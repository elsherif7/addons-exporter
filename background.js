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
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`,
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
      `https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
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

function formatExportDate(d) {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${month} ${day}, ${year}`;
}

function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// An attacker-controlled add-on name containing "</script>" would
// otherwise close this tag early when the report is opened directly.
// Escaping "</" as "<\/" is a safe JSON escape that JSON.parse reads back
// identically, so it can't do that.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function buildHtmlReport(list) {
  const linkTypeLabels = {
    'amo-exact': 'Exact match',
    'amo-search': 'Possible match',
    'homepage': 'Homepage',
    'amo-search-fallback': 'Search results',
  };
  const uncertainLinkTypes = new Set(['amo-search', 'amo-search-fallback']);

  const row = (a) => {
    const matchLabel = linkTypeLabels[a.linkType] || '';
    const matchClass = uncertainLinkTypes.has(a.linkType) ? ' class="match-uncertain"' : '';
    return `<tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.version)}</td>
      <td><a href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.link)}</a></td>
      <td${matchClass}>${escapeHtml(matchLabel)}</td>
    </tr>`;
  };

  const section = (title, items) => items.length ? `
    <h1 class="group-title">${title} (${items.length})</h1>
    <table>
      <tr><th>Name</th><th>Version</th><th>Link</th><th>Match</th></tr>
      ${items.map(row).join('\n')}
    </table>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>My Add-ons - Add-ons Exporter Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 15px; }
  h1 { font-size: 28px; }
  h1.group-title { font-size: 20px; margin-top: 40px; }
  p { font-size: 16px; color: #444; line-height: 1.7; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 30px; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; overflow-wrap: break-word; }
  th { background: #f0f0f0; }
  th:nth-child(1), td:nth-child(1) { width: 28%; }
  th:nth-child(2), td:nth-child(2) { width: 10%; }
  th:nth-child(3), td:nth-child(3) { width: 47%; }
  th:nth-child(4), td:nth-child(4) { width: 15%; white-space: nowrap; }
  .cta-link { color: #0060df; font-weight: bold; text-decoration: underline; }
  .match-uncertain { color: #b45309; font-style: italic; }
</style>
</head>
<body>
  <h1>Add-ons Exporter</h1>
  <p>Exported on ${formatExportDate(new Date())}. Found ${list.length} add-ons in total.</p>
  <p><em>Tip: on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/" target="_blank" rel="noopener">Add-ons Exporter</a> installed, click its toolbar icon and choose "Import Add-ons" to open every link below as a tab automatically. Don't have it yet? Install it from the link above first.</em></p>

  ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
  ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
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

  // Also excludes 'dictionary'/'locale' items - the report only has
  // Enabled/Disabled sections, so they'd be counted but never shown.
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
// (bug 1851373) - a manual timer was tried before and still got killed
// with the background page anyway.
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
  await browser.downloads.download({
    url,
    filename: `Firefox-Addons (${formatFilenameTimestamp(new Date())}).html`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
