// Tests for src/common/theme.js. Loads the real source via vm with a
// fake document/browser.storage, same pattern as the other test files.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc } = require('./helpers');

const themeSrc = readSrc('src/common/theme.js');

function loadThemeInSandbox(storageGetImpl, onChangedImpl) {
  const setAttributeCalls = [];
  const storage = {
    local: {
      get: storageGetImpl || (async () => ({})),
    },
  };
  if (onChangedImpl) storage.onChanged = onChangedImpl;
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name, value) => setAttributeCalls.push([name, value]),
      },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    browser: { storage },
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

// --- A33: cross-tab theme sync via storage.onChanged ---

test('storage.onChanged: a theme change from another tab is applied here too', () => {
  let registeredListener = null;
  const { setAttributeCalls } = loadThemeInSandbox(undefined, {
    addListener: (fn) => { registeredListener = fn; },
  });
  assert.ok(registeredListener, 'a storage.onChanged listener should have been registered');
  registeredListener({ theme: { newValue: 'dark', oldValue: 'light' } }, 'local');
  assert.deepStrictEqual(setAttributeCalls[setAttributeCalls.length - 1], ['data-theme', 'dark']);
});

test('storage.onChanged: a change to an unrelated key is ignored', () => {
  let registeredListener = null;
  const { setAttributeCalls } = loadThemeInSandbox(undefined, {
    addListener: (fn) => { registeredListener = fn; },
  });
  const before = setAttributeCalls.length;
  registeredListener({ someOtherKey: { newValue: 'x' } }, 'local');
  assert.strictEqual(setAttributeCalls.length, before, 'should not react to a change that isn\'t the theme key');
});

test('storage.onChanged: a change in a different storage area is ignored', () => {
  let registeredListener = null;
  const { setAttributeCalls } = loadThemeInSandbox(undefined, {
    addListener: (fn) => { registeredListener = fn; },
  });
  const before = setAttributeCalls.length;
  registeredListener({ theme: { newValue: 'dark' } }, 'sync');
  assert.strictEqual(setAttributeCalls.length, before, 'should only react to the local storage area');
});

test('loading theme.js with no storage.onChanged at all does not throw', () => {
  assert.doesNotThrow(() => loadThemeInSandbox());
});

// --- smooth light/dark switch (.theme-switching) ---

function loadThemeWithClassList() {
  const classes = new Set();
  const timers = [];
  let attr = null;
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name, value) => { if (name === 'data-theme') attr = value; },
        getAttribute: (name) => (name === 'data-theme' ? attr : null),
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    browser: { storage: { local: { get: async () => ({}) } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeSrc, sandbox);
  return { sandbox, classes, timers };
}

testAsync('theme: the first apply on page load never animates', async () => {
  const { sandbox, classes } = loadThemeWithClassList();
  await sandbox.initTheme();
  sandbox.applyTheme('dark'); // after init: this one may animate
  assert.strictEqual(classes.has('theme-switching'), true);
  const fresh = loadThemeWithClassList();
  fresh.sandbox.applyTheme('dark'); // before init finishes: must not animate
  assert.strictEqual(fresh.classes.has('theme-switching'), false);
});

testAsync('theme: a real change adds .theme-switching and a timer removes it; same theme does nothing', async () => {
  const { sandbox, classes, timers } = loadThemeWithClassList();
  await sandbox.initTheme(); // applies light
  sandbox.applyTheme('light');
  assert.strictEqual(classes.has('theme-switching'), false, 'no change, no animation');
  sandbox.applyTheme('dark');
  assert.strictEqual(classes.has('theme-switching'), true);
  timers[timers.length - 1]();
  assert.strictEqual(classes.has('theme-switching'), false, 'cleaned up after the transition');
});
