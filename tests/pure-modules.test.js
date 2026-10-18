// parsers.js, match.js and settings-file.js must stay pure. They're loaded
// into a sandbox with no document and no browser object, so this fails if one
// starts touching the page.

const assert = require('assert');
const { test, readSrcs, makeSandbox } = require('./helpers');

function load(...files) {
  return makeSandbox({ URL }, readSrcs('src/common/core.js', ...files));
}

test('parsers.js + match.js load and work with no document and no browser object', () => {
  const sb = load('src/import/parsers.js', 'src/import/match.js');
  const json = JSON.stringify({ formatVersion: 1, addons: [
    { name: 'Dark Reader', version: '4', type: 'extension', enabled: true, link: 'https://a.example/', linkType: 'amo-exact', id: 'dr@x' },
  ] });
  const r = sb.parseJsonPayload(json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.addons.length, 1);
  assert.strictEqual(r.addons[0].id, 'dr@x');
  const index = sb.buildInstalledIndex([{ id: 'dr@x', name: 'Dark Reader: Dark mode' }]);
  assert.ok(sb.findInstalledMatch({ id: 'dr@x', name: 'whatever' }, index), 'matched by id');
  assert.ok(sb.findInstalledMatch({ id: '', name: 'Dark Reader' }, index), 'matched by short name');
  assert.strictEqual(sb.findInstalledMatch({ id: '', name: 'Other' }, index), null);
});

test('parsers.js: CSV, TXT and HTML-data readers reject a wrong layout without a DOM', () => {
  const sb = load('src/import/parsers.js');
  assert.strictEqual(sb.parseCsvPayload('name,version\nx,1').ok, false);
  assert.strictEqual(sb.parseTxtPayload('nothing here').ok, false);
  assert.strictEqual(sb.parseAddonsPayload(null).ok, false);
});

test('settings-file.js loads with no document and no browser object; round-trips with defaults', () => {
  const sb = load('src/settings/settings-file.js');
  const out = sb.buildSettingsExport(sb.withSettingsDefaults({}));
  const back = sb.parseSettingsFile(out);
  assert.strictEqual(back.ok, true);
  assert.deepStrictEqual(Object.keys(back.settings), ['theme', 'exportFormat', 'shortenNames']);
  assert.strictEqual(back.settings.theme, 'light');
  assert.strictEqual(back.settings.exportFormat, 'html');
  assert.strictEqual(sb.parseSettingsFile(JSON.stringify({ formatVersion: 1, settings: { theme: 'dark' } })).ok, false);
  assert.strictEqual(sb.withSettingsDefaults({ theme: 'dark', exportFormat: ['json', 'csv'], shortenNames: 'off' }).theme, 'dark');
});
