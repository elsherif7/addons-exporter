// Tests for the shared helpers in src/common/core.js, page-ui.js and src/background/amo.js. Loads the real
// source via vm so these run against the actual file, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext, readCommon, makeFakeDom, makeSandbox } = require('./helpers');

const commonSrc = readCommon();
const sandbox = makeSandbox({ URL }, commonSrc);

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes, extractTranslatedField, isPlausibleNameMatch, shortName } = sandbox;

// The exported report carries its own copy of filterAddonRows (it can't load
// page-ui.js once saved elsewhere). The report's script lives in
// src/background/report-inline.js - the real file, not a hand-copied
// snapshot - so an edit to one copy and not the other gets caught here
// instead of silently drifting.
const reportInlineScript = readSrc('src/background/report-inline.js');

// Runs the report's inline script against a fake `addonList` container and
// returns its filterAddonRows, so it can be called directly the same way
// page-ui.js's version is called in the test below.
function loadReportFilterAddonRows(addonListContainer) {
  // The inline script calls applyTheme() on load, which needs setAttribute
  // on the document element and also reads from localStorage; it also wires
  // up the theme toggle's click listener. Provide minimal stubs for both so
  // the script can initialise without throwing.
  const stubEl = () => ({ style: {}, addEventListener() {}, setAttribute() {}, textContent: '', children: [], classList: { contains: () => false }, querySelector: () => null });
  const reportDocument = {
    documentElement: { setAttribute() {} },
    getElementById(id) {
      return id === 'addonList' ? addonListContainer : stubEl();
    },
  };
  const reportSandbox = makeSandbox({
    document: reportDocument,
    localStorage: { getItem() { return null; }, setItem() {} },
  }, reportInlineScript);
  return reportSandbox.filterAddonRows;
}

// --- escapeHtml ---

test('escapeHtml escapes & < > " \'', () => {
  assert.strictEqual(escapeHtml(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
});

test('escapeHtml leaves plain text untouched', () => {
  assert.strictEqual(escapeHtml('uBlock Origin 1.58.0'), 'uBlock Origin 1.58.0');
});

test('escapeHtml coerces non-strings via String()', () => {
  assert.strictEqual(escapeHtml(42), '42');
  assert.strictEqual(escapeHtml(null), 'null');
  assert.strictEqual(escapeHtml(undefined), 'undefined');
});

// --- isSafeUrl ---

test('linkLabel: AMO for addons.mozilla.org, the real site for anything else, "Link" for junk', () => {
  const { linkLabel } = sandbox;
  assert.strictEqual(linkLabel('https://addons.mozilla.org/en-US/firefox/addon/x/'), 'AMO');
  assert.strictEqual(linkLabel('https://ADDONS.mozilla.org/search/?q=x'), 'AMO');
  assert.strictEqual(linkLabel('https://example.com/tab,stash?x=1'), 'example.com');
  assert.strictEqual(linkLabel('https://www.example.com/'), 'example.com');
  assert.strictEqual(linkLabel('https://addons.mozilla.org.evil.example/'), 'addons.mozilla.org.evil.example', 'a look-alike host is never called AMO');
  assert.strictEqual(linkLabel('not a url'), 'Link');
  assert.strictEqual(linkLabel(''), 'Link');
  assert.strictEqual(linkLabel(undefined), 'Link');
});

test('isSafeUrl accepts http and https', () => {
  assert.strictEqual(isSafeUrl('http://example.com'), true);
  assert.strictEqual(isSafeUrl('https://example.com'), true);
});

test('isSafeUrl rejects javascript: URLs', () => {
  assert.strictEqual(isSafeUrl('javascript:alert(1)'), false);
});

test('isSafeUrl rejects malformed strings', () => {
  assert.strictEqual(isSafeUrl('not a url'), false);
  assert.strictEqual(isSafeUrl(''), false);
});

test('isSafeUrl rejects near-miss schemes (the startsWith("http") bug)', () => {
  assert.strictEqual(isSafeUrl('httpx://example.com'), false);
});

// --- byName ---

test('byName sorts case-insensitively', () => {
  const items = [{ name: 'uBlock Origin' }, { name: 'Dark Reader' }, { name: 'adblock' }];
  items.sort(byName);
  assert.deepStrictEqual(items.map((i) => i.name), ['adblock', 'Dark Reader', 'uBlock Origin']);
});

// --- filterAddonRows ---
// Minimal fake DOM - just enough surface area (children, classList.contains,
// style.display, querySelector, textContent) for filterAddonRows to run
// against. Name and version are modeled as separate sub-elements, same as
// the real .addon-name / .addon-version markup, so tests can tell them apart.

// classList stand-in: reports its base class, and records the
// .is-filtered class that setFilterVisible() toggles for the search fade.
function fakeClassList(baseCls) {
  const extra = new Set();
  return {
    contains: (c) => c === baseCls || extra.has(c),
    toggle: (c, force) => { if (force) extra.add(c); else extra.delete(c); return !!force; },
  };
}

function makeEl(cls, nameText, versionText) {
  const nameEl = nameText != null ? { textContent: nameText } : null;
  return {
    style: { display: '' },
    classList: fakeClassList(cls),
    querySelector: (sel) => (sel === '.addon-name' ? nameEl : null),
    textContent: [nameText, versionText].filter((t) => t != null).join(' '),
    children: [],
  };
}

function makeGroupBox(heading, rows) {
  const box = {
    style: { display: '' },
    classList: fakeClassList('group-box'),
    querySelector: () => null,
    children: [heading, ...rows],
  };
  return box;
}

function makeGroupContainer(heading, rows) {
  const box = makeGroupBox(heading, rows);
  const container = {
    style: { display: '' },
    classList: fakeClassList('group-container'),
    querySelector: (sel) => sel === '.group-box' ? box : null,
    children: [heading, box],
  };
  return { container, box };
}

// filterAddonRows now finds group-containers via container.querySelectorAll
// rather than only container.children (see the A1 fix), since export.js/
// import.js can nest them inside an outer .groups-outer-box. This fixture
// doesn't nest them, but still needs querySelectorAll to exist - a plain
// recursive walk by class name is all these fixtures ever need it for.
function queryAllByClass(root, selector) {
  const cls = selector.replace(/^\./, '');
  const out = [];
  (function walk(node) {
    for (const child of node.children || []) {
      if (child.classList && child.classList.contains(cls)) out.push(child);
      walk(child);
    }
  })(root);
  return out;
}

function makeContainer() {
  const enabledHeading = makeEl('group-heading');
  const row1 = makeEl('addon-row', 'uBlock Origin', '1.58.0');
  const row2 = makeEl('addon-row', 'Dark Reader', '4.9.90');
  const disabledHeading = makeEl('group-heading');
  const row3 = makeEl('addon-row', 'Old Extension', '0.5');
  const { container: enabledBox } = makeGroupContainer(enabledHeading, [row1, row2]);
  const { container: disabledBox } = makeGroupContainer(disabledHeading, [row3]);
  const container = { children: [enabledBox, disabledBox] };
  container.querySelectorAll = (sel) => queryAllByClass(container, sel);
  return {
    container,
    enabledBox, enabledHeading, row1, row2,
    disabledBox, disabledHeading, row3,
  };
}

test('filterAddonRows: matching query hides non-matches, keeps matching group-box visible', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'dark');
  assert.strictEqual(anyMatch, true);
  assert.strictEqual(enabledBox.style.display, '');
  assert.strictEqual(row1.style.display, 'none');
  assert.strictEqual(row2.style.display, '');
  assert.strictEqual(disabledBox.style.display, 'none');
  assert.strictEqual(row3.style.display, 'none');
});

