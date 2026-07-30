const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  setStatus('Exporting...');
  try {
    const result = await browser.runtime.sendMessage({ type: 'export' });
    await browser.tabs.create({
      url: browser.runtime.getURL('confirmation.html') + '?count=' + result.count
    });
    window.close();
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});

document.getElementById('importBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('import.html') });
  window.close();
});
