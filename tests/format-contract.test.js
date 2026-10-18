// Data layout of every file the Importer reads. The look of the html report
// can change, the data can't: the Importer (and the report already released on
// AMO) depends on it.
//
// If a test here fails after you changed an export: decide if old files must
// still be readable (keep a reader in migrateAddonsData() and the parsers),
// bump EXPORT_FORMAT_VERSION in src/common/core.js (the settings file has its
// own SETTINGS_FILE_FORMAT_VERSION in src/settings/settings-file.js), then
// update CONTRACT below.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, evalInContext, readCommon, readReportBuilders, readImport, htmlData, stubDocument, makeSandbox, FIREFOX_SOURCE: SOURCE } = require('./helpers');

const CONTRACT = {
  exportFormatVersion: 2,
  // format 1 (the AMO release) had no source block, the Importer still reads it
  sourceKeys: ['formatVersion', 'fileType', 'basedOn', 'browser', 'browserVersion', 'extensionVersion'],
  htmlTopV1: ['formatVersion', 'addons'],
  htmlTop: ['source', 'addons'],
  htmlEntry: ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'],
  jsonTop: ['source', 'addons'],
  jsonEntry: ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'],
  csvHeader: 'name,version,type,enabled,link,linkType,id',
  txtColumns: 7,
  txtSeparator: ' | ',
};

const sourceLines = (fileType, version) => [
  `# addons-hub-source-formatVersion: ${version}`,
  `# addons-hub-source-fileType: ${fileType}`,
  '# addons-hub-source-basedOn: Gecko',
  '# addons-hub-source-browser: Firefox',
  '# addons-hub-source-browserVersion: 128.0',
  '# addons-hub-source-extensionVersion: 1.2.0',
];

const sandbox = makeSandbox({ URL }, readCommon(), readReportBuilders());
const VERSION = evalInContext(sandbox, 'EXPORT_FORMAT_VERSION');

const AMO = 'https://addons.mozilla.org/en-US/firefox/addon/';
// field order differs from every format on purpose, builders must set it themselves
const list = [
  { linkType: 'amo-exact', link: AMO + 'a/', type: 'extension', enabled: true, version: '1.0', name: 'Alpha - the first', id: 'a@x' },
  { linkType: 'homepage', link: 'https://example.com/n', type: 'theme', enabled: false, version: '2', name: 'Night', id: 'n@x' },
];
const keys = (o) => Array.from(Object.keys(o));

const HINT = ' - the data layout changed. Read the note at the top of tests/format-contract.test.js: bump the format version and update CONTRACT on purpose.';

test('contract: EXPORT_FORMAT_VERSION is the version CONTRACT describes' , () => {
  assert.strictEqual(VERSION, CONTRACT.exportFormatVersion, 'the format version and CONTRACT must change together' + HINT);
});

test('contract: HTML report data is the source, then addons, each add-on id, name, version, enabled, type, link, linkType', () => {
  for (const shorten of [true, false]) {
    for (const theme of ['light', 'dark']) {
      const data = htmlData(sandbox.buildHtmlReport(list, theme, shorten, SOURCE));
      assert.deepStrictEqual(keys(data), CONTRACT.htmlTop, 'top-level fields' + HINT);
      assert.deepStrictEqual(keys(data.source), CONTRACT.sourceKeys, 'source fields' + HINT);
      assert.deepStrictEqual({ ...data.source }, { formatVersion: VERSION, fileType: 'html', ...SOURCE });
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
  // only the version and source around the add-ons are new
  const rebuilt = htmlData(sandbox.buildHtmlReport(released.addons, 'light', false, SOURCE));
  assert.strictEqual(JSON.stringify(rebuilt.addons), JSON.stringify(released.addons), 'today\'s report writes the released add-ons exactly' + HINT);
});

test('contract: JSON export is the source, then addons, each add-on name, version, type, enabled, link, linkType, id', () => {
  const data = JSON.parse(sandbox.buildJsonExport(list, false, SOURCE));
  assert.deepStrictEqual(keys(data), CONTRACT.jsonTop, 'top-level fields' + HINT);
  assert.deepStrictEqual(keys(data.source), CONTRACT.sourceKeys, 'source fields' + HINT);
  assert.deepStrictEqual({ ...data.source }, { formatVersion: VERSION, fileType: 'json', ...SOURCE });
  for (const a of data.addons) assert.deepStrictEqual(keys(a), CONTRACT.jsonEntry, 'add-on fields' + HINT);
});

test('contract: CSV export starts with the source comments, then exactly the contract header', () => {
  const lines = sandbox.buildCsvExport(list, false, SOURCE).replace(/^\uFEFF/, '').split('\r\n');
  const src = sourceLines('csv', VERSION);
  assert.deepStrictEqual(lines.slice(0, src.length), src, 'CSV source lines' + HINT);
  assert.strictEqual(lines[src.length], CONTRACT.csvHeader, 'CSV header' + HINT);
});

test('contract: TXT export starts with the source comments; every add-on line has exactly the contract number of columns', () => {
  const lines = sandbox.buildTxtExport(list, false, SOURCE).split('\r\n');
  const src = sourceLines('txt', VERSION);
  assert.deepStrictEqual(lines.slice(0, src.length), src, 'TXT source lines' + HINT);
  const rows = lines.filter((l) => l.includes(CONTRACT.txtSeparator));
  assert.strictEqual(rows.length, list.length);
  for (const row of rows) assert.strictEqual(row.split(CONTRACT.txtSeparator).length, CONTRACT.txtColumns, 'TXT columns' + HINT);
});

test('contract: the Importer reads exactly what each export writes (the contract and the parsers agree)', () => {
  const importSb = makeSandbox({ URL, document: stubDocument() }, readCommon(), readReportBuilders(), readImport());
  const ids = (r) => { assert.strictEqual(r.ok, true, r.error); return Array.from(r.addons, (a) => a.id).sort(); };
  assert.deepStrictEqual(ids(importSb.parseAddonsPayload(JSON.stringify(htmlData(importSb.buildHtmlReport(list, 'light', false, SOURCE))))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseJsonPayload(importSb.buildJsonExport(list, false, SOURCE))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseCsvPayload(importSb.buildCsvExport(list, false, SOURCE))), ['a@x', 'n@x']);
  assert.deepStrictEqual(ids(importSb.parseTxtPayload(importSb.buildTxtExport(list, false, SOURCE))), ['a@x', 'n@x']);
});
