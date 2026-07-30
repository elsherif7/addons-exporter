browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'export') {
    return doExport().then((result) => {
      // Open the confirmation tab from here (the background script),
      // not from the popup - the popup can close early when the native
      // "Save As" dialog steals focus, which would otherwise stop this
      // step from ever running.
      browser.tabs.create({
        url: browser.runtime.getURL('confirmation.html') + '?count=' + result.count
      });
      return result;
    });
  }
});

// Look up the extension's real AMO (addons.mozilla.org) listing page.
// Try by exact ID/GUID first (most reliable), then fall back to a name search.
async function findAmoPage(id, name) {
  // 1. Exact lookup by addon ID/GUID
  try {
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.url) return data.url;
    }
  } catch (e) {
    // fall through
  }

  // 2. Fuzzy search by name
  try {
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&app=firefox`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0 && data.results[0].url) {
        return data.results[0].url;
      }
    }
  } catch (e) {
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

function buildHtmlReport(list) {
  const enabled = list.filter(a => a.enabled);
  const disabled = list.filter(a => !a.enabled);

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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>My Add-ons - Add-ons Exporter Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 15px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; }
  th { background: #f0f0f0; }
</style>
</head>
<body>
  <h1>My Installed Add-ons</h1>
  <p>Exported on ${formatExportDate(new Date())}. Found ${list.length} add-ons in total.</p>
  <p><em>Tip: on another browser with Add-ons Exporter installed, click its toolbar icon and choose "Import Add-ons" to open every link below as a tab automatically.</em></p>

  ${section('Enabled', enabled)}
  ${section('Disabled', disabled)}

  <script type="application/json" id="addons-exporter-data">${JSON.stringify(list)}</script>
</body>
</html>`;
}

async function doExport() {
  const all = await browser.management.getAll();
  const extensions = all.filter(a => a.type === 'extension' && a.id !== browser.runtime.id);

  const list = await Promise.all(extensions.map(async (a) => {
    let link = await findAmoPage(a.id, a.name);
    if (!link && a.homepageUrl && a.homepageUrl.startsWith('http')) {
      link = a.homepageUrl;
    }
    if (!link) {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
    }
    return { name: a.name, version: a.version, enabled: a.enabled, link };
  }));

  const html = buildHtmlReport(list);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  // saveAs: true = always show the native "Save As" dialog, letting the
  // user pick the folder and filename themselves.
  await browser.downloads.download({
    url,
    filename: 'Firefox-Addons.html',
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { count: list.length };
}
