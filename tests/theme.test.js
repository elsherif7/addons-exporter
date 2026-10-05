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

// --- view-transition switch (with the color glide as the fallback) ---

function loadThemeForSwitch({ reducedMotion = false, withViewTransitions = true } = {}) {
  const transitions = [];
  const classes = new Set();
  const timers = [];
  let attr = null;
  const document = {
    documentElement: {
      setAttribute: (name, value) => { if (name === 'data-theme') attr = value; },
      getAttribute: (name) => (name === 'data-theme' ? attr : null),
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    },
  };
  if (withViewTransitions) {
    // Real browsers call the update callback for us once the old frame is captured.
    document.startViewTransition = (cb) => { transitions.push(cb); };
  }
  const sandbox = {
    document,
    matchMedia: () => ({ matches: reducedMotion }),
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    browser: { storage: { local: { get: async () => ({}) } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeSrc, sandbox);
  return { sandbox, transitions, classes, timers, getAttr: () => attr };
}

testAsync('theme: with view transitions, a real change is wrapped in startViewTransition (and the attribute set inside it)', async () => {
  const ctx = loadThemeForSwitch();
  await ctx.sandbox.initTheme(); // settles on light
  ctx.sandbox.applyTheme('dark');
  assert.strictEqual(ctx.transitions.length, 1);
  assert.strictEqual(ctx.getAttr(), 'light', 'the theme must only flip inside the transition callback');
  ctx.transitions[0]();
  assert.strictEqual(ctx.getAttr(), 'dark');
  assert.strictEqual(ctx.classes.has('theme-switching'), false, 'no color glide on top of the view transition');
});

testAsync('theme: the first apply on page load never animates', async () => {
  const ctx = loadThemeForSwitch();
  ctx.sandbox.applyTheme('dark'); // before initTheme finishes
  assert.strictEqual(ctx.transitions.length, 0);
  assert.strictEqual(ctx.getAttr(), 'dark', 'applied immediately');
  assert.strictEqual(ctx.classes.has('theme-switching'), false);
});

testAsync('theme: without view transitions, colors glide via .theme-switching, removed by a timer', async () => {
  const ctx = loadThemeForSwitch({ withViewTransitions: false });
  await ctx.sandbox.initTheme();
  ctx.sandbox.applyTheme('dark');
  assert.strictEqual(ctx.getAttr(), 'dark');
  assert.strictEqual(ctx.classes.has('theme-switching'), true);
  ctx.timers[ctx.timers.length - 1]();
  assert.strictEqual(ctx.classes.has('theme-switching'), false);
});

testAsync('theme: no animation when the theme does not change, or when reduced motion is on', async () => {
  const same = loadThemeForSwitch();
  await same.sandbox.initTheme();
  same.sandbox.applyTheme('light');
  assert.strictEqual(same.transitions.length, 0);
  assert.strictEqual(same.classes.has('theme-switching'), false);

  const reduced = loadThemeForSwitch({ reducedMotion: true });
  await reduced.sandbox.initTheme();
  reduced.sandbox.applyTheme('dark');
  assert.strictEqual(reduced.transitions.length, 0);
  assert.strictEqual(reduced.classes.has('theme-switching'), false);
  assert.strictEqual(reduced.getAttr(), 'dark', 'still switches, just instantly');
});
