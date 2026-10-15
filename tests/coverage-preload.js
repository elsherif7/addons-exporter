// Only used by `npm run test:coverage` (node --require tests/coverage-preload.js).
//
// The tests run the extension's scripts inside vm sandboxes, which a coverage
// tool cannot attribute to a file on its own. This hook gives each script a
// file name when it is run, so the coverage of src/ is counted for real.
// Where a test runs several source files joined into one script, each file is
// run as its own script in the same sandbox - the same way a page loads them.
// It changes nothing about what the tests check.

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'src');
const known = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith('.js') && !full.endsWith('.generated.js')) known.push([fs.readFileSync(full, 'utf8'), pathToFileURL(full).href]);
  }
})(SRC);

const original = vm.runInContext;
vm.runInContext = function (code, context, options) {
  if (typeof code !== 'string') return original.call(this, code, context, options);
  const found = [];
  for (const [source, url] of known) {
    const at = code.indexOf(source);
    if (at !== -1) found.push({ at, end: at + source.length, url });
  }
  if (found.length === 0) return original.call(this, code, context, options);

  const base = typeof options === 'object' && options ? options : {};
  found.sort((a, b) => a.at - b.at);
  let pos = 0;
  let result;
  for (const f of found) {
    if (f.at < pos) continue;
    const between = code.slice(pos, f.at);
    if (between.trim()) result = original.call(this, between, context, options);
    result = original.call(this, code.slice(f.at, f.end), context, { ...base, filename: f.url });
    pos = f.end;
  }
  const rest = code.slice(pos);
  if (rest.trim()) result = original.call(this, rest, context, options);
  return result;
};
