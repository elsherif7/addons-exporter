// Exact text of every export format for a fixed list of add-ons, including the
// awkward cases. A refactor must not change what users get in their saved files.
//
// If an output is meant to change, regenerate and review the diff:
//     UPDATE_GOLDEN=1 node --test tests/golden.test.js
//
// \r\n is normalised before comparing so a checkout that converts line endings
// (git on Windows) doesn't fail. A separate test checks CSV/TXT really use \r\n.
//
// The stylesheet and icon are masked out: they have their own sync tests and a
// colour change shouldn't touch the golden files.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, readCommon, readReportBuilders, makeSandbox, FIREFOX_SOURCE: SOURCE } = require('./helpers');

const sandbox = makeSandbox({ URL }, readCommon(), readReportBuilders());
const { buildHtmlReport, buildJsonExport, buildCsvExport, buildTxtExport } = sandbox;
// fixed source, so the golden files don't depend on who regenerates them

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const AMO = 'https://addons.mozilla.org/en-US/firefox/addon/';
const fixture = [
  { id: 'uBlock0@raymondhill.net', name: 'uBlock Origin – free ad blocker', version: '1.58.0', enabled: true, type: 'extension', link: AMO + 'ublock-origin/', linkType: 'amo-exact' },
  { id: 'addon@darkreader.org', name: 'Dark Reader', version: '4.9.90', enabled: true, type: 'extension', link: AMO + 'darkreader/', linkType: 'amo-exact' },
  { id: '{7be2ba16-0f1e-4d93-9ebc-5164397477e9}', name: 'Buster: Captcha Solver for Humans', version: '2.0.1', enabled: true, type: 'extension', link: AMO + 'buster-captcha-solver/', linkType: 'amo-search' },
  { id: 'quotes@example.com', name: 'Tab "Stash", Pro Edition', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/tab,stash?x=1&y="2"', linkType: 'homepage' },
  { id: 'formula@example.com', name: '=SUM(1+1) Helper', version: '0.1', enabled: true, type: 'extension', link: AMO + 'formula-helper/', linkType: 'amo-exact' },
  { id: 'plus@example.com', name: '+Plus Notes', version: '3', enabled: false, type: 'extension', link: AMO + 'plus-notes/', linkType: 'amo-exact' },
  { id: 'jp@example.com', name: '広告ブロッカー - 日本語版', version: '2.5', enabled: true, type: 'extension', link: AMO + 'jp-blocker/', linkType: 'amo-exact' },
  { id: 'cafe@example.com', name: 'Café Tab Manager: Pro', version: '5.1.2', enabled: true, type: 'extension', link: AMO + 'cafe-tab-manager/', linkType: 'amo-exact' },
  // CSV quotes the newline, TXT writes it as \n
  { id: 'newline@example.com', name: 'Line\nBreak Tool', version: '1.1', enabled: false, type: 'extension', link: 'https://example.com/line-break', linkType: 'homepage' },
  { id: 'markup@example.com', name: '<script>alert(1)</script> & "friends"', version: '9.9', enabled: true, type: 'extension', link: 'https://example.com/?q=search&lang=en', linkType: 'amo-search-fallback' },
  { id: 'long@example.com', name: 'An Extremely Long Add-on Name That Goes Well Past Forty Characters Without Any Separator', version: '10.20.30', enabled: true, type: 'extension', link: AMO + 'long-name/', linkType: 'amo-exact' },
  { id: '{11111111-2222-3333-4444-555555555555}', name: 'Midnight Theme', version: '1.0', enabled: false, type: 'theme', link: 'https://example.com/midnight', linkType: 'homepage' },
  { id: 'sun@example.com', name: 'Sunrise — Light Theme', version: '2.0', enabled: true, type: 'theme', link: AMO + 'sunrise/', linkType: 'amo-exact' },
];

const norm = (s) => s.replace(/\r\n/g, '\n');

function maskHtml(html) {
  return html
    .replace(/<style>[\s\S]*?<\/style>/, '<style>/* report.css (checked by its own sync test) */</style>')
    .replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'data:image/png;base64,ICON');
}

