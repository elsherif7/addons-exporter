// Format 2 added the "source" to every export: which browser (and version) and
// which Add-ons Hub version made the file. Covers the shared helpers (core.js),
// the browser detection (background/browser-info.js), what each builder writes,
// what the Importer reads back (format 2, and format 1 files that have none),
// and the line the HTML report shows.

const assert = require('assert');
const vm = require('vm');
const { test, testAsync, readSrcs, readReportBuilders } = require('./helpers');

function load(globals = {}) {
  const sb = { URL, ...globals };
  vm.createContext(sb);
  vm.runInContext(readSrcs('src/common/core.js'), sb);
  vm.runInContext(readReportBuilders(), sb);
  vm.runInContext(readSrcs('src/import/parsers.js', 'src/background/browser-info.js'), sb);
  return sb;
}
const sb = load();
const UNKNOWN = { browser: 'Unknown', basedOn: 'Unknown', browserVersion: 'unknown', extensionVersion: 'unknown' };
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the sandbox's realm, for deepStrictEqual
const SOURCE = { browser: 'Firefox', basedOn: 'Firefox', browserVersion: '128.0', extensionVersion: '1.2.0' };
const addon = (o = {}) => ({ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'amo-exact', ...o });
const list = [addon(), addon({ id: 'b@x', name: 'Beta', enabled: false, type: 'theme', link: 'https://example.com/b', linkType: 'homepage' })];
const htmlData = (html) => JSON.parse(html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));

// --- the shared helpers ---

test('source: cleanSourceText keeps plain text and falls back for anything unusable', () => {
  assert.strictEqual(sb.cleanSourceText('Firefox Developer Edition', 'x'), 'Firefox Developer Edition');
  assert.strictEqual(sb.cleanSourceText('130.0a1', 'x'), '130.0a1');
  assert.strictEqual(sb.cleanSourceText('Evil; browser=<b>"x"</b>\r\n', 'x'), 'Evil browserbxb');
  for (const bad of ['', '   ', null, undefined, '日本語', '...', ';;;']) assert.strictEqual(sb.cleanSourceText(bad, 'fallback'), 'fallback');
  assert.strictEqual(sb.cleanSourceText('a'.repeat(200), 'x').length, 64);
});

test('source: makeSource and normalizeSource always give exactly the three keys, in order', () => {
  assert.deepStrictEqual(plain(sb.makeSource('Firefox', '128.0', '1.2.0', 'Firefox')), SOURCE);
  assert.deepStrictEqual(Object.keys(sb.normalizeSource({ extensionVersion: '1', browserVersion: '2', browser: 'B', extra: 'x' })), ['browser', 'basedOn', 'browserVersion', 'extensionVersion']);
  assert.deepStrictEqual(plain(sb.normalizeSource(undefined)), UNKNOWN);
  assert.deepStrictEqual(plain(sb.normalizeSource('nope')), UNKNOWN);
});

test('source: sourceProblem accepts exactly what the exporter writes and names the first problem otherwise', () => {
  assert.strictEqual(sb.sourceProblem(SOURCE), null);
  assert.match(sb.sourceProblem(null), /not an object/);
  assert.match(sb.sourceProblem([]), /not an object/);
  assert.match(sb.sourceProblem({ browser: 'F', basedOn: 'F', browserVersion: '1' }), /not exactly browser, basedOn, browserVersion, extensionVersion/);
  assert.match(sb.sourceProblem({ browserVersion: '1', basedOn: 'F', browser: 'F', extensionVersion: '1' }), /not exactly/);
  assert.match(sb.sourceProblem({ ...SOURCE, extra: 'x' }), /not exactly/);
  assert.match(sb.sourceProblem({ ...SOURCE, basedOn: '' }), /basedOn is not plain text/);
  assert.match(sb.sourceProblem({ ...SOURCE, browser: 5 }), /browser is not plain text/);
  assert.match(sb.sourceProblem({ ...SOURCE, browserVersion: '' }), /browserVersion is not plain text/);
  assert.match(sb.sourceProblem({ ...SOURCE, extensionVersion: '1;2' }), /extensionVersion is not plain text/);
});

