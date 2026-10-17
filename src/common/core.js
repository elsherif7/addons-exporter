// Core helpers: the pure data and settings code every part of the extension
// shares - the export format registry, the settings schema and loader, text
// helpers and display labels. Nothing here touches the page or the network, so
// it is loaded EVERYWHERE: the background (manifest.json) and every page, always
// first. Page-only code lives in page-ui.js, AMO lookups in background/amo.js.

// Bump if the exported data's shape ever changes.
//   1: the add-ons only.
//   2: also a "source" - the format version, the file type, and where the
//      export came from (the browser and its version and this extension's
//      version). The Importer still reads 1.
const EXPORT_FORMAT_VERSION = 2;

// Where an export came from and what the file is, written into every export
// file. The format version (the same number EXPORT_FORMAT_VERSION holds - the
// version of the export format itself) and the file type come first, then the
// browser details. The browser is free text (whatever the browser calls itself:
// "Firefox", "LibreWolf", "Waterfox", and later "Chrome" or anything else), so
// a new browser never needs a new format version. Kept to plain characters so
// it reads the same in JSON, CSV, TXT and HTML and can be checked strictly.
const SOURCE_KEYS = ['formatVersion', 'fileType', 'basedOn', 'browser', 'browserVersion', 'extensionVersion'];
// The file types a source can name: one per export format, plus the Settings file.
const FILE_TYPES = ['html', 'json', 'csv', 'txt', 'settings'];
// The part of the source that describes the browser - everything the file
// itself does not already know.
const BROWSER_KEYS = ['basedOn', 'browser', 'browserVersion', 'extensionVersion'];
const UNKNOWN_BROWSER = Object.freeze({ basedOn: 'Unknown', browser: 'Unknown', browserVersion: 'unknown', extensionVersion: 'unknown' });
const SOURCE_TEXT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._+-]{0,62}[A-Za-z0-9._+-])?$/;

// Reduces any value to text that passes SOURCE_TEXT_PATTERN, or `fallback`.
function cleanSourceText(value, fallback) {
  const text = String(value == null ? '' : value).replace(/[^A-Za-z0-9 ._+-]/g, '').replace(/ +/g, ' ').trim().slice(0, 64).trim();
  return SOURCE_TEXT_PATTERN.test(text) ? text : fallback;
}

// The browser part of the source: four clean values, in order. Anything missing
// or unusable becomes "Unknown" / "unknown", so a file is always written.
function makeBrowserSource(browserName, browserVersion, extensionVersion, basedOn) {
  return {
    basedOn: cleanSourceText(basedOn, UNKNOWN_BROWSER.basedOn),
    browser: cleanSourceText(browserName, UNKNOWN_BROWSER.browser),
    browserVersion: cleanSourceText(browserVersion, UNKNOWN_BROWSER.browserVersion),
    extensionVersion: cleanSourceText(extensionVersion, UNKNOWN_BROWSER.extensionVersion),
  };
}
function normalizeBrowserSource(source) {
  const s = source && typeof source === 'object' ? source : {};
  return makeBrowserSource(s.browser, s.browserVersion, s.extensionVersion, s.basedOn);
}

// The full source block a file carries: its format version and file type, then
// the browser part above. Every format writes exactly this shape, in this order.
function makeSource(fileType, formatVersion, browserSource) {
  const b = normalizeBrowserSource(browserSource);
  return {
    formatVersion,
    fileType,
    basedOn: b.basedOn,
    browser: b.browser,
    browserVersion: b.browserVersion,
    extensionVersion: b.extensionVersion,
  };
}

// Exactly these keys, in exactly this order (JSON.parse keeps a file's order).
// The one place "the fields are exactly these, in this order" is written: the
// source check below and the Importer's payload check (parsers.js) both use it.
function hasExactKeys(obj, keys) {
  const have = Object.keys(obj);
  return have.length === keys.length && keys.every((k, i) => have[i] === k);
}

