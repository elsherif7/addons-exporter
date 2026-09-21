// Runs every test file in this folder. Each *.test.js file registers its
// tests (via test()/testAsync() from ./helpers.js) as a side effect of
// being required - this discovers them automatically (sorted, so the
// run order stays stable) and prints the final summary once everything,
// including async tests, has settled.
//
// Run with: node tests/run.js
//
// Adding a new test file: just create tests/<name>.test.js (see any
// existing one for the pattern - require('./helpers') for
// test()/testAsync(), plus readSrc()/evalInContext() as needed). It's
// picked up automatically - nothing to register here.

const fs = require('fs');
const path = require('path');

const testFiles = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const file of testFiles) {
  require(path.join(__dirname, file));
}

require('./helpers').finish();
