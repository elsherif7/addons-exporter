// Shared helpers. Loaded first everywhere (background and every page), so
// nothing in here may touch the page or the network.

// Bump this if the shape of the exported data changes.
//   1: just the add-ons
//   2: also a "source" (format version, file type, browser info)
const EXPORT_FORMAT_VERSION = 2;

// What every export file says about itself, in this exact order. The Importer
// checks the order strictly. The browser is free text so a new browser never
// needs a new format version.
const SOURCE_KEYS = ['formatVersion', 'fileType', 'basedOn', 'browser', 'browserVersion', 'extensionVersion'];
const FILE_TYPES = ['html', 'json', 'csv', 'txt', 'settings'];
const BROWSER_KEYS = ['basedOn', 'browser', 'browserVersion', 'extensionVersion'];
const UNKNOWN_BROWSER = Object.freeze({ basedOn: 'Unknown', browser: 'Unknown', browserVersion: 'unknown', extensionVersion: 'unknown' });
// Plain characters only, so the value reads the same in JSON, CSV, TXT and HTML.
const SOURCE_TEXT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._+-]{0,62}[A-Za-z0-9._+-])?$/;

function cleanSourceText(value, fallback) {
  const text = String(value == null ? '' : value).replace(/[^A-Za-z0-9 ._+-]/g, '').replace(/ +/g, ' ').trim().slice(0, 64).trim();
  return SOURCE_TEXT_PATTERN.test(text) ? text : fallback;
}

// Anything missing or unusable becomes "Unknown", so a file is always written.
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

// Exactly these keys in exactly this order (JSON.parse keeps the file's order).
// Used for the source and for the Importer's add-on entries.
function hasExactKeys(obj, keys) {
  const have = Object.keys(obj);
  return have.length === keys.length && keys.every((k, i) => have[i] === k);
}

// null if the source is what an exporter writes, otherwise a short reason.
// If fileType is given, the source must be for exactly that file type.
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

// CSV and TXT carry the source as one comment line per field at the top.
function sourceCommentLines(source) {
  return SOURCE_KEYS.map((key) => `# addons-hub-source-${key}: ${source[key]}`);
}
// The reverse: the source, or null unless it is exactly the six lines above.
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

// One format is stored as a plain string, several as an array ('html' or ['html', 'json']).
const EXPORT_FORMAT_STORAGE_KEY = 'exportFormat';
const EXPORT_FORMAT_DEFAULT = 'html';

// The one list of export formats. Adding a format starts here, then it still
// needs a builder (report-template.js / export-formats.js), a case in
// background.js, a reader in the Importer and a tick box in Settings.
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
// In the fixed order they are listed and exported in.
const EXPORT_FORMATS = EXPORT_FORMAT_REGISTRY.map((f) => f.id);

// An unknown id gets the default format.
function getExportFormat(fmt) {
  return EXPORT_FORMAT_REGISTRY.find((f) => f.id === fmt) ||
    EXPORT_FORMAT_REGISTRY.find((f) => f.id === EXPORT_FORMAT_DEFAULT);
}

const SHORT_NAME_STORAGE_KEY = 'shortenNames';
const SHORT_NAME_DEFAULT = 'on';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Links come from add-ons and import files, so only http(s) is trusted.
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

// Every export lists enabled add-ons first, then disabled, each A-Z. This is
// the one place that grouping happens.
// Returns { enabled, disabled, all }.
function groupForReading(list) {
  const enabled = list.filter((a) => a.enabled).sort(byName);
  const disabled = list.filter((a) => !a.enabled).sort(byName);
  return { enabled, disabled, all: [...enabled, ...disabled] };
}

function formatLabel(fmt) {
  return getExportFormat(fmt).label;
}

// Accepts a format string, an array, or 'html,json' (how the confirmation
// page's address carries several). Gives back known formats only, no repeats,
// in the fixed order, and never an empty list.
function resolveExportFormats(val) {
  const raw = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',') : []);
  const picked = EXPORT_FORMATS.filter((f) => raw.includes(f));
  return picked.length ? picked : [EXPORT_FORMAT_DEFAULT];
}

function serializeExportFormats(list) {
  const formats = resolveExportFormats(list);
  return formats.length === 1 ? formats[0] : formats;
}

