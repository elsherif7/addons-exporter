// Runs every test file in this folder. Each *.test.js file registers its
// tests (via test()/testAsync() from ./helpers.js) as a side effect of
// being required - this just requires them in a stable order and prints
// the final summary once everything, including async tests, has settled.
//
// Run with: node tests/run.js
//
// Adding a new test file: create tests/<name>.test.js (see any existing
// one for the pattern - require('./helpers') for test()/testAsync(), plus
// readSrc()/evalInContext() as needed), then add a require() for it below.

require('./common.test.js');
require('./theme.test.js');
require('./import.test.js');
require('./report-template.test.js');
require('./background.test.js');
require('./export.test.js');
require('./settings.test.js');
require('./manager.test.js');

require('./helpers').finish();
