// Tests for src/background/report-template.js. Loads the real source via
// vm, same as the other test files, but needs no browser/fetch mocking at
// all - buildHtmlReport() and its helpers are pure string templating with
// no browser.* dependency. That's the point of splitting it out of
// background.js: this file can be tested entirely on its own.

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { test, readSrc, evalInContext } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const reportTemplateSrc = readSrc('src/background/report-template.js');

const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);
vm.runInContext(reportTemplateSrc, sandbox);
const { buildHtmlReport, safeJsonForScriptTag, buildJsonExport, buildCsvExport } = sandbox;

// REPORT_ICON_DATA_URI is declared with top-level `const` in
// report-template.js, so (unlike the function declarations above) it
// isn't copied onto the sandbox object - it only exists in the context's
// own lexical scope. Evaluate it there directly instead of destructuring
// it from sandbox, same as import.test.js does for EXPORT_FORMAT_VERSION.
const REPORT_ICON_DATA_URI = evalInContext(sandbox, 'REPORT_ICON_DATA_URI');

const sampleList = [
  { id: 'ublock@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/', linkType: 'amo-exact' },
  { id: 'darkreader@example.com', name: 'Dark Reader', version: '4.9.90', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/addon/darkreader/', linkType: 'amo-search' },
  { id: 'old@example.com', name: 'Old Extension', version: '0.5', enabled: false, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/search/?q=Old%20Extension', linkType: 'amo-search-fallback' },
];

test('buildHtmlReport: groups add-ons into Enabled/Disabled sections with counts', () => {
  const html = buildHtmlReport(sampleList);
  assert.match(html, /Enabled \(2\)/);
  assert.match(html, /Disabled \(1\)/);
  assert.match(html, /uBlock Origin/);
  assert.match(html, /Dark Reader/);
  assert.match(html, /Old Extension/);
});

test('buildHtmlReport: escapes add-on names instead of inserting them raw', () => {
  const html = buildHtmlReport([
    { id: 'x@example.com', name: '<script>alert(1)</script>', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'homepage' },
  ]);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the raw tag should not appear unescaped in the HTML');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('buildHtmlReport: embeds a re-importable JSON payload with formatVersion and the given list', () => {
  const html = buildHtmlReport(sampleList);
  const dataMatch = html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch, 'expected an embedded #addons-exporter-data script tag');
  const data = JSON.parse(dataMatch[1]);
  assert.strictEqual(typeof data.formatVersion, 'number');
  assert.strictEqual(data.addons.length, sampleList.length);
  assert.deepStrictEqual(new Set(data.addons.map((a) => a.id)), new Set(sampleList.map((a) => a.id)));
});

test('buildHtmlReport: uses REPORT_ICON_DATA_URI as the page favicon', () => {
  const html = buildHtmlReport(sampleList);
  const faviconMatch = html.match(/<link rel="icon" href="(data:image\/png;base64,[^"]+)">/);
  assert.ok(faviconMatch, 'expected a <link rel="icon" href="data:image/png;base64,..."> in the report');
  assert.strictEqual(faviconMatch[1], REPORT_ICON_DATA_URI);
});

test('buildHtmlReport: defaults to light when no theme is given', () => {
  const html = buildHtmlReport(sampleList);
  assert.match(html, /<html data-theme="light">/);
});

test('buildHtmlReport: honors an explicit "dark" theme', () => {
  const html = buildHtmlReport(sampleList, 'dark');
  assert.match(html, /<html data-theme="dark">/);
});

test('buildHtmlReport: falls back to light for anything other than exactly "dark"', () => {
  assert.match(buildHtmlReport(sampleList, 'light'), /<html data-theme="light">/);
  assert.match(buildHtmlReport(sampleList, 'nonsense'), /<html data-theme="light">/);
  assert.match(buildHtmlReport(sampleList, undefined), /<html data-theme="light">/);
});

test('buildHtmlReport: includes a theme toggle button matching the starting theme', () => {
  const lightHtml = buildHtmlReport(sampleList, 'light');
  assert.match(lightHtml, /id="themeToggle"/);
  assert.match(lightHtml, /aria-label="Switch to dark mode"/);

  const darkHtml = buildHtmlReport(sampleList, 'dark');
  assert.match(darkHtml, /aria-label="Switch to light mode"/);
});

test('safeJsonForScriptTag: escapes "</" so an add-on name can\'t close the script tag early', () => {
  const json = safeJsonForScriptTag({ addons: [{ name: 'x</script><script>alert(1)</script>' }] });
  assert.ok(!json.includes('</script>'), 'a literal </script> would close the tag early if left unescaped');
  assert.deepStrictEqual(JSON.parse(json), { addons: [{ name: 'x</script><script>alert(1)</script>' }] });
});

