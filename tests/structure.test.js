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
  // Find the div.settings-option-row that contains resetSettingsBtn specifically.
  const resetRowMatch = settingsHtml.match(/<div class="settings-option-row">(?:(?!<div class="settings-option-row">)[\s\S])*?id="resetSettingsBtn"[\s\S]*?<\/div>/);
  assert.ok(resetRowMatch, 'could not find <div class="settings-option-row"> containing resetSettingsBtn');
  assert.match(resetRowMatch[0], /<button[^>]+id="resetSettingsBtn"/,
    'Reset Settings row must contain a native <button>');
  assert.doesNotMatch(resetRowMatch[0], /<input type="radio"/,
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

// --- Animations: shared rules every surface must keep ---
// The popup and the report can't load shared.css, so each carries its own
// copy of the motion rules. These pin the parts that are easy to lose.

const sharedCssForMotion = readSrc('src/common/shared.css');
const reportCssForMotion = readSrc('src/background/report.css');

test('motion: shared.css, the popup and the report all honor prefers-reduced-motion', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    assert.match(src, /@media \(prefers-reduced-motion: reduce\)/, `${name} is missing its reduced-motion rule`);
  }
});

test('motion: shared.css, the popup and the report all define the .theme-switching color transition', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    assert.match(src, /:root\.theme-switching/, `${name} is missing the theme transition`);
  }
});

test('motion: entrance animations use backwards fill (a held final keyframe would override :hover transforms)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    const entrance = src.match(/animation:\s*(?:hub-card-in|hub-rise-in|hub-unfold|hub-title-in|hub-wipe-in|popup-card-in|popup-in)[^;]*;/g) || [];
    assert.ok(entrance.length > 0, `${name} has no entrance animation`);
    for (const decl of entrance) {
      assert.match(decl, /backwards/, `${name}: "${decl}" must use backwards fill`);
      assert.doesNotMatch(decl, /\b(both|forwards)\b/, `${name}: "${decl}" must not hold its last frame`);
    }
  }
});

test('motion: search fade rules (.is-filtered + allow-discrete) exist in shared.css and the report', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['report.css', reportCssForMotion]]) {
    assert.match(src, /\.addon-row\.is-filtered/, `${name}: missing .is-filtered rule`);
    assert.match(src, /allow-discrete/, `${name}: missing the display transition`);
    assert.match(src, /@starting-style/, `${name}: missing @starting-style (fade-in)`);
  }
});

test('motion: the report switches animations off when printing', () => {
  assert.match(reportCssForMotion, /@media print\s*\{[\s\S]*animation:\s*none/);
});

test('motion: the report only animates theme changes after first paint', () => {
  const src = readSrc('src/background/report-template.js');
  assert.match(src, /var themeReady = false;/);
  assert.match(src, /applyTheme\(loadPersistedTheme\(\)\);\s*themeReady = true;/);
});

test('motion: shared.css, the popup and the report all define the view-transition theme switch', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    assert.match(src, /::view-transition-old\(root\)/, `${name} is missing the old-snapshot rule`);
    assert.match(src, /::view-transition-new\(root\)/, `${name} is missing the new-snapshot rule`);
    assert.match(src, /@keyframes hub-theme-in/, `${name} is missing hub-theme-in`);
    assert.match(src, /::view-transition-old\(root\)\s*\{\s*animation:\s*none/, `${name}: the old page should stay put under the fade`);
  }
});

test('motion: the theme switch is a plain cross-fade (no blur, no zoom)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    const kf = src.match(/@keyframes hub-theme-in\s*\{[^}]*\}[^}]*\}/);
    assert.ok(kf, `${name}: hub-theme-in keyframes not found`);
    assert.doesNotMatch(kf[0], /blur|scale|transform/, `${name}: the theme fade must be opacity only`);
  }
});

test('motion: nothing leaves a full-screen overlay behind (the old .theme-flash veil is gone)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    assert.doesNotMatch(src, /\.theme-flash/, `${name} still has .theme-flash`);
  }
});

