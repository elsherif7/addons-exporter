// Export and Import bring an already-open Exporter / Importer tab to the front
// instead of opening a second one (like Settings, whose page the browser
// reuses itself). Each of those pages answers { type: 'whereIsPage', page }
// with its own tab - see answerWhereIsPage() in src/common/page-ui.js. If none
// answers (or the tab has just closed), a new tab is opened.
async function openOrFocus(page) {
  try {
    const found = await browser.runtime.sendMessage({ type: 'whereIsPage', page });
    if (found && Number.isInteger(found.tabId)) {
      await browser.tabs.update(found.tabId, { active: true });
      if (Number.isInteger(found.windowId)) await browser.windows.update(found.windowId, { focused: true });
      window.close();
      return;
    }
  } catch { /* nobody answered, or the tab is gone - open a new one */ }
  await browser.tabs.create({ url: browser.runtime.getURL(`src/${page}/${page}.html`) });
  window.close();
}

document.getElementById('exportBtn').addEventListener('click', () => openOrFocus('export'));
document.getElementById('importBtn').addEventListener('click', () => openOrFocus('import'));

document.getElementById('settingsBtn').addEventListener('click', async () => {
  await browser.runtime.openOptionsPage();
  // An already-open Settings tab is reused rather than reloaded, so ask it
  // to play its entrance again. Harmless if it was just opened.
  try { await browser.runtime.sendMessage({ type: 'replaySettingsEntrance' }); } catch { /* nothing listening */ }
  window.close();
});
