// Tests for src/export/export.js's click handler.
// On desktop, background.js already saves the file and opens
// confirmation.html itself, so export.js's handler does nothing beyond
// showing status text. On Android, background.js hands the report back
// instead (see background.test.js), and export.js must trigger the
// actual save right here, synchronously within this same click - not
// after another message hop - for it to have a chance of being treated
// as a real user-triggered download. Loads the real export.js via vm
// with a mocked browser/DOM, and invokes its actual exportBtn click
// handler.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc } = require('./helpers');

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
    exportDesc: { innerHTML: '' },
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
  return { sentMessages, appendedLinks, createdTabUrls, statusEl: elements.status, exportBtnEl: elements.exportSelectedBtn };
}

testAsync('export.js click handler: on Android, proceeds to confirmation.html once downloads.onCreated fires', async () => {
  const { sentMessages, appendedLinks, createdTabUrls, exportBtnEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox-Addons (test).html' },
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
  assert.strictEqual(appendedLinks[0].download, 'Firefox-Addons (test).html');
  assert.strictEqual(appendedLinks[0].clicked, true);
  assert.strictEqual(appendedLinks[0].removed, true);
  // Both onCreated and the (immediate, mocked) fallback timer fire here -
  // the "settled" guard in export.js should mean only one tab opens.
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html\?from=export&format=html$/);
});

testAsync('export.js click handler: on Android, still proceeds via the fallback timer if onCreated never fires', async () => {
  const { createdTabUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox-Addons (test).html' },
    simulateDownloadCreated: false,
  });
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html\?from=export&format=html$/);
});

testAsync('export.js click handler: on desktop, does nothing extra since background.js already handled it', async () => {
  const { appendedLinks, createdTabUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: undefined,
  });
  assert.strictEqual(appendedLinks.length, 0);
  assert.strictEqual(createdTabUrls.length, 0);
});