test('filterAddonRows: empty query shows everything', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, '');
  assert.strictEqual(anyMatch, true);
  for (const el of [enabledBox, row1, row2, disabledBox, row3]) {
    assert.strictEqual(el.style.display, '');
  }
});

test('filterAddonRows: no matches hides everything and returns false', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'zzz-nomatch');
  assert.strictEqual(anyMatch, false);
  for (const el of [enabledBox, row1, row2, disabledBox, row3]) {
    assert.strictEqual(el.style.display, 'none');
  }
});

test('filterAddonRows: query matching a version number does not match the row', () => {
  const { container, row1 } = makeContainer(); // row1 is "uBlock Origin" / "1.58.0"
  const anyMatch = filterAddonRows(container, '58');
  assert.strictEqual(anyMatch, false);
  assert.strictEqual(row1.style.display, 'none');
});

test('filterAddonRows: page-ui.js and the report\'s inline copy agree on the same fixture', () => {
  // Both now use group-container structure — use the same fixture for both.
  const fixtureA = makeContainer();
  const fixtureB = makeContainer();

  const reportFilterAddonRows = loadReportFilterAddonRows(fixtureB.container);

  for (const query of ['dark', '58', '', 'zzz-nomatch']) {
    const anyMatchA = filterAddonRows(fixtureA.container, query);
    const anyMatchB = reportFilterAddonRows(query);
    assert.strictEqual(anyMatchA, anyMatchB, `anyMatch differed for query "${query}"`);

    const rowsA = [fixtureA.row1, fixtureA.row2, fixtureA.row3];
    const rowsB = [fixtureB.row1, fixtureB.row2, fixtureB.row3];
    rowsA.forEach((el, i) => {
      assert.strictEqual(el.style.display, rowsB[i].style.display, `row ${i} display differed for query "${query}"`);
    });
  }
});

// --- filterAddonRows: group-containers nested inside an outer wrapper ---
// export.js's renderList() and import.js's renderAddonList() both wrap
// their group-containers in an outer .groups-outer-box (see appendGroup()
// in each file) rather than appending them straight into the list
// container. filterAddonRows used to only ever look at container.children,
// so once that wrapper was introduced it silently stopped finding any
// group-container at all - search matched nothing and "no matches" showed
// for every query, including a matching one. This section pins that
// nested case down directly instead of relying on the flat fixture above.

function makeContainerWithOuterBox() {
  const { container: flatContainer, ...rest } = makeContainer();
  const outerBox = {
    style: { display: '' },
    classList: { contains: (c) => c === 'groups-outer-box' },
    querySelector: () => null,
    children: flatContainer.children,
  };
  const container = { children: [outerBox] };
  container.querySelectorAll = (sel) => queryAllByClass(container, sel);
  return { container, outerBox, ...rest };
}

test('filterAddonRows: finds group-containers nested inside an outer wrapper, not just direct children', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainerWithOuterBox();
  const anyMatch = filterAddonRows(container, 'dark');
  assert.strictEqual(anyMatch, true, 'a query matching a row inside a nested group-container should still report a match');
  assert.strictEqual(enabledBox.style.display, '');
  assert.strictEqual(row1.style.display, 'none');
  assert.strictEqual(row2.style.display, '');
  assert.strictEqual(disabledBox.style.display, 'none');
  assert.strictEqual(row3.style.display, 'none');
});

test('filterAddonRows: nested group-containers - no matches hides everything and returns false', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainerWithOuterBox();
  const anyMatch = filterAddonRows(container, 'zzz-nomatch');
  assert.strictEqual(anyMatch, false);
  for (const el of [enabledBox, row1, row2, disabledBox, row3]) {
    assert.strictEqual(el.style.display, 'none');
  }
});

test('filterAddonRows: nested group-containers - empty query shows everything', () => {
  const { container, enabledBox, row1, row2, disabledBox, row3 } = makeContainerWithOuterBox();
  const anyMatch = filterAddonRows(container, '');
  assert.strictEqual(anyMatch, true);
  for (const el of [enabledBox, row1, row2, disabledBox, row3]) {
    assert.strictEqual(el.style.display, '');
  }
});

test('filterAddonRows: page-ui.js and the report\'s inline copy agree with a nested outer wrapper too', () => {
  const fixtureA = makeContainerWithOuterBox();
  const fixtureB = makeContainerWithOuterBox();

  const reportFilterAddonRows = loadReportFilterAddonRows(fixtureB.container);

  for (const query of ['dark', '58', '', 'zzz-nomatch']) {
    const anyMatchA = filterAddonRows(fixtureA.container, query);
    const anyMatchB = reportFilterAddonRows(query);
    assert.strictEqual(anyMatchA, anyMatchB, `anyMatch differed for query "${query}"`);

    const rowsA = [fixtureA.row1, fixtureA.row2, fixtureA.row3];
    const rowsB = [fixtureB.row1, fixtureB.row2, fixtureB.row3];
    rowsA.forEach((el, i) => {
      assert.strictEqual(el.style.display, rowsB[i].style.display, `row ${i} display differed for query "${query}"`);
    });
  }
});

// --- byName (tie-breaking) ---

test('byName: locale-aware and case-insensitive, and a stable sort keeps identical names in order', () => {
  // Identical names compare equal...
  assert.strictEqual(byName({ name: 'uBlock Origin' }, { name: 'uBlock Origin' }), 0);
  // ...and sensitivity: 'base' makes the comparison case- and accent-insensitive.
  assert.strictEqual(byName({ name: 'UBlock' }, { name: 'ublock' }), 0);
  assert.ok(byName({ name: 'alpha' }, { name: 'beta' }) < 0);
  assert.ok(byName({ name: 'beta' }, { name: 'alpha' }) > 0);
  // Two add-ons with the same name keep their original order (a stable sort),
  // so an export never reshuffles them.
  const first = { name: 'Same', id: 'first' };
  const second = { name: 'Same', id: 'second' };
  const sorted = [second, first].sort(byName);
  assert.deepStrictEqual(sorted.map((a) => a.id), ['second', 'first']);
});

// --- extractTranslatedField ---
// AMO's API returns translated fields (name, summary, etc.) as a
// locale-keyed object unless a `lang` param is passed - findAmoPage()
// doesn't pass one, so it always gets the object form back.

test('extractTranslatedField: plain string passes through unchanged', () => {
  assert.strictEqual(extractTranslatedField('uBlock Origin'), 'uBlock Origin');
});

test('extractTranslatedField: locale-keyed object picks a usable value', () => {
  assert.strictEqual(extractTranslatedField({ 'en-US': 'uBlock Origin', fr: 'uBlock Origin FR' }), 'uBlock Origin');
});

