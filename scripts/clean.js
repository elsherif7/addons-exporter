// Deletes this project's throwaway folders and files - everything a tool made
// and can make again: node_modules comes back with `npm ci`, coverage with
// `npm run test:coverage`, web-ext-artifacts with a web-ext build. Nothing
// else is ever touched.
//
//   npm run clean                     # delete everything it lists
//   npm run clean -- --dry-run        # only show what would go
//   npm run clean -- --path DIR       # clean DIR instead of the project root
//
// To keep it useful as the project grows, add a folder name to DIRS_ANYWHERE
// (matched anywhere in the tree) or DIRS_AT_ROOT (matched only at the root,
// for names generic enough that real source could share one), or a file name
// or extension to FILE_NAMES / FILE_SUFFIXES / ROOT_FILE_SUFFIXES. Folders
// named in NEVER_ENTER are never opened and never deleted - they hold input,
// not output.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Folders to remove wherever they turn up: these names are specific enough
// that nothing else is ever called this.
const DIRS_ANYWHERE = new Set([
  'node_modules',      // npm
  'coverage',          // test and lint reports
  'web-ext-artifacts', // web-ext builds
  '__pycache__',       // Python bytecode
  '.venv',
  'venv',
]);

// Folders to remove only at the project root. These names are generic enough
// that a real source folder deeper in the tree could share one, and that is
// not ours to delete.
const DIRS_AT_ROOT = new Set([
  'build',
  'dist',
  '.cache',
  '.next',
  '.turbo',
  '.parcel-cache',
  'htmlcov',
  '.nyc_output',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);

// Single files to remove, by exact name, wherever they turn up.
const FILE_NAMES = new Set([
  '.DS_Store',       // macOS folder metadata
  'Thumbs.db',       // Windows thumbnail cache
  'desktop.ini',
  '.eslintcache',
  '.stylelintcache',
  '.coverage',       // pytest-cov's data file (its report folder is "coverage")
]);

// Single files to remove, by lower-case extension, wherever they turn up.
const FILE_SUFFIXES = new Set([
  '.pyc',
  '.pyo',
]);

// Single files to remove, by lower-case extension, only at the project root:
// an export (.zip) or a build (.xpi) parked in a subfolder is kept.
const ROOT_FILE_SUFFIXES = new Set([
  '.zip',
  '.xpi',
]);

// Never opened, never removed: version control, the tests, and anything called
// "fixtures" - input data that can look just like output (tests/fixtures is
// compared byte-for-byte, so it has to survive a clean).
const NEVER_ENTER = new Set(['.git', 'tests', 'fixtures']);

// A byte count as something readable, e.g. "5.8 MB".
function human(bytes) {
  let value = bytes;
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (value < 1024 || unit === 'GB') {
      return unit === 'B' ? `${value} B` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${value.toFixed(1)} GB`;
}

// Bytes held by a file, or by everything under a folder. Anything unreadable
// counts as zero rather than stopping the clean.
function sizeOf(target) {
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return stats.size;

  let total = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let child;
      try {
        child = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (child.isDirectory()) visit(full);
      else total += child.size;
    }
  };
  visit(target);
  return total;
}

// Every artefact under root, in a stable order.
function find(root) {
  const found = [];

  const visit = (dir, atRoot) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // A symlink to a folder is treated as a folder: a linked node_modules is
      // still a node_modules. Removing one unlinks it, never what it points at.
      const folderish = entry.isDirectory() || entry.isSymbolicLink();

      if (folderish) {
        if (NEVER_ENTER.has(entry.name)) continue;
        // Taken whole and not descended into, so nothing inside one is listed
        // as well.
        if (DIRS_ANYWHERE.has(entry.name) || (atRoot && DIRS_AT_ROOT.has(entry.name))) {
          found.push(full);
          continue;
        }
        if (entry.isDirectory()) visit(full, false);
        continue;
      }

      const suffix = path.extname(entry.name).toLowerCase();
      const matched = FILE_NAMES.has(entry.name) ||
        FILE_SUFFIXES.has(suffix) ||
        (atRoot && ROOT_FILE_SUFFIXES.has(suffix));
      if (matched) found.push(full);
    }
  };

  visit(root, true);
  return found.sort();
}

// Delete a file, a symlink, or a whole folder - read-only files included:
// fs.rm's recursive mode clears Windows' read-only flag on its own, which is
// most of what npm writes.
function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function main(argv) {
  let root = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (arg === '--path' || arg === '-p') {
      const value = argv[++i];
      if (!value) {
        console.error('--path needs a folder');
        return 2;
      }
      root = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/clean.js [--dry-run] [--path DIR]');
      return 0;
    } else {
      console.error(`unknown option: ${arg}   (try --help)`);
      return 2;
    }
  }

  const target = root ? path.resolve(root) : ROOT;
  let stats;
  try {
    stats = fs.statSync(target);
  } catch {
    stats = null;
  }
  if (!stats || !stats.isDirectory()) {
    console.error(`not a folder: ${target}`);
    return 1;
  }

  const targets = find(target);
  console.log(`Cleaning ${target}${dryRun ? ' (dry run)' : ''}`);
  if (targets.length === 0) {
    console.log('  nothing to clean - already tidy.');
    return 0;
  }

  const sized = targets.map((item) => ({ path: item, size: sizeOf(item) }));
  const total = sized.reduce((sum, item) => sum + item.size, 0);
  for (const item of sized) {
    console.log(`  ${human(item.size).padStart(9)}  ${path.relative(target, item.path)}`);
  }

  if (dryRun) {
    console.log(`\nWould delete ${sized.length} item(s), freeing ${human(total)}. Nothing was touched.`);
    return 0;
  }

  let failed = 0;
  for (const item of sized) {
    try {
      remove(item.path);
    } catch (err) {
      failed += 1;
      console.error(`  could not delete ${item.path}: ${err.message}`);
    }
  }

  console.log(`\nDeleted ${sized.length - failed} item(s), freeing ${human(total)}.`);
  if (failed > 0) {
    console.error(`${failed} item(s) could not be removed.`);
    return 1;
  }
  return 0;
}

module.exports = {
  find,
  remove,
  sizeOf,
  human,
  ROOT,
  DIRS_ANYWHERE,
  DIRS_AT_ROOT,
  FILE_NAMES,
  FILE_SUFFIXES,
  ROOT_FILE_SUFFIXES,
  NEVER_ENTER,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
