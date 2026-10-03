// Structural checks across the static HTML pages and the generated
// report - things like lang attributes and ARIA roles that are easy to
// add to one page and forget on another, and that no other test file
// naturally covers (they're not really "behavior" of any one function).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, readSrc } = require('./helpers');

const HTML_PAGES = [
  'src/popup/popup.html',
  'src/export/export.html',
  'src/import/import.html',
  'src/settings/settings.html',
  'src/confirmation/confirmation.html',
];

// --- A19: <html lang="en"> on every page ---

for (const page of HTML_PAGES) {
  test(`A19: ${page} declares <html lang="en">`, () => {
    const html = readSrc(page);
    assert.match(html, /<html[^>]*\blang="en"/, `${page} is missing lang="en" on its <html> tag`);
  });
}

test('A19: the generated report declares <html lang="en">', () => {
  const reportSrc = readSrc('src/background/report-template.js');
  // The report's <html> tag is a template literal with an interpolated
  // data-theme value - just check lang="en" appears on the same tag.
  assert.match(reportSrc, /<html lang="en" data-theme=/);
});

// --- A19: role="status" + aria-live="polite" on the live status regions ---

test('A19: export.html\'s #status is a live region', () => {
  const html = readSrc('src/export/export.html');
  assert.match(html, /<span id="status"[^>]*\brole="status"[^>]*\baria-live="polite"/);
});

test('A19: export.html\'s #selectionCount is a live region', () => {
  const html = readSrc('src/export/export.html');
  assert.match(html, /<span id="selectionCount"[^>]*\brole="status"[^>]*\baria-live="polite"/);
});

test('A19: import.html\'s #status is a live region', () => {
  const html = readSrc('src/import/import.html');
  assert.match(html, /<span id="status"[^>]*\brole="status"[^>]*\baria-live="polite"/);
});

test('A19: import.html\'s #selectionCount is a live region', () => {
  const html = readSrc('src/import/import.html');
  assert.match(html, /<span id="selectionCount"[^>]*\brole="status"[^>]*\baria-live="polite"/);
});

test('A19: settings.html\'s #settingsStatus is a live region', () => {
  const html = readSrc('src/settings/settings.html');
  assert.match(html, /<span id="settingsStatus"[^>]*\brole="status"[^>]*\baria-live="polite"/);
});

// --- A21: radiogroup semantics on the settings radio groups ---

for (const [heading, headingId] of [['Appearance', 'appearanceHeading'], ['Export Format', 'exportFormatHeading'], ['Display', 'displayHeading']]) {
  test(`A21: settings.html's "${heading}" radio group has role="radiogroup" and aria-labelledby`, () => {
    const html = readSrc('src/settings/settings.html');
    const re = new RegExp(`role="radiogroup" aria-labelledby="${headingId}"[\\s\\S]*?<h2 id="${headingId}">${heading}</h2>`);
    assert.match(html, re);
  });
}

// --- A21: aria-label on the × remove-file button and search inputs ---

test('A21: import.html\'s remove-file button has an aria-label', () => {
  const html = readSrc('src/import/import.html');
  assert.match(html, /<button id="removeFileBtn" aria-label="[^"]+"/);
});

for (const page of ['src/export/export.html', 'src/import/import.html']) {
  test(`A21: ${page}'s search input has an aria-label`, () => {
    const html = readSrc(page);
    assert.match(html, /<input type="search" id="searchInput"[^>]*\baria-label="[^"]+"/);
  });
}

// --- settings-option-row refactor ---
// Every Settings option row (radio rows and action rows) must use the
// shared settings-option-row class. These tests act as tripwires: they
// catch regressions where someone adds a new row with a specialized
// class instead of the canonical one, or accidentally reintroduces the
// old class names.

const settingsHtml = readSrc('src/settings/settings.html');

// Tripwire: old specialized class names must not exist anywhere in
// settings.html. If any of these appear it means someone added a row
// without using the shared implementation.
test('settings-option-row: theme-option class no longer exists in settings.html', () => {
  assert.doesNotMatch(settingsHtml, /class="[^"]*theme-option[^"]*"/,
    'theme-option found — use settings-option-row instead');
});

