// Tests for the pure functions in src/settings/settings.js:
// buildSettingsExport() and parseSettingsFile(). Loads the real source
// files via vm so these run against the actual code, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, readSrc, evalInContext } = require('./helpers');

const themeSrc = readSrc('src/common/theme.js');
const commonSrc = readSrc('src/common/common.js');
const settingsSrc = readSrc('src/settings/settings.js');

// settings.js wires up DOM elements and event listeners at load time.
// Provide a minimal stub document so it can load without throwing.
function makeFakeElement() {
  return {
    style: {},
    checked: false,
    value: '',
    textContent: '',
    className: '',
    innerHTML: '',
    addEventListener() {},
    querySelectorAll() { return []; },
    click() {},
  };
}

function makeSettingsSandbox() {
  const fakeDocument = {
    querySelectorAll: () => [],
    getElementById: () => makeFakeElement(),
    body: { appendChild() {}, },
    createElement: () => makeFakeElement(),
    documentElement: { setAttribute() {} },
  };
  const sandbox = {
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: () => 0,
    document: fakeDocument,
    browser: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeSrc, sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(settingsSrc, sandbox);
  return sandbox;
}

const sandbox = makeSettingsSandbox();
const { buildSettingsExport, parseSettingsFile } = sandbox;

// Evaluate consts that live only in the vm's lexical scope.
const SETTINGS_FILE_FORMAT_VERSION = evalInContext(sandbox, 'SETTINGS_FILE_FORMAT_VERSION');
const THEME_STORAGE_KEY = evalInContext(sandbox, 'THEME_STORAGE_KEY');
const EXPORT_FORMAT_STORAGE_KEY = evalInContext(sandbox, 'EXPORT_FORMAT_STORAGE_KEY');

// --- buildSettingsExport ---

test('buildSettingsExport: produces valid JSON with formatVersion and settings', () => {
  const json = buildSettingsExport({ [THEME_STORAGE_KEY]: 'dark', [EXPORT_FORMAT_STORAGE_KEY]: 'json' });
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.formatVersion, SETTINGS_FILE_FORMAT_VERSION);
  assert.strictEqual(parsed.settings[THEME_STORAGE_KEY], 'dark');
  assert.strictEqual(parsed.settings[EXPORT_FORMAT_STORAGE_KEY], 'json');
});

test('buildSettingsExport: omits keys that are not in KNOWN_SETTINGS_KEYS', () => {
  const json = buildSettingsExport({ [THEME_STORAGE_KEY]: 'light', unknownKey: 'should-not-appear' });
  const parsed = JSON.parse(json);
  assert.ok(!('unknownKey' in parsed.settings), 'unknown key should not appear in the export');
});

test('buildSettingsExport: works with an empty settings object', () => {
  const json = buildSettingsExport({});
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.formatVersion, SETTINGS_FILE_FORMAT_VERSION);
  assert.deepStrictEqual(parsed.settings, {});
});

test('buildSettingsExport: output is valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(buildSettingsExport({ [THEME_STORAGE_KEY]: 'light' })));
});

// --- parseSettingsFile ---

function makeSettingsFile(settings, formatVersion = SETTINGS_FILE_FORMAT_VERSION) {
  return JSON.stringify({ formatVersion, settings });
}

test('parseSettingsFile: valid file succeeds and returns recognised settings', () => {
  const result = parseSettingsFile(makeSettingsFile({ [THEME_STORAGE_KEY]: 'dark', [EXPORT_FORMAT_STORAGE_KEY]: 'csv' }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.settings[THEME_STORAGE_KEY], 'dark');
  assert.strictEqual(result.settings[EXPORT_FORMAT_STORAGE_KEY], 'csv');
});

test('parseSettingsFile: throws on malformed JSON', () => {
  assert.throws(() => parseSettingsFile('{not valid json'));
});

test('parseSettingsFile: missing formatVersion is rejected', () => {
  const result = parseSettingsFile(JSON.stringify({ settings: { [THEME_STORAGE_KEY]: 'dark' } }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its format version/);
});

test('parseSettingsFile: non-numeric formatVersion is rejected', () => {
  const result = parseSettingsFile(JSON.stringify({ formatVersion: '1', settings: { [THEME_STORAGE_KEY]: 'dark' } }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its format version/);
});

test('parseSettingsFile: formatVersion newer than supported is rejected', () => {
  const result = parseSettingsFile(makeSettingsFile({ [THEME_STORAGE_KEY]: 'dark' }, SETTINGS_FILE_FORMAT_VERSION + 1));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /newer version of Add-ons Hub/);
});

test('parseSettingsFile: missing settings object is rejected', () => {
  const result = parseSettingsFile(JSON.stringify({ formatVersion: SETTINGS_FILE_FORMAT_VERSION }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /valid settings/);
});

test('parseSettingsFile: settings as an array is rejected', () => {
  const result = parseSettingsFile(JSON.stringify({ formatVersion: SETTINGS_FILE_FORMAT_VERSION, settings: [] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /valid settings/);
});

test('parseSettingsFile: unknown settings keys are silently dropped', () => {
  const result = parseSettingsFile(makeSettingsFile({ [THEME_STORAGE_KEY]: 'light', futureKey: 'someValue' }));
  assert.strictEqual(result.ok, true);
  assert.ok(!('futureKey' in result.settings), 'unknown key should be dropped');
  assert.strictEqual(result.settings[THEME_STORAGE_KEY], 'light');
});

test('parseSettingsFile: invalid theme value is dropped', () => {
  const result = parseSettingsFile(makeSettingsFile({ [THEME_STORAGE_KEY]: 'purple' }));
  assert.strictEqual(result.ok, true);
  assert.ok(!(THEME_STORAGE_KEY in result.settings), 'invalid theme should be dropped');
});

test('parseSettingsFile: invalid exportFormat value is dropped', () => {
  const result = parseSettingsFile(makeSettingsFile({ [EXPORT_FORMAT_STORAGE_KEY]: 'xml' }));
  assert.strictEqual(result.ok, true);
  assert.ok(!(EXPORT_FORMAT_STORAGE_KEY in result.settings), 'invalid exportFormat should be dropped');
});

test('parseSettingsFile: file with only unknown/invalid keys succeeds but returns empty settings', () => {
  const result = parseSettingsFile(makeSettingsFile({ futureKey: 'x', [THEME_STORAGE_KEY]: 'nonsense' }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(Object.keys(result.settings).length, 0, 'settings object should be empty');
});

test('parseSettingsFile: all valid values are accepted', () => {
  for (const theme of ['light', 'dark']) {
    const r = parseSettingsFile(makeSettingsFile({ [THEME_STORAGE_KEY]: theme }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.settings[THEME_STORAGE_KEY], theme);
  }
  for (const fmt of ['html', 'json', 'csv']) {
    const r = parseSettingsFile(makeSettingsFile({ [EXPORT_FORMAT_STORAGE_KEY]: fmt }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.settings[EXPORT_FORMAT_STORAGE_KEY], fmt);
  }
});

test('parseSettingsFile: round-trip through buildSettingsExport preserves values', () => {
  const original = { [THEME_STORAGE_KEY]: 'dark', [EXPORT_FORMAT_STORAGE_KEY]: 'csv' };
  const json = buildSettingsExport(original);
  const result = parseSettingsFile(json);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.settings[THEME_STORAGE_KEY], 'dark');
  assert.strictEqual(result.settings[EXPORT_FORMAT_STORAGE_KEY], 'csv');
});
