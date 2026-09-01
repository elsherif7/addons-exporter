// Plain Node test runner for common.js - no framework, no dependencies.
// Loads the real common.js source via vm so these tests run against the
// actual file, not a copy. Run with: node test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'common.js'), 'utf8');
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes } = sandbox;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.message}`);
  }
}

// --- escapeHtml ---

test('escapeHtml escapes & < > " \'', () => {
  assert.strictEqual(
    escapeHtml(`<script>alert("x")</script> & 'quotes'`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;'
  );
});

test('escapeHtml leaves plain text untouched', () => {
  assert.strictEqual(escapeHtml('uBlock Origin 1.58.0'), 'uBlock Origin 1.58.0');
});

test('escapeHtml coerces non-strings via String()', () => {
  assert.strictEqual(escapeHtml(42), '42');
  assert.strictEqual(escapeHtml(undefined), 'undefined');
});

// --- isSafeUrl ---

test('isSafeUrl accepts http and https', () => {
  assert.strictEqual(isSafeUrl('https://example.com'), true);
  assert.strictEqual(isSafeUrl('http://example.com'), true);
});

test('isSafeUrl rejects javascript: URLs', () => {
  assert.strictEqual(isSafeUrl('javascript:alert(1)'), false);
});

test('isSafeUrl rejects malformed strings', () => {
  assert.strictEqual(isSafeUrl('not a url'), false);
  assert.strictEqual(isSafeUrl(''), false);
});

test('isSafeUrl rejects near-miss schemes (the startsWith("http") bug)', () => {
  assert.strictEqual(isSafeUrl('httpx://evil.example'), false);
  assert.strictEqual(isSafeUrl('http-evil:something'), false);
});

// --- byName ---

test('byName sorts case-insensitively', () => {
  const items = [{ name: 'banana' }, { name: 'Apple' }, { name: 'cherry' }];
  items.sort(byName);
  assert.deepStrictEqual(items.map(i => i.name), ['Apple', 'banana', 'cherry']);
});

// --- filterAddonRows ---
// Minimal fake DOM - just enough surface area (children, classList.contains,
// style.display, querySelector) for filterAddonRows to run against.

function makeEl(cls, labelText) {
  return {
    style: { display: '' },
    classList: { contains: (c) => c === cls },
    querySelector: (sel) => (sel === 'label' && labelText != null ? { textContent: labelText } : null),
  };
}

function makeContainer() {
  const enabledHeading = makeEl('group-heading');
  const row1 = makeEl('addon-row', 'uBlock Origin 1.58.0');
  const row2 = makeEl('addon-row', 'Dark Reader 4.9.90');
  const disabledHeading = makeEl('group-heading');
  const row3 = makeEl('addon-row', 'Old Extension 0.5');
  return {
    container: { children: [enabledHeading, row1, row2, disabledHeading, row3] },
    enabledHeading, row1, row2, disabledHeading, row3,
  };
}

test('filterAddonRows: matching query hides non-matches, keeps matching heading visible', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'dark');
  assert.strictEqual(anyMatch, true);
  assert.strictEqual(enabledHeading.style.display, '');
  assert.strictEqual(row1.style.display, 'none');
  assert.strictEqual(row2.style.display, '');
  assert.strictEqual(disabledHeading.style.display, 'none');
  assert.strictEqual(row3.style.display, 'none');
});

test('filterAddonRows: empty query shows everything', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, '');
  assert.strictEqual(anyMatch, true);
  for (const el of [enabledHeading, row1, row2, disabledHeading, row3]) {
    assert.strictEqual(el.style.display, '');
  }
});

test('filterAddonRows: no matches hides everything and returns false', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'zzz-nomatch');
  assert.strictEqual(anyMatch, false);
  for (const el of [enabledHeading, row1, row2, disabledHeading, row3]) {
    assert.strictEqual(el.style.display, 'none');
  }
});

// --- byName (tie-breaking) ---

test('byName with identical names: both items survive the sort', () => {
  const items = [{ name: 'uBlock Origin' }, { name: 'uBlock Origin' }];
  items.sort(byName);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].name, 'uBlock Origin');
  assert.strictEqual(items[1].name, 'uBlock Origin');
});

// --- visibleCheckboxes ---
// Minimal fake checkboxes — visibleCheckboxes only needs cb.closest('.addon-row')
// and the row's style.display.

function makeCheckbox(rowDisplay) {
  const row = { style: { display: rowDisplay } };
  return { closest: (sel) => (sel === '.addon-row' ? row : null) };
}

test('visibleCheckboxes: returns all checkboxes when all rows are visible', () => {
  const cbs = [makeCheckbox(''), makeCheckbox(''), makeCheckbox('')];
  const visible = visibleCheckboxes(cbs);
  assert.strictEqual(visible.length, 3);
});

test('visibleCheckboxes: excludes checkboxes whose row is hidden', () => {
  const cbs = [makeCheckbox(''), makeCheckbox('none'), makeCheckbox('')];
  const visible = visibleCheckboxes(cbs);
  assert.strictEqual(visible.length, 2);
  assert.strictEqual(visible[0], cbs[0]);
  assert.strictEqual(visible[1], cbs[2]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
