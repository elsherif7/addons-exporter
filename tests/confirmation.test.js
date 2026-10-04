// Tests for src/confirmation/confirmation.js. This page had no test
// coverage at all before - it's exercised here via a fake DOM (S1) since
// it reads location.search and writes into #heading/#message at load time.

const vm = require('vm');
const assert = require('assert');
const { test, readSrc, makeFakeDom } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const confirmationSrc = readSrc('src/confirmation/confirmation.js');

function loadConfirmation(search, { prefillMessage } = {}) {
  const { document, elements } = makeFakeDom(['heading', 'message']);
  // The real confirmation.html ships #message with static fallback text.
  if (prefillMessage) elements.message.textContent = prefillMessage;
  const sandbox = {
    document,
    location: { search },
    URLSearchParams,
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);
  vm.runInContext(confirmationSrc, sandbox);
  return { document, elements };
}

test('export, HTML format: heading and message name the right title and format', () => {
  const { elements } = loadConfirmation('?from=export&format=html');
  assert.strictEqual(elements.heading.textContent, 'Add-ons Exporter');
  assert.match(elements.message.textContent, /exported as an HTML report/);
});

test('export, JSON format: uses "a JSON file", not "a HTML report"', () => {
  const { elements } = loadConfirmation('?from=export&format=json');
  assert.match(elements.message.textContent, /exported as a JSON file/);
  assert.doesNotMatch(elements.message.textContent, /report/);
});

test('export, CSV format: uses "a CSV file"', () => {
  const { elements } = loadConfirmation('?from=export&format=csv');
  assert.match(elements.message.textContent, /exported as a CSV file/);
});

test('export, no format param: defaults to HTML report wording', () => {
  const { elements } = loadConfirmation('?from=export');
  assert.match(elements.message.textContent, /exported as an HTML report/);
});

test('import: heading and message reflect the Importer, not the Exporter', () => {
  const { elements } = loadConfirmation('?from=import');
  assert.strictEqual(elements.heading.textContent, 'Add-ons Importer');
  assert.match(elements.message.textContent, /Each selected add-on is opening in its own tab/);
});

test('no ?from= at all: defaults to the export message', () => {
  const { elements } = loadConfirmation('');
  assert.strictEqual(elements.heading.textContent, 'Add-ons Exporter');
});

test('an unrecognised ?from= value falls back to the export message, not a crash', () => {
  const { elements } = loadConfirmation('?from=something-unexpected');
  assert.strictEqual(elements.heading.textContent, 'Add-ons Exporter');
});

test('the message is built with real <strong> elements, not raw HTML text', () => {
  const { elements } = loadConfirmation('?from=export&format=html');
  const strongs = elements.message.querySelectorAll('strong');
  assert.ok(strongs.length >= 2, 'expected at least two <strong> elements (the two product names)');
  assert.strictEqual(strongs[0].textContent, 'Add-ons Exporter');
});

test('document.title is set to the same heading text', () => {
  const { document, elements } = loadConfirmation('?from=import');
  assert.strictEqual(document.title, elements.heading.textContent);
});

// The real page's #message already contains static text before the script
// runs. The message must replace it, not be appended after it (which
// showed the text twice).
test('the message replaces the static fallback text in the HTML instead of duplicating it', () => {
  const fallback = 'Thanks for using Add-ons Exporter. Your add-ons were exported as an HTML report. On another browser, choose Add-ons Importer to select which ones to install.';
  const { elements } = loadConfirmation('?from=export&format=html', { prefillMessage: fallback });
  const text = elements.message.textContent;
  assert.strictEqual(text.split('Thanks for using').length - 1, 1, 'the message should appear exactly once');
});

test('import message replaces the export-worded fallback text, not appended after it', () => {
  const fallback = 'Thanks for using Add-ons Exporter. Your add-ons were exported as an HTML report.';
  const { elements } = loadConfirmation('?from=import', { prefillMessage: fallback });
  const text = elements.message.textContent;
  assert.doesNotMatch(text, /exported as/, 'the export wording from the fallback must be gone on the import page');
  assert.match(text, /Each selected add-on is opening/);
});

test('a prototype-pollution-shaped ?from= value falls back to the export message safely', () => {
  // MESSAGES['constructor'] resolves to Object.prototype.constructor (a
  // function, truthy) via the old `|| MESSAGES.export` fallback, so this
  // specific value is the one that would have slipped past it.
  const { elements } = loadConfirmation('?from=constructor');
  assert.strictEqual(elements.heading.textContent, 'Add-ons Exporter');
  assert.doesNotMatch(elements.message.textContent, /undefined/);
});

test('import: ?failed=N adds how many add-ons could not be opened', () => {
  const { elements } = loadConfirmation('?from=import&failed=2');
  assert.match(elements.message.textContent, /2 add-ons could not be opened\./);
});

test('import: ?failed=1 uses the singular', () => {
  const { elements } = loadConfirmation('?from=import&failed=1');
  assert.match(elements.message.textContent, /1 add-on could not be opened\./);
});

test('import: a missing, zero, or junk ?failed= value adds nothing', () => {
  for (const q of ['?from=import', '?from=import&failed=0', '?from=import&failed=abc', '?from=import&failed=-3', '?from=import&failed=1.5', '?from=import&failed=99999']) {
    const { elements } = loadConfirmation(q);
    assert.doesNotMatch(elements.message.textContent, /could not be opened/, q);
  }
});

test('export: ?failed= is ignored (only the Importer reports it)', () => {
  const { elements } = loadConfirmation('?from=export&format=csv&failed=3');
  assert.doesNotMatch(elements.message.textContent, /could not be opened/);
});

