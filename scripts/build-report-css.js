// Reads src/background/report.css and inlines it into the <style> block
// inside src/background/report-template.js.
//
// Run with: npm run build
//
// When to run: after editing src/background/report.css. The test
// "report.css is in sync with report-template.js" will fail until you do.
//
// Why report.css exists: the exported HTML report is a standalone file
// that can't load shared.css once saved elsewhere, so its styles must be
// inlined into the template. Editing report.css directly (rather than the
// embedded string inside report-template.js) is cleaner and avoids
// accidentally breaking the JS template literal surrounding it.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'src', 'background', 'report.css');
const TEMPLATE_PATH = path.join(ROOT, 'src', 'background', 'report-template.js');

const css = fs.readFileSync(CSS_PATH, 'utf8');
const src = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Matches the content between <style> and </style> in the template literal.
const STYLE_RE = /(<style>\n)([\s\S]*?)(\n<\/style>)/;
if (!STYLE_RE.test(src)) {
  console.error('build-report-css: could not find <style>...</style> block in', TEMPLATE_PATH);
  process.exit(1);
}

const updated = src.replace(STYLE_RE, `$1${css}$3`);

if (updated === src) {
  console.log('build-report-css: report-template.js is already up to date, nothing changed.');
} else {
  fs.writeFileSync(TEMPLATE_PATH, updated, 'utf8');
  console.log('build-report-css: updated <style> block in', path.relative(ROOT, TEMPLATE_PATH));
}
