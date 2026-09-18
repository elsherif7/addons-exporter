// Shared helpers used by background.js, report-template.js, export.js,
// and import.js.

// Bump if the exported JSON shape ever changes.
const EXPORT_FORMAT_VERSION = 1;

// Storage key for the user's chosen export file format.
// Valid values: 'html' | 'json' | 'csv'. Defaults to 'html' when unset.
const EXPORT_FORMAT_STORAGE_KEY = 'exportFormat';
const EXPORT_FORMAT_DEFAULT = 'html';

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
// search API ranks first. Normalizes punctuation/case away, then accepts
// an exact match, a substring match either direction (handles a listing
// title with an extra tagline, e.g. "uBlock Origin" vs "ublock origin ad
// blocker"), or enough shared significant words to not be a coincidence.
function isPlausibleNameMatch(installedName, resultName) {
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = normalize(installedName);
  const b = normalize(resultName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const significantWords = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.size === 0) return false;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  // At least half the installed add-on's significant words show up in the
  // result - loose enough for reordering/extra words, tight enough to
  // reject an unrelated top result.
  return shared / wordsA.size >= 0.5;
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
// .group-heading if none of its rows still match. Returns true if
// anything's visible.
//
// NOTE: report-template.js's buildHtmlReport() has its own copy of this
// inlined into the exported report (it can't load common.js once saved
// elsewhere). Keep both copies in sync if you change this.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let heading = null;
  let headingHasMatch = false;
  let anyMatch = false;

  const finishHeading = () => {
    if (heading) heading.style.display = headingHasMatch ? '' : 'none';
  };

  for (const el of container.children) {
    if (el.classList.contains('group-heading')) {
      finishHeading();
      heading = el;
      headingHasMatch = false;
    } else if (el.classList.contains('addon-row')) {
      const nameEl = el.querySelector('.addon-name');
      const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
      el.style.display = match ? '' : 'none';
      if (match) {
        headingHasMatch = true;
        anyMatch = true;
      }
    }
  }
  finishHeading();
  return anyMatch;
}
