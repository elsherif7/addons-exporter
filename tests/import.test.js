// Tests for src/import/import.js's file-parsing and validation pipeline.
// Loads the real source files via vm so these run against the actual
// files, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext, makeFakeDom } = require('./helpers');

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
const reportTemplateSrc = readSrc('src/background/report-template.js');
const importSrc = readSrc('src/import/import.js');
const sandbox = { URL, document: fakeDocument };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);
vm.runInContext(reportTemplateSrc, sandbox);
vm.runInContext(importSrc, sandbox);

const {
  parseAddonsPayload,
  parseJsonPayload,
  parseCsvPayload,
  parseCsvRow,
  buildInstalledIndex,
  findInstalledMatch,
  migrateAddonsData,
  buildCsvExport,
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

// --- A6: a v1.0.0 (bare-array) export is rejected with a clear reason ---

test('parseAddonsPayload: a v1.0.0-style bare array is rejected with a specific message, not "No add-ons found"', () => {
  // v1.0.0 exported a plain array with no formatVersion/addons wrapper at
  // all - this is that exact shape.
  const result = parseAddonsPayload(JSON.stringify([
    { name: 'uBlock Origin', version: '1.58.0', enabled: true },
  ]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /old, unsupported version/);
});

// --- A27: stricter formatVersion, type coercion, de-duplication ---

test('parseAddonsPayload: a negative formatVersion is rejected', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: -5, addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: a fractional formatVersion is rejected', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: 1.5, addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: a non-string id/version/link is dropped rather than trusted as-is', () => {
  const result = parseAddonsPayload(payload([
    { name: 'Weird Types', id: 12345, version: 5, link: ['not', 'a', 'string'] },
  ]));
  assert.strictEqual(result.ok, true);
  const a = result.addons[0];
  assert.strictEqual(a.id, undefined);
  assert.strictEqual(a.version, undefined);
  assert.strictEqual(a.link, undefined);
  assert.strictEqual(a.name, 'Weird Types', 'the valid name field should be unaffected');
});

test('parseAddonsPayload: an exact duplicate entry is de-duplicated', () => {
  const entry = { id: 'a@x', name: 'Same', version: '1', link: 'https://example.com/a' };
  const result = parseAddonsPayload(payload([entry, { ...entry }]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'the duplicate entry should not produce a second row');
});

test('parseAddonsPayload: two different add-ons sharing no id/link are not treated as duplicates', () => {
  const result = parseAddonsPayload(payload([
    { name: 'Alpha' },
    { name: 'Beta' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 2);
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

function captureBulkSelectHandlers(checkboxList, { failConfirmation = false } = {}) {
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
      tabs: {
        create: async (options) => {
          if (failConfirmation && options.url.includes('confirmation.html')) {
            throw new Error('tab creation failed');
          }
          createdTabUrls.push(options.url);
          return {};
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  return {
    selectAllHandler, deselectAllHandler, openSelectedHandler,
    selectionCountEl: elements.selectionCount, statusEl: elements.status,
    openSelectedBtnEl, createdTabUrls, sandbox, elements,
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

testAsync('openSelectedBtn: a failing confirmation tab still opens the add-on tabs and re-enables the button', async () => {
  const cb1 = makeCheckbox();
  cb1.checked = true;
  cb1.dataset = { idx: '0' };

  const { openSelectedHandler, createdTabUrls, openSelectedBtnEl, statusEl, sandbox } =
    captureBulkSelectHandlers([cb1], { failConfirmation: true });
  vm.runInContext("displayItems = [{ link: 'https://addons.mozilla.org/a/' }];", sandbox);

  await openSelectedHandler();

  assert.deepStrictEqual(createdTabUrls, ['https://addons.mozilla.org/a/'],
    'the confirmation tab throwing should not stop the add-on tab from opening');
  assert.strictEqual(openSelectedBtnEl.disabled, false,
    'the button must not stay stuck disabled just because the confirmation tab failed');
  assert.strictEqual(statusEl.textContent, 'Opened 1 tab');
});

testAsync('openSelectedBtn: status text uses singular "tab" for exactly one', async () => {
  const cb1 = makeCheckbox();
  cb1.checked = true;
  cb1.dataset = { idx: '0' };

  const { openSelectedHandler, statusEl, sandbox } = captureBulkSelectHandlers([cb1]);
  vm.runInContext("displayItems = [{ link: 'https://addons.mozilla.org/a/' }];", sandbox);

  await openSelectedHandler();

  assert.strictEqual(statusEl.textContent, 'Opened 1 tab', 'not "Opened 1 tabs"');
});

// --- parseJsonPayload ---

function jsonFile(addons, formatVersion = EXPORT_FORMAT_VERSION) {
  return JSON.stringify({ formatVersion, addons });
}

test('parseJsonPayload: valid JSON file succeeds and returns the parsed addons', () => {
  const result = parseJsonPayload(jsonFile([
    { id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/x', linkType: 'amo-exact' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

test('parseJsonPayload: throws on malformed JSON', () => {
  assert.throws(() => parseJsonPayload('{not valid json'));
});

test('parseJsonPayload: rejects a newer formatVersion', () => {
  const result = parseJsonPayload(jsonFile([{ name: 'X' }], EXPORT_FORMAT_VERSION + 1));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /newer version of Add-ons Exporter/);
});

test('parseJsonPayload: rejects an empty addons array', () => {
  const result = parseJsonPayload(jsonFile([]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

// --- parseCsvRow ---

test('parseCsvRow: splits a plain unquoted row', () => {
  assert.deepStrictEqual(Array.from(parseCsvRow('a,b,c')), ['a', 'b', 'c']);
});

test('parseCsvRow: handles a quoted field containing a comma', () => {
  assert.deepStrictEqual(Array.from(parseCsvRow('"Hello, World",b,c')), ['Hello, World', 'b', 'c']);
});

test('parseCsvRow: handles doubled double-quotes inside a quoted field', () => {
  assert.deepStrictEqual(Array.from(parseCsvRow('"Say ""Hi""",b')), ['Say "Hi"', 'b']);
});

test('parseCsvRow: handles an empty field', () => {
  assert.deepStrictEqual(Array.from(parseCsvRow('a,,c')), ['a', '', 'c']);
});

// --- parseCsvPayload ---

function csvFile(addons, formatVersion = EXPORT_FORMAT_VERSION) {
  const header = 'id,name,version,enabled,type,link,linkType';
  const rows = addons.map((a) =>
    [a.id || '', a.name || '', a.version || '', a.enabled, a.type || '', a.link || '', a.linkType || ''].join(',')
  );
  return [`# addons-hub-format-version: ${formatVersion}`, header, ...rows].join('\r\n');
}

test('parseCsvPayload: valid CSV file succeeds and returns the parsed addons', () => {
  const result = parseCsvPayload(csvFile([
    { id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/x', linkType: 'amo-exact' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

test('parseCsvPayload: converts enabled field from string to boolean', () => {
  const result = parseCsvPayload(csvFile([
    { id: 'a@e.com', name: 'Enabled One', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' },
    { id: 'b@e.com', name: 'Disabled One', version: '1.0', enabled: false, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons[0].enabled, true);
  assert.strictEqual(result.addons[1].enabled, false);
});

test('parseCsvPayload: missing format-version comment is rejected', () => {
  const result = parseCsvPayload('id,name,version,enabled,type,link,linkType\next1,uBlock Origin,1.0,true,extension,https://x.com/,amo-exact');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no format-version comment found/);
});

test('parseCsvPayload: rejects a newer formatVersion', () => {
  const result = parseCsvPayload(csvFile([{ id: 'x@e.com', name: 'X', version: '1.0', enabled: true, type: 'extension', link: 'https://x.com/', linkType: 'amo-exact' }], EXPORT_FORMAT_VERSION + 1));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /newer version of Add-ons Exporter/);
});

test('parseCsvPayload: missing expected columns is rejected', () => {
  const result = parseCsvPayload(`# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}\r\nid,name\r\next1,uBlock Origin`);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing expected CSV columns/);
});

test('parseCsvPayload: no data rows is rejected', () => {
  const result = parseCsvPayload(`# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}\r\nid,name,version,enabled,type,link,linkType`);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseCsvPayload: drops rows with blank names, keeps valid ones', () => {
  const result = parseCsvPayload(csvFile([
    { id: 'a@e.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension', link: 'https://x.com/', linkType: 'amo-exact' },
    { id: 'b@e.com', name: '', version: '1.0', enabled: true, type: 'extension', link: 'https://x.com/', linkType: 'amo-exact' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

test('parseCsvPayload: handles CRLF and LF line endings', () => {
  const withLf = csvFile([
    { id: 'a@e.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension', link: 'https://x.com/', linkType: 'amo-exact' },
  ]).replace(/\r\n/g, '\n');
  const result = parseCsvPayload(withLf);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
});

// --- A25: whole-text CSV parsing (parseCsvRecords) ---

test('parseCsvRow: a stray character right after a closing quote folds into that field, not a phantom column', () => {
  assert.deepStrictEqual(Array.from(parseCsvRow('"abc"def,x')), ['abcdef', 'x']);
});

test('parseCsvPayload: a quoted field containing a real newline stays one field, not two rows', () => {
  const text = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    'id,name,version,enabled,type,link,linkType',
    'a@e.com,"Line1\nLine2",1.0,true,extension,https://x.com/,amo-exact',
  ].join('\r\n');
  const result = parseCsvPayload(text);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'should be one add-on, not two');
  assert.strictEqual(result.addons[0].name, 'Line1\nLine2');
});

test('parseCsvPayload: a spreadsheet-padded format-version comment line is still recognised', () => {
  const text = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION},,,,,,`,
    'id,name,version,enabled,type,link,linkType',
    'a@e.com,X,1.0,true,extension,https://x.com/,amo-exact',
  ].join('\r\n');
  const result = parseCsvPayload(text);
  assert.strictEqual(result.ok, true);
});

// --- A26: enabled is parsed case-insensitively ---

test('parseCsvPayload: enabled is parsed case-insensitively (a spreadsheet often capitalizes it)', () => {
  const text = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    'id,name,version,enabled,type,link,linkType',
    'a@e.com,A,1.0,TRUE,extension,https://x.com/,amo-exact',
    'b@e.com,B,1.0,False,extension,https://x.com/,amo-exact',
  ].join('\r\n');
  const result = parseCsvPayload(text);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons[0].enabled, true);
  assert.strictEqual(result.addons[1].enabled, false);
});

// --- A24 (import side): stripping the formula-injection guard ---

test('parseCsvPayload: strips the leading-apostrophe formula guard back off on import', () => {
  const csv = buildCsvExport([
    { id: 'x@e.com', name: '=HYPERLINK("https://evil.example","click")', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' },
  ]);
  const result = parseCsvPayload(csv);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons[0].name, '=HYPERLINK("https://evil.example","click")',
    'round-tripping through export+import should restore the original name exactly');
});

test('parseCsvPayload: a name that genuinely starts with an apostrophe (not our guard) is left alone', () => {
  const text = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    'id,name,version,enabled,type,link,linkType',
    `a@e.com,"'Twas Great",1.0,true,extension,https://x.com/,amo-exact`,
  ].join('\r\n');
  const result = parseCsvPayload(text);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons[0].name, "'Twas Great");
});

// --- A27: de-duplication ---

test('parseCsvPayload: an exact duplicate row is de-duplicated', () => {
  const text = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    'id,name,version,enabled,type,link,linkType',
    'a@e.com,Same,1.0,true,extension,https://x.com/a,amo-exact',
    'a@e.com,Same,1.0,true,extension,https://x.com/a,amo-exact',
  ].join('\r\n');
  const result = parseCsvPayload(text);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'the duplicate row should not produce a second entry');
});

// --- Real DOM: search and Select All against the actual rendered list ---
// Mirrors the equivalent block in export.test.js: renders import.js's
// real list (via setSelectedFile -> loadFile -> renderAddonList) against
// a real element tree with makeFakeDom, then drives the real
// searchInput/selectAllBtn handlers.

function jsonAddonsFile(addons, formatVersion = EXPORT_FORMAT_VERSION) {
  return { name: 'addons.json', text: async () => JSON.stringify({ formatVersion, addons }) };
}

async function renderRealImportList(addons, installed = []) {
  const { document, elements } = makeFakeDom([
    'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
    'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
    'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
    'searchInput', 'noSearchMatches',
  ]);
  const sandbox = {
    document,
    URL,
    browser: {
      runtime: {
        sendMessage: async (msg) => (msg.type === 'listAddons' ? installed : undefined),
        getURL: (p) => p,
      },
      storage: { local: { get: async () => ({}) } },
      tabs: { create: async () => ({}) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  sandbox.setSelectedFile(jsonAddonsFile(addons));
  // Let loadFile()'s file read, JSON parse, and listAddons message settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return elements;
}

testAsync('import.js real DOM: search hides non-matching rows and their group', async () => {
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
    { id: 'b@x', name: 'Beta', version: '2.0', link: 'https://example.com/b' },
  ]);
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  const shown = rows.filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.addon-name').textContent);
  assert.deepStrictEqual(shown, ['Alpha'], 'only the matching row should stay visible');
  assert.strictEqual(elements.noSearchMatches.style.display, 'none');
});

testAsync('import.js real DOM: a query matching nothing shows the "no matches" message and hides every row', async () => {
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
  ]);
  elements.searchInput.value = 'zzz-nomatch';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  assert.ok(rows.every((r) => r.style.display === 'none'));
  assert.strictEqual(elements.noSearchMatches.style.display, 'block');
});

testAsync('import.js real DOM: Select All while a search is active only checks the visible row', async () => {
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
    { id: 'b@x', name: 'Beta', version: '2.0', link: 'https://example.com/b' },
  ]);
  elements.deselectAllBtn.click(); // not-yet-installed rows are checked by default on render - start from a known state
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');
  elements.selectAllBtn.click();

  const checked = elements.addonList.querySelectorAll('input[type="checkbox"]:checked');
  assert.strictEqual(checked.length, 1, 'Select All should only check the row the active search still shows');
  assert.strictEqual(elements.selectionCount.textContent, '1 of 2 selected');
});

// --- A2: stale-load races ---
// Bootstraps the same real page as renderRealImportList(), but without
// auto-driving setSelectedFile, so each test can control the timing of
// the file read / listAddons / storage.get itself.
function bootImportSandbox({ installed = [], storageGet } = {}) {
  const { document, elements } = makeFakeDom([
    'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
    'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
    'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
    'searchInput', 'noSearchMatches',
  ]);
  const sandbox = {
    document,
    URL,
    browser: {
      runtime: {
        sendMessage: async (msg) => (msg.type === 'listAddons' ? installed : undefined),
        getURL: (p) => p,
      },
      storage: { local: { get: storageGet || (async () => ({})) } },
      tabs: { create: async () => ({}) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  return { sandbox, elements };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

testAsync('import.js: removing the file mid-load leaves the list empty once the stale load finishes', async () => {
  const { sandbox, elements } = bootImportSandbox();
  const slowFile = jsonAddonsFile([{ id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' }]);
  const realText = slowFile.text;
  slowFile.text = async () => { await sleep(30); return realText(); };

  sandbox.setSelectedFile(slowFile);
  await sleep(5); // load is in flight (past the start, not past the slow file.text())
  sandbox.setSelectedFile(null); // user removes the file before it finishes loading
  await sleep(50); // give the stale load plenty of time to (wrongly) finish and render

  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 0, 'the stale load should not have rendered anything');
  assert.strictEqual(elements.fileNameRow.style.display, 'none');
  assert.strictEqual(elements.chooseFileBtn.style.display, '');
});

testAsync('import.js: a second file wins even if the first is still awaiting storage.get', async () => {
  let storageCalls = 0;
  const { sandbox, elements } = bootImportSandbox({
    storageGet: async () => {
      storageCalls++;
      if (storageCalls === 1) await sleep(40); // only the first (stale) load is slow here
      return {};
    },
  });

  sandbox.setSelectedFile(jsonAddonsFile([{ id: 'a@x', name: 'FirstFileAddon', version: '1', link: 'https://example.com/a' }]));
  await sleep(10); // first load is now past listAddons and into the slow storage.get
  sandbox.setSelectedFile(jsonAddonsFile([{ id: 'b@x', name: 'SecondFileAddon', version: '1', link: 'https://example.com/b' }]));
  await sleep(80); // let both loads fully settle

  const names = elements.addonList.querySelectorAll('.addon-name').map((n) => n.textContent);
  assert.deepStrictEqual(names, ['SecondFileAddon'], 'the second, faster-to-select file should be what\'s shown, not the first');
});
