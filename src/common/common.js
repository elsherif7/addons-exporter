// Shared helpers used by background.js, report-template.js, export.js,
// import.js, confirmation.js, and settings.js.

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

// Maps the stored exportFormat value to a human-readable file type label.
// Shared by export.js (the description text) and confirmation.js (the
// "done" message) - previously each had its own copy of this.
function formatLabel(fmt) {
  if (fmt === 'json') return 'JSON file';
  if (fmt === 'csv') return 'CSV file';
  return 'HTML report';
}

// Shared value-checking for two of the three settings (the third, theme,
// is already centralized in theme.js's resolveTheme()) - storage can
// hold anything (a stale value from an older version, or something
// written directly), so a stored value is checked against its known-good
// set rather than trusted as-is. Previously each of export.js, settings.js
// and background.js had its own copy of this same check.
function isValidExportFormat(val) {
  return val === 'html' || val === 'json' || val === 'csv';
}
function isValidShortenNames(val) {
  return val === 'on' || val === 'off';
}
function resolveExportFormat(val) {
  return isValidExportFormat(val) ? val : EXPORT_FORMAT_DEFAULT;
}
function resolveShortenNames(val) {
  return isValidShortenNames(val) ? val : SHORT_NAME_DEFAULT;
}

// Reads all three settings in a single storage.local.get call, applying
// the same validation each individual reader already did on its own.
// Falls back to every default if the read itself fails, matching how
// each site already treated that case before this was consolidated.
// Written for background.js in particular, which can't load theme.js
// (it has no document to apply a theme to) - so the theme key here is
// the literal 'theme' string, not theme.js's THEME_STORAGE_KEY constant.
// A tripwire test confirms that literal matches theme.js's key.
async function getStoredSettings() {
  try {
    const stored = await browser.storage.local.get(['theme', EXPORT_FORMAT_STORAGE_KEY, SHORT_NAME_STORAGE_KEY]);
    return {
      theme: stored.theme === 'dark' ? 'dark' : 'light',
      exportFormat: resolveExportFormat(stored[EXPORT_FORMAT_STORAGE_KEY]),
      shortenNames: resolveShortenNames(stored[SHORT_NAME_STORAGE_KEY]),
    };
  } catch {
    return { theme: 'light', exportFormat: EXPORT_FORMAT_DEFAULT, shortenNames: SHORT_NAME_DEFAULT };
  }
}

// "a" or "an" for a label that might start with a capitalized acronym
// (e.g. "HTML report", "JSON file"). A plain first-letter vowel check
// gets acronyms wrong: "HTML" is read out letter by letter as
// "aitch-tee-em-el" - a vowel sound despite H being a consonant letter -
// so it needs "an", not "a". A few single letters exist whose *name*
// starts with a vowel sound even though the letter itself doesn't: this
// covers all of them, not just the ones this extension happens to use
// today (HTML/JSON/CSV).
function indefiniteArticleFor(label) {
  const firstWord = String(label).trim().split(/\s+/)[0] || '';
  if (/^[A-Z]{2,}$/.test(firstWord)) {
    const VOWEL_SOUND_INITIALS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);
    return VOWEL_SOUND_INITIALS.has(firstWord[0]) ? 'an' : 'a';
  }
  return /^[aeiou]/i.test(firstWord) ? 'an' : 'a';
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
// Shows or hides `el` the way search filtering does: display plus an
// .is-filtered class, which shared.css turns into a fade out / fade in
// (and which is simply instant where that CSS isn't supported).
// `shownDisplay` is what display becomes when visible ('' = stylesheet
// default).
function setFilterVisible(el, visible, shownDisplay = '') {
  el.style.display = visible ? shownDisplay : 'none';
  if (el.classList) el.classList.toggle('is-filtered', !visible);
}

// NOTE: report-template.js's buildHtmlReport() has its own copy of this
// (and of setFilterVisible above) inlined into the exported report (it
// can't load common.js once saved elsewhere). Keep both copies in sync if
// you change this.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let anyMatch = false;

  // Group containers can sit at any depth - export.js/import.js/the report
  // all wrap them in an outer .groups-outer-box (see appendGroup()/
  // renderList()/renderAddonList()), so they're no longer necessarily
  // direct children of `container`. querySelectorAll finds them
  // regardless of nesting.
  for (const el of container.querySelectorAll('.group-container')) {
    const box = el.querySelector('.group-box');
    let groupHasMatch = false;
    if (box) {
      for (const child of box.children) {
        if (child.classList.contains('addon-row')) {
          const nameEl = child.querySelector('.addon-name');
          const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
          setFilterVisible(child, match);
          if (match) { groupHasMatch = true; anyMatch = true; }
        }
      }
    }
    setFilterVisible(el, groupHasMatch);
  }

  return anyMatch;
}

// Used by export.js and import.js when they finish: the page fades out
// and is replaced, in the same tab, by the confirmation page (instead of
// opening a second tab next to it). The fade uses the Web Animations API
// on the page's .card and is skipped when that isn't available or the
// user has asked for reduced motion, so callers can always just await it.
const PAGE_FADE_MS = 380;

// Resolves once the card has faded out, with the animation (held at its
// final frame) so the caller can undo it, or null if nothing was animated.
async function fadeOutPage() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const card = document.querySelector('.card');
  if (!card || typeof card.animate !== 'function') return null;
  try {
    const anim = card.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-24px) scale(0.95)' },
      ],
      { duration: PAGE_FADE_MS, easing: 'ease-in', fill: 'forwards' }
    );
    await anim.finished;
    return anim;
  } catch {
    return null; // cosmetic only - never block the hand-off
  }
}

// `query` is the confirmation page's query string, e.g. 'from=export&format=csv'.
// location.replace (not assign) so the back button doesn't return to a
// finished export/import page.
async function goToConfirmation(query) {
  const anim = await fadeOutPage();
  try {
    location.replace(browser.runtime.getURL(`src/confirmation/confirmation.html?${query}`));
  } catch (e) {
    if (anim) { try { anim.cancel(); } catch { /* already gone */ } }
    throw e;
  }
}

// Restarts the page's entrance animation (the .card and its children
// spring in again). Used when an already-open tab is brought back to the
// front - e.g. Settings, which Firefox reuses instead of reopening - so it
// gets the same entrance as a freshly opened page. shared.css's
// .replay-reset switches the animations off for one frame; forcing a
// reflow in between makes them start over.
function replayEntrance() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const card = document.querySelector('.card');
  if (!card || !card.classList) return;
  card.classList.add('replay-reset');
  void card.offsetWidth;
  card.classList.remove('replay-reset');
}

// Stagger between opening add-on tabs, so dozens of add-ons don't all burst
// open at once. Used by import.js (fallback) and background.js.
const TAB_OPEN_DELAY_MS = 150;

