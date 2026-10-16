// The data contract of every file the Importer reads.
//
// The look of the HTML report can change freely; the data inside every export
// cannot, because the Importer (and, for the HTML report, the version already
// released on addons.mozilla.org) depends on it. This file pins the data layout
// of each format next to EXPORT_FORMAT_VERSION, so the two can only change
// together and on purpose.
//
// If one of these tests fails after you changed an export:
//   1. A file written by the previous layout may no longer be readable. Decide
//      if the Importer must still read it (then keep a reader for it, in
//      migrateAddonsData() and the parsers), or not.
//   2. Bump EXPORT_FORMAT_VERSION in src/common/core.js (the settings file has
//      its own SETTINGS_FILE_FORMAT_VERSION in src/settings/settings.js).
//   3. Update CONTRACT below, with the new version number.
// Changing only the page's look (HTML/CSS) must never need any of this.

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { test, readSrc, evalInContext, readCommon, readReportBuilders, readImport } = require('./helpers');

const CONTRACT = {
  exportFormatVersion: 2,
  // Format 2 added the source: where the export came from. (Format 1, which the
  // release on AMO wrote, had the same without it - the Importer still reads it.)
  sourceKeys: ['browser', 'basedOn', 'browserVersion', 'extensionVersion'],
  htmlTopV1: ['formatVersion', 'addons'],
  // The HTML report's embedded data.
  htmlTop: ['formatVersion', 'source', 'addons'],
  htmlEntry: ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'],
  // The JSON file.
  jsonTop: ['formatVersion', 'source', 'addons'],
  jsonEntry: ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'],
  // CSV and TXT carry the source as one comment line right after the version line.
  sourceLine: '# addons-hub-source: browser=Firefox; basedOn=Firefox; browserVersion=128.0; extensionVersion=1.2.0',
  // The CSV header row.
  csvHeader: 'name,version,type,enabled,link,linkType,id',
  // The TXT columns, in order, and its separator.
  txtColumns: 6,
  txtSeparator: ' | ',
};

const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(readCommon(), sandbox);
vm.runInContext(readReportBuilders(), sandbox);
const VERSION = evalInContext(sandbox, 'EXPORT_FORMAT_VERSION');

const AMO = 'https://addons.mozilla.org/en-US/firefox/addon/';
// Deliberately in a different field order from every format, to prove the
// builders fix the order themselves.
const list = [
  { linkType: 'amo-exact', link: AMO + 'a/', type: 'extension', enabled: true, version: '1.0', name: 'Alpha - the first', id: 'a@x' },
  { linkType: 'homepage', link: 'https://example.com/n', type: 'theme', enabled: false, version: '2', name: 'Night', id: 'n@x' },
];
const SOURCE = { browser: 'Firefox', basedOn: 'Firefox', browserVersion: '128.0', extensionVersion: '1.2.0' };
const keys = (o) => Array.from(Object.keys(o));
const htmlData = (html) => JSON.parse(html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/)[1]);

const HINT = ' - the data layout changed. Read the note at the top of tests/format-contract.test.js: bump the format version and update CONTRACT on purpose.';

test('contract: EXPORT_FORMAT_VERSION is the version CONTRACT describes' , () => {
  assert.strictEqual(VERSION, CONTRACT.exportFormatVersion, 'the format version and CONTRACT must change together' + HINT);
});

test('contract: HTML report data is formatVersion, source, then addons, each add-on id, name, version, enabled, type, link, linkType', () => {
  for (const shorten of [true, false]) {
    for (const theme of ['light', 'dark']) {
      const data = htmlData(sandbox.buildHtmlReport(list, theme, shorten, SOURCE));
      assert.deepStrictEqual(keys(data), CONTRACT.htmlTop, 'top-level fields' + HINT);
      assert.strictEqual(data.formatVersion, CONTRACT.exportFormatVersion);
      assert.deepStrictEqual(keys(data.source), CONTRACT.sourceKeys, 'source fields' + HINT);
      assert.deepStrictEqual({ ...data.source }, SOURCE);
      for (const a of data.addons) assert.deepStrictEqual(keys(a), CONTRACT.htmlEntry, 'add-on fields' + HINT);
    }
  }
});

