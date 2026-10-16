// The .zip reader (src/import/zip-reader.js) and the Importer opening a .zip.
// Zips are built here byte by byte, so the odd ones (encrypted, damaged,
// zip64, oversized) can be made on purpose; the real-tool ones come from
// Python's zipfile and from this extension's own writer (background/zip.js).

const assert = require('assert');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { test, testAsync, readSrc, readSrcs, readImport, readCommon, makeFakeDom } = require('./helpers');

function load() {
  const sb = { Blob, DecompressionStream, TextDecoder, TextEncoder };
  vm.createContext(sb);
  vm.runInContext(readSrcs('src/common/crc32.js', 'src/background/zip.js', 'src/import/zip-reader.js'), sb);
  return sb;
}
const sb = load();
const EXT = new Set(['html', 'htm', 'json', 'csv', 'txt']);
const read = async (bytes, maxEntryBytes = 1024 * 1024) => JSON.parse(JSON.stringify(await sb.readZipEntries(bytes, { extensions: EXT, maxEntryBytes })));

// A zip with full control: each entry is { name, data, method: 'store'|'deflate'|<number>,
// flags, crc, size (declared), compressed (raw bytes to store instead of the real ones) }.
function makeZip(entries, { comment = '' } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const crc = (buf) => zlib.crc32 ? zlib.crc32(buf) : sb.zipCrc32(new Uint8Array(buf));
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data === undefined ? '' : e.data, 'utf8');
    const method = e.method === 'deflate' ? 8 : (typeof e.method === 'number' ? e.method : 0);
    const body = e.compressed || (method === 8 ? zlib.deflateRawSync(data) : data);
    const flags = e.flags || 0;
    const sum = e.crc === undefined ? crc(data) : e.crc;
    const size = e.size === undefined ? data.length : e.size;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(sum, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(sum, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end, Buffer.from(comment)]));
}

// --- what it reads ---

testAsync('zip reader: reads stored and deflated entries, in the order they are in the zip', async () => {
  const r = await read(makeZip([
    { name: 'a.json', data: '{"a":1}', method: 'store' },
    { name: 'b.csv', data: 'x,y\n1,2\n', method: 'deflate' },
  ]));
  assert.deepStrictEqual(r, { ok: true, entries: [{ name: 'a.json', text: '{"a":1}' }, { name: 'b.csv', text: 'x,y\n1,2\n' }] });
});

testAsync('zip reader: reads what this extension\'s own zip writer makes, non-ASCII names and text included', async () => {
  const bytes = sb.buildZip([
    { name: 'add-ons_2026.json', content: '{"name":"Café 日本語"}' },
    { name: 'add-ons_2026.txt', content: 'plain' },
  ]);
  const r = await read(bytes);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.entries.map((e) => e.name), ['add-ons_2026.json', 'add-ons_2026.txt']);
  assert.strictEqual(r.entries[0].text, '{"name":"Café 日本語"}');
});

testAsync('zip reader: reads a zip made by Python\'s zipfile (deflated, with a comment and a folder)', async () => {
  const py = spawnSync('python3', ['-I', '-c', [
    'import sys, zipfile, io',
    'b = io.BytesIO()',
    'z = zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED)',
    'z.writestr("export/", "")',
    'z.writestr("export/list.json", "{\\"k\\": \\"v\\"}" * 200)',
    'z.writestr("notes.md", "ignored")',
    'z.comment = b"made by python"',
    'z.close()',
    'sys.stdout.buffer.write(b.getvalue())',
  ].join('\n')]);
  if (py.status !== 0) return; // no Python here: the hand-built zips above and below still cover the format
  const r = await read(new Uint8Array(py.stdout));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.entries.map((e) => e.name), ['export/list.json']);
  assert.strictEqual(r.entries[0].text, '{"k": "v"}'.repeat(200));
});

testAsync('zip reader: skips folders, macOS "__MACOSX" and "._" files, and files that are not exports', async () => {
  const r = await read(makeZip([
    { name: 'folder/', data: '' },
    { name: '__MACOSX/list.json', data: 'junk' },
    { name: 'folder/._list.json', data: 'junk' },
    { name: 'README', data: 'no extension' },
    { name: 'picture.png', data: 'x' },
    { name: 'folder/LIST.JSON', data: '{}' },
  ]));
  assert.deepStrictEqual(r.entries.map((e) => e.name), ['folder/LIST.JSON']);
});

