browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'openTabs') {
    return Promise.resolve(queueTabOpens(message.urls));
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(async ({ html, filename, format, stats }) => {
      const platform = await browser.runtime.getPlatformInfo();

      if (platform.os === 'android') {
        return { html, filename, stats };
      }

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      try {
        await browser.downloads.download({ url, filename, saveAs: true });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }

      // No tab is opened from here: export.js replaces its own page with
      // the confirmation page once it gets this result back.
      return { format, stats };
    });
  }
});

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

const AMO_API_BASE = 'https://addons.mozilla.org/api/v5';
const AMO_FETCH_TIMEOUT_MS = 15000;

// Tries an exact ID lookup first, then a name search. Returns
// { url, matchType } or null. onFailure(), if given, is called once per
// genuine failure (network error, timeout, or a non-2xx/404 status) -
// not for a clean 404 or a search that simply found nothing plausible,
// since neither of those means anything is actually wrong.
async function findAmoPage(id, name, onFailure) {
  // 1. Exact lookup by addon ID/GUID
  const exact = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/addon/${encodeURIComponent(id)}/`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (exact.ok) {
    if (exact.status !== 404) {
      if (exact.data && exact.data.url) return { url: exact.data.url, matchType: 'amo-exact' };
      console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) returned no url field`, exact.data);
    }
    // A 404 here just means it's not on AMO - not worth a warning, and
    // not a failure (see the doc comment above).
  } else {
    console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) failed:`, exact.error || `HTTP ${exact.status}`);
    if (onFailure) onFailure();
  }

  // 2. Fuzzy search by name
  const search = await fetchJsonWithTimeout(
    `${AMO_API_BASE}/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
    AMO_FETCH_TIMEOUT_MS
  );
  if (search.ok) {
    const top = search.data && search.data.results && search.data.results[0];
    if (top && top.url && isPlausibleNameMatch(name, extractTranslatedField(top.name))) {
      return { url: top.url, matchType: 'amo-search' };
    }
    // Either no results, or the top result's name didn't clear the
    // relevance bar - don't hand back an unrelated add-on just
    // because it happened to rank first.
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) returned no plausible match`, search.data);
  } else {
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) failed:`, search.error || `HTTP ${search.status}`);
    if (onFailure) onFailure();
  }

  return null;
}

function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// buildHtmlReport() - the standalone HTML report builder - lives in
// report-template.js, loaded before this file (see manifest.json). It's
// pure string templating with no browser.* dependency, split out so it
// can be read/tested on its own, separate from this file's messaging
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
  // excludes Mozilla's own built-in components: desktop's use ids ending
  // in @mozilla.org, while Firefox for Android bundles several of its own
  // (ads/icons/fxa/readerview/search telemetry) ending in @mozac.org -
  // neither is something the user actually chose to install.
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

  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
    let amoMatch = null;
    if (Date.now() < deadlineAt && consecutiveFailures < maxConsecutiveFailures) {
      let lookupFailed = false;
      amoMatch = await findAmoPage(a.id, a.name, () => { lookupFailed = true; });
      if (lookupFailed) {
        consecutiveFailures++;
        stats.lookupFailures++;
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
    } else if (a.homepageUrl && isSafeUrl(a.homepageUrl)) {
      link = a.homepageUrl;
      linkType = 'homepage';
      stats.homepage++;
    } else {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      linkType = 'amo-search-fallback';
      stats.searchFallback++;
    }
    reportProgress();
    return { id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type, link, linkType };
  });

  // background.js has no document to apply a theme to, so it doesn't
  // load theme.js - it only needs the resolved value here, to bake into
  // the report's starting state (see report-template.js's
  // buildHtmlReport). getStoredSettings() (common.js) falls back to every
  // default if storage is ever unavailable.
  const { theme, exportFormat, shortenNames } = await getStoredSettings();
  const shorten = shortenNames !== 'off';

  let content;
  let ext;
  if (exportFormat === 'json') {
    content = buildJsonExport(list);
    ext = 'json';
  } else if (exportFormat === 'csv') {
    content = buildCsvExport(list);
    ext = 'csv';
  } else {
    content = buildHtmlReport(list, theme, shorten);
    ext = 'html';
  }

  const filename = `Firefox Add-ons (${formatFilenameTimestamp(new Date())}).${ext}`;
  return { html: content, filename, format: ext, stats };
}
