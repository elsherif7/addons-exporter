// Tracks the export currently in progress, if any, so a 'cancelExport'
// message has something to flip. Only one export realistically runs at a
// time (one export.html tab drives it), so a single module-level slot is
// enough - no need for a map keyed by an export id.
let currentExportCancelToken = null;

function cancelledExportError() {
  const err = new Error('Export cancelled');
  err.cancelled = true;
  return err;
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'cancelExport') {
    if (currentExportCancelToken) currentExportCancelToken.cancelled = true;
    return Promise.resolve({ ok: true });
  }
  if (message.type === 'export') {
    const cancelToken = { cancelled: false };
    currentExportCancelToken = cancelToken;
    return doExport(message.ids, cancelToken).then(async ({ html, filename, format, stats }) => {
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

      // Opened from here, not the popup - the popup can close early once
      // the native Save dialog steals focus.
      await browser.tabs.create({
        url: browser.runtime.getURL(`src/confirmation/confirmation.html?from=export&format=${format}`)
      });
      return { format, stats };
    }).catch((err) => {
      // A cancellation isn't a real error - export.js needs to tell it
      // apart from an actual failure so it can show a plain "cancelled"
      // status instead of an error message.
      if (err && err.cancelled) return { cancelled: true };
      throw err;
    }).finally(() => {
      if (currentExportCancelToken === cancelToken) currentExportCancelToken = null;
    });
  }
});

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

// Don't add a setInterval() keep-alive here. Firefox already resets the
// idle-suspend timer while export.js's sendMessage() call is pending
// (bug 1851373). A keep-alive timer was tried in an earlier version but
// the background page was still killed despite it.
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

async function doExport(ids, cancelToken = { cancelled: false }, {
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
    if (cancelToken.cancelled) throw cancelledExportError();

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

    if (cancelToken.cancelled) throw cancelledExportError();

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
  // buildHtmlReport). Falls back to light if storage is ever unavailable.
  let theme = 'light';
  try {
    const stored = await browser.storage.local.get('theme');
    theme = stored.theme === 'dark' ? 'dark' : 'light';
  } catch {
    // keep the 'light' default
  }

  // Read the user's chosen export format, defaulting to HTML.
  let exportFormat = EXPORT_FORMAT_DEFAULT;
  try {
    const stored = await browser.storage.local.get(EXPORT_FORMAT_STORAGE_KEY);
    const val = stored[EXPORT_FORMAT_STORAGE_KEY];
    if (val === 'html' || val === 'json' || val === 'csv') exportFormat = val;
  } catch {
    // keep the default
  }

  let shorten = true;
  try {
    const stored = await browser.storage.local.get(SHORT_NAME_STORAGE_KEY);
    if (stored && stored[SHORT_NAME_STORAGE_KEY] === 'off') shorten = false;
  } catch {
    // keep the default
  }

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
