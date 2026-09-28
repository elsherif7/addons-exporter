// Tests for src/confirmation/confirmation.js. This page had no test
// coverage at all before - it's exercised here via a fake DOM (S1) since
// it reads location.search and writes into #heading/#message at load time.

const vm = require('vm');
const assert = require('assert');
const { test, readSrc, makeFakeDom } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const confirmationSrc = readSrc('src/confirmation/confirmation.js');

function loadConfirmation(search) {
  const { document, elements } = makeFakeDom(['heading', 'message']);
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
