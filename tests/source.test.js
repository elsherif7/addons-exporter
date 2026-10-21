const assert = require('assert');
const { test, testAsync, readSrcs, readReportBuilders, plain, htmlData, makeSandbox, FIREFOX_SOURCE: BROWSER } = require('./helpers');

function load(globals = {}) {
  return makeSandbox(
    { URL, ...globals },
    readSrcs('src/common/core.js'),
    readReportBuilders(),
    readSrcs('src/import/parsers.js', 'src/background/browser-info.js')
  );
}
const sb = load();
const UNKNOWN = { basedOn: 'Unknown', browser: 'Unknown', browserVersion: 'unknown', extensionVersion: 'unknown', device: 'Unknown' };
// BROWSER is only the browser half (what getExportSource returns), source() adds version and type like makeSource
const source = (fileType, formatVersion = 3, browser = BROWSER) => {
  const out = { formatVersion, fileType };
  if (formatVersion >= 3) out.device = browser.device;
  out.basedOn = browser.basedOn;
  out.browser = browser.browser;
  out.browserVersion = browser.browserVersion;
  out.extensionVersion = browser.extensionVersion;
  return out;
};
const addon = (o = {}) => ({ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'amo-exact', ...o });
const list = [addon(), addon({ id: 'b@x', name: 'Beta', enabled: false, type: 'theme', link: 'https://example.com/b', linkType: 'homepage' })];

test('source: cleanSourceText keeps plain text and falls back for anything unusable', () => {
  assert.strictEqual(sb.cleanSourceText('Firefox Developer Edition', 'x'), 'Firefox Developer Edition');
  assert.strictEqual(sb.cleanSourceText('130.0a1', 'x'), '130.0a1');
  assert.strictEqual(sb.cleanSourceText('Evil; browser=<b>"x"</b>\r\n', 'x'), 'Evil browserbxb');
  for (const bad of ['', '   ', null, undefined, '日本語', '...', ';;;']) assert.strictEqual(sb.cleanSourceText(bad, 'fallback'), 'fallback');
  assert.strictEqual(sb.cleanSourceText('a'.repeat(200), 'x').length, 64);
});

test('source: makeBrowserSource and normalizeBrowserSource always give exactly the four browser keys and a device, in order', () => {
  assert.deepStrictEqual(plain(sb.makeBrowserSource('Firefox', '128.0', '1.2.0', 'Gecko', 'Computer')), BROWSER);
  assert.deepStrictEqual(Object.keys(sb.normalizeBrowserSource({ extensionVersion: '1', browserVersion: '2', browser: 'B', extra: 'x' })), ['basedOn', 'browser', 'browserVersion', 'extensionVersion', 'device']);
  assert.deepStrictEqual(plain(sb.normalizeBrowserSource(undefined)), UNKNOWN);
  assert.deepStrictEqual(plain(sb.normalizeBrowserSource('nope')), UNKNOWN);
  assert.strictEqual(sb.normalizeBrowserSource({ device: 'Tablet' }).device, 'Unknown');
});

test('source: makeSource puts the format version and file type before the device and browser, in the exact order', () => {
  assert.deepStrictEqual(plain(sb.makeSource('json', 3, BROWSER)), source('json'));
  assert.deepStrictEqual(Object.keys(sb.makeSource('csv', 3, undefined)), ['formatVersion', 'fileType', 'device', 'basedOn', 'browser', 'browserVersion', 'extensionVersion']);
  assert.deepStrictEqual(plain(sb.makeSource('txt', 3, undefined)), source('txt', 3, UNKNOWN));
  // Format 2 is the older six-key shape and has no device.
  assert.deepStrictEqual(plain(sb.makeSource('json', 2, BROWSER)), source('json', 2));
  assert.deepStrictEqual(Object.keys(sb.makeSource('csv', 2, undefined)), ['formatVersion', 'fileType', 'basedOn', 'browser', 'browserVersion', 'extensionVersion']);
});

