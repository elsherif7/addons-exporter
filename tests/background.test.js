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

async function captureExportMessageResult(platformOs, storageLocalGetImpl) {
  const defaultStorage = async () => ({});
  const storageGet = storageLocalGetImpl || defaultStorage;
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
      storage: { local: { get: storageGet } },
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
  assert.match(result.filename, /^Firefox Add-ons \(.+\)\.html$/);
});

testAsync('export message: on desktop, downloads with saveAs, opens no tab itself, and returns {format, stats}', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult('win');
  assert.strictEqual(downloadOptions.saveAs, true);
  assert.match(downloadOptions.url, /^blob:/);
  // export.js replaces its own page with the confirmation page instead.
  assert.strictEqual(createdTabUrls.length, 0);
  assert.strictEqual(result.format, 'html');
  assert.strictEqual(result.stats.total, 1);
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

async function runDoExportWithOptions(addons, fetchImpl, options) {
  const bgSandbox = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: fetchImpl,
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => addons },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  return bgSandbox.doExport(addons.map((a) => a.id), options);
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

testAsync('doExport: past its lookup deadline, stops trying AMO and falls back for what\'s left', async () => {
  let fetchCallCount = 0;
  const fetchImpl = async () => {
    fetchCallCount++;
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const addons = [
    { id: 'a@x', name: 'Addon A', version: '1', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Addon B', version: '1', enabled: true, type: 'extension' },
  ];
  // deadlineMs: -1 means "already past the deadline" from the very first
  // item - simulates a big export that's been running a while, without
  // an actual 90-second wait in the test.
  const result = await runDoExportWithOptions(addons, fetchImpl, { deadlineMs: -1 });
  assert.strictEqual(fetchCallCount, 0, 'no AMO lookups should have been attempted at all');
  assert.strictEqual(result.stats.lookupsSkipped, 2);
  assert.strictEqual(result.stats.searchFallback, 2);
});

testAsync('doExport: stops attempting AMO lookups after enough consecutive failures', async () => {
  let fetchCallCount = 0;
  const fetchImpl = async () => { fetchCallCount++; throw new Error('network down'); };
  const addons = Array.from({ length: 6 }, (_, i) => (
    { id: `a${i}@x`, name: `Addon ${i}`, version: '1', enabled: true, type: 'extension' }
  ));
  const result = await runDoExportWithOptions(addons, fetchImpl, { maxConsecutiveFailures: 2 });
  assert.ok(result.stats.lookupsSkipped > 0, 'later add-ons should have skipped the lookup once the breaker tripped');
  // Each attempted lookup makes up to 2 fetch calls (exact + search); with
  // the breaker capped at 2 consecutive failures out of 6 add-ons, far
  // fewer than 12 calls should have actually gone out.
  assert.ok(fetchCallCount < 12, `expected the breaker to cut lookups short, got ${fetchCallCount} fetch calls`);
});

testAsync('doExport: stats reflect a mix of exact, homepage, and fallback outcomes', async () => {
  const addons = [
    { id: 'exact@x', name: 'Exact Match', version: '1', enabled: true, type: 'extension' },
    { id: 'home@x', name: 'Homepage Only', version: '1', enabled: true, type: 'extension', homepageUrl: 'https://example.com/home' },
    { id: 'none@x', name: 'No Match At All', version: '1', enabled: true, type: 'extension' },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('exact%40x')) return { ok: true, status: 200, json: async () => ({ url: 'https://addons.mozilla.org/en-US/firefox/addon/exact/' }) };
    if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const result = await runDoExportWithOptions(addons, fetchImpl, {});
  assert.strictEqual(result.stats.total, 3);
  assert.strictEqual(result.stats.amoExact, 1);
  assert.strictEqual(result.stats.homepage, 1);
  assert.strictEqual(result.stats.searchFallback, 1);
  assert.strictEqual(result.stats.lookupFailures, 0);
});

// --- doExport()'s theme-reading behavior ---
// The report should start in whatever theme is currently stored, so a
// dark-mode user gets a dark-mode report by default. Separate harness
// from runDoExportWithFetch above since its return shape (the parsed
// addon data) is already relied on by every test above this point -
// this one needs the raw html string instead, to check <html data-theme>.

async function runDoExportForTheme(storageLocalGetImpl) {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: true, status: 200, json: async () => ({ url: 'https://addons.mozilla.org/en-US/firefox/addon/exact-match/' }) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const bgSandbox = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: fetchImpl,
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => [baseAddon] },
      storage: { local: { get: storageLocalGetImpl } },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const { html } = await bgSandbox.doExport([baseAddon.id]);
  return html;
}

testAsync('doExport: bakes the stored dark theme into the report', async () => {
  const html = await runDoExportForTheme(async () => ({ theme: 'dark' }));
  assert.match(html, /<html lang="en" data-theme="dark">/);
});

testAsync('doExport: defaults to light when no theme is stored', async () => {
  const html = await runDoExportForTheme(async () => ({}));
  assert.match(html, /<html lang="en" data-theme="light">/);
});

testAsync('doExport: falls back to light if storage.local.get throws', async () => {
  const html = await runDoExportForTheme(async () => { throw new Error('storage unavailable'); });
  assert.match(html, /<html lang="en" data-theme="light">/);
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

// --- doExport()'s export-format dispatch ---
// doExport() reads EXPORT_FORMAT_STORAGE_KEY from storage and calls the
// matching builder. Separate harness from runDoExportWithFetch/
// runDoExportForTheme since those already rely on their specific return
// shapes - this one just needs the raw content string and filename.

async function runDoExportForFormat(storageLocalGetImpl) {
  const fetchImpl = async (url) => {
    if (url.includes('/addons/addon/')) return { ok: true, status: 200, json: async () => ({ url: 'https://addons.mozilla.org/en-US/firefox/addon/exact-match/' }) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const bgSandbox = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: fetchImpl,
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => [baseAddon] },
      storage: { local: { get: storageLocalGetImpl } },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const { html: content, filename } = await bgSandbox.doExport([baseAddon.id]);
  return { content, filename };
}

testAsync('doExport: produces a .json file when exportFormat is "json"', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({ exportFormat: 'json' }));
  assert.match(filename, /\.json$/);
  const parsed = JSON.parse(content);
  assert.strictEqual(typeof parsed.formatVersion, 'number');
  assert.ok(Array.isArray(parsed.addons));
  assert.strictEqual(parsed.addons[0].name, baseAddon.name);
});

testAsync('doExport: produces a .csv file when exportFormat is "csv"', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({ exportFormat: 'csv' }));
  assert.match(filename, /\.csv$/);
  assert.match(content, /^# addons-hub-format-version:/);
  assert.match(content, /id,name,version,enabled,type,link,linkType/);
  assert.match(content, new RegExp(baseAddon.name));
});

testAsync('doExport: defaults to .html when exportFormat is unset', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({}));
  assert.match(filename, /\.html$/);
  assert.match(content, /<!DOCTYPE html>/);
});

