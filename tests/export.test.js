// Tests for src/export/export.js's click handler.
// On desktop, background.js already saves the file, so export.js's
// handler just replaces its own page with confirmation.html (same tab,
// no second tab). On Android, background.js hands the report back
// instead (see background.test.js), and export.js must trigger the
// actual save right here, synchronously within this same click - not
// after another message hop - for it to have a chance of being treated
// as a real user-triggered download. Loads the real export.js via vm
// with a mocked browser/DOM, and invokes its actual exportBtn click
// handler.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, makeFakeDom } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const exportSrc = readSrc('src/export/export.js');

async function captureExportClick({ selectedIds, exportResponse, simulateDownloadCreated = false }) {
  const checkedCheckboxes = selectedIds.map((id) => ({ dataset: { id } }));
  const listElStub = {
    querySelectorAll: (sel) => (sel.includes('checkbox') ? checkedCheckboxes : []),
    addEventListener() {},
    replaceChildren() {},
  };
  let exportClickHandler = null;
  const appendedLinks = [];
  const bodyStub = { appendChild: (el) => appendedLinks.push(el) };
  const createdTabUrls = [];
  const navigatedUrls = [];
  const sentMessages = [];
  const elements = {
    addonList: listElStub,
    selectAllBtn: { addEventListener() {} },
    deselectAllBtn: { addEventListener() {} },
    exportSelectedBtn: {
      addEventListener: (ev, fn) => { if (ev === 'click') exportClickHandler = fn; },
      disabled: false,
    },
    status: { textContent: '' },
    selectionCount: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
    exportDesc: { innerHTML: '', textContent: '', append() {} },
  };
  const exSandbox = {
    URL: { createObjectURL: () => 'blob:fake-url', revokeObjectURL() {} },
    Blob: function Blob(parts, opts) { this.parts = parts; this.opts = opts; },
    // export.js's fallback timer fires immediately here, keeping the
    // test fast. When simulateDownloadCreated is true, the
    // downloads.onCreated stub below fires first anyway (synchronously,
    // before this fallback even runs), so the "settled" guard in
    // export.js means only one path actually resolves things either way.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    // export.js finishes by replacing its own page with confirmation.html
    location: { replace: (url) => navigatedUrls.push(url) },
    document: {
      getElementById: (id) => elements[id],
      body: bodyStub,
      createElement: () => ({ style: {}, click() { this.clicked = true; }, remove() { this.removed = true; } }),
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          if (msg.type === 'listAddons') return [];
          if (msg.type === 'export') return exportResponse;
          return undefined;
        },
        getURL: (path) => `moz-extension://test-id/${path}`,
      },
      tabs: { create: async (options) => { createdTabUrls.push(options.url); return {}; } },
      storage: { local: { get: async () => ({}) } },
      downloads: {
        onCreated: {
          // Simulates the download actually being observed - fires
          // synchronously at registration time, same as a very fast
          // real download would resolve things before the fallback
          // timer got a chance to.
          addListener: (fn) => { if (simulateDownloadCreated) fn({}); },
          removeListener() {},
        },
      },
    },
  };
  vm.createContext(exSandbox);
  vm.runInContext(commonSrc, exSandbox);
  vm.runInContext(exportSrc, exSandbox);
  // Let the top-level IIFE's listAddons call settle before the button
  // even exists to be clicked.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await exportClickHandler();
  return { sentMessages, appendedLinks, createdTabUrls, navigatedUrls, statusEl: elements.status, exportBtnEl: elements.exportSelectedBtn };
}

testAsync('export.js click handler: on Android, proceeds to confirmation.html once downloads.onCreated fires', async () => {
  const { sentMessages, appendedLinks, createdTabUrls, navigatedUrls, exportBtnEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox Add-ons (test).html' },
    simulateDownloadCreated: true,
  });
  const exportMsg = sentMessages.find((m) => m.type === 'export');
  // Array.from (called in this realm) normalizes the foreign-realm array
  // that comes back from the vm sandbox, so deepStrictEqual can compare
  // it against a plain literal instead of tripping over cross-realm
  // Array identity.
  assert.deepStrictEqual(Array.from(exportMsg.ids), ['ext1@example.com']);
  assert.strictEqual(appendedLinks.length, 1);
  assert.strictEqual(appendedLinks[0].href, 'blob:fake-url');
  assert.strictEqual(appendedLinks[0].download, 'Firefox Add-ons (test).html');
  assert.strictEqual(appendedLinks[0].clicked, true);
  assert.strictEqual(appendedLinks[0].removed, true);
  // Both onCreated and the (immediate, mocked) fallback timer fire here -
  // the "settled" guard in export.js should mean the page only navigates
  // once - and in place, never by opening another tab.
  assert.strictEqual(createdTabUrls.length, 0);
  assert.strictEqual(navigatedUrls.length, 1);
  assert.strictEqual(navigatedUrls[0], 'moz-extension://test-id/src/confirmation/confirmation.html?from=export&format=html');
});