test('contract: HTML report data always carries the full names, whatever the Shorten setting is', () => {
  const data = htmlData(sandbox.buildHtmlReport(list, 'light', true, SOURCE));
  assert.strictEqual(data.addons[0].name, 'Alpha - the first');
});

test('contract: the add-ons in the HTML report match the released AMO report (format 1), field for field', () => {
  const amo = fs.readFileSync(path.join(__dirname, 'fixtures', 'amo-release.html'), 'utf8');
  const released = htmlData(amo);
  assert.deepStrictEqual(keys(released), CONTRACT.htmlTopV1);
  assert.strictEqual(released.formatVersion, 1);
  for (const a of released.addons) assert.deepStrictEqual(keys(a), CONTRACT.htmlEntry);
  // Rebuilt by today's code from the released data, the add-ons are unchanged;
  // only the format version and the source around them are new.
  const rebuilt = htmlData(sandbox.buildHtmlReport(released.addons, 'light', false, SOURCE));
  assert.strictEqual(JSON.stringify(rebuilt.addons), JSON.stringify(released.addons), 'today\'s report writes the released add-ons exactly' + HINT);
});

test('contract: JSON export is formatVersion, source, then addons, each add-on name, version, type, enabled, link, linkType, id', () => {
  const data = JSON.parse(sandbox.buildJsonExport(list, false, SOURCE));
  assert.deepStrictEqual(keys(data), CONTRACT.jsonTop, 'top-level fields' + HINT);
  assert.strictEqual(data.formatVersion, CONTRACT.exportFormatVersion);
  assert.deepStrictEqual(keys(data.source), CONTRACT.sourceKeys, 'source fields' + HINT);
  for (const a of data.addons) assert.deepStrictEqual(keys(a), CONTRACT.jsonEntry, 'add-on fields' + HINT);
});

test('contract: CSV export starts with the version comment, the source comment, then exactly the contract header', () => {
  const lines = sandbox.buildCsvExport(list, false, SOURCE).replace(/^\uFEFF/, '').split('\r\n');
  assert.strictEqual(lines[0], `# addons-hub-format-version: ${CONTRACT.exportFormatVersion}`);
  assert.strictEqual(lines[1], CONTRACT.sourceLine, 'CSV source line' + HINT);
  assert.strictEqual(lines[2], CONTRACT.csvHeader, 'CSV header' + HINT);
});

test('contract: TXT export starts with the version and source comments; every add-on line has exactly the contract number of columns', () => {
  const lines = sandbox.buildTxtExport(list, false, SOURCE).split('\r\n');
  assert.strictEqual(lines[0], `# addons-hub-format-version: ${CONTRACT.exportFormatVersion}`);
  assert.strictEqual(lines[1], CONTRACT.sourceLine, 'TXT source line' + HINT);
  const rows = lines.filter((l) => l.includes(CONTRACT.txtSeparator));
  assert.strictEqual(rows.length, list.length);
  for (const row of rows) assert.strictEqual(row.split(CONTRACT.txtSeparator).length, CONTRACT.txtColumns, 'TXT columns' + HINT);
});

test('contract: the Importer reads exactly what each export writes (the contract and the parsers agree)', () => {
  const importSb = { URL, document: { getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, dataset: {}, textContent: '', innerHTML: '', value: '' }), addEventListener() {} } };
  vm.createContext(importSb);
  vm.runInContext(readCommon(), importSb);
  vm.runInContext(readReportBuilders(), importSb);
  vm.runInContext(readImport(), importSb);
  const ids = (r) => { assert.strictEqual(r.ok, true, r.error); return Array.from(r.addons, (a) => a.id).sort(); };
  assert.deepStrictEqual(ids(importSb.parseAddonsPayload(JSON.stringify(htmlData(importSb.buildHtmlReport(list, 'light', false, SOURCE))))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseJsonPayload(importSb.buildJsonExport(list, false, SOURCE))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseCsvPayload(importSb.buildCsvExport(list, false, SOURCE))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseTxtPayload(importSb.buildTxtExport(list, false, SOURCE))), ['a@x', 'n@x']);
});
