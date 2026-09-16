// Tests for src/background/background.js. Loads the real source via vm
// with a mocked browser/fetch, so these run against the actual file and
// exercise its real registered message listener (not internal functions
// called directly in isolation).

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const reportTemplateSrc = readSrc('src/background/report-template.js');
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
  vm.runInContext(reportTemplateSrc, bgSandbox);
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
  vm.runInContext(reportTemplateSrc, bgSandbox);
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

// --- background.js: doExport()'s link-resolution branching ---
// findAmoPage() tries an exact AMO lookup first, then a fuzzy name
// search; doExport() then falls back to the add-on's own homepage, and
// finally to a raw AMO search-results URL, if neither AMO path found
// anything. Calls doExport() directly (same pattern as
// listInstalledAddons() above) since the branching under test lives
// there and in findAmoPage() itself, not in the message listener's
// platform switch that the tests above already cover.

const baseAddon = { id: 'ext1@example.com', name: 'Test Addon', version: '1.0', enabled: true, type: 'extension' };

async function runDoExportWithFetch(addon, fetchImpl) {
  const bgSandbox = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: fetchImpl,
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => [addon] },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const { html } = await bgSandbox.doExport([addon.id]);
  const dataMatch = html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/);
  return JSON.parse(dataMatch[1]).addons[0];
}

testAsync('doExport: uses the exact AMO match when found', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) {
      return { ok: true, status: 200, json: async () => ({ url: 'https://addons.mozilla.org/en-US/firefox/addon/exact-match/' }) };
    }
    throw new Error('should not reach name search when the exact lookup already succeeded');
  };
  const result = await runDoExportWithFetch(baseAddon, fetchImpl);
  assert.strictEqual(result.linkType, 'amo-exact');
  assert.strictEqual(result.link, 'https://addons.mozilla.org/en-US/firefox/addon/exact-match/');
});

testAsync('doExport: falls back to a name search match when the exact lookup 404s', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [{ url: 'https://addons.mozilla.org/en-US/firefox/addon/test-addon/', name: { 'en-US': 'Test Addon' } }] }),
    };
  };
  const result = await runDoExportWithFetch(baseAddon, fetchImpl);
  assert.strictEqual(result.linkType, 'amo-search');
  assert.strictEqual(result.link, 'https://addons.mozilla.org/en-US/firefox/addon/test-addon/');
});

testAsync('doExport: falls back to the add-on\'s homepage when neither AMO path finds anything', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const addon = { ...baseAddon, homepageUrl: 'https://example.com/test-addon' };
  const result = await runDoExportWithFetch(addon, fetchImpl);
  assert.strictEqual(result.linkType, 'homepage');
  assert.strictEqual(result.link, 'https://example.com/test-addon');
});

testAsync('doExport: falls back to an AMO search-results URL when there\'s no AMO match and no homepage', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const result = await runDoExportWithFetch(baseAddon, fetchImpl);
  assert.strictEqual(result.linkType, 'amo-search-fallback');
  assert.strictEqual(result.link, `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(baseAddon.name)}`);
});

testAsync('doExport: an unsafe homepage URL is rejected in favor of the search-results fallback', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const addon = { ...baseAddon, homepageUrl: 'javascript:alert(1)' };
  const result = await runDoExportWithFetch(addon, fetchImpl);
  assert.strictEqual(result.linkType, 'amo-search-fallback');
});

// --- background.js: mapWithConcurrency()'s concurrency cap ---
// AMO_LOOKUP_CONCURRENCY caps how many lookups run at once so a big
// add-on collection doesn't trip AMO's rate limiting. Calls
// mapWithConcurrency() directly with a tracking fn instead of going
// through findAmoPage()/fetch, since the cap itself is what's under test
// here, not the AMO lookup logic already covered above.

testAsync('mapWithConcurrency: never runs more than `limit` calls at once', async () => {
  const bgSandbox = {
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: { runtime: { onMessage: { addListener() {} } } },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);

  let current = 0;
  let maxConcurrent = 0;
  const fn = async () => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise((resolve) => setTimeout(resolve, 5));
    current--;
    return true;
  };

  const items = Array.from({ length: 12 }, (_, i) => i);
  await bgSandbox.mapWithConcurrency(items, 5, fn);

  assert.ok(maxConcurrent <= 5, `expected at most 5 concurrent calls, saw ${maxConcurrent}`);
  assert.strictEqual(maxConcurrent, 5, 'expected concurrency to actually reach the cap with 12 items and a limit of 5');
});
