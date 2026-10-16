// The settings file: the pure code that builds the Export settings file and
// strictly reads one back (Import settings). Nothing here touches the page, so
// it can be tested without a DOM. Needs core.js (the settings schema and format
// helpers) loaded first.

const SETTINGS_FILE_FORMAT_VERSION = 1;

// The settings keys this page knows about: exactly the ones an export holds
// and an import requires.
const KNOWN_SETTINGS_KEYS = [
  SETTINGS_SCHEMA.theme.key,
  EXPORT_FORMAT_STORAGE_KEY,
  SHORT_NAME_STORAGE_KEY,
];

// Builds the settings export object from the current stored values.
// settings is a plain object: { theme: '...', exportFormat: '...' } (exportFormat is one format, or an array when several are chosen).
// source is the browser part of the source (which browser and extension
// version made it); the file's own format version and file type ("settings")
// are added here, so the settings file carries the same source shape as an export.
function buildSettingsExport(settings, source = UNKNOWN_BROWSER) {
  const out = {};
  for (const key of KNOWN_SETTINGS_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return JSON.stringify({ source: makeSource('settings', SETTINGS_FILE_FORMAT_VERSION, source), settings: out }, null, 2);
}

// Validates and parses a settings file's text. Accepts only what
// buildSettingsExport() writes (given withSettingsDefaults()'s values):
//   { "source": { formatVersion, fileType: "settings", browser, basedOn,
//                 browserVersion, extensionVersion },
//     "settings": { theme, exportFormat, shortenNames } }
// with exactly those three settings, in that order, each a valid value. Anything else - a
// missing or unknown setting, an invalid value - rejects the whole file,
// naming the problem; nothing is dropped or guessed at. exportFormat is one
// format as a string, or two or more as an array in the fixed order.
// Returns { ok: true, settings: {...} } or { ok: false, error: '...' }.
// Throws on malformed JSON - the caller's try/catch handles it.
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

// Fills in the default value for any of the three known settings that
// aren't in `stored` yet - a pristine profile has never written any of
// them, so exporting straight from storage.local.get() produced an empty
// {} settings object that couldn't be re-imported (nothing in it passed
// parseSettingsFile's "no recognised settings" check). Only used by the
// Export handler below - buildSettingsExport() itself is unchanged, and
// still only writes whatever it's actually given.
function withSettingsDefaults(stored) {
  const fmt = stored && stored[EXPORT_FORMAT_STORAGE_KEY];
  const shorten = stored && stored[SHORT_NAME_STORAGE_KEY];
  return {
    [SETTINGS_SCHEMA.theme.key]: SETTINGS_SCHEMA.theme.resolve(stored && stored[SETTINGS_SCHEMA.theme.key]),
    [EXPORT_FORMAT_STORAGE_KEY]: serializeExportFormats(fmt),
    [SHORT_NAME_STORAGE_KEY]: (shorten === 'on' || shorten === 'off') ? shorten : SHORT_NAME_DEFAULT,
  };
}
