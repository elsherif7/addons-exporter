const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  setStatus('Exporting...');
  try {
    const result = await browser.runtime.sendMessage({ type: 'export' });
    setStatus(`Exported ${result.count} extensions. Open the downloaded HTML file in your other browser.`);
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});
