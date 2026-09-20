// Tests for src/common/theme.js. Loads the real source via vm with a
// fake document/browser.storage, same pattern as the other test files.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc } = require('./helpers');

const themeSrc = readSrc('src/common/theme.js');

function loadThemeInSandbox(storageGetImpl) {
  const setAttributeCalls = [];
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name, value) => setAttributeCalls.push([name, value]),
      },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    browser: {
      storage: {
        local: {
          get: storageGetImpl || (async () => ({})),
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeSrc, sandbox);
  return { sandbox, setAttributeCalls };
}

test('resolveTheme: only "dark" resolves to dark - anything else falls back to light', () => {
  const { sandbox } = loadThemeInSandbox();
  assert.strictEqual(sandbox.resolveTheme({ theme: 'dark' }), 'dark');
  assert.strictEqual(sandbox.resolveTheme({ theme: 'light' }), 'light');
  assert.strictEqual(sandbox.resolveTheme({}), 'light');
  assert.strictEqual(sandbox.resolveTheme({ theme: 'nonsense' }), 'light');
  assert.strictEqual(sandbox.resolveTheme(undefined), 'light');
});

test('applyTheme: sets data-theme to "dark" only for "dark", "light" for anything else', () => {
  const { sandbox, setAttributeCalls } = loadThemeInSandbox();
  sandbox.applyTheme('dark');
  sandbox.applyTheme('light');
  sandbox.applyTheme('nonsense');
  assert.deepStrictEqual(setAttributeCalls, [
    ['data-theme', 'dark'],
    ['data-theme', 'light'],
    ['data-theme', 'light'],
  ]);
});

testAsync('initTheme: reads the stored theme and applies it', async () => {
  const { sandbox, setAttributeCalls } = loadThemeInSandbox(async () => ({ theme: 'dark' }));
  await sandbox.initTheme();
  assert.deepStrictEqual(setAttributeCalls[setAttributeCalls.length - 1], ['data-theme', 'dark']);
});

testAsync('initTheme: falls back to light if storage.local.get throws', async () => {
  const { sandbox, setAttributeCalls } = loadThemeInSandbox(async () => {
    throw new Error('storage unavailable');
  });
  await sandbox.initTheme();
  assert.deepStrictEqual(setAttributeCalls[setAttributeCalls.length - 1], ['data-theme', 'light']);
});
