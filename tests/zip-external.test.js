// builds zips with buildZip() (src/background/zip.js) and checks them with tools not written here.
// the first writer passed its own unit test (its reader was written to match it) but real tools
// rejected the archive: a size field in the end-of-central-directory record was wrong. only an
// outside reader catches that, so: Info-ZIP unzip, Python zipfile, bsdtar. each is skipped if
// missing; if none exists one test says so and passes.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, readSrcs, makeSandbox } = require('./helpers');

const sandbox = makeSandbox({ TextEncoder, Uint8Array, Uint32Array, DataView }, readSrcs('src/common/crc32.js', 'src/background/zip.js'));

// realistic multi-format export, non-ascii included
const files = [
  { name: 'Firefox Add-ons (2026-10-12_13-47-00).html', content: '<!DOCTYPE html><title>Add-ons Exporter</title>\n<p>café 広告</p>' },
  { name: 'Firefox Add-ons (2026-10-12_13-47-00).json', content: JSON.stringify({ formatVersion: 1, addons: [{ name: 'uBlock Origin', id: 'uBlock0@raymondhill.net' }] }, null, 2) },
  { name: 'Firefox Add-ons (2026-10-12_13-47-00).csv', content: '﻿# addons-hub-format-version: 1\r\nname,version\r\n"Tab ""Stash""",1.0' },
  { name: 'Firefox Add-ons (2026-10-12_13-47-00).txt', content: '# addons-hub-format-version: 1\r\n\r\nEnabled (1)\r\n' },
];

const zipBytes = Buffer.from(sandbox.buildZip(files, new Date(2026, 9, 12, 13, 47, 0)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-hub-zip-'));
const zipPath = path.join(dir, 'export.zip');
fs.writeFileSync(zipPath, zipBytes);

function available(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

function run(cmd, args, options) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options });
}

let toolsFound = 0;

if (available('unzip', ['-v'])) {
  toolsFound++;
  test('zip (external): Info-ZIP `unzip -t` reports the archive as valid', () => {
    const r = run('unzip', ['-t', zipPath]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No errors detected/);
  });
  test('zip (external): `unzip` extracts every file with the exact original bytes', () => {
    const out = path.join(dir, 'unzip-out');
    fs.mkdirSync(out);
    const r = run('unzip', ['-q', zipPath, '-d', out]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const f of files) {
      assert.strictEqual(fs.readFileSync(path.join(out, f.name), 'utf8'), f.content, f.name);
    }
  });
}

const python = ['python3', 'python'].find((p) => available(p, ['--version']));
if (python) {
  toolsFound++;
  test('zip (external): Python zipfile validates every entry (CRC and sizes) and returns the original text', () => {
    const script = [
      'import sys, zipfile, json',
      'z = zipfile.ZipFile(sys.argv[1])',
      'bad = z.testzip()',
      'assert bad is None, "bad entry: %s" % bad',
      'out = {i.filename: z.read(i).decode("utf-8") for i in z.infolist()}',
      'print(json.dumps(out))',
    ].join('\n');
    const r = run(python, ['-I', '-c', script, zipPath]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const got = JSON.parse(r.stdout);
    assert.deepStrictEqual(Object.keys(got), files.map((f) => f.name), 'same names, same order');
    for (const f of files) assert.strictEqual(got[f.name], f.content, f.name);
  });
}

// only bsdtar (`tar` on Windows 10+ and macOS) reads zips, GNU tar doesn't
const tarVersion = run('tar', ['--version']);
if (!tarVersion.error && /bsdtar|libarchive/i.test(tarVersion.stdout)) {
  toolsFound++;
  test('zip (external): bsdtar can list the archive and finds every file', () => {
    const r = run('tar', ['-tf', zipPath]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const listed = r.stdout.split(/\r?\n/).filter(Boolean);
    assert.deepStrictEqual(listed, files.map((f) => f.name));
  });
}

if (toolsFound === 0) {
  test('zip (external): no unzip, Python or bsdtar found on this machine - nothing to check with (install one to enable)', () => {});
}
