browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'openTabs') {
    return Promise.resolve(queueTabOpens(message.urls));
  }
  if (message.type === 'getExportSource') {
    // The Settings page asks for this so its exported file records the same
    // source the add-on exports do (browser-info.js lives here).
    return getExportSource();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(async ({ files, formats, stats }) => {
      await saveExport(files);
      // No tab is opened from here: export.js replaces its own page with
      // the confirmation page once it gets this result back.
      return { formats, zipped: files.length > 1, stats };
    });
  }
});

// Saves the exported files through ONE Save dialog. One format: that file.
// Several: they are bundled into one zip, so there is a single dialog instead
// of one per file. The single file's MIME type comes from the format registry.
async function saveExport(files) {
  let blob;
  let saveName;
  if (files.length > 1) {
    const zipBytes = buildZip(files.map((f) => ({ name: f.filename, content: f.content })));
    blob = new Blob([zipBytes], { type: 'application/zip' });
    saveName = files[0].filename.replace(/\.\w+$/, '') + '.zip';
  } else {
    blob = new Blob([files[0].content], { type: getExportFormat(files[0].format).mime });
    saveName = files[0].filename;
  }
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename: saveName, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS);
  }
}

// The Importer opens the first add-on's page itself, then hands the rest
// here and immediately replaces its own page with the confirmation page -
// a page that has navigated away can't keep a loop running, this script
// can. Opens each as a background tab, one after another with the shared
// stagger, starting right away. Returns at once ({ queued }) rather than
// waiting for them all, so the page isn't held up; each tabs.create call
// is also activity that keeps this event page alive until the queue is
// done. Re-validates every URL (this message could come from anywhere in
// the extension) and caps the batch.
const MAX_QUEUED_TABS = 500;

function queueTabOpens(urls) {
  const safe = (Array.isArray(urls) ? urls : [])
    .filter((url) => typeof url === 'string' && isSafeUrl(url))
    .slice(0, MAX_QUEUED_TABS);
  (async () => {
    for (let i = 0; i < safe.length; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, TAB_OPEN_DELAY_MS));
      try {
        await browser.tabs.create({ url: safe[i], active: false });
      } catch {
        /* one tab failing shouldn't stop the rest */
      }
    }
  })();
  return { queued: safe.length };
}

// buildHtmlReport(), buildJsonExport(), buildCsvExport(), buildTxtExport() -
// all export format builders - live in
// export-formats.js (buildHtmlReport() in report-template.js), loaded before
// this file (see manifest.json). They're
// pure string templating with no browser.* dependency, split out so they
// can be read/tested on their own, separate from this file's messaging
// and AMO-lookup concerns.

// Caps how many AMO lookups run at once, so a big add-on collection
// doesn't trip AMO's rate limiting.
const AMO_LOOKUP_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Shared by listInstalledAddons() and doExport() so both always agree on
// which add-ons are eligible.
async function getExportableAddons() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch {
    throw new Error('Could not read your installed add-ons. Try reloading the extension, or check that it still has permission to manage add-ons.');
  }

  // Excludes dictionaries, language packs, and anything else that isn't
  // a plain extension or theme — the report only has Enabled/Disabled
  // sections, and those types have no matching store listing. Also
  // excludes Mozilla's own built-in components: ids ending in @mozilla.org
  // or @mozac.org are not add-ons the user actually chose to install.
  return all.filter(a =>
    (a.type === 'extension' || a.type === 'theme') &&
    !a.id.endsWith('@mozilla.org') &&
    !a.id.endsWith('@mozac.org')
  );
}

async function listInstalledAddons() {
  const extensions = await getExportableAddons();
  return extensions.map(a => ({
    id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type,
    optionsUrl: a.optionsUrl || null,
  }));
}

// Background worker suspension note:
//
// Firefox MV3 uses an event page (not a service worker), and kills it after
// ~30 seconds of inactivity. Two mechanisms already keep it alive during an
// export:
//   1. export.js's sendMessage() call stays open for the duration of the
//      export, and Firefox resets the idle timer while a message port is
//      held open (bug 1851373).
//   2. The fetch calls inside mapWithConcurrency() count as ongoing network
//      activity, each resetting the timer on their own.
//
// A plain setInterval() keep-alive was tried in an earlier version but the
// background page was still killed despite it - a bare timer with no
// browser.* API call inside doesn't count as "activity" to the event page
// lifetime tracker.
//
// A known workaround (confirmed working as of 2025) is to call any
// browser.* API on a short interval, e.g.:
//   self.setInterval(() => browser.runtime.getPlatformInfo(), 20000)
// This converts the event page into an effectively persistent background
// script. It has not been adopted here because the existing two mechanisms
// above already cover the normal export window (up to the 90s deadline
// below), and making the background unconditionally persistent would prevent
// Firefox from ever reclaiming its memory between sessions. If future testing
// shows exports are still being killed despite those two mechanisms (e.g. on
// a very slow connection with a huge add-on list), the getPlatformInfo
// interval is the recommended fix - scoped to the duration of doExport()
// only, not the lifetime of the background script.
// After this much wall time spent on AMO lookups, stop attempting them
// and fall back to a homepage/search link for whatever's left - large
// lists could otherwise take a very long time (up to two 15s lookups per
// add-on, 5 at a time) with no way to know the export is still moving.
const AMO_LOOKUP_DEADLINE_MS = 90000;
// After this many AMO failures in a row (network error, timeout, or a
// 429 that didn't clear on retry - never a clean "not found"), treat it
// the same as hitting the deadline: AMO is clearly having a bad time, and
// hammering it further for every remaining add-on isn't worth it.
const AMO_LOOKUP_MAX_CONSECUTIVE_FAILURES = 5;