testAsync('doExport: defaults to .html when exportFormat is an unrecognised value', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({ exportFormat: 'xml' }));
  assert.match(filename, /\.html$/);
  assert.match(content, /<!DOCTYPE html>/);
});

testAsync('doExport: defaults to .html when storage.local.get throws for exportFormat', async () => {
  const { content, filename } = await runDoExportForFormat(async () => {
    throw new Error('storage unavailable');
  });
  assert.match(filename, /\.html$/);
  assert.match(content, /<!DOCTYPE html>/);
});

// --- background.js: the result reports the format export.js puts in the confirmation URL ---

testAsync('export message: on desktop with JSON format, the result reports format=json', async () => {
  const { result } = await captureExportMessageResult('win', async () => ({ exportFormat: 'json' }));
  assert.strictEqual(result.format, 'json');
});

testAsync('export message: on desktop with CSV format, the result reports format=csv', async () => {
  const { result } = await captureExportMessageResult('win', async () => ({ exportFormat: 'csv' }));
  assert.strictEqual(result.format, 'csv');
});

// --- listInstalledAddons: includes optionsUrl ---

testAsync('listInstalledAddons: includes optionsUrl when present, null when absent', async () => {
  const bgSandbox = {
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      management: {
        getAll: async () => [
          { id: 'ext1@example.com', name: 'Ext With Settings', version: '1.0', enabled: true, type: 'extension', optionsUrl: 'moz-extension://abc/options.html' },
          { id: 'ext2@example.com', name: 'Ext Without Settings', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const result = await bgSandbox.listInstalledAddons();
  assert.strictEqual(result[0].optionsUrl, 'moz-extension://abc/options.html');
  assert.strictEqual(result[1].optionsUrl, null);
});

// --- management.uninstall is available via the management permission ---

testAsync('browser.management.uninstall: can be called and resolves', async () => {
  // Firefox does not expose browser.management.uninstall() for regular
  // extensions — the Remove button opens about:addons instead. This test
  // just verifies the management API sandbox loads without error.
  const bgSandbox = {
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      management: {
        getAll: async () => [],
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(reportTemplateSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  assert.ok(typeof bgSandbox.browser.management.getAll === 'function');
});

// --- background.js: openTabs (the Importer hands every tab after the first to us) ---

// Objects built inside the vm sandbox have a different Object prototype, so
// deepStrictEqual needs them copied into this realm first.
const plain = (v) => JSON.parse(JSON.stringify(v));

function loadBackgroundForOpenTabs({ failUrls = [] } = {}) {
  let messageListener = null;
  const created = [];
  let timeoutCalls = 0;
  const sb = {
    URL, Blob, AbortController,
    setTimeout: (fn) => { timeoutCalls++; fn(); return 0; },
    clearTimeout() {},
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    browser: {
      runtime: {
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        getURL: (path) => `moz-extension://test-id/${path}`,
      },
      tabs: {
        create: async (options) => {
          if (failUrls.includes(options.url)) throw new Error('tab creation failed');
          created.push(options);
          return {};
        },
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
  vm.runInContext(reportTemplateSrc, sb);
  vm.runInContext(backgroundSrc, sb);
  return { send: (msg) => messageListener(msg), created, getTimeoutCalls: () => timeoutCalls };
}

// The queue runs in the background after the reply; let it drain.
const settleQueue = () => new Promise((resolve) => setImmediate(resolve));

testAsync('openTabs: replies at once with how many are queued, then opens each as a background tab', async () => {
  const ctx = loadBackgroundForOpenTabs();
  const reply = await ctx.send({ type: 'openTabs', urls: ['https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/'] });
  assert.deepStrictEqual(plain(reply), { queued: 2 });
  await settleQueue();
  assert.deepStrictEqual(plain(ctx.created), [
    { url: 'https://addons.mozilla.org/b/', active: false },
    { url: 'https://addons.mozilla.org/c/', active: false },
  ]);
  assert.strictEqual(ctx.getTimeoutCalls(), 1, 'the first opens immediately; one stagger delay before the second');
});

testAsync('openTabs: drops anything that is not an http/https string (this message is re-validated)', async () => {
  const ctx = loadBackgroundForOpenTabs();
  const reply = await ctx.send({
    type: 'openTabs',
    urls: ['javascript:alert(1)', 'file:///etc/passwd', 42, null, 'https://addons.mozilla.org/ok/'],
  });
  assert.deepStrictEqual(plain(reply), { queued: 1 });
  await settleQueue();
  assert.deepStrictEqual(ctx.created.map((o) => o.url), ['https://addons.mozilla.org/ok/']);
});

testAsync('openTabs: a missing or non-array urls value queues nothing and does not throw', async () => {
  const ctx = loadBackgroundForOpenTabs();
  assert.deepStrictEqual(plain(await ctx.send({ type: 'openTabs' })), { queued: 0 });
  assert.deepStrictEqual(plain(await ctx.send({ type: 'openTabs', urls: 'https://addons.mozilla.org/x/' })), { queued: 0 });
  await settleQueue();
  assert.strictEqual(ctx.created.length, 0);
});

testAsync('openTabs: one tab failing to open does not stop the rest', async () => {
  const ctx = loadBackgroundForOpenTabs({ failUrls: ['https://addons.mozilla.org/b/'] });
  await ctx.send({ type: 'openTabs', urls: ['https://addons.mozilla.org/b/', 'https://addons.mozilla.org/c/'] });
  await settleQueue();
  assert.deepStrictEqual(ctx.created.map((o) => o.url), ['https://addons.mozilla.org/c/']);
});

testAsync('openTabs: caps a single batch at 500 tabs', async () => {
  const ctx = loadBackgroundForOpenTabs();
  const urls = Array.from({ length: 600 }, (_, i) => `https://addons.mozilla.org/a${i}/`);
  const reply = await ctx.send({ type: 'openTabs', urls });
  assert.deepStrictEqual(plain(reply), { queued: 500 });
});

