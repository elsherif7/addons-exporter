// Tests for src/background/background.js. Loads the real source via vm
// with a mocked browser/fetch, so these run against the actual file and
// exercise its real registered message listener (not internal functions
// called directly in isolation).

const assert = require('assert');
const { test, testAsync, readSrc, readSrcs, readCommon, readReportBuilders, plain, makeSandbox } = require('./helpers');

const commonSrc = readCommon();
const reportTemplateSrc = readReportBuilders() + '\n' + readSrc('src/background/browser-info.js');
const backgroundSrc = readSrc('src/background/background.js');

// --- background.js: excludes Mozilla's own built-in components ---
// IDs ending in @mozilla.org or @mozac.org are not add-ons the user
// actually installed and are excluded from the exportable set.

testAsync('listInstalledAddons: excludes both @mozilla.org and @mozac.org built-ins', async () => {
  const bgSandbox = makeSandbox({
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      management: {
        getAll: async () => [
          { id: 'ublock@example.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension' },
          { id: 'webcompat@mozilla.org', name: 'Web Compat', version: '1.0', enabled: true, type: 'extension' },
          { id: 'ads@mozac.org', name: 'Built-in Ads Component', version: '1.0', enabled: true, type: 'extension' },
          { id: 'readerview@mozac.org', name: 'Built-in ReaderView Component', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
    },
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const result = await bgSandbox.listInstalledAddons();
  assert.deepStrictEqual(Array.from(result, (a) => a.id), ['ublock@example.com']);
});

// --- background.js: export message handler ---
// Loads the real background.js via vm with a mocked browser/fetch,
// and invokes the actual registered message listener
// (not doExport() directly) so this covers the export save path.

async function captureExportMessageResult(storageLocalGetImpl) {
  const defaultStorage = async () => ({});
  const storageGet = storageLocalGetImpl || defaultStorage;
  let downloadOptions = null;
  const createdTabUrls = [];
  let messageListener = null;
  const bgSandbox = makeSandbox({
    URL,
    Blob,
    AbortController,
    // background.js schedules a 30s delay before revoking the blob URL -
    // firing immediately here avoids the test run actually waiting that long.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async (url) => {
      // Exact-id lookup: pretend it's not on AMO. Name search: no results.
      if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    },
    browser: {
      runtime: {
        onMessage: { addListener: (fn) => { messageListener = fn; } },
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const result = await messageListener({ type: 'export', ids: ['ext1@example.com'] });
  return { downloadOptions, createdTabUrls, result };
}

testAsync('export message: downloads with saveAs, opens no tab itself, and returns {formats, stats}', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult();
  assert.strictEqual(downloadOptions.saveAs, true);
  assert.match(downloadOptions.url, /^blob:/);
  // export.js replaces its own page with the confirmation page instead.
  assert.strictEqual(createdTabUrls.length, 0);
  assert.deepStrictEqual(Array.from(result.formats), ['html']);
  assert.strictEqual(result.zipped, false);
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
  const bgSandbox = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const { files: [{ content: html }] } = await bgSandbox.doExport([addon.id]);
  const dataMatch = html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/);
  return JSON.parse(dataMatch[1]).addons[0];
}

async function runDoExportWithOptions(addons, fetchImpl, options) {
  const bgSandbox = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
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
  const bgSandbox = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const { files: [{ content: html }] } = await bgSandbox.doExport([baseAddon.id]);
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
  const bgSandbox = makeSandbox({
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: { runtime: { onMessage: { addListener() {} } } },
  }, commonSrc, reportTemplateSrc, backgroundSrc);

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
  const bgSandbox = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const { files: [{ content, filename }] } = await bgSandbox.doExport([baseAddon.id]);
  return { content, filename };
}

testAsync('doExport: produces a .json file when exportFormat is "json"', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({ exportFormat: 'json' }));
  assert.match(filename, /\.json$/);
  const parsed = JSON.parse(content);
  assert.strictEqual(typeof parsed.source.formatVersion, 'number');
  assert.ok(Array.isArray(parsed.addons));
  assert.strictEqual(parsed.addons[0].name, baseAddon.name);
});

testAsync('doExport: produces a .csv file when exportFormat is "csv"', async () => {
  const { content, filename } = await runDoExportForFormat(async () => ({ exportFormat: 'csv' }));
  assert.match(filename, /\.csv$/);
  assert.match(content, /^\uFEFF# addons-hub-source-formatVersion:/);
  assert.match(content, /name,version,type,enabled,link,linkType,id/);
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
  const { result } = await captureExportMessageResult(async () => ({ exportFormat: 'json' }));
  assert.deepStrictEqual(Array.from(result.formats), ['json']);
});

testAsync('export message: on desktop with CSV format, the result reports format=csv', async () => {
  const { result } = await captureExportMessageResult(async () => ({ exportFormat: 'csv' }));
  assert.deepStrictEqual(Array.from(result.formats), ['csv']);
});

// --- listInstalledAddons: includes optionsUrl ---

testAsync('listInstalledAddons: includes optionsUrl when present, null when absent', async () => {
  const bgSandbox = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const result = await bgSandbox.listInstalledAddons();
  assert.strictEqual(result[0].optionsUrl, 'moz-extension://abc/options.html');
  assert.strictEqual(result[1].optionsUrl, null);
});

// --- background.js: loads and registers its message listener ---
// Firefox does not expose browser.management.uninstall() to regular
// extensions - the Remove button opens about:addons instead - so there is no
// uninstall path to test. What matters is that background.js loads in a
// sandbox that has only the management API, and registers the
// runtime.onMessage listener every page's message goes through.

testAsync('background.js: loads with only the management API and registers its message listener', async () => {
  let listener = null;
  const bgSandbox = makeSandbox({
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      management: {
        getAll: async () => [],
      },
    },
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  assert.strictEqual(typeof listener, 'function', 'background.js must register a runtime.onMessage listener');
});

// --- background.js: openTabs (the Importer hands every tab after the first to us) ---

function loadBackgroundForOpenTabs({ failUrls = [] } = {}) {
  let messageListener = null;
  const created = [];
  let timeoutCalls = 0;
  const sb = makeSandbox({
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
  }, commonSrc, reportTemplateSrc, backgroundSrc);
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


testAsync('doExport: with several formats ticked it builds one file per format, all with the same timestamp', async () => {
  const addon = { id: 'ext1@example.com', name: 'Test Addon', version: '1.0', enabled: true, type: 'extension' };
  const bgSandbox = makeSandbox({
    URL, AbortController, setTimeout, clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => [addon] },
      storage: { local: { get: async () => ({ exportFormat: ['json', 'html', 'csv'] }) } },
    },
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  const result = await bgSandbox.doExport([addon.id]);
  assert.deepStrictEqual(Array.from(result.formats), ['html', 'json', 'csv']);
  assert.strictEqual(result.files.length, 3);
  const stamps = result.files.map((f) => f.filename.replace(/\.\w+$/, ''));
  assert.strictEqual(new Set(stamps).size, 1, 'one shared timestamp');
  assert.deepStrictEqual(Array.from(result.files.map((f) => f.filename.split('.').pop())), ['html', 'json', 'csv']);
  assert.deepStrictEqual(Array.from(Object.keys(result)).sort(), ['files', 'formats', 'stats'], 'only files, formats and stats come back');
  assert.deepStrictEqual(Array.from(Object.keys(result.files[0])).sort(), ['content', 'filename', 'format'], 'each file is { content, filename, format }');
});

// --- several formats are saved as ONE zip (one Save dialog) ---

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.strictEqual(view.getUint32(eocd, true), 0x06054b50, 'end-of-central-directory signature');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  assert.strictEqual(view.getUint32(eocd + 12, true), eocd - pos, 'central directory size matches where it actually is');
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.strictEqual(view.getUint32(pos, true), 0x02014b50);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const offset = view.getUint32(pos + 42, true);
    const name = Buffer.from(bytes.subarray(pos + 46, pos + 46 + nameLen)).toString('utf8');
    assert.strictEqual(view.getUint32(offset, true), 0x04034b50);
    const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    out.push({ name, text: Buffer.from(bytes.subarray(dataStart, dataStart + size)).toString('utf8'), crc: view.getUint32(pos + 16, true) });
    pos += 46 + nameLen;
  }
  return out;
}

test('zip.js: buildZip stores every file intact, with correct names and CRCs (incl. non-ASCII)', () => {
  const zipSrc = readSrcs('src/common/crc32.js', 'src/background/zip.js');
  const sb = makeSandbox({ TextEncoder, Uint8Array, Uint32Array, DataView }, zipSrc);
  const files = [
    { name: 'Firefox Add-ons (x).html', content: '<p>héllo – ✓</p>' },
    { name: 'Firefox Add-ons (x).json', content: '{"a":1}' },
  ];
  const entries = readZip(sb.buildZip(files, new Date(2026, 9, 12, 1, 30, 4)));
  assert.strictEqual(entries.length, 2);
  entries.forEach((e, i) => {
    assert.strictEqual(e.name, files[i].name);
    assert.strictEqual(e.text, files[i].content);
  });
  // CRC-32 of "123456789" is the well-known check value 0xCBF43926.
  const check = readZip(sb.buildZip([{ name: 'c.txt', content: '123456789' }]));
  assert.strictEqual(check[0].crc, 0xCBF43926);
});

testAsync('export message: several formats are downloaded as one .zip with a single Save dialog', async () => {
  const downloads = [];
  const addon = { id: 'ext1@example.com', name: 'Test Addon', version: '1.0', enabled: true, type: 'extension' };
  let listener;
  const bgSandbox = makeSandbox({
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, AbortController, setTimeout: () => 0, clearTimeout,
    Blob, TextEncoder, Uint8Array, Uint32Array, DataView,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    browser: {
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: async () => {} },
      management: { getAll: async () => [addon] },
      storage: { local: { get: async () => ({ exportFormat: ['html', 'json'] }) } },
      downloads: { download: async (opts) => { downloads.push(opts); return 1; } },
    },
  }, commonSrc, reportTemplateSrc, readSrcs('src/common/crc32.js', 'src/background/zip.js'), backgroundSrc);
  const result = await listener({ type: 'export', ids: [addon.id] });
  assert.strictEqual(downloads.length, 1, 'one download, so one Save dialog');
  assert.ok(/\.zip$/.test(downloads[0].filename));
  assert.strictEqual(downloads[0].saveAs, true);
  assert.strictEqual(result.zipped, true);
  assert.deepStrictEqual(Array.from(result.formats), ['html', 'json']);
});

// --- the Shorten add-on names setting reaches every export format ---

const longNameAddon = { id: 'buster@x', name: 'Buster: Captcha Solver for Humans', version: '3.4.0', enabled: true, type: 'extension' };

async function exportContent(storage, addon = longNameAddon) {
  const bgSandbox = makeSandbox({
    URL, AbortController, setTimeout, clearTimeout,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
      management: { getAll: async () => [addon] },
      storage: { local: { get: async () => storage } },
    },
  }, commonSrc, reportTemplateSrc, backgroundSrc);
  return (await bgSandbox.doExport([addon.id])).files[0].content;
}

for (const fmt of ['json', 'csv', 'txt']) {
  testAsync(`doExport (${fmt}): shortens names by default and keeps the id`, async () => {
    const content = await exportContent({ exportFormat: fmt });
    assert.ok(content.includes('Buster'));
    assert.ok(!content.includes('Captcha Solver'), 'the long name is cut');
    assert.ok(content.includes('buster@x'), 'the id is there');
  });
  testAsync(`doExport (${fmt}): keeps the full name when Shorten add-on names is off`, async () => {
    const content = await exportContent({ exportFormat: fmt, shortenNames: 'off' });
    assert.ok(content.includes('Buster: Captcha Solver for Humans'));
    assert.ok(content.includes('buster@x'));
  });
}