test('motion: shared.css has the .replay-reset rule replayEntrance() depends on (covers everything inside the card)', () => {
  assert.match(sharedCssForMotion, /\.replay-reset,\s*\.replay-reset \*\s*\{\s*animation:\s*none/);
});

test('motion: reduced motion also zeroes animation delays, so staged reveals never leave content hidden', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    const block = src.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\s*\}\n/);
    assert.ok(block, `${name}: reduced-motion block not found`);
    assert.match(block[0], /animation-delay:\s*0s\s*!important/, `${name} must zero animation-delay`);
  }
});

test('settings: the page reveals in order - card, then title, then each section top to bottom', () => {
  const html = readSrc('src/settings/settings.html');
  const sec = (re, label) => {
    const m = html.match(re);
    assert.ok(m, `${label} delay not found`);
    return parseFloat(m[1]);
  };
  const card = sec(/\.card \{ animation-delay: ([\d.]+)s; \}/, 'card');
  const title = sec(/\.card > h1:first-child \{ animation-delay: ([\d.]+)s; \}/, 'title');
  const groups = [1, 2, 3, 4, 5, 6].map((n) =>
    sec(new RegExp(`:nth-of-type\\(${n}\\) \\{ --gd: ([\\d.]+)s; \\}`), `section ${n}`));
  assert.ok(card > 0, 'the card must wait so the bare background shows first');
  assert.ok(title > card, 'title comes after the card');
  assert.ok(groups[0] > title, 'first section comes after the title');
  for (let i = 1; i < groups.length; i++) {
    assert.ok(groups[i] > groups[i - 1], `section ${i + 1} must come after section ${i}`);
  }
  // 6 groups in the markup, so none is left without a delay.
  assert.strictEqual((html.match(/<div class="settings-group"/g) || []).length, 6);
});

test('motion: popup Settings button asks an already-open Settings tab to replay its entrance', () => {
  const popupJs = readSrc('src/popup/popup.js');
  assert.match(popupJs, /openOptionsPage\(\)[\s\S]*replaySettingsEntrance/);
  assert.match(readSrc('src/settings/settings.js'), /replaySettingsEntrance/);
});

