browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'resolveAddonLinks') {
    return resolveInstalledAddonLinks(message.ids);
  }
  if (message.type === 'openTabs') {
    return Promise.resolve(queueTabOpens(message.urls));
  }
  if (message.type === 'getExportSource') {
    // Settings asks for this so its file records the same source as the exports.
    return getExportSource();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(async ({ files, formats, stats }) => {
      await saveExport(files);
      // export.js swaps its own page for the confirmation page when this returns.
      return { formats, zipped: files.length > 1, stats };
    });
  }
});

// Several files go into one zip so there is a single Save dialog.
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

// The Importer opens the first add-on itself and hands the rest here, because
// once it navigates to the confirmation page it can't keep a loop running and
// this script can. Tabs open in the background, staggered. It returns
// straight away ({ queued }); the tabs.create calls keep this event page
// alive until the queue is done. URLs are checked again here and the batch is
// capped.
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
        /* one failing tab shouldn't stop the rest */
      }
    }
  })();
  return { queued: safe.length };
}

// Keeps a big collection from tripping AMO's rate limit.
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

// Used by both listInstalledAddons() and doExport() so they agree on what is
// eligible.
async function getExportableAddons() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch {
    throw new Error('Could not read your installed add-ons. Try reloading the extension, or check that it still has permission to manage add-ons.');
  }

  // Only extensions and themes (dictionaries and language packs have no store
  // listing), and not Mozilla's built-in components (@mozilla.org, @mozac.org),
  // which the user never chose to install.
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

// Firefox kills the MV3 event page after about 30s idle. During an export two
// things keep it up: export.js's open sendMessage() port (bug 1851373) and the
// AMO fetches. A bare setInterval did not help, because a timer with no
// browser.* call isn't counted as activity, so doExport() also calls a
// browser.* API every 20s. It's cleared when the export ends, so Firefox can
// still reclaim the page afterwards.

// After this long, stop looking things up on AMO and use a homepage/search
// link for the rest. Big lists could otherwise take very long (up to three 15s
// lookups per add-on, 5 at a time) with no sign of progress.
const AMO_LOOKUP_DEADLINE_MS = 90000;
// Same idea for a run of failures (network error, timeout, a 429 that
// didn't clear; never a clean "not found"): AMO is struggling, so stop.
const AMO_LOOKUP_MAX_CONSECUTIVE_FAILURES = 5;

// The Exporter page resolves every link on load and an export resolves them
// again. Remember AMO hits (and homepages) for the life of the event page so
// opening the page first doesn't double the requests. The version is part of
// the key, so an updated add-on is looked up again. Fallback search links are
// not cached: a later attempt may be the one that reaches AMO.
const addonLinkCache = new Map();

function addonLinkCacheKey(a) {
  return `${a.id}\u0000${a.version}`;
}

function countAddonLink(stats, linkType) {
  if (!stats) return;
  if (linkType === 'amo-exact') stats.amoExact++;
  else if (linkType === 'amo-search') stats.amoSearch++;
  else if (linkType === 'homepage') stats.homepage++;
}

