const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const all = await browser.management.getAll();
    const list = all
      .filter(a => a.type === 'extension' && a.id !== browser.runtime.id)
      .map(a => ({
        name: a.name,
        version: a.version,
        enabled: a.enabled,
        link: a.homepageUrl && a.homepageUrl.startsWith('http')
          ? a.homepageUrl
          : `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`
      }));

    const json = JSON.stringify(list, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    await browser.downloads.download({
      url,
      filename: 'my-extensions.json',
      saveAs: true
    });

    setStatus(`Exported ${list.length} extensions.`);
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});

document.getElementById('importBtn').addEventListener('click', () => {
  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];
  if (!file) {
    setStatus('Pick a .json file first.');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const list = JSON.parse(e.target.result);
      setStatus(`Opening ${list.length} tabs...`);
      for (const item of list) {
        await browser.tabs.create({ url: item.link, active: false });
      }
      setStatus(`Opened ${list.length} tabs. Click "Add to Firefox" on each.`);
    } catch (err) {
      setStatus('Error reading file: ' + err.message);
    }
  };
  reader.readAsText(file);
});
