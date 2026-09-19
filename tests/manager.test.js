// Tests for the pure helper functions in src/manager/manager.js:
// displayName() and applyNickname(). Loads the real source via vm with
// a minimal DOM stub so the file can load without throwing.

const assert = require('assert');
const vm = require('vm');
const { test, readSrc, evalInContext } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const managerSrc = readSrc('src/manager/manager.js');

function makeStubEl() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    replaceChildren() {},
  };
}

const fakeDocument = { getElementById: () => makeStubEl() };

const sandbox = {
  URL,
  document: fakeDocument,
  browser: {
    runtime: { sendMessage: async () => [] },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  },
};
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);
vm.runInContext(managerSrc, sandbox);

const { displayName, applyNickname } = sandbox;

// --- displayName ---

test('displayName: returns real name when no nicknames object given', () => {
  const addon = { id: 'ext@e.com', name: 'uBlock Origin' };
  assert.strictEqual(displayName(addon, {}), 'uBlock Origin');
});

test('displayName: returns real name when id has no entry in nicknames', () => {
  const addon = { id: 'ext@e.com', name: 'uBlock Origin' };
  assert.strictEqual(displayName(addon, { 'other@e.com': 'Other' }), 'uBlock Origin');
});

test('displayName: returns stored nickname when one exists for the id', () => {
  const addon = { id: 'ext@e.com', name: 'uBlock Origin' };
  assert.strictEqual(displayName(addon, { 'ext@e.com': 'My Blocker' }), 'My Blocker');
});

test('displayName: falls back to real name when nickname is empty string', () => {
  const addon = { id: 'ext@e.com', name: 'uBlock Origin' };
  // An empty string stored shouldn't normally happen, but handle it safely.
  assert.strictEqual(displayName(addon, { 'ext@e.com': '' }), 'uBlock Origin');
});

// --- applyNickname ---

test('applyNickname: sets a new nickname for the given id', () => {
  const result = applyNickname({}, 'ext@e.com', 'My Blocker');
  assert.strictEqual(result['ext@e.com'], 'My Blocker');
});

test('applyNickname: trims whitespace before storing', () => {
  const result = applyNickname({}, 'ext@e.com', '  My Blocker  ');
  assert.strictEqual(result['ext@e.com'], 'My Blocker');
});

test('applyNickname: removes the key when nickname is empty string', () => {
  const result = applyNickname({ 'ext@e.com': 'My Blocker' }, 'ext@e.com', '');
  assert.ok(!('ext@e.com' in result), 'key should be removed for empty nickname');
});

test('applyNickname: removes the key when nickname is whitespace-only', () => {
  const result = applyNickname({ 'ext@e.com': 'My Blocker' }, 'ext@e.com', '   ');
  assert.ok(!('ext@e.com' in result), 'key should be removed for whitespace-only nickname');
});

test('applyNickname: does not mutate the original nicknames object', () => {
  const original = { 'ext@e.com': 'Old Name' };
  applyNickname(original, 'ext@e.com', 'New Name');
  assert.strictEqual(original['ext@e.com'], 'Old Name', 'original should be unchanged');
});

test('applyNickname: preserves other existing nicknames', () => {
  const original = { 'a@e.com': 'Alpha', 'b@e.com': 'Beta' };
  const result = applyNickname(original, 'a@e.com', 'New Alpha');
  assert.strictEqual(result['a@e.com'], 'New Alpha');
  assert.strictEqual(result['b@e.com'], 'Beta');
});

test('applyNickname: clearing one nickname leaves others intact', () => {
  const original = { 'a@e.com': 'Alpha', 'b@e.com': 'Beta' };
  const result = applyNickname(original, 'a@e.com', '');
  assert.ok(!('a@e.com' in result));
  assert.strictEqual(result['b@e.com'], 'Beta');
});