// Resolves one add-on's link, in the same fallback order the export and the
// report use: exact AMO page, plausible AMO search result, homepage, then an
// AMO name search. doExport() passes stats so the success message can count
// each outcome; the Exporter page only needs the links.
function createAddonLinkResolver({
  deadlineAt = Date.now() + AMO_LOOKUP_DEADLINE_MS,
  maxConsecutiveFailures = AMO_LOOKUP_MAX_CONSECUTIVE_FAILURES,
  stats = null,
} = {}) {
  let consecutiveFailures = 0;

  return async (a) => {
    const cached = addonLinkCache.get(addonLinkCacheKey(a));
    if (cached) {
      countAddonLink(stats, cached.linkType);
      return {
        id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type,
        link: cached.link, linkType: cached.linkType,
      };
    }

    let amoMatch = null;
    // Per add-on, and only counted if no AMO link ends up found, so a
    // failure the name search recovered from isn't reported as a missing link.
    let lookupFailed = false;
    if (Date.now() < deadlineAt && consecutiveFailures < maxConsecutiveFailures) {
      amoMatch = await findAmoPage(a.id, a.name, () => { lookupFailed = true; });
      if (lookupFailed) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
    } else if (stats) {
      stats.lookupsSkipped++;
    }

    let link;
    let linkType;
    if (amoMatch && isSafeUrl(amoMatch.url)) {
      link = amoMatch.url;
      linkType = amoMatch.matchType;
      if (stats) {
        if (linkType === 'amo-exact') stats.amoExact++;
        else stats.amoSearch++;
      }
    } else {
      // Only a lookup that really failed counts as a failure. "Not on AMO",
      // a poor name match or a skipped lookup just get a fallback link, and
      // the success message words those differently.
      if (stats && lookupFailed) stats.lookupFailures++;
      if (a.homepageUrl && isSafeUrl(a.homepageUrl)) {
        link = a.homepageUrl;
        linkType = 'homepage';
        if (stats) stats.homepage++;
      } else {
        link = amoSearchUrl(a.name);
        linkType = 'amo-search-fallback';
        if (stats) stats.searchFallback++;
      }
    }
    // Don't cache a homepage that only won because AMO was unreachable; the
    // next attempt may still find the add-on's AMO page. A clean "not on AMO"
    // homepage is stable enough to keep.
    const cacheable = linkType !== 'amo-search-fallback' &&
      !(linkType === 'homepage' && lookupFailed);
    if (cacheable) {
      addonLinkCache.set(addonLinkCacheKey(a), { link, linkType });
    }
    return { id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type, link, linkType };
  };
}

// Used by the Exporter page so its row links match the report and Importer:
// they get the same resolved AMO page, with the same homepage/search fallback.
async function resolveInstalledAddonLinks(ids) {
  let extensions = await getExportableAddons();

  if (Array.isArray(ids)) {
    const idSet = new Set(ids);
    extensions = extensions.filter(a => idSet.has(a.id));
  }

  const resolveLink = createAddonLinkResolver();
  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, resolveLink);
  return list.map(({ id, link, linkType }) => ({ id, link, linkType }));
}

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
    // The export page may already be closed, so ignore errors.
    browser.runtime.sendMessage({ type: 'exportProgress', done, total }).catch(() => {});
  };

  const stats = {
    total, amoExact: 0, amoSearch: 0, homepage: 0, searchFallback: 0,
    lookupFailures: 0, lookupsSkipped: 0,
  };
  const resolveLink = createAddonLinkResolver({
    deadlineAt: Date.now() + deadlineMs,
    maxConsecutiveFailures,
    stats,
  });

  // the keep-alive described above
  const keepAliveTimer = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getPlatformInfo)
    ? setInterval(() => { browser.runtime.getPlatformInfo().catch(() => {}); }, 20000)
    : null;

  let list;
  try {
    list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
      const resolved = await resolveLink(a);
      reportProgress();
      return resolved;
    });
  } finally {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
  }

  // A-Z, so every format comes out in the same order whatever order
  // management.getAll() returned.
  list.sort(byName);

  // No document here, so theme.js isn't loaded; only the resolved theme is
  // needed, for the report's starting state. loadSettings() falls back to the
  // defaults if storage is unavailable.
  const { theme, exportFormats, shortenNames } = await loadSettings();
  const shorten = shortenNames !== 'off';
  const source = await getExportSource();

  // One file per chosen format, all from the same list, so the slow AMO
  // lookups run once however many formats are ticked.
  const timestamp = formatFilenameTimestamp(new Date());
  // Name the file after the browser actually running ("Zen", "Waterfox"...),
  // not always Firefox. The source's browser field is already plain text, so
  // it is safe in a filename; when it is unknown, leave the prefix off rather
  // than writing "Unknown Add-ons".
  const browserPrefix = source.browser === UNKNOWN_BROWSER.browser ? '' : `${source.browser} `;
  const files = exportFormats.map((fmt) => {
    let content;
    if (fmt === 'json') content = buildJsonExport(list, shorten, source);
    else if (fmt === 'csv') content = buildCsvExport(list, shorten, source);
    else if (fmt === 'txt') content = buildTxtExport(list, shorten, source);
    else content = buildHtmlReport(list, theme, shorten, source);
    return { content, filename: `${browserPrefix}Add-ons (${timestamp}).${getExportFormat(fmt).extension}`, format: fmt };
  });

  return {
    files,
    formats: files.map((f) => f.format),
    stats,
  };
}