test('source: the comment line round-trips, and anything else is not a source line', () => {
  const line = sb.sourceCommentLine(SOURCE);
  assert.strictEqual(line, '# addons-hub-source: browser=Firefox; basedOn=Firefox; browserVersion=128.0; extensionVersion=1.2.0');
  assert.deepStrictEqual(plain(sb.parseSourceCommentLine(line)), SOURCE);
  for (const bad of ['', undefined, '# addons-hub-source: browser=Firefox', line + ' ', ' ' + line, line.replace('browser=Firefox', 'browser='), line.replace('; browserVersion', ';browserVersion'), line.replace('Firefox', 'Fire=fox'), line.replace('# ', '#')]) {
    assert.strictEqual(sb.parseSourceCommentLine(bad), null, String(bad));
  }
});

test('source: sourceLabel is "Firefox 128.0", or just the browser when the version is not known', () => {
  assert.strictEqual(sb.sourceLabel(SOURCE), 'Firefox 128.0');
  assert.strictEqual(sb.sourceLabel({ ...SOURCE, browserVersion: 'unknown' }), 'Firefox');
  assert.strictEqual(sb.sourceLabel(undefined), 'Unknown');
});

// --- which browser is this ---

test('browser-info: names the browser from its user-agent text, the specific ones before Chrome', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox', '128.0'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome', '126.0.0.0'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87', 'Edge', '126.0.2592.87'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0', 'Opera', '112.0.0.0'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.8.3381.48', 'Vivaldi', '6.8.3381.48'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari', '17.5'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 Waterfox/6.0.18', 'Waterfox', '6.0.18'],
    ['Mozilla/5.0 (Linux; x86_64) Ladybird/1.0', 'Ladybird', '1.0'],
  ];
  for (const [ua, name, version] of cases) assert.deepStrictEqual(plain(sb.detectBrowserFromUserAgent(ua)), { name, version }, ua);
  for (const junk of ['', undefined, null, 42, 'curl/8.0']) assert.strictEqual(sb.detectBrowserFromUserAgent(junk), null);
});

testAsync('browser-info: Firefox and its forks are named by what the browser reports, with its real version', async () => {
  for (const [reported, version] of [['Firefox', '128.0'], ['LibreWolf', '128.0.3-1'], ['Waterfox', '6.0.18']]) {
    const s = load({ browser: { runtime: { getBrowserInfo: async () => ({ name: reported, vendor: 'x', version, buildID: '1' }), getManifest: () => ({ version: '1.2.0' }) } } });
    assert.deepStrictEqual(plain(await s.getExportSource()), { browser: reported, basedOn: 'Firefox', browserVersion: version, extensionVersion: '1.2.0' });
  }
});

