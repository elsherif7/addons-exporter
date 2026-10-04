// Tests for the pure functions in src/settings/settings.js:
// buildSettingsExport() and parseSettingsFile(). Loads the real source
// files via vm so these run against the actual code, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext, makeFakeDom } = require('./helpers');

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
      runtime: { getManifest: () => ({ version: '1.2.0' }), id: 'addons-exporter@local' },
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
      runtime: { getManifest: () => ({ version: '1.2.0' }), id: 'addons-exporter@local' },
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


// --- A20: the Reset dialog's accessibility ---
// Uses makeFakeDom (S1) rather than the ad hoc fixtures above - the
// dialog is now built with createElement/append (not innerHTML), so it
// needs a document that can actually hold and query real child elements.

function makeResetDialogSandbox() {
  const { document, elements } = makeFakeDom(['resetSettingsBtn', 'settingsStatus']);
  // A stand-in for the rest of the page's content, to verify it gets
  // inert-ed while the dialog is open and restored after.
  const pageContent = document.createElement('div');
  pageContent.id = 'pageContent';
  document.body.appendChild(pageContent);
  document.body.appendChild(elements.resetSettingsBtn);

  const sb = {
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: () => 0,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document,
    browser: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
      runtime: { getManifest: () => ({ version: '1.2.0' }), id: 'addons-exporter@local' },
    },
  };
  vm.createContext(sb);
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  return { document, elements, pageContent };
}

function openResetDialog(document, resetBtn) {
  resetBtn.click();
  return document.body.querySelector('[role="dialog"]');
}

test('Reset dialog: has role=dialog, aria-modal, and is labelled by its own title', () => {
  const { document, elements } = makeResetDialogSandbox();
  const dialog = openResetDialog(document, elements.resetSettingsBtn);
  assert.ok(dialog, 'a dialog should have been added to the page');
  assert.strictEqual(dialog.getAttribute('aria-modal'), 'true');
  const labelledBy = dialog.getAttribute('aria-labelledby');
  const titleEl = document.body.querySelector(`#${labelledBy}`);
  assert.ok(titleEl, 'aria-labelledby should point at a real element');
  assert.strictEqual(titleEl.textContent, 'Settings');
});

test('Reset dialog: focus moves to Cancel when it opens, and everything else is made inert', () => {
  const { document, elements, pageContent } = makeResetDialogSandbox();
  assert.strictEqual(pageContent.inert, undefined, 'not inert before the dialog opens');
  openResetDialog(document, elements.resetSettingsBtn);
  const cancelBtn = document.body.querySelector('#rsCancel');
  assert.strictEqual(cancelBtn._focused, true, 'focus should move into the dialog (to Cancel) on open');
  assert.strictEqual(pageContent.inert, true, 'the rest of the page should be inert while the dialog is open');
});

test('Reset dialog: Cancel closes it, restores focus to the Reset button, and un-inerts the page', () => {
  const { document, elements, pageContent } = makeResetDialogSandbox();
  openResetDialog(document, elements.resetSettingsBtn);
  document.body.querySelector('#rsCancel').click();

  assert.strictEqual(document.body.querySelector('[role="dialog"]'), null, 'the dialog should be removed');
  assert.strictEqual(elements.resetSettingsBtn._focused, true, 'focus should return to the button that opened it');
  assert.strictEqual(pageContent.inert, false, 'the page should no longer be inert once the dialog closes');
});

test('Reset dialog: Escape closes it the same way Cancel does', () => {
  const { document, elements } = makeResetDialogSandbox();
  openResetDialog(document, elements.resetSettingsBtn);
  document.body.querySelector('[role="dialog"]').dispatchEvent({ type: 'keydown', key: 'Escape' });

  assert.strictEqual(document.body.querySelector('[role="dialog"]'), null, 'Escape should close the dialog');
  assert.strictEqual(elements.resetSettingsBtn._focused, true);
});

