// Tests for the pure functions in src/settings/settings.js:
// buildSettingsExport() and parseSettingsFile(). Loads the real source
// files via vm so these run against the actual code, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext } = require('./helpers');

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
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDocument,
    browser: {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { getManifest: () => ({ version: '1.2.0' }) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeSrc, sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(settingsSrc, sandbox);
  return sandbox;
}

const sandbox = makeSettingsSandbox();
const { buildSettingsExport, parseSettingsFile, withSettingsDefaults } = sandbox;

// Evaluate consts that live only in the vm's lexical scope.
const SETTINGS_FILE_FORMAT_VERSION = evalInContext(sandbox, 'SETTINGS_FILE_FORMAT_VERSION');
const THEME_STORAGE_KEY = evalInContext(sandbox, 'THEME_STORAGE_KEY');
const EXPORT_FORMAT_STORAGE_KEY = evalInContext(sandbox, 'EXPORT_FORMAT_STORAGE_KEY');
const SHORT_NAME_STORAGE_KEY = evalInContext(sandbox, 'SHORT_NAME_STORAGE_KEY');

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

// --- A7: a pristine (never-touched) profile's export can be re-imported ---

test('withSettingsDefaults: fills in defaults for a pristine (empty) stored object', () => {
  const result = withSettingsDefaults({});
  assert.strictEqual(result[THEME_STORAGE_KEY], 'light');
  assert.strictEqual(result[EXPORT_FORMAT_STORAGE_KEY], 'html');
  assert.strictEqual(result[SHORT_NAME_STORAGE_KEY], 'on');
});

test('withSettingsDefaults: keeps an explicitly stored value instead of the default', () => {
  const result = withSettingsDefaults({ [THEME_STORAGE_KEY]: 'dark', [EXPORT_FORMAT_STORAGE_KEY]: 'json', [SHORT_NAME_STORAGE_KEY]: 'off' });
  assert.strictEqual(result[THEME_STORAGE_KEY], 'dark');
  assert.strictEqual(result[EXPORT_FORMAT_STORAGE_KEY], 'json');
  assert.strictEqual(result[SHORT_NAME_STORAGE_KEY], 'off');
});

test('withSettingsDefaults: an invalid stored value falls back to the default rather than being kept', () => {
  const result = withSettingsDefaults({ [EXPORT_FORMAT_STORAGE_KEY]: 'xml' });
  assert.strictEqual(result[EXPORT_FORMAT_STORAGE_KEY], 'html');
});

test('A7 regression: a pristine export (nothing ever stored) can be re-imported successfully', () => {
  const json = buildSettingsExport(withSettingsDefaults({}));
  const result = parseSettingsFile(json);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(Object.keys(result.settings).length, 3, 'all three defaults should be present, not an empty {}');
});

// --- A33: a storage write failure reverts the radio and shows an error ---
// Uses a dedicated sandbox with real radio elements, since the shared
// `sandbox` above's querySelectorAll always returns [] (it only needs the
// pure functions), so no change handler is ever attached there.

function makeRadioEl(value) {
  return { value, checked: false, _onChange: null, addEventListener(ev, fn) { if (ev === 'change') this._onChange = fn; } };
}

function makeSettingsSandboxWithRadios(storageSet) {
  const themeRadioEls = [makeRadioEl('light'), makeRadioEl('dark')];
  const formatRadioEls = [makeRadioEl('html'), makeRadioEl('json'), makeRadioEl('csv')];
  const shortenRadioEls = [makeRadioEl('on'), makeRadioEl('off')];
  const statusEl = { textContent: '', className: '' };
  const fakeDocument = {
    querySelectorAll: (sel) => {
      if (sel.includes('"theme"')) return themeRadioEls;
      if (sel.includes('"exportFormat"')) return formatRadioEls;
      if (sel.includes('"shortenNames"')) return shortenRadioEls;
      return [];
    },
    getElementById: (id) => (id === 'settingsStatus' ? statusEl : makeFakeElement()),
    body: { appendChild() {} },
    createElement: () => makeFakeElement(),
    documentElement: { setAttribute() {} },
  };
  const setCalls = [];
  const sb = {
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: () => 0,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDocument,
    browser: {
      storage: {
        local: {
          get: async () => ({}),
          set: storageSet || (async (o) => { setCalls.push(o); }),
          remove: async () => {},
        },
      },
      runtime: { getManifest: () => ({ version: '1.2.0' }) },
    },
  };
  vm.createContext(sb);
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  return { themeRadioEls, formatRadioEls, shortenRadioEls, statusEl, setCalls };
}

testAsync('theme radio: a storage write failure shows an error and reverts the radio, instead of an unhandled rejection', async () => {
  const { themeRadioEls, statusEl } = makeSettingsSandboxWithRadios(async () => { throw new Error('quota exceeded'); });
  const darkRadio = themeRadioEls[1];
  darkRadio.checked = true;
  await darkRadio._onChange();

  assert.match(statusEl.textContent, /Could not save theme/);
  assert.strictEqual(statusEl.className, 'error');
  // storage.local.get() in this sandbox always returns {} (the write
  // never actually landed), so loadCurrentTheme() should revert back to
  // the default: light checked, dark unchecked.
  assert.strictEqual(themeRadioEls[0].checked, true, 'light should be re-checked as the actually-stored value');
  assert.strictEqual(themeRadioEls[1].checked, false, 'dark should be reverted since the write failed');
});

testAsync('theme radio: a successful write applies the theme and reports no error', async () => {
  const { themeRadioEls, statusEl, setCalls } = makeSettingsSandboxWithRadios();
  const darkRadio = themeRadioEls[1];
  darkRadio.checked = true;
  await darkRadio._onChange();

  assert.strictEqual(statusEl.className, '', 'should not be in an error state');
  assert.strictEqual(setCalls.length, 1);
  assert.strictEqual(setCalls[0][THEME_STORAGE_KEY], 'dark');
});

testAsync('exportFormat radio: a storage write failure shows an error and reverts the radio', async () => {
  const { formatRadioEls, statusEl } = makeSettingsSandboxWithRadios(async () => { throw new Error('disk full'); });
  const jsonRadio = formatRadioEls[1];
  jsonRadio.checked = true;
  await jsonRadio._onChange();

  assert.match(statusEl.textContent, /Could not save export format/);
  assert.strictEqual(formatRadioEls[0].checked, true, 'html (the default) should be re-checked');
  assert.strictEqual(formatRadioEls[1].checked, false, 'json should be reverted since the write failed');
});

testAsync('shortenNames radio: a storage write failure shows an error and reverts the radio', async () => {
  const { shortenRadioEls, statusEl } = makeSettingsSandboxWithRadios(async () => { throw new Error('disk full'); });
  const offRadio = shortenRadioEls[1];
  offRadio.checked = true;
  await offRadio._onChange();

  assert.match(statusEl.textContent, /Could not save the display setting/);
  assert.strictEqual(shortenRadioEls[0].checked, true, 'on (the default) should be re-checked');
  assert.strictEqual(shortenRadioEls[1].checked, false, 'off should be reverted since the write failed');
});

// --- A10: compareVersions ---

const { compareVersions } = sandbox;

test('compareVersions: equal versions', () => {
  assert.strictEqual(compareVersions('1.2.0', '1.2.0'), 0);
});

test('compareVersions: a missing trailing segment counts as 0', () => {
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
});

test('compareVersions: simple newer/older', () => {
  assert.strictEqual(compareVersions('1.3.0', '1.2.0'), 1);
  assert.strictEqual(compareVersions('1.2.0', '1.3.0'), -1);
});

test('compareVersions: numeric, not lexicographic - "1.10" is newer than "1.9"', () => {
  assert.strictEqual(compareVersions('1.10', '1.9'), 1);
  assert.strictEqual(compareVersions('1.9', '1.10'), -1);
});

// --- A8/A9/A10: the checkUpdateBtn click handler ---

function makeUpdateCheckSandbox(fetchImpl, currentVersion) {
  const btn = { disabled: false, textContent: '', addEventListener(ev, fn) { if (ev === 'click') this._onClick = fn; } };
  const statusRow = { style: {} };
  const statusMsg = { textContent: '', style: {}, _children: [], appendChild(node) { this._children.push(node); } };
  const elements = {
    checkUpdateBtn: btn,
    updateStatusRow: statusRow,
    updateStatusMsg: statusMsg,
  };
  const fakeDocument = {
    querySelectorAll: () => [],
    getElementById: (id) => elements[id] || makeFakeElement(),
    body: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: '', href: '', target: '', rel: '' }),
    documentElement: { setAttribute() {} },
  };
  const sb = {
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    Blob: function Blob() {},
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    document: fakeDocument,
    browser: {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { getManifest: () => ({ version: currentVersion }) },
    },
  };
  vm.createContext(sb);
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  return { btn, statusRow, statusMsg };
}

