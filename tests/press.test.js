// Tests for src/common/press.js - the click/tap feedback ring.
const assert = require('assert');
const vm = require('vm');
const { test, readSrc } = require('./helpers');

const pressSrc = readSrc('src/common/press.js');

// A fake element that knows which selectors it "matches" and records animate().
function makeEl({ rowLike = false, matchesTarget = true, disabled = false, ariaDisabled = false, classes = [] } = {}) {
  const el = {
    animations: [],
    disabled,
    classList: { contains: (c) => classes.includes(c) },
    getAttribute: (name) => (name === 'aria-disabled' && ariaDisabled ? 'true' : null),
    matches: (sel) => rowLike && /addon-row|settings-option-row/.test(sel),
    animate(keyframes, options) { el.animations.push({ keyframes, options }); return {}; },
    closest: (sel) => {
      const isRowSel = /addon-row|settings-option-row/.test(sel);
      if (isRowSel) return rowLike ? el : null;
      return matchesTarget ? el : null;
    },
  };
  return el;
}

function loadPress({ reducedMotion = false, ringValue = 'rgba(1, 2, 3, 0.5)' } = {}) {
  const listeners = {};
  const sandbox = {
    document: {
      documentElement: {},
      addEventListener: (type, fn, capture) => { listeners[type] = { fn, capture }; },
    },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: (name) => (name === '--press-ring' ? ` ${ringValue} ` : '') }),
  };
  vm.createContext(sandbox);
  vm.runInContext(pressSrc, sandbox);
  return { listeners };
}

test('press: listens for pointerdown and click, both in the capture phase', () => {
  const { listeners } = loadPress();
  assert.strictEqual(listeners.pointerdown.capture, true);
  assert.strictEqual(listeners.click.capture, true);
});

test('press: pressing a button sends out a ring that fades (box-shadow spread 0 -> 12px)', () => {
  const { listeners } = loadPress();
  const btn = makeEl();
  listeners.pointerdown.fn({ target: btn, pointerType: 'mouse', button: 0 });
  assert.strictEqual(btn.animations.length, 1);
  const [from, to] = btn.animations[0].keyframes;
  assert.strictEqual(from.boxShadow, '0 0 0 0 rgba(1, 2, 3, 0.5)', 'colour comes from --press-ring');
  assert.strictEqual(to.boxShadow, '0 0 0 12px transparent');
  assert.strictEqual(btn.animations[0].options.duration, 520);
});

test('press: list rows flash from the inside instead (their container clips outside shadows)', () => {
  const { listeners } = loadPress();
  const row = makeEl({ rowLike: true });
  listeners.pointerdown.fn({ target: row, pointerType: 'mouse', button: 0 });
  const [from, to] = row.animations[0].keyframes;
  assert.match(from.boxShadow, /^inset 0 0 0 999px /);
  assert.strictEqual(to.boxShadow, 'inset 0 0 0 999px transparent');
});

test('press: pressing something inside a row pulses the whole row (rows are matched first)', () => {
  const { listeners } = loadPress();
  const row = makeEl({ rowLike: true });
  // The checkbox itself is a valid target, but the row around it wins.
  const checkbox = { closest: (sel) => (/addon-row|settings-option-row/.test(sel) ? row : checkbox) };
  listeners.pointerdown.fn({ target: checkbox, pointerType: 'touch', button: 0 });
  assert.strictEqual(row.animations.length, 1);
});

test('press: right/middle mouse buttons do nothing, touch and pen always count', () => {
  const { listeners } = loadPress();
  const btn = makeEl();
  listeners.pointerdown.fn({ target: btn, pointerType: 'mouse', button: 2 });
  listeners.pointerdown.fn({ target: btn, pointerType: 'mouse', button: 1 });
  assert.strictEqual(btn.animations.length, 0);
  listeners.pointerdown.fn({ target: btn, pointerType: 'touch', button: 0 });
  listeners.pointerdown.fn({ target: btn, pointerType: 'pen', button: 0 });
  assert.strictEqual(btn.animations.length, 2);
});

test('press: keyboard activation (a click with detail 0) pulses; a real mouse click does not pulse twice', () => {
  const { listeners } = loadPress();
  const btn = makeEl();
  listeners.click.fn({ target: btn, detail: 0 });
  assert.strictEqual(btn.animations.length, 1);
  listeners.click.fn({ target: btn, detail: 1 });
  assert.strictEqual(btn.animations.length, 1, 'the pointerdown already pulsed for a mouse click');
});

test('press: disabled buttons, aria-disabled controls and disabled rows do not pulse', () => {
  const { listeners } = loadPress();
  for (const opts of [{ disabled: true }, { ariaDisabled: true }, { classes: ['row-disabled'] }]) {
    const el = makeEl(opts);
    listeners.pointerdown.fn({ target: el, pointerType: 'mouse', button: 0 });
    assert.strictEqual(el.animations.length, 0, JSON.stringify(opts));
  }
});

test('press: nothing happens for reduced motion, non-interactive targets, or a missing target', () => {
  const reduced = loadPress({ reducedMotion: true });
  const btn = makeEl();
  reduced.listeners.pointerdown.fn({ target: btn, pointerType: 'mouse', button: 0 });
  assert.strictEqual(btn.animations.length, 0);

  const { listeners } = loadPress();
  const plain = makeEl({ matchesTarget: false });
  listeners.pointerdown.fn({ target: plain, pointerType: 'mouse', button: 0 });
  assert.strictEqual(plain.animations.length, 0);
  listeners.pointerdown.fn({ target: null, pointerType: 'mouse', button: 0 });
  listeners.pointerdown.fn({ target: {}, pointerType: 'mouse', button: 0 });
});

test('press: falls back to a built-in colour when --press-ring is not defined', () => {
  const { listeners } = loadPress({ ringValue: '' });
  const btn = makeEl();
  listeners.pointerdown.fn({ target: btn, pointerType: 'mouse', button: 0 });
  assert.match(btn.animations[0].keyframes[0].boxShadow, /rgba\(0, 96, 223, 0\.4\)/);
});

test('press: a page where animate() is unavailable (old browser) is simply left alone', () => {
  const { listeners } = loadPress();
  const el = makeEl();
  el.animate = undefined;
  listeners.pointerdown.fn({ target: el, pointerType: 'mouse', button: 0 });
});

test('press: loading it where there is no document is a safe no-op', () => {
  const bare = {};
  vm.createContext(bare);
  vm.runInContext(pressSrc, bare);
});
