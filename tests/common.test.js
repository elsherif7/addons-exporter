// Tests for src/common/common.js's pure helper functions. Loads the real
// source via vm so these run against the actual file, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrc, evalInContext } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes, extractTranslatedField, isPlausibleNameMatch, shortName } = sandbox;

// report-template.js's buildHtmlReport() inlines its own copy of
// filterAddonRows into the exported report (it can't load common.js once
// saved elsewhere). Pull that copy's literal source straight out of
// report-template.js - not a hand-copied snapshot - so a future edit to
// one copy and not the other gets caught here instead of silently drifting.
const reportTemplateSrc = readSrc('src/background/report-template.js');
// Extract the inline <script> block by its named marker comment rather than
// by a bare /<script>/ tag match. The report template has two <script> tags
// (a JSON data tag and the logic block); a tag-only regex would pick the
// wrong one if their order ever changed, or if a third tag was added before
// it. The marker pins extraction to exactly the right block regardless of
// what else is in the template.
const reportScriptMatch = reportTemplateSrc.match(/\/\/ @inline-script-start([\s\S]*?)<\/script>/);
if (!reportScriptMatch) {
  throw new Error("Could not find the '// @inline-script-start' marker in report-template.js - add it back to the report's inline <script> block.");
}
const reportInlineScript = reportScriptMatch[1];

