// drives the real export.js click handler via vm with a mocked browser/DOM.
// the handler replaces its own page with confirmation.html (same tab, no second tab)

const assert = require('assert');
const { test, testAsync, readSrc, makeFakeDom, readCommon, makeSandbox, waitFor, EXPORTER_ELEMENT_IDS } = require('./helpers');

const commonSrc = readCommon();
const exportSrc = readSrc('src/export/export.js');

async function captureExportClick({ selectedIds, exportResponse }) {
  const checkedCheckboxes = selectedIds.map((id) => ({ dataset: { id } }));
  const listElStub = {
    querySelectorAll: (sel) => (sel.includes('checkbox') ? checkedCheckboxes : []),
    addEventListener() {},
    replaceChildren() {},
  };
  let exportClickHandler = null;
  const createdTabUrls = [];
  const navigatedUrls = [];
  const sentMessages = [];
  const elements = {
    addonList: listElStub,
    selectAllBtn: { addEventListener() {} },
    deselectAllBtn: { addEventListener() {} },
    exportSelectedBtn: {
      addEventListener: (ev, fn) => { if (ev === 'click') exportClickHandler = fn; },
      disabled: false,
    },
    status: { textContent: '' },
    selectionCount: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
    exportDesc: { innerHTML: '', textContent: '', append() {} },
  };
  const exSandbox = makeSandbox({
    URL: { createObjectURL: () => 'blob:fake-url', revokeObjectURL() {} },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    location: { replace: (url) => navigatedUrls.push(url) },
    document: {
      getElementById: (id) => elements[id],
      body: { appendChild() {} },
      createElement: () => ({ style: {} }),
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          if (msg.type === 'listAddons') return [];
          if (msg.type === 'export') return exportResponse;
          return undefined;
        },
        getURL: (path) => `moz-extension://test-id/${path}`,
      },
      tabs: { create: async (options) => { createdTabUrls.push(options.url); return {}; } },
      storage: { local: { get: async () => ({}) } },
    },
  }, commonSrc, exportSrc);
  // let the top-level IIFE's listAddons call settle before the button exists
  await new Promise((resolve) => setTimeout(resolve, 0));
  await exportClickHandler();
  return { sentMessages, createdTabUrls, navigatedUrls, statusEl: elements.status, exportBtnEl: elements.exportSelectedBtn };
}

testAsync('export.js click handler: saves nothing itself and replaces its page with confirmation.html', async () => {
  const { createdTabUrls, navigatedUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 1, lookupFailures: 0 } },
  });
  assert.strictEqual(createdTabUrls.length, 0, 'no second tab');
  assert.deepStrictEqual(navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=export&format=html',
  ]);
});

testAsync('export.js click handler: on desktop, the confirmation URL carries the format that was exported', async () => {
  for (const format of ['json', 'csv']) {
    const { navigatedUrls } = await captureExportClick({
      selectedIds: ['ext1@example.com'],
      exportResponse: { formats: [format], stats: { total: 1, lookupFailures: 0 } },
    });
    assert.match(navigatedUrls[0], new RegExp(`confirmation\\.html\\?from=export&format=${format}$`));
  }
});

testAsync('export.js click handler: several formats are saved as one .zip, and the URL says so', async () => {
  const { navigatedUrls, statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: {
      formats: ['html', 'json'],
      zipped: true,
      stats: { total: 1, amoExact: 1, amoSearch: 0, homepage: 0, searchFallback: 0, lookupFailures: 0, lookupsSkipped: 0 },
    },
  });
  assert.deepStrictEqual(navigatedUrls, [
    'moz-extension://test-id/src/confirmation/confirmation.html?from=export&format=html,json&zip=1',
  ]);
  assert.match(statusEl.textContent, /saved together in one \.zip file/);
});

testAsync('export.js click handler: re-enables Export Selected after a successful desktop export', async () => {
  const { exportBtnEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 1, lookupFailures: 0 } },
  });
  assert.strictEqual(exportBtnEl.disabled, false, 'the button should not stay stuck disabled after success');
});

testAsync('export.js click handler: success message names a non-HTML format', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { formats: ['json'], stats: { total: 1, lookupFailures: 0 } },
  });
  assert.match(statusEl.textContent, /JSON file/);
  assert.doesNotMatch(statusEl.textContent, /report/);
});

