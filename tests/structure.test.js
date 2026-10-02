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

// --- A34: settings.html's static version fallback matches the manifest ---

test('A34 tripwire: settings.html\'s hardcoded version fallback matches manifest.json', () => {
  const manifest = JSON.parse(readSrc('manifest.json'));
  const settingsHtml = readSrc('src/settings/settings.html');
  const versionLinkMatch = settingsHtml.match(/id="versionLink"[^>]*>([^<]+)</);
  assert.ok(versionLinkMatch, 'could not find the #versionLink element in settings.html');
  assert.strictEqual(versionLinkMatch[1], manifest.version,
    `settings.html's static version fallback ("${versionLinkMatch[1]}") is out of sync with manifest.json ("${manifest.version}") - update settings.html`);
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