// null when `source` is exactly what an exporter writes, otherwise a short
// reason. When `fileType` is given, the source must name exactly that file type.
function sourceProblem(source, fileType) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return 'it is not an object';
  if (!hasExactKeys(source, SOURCE_KEYS)) {
    return 'its fields are not exactly ' + SOURCE_KEYS.join(', ') + ', in that order';
  }
  if (!Number.isInteger(source.formatVersion) || source.formatVersion < 1) return 'its format version is not a positive whole number';
  if (!FILE_TYPES.includes(source.fileType)) return 'its file type is not one of ' + FILE_TYPES.join(', ');
  if (fileType !== undefined && source.fileType !== fileType) return `its file type is not "${fileType}"`;
  for (const k of BROWSER_KEYS) {
    if (typeof source[k] !== 'string' || !SOURCE_TEXT_PATTERN.test(source[k])) return `${k} is not plain text`;
  }
  return null;
}

// The source as CSV and TXT carry it: one comment line per field, in
// SOURCE_KEYS order - so a plain-text file starts with a header that names its
// own format version and file type.
function sourceCommentLines(source) {
  return SOURCE_KEYS.map((key) => `# addons-hub-source-${key}: ${source[key]}`);
}
// Reads those comment lines (an array, in order): the source, or null if they
// are anything but exactly the six lines sourceCommentLines() writes.
function parseSourceCommentLines(lines, fileType) {
  if (!Array.isArray(lines) || lines.length !== SOURCE_KEYS.length) return null;
  const raw = {};
  for (let i = 0; i < SOURCE_KEYS.length; i++) {
    const m = typeof lines[i] === 'string' && lines[i].match(/^# addons-hub-source-([A-Za-z]+): (.*)$/);
    if (!m || m[1] !== SOURCE_KEYS[i]) return null;
    raw[SOURCE_KEYS[i]] = m[2];
  }
  const source = {
    formatVersion: /^\d+$/.test(raw.formatVersion) ? parseInt(raw.formatVersion, 10) : raw.formatVersion,
    fileType: raw.fileType,
    basedOn: raw.basedOn,
    browser: raw.browser,
    browserVersion: raw.browserVersion,
    extensionVersion: raw.extensionVersion,
  };
  return sourceProblem(source, fileType) ? null : source;
}

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

// The localStorage cache keys the Settings page uses to pre-apply its controls
// before the first paint: settings.js writes the current choice here after each
// change, and settings-init.js reads it back synchronously on the next open.
// Kept in one place so the two files can never drift apart.
const SETTINGS_CACHE_KEYS = {
  exportFormat: 'addons-hub-settings-exportFormat',
  shortenNames: 'addons-hub-settings-shortenNames',
};

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

// The timestamp every downloaded file's name carries - "2026-10-17_14-05-09"
// in local time - so two exports into the same folder never overwrite each
// other. Used by background.js (the add-on exports) and settings.js (the
// settings file).
function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// Stagger between opening add-on tabs, so dozens of add-ons don't all burst
// open at once. Used by import.js (fallback) and background.js.
const TAB_OPEN_DELAY_MS = 150;

// How long a downloaded blob's object URL is kept alive before it is revoked -
// long enough that a slow Save dialog cannot break the download. Used by
// background.js (an add-on export) and settings.js (a settings export).
const OBJECT_URL_REVOKE_MS = 30000;

// What a row's link is called on screen: "AMO" for a page on addons.mozilla.org,
// otherwise the site it really points to ("example.com"), so a homepage or a
// hand-edited link is never presented as an AMO page. Anything that is not a
// readable web address gets the plain word "Link".
function linkLabel(link) {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return 'Link';
    return host === 'addons.mozilla.org' ? 'AMO' : host;
  } catch {
    return 'Link';
  }
}

// The AMO search page for an add-on's name - the last-resort link. Used by the
// Exporter's row link (export.js) and by the background's own fallback when no
// exact AMO page or homepage was found, so the two always point at the same URL.
function amoSearchUrl(name) {
  return `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(name)}`;
}