testAsync('export.js click handler: on Android, still proceeds via the fallback timer if onCreated never fires', async () => {
  const { navigatedUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox Add-ons (test).html' },
    simulateDownloadCreated: false,
  });
  assert.strictEqual(navigatedUrls.length, 1);
  assert.match(navigatedUrls[0], /confirmation\.html\?from=export&format=html$/);
});

testAsync('export.js click handler: on desktop, saves nothing itself and replaces its page with confirmation.html', async () => {
  const { appendedLinks, createdTabUrls, navigatedUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { format: 'html', stats: { total: 1, lookupFailures: 0 } },
  });
  assert.strictEqual(appendedLinks.length, 0);
  assert.strictEqual(createdTabUrls.length, 0, 'no second tab');
  assert.deepStrictEqual(navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=export&format=html',
  ]);
});

testAsync('export.js click handler: on desktop, the confirmation URL carries the format that was exported', async () => {
  for (const format of ['json', 'csv']) {
    const { navigatedUrls } = await captureExportClick({
      selectedIds: ['ext1@example.com'],
      exportResponse: { format, stats: { total: 1, lookupFailures: 0 } },
    });
    assert.match(navigatedUrls[0], new RegExp(`confirmation\\.html\\?from=export&format=${format}$`));
  }
});

// --- A14: desktop success re-enables the button and names the format ---

testAsync('export.js click handler: re-enables Export Selected after a successful desktop export', async () => {
  const { exportBtnEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { format: 'html', stats: { total: 1, lookupFailures: 0 } },
  });
  assert.strictEqual(exportBtnEl.disabled, false, 'the button should not stay stuck disabled after success');
});

testAsync('export.js click handler: success message names a non-HTML format', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { format: 'json', stats: { total: 1, lookupFailures: 0 } },
  });
  assert.match(statusEl.textContent, /JSON file/);
  assert.doesNotMatch(statusEl.textContent, /report/);
});

testAsync('export.js click handler: success message reports lookup failures when there were any', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { format: 'html', stats: { total: 2, lookupFailures: 1 } },
  });
  assert.match(statusEl.textContent, /1 of 2 add\u2011ons couldn\u2019t be looked up on AMO/);
});

testAsync('export.js click handler: no lookup-failure mention when there weren\'t any', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { format: 'html', stats: { total: 1, lookupFailures: 0 } },
  });
  assert.doesNotMatch(statusEl.textContent, /couldn't be looked up/);
});

// --- 4.3: stats breakdown in the success message ---

testAsync('export.js success message: shows "all found on AMO" when all are exact/search matches', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { format: 'html', stats: { total: 2, amoExact: 1, amoSearch: 1, homepage: 0, searchFallback: 0, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /All 2 add\u2011ons found on AMO/);
});

testAsync('export.js success message: shows mixed breakdown when some are AMO and some are fallback', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com', 'ext3@example.com'],
    exportResponse: { format: 'html', stats: { total: 3, amoExact: 2, amoSearch: 0, homepage: 1, searchFallback: 0, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /2 found on AMO, 1 got a fallback link/);
});

testAsync('export.js success message: shows fallback-only message when AMO found nothing', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { format: 'html', stats: { total: 1, amoExact: 0, amoSearch: 0, homepage: 0, searchFallback: 1, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /1 add\u2011on got a fallback link \(AMO had no match\)/);
});

testAsync('export.js success message: shows skipped-lookups note when deadline was hit', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { format: 'html', stats: { total: 2, amoExact: 1, amoSearch: 0, homepage: 0, searchFallback: 1, lookupFailures: 0, lookupsSkipped: 1 } },
  });
  assert.match(statusEl.textContent, /1 add\u2011on skipped AMO \(deadline reached\)/);
});

// --- A16: a non-array listAddons response shows a friendly message ---

testAsync('export.js: a non-array listAddons response shows a friendly error, not a raw exception', async () => {
  const listElStub = { replaceChildren: (...nodes) => { listElStub.children = nodes; }, addEventListener() {} };
  const elements = {
    addonList: listElStub,
    selectAllBtn: { addEventListener() {} },
    deselectAllBtn: { addEventListener() {} },
    exportSelectedBtn: { addEventListener() {}, disabled: false },
    status: { textContent: '' },
    selectionCount: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
    exportDesc: { innerHTML: '', textContent: '', append() {} },
  };
  const exSandbox = {
    URL,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({ className: '', textContent: '' }),
    },
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => undefined },
      storage: { local: { get: async () => ({}) } },
    },
  };
  vm.createContext(exSandbox);
  vm.runInContext(commonSrc, exSandbox);
  vm.runInContext(exportSrc, exSandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(listElStub.children.length, 1);
  assert.strictEqual(listElStub.children[0].className, 'placeholder-text error');
  assert.doesNotMatch(listElStub.children[0].textContent, /Cannot read propert/,
    'should be a plain, friendly message - not a raw JS TypeError');
});