test('settings-option-row: about-block-hover class no longer exists in settings.html', () => {
  assert.doesNotMatch(settingsHtml, /class="[^"]*about-block-hover[^"]*"/,
    'about-block-hover found — the Reset row should use settings-option-row instead');
});

// Structural: all 8 option rows use settings-option-row.
test('settings-option-row: all 7 radio label rows use settings-option-row', () => {
  const matches = [...settingsHtml.matchAll(/<label[^>]+class="settings-option-row"[^>]*>/g)];
  assert.strictEqual(matches.length, 7,
    `expected 7 radio label rows with class="settings-option-row", found ${matches.length}`);
});

test('settings-option-row: the Reset Settings action row uses settings-option-row', () => {
  assert.match(settingsHtml, /<div class="settings-option-row">[^]*?id="resetSettingsBtn"/,
    'Reset Settings row should be a <div class="settings-option-row"> containing resetSettingsBtn');
});

// Semantics: radio rows use <label> (not <div>), Reset uses <div> (not <label>).
test('settings-option-row: radio rows are <label> elements (not <div>)', () => {
  // A <div class="settings-option-row"> that contains a radio input would be wrong.
  assert.doesNotMatch(settingsHtml,
    /<div class="settings-option-row">[^<]*<input type="radio"/,
    'radio inputs must be inside <label class="settings-option-row">, not a <div>');
});

test('settings-option-row: Reset Settings uses a native <button> (not a radio input)', () => {
  // The reset row must contain a <button>, never an <input type="radio">.
  const resetRowMatch = settingsHtml.match(/<div class="settings-option-row">([\s\S]*?)<\/div>/);
  assert.ok(resetRowMatch, 'could not find <div class="settings-option-row">');
  assert.match(resetRowMatch[1], /<button[^>]+id="resetSettingsBtn"/,
    'Reset Settings row must contain a native <button>');
  assert.doesNotMatch(resetRowMatch[1], /<input type="radio"/,
    'Reset Settings row must not contain a radio input');
});

// Radio IDs, names, and values unchanged after the refactor.
for (const [id, name, value] of [
  ['themeLight',      'theme',        'light'],
  ['themeDark',       'theme',        'dark'],
  ['formatHtml',      'exportFormat', 'html'],
  ['formatJson',      'exportFormat', 'json'],
  ['formatCsv',       'exportFormat', 'csv'],
  ['shortenNamesOn',  'shortenNames', 'on'],
  ['shortenNamesOff', 'shortenNames', 'off'],
]) {
  test(`settings-option-row: radio #${id} has name="${name}" and value="${value}"`, () => {
    const re = new RegExp(`id="${id}"[^>]*name="${name}"[^>]*value="${value}"|id="${id}"[^>]*value="${value}"[^>]*name="${name}"`);
    // The input tag itself carries id/name/value; order may vary.
    const inputRe = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`);
    const inputMatch = settingsHtml.match(inputRe);
    assert.ok(inputMatch, `could not find <input id="${id}">`);
    assert.match(inputMatch[0], new RegExp(`\\bname="${name}"`), `#${id} missing name="${name}"`);
    assert.match(inputMatch[0], new RegExp(`\\bvalue="${value}"`), `#${id} missing value="${value}"`);
  });
}

// label/input associations: every radio <label> must have a for= that
// matches its radio's id.
for (const [labelFor, radioId] of [
  ['themeLight',      'themeLight'],
  ['themeDark',       'themeDark'],
  ['formatHtml',      'formatHtml'],
  ['formatJson',      'formatJson'],
  ['formatCsv',       'formatCsv'],
  ['shortenNamesOn',  'shortenNamesOn'],
  ['shortenNamesOff', 'shortenNamesOff'],
]) {
  test(`settings-option-row: label for="${labelFor}" is associated with input id="${radioId}"`, () => {
    assert.match(settingsHtml,
      new RegExp(`<label[^>]+class="settings-option-row"[^>]+for="${labelFor}"`),
      `label with for="${labelFor}" not found using settings-option-row`);
    assert.match(settingsHtml,
      new RegExp(`<input[^>]+id="${radioId}"`),
      `radio input with id="${radioId}" not found`);
  });
}

