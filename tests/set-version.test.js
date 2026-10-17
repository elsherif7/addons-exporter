// scripts/set-version.js: sets the version in package.json and manifest.json
// together, changing nothing else in either file.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./helpers');
const { setVersion } = require('../scripts/set-version');

const ROOT = path.join(__dirname, '..');

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-hub-version-'));
  for (const name of ['package.json', 'manifest.json']) fs.copyFileSync(path.join(ROOT, name), path.join(dir, name));
  return dir;
}
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('set-version: both files get the new version and nothing else in them changes', () => {
  const dir = tempCopy();
  const before = { pkg: read(dir, 'package.json'), manifest: read(dir, 'manifest.json') };
  setVersion(dir, '9.8.7');
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).version, '9.8.7');
  assert.strictEqual(JSON.parse(read(dir, 'manifest.json')).version, '9.8.7');
  const back = (text, v) => text.replace(`"version": "${v}"`, '"version": "OLD"');
  const oldVersion = JSON.parse(before.pkg).version;
  assert.strictEqual(back(read(dir, 'package.json'), '9.8.7'), back(before.pkg, oldVersion), 'package.json: only the version line changed');
  assert.strictEqual(back(read(dir, 'manifest.json'), '9.8.7'), back(before.manifest, JSON.parse(before.manifest).version), 'manifest.json: only the version line changed');
});

test('set-version: it does not touch strict_min_version or any other "version" key', () => {
  const dir = tempCopy();
  setVersion(dir, '2.0');
  const manifest = JSON.parse(read(dir, 'manifest.json'));
  assert.strictEqual(manifest.browser_specific_settings.gecko.strict_min_version, JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).browser_specific_settings.gecko.strict_min_version);
});

test('set-version: a version that is not numbers and dots is rejected and nothing is written', () => {
  const dir = tempCopy();
  const before = read(dir, 'manifest.json');
  for (const bad of ['', 'v1.2', '01.2', '1.02', '1.2.3.4.5', '1..2', 'latest', '1.2.3-beta']) {
    assert.throws(() => setVersion(dir, bad), /not a valid version/, bad);
  }
  assert.strictEqual(read(dir, 'manifest.json'), before);
});

test('set-version: line endings are kept as they were', () => {
  const dir = tempCopy();
  for (const name of ['package.json', 'manifest.json']) {
    fs.writeFileSync(path.join(dir, name), read(dir, name).replace(/\r?\n/g, '\r\n'));
  }
  setVersion(dir, '3.1.4');
  for (const name of ['package.json', 'manifest.json']) {
    assert.ok(/\r\n/.test(read(dir, name)) && !/(?<!\r)\n/.test(read(dir, name)), name + ' is still all CRLF');
  }
});

test('set-version: the repository\'s own two versions agree (so the script is never needed to fix a failing test)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  assert.strictEqual(pkg, manifest);
});