test('settings: pressing Settings again (popup message) scrolls to the top and replays the reveal; a plain tab switch does neither', () => {
  const src = readSrc('src/settings/settings.js');
  assert.match(src, /function scrollSettingsToTop\(\)[\s\S]*window\.scrollTo\(\{ top: 0/);
  const onMessage = src.match(/message\.type === 'replaySettingsEntrance'\) \{([\s\S]*?)\n    \}/);
  assert.ok(onMessage, 'message handler not found');
  assert.match(onMessage[1], /scrollSettingsToTop\(\)/);
  assert.match(onMessage[1], /replayEntranceIfIdle\(\)/);
  // Switching back to the tab must not replay the ~2s reveal or reset scroll.
  assert.doesNotMatch(src, /addEventListener\('visibilitychange'/);
});

test('popup: opens in order - card, then title, then the three buttons top to bottom', () => {
  const delay = (re, label) => {
    const m = popupHtml.match(re);
    assert.ok(m, `${label} delay not found`);
    return parseFloat(m[1]);
  };
  const card = delay(/\.card \{[^}]*animation-delay:\s*([\d.]+)s/, 'card');
  const title = delay(/h3 \{ animation-delay: ([\d.]+)s; \}/, 'title');
  const exp = delay(/#exportBtn \{ animation-delay: ([\d.]+)s; \}/, 'export button');
  const imp = delay(/#importBtn \{ animation-delay: ([\d.]+)s; \}/, 'import button');
  const set = delay(/#settingsBtn \{ animation-delay: ([\d.]+)s; \}/, 'settings button');
  assert.ok(card > 0, 'the card must wait so the bare background shows first');
  assert.ok(title > card && exp > title && imp > exp && set > imp, 'each step must come after the one above it');
});

test('popup: overflow is hidden only while the reveal runs, so sliding items cannot flash a scrollbar', () => {
  assert.match(popupHtml, /@keyframes popup-no-scroll\s*\{\s*from, to \{ overflow: hidden; \}/);
  assert.match(popupHtml, /html \{ animation: popup-no-scroll [\d.]+s; \}/);
});

test('settings and popup: the reveal animations never use blur, and always hold hidden until their turn (backwards fill)', () => {
  const settingsHtml = readSrc('src/settings/settings.html');
  for (const [name, src] of [['settings.html', settingsHtml], ['popup.html', popupHtml]]) {
    // The only blur allowed is the reset dialog's backdrop-filter (a blurred
    // page behind a dialog), never inside an animation's keyframes.
    const withoutBackdrop = src.replace(/(-webkit-)?backdrop-filter:[^;]*;/g, '');
    assert.doesNotMatch(withoutBackdrop, /blur\(/, `${name} must not use blur in its animations`);
    assert.doesNotMatch(src, /animation-fill-mode:\s*(both|forwards)/, `${name} must not hold a final keyframe`);
  }
  // Settings spells its animations out longhand; the fill must be backwards.
  assert.match(settingsHtml, /\.settings-group > \* \{[^}]*animation-fill-mode: backwards;/);
  for (const kf of ['settings-card-unfold', 'settings-title-in', 'settings-slide-in', 'settings-wipe-in']) {
    assert.match(settingsHtml, new RegExp(`@keyframes ${kf}`), `missing @keyframes ${kf}`);
  }
  for (const kf of ['popup-card-in', 'popup-title-in', 'popup-in']) {
    assert.match(popupHtml, new RegExp(`@keyframes ${kf}`), `missing @keyframes ${kf}`);
  }
});

test('settings and popup: clipped reveals end beyond the box so shadows and focus rings are never cut off', () => {
  const settingsHtml = readSrc('src/settings/settings.html');
  for (const [name, src] of [['settings.html', settingsHtml], ['popup.html', popupHtml]]) {
    const ends = src.match(/to\s*\{[^}]*clip-path:\s*inset\(([^)]*)\)/g) || [];
    assert.ok(ends.length > 0, `${name}: no clip-path reveal found`);
    for (const end of ends) {
      assert.match(end, /inset\(-\d+px/, `${name}: "${end}" must end with a negative inset`);
    }
  }
});

// --- Press feedback (click/tap ring) ---

test('press: every extension page loads press.js', () => {
  for (const page of ['src/popup/popup.html', 'src/export/export.html', 'src/import/import.html', 'src/settings/settings.html', 'src/confirmation/confirmation.html']) {
    assert.match(readSrc(page), /<script src="\.\.\/common\/press\.js"><\/script>/, `${page} does not load press.js`);
  }
});

test('press: shared.css, the popup and the report all define the --press-ring colour, in light and dark', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    const defs = src.match(/--press-ring:/g) || [];
    assert.strictEqual(defs.length, 2, `${name} should define --press-ring for light and dark`);
  }
});

test('press: the report carries its own copy of the press feedback (it cannot load press.js)', () => {
  const src = readSrc('src/background/report-template.js');
  assert.match(src, /Mirrors src\/common\/press\.js/);
  assert.match(src, /el\.animate\(/);
  assert.match(src, /addEventListener\('pointerdown'/);
});

test('press: buttons press in fast and spring back out (a long transform transition, a short one while :active)', () => {
  for (const [name, src, spring] of [['shared.css', sharedCssForMotion, '--motion-spring'], ['popup.html', popupHtml, '--spring']]) {
    assert.match(src, new RegExp(`transform 0\\.35s var\\(${spring}\\)`), `${name}: .hub-btn needs the springy release`);
    assert.match(src, /\.hub-btn:active \{ transform: scale\(0\.95\); transition-duration: 0\.08s; \}/, `${name}: .hub-btn:active`);
  }
});



test('settings: the reset dialog backdrop is a visible blur (page stays readable behind it)', () => {
  const html = readSrc('src/settings/settings.html');
  assert.match(html, /\.s-overlay \{[^}]*backdrop-filter:\s*blur\(\d+px\)/);
  // Dim only lightly - the page behind must remain visible.
  const alpha = parseFloat(html.match(/\.s-overlay \{[^}]*background:\s*rgba\(0, 0, 0, ([\d.]+)\)/)[1]);
  assert.ok(alpha > 0 && alpha <= 0.4, `light tint expected, got ${alpha}`);
});

test('settings: the success message slides in (no check mark), with a light and dark success colour', () => {
  const html = readSrc('src/settings/settings.html');
  assert.match(html, /:root \{ --success-color: #[0-9a-f]{6}; \}/i);
  assert.match(html, /:root\[data-theme="dark"\] \{ --success-color: #[0-9a-f]{6}; \}/i);
  for (const id of ['exportSettingsStatus', 'importSettingsStatus', 'resetSettingsStatus']) {
    assert.match(html, new RegExp(`#${id}\\.is-success`), `${id} is missing its success style`);
  }
  assert.doesNotMatch(html, /2713|\u2713/, 'the check mark was removed on purpose');
  assert.doesNotMatch(html, /\.is-success::before/);
});

test('settings: descriptions and messages are inline-block, so sliding them in actually moves them', () => {
  const html = readSrc('src/settings/settings.html');
  assert.match(html, /#exportSettingsDesc[\s\S]*?#resetSettingsStatus \{ display: inline-block; \}/);
});

// --- Staged opening reveal: Exporter, Importer and the HTML report ---

test('staged reveal: the Exporter and Importer cards opt in with the "staged" class', () => {
  for (const page of ['src/export/export.html', 'src/import/import.html']) {
    assert.match(readSrc(page), /<div class="card staged">/, `${page} must use class="card staged"`);
  }
});

test('staged reveal: the Exporter and Importer load reveal.js, which times every part in page order', () => {
  for (const page of ['src/export/export.html', 'src/import/import.html']) {
    const html = readSrc(page);
    assert.match(html, /<script src="\.\.\/common\/reveal\.js"><\/script>/, `${page} must load reveal.js`);
    // The start times come from reveal.js now, not from hand-written --d rules.
    assert.doesNotMatch(html, /--d:/, `${page} must not hard-code --d any more`);
  }
});

test('step by step: the description on the Exporter and both paragraphs on the Importer are marked intro-text', () => {
  assert.match(readSrc('src/export/export.html'), /<p id="exportDesc" class="intro-text">/);
  const imp = readSrc('src/import/import.html');
  assert.strictEqual((imp.match(/<p class="intro-text">/g) || []).length, 2);
});

test('staged reveal: the Exporter search box takes its place in the order even though it is shown later (data-stage)', () => {
  assert.match(readSrc('src/export/export.html'), /id="searchInput"[^>]*data-stage[^>]*style="display:none;"/);
  // The Importer's search box is revealed whenever a file is chosen, so it must NOT hold a slot.
  assert.doesNotMatch(readSrc('src/import/import.html'), /id="searchInput"[^>]*data-stage/);
});

test('staged reveal: no leftover rule makes the search box appear at once, ahead of the text above it', () => {
  assert.doesNotMatch(sharedCssForMotion, /#searchInput, #listControls, #checklistBox, #fileNameRow \{ animation-delay: 0s; \}/);
});

// The Settings page is the reference: the other pages must animate exactly like it.
function keyframesBody(src, name) {
  const m = src.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\s*\\}\\n`));
  assert.ok(m, `@keyframes ${name} not found`);
  return m[1].replace(/\s+/g, ' ').trim();
}

test('same as Settings: the Exporter, Importer and report use the very same animations as the Settings page', () => {
  const settings = readSrc('src/settings/settings.html');
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['report.css', reportCssForMotion]]) {
    assert.strictEqual(keyframesBody(src, 'hub-unfold'), keyframesBody(settings, 'settings-card-unfold'), `${name}: card unfold`);
    assert.strictEqual(keyframesBody(src, 'hub-title-in'), keyframesBody(settings, 'settings-title-in'), `${name}: title`);
    assert.strictEqual(keyframesBody(src, 'hub-wipe-in'), keyframesBody(settings, 'settings-wipe-in'), `${name}: wipe (parts and rows)`);
    assert.strictEqual(keyframesBody(src, 'hub-slide-in'), keyframesBody(settings, 'settings-slide-in'), `${name}: slide (headings)`);
  }
});

test('same as Settings: the same durations - card 0.8s, title 0.6s, parts and rows 0.55s', () => {
  const settings = readSrc('src/settings/settings.html');
  assert.match(settings, /animation-duration: 0\.8s;/);
  assert.match(settings, /animation-name: settings-title-in;\s*animation-duration: 0\.6s;/);
  assert.match(settings, /\.settings-group > \* \{[^}]*animation-duration: 0\.55s;/);
  assert.match(sharedCssForMotion, /\.card\.staged \{ animation: hub-unfold 0\.8s /);
  assert.match(sharedCssForMotion, /\.card\.staged > h1:first-child \{ animation: hub-title-in 0\.6s /);
  assert.match(sharedCssForMotion, /\.card\.staged > :not\(h1\) \{ animation: hub-wipe-in 0\.55s /);
  assert.match(sharedCssForMotion, /#addonList\.revealing \.addon-row \{[^}]*animation: hub-wipe-in 0\.55s /);
  assert.match(sharedCssForMotion, /#addonList\.revealing \.group-heading \{[^}]*animation: hub-slide-in 0\.55s /);
  assert.match(reportCssForMotion, /\.card \{ animation: hub-unfold 0\.8s /);
  assert.match(reportCssForMotion, /\.card > h1 \{ animation: hub-title-in 0\.6s /);
  assert.match(reportCssForMotion, /#addonList\.revealing \.addon-row \{[^}]*animation: hub-wipe-in 0\.55s /);
});

test('same as Settings: the same spacing - one part every 0.16s, one row every 0.08s', () => {
  const settings = readSrc('src/settings/settings.html');
  const groups = [1, 2, 3, 4, 5, 6].map((n) => parseFloat(settings.match(new RegExp(`:nth-of-type\\(${n}\\) \\{ --gd: ([\\d.]+)s; \\}`))[1]));
  assert.strictEqual(Math.round((groups[1] - groups[0]) * 1000) / 1000, 0.16, 'Settings: sections 0.16s apart');
  assert.match(settings, /var\(--i, 0\) \* 0\.08s/, 'Settings: rows 0.08s apart');
  const reveal = readSrc('src/common/reveal.js');
  assert.match(reveal, /const PART_STEP = 0\.16;/);
  assert.match(reveal, /const ROW_STEP = 0\.08;/);
  const tpl = readSrc('src/background/report-template.js');
  assert.match(tpl, /PART_STEP = 0\.16/);
  assert.match(tpl, /ROW_STEP = 0\.08/);
});

test('same as Settings: nothing from the older versions is left over (no typewriter, no box-then-label, no line reveal)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['report.css', reportCssForMotion], ['reveal.js', readSrc('src/common/reveal.js')]]) {
    assert.doesNotMatch(src, /tw-char|hub-lines-in|reveal-lines|type-text|label-in|hub-row-in|--dt/, `${name} still has an older reveal`);
  }
});

test('staged reveal: shared.css order is card (0.15s) -> title (0.55s) -> parts (from --d)', () => {
  assert.match(sharedCssForMotion, /\.card\.staged \{ animation: hub-unfold [^;]*backwards; animation-delay: 0\.15s; \}/);
  assert.match(sharedCssForMotion, /\.card\.staged > h1:first-child \{ animation: hub-title-in [^;]*backwards; animation-delay: 0\.55s; \}/);
  assert.match(sharedCssForMotion, /\.card\.staged > :not\(h1\) \{ animation: hub-wipe-in [^;]*backwards; animation-delay: var\(--d, 0s\); \}/);
});

test('staged reveal: the report opens in order - card, title, intro, search box, list (also without its script)', () => {
  const delay = (re, label) => {
    const m = reportCssForMotion.match(re);
    assert.ok(m, `${label} delay not found`);
    return parseFloat(m[1]);
  };
  const card = delay(/\.card \{ animation: hub-unfold [^;]*; animation-delay: ([\d.]+)s; \}/, 'card');
  const title = delay(/\.card > h1 \{ animation: hub-title-in [^;]*; animation-delay: ([\d.]+)s; \}/, 'title');
  const intro = delay(/\.card > \.intro-text \{ animation: hub-wipe-in [^;]*; animation-delay: var\(--d, ([\d.]+)s\); \}/, 'intro');
  const search = delay(/\.card > \.search-input \{ animation: hub-wipe-in [^;]*; animation-delay: var\(--d, ([\d.]+)s\); \}/, 'search');
  const list = delay(/\.card > \.checklist-box \{ animation: hub-wipe-in [^;]*; animation-delay: var\(--d, ([\d.]+)s\); \}/, 'list');
  assert.ok(card > 0 && title > card && intro > title && search > intro && list > search);
});

test('same as Settings: the report times its parts and rows with its own script, and switches the entrance off afterwards', () => {
  const tpl = readSrc('src/background/report-template.js');
  assert.match(tpl, /<p class="intro-text"><strong>Tip:<\/strong>/);
  assert.match(tpl, /<div id="addonList" class="revealing">/);
  assert.match(tpl, /Opening reveal - mirrors src\/common\/reveal\.js/);
  assert.match(tpl, /list\.classList\.remove\('revealing'\)/, 'the flag is taken away again so searching never replays the entrance');
  assert.match(tpl, /Opening reveal[\s\S]*prefers-reduced-motion: reduce/, 'skipped for reduced motion');
});

test('staged reveal: clipped reveals in shared.css and the report end beyond the box (shadows and focus rings stay visible)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['report.css', reportCssForMotion]]) {
    for (const kf of ['hub-unfold', 'hub-wipe-in']) {
      const body = src.match(new RegExp(`@keyframes ${kf} \\{[\\s\\S]*?\\n\\s*\\}\\n`));
      assert.ok(body, `${name}: @keyframes ${kf} not found`);
      assert.match(body[0], /to\s*\{[^}]*clip-path:\s*inset\(-\d+px/, `${name}: ${kf} must end with a negative inset`);
      assert.doesNotMatch(body[0], /blur\(/, `${name}: ${kf} must not blur`);
    }
  }
});

test('staged reveal: the report removes all animation when printing (nothing caught half-revealed)', () => {
  assert.match(reportCssForMotion, /@media print\s*\{[\s\S]*animation:\s*none/);
});

test('list controls: Select all / Deselect all are pill buttons and the count is a badge that hides while empty', () => {
  const css = readSrc('src/common/shared.css');
  assert.match(css, /\.list-controls button \{[^}]*border-radius: 999px;/, 'pill buttons');
  assert.match(css, /\.list-controls button \{[^}]*border: 1px solid var\(--border\);/, 'visible outline, so they look pressable');
  assert.match(css, /#selectionCount \{[^}]*border-radius: 999px;/, 'count badge');
  assert.match(css, /#selectionCount:empty \{ display: none; \}/, 'no empty badge before the list loads');
  assert.match(css, /\.list-controls button:focus-visible \{[^}]*outline:/, 'keyboard focus stays visible');
  assert.match(css, /\.list-controls button:active \{ transform: scale\(0\.94\)/, 'pressed-in feel');
});

test('settings: the Light and Dark rows carry the report\'s sun and moon icons, and the chosen one spins in', () => {
  const html = readSrc('src/settings/settings.html');
  const light = html.match(/<label class="settings-option-row" for="themeLight">[\s\S]*?<\/label>/)[0];
  const dark = html.match(/<label class="settings-option-row" for="themeDark">[\s\S]*?<\/label>/)[0];
  assert.match(light, /<svg class="appearance-icon"[^>]*aria-hidden="true"[\s\S]*<circle cx="12" cy="12" r="5"\/>/, 'sun in the Light row');
  assert.match(dark, /<svg class="appearance-icon"[^>]*aria-hidden="true"[\s\S]*M21 12\.79A9 9 0 1 1 11\.21 3/, 'moon in the Dark row');
  assert.match(html, /\.settings-option-row input:checked ~ \.appearance-icon \{[^}]*animation: settings-icon-spin [^;]*backwards;/);
  assert.match(html, /@keyframes settings-icon-spin \{\s*from \{ opacity: 0; transform: rotate\(-200deg\) scale\(0\.3\); \}/, 'same spin as the report toggle');
  // The icons must be the very same shapes the report uses.
  const report = readSrc('src/background/report-template.js');
  assert.ok(report.includes('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'), 'report moon path');
});


// --- Tab icons (favicons) ---

test('favicon: every full page (the ones that open in a tab) links an icon, and that file really exists', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const pages = ['src/export/export.html', 'src/import/import.html', 'src/settings/settings.html', 'src/confirmation/confirmation.html'];
  for (const page of pages) {
    const m = readSrc(page).match(/<link rel="icon" href="([^"]+)">/);
    assert.ok(m, `${page} has no <link rel="icon">, so its tab would show no icon`);
    // Relative links resolve from the page's own folder (src/<page>/), not the project root.
    const resolved = path.resolve(root, path.dirname(page), m[1]);
    assert.ok(fs.existsSync(resolved), `${page}: icon link "${m[1]}" points at ${path.relative(root, resolved)}, which does not exist`);
  }
});
