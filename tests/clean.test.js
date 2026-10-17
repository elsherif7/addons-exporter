// scripts/clean.js: what it decides is throwaway, and what it refuses to
// touch. The rules are the whole point of that script, so they get tests like
// any other logic - each one runs against a scratch tree in the OS temp
// folder, never against this project.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./helpers');

const { find, remove, sizeOf, human, ROOT } = require('../scripts/clean');

// Builds a scratch tree. A name ending in "/" makes an empty folder; anything
// else makes a one-byte file, with its folders as needed.
function makeTree(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-hub-clean-'));
  for (const entry of entries) {
    const full = path.join(root, entry);
    if (entry.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'x');
    }
  }
  return root;
}

function relative(root, found) {
  return found.map((item) => path.relative(root, item).split(path.sep).join('/'));
}

test('clean: finds throwaway output and leaves everything that is not', (t) => {
  const root = makeTree([
    // matched wherever they turn up
    'node_modules/left-pad/index.js',
    'sub/node_modules/left-pad/index.js',
    'coverage/index.html',
    'web-ext-artifacts/addons_hub-1.2.0.zip',
    '__pycache__/module.pyc',
    'src/app.pyc',
    '.DS_Store',
    'Thumbs.db',
    // matched only at the root
    'build/output.js',
    'dist/bundle.js',
    '.cache/',
    'export.zip',
    // not matched: generic folder names deeper in the tree
    'src/build/real-source.js',
    'src/dist/real-source.js',
    'notes/build/real-source.js',
    // not matched: an archive parked in a subfolder
    'downloads/export.zip',
    // not matched: ordinary project files
    'src/main.js',
    'README.md',
    'icons/icon48.png',
    // never entered, so never matched, however they are named
    '.git/objects/ab/cdef',
    'tests/fixtures/amo.zip',
    'tests/node_modules/left-pad/index.js',
    'tests/golden/report.html',
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepStrictEqual(relative(root, find(root)), [
    '.DS_Store',
    '.cache',
    'Thumbs.db',
    '__pycache__',
    'build',
    'coverage',
    'dist',
    'export.zip',
    'node_modules',
    'src/app.pyc',
    'sub/node_modules',
    'web-ext-artifacts',
  ]);
});

test('clean: removes a whole folder, read-only files included, and nothing else', (t) => {
  const root = makeTree(['node_modules/pkg/index.js', 'keep.txt']);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // npm writes read-only files; removing them must not need a chmod first.
  fs.chmodSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 0o444);

  const targets = find(root);
  assert.deepStrictEqual(relative(root, targets), ['node_modules']);
  for (const target of targets) remove(target);

  assert.ok(!fs.existsSync(path.join(root, 'node_modules')), 'node_modules is gone');
  assert.ok(fs.existsSync(path.join(root, 'keep.txt')), 'nothing else is touched');
});

test('clean: reports readable sizes, and treats anything unreadable as zero', (t) => {
  const root = makeTree(['node_modules/a.js', 'node_modules/nested/b.js', 'empty-dir/']);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.strictEqual(sizeOf(path.join(root, 'node_modules')), 2, 'both one-byte files');
  assert.strictEqual(sizeOf(path.join(root, 'empty-dir')), 0);
  assert.strictEqual(sizeOf(path.join(root, 'not-there')), 0);

  assert.strictEqual(human(0), '0 B');
  assert.strictEqual(human(512), '512 B');
  assert.strictEqual(human(1024), '1.0 KB');
  assert.strictEqual(human(5 * 1024 * 1024), '5.0 MB');
});

// The one that would hurt: the script must never decide that source is output.
test('clean: on this project, nothing it would delete is source or history', () => {
  const found = relative(ROOT, find(ROOT));
  for (const item of found) {
    assert.ok(!/^(src|tests|icons)\//.test(item), `${item} is source, not output`);
    assert.ok(!item.startsWith('.git/'), `${item} is version control`);
  }
});