// "HTML report", "HTML report and JSON file", "HTML report, JSON file and CSV file"
function formatLabelsText(fmts) {
  const labels = resolveExportFormats(fmts).map(formatLabel);
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
}

// Storage can hold anything, so stored values are checked, never trusted.
function isValidExportFormat(val) {
  return EXPORT_FORMATS.includes(val);
}
function isValidShortenNames(val) {
  return val === 'on' || val === 'off';
}
function resolveShortenNames(val) {
  return isValidShortenNames(val) ? val : SHORT_NAME_DEFAULT;
}

// Every stored setting with its key, default and a resolver that turns
// whatever is stored into a safe value. Theme uses the literal 'theme' because
// the background can't load theme.js (a test checks they match).
const SETTINGS_SCHEMA = {
  theme: { key: 'theme', default: 'light', resolve: (v) => (v === 'dark' ? 'dark' : 'light') },
  exportFormats: { key: EXPORT_FORMAT_STORAGE_KEY, default: [EXPORT_FORMAT_DEFAULT], resolve: resolveExportFormats },
  shortenNames: { key: SHORT_NAME_STORAGE_KEY, default: SHORT_NAME_DEFAULT, resolve: resolveShortenNames },
};
const SETTINGS_STORAGE_KEYS = Object.values(SETTINGS_SCHEMA).map((d) => d.key);

// localStorage copies of two settings, so settings-init.js can tick the
// controls before the first paint.
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

// The way to read settings: one storage read, every value checked. Falls back
// to the defaults if the read fails. Returns { theme, exportFormats, shortenNames }.
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

// Calls handler(changedNames, settings) when a setting changes anywhere (another
// tab, an import, a reset). After a reset the settings arrive as defaults.
function onSettingsChanged(handler) {
  if (typeof browser === 'undefined' || !browser.storage || !browser.storage.onChanged) return;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = Object.keys(SETTINGS_SCHEMA).filter((n) => changes[SETTINGS_SCHEMA[n].key]);
    if (!changed.length) return;
    loadSettings().then((settings) => handler(changed, settings));
  });
}

function typeLabel(type) {
  return type === 'theme' ? 'Theme' : 'Extension';
}
// The reverse. Anything that is not exactly "Theme" or "Extension" gives null.
function parseType(label) {
  if (label === 'Theme') return 'theme';
  if (label === 'Extension') return 'extension';
  return null;
}

// "a" or "an" for a label like "HTML report". A plain vowel check gets
// acronyms wrong because "HTML" is said "aitch-tee-em-el", so it needs "an".
function indefiniteArticleFor(label) {
  const firstWord = String(label).trim().split(/\s+/)[0] || '';
  if (/^[A-Z]{2,}$/.test(firstWord)) {
    const VOWEL_SOUND_INITIALS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);
    return VOWEL_SOUND_INITIALS.has(firstWord[0]) ? 'an' : 'a';
  }
  return /^[aeiou]/i.test(firstWord) ? 'an' : 'a';
}

// Cuts a name at the first dash, colon or comma:
// "Buster: Captcha Solver for Humans" -> "Buster"
function shortName(name) {
  const match = String(name).match(/^(.+?)(?:\s+[-–—]|\s*[,:])/);
  return match ? match[1].trim() : String(name);
}

// An exact match gets no label, only the less certain ones do.
const LINK_TYPE_LABELS = {
  'amo-search': 'Possible match',
  'homepage': 'Homepage',
  'amo-search-fallback': 'Search results',
};
const UNCERTAIN_LINK_TYPES = new Set(['amo-search', 'amo-search-fallback']);

// "2026-10-17_14-05-09" in local time, so two exports never overwrite each other.
function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// Gap between opening add-on tabs, so dozens don't all open at once.
const TAB_OPEN_DELAY_MS = 150;

// How long a download's blob URL stays alive. Long enough for a slow Save dialog.
const OBJECT_URL_REVOKE_MS = 30000;

// What a row's link is called: "AMO" for addons.mozilla.org, otherwise the
// real site ("example.com"), so a homepage or an edited link never passes as
// AMO. Anything unreadable is "Link".
function linkLabel(link) {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return 'Link';
    return host === 'addons.mozilla.org' ? 'AMO' : host;
  } catch {
    return 'Link';
  }
}

// The last-resort link: an AMO search for the add-on's name.
function amoSearchUrl(name) {
  return `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(name)}`;
}
