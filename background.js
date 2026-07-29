browser.browserAction.onClicked.addListener(async () => {
  const result = await doExport();
  browser.tabs.create({
    url: browser.runtime.getURL('confirmation.html') + '?count=' + result.count
  });
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

function buildHtmlReport(list) {
  const enabled = list.filter(a => a.enabled);
  const disabled = list.filter(a => !a.enabled);

  const row = (a, idx) =>
    `<tr>
      <td><input type="checkbox" class="pick" data-link="${a.link}" checked></td>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.version)}</td>
      <td><a href="${a.link}" target="_blank" rel="noopener">${a.link}</a></td>
    </tr>`;

  const section = (title, items) => items.length ? `
    <h2>${title} (${items.length})</h2>
    <table>
      <tr><th></th><th>Name</th><th>Version</th><th>Link</th></tr>
      ${items.map(row).join('\n')}
    </table>` : '';

  const plainText = list.map(a => `${a.name} - ${a.link}`).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>My Extensions - ExtMover Export</title>
<style>
  body { font-family: sans-serif; max-width: 900px; margin: 30px auto; padding: 0 15px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; }
  th { background: #f0f0f0; }
  button { padding: 8px 14px; margin-right: 10px; margin-bottom: 20px; cursor: pointer; }
  #copyStatus, #openStatus { font-size: 13px; color: #444; margin-left: 8px; }
  label.selectAll { font-size: 13px; margin-left: 10px; }
  @media print { button, #copyStatus, #openStatus, .pick, label.selectAll { display: none; } }
</style>
</head>
<body>
  <h1>My Installed Extensions</h1>
  <p>Exported on ${new Date().toLocaleString()} — ${list.length} total.</p>

  <button onclick="window.print()">Print</button>
  <button id="copyBtn">Copy list as text</button>
  <span id="copyStatus"></span>
  <br>
  <button id="openBtn">Open checked in new tabs</button>
  <label class="selectAll"><input type="checkbox" id="selectAll" checked> Select/deselect all</label>
  <span id="openStatus"></span>

  ${section('Enabled', enabled)}
  ${section('Disabled', disabled)}

  <script>
    const plain = ${JSON.stringify(plainText)};
    document.getElementById('copyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(plain).then(() => {
        document.getElementById('copyStatus').textContent = 'Copied!';
      }).catch(() => {
        document.getElementById('copyStatus').textContent = 'Copy failed - select text manually.';
      });
    });

    document.getElementById('selectAll').addEventListener('change', (e) => {
      document.querySelectorAll('.pick').forEach(cb => cb.checked = e.target.checked);
    });

    document.getElementById('openBtn').addEventListener('click', () => {
      const checked = Array.from(document.querySelectorAll('.pick:checked'));
      if (checked.length === 0) {
        document.getElementById('openStatus').textContent = 'Nothing selected.';
        return;
      }
      checked.forEach(cb => window.open(cb.dataset.link, '_blank'));
      document.getElementById('openStatus').textContent =
        'Opened ' + checked.length + ' tabs. (If your browser blocked some, allow pop-ups for this page and try again.)';
    });
  </script>
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

  // saveAs: false = behaves like a normal browser download: saves straight
  // to the Downloads folder, or asks where to save if the browser is set
  // to always ask (Settings > General > Downloads).
  await browser.downloads.download({
    url,
    filename: 'my-extensions.html',
    saveAs: false
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { count: list.length };
}
