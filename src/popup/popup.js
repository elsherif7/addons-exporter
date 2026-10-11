document.getElementById('exportBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('src/export/export.html') });
  window.close();
});

document.getElementById('importBtn').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('src/import/import.html') });
  window.close();
});

document.getElementById('settingsBtn').addEventListener('click', async () => {
  await browser.runtime.openOptionsPage();
  // An already-open Settings tab is reused rather than reloaded, so ask it
  // to play its entrance again. Harmless if it was just opened.
  try { await browser.runtime.sendMessage({ type: 'replaySettingsEntrance' }); } catch { /* nothing listening */ }
  window.close();
});