testAsync('export.js click handler: success message reports lookup failures when there were any', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 2, lookupFailures: 1 } },
  });
  assert.match(statusEl.textContent, /1 of 2 add\u2011ons couldn\u2019t be looked up on AMO/);
});

testAsync('export.js click handler: no lookup-failure mention when there weren\'t any', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 1, lookupFailures: 0 } },
  });
  assert.doesNotMatch(statusEl.textContent, /couldn't be looked up/);
});

testAsync('export.js success message: shows "all found on AMO" when all are exact/search matches', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 2, amoExact: 1, amoSearch: 1, homepage: 0, searchFallback: 0, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /All 2 add\u2011ons found on AMO/);
});

testAsync('export.js success message: shows mixed breakdown when some are AMO and some are fallback', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com', 'ext3@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 3, amoExact: 2, amoSearch: 0, homepage: 1, searchFallback: 0, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /2 found on AMO, 1 got a fallback link/);
});

testAsync('export.js success message: shows fallback-only message when AMO found nothing', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 1, amoExact: 0, amoSearch: 0, homepage: 0, searchFallback: 1, lookupFailures: 0, lookupsSkipped: 0 } },
  });
  assert.match(statusEl.textContent, /1 add\u2011on got a fallback link \(AMO had no match\)/);
});

testAsync('export.js success message: shows skipped-lookups note when deadline was hit', async () => {
  const { statusEl } = await captureExportClick({
    selectedIds: ['ext1@example.com', 'ext2@example.com'],
    exportResponse: { formats: ['html'], stats: { total: 2, amoExact: 1, amoSearch: 0, homepage: 0, searchFallback: 1, lookupFailures: 0, lookupsSkipped: 1 } },
  });
  assert.match(statusEl.textContent, /1 add\u2011on skipped AMO \(deadline reached\)/);
});

testAsync('export.js: a non-array listAddons response shows a friendly error, not a raw exception', async () => {
  const listElStub = { replaceChildren: (...nodes) => { listElStub.children = nodes; }, addEventListener() {} };
  const elements = {
    addonList: listElStub,
    selectAllBtn: { addEventListener() {} },
    deselectAllBtn: { addEventListener() {} },
    exportSelectedBtn: { addEventListener() {}, disabled: false },
    status: { textContent: '' },
    selectionCount: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
    exportDesc: { innerHTML: '', textContent: '', append() {} },
  };
  const exSandbox = makeSandbox({
    URL,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({ className: '', textContent: '' }),
    },
    browser: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => undefined },
      storage: { local: { get: async () => ({}) } },
    },
  }, commonSrc, exportSrc);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(listElStub.children.length, 1);
  assert.strictEqual(listElStub.children[0].className, 'placeholder-text error');
  assert.doesNotMatch(listElStub.children[0].textContent, /Cannot read propert/,
    'should be a plain, friendly message - not a raw JS TypeError');
});

// real bootstrap against a real element tree (makeFakeDom), same A1 regression
// but through actual rendering instead of a hand-built fixture

async function renderRealExportList(addons, { resolveLinks, exportResult } = {}) {
  const { document, elements } = makeFakeDom(EXPORTER_ELEMENT_IDS);
  const listeners = [];
  const managementEvents = {
    onInstalled: [], onUninstalled: [], onEnabled: [], onDisabled: [],
  };
  const management = {};
  for (const name of Object.keys(managementEvents)) {
    management[name] = { addListener: (fn) => managementEvents[name].push(fn) };
  }
  const sandbox = makeSandbox({
    document,
    URL,
    setTimeout,
    location: { replace() {} },
    browser: {
      runtime: {
        sendMessage: async (msg) => {
          if (msg.type === 'listAddons') return addons;
          if (msg.type === 'resolveAddonLinks' && resolveLinks) return resolveLinks(msg);
          if (msg.type === 'export' && exportResult !== undefined) return exportResult;
          return undefined;
        },
        onMessage: { addListener: (fn) => listeners.push(fn) },
        getURL: (p) => p,
      },
      storage: { local: { get: async () => ({}) } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      management,
    },
  }, commonSrc, exportSrc);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { elements, listeners, managementEvents, document };
}

testAsync('export.js real DOM: search hides non-matching rows and their group', async () => {
  const { elements } = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ]);
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  const shown = rows.filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.addon-name').textContent);
  assert.deepStrictEqual(shown, ['Alpha'], 'only the matching row should stay visible');
  assert.strictEqual(elements.noSearchMatches.style.display, 'none');
});

