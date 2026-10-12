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
const fakeDocument = { getElementById() { return makeFakeElement(); }, addEventListener() {} };

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
  validateSelectedFile,
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

function captureBulkSelectHandlers(checkboxList, { failNavigation = false, failSendMessage = false, failTabUrls = [] } = {}) {
  let selectAllHandler = null;
  let deselectAllHandler = null;
  let openSelectedHandler = null;
  let setTimeoutCallCount = 0;
  const createdTabUrls = [];
  const navigatedUrls = [];
  const sentMessages = [];
  const order = []; // interleaved log of tab creation / message / navigation
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
    document: { getElementById: (id) => elements[id], addEventListener() {} },
    // import.js finishes by replacing its own page with confirmation.html
    location: {
      replace: (url) => {
        if (failNavigation) throw new Error('navigation failed');
        order.push('navigate');
        navigatedUrls.push(url);
      },
    },
    browser: {
      runtime: {
        getURL: (path) => `moz-extension://test-id/${path}`,
        // The Importer hands every tab after the first to background.js.
        sendMessage: async (msg) => {
          if (failSendMessage) throw new Error('Could not establish connection');
          order.push('message');
          sentMessages.push(msg);
          return { queued: msg.urls.length };
        },
      },
      tabs: {
        create: async (options) => {
          if (failTabUrls.includes(options.url)) throw new Error('tab creation failed');
          order.push('tab');
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
    openSelectedBtnEl, createdTabUrls, navigatedUrls, sentMessages, order, sandbox, elements,
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

// Objects built inside the vm sandbox have a different Object prototype, so
// deepStrictEqual needs them copied into this realm first.
const plain = (v) => JSON.parse(JSON.stringify(v));

function selectItems(links) {
  const boxes = links.map((_, i) => {
    const cb = makeCheckbox();
    cb.checked = true;
    cb.dataset = { idx: String(i) };
    return cb;
  });
  const items = links.map((link) => ({ link }));
  return { boxes, itemsJs: `displayItems = ${JSON.stringify(items)};` };
}

testAsync('openSelectedBtn: opens only the FIRST add-on itself, hands the rest to background.js, then shows the confirmation page', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/']);
  const ctx = captureBulkSelectHandlers(boxes);
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, ['https://addons.mozilla.org/a/'], 'only the first tab is opened from the page');
  assert.deepStrictEqual(plain(ctx.sentMessages), [
    { type: 'openTabs', urls: ['https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/'] },
  ]);
  assert.deepStrictEqual(ctx.navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=import',
  ]);
  // The confirmation page must not wait for the later add-ons.
  assert.deepStrictEqual(ctx.order, ['tab', 'message', 'navigate']);
  assert.strictEqual(ctx.getSetTimeoutCallCount(), 0, 'no stagger delay here - background.js does that');
  assert.strictEqual(ctx.statusEl.textContent, 'Opened 3 tabs');
});

testAsync('openSelectedBtn: a single selected add-on needs no hand-off at all', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/']);
  const ctx = captureBulkSelectHandlers(boxes);
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, ['https://addons.mozilla.org/a/']);
  assert.deepStrictEqual(plain(ctx.sentMessages), []);
  assert.deepStrictEqual(ctx.order, ['tab', 'navigate']);
  assert.strictEqual(ctx.statusEl.textContent, 'Opened 1 tab', 'not "Opened 1 tabs"');
});

testAsync('openSelectedBtn: stays on the page (no confirmation) if every selected link fails to open', async () => {
  const { boxes, itemsJs } = selectItems(['javascript:alert(1)']);
  const ctx = captureBulkSelectHandlers(boxes);
  // Re-validated at open time regardless of how it got selected - see
  // isSafeUrl's use in the real handler.
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, []);
  assert.deepStrictEqual(plain(ctx.sentMessages), []);
  assert.deepStrictEqual(ctx.navigatedUrls, [], 'nothing opened, so there is nothing to confirm');
  assert.match(ctx.statusEl.textContent, /1 failed to open/);
  assert.strictEqual(ctx.openSelectedBtnEl.disabled, false);
});

