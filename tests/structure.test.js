// Structural checks across the static HTML pages and the generated
// report - things that are easy to add to one page and forget on
// another, and that no other test file naturally covers.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, readSrc, evalInContext, readCommon, makeSandbox } = require('./helpers');

const HTML_PAGES = [
  'src/popup/popup.html',
  'src/export/export.html',
  'src/import/import.html',
  'src/settings/settings.html',
  'src/confirmation/confirmation.html',
];

// The Settings page is settings.html plus its stylesheet, settings.css; the
// tests below look at both together (markup and rules).
function readSettingsPage() {
  return readSrc('src/settings/settings.html') + '\n' + readSrc('src/settings/settings.css');
}

// --- settings-option-row refactor ---
// Every Settings option row (radio and tick-box rows, and action rows) must use the
// shared settings-option-row class. These tests act as tripwires: they
// catch regressions where someone adds a new row with a specialized
// class instead of the canonical one, or accidentally reintroduces the
// old class names.

const settingsHtml = readSettingsPage();

// Structural: all 8 option rows use settings-option-row.
test('settings-option-row: all 8 option label rows (radios and tick boxes) use settings-option-row', () => {
  const matches = [...settingsHtml.matchAll(/<label[^>]+class="settings-option-row"[^>]*>/g)];
  assert.strictEqual(matches.length, 8,
    `expected 8 option label rows with class="settings-option-row", found ${matches.length}`);
});

test('settings-option-row: the Reset Settings action row uses settings-option-row', () => {
  assert.match(settingsHtml, /<div class="settings-option-row">[^]*?id="resetSettingsBtn"/,
    'Reset Settings row should be a <div class="settings-option-row"> containing resetSettingsBtn');
});

// Semantics: option rows use <label> (not <div>), Reset uses <div> (not <label>).
test('settings-option-row: option rows are <label> elements (not <div>)', () => {
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

// Option input IDs, names, and values unchanged after the refactor.
for (const [id, name, value] of [
  ['themeLight',      'theme',        'light'],
  ['themeDark',       'theme',        'dark'],
  ['formatHtml',      'exportFormat', 'html'],
  ['formatJson',      'exportFormat', 'json'],
  ['formatCsv',       'exportFormat', 'csv'],
  ['formatTxt',       'exportFormat', 'txt'],
  ['shortenNamesOn',  'shortenNames', 'on'],
  ['shortenNamesOff', 'shortenNames', 'off'],
]) {
  test(`settings-option-row: input #${id} has name="${name}" and value="${value}"`, () => {
    const re = new RegExp(`id="${id}"[^>]*name="${name}"[^>]*value="${value}"|id="${id}"[^>]*value="${value}"[^>]*name="${name}"`);
    // The input tag itself carries id/name/value; order may vary.
    const inputRe = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`);
    const inputMatch = settingsHtml.match(inputRe);
    assert.ok(inputMatch, `could not find <input id="${id}">`);
    assert.match(inputMatch[0], new RegExp(`\\bname="${name}"`), `#${id} missing name="${name}"`);
    assert.match(inputMatch[0], new RegExp(`\\bvalue="${value}"`), `#${id} missing value="${value}"`);
  });
}

// label/input associations: every option <label> must have a for= that
// matches its input's id.
for (const [labelFor, radioId] of [
  ['themeLight',      'themeLight'],
  ['themeDark',       'themeDark'],
  ['formatHtml',      'formatHtml'],
  ['formatJson',      'formatJson'],
  ['formatCsv',       'formatCsv'],
  ['formatTxt',       'formatTxt'],
  ['shortenNamesOn',  'shortenNamesOn'],
  ['shortenNamesOff', 'shortenNamesOff'],
]) {
  test(`settings-option-row: label for="${labelFor}" is associated with input id="${radioId}"`, () => {
    assert.match(settingsHtml,
      new RegExp(`<label[^>]+class="settings-option-row"[^>]+for="${labelFor}"`),
      `label with for="${labelFor}" not found using settings-option-row`);
    assert.match(settingsHtml,
      new RegExp(`<input[^>]+id="${radioId}"`),
      `option input with id="${radioId}" not found`);
  });
}

// --- hub-btn refactor ---
// Every visible action button must use the shared hub-btn class.
// Tripwires catch regressions where someone adds a new button without
// the shared base, or reintroduces a duplicated button implementation.

// --- popup.html ---

const popupHtml = readSrc('src/popup/popup.html');

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

test('motion: the report only animates theme changes after first paint', () => {
  const src = readSrc('src/background/report-inline.js');
  assert.match(src, /var themeReady = false;/);
  assert.match(src, /applyTheme\(loadPersistedTheme\(\)\);\s*themeReady = true;/);
});

test('motion: reduced motion also zeroes animation delays, so staged reveals never leave content hidden', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml], ['report.css', reportCssForMotion]]) {
    const block = src.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\s*\}\n/);
    assert.ok(block, `${name}: reduced-motion block not found`);
    assert.match(block[0], /animation-delay:\s*0s\s*!important/, `${name} must zero animation-delay`);
  }
});

