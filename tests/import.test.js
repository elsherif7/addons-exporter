// Tests for src/import/import.js's file-parsing and validation pipeline.
// Loads the real source files via vm so these run against the actual
// files, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext } = require('./helpers');

function makeFakeElement() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    dataset: {},
    textContent: '',
    innerHTML: '',
    value: '',
  };
}

// import.js wires up DOM elements and event listeners at load time. This
// stub exists purely to let the file load without throwing - none of the
// tests below trigger DOM rendering, file reading, or messaging, so a
// generic fake element for every id is enough.
const fakeDocument = { getElementById() { return makeFakeElement(); } };

const commonSrc = readSrc('src/common/common.js');
const importSrc = readSrc('src/import/import.js');
const sandbox = { URL, document: fakeDocument };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);
vm.runInContext(importSrc, sandbox);

const {
  parseAddonsPayload,
  buildInstalledIndex,
  findInstalledMatch,
  migrateAddonsData,
} = sandbox;

// EXPORT_FORMAT_VERSION is declared with top-level `const` in common.js,
// so (unlike the function declarations above) it isn't copied onto the
// sandbox object - it only exists in the context's own lexical scope.
// Evaluate it there directly instead of destructuring it from sandbox.
const EXPORT_FORMAT_VERSION = evalInContext(sandbox, 'EXPORT_FORMAT_VERSION');

// --- parseAddonsPayload ---
// Validates the untrusted-file payload embedded in an exported report.

function payload(addons, formatVersion = EXPORT_FORMAT_VERSION) {
  return JSON.stringify({ formatVersion, addons });
}

test('parseAddonsPayload: null jsonText (no embedded data element found)', () => {
  const result = parseAddonsPayload(null);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no embedded data found/);
});

test('parseAddonsPayload: throws on malformed JSON', () => {
  assert.throws(() => parseAddonsPayload('{not valid json'));
});