testAsync('openSelectedBtn: unsafe links are skipped and counted; the confirmation page is told how many', async () => {
  const { boxes, itemsJs } = selectItems(['javascript:alert(1)', 'https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/']);
  const ctx = captureBulkSelectHandlers(boxes);
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, ['https://addons.mozilla.org/a/']);
  assert.deepStrictEqual(plain(ctx.sentMessages), [{ type: 'openTabs', urls: ['https://addons.mozilla.org/b/'] }]);
  assert.deepStrictEqual(ctx.navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=import&failed=1',
  ]);
});

testAsync('openSelectedBtn: if the first tab cannot be created, the next one is the "first" and the failure is counted', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/']);
  const ctx = captureBulkSelectHandlers(boxes, { failTabUrls: ['https://addons.mozilla.org/a/'] });
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, ['https://addons.mozilla.org/b/']);
  assert.deepStrictEqual(plain(ctx.sentMessages), [{ type: 'openTabs', urls: ['https://addons.mozilla.org/c/'] }]);
  assert.match(ctx.navigatedUrls[0], /from=import&failed=1$/);
});

testAsync('openSelectedBtn: if background.js cannot be reached, the page opens the rest itself (staggered) before moving on', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/']);
  const ctx = captureBulkSelectHandlers(boxes, { failSendMessage: true });
  vm.runInContext(itemsJs, ctx.sandbox);

  await ctx.openSelectedHandler();

  assert.deepStrictEqual(ctx.createdTabUrls, [
    'https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/',
  ]);
  assert.strictEqual(ctx.getSetTimeoutCallCount(), 2, 'one stagger delay before each fallback tab');
  assert.deepStrictEqual(ctx.navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=import',
  ]);
});

testAsync('openSelectedBtn: a failing navigation still leaves the add-on tabs open and re-enables the button', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/']);
  const ctx = captureBulkSelectHandlers(boxes, { failNavigation: true });
  vm.runInContext(itemsJs, ctx.sandbox);

  await assert.rejects(() => ctx.openSelectedHandler(), /navigation failed/);

  assert.deepStrictEqual(ctx.createdTabUrls, ['https://addons.mozilla.org/a/']);
  assert.strictEqual(ctx.openSelectedBtnEl.disabled, false,
    'the button must not stay stuck disabled just because the page could not be replaced');
  assert.strictEqual(ctx.statusEl.textContent, 'Opened 1 tab');
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
  ], false); // full names: this checks the guard round-trips, not shortening
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

// --- A35: unsafe-link rows get a class directly, not via :has() ---

testAsync('import.js real DOM: a row with an unsafe link gets the row-disabled class', async () => {
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Safe', version: '1', link: 'https://example.com/a' },
    { id: 'b@x', name: 'Unsafe', version: '1', link: 'javascript:alert(1)' },
  ]);
  const rows = elements.addonList.querySelectorAll('.addon-row');
  const safeRow = rows.find((r) => r.querySelector('.addon-name').textContent === 'Safe');
  const unsafeRow = rows.find((r) => r.querySelector('.addon-name').textContent === 'Unsafe');
  assert.strictEqual(safeRow.classList.contains('row-disabled'), false);
  assert.strictEqual(unsafeRow.classList.contains('row-disabled'), true);
});

// --- A23: validateSelectedFile ---

test('validateSelectedFile: accepts .html, .htm, .json, .csv, and .txt', () => {
  for (const name of ['export.html', 'export.htm', 'export.json', 'export.csv', 'export.txt']) {
    const result = validateSelectedFile({ name, size: 1000 });
    assert.strictEqual(result.ok, true, `${name} should be accepted`);
  }
});

test('validateSelectedFile: rejects an unrecognised extension', () => {
  const result = validateSelectedFile({ name: 'notes.xml', size: 1000 });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /isn't a supported file type/);
});

test('validateSelectedFile: extension check is case-insensitive', () => {
  const result = validateSelectedFile({ name: 'Export.HTML', size: 1000 });
  assert.strictEqual(result.ok, true);
});

test('validateSelectedFile: rejects a file over the size cap', () => {
  const result = validateSelectedFile({ name: 'export.json', size: 11 * 1024 * 1024 });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /too large/);
});