test('motion: popup Settings button asks an already-open Settings tab to replay its entrance', () => {
  const popupJs = readSrc('src/popup/popup.js');
  assert.match(popupJs, /openOptionsPage\(\)[\s\S]*replaySettingsEntrance/);
  assert.match(readSrc('src/settings/settings.js'), /replaySettingsEntrance/);
});

test('settings: pressing Settings again (popup message) scrolls to the top and replays the reveal; a plain tab switch does neither', () => {
  const src = readSrc('src/settings/settings.js');
  assert.match(readSrc('src/common/page-ui.js'), /function scrollPageToTop\(\)[\s\S]*window\.scrollTo\(\{ top: 0/);
  const onMessage = src.match(/message\.type === 'replaySettingsEntrance'\) \{([\s\S]*?)\n    \}/);
  assert.ok(onMessage, 'message handler not found');
  assert.match(onMessage[1], /scrollPageToTop\(\)/);
  assert.match(onMessage[1], /replayEntranceIfIdle\(\)/);
  // Nothing is left open on the page either: the reset confirmation goes, and
  // any message sitting in the Export/Import rows is cleared.
  assert.match(onMessage[1], /dismissResetDialog\(true\)/);
  assert.match(onMessage[1], /clearAllRows\(\)/);
  // Switching back to the tab must not replay the ~2s reveal or reset scroll.
  assert.doesNotMatch(src, /addEventListener\('visibilitychange'/);
});

test('export/import: opening the Exporter or Importer again replays its entrance, without resetting the page', () => {
  const pageUi = readSrc('src/common/page-ui.js');
  const answer = pageUi.match(/function answerWhereIsPage\(page, resetToFresh\) \{([\s\S]*?)\n\}/);
  assert.ok(answer, 'answerWhereIsPage not found');
  assert.match(answer[1], /scrollPageToTop\(\)/);
  assert.match(answer[1], /resetToFresh\(\)/);
  assert.match(answer[1], /replayStagedReveal\(\)/);
  // The rows only cascade while the list carries .revealing (reveal.js takes
  // the flag off once they are in), so the replay puts it back and restarts the
  // card and its parts too.
  const replay = pageUi.match(/function replayStagedReveal\(\) \{([\s\S]*?)\n\}/);
  assert.ok(replay, 'replayStagedReveal not found');
  assert.match(replay[1], /classList\.add\('revealing'\)/);
  assert.match(replay[1], /classList\.remove\('revealing'\)/);
  assert.match(replay[1], /replayEntrance\(\)/);
  assert.match(readSrc('src/export/export.js'), /answerWhereIsPage\('export', \(\) => list\.clearSearch\(\)\)/);
  // The Importer has a popup of its own to close (the .zip export picker) and a
  // search box to empty. Its file, list and ticks are left alone.
  assert.match(readSrc('src/import/import.js'), /answerWhereIsPage\('import', \(\) => \{[\s\S]*?closeExportPicker\(\);[\s\S]*?list\.clearSearch\(\);[\s\S]*?\}\);/);
  // The shared list is where clearing the search lives (addon-list.js).
  const addonList = readSrc('src/common/addon-list.js');
  assert.match(addonList, /function clearSearch\(\) \{[\s\S]*?searchInput\.value = '';[\s\S]*?applySearch\(\);/);
  assert.match(addonList, /return \{ checkboxes, updateSelectionCount, render, clearSearch \};/);
});

// --- Press feedback (click/tap ring) ---

test('press: every extension page loads press.js', () => {
  for (const page of ['src/popup/popup.html', 'src/export/export.html', 'src/import/import.html', 'src/settings/settings.html', 'src/confirmation/confirmation.html']) {
    assert.match(readSrc(page), /<script src="\.\.\/common\/press\.js"><\/script>/, `${page} does not load press.js`);
  }
});

test('press: tokens.css and the popup define the --press-ring colour, in light and dark', () => {
  for (const [name, src] of [['tokens.css', readSrc('src/common/tokens.css')], ['popup.html', popupHtml]]) {
    const defs = src.match(/--press-ring:/g) || [];
    assert.strictEqual(defs.length, 2, `${name} should define --press-ring for light and dark`);
  }
});

test('press: the report carries its own copy of the press feedback (it cannot load press.js)', () => {
  const src = readSrc('src/background/report-inline.js');
  assert.match(src, /Mirrors src\/common\/press\.js/);
  assert.match(src, /el\.animate\(/);
  assert.match(src, /addEventListener\('pointerdown'/);
});

test('press: buttons press in fast and spring back out (a long transform transition, a short one while :active)', () => {
  for (const [name, src] of [['shared.css', sharedCssForMotion], ['popup.html', popupHtml]]) {
    assert.match(src, /transform 0\.35s var\(--motion-spring\)/, `${name}: .hub-btn needs the springy release`);
    assert.match(src, /\.hub-btn:active \{ transform: scale\(0\.95\); transition-duration: 0\.08s; \}/, `${name}: .hub-btn:active`);
  }
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

test('Importer: the file input takes more than one file, and the page says so', () => {
  const imp = readSrc('src/import/import.html');
  const tag = imp.match(/<input[^>]*id="fileInput"[^>]*>/);
  assert.ok(tag, '#fileInput not found');
  assert.match(tag[0], /\bmultiple\b/, '#fileInput must accept several files at once');
  assert.match(imp, /Pick one or more <strong>exported files<\/strong>/, 'the intro must offer more than one file');
  assert.match(imp, /id="chooseFileBtn"[^>]*>Choose files</, 'the button must say files, not file');
});

test('staged reveal: the Exporter search box takes its place in the order even though it is shown later (data-stage)', () => {
  assert.match(readSrc('src/export/export.html'), /id="searchInput"[^>]*data-stage[^>]*style="display:none;"/);
  // The Importer's search box is revealed whenever a file is chosen, so it must NOT hold a slot.
  assert.doesNotMatch(readSrc('src/import/import.html'), /id="searchInput"[^>]*data-stage/);
});

// The Settings page is the reference: the other pages must animate exactly like it.
function keyframesBody(src, name) {
  const m = src.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\s*\\}\\n`));
  assert.ok(m, `@keyframes ${name} not found`);
  return m[1].replace(/\s+/g, ' ').trim();
}

test('same as Settings: the report copies shared.css\'s hub-* animations exactly (it cannot load shared.css)', () => {
  for (const name of ['hub-unfold', 'hub-title-in', 'hub-wipe-in', 'hub-slide-in']) {
    assert.strictEqual(keyframesBody(reportCssForMotion, name), keyframesBody(sharedCssForMotion, name), `${name} must match shared.css`);
  }
});

test('same as Settings: the Settings page reuses the shared hub-* animations instead of duplicating them', () => {
  const settings = readSettingsPage();
  for (const name of ['hub-unfold', 'hub-title-in', 'hub-wipe-in', 'hub-slide-in']) {
    assert.match(settings, new RegExp(`animation(?:-name)?: ${name}\\b`), `settings.css must use ${name}`);
  }
  assert.doesNotMatch(settings, /@keyframes settings-(card-unfold|title-in|wipe-in|slide-in)/, 'settings.css must not carry its own copies');
});

test('same as Settings: the same durations - card 0.8s, title 0.6s, parts and rows 0.55s', () => {
  const settings = readSettingsPage();
  assert.match(settings, /animation-duration: 0\.8s;/);
  assert.match(settings, /animation-name: hub-title-in;\s*animation-duration: 0\.6s;/);
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
  const settings = readSettingsPage();
  const groups = [1, 2, 3, 4, 5, 6].map((n) => parseFloat(settings.match(new RegExp(`:nth-of-type\\(${n}\\) \\{ --gd: ([\\d.]+)s; \\}`))[1]));
  assert.strictEqual(Math.round((groups[1] - groups[0]) * 1000) / 1000, 0.16, 'Settings: sections 0.16s apart');
  assert.match(settings, /var\(--i, 0\) \* 0\.08s/, 'Settings: rows 0.08s apart');
  const reveal = readSrc('src/common/reveal.js');
  assert.match(reveal, /const PART_STEP = 0\.16;/);
  assert.match(reveal, /const ROW_STEP = 0\.08;/);
  const tpl = readSrc('src/background/report-inline.js');
  assert.match(tpl, /PART_STEP = 0\.16/);
  assert.match(tpl, /ROW_STEP = 0\.08/);
});

test('same as Settings: the report times its parts and rows with its own script, and switches the entrance off afterwards', () => {
  const tpl = readSrc('src/background/report-template.js') + readSrc('src/background/report-inline.js');
  assert.match(tpl, /<p class="intro-text"><strong>Tip:<\/strong>/);
  assert.match(tpl, /<div id="addonList" class="revealing">/);
  assert.match(tpl, /Opening reveal - mirrors src\/common\/reveal\.js/);
  assert.match(tpl, /list\.classList\.remove\('revealing'\)/, 'the flag is taken away again so searching never replays the entrance');
  assert.match(tpl, /Opening reveal[\s\S]*prefers-reduced-motion: reduce/, 'skipped for reduced motion');
});

test('settings: the Light and Dark rows carry the report\'s sun and moon icons, and the chosen one spins in', () => {
  const html = readSettingsPage();
  const light = html.match(/<label class="settings-option-row" for="themeLight">[\s\S]*?<\/label>/)[0];
  const dark = html.match(/<label class="settings-option-row" for="themeDark">[\s\S]*?<\/label>/)[0];
  assert.match(light, /<svg class="appearance-icon"[\s\S]*<circle cx="12" cy="12" r="5"\/>/, 'sun in the Light row');
  assert.match(dark, /<svg class="appearance-icon"[\s\S]*M21 12\.79A9 9 0 1 1 11\.21 3/, 'moon in the Dark row');
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

// --- Live settings: every open page follows a change made anywhere ---

test('live settings: the theme, export format and name shortening each have a live listener on the pages that use them', () => {
  assert.match(readSrc('src/common/theme.js'), /changes\[THEME_STORAGE_KEY\][\s\S]*applyTheme\(/, 'every page follows the theme');
  assert.match(readSrc('src/export/export.js'), /onSettingsChanged\([\s\S]*'exportFormats'[\s\S]*updateExportDesc\(\)/, 'the Exporter follows the export format');
  // Both pages get this from the shared list (addon-list.js).
  const list = readSrc('src/common/addon-list.js');
  assert.match(list, /onShortenNamesChanged\(\(shorten\) => \{/, 'the shared list follows "Shorten add-on names"');
  assert.match(list, /nameEl\.dataset\.fullName = a\.name/, 'rows remember their full name');
  for (const page of ['src/export/export.js', 'src/import/import.js']) {
    assert.match(readSrc(page), /createAddonList\(\{/, `${page} uses the shared list`);
    assert.match(readSrc(page), /createAddonRowBase\(/, `${page} builds its rows from the shared row`);
  }
  const settings = readSrc('src/settings/settings.js');
  for (const [name, load] of [['theme', 'loadCurrentTheme'], ['exportFormats', 'loadCurrentExportFormat'], ['shortenNames', 'loadCurrentShortenNames']]) {
    assert.match(settings, new RegExp(`changed\\.includes\\('${name}'\\)\\) ${load}\\(`), `the Settings page follows ${name}`);
  }
});

test('settings: row messages (Export / Import / Reset) hide themselves after 7 seconds', () => {
  const src = readSrc('src/settings/settings.js');
  assert.match(src, /const STATUS_AUTO_HIDE_MS = 7000;/);
  assert.match(src, /hideTimer = setTimeout\([\s\S]*?STATUS_AUTO_HIDE_MS\)/);
  assert.match(src, /function restore\(\) \{\s*cancelAutoHide\(\);/, 'restoring the row (touching anything) cancels the pending hide');
});

test('confirmation page: opens exactly like Settings (a staged card, timed by reveal.js)', () => {
  const html = readSrc('src/confirmation/confirmation.html');
  assert.match(html, /<div class="card staged">/);
  assert.match(html, /<script src="\.\.\/common\/reveal\.js"><\/script>/);
  // reveal.js must be there before the page script, which builds the message.
  assert.ok(html.indexOf('reveal.js') < html.indexOf('confirmation.js'));
  // The heading, the message and the links are the card's direct children - the parts that get their turn.
  assert.match(html, /<h1 id="heading">/);
  assert.match(html, /<p id="message">/);
  assert.match(html, /<div class="about-block">/);
});

test('remove file (x): the Importer exits in reverse and releases its held frames', () => {
  const src = readSrc('src/import/import.js');
  assert.match(src, /async function removeFileAnimated\(\)/);
  assert.match(src, /removeFileBtn\.addEventListener\('click', removeFileAnimated\)/);
  assert.match(src, /fill: 'forwards'/);
  assert.match(src, /a\.cancel\(\)/, 'the held end frames are cancelled afterwards');
});

test('selection badge: the Exporter and Importer (shared list) set it through setSelectionCount, so a change animates', () => {
  assert.match(readSrc('src/common/addon-list.js'), /setSelectionCount\(countEl, /, 'the shared list must use setSelectionCount');
  assert.doesNotMatch(readSrc('src/common/addon-list.js'), /countEl\.textContent =/);
  assert.doesNotMatch(readSrc('src/export/export.js'), /selectionCountEl\.textContent =/);
});

test('settings.html: the Export Format tick boxes are exactly the registry formats, in order, with the registry text', () => {
  const html = readSettingsPage();
  const sb = makeSandbox({}, readCommon());
  const reg = Array.from(evalInContext(sb, 'EXPORT_FORMAT_REGISTRY'));
  const boxes = [...html.matchAll(/<input type="checkbox" name="exportFormat" id="(\w+)" value="(\w+)">/g)];
  assert.deepStrictEqual(boxes.map((m) => m[2]), reg.map((f) => f.id), 'same formats, same order');
  reg.forEach((f, i) => {
    assert.strictEqual(boxes[i][1], 'format' + f.id[0].toUpperCase() + f.id.slice(1), `${f.id} box id (settings-init.js relies on it)`);
    assert.ok(html.includes(`>${f.title}</span>`), `${f.id} title`);
    assert.ok(html.includes(f.description), `${f.id} description`);
  });
});

test('settings: the page keeps its styling in settings.css - only "display:none" starts hidden inline', () => {
  const html = readSrc('src/settings/settings.html');
  assert.doesNotMatch(html, /<style[\s>]/, 'settings.html must not have a <style> block');
  assert.match(html, /<link rel="stylesheet" href="settings\.css">/);
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    assert.strictEqual(m[1].replace(/[\s;]/g, ''), 'display:none', `unexpected inline style: ${m[1]}`);
  }
});

// The one shared button class: every action button on every page carries it, so
// they all press, hover and spring the same way.
test('hub-btn: every action button on the popup, Exporter, Importer and Settings carries hub-btn', () => {
  const pages = {
    'src/popup/popup.html': ['exportBtn', 'importBtn', 'settingsBtn'],
    'src/export/export.html': ['exportSelectedBtn'],
    'src/import/import.html': ['openSelectedBtn', 'chooseFileBtn'],
    'src/settings/settings.html': ['exportSettingsBtn', 'importSettingsBtn', 'resetSettingsBtn'],
  };
  for (const [page, ids] of Object.entries(pages)) {
    const html = readSrc(page);
    for (const id of ids) {
      const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
      assert.ok(tag, `${page}: #${id} not found`);
      assert.match(tag[0], /class="[^"]*\bhub-btn\b/, `${page}: #${id} must use hub-btn`);
    }
  }
  const js = readSrc('src/settings/settings.js');
  assert.match(js, /rsCancel[\s\S]{0,200}hub-btn|hub-btn[\s\S]{0,200}rsCancel/, 'the Cancel button in the reset dialog uses hub-btn');
  assert.match(js, /rsConfirm[\s\S]{0,200}hub-btn|hub-btn[\s\S]{0,200}rsConfirm/, 'the Reset button in the reset dialog uses hub-btn');
});

// Screen readers: icon-only buttons need a name, search boxes need a label,
// and the status messages must be announced when they change.
test('a11y: the remove-file button has a name and the search boxes are labelled', () => {
  const imp = readSrc('src/import/import.html');
  assert.match(imp.match(/<button[^>]*id="removeFileBtn"[^>]*>/)[0], /aria-label="[^"]+"/, 'removeFileBtn needs an aria-label');
  for (const page of ['src/import/import.html', 'src/export/export.html']) {
    const tag = readSrc(page).match(/<input[^>]*id="searchInput"[^>]*>/);
    assert.ok(tag, `${page}: #searchInput not found`);
    assert.match(tag[0], /aria-label="[^"]+"/, `${page}: #searchInput needs an aria-label`);
  }
});

test('a11y: status messages are polite live regions', () => {
  const pages = {
    'src/import/import.html': ['status'],
    'src/export/export.html': ['status'],
    'src/settings/settings.html': ['settingsStatus', 'exportSettingsStatus', 'importSettingsStatus', 'resetSettingsStatus'],
  };
  for (const [page, ids] of Object.entries(pages)) {
    const html = readSrc(page);
    for (const id of ids) {
      const tag = html.match(new RegExp(`<span[^>]*id="${id}"[^>]*>`));
      assert.ok(tag, `${page}: #${id} not found`);
      assert.match(tag[0], /role="status"/, `${page}: #${id} needs role="status"`);
      assert.match(tag[0], /aria-live="polite"/, `${page}: #${id} needs aria-live="polite"`);
    }
  }
});

// The minimum Firefox version has to cover what the code relies on:
// - 127: MV3 host permissions are granted at install (the AMO lookups need them)
// - 128: the first version that accepts data_collection_permissions without an error
// - 112: element.inert (the reset dialog) and linear() easing
//
// web-ext warns twice about that floor, because the key it looks for,
// data_collection_permissions, is only expected from Firefox 140 (142 on
// Android). Both warnings are deliberate: a Firefox that does not know a key
// ignores it, and 128 is what the rest of the extension needs, so neither
// warning is a reason to raise the floor. The README explains both by name.
test('manifest: strict_min_version is at least 128 and the README states the same', () => {
  const manifest = JSON.parse(readSrc('manifest.json'));
  const min = manifest.browser_specific_settings.gecko.strict_min_version;
  assert.ok(parseInt(min, 10) >= 128, `strict_min_version ${min} is below 128`);
  assert.ok(manifest.browser_specific_settings.gecko.data_collection_permissions, 'data_collection_permissions is declared');
  const readme = readSrc('README.md');
  assert.match(readme, new RegExp(`Requires Firefox ${parseInt(min, 10)} or newer`), 'README states the same minimum version');
  for (const code of ['KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION', 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION']) {
    assert.ok(readme.includes(code), `README explains the ${code} warning instead of leaving it unexplained`);
  }
});

// web-ext reads .web-ext-config.mjs for every command, so `web-ext lint` and
// `web-ext build` behave the same whether they run through `npm run lint:ext`
// or are typed by hand. This list is what keeps development-only files out of
// the lint report and out of any package.
test('web-ext config: development-only files are ignored, however web-ext is started', () => {
  const config = readSrc('.web-ext-config.mjs');
  for (const pattern of ['tests/**', 'scripts/**', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'coverage/**']) {
    assert.ok(config.includes(`'${pattern}'`), `.web-ext-config.mjs does not ignore ${pattern}`);
  }
  // The report's build input is a real script the linter should see, so it must
  // not be in the list.
  assert.ok(!config.includes('report-inline.js'), 'report-inline.js should be linted, not ignored');
  assert.match(readSrc('package.json'), /"lint:ext": "npx --yes web-ext@10\.8\.0 lint"/, 'lint:ext must rely on the config file, not a repeated ignore list');
});

// Node 20 reached end of life in April 2026, so the project asks for the
// oldest Node that is still supported. The README states the same number, so a
// reader is never told something the tooling does not ask for.
test('tooling: package.json and the README agree on the Node version', () => {
  const { engines } = JSON.parse(readSrc('package.json'));
  const major = engines.node.replace(/[^0-9]/g, '');
  assert.match(readSrc('README.md'), new RegExp(`needs Node ${major} or newer`), 'README states the same Node version');
});

// --- The fake DOM's blind spot: the CSS half of a JS/CSS contract ---
// The page scripts are tested against a fake DOM with no CSS engine (see the
// "Minimal fake DOM" comment in tests/helpers.js for the full list of what it
// cannot do). It can see that a script put a class on an element, but never
// that anything styles that class - so a class whose rule was renamed,
// deleted, or moved into a stylesheet the page never loads does nothing in
// Firefox and nothing in the test suite either. These two tests read the
// stylesheets as text instead, which is the only place that half of the
// contract can be checked without a browser.

// Every file under src/ with the given extension, as project-relative paths
// with forward slashes, so a new file is picked up without touching these.
function filesUnder(dir, extension) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(relative, extension));
    else if (entry.name.endsWith(extension)) out.push(relative);
  }
  return out;
}

