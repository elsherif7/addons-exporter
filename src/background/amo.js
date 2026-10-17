// AMO (addons.mozilla.org) lookups used by the background's export: the
// fetch helper with its retry, the name-match check and findAmoPage(). Needs
// core.js (shortName) loaded first. Background only - no page loads this.

// Used when a 429 response gives no Retry-After header.
const AMO_RETRY_AFTER_DEFAULT_MS = 1000;
// Caps how long a single retry ever waits, in case a server sends back
// something absurd (or malicious) in its Retry-After header.
const AMO_RETRY_AFTER_MAX_MS = 10000;

// Parses a Retry-After header (seconds, per RFC 9110) into a capped
// delay in ms. Split out from fetchJsonWithTimeout so the parsing/capping
// itself can be tested without an actual wait.
function computeRetryAfterMs(headerValue) {
  if (headerValue == null || headerValue === '') {
    return AMO_RETRY_AFTER_DEFAULT_MS;
  }
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return AMO_RETRY_AFTER_DEFAULT_MS;
  return Math.min(seconds * 1000, AMO_RETRY_AFTER_MAX_MS);
}

// Fetches a URL and parses its JSON body, with `timeoutMs` covering the
// whole thing - the network request AND the body read. A plain
// AbortController tied only around fetch() doesn't do that: once fetch()
// resolves with a Response, the timer that could still abort it has
// already been cleared, so a response whose body stalls (a slow or
// wedged server, not just a slow connection) hangs well past the
// intended timeout.
//
// Returns:
//   { ok: true, status, data }        - success, parsed JSON body
//   { ok: true, status: 404, data: null } - "not found" isn't a failure,
//                                            just means nothing's there
//   { ok: false, status, error }      - a genuine failure: network error,
//                                        timeout, or a non-2xx/404 status
//
// On a 429, retries exactly once, honoring the response's Retry-After
// header (capped - see computeRetryAfterMs above).
async function fetchJsonWithTimeout(url, timeoutMs) {
  async function attempt() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (res.status === 404) {
        return { ok: true, status: 404, data: null };
      }
      if (res.status === 429) {
        const header = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
        return { ok: false, status: 429, retryAfterMs: computeRetryAfterMs(header) };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: null, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  const first = await attempt();
  if (first.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, first.retryAfterMs));
    const second = await attempt();
    // A second 429 isn't retried again - one retry is enough to ride out
    // a brief limit; a server still saying no after that just fails.
    if (!second.ok && second.status === 429) {
      return { ok: false, status: 429, error: 'HTTP 429 (after one retry)' };
    }
    return second;
  }
  return first;
}

// AMO's API returns "translated fields" (name, summary, etc.) as an object
// keyed by locale - e.g. {"en-US": "uBlock Origin"} - unless a `lang` param
// is passed, which findAmoPage() doesn't do. Pulls out a usable string
// either way, so callers don't need to know which shape they got.
function extractTranslatedField(field) {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const values = Object.values(field).filter((v) => typeof v === 'string' && v);
    return values[0] || '';
  }
  return '';
}

// Whether an AMO search result's name is a plausible match for the
// installed add-on's name, rather than blindly trusting whatever the
// search API ranks first. Normalizes punctuation/case away (keeping any
// script's letters and digits, not just a-z0-9), then accepts an exact
// match, a match after stripping a tagline the same way shortName() does
// for display (handles "uBlock Origin" vs "uBlock Origin: Ad Blocker"),
// or enough shared significant words in both directions to not be a
// coincidence.
function isPlausibleNameMatch(installedName, resultName) {
  const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = normalize(installedName);
  const b = normalize(resultName);
  if (!a || !b) return false;
  if (a === b) return true;

  // A listing title often tacks on a tagline after a separator - the same
  // ones shortName() truncates at for display (colon, dash, comma) - e.g.
  // "uBlock Origin" vs "uBlock Origin: Ad Blocker". Comparing against the
  // truncated form catches that without loosening the word-overlap check
  // below enough to also accept a same-shaped but different add-on with no
  // such separator (e.g. "uBlock Origin" vs "uBlock Origin Lite").
  const shortA = normalize(shortName(installedName));
  const shortB = normalize(shortName(resultName));
  if (shortA === b || a === shortB || shortA === shortB) return true;

  const significantWords = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  // Requires most of BOTH names' significant words to overlap, not just
  // the installed add-on's - a one-sided ratio let a short, generic name
  // (e.g. "Dark Mode") match an unrelated one sharing a single word (e.g.
  // "Dark Reader"), and let "uBlock Origin" match "uBlock Origin Lite", a
  // different add-on.
  return shared / wordsA.size >= 0.7 && shared / wordsB.size >= 0.7;
}

const AMO_API_BASE = 'https://addons.mozilla.org/api/v5';
const AMO_FETCH_TIMEOUT_MS = 15000;

// Tries an exact ID lookup first, then a name search. Returns
// { url, matchType } or null. onFailure(), if given, is called once per
// genuine failure (network error, timeout, or a non-2xx/404 status) -
// not for a clean 404 or a search that simply found nothing plausible,
// since neither of those means anything is actually wrong.
async function findAmoPage(id, name, onFailure) {
  // 1. Exact lookup by addon ID/GUID
  const exact = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/addon/${encodeURIComponent(id)}/`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (exact.ok) {
    if (exact.status !== 404) {
      if (exact.data && exact.data.url) return { url: exact.data.url, matchType: 'amo-exact' };
      console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) returned no url field`, exact.data);
    }
    // A 404 here just means it's not on AMO - not worth a warning, and
    // not a failure (see the doc comment above).
  } else {
    console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) failed:`, exact.error || `HTTP ${exact.status}`);
    if (onFailure) onFailure();
  }

  // 2. Fuzzy search by name
  const search = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (search.ok) {
    const top = search.data && search.data.results && search.data.results[0];
    if (top && top.url && isPlausibleNameMatch(name, extractTranslatedField(top.name))) {
      return { url: top.url, matchType: 'amo-search' };
    }
    // Either no results, or the top result's name didn't clear the
    // relevance bar - don't hand back an unrelated add-on just
    // because it happened to rank first.
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) returned no plausible match`, search.data);
  } else {
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) failed:`, search.error || `HTTP ${search.status}`);
    if (onFailure) onFailure();
  }

  return null;
}