testAsync('export.js real DOM: a query matching nothing shows the "no matches" message and hides every row', async () => {
  const { elements } = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
  ]);
  elements.searchInput.value = 'zzz-nomatch';
  elements.searchInput.dispatchEvent('input');

  const rows = elements.addonList.querySelectorAll('.addon-row');
  assert.ok(rows.every((r) => r.style.display === 'none'));
  assert.strictEqual(elements.noSearchMatches.style.display, 'block');
});

testAsync('export.js real DOM: Select All while a search is active only checks the visible row', async () => {
  const { elements } = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ]);
  elements.deselectAllBtn.click();  // rows start checked, so reset first
  elements.searchInput.value = 'alpha';
  elements.searchInput.dispatchEvent('input');
  elements.selectAllBtn.click();

  const checked = elements.addonList.querySelectorAll('input[type="checkbox"]:checked');
  assert.strictEqual(checked.length, 1, 'Select All should only check the row the active search still shows');
  assert.strictEqual(elements.selectionCount.textContent, '1 of 2 selected');
});

testAsync('export.js real DOM: reopening from the popup clears the search box and shows the whole list again', async () => {
  const { elements, listeners } = await renderRealExportList([
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ]);
  elements.searchInput.value = 'zzz-nomatch';
  elements.searchInput.dispatchEvent('input');
  assert.ok(elements.addonList.querySelectorAll('.addon-row').every((r) => r.style.display === 'none'));
  assert.strictEqual(elements.noSearchMatches.style.display, 'block');

  listeners.forEach((fn) => fn({ type: 'whereIsPage', page: 'export' }));

  assert.strictEqual(elements.searchInput.value, '', 'the box is empty again');
  assert.strictEqual(elements.noSearchMatches.style.display, 'none', 'and the "no matches" note is gone');
  assert.ok(elements.addonList.querySelectorAll('.addon-row').every((r) => r.style.display !== 'none'),
    'every row is showing again');
  assert.ok(elements.addonList.querySelectorAll('input[type="checkbox"]:checked').length > 0,
    'and the ticks are untouched');
});

