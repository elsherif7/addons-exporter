browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(() => {
      // Opened from here, not the popup - the popup can close early once
      // the native Save dialog steals focus.
      browser.tabs.create({
        url: browser.runtime.getURL('confirmation.html')
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
      console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) returned no url field`, data);
    } else if (res.status !== 404) {
      // 404 just means it's not on AMO, not worth a warning.
      console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) threw:`, err);
  }

  // 2. Fuzzy search by name
  try {
    const res = await fetchWithTimeout(
      `${AMO_API_BASE}/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0 && data.results[0].url) {
        return { url: data.results[0].url, matchType: 'amo-search' };
      }
      console.debug(`[Add-ons Exporter] AMO name search for "${name}" (${id}) returned no usable results`, data);
    } else {
      console.warn(`[Add-ons Exporter] AMO name search for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Exporter] AMO name search for "${name}" (${id}) threw:`, err);
  }

  return null;
}

function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// An add-on name (attacker-controlled) containing "</script>" would
// close this tag early when the report is opened directly. Escaping
// "</" as "<\/" stops that - JSON.parse reads it back the same either way.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

// The extension's own icon, embedded as a data URI (not a relative path)
// since the exported report is a standalone file that won't have the
// extension's icons folder sitting next to it once it's saved elsewhere.
const REPORT_ICON_DATA_URI = 'data:image/png;base64,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';

function buildHtmlReport(list) {
  const row = (a) => {
    const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
    const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';
    const match = matchLabel ? `<span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>` : '';
    return `<div class="addon-row">
      <a class="addon-name" href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>
      <span class="addon-version">${escapeHtml(a.version)}</span>
      ${match}
    </div>`;
  };

  const section = (title, items) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map(row).join('')}`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Add-ons Exporter</title>
<link rel="icon" href="${REPORT_ICON_DATA_URI}">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f5f7; margin: 0; padding: 60px 20px; color: #222; }
  .card { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 40px; text-align: center; }
  h1 { font-size: 28px; margin: 0 0 16px; }
  p { font-size: 16px; color: #444; line-height: 1.7; margin: 0 0 28px; }
  .cta-link { color: #0060df; font-weight: bold; text-decoration: underline; }
  .search-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    margin-bottom: 10px;
    border: 1px solid #d0d3d9;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
  }
  .search-input:focus { outline: none; border-color: #1f2937; }
  .placeholder-text { padding: 20px; color: #666; font-size: 14px; margin: 0; }
  .checklist-box {
    text-align: left;
    max-height: 360px;
    overflow-y: auto;
    border: 1px solid #e2e4e8;
    border-radius: 8px;
    padding: 4px 0;
    margin-bottom: 30px;
  }
  .group-heading {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #555;
    padding: 10px 14px 4px;
  }
  .addon-row {
    padding: 10px 14px;
    border-bottom: 1px solid #f0f1f3;
  }
  .addon-row:last-child { border-bottom: none; }
  .addon-name { font-size: 14px; font-weight: 600; color: #0060df; text-decoration: none; }
  .addon-name:hover { text-decoration: underline; }
  .addon-version { color: #888; font-size: 12px; margin-left: 6px; }
  .match-label { font-size: 11px; color: #666; margin-left: 8px; }
  .match-uncertain { color: #b45309; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
  <h1>Add-ons Exporter</h1>
  <p><strong>Tip:</strong> on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/" target="_blank" rel="noopener">Add-ons Exporter</a> installed, click its toolbar icon and choose <strong>Import Add-ons</strong> to open every link below as a tab automatically.</p>

  <input type="search" id="searchInput" class="search-input" placeholder="Search add-ons...">

  <div class="checklist-box">
    <div id="addonList">
      ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
      ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}
    </div>
    <p id="noSearchMatches" class="placeholder-text" style="display:none;">No add-ons match your search.</p>
  </div>
  </div>

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
  <script>
    // Self-contained - this file has no access to the extension's own
    // scripts or APIs once it's saved and opened on its own.
    var addonListEl = document.getElementById('addonList');
    var noSearchMatchesEl = document.getElementById('noSearchMatches');

    function filterAddonRows(query) {
      var q = query.trim().toLowerCase();
      var heading = null;
      var headingHasMatch = false;
      var anyMatch = false;
      var finishHeading = function () {
        if (heading) heading.style.display = headingHasMatch ? '' : 'none';
      };
      var children = addonListEl.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el.classList.contains('group-heading')) {
          finishHeading();
          heading = el;
          headingHasMatch = false;
        } else if (el.classList.contains('addon-row')) {
          var match = q === '' || el.textContent.toLowerCase().indexOf(q) !== -1;
          el.style.display = match ? '' : 'none';
          if (match) { headingHasMatch = true; anyMatch = true; }
        }
      }
      finishHeading();
      return anyMatch;
    }

    document.getElementById('searchInput').addEventListener('input', function (e) {
      var anyMatch = filterAddonRows(e.target.value);
      noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
    });
  </script>
</body>
</html>`;
}

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
  // sections, and those types have no matching store listing.
  return all.filter(a =>
    (a.type === 'extension' || a.type === 'theme') && !a.id.endsWith('@mozilla.org')
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
// (bug 1851373). A keep-alive timer was added in an earlier version to
// work around background-page suspension during long exports, but the
// background page was still killed despite it — the sendMessage approach
// is sufficient and the timer is not needed.
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
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  // saveAs: true = always show the native "Save As" dialog, letting the
  // user pick the folder and filename themselves.
  try {
    await browser.downloads.download({
      url,
      filename: `Firefox-Addons (${formatFilenameTimestamp(new Date())}).html`,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
