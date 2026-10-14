// Core helpers: the pure data and settings code every part of the extension
// shares - the export format registry, the settings schema and loader, text
// helpers and display labels. Nothing here touches the page or the network, so
// it is loaded EVERYWHERE: the background (manifest.json) and every page, always
// first. Page-only code lives in page-ui.js, AMO lookups in background/amo.js.

// Bump if the exported JSON shape ever changes.
const EXPORT_FORMAT_VERSION = 1;

// Storage key for the user's chosen export file format(s).
// One format is stored as its plain string; more than one as an array of them,
// e.g. ['html', 'json']. Defaults to 'html' when unset.
const EXPORT_FORMAT_STORAGE_KEY = 'exportFormat';
const EXPORT_FORMAT_DEFAULT = 'html';

// The ONE list of export formats. Everything that needs to know about a
// format reads it from here: the order they are listed and exported in, the
// name shown in messages, the file extension, the MIME type of a single saved
// file, and the text on the Settings page. Adding a format starts here (the
// builder in report-template.js, the case in background.js and the importer
// still need their own code; a test checks Settings lists exactly these).
const EXPORT_FORMAT_REGISTRY = [
  { id: 'html', label: 'HTML report', title: 'HTML', extension: 'html', mime: 'text/html',
    description: 'A readable report you can open in any browser. Add-ons Importer can read it back.' },
  { id: 'json', label: 'JSON file', title: 'JSON', extension: 'json', mime: 'application/json',
    description: 'Plain data for other tools. Add-ons Importer can read it back.' },
  { id: 'csv', label: 'CSV file', title: 'CSV', extension: 'csv', mime: 'text/csv',
    description: 'A table for Excel or any spreadsheet. Add-ons Importer can read it back.' },
  { id: 'txt', label: 'TXT file', title: 'TXT', extension: 'txt', mime: 'text/plain',
    description: 'A simple list, one add-on per line. Add-ons Importer can read it back.' },
];
// Every format id, in the fixed order they are listed and exported in.
const EXPORT_FORMATS = EXPORT_FORMAT_REGISTRY.map((f) => f.id);

// The registry entry for a format id; an unknown one gets the default's.
function getExportFormat(fmt) {
  return EXPORT_FORMAT_REGISTRY.find((f) => f.id === fmt) ||
    EXPORT_FORMAT_REGISTRY.find((f) => f.id === EXPORT_FORMAT_DEFAULT);
}

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

// Every export lists enabled add-ons first and disabled ones after, each
// group A-Z - easier to read than one long mixed list. This is the ONE place
// that grouping is done; the HTML report, TXT, CSV, JSON and the Exporter's
// list all use it.
// Returns { enabled, disabled, all } (all = enabled then disabled).
function groupForReading(list) {
  const enabled = list.filter((a) => a.enabled).sort(byName);
  const disabled = list.filter((a) => !a.enabled).sort(byName);
  return { enabled, disabled, all: [...enabled, ...disabled] };
}

// The human-readable file type for a format id ("HTML report", "JSON file"...).
// Shared by export.js (the description text) and confirmation.js (the "done"
// message). Anything unknown reads as the default format.
function formatLabel(fmt) {
  return getExportFormat(fmt).label;
}

// Turns whatever is stored (or passed around) for the export format - a
// single format string, an array of them, or a comma-separated string such
// as 'html,json' (how the confirmation page's address carries several) -
// into a clean list: only known formats, no repeats, always in the fixed
// EXPORT_FORMATS order. Nothing usable gives the default, so there is always
// at least one.
function resolveExportFormats(val) {
  const raw = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',') : []);
  const picked = EXPORT_FORMATS.filter((f) => raw.includes(f));
  return picked.length ? picked : [EXPORT_FORMAT_DEFAULT];
}

// The form to store a list of formats in: a lone format as its plain string
// (a plain string, the simplest thing to store), several as an array.
function serializeExportFormats(list) {
  const formats = resolveExportFormats(list);
  return formats.length === 1 ? formats[0] : formats;
}

// "HTML report", "HTML report and JSON file", "HTML report, JSON file and
// CSV file" - for plain-text messages.
function formatLabelsText(fmts) {
  const labels = resolveExportFormats(fmts).map(formatLabel);
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
}

// Shared value-checking for two of the three settings (the third, theme,
// is already centralized in theme.js's resolveTheme()) - storage can
// hold anything (a stale value, or something written directly), so a stored value is checked against its known-good
// set rather than trusted as-is. Previously each of export.js, settings.js
// and background.js had its own copy of this same check.
function isValidExportFormat(val) {
  return EXPORT_FORMATS.includes(val);
}
function isValidShortenNames(val) {
  return val === 'on' || val === 'off';
}
function resolveShortenNames(val) {
  return isValidShortenNames(val) ? val : SHORT_NAME_DEFAULT;
}