test('source: sourceProblem accepts exactly what the exporter writes and names the first problem otherwise', () => {
  assert.strictEqual(sb.sourceProblem(source('json')), null);
  assert.strictEqual(sb.sourceProblem(source('csv'), 'csv'), null);
  assert.strictEqual(sb.sourceProblem(source('json', 2)), null);
  assert.match(sb.sourceProblem(null), /not an object/);
  assert.match(sb.sourceProblem([]), /not an object/);
  assert.match(sb.sourceProblem({ browser: 'F', basedOn: 'F', browserVersion: '1' }), /not exactly formatVersion, fileType, basedOn, browser, browserVersion, extensionVersion/);
  assert.match(sb.sourceProblem({ browserVersion: '1', basedOn: 'F', browser: 'F', extensionVersion: '1' }), /not exactly/);
  assert.match(sb.sourceProblem({ ...source('json'), extra: 'x' }), /not exactly/);
  assert.match(sb.sourceProblem({ ...source('json', 2), formatVersion: 0 }), /format version is not a positive whole number/);
  assert.match(sb.sourceProblem({ ...source('json', 2), formatVersion: '2' }), /format version is not a positive whole number/);
  assert.match(sb.sourceProblem({ ...source('json'), device: 'Tablet' }), /device is not one of/);
  const withoutDevice = { ...source('json') };
  delete withoutDevice.device;
  assert.match(sb.sourceProblem(withoutDevice), /not exactly formatVersion, fileType, device, basedOn, browser, browserVersion, extensionVersion/);
  assert.match(sb.sourceProblem({ ...source('json'), fileType: 'pdf' }), /file type is not one of/);
  assert.match(sb.sourceProblem({ ...source('json'), fileType: 'csv' }, 'json'), /file type is not "json"/);
  assert.match(sb.sourceProblem({ ...source('json'), basedOn: '' }), /basedOn is not plain text/);
  assert.match(sb.sourceProblem({ ...source('json'), browser: 5 }), /browser is not plain text/);
  assert.match(sb.sourceProblem({ ...source('json'), browserVersion: '' }), /browserVersion is not plain text/);
  assert.match(sb.sourceProblem({ ...source('json'), extensionVersion: '1;2' }), /extensionVersion is not plain text/);
});

test('source: the comment lines round-trip, and anything else is not a source line', () => {
  const lines = sb.sourceCommentLines(source('csv'));
  assert.deepStrictEqual(plain(lines), [
    '# addons-hub-source-formatVersion: 3',
    '# addons-hub-source-fileType: csv',
    '# addons-hub-source-device: Computer',
    '# addons-hub-source-basedOn: Gecko',
    '# addons-hub-source-browser: Firefox',
    '# addons-hub-source-browserVersion: 128.0',
    '# addons-hub-source-extensionVersion: 1.2.0',
  ]);
  assert.deepStrictEqual(plain(sb.parseSourceCommentLines(lines)), source('csv'));
  assert.deepStrictEqual(plain(sb.parseSourceCommentLines(lines, 'csv')), source('csv'));
  assert.strictEqual(sb.parseSourceCommentLines(lines, 'txt'), null);
  const linesV2 = sb.sourceCommentLines(source('csv', 2));
  assert.deepStrictEqual(plain(linesV2), [
    '# addons-hub-source-formatVersion: 2',
    '# addons-hub-source-fileType: csv',
    '# addons-hub-source-basedOn: Gecko',
    '# addons-hub-source-browser: Firefox',
    '# addons-hub-source-browserVersion: 128.0',
    '# addons-hub-source-extensionVersion: 1.2.0',
  ]);
  assert.deepStrictEqual(plain(sb.parseSourceCommentLines(linesV2)), source('csv', 2));
  assert.strictEqual(sb.parseSourceCommentLines(linesV2, 'txt'), null);
  const bad = [
    [],
    ['# addons-hub-source: browser=Firefox; basedOn=Firefox; browserVersion=128.0; extensionVersion=1.2.0'],
    lines.slice(0, 6),
    [...lines, ''],
    [lines[1], lines[0], lines[2], lines[3], lines[4], lines[5], lines[6]],
    [lines[0], lines[1].replace('fileType', 'fileTypes'), ...lines.slice(2)],
    lines.map((l) => l.replace('Firefox', 'Fire=fox')),
    lines.map((l) => l.replace('# ', '#')),
    [lines[0].replace(': 3', ': x'), ...lines.slice(1)],
  ];
  for (const b of bad) assert.strictEqual(sb.parseSourceCommentLines(b), null, JSON.stringify(b));
});

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
    const s = load({ browser: { runtime: { getBrowserInfo: async () => ({ name: reported, vendor: 'x', version, buildID: '1' }), getPlatformInfo: async () => ({ os: 'win', arch: 'x86-64' }), getManifest: () => ({ version: '1.2.0' }) } } });
    assert.deepStrictEqual(plain(await s.getExportSource()), { browser: reported, basedOn: 'Gecko', browserVersion: version, extensionVersion: '1.2.0', device: 'Computer' });
  }
});

