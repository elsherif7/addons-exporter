const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: 'export' });
    setStatus(`Exported ${result.count} extensions.`);
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
