// Shared helpers used by background.js, report-template.js, export.js,
// and import.js.

// Bump if the exported JSON shape ever changes.
const EXPORT_FORMAT_VERSION = 1;

// Storage key for the user's chosen export file format.
// Valid values: 'html' | 'json' | 'csv'. Defaults to 'html' when unset.
const EXPORT_FORMAT_STORAGE_KEY = 'exportFormat';
const EXPORT_FORMAT_DEFAULT = 'html';

// Storage key for the shorten-add-on-names setting.
// Valid values: 'on' | 'off'. Defaults to 'on' when unset.
const SHORT_NAME_STORAGE_KEY = 'shortenNames';
const SHORT_NAME_DEFAULT = 'on';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Add-on names/links aren't trustworthy - could be a sideloaded
// extension or a hand-edited import file.
function isSafeUrl(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// Used when a 429 response gives no Retry-After header.
const AMO_RETRY_AFTER_DEFAULT_MS = 1000;
// Caps how long a single retry ever waits, in case a server sends back
// something absurd (or malicious) in its Retry-After header.
const AMO_RETRY_AFTER_MAX_MS = 10000;

// Parses a Retry-After header (seconds, per RFC 9110) into a capped
// delay in ms. Split out from fetchJsonWithTimeout so the parsing/capping
// itself can be tested without an actual wait.
function computeRetryAfterMs(headerValue) {
  if (headerValue === null || headerValue === undefined || headerValue === '') {
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
  if (!first.ok && first.status === 429) {
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

// Returns a shortened display name by truncating at the first common
// separator (dash, en-dash, em-dash, colon, or comma).
// "Buster: Captcha Solver for Humans" → "Buster"
// "StayFree - Website Blocker, ..." → "StayFree"
// "Proton VPN: Fast & Secure" → "Proton VPN"
function shortName(name) {
  const match = String(name).match(/^(.+?)(?:\s+[-–—]|\s*[,:])/);
  return match ? match[1].trim() : String(name);
}

// Select all/Deselect all only touch what the current search still shows -
// a checked box that gets filtered out of view stays checked.
function visibleCheckboxes(allCheckboxes) {
  return Array.from(allCheckboxes).filter((cb) => cb.closest('.addon-row').style.display !== 'none');
}

// No label for an exact match - that's the expected common case, only
// worth flagging when the link is less certain.
const LINK_TYPE_LABELS = {
  'amo-search': 'Possible match',
  'homepage': 'Homepage',
  'amo-search-fallback': 'Search results',
};
const UNCERTAIN_LINK_TYPES = new Set(['amo-search', 'amo-search-fallback']);

// Filters .addon-row elements by search query (matched against each row's
// .addon-name only, not version numbers or match-type labels), hiding a
// .group-box if none of its rows still match. Returns true if
// anything's visible.
//
// NOTE: report-template.js's buildHtmlReport() has its own copy of this
// inlined into the exported report (it can't load common.js once saved
// elsewhere). Keep both copies in sync if you change this.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let anyMatch = false;

  // Group containers can sit at any depth - export.js/import.js now wrap
  // them in an outer .groups-outer-box (see appendGroup()/renderList()/
  // renderAddonList()), so they're no longer necessarily direct children
  // of `container`. querySelectorAll finds them regardless of nesting;
  // container.children below only ever finds true top-level flat
  // structures, which is why that loop is kept separate rather than
  // merged into this one.
  for (const el of container.querySelectorAll('.group-container')) {
    const box = el.querySelector('.group-box');
    let groupHasMatch = false;
    if (box) {
      for (const child of box.children) {
        if (child.classList.contains('addon-row')) {
          const nameEl = child.querySelector('.addon-name');
          const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
          child.style.display = match ? '' : 'none';
          if (match) { groupHasMatch = true; anyMatch = true; }
        }
      }
    }
    el.style.display = groupHasMatch ? '' : 'none';
  }

  for (const el of container.children) {
    if (el.classList.contains('group-container')) {
      // Already handled by the querySelectorAll pass above.
      continue;
    } else if (el.classList.contains('group-box')) {
      // Legacy flat group-box (report template still uses this).
      let groupHasMatch = false;
      for (const child of el.children) {
        if (child.classList.contains('addon-row')) {
          const nameEl = child.querySelector('.addon-name');
          const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
          child.style.display = match ? '' : 'none';
          if (match) { groupHasMatch = true; anyMatch = true; }
        }
      }
      el.style.display = groupHasMatch ? '' : 'none';
    } else if (el.classList.contains('addon-row')) {
      // Fallback: flat structure (e.g. report template).
      const nameEl = el.querySelector('.addon-name');
      const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
      el.style.display = match ? '' : 'none';
      if (match) anyMatch = true;
    }
  }
  return anyMatch;
}