function check(name, actual) {
  const file = path.join(GOLDEN_DIR, name);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual, 'utf8');
    return;
  }
  assert.ok(fs.existsSync(file), `missing golden file tests/golden/${name} - run: UPDATE_GOLDEN=1 node --test tests/golden.test.js`);
  const expected = fs.readFileSync(file, 'utf8');
  assert.strictEqual(norm(actual), norm(expected),
    `output differs from tests/golden/${name}. If the change is intended, run: UPDATE_GOLDEN=1 node --test tests/golden.test.js, then review the diff.`);
}

const variants = [
  ['short', true],
  ['full', false],
];

for (const [label, shorten] of variants) {
  test(`golden: JSON export (${label} names) is unchanged`, () => {
    check(`export-${label}.json`, buildJsonExport(fixture, shorten, SOURCE));
  });
  test(`golden: CSV export (${label} names) is unchanged`, () => {
    check(`export-${label}.csv`, buildCsvExport(fixture, shorten, SOURCE));
  });
  test(`golden: TXT export (${label} names) is unchanged`, () => {
    check(`export-${label}.txt`, buildTxtExport(fixture, shorten, SOURCE));
  });
  test(`golden: HTML report (${label} names, light) is unchanged`, () => {
    check(`report-${label}-light.html`, maskHtml(buildHtmlReport(fixture, 'light', shorten, SOURCE)));
  });
}
test('golden: HTML report (short names, dark) is unchanged', () => {
  check('report-short-dark.html', maskHtml(buildHtmlReport(fixture, 'dark', true, SOURCE)));
});

test('golden: an empty list gives the same (valid) output in every format', () => {
  check('empty.json', buildJsonExport([], true, SOURCE));
  check('empty.csv', buildCsvExport([], true, SOURCE));
  check('empty.txt', buildTxtExport([], true, SOURCE));
  check('empty.html', maskHtml(buildHtmlReport([], 'light', true, SOURCE)));
});

// the only lone \n allowed in CSV is inside the quoted name with a newline
test('golden: CSV and TXT exports separate lines with \\r\\n, JSON with \\n', () => {
  const lone = (text) => (text.match(/(?<!\r)\n/g) || []).length;
  assert.ok(buildCsvExport(fixture, true, SOURCE).includes('\r\n'));
  assert.strictEqual(lone(buildCsvExport(fixture, true, SOURCE)), 1, 'CSV: only the newline inside the quoted name');
  assert.ok(buildTxtExport(fixture, true, SOURCE).includes('\r\n'));
  assert.strictEqual(lone(buildTxtExport(fixture, true, SOURCE)), 0, 'TXT: no stray line breaks');
  assert.ok(!buildJsonExport(fixture, true, SOURCE).includes('\r'), 'JSON has no \\r');
});

// so trimming the fixture can't silently weaken the tests above
test('golden: the fixture still contains each awkward case', () => {
  const names = fixture.map((a) => a.name).join('\n');
  assert.ok(/"/.test(names) && /,/.test(names), 'quotes and commas');
  assert.ok(/\n/.test(fixture.find((a) => a.id === 'newline@example.com').name), 'a newline');
  assert.ok(fixture.some((a) => /^[=+]/.test(a.name)), 'a leading formula character');
  assert.ok(fixture.some((a) => /[^\x00-\x7F]/.test(a.name)), 'non-ASCII text');
  assert.ok(fixture.some((a) => a.name.length > 40 && sandbox.shortName(a.name) === a.name), 'a very long name that shortening leaves alone');
  assert.ok(fixture.some((a) => /</.test(a.name)), 'markup');
  assert.ok(fixture.some((a) => a.type === 'theme'), 'a theme');
  assert.ok(fixture.some((a) => !a.enabled), 'a disabled add-on');
});

test('golden: TXT escaping is unchanged', () => {
  const escapes = [
    { id: 'a@example.com', name: 'Pipe | Name', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'homepage' },
    { id: 'b@example.com', name: 'Line\nBreak\r\nName', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/b', linkType: 'homepage' },
    { id: 'c@example.com', name: 'C:\\Tools\\ \\| end\\', version: '1.0', enabled: false, type: 'theme', link: 'https://example.com/c d', linkType: 'homepage' },
    { id: 'd@example.com', name: '  Padded  ', version: '1.0', enabled: false, type: 'extension', link: 'https://example.com/d', linkType: 'homepage' },
  ];
  check('escapes.txt', buildTxtExport(escapes, false, SOURCE));
});