testAsync('zip reader: a zip with no export files is fine here (an empty list); the Importer words that', async () => {
  const r = await read(makeZip([{ name: 'a.png', data: 'x' }]));
  assert.deepStrictEqual(r, { ok: true, entries: [] });
});

testAsync('zip reader: a zip comment after the directory is allowed', async () => {
  const r = await read(makeZip([{ name: 'a.txt', data: 'hi' }], { comment: 'a comment' }));
  assert.strictEqual(r.entries[0].text, 'hi');
});

// --- what it refuses, in plain words ---

const refused = async (bytes, pattern, max) => {
  const r = await read(bytes, max);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, pattern);
};

testAsync('zip reader: refuses something that is not a zip, a file cut short, and an empty file', async () => {
  await refused(new Uint8Array(Buffer.from('this is plain text, not a zip file at all')), /no zip directory/);
  await refused(new Uint8Array(0), /too short/);
  const whole = makeZip([{ name: 'a.json', data: '{"a":1}' }]);
  await refused(whole.subarray(0, whole.length - 30), /no zip directory|damaged|cut short/);
});

testAsync('zip reader: refuses a password-protected entry', async () => {
  await refused(makeZip([{ name: 'a.json', data: '{}', flags: 1 }]), /password-protected/);
});

testAsync('zip reader: refuses compression methods it cannot read', async () => {
  await refused(makeZip([{ name: 'a.json', data: '{}', method: 12 }]), /compression method/);
});

testAsync('zip reader: refuses zip64 and split archives', async () => {
  const z64 = makeZip([{ name: 'a.json', data: '{}' }]);
  new DataView(z64.buffer).setUint16(z64.length - 22 + 10, 0xFFFF, true);
  await refused(z64, /zip64/);
  const split = makeZip([{ name: 'a.json', data: '{}' }]);
  new DataView(split.buffer).setUint16(split.length - 22 + 4, 1, true);
  await refused(split, /split/);
});

testAsync('zip reader: refuses an entry whose content does not match its checksum or declared size', async () => {
  await refused(makeZip([{ name: 'a.json', data: '{"a":1}', crc: 12345 }]), /"a\.json" is damaged/);
  await refused(makeZip([{ name: 'a.json', data: '{"a":1}', size: 3 }]), /"a\.json" is damaged/);
  await refused(makeZip([{ name: 'a.json', data: '{"a":1}', method: 'deflate', compressed: Buffer.from('garbage-not-deflate') }]), /"a\.json" is damaged/);
});

testAsync('zip reader: refuses an entry bigger than the limit, as declared and as it really unpacks', async () => {
  await refused(makeZip([{ name: 'a.json', data: 'x'.repeat(200) }]), /too large/, 100);
  // A small zip that claims to be small but unpacks to far more: stopped while unpacking.
  const bomb = makeZip([{ name: 'a.json', data: 'x'.repeat(2_000_000), method: 'deflate', size: 1000 }]);
  assert.ok(bomb.length < 10_000, 'the bomb itself is tiny');
  await refused(bomb, /"a\.json" is damaged/, 1_000_000);
});

testAsync('zip reader: refuses a damaged directory', async () => {
  const z = makeZip([{ name: 'a.json', data: '{}' }]);
  new DataView(z.buffer).setUint32(z.length - 22 + 16, 5000, true); // directory "starts" past the end
  await refused(z, /directory is damaged/);
});

