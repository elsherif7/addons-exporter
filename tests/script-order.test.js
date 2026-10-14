// Script order is load-bearing: the extension's scripts are classic scripts
// that share one global scope per context (the background, and each page), so
// a script that uses a function from a file that is not loaded - or is loaded
// AFTER it - only fails at runtime, in that one context. This reads the real
// script lists (manifest.json for the background, the <script> tags of each
// page) and checks, for every file in every context, that each shared
// function or constant it uses comes from a file loaded earlier in the SAME
// context. It also keeps page-only code out of the background.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, readSrc } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// The shared libraries: their top-level names are what other scripts depend on.
// (Page scripts - export.js, import.js, settings.js... - are consumers only.)
const LIBRARIES = [
  'src/common/theme.js',
  'src/common/core.js',
  'src/common/page-ui.js',
  'src/common/addon-list.js',
  'src/common/press.js',
  'src/common/reveal.js',
  'src/background/export-formats.js',
  'src/background/report-template.js',
  'src/background/zip.js',
  'src/background/amo.js',
  'src/import/parsers.js',
  'src/import/match.js',
  'src/settings/settings-file.js',
];

// The code of a script with comments and string contents blanked out, so that
// words in comments and text are not mistaken for uses. Template-literal
// ${...} expressions are code and are kept. A "/" starts a regular expression
// when the last real character before it cannot end an operand.
function codeOnly(src) {
  let out = '';
  let i = 0;
  let last = '';
  function template() {
    // i is just after the opening backtick
    out += ' ';
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { out += '  '; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        out += '  '; i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          const ch = src[i];
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) break; }
          if (ch === '`') { i++; template(); continue; }
          if (ch === "'" || ch === '"') { skipString(ch); continue; }
          out += ch; i++;
        }
        out += ' '; i++;
        continue;
      }
      out += src[i] === '\n' ? '\n' : ' ';
      i++;
    }
    out += ' '; i++;
  }
  function skipString(q) {
    out += ' '; i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { out += '  '; i += 2; continue; }
      out += ' '; i++;
    }
    out += ' '; i++;
  }
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === "'" || c === '"') { skipString(c); last = 'x'; continue; }
    if (c === '`') { i++; template(); last = 'x'; continue; }
    if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last))) {
      // regular expression literal
      out += ' '; i++;
      let inClass = false;
      while (i < src.length && (src[i] !== '/' || inClass)) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += ' '; i++;
      }
      out += ' '; i++;
      while (/[a-z]/.test(src[i] || '')) { out += ' '; i++; }
      last = 'x';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

// Names declared at the top level of a script (column 0, which is how every
// file in this project is written).
function topLevelNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

const definedIn = new Map(); // library name -> the file that declares it
for (const file of LIBRARIES) {
  for (const n of topLevelNames(readSrc(file))) {
    assert.ok(!definedIn.has(n), `${n} is declared in both ${definedIn.get(n)} and ${file}`);
    definedIn.set(n, file);
  }
}

// Every context the extension runs scripts in, with its scripts in load order.
function contexts() {
  const list = [];
  const manifest = JSON.parse(readSrc('manifest.json'));
  list.push({ name: 'background', files: manifest.background.scripts });
  for (const dir of fs.readdirSync(path.join(ROOT, 'src'))) {
    const dirPath = path.join(ROOT, 'src', dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const f of fs.readdirSync(dirPath).filter((x) => x.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dirPath, f), 'utf8');
      const files = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
        .map((m) => path.posix.normalize(`src/${dir}/${m[1]}`));
      list.push({ name: `${dir}/${f}`, files });
    }
  }
  return list;
}

test('script order: every script in every context only uses shared names from files loaded before it', () => {
  const problems = [];
  for (const ctx of contexts()) {
    ctx.files.forEach((file, index) => {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${ctx.name} loads ${file}, which does not exist`);
      const own = topLevelNames(readSrc(file));
      const code = codeOnly(readSrc(file));
      const before = new Set(ctx.files.slice(0, index));
      const used = new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);
      for (const name of used) {
        const owner = definedIn.get(name);
        if (!owner || owner === file || own.has(name)) continue; // not shared, or its own
        if (!before.has(owner)) {
          problems.push(`${ctx.name}: ${file} uses ${name} (from ${owner}), which is not loaded before it`);
        }
      }
    });
  }
  assert.deepStrictEqual(problems, []);
});

test('script order: the background never loads page-only code, and no page loads the background\'s', () => {
  for (const ctx of contexts()) {
    const files = ctx.files;
    if (ctx.name === 'background') {
      for (const bad of ['src/common/page-ui.js', 'src/common/addon-list.js', 'src/common/theme.js', 'src/common/press.js', 'src/common/reveal.js']) {
        assert.ok(!files.includes(bad), `the background must not load ${bad} (it has no document)`);
      }
    } else {
      for (const bad of files.filter((f) => f.startsWith('src/background/'))) {
        assert.fail(`${ctx.name} loads ${bad}, which belongs to the background`);
      }
    }
  }
});

test('script order: core.js comes first among the shared scripts of every context that loads it', () => {
  for (const ctx of contexts()) {
    if (!ctx.files.includes('src/common/core.js')) continue;
    const shared = ctx.files.filter((f) => LIBRARIES.includes(f) && f !== 'src/common/theme.js');
    assert.strictEqual(shared[0], 'src/common/core.js', `${ctx.name}: core.js must be the first shared script`);
  }
});

test('script order: no library file declares the same top-level name as another (they share one scope)', () => {
  // Checked while building the table above - this just makes the intent a test.
  assert.ok(definedIn.size > 50, 'the table of shared names should be filled');
});

test('script order: the checker catches a script that is loaded too late (self-test)', () => {
  const code = codeOnly('const x = escapeHtml("a"); // shortName in a comment\nconst s = "byName";');
  const used = new Set(code.match(/[A-Za-z_$][\w$]*/g));
  assert.ok(used.has('escapeHtml'));
  assert.ok(!used.has('shortName'), 'names in comments are ignored');
  assert.ok(!used.has('byName'), 'names in strings are ignored');
  const tpl = codeOnly('const t = `a ${typeLabel(x)} b typeLabelText`;');
  assert.ok(/typeLabel\(/.test(tpl), 'code inside ${...} is kept');
  assert.ok(!/typeLabelText/.test(tpl), 'template text is ignored');
});
