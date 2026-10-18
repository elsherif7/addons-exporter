// only used by `npm run test:coverage` (node --require tests/coverage-preload.js).
// the tests run scripts in vm sandboxes, which coverage can't attribute to a file, so this
// gives each script its file name. when a test joins several source files into one script,
// each is run separately in the same sandbox, like a page loading them.

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