testAsync('zip reader: random bytes never throw, they give a sentence', async () => {
  for (let n = 0; n < 40; n++) {
    const junk = new Uint8Array(Array.from({ length: 30 + n * 7 }, (_, i) => (i * 131 + n * 17) % 256));
    const r = await sb.readZipEntries(junk, { extensions: EXT, maxEntryBytes: 1000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(typeof r.error, 'string');
  }
});

// --- the Importer opening a .zip ---

const jsonText = (names) => JSON.stringify({
  formatVersion: 1,
  addons: names.map((n, i) => ({ name: n, version: '1.0', type: 'extension', enabled: true, link: `https://example.com/${i}`, linkType: 'homepage', id: `${i}@x` })),
});

function bootImporter(installed = []) {
  const { document, elements } = makeFakeDom([
    'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
    'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
    'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
    'searchInput', 'noSearchMatches', 'exportPickRow', 'exportPick', 'exportPickList',
  ]);
  const sandbox = {
    document, URL, Blob, DecompressionStream, TextDecoder,
    browser: {
      runtime: { sendMessage: async (m) => (m.type === 'listAddons' ? installed : undefined), getURL: (p) => p },
      storage: { local: { get: async () => ({}) } },
      tabs: { create: async () => ({}) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readCommon(), sandbox);
  vm.runInContext(readImport(), sandbox);
  return { sandbox, elements };
}

const zipFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const shownNames = (elements) => elements.addonList.querySelectorAll('.addon-name').map((n) => n.textContent);

testAsync('Importer: a .zip with several formats is read, using the JSON file', async () => {
  const { sandbox, elements } = bootImporter();
  const zip = makeZip([
    { name: 'add-ons.txt', data: 'not used', method: 'deflate' },
    { name: 'add-ons.json', data: jsonText(['Alpha', 'Beta']), method: 'deflate' },
  ]);
  sandbox.setSelectedFile(zipFile('add-ons_2026.zip', zip));
  await settle();
  assert.deepStrictEqual(shownNames(elements), ['Alpha', 'Beta']);
  assert.strictEqual(elements.fileName.textContent, 'add-ons_2026.zip');
  assert.strictEqual(elements.status.textContent, '');
});

testAsync('Importer: if the first file in a .zip cannot be read, the next one is tried', async () => {
  const { sandbox, elements } = bootImporter();
  const csv = '# addons-hub-format-version: 1\r\nname,version,type,enabled,link,linkType,id\r\nAlpha,1.0,extension,true,https://example.com/,homepage,a@x';
  sandbox.setSelectedFile(zipFile('mixed.zip', makeZip([
    { name: 'add-ons.json', data: '{ this is not json' },
    { name: 'add-ons.csv', data: csv, method: 'deflate' },
  ])));
  await settle();
  assert.strictEqual(elements.status.textContent, '');
  assert.deepStrictEqual(shownNames(elements), ['Alpha']);
});

testAsync('Importer: the Exporter\'s own .zip (made by its real format builders) comes back whole, from CSV alone and from TXT alone', async () => {
  const ex = { TextEncoder };
  vm.createContext(ex);
  vm.runInContext(readSrcs('src/common/core.js', 'src/background/export-formats.js'), ex);
  const list = [
    { id: 'a@x', name: 'Alpha "quoted" ; semi', version: '1.0', type: 'extension', enabled: true, link: 'https://example.com/a', linkType: 'amo-exact' },
    { id: 'b@x', name: "'=Beta | pipe", version: '2.0', type: 'theme', enabled: false, link: 'https://example.com/b', linkType: 'homepage' },
  ];
  const expected = ["'=Beta | pipe", 'Alpha "quoted" ; semi'].sort();
  for (const [name, content] of [['list.csv', ex.buildCsvExport(list, false)], ['list.txt', ex.buildTxtExport(list, false)]]) {
    const { sandbox, elements } = bootImporter();
    sandbox.setSelectedFile(zipFile('export.zip', sb.buildZip([{ name, content }])));
    await settle();
    assert.strictEqual(elements.status.textContent, '', name);
    assert.deepStrictEqual(shownNames(elements).sort(), expected, name);
  }
});

testAsync('Importer: a .zip with no export file in it says so', async () => {
  const { sandbox, elements } = bootImporter();
  sandbox.setSelectedFile(zipFile('photos.zip', makeZip([{ name: 'cat.png', data: 'x' }])));
  await settle();
  assert.match(elements.status.textContent, /doesn't contain an Add-ons Exporter file/);
  assert.deepStrictEqual(shownNames(elements), []);
});

testAsync('Importer: a damaged .zip shows the reader\'s sentence, and a file that is not an export is ignored', async () => {
  const { sandbox, elements } = bootImporter();
  sandbox.setSelectedFile(zipFile('broken.zip', new Uint8Array(Buffer.from('definitely not a zip file, just some text'))));
  await settle();
  assert.match(elements.status.textContent, /isn't a \.zip file the Importer can read/);

  const again = bootImporter();
  again.sandbox.setSelectedFile(zipFile('bad-json.zip', makeZip([{ name: 'list.json', data: '{"formatVersion":1}' }])));
  await settle();
  assert.match(again.elements.status.textContent, /doesn't contain an Add-ons Exporter file/);
  assert.deepStrictEqual(shownNames(again.elements), []);
});

testAsync('Importer: files in a .zip that hold the same add-ons are one export, with no picker', async () => {
  const { sandbox, elements } = bootImporter();
  sandbox.setSelectedFile(zipFile('same.zip', makeZip([
    { name: 'one.json', data: jsonText(['Alpha', 'Beta']) },
    { name: 'two.json', data: jsonText(['Beta', 'Alpha']), method: 'deflate' },
    { name: 'notes.txt', data: 'just some notes, not an export' },
  ])));
  await settle();
  assert.strictEqual(elements.status.textContent, '');
  assert.deepStrictEqual(shownNames(elements), ['Alpha', 'Beta']);
  assert.strictEqual(elements.exportPickRow.style.display, 'none', 'no picker when the files agree');
});

testAsync('Importer: a .zip with different exports shows a picker ("All add-ons" first and default, then the biggest export), and the choice redraws the list', async () => {
  const { sandbox, elements } = bootImporter();
  sandbox.setSelectedFile(zipFile('mixed.zip', makeZip([
    { name: 'first.json', data: jsonText(['Alpha']) },
    { name: 'second.json', data: jsonText(['Beta', 'Gamma']), method: 'deflate' },
  ])));
  await settle();

  const options = () => elements.exportPickList.querySelectorAll('.export-pick-option');
  assert.deepStrictEqual(options().map((o) => o.textContent), ['All add-ons (2)', 'second.json (2)', 'first.json (1)']);
  assert.strictEqual(elements.exportPickRow.style.display, 'block');
  assert.strictEqual(elements.exportPick.textContent, 'All add-ons (2)', '"All add-ons" is the default');
  assert.strictEqual(elements.exportPickList.style.display, 'none', 'the row panel starts closed');
  assert.deepStrictEqual(shownNames(elements), ['Alpha', 'Gamma'], 'All merges, keeping id 0@x once - from the first export');

  elements.exportPick.click(); // the closed box opens the row panel
  assert.strictEqual(elements.exportPickList.style.display, 'block');
  assert.strictEqual(elements.exportPick.getAttribute('aria-expanded'), 'true');

  options()[1].click(); // second.json
  assert.strictEqual(elements.exportPickList.style.display, 'none', 'picking a row closes the panel');
  assert.strictEqual(elements.exportPick.textContent, 'second.json (2)', 'the closed box echoes the choice');
  assert.deepStrictEqual(shownNames(elements), ['Beta', 'Gamma']);

  options()[2].click(); // first.json
  assert.strictEqual(elements.exportPick.textContent, 'first.json (1)');
  assert.deepStrictEqual(shownNames(elements), ['Alpha']);

  options()[0].click(); // back to All add-ons
  assert.strictEqual(elements.exportPick.textContent, 'All add-ons (2)');
  assert.deepStrictEqual(shownNames(elements), ['Alpha', 'Gamma']);
});

test('Importer: .zip is an accepted file type, and the page lists the zip reader before import.js', () => {
  const s = bootImporter().sandbox;
  assert.strictEqual(s.validateSelectedFile({ name: 'x.zip', size: 10 }).ok, true);
  assert.strictEqual(s.validateSelectedFile({ name: 'x.rar', size: 10 }).ok, false);
  const html = readSrc('src/import/import.html');
  assert.match(html, /accept="[^"]*\.zip/);
  assert.ok(html.indexOf('zip-reader.js') !== -1 && html.indexOf('zip-reader.js') < html.indexOf('import.js'));
});