test('extractTranslatedField: null/undefined/empty object returns empty string', () => {
  assert.strictEqual(extractTranslatedField(null), '');
  assert.strictEqual(extractTranslatedField(undefined), '');
  assert.strictEqual(extractTranslatedField({}), '');
});

// --- isPlausibleNameMatch ---
// Guards findAmoPage()'s fuzzy name search from handing back an
// unrelated add-on just because it happened to rank first.

test('isPlausibleNameMatch: exact name (case/whitespace-insensitive) matches', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', '  UBLOCK   origin  '), true);
});

test('isPlausibleNameMatch: a listing title with an extra tagline still matches', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', 'uBlock Origin: Ad Blocker'), true);
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin: Ad Blocker', 'uBlock Origin'), true);
});

test('isPlausibleNameMatch: reordered/extra shared words still match', () => {
  assert.strictEqual(isPlausibleNameMatch('Dark Reader Night Mode', 'Night Mode Dark Reader'), true);
});

test('isPlausibleNameMatch: an unrelated result is rejected', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', 'Grammarly for Firefox'), false);
});

test('isPlausibleNameMatch: empty installed or result name is rejected', () => {
  assert.strictEqual(isPlausibleNameMatch('', 'uBlock Origin'), false);
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', ''), false);
});

// A4: normalize() used to strip everything outside a-z0-9, so even an
// identical non-Latin name never matched itself - findAmoPage()'s fuzzy
// search would treat a real match as unrelated for any add-on whose name
// isn't written in Latin script.
test('isPlausibleNameMatch: identical names in non-Latin scripts still match', () => {
  assert.strictEqual(isPlausibleNameMatch('مانع الإعلانات', 'مانع الإعلانات'), true, 'Arabic');
  assert.strictEqual(isPlausibleNameMatch('广告拦截器', '广告拦截器'), true, 'Chinese');
  assert.strictEqual(isPlausibleNameMatch('Блокировщик рекламы', 'Блокировщик рекламы'), true, 'Cyrillic');
});

// A5: the old one-sided "at least half of the installed name's words"
// threshold let a short, generic name match an unrelated add-on that
// merely happened to share one word with it.
test('isPlausibleNameMatch: rejects same-shaped but unrelated add-on names', () => {
  assert.strictEqual(isPlausibleNameMatch('Dark Mode', 'Dark Reader'), false);
  assert.strictEqual(isPlausibleNameMatch('Privacy Badger', 'Privacy Possum'), false);
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', 'uBlock Origin Lite'), false,
    'a real product-variant suffix with no tagline separator is a different add-on, not a tagline');
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

// --- shortName ---
// shortName lives in core.js and is used by export.js, import.js,
// and report-inline.js to shorten long add-on names at separators.

test('shortName: truncates at " - "', () => {
  assert.strictEqual(shortName('StayFree - Website Blocker, Web Usage Stats'), 'StayFree');
});

test('shortName: truncates at " – " (en-dash)', () => {
  assert.strictEqual(shortName('Mate Translate – translator, dictionary'), 'Mate Translate');
});

test('shortName: truncates at ":"', () => {
  assert.strictEqual(shortName('Buster: Captcha Solver for Humans'), 'Buster');
});

test('shortName: " & " is not a separator — keeps full name', () => {
  assert.strictEqual(shortName('Unhook - Remove YouTube Recommended & Shorts'), 'Unhook');
});

test('shortName: returns full name when no separator found', () => {
  assert.strictEqual(shortName('uBlock Origin'), 'uBlock Origin');
});

test('shortName: truncates at comma', () => {
  assert.strictEqual(shortName('Dark Reader, night mode'), 'Dark Reader');
});

// --- computeRetryAfterMs ---

test('computeRetryAfterMs: converts seconds to ms', () => {
  assert.strictEqual(sandbox.computeRetryAfterMs('2'), 2000);
});

// Read straight out of the sandbox so they can never drift from amo.js.
// They're declared with const, so (unlike the function declarations used
// everywhere else in this file) they never attach to the vm context as
// sandbox properties - evalInContext is what reads them back.
const RETRY_AFTER_MAX_MS = evalInContext(sandbox, 'AMO_RETRY_AFTER_MAX_MS');
const RETRY_AFTER_DEFAULT_MS = evalInContext(sandbox, 'AMO_RETRY_AFTER_DEFAULT_MS');

test('computeRetryAfterMs: caps an absurdly large value', () => {
  assert.strictEqual(sandbox.computeRetryAfterMs('99999'), RETRY_AFTER_MAX_MS);
});

test('computeRetryAfterMs: falls back to the default when there\'s no header', () => {
  assert.strictEqual(sandbox.computeRetryAfterMs(null), RETRY_AFTER_DEFAULT_MS);
});

test('computeRetryAfterMs: falls back to the default for a non-numeric or negative value', () => {
  assert.strictEqual(sandbox.computeRetryAfterMs('not-a-number'), RETRY_AFTER_DEFAULT_MS);
  assert.strictEqual(sandbox.computeRetryAfterMs('-5'), RETRY_AFTER_DEFAULT_MS);
});

// --- fetchJsonWithTimeout ---
// A separate, minimal sandbox (own fetch/AbortController/setTimeout) per
// test rather than reusing the shared `sandbox` above, the same pattern
// background.test.js uses for its own fetch-dependent tests.

function bootFetchSandbox(fetchImpl) {
  const fetchSandbox = makeSandbox({ URL, AbortController, setTimeout, clearTimeout, fetch: fetchImpl }, commonSrc);
  return fetchSandbox;
}

testAsync('fetchJsonWithTimeout: treats 404 as "not found", not a failure', async () => {
  const fetchSandbox = bootFetchSandbox(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  const result = await fetchSandbox.fetchJsonWithTimeout('https://example.com/x', 5000);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.data, null);
});

testAsync('fetchJsonWithTimeout: aborts even when only the response body stalls, not just the request', async () => {
  // fetch() itself resolves right away with a response whose .json()
  // never settles on its own - only aborting should ever reject it. This
  // is exactly the case a timer wrapped only around fetch() misses: it's
  // already been cleared by the time a slow/wedged body would matter.
  const fetchSandbox = bootFetchSandbox(async (url, opts) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  }));
  const start = Date.now();
  const result = await fetchSandbox.fetchJsonWithTimeout('https://example.com/x', 20);
  const elapsed = Date.now() - start;
  assert.strictEqual(result.ok, false);
  assert.ok(elapsed < 1000, `should have aborted quickly, took ${elapsed}ms`);
});

testAsync('fetchJsonWithTimeout: retries exactly once on 429, honoring Retry-After', async () => {
  let calls = 0;
  const fetchSandbox = bootFetchSandbox(async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => (h === 'Retry-After' ? '0' : null) }, // '0' keeps the test fast
        json: async () => ({}),
      };
    }
    return { ok: true, status: 200, json: async () => ({ found: true }) };
  });
  const result = await fetchSandbox.fetchJsonWithTimeout('https://example.com/x', 5000);
  assert.strictEqual(calls, 2, 'should retry exactly once');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.data.found, true);
});

