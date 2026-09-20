// Firefox for Android shows this popup as a full-screen overlay rather
// than a small anchored dropdown - see the matching CSS rule in
// popup.html for why this needs a runtime check instead of a media query.
browser.runtime.getPlatformInfo().then((info) => {
  if (info.os === 'android') {
    document.body.classList.add('android');
  }
});

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
  window.close();
});