// --- REPORT_ICON_DATA_URI stays in sync with icon32.png ---
// The report's favicon is a hand-pasted base64 blob with nothing else
// tying it to the actual icon file - nothing would catch it going stale
// if the icons are ever regenerated. REPORT_ICON_DATA_URI above is the
// real value from the actual loaded report-template.js (not a copy),
// compared here byte-for-byte against the real icon32.png file on disk.

test('REPORT_ICON_DATA_URI: matches src/icons/icon32.png byte-for-byte', () => {
  const base64Payload = REPORT_ICON_DATA_URI.slice('data:image/png;base64,'.length);
  const embeddedBytes = Buffer.from(base64Payload, 'base64');
  const iconBytes = fs.readFileSync(path.join(__dirname, '..', 'src/icons/icon32.png'));
  assert.ok(
    embeddedBytes.equals(iconBytes),
    'REPORT_ICON_DATA_URI no longer matches src/icons/icon32.png - re-encode it if the icon changed intentionally'
  );
});

// --- buildJsonExport ---

test('buildJsonExport: returns valid JSON with formatVersion and all addons', () => {
  const json = buildJsonExport(sampleList);
  const parsed = JSON.parse(json);
  assert.strictEqual(typeof parsed.formatVersion, 'number');
  assert.ok(Array.isArray(parsed.addons));
  assert.strictEqual(parsed.addons.length, sampleList.length);
  assert.deepStrictEqual(
    new Set(parsed.addons.map((a) => a.id)),
    new Set(sampleList.map((a) => a.id))
  );
});

test('buildJsonExport: preserves all fields on each add-on', () => {
  const json = buildJsonExport(sampleList);
  const parsed = JSON.parse(json);
  const ublock = parsed.addons.find((a) => a.id === 'ublock@example.com');
  assert.ok(ublock);
  assert.strictEqual(ublock.name, 'uBlock Origin');
  assert.strictEqual(ublock.version, '1.58.0');
  assert.strictEqual(ublock.enabled, true);
  assert.strictEqual(ublock.type, 'extension');
  assert.strictEqual(ublock.link, 'https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/');
  assert.strictEqual(ublock.linkType, 'amo-exact');
});

test('buildJsonExport: output is valid JSON even when names contain special characters', () => {
  const list = [{ id: 'x@e.com', name: 'A & B <>"\'', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  assert.doesNotThrow(() => JSON.parse(buildJsonExport(list)));
});

// --- buildCsvExport ---

test('buildCsvExport: first line is the format-version comment', () => {
  const csv = buildCsvExport(sampleList);
  const firstLine = csv.split('\r\n')[0];
  assert.match(firstLine, /^# addons-hub-format-version: \d+$/);
});

test('buildCsvExport: second line is the header row with all expected columns', () => {
  const csv = buildCsvExport(sampleList);
  const headerLine = csv.split('\r\n')[1];
  assert.strictEqual(headerLine, 'id,name,version,enabled,type,link,linkType');
});

test('buildCsvExport: produces one data row per add-on', () => {
  const csv = buildCsvExport(sampleList);
  // Lines: comment + header + N data rows
  const dataRows = csv.split('\r\n').slice(2);
  assert.strictEqual(dataRows.length, sampleList.length);
});

test('buildCsvExport: enabled field is "true" or "false" (not 1/0)', () => {
  const csv = buildCsvExport(sampleList);
  const rows = csv.split('\r\n').slice(2);
  for (const row of rows) {
    const fields = row.split(',');
    // enabled is the 4th column (index 3)
    assert.ok(fields[3] === 'true' || fields[3] === 'false', `expected true/false, got "${fields[3]}"`);
  }
});

test('buildCsvExport: fields containing commas are quoted per RFC 4180', () => {
  const list = [{ id: 'x@e.com', name: 'Hello, World', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list);
  const dataRow = csv.split('\r\n')[2];
  assert.match(dataRow, /"Hello, World"/);
});

test('buildCsvExport: fields containing double-quotes double them per RFC 4180', () => {
  const list = [{ id: 'x@e.com', name: 'Say "Hi"', version: '1.0', enabled: false, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list);
  const dataRow = csv.split('\r\n')[2];
  assert.match(dataRow, /"Say ""Hi"""/);
});

test('buildCsvExport: all seven columns are present on every data row', () => {
  const csv = buildCsvExport(sampleList);
  const rows = csv.split('\r\n').slice(2);
  for (const row of rows) {
    // A naive split on comma works here since our sample data has no
    // commas inside fields - just check the column count is right.
    // (RFC 4180 quoting is tested separately above.)
    const fields = row.split(',');
    assert.strictEqual(fields.length, 7, `expected 7 columns, got ${fields.length} in row: ${row}`);
  }
});
