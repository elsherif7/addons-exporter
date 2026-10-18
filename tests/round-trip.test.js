// Generated lists with awkward names are written in every format and read back
// by the Importer's own parsers. The generator is seeded so a failure repeats.

const assert = require('assert');
const { test, readCommon, readReportBuilders, readImport, htmlData, stubDocument, makeSandbox } = require('./helpers');

const sb = makeSandbox({ URL, document: stubDocument() }, readCommon(), readReportBuilders(), readImport());

// mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'uBlock Origin', 'Dark Reader', 'a,b', 'say "hi"', "it's", 'line\nbreak', 'crlf\r\nbreak', 'tab\there',
  'pipe | pipe', 'back\\slash', '\\|', '=SUM(A1)', '+1', '-2', '@x', '  padded  ', 'ملحق عربي', '日本語の拡張',
  'Ünïcödé', '😀 emoji', 'x'.repeat(200), '<b>tag</b>', '</script>', '&amp;', '# not a comment', ',', '"', '|',
];
const TYPES = ['extension', 'theme'];
const LINK_TYPES = ['amo-exact', 'amo-search', 'homepage', 'amo-search-fallback'];

function makeList(seed, size) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const list = [];
  for (let i = 0; i < size; i++) {
    let name = '';
    const parts = 1 + Math.floor(r() * 3);
    for (let p = 0; p < parts; p++) name += (p ? pick([' ', ' - ', ': ', '']) : '') + pick(PIECES);
    if (!name.trim()) name = 'Add-on ' + i;
    list.push({
      id: `id${i}-${Math.floor(r() * 1e6)}@example.com`,
      name,
      version: `${Math.floor(r() * 9)}.${Math.floor(r() * 99)}`,
      enabled: r() > 0.4,
      type: pick(TYPES),
      link: `https://addons.mozilla.org/en-US/firefox/addon/slug-${i}/`,
      linkType: pick(LINK_TYPES),
    });
  }
  return list;
}

// txt has no linkType column. csv reader turns every line ending, even inside a
// quoted name, into a plain break, so CRLF in a name comes back as LF.
const plain = (a, format) => {
  const o = { id: a.id, name: format === 'csv' ? a.name.replace(/\r\n?/g, '\n') : a.name, version: a.version, enabled: a.enabled, type: a.type, link: a.link };
  if (format !== 'txt') o.linkType = a.linkType;
  return o;
};
const bySorted = (arr, format) => Array.from(arr, (a) => plain(a, format)).sort((x, y) => (x.id < y.id ? -1 : 1));

const FORMATS = {
  html: (list) => sb.parseAddonsPayload(JSON.stringify(htmlData(sb.buildHtmlReport(list, 'light', false)))),
  json: (list) => sb.parseJsonPayload(sb.buildJsonExport(list, false)),
  csv: (list) => sb.parseCsvPayload(sb.buildCsvExport(list, false)),
  txt: (list) => sb.parseTxtPayload(sb.buildTxtExport(list, false)),
};

for (const [format, roundTrip] of Object.entries(FORMATS)) {
  test(`round trip (${format}): 25 generated lists with awkward names come back exactly`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const list = makeList(seed, 12);
      const result = roundTrip(list);
      assert.strictEqual(result.ok, true, `${format}, seed ${seed}: ${result.error}`);
      assert.deepStrictEqual(bySorted(result.addons, format), bySorted(list, format), `${format}, seed ${seed}: the add-ons that came back differ from the ones written`);
    }
  });

  test(`round trip (${format}): every awkward piece on its own survives`, () => {
    const list = PIECES.map((name, i) => ({ id: `p${i}@x`, name, version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'homepage' }));
    const result = roundTrip(list);
    assert.strictEqual(result.ok, true, `${format}: ${result.error}`);
    assert.deepStrictEqual(bySorted(result.addons, format), bySorted(list, format));
  });
}

test('round trip: an empty list is written and read back as an empty list in every format that allows it', () => {
  for (const [format, roundTrip] of Object.entries(FORMATS)) {
    const result = roundTrip([]);
    if (result.ok) assert.strictEqual(result.addons.length, 0, `${format}: an empty list must stay empty`);
  }
});
