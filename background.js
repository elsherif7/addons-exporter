browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'export') {
    return doExport();
  }
});

async function doExport() {
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

  // Give the download time to actually start reading the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { count: list.length };
}