testAsync('Reset dialog: clicking Reset (confirm) also closes the dialog and restores focus', async () => {
  const { document, elements } = makeResetDialogSandbox();
  openResetDialog(document, elements.resetSettingsBtn);
  document.body.querySelector('#rsConfirm').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(document.body.querySelector('[role="dialog"]'), null, 'the dialog should close on confirm too');
  assert.strictEqual(elements.resetSettingsBtn._focused, true);
});

test('Reset dialog: mentions the display setting, which it actually resets', () => {
  const { document, elements } = makeResetDialogSandbox();
  const dialog = openResetDialog(document, elements.resetSettingsBtn);
  const message = dialog.querySelector('p');
  assert.match(message.textContent, /display/i, 'the dialog text should mention the display setting it also resets');
});

// --- 2.1: exportSettingsBtn — Android vs desktop path ---
// The export handler now detects the platform and uses a plain <a download>
// click on Android (where downloads.download({saveAs}) silently fails with
// a blob: URL) instead of the saveAs dialog used on desktop.

function makeExportSettingsSandbox({ platformOs, simulateDownloadCreated = false }) {
  const exportBtnEl = { addEventListener(ev, fn) { if (ev === 'click') this._onClick = fn; } };
  const statusEl = { textContent: '', className: '' };
  const exportStatusEl = { textContent: '', style: { display: 'none', color: '' } };
  const appendedLinks = [];
  const downloadCalls = [];
  const bodyStub = {
    appendChild: (el) => appendedLinks.push(el),
    children: [],
  };
  const fakeDocument = {
    querySelectorAll: () => [],
    getElementById: (id) => {
      if (id === 'exportSettingsBtn') return exportBtnEl;
      if (id === 'settingsStatus') return statusEl;
      if (id === 'exportSettingsStatus') return exportStatusEl;
      return makeFakeElement();
    },
    body: bodyStub,
    createElement: () => ({
      style: {},
      href: '',
      download: '',
      click() { this.clicked = true; },
      remove() { this.removed = true; },
    }),
    documentElement: { setAttribute() {} },
  };
  const sb = {
    URL: { createObjectURL: () => 'blob:fake-url', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDocument,
    browser: {
      runtime: {
        getManifest: () => ({ version: '1.2.0' }),
        id: 'addons-exporter@local',
        getPlatformInfo: async () => ({ os: platformOs }),
      },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      downloads: {
        download: async (opts) => { downloadCalls.push(opts); return 1; },
        onCreated: {
          addListener: (fn) => { if (simulateDownloadCreated) fn({}); },
          removeListener() {},
        },
      },
    },
  };
  vm.createContext(sb);
  sb.makeFakeElement = makeFakeElement;
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  return { exportBtnEl, statusEl, exportStatusEl, appendedLinks, downloadCalls };
}

testAsync('exportSettingsBtn: on desktop, uses downloads.download with saveAs and shows success', async () => {
  const { exportBtnEl, statusEl, exportStatusEl, appendedLinks, downloadCalls } = makeExportSettingsSandbox({ platformOs: 'win' });
  await exportBtnEl._onClick();
  assert.strictEqual(downloadCalls.length, 1, 'should call downloads.download once on desktop');
  assert.strictEqual(downloadCalls[0].saveAs, true);
  assert.match(downloadCalls[0].filename, /^Add-ons Hub Settings \(.+\)\.json$/);
  assert.strictEqual(appendedLinks.length, 0, 'should not create an <a> link on desktop');
  assert.strictEqual(exportStatusEl.textContent, 'Settings exported.');
  assert.strictEqual(statusEl.className, '');
});

testAsync('exportSettingsBtn: on Android, uses <a download> click instead of downloads.download saveAs', async () => {
  const { exportBtnEl, statusEl, exportStatusEl, appendedLinks, downloadCalls } = makeExportSettingsSandbox({
    platformOs: 'android',
    simulateDownloadCreated: true,
  });
  await exportBtnEl._onClick();
  assert.strictEqual(downloadCalls.length, 0, 'should not call downloads.download on Android');
  assert.strictEqual(appendedLinks.length, 1, 'should create an <a> link on Android');
  assert.strictEqual(appendedLinks[0].href, 'blob:fake-url');
  assert.match(appendedLinks[0].download, /^Add-ons Hub Settings \(.+\)\.json$/);
  assert.strictEqual(appendedLinks[0].clicked, true);
  assert.strictEqual(appendedLinks[0].removed, true);
  assert.strictEqual(exportStatusEl.textContent, 'Settings exported.');
});

testAsync('exportSettingsBtn: on Android, still succeeds via the fallback timer if onCreated never fires', async () => {
  const { exportBtnEl, statusEl, exportStatusEl } = makeExportSettingsSandbox({
    platformOs: 'android',
    simulateDownloadCreated: false, // fallback setTimeout fires immediately in this sandbox
  });
  await exportBtnEl._onClick();
  assert.strictEqual(exportStatusEl.textContent, 'Settings exported.');
});

testAsync('exportSettingsBtn: a getPlatformInfo failure falls back to the desktop path gracefully', async () => {
  // If getPlatformInfo rejects (shouldn't happen in practice, but guards
  // against a future API change), the catch gives os: 'unknown', which
  // takes the desktop (saveAs) path rather than throwing altogether.
  const { exportBtnEl, statusEl, exportStatusEl, downloadCalls } = makeExportSettingsSandbox({ platformOs: 'win' });
  // Swap getPlatformInfo to a throwing version via the already-created sandbox's browser object.
  // Re-create the sandbox with a throwing getPlatformInfo instead.
  const exportBtnEl2 = { addEventListener(ev, fn) { if (ev === 'click') this._onClick = fn; } };
  const statusEl2 = { textContent: '', className: '' };
  const exportStatusEl2 = { textContent: '', style: { display: 'none', color: '' } };
  const downloadCalls2 = [];
  const fakeDocument2 = {
    querySelectorAll: () => [],
    getElementById: (id) => {
      if (id === 'exportSettingsBtn') return exportBtnEl2;
      if (id === 'settingsStatus') return statusEl2;
      if (id === 'exportSettingsStatus') return exportStatusEl2;
      return makeFakeElement();
    },
    body: { appendChild() {}, children: [] },
    createElement: () => ({ style: {}, href: '', download: '', click() {}, remove() {} }),
    documentElement: { setAttribute() {} },
  };
  const sb2 = {
    URL: { createObjectURL: () => 'blob:fake-url', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDocument2,
    browser: {
      runtime: {
        getManifest: () => ({ version: '1.2.0' }),
        id: 'addons-exporter@local',
        getPlatformInfo: async () => { throw new Error('API unavailable'); },
      },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      downloads: {
        download: async (opts) => { downloadCalls2.push(opts); return 1; },
        onCreated: { addListener() {}, removeListener() {} },
      },
    },
  };
  vm.createContext(sb2);
  vm.runInContext(themeSrc, sb2);
  vm.runInContext(commonSrc, sb2);
  vm.runInContext(settingsSrc, sb2);
  await exportBtnEl2._onClick();
  assert.strictEqual(downloadCalls2.length, 1, 'should fall back to the desktop (saveAs) path when getPlatformInfo throws');
  assert.strictEqual(exportStatusEl2.textContent, 'Settings exported.');
});

// --- settings-init.js: localStorage startup cache ---
// Loads the real settings-init.js via vm with a fake document and
// localStorage, and verifies it pre-applies cached radio states before
// the first paint (simulated by checking .checked immediately after the
// script runs, with no async gap).

const settingsInitSrc = readSrc('src/settings/settings-init.js');

function makeSettingsInitDom(cachedFormat, cachedShorten) {
  // Minimal fake elements — only the six radio inputs settings-init.js
  // touches, plus getElementById to resolve them.
  function makeRadio(id, value, defaultChecked) {
    return { id, value, checked: defaultChecked };
  }
  const radios = {
    formatHtml:      makeRadio('formatHtml',      'html', false),
    formatJson:      makeRadio('formatJson',      'json', false),
    formatCsv:       makeRadio('formatCsv',       'csv',  false),
    shortenNamesOn:  makeRadio('shortenNamesOn',  'on',   false),
    shortenNamesOff: makeRadio('shortenNamesOff', 'off',  false),
  };
  const document = {
    getElementById: (id) => radios[id] || null,
  };
  const cache = {};
  if (cachedFormat !== undefined) cache['addons-hub-settings-exportFormat'] = cachedFormat;
  if (cachedShorten !== undefined) cache['addons-hub-settings-shortenNames'] = cachedShorten;
  const localStorage = {
    getItem: (key) => Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null,
  };
  const sb = { document, localStorage };
  vm.createContext(sb);
  vm.runInContext(settingsInitSrc, sb);
  return radios;
}

test('settings-init: cache hit "json" checks the JSON radio and unchecks HTML', () => {
  const radios = makeSettingsInitDom('json', undefined);
  assert.strictEqual(radios.formatJson.checked, true,  'json should be checked');
  assert.strictEqual(radios.formatHtml.checked, false, 'html should be unchecked');
  assert.strictEqual(radios.formatCsv.checked,  false, 'csv should be unchecked');
});

test('settings-init: cache hit "csv" checks the CSV radio', () => {
  const radios = makeSettingsInitDom('csv', undefined);
  assert.strictEqual(radios.formatCsv.checked,  true);
  assert.strictEqual(radios.formatHtml.checked, false);
  assert.strictEqual(radios.formatJson.checked, false);
});

test('settings-init: cache hit "html" keeps HTML checked (matches default)', () => {
  const radios = makeSettingsInitDom('html', undefined);
  assert.strictEqual(radios.formatHtml.checked, true);
  assert.strictEqual(radios.formatJson.checked, false);
  assert.strictEqual(radios.formatCsv.checked,  false);
});

test('settings-init: cache miss applies defaults (html / on)', () => {
  // No cache key set — should apply the hardcoded defaults.
  const radios = makeSettingsInitDom(undefined, undefined);
  assert.strictEqual(radios.formatHtml.checked, true,  'html default should be applied');
  assert.strictEqual(radios.formatJson.checked, false);
  assert.strictEqual(radios.formatCsv.checked,  false);
  assert.strictEqual(radios.shortenNamesOn.checked,  true,  'on default should be applied');
  assert.strictEqual(radios.shortenNamesOff.checked, false);
});

test('settings-init: invalid cache value falls back to defaults', () => {
  const radios = makeSettingsInitDom('xml', 'maybe');
  assert.strictEqual(radios.formatHtml.checked, true,  'invalid format falls back to html default');
  assert.strictEqual(radios.shortenNamesOn.checked, true, 'invalid shorten falls back to on default');
});

test('settings-init: cache hit "off" checks Show Full and unchecks Shorten', () => {
  const radios = makeSettingsInitDom(undefined, 'off');
  assert.strictEqual(radios.shortenNamesOff.checked, true,  'off should be checked');
  assert.strictEqual(radios.shortenNamesOn.checked,  false, 'on should be unchecked');
});

test('settings-init: cache hit "on" keeps Shorten checked (matches default)', () => {
  const radios = makeSettingsInitDom(undefined, 'on');
  assert.strictEqual(radios.shortenNamesOn.checked,  true);
  assert.strictEqual(radios.shortenNamesOff.checked, false);
});

test('settings-init: localStorage throwing still applies defaults', () => {
  const radios = {
    formatHtml:      { checked: false },
    formatJson:      { checked: false },
    formatCsv:       { checked: false },
    shortenNamesOn:  { checked: false },
    shortenNamesOff: { checked: false },
  };
  const sb = {
    document: { getElementById: (id) => radios[id] || null },
    localStorage: { getItem() { throw new Error('storage unavailable'); } },
  };
  vm.createContext(sb);
  assert.doesNotThrow(() => vm.runInContext(settingsInitSrc, sb));
  assert.strictEqual(radios.formatHtml.checked,    true,  'html default applied after localStorage error');
  assert.strictEqual(radios.shortenNamesOn.checked, true,  'on default applied after localStorage error');
});

test('settings-init: null getElementById (element not found) does not throw', () => {
  // Simulates an element being absent from the DOM — should degrade gracefully.
  const sb = {
    document: { getElementById: () => null },
    localStorage: { getItem: () => 'json' },
  };
  vm.createContext(sb);
  assert.doesNotThrow(() => vm.runInContext(settingsInitSrc, sb));
});

// Verify that settings.js writes the localStorage cache keys from the
// batched init IIFE so the cache is ready for the next page open.

testAsync('settings.js batched init writes exportFormat to the localStorage cache', async () => {
  const cacheStore = {};
  const allRadios = [
    { value: 'light', checked: false, addEventListener() {} },
    { value: 'dark',  checked: false, addEventListener() {} },
    { value: 'html',  checked: false, addEventListener() {} },
    { value: 'json',  checked: false, addEventListener() {} },
    { value: 'csv',   checked: false, addEventListener() {} },
    { value: 'on',    checked: false, addEventListener() {} },
    { value: 'off',   checked: false, addEventListener() {} },
  ];
  const fakeDoc = {
    querySelectorAll: (sel) => {
      if (sel.includes('"theme"'))        return allRadios.slice(0, 2);
      if (sel.includes('"exportFormat"')) return allRadios.slice(2, 5);
      if (sel.includes('"shortenNames"')) return allRadios.slice(5, 7);
      return [];
    },
    getElementById: () => ({ textContent: '', className: '', addEventListener() {} }),
    body: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: '', href: '' }),
    documentElement: { setAttribute() {} },
  };
  const sb = {
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: () => 0,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDoc,
    localStorage: { getItem: () => null, setItem: (k, v) => { cacheStore[k] = v; } },
    browser: {
      storage: {
        local: {
          // getStoredSettings reads all three keys at once as an array.
          get: async () => ({ theme: 'light', exportFormat: 'csv', shortenNames: 'on' }),
          set: async () => {}, remove: async () => {},
        },
      },
      runtime: { getManifest: () => ({ version: '1.2.0' }), id: 'addons-exporter@local' },
    },
  };
  vm.createContext(sb);
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(cacheStore['addons-hub-settings-exportFormat'], 'csv',
    'the batched init should write the confirmed exportFormat to localStorage');
});

