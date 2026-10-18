// Sets the version in package.json and manifest.json together so they can't
// disagree (a test fails if they do).
//
//   node scripts/set-version.js 1.3.0
//   npm run set-version -- 1.3.0
//
// Only the "version" line changes; formatting and line endings are kept.
// Firefox accepts one to four dot-separated whole numbers, none with a leading
// zero (01.2 is rejected).

'use strict';

const fs = require('fs');
const path = require('path');

const VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/;
const FILES = ['package.json', 'manifest.json'];

// Throws, and writes nothing, if the version is invalid or a file doesn't have
// exactly one "version" line.
function setVersion(root, version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`"${version}" is not a valid version (use numbers and dots, like 1.3.0)`);
  }
  const updates = FILES.map((name) => {
    const file = path.join(root, name);
    const text = fs.readFileSync(file, 'utf8');
    const matches = text.match(/^(\s*"version"\s*:\s*")[^"]*(")/gm) || [];
    if (matches.length !== 1) throw new Error(`${name}: expected exactly one "version" line, found ${matches.length}`);
    return { file, text: text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`) };
  });
  for (const { file, text } of updates) fs.writeFileSync(file, text);
  return FILES;
}

module.exports = { setVersion };

if (require.main === module) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/set-version.js <version>   (for example 1.3.0)');
    process.exit(1);
  }
  try {
    setVersion(path.join(__dirname, '..'), version);
    console.log(`version set to ${version} in ${FILES.join(' and ')}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
