// Tests for src/background/background.js. Loads the real source via vm
// with a mocked browser/fetch, so these run against the actual file and
// exercise its real registered message listener (not internal functions
// called directly in isolation).

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const backgroundSrc = readSrc('src/background/background.js');

// --- background.js: excludes Firefox for Android's own bundled components ---
// Android bundles several of its own WebExtension-based components
// (ads/icons/fxa/readerview/search telemetry) with ids ending in
// @mozac.org - these aren't anything the user installed and shouldn't
// show up as exportable, the same way desktop's @mozilla.org ones don't.

testAsync('listInstalledAddons: excludes both @mozilla.org and @mozac.org built-ins', async () => {
  const bgSandbox = {
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      management: {
        getAll: async () => [
          { id: 'ublock@example.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension' },
          { id: 'webcompat@mozilla.org', name: 'Web Compat', version: '1.0', enabled: true, type: 'extension' },
          { id: 'ads@mozac.org', name: 'Mozilla Android Components - Ads Telemetry', version: '1.0', enabled: true, type: 'extension' },
          { id: 'readerview@mozac.org', name: 'Mozilla Android Components - ReaderView', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const result = await bgSandbox.listInstalledAddons();
  assert.deepStrictEqual(Array.from(result, (a) => a.id), ['ublock@example.com']);
});

// --- background.js: export message handler, platform-specific saving ---
// Android's downloads.download() can't handle a blob: URL (Android's own
// DownloadManager only accepts http/https) and there's no saveAs dialog
// to fall back to either. The message handler now hands the report back
// to export.js on Android instead of saving it itself - see the comment
// there for why. Loads the real background.js via vm with a mocked
// browser/fetch, and invokes the actual registered message listener
// (not doExport() directly) so this covers the real platform branching.

async function captureExportMessageResult(platformOs) {
  let downloadOptions = null;
  const createdTabUrls = [];
  let messageListener = null;
  const bgSandbox = {
    URL,
    Blob,
    AbortController,
    // background.js schedules a 30s delay before revoking the blob URL
    // on desktop - firing immediately here avoids this test (and the
    // whole test run) actually waiting that long to exit, since Node
    // keeps the event loop alive for pending timers.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async (url) => {
      // Exact-id lookup: pretend it's not on AMO. Name search: no results.
      // Neither path matters for this test - only the final export step does.
      if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    },
    browser: {
      runtime: {
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        getPlatformInfo: async () => ({ os: platformOs }),
        getURL: (path) => `moz-extension://test-id/${path}`,
        sendMessage: async () => {},
      },
      management: {
        getAll: async () => [
          { id: 'ext1@example.com', name: 'Test Addon', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
      downloads: {
        download: async (options) => {
          downloadOptions = options;
          return 1;
        },
      },
      tabs: {
        create: async (options) => {
          createdTabUrls.push(options.url);
          return {};
        },
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const result = await messageListener({ type: 'export', ids: ['ext1@example.com'] });
  return { downloadOptions, createdTabUrls, result };
}

testAsync('export message: on Android, hands the report back instead of saving or opening any tab itself', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult('android');
  assert.strictEqual(downloadOptions, null);
  assert.strictEqual(createdTabUrls.length, 0);
  assert.match(result.html, /Test Addon/);
  assert.match(result.filename, /^Firefox-Addons \(.+\)\.html$/);
});

testAsync('export message: on desktop, downloads with saveAs, opens confirmation.html, and returns nothing', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult('win');
  assert.strictEqual(downloadOptions.saveAs, true);
  assert.match(downloadOptions.url, /^blob:/);
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html$/);
  assert.strictEqual(result, undefined);
});
