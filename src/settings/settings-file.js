// The settings file: builds the Export settings file and strictly reads one
// back. No page code. Needs core.js (settings schema, format helpers).

const SETTINGS_FILE_FORMAT_VERSION = 1;

// Exactly the keys an export holds and an import requires (an alias of core.js's
// SETTINGS_STORAGE_KEYS, so they can't drift apart).
const KNOWN_SETTINGS_KEYS = SETTINGS_STORAGE_KEYS;

// `settings` is a plain object of the stored values (exportFormat is one
// format, or an array when several are chosen). `source` is the browser part;
// the format version and file type ("settings") are added here, so the file
// has the same source shape as an export.
function buildSettingsExport(settings, source = UNKNOWN_BROWSER) {
  const out = {};
  for (const key of KNOWN_SETTINGS_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return JSON.stringify({ source: makeSource('settings', SETTINGS_FILE_FORMAT_VERSION, source), settings: out }, null, 2);
}

// Accepts only what buildSettingsExport() writes:
//   { "source": { formatVersion, fileType: "settings", basedOn, browser,
//                 browserVersion, extensionVersion },
//     "settings": { theme, exportFormat, shortenNames } }
// exactly those three settings, in that order, each valid. Anything else (a
// missing or unknown setting, a bad value) rejects the whole file and names
// the problem; nothing is dropped or guessed. exportFormat is a string, or an
// array of two or more in the fixed order.
// Returns { ok: true, settings } or { ok: false, error }. Throws on malformed
// JSON, so the caller needs a try/catch.
const settingsError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Hub settings format (${detail}).` });

function parseSettingsFile(text) {
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Hub settings file.' };
  }
  const sourceIssue = sourceProblem(parsed.source, 'settings');
  if (sourceIssue) return settingsError(`source: ${sourceIssue}`);
  if (parsed.source.formatVersion > SETTINGS_FILE_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Hub. Please update the extension and try again.' };
  }
  if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
    return { ok: false, error: 'This file doesn\'t contain valid settings.' };
  }
  if (Object.keys(parsed).join() !== 'source,settings') {
    return settingsError('the file is not exactly source, then settings');
  }

  const given = parsed.settings;
  const keys = Object.keys(given);
  const unknown = keys.find((k) => !KNOWN_SETTINGS_KEYS.includes(k));
  if (unknown !== undefined) return settingsError(`unknown setting "${unknown}"`);
  const missing = KNOWN_SETTINGS_KEYS.find((k) => !keys.includes(k));
  if (missing !== undefined) return settingsError(`the setting "${missing}" is missing`);
  if (keys.join() !== KNOWN_SETTINGS_KEYS.join()) {
    return settingsError('the settings must be in the order ' + KNOWN_SETTINGS_KEYS.join(', '));
  }

  const t = given[SETTINGS_SCHEMA.theme.key];
  if (t !== 'light' && t !== 'dark') return settingsError('theme must be "light" or "dark"');

  const f = given[EXPORT_FORMAT_STORAGE_KEY];
  const formatOk = Array.isArray(f)
    ? f.length > 1 && f.every(isValidExportFormat) && resolveExportFormats(f).join() === f.join()
    : isValidExportFormat(f);
  if (!formatOk) return settingsError('exportFormat must be one format, or two or more in the usual order');

  const s = given[SHORT_NAME_STORAGE_KEY];
  if (s !== 'on' && s !== 'off') return settingsError('shortenNames must be "on" or "off"');

  return { ok: true, settings: { [SETTINGS_SCHEMA.theme.key]: t, [EXPORT_FORMAT_STORAGE_KEY]: f, [SHORT_NAME_STORAGE_KEY]: s } };
}

// A fresh profile has stored none of the settings, so exporting straight from
// storage gave an empty file that couldn't be imported again. This fills in
// the defaults for the export.
function withSettingsDefaults(stored) {
  return {
    [SETTINGS_SCHEMA.theme.key]: SETTINGS_SCHEMA.theme.resolve(stored && stored[SETTINGS_SCHEMA.theme.key]),
    [EXPORT_FORMAT_STORAGE_KEY]: serializeExportFormats(stored && stored[EXPORT_FORMAT_STORAGE_KEY]),
    [SHORT_NAME_STORAGE_KEY]: resolveShortenNames(stored && stored[SHORT_NAME_STORAGE_KEY]),
  };
}