async function doExport(ids, {
  deadlineMs = AMO_LOOKUP_DEADLINE_MS,
  maxConsecutiveFailures = AMO_LOOKUP_MAX_CONSECUTIVE_FAILURES,
} = {}) {
  let extensions = await getExportableAddons();

  if (Array.isArray(ids)) {
    const idSet = new Set(ids);
    extensions = extensions.filter(a => idSet.has(a.id));
  }

  if (extensions.length === 0) {
    throw new Error('No add-ons selected to export.');
  }

  const total = extensions.length;
  let done = 0;
  const reportProgress = () => {
    done++;
    // Silenced — export.html may already be closed; that's expected.
    browser.runtime.sendMessage({ type: 'exportProgress', done, total }).catch(() => {});
  };

  const deadlineAt = Date.now() + deadlineMs;
  let consecutiveFailures = 0;
  const stats = {
    total, amoExact: 0, amoSearch: 0, homepage: 0, searchFallback: 0,
    lookupFailures: 0, lookupsSkipped: 0,
  };

  // Keep-alive timer scoped strictly to doExport: calls getPlatformInfo periodically
  // so Firefox's event-page idle timer does not suspend the background script while
  // resolving a large add-on list on a slow connection. Cleared in the finally block below.
  const keepAliveTimer = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getPlatformInfo)
    ? setInterval(() => { browser.runtime.getPlatformInfo().catch(() => {}); }, 20000)
    : null;

  let list;
  try {
    list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
      let amoMatch = null;
    // Whether this add-on's own lookup requests failed (network error,
    // timeout, non-2xx). Kept per add-on and counted only if no AMO link came
    // back in the end, so a failure the name search then rescued is not
    // reported as a missing link while its link is a perfectly good AMO one.
    let lookupFailed = false;
    if (Date.now() < deadlineAt && consecutiveFailures < maxConsecutiveFailures) {
      amoMatch = await findAmoPage(a.id, a.name, () => { lookupFailed = true; });
      if (lookupFailed) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
    } else {
      stats.lookupsSkipped++;
    }

    let link;
    let linkType;
    if (amoMatch && isSafeUrl(amoMatch.url)) {
      link = amoMatch.url;
      linkType = amoMatch.matchType;
      if (linkType === 'amo-exact') stats.amoExact++; else stats.amoSearch++;
    } else {
      // No AMO link for this add-on. Only a lookup that actually failed counts
      // as a failure here: a clean "not on AMO" answer, an implausible name
      // match, or a lookup skipped for the deadline simply gets a fallback
      // link, and the success message words the two cases differently.
      if (lookupFailed) stats.lookupFailures++;
      if (a.homepageUrl && isSafeUrl(a.homepageUrl)) {
        link = a.homepageUrl;
        linkType = 'homepage';
        stats.homepage++;
      } else {
        link = amoSearchUrl(a.name);
        linkType = 'amo-search-fallback';
        stats.searchFallback++;
      }
    }
      reportProgress();
      return { id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type, link, linkType };
    });
  } finally {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
  }

  // Sort A→Z by name so every export format (HTML, JSON, CSV, TXT) comes
  // out in the same consistent alphabetical order, regardless of the order
  // browser.management.getAll() happened to return them in.
  list.sort(byName);

  // background.js has no document to apply a theme to, so it doesn't
  // load theme.js - it only needs the resolved value here, to bake into
  // the report's starting state (see report-template.js's
  // buildHtmlReport). loadSettings() (core.js) falls back to every
  // default if storage is ever unavailable.
  const { theme, exportFormats, shortenNames } = await loadSettings();
  const shorten = shortenNames !== 'off';
  // Which browser and extension version made these files; written into each one.
  const source = await getExportSource();

  // One file per chosen format, all named with the same timestamp. They are
  // built from the one list, so the (slow) AMO lookups above run only once
  // however many formats are ticked.
  const timestamp = formatFilenameTimestamp(new Date());
  const files = exportFormats.map((fmt) => {
    let content;
    if (fmt === 'json') content = buildJsonExport(list, shorten, source);
    else if (fmt === 'csv') content = buildCsvExport(list, shorten, source);
    else if (fmt === 'txt') content = buildTxtExport(list, shorten, source);
    else content = buildHtmlReport(list, theme, shorten, source);
    return { content, filename: `Firefox Add-ons (${timestamp}).${getExportFormat(fmt).extension}`, format: fmt };
  });

  // files carries each exported file ({ content, filename, format }).
  return {
    files,
    formats: files.map((f) => f.format),
    stats,
  };
}