// Shared CSS class must be defined in the <style> block (not removed).
test('settings-option-row: .settings-option-row is defined in the settings.html <style> block', () => {
  assert.match(settingsHtml, /\.settings-option-row\s*\{/,
    '.settings-option-row CSS rule not found in settings.html');
});

// Hover and dark-mode rules exist for the shared class.
test('settings-option-row: hover rule is defined for .settings-option-row', () => {
  assert.match(settingsHtml, /\.settings-option-row:hover\s*\{/,
    '.settings-option-row:hover rule not found');
});

test('settings-option-row: dark-mode hover rule is defined for .settings-option-row', () => {
  assert.match(settingsHtml, /\[data-theme="dark"\][^{]*\.settings-option-row:hover/,
    'dark-mode .settings-option-row:hover rule not found');
});

// --- hub-btn refactor ---
// Every visible action button must use the shared hub-btn class.
// Tripwires catch regressions where someone adds a new button without
// the shared base, or reintroduces a duplicated button implementation.

// --- shared.css: hub-btn is defined and owns the common rules ---

const sharedCssForBtn = readSrc('src/common/shared.css');

test('hub-btn: .hub-btn is defined in shared.css', () => {
  assert.match(sharedCssForBtn, /\.hub-btn\s*\{/, '.hub-btn rule not found in shared.css');
});

test('hub-btn: .hub-btn:hover is defined in shared.css', () => {
  assert.match(sharedCssForBtn, /\.hub-btn:hover\s*\{/, '.hub-btn:hover rule not found in shared.css');
});

test('hub-btn: .primary-btn no longer duplicates border/background/cursor in shared.css', () => {
  // Extract only the .primary-btn block (not hub-btn) and verify the
  // duplicated properties were removed.
  const primaryBtnBlock = sharedCssForBtn.match(/\.primary-btn\s*\{([^}]*)\}/);
  assert.ok(primaryBtnBlock, '.primary-btn block not found in shared.css');
  const block = primaryBtnBlock[1];
  assert.doesNotMatch(block, /\bborder\s*:/, '.primary-btn should not redeclare border (it inherits from hub-btn)');
  assert.doesNotMatch(block, /\bbackground\s*:/, '.primary-btn should not redeclare background (it inherits from hub-btn)');
  assert.doesNotMatch(block, /\bcursor\s*:/, '.primary-btn should not redeclare cursor (it inherits from hub-btn)');
});

// --- export.html ---

const exportHtml = readSrc('src/export/export.html');

test('hub-btn: exportSelectedBtn uses hub-btn', () => {
  assert.match(exportHtml, /id="exportSelectedBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="exportSelectedBtn"/,
    'exportSelectedBtn should have hub-btn class');
});

// --- import.html ---

const importHtml = readSrc('src/import/import.html');

test('hub-btn: openSelectedBtn uses hub-btn', () => {
  assert.match(importHtml, /id="openSelectedBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="openSelectedBtn"/,
    'openSelectedBtn should have hub-btn class');
});

test('hub-btn: chooseFileBtn uses hub-btn', () => {
  assert.match(importHtml, /id="chooseFileBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="chooseFileBtn"/,
    'chooseFileBtn should have hub-btn class');
});

test('hub-btn: #chooseFileBtn no longer duplicates button base styles in import.html', () => {
  const chooseFileBtnBlock = importHtml.match(/#chooseFileBtn\s*\{([^}]*)\}/);
  assert.ok(chooseFileBtnBlock, '#chooseFileBtn CSS block not found in import.html');
  const block = chooseFileBtnBlock[1];
  assert.doesNotMatch(block, /\bborder\s*:/, '#chooseFileBtn should not redeclare border');
  assert.doesNotMatch(block, /\bbackground\s*:/, '#chooseFileBtn should not redeclare background');
  assert.doesNotMatch(block, /\bcursor\s*:/, '#chooseFileBtn should not redeclare cursor');
});

// --- settings.html ---

const settingsHtmlForBtn = readSrc('src/settings/settings.html');

test('hub-btn: exportSettingsBtn uses hub-btn', () => {
  assert.match(settingsHtmlForBtn, /id="exportSettingsBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="exportSettingsBtn"/,
    'exportSettingsBtn should have hub-btn class');
});

test('hub-btn: importSettingsBtn uses hub-btn', () => {
  assert.match(settingsHtmlForBtn, /id="importSettingsBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="importSettingsBtn"/,
    'importSettingsBtn should have hub-btn class');
});

test('hub-btn: resetSettingsBtn uses hub-btn', () => {
  assert.match(settingsHtmlForBtn, /id="resetSettingsBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="resetSettingsBtn"/,
    'resetSettingsBtn should have hub-btn class');
});

test('hub-btn: .settings-btn no longer duplicates button base styles in settings.html', () => {
  const settingsBtnBlock = settingsHtmlForBtn.match(/\.settings-btn\s*\{([^}]*)\}/);
  assert.ok(settingsBtnBlock, '.settings-btn block not found in settings.html');
  const block = settingsBtnBlock[1];
  assert.doesNotMatch(block, /\bborder\s*:/, '.settings-btn should not redeclare border');
  assert.doesNotMatch(block, /\bbackground\s*:/, '.settings-btn should not redeclare background');
  assert.doesNotMatch(block, /\bcursor\s*:/, '.settings-btn should not redeclare cursor');
});

// Modal buttons (cancelBtn/confirmBtn) get hub-btn from settings.js at runtime.
// Verify the className assignment in settings.js includes hub-btn.
const settingsJsSrc = readSrc('src/settings/settings.js');

test('hub-btn: modal Cancel button (rsCancel) is assigned hub-btn in settings.js', () => {
  assert.match(settingsJsSrc, /cancelBtn\.className\s*=\s*'[^']*hub-btn[^']*'/,
    'cancelBtn.className should include hub-btn');
});

test('hub-btn: modal Reset button (rsConfirm) is assigned hub-btn in settings.js', () => {
  assert.match(settingsJsSrc, /confirmBtn\.className\s*=\s*'[^']*hub-btn[^']*'/,
    'confirmBtn.className should include hub-btn');
});

// --- popup.html ---

const popupHtml = readSrc('src/popup/popup.html');

test('hub-btn: popup exportBtn uses hub-btn', () => {
  assert.match(popupHtml, /id="exportBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="exportBtn"/,
    'popup exportBtn should have hub-btn class');
});

test('hub-btn: popup importBtn uses hub-btn', () => {
  assert.match(popupHtml, /id="importBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="importBtn"/,
    'popup importBtn should have hub-btn class');
});

test('hub-btn: popup settingsBtn uses hub-btn', () => {
  assert.match(popupHtml, /id="settingsBtn"[^>]*class="[^"]*hub-btn[^"]*"|class="[^"]*hub-btn[^"]*"[^>]*id="settingsBtn"/,
    'popup settingsBtn should have hub-btn class');
});

// Tripwire: popup must not have a bare `button {` selector anymore.
test('hub-btn: popup.html no longer has a bare button { selector', () => {
  assert.doesNotMatch(popupHtml, /^\s*button\s*\{/m,
    'bare button { selector found in popup.html — use .hub-btn instead');
});

// Drift check: popup's local hub-btn copy must declare the same key
// properties as shared.css's hub-btn (border, background, cursor, transition).
test('hub-btn: popup.html local .hub-btn copy declares the core shared properties', () => {
  // Match the standalone .hub-btn { block, not the `body.android .hub-btn` override.
  const popupHubBtnBlock = popupHtml.match(/(?:^|\n)\s*\.hub-btn\s*\{([^}]*)\}/m);
  assert.ok(popupHubBtnBlock, '.hub-btn block not found in popup.html');
  const block = popupHubBtnBlock[1];
  assert.match(block, /\bborder\s*:/, 'popup .hub-btn missing border');
  assert.match(block, /\bbackground\s*:/, 'popup .hub-btn missing background');
  assert.match(block, /\bcursor\s*:/, 'popup .hub-btn missing cursor');
  assert.match(block, /\btransition\s*:/, 'popup .hub-btn missing transition');
});
