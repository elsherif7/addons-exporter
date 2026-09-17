browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(async ({ html, filename }) => {
      const platform = await browser.runtime.getPlatformInfo();

      if (platform.os === 'android') {
        // Android's downloads.download() hands the URL to the OS's own
        // DownloadManager, which only accepts http/https URIs and throws
        // "Can only download HTTP/HTTPS URIs" for a blob: URL - there's
        // no saveAs dialog to fall back to either. A real download still
        // needs to happen somewhere, and the only mechanism that works
        // there (a plain <a download> click) needs to run in the same
        // tab/continuation as the original Export click to have a
        // chance of being recognized as a genuine user-triggered
        // download rather than getting silently dropped - a new tab
        // opened from here has no such gesture to inherit. So instead of
        // saving it here, hand the report back to export.js and let it
        // do the save itself.
        return { html, filename };
      }

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      try {
        // saveAs: true always shows the native "Save As" dialog, letting
        // the user pick the folder and filename themselves - desktop-only.
        await browser.downloads.download({ url, filename, saveAs: true });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }

      // Opened from here, not the popup - the popup can close early once
      // the native Save dialog steals focus.
      await browser.tabs.create({
        url: browser.runtime.getURL('src/confirmation/confirmation.html?from=export')
      });
    });
  }
});

const AMO_API_BASE = 'https://addons.mozilla.org/api/v5';
const AMO_FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // omit credentials so an AMO login cookie doesn't ride along on what's
    // meant to be an anonymous lookup.
    return await fetch(url, { signal: controller.signal, credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

// Tries an exact ID lookup first, then a name search. Returns
// { url, matchType } or null.
async function findAmoPage(id, name) {
  // 1. Exact lookup by addon ID/GUID
  try {
    const res = await fetchWithTimeout(
      `${AMO_API_BASE}/addons/addon/${encodeURIComponent(id)}/`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { url: data.url, matchType: 'amo-exact' };
      console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) returned no url field`, data);
    } else if (res.status !== 404) {
      // 404 just means it's not on AMO, not worth a warning.
      console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Hub] AMO exact lookup for "${name}" (${id}) threw:`, err);
  }

  // 2. Fuzzy search by name
  try {
    const res = await fetchWithTimeout(
      `${AMO_API_BASE}/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      const top = data.results && data.results[0];
      if (top && top.url && isPlausibleNameMatch(name, extractTranslatedField(top.name))) {
        return { url: top.url, matchType: 'amo-search' };
      }
      // Either no results, or the top result's name didn't clear the
      // relevance bar - don't hand back an unrelated add-on just
      // because it happened to rank first.
      console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) returned no plausible match`, data);
    } else {
      console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Hub] AMO name search for "${name}" (${id}) threw:`, err);
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
    id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type
  }));
}

// Don't add a setInterval() keep-alive here. Firefox already resets the
// idle-suspend timer while export.js's sendMessage() call is pending
// (bug 1851373). A keep-alive timer was tried in an earlier version but
// the background page was still killed despite it.
async function doExport(ids) {
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

  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
    const amoMatch = await findAmoPage(a.id, a.name);
    let link;
    let linkType;
    if (amoMatch && isSafeUrl(amoMatch.url)) {
      link = amoMatch.url;
      linkType = amoMatch.matchType;
    } else if (a.homepageUrl && isSafeUrl(a.homepageUrl)) {
      link = a.homepageUrl;
      linkType = 'homepage';
    } else {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      linkType = 'amo-search-fallback';
    }
    reportProgress();
    return { id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type, link, linkType };
  });

  const html = buildHtmlReport(list);
  const filename = `Firefox-Addons (${formatFilenameTimestamp(new Date())}).html`;
  return { html, filename };
}