test('validateSelectedFile: accepts a file right at the size cap', () => {
  const result = validateSelectedFile({ name: 'export.json', size: 10 * 1024 * 1024 });
  assert.strictEqual(result.ok, true);
});

test('validateSelectedFile: a missing/undefined size is not treated as oversized', () => {
  const result = validateSelectedFile({ name: 'export.json' });
  assert.strictEqual(result.ok, true);
});

// --- A23: setSelectedFile rejects an invalid file before loading it ---

testAsync('import.js: selecting an unsupported file type is rejected before any read is attempted', async () => {
  const { sandbox, elements } = bootImportSandbox();
  let readAttempted = false;
  sandbox.setSelectedFile({ name: 'notes.xml', size: 100, text: async () => { readAttempted = true; return ''; } });
  await sleep(20);

  assert.strictEqual(readAttempted, false, 'the file should never be read at all');
  assert.match(elements.status.textContent, /isn't a supported file type/);
});

testAsync('import.js: selecting an oversized file is rejected before any read is attempted', async () => {
  const { sandbox, elements } = bootImportSandbox();
  let readAttempted = false;
  sandbox.setSelectedFile({ name: 'export.json', size: 50 * 1024 * 1024, text: async () => { readAttempted = true; return ''; } });
  await sleep(20);

  assert.strictEqual(readAttempted, false);
  assert.match(elements.status.textContent, /too large/);
});

// --- A23: drag-drop is guarded at the document level too ---

testAsync('import.js: a drop event on the document (outside the picker) is prevented by default', async () => {
  const { sandbox } = bootImportSandbox();
  const event = { type: 'drop', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  sandbox.document.dispatchEvent(event);
  assert.strictEqual(event.defaultPrevented, true, 'a drop anywhere on the page should be prevented, not just inside the picker');
});

// --- 4.2: compareNote summary line ---

testAsync('import.js real DOM: shows a count note when some are new and some are already installed', async () => {
  const installed = [{ id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' }];
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
    { id: 'b@x', name: 'Beta',  version: '2.0', link: 'https://example.com/b' },
  ], installed);
  assert.match(elements.compareNote.textContent, /1 new add-on pre-selected/);
  assert.match(elements.compareNote.textContent, /1 already-installed add-on shown for reference/);
});

testAsync('import.js real DOM: count note uses plural when there are multiple new and multiple installed', async () => {
  const installed = [
    { id: 'b@x', name: 'Beta',  version: '2.0', enabled: true, type: 'extension' },
    { id: 'c@x', name: 'Gamma', version: '3.0', enabled: true, type: 'extension' },
  ];
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
    { id: 'd@x', name: 'Delta', version: '4.0', link: 'https://example.com/d' },
    { id: 'b@x', name: 'Beta',  version: '2.0', link: 'https://example.com/b' },
    { id: 'c@x', name: 'Gamma', version: '3.0', link: 'https://example.com/c' },
  ], installed);
  assert.match(elements.compareNote.textContent, /2 new add-ons pre-selected/);
  assert.match(elements.compareNote.textContent, /2 already-installed add-ons shown for reference/);
});

testAsync('import.js real DOM: shows the "already have everything" note when nothing is new', async () => {
  const installed = [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' }];
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
  ], installed);
  assert.match(elements.compareNote.textContent, /already have every add-on/);
  assert.doesNotMatch(elements.compareNote.textContent, /new add-on/);
});

testAsync('import.js real DOM: no note shown when everything is new and nothing is installed', async () => {
  const elements = await renderRealImportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
  ]);
  assert.strictEqual(elements.compareNote.textContent, '', 'no note needed when all add-ons are new');
});

// --- Live "Shorten add-on names": an already-open Importer follows the setting ---

