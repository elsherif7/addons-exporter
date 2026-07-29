browser.browserAction.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL('popup.html') });
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'export') {
    return doExport();
  }
});

// Ask Mozilla's addon search API for the closest match to this extension's
// name, and return its real listing page if found.
async function findAmoPage(name) {
  try {
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&app=firefox`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const top = data.results[0];
      // url field usually already points to the addon's listing page
      if (top.url) return top.url;
      if (top.slug) return `https://addons.mozilla.org/en-US/firefox/addon/${top.slug}/`;
    }
  } catch (e) {
    // network hiccup, or AMO doesn't list this one (e.g. built-in features
    // like "New Tab") -- just fall through to the search-page fallback
  }
  return null;
}

async function doExport() {
  const all = await browser.management.getAll();
  const extensions = all.filter(a => a.type === 'extension' && a.id !== browser.runtime.id);

  const list = await Promise.all(extensions.map(async (a) => {
    let link;
    if (a.homepageUrl && a.homepageUrl.startsWith('http')) {
      link = a.homepageUrl;
    } else {
      link = await findAmoPage(a.name);
      if (!link) {
        link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      }
    }
    return {
      name: a.name,
      version: a.version,
      enabled: a.enabled,
      link
    };
  }));

  const json = JSON.stringify(list, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  await browser.downloads.download({
    url,
    filename: 'my-extensions.json',
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return { count: list.length };
}