// --- Real DOM: search and Select All against the actual rendered list ---
// Runs export.js's real top-level bootstrap (listAddons -> renderList())
// against a real element tree via makeFakeDom, then drives the real
// searchInput/selectAllBtn handlers - the same regression the A1 fix
// targets, but through actual rendering rather than a hand-built fixture.

async function renderRealExportList(addons) {
  const { document, elements } = makeFakeDom([
    'addonList', 'selectAllBtn', 'deselectAllBtn', 'exportSelectedBtn',
    'status', 'selectionCount', 'searchInput', 'noSearchMatches', 'exportDesc',
  ]);
  const sandbox = {
    document,
    URL,
    browser: {
      runtime: {
        sendMessage: async (msg) => (msg.type === 'listAddons' ? addons : undefined),
        onMessage: { addListener() {} },
        getURL: (p) => p,
      },
      storage: { local: { get: async () => ({}) } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(exportSrc, sandbox);
  // Let the top-level IIFE's listAddons() message and renderList() settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return elements;
}

testAsync('export.js real DOM: search hides non-matching rows and their group', async () => {
  const elements = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ]);
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  const shown = rows.filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.addon-name').textContent);
  assert.deepStrictEqual(shown, ['Alpha'], 'only the matching row should stay visible');
  assert.strictEqual(elements.noSearchMatches.style.display, 'none');
});

testAsync('export.js real DOM: a query matching nothing shows the "no matches" message and hides every row', async () => {
  const elements = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
  ]);
  elements.searchInput.value = 'zzz-nomatch';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  assert.ok(rows.every((r) => r.style.display === 'none'));
  assert.strictEqual(elements.noSearchMatches.style.display, 'block');
});

testAsync('export.js real DOM: Select All while a search is active only checks the visible row', async () => {
  const elements = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ]);
  elements.deselectAllBtn.click(); // rows are checked by default on render - start from a known state
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');
  elements.selectAllBtn.click();

  const checked = elements.addonList.querySelectorAll('input[type="checkbox"]:checked');
  assert.strictEqual(checked.length, 1, 'Select All should only check the row the active search still shows');
  assert.strictEqual(elements.selectionCount.textContent, '1 of 2 selected');
});

// --- A33: cross-tab export-format sync via storage.onChanged ---

testAsync('storage.onChanged: an export-format change from another tab refreshes the description', async () => {
  let registeredListener = null;
  let getCallCount = 0;
  const { document, elements } = makeFakeDom([
    'addonList', 'selectAllBtn', 'deselectAllBtn', 'exportSelectedBtn',
    'status', 'selectionCount', 'searchInput', 'noSearchMatches', 'exportDesc',
  ]);
  const sandbox = {
    document,
    URL,
    browser: {
      runtime: { sendMessage: async () => [], onMessage: { addListener() {} }, getURL: (p) => p },
      storage: {
        local: {
          get: async () => {
            getCallCount++;
            // Simulates the value having actually changed in storage by
            // the time the listener re-reads it - the first read (this
            // page's own initial load) still sees the old default.
            return getCallCount === 1 ? {} : { exportFormat: 'json' };
          },
        },
        onChanged: { addListener: (fn) => { registeredListener = fn; } },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(exportSrc, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(registeredListener, 'a storage.onChanged listener should have been registered');
  assert.doesNotMatch(elements.exportDesc.textContent, /JSON file/);

  registeredListener({ exportFormat: { newValue: 'json' } }, 'local');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(elements.exportDesc.textContent, /JSON file/);
});

// --- A32/A21: the AMO link is a name search, and lives outside the label ---

testAsync('export.js real DOM: the AMO link searches by name (not a guessed id URL) and sits outside the label', async () => {
  const elements = await renderRealExportList([
    { id: 'weird@id.example', name: 'Some Theme', version: '1.0', enabled: true, type: 'theme' },
  ]);
  const row = elements.addonList.querySelector('.addon-row');
  const link = row.querySelector('a.match-label');
  assert.ok(link, 'the row should have a match-label link');
  assert.strictEqual(link.textContent, 'AMO');
  assert.match(link.href, /\/search\/\?q=Some(%20|\+)Theme/, 'should search by name, not guess an exact-id URL');
  assert.doesNotMatch(link.href, /weird%40id\.example/, 'should not use the add-on id as a guessed URL');

  const label = row.querySelector('label');
  assert.strictEqual(label.contains(link), false, 'the link must not be inside the label (it would be absorbed into the checkbox\'s accessible name)');
});