async function renderRealImportListLive(addons, stored = {}) {
  const { document, elements } = makeFakeDom([
    'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
    'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
    'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
    'searchInput', 'noSearchMatches',
  ]);
  const listeners = [];
  const sandbox = {
    document,
    URL,
    browser: {
      runtime: { sendMessage: async (msg) => (msg.type === 'listAddons' ? [] : undefined), getURL: (p) => p },
      storage: { local: { get: async () => stored }, onChanged: { addListener: (fn) => listeners.push(fn) } },
      tabs: { create: async () => ({}) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  sandbox.setSelectedFile(jsonAddonsFile(addons));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fire = (changes, area = 'local') => listeners.forEach((fn) => fn(changes, area));
  const names = () => elements.addonList.querySelectorAll('.addon-name').map((n) => n.textContent);
  return { elements, fire, names };
}

const LIVE_ADDONS = [
  { id: 'a@x', name: 'uBlock Origin - free ad blocker', version: '1.0', link: 'https://example.com/a' },
  { id: 'b@x', name: 'Dark Reader: dark mode', version: '2.0', link: 'https://example.com/b' },
];

testAsync('live names (Importer): switching "Shorten add-on names" off shows the full names at once, and back on shortens them again', async () => {
  const { fire, names } = await renderRealImportListLive(LIVE_ADDONS);
  assert.deepStrictEqual(names().sort(), ['Dark Reader', 'uBlock Origin']);
  fire({ shortenNames: { newValue: 'off' } });
  assert.deepStrictEqual(names().sort(), ['Dark Reader: dark mode', 'uBlock Origin - free ad blocker']);
  fire({ shortenNames: { newValue: 'on' } });
  assert.deepStrictEqual(names().sort(), ['Dark Reader', 'uBlock Origin']);
});

testAsync('live names (Importer): a reset (the setting removed) goes back to shortened names', async () => {
  const { fire, names } = await renderRealImportListLive(LIVE_ADDONS, { shortenNames: 'off' });
  assert.deepStrictEqual(names().sort(), ['Dark Reader: dark mode', 'uBlock Origin - free ad blocker']);
  fire({ shortenNames: { oldValue: 'off' } });
  assert.deepStrictEqual(names().sort(), ['Dark Reader', 'uBlock Origin']);
});

testAsync('live names (Importer): a search in progress is applied again to the new names, and the selection is untouched', async () => {
  const { elements, fire } = await renderRealImportListLive(LIVE_ADDONS);
  const checkedBefore = elements.addonList.querySelectorAll('input[type="checkbox"]:checked').length;
  elements.searchInput.value = 'free ad';
  elements.searchInput.dispatchEvent('input');
  const visible = () => elements.addonList.querySelectorAll('.addon-row')
    .filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.addon-name').textContent);
  assert.deepStrictEqual(visible(), []);
  fire({ shortenNames: { newValue: 'off' } });
  assert.deepStrictEqual(visible(), ['uBlock Origin - free ad blocker']);
  assert.strictEqual(elements.addonList.querySelectorAll('input[type="checkbox"]:checked').length, checkedBefore, 'ticked boxes stay ticked');
});

// --- Removing the file (the x) plays the opening in reverse, then really removes it ---

async function renderImportForRemoval(addons, { reducedMotion = false, slowFile = null } = {}) {
  const { document, elements } = makeFakeDom([
    'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
    'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
    'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
    'searchInput', 'noSearchMatches',
  ]);
  const log = [];     // every element.animate() call, in order
  const pending = []; // controllable animations
  const animatable = (el, name) => {
    el.animate = (keyframes, options) => {
      let resolve;
      const finished = new Promise((r) => { resolve = r; });
      const anim = { name, keyframes, options, finished, cancelled: false, resolve, cancel() { anim.cancelled = true; } };
      log.push(anim);
      pending.push(anim);
      return anim;
    };
  };
  for (const name of ['checklistBox', 'listControls', 'searchInput', 'compareNote', 'fileNameRow', 'chooseFileBtn']) animatable(elements[name], name);
  const sandbox = {
    document,
    URL,
    matchMedia: () => ({ matches: reducedMotion }),
    browser: {
      runtime: { sendMessage: async (msg) => (msg.type === 'listAddons' ? [] : undefined), getURL: (p) => p },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { create: async () => ({}) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(importSrc, sandbox);
  sandbox.setSelectedFile(slowFile || jsonAddonsFile(addons));
  await new Promise((resolve) => setTimeout(resolve, 20));
  log.length = 0; // forget animations from loading the file
  pending.length = 0;
  const finishAll = async () => {
    pending.forEach((a) => a.resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { elements, sandbox, log, finishAll };
}

const REMOVAL_ADDONS = [
  { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
  { id: 'b@x', name: 'Beta', version: '2.0', link: 'https://example.com/b' },
];

testAsync('remove file (x): the page plays out in reverse - lowest part first, each 80ms after the one below it, sliding left and fading', async () => {
  const { elements, log } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  assert.deepStrictEqual(log.map((a) => a.name), ['checklistBox', 'listControls', 'searchInput', 'fileNameRow']);
  assert.deepStrictEqual(log.map((a) => a.options.delay), [0, 80, 160, 240]);
  for (const a of log) {
    assert.strictEqual(a.keyframes[1].opacity, 0);
    assert.strictEqual(a.keyframes[1].transform, 'translateX(-14px)');
    assert.strictEqual(a.options.fill, 'forwards', 'held at the end frame until the file is really gone');
  }
});

testAsync('remove file (x): the file is only really removed once the exit has finished', async () => {
  const { elements, finishAll } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  assert.strictEqual(elements.fileNameRow.style.display, 'flex', 'still showing while it animates out');
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 2);
  await finishAll();
  assert.strictEqual(elements.fileNameRow.style.display, 'none');
  assert.strictEqual(elements.chooseFileBtn.style.display, '');
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 0);
  assert.strictEqual(elements.status.textContent, '');
});

testAsync('remove file (x): the held end frames are cancelled afterwards, so the next file\'s list is not left invisible', async () => {
  const { elements, log, finishAll } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  const exit = log.slice();
  await finishAll();
  assert.ok(exit.every((a) => a.cancelled), 'every exit animation was cancelled once the file was gone');
});

testAsync('remove file (x): "Choose file" pops back in once the file is gone', async () => {
  const { elements, log, finishAll } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  await finishAll();
  const pop = log.find((a) => a.name === 'chooseFileBtn');
  assert.ok(pop, 'the button animates in');
  assert.strictEqual(pop.keyframes[0].opacity, 0);
  assert.strictEqual(pop.keyframes[1].opacity, 1);
});

testAsync('remove file (x): pressing it twice does not start a second exit', async () => {
  const { elements, log } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  elements.removeFileBtn.click();
  assert.strictEqual(log.length, 4);
});

testAsync('remove file (x): a note under the file name is part of the exit; with nothing to say it is skipped', async () => {
  const withNote = await renderImportForRemoval(REMOVAL_ADDONS);
  withNote.elements.compareNote.textContent = 'You already have every add-on from this export installed.';
  withNote.elements.removeFileBtn.click();
  assert.deepStrictEqual(withNote.log.map((a) => a.name), ['checklistBox', 'listControls', 'searchInput', 'compareNote', 'fileNameRow']);
});

testAsync('remove file (x): choosing another file while it is animating out keeps that file and its list visible', async () => {
  const { elements, sandbox, log, finishAll } = await renderImportForRemoval(REMOVAL_ADDONS);
  elements.removeFileBtn.click();
  const exit = log.slice();
  sandbox.setSelectedFile(jsonAddonsFile([{ id: 'c@x', name: 'Gamma', version: '3', link: 'https://example.com/c' }]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await finishAll();
  assert.ok(exit.every((a) => a.cancelled), 'the held frames are released so the new list shows');
  assert.deepStrictEqual(elements.addonList.querySelectorAll('.addon-name').map((n) => n.textContent), ['Gamma']);
  assert.notStrictEqual(elements.fileNameRow.style.display, 'none', 'the new file is still shown');
});

testAsync('remove file (x): a load that is still in flight can no longer draw anything once x is pressed', async () => {
  let release;
  const slowFile = { name: 'slow.json', size: 10, text: () => new Promise((resolve) => { release = () => resolve(JSON.stringify({ formatVersion: 1, addons: [{ id: 'z@x', name: 'Late', version: '1', link: 'https://example.com/z' }] })); }) };
  const { elements, finishAll } = await renderImportForRemoval(REMOVAL_ADDONS, { slowFile });
  elements.removeFileBtn.click();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await finishAll();
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 0, 'the late result is thrown away');
});

testAsync('remove file (x): with reduced motion, or when nothing can animate, the file is removed at once', async () => {
  const reduced = await renderImportForRemoval(REMOVAL_ADDONS, { reducedMotion: true });
  reduced.elements.removeFileBtn.click();
  assert.strictEqual(reduced.log.length, 0);
  assert.strictEqual(reduced.elements.fileNameRow.style.display, 'none');
  assert.strictEqual(reduced.elements.addonList.querySelectorAll('.addon-row').length, 0);
});

// --- the readable JSON / CSV / TXT exports still import back unchanged ---

const readableSample = [
  { id: 'z@e.com', name: 'Zed Tool', version: '2.0', enabled: false, type: 'extension', link: 'https://example.com/z', linkType: 'amo-exact' },
  { id: 'a@e.com', name: 'Ünïcode, "Quoted" Add-on', version: '1.10.3', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'amo-search' },
  { id: 'd@e.com', name: 'Dark Theme', version: '1.0', enabled: true, type: 'theme', link: 'https://example.com/d', linkType: 'homepage' },
  { id: 'b@e.com', name: 'Beta', version: '3', enabled: false, type: 'theme', link: 'https://example.com/b', linkType: 'amo-exact' },
];
const readableNames = (r) => Array.from(r.addons.map((a) => a.name));

test('readable exports: enabled add-ons come first, then disabled, each A-Z (JSON, CSV and TXT agree)', () => {
  const expected = ['Dark Theme', 'Ünïcode, "Quoted" Add-on', 'Beta', 'Zed Tool'];
  assert.deepStrictEqual(readableNames(sandbox.parseJsonPayload(sandbox.buildJsonExport(readableSample, false))), expected);
  assert.deepStrictEqual(readableNames(sandbox.parseCsvPayload(sandbox.buildCsvExport(readableSample, false))), expected);
  assert.deepStrictEqual(readableNames(sandbox.parseTxtPayload(sandbox.buildTxtExport(readableSample, false))), expected);
});

test('readable exports: every field survives the round trip in all three formats', () => {
  const byId = (r) => Object.fromEntries(r.addons.map((a) => [a.id || a.name, a]));
  for (const text of [sandbox.buildJsonExport(readableSample, false), sandbox.buildCsvExport(readableSample, false)]) {
    const r = text.trimStart().startsWith('{') ? sandbox.parseJsonPayload(text) : sandbox.parseCsvPayload(text);
    assert.strictEqual(r.ok, true);
    const m = byId(r);
    for (const a of readableSample) {
      assert.strictEqual(m[a.id].name, a.name);
      assert.strictEqual(m[a.id].version, a.version);
      assert.strictEqual(m[a.id].enabled, a.enabled);
      assert.strictEqual(m[a.id].type, a.type);
      assert.strictEqual(m[a.id].link, a.link);
    }
  }
  const t = sandbox.parseTxtPayload(sandbox.buildTxtExport(readableSample, false));
  assert.strictEqual(t.ok, true);
  for (const a of readableSample) {
    const got = t.addons.find((x) => x.name === a.name);
    assert.ok(got, a.name);
    assert.strictEqual(got.version, a.version);
    assert.strictEqual(got.enabled, a.enabled);
    assert.strictEqual(got.type, a.type);
    assert.strictEqual(got.link, a.link);
  }
});

test('JSON export: each add-on lists name first and the id last', () => {
  const parsed = JSON.parse(sandbox.buildJsonExport(readableSample, false));
  assert.deepStrictEqual(Object.keys(parsed.addons[0]), ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id']);
  assert.strictEqual(parsed.formatVersion, EXPORT_FORMAT_VERSION);
});

test('TXT export: a title, Enabled and Disabled sections, and lined-up columns', () => {
  const txt = sandbox.buildTxtExport(readableSample, false);
  const lines = txt.split('\r\n');
  assert.match(lines[0], /^# addons-hub-format-version: \d+$/);
  assert.strictEqual(lines[2], 'Firefox Add-ons - 4 in total (2 enabled, 2 disabled)');
  assert.ok(lines.includes('Enabled (2)') && lines.includes('Disabled (2)'));
  const rows = lines.filter((l) => l.includes(' | '));
  assert.strictEqual(rows.length, 4);
  // every column starts at the same place on every line
  const firstBar = rows.map((l) => l.indexOf(' | '));
  assert.strictEqual(new Set(firstBar).size, 1);
  assert.ok(!/\r\n$/.test(txt), 'no blank line left at the end');
});

test('CSV export: begins with a byte-order mark, which the importer ignores', () => {
  const csv = sandbox.buildCsvExport(readableSample, false);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  assert.strictEqual(sandbox.parseCsvPayload(csv).ok, true);
  assert.strictEqual(sandbox.parseTxtPayload('﻿' + sandbox.buildTxtExport(readableSample, false)).ok, true);
});

// --- shortened names, ids, and older exports without ids ---

const longNameAddons = [
  { id: 'buster@x', name: 'Buster: Captcha Solver for Humans', version: '3.4.0', enabled: true, type: 'extension', link: 'https://example.com/buster', linkType: 'amo-exact' },
  { id: 'stayfree@x', name: 'StayFree - Website Blocker, Web Analytics', version: '2.0', enabled: false, type: 'extension', link: 'https://example.com/stayfree', linkType: 'amo-exact' },
  { id: 'plain@x', name: 'Plain Name', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/plain', linkType: 'homepage' },
];
const namesOf = (r) => Array.from(r.addons.map((a) => a.name));

test('shortened names: JSON, CSV and TXT all apply the Shorten setting, HTML-report style (on by default)', () => {
  const expectShort = ['Buster', 'Plain Name', 'StayFree'];
  assert.deepStrictEqual(namesOf(sandbox.parseJsonPayload(sandbox.buildJsonExport(longNameAddons))).sort(), expectShort);
  assert.deepStrictEqual(namesOf(sandbox.parseCsvPayload(sandbox.buildCsvExport(longNameAddons))).sort(), expectShort);
  assert.deepStrictEqual(namesOf(sandbox.parseTxtPayload(sandbox.buildTxtExport(longNameAddons))).sort(), expectShort);
});

test('shortened names: turning the setting off keeps the full names in all three', () => {
  const full = longNameAddons.map((a) => a.name).sort();
  assert.deepStrictEqual(namesOf(sandbox.parseJsonPayload(sandbox.buildJsonExport(longNameAddons, false))).sort(), full);
  assert.deepStrictEqual(namesOf(sandbox.parseCsvPayload(sandbox.buildCsvExport(longNameAddons, false))).sort(), full);
  assert.deepStrictEqual(namesOf(sandbox.parseTxtPayload(sandbox.buildTxtExport(longNameAddons, false))).sort(), full);
});

test('ids: every format carries each add-on\'s id, shortened names or not', () => {
  for (const shorten of [true, false]) {
    const j = sandbox.parseJsonPayload(sandbox.buildJsonExport(longNameAddons, shorten));
    const c = sandbox.parseCsvPayload(sandbox.buildCsvExport(longNameAddons, shorten));
    const t = sandbox.parseTxtPayload(sandbox.buildTxtExport(longNameAddons, shorten));
    for (const r of [j, c, t]) {
      assert.deepStrictEqual(Array.from(r.addons.map((a) => a.id)).sort(), ['buster@x', 'plain@x', 'stayfree@x']);
    }
  }
});

test('TXT export: the id is the sixth column, after the link (the first five are unchanged)', () => {
  const rows = sandbox.buildTxtExport(longNameAddons).split('\r\n').filter((l) => l.includes(' | '));
  assert.strictEqual(rows.length, 3);
  for (const row of rows) {
    const parts = row.split(' | ').map((p) => p.trim());
    assert.strictEqual(parts.length, 6);
    assert.match(parts[4], /^https:\/\/example\.com\//);
    assert.match(parts[5], /@x$/);
  }
});

test('older TXT export (five columns, no id) still imports, with no id', () => {
  const old = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    '',
    'uBlock Origin | 1.60.0 | Extension | Enabled | https://example.com/ub',
    'Old Theme | 1.0 | Theme | Disabled | https://example.com/ot',
  ].join('\r\n');
  const r = sandbox.parseTxtPayload(old);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons.length, 2);
  assert.strictEqual(r.addons[0].name, 'uBlock Origin');
  assert.strictEqual(r.addons[0].id, undefined);
  assert.strictEqual(r.addons[1].type, 'theme');
});

test('older JSON export (no ids, full names) still imports', () => {
  const r = sandbox.parseJsonPayload(JSON.stringify({ formatVersion: EXPORT_FORMAT_VERSION, addons: [
    { name: 'Buster: Captcha Solver for Humans', version: '3.4.0', enabled: true, type: 'extension', link: 'https://example.com/b' },
  ] }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons[0].name, 'Buster: Captcha Solver for Humans');
  assert.strictEqual(r.addons[0].id, undefined);
});

test('older CSV export (the old column order, id first) still imports', () => {
  const csv = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    'id,name,version,enabled,type,link,linkType',
    'buster@x,Buster,3.4.0,true,extension,https://example.com/b,amo-exact',
  ].join('\r\n');
  const r = sandbox.parseCsvPayload(csv);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons[0].id, 'buster@x');
  assert.strictEqual(r.addons[0].name, 'Buster');
});

const installedFull = [
  { id: 'buster@x', name: 'Buster: Captcha Solver for Humans' },
  { id: 'stayfree@x', name: 'StayFree - Website Blocker, Web Analytics' },
  { id: 'plain@x', name: 'Plain Name' },
];

test('matching: the id wins, even when the file\'s name is shortened', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  const m = sandbox.findInstalledMatch({ id: 'buster@x', name: 'Buster' }, index);
  assert.strictEqual(m.id, 'buster@x');
});

test('matching: with an id that is not installed, it falls back to the name', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  assert.strictEqual(sandbox.findInstalledMatch({ id: 'other-id', name: 'Plain Name' }, index).id, 'plain@x');
  assert.strictEqual(sandbox.findInstalledMatch({ id: 'other-id', name: 'Buster' }, index).id, 'buster@x');
});

test('matching: no id - an exact full name, a shortened name, or a differently-shortened name all find the add-on', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'Buster: Captcha Solver for Humans' }, index).id, 'buster@x');
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'buster' }, index).id, 'buster@x');
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'StayFree' }, index).id, 'stayfree@x');
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'StayFree - something else' }, index).id, 'stayfree@x');
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'Plain Name' }, index).id, 'plain@x');
});