testAsync('browser-info: without getBrowserInfo (or when it fails) the user agent is used, and a version that is missing is "unknown"', async () => {
  const chrome = load({ navigator: { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }, browser: { runtime: { getPlatformInfo: async () => ({ os: 'win' }), getManifest: () => ({ version: '2.0.0' }) } } });
  assert.deepStrictEqual(plain(await chrome.getExportSource()), { browser: 'Chrome', basedOn: 'Chromium', browserVersion: '126.0.0.0', extensionVersion: '2.0.0', device: 'Computer' });
  const failing = load({ navigator: { userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/128.0' }, browser: { runtime: { getBrowserInfo: async () => { throw new Error('no'); }, getPlatformInfo: async () => ({ os: 'win' }), getManifest: () => ({ version: '1.2.0' }) } } });
  assert.deepStrictEqual(plain(await failing.getExportSource()), BROWSER);
  const nameOnly = load({ browser: { runtime: { getBrowserInfo: async () => ({ name: 'Floorp' }), getManifest: () => ({ version: '1.2.0' }) } } });
  assert.deepStrictEqual(plain(await nameOnly.getExportSource()), { browser: 'Floorp', basedOn: 'Gecko', browserVersion: 'unknown', extensionVersion: '1.2.0', device: 'Unknown' });
});

testAsync('browser-info: the platform API decides phone or computer, with the user agent as fallback', async () => {
  const phone = load({ browser: { runtime: { getBrowserInfo: async () => ({ name: 'Firefox', version: '128.0' }), getPlatformInfo: async () => ({ os: 'android', arch: 'aarch64' }), getManifest: () => ({ version: '1.2.0' }) } } });
  assert.strictEqual((await phone.getExportSource()).device, 'Phone');
  for (const os of ['win', 'mac', 'linux', 'cros', 'openbsd', 'fuchsia']) {
    const computer = load({ browser: { runtime: { getPlatformInfo: async () => ({ os }), getManifest: () => ({ version: '1.2.0' }) } } });
    assert.strictEqual((await computer.getExportSource()).device, 'Computer', os);
  }
  // If the platform API is missing or fails, the user agent still answers.
  const androidUa = load({ navigator: { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0' }, browser: { runtime: { getManifest: () => ({ version: '1.2.0' }) } } });
  assert.strictEqual((await androidUa.getExportSource()).device, 'Phone');
  const brokenPlatform = load({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' }, browser: { runtime: { getPlatformInfo: async () => { throw new Error('no'); }, getManifest: () => ({ version: '1.2.0' }) } } });
  assert.strictEqual((await brokenPlatform.getExportSource()).device, 'Computer');
  const noHint = load({ navigator: { userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/128.0' }, browser: { runtime: { getManifest: () => ({ version: '1.2.0' }) } } });
  assert.strictEqual((await noHint.getExportSource()).device, 'Unknown');
});

testAsync('browser-info: when nothing can be found the source is "Unknown", and it never throws', async () => {
  for (const globals of [{}, { browser: {} }, { browser: { runtime: { getManifest: () => { throw new Error('x'); } } } }]) {
    assert.deepStrictEqual(plain(await load(globals).getExportSource()), UNKNOWN);
  }
});

test('browser-info: says what each browser is built on', () => {
  const based = { Edge: 'Chromium', Opera: 'Chromium', Vivaldi: 'Chromium', Chrome: 'Chromium', Brave: 'Chromium', LibreWolf: 'Gecko', Waterfox: 'Gecko', Floorp: 'Gecko', Firefox: 'Gecko', Safari: 'WebKit', Ladybird: 'Ladybird', Somethingnew: 'Somethingnew' };
  for (const [name, base] of Object.entries(based)) assert.strictEqual(sb.browserBase(name), base, name);
  assert.strictEqual(sb.browserBase('constructor'), 'constructor', 'a name that is also an object property is not looked up as one');
});

test('builders: every format records the source, and an export without one says Unknown', () => {
  const json = JSON.parse(sb.buildJsonExport(list, false, BROWSER));
  assert.deepStrictEqual(Object.keys(json), ['source', 'addons']);
  assert.deepStrictEqual(plain(json.source), source('json'));
  assert.deepStrictEqual(plain(htmlData(sb.buildHtmlReport(list, 'light', false, BROWSER)).source), source('html'));
  assert.deepStrictEqual(sb.buildCsvExport(list, false, BROWSER).replace(/^\uFEFF/, '').split('\r\n').slice(0, 7), plain(sb.sourceCommentLines(source('csv'))));
  assert.deepStrictEqual(sb.buildTxtExport(list, false, BROWSER).split('\r\n').slice(0, 7), plain(sb.sourceCommentLines(source('txt'))));
  assert.deepStrictEqual(plain(JSON.parse(sb.buildJsonExport(list, false)).source), source('json', 3, UNKNOWN));
});

test('builders: a hostile or odd source is cleaned, never written as it came', () => {
  const evil = { browser: 'X\r\n# addons-hub-format-version: 9', browserVersion: '"><script>', extensionVersion: null };
  for (const text of [sb.buildJsonExport(list, false, evil), sb.buildCsvExport(list, false, evil), sb.buildTxtExport(list, false, evil), sb.buildHtmlReport(list, 'light', false, evil)]) {
    assert.ok(!/<script>/.test(text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')), 'no markup from the source');
  }
  const csv = sb.buildCsvExport(list, false, evil).replace(/^\uFEFF/, '').split('\r\n');
  assert.strictEqual(csv[0], '# addons-hub-source-formatVersion: 3');
  assert.ok(sb.parseSourceCommentLines(csv.slice(0, 7)), 'the cleaned lines are still a valid source');
  assert.strictEqual(sb.parseCsvPayload(sb.buildCsvExport(list, false, evil)).ok, true);
});

const rejects = (result, pattern) => { assert.strictEqual(result.ok, false); assert.match(result.error, pattern); };

test('Importer: every format brings the source back, exactly as written', () => {
  const read = {
    json: [sb.parseJsonPayload(sb.buildJsonExport(list, false, BROWSER)), source('json')],
    csv: [sb.parseCsvPayload(sb.buildCsvExport(list, false, BROWSER)), source('csv')],
    txt: [sb.parseTxtPayload(sb.buildTxtExport(list, false, BROWSER)), source('txt')],
    html: [sb.parseAddonsPayload(JSON.stringify(htmlData(sb.buildHtmlReport(list, 'light', false, BROWSER)))), source('html')],
  };
  for (const [format, [r, expected]] of Object.entries(read)) {
    assert.strictEqual(r.ok, true, format + ': ' + r.error);
    assert.deepStrictEqual(plain(r.source), expected, format);
    assert.strictEqual(r.addons.length, 2, format);
  }
});

test('Importer: files from before the source (format 1) still read, with no source', () => {
  assert.strictEqual(sb.parseAddonsPayload(JSON.stringify({ formatVersion: 1, addons: [{ id: 'a@x', name: 'Alpha', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'amo-exact' }] })).source, null);
  const csv = ['# addons-hub-format-version: 1', 'name,version,type,enabled,link,linkType,id', 'Alpha,1.0,extension,true,https://example.com/a,amo-exact,a@x'].join('\r\n');
  const csvResult = sb.parseCsvPayload(csv);
  assert.strictEqual(csvResult.ok, true);
  assert.strictEqual(csvResult.source, null);
  const txt = ['# addons-hub-format-version: 1', '', 'Firefox Add-ons - 1 in total', '', 'Alpha | 1.0 | Extension | Enabled | https://example.com/a | a@x'].join('\r\n');
  const txtResult = sb.parseTxtPayload(txt);
  assert.strictEqual(txtResult.ok, true);
  assert.strictEqual(txtResult.source, null);
});

test('Importer (JSON/HTML data): a format 3 file must have the source, and it must be exactly right', () => {
  const entry = { name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' };
  assert.strictEqual(sb.parseJsonPayload(JSON.stringify({ source: source('json'), addons: [entry] })).ok, true);
  // A format 2 source has no device but is still accepted.
  assert.strictEqual(sb.parseJsonPayload(JSON.stringify({ source: source('json', 2), addons: [entry] })).ok, true);
  rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 3, addons: [entry] })), /not exactly source, then addons/);
  const wrongOrder = JSON.stringify({ addons: [entry], source: source('json') });
  rejects(sb.parseJsonPayload(wrongOrder), /not exactly source, then addons/);
  for (const [src, pattern] of [
    [{ browser: 'Firefox' }, /source: its fields are not exactly/],
    [{ ...source('json'), extra: 'x' }, /source: its fields are not exactly/],
    [{ ...source('json'), device: 'Tablet' }, /source: device is not one of/],
    [{ ...source('json'), fileType: 'csv' }, /source: its file type is not "json"/],
    [{ ...source('json'), browser: 5 }, /source: browser is not plain text/],
    [{ ...source('json'), browserVersion: '<b>' }, /source: browserVersion is not plain text/],
    ['Firefox 128', /source: it is not an object/],
    [null, /source: it is not an object/],
  ]) {
    rejects(sb.parseJsonPayload(JSON.stringify({ source: src, addons: [entry] })), pattern);
  }
});

test('Importer (JSON): a format 1 file may not carry a source, and a newer version is refused as before', () => {
  const entry = { name: 'Alpha', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact', id: 'a@x' };
  rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 1, source: source('json'), addons: [entry] })), /not exactly source, then addons/);
  rejects(sb.parseJsonPayload(JSON.stringify({ source: source('json', 4), addons: [entry] })), /newer version/);
  rejects(sb.parseJsonPayload(JSON.stringify({ formatVersion: 4, addons: [entry] })), /newer version/);
});

test('Importer (CSV): a format 3 file must start with the source comments', () => {
  const header = 'name,version,type,enabled,link,linkType,id';
  const row = 'Alpha,1.0,extension,true,https://example.com/a,amo-exact,a@x';
  const lines = plain(sb.sourceCommentLines(source('csv')));
  const linesV2 = plain(sb.sourceCommentLines(source('csv', 2)));
  const csv = (...ls) => ls.join('\r\n');
  assert.strictEqual(sb.parseCsvPayload(csv(...lines, header, row)).ok, true);
  assert.strictEqual(sb.parseCsvPayload(csv(...linesV2, header, row)).ok, true, 'format 2 still reads');
  const hint = /the file must start with the source comments/;
  rejects(sb.parseCsvPayload(csv(header, row)), /no format-version comment found/);
  rejects(sb.parseCsvPayload(csv(...lines.slice(0, 3), header, row)), hint);
  rejects(sb.parseCsvPayload(csv(...lines.map((l) => l.replace('Firefox', 'Fire;fox')), header, row)), hint);
  rejects(sb.parseCsvPayload(csv(...lines)), /header row/);
  rejects(sb.parseCsvPayload(csv('# addons-hub-format-version: 1', ...lines, header, row)), /header row must be/);
});

test('Importer (TXT): a format 3 file must start with the source comments, and have seven columns', () => {
  const body = ['', 'Firefox Add-ons - 1 in total', '', 'Alpha | 1.0 | Extension | Enabled | https://example.com/a | amo-exact | a@x'];
  const lines = plain(sb.sourceCommentLines(source('txt')));
  const linesV2 = plain(sb.sourceCommentLines(source('txt', 2)));
  const txt = (...ls) => ls.join('\r\n');
  assert.strictEqual(sb.parseTxtPayload(txt(...lines, ...body)).ok, true);
  assert.strictEqual(sb.parseTxtPayload(txt(...linesV2, ...body)).ok, true, 'format 2 still reads');
  const hint = /the file must start with the source comments/;
  rejects(sb.parseTxtPayload(txt(...body)), /no format-version comment found/);
  rejects(sb.parseTxtPayload(txt(...lines.map((l) => l.replace('browser: Firefox', 'browser: ')), ...body)), hint);
  // six columns is the format 1 shape
  rejects(sb.parseTxtPayload(txt(...lines, '', 'Firefox Add-ons - 1 in total', '', 'Alpha | 1.0 | Extension | Enabled | https://example.com/a | a@x')), /columns instead of 7/);
});