test('parseAddonsPayload: missing addons array', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: 1 }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: addons present but not an array', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: 1, addons: 'nope' }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: empty addons array', () => {
  const result = parseAddonsPayload(payload([]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: drops entries with missing/blank/non-string name, keeps valid ones', () => {
  const result = parseAddonsPayload(payload([
    { name: 'uBlock Origin' },
    { name: '' },
    { name: '   ' },
    { name: 42 },
    {},
    null,
    { name: 'Dark Reader' },
  ]));
  assert.strictEqual(result.ok, true);
  // Array.from (called in this realm) normalizes the foreign-realm array
  // that comes back from the vm sandbox, so deepStrictEqual can compare
  // it against a plain literal instead of tripping over cross-realm
  // Array identity.
  assert.deepStrictEqual(Array.from(result.addons, (a) => a.name), ['uBlock Origin', 'Dark Reader']);
});

test('parseAddonsPayload: every entry invalid -> rejected as no valid add-ons', () => {
  const result = parseAddonsPayload(payload([{ name: '' }, { notAName: 'x' }]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No valid add-ons found/);
});

test('parseAddonsPayload: missing formatVersion', () => {
  const result = parseAddonsPayload(JSON.stringify({ addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: non-numeric formatVersion', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: '1', addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: formatVersion newer than supported is rejected', () => {
  const result = parseAddonsPayload(payload([{ name: 'X' }], EXPORT_FORMAT_VERSION + 1));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /newer version of Add-ons Exporter/);
});

test('parseAddonsPayload: formatVersion exactly at the supported boundary succeeds', () => {
  const result = parseAddonsPayload(payload([{ name: 'X' }], EXPORT_FORMAT_VERSION));
  assert.strictEqual(result.ok, true);
});

test('parseAddonsPayload: valid file succeeds and returns the parsed addons', () => {
  const result = parseAddonsPayload(payload([
    { id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', link: 'https://addons.mozilla.org/x' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

// --- migrateAddonsData ---

test('migrateAddonsData: currently a no-op, returns the list unchanged', () => {
  const list = [{ name: 'X' }];
  assert.strictEqual(migrateAddonsData(list, EXPORT_FORMAT_VERSION), list);
});

// Deliberately hardcodes today's version number and today's no-op
// behavior, rather than reading EXPORT_FORMAT_VERSION dynamically like
// the test above. The moment someone bumps EXPORT_FORMAT_VERSION, this
// starts failing - that's the point. It's a tripwire: a format bump
// can't ship without someone consciously updating migrateAddonsData for
// the new shape and updating this test to match, instead of the bump
// quietly going out with the old no-op still in place.
test('migrateAddonsData: bumping the format version requires updating this test and migrateAddonsData', () => {
  assert.strictEqual(
    EXPORT_FORMAT_VERSION, 1,
    'EXPORT_FORMAT_VERSION changed - implement real migration logic in migrateAddonsData for the new format, then update this test to match.'
  );
  const list = [{ name: 'X' }];
  assert.deepStrictEqual(
    migrateAddonsData(list, 1), list,
    'migrateAddonsData is expected to still be a no-op for format version 1'
  );
});

// --- buildInstalledIndex / findInstalledMatch ---

test('findInstalledMatch: matches by id even when names differ', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Renamed Locally' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'ext1@example.com', name: 'Original Name' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: falls back to case-insensitive name match when id is absent', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ name: 'DARK reader' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: falls back to name when id is present but not found', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'some-other-id', name: 'Dark Reader' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: returns null when neither id nor name matches', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'nope', name: 'Something Else' }, index);
  assert.strictEqual(match, null);
});

// --- selectAllBtn / deselectAllBtn click handlers ---
// These load the real import.js via vm with a fake addon list (some rows
// disabled the way createAddonRow disables them for unsafe links, some
// hidden the way a search filter hides them) and invoke the actual
// registered click handlers, the same approach export.test.js uses for
// export.js's exportBtn handler.

function makeCheckbox({ disabled = false, hidden = false } = {}) {
  return {
    checked: false,
    disabled,
    closest: () => ({ style: { display: hidden ? 'none' : '' } }),
  };
}

function captureBulkSelectHandlers(checkboxList) {
  let selectAllHandler = null;
  let deselectAllHandler = null;
  let openSelectedHandler = null;
  let setTimeoutCallCount = 0;
  const createdTabUrls = [];
  const addonListElStub = {
    querySelectorAll: (sel) => (sel.includes(':checked') ? checkboxList.filter((cb) => cb.checked) : checkboxList),
    addEventListener() {},
  };
  const openSelectedBtnEl = {
    addEventListener: (ev, fn) => { if (ev === 'click') openSelectedHandler = fn; },
    disabled: false,
  };
  const elements = {
    status: { textContent: '' },
    fileName: {},
    fileNameRow: { style: {} },
    fileInput: { addEventListener() {} },
    picker: { addEventListener() {} },
    removeFileBtn: { addEventListener() {} },
    chooseFileBtn: { addEventListener() {} },
    listControls: { style: {} },
    addonList: addonListElStub,
    checklistBox: { style: {} },
    selectAllBtn: { addEventListener: (ev, fn) => { if (ev === 'click') selectAllHandler = fn; } },
    deselectAllBtn: { addEventListener: (ev, fn) => { if (ev === 'click') deselectAllHandler = fn; } },
    selectionCount: { textContent: '' },
    openSelectedBtn: openSelectedBtnEl,
    compareNote: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
  };
  const sandbox = {
    URL,
    setTimeout: (fn) => { setTimeoutCallCount++; fn(); return 0; }, // fires the stagger delay immediately - no reason for tests to actually wait
    document: { getElementById: (id) => elements[id] },
    browser: {
      runtime: { getURL: (path) => `moz-extension://test-id/${path}` },
      tabs: { create: async (options) => { createdTabUrls.push(options.url); return {}; } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  return {
    selectAllHandler, deselectAllHandler, openSelectedHandler,
    selectionCountEl: elements.selectionCount, openSelectedBtnEl, createdTabUrls, sandbox,
    getSetTimeoutCallCount: () => setTimeoutCallCount,
  };
}

test('selectAllBtn: checks visible enabled rows, skips disabled (unsafe-link) rows', () => {
  const enabled1 = makeCheckbox();
  const disabled = makeCheckbox({ disabled: true });
  const enabled2 = makeCheckbox();
  const { selectAllHandler, selectionCountEl } = captureBulkSelectHandlers([enabled1, disabled, enabled2]);

  selectAllHandler();

  assert.strictEqual(enabled1.checked, true);
  assert.strictEqual(enabled2.checked, true);
  assert.strictEqual(disabled.checked, false, 'a disabled (unsafe-link) checkbox should never be checked by Select all');
  assert.strictEqual(selectionCountEl.textContent, '2 of 3 selected');
});

test('selectAllBtn: skips rows hidden by the current search filter', () => {
  const visible = makeCheckbox();
  const hidden = makeCheckbox({ hidden: true });
  const { selectAllHandler } = captureBulkSelectHandlers([visible, hidden]);

  selectAllHandler();

  assert.strictEqual(visible.checked, true);
  assert.strictEqual(hidden.checked, false);
});

test('deselectAllBtn: unchecks visible enabled rows, leaves disabled rows alone', () => {
  const enabled1 = makeCheckbox();
  const disabled = makeCheckbox({ disabled: true });
  enabled1.checked = true;
  const { deselectAllHandler, selectionCountEl, openSelectedBtnEl } = captureBulkSelectHandlers([enabled1, disabled]);

  deselectAllHandler();

  assert.strictEqual(enabled1.checked, false);
  assert.strictEqual(disabled.checked, false);
  assert.strictEqual(selectionCountEl.textContent, '0 of 2 selected');
  assert.strictEqual(openSelectedBtnEl.disabled, true);
});

// --- openSelectedBtn click handler ---
// displayItems is a module-level `let`, reassigned by loadFile() in real
// use - it isn't a sandbox property (only var/function declarations are),
// so it's set here via vm.runInContext() directly against the returned
// sandbox, in the same lexical scope where it was declared.

testAsync('openSelectedBtn: opens the import confirmation tab first, then each selected link, staggered throughout', async () => {
  const cb1 = makeCheckbox();
  cb1.checked = true;
  cb1.dataset = { idx: '0' };
  const cb2 = makeCheckbox();
  cb2.checked = true;
  cb2.dataset = { idx: '1' };

  const { openSelectedHandler, createdTabUrls, sandbox, getSetTimeoutCallCount } = captureBulkSelectHandlers([cb1, cb2]);
  vm.runInContext(
    "displayItems = [{ link: 'https://addons.mozilla.org/a/' }, { link: 'https://addons.mozilla.org/b/' }];",
    sandbox
  );

  await openSelectedHandler();

  assert.deepStrictEqual(createdTabUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=import',
    'https://addons.mozilla.org/a/',
    'https://addons.mozilla.org/b/',
  ]);
  // One stagger delay after confirmation, before the first tab, plus one
  // between the two tabs (none needed after the last one) - 2 total.
  assert.strictEqual(getSetTimeoutCallCount(), 2);
});

testAsync('openSelectedBtn: still opens the confirmation tab even if every selected link fails to open', async () => {
  const cb1 = makeCheckbox();
  cb1.checked = true;
  cb1.dataset = { idx: '0' };

  const { openSelectedHandler, createdTabUrls, sandbox } = captureBulkSelectHandlers([cb1]);
  // Re-validated at open time regardless of how it got selected - see
  // isSafeUrl's use in the real handler.
  vm.runInContext("displayItems = [{ link: 'javascript:alert(1)' }];", sandbox);

  await openSelectedHandler();

  // Confirmation opens before the loop runs, so it can't know yet
  // whether anything will actually succeed - only the unsafe link is
  // blocked, same as always.
  assert.deepStrictEqual(createdTabUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=import',
  ]);
});