test('matching: a short name shared by two installed add-ons is ambiguous, so it matches neither', () => {
  const index = sandbox.buildInstalledIndex([
    { id: 'a@x', name: 'Dark: Reader' },
    { id: 'b@x', name: 'Dark - Mode' },
  ]);
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'Dark' }, index), null);
  assert.strictEqual(sandbox.findInstalledMatch({ id: 'b@x', name: 'Dark' }, index).id, 'b@x', 'the id still decides');
});

test('matching: an unknown add-on matches nothing', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  assert.strictEqual(sandbox.findInstalledMatch({ name: 'Something Else' }, index), null);
});

test('end to end: shortened exports in all three formats still match every installed add-on', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  const files = [
    sandbox.parseJsonPayload(sandbox.buildJsonExport(longNameAddons)),
    sandbox.parseCsvPayload(sandbox.buildCsvExport(longNameAddons)),
    sandbox.parseTxtPayload(sandbox.buildTxtExport(longNameAddons)),
  ];
  for (const r of files) {
    assert.strictEqual(r.ok, true);
    for (const item of r.addons) {
      const m = sandbox.findInstalledMatch(item, index);
      assert.ok(m && m.id === item.id, `${item.name} should match ${item.id}`);
    }
  }
});

test('end to end: an older shortened-name TXT with no ids still matches by name', () => {
  const index = sandbox.buildInstalledIndex(installedFull);
  const old = [`# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`, '', 'Buster | 3.4.0 | Extension | Enabled | https://example.com/b'].join('\r\n');
  const r = sandbox.parseTxtPayload(old);
  assert.strictEqual(sandbox.findInstalledMatch(r.addons[0], index).id, 'buster@x');
});
