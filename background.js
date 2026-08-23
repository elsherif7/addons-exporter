// Version of the JSON data embedded in exported reports. Bump this if the
// shape of that data ever changes, so import.js can detect old exports
// and handle them gracefully instead of breaking silently.
const EXPORT_FORMAT_VERSION = 1;

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(() => {
      // Open the confirmation tab from here (the background script),
      // not from the popup - the popup can close early when the native
      // "Save As" dialog steals focus, which would otherwise stop this
      // step from ever running.
      browser.tabs.create({
        url: browser.runtime.getURL('confirmation.html')
      });
    });
  }
});

// Milliseconds to wait for a single AMO API request before giving up on it
// and falling through to the next lookup step. Generous, since an accurate
// AMO match is worth waiting for - but bounded, so a slow/unreachable AMO
// endpoint can't stall the whole export indefinitely.
const AMO_FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Look up the extension's real AMO (addons.mozilla.org) listing page.
// Try by exact ID/GUID first (most reliable), then fall back to a name search.
// Returns { url, matchType } - matchType lets the report show how confident
// each link is, since a fuzzy name search can genuinely point to the wrong
// add-on - or null if neither lookup found anything.
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
    }
  } catch {
    // fall through
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
    }
  } catch {
    // fall through
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

// JSON.stringify never escapes "/", so a string value containing the
// literal text "</script>" - like an add-on's name, which is completely
// attacker-controlled for any sideloaded/unlisted extension - would
// prematurely close this embedding <script> tag when a real browser
// parses the exported file (opening the report directly is the file's
// whole purpose, not just importing it back through this extension).
// That lets a maliciously-named add-on inject and execute a genuine new
// <script> tag in the report. Escaping "</" as "<\/" is a lossless,
// standard fix - "\/" is a valid JSON escape for "/", so JSON.parse
// reads it back identically, but the browser's HTML tokenizer no longer
// sees a closing tag.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function buildHtmlReport(list) {
  // Human-readable labels for how each link was resolved (see linkType,
  // set in doExport). Fuzzy/fallback matches are flagged with the
  // .match-uncertain style below since they can genuinely point to the
  // wrong add-on and are worth a second look.
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
    const typeTag = a.type === 'theme' ? ' <span class="type-tag">Theme</span>' : '';
    return `<tr>
      <td>${escapeHtml(a.name)}${typeTag}</td>
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
  .type-tag { font-size: 11px; font-style: italic; color: #888; }
</style>
</head>
<body>
  <h1>My Installed Add-ons</h1>
  <p>Exported on ${formatExportDate(new Date())}. Found ${list.length} add-ons in total.</p>
  <p><em>Tip: on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/" target="_blank" rel="noopener">Add-ons Exporter</a> installed, click its toolbar icon and choose "Import Add-ons" to open every link below as a tab automatically. Don't have it yet? Install it from the link above first.</em></p>

  ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
  ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
</body>
</html>`;
}

// Max number of AMO lookups (findAmoPage calls) allowed to run at once
// during export. Unbounded concurrency (one fetch pair per installed
// add-on, all at once) risks tripping AMO's rate limiting for users with
// large add-on collections - this keeps lookups running in parallel for
// speed, but caps how many are in flight at a time.
const AMO_LOOKUP_CONCURRENCY = 5;

// Runs fn(item) over items with at most `limit` calls in flight at once,
// returning results in the same order as items.
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

// Reads installed add-ons and filters down to the ones this extension can
// export (extensions/themes, excluding Firefox's own built-ins). Shared by
// listInstalledAddons() (export.html's picker) and doExport() (the actual
// export), so both always agree on exactly which add-ons are eligible.
async function getExportableAddons() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch {
    // Surfaces as "Error: <message>" in the popup/export page - give it
    // something actionable instead of whatever raw message crosses the
    // runtime messaging boundary.
    throw new Error('Could not read your installed add-ons. Try reloading the extension, or check that it still has permission to manage add-ons.');
  }

  // browser.management can also report 'dictionary' and 'locale' items
  // (spell-check dictionaries, language packs). Deliberately excluded here:
  // buildHtmlReport() only has Extensions/Themes sections, so including
  // them would silently drop them from the report body while still
  // counting them in the "Found N add-ons" total - worse than leaving
  // them out. Revisit if dictionaries/locales ever get their own section.
  return all.filter(a =>
    (a.type === 'extension' || a.type === 'theme') && !a.id.endsWith('@mozilla.org')
  );
}

// Lightweight listing for export.html's picker - just the fields needed to
// render checkboxes. No AMO lookups here; those only run for whatever the
// user actually selects, in doExport().
async function listInstalledAddons() {
  const extensions = await getExportableAddons();
  return extensions.map(a => ({
    id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type
  }));
}

async function doExport(ids) {
  let extensions = await getExportableAddons();

  // ids comes from export.html's checkbox selection. If provided, export
  // only those add-ons instead of everything eligible.
  if (Array.isArray(ids)) {
    const idSet = new Set(ids);
    extensions = extensions.filter(a => idSet.has(a.id));
  }

  if (extensions.length === 0) {
    throw new Error('No add-ons selected to export.');
  }

  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
    const amoMatch = await findAmoPage(a.id, a.name);
    let link;
    let linkType;
    if (amoMatch) {
      link = amoMatch.url;
      linkType = amoMatch.matchType;
    } else if (a.homepageUrl && a.homepageUrl.startsWith('http')) {
      link = a.homepageUrl;
      linkType = 'homepage';
    } else {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      linkType = 'amo-search-fallback';
    }
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
