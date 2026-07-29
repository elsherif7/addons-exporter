browser.browserAction.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL('popup.html') });
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'export') {
    return doExport();
  }
});

async function findAmoPage(name) {
  try {
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&app=firefox`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const top = data.results[0];
      if (top.url) return top.url;
      if (top.slug) return `https://addons.mozilla.org/en-US/firefox/addon/${top.slug}/`;
    }
  } catch (e) {
    // ignore, fall back below
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

  const row = (a) =>
    `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.version)}</td>` +
    `<td><a href="${a.link}" target="_blank" rel="noopener">${a.link}</a></td></tr>`;

  const section = (title, items) => items.length ? `
    <h2>${title} (${items.length})</h2>
    <table>
      <tr><th>Name</th><th>Version</th><th>Link</th></tr>
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
  #copyStatus { font-size: 13px; color: #444; margin-left: 8px; }
  @media print { button, #copyStatus { display: none; } }
</style>
</head>
<body>
  <h1>My Installed Extensions</h1>
  <p>Exported on ${new Date().toLocaleString()} — ${list.length} total.</p>

  <button onclick="window.print()">Print</button>
  <button id="copyBtn">Copy list as text</button>
  <span id="copyStatus"></span>

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
  </script>
</body>
</html>`;
}

async function doExport() {
  const all = await browser.management.getAll();
  const extensions = all.filter(a => a.type === 'extension' && a.id !== browser.runtime.id);

  const list = await Promise.all(extensions.map(async (a) => {
    let link;
    if (a.homepageUrl && a.homepageUrl.startsWith('http')) {
      link = a.homepageUrl;
    } else {
      link = await findAmoPage(a.name);
      if (!link) {
        link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      }
    }
    return { name: a.name, version: a.version, enabled: a.enabled, link };
  }));

  const html = buildHtmlReport(list);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  await browser.downloads.download({
    url,
    filename: 'my-extensions.html',
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { count: list.length };
}
