const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  setStatus('Exporting your add-ons, please wait...');
  try {
    await browser.runtime.sendMessage({ type: 'export' });
    // The confirmation tab is opened by background.js itself, so this
    // still happens even if this popup closes early (e.g. when the
    // native "Save As" dialog steals focus).
    window.close();
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});

document.getElementById('importBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('import.html') });
  window.close();
});
