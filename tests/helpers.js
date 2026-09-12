// Shared test-running infrastructure for every *.test.js file in this
// folder - no framework, just enough to run assertions and print a
// summary, matching this project's existing "plain Node.js" style.
//
// Each *.test.js file requires this and calls test()/testAsync()
// directly as it loads. tests/run.js requires every *.test.js file (which
// registers their tests as a side effect of being required, same as
// before the split) and then calls finish() once, after everything -
// including async tests from every file - has settled.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const pendingAsyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.message}`);
  }
}

// test() is synchronous - fine for plain assertions, but some tests need
// to load and exercise real async code (message listeners, click
// handlers). testAsync() runs the same pass/fail bookkeeping against a
// promise instead; the calls are collected here (across every test file,
// since this module is cached and shared by all of them) so finish() can
// wait for all of them before printing the final summary.
function testAsync(name, fn) {
  pendingAsyncTests.push(
    fn().then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    }).catch((err) => {
      failed++;
      console.log(`  FAIL - ${name}`);
      console.log(`    ${err.message}`);
    })
  );
}

// Reads a file relative to the project root (one level up from tests/),
// so every *.test.js file can say readSrc('src/common/common.js') instead
// of repeating path.join(__dirname, '..', ...) at each call site.
function readSrc(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// Evaluates an identifier or expression directly in a vm context instead
// of destructuring it off the sandbox object. Needed for anything the
// loaded source declares with top-level const/let - function declarations
// and var get copied onto the sandbox object when a script runs in it,
// but const/let don't, so those have to be read this way instead.
function evalInContext(sandbox, expr) {
  return vm.runInContext(expr, sandbox);
}

// Waits for every async test (from every test file that's been required)
// to settle, then prints the combined summary and exits non-zero if
// anything failed. Called once, by tests/run.js, after requiring every
// *.test.js file.
async function finish() {
  await Promise.all(pendingAsyncTests);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, testAsync, readSrc, evalInContext, finish };
