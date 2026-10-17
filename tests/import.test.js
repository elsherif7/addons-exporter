// Tests for src/import/import.js's file-parsing and validation pipeline.
// Loads the real source files via vm so these run against the actual
// files, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, evalInContext, makeFakeDom, readCommon, readReportBuilders, readImport, plain, stubDocument, makeSandbox, IMPORTER_ELEMENT_IDS, FIREFOX_SOURCE: SOURCE } = require('./helpers');

// import.js wires up DOM elements and event listeners at load time.
// stubDocument() exists purely to let the file load without throwing - none of
// the tests below trigger DOM rendering, file reading, or messaging, so a
// generic fake element for every id is enough.

const commonSrc = readCommon();
const reportTemplateSrc = readReportBuilders();
const importSrc = readImport();
const sandbox = makeSandbox({ URL, document: stubDocument() }, commonSrc, reportTemplateSrc, importSrc);

const {
  parseAddonsPayload,
  parseJsonPayload,
  parseCsvPayload,
  parseCsvRecords,
  buildInstalledIndex,
  findInstalledMatch,
  migrateAddonsData,
  buildCsvExport,
  validateSelectedFile,
} = sandbox;

// EXPORT_FORMAT_VERSION is declared with top-level `const` in core.js,
// so (unlike the function declarations above) it isn't copied onto the
// sandbox object - it only exists in the context's own lexical scope.
// Evaluate it there directly instead of destructuring it from sandbox.
const EXPORT_FORMAT_VERSION = evalInContext(sandbox, 'EXPORT_FORMAT_VERSION');
// The hand-built files in most tests below are format 1 (the add-ons only, no
// source): format 1 is still read, so its strict layout stays covered. Format 2,
// which adds the source, has its own tests at the end of this file.
const V1 = 1;

// --- parseAddonsPayload ---
// Validates the untrusted-file payload embedded in an exported report.

function payload(addons, formatVersion = V1) {
  return JSON.stringify({ formatVersion, addons });
}
// A format 2 file: the source (whose own first two fields are the format
// version and the file type), then the add-ons, with no top-level format
// version. SOURCE is the browser part, as getExportSource() returns it.
function payloadV2(addons, source = { formatVersion: 2, fileType: 'html', ...SOURCE }) {
  return JSON.stringify({ source, addons });
}

test('parseAddonsPayload: null jsonText (no embedded data element found)', () => {
  const result = parseAddonsPayload(null);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no embedded data found/);
});