testAsync('checkUpdateBtn: shows "up to date" when the local version matches AMO', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(
    async () => ({ ok: true, status: 200, json: async () => ({ current_version: { version: '1.2.0' } }) }),
    '1.2.0'
  );
  await btn._onClick();
  assert.match(statusMsg.textContent, /up to date/);
  assert.strictEqual(btn.disabled, false);
  assert.strictEqual(btn.textContent, 'Check now');
});

testAsync('checkUpdateBtn: a local version newer than AMO also counts as up to date', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(
    async () => ({ ok: true, status: 200, json: async () => ({ current_version: { version: '1.1.0' } }) }),
    '1.2.0'
  );
  await btn._onClick();
  assert.match(statusMsg.textContent, /up to date/, 'a dev build ahead of the published version should not say an update is available');
});

testAsync('checkUpdateBtn: "1.10" is correctly treated as newer than "1.9" (not a string comparison)', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(
    async () => ({ ok: true, status: 200, json: async () => ({ current_version: { version: '1.10' } }) }),
    '1.9'
  );
  await btn._onClick();
  assert.doesNotMatch(statusMsg.textContent, /up to date/);
  assert.match(statusMsg.textContent, /Version 1\.10 is available/);
});

testAsync('checkUpdateBtn: an AMO-supplied version string is never treated as HTML', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(
    async () => ({ ok: true, status: 200, json: async () => ({ current_version: { version: '9.9 <img src=x onerror=alert(1)>' } }) }),
    '1.0'
  );
  await btn._onClick();
  assert.strictEqual(statusMsg._children.length, 1, 'only the real update link should be a child element - nothing from the AMO string');
  assert.ok(statusMsg._children[0].href.includes('addons.mozilla.org'), 'the one real child should be the actual update link');
  assert.ok(statusMsg.textContent.includes('9.9 <img src=x onerror=alert(1)>'), 'the raw AMO string should appear as plain text, not be parsed');
});

testAsync('checkUpdateBtn: a network failure shows an error and re-enables the button', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(async () => { throw new Error('network unreachable'); }, '1.0');
  await btn._onClick();
  assert.match(statusMsg.textContent, /Could not check for updates/);
  assert.strictEqual(btn.disabled, false, 'the button must not stay stuck disabled');
  assert.strictEqual(btn.textContent, 'Check now');
});

testAsync('checkUpdateBtn: a 404 (our own add-on ID not found on AMO) is treated as a failure, not a silent no-op', async () => {
  const { btn, statusMsg } = makeUpdateCheckSandbox(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    '1.0'
  );
  await btn._onClick();
  assert.match(statusMsg.textContent, /Could not check for updates/);
  assert.strictEqual(btn.disabled, false);
});