testAsync('browser-info: without getBrowserInfo (or when it fails) the user agent is used, and a version that is missing is "unknown"', async () => {
  const chrome = load({ navigator: { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }, browser: { runtime: { getManifest: () => ({ version: '2.0.0' }) } } });
  assert.deepStrictEqual(plain(await chrome.getExportSource()), { browser: 'Chrome', basedOn: 'Chromium', browserVersion: '126.0.0.0', extensionVersion: '2.0.0' });
  const failing = load({ navigator: { userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/128.0' }, browser: { runtime: { getBrowserInfo: async () => { throw new Error('no'); }, getManifest: () => ({ version: '1.2.0' }) } } });
  assert.deepStrictEqual(plain(await failing.getExportSource()), SOURCE);
  const nameOnly = load({ browser: { runtime: { getBrowserInfo: async () => ({ name: 'Floorp' }), getManifest: () => ({ version: '1.2.0' }) } } });
  assert.deepStrictEqual(plain(await nameOnly.getExportSource()), { browser: 'Floorp', basedOn: 'Firefox', browserVersion: 'unknown', extensionVersion: '1.2.0' });
});

testAsync('browser-info: when nothing can be found the source is "Unknown", and it never throws', async () => {
  for (const globals of [{}, { browser: {} }, { browser: { runtime: { getManifest: () => { throw new Error('x'); } } } }]) {
    assert.deepStrictEqual(plain(await load(globals).getExportSource()), UNKNOWN);
  }
});

test('browser-info: says what each browser is built on', () => {
  const based = { Edge: 'Chromium', Opera: 'Chromium', Vivaldi: 'Chromium', Chrome: 'Chromium', Brave: 'Chromium', LibreWolf: 'Firefox', Waterfox: 'Firefox', Floorp: 'Firefox', Firefox: 'Firefox', Safari: 'WebKit', Ladybird: 'Ladybird', Somethingnew: 'Somethingnew' };
  for (const [name, base] of Object.entries(based)) assert.strictEqual(sb.browserBase(name), base, name);
  assert.strictEqual(sb.browserBase('constructor'), 'constructor', 'a name that is also an object property is not looked up as one');
});

test('source: the label adds "based on" only when the browser is not the same as its base', () => {
  assert.strictEqual(sb.sourceLabel({ ...SOURCE, browser: 'LibreWolf', browserVersion: '128.0' }), 'LibreWolf 128.0, based on Firefox');
  assert.strictEqual(sb.sourceLabel(SOURCE), 'Firefox 128.0');
  assert.strictEqual(sb.sourceLabel({ ...SOURCE, browser: 'Edge', basedOn: 'Chromium' }), 'Edge 128.0, based on Chromium');
  assert.strictEqual(sb.sourceLabel({ ...SOURCE, basedOn: 'Unknown' }), 'Firefox 128.0');
});

// --- what the builders write ---

test('builders: every format records the source, and an export without one says Unknown', () => {
  const json = JSON.parse(sb.buildJsonExport(list, false, SOURCE));
  assert.deepStrictEqual(Object.keys(json), ['formatVersion', 'source', 'addons']);
  assert.deepStrictEqual(plain(json.source), SOURCE);
  assert.strictEqual(htmlData(sb.buildHtmlReport(list, 'light', false, SOURCE)).source.browser, 'Firefox');
  assert.strictEqual(sb.buildCsvExport(list, false, SOURCE).split('\r\n')[1], sb.sourceCommentLine(SOURCE));
  assert.strictEqual(sb.buildTxtExport(list, false, SOURCE).split('\r\n')[1], sb.sourceCommentLine(SOURCE));
  assert.deepStrictEqual(plain(JSON.parse(sb.buildJsonExport(list, false)).source), UNKNOWN);
});

test('builders: a hostile or odd source is cleaned, never written as it came', () => {
  const evil = { browser: 'X\r\n# addons-hub-format-version: 9', browserVersion: '"><script>', extensionVersion: null };
  for (const text of [sb.buildJsonExport(list, false, evil), sb.buildCsvExport(list, false, evil), sb.buildTxtExport(list, false, evil), sb.buildHtmlReport(list, 'light', false, evil)]) {
    assert.ok(!/<script>/.test(text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')), 'no markup from the source');
  }
  const csv = sb.buildCsvExport(list, false, evil).split('\r\n');
  assert.strictEqual(csv[0].replace('﻿', ''), '# addons-hub-format-version: 2');
  assert.ok(sb.parseSourceCommentLine(csv[1]), 'the cleaned line is still a valid source line');
  assert.strictEqual(sb.parseCsvPayload(sb.buildCsvExport(list, false, evil)).ok, true);
});

test('HTML report: says on the page where it was exported from, and leaves out what is not known', () => {
  assert.match(sb.buildHtmlReport(list, 'light', false, SOURCE), /<p class="intro-text source-note">Exported from Firefox 128\.0 with Add-ons Hub 1\.2\.0<\/p>/);
  assert.match(sb.buildHtmlReport(list, 'light', false), /<p class="intro-text source-note">Exported from Unknown<\/p>/);
  assert.match(sb.buildHtmlReport(list, 'light', false, { browser: 'Chrome', browserVersion: '126.0.0.0' }), /Exported from Chrome 126\.0\.0\.0<\/p>/);
});

// --- what the Importer reads ---

const v2json = (o = {}) => JSON.stringify({ formatVersion: 2, source: SOURCE, addons: [addon()], ...o });
const rejects = (result, pattern) => { assert.strictEqual(result.ok, false); assert.match(result.error, pattern); };

test('Importer: every format brings the source back, exactly as written', () => {
  const read = {
    json: sb.parseJsonPayload(sb.buildJsonExport(list, false, SOURCE)),
    csv: sb.parseCsvPayload(sb.buildCsvExport(list, false, SOURCE)),
    txt: sb.parseTxtPayload(sb.buildTxtExport(list, false, SOURCE)),
    html: sb.parseAddonsPayload(JSON.stringify(htmlData(sb.buildHtmlReport(list, 'light', false, SOURCE)))),
  };
  for (const [format, r] of Object.entries(read)) {
    assert.strictEqual(r.ok, true, format + ': ' + r.error);
    assert.deepStrictEqual(plain(r.source), SOURCE, format);
    assert.strictEqual(r.addons.length, 2, format);
  }
});

test('Importer: files from before the source (format 1) still read, with no source', () => {
  const v1 = { formatVersion: 1, addons: [addon()] };
  assert.strictEqual(sb.parseAddonsPayload(JSON.stringify({ ...v1, addons: [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'amo-exact' }] })).source, null);
  const csv = ['# addons-hub-format-version: 1', 'name,version,type,enabled,link,linkType,id', 'Alpha,1.0,extension,true,https://example.com/a,amo-exact,a@x'].join('\r\n');
  const csvResult = sb.parseCsvPayload(csv);
  assert.strictEqual(csvResult.ok, true);
  assert.strictEqual(csvResult.source, null);
  const txt = ['# addons-hub-format-version: 1', '', 'Firefox Add-ons - 1 in total', '', 'Alpha | 1.0 | Extension | Enabled | https://example.com/a | a@x'].join('\r\n');
  const txtResult = sb.parseTxtPayload(txt);
  assert.strictEqual(txtResult.ok, true);
  assert.strictEqual(txtResult.source, null);
});

test('Importer (JSON/HTML data): a format 2 file must have the source, in the right place, and be exactly right', () => {
  assert.strictEqual(sb.parseJsonPayload(v2json({ addons: [{ name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' }] })).ok, true);
  const noSource = JSON.stringify({ formatVersion: 2, addons: [{ name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' }] });
  rejects(sb.parseJsonPayload(noSource), /not exactly formatVersion, then source, then addons/);
  const entry = { name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' };
  const wrongOrder = JSON.stringify({ formatVersion: 2, addons: [entry], source: SOURCE });
  rejects(sb.parseJsonPayload(wrongOrder), /not exactly formatVersion, then source, then addons/);
  for (const [source, pattern] of [
    [{ browser: 'Firefox' }, /source: its fields are not exactly/],
    [{ ...SOURCE, extra: 'x' }, /source: its fields are not exactly/],
    [{ ...SOURCE, browser: 5 }, /source: browser is not plain text/],
    [{ ...SOURCE, browserVersion: '<b>' }, /source: browserVersion is not plain text/],
    ['Firefox 128', /source: it is not an object/],
    [null, /source: it is not an object/],
  ]) {
    rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 2, source, addons: [entry] })), pattern);
  }
});

test('Importer (JSON): a format 1 file may not carry a source, and a newer version is refused as before', () => {
  const entry = { name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' };
  rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 1, source: SOURCE, addons: [entry] })), /not exactly formatVersion, then addons/);
  rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 3, source: SOURCE, addons: [entry] })), /newer version/);
});

test('Importer (CSV): a format 2 file must have the source line right after the version line', () => {
  const header = 'name,version,type,enabled,link,linkType,id';
  const row = 'Alpha,1.0,extension,true,https://example.com/a,amo-exact,a@x';
  const line = sb.sourceCommentLine(SOURCE);
  const csv = (...lines) => lines.join('\r\n');
  assert.strictEqual(sb.parseCsvPayload(csv('# addons-hub-format-version: 2', line, header, row)).ok, true);
  const hint = /second line must be the source comment/;
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 2', header, row)), hint);
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 2', header, line, row)), hint);
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 2', line.replace('Firefox', 'Fire;fox'), header, row)), hint);
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 2', line)), hint.test('') ? hint : /header row/);
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 1', line, header, row)), /header row must be/);
});

test('Importer (TXT): a format 2 file must have the source line right after the version line', () => {
  const body = ['', 'Firefox Add-ons - 1 in total', '', 'Alpha | 1.0 | Extension | Enabled | https://example.com/a | a@x'];
  const line = sb.sourceCommentLine(SOURCE);
  const txt = (...lines) => lines.join('\r\n');
  assert.strictEqual(sb.parseTxtPayload(txt('# addons-hub-format-version: 2', line, ...body)).ok, true);
  const hint = /second line must be the source comment/;
  rejects(sb.parseTxtPayload(txt('# addons-hub-format-version: 2', ...body)), hint);
  rejects(sb.parseTxtPayload(txt('# addons-hub-format-version: 2', line.replace('browser=Firefox', 'browser='), ...body)), hint);
});
