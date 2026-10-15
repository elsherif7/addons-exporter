// The popup's three buttons (src/popup/popup.js): Export and Import open their
// page in a new tab, Settings opens the options page and asks an already-open
// Settings tab to replay its entrance. Each closes the popup afterwards.

const assert = require('assert');
const vm = require('vm');
const { testAsync, readSrc } = require('./helpers');

function load({ sendMessage } = {}) {
  const handlers = {};
  const calls = [];
  const sb = {
    document: { getElementById: (id) => ({ addEventListener: (type, fn) => { if (type === 'click') handlers[id] = fn; } }) },
    window: { close: () => calls.push(['close']) },
    browser: {
      tabs: { create: async (o) => { calls.push(['tabs.create', o.url]); } },
      runtime: {
        getURL: (p) => `moz-extension://x/${p}`,
        openOptionsPage: async () => { calls.push(['openOptionsPage']); },
        sendMessage: sendMessage || (async (m) => { calls.push(['sendMessage', m.type]); }),
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(readSrc('src/popup/popup.js'), sb);
  return { handlers, calls };
}

testAsync('popup: Export and Import each open their page in a new tab, then close the popup', async () => {
  const { handlers, calls } = load();
  await handlers.exportBtn();
  await handlers.importBtn();
  assert.deepStrictEqual(calls, [
    ['tabs.create', 'moz-extension://x/src/export/export.html'], ['close'],
    ['tabs.create', 'moz-extension://x/src/import/import.html'], ['close'],
  ]);
});

testAsync('popup: Settings opens the options page, asks it to replay, then closes the popup', async () => {
  const { handlers, calls } = load();
  await handlers.settingsBtn();
  assert.deepStrictEqual(calls, [['openOptionsPage'], ['sendMessage', 'replaySettingsEntrance'], ['close']]);
});

testAsync('popup: Settings still closes the popup when nothing is listening for the message', async () => {
  const { handlers, calls } = load({ sendMessage: async () => { throw new Error('Could not establish connection'); } });
  await handlers.settingsBtn();
  assert.deepStrictEqual(calls, [['openOptionsPage'], ['close']]);
});