test('parseAddonsPayload: an empty data element reads as a file with no add-ons, not as a JSON error', () => {
  const result = parseAddonsPayload('   ');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found in that file/);
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

// A complete entry, exactly as the exporter writes it (HTML report and JSON).
const entry = (o = {}) => ({ id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/x', linkType: 'amo-exact', ...o });
const entryRejects = (o, pattern) => {
  const result = parseAddonsPayload(payload([entry(), o]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, pattern);
};

test('parseAddonsPayload: one bad entry rejects the whole file, naming it', () => {
  entryRejects(entry({ name: '' }), /add-on 2: it has no name/);
  entryRejects(entry({ name: '   ' }), /no name/);
  entryRejects(entry({ name: 42 }), /no name/);
  entryRejects(entry({ id: '' }), /no id/);
  entryRejects(null, /not an object/);
  entryRejects('text', /not an object/);
});

test('parseAddonsPayload: every field must be present and of the right type', () => {
  for (const key of ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType']) {
    const e = entry();
    delete e[key];
    entryRejects(e, /fields are not exactly/);
  }
  entryRejects(entry({ id: 12345 }), /no id/);
  entryRejects(entry({ version: 5 }), /version is not text/);
  entryRejects(entry({ link: ['not', 'a', 'string'] }), /link is not text/);
  entryRejects(entry({ linkType: null }), /linkType is not text/);
  entryRejects(entry({ enabled: 'true' }), /enabled is not true or false/);
  entryRejects(entry({ type: 'Extension' }), /type is not extension or theme/);
});

test('parseAddonsPayload: a field the exporter does not write rejects the file', () => {
  entryRejects(entry({ extra: 'x' }), /fields are not exactly/);
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: V1, addons: [entry()], note: 'x' }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not exactly formatVersion, then addons/);
});

test('parseAddonsPayload: the fields must come in the order the HTML report writes them (id first)', () => {
  const reordered = { name: 'X', version: '1', type: 'extension', enabled: true, link: 'https://addons.mozilla.org/x', linkType: 'amo-exact', id: 'x@e' };
  const result = parseAddonsPayload(payload([reordered]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /exactly id, name, version, enabled, type, link, linkType, in that order/);
  assert.strictEqual(parseAddonsPayload(payload([entry()])).ok, true);
});

test('parseAddonsPayload: the top-level fields must be formatVersion, then addons', () => {
  const swapped = JSON.stringify({ addons: [entry()], formatVersion: V1 });
  assert.strictEqual(parseAddonsPayload(swapped).ok, false);
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

test('parseAddonsPayload: the newest supported format version succeeds, and so does the one before it', () => {
  assert.strictEqual(EXPORT_FORMAT_VERSION, 2);
  assert.strictEqual(parseAddonsPayload(payload([entry()], V1)).ok, true);
  assert.strictEqual(parseAddonsPayload(payloadV2([entry()])).ok, true);
});

test('parseAddonsPayload: valid file succeeds and returns the parsed addons', () => {
  const result = parseAddonsPayload(payload([entry()]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.deepStrictEqual(plain(result.addons[0]), entry());
});

// The HTML report from the version released on addons.mozilla.org, saved
// unchanged (tests/fixtures/amo-release.html). Its embedded data is read by
// the same strict check as everything else.
test('AMO release: the HTML report from the released version is read in full by the strict check', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'amo-release.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the embedded data is there');
  const result = parseAddonsPayload(m[1]);
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.addons.length, 15);
  assert.ok(result.addons.some((a) => a.id === 'addons-exporter@local' && a.name === 'Add-ons Exporter'));
  const theme = result.addons.find((a) => a.type === 'theme');
  assert.strictEqual(theme.enabled, false);
  assert.ok(result.addons.every((a) => a.id && a.link.startsWith('https://addons.mozilla.org/')));
});

// --- A6: a bare-array export (the shape that predates format 1) is turned away cleanly ---

test('parseAddonsPayload: a bare array is rejected as a file with no format version, not "No add-ons found"', () => {
  // A plain array with no formatVersion/addons wrapper at all. No released
  // export ever wrote that shape, so it is turned away here by the same strict
  // check as any other payload without a version.
  const result = parseAddonsPayload(JSON.stringify([
    { name: 'uBlock Origin', version: '1.58.0', enabled: true },
  ]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
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

test('parseAddonsPayload: an exact duplicate entry is de-duplicated', () => {
  const result = parseAddonsPayload(payload([entry(), entry()]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'the duplicate entry should not produce a second row');
});

test('parseAddonsPayload: two different add-ons are not treated as duplicates', () => {
  const result = parseAddonsPayload(payload([entry({ id: 'a@x', name: 'Alpha' }), entry({ id: 'b@x', name: 'Beta' })]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 2);
});

// --- migrateAddonsData ---

test('migrateAddonsData: currently a no-op, returns the list unchanged', () => {
  const list = [{ name: 'X' }];
  assert.strictEqual(migrateAddonsData(list, EXPORT_FORMAT_VERSION), list);
});

// (Format 2 only added the source around the add-ons, so the add-on entries
// still need no migration.)
// Deliberately hardcodes today's version number and today's no-op
// behavior, rather than reading EXPORT_FORMAT_VERSION dynamically like
// the test above. The moment someone bumps EXPORT_FORMAT_VERSION, this
// starts failing - that's the point. It's a tripwire: a format bump
// can't ship without someone consciously updating migrateAddonsData for
// the new shape and updating this test to match, instead of the bump
// quietly going out with the old no-op still in place.
test('migrateAddonsData: bumping the format version requires updating this test and migrateAddonsData', () => {
  assert.strictEqual(
    EXPORT_FORMAT_VERSION, 2,
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
    exportPickRow: { style: {}, addEventListener() {} },
    exportPick: { addEventListener() {}, setAttribute() {}, focus() {}, style: {}, textContent: '' },
    exportPickList: { style: {}, replaceChildren() {}, querySelectorAll: () => [] },
  };
  const sandbox = makeSandbox({
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
  }, commonSrc, importSrc);
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

function jsonFile(addons, formatVersion = V1) {
  return JSON.stringify({ formatVersion, addons });
}

const jsonEntry = { name: 'uBlock Origin', version: '1.58.0', type: 'extension', enabled: true, link: 'https://addons.mozilla.org/x', linkType: 'amo-exact', id: 'ext1@example.com' };

test('parseJsonPayload: valid JSON file succeeds and returns the parsed addons', () => {
  const result = parseJsonPayload(jsonFile([jsonEntry]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

test('parseJsonPayload: the fields must come in the JSON export\'s order (name first, id last), not the HTML report\'s', () => {
  const htmlOrder = { id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/x', linkType: 'amo-exact' };
  const result = parseJsonPayload(jsonFile([htmlOrder]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /exactly name, version, type, enabled, link, linkType, id, in that order/);
});

test('parseJsonPayload: the real JSON export is accepted, with and without shortened names', () => {
  for (const shorten of [true, false]) {
    const list = [{ id: 'b@x', name: 'Buster: Captcha Solver', version: '1', enabled: true, type: 'extension', link: 'https://example.com/b', linkType: 'amo-exact' },
      { id: 't@x', name: 'Night - Theme', version: '2', enabled: false, type: 'theme', link: 'https://example.com/t', linkType: 'homepage' }];
    assert.strictEqual(parseJsonPayload(sandbox.buildJsonExport(list, shorten)).ok, true);
  }
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

// --- parseCsvRecords ---

test('parseCsvRecords: plain, quoted (comma, doubled quote, line break) and empty fields', () => {
  const rows = parseCsvRecords('a,b,c\n"Hello, World","Say ""Hi""","two\nlines"\nx,,z');
  assert.deepStrictEqual(Array.from(rows, (r) => Array.from(r)), [
    ['a', 'b', 'c'],
    ['Hello, World', 'Say "Hi"', 'two\nlines'],
    ['x', '', 'z'],
  ]);
});

// --- parseCsvPayload ---
// The importer accepts exactly what buildCsvExport() writes and nothing else.

const CSV_HEAD = 'name,version,type,enabled,link,linkType,id';
const csvLines = (rows, formatVersion = V1, header = CSV_HEAD) =>
  [`# addons-hub-format-version: ${formatVersion}`, header, ...rows].join('\r\n');
const csvRow = (o = {}) => {
  const a = { name: 'uBlock Origin', version: '1.0', type: 'extension', enabled: 'true', link: 'https://x.com/', linkType: 'amo-exact', id: 'a@e.com', ...o };
  return [a.name, a.version, a.type, a.enabled, a.link, a.linkType, a.id].join(',');
};
const csvRejects = (text, pattern) => {
  const r = parseCsvPayload(text);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, pattern);
};

test('parseCsvPayload: a file the exporter wrote is read back, every field', () => {
  const result = parseCsvPayload(csvLines([csvRow(), csvRow({ name: 'Midnight', type: 'theme', enabled: 'false', id: 'b@e.com' })]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 2);
  assert.deepStrictEqual(plain(result.addons[0]),
    { name: 'uBlock Origin', version: '1.0', type: 'extension', enabled: true, link: 'https://x.com/', linkType: 'amo-exact', id: 'a@e.com' });
  assert.strictEqual(result.addons[1].type, 'theme');
  assert.strictEqual(result.addons[1].enabled, false);
});

test('parseCsvPayload: missing format-version comment is rejected', () => {
  csvRejects(`${CSV_HEAD}\n${csvRow()}`, /no format-version comment found/);
});

test('parseCsvPayload: the format-version comment must be exactly the exporter\'s (no padding commas, no extra spaces)', () => {
  csvRejects(`# addons-hub-format-version: ${V1},,,,,,\r\n${CSV_HEAD}\r\n${csvRow()}`, /no format-version comment found/);
  csvRejects(`#addons-hub-format-version: ${V1}\r\n${CSV_HEAD}\r\n${csvRow()}`, /no format-version comment found/);
});

test('parseCsvPayload: rejects a newer formatVersion', () => {
  csvRejects(csvLines([csvRow()], EXPORT_FORMAT_VERSION + 1), /newer version of Add-ons Exporter/);
});

test('parseCsvPayload: a format version below 1 is rejected as no usable version, in both header shapes', () => {
  csvRejects(csvLines([csvRow()], 0), /missing its export format version/);
  const zeroSource = [
    '# addons-hub-source-formatVersion: 0',
    '# addons-hub-source-fileType: csv',
    '# addons-hub-source-browser: Firefox',
    '# addons-hub-source-basedOn: Gecko',
    '# addons-hub-source-browserVersion: 128.0',
    '# addons-hub-source-extensionVersion: 1.2.0',
  ].join('\r\n');
  // Not "the file must start with the source comments": the comments are there,
  // the version in them is what cannot be used.
  csvRejects(`${zeroSource}\r\n${CSV_HEAD}\r\n${csvRow()}`, /missing its export format version/);
});

test('parseCsvPayload: the header must be exactly the exporter\'s: a different column order, a missing or an extra column is rejected', () => {
  csvRejects(csvLines([csvRow()], V1, 'id,name,version,enabled,type,link,linkType'), /header row must be/);
  csvRejects(csvLines([csvRow()], V1, 'name,version,type,enabled,link,linkType'), /header row must be/);
  csvRejects(csvLines([csvRow()], V1, CSV_HEAD + ',extra'), /header row must be/);
  csvRejects(csvLines([csvRow()], V1, 'Name,Version,Type,Enabled,Link,LinkType,Id'), /header row must be/);
});

test('parseCsvPayload: no data rows is rejected', () => {
  csvRejects(csvLines([]), /No add-ons found/);
});

test('parseCsvPayload: a row with too few or too many fields rejects the whole file, naming the row', () => {
  csvRejects(csvLines([csvRow(), 'Short,1.0,extension,true']), /row 2 has 4 fields instead of 7/);
  csvRejects(csvLines([csvRow() + ',extra']), /row 1 has 8 fields instead of 7/);
});

test('parseCsvPayload: a row with no name or no id rejects the whole file', () => {
  csvRejects(csvLines([csvRow({ name: '' })]), /row 1 has no name/);
  csvRejects(csvLines([csvRow({ id: '' })]), /row 1 has no id/);
});

test('parseCsvPayload: type must be extension or theme, enabled must be true or false (exactly, lower case)', () => {
  csvRejects(csvLines([csvRow({ type: 'Extension' })]), /unknown type/);
  csvRejects(csvLines([csvRow({ type: '' })]), /unknown type/);
  csvRejects(csvLines([csvRow({ enabled: 'TRUE' })]), /unknown enabled value/);
  csvRejects(csvLines([csvRow({ enabled: 'yes' })]), /unknown enabled value/);
});

test('parseCsvPayload: a blank line, including a trailing one, is rejected', () => {
  csvRejects(csvLines([csvRow(), '']), /row 2 has 1 fields instead of 7/);
  csvRejects(csvLines([csvRow(), '', csvRow({ id: 'b@e.com' })]), /row 2 has 1 fields/);
});

test('parseCsvPayload: CRLF or LF line endings are both read (a checkout may convert them)', () => {
  const result = parseCsvPayload(csvLines([csvRow()]).replace(/\r\n/g, '\n'));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
});

// --- whole-text CSV parsing (parseCsvRecords) ---

test('parseCsvPayload: text a CSV writer never produces is rejected, not repaired', () => {
  csvRejects(csvLines([csvRow({ name: '"abc"def' })]), /unexpected text after a closing quote/);
  csvRejects(csvLines([csvRow({ name: 'ab"c' })]), /quote inside an unquoted value/);
  csvRejects(csvLines([csvRow({ name: '"never closed' })]), /never closed/);
});

test('parseCsvPayload: a quoted field containing a real newline stays one field, not two rows', () => {
  const result = parseCsvPayload(csvLines([csvRow({ name: '"Line1\nLine2"' })]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'should be one add-on, not two');
  assert.strictEqual(result.addons[0].name, 'Line1\nLine2');
});

// --- stripping the formula-injection guard ---

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
  const result = parseCsvPayload(csvLines([csvRow({ name: `"'Twas Great"` })]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons[0].name, "'Twas Great");
});

test('buildCsvExport + parseCsvPayload: names starting with an apostrophe then a formula character round-trip exactly', () => {
  const names = ["'=x", "''=z", "'''-q", "'+1", "'-2", "'@y", "'\ttab", "'Twas", "=x", "plain"];
  const list = names.map((name, i) => ({ id: `n${i}@e.com`, name, version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }));
  const result = parseCsvPayload(buildCsvExport(list, false));
  assert.strictEqual(result.ok, true);
  // The export lists add-ons in reading order, so compare as sorted sets.
  assert.deepStrictEqual(Array.from(result.addons, (a) => a.name).sort(), [...names].sort());
});

// --- de-duplication ---

test('parseCsvPayload: an exact duplicate row is de-duplicated', () => {
  const row = csvRow({ name: 'Same', link: 'https://x.com/a' });
  const result = parseCsvPayload(csvLines([row, row]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1, 'the duplicate row should not produce a second entry');
});

// --- Real DOM: search and Select All against the actual rendered list ---
// Mirrors the equivalent block in export.test.js: renders import.js's
// real list (via setSelectedFile -> loadFile -> renderAddonList) against
// a real element tree with makeFakeDom, then drives the real
// searchInput/selectAllBtn handlers.

// Test fixtures name only what a test cares about; the rest is filled in so
// the file passes the importer's strict check, as a real export does.
const completeAddon = (a, i) => {
  const full = { id: `fixture-${i}@example.com`, version: '1.0', enabled: true, type: 'extension', link: `https://example.com/${i}`, linkType: 'amo-exact', ...a };
  // The JSON export's field order.
  return { name: full.name, version: full.version, type: full.type, enabled: full.enabled, link: full.link, linkType: full.linkType, id: full.id };
};
function jsonAddonsFile(addons, formatVersion = V1) {
  return { name: 'addons.json', text: async () => JSON.stringify({ formatVersion, addons: addons.map(completeAddon) }) };
}

async function renderRealImportList(addons, installed = []) {
  const { document, elements } = makeFakeDom(IMPORTER_ELEMENT_IDS);
  const sandbox = makeSandbox({
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
  }, commonSrc, importSrc);
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
  const { document, elements } = makeFakeDom(IMPORTER_ELEMENT_IDS);
  const sandbox = makeSandbox({
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
  }, commonSrc, importSrc);
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

testAsync('import.js: a selection nothing can be read from cancels a load still in flight', async () => {
  const { sandbox, elements } = bootImportSandbox();
  const slowFile = jsonAddonsFile([{ id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' }]);
  const realText = slowFile.text;
  slowFile.text = async () => { await sleep(30); return realText(); };

  sandbox.setSelectedFile(slowFile);
  await sleep(5); // in flight: past the start, not past the slow file.text()
  sandbox.setSelectedFile({ name: 'notes.pdf', size: 10 }); // nothing readable in it
  assert.match(elements.status.textContent, /isn't a supported file type/, 'the reason is shown at once');
  await sleep(50); // give the stale load plenty of time to (wrongly) finish

  assert.match(elements.status.textContent, /isn't a supported file type/, 'and it is what stands, not the stale load\'s own result');
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 0, 'the stale load rendered nothing');
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
  const { document, elements } = makeFakeDom(IMPORTER_ELEMENT_IDS);
  const listeners = [];
  const sandbox = makeSandbox({
    document,
    URL,
    browser: {
      runtime: { sendMessage: async (msg) => (msg.type === 'listAddons' ? [] : undefined), getURL: (p) => p },
      storage: { local: { get: async () => stored }, onChanged: { addListener: (fn) => listeners.push(fn) } },
      tabs: { create: async () => ({}) },
    },
  }, commonSrc, importSrc);
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
  const { document, elements } = makeFakeDom(IMPORTER_ELEMENT_IDS);
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
  const sandbox = makeSandbox({
    document,
    URL,
    matchMedia: () => ({ matches: reducedMotion }),
    browser: {
      runtime: { sendMessage: async (msg) => (msg.type === 'listAddons' ? [] : undefined), getURL: (p) => p },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { create: async () => ({}) },
    },
  }, commonSrc, importSrc);
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
  const slowFile = { name: 'slow.json', size: 10, text: () => new Promise((resolve) => { release = () => resolve(JSON.stringify({ formatVersion: 1, addons: [{ name: 'Late', version: '1', type: 'extension', enabled: true, link: 'https://example.com/z', linkType: 'amo-exact', id: 'z@x' }] })); }) };
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

// --- Reopening from the popup: the .zip picker closes, nothing else moves ---

testAsync('Importer: reopening from the popup closes the .zip picker and clears the search, keeping the file, the list and the ticks', async () => {
  const { document, elements } = makeFakeDom(IMPORTER_ELEMENT_IDS);
  const listeners = [];
  const timers = [];
  const sandbox = makeSandbox({
    document,
    URL,
    // replayStagedReveal clears the .revealing flag again on a timer; recording
    // it instead of scheduling one keeps the test from leaving a timer behind.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    browser: {
      runtime: {
        sendMessage: async (msg) => (msg.type === 'listAddons' ? [] : undefined),
        getURL: (p) => p,
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: { local: { get: async () => ({}), onChanged: { addListener() {} } } },
      tabs: { create: async () => ({}), getCurrent: async () => ({ id: 1, windowId: 1 }) },
    },
  }, commonSrc, importSrc);

  sandbox.setSelectedFile(jsonAddonsFile([
    { id: 'a@x', name: 'Alpha', version: '1.0', link: 'https://example.com/a' },
    { id: 'b@x', name: 'Beta', version: '2.0', link: 'https://example.com/b' },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  elements.deselectAllBtn.click();
  elements.selectAllBtn.click();
  assert.strictEqual(elements.selectionCount.textContent, '2 of 2 selected');

  sandbox.openExportPicker();
  assert.strictEqual(elements.exportPickList.style.display, 'block', 'the picker is open');

  elements.searchInput.value = 'zzz-nomatch';
  elements.searchInput.dispatchEvent('input');
  assert.ok(elements.addonList.querySelectorAll('.addon-row').every((r) => r.style.display === 'none'));
  assert.strictEqual(elements.noSearchMatches.style.display, 'block');

  listeners.forEach((fn) => fn({ type: 'whereIsPage', page: 'import' }));

  assert.strictEqual(elements.exportPickList.style.display, 'none', 'the picker panel is closed');
  assert.strictEqual(elements.exportPick.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(elements.searchInput.value, '', 'the search box is empty again');
  assert.strictEqual(elements.noSearchMatches.style.display, 'none', 'and its "no matches" note is gone');
  assert.ok(elements.addonList.querySelectorAll('.addon-row').every((r) => r.style.display !== 'none'),
    'every row is showing again');
  assert.strictEqual(elements.fileNameRow.style.display, 'flex', 'the chosen file is still there');
  assert.strictEqual(elements.chooseFileBtn.style.display, 'none', 'still replaced by its name');
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 2, 'its list is untouched');
  assert.strictEqual(elements.addonList.querySelectorAll('input[type="checkbox"]:checked').length, 2, 'and so are the ticks');
  assert.strictEqual(elements.selectionCount.textContent, '2 of 2 selected', 'the count still reads the same');
  assert.strictEqual(elements.addonList.classList.contains('revealing'), true, 'the rows are set to cascade again');
  assert.strictEqual(timers[0].ms, 850, 'and the flag comes off once the last row has wiped');
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
  assert.strictEqual(parsed.source.formatVersion, EXPORT_FORMAT_VERSION);
});

test('TXT export: a title, Enabled and Disabled sections, and lined-up columns', () => {
  const txt = sandbox.buildTxtExport(readableSample, false, SOURCE);
  const lines = txt.split('\r\n');
  assert.deepStrictEqual(lines.slice(0, 6), [
    '# addons-hub-source-formatVersion: 2',
    '# addons-hub-source-fileType: txt',
    '# addons-hub-source-browser: Firefox',
    '# addons-hub-source-basedOn: Gecko',
    '# addons-hub-source-browserVersion: 128.0',
    '# addons-hub-source-extensionVersion: 1.2.0',
  ]);
  assert.strictEqual(lines[7], 'Firefox Add-ons - 4 in total (2 enabled, 2 disabled)');
  assert.ok(lines.includes('Enabled (2)') && lines.includes('Disabled (2)'));
  const rows = lines.filter((l) => l.includes(' | '));
  assert.strictEqual(rows.length, 4);
  // every column starts at the same place on every line
  const firstBar = rows.map((l) => l.indexOf(' | '));
  assert.strictEqual(new Set(firstBar).size, 1);
  assert.ok(!/\r\n$/.test(txt), 'no blank line left at the end');
});

test('CSV export: begins with a byte-order mark, which the importer ignores (the TXT export has none)', () => {
  const csv = sandbox.buildCsvExport(readableSample, false);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  assert.strictEqual(sandbox.parseCsvPayload(csv).ok, true);
  assert.notStrictEqual(sandbox.buildTxtExport(readableSample, false).charCodeAt(0), 0xFEFF);
});

// --- shortened names and ids ---

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

test('TXT export: the link type is the sixth column and the id the seventh, after the link', () => {
  const rows = sandbox.buildTxtExport(longNameAddons).split('\r\n').filter((l) => l.includes(' | '));
  assert.strictEqual(rows.length, 3);
  for (const row of rows) {
    const parts = row.split(' | ').map((p) => p.trim());
    assert.strictEqual(parts.length, 7);
    assert.match(parts[4], /^https:\/\/example\.com\//);
    assert.match(parts[5], /^(amo-exact|amo-search|homepage|amo-search-fallback)$/);
    assert.match(parts[6], /@x$/);
  }
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


// --- TXT: names are restored exactly (escaping) ---

const exactNames = [
  'Plain Name',
  'Foo | Bar',
  '| Leading and trailing |',
  'Line\nBreak\r\nTool',
  'C:\\Tools\\new',
  'Ends with a backslash\\',
  'Backslash then pipe \\| and \\\\ and \\n written out',
  '  Padded on both sides  ',
  'Tab\tinside',
  '\ttab at the start',
  'Caf\u00E9 \u5E83\u544A - Pro: Edition, Plus',
];
const exactAddons = exactNames.map((name, i) => ({
  id: `exact${i}@example.com`, name, version: `${i}.0`, enabled: i % 2 === 0, type: i % 3 === 0 ? 'theme' : 'extension',
  link: `https://example.com/${i}`, linkType: 'homepage',
}));

test('TXT round trip: every awkward name comes back exactly, with its other fields, one add-on each', () => {
  const r = sandbox.parseTxtPayload(sandbox.buildTxtExport(exactAddons, false));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons.length, exactAddons.length, 'none lost, none split in two');
  for (const original of exactAddons) {
    const back = r.addons.find((a) => a.id === original.id);
    assert.ok(back, `${original.id} missing`);
    assert.strictEqual(back.name, original.name);
    assert.strictEqual(back.version, original.version);
    assert.strictEqual(back.link, original.link);
    assert.strictEqual(back.enabled, original.enabled);
    assert.strictEqual(back.type, original.type);
  }
});

test('TXT round trip: with Shorten names on, the shortened name is what comes back, escaped the same way', () => {
  const list = [{ id: 'sh@example.com', name: 'Foo | Bar \u2013 with a\nline break and \\ too', version: '1', enabled: true, type: 'extension', link: 'https://example.com/s', linkType: 'homepage' }];
  const r = sandbox.parseTxtPayload(sandbox.buildTxtExport(list, true));
  assert.strictEqual(r.addons[0].name, sandbox.shortName(list[0].name));
  assert.strictEqual(r.addons[0].name, 'Foo | Bar');
});

test('TXT round trip: links with spaces, pipes or line breaks come back as written', () => {
  const list = [{ id: 'l@example.com', name: 'L', version: '1', enabled: true, type: 'extension', link: 'https://example.com/a b | c\\d', linkType: 'homepage' }];
  const r = sandbox.parseTxtPayload(sandbox.buildTxtExport(list, false));
  assert.strictEqual(r.addons[0].link, 'https://example.com/a b | c\\d');
});

test('TXT round trip: those add-ons still match the installed ones by id', () => {
  const index = sandbox.buildInstalledIndex(exactAddons.map((a) => ({ id: a.id, name: a.name })));
  const r = sandbox.parseTxtPayload(sandbox.buildTxtExport(exactAddons, true));
  for (const item of r.addons) {
    const m = sandbox.findInstalledMatch(item, index);
    assert.ok(m && m.id === item.id, `${item.name} should match ${item.id}`);
  }
});

test('TXT round trip: with Shorten names off, the exact name also matches by name when the id is unknown', () => {
  const index = sandbox.buildInstalledIndex(exactAddons.map((a) => ({ id: 'other-' + a.id, name: a.name })));
  const r = sandbox.parseTxtPayload(sandbox.buildTxtExport(exactAddons, false));
  for (const item of r.addons) {
    const m = sandbox.findInstalledMatch(item, index);
    assert.ok(m && m.id === 'other-' + item.id, `${item.name} should match by name`);
  }
});

// --- TXT: only what buildTxtExport() writes is accepted ---

const txtLines = (lines, formatVersion = V1) => [`# addons-hub-format-version: ${formatVersion}`, '', ...lines].join('\r\n');
const txtLine = (o = {}) => {
  const a = { name: 'Dark Reader', version: '4.9', type: 'Extension', status: 'Enabled', link: 'https://example.com/d', id: 'dr@x', ...o };
  return [a.name, a.version, a.type, a.status, a.link, a.id].join(' | ');
};
const txtRejects = (text, pattern) => {
  const r = sandbox.parseTxtPayload(text);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, pattern);
};

test('TXT strict: a line with the id missing (five columns) rejects the whole file, naming the line', () => {
  txtRejects(txtLines([txtLine(), 'Midnight | 1.0 | Theme | Disabled | https://example.com/m']), /line 4 has 5 columns instead of 6/);
});

test('TXT strict: more than six columns rejects the file', () => {
  txtRejects(txtLines([txtLine() + ' | extra']), /line 3 has 7 columns instead of 6/);
});

test('TXT strict: type must be Extension or Theme and status Enabled or Disabled, exactly', () => {
  txtRejects(txtLines([txtLine({ type: 'extension' })]), /unknown type/);
  txtRejects(txtLines([txtLine({ type: 'Addon' })]), /unknown type/);
  txtRejects(txtLines([txtLine({ status: 'enabled' })]), /unknown status/);
  txtRejects(txtLines([txtLine({ status: '' })]), /unknown status/);
});

test('TXT strict: no name or no id rejects the file', () => {
  txtRejects(txtLines([txtLine({ name: '' })]), /no name/);
  txtRejects(txtLines([txtLine({ name: '   ' })]), /no name/);
  txtRejects(txtLines([txtLine({ id: '' })]), /no id/);
});

test('TXT strict: a backslash that is not one of the exporter\'s escapes rejects the file', () => {
  txtRejects(txtLines([txtLine({ name: 'C:\\Tools' })]), /backslash that is not an escape/);
  txtRejects(txtLines([txtLine({ name: 'Ends with one\\' })]), /backslash that is not an escape/);
});

test('TXT strict: an unescaped pipe inside a column cannot be mistaken for a name; a bare pipe with no spaces stays text', () => {
  // "A|B" has no " | ", so it is part of the name only if the exporter left it
  // unescaped - it never does, but nothing here splits on it either.
  txtRejects(txtLines([txtLine({ name: 'A | B' })]), /7 columns/);
});

test('TXT strict: the format-version comment must be exactly the first line, and a byte-order mark is not accepted', () => {
  txtRejects('\uFEFF' + txtLines([txtLine()]), /no format-version comment found/);
  txtRejects(`#addons-hub-format-version: ${V1}\r\n${txtLine()}`, /no format-version comment found/);
  txtRejects(`\r\n# addons-hub-format-version: ${V1}\r\n${txtLine()}`, /no format-version comment found/);
});

test('TXT strict: a format version below 1 is rejected as no usable version', () => {
  txtRejects(txtLines([txtLine()], 0), /missing its export format version/);
});

test('TXT strict: title, section headings and blank lines (no " | " in them) are skipped, as the exporter writes them', () => {
  const r = sandbox.parseTxtPayload(txtLines(['Firefox Add-ons - 1 in total (1 enabled, 0 disabled)', '', 'Enabled (1)', '-----------', txtLine(), '']));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons.length, 1);
  assert.strictEqual(r.addons[0].id, 'dr@x');
});

test('TXT strict: a file with headings only is "No add-ons found"', () => {
  txtRejects(txtLines(['Firefox Add-ons - 0 in total (0 enabled, 0 disabled)']), /No add-ons found/);
});

testAsync('openSelectedBtn: uses the count background.js says it queued - tabs it did not take count as failed, not opened', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/', 'https://addons.mozilla.org/d/']);
  const ctx = captureBulkSelectHandlers(boxes);
  vm.runInContext(itemsJs, ctx.sandbox);
  ctx.sandbox.browser.runtime.sendMessage = async () => ({ queued: 1 }); // 3 handed over, 1 taken
  await ctx.openSelectedHandler();
  assert.strictEqual(ctx.statusEl.textContent, 'Opened 2 tabs, 2 failed to open');
  assert.deepStrictEqual(ctx.navigatedUrls, ['moz-extension://test-id/src/confirmation/confirmation.html?from=import&failed=2']);
});

testAsync('openSelectedBtn: a reply without a count (older background) is treated as everything queued', async () => {
  const { boxes, itemsJs } = selectItems(['https://addons.mozilla.org/a/', 'https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/']);
  const ctx = captureBulkSelectHandlers(boxes);
  vm.runInContext(itemsJs, ctx.sandbox);
  ctx.sandbox.browser.runtime.sendMessage = async () => undefined;
  await ctx.openSelectedHandler();
  assert.strictEqual(ctx.statusEl.textContent, 'Opened 3 tabs');
});
