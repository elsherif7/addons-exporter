// Export and Import focus an already-open Exporter/Importer tab instead of
// opening a second one. Each of those pages answers { type: 'whereIsPage',
// page } with its own tab (answerWhereIsPage() in common/page-ui.js). If
// nobody answers, or the tab just closed, a new tab opens. The popup always
// closes, whatever happens.
async function openOrFocus(page) {
  try {
    try {
      const found = await browser.runtime.sendMessage({ type: 'whereIsPage', page });
      if (found && Number.isInteger(found.tabId)) {
        await browser.tabs.update(found.tabId, { active: true });
        // Raising the window is a bonus. If it fails the tab is already
        // focused, and falling through would open a second one.
        try {
          if (Number.isInteger(found.windowId)) await browser.windows.update(found.windowId, { focused: true });
        } catch { /* window went away, the tab is focused anyway */ }
        return;
      }
    } catch { /* nobody answered, or the tab is gone */ }
    await browser.tabs.create({ url: browser.runtime.getURL(`src/${page}/${page}.html`) });
  } catch { /* the popup still has to close */ } finally {
    window.close();
  }
}

document.getElementById('exportBtn').addEventListener('click', () => openOrFocus('export'));
document.getElementById('importBtn').addEventListener('click', () => openOrFocus('import'));

document.getElementById('settingsBtn').addEventListener('click', async () => {
  try {
    await browser.runtime.openOptionsPage();
    // an open Settings tab is reused, not reloaded, so ask it to replay its entrance
    try { await browser.runtime.sendMessage({ type: 'replaySettingsEntrance' }); } catch { /* nothing listening */ }
  } catch { /* the popup still has to close */ } finally {
    window.close();
  }
});
