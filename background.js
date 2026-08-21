// Version of the JSON data embedded in exported reports. Bump this if the
// shape of that data ever changes, so import.js can detect old exports
// and handle them gracefully instead of breaking silently.
const EXPORT_FORMAT_VERSION = 1;

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'export') {
    return doExport().then(() => {
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
async function findAmoPage(id, name) {
  // 1. Exact lookup by addon ID/GUID
  try {
    const res = await fetchWithTimeout(
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      if (data.url) return data.url;
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
        return data.results[0].url;
      }
    }
  } catch {
    // fall through
  }

  return null;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

function buildHtmlReport(list) {
  const extensions = list.filter(a => a.type === 'extension');
  const themes = list.filter(a => a.type === 'theme');

  const row = (a) =>
    `<tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.version)}</td>
      <td><a href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.link)}</a></td>
    </tr>`;

  const section = (title, items) => items.length ? `
    <h2>${title} (${items.length})</h2>
    <table>
      <tr><th>Name</th><th>Version</th><th>Link</th></tr>
      ${items.map(row).join('\n')}
    </table>` : '';

  const group = (title, items) => items.length ? `
    <h1 class="group-title">${title}</h1>
    ${section('Enabled', items.filter(a => a.enabled))}
    ${section('Disabled', items.filter(a => !a.enabled))}` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>My Add-ons - Add-ons Exporter Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 15px; }
  h1 { font-size: 28px; }
  h1.group-title { font-size: 20px; margin-top: 40px; }
  h2 { font-size: 18px; }
  p { font-size: 16px; color: #444; line-height: 1.7; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; }
  th { background: #f0f0f0; }
  .cta-link { color: #0060df; font-weight: bold; text-decoration: underline; }
</style>
</head>
<body>
  <h1>My Installed Add-ons</h1>
  <p>Exported on ${formatExportDate(new Date())}. Found ${list.length} add-ons in total.</p>
  <p><em>Tip: on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/" target="_blank" rel="noopener">Add-ons Exporter</a> installed, click its toolbar icon and choose "Import Add-ons" to open every link below as a tab automatically. Don't have it yet? Install it from the link above first.</em></p>

  ${group('Extensions', extensions)}
  ${group('Themes', themes)}

  <script type="application/json" id="addons-exporter-data">${JSON.stringify({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
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

async function doExport() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch {
    // Surfaces as "Error: <message>" in the popup (see popup.js) - give it
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
  const extensions = all.filter(a =>
    (a.type === 'extension' || a.type === 'theme') && !a.id.endsWith('@mozilla.org')
  );

  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
    let link = await findAmoPage(a.id, a.name);
    if (!link && a.homepageUrl && a.homepageUrl.startsWith('http')) {
      link = a.homepageUrl;
    }
    if (!link) {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
    }
    return { name: a.name, version: a.version, enabled: a.enabled, type: a.type, link };
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