testAsync('settings.js batched init writes shortenNames to the localStorage cache', async () => {
  const cacheStore = {};
  const allRadios = [
    { value: 'light', checked: false, addEventListener() {} },
    { value: 'dark',  checked: false, addEventListener() {} },
    { value: 'html',  checked: false, addEventListener() {} },
    { value: 'json',  checked: false, addEventListener() {} },
    { value: 'csv',   checked: false, addEventListener() {} },
    { value: 'on',    checked: false, addEventListener() {} },
    { value: 'off',   checked: false, addEventListener() {} },
  ];
  const fakeDoc = {
    querySelectorAll: (sel) => {
      if (sel.includes('"theme"'))        return allRadios.slice(0, 2);
      if (sel.includes('"exportFormat"')) return allRadios.slice(2, 5);
      if (sel.includes('"shortenNames"')) return allRadios.slice(5, 7);
      return [];
    },
    getElementById: () => ({ textContent: '', className: '', addEventListener() {} }),
    body: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: '', href: '' }),
    documentElement: { setAttribute() {} },
  };
  const sb = {
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout: () => 0,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    document: fakeDoc,
    localStorage: { getItem: () => null, setItem: (k, v) => { cacheStore[k] = v; } },
    browser: {
      storage: {
        local: {
          get: async () => ({ theme: 'light', exportFormat: 'html', shortenNames: 'off' }),
          set: async () => {}, remove: async () => {},
        },
      },
      runtime: { getManifest: () => ({ version: '1.2.0' }), id: 'addons-exporter@local' },
    },
  };
  vm.createContext(sb);
  vm.runInContext(themeSrc, sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(settingsSrc, sb);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(cacheStore['addons-hub-settings-shortenNames'], 'off',
    'the batched init should write the confirmed shortenNames to localStorage');
});