// The settings schema: every stored setting, its storage key, its default and
// how a stored value is turned into a safe one (storage can hold anything -
// a stale value, or something written directly - so a value is checked
// against its known-good set, never trusted). Theme's key is the literal
// 'theme', not theme.js's THEME_STORAGE_KEY, because background.js cannot
// load theme.js (it has no document to apply a theme to); a tripwire test
// confirms the literal matches.
const SETTINGS_SCHEMA = {
  theme: { key: 'theme', default: 'light', resolve: (v) => (v === 'dark' ? 'dark' : 'light') },
  exportFormats: { key: EXPORT_FORMAT_STORAGE_KEY, default: [EXPORT_FORMAT_DEFAULT], resolve: resolveExportFormats },
  shortenNames: { key: SHORT_NAME_STORAGE_KEY, default: SHORT_NAME_DEFAULT, resolve: resolveShortenNames },
};
const SETTINGS_STORAGE_KEYS = Object.values(SETTINGS_SCHEMA).map((d) => d.key);

function defaultSettings() {
  const out = {};
  for (const [name, def] of Object.entries(SETTINGS_SCHEMA)) {
    out[name] = Array.isArray(def.default) ? def.default.slice() : def.default;
  }
  return out;
}

// THE way to read settings: one storage.local.get for all of them, each
// checked by the schema. Used by the Exporter, Importer, Settings page and
// background alike. Every setting falls back to its default if the read
// itself fails. Returns { theme, exportFormats, shortenNames }.
async function loadSettings() {
  try {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEYS);
    const out = {};
    for (const [name, def] of Object.entries(SETTINGS_SCHEMA)) {
      out[name] = def.resolve(stored[def.key]);
    }
    return out;
  } catch {
    return defaultSettings();
  }
}

// Calls handler(changedNames, settings) whenever any stored setting changes
// (from another tab, an import or a reset). changedNames lists the schema
// names that changed; settings is a fresh loadSettings() result, so a reset
// (value removed) arrives as the default. Pages without storage.onChanged are
// left alone.
function onSettingsChanged(handler) {
  if (typeof browser === 'undefined' || !browser.storage || !browser.storage.onChanged) return;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = Object.keys(SETTINGS_SCHEMA).filter((n) => changes[SETTINGS_SCHEMA[n].key]);
    if (!changed.length) return;
    loadSettings().then((settings) => handler(changed, settings));
  });
}

// How an add-on's type is written for people (the TXT export, the report, the
// Exporter and Importer lists) and the reverse, for reading it back. Anything
// that is not exactly "Theme" or "Extension" is not a type: parseType()
// returns null for it.
function typeLabel(type) {
  return type === 'theme' ? 'Theme' : 'Extension';
}
function parseType(label) {
  if (label === 'Theme') return 'theme';
  if (label === 'Extension') return 'extension';
  return null;
}

// "a" or "an" for a label that might start with a capitalized acronym
// (e.g. "HTML report", "JSON file"). A plain first-letter vowel check
// gets acronyms wrong: "HTML" is read out letter by letter as
// "aitch-tee-em-el" - a vowel sound despite H being a consonant letter -
// so it needs "an", not "a". A few single letters exist whose *name*
// starts with a vowel sound even though the letter itself doesn't: this
// covers all of them, not just the ones this extension happens to use
// today (HTML/JSON/CSV/TXT).
function indefiniteArticleFor(label) {
  const firstWord = String(label).trim().split(/\s+/)[0] || '';
  if (/^[A-Z]{2,}$/.test(firstWord)) {
    const VOWEL_SOUND_INITIALS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);
    return VOWEL_SOUND_INITIALS.has(firstWord[0]) ? 'an' : 'a';
  }
  return /^[aeiou]/i.test(firstWord) ? 'an' : 'a';
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

// No label for an exact match - that's the expected common case, only
// worth flagging when the link is less certain.
const LINK_TYPE_LABELS = {
  'amo-search': 'Possible match',
  'homepage': 'Homepage',
  'amo-search-fallback': 'Search results',
};
const UNCERTAIN_LINK_TYPES = new Set(['amo-search', 'amo-search-fallback']);

// Stagger between opening add-on tabs, so dozens of add-ons don't all burst
// open at once. Used by import.js (fallback) and background.js.
const TAB_OPEN_DELAY_MS = 150;
