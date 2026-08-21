document.getElementById('exportBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('export.html') });
  window.close();
});

document.getElementById('importBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('import.html') });
  window.close();
});
