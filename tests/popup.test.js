// The popup's three buttons (src/popup/popup.js): Export and Import bring an
// already-open Exporter / Importer tab to the front, or open a new one;
// Settings opens the options page and asks an already-open Settings tab to
// replay its entrance. Each closes the popup afterwards. Also the other half:
// how those pages answer "are you open?" (answerWhereIsPage in page-ui.js).

const assert = require('assert');
const { test, testAsync, readSrc, readSrcs, makeSandbox } = require('./helpers');

function load({ sendMessage, tabsUpdate, tabsCreate, openOptionsPage } = {}) {
  const handlers = {};
  const calls = [];
  const sb = makeSandbox({
    document: { getElementById: (id) => ({ addEventListener: (type, fn) => { if (type === 'click') handlers[id] = fn; } }) },
    window: { close: () => calls.push(['close']) },
    browser: {
      tabs: {
        create: tabsCreate || (async (o) => { calls.push(['tabs.create', o.url]); }),
        update: tabsUpdate || (async (id, props) => { calls.push(['tabs.update', id, props.active]); }),
      },
      windows: { update: async (id, props) => { calls.push(['windows.update', id, props.focused]); } },
      runtime: {
        getURL: (p) => `moz-extension://x/${p}`,
        openOptionsPage: openOptionsPage || (async () => { calls.push(['openOptionsPage']); }),
        sendMessage: sendMessage || (async (m) => { calls.push(['sendMessage', m.type, m.page]); }),
      },
    },
  }, readSrc('src/popup/popup.js'));
  return { handlers, calls };
}

testAsync('popup: with no Exporter or Importer open, each opens its page in a new tab, then closes the popup', async () => {
  const { handlers, calls } = load();
  await handlers.exportBtn();
  await handlers.importBtn();
  assert.deepStrictEqual(calls, [
    ['sendMessage', 'whereIsPage', 'export'], ['tabs.create', 'moz-extension://x/src/export/export.html'], ['close'],
    ['sendMessage', 'whereIsPage', 'import'], ['tabs.create', 'moz-extension://x/src/import/import.html'], ['close'],
  ]);
});

testAsync('popup: an Exporter or Importer that is already open is brought to the front, not opened again', async () => {
  for (const button of ['exportBtn', 'importBtn']) {
    const { handlers, calls } = load({ sendMessage: async () => ({ tabId: 7, windowId: 3 }) });
    await handlers[button]();
    assert.deepStrictEqual(calls, [['tabs.update', 7, true], ['windows.update', 3, true], ['close']]);
  }
});

testAsync('popup: if the open tab cannot be focused (it has just closed), a new one is opened', async () => {
  const { handlers, calls } = load({
    sendMessage: async () => ({ tabId: 7, windowId: 3 }),
    tabsUpdate: async () => { throw new Error('Invalid tab ID: 7'); },
  });
  await handlers.importBtn();
  assert.deepStrictEqual(calls, [['tabs.create', 'moz-extension://x/src/import/import.html'], ['close']]);
});

testAsync('popup: if asking fails or the answer is junk, a new tab is opened', async () => {
  for (const sendMessage of [async () => { throw new Error('Could not establish connection'); }, async () => ({ tabId: 'seven' }), async () => null]) {
    const { handlers, calls } = load({ sendMessage });
    await handlers.exportBtn();
    assert.deepStrictEqual(calls, [['tabs.create', 'moz-extension://x/src/export/export.html'], ['close']]);
  }
});

testAsync('popup: Settings opens the options page, asks it to replay, then closes the popup', async () => {
  const { handlers, calls } = load();
  await handlers.settingsBtn();
  assert.deepStrictEqual(calls, [['openOptionsPage'], ['sendMessage', 'replaySettingsEntrance', undefined], ['close']]);
});

testAsync('popup: Settings still closes the popup when nothing is listening for the message', async () => {
  const { handlers, calls } = load({ sendMessage: async () => { throw new Error('Could not establish connection'); } });
  await handlers.settingsBtn();
  assert.deepStrictEqual(calls, [['openOptionsPage'], ['close']]);
});

testAsync('popup: the popup closes even when opening the options page fails', async () => {
  const { handlers, calls } = load({ openOptionsPage: async () => { throw new Error('no options page'); } });
  await handlers.settingsBtn();
  assert.deepStrictEqual(calls, [['close']]);
});

testAsync('popup: the popup closes even when the page cannot be opened at all', async () => {
  const { handlers, calls } = load({ tabsCreate: async () => { throw new Error('no tabs'); } });
  await handlers.exportBtn();
  assert.deepStrictEqual(calls, [['sendMessage', 'whereIsPage', 'export'], ['close']]);
});

// --- the page's side: answerWhereIsPage() ---

function loadPage(browserStub) {
  const sb = makeSandbox({ browser: browserStub }, readSrcs('src/common/core.js', 'src/common/page-ui.js'));
  return sb;
}
function stubWithTab(tab) {
  const listeners = [];
  return { listeners, browser: { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } }, tabs: { getCurrent: async () => tab } } };
}

testAsync('answerWhereIsPage: the page with the asked-for name answers with its own tab; other names and messages are ignored', async () => {
  const { listeners, browser } = stubWithTab({ id: 12, windowId: 4 });
  loadPage(browser).answerWhereIsPage('export');
  assert.strictEqual(listeners.length, 1);
  const answer = await listeners[0]({ type: 'whereIsPage', page: 'export' });
  assert.deepStrictEqual({ ...answer }, { tabId: 12, windowId: 4 });
  assert.strictEqual(listeners[0]({ type: 'whereIsPage', page: 'import' }), undefined);
  assert.strictEqual(listeners[0]({ type: 'exportProgress' }), undefined);
  assert.strictEqual(listeners[0](undefined), undefined);
});

testAsync('answerWhereIsPage: no tab, or a failing lookup, means no answer rather than an error', async () => {
  const none = stubWithTab(undefined);
  loadPage(none.browser).answerWhereIsPage('import');
  assert.strictEqual(await none.listeners[0]({ type: 'whereIsPage', page: 'import' }), undefined);
  const failing = { runtime: { onMessage: { addListener: (fn) => { failing.fn = fn; } } }, tabs: { getCurrent: async () => { throw new Error('no'); } } };
  loadPage(failing).answerWhereIsPage('import');
  assert.strictEqual(await failing.fn({ type: 'whereIsPage', page: 'import' }), undefined);
});

test('answerWhereIsPage: a page with no runtime messaging or tabs API is left alone', () => {
  loadPage(undefined).answerWhereIsPage('export');
  loadPage({}).answerWhereIsPage('export');
  loadPage({ runtime: {} }).answerWhereIsPage('export');
});

test('the Exporter and Importer answer to their own name', () => {
  assert.match(readSrc('src/export/export.js'), /answerWhereIsPage\('export',/);
  assert.match(readSrc('src/import/import.js'), /answerWhereIsPage\('import',/);
});