testAsync('export.js real DOM: installing, disabling and enabling add-ons refreshes the open list', async () => {
  const addons = [
    { id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' },
    { id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' },
  ];
  const { elements, managementEvents } = await renderRealExportList(addons);
  const rowFor = (name) => elements.addonList.querySelectorAll('.addon-row')
    .find((row) => row.querySelector('.addon-name').textContent === name);
  const headings = () => elements.addonList.querySelectorAll('.group-heading').map((h) => h.textContent);

  // Leave Beta unticked, then change the browser's add-ons while the page stays open.
  const betaBox = rowFor('Beta').querySelector('input[type="checkbox"]');
  betaBox.checked = false;
  betaBox.dispatchEvent('change');
  assert.strictEqual(elements.selectionCount.textContent, '1 of 2 selected');

  addons[1].enabled = false;
  addons.push({ id: 'c@x', name: 'Gamma', version: '3.0', enabled: true, type: 'extension' });
  managementEvents.onDisabled.forEach((fn) => fn({ id: 'b@x' }));
  managementEvents.onInstalled.forEach((fn) => fn({ id: 'c@x' }));

  await waitFor(() => headings().includes('Disabled (1)'), 'the disabled group after refreshing');
  assert.deepStrictEqual(headings(), ['Enabled (2)', 'Disabled (1)']);
  assert.strictEqual(rowFor('Beta').querySelector('input[type="checkbox"]').checked, false,
    'the unticked add-on stays unticked across the refresh');
  assert.strictEqual(rowFor('Alpha').querySelector('input[type="checkbox"]').checked, true);
  assert.strictEqual(rowFor('Gamma').querySelector('input[type="checkbox"]').checked, true,
    'a newly installed add-on starts ticked');
  assert.strictEqual(elements.selectionCount.textContent, '2 of 3 selected');

  // Enabling it again moves it back without losing its unticked state.
  addons[1].enabled = true;
  managementEvents.onEnabled.forEach((fn) => fn({ id: 'b@x' }));

  await waitFor(() => headings().length === 1, 'the disabled group to disappear');
  assert.deepStrictEqual(headings(), ['Enabled (3)']);
  assert.strictEqual(rowFor('Beta').querySelector('input[type="checkbox"]').checked, false);
});

testAsync('export.js real DOM: a refresh during an export does not re-enable the button', async () => {
  const addons = [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' }];
  let finishExport;
  const exportResult = new Promise((resolve) => { finishExport = resolve; });
  const { elements, managementEvents } = await renderRealExportList(addons, { exportResult });

  elements.exportSelectedBtn.click();
  await waitFor(() => elements.status.textContent.startsWith('Exporting'), 'the export to start');
  assert.strictEqual(elements.exportSelectedBtn.disabled, true);

  addons.push({ id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' });
  managementEvents.onInstalled.forEach((fn) => fn({ id: 'b@x' }));
  await waitFor(() => elements.addonList.querySelectorAll('.addon-row').length === 2, 'the refreshed list');

  assert.strictEqual(elements.exportSelectedBtn.disabled, true,
    'the button stays disabled until the export really finishes');

  finishExport({ formats: ['html'], stats: { total: 1, lookupFailures: 0 } });
  await waitFor(() => !elements.exportSelectedBtn.disabled, 'the export to finish');
});

testAsync('export.js real DOM: reopening from the popup re-reads the add-on list', async () => {
  const addons = [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' }];
  const { elements, listeners } = await renderRealExportList(addons);

  addons[0].enabled = false;
  addons.push({ id: 'b@x', name: 'Beta', version: '2.0', enabled: true, type: 'extension' });
  listeners.forEach((fn) => fn({ type: 'whereIsPage', page: 'export' }));

  await waitFor(() => elements.addonList.querySelectorAll('.addon-row').length === 2,
    'the second add-on to appear after reopening');
  const headings = elements.addonList.querySelectorAll('.group-heading').map((h) => h.textContent);
  assert.deepStrictEqual(headings, ['Enabled (1)', 'Disabled (1)']);
});

testAsync('export.js real DOM: coming back to the tab refreshes the list without the popup', async () => {
  const addons = [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension' }];
  const { elements, document } = await renderRealExportList(addons);

  addons[0].enabled = false;
  document.dispatchEvent('visibilitychange');

  await waitFor(() => elements.addonList.querySelectorAll('.group-heading')[0].textContent === 'Disabled (1)',
    'the add-on to move to the disabled group');
  assert.strictEqual(elements.addonList.querySelectorAll('.addon-row').length, 1);
});

testAsync('storage.onChanged: an export-format change from another tab refreshes the description', async () => {
  const registeredListeners = [];
  let getCallCount = 0;
  const { document, elements } = makeFakeDom(EXPORTER_ELEMENT_IDS);
  const sandbox = makeSandbox({
    document,
    URL,
    browser: {
      runtime: { sendMessage: async () => [], onMessage: { addListener() {} }, getURL: (p) => p },
      storage: {
        local: {
          get: async () => {
            getCallCount++;
            // pretend storage changed by the time the listener re-reads it; the first read
            // (initial load) still sees the old default
            return getCallCount === 1 ? {} : { exportFormat: 'json' };
          },
        },
        onChanged: { addListener: (fn) => { registeredListeners.push(fn); } },
      },
    },
  }, commonSrc, exportSrc);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(registeredListeners.length > 0, 'a storage.onChanged listener should have been registered');
  assert.doesNotMatch(elements.exportDesc.textContent, /JSON file/);

  registeredListeners.forEach((fn) => fn({ exportFormat: { newValue: 'json' } }, 'local'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(elements.exportDesc.textContent, /JSON file/);
});

testAsync('export.js real DOM: the AMO link uses the resolved add-on page and sits outside the label', async () => {
  const exact = 'https://addons.mozilla.org/en-US/firefox/addon/some-theme/';
  const { elements } = await renderRealExportList([
    { id: 'weird@id.example', name: 'Some Theme', version: '1.0', enabled: true, type: 'theme' },
  ], {
    resolveLinks: () => [{ id: 'weird@id.example', link: exact, linkType: 'amo-exact' }],
  });
  const row = elements.addonList.querySelector('.addon-row');
  const link = row.querySelector('a.match-label');
  await waitFor(() => link.href === exact, 'the resolved AMO page on the row link');

  assert.ok(link, 'the row should have a match-label link');
  assert.strictEqual(link.textContent, 'AMO');
  assert.strictEqual(link.href, exact, 'should use the resolved AMO page, not a name search');
  assert.strictEqual(link.dataset.pending, undefined, 'the link is no longer pending');

  const label = row.querySelector('label');
  assert.strictEqual(label.contains(link), false, 'the link must not be inside the label (it would be absorbed into the checkbox\'s accessible name)');
});

testAsync('export.js real DOM: a fallback link keeps its match label and uncertain styling', async () => {
  const { elements } = await renderRealExportList([
    { id: 'no-match@example.com', name: 'No Match', version: '1.0', enabled: true, type: 'extension' },
  ], {
    resolveLinks: () => [{
      id: 'no-match@example.com',
      link: 'https://addons.mozilla.org/en-US/firefox/search/?q=No%20Match',
      linkType: 'amo-search-fallback',
    }],
  });
  const row = elements.addonList.querySelector('.addon-row');
  const label = row.querySelector('label');
  await waitFor(() => label.textContent.includes('Search results'), 'the fallback match label');

  const kind = Array.from(label.querySelectorAll('span')).find((span) => span.dataset.linkKind === '1');
  assert.strictEqual(kind.textContent, 'Search results');
  assert.ok(kind.classList.contains('match-uncertain'));
});

async function renderExportListWithLiveSettings(addons, stored = {}) {
  const { document, elements } = makeFakeDom(EXPORTER_ELEMENT_IDS);
  const listeners = [];
  const sandbox = makeSandbox({
    document,
    URL,
    browser: {
      runtime: { sendMessage: async (msg) => (msg.type === 'listAddons' ? addons : undefined), onMessage: { addListener() {} }, getURL: (p) => p },
      storage: { local: { get: async () => stored }, onChanged: { addListener: (fn) => listeners.push(fn) } },
    },
  }, commonSrc, exportSrc);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const fire = (changes, area = 'local') => listeners.forEach((fn) => fn(changes, area));
  const names = () => elements.addonList.querySelectorAll('.addon-name').map((n) => n.textContent);
  return { elements, fire, names };
}

const LONG_NAMES = [
  { id: 'a@x', name: 'uBlock Origin - free ad blocker', version: '1.0', enabled: true, type: 'extension' },
  { id: 'b@x', name: 'Dark Reader: dark mode', version: '2.0', enabled: true, type: 'extension' },
];

testAsync('live names (Exporter): switching "Shorten add-on names" off shows the full names at once, and back on shortens them again', async () => {
  const { fire, names } = await renderExportListWithLiveSettings(LONG_NAMES);
  assert.deepStrictEqual(names(), ['Dark Reader', 'uBlock Origin'], 'starts shortened (the default)');
  fire({ shortenNames: { newValue: 'off' } });
  assert.deepStrictEqual(names(), ['Dark Reader: dark mode', 'uBlock Origin - free ad blocker']);
  fire({ shortenNames: { newValue: 'on' } });
  assert.deepStrictEqual(names(), ['Dark Reader', 'uBlock Origin']);
});

testAsync('live names (Exporter): a reset (the setting removed) goes back to the default, shortened', async () => {
  const { fire, names } = await renderExportListWithLiveSettings(LONG_NAMES, { shortenNames: 'off' });
  assert.deepStrictEqual(names(), ['Dark Reader: dark mode', 'uBlock Origin - free ad blocker'], 'starts with full names');
  fire({ shortenNames: { oldValue: 'off' } });  // removed, so no newValue
  assert.deepStrictEqual(names(), ['Dark Reader', 'uBlock Origin']);
});

testAsync('live names (Exporter): other settings and other storage areas leave the names alone', async () => {
  const { fire, names } = await renderExportListWithLiveSettings(LONG_NAMES);
  fire({ theme: { newValue: 'dark' } });
  fire({ shortenNames: { newValue: 'off' } }, 'sync');
  assert.deepStrictEqual(names(), ['Dark Reader', 'uBlock Origin']);
});

testAsync('live names (Exporter): a search in progress is applied again to the new names', async () => {
  const { elements, fire } = await renderExportListWithLiveSettings(LONG_NAMES);
  elements.searchInput.value = 'free ad';
  elements.searchInput.dispatchEvent('input');
  const visible = () => elements.addonList.querySelectorAll('.addon-row')
    .filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.addon-name').textContent);
  assert.deepStrictEqual(visible(), [], 'the search matches what is shown - the short names - so nothing yet');
  fire({ shortenNames: { newValue: 'off' } });
  assert.deepStrictEqual(visible(), ['uBlock Origin - free ad blocker'], 'now the full name is shown, and the search finds it without retyping');
});