testAsync('fetchJsonWithTimeout: a second 429 in a row is not retried again', async () => {
  let calls = 0;
  const fetchSandbox = bootFetchSandbox(async () => {
    calls++;
    return { ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '0' : null) }, json: async () => ({}) };
  });
  const result = await fetchSandbox.fetchJsonWithTimeout('https://example.com/x', 5000);
  assert.strictEqual(calls, 2, 'exactly one retry attempt total, not more');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 429);
});

// --- A15: indefiniteArticleFor ---

test('indefiniteArticleFor: "HTML report" needs "an" (H is "aitch", a vowel sound)', () => {
  assert.strictEqual(sandbox.indefiniteArticleFor('HTML report'), 'an');
});

test('indefiniteArticleFor: "JSON file" needs "a" (J is "jay", a consonant sound)', () => {
  assert.strictEqual(sandbox.indefiniteArticleFor('JSON file'), 'a');
});

test('indefiniteArticleFor: "CSV file" needs "a" (C is "see", a consonant sound)', () => {
  assert.strictEqual(sandbox.indefiniteArticleFor('CSV file'), 'a');
});

test('indefiniteArticleFor: falls back to ordinary spelling for a non-acronym word', () => {
  assert.strictEqual(sandbox.indefiniteArticleFor('extension'), 'an');
  assert.strictEqual(sandbox.indefiniteArticleFor('theme'), 'a');
});

// --- A34: loadSettings ---

function bootSettingsSandbox(storageGetImpl) {
  const sb = makeSandbox({ browser: { storage: { local: { get: storageGetImpl } } } }, commonSrc);
  return sb;
}

testAsync('loadSettings: valid stored values are used as-is', async () => {
  const sb = bootSettingsSandbox(async () => ({ theme: 'dark', exportFormat: 'json', shortenNames: 'off' }));
  const result = await sb.loadSettings();
  assert.strictEqual(result.theme, 'dark');
  assert.deepStrictEqual(Array.from(result.exportFormats), ['json']);
  assert.strictEqual(result.shortenNames, 'off');
});