// Every stylesheet a page can be affected by: the .css files, plus the inline
// <style> blocks that import.html, popup.html and confirmation.html carry (the
// picker's .dragover highlight and the .zip picker's options live there, not
// in a .css file).
function stylesheetSources() {
  const sources = filesUnder('src', '.css').map(readSrc);
  for (const file of filesUnder('src', '.html')) {
    for (const block of readSrc(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) sources.push(block[1]);
  }
  return sources;
}

// Every class a page script puts on an element, by either route: classList
// (toggled states such as .revealing or .dragover) or an assigned className
// (the rows, labels and dialogs built by addon-list.js, page-ui.js and the
// page scripts). The value maps a class to the file that sets it, for the
// failure message.
function classesSetByScripts() {
  const found = new Map();
  for (const file of filesUnder('src', '.js')) {
    const src = readSrc(file);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([\w-]+)'/g)) {
      if (!found.has(m[1])) found.set(m[1], file);
    }
    for (const m of src.matchAll(/\.className\s*=\s*'([^']*)'/g)) {
      for (const cls of m[1].split(/\s+/).filter(Boolean)) {
        if (!found.has(cls)) found.set(cls, file);
      }
    }
  }
  return found;
}

test('fake DOM boundary: every class the page scripts set is styled by a stylesheet', () => {
  const classes = classesSetByScripts();
  // Guard the guard: if the scan or the file walk broke, this must not pass by
  // finding almost nothing.
  assert.ok(classes.size >= 25, `only ${classes.size} classes found - did the scan break?`);

  const stylesheets = stylesheetSources().join('\n');
  for (const [cls, file] of classes) {
    assert.match(stylesheets, new RegExp(`\\.${cls}(?![\\w-])`),
      `${file} sets .${cls}, but no stylesheet styles it - it does nothing in Firefox, and the fake DOM cannot tell`);
  }
});

// The report is a standalone file: it carries its own copy of the CSS and
// loads nothing else. A class its script toggles therefore has to be in
// report.css itself - moving such a rule into shared.css would leave the
// report silently unstyled, which is invisible to the fake DOM either way.
test('fake DOM boundary: the report script only relies on classes report.css styles', () => {
  const toggled = new Set(
    [...readSrc('src/background/report-inline.js').matchAll(/classList\.(?:add|remove|toggle)\(\s*'([\w-]+)'/g)].map((m) => m[1])
  );
  assert.ok(toggled.size >= 3, `only ${toggled.size} classes found - did the scan break?`);

  const reportCss = readSrc('src/background/report.css');
  for (const cls of toggled) {
    assert.match(reportCss, new RegExp(`\\.${cls}(?![\\w-])`),
      `.${cls} is toggled by report-inline.js, but report.css does not style it`);
  }
});
