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
const { test, readSrc, evalInContext, readCommon, readReportBuilders } = require('./helpers');

const CONTRACT = {
  exportFormatVersion: 1,
  // The HTML report's embedded data (also the version released on AMO).
  htmlTop: ['formatVersion', 'addons'],
  htmlEntry: ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'],
  // The JSON file.
  jsonTop: ['formatVersion', 'addons'],
  jsonEntry: ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'],
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
const keys = (o) => Array.from(Object.keys(o));
const htmlData = (html) => JSON.parse(html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/)[1]);

const HINT = ' - the data layout changed. Read the note at the top of tests/format-contract.test.js: bump the format version and update CONTRACT on purpose.';

test('contract: EXPORT_FORMAT_VERSION is the version CONTRACT describes' , () => {
  assert.strictEqual(VERSION, CONTRACT.exportFormatVersion, 'the format version and CONTRACT must change together' + HINT);
});

test('contract: HTML report data is formatVersion then addons, each add-on id, name, version, enabled, type, link, linkType', () => {
  for (const shorten of [true, false]) {
    for (const theme of ['light', 'dark']) {
      const data = htmlData(sandbox.buildHtmlReport(list, theme, shorten));
      assert.deepStrictEqual(keys(data), CONTRACT.htmlTop, 'top-level fields' + HINT);
      assert.strictEqual(data.formatVersion, CONTRACT.exportFormatVersion);
      for (const a of data.addons) assert.deepStrictEqual(keys(a), CONTRACT.htmlEntry, 'add-on fields' + HINT);
    }
  }
});

test('contract: HTML report data always carries the full names, whatever the Shorten setting is', () => {
  const data = htmlData(sandbox.buildHtmlReport(list, 'light', true));
  assert.strictEqual(data.addons[0].name, 'Alpha - the first');
});

test('contract: HTML report data matches the released AMO report, field for field', () => {
  const amo = fs.readFileSync(path.join(__dirname, 'fixtures', 'amo-release.html'), 'utf8');
  const released = htmlData(amo);
  assert.deepStrictEqual(keys(released), CONTRACT.htmlTop);
  for (const a of released.addons) assert.deepStrictEqual(keys(a), CONTRACT.htmlEntry);
  // Rebuilt by today's code from the released data, the data block is unchanged.
  const rebuilt = htmlData(sandbox.buildHtmlReport(released.addons, 'light', false));
  assert.strictEqual(JSON.stringify(rebuilt), JSON.stringify(released), 'today\'s report writes the released data exactly' + HINT);
});

test('contract: JSON export is formatVersion then addons, each add-on name, version, type, enabled, link, linkType, id', () => {
  const data = JSON.parse(sandbox.buildJsonExport(list, false));
  assert.deepStrictEqual(keys(data), CONTRACT.jsonTop, 'top-level fields' + HINT);
  assert.strictEqual(data.formatVersion, CONTRACT.exportFormatVersion);
  for (const a of data.addons) assert.deepStrictEqual(keys(a), CONTRACT.jsonEntry, 'add-on fields' + HINT);
});

test('contract: CSV export starts with the version comment, then exactly the contract header', () => {
  const lines = sandbox.buildCsvExport(list, false).replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(lines[0], `# addons-hub-format-version: ${CONTRACT.exportFormatVersion}`);
  assert.strictEqual(lines[1], CONTRACT.csvHeader, 'CSV header' + HINT);
});

test('contract: TXT export starts with the version comment; every add-on line has exactly the contract number of columns', () => {
  const lines = sandbox.buildTxtExport(list, false).split('\r\n');
  assert.strictEqual(lines[0], `# addons-hub-format-version: ${CONTRACT.exportFormatVersion}`);
  const rows = lines.filter((l) => l.includes(CONTRACT.txtSeparator));
  assert.strictEqual(rows.length, list.length);
  for (const row of rows) assert.strictEqual(row.split(CONTRACT.txtSeparator).length, CONTRACT.txtColumns, 'TXT columns' + HINT);
});

test('contract: the Importer reads exactly what each export writes (the contract and the parsers agree)', () => {
  const importSb = { URL, document: { getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, dataset: {}, textContent: '', innerHTML: '', value: '' }), addEventListener() {} } };
  vm.createContext(importSb);
  vm.runInContext(readCommon(), importSb);
  vm.runInContext(readReportBuilders(), importSb);
  vm.runInContext(readSrc('src/import/import.js'), importSb);
  const ids = (r) => { assert.strictEqual(r.ok, true, r.error); return Array.from(r.addons, (a) => a.id).sort(); };
  assert.deepStrictEqual(ids(importSb.parseAddonsPayload(JSON.stringify(htmlData(importSb.buildHtmlReport(list, 'light', false))))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseJsonPayload(importSb.buildJsonExport(list, false))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseCsvPayload(importSb.buildCsvExport(list, false))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseTxtPayload(importSb.buildTxtExport(list, false))), ['a@x', 'n@x']);
});
