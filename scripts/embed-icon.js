// Reads src/icons/icon32.png, base64-encodes it, and rewrites the
// REPORT_ICON_DATA_URI constant in src/background/report-template.js.
//
// Run with: npm run embed-icon
//
// When to run: after replacing or updating src/icons/icon32.png. The
// existing test (report-template.test.js: "REPORT_ICON_DATA_URI: matches
// src/icons/icon32.png byte-for-byte") will fail until you do.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'src', 'icons', 'icon32.png');
const TEMPLATE_PATH = path.join(ROOT, 'src', 'background', 'report-template.js');

const iconBytes = fs.readFileSync(ICON_PATH);
const dataUri = `data:image/png;base64,${iconBytes.toString('base64')}`;

const src = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Matches the full const declaration on one line, whatever value it currently holds.
const CONST_RE = /^(const REPORT_ICON_DATA_URI = ')[^']*(';\s*)$/m;
if (!CONST_RE.test(src)) {
  console.error('embed-icon: could not find REPORT_ICON_DATA_URI constant in', TEMPLATE_PATH);
  process.exit(1);
}

const updated = src.replace(CONST_RE, `$1${dataUri}$2`);

if (updated === src) {
  console.log('embed-icon: REPORT_ICON_DATA_URI is already up to date, nothing changed.');
} else {
  fs.writeFileSync(TEMPLATE_PATH, updated, 'utf8');
  console.log('embed-icon: updated REPORT_ICON_DATA_URI in', path.relative(ROOT, TEMPLATE_PATH));
}