testAsync('loadSettings: invalid stored values fall back to their defaults', async () => {
  const sb = bootSettingsSandbox(async () => ({ theme: 'sepia', exportFormat: 'xml', shortenNames: 'maybe' }));
  const result = await sb.loadSettings();
  assert.strictEqual(result.theme, 'light');
  assert.deepStrictEqual(Array.from(result.exportFormats), ['html']);
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('loadSettings: a pristine (empty) profile gets every default', async () => {
  const sb = bootSettingsSandbox(async () => ({}));
  const result = await sb.loadSettings();
  assert.strictEqual(result.theme, 'light');
  assert.deepStrictEqual(Array.from(result.exportFormats), ['html']);
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('loadSettings: a throwing storage.get falls back to every default, not a rejection', async () => {
  const sb = bootSettingsSandbox(async () => { throw new Error('storage unavailable'); });
  const result = await sb.loadSettings();
  assert.strictEqual(result.theme, 'light');
  assert.deepStrictEqual(Array.from(result.exportFormats), ['html']);
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('loadSettings: reads all three keys in a single storage.get call', async () => {
  let callCount = 0;
  const sb = bootSettingsSandbox(async () => { callCount++; return {}; });
  await sb.loadSettings();
  assert.strictEqual(callCount, 1, 'should be exactly one storage.get call, not one per setting');
});

test('resolveShortenNames: valid values pass through, invalid ones fall back', () => {
  assert.strictEqual(sandbox.resolveShortenNames('off'), 'off');
  assert.strictEqual(sandbox.resolveShortenNames('maybe'), 'on');
});

// A34 tripwire: loadSettings() (used by background.js, which can't
// load theme.js) hardcodes the literal 'theme' key rather than importing
// theme.js's THEME_STORAGE_KEY constant. If that constant's value is ever
// changed, this test is what would catch the two falling out of sync.
test('A34 tripwire: loadSettings\' literal theme key matches theme.js\'s THEME_STORAGE_KEY', () => {
  const themeSrc = readSrc('src/common/theme.js');
  const themeSandbox = makeSandbox({
    browser: { storage: { local: { get: async () => ({}) } } },
    document: { documentElement: { setAttribute() {} } },
    localStorage: { getItem() { return null; }, setItem() {} },
  }, themeSrc);
  const themeKey = evalInContext(themeSandbox, 'THEME_STORAGE_KEY');

  assert.strictEqual(themeKey, 'theme');
  assert.match(commonSrc, /theme: \{ key: 'theme'/,
    'the settings schema should use the literal \'theme\' key, matching THEME_STORAGE_KEY\'s value above');
});

test('A34: formatLabel maps each export format to its label', () => {
  assert.strictEqual(sandbox.formatLabel('json'), 'JSON file');
  assert.strictEqual(sandbox.formatLabel('csv'), 'CSV file');
  assert.strictEqual(sandbox.formatLabel('txt'), 'TXT file');
  assert.strictEqual(sandbox.formatLabel('html'), 'HTML report');
  assert.strictEqual(sandbox.formatLabel('nonsense'), 'HTML report');
});

// --- page-ui.js: fadeOutPage() / goToConfirmation() ---
// Cosmetic fade before the page is replaced by the confirmation page.
// Must be a safe no-op wherever animation isn't available, and must
// never block the caller.
function makeFadeSandbox({ card, reducedMotion = false, replaceImpl } = {}) {
  const navigated = [];
  const sb = makeSandbox({
    URL,
    document: { querySelector: (sel) => (sel === '.card' ? card : null) },
    matchMedia: () => ({ matches: reducedMotion }),
    location: { replace: replaceImpl || ((url) => navigated.push(url)) },
    browser: { runtime: { getURL: (p) => `moz-extension://test-id/${p}` } },
  }, commonSrc);
  return { sb, navigated };
}

function makeAnimatedCard() {
  const card = { calls: [], cancelled: false };
  card.animate = (frames, opts) => {
    card.calls.push({ frames, opts });
    return { finished: Promise.resolve(), cancel() { card.cancelled = true; } };
  };
  return card;
}

testAsync('fadeOutPage: animates the .card out and holds the final frame', async () => {
  const card = makeAnimatedCard();
  const { sb } = makeFadeSandbox({ card });
  const anim = await sb.fadeOutPage();
  assert.ok(anim, 'returns the animation so a caller can undo it');
  assert.strictEqual(card.calls.length, 1);
  assert.strictEqual(card.calls[0].frames[1].opacity, 0);
  assert.strictEqual(card.calls[0].opts.fill, 'forwards');
  assert.strictEqual(card.cancelled, false);
});

testAsync('fadeOutPage: does nothing when the user prefers reduced motion', async () => {
  const card = makeAnimatedCard();
  const { sb } = makeFadeSandbox({ card, reducedMotion: true });
  assert.strictEqual(await sb.fadeOutPage(), null);
  assert.strictEqual(card.calls.length, 0);
});

testAsync('fadeOutPage: safe no-op when there is no .card, no animate(), or no document', async () => {
  assert.strictEqual(await makeFadeSandbox({ card: null }).sb.fadeOutPage(), null);
  assert.strictEqual(await makeFadeSandbox({ card: {} }).sb.fadeOutPage(), null);
  const bare = makeSandbox({ URL }, commonSrc);
  assert.strictEqual(await bare.fadeOutPage(), null);
});

testAsync('fadeOutPage: a throwing animation never blocks the caller', async () => {
  const card = { animate() { throw new Error('boom'); } };
  const { sb } = makeFadeSandbox({ card });
  assert.strictEqual(await sb.fadeOutPage(), null);
});

testAsync('goToConfirmation: fades out, then replaces this page (not a new tab) with the confirmation URL', async () => {
  const card = makeAnimatedCard();
  const { sb, navigated } = makeFadeSandbox({ card });
  await sb.goToConfirmation('from=import&failed=2');
  assert.strictEqual(card.calls.length, 1);
  assert.deepStrictEqual(navigated, ['moz-extension://test-id/src/confirmation/confirmation.html?from=import&failed=2']);
});

testAsync('goToConfirmation: still navigates when nothing can animate', async () => {
  const { sb, navigated } = makeFadeSandbox({ card: null });
  await sb.goToConfirmation('from=export&format=csv');
  assert.deepStrictEqual(navigated, ['moz-extension://test-id/src/confirmation/confirmation.html?from=export&format=csv']);
});

testAsync('goToConfirmation: if navigation throws, the card is brought back and the error propagates', async () => {
  const card = makeAnimatedCard();
  const { sb } = makeFadeSandbox({ card, replaceImpl: () => { throw new Error('nav failed'); } });
  await assert.rejects(() => sb.goToConfirmation('from=export'), /nav failed/);
  assert.strictEqual(card.cancelled, true, 'card must not stay invisible after a failed navigation');
});

// --- setFilterVisible / the search fade hooks ---

test('setFilterVisible: hiding sets display:none and adds .is-filtered; showing clears both', () => {
  const el = { style: { display: '' }, classList: fakeClassList('x') };
  sandbox.setFilterVisible(el, false);
  assert.strictEqual(el.style.display, 'none');
  assert.strictEqual(el.classList.contains('is-filtered'), true);
  sandbox.setFilterVisible(el, true);
  assert.strictEqual(el.style.display, '');
  assert.strictEqual(el.classList.contains('is-filtered'), false);
});

test('setFilterVisible: uses shownDisplay when visible, and tolerates an element with no classList', () => {
  const el = { style: { display: 'none' } };
  sandbox.setFilterVisible(el, true, 'block');
  assert.strictEqual(el.style.display, 'block');
  sandbox.setFilterVisible(el, false);
  assert.strictEqual(el.style.display, 'none');
});

test('filterAddonRows: rows and groups that stop matching get .is-filtered, and lose it when they match again', () => {
  // makeContainer(): Enabled group = uBlock Origin + Dark Reader,
  // Disabled group = Old Extension.
  const { container, enabledBox, disabledBox, row1, row2, row3 } = makeContainer();

  filterAddonRows(container, 'dark');
  assert.strictEqual(row2.classList.contains('is-filtered'), false);
  assert.strictEqual(row1.classList.contains('is-filtered'), true);
  assert.strictEqual(row3.classList.contains('is-filtered'), true);
  assert.strictEqual(enabledBox.classList.contains('is-filtered'), false);
  assert.strictEqual(disabledBox.classList.contains('is-filtered'), true, 'an emptied group fades out too');

  filterAddonRows(container, '');
  for (const el of [row1, row2, row3, enabledBox, disabledBox]) {
    assert.strictEqual(el.classList.contains('is-filtered'), false);
    assert.strictEqual(el.style.display, '');
  }
});

// --- replayEntrance ---

test('replayEntrance: adds .replay-reset, forces a reflow, then removes it so the animation restarts', () => {
  const log = [];
  const classes = new Set();
  const card = {
    classList: {
      add: (c) => { classes.add(c); log.push('add:' + c); },
      remove: (c) => { classes.delete(c); log.push('remove:' + c); },
    },
    get offsetWidth() { log.push('reflow'); return 100; },
  };
  const sb = makeSandbox({ URL, document: { querySelector: (sel) => (sel === '.card' ? card : null) } }, commonSrc);
  sb.replayEntrance();
  assert.deepStrictEqual(log, ['add:replay-reset', 'reflow', 'remove:replay-reset']);
  assert.strictEqual(classes.size, 0);
});

test('replayEntrance: safe no-op without a document or .card', () => {
  const bare = makeSandbox({ URL }, commonSrc);
  bare.replayEntrance();
  const sb = makeSandbox({ URL, document: { querySelector: () => null } }, commonSrc);
  sb.replayEntrance();
});

// --- replayStagedReveal / scrollPageToTop ---

test('replayStagedReveal: restarts the card, puts the row-cascade flag back, then takes it off after the last row', () => {
  const log = [];
  const classes = new Set();
  const card = {
    classList: {
      add: (c) => { classes.add(c); log.push('add:' + c); },
      remove: (c) => { classes.delete(c); log.push('remove:' + c); },
    },
    get offsetWidth() { log.push('reflow'); return 100; },
  };
  const row = (rd) => ({ style: { getPropertyValue: (k) => (k === '--rd' ? rd : '') } });
  const list = {
    classList: {
      add: (c) => { classes.add(c); log.push('list-add:' + c); },
      remove: (c) => { classes.delete(c); log.push('list-remove:' + c); },
    },
    querySelectorAll: (sel) => (sel === '.addon-row' ? [row('1.22s'), row('1.38s'), row('0.98s')] : []),
  };
  const timers = [];
  const sb = makeSandbox({
    URL,
    document: {
      querySelector: (sel) => (sel === '.card' ? card : null),
      getElementById: (id) => (id === 'addonList' ? list : null),
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  }, commonSrc);

  sb.replayStagedReveal();
  assert.deepStrictEqual(log, ['list-add:revealing', 'add:replay-reset', 'reflow', 'remove:replay-reset']);
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 2230, 'the last row\'s 1.38s delay plus its own wipe');
  timers[0].fn();
  assert.strictEqual(classes.has('revealing'), false);
});

test('replayStagedReveal: with no rows, or no list at all, it only restarts the card', () => {
  const classes = new Set();
  const card = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, get offsetWidth() { return 100; } };
  const list = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, querySelectorAll: () => [] };
  const timers = [];
  const sb = makeSandbox({
    URL,
    document: {
      querySelector: (sel) => (sel === '.card' ? card : null),
      getElementById: () => list,
    },
    setTimeout: (fn, ms) => { timers.push(ms); return 1; },
  }, commonSrc);
  sb.replayStagedReveal();
  assert.strictEqual(classes.has('revealing'), false, 'nothing to cascade');
  assert.strictEqual(timers.length, 0, 'and so nothing to take the flag off from');

  makeSandbox({ URL }, commonSrc).replayStagedReveal();
});

test('scrollPageToTop: smooth normally, instant with reduced motion, and a no-op without a window', () => {
  const calls = [];
  const withWindow = (reduced) => makeSandbox({
    URL,
    window: { scrollTo: (opts) => calls.push(JSON.parse(JSON.stringify(opts))) },
    matchMedia: () => ({ matches: reduced }),
  }, commonSrc);
  withWindow(false).scrollPageToTop();
  withWindow(true).scrollPageToTop();
  assert.deepStrictEqual(calls, [
    { top: 0, left: 0, behavior: 'smooth' },
    { top: 0, left: 0, behavior: 'auto' },
  ]);
  makeSandbox({ URL }, commonSrc).scrollPageToTop();
});

// --- Live settings: applyNameShortening / onShortenNamesChanged ---

function makeNameEl(full, shown, { animate = true } = {}) {
  const el = { dataset: full === undefined ? {} : { fullName: full }, textContent: shown, animations: [] };
  if (animate) el.animate = (keyframes, options) => { el.animations.push({ keyframes, options }); return {}; };
  return el;
}

function makeNamesRoot(els) {
  return { querySelectorAll: (sel) => (sel === '.addon-name' ? els : []) };
}

test('applyNameShortening: shows the short form when on and the full form when off, and says how many changed', () => {
  const a = makeNameEl('uBlock Origin - free ad blocker', 'uBlock Origin - free ad blocker');
  const b = makeNameEl('Dark Reader: dark mode', 'Dark Reader: dark mode');
  const root = makeNamesRoot([a, b]);
  assert.strictEqual(sandbox.applyNameShortening(root, true), 2);
  assert.strictEqual(a.textContent, 'uBlock Origin');
  assert.strictEqual(b.textContent, 'Dark Reader');
  assert.strictEqual(sandbox.applyNameShortening(root, false), 2);
  assert.strictEqual(a.textContent, 'uBlock Origin - free ad blocker');
});

test('applyNameShortening: a name that does not change (no separator, or already right) is left alone, with no fade', () => {
  const plain = makeNameEl('Simple Name', 'Simple Name');
  const already = makeNameEl('Tab Tool - helper', 'Tab Tool');
  const changed = sandbox.applyNameShortening(makeNamesRoot([plain, already]), true);
  assert.strictEqual(changed, 0);
  assert.strictEqual(plain.animations.length + already.animations.length, 0);
});

test('applyNameShortening: each changed name fades in briefly so the change is noticed', () => {
  const a = makeNameEl('A - x', 'A - x');
  sandbox.applyNameShortening(makeNamesRoot([a]), true);
  assert.strictEqual(a.animations.length, 1);
  assert.strictEqual(a.animations[0].keyframes[0].opacity, 0.15);
  assert.strictEqual(a.animations[0].keyframes[1].opacity, 1);
});

test('applyNameShortening: rows that never recorded a full name are skipped, and a missing animate() is fine', () => {
  const noData = makeNameEl(undefined, 'Mystery - thing');
  const noAnimate = makeNameEl('B - y', 'B - y', { animate: false });
  const changed = sandbox.applyNameShortening(makeNamesRoot([noData, noAnimate]), true);
  assert.strictEqual(changed, 1);
  assert.strictEqual(noData.textContent, 'Mystery - thing');
  assert.strictEqual(noAnimate.textContent, 'B');
});

test('onShortenNamesChanged: calls the handler with true/false, and a reset (setting removed) means the default, true', () => {
  const listeners = [];
  const sb = makeSandbox({ URL, browser: { storage: { onChanged: { addListener: (fn) => listeners.push(fn) } } } }, commonSrc);
  const seen = [];
  sb.onShortenNamesChanged((v) => seen.push(v));
  assert.strictEqual(listeners.length, 1);
  listeners[0]({ shortenNames: { newValue: 'off' } }, 'local');
  listeners[0]({ shortenNames: { newValue: 'on' } }, 'local');
  listeners[0]({ shortenNames: { oldValue: 'off' } }, 'local');
  listeners[0]({ shortenNames: { newValue: 'banana' } }, 'local');
  assert.deepStrictEqual(seen, [false, true, true, true]);
});

test('onShortenNamesChanged: other settings, other storage areas, and pages without storage.onChanged are ignored safely', () => {
  const listeners = [];
  const sb = makeSandbox({ URL, browser: { storage: { onChanged: { addListener: (fn) => listeners.push(fn) } } } }, commonSrc);
  const seen = [];
  sb.onShortenNamesChanged((v) => seen.push(v));
  listeners[0]({ theme: { newValue: 'dark' } }, 'local');
  listeners[0]({ shortenNames: { newValue: 'off' } }, 'sync');
  assert.deepStrictEqual(seen, []);

  const bare = makeSandbox({ URL, browser: { storage: {} } }, commonSrc);
  bare.onShortenNamesChanged(() => {}); // must not throw
});

// --- setSelectionCount: the "12 of 12 selected" badge rolls, pops and flashes when the number changes ---

// A node with just enough of the DOM: text, children, attributes, and an
// animate() whose animations finish only when the test says so.
class BadgeNode {
  constructor() { this.className = ''; this.children = []; this.attrs = {}; this.animations = []; this._text = ''; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this.children = []; this._text = v; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  animate(keyframes, options) {
    let done;
    const finished = new Promise((resolve) => { done = resolve; });
    const anim = { keyframes, options, finished, finish: () => done() };
    this.animations.push(anim);
    return anim;
  }
}

function badgeEnv({ reducedMotion = false, withDocument = true } = {}) {
  const sb = { URL, matchMedia: () => ({ matches: reducedMotion }) };
  if (withDocument) sb.document = { createElement: () => new BadgeNode() };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
  const badge = new BadgeNode();
  return { sb, badge, set: (text) => sb.setSelectionCount(badge, text) };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
const shadowOf = (badge) => badge.animations.filter((a) => a.keyframes[0].boxShadow).map((a) => a.keyframes[0].boxShadow);

test('setSelectionCount: more selected - the badge pops, flashes green, and the new number rolls up from below', () => {
  const { badge, set } = badgeEnv();
  set('3 of 12 selected');
  set('4 of 12 selected');
  // While it rolls the slot holds the new number and the ghost of the old one (hidden from screen readers);
  // the real text is tracked separately and comes back as plain text when the roll ends.
  assert.strictEqual(badge.textContent, '43 of 12 selected');

  const pop = badge.animations.find((a) => a.keyframes[1].transform === 'scale(1.18)');
  assert.ok(pop, 'the whole badge pops to 1.18x and settles');
  assert.deepStrictEqual(shadowOf(badge).length, 1);
  assert.match(shadowOf(badge)[0], /rgba\(46, 160, 67/, 'green');

  const [slot, rest] = badge.children;
  assert.strictEqual(slot.className, 'count-roll');
  const [now, old] = slot.children;
  assert.strictEqual(now.textContent, '4');
  assert.strictEqual(old.textContent, '3');
  assert.strictEqual(old.attrs['aria-hidden'], 'true', 'the ghost of the old number is hidden from screen readers');
  assert.strictEqual(rest.textContent, ' of 12 selected');
  assert.strictEqual(now.animations[0].keyframes[0].transform, 'translateY(100%)', 'the new number comes up from below');
  assert.strictEqual(old.animations[0].keyframes[1].transform, 'translateY(-100%)', 'the old one leaves upwards');
  assert.strictEqual(old.animations[0].options.fill, 'forwards');
});

test('setSelectionCount: fewer selected - flashes amber, and the number rolls the other way', () => {
  const { badge, set } = badgeEnv();
  set('12 of 12 selected');
  set('11 of 12 selected');
  assert.match(shadowOf(badge)[0], /rgba\(217, 119, 6/, 'amber');
  const [now, old] = badge.children[0].children;
  assert.strictEqual(now.animations[0].keyframes[0].transform, 'translateY(-100%)', 'the new number comes down from above');
  assert.strictEqual(old.animations[0].keyframes[1].transform, 'translateY(100%)');
});

test('setSelectionCount: Select all / Deselect all (12 -> 0) rolls too, and a two-digit number rolls whole', () => {
  const { badge, set } = badgeEnv();
  set('12 of 12 selected');
  set('0 of 12 selected');
  const [now, old] = badge.children[0].children;
  assert.strictEqual(now.textContent, '0');
  assert.strictEqual(old.textContent, '12');
});

test('setSelectionCount: if only the total changes (same number selected), it just pops - no tint, no roll', () => {
  const { badge, set } = badgeEnv();
  set('3 of 12 selected');
  set('3 of 13 selected');
  assert.strictEqual(badge.animations.length, 1, 'only the pop');
  assert.strictEqual(shadowOf(badge).length, 0);
  assert.strictEqual(badge.children.length, 0, 'no slot built');
  assert.strictEqual(badge.textContent, '3 of 13 selected');
});

test('setSelectionCount: once the roll has finished the badge holds plain text again', async () => {
  const { badge, set } = badgeEnv();
  set('3 of 12 selected');
  set('4 of 12 selected');
  const [now, old] = badge.children[0].children;
  now.animations[0].finish();
  old.animations[0].finish();
  await flushPromises();
  assert.strictEqual(badge.children.length, 0);
  assert.strictEqual(badge.textContent, '4 of 12 selected');
});

test('setSelectionCount: a newer change during a roll takes over - the earlier roll finishing cannot put the old text back', async () => {
  const { badge, set } = badgeEnv();
  set('3 of 12 selected');
  set('4 of 12 selected');
  const firstRoll = badge.children[0].children;
  set('5 of 12 selected'); // before the first roll has finished
  assert.strictEqual(badge.children[0].children[0].textContent, '5', 'a fresh roll for the new number');
  firstRoll[0].animations[0].finish();
  firstRoll[1].animations[0].finish();
  await flushPromises();
  assert.notStrictEqual(badge.textContent, '4 of 12 selected');
  const secondRoll = badge.children[0].children;
  secondRoll[0].animations[0].finish();
  secondRoll[1].animations[0].finish();
  await flushPromises();
  assert.strictEqual(badge.textContent, '5 of 12 selected');
});

test('setSelectionCount: the roll compares against the real text, not the mid-roll slot', () => {
  const { badge, set } = badgeEnv();
  set('3 of 12 selected');
  set('4 of 12 selected');
  const before = badge.animations.length;
  set('4 of 12 selected'); // same again while the roll is on screen
  assert.strictEqual(badge.animations.length, before, 'no new animation for an unchanged number');
});

test('setSelectionCount: the first text, the same text, and clearing it play nothing extra', () => {
  const { badge, set } = badgeEnv();
  set('12 of 12 selected');
  set('12 of 12 selected');
  set('');
  assert.strictEqual(badge.animations.length, 0);
  assert.strictEqual(badge.textContent, '');
});

test('setSelectionCount: with reduced motion the text just changes', () => {
  const { badge, set } = badgeEnv({ reducedMotion: true });
  set('3 of 12 selected');
  set('4 of 12 selected');
  assert.strictEqual(badge.animations.length, 0);
  assert.strictEqual(badge.textContent, '4 of 12 selected');
});

test('setSelectionCount: without a document to build the slot in, the pop and tint still play and the text is right', () => {
  const { badge, set } = badgeEnv({ withDocument: false });
  set('3 of 12 selected');
  set('4 of 12 selected');
  assert.strictEqual(badge.animations.length, 2, 'pop + tint');
  assert.strictEqual(badge.textContent, '4 of 12 selected');
});

test('setSelectionCount: an element that cannot animate just gets its text', () => {
  const sb = makeSandbox({ URL }, commonSrc);
  const plain = { textContent: '3 of 12 selected' };
  sb.setSelectionCount(plain, '4 of 12 selected');
  assert.strictEqual(plain.textContent, '4 of 12 selected');
});

// --- several export formats at once ---

test('resolveExportFormats: a string, a list or a comma list becomes known formats in fixed order, never empty', () => {
  assert.deepStrictEqual(Array.from(sandbox.resolveExportFormats('json')), ['json']);
  assert.deepStrictEqual(Array.from(sandbox.resolveExportFormats(['txt', 'html'])), ['html', 'txt']);
  assert.deepStrictEqual(Array.from(sandbox.resolveExportFormats('csv,json,csv')), ['json', 'csv']);
  assert.deepStrictEqual(Array.from(sandbox.resolveExportFormats(['xml', 'json'])), ['json']);
  for (const bad of [undefined, null, '', 'xml', [], ['xml'], 42]) {
    assert.deepStrictEqual(Array.from(sandbox.resolveExportFormats(bad)), ['html']);
  }
});

test('serializeExportFormats: one format stays a plain string, several become an array', () => {
  assert.strictEqual(sandbox.serializeExportFormats(['json']), 'json');
  assert.strictEqual(sandbox.serializeExportFormats('csv'), 'csv');
  assert.deepStrictEqual(Array.from(sandbox.serializeExportFormats(['txt', 'html'])), ['html', 'txt']);
  assert.strictEqual(sandbox.serializeExportFormats([]), 'html');
});

test('formatLabelsText: labels are joined like a sentence', () => {
  assert.strictEqual(sandbox.formatLabelsText('json'), 'JSON file');
  assert.strictEqual(sandbox.formatLabelsText(['html', 'json']), 'HTML report and JSON file');
  assert.strictEqual(sandbox.formatLabelsText(['html', 'json', 'csv', 'txt']), 'HTML report, JSON file, CSV file and TXT file');
});

test('loadSettings: exportFormats lists every stored format, in the fixed order, and there is no single exportFormat field', async () => {
  const sb = makeSandbox({ URL, browser: { storage: { local: { get: async () => ({ exportFormat: ['json', 'html'] }) } } } }, commonSrc);
  const s = await sb.loadSettings();
  assert.deepStrictEqual(Array.from(s.exportFormats), ['html', 'json']);
  assert.ok(!('exportFormat' in s), 'only the list is returned');
});

// --- typeLabel() / parseType(): how an add-on's type is written for people and read back ---

test('typeLabel: "theme" is Theme, anything else is Extension', () => {
  assert.strictEqual(sandbox.typeLabel('theme'), 'Theme');
  assert.strictEqual(sandbox.typeLabel('extension'), 'Extension');
  assert.strictEqual(sandbox.typeLabel(undefined), 'Extension');
});

test('parseType: reads exactly Theme and Extension back, anything else is null', () => {
  assert.strictEqual(sandbox.parseType('Theme'), 'theme');
  assert.strictEqual(sandbox.parseType('Extension'), 'extension');
  for (const bad of ['theme', 'extension', 'THEME', '', ' Theme', 'Addon', undefined]) assert.strictEqual(sandbox.parseType(bad), null, String(bad));
});

test('typeLabel and parseType are inverses for both types', () => {
  for (const t of ['theme', 'extension']) assert.strictEqual(sandbox.parseType(sandbox.typeLabel(t)), t);
});

// --- Phase 2: format registry, settings schema, shared loader ---

test('registry: every format has an id, label, title, extension, MIME type and description; ids are unique and in the fixed order', () => {
  const reg = Array.from(evalInContext(sandbox, 'EXPORT_FORMAT_REGISTRY'));
  assert.deepStrictEqual(reg.map((f) => f.id), ['html', 'json', 'csv', 'txt']);
  assert.deepStrictEqual(Array.from(evalInContext(sandbox, 'EXPORT_FORMATS')), ['html', 'json', 'csv', 'txt']);
  for (const f of reg) {
    for (const k of ['id', 'label', 'title', 'extension', 'mime', 'description']) {
      assert.ok(typeof f[k] === 'string' && f[k].length > 0, `${f.id}.${k}`);
    }
    assert.strictEqual(f.extension, f.id, 'the extension is the id today');
  }
  assert.deepStrictEqual(reg.map((f) => f.mime), ['text/html', 'application/json', 'text/csv', 'text/plain']);
});

test('registry: getExportFormat falls back to the default for anything unknown', () => {
  assert.strictEqual(sandbox.getExportFormat('csv').id, 'csv');
  assert.strictEqual(sandbox.getExportFormat('nope').id, 'html');
  assert.strictEqual(sandbox.getExportFormat(undefined).id, 'html');
});

async function loadWith(stored) {
  const sb = makeSandbox({ browser: { storage: { local: { get: async () => stored } } } }, commonSrc);
  return sb.loadSettings();
}

testAsync('loadSettings: stored value shapes - lone string, array, comma string, junk, nothing', async () => {
  const shape = (r) => ({ theme: r.theme, exportFormats: Array.from(r.exportFormats), shortenNames: r.shortenNames });
  assert.deepStrictEqual(shape(await loadWith({ exportFormat: 'csv' })), { theme: 'light', exportFormats: ['csv'], shortenNames: 'on' });
  assert.deepStrictEqual(shape(await loadWith({ exportFormat: ['txt', 'html'], theme: 'dark', shortenNames: 'off' })), { theme: 'dark', exportFormats: ['html', 'txt'], shortenNames: 'off' });
  assert.deepStrictEqual(shape(await loadWith({ exportFormat: 'json,csv' })).exportFormats, ['json', 'csv']);
  assert.deepStrictEqual(shape(await loadWith({ exportFormat: 42, theme: 'purple', shortenNames: 'maybe' })), { theme: 'light', exportFormats: ['html'], shortenNames: 'on' });
  assert.deepStrictEqual(shape(await loadWith({})), { theme: 'light', exportFormats: ['html'], shortenNames: 'on' });
});

testAsync('loadSettings: one storage read for everything; a failing read gives every default', async () => {
  let calls = 0, asked;
  const sb = makeSandbox({ browser: { storage: { local: { get: async (k) => { calls++; asked = k; return {}; } } } } }, commonSrc);
  await sb.loadSettings();
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(Array.from(asked).sort(), ['exportFormat', 'shortenNames', 'theme']);
  const bad = makeSandbox({ browser: { storage: { local: { get: async () => { throw new Error('x'); } } } } }, commonSrc);
  const r = await bad.loadSettings();
  assert.deepStrictEqual([r.theme, Array.from(r.exportFormats), r.shortenNames], ['light', ['html'], 'on']);
});

testAsync('onSettingsChanged: reports which settings changed with fresh values; other areas/keys ignored; no storage.onChanged is safe', async () => {
  const listeners = [];
  const sb = makeSandbox({ browser: { storage: { local: { get: async () => ({ exportFormat: ['html', 'csv'] }) }, onChanged: { addListener: (fn) => listeners.push(fn) } } } }, commonSrc);
  const seen = [];
  sb.onSettingsChanged((changed, settings) => seen.push([Array.from(changed), Array.from(settings.exportFormats)]));
  listeners[0]({ exportFormat: { newValue: ['html', 'csv'] } }, 'local');
  listeners[0]({ exportFormat: {} }, 'sync');
  listeners[0]({ unrelated: {} }, 'local');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(seen, [[['exportFormats'], ['html', 'csv']]]);
  const bare = makeSandbox({ browser: {} }, commonSrc);
  bare.onSettingsChanged(() => {}); // must not throw
});

// --- addon-list.js: the list shared by the Exporter and the Importer ---

function loadAddonListSandbox() {
  const { document } = makeFakeDom();
  const sb = makeSandbox({ document, URL }, readCommon());
  return sb;
}

test('createAddonGroups: numbers rows across groups, skips empty groups, headings show the count', () => {
  const sb = loadAddonListSandbox();
  const seen = [];
  const box = sb.createAddonGroups(
    [{ title: 'First', items: [{ n: 'a' }, { n: 'b' }] }, { title: 'Empty', items: [] }, { title: 'Last', items: [{ n: 'c' }] }],
    (item, index, group) => { seen.push([item.n, index, group.title]); return sb.document.createElement('div'); }
  );
  assert.deepStrictEqual(seen, [['a', 0, 'First'], ['b', 1, 'First'], ['c', 2, 'Last']]);
  assert.strictEqual(box.className, 'groups-outer-box');
  assert.strictEqual(box.children.length, 2, 'the empty group is left out');
  assert.strictEqual(box.children[0].children[0].textContent, 'First (2)');
  assert.strictEqual(box.children[1].children[0].textContent, 'Last (1)');
});

test('createAddonRowBase: id prefix, data, ticked/disabled state, short or full name, version only if text', () => {
  const sb = loadAddonListSandbox();
  const a = { name: 'Alpha: The Tool', version: '1.0', type: 'theme' };
  const { row, checkbox, label } = sb.createAddonRowBase(a, 3, { idPrefix: 'x', dataset: { id: 'a@x' }, checked: false, disabled: true, shorten: true });
  assert.strictEqual(checkbox.id, 'x-3');
  assert.strictEqual(checkbox.dataset.id, 'a@x');
  assert.strictEqual(checkbox.checked, false);
  assert.strictEqual(checkbox.disabled, true);
  assert.ok(row.classList.contains('row-disabled'));
  assert.strictEqual(label.htmlFor, 'x-3');
  const name = label.children[0];
  assert.strictEqual(name.textContent, 'Alpha');
  assert.strictEqual(name.dataset.fullName, 'Alpha: The Tool');
  assert.strictEqual(label.children[1].textContent, '1.0');
  assert.strictEqual(label.children[2].textContent, 'Theme');
  const full = sb.createAddonRowBase({ name: 'Alpha: The Tool', version: 7, type: 'extension' }, 0, { idPrefix: 'y', shorten: false });
  assert.strictEqual(full.label.children[0].textContent, 'Alpha: The Tool');
  assert.strictEqual(full.label.children[1].textContent, '', 'a version that is not text shows nothing');
  assert.strictEqual(full.checkbox.checked, true, 'ticked by default');
  assert.ok(!full.row.classList.contains('row-disabled'));
});
