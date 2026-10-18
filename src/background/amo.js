// AMO (addons.mozilla.org) lookups for the export. Needs core.js (shortName).
// Background only.

// Used when a 429 comes back without a Retry-After header.
const AMO_RETRY_AFTER_DEFAULT_MS = 1000;
// A server could send anything in Retry-After, so a retry never waits longer than this.
const AMO_RETRY_AFTER_MAX_MS = 10000;

// Retry-After is in seconds. Split out so it can be tested without waiting.
function computeRetryAfterMs(headerValue) {
  if (headerValue == null || headerValue === '') {
    return AMO_RETRY_AFTER_DEFAULT_MS;
  }
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return AMO_RETRY_AFTER_DEFAULT_MS;
  return Math.min(seconds * 1000, AMO_RETRY_AFTER_MAX_MS);
}

// Fetches a URL and parses its JSON. The timeout covers the body read too:
// an AbortController that only wraps fetch() is cleared as soon as the headers
// arrive, so a server that stalls mid-body would hang forever.
//
// Returns one of:
//   { ok: true, status, data }
//   { ok: true, status: 404, data: null }   (not found is not a failure)
//   { ok: false, status, error }
//
// A 429 is retried once, after Retry-After.
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
    // one retry only
    if (!second.ok && second.status === 429) {
      return { ok: false, status: 429, error: 'HTTP 429 (after one retry)' };
    }
    return second;
  }
  return first;
}

// AMO sends names as {"en-US": "uBlock Origin"} unless a `lang` param is
// given (we don't). Handles both shapes.
function extractTranslatedField(field) {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const values = Object.values(field).filter((v) => typeof v === 'string' && v);
    return values[0] || '';
  }
  return '';
}

// Checks that a search result really is the installed add-on, so we don't
// trust whatever AMO ranks first. Accepts an exact match, a match after
// cutting the tagline off like shortName() does, or enough shared words in
// both directions.
function isPlausibleNameMatch(installedName, resultName) {
  const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = normalize(installedName);
  const b = normalize(resultName);
  if (!a || !b) return false;
  if (a === b) return true;

  // "uBlock Origin" vs "uBlock Origin: Ad Blocker". Doing this on the
  // truncated names keeps the word check below strict enough to still reject
  // "uBlock Origin" vs "uBlock Origin Lite".
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
  // Both sides have to overlap. With only the installed name's ratio, "Dark
  // Mode" matched "Dark Reader" and "uBlock Origin" matched "uBlock Origin Lite".
  return shared / wordsA.size >= 0.7 && shared / wordsB.size >= 0.7;
}

const AMO_API_BASE = 'https://addons.mozilla.org/api/v5';
const AMO_FETCH_TIMEOUT_MS = 15000;

// Exact ID lookup first, then a name search. Returns { url, matchType } or
// null. onFailure() is called once per real failure (network error, timeout,
// non-2xx/404), not for a 404 or an empty search.
async function findAmoPage(id, name, onFailure) {
  const exact = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/addon/${encodeURIComponent(id)}/`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (exact.ok) {
    if (exact.status !== 404) {
      if (exact.data && exact.data.url) return { url: exact.data.url, matchType: 'amo-exact' };
      console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) returned no url field`, exact.data);
    }
    // 404 just means it isn't on AMO
  } else {
    console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) failed:`, exact.error || `HTTP ${exact.status}`);
    if (onFailure) onFailure();
  }

  const search = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (search.ok) {
    const top = search.data && search.data.results && search.data.results[0];
    if (top && top.url && isPlausibleNameMatch(name, extractTranslatedField(top.name))) {
      return { url: top.url, matchType: 'amo-search' };
    }
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) returned no plausible match`, search.data);
  } else {
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) failed:`, search.error || `HTTP ${search.status}`);
    if (onFailure) onFailure();
  }

  return null;
}