// Runs the report's inline script against a fake `addonList` container and
// returns its filterAddonRows, so it can be called directly the same way
// common.js's version is called in the test below.
function loadReportFilterAddonRows(addonListContainer) {
  // The inline script now calls applyTheme() on load, which needs
  // setAttribute/textContent on the themeToggle element, and also reads
  // from localStorage. Provide minimal stubs for both so the script can
  // initialise without throwing.
  const stubEl = () => ({ style: {}, addEventListener() {}, setAttribute() {}, textContent: '', children: [], classList: { contains: () => false }, querySelector: () => null });
  const reportDocument = {
    documentElement: { setAttribute() {} },
    getElementById(id) {
      return id === 'addonList' ? addonListContainer : stubEl();
    },
  };
  const reportSandbox = {
    document: reportDocument,
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  vm.createContext(reportSandbox);
  vm.runInContext(reportInlineScript, reportSandbox);
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

test('filterAddonRows: common.js and the report\'s inline copy agree on the same fixture', () => {
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

test('filterAddonRows: common.js and the report\'s inline copy agree with a nested outer wrapper too', () => {
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

test('byName with identical names: both items survive the sort', () => {
  const items = [{ name: 'uBlock Origin' }, { name: 'uBlock Origin' }];
  items.sort(byName);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].name, 'uBlock Origin');
  assert.strictEqual(items[1].name, 'uBlock Origin');
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
// shortName lives in common.js and is used by export.js, import.js,
// and report-template.js to shorten long add-on names at separators.

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

// These mirror AMO_RETRY_AFTER_MAX_MS / AMO_RETRY_AFTER_DEFAULT_MS in
// common.js as literals - they're declared with const there, so (unlike
// the function declarations used everywhere else in this file) they
// never attach to the vm context as sandbox properties to read back.
const RETRY_AFTER_MAX_MS = 10000;
const RETRY_AFTER_DEFAULT_MS = 1000;

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
  const fetchSandbox = { URL, AbortController, setTimeout, clearTimeout, fetch: fetchImpl };
  vm.createContext(fetchSandbox);
  vm.runInContext(commonSrc, fetchSandbox);
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

// --- A30: dead code cleanup ---

test('A30: the legacy flat-structure branches are gone from filterAddonRows', () => {
  const commonSrcRaw = readSrc('src/common/common.js');
  assert.doesNotMatch(commonSrcRaw, /Legacy flat group-box/);
  assert.doesNotMatch(commonSrcRaw, /Fallback: flat structure/);
});

// --- A34: getStoredSettings ---

function bootSettingsSandbox(storageGetImpl) {
  const sb = { browser: { storage: { local: { get: storageGetImpl } } } };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
  return sb;
}

testAsync('getStoredSettings: valid stored values are used as-is', async () => {
  const sb = bootSettingsSandbox(async () => ({ theme: 'dark', exportFormat: 'json', shortenNames: 'off' }));
  const result = await sb.getStoredSettings();
  assert.strictEqual(result.theme, 'dark');
  assert.strictEqual(result.exportFormat, 'json');
  assert.strictEqual(result.shortenNames, 'off');
});

testAsync('getStoredSettings: invalid stored values fall back to their defaults', async () => {
  const sb = bootSettingsSandbox(async () => ({ theme: 'sepia', exportFormat: 'xml', shortenNames: 'maybe' }));
  const result = await sb.getStoredSettings();
  assert.strictEqual(result.theme, 'light');
  assert.strictEqual(result.exportFormat, 'html');
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('getStoredSettings: a pristine (empty) profile gets every default', async () => {
  const sb = bootSettingsSandbox(async () => ({}));
  const result = await sb.getStoredSettings();
  assert.strictEqual(result.theme, 'light');
  assert.strictEqual(result.exportFormat, 'html');
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('getStoredSettings: a throwing storage.get falls back to every default, not a rejection', async () => {
  const sb = bootSettingsSandbox(async () => { throw new Error('storage unavailable'); });
  const result = await sb.getStoredSettings();
  assert.strictEqual(result.theme, 'light');
  assert.strictEqual(result.exportFormat, 'html');
  assert.strictEqual(result.shortenNames, 'on');
});

testAsync('getStoredSettings: reads all three keys in a single storage.get call', async () => {
  let callCount = 0;
  const sb = bootSettingsSandbox(async () => { callCount++; return {}; });
  await sb.getStoredSettings();
  assert.strictEqual(callCount, 1, 'should be exactly one storage.get call, not one per setting');
});

test('resolveExportFormat / resolveShortenNames: valid values pass through, invalid ones fall back', () => {
  assert.strictEqual(sandbox.resolveExportFormat('json'), 'json');
  assert.strictEqual(sandbox.resolveExportFormat('xml'), 'html');
  assert.strictEqual(sandbox.resolveShortenNames('off'), 'off');
  assert.strictEqual(sandbox.resolveShortenNames('maybe'), 'on');
});

// A34 tripwire: getStoredSettings() (used by background.js, which can't
// load theme.js) hardcodes the literal 'theme' key rather than importing
// theme.js's THEME_STORAGE_KEY constant. If that constant's value is ever
// changed, this test is what would catch the two falling out of sync.
test('A34 tripwire: getStoredSettings\' literal theme key matches theme.js\'s THEME_STORAGE_KEY', () => {
  const themeSrc = readSrc('src/common/theme.js');
  const themeSandbox = {
    browser: { storage: { local: { get: async () => ({}) } } },
    document: { documentElement: { setAttribute() {} } },
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  vm.createContext(themeSandbox);
  vm.runInContext(themeSrc, themeSandbox);
  const themeKey = evalInContext(themeSandbox, 'THEME_STORAGE_KEY');

  assert.strictEqual(themeKey, 'theme');
  assert.match(commonSrc, /storage\.local\.get\(\['theme', EXPORT_FORMAT_STORAGE_KEY/,
    'getStoredSettings should read the literal \'theme\' key, matching THEME_STORAGE_KEY\'s value above');
});

test('A34: formatLabel maps each export format to its label', () => {
  assert.strictEqual(sandbox.formatLabel('json'), 'JSON file');
  assert.strictEqual(sandbox.formatLabel('csv'), 'CSV file');
  assert.strictEqual(sandbox.formatLabel('html'), 'HTML report');
  assert.strictEqual(sandbox.formatLabel('nonsense'), 'HTML report');
});

test('A34: formatLabel is no longer duplicated in export.js or confirmation.js', () => {
  const exportSrcRaw = readSrc('src/export/export.js');
  const confirmationSrcRaw = readSrc('src/confirmation/confirmation.js');
  assert.doesNotMatch(exportSrcRaw, /function formatLabel/);
  assert.doesNotMatch(confirmationSrcRaw, /function exportFormatLabel|FORMAT_LABELS/);
});

// --- common.js: fadeOutPage() / goToConfirmation() ---
// Cosmetic fade before the page is replaced by the confirmation page.
// Must be a safe no-op wherever animation isn't available, and must
// never block the caller.
function makeFadeSandbox({ card, reducedMotion = false, replaceImpl } = {}) {
  const navigated = [];
  const sb = {
    URL,
    document: { querySelector: (sel) => (sel === '.card' ? card : null) },
    matchMedia: () => ({ matches: reducedMotion }),
    location: { replace: replaceImpl || ((url) => navigated.push(url)) },
    browser: { runtime: { getURL: (p) => `moz-extension://test-id/${p}` } },
  };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
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
  const bare = { URL };
  vm.createContext(bare);
  vm.runInContext(commonSrc, bare);
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
  const sb = { URL, document: { querySelector: (sel) => (sel === '.card' ? card : null) } };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
  sb.replayEntrance();
  assert.deepStrictEqual(log, ['add:replay-reset', 'reflow', 'remove:replay-reset']);
  assert.strictEqual(classes.size, 0);
});

test('replayEntrance: safe no-op without a document or .card', () => {
  const bare = { URL };
  vm.createContext(bare);
  vm.runInContext(commonSrc, bare);
  bare.replayEntrance();
  const sb = { URL, document: { querySelector: () => null } };
  vm.createContext(sb);
  vm.runInContext(commonSrc, sb);
  sb.replayEntrance();
});

