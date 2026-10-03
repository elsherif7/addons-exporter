// Runs `node --check` on every .js file under src/ to catch syntax errors
// before they reach Firefox. Called by `npm test` via the pretest hook.
//
// node --check parses the file and reports any syntax errors without
// executing it - safe to run on browser extension source that uses
// browser.* APIs not available in Node.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

function jsFilesIn(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...jsFilesIn(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

const files = jsFilesIn(SRC_DIR);
let anyError = false;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    console.error(`syntax error in ${path.relative(ROOT, file)}:`);
    console.error((err.stderr || err.stdout || '').toString().trim());
    anyError = true;
  }
}

if (anyError) {
  process.exit(1);
} else {
  console.log(`syntax ok — checked ${files.length} files`);
}
