const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, evalInContext, readCommon, readReportBuilders, makeSandbox, FIREFOX_SOURCE } = require('./helpers');

const commonSrc = readCommon();
const reportTemplateSrc = readReportBuilders();

const sandbox = makeSandbox({ URL }, commonSrc, reportTemplateSrc);
const { buildHtmlReport, safeJsonForScriptTag, buildJsonExport, buildCsvExport } = sandbox;

// top-level const, so it isn't on the sandbox object, eval it in the context
const REPORT_ICON_DATA_URI = evalInContext(sandbox, 'REPORT_ICON_DATA_URI');

const sampleList = [
  { id: 'ublock@example.com', name: 'uBlock Origin', version: '1.58.0', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/', linkType: 'amo-exact' },
  { id: 'darkreader@example.com', name: 'Dark Reader', version: '4.9.90', enabled: true, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/addon/darkreader/', linkType: 'amo-search' },
  { id: 'old@example.com', name: 'Old Extension', version: '0.5', enabled: false, type: 'extension', link: 'https://addons.mozilla.org/en-US/firefox/search/?q=Old%20Extension', linkType: 'amo-search-fallback' },
];

test('buildHtmlReport: groups add-ons into Enabled/Disabled sections with counts', () => {
  const html = buildHtmlReport(sampleList);
  assert.match(html, /Enabled \(2\)/);
  assert.match(html, /Disabled \(1\)/);
  assert.match(html, /uBlock Origin/);
  assert.match(html, /Dark Reader/);
  assert.match(html, /Old Extension/);
});

test('buildHtmlReport: escapes add-on names instead of inserting them raw', () => {
  const html = buildHtmlReport([
    { id: 'x@example.com', name: '<script>alert(1)</script>', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'homepage' },
  ]);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the raw tag should not appear unescaped in the HTML');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('buildHtmlReport: embeds a re-importable JSON payload with a source and the given list', () => {
  const html = buildHtmlReport(sampleList);
  const dataMatch = html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch, 'expected an embedded #addons-exporter-data script tag');
  const data = JSON.parse(dataMatch[1]);
  assert.strictEqual(typeof data.source.formatVersion, 'number');
  assert.strictEqual(data.source.fileType, 'html');
  assert.strictEqual(data.addons.length, sampleList.length);
  assert.deepStrictEqual(new Set(data.addons.map((a) => a.id)), new Set(sampleList.map((a) => a.id)));
});

test('buildHtmlReport: uses REPORT_ICON_DATA_URI as the page favicon', () => {
  const html = buildHtmlReport(sampleList);
  const faviconMatch = html.match(/<link rel="icon" href="(data:image\/png;base64,[^"]+)">/);
  assert.ok(faviconMatch, 'expected a <link rel="icon" href="data:image/png;base64,..."> in the report');
  assert.strictEqual(faviconMatch[1], REPORT_ICON_DATA_URI);
});

test('buildHtmlReport: defaults to light when no theme is given', () => {
  const html = buildHtmlReport(sampleList);
  assert.match(html, /<html lang="en" data-theme="light">/);
});

test('buildHtmlReport: honors an explicit "dark" theme', () => {
  const html = buildHtmlReport(sampleList, 'dark');
  assert.match(html, /<html lang="en" data-theme="dark">/);
});

test('buildHtmlReport: falls back to light for anything other than exactly "dark"', () => {
  assert.match(buildHtmlReport(sampleList, 'light'), /<html lang="en" data-theme="light">/);
  assert.match(buildHtmlReport(sampleList, 'nonsense'), /<html lang="en" data-theme="light">/);
  assert.match(buildHtmlReport(sampleList, undefined), /<html lang="en" data-theme="light">/);
});

test('buildHtmlReport: includes a theme toggle button', () => {
  const lightHtml = buildHtmlReport(sampleList, 'light');
  assert.match(lightHtml, /id="themeToggle"/);

  const darkHtml = buildHtmlReport(sampleList, 'dark');
  assert.match(darkHtml, /id="themeToggle"/);
});

// both icons are in the markup and css picks one, so the report script never
// swaps them (keeps it free of innerHTML)
test('buildHtmlReport: the toggle carries both icons, and report.css shows the one the theme calls for', () => {
  const html = buildHtmlReport(sampleList, 'light');
  assert.match(html, /class="theme-icon theme-icon-sun"/);
  assert.match(html, /class="theme-icon theme-icon-moon"/);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src/background/report.css'), 'utf8');
  assert.match(css, /\.theme-toggle \.theme-icon \{ display: none; \}/);
  assert.match(css, /\[data-theme="light"\] \.theme-toggle \.theme-icon-moon/);
  assert.match(css, /\[data-theme="dark"\] \.theme-toggle \.theme-icon-sun/);
});

test('buildHtmlReport: the icon-only theme toggle and the search box have accessible names', () => {
  const html = buildHtmlReport(sampleList, 'light');
  assert.match(html, /<button[^>]*id="themeToggle"[^>]*aria-label="[^"]+"/, 'the icon-only toggle needs an aria-label');
  assert.match(html, /<input[^>]*id="searchInput"[^>]*aria-label="[^"]+"/, 'the search box needs an aria-label');
});

test('safeJsonForScriptTag: escapes "</" so an add-on name can\'t close the script tag early', () => {
  const json = safeJsonForScriptTag({ addons: [{ name: 'x</script><script>alert(1)</script>' }] });
  assert.ok(!json.includes('</script>'), 'a literal </script> would close the tag early if left unescaped');
  assert.deepStrictEqual(JSON.parse(json), { addons: [{ name: 'x</script><script>alert(1)</script>' }] });
});

test('safeJsonForScriptTag: escapes U+2028 and U+2029 line separators for safe inlining', () => {
  const json = safeJsonForScriptTag({ addons: [{ name: 'line\u2028sep\u2029test' }] });
  assert.ok(!json.includes('\u2028'), 'U+2028 must be escaped');
  assert.ok(!json.includes('\u2029'), 'U+2029 must be escaped');
  assert.ok(json.includes('\\u2028'), 'literal \\u2028 must be in output');
  assert.ok(json.includes('\\u2029'), 'literal \\u2029 must be in output');
  assert.deepStrictEqual(JSON.parse(json), { addons: [{ name: 'line\u2028sep\u2029test' }] });
});


test('REPORT_ICON_DATA_URI: matches icons/icon32.png byte-for-byte', () => {
  const base64Payload = REPORT_ICON_DATA_URI.slice('data:image/png;base64,'.length);
  const embeddedBytes = Buffer.from(base64Payload, 'base64');
  const iconBytes = fs.readFileSync(path.join(__dirname, '..', 'icons/icon32.png'));
  assert.ok(
    embeddedBytes.equals(iconBytes),
    'REPORT_ICON_DATA_URI no longer matches icons/icon32.png - re-encode it if the icon changed intentionally'
  );
});

test('buildJsonExport: returns valid JSON with a source and all addons', () => {
  const json = buildJsonExport(sampleList);
  const parsed = JSON.parse(json);
  assert.strictEqual(typeof parsed.source.formatVersion, 'number');
  assert.strictEqual(parsed.source.fileType, 'json');
  assert.ok(Array.isArray(parsed.addons));
  assert.strictEqual(parsed.addons.length, sampleList.length);
  assert.deepStrictEqual(
    new Set(parsed.addons.map((a) => a.id)),
    new Set(sampleList.map((a) => a.id))
  );
});

test('buildJsonExport: preserves all fields on each add-on', () => {
  const json = buildJsonExport(sampleList);
  const parsed = JSON.parse(json);
  const ublock = parsed.addons.find((a) => a.id === 'ublock@example.com');
  assert.ok(ublock);
  assert.strictEqual(ublock.name, 'uBlock Origin');
  assert.strictEqual(ublock.version, '1.58.0');
  assert.strictEqual(ublock.enabled, true);
  assert.strictEqual(ublock.type, 'extension');
  assert.strictEqual(ublock.link, 'https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/');
  assert.strictEqual(ublock.linkType, 'amo-exact');
});

test('buildJsonExport: output is valid JSON even when names contain special characters', () => {
  const list = [{ id: 'x@e.com', name: 'A & B <>"\'', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  assert.doesNotThrow(() => JSON.parse(buildJsonExport(list)));
});

test('buildCsvExport: the first line is the start of the source, led by the byte-order mark', () => {
  const csv = buildCsvExport(sampleList);
  const firstLine = csv.split('\r\n')[0];
  // BOM so Excel reads it as UTF-8
  assert.match(firstLine, /^\uFEFF# addons-hub-source-formatVersion: \d+$/);
});

test('buildCsvExport: the six source lines come first, then the header row', () => {
  const csv = buildCsvExport(sampleList, true, FIREFOX_SOURCE);
  const lines = csv.split('\r\n');
  assert.deepStrictEqual(lines.slice(0, 6), [
    '\uFEFF# addons-hub-source-formatVersion: 2',
    '# addons-hub-source-fileType: csv',
    '# addons-hub-source-basedOn: Gecko',
    '# addons-hub-source-browser: Firefox',
    '# addons-hub-source-browserVersion: 128.0',
    '# addons-hub-source-extensionVersion: 1.2.0',
  ]);
  assert.strictEqual(lines[6], 'name,version,type,enabled,link,linkType,id');
});

test('buildCsvExport: produces one data row per add-on', () => {
  const csv = buildCsvExport(sampleList);
  // six source lines + header, then the rows
  const dataRows = csv.split('\r\n').slice(7);
  assert.strictEqual(dataRows.length, sampleList.length);
});

test('buildCsvExport: enabled field is "true" or "false" (not 1/0)', () => {
  const csv = buildCsvExport(sampleList);
  const rows = csv.split('\r\n').slice(7);
  for (const row of rows) {
    const fields = row.split(',');
    assert.ok(fields[3] === 'true' || fields[3] === 'false', `expected true/false, got "${fields[3]}"`);
  }
});

test('buildCsvExport: fields containing commas are quoted per RFC 4180', () => {
  const list = [{ id: 'x@e.com', name: 'Hello, World', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list, false);
  const dataRow = csv.split('\r\n')[7];
  assert.match(dataRow, /"Hello, World"/);
});

test('buildCsvExport: fields containing double-quotes double them per RFC 4180', () => {
  const list = [{ id: 'x@e.com', name: 'Say "Hi"', version: '1.0', enabled: false, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list);
  const dataRow = csv.split('\r\n')[7];
  assert.match(dataRow, /"Say ""Hi"""/);
});

test('buildCsvExport: all seven columns are present on every data row', () => {
  const csv = buildCsvExport(sampleList);
  const rows = csv.split('\r\n').slice(7);
  for (const row of rows) {
    // plain split is fine, the sample data has no commas inside fields
    const fields = row.split(',');
    assert.strictEqual(fields.length, 7, `expected 7 columns, got ${fields.length} in row: ${row}`);
  }
});

test('buildCsvExport: a name starting with = gets a leading-apostrophe guard', () => {
  const list = [{ id: 'x@e.com', name: '=HYPERLINK("https://evil.example","click")', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list);
  const dataRow = csv.split('\r\n')[7];
  assert.match(dataRow, /^"'=HYPERLINK/);
});

test('buildCsvExport: names starting with +, -, @, or a tab all get the guard', () => {
  for (const name of ['+SUM(1,1)', '-1+1', '@cmd', '\tstart-with-tab']) {
    const list = [{ id: 'x@e.com', name, version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
    const csv = buildCsvExport(list, false);
    const dataRow = csv.split('\r\n')[7];
    assert.ok(dataRow.includes(`'${name}`), `expected a guarded "${name}" in row: ${dataRow}`);
  }
});

test('buildCsvExport: an ordinary name is not guarded', () => {
  const list = [{ id: 'x@e.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/', linkType: 'amo-exact' }];
  const csv = buildCsvExport(list);
  const dataRow = csv.split('\r\n')[7];
  assert.ok(dataRow.startsWith('uBlock Origin,1.0,'), `should not be guarded: ${dataRow}`);
});

// report.css is a standalone copy of some shared.css rules, these catch drift.
// Left out on purpose: --btn-disabled-bg, the flex/checkbox layout on
// .addon-row, margin-left on .addon-version (the report has no checkboxes or
// disabled buttons).

const sharedCssSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src/common/shared.css'), 'utf8'
);
const reportTemplateSrcRaw = fs.readFileSync(
  path.join(__dirname, '..', 'src/background/report.css'), 'utf8'
);

function extractCssProp(src, selector, property) {
  const sel = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propName = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(sel + '\\s*\\{([^}]+)\\}');
  const block = src.match(blockRe);
  if (!block) return null;
  const propRe = new RegExp(propName + '\\s*:\\s*([^;]+);');
  const prop = block[1].match(propRe);
  return prop ? prop[1].trim() : null;
}

const sharedRules = [
  ['.card', 'border'],
  ['.groups-outer-box', 'border'],
  ['.groups-outer-box', 'border-radius'],
  ['.groups-outer-box', 'padding'],
  ['.groups-outer-box', 'margin-bottom'],
  ['.search-input', 'border-radius'],
  ['.search-input', 'padding'],
  ['.search-input', 'font-size'],
  ['.search-input', 'border'],
  ['.checklist-box', 'overflow-x'],
  ['.checklist-box', 'margin-bottom'],
  ['.group-container', 'margin-bottom'],
  ['.group-box', 'border'],
  ['.group-box', 'border-radius'],
  ['.group-box', 'overflow'],
  ['.group-box', 'margin-bottom'],
  ['.group-heading', 'font-size'],
  ['.group-heading', 'font-weight'],
  ['.group-heading', 'letter-spacing'],
  ['.group-heading', 'color'],
  ['.group-heading', 'padding'],
  ['.addon-row', 'padding'],
  ['.addon-row', 'border-bottom'],
  ['.addon-name', 'font-size'],
  ['.addon-name', 'font-weight'],
  ['.addon-name', 'color'],
  ['.addon-version', 'font-size'],
  ['.addon-version', 'color'],
  ['.placeholder-text', 'padding'],
  ['.placeholder-text', 'color'],
  ['.placeholder-text', 'font-size'],
  ['.match-label', 'font-size'],
  ['.match-label', 'color'],
  ['.match-label', 'margin-left'],
  ['.match-uncertain', 'color'],
  ['.match-uncertain', 'font-weight'],
];

for (const [selector, property] of sharedRules) {
  test(`CSS drift: "${selector} { ${property} }" matches between shared.css and report.css`, () => {
    const fromShared = extractCssProp(sharedCssSrc, selector, property);
    const fromReport = extractCssProp(reportTemplateSrcRaw, selector, property);
    assert.ok(fromShared !== null,
      `"${property}" not found in shared.css for selector "${selector}" — update this test if the rule moved`);
    assert.ok(fromReport !== null,
      `"${property}" not found in report.css for selector "${selector}" — the report copy may be missing this rule`);
    assert.strictEqual(fromReport, fromShared,
      `"${selector} { ${property} }" differs: shared.css has "${fromShared}", report has "${fromReport}"`);
  });
}

// colour and motion variables live only in tokens.css, so neither shared.css
// nor report.css may have its own :root block

// same LF normalising as scripts/build-assets.js, so the REPORT_CSS comparison
// holds on a CRLF checkout
const lf = (text) => text.replace(/\r\n/g, '\n');
const tokensCssSrc = lf(fs.readFileSync(path.join(__dirname, '..', 'src/common/tokens.css'), 'utf8'));

function extractCssVars(src, rootSelector) {
  const sel = rootSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(sel + '\\s*\\{([^}]*)\\}');
  const block = src.match(blockRe);
  if (!block) return null;
  const vars = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

test('tokens: shared.css and report.css declare no variables of their own (tokens.css is the only source)', () => {
  assert.doesNotMatch(sharedCssSrc, /:root\s*(\[[^\]]*\])?\s*\{/, 'shared.css has a :root block - move it into tokens.css');
  assert.doesNotMatch(reportTemplateSrcRaw, /:root\s*(\[[^\]]*\])?\s*\{/, 'report.css has a :root block - move it into tokens.css');
});

test('tokens: every full page loads tokens.css before shared.css', () => {
  for (const page of ['export/export', 'import/import', 'settings/settings', 'confirmation/confirmation']) {
    const html = fs.readFileSync(path.join(__dirname, '..', `src/${page}.html`), 'utf8');
    const t = html.indexOf('../common/tokens.css');
    const s = html.indexOf('../common/shared.css');
    assert.ok(t !== -1 && s !== -1 && t < s, `${page}.html must load tokens.css before shared.css`);
  }
});

// reads the real css variables instead of hardcoding colours, so it follows palette changes

function relLuminance(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [label, rootSelector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  test(`A18: --text-faint meets 4.5:1 contrast against --card-bg (${label})`, () => {
    const vars = extractCssVars(tokensCssSrc, rootSelector);
    const ratio = contrastRatio(vars['--text-faint'], vars['--card-bg']);
    assert.ok(ratio >= 4.5, `--text-faint (${vars['--text-faint']}) vs --card-bg (${vars['--card-bg']}) is only ${ratio.toFixed(2)}:1, need 4.5:1`);
  });

  test(`A17: --link-accent (used for the search input's focus outline) meets 3:1 against --card-bg (${label})`, () => {
    const vars = extractCssVars(tokensCssSrc, rootSelector);
    const ratio = contrastRatio(vars['--link-accent'], vars['--card-bg']);
    assert.ok(ratio >= 3, `--link-accent (${vars['--link-accent']}) vs --card-bg (${vars['--card-bg']}) is only ${ratio.toFixed(2)}:1, need 3:1`);
  });
}

test('A35: no :has() selector remains in shared.css', () => {
  assert.doesNotMatch(sharedCssSrc, /:has\(/);
});

test('A22: shared.css has a prefers-reduced-motion rule', () => {
  assert.match(sharedCssSrc, /@media \(prefers-reduced-motion: reduce\)/);
});

test('A22: the report has a prefers-reduced-motion rule', () => {
  assert.match(reportTemplateSrcRaw, /@media \(prefers-reduced-motion: reduce\)/);
});

test('A36: the report tip does not claim every link opens automatically', () => {
  assert.doesNotMatch(reportTemplateSrc, /open every link below as a tab automatically/);
});

test('A36: the report tip accurately describes selecting the file and pre-selecting new add-ons', () => {
  assert.match(reportTemplateSrc, /select this file[\s\S]{0,80}pre-selected to open/);
});

// catches editing a source without re-running `npm run build`
test('report-assets.generated.js is in sync with report.css, report-inline.js and the icon', () => {
  const { buildAssets, OUT_PATH } = require('../scripts/build-assets');
  assert.strictEqual(
    fs.readFileSync(OUT_PATH, 'utf8'), buildAssets(),
    'report-assets.generated.js is out of sync with its sources - run `npm run build` to update it'
  );
});

test('the report embeds REPORT_CSS: tokens.css, then report.css', () => {
  const css = tokensCssSrc + '\n' + lf(fs.readFileSync(path.join(__dirname, '..', 'src', 'background', 'report.css'), 'utf8'));
  const sb = makeSandbox({}, readReportBuilders());
  assert.strictEqual(evalInContext(sb, 'REPORT_CSS'), css);
});


const awkwardTxtList = [
  { id: 'nl@example.com', name: 'Line\nBreak\r\nTool', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/a', linkType: 'homepage' },
  { id: 'pipe@example.com', name: 'Foo | Bar', version: '2.0', enabled: true, type: 'extension', link: 'https://example.com/b', linkType: 'homepage' },
  { id: 'edge@example.com', name: '| Leading and trailing |', version: '3.0', enabled: false, type: 'extension', link: 'https://example.com/c', linkType: 'homepage' },
  { id: 'slash@example.com', name: 'C:\\Tools\\new | \\|', version: '4.0', enabled: false, type: 'theme', link: 'https://example.com/d', linkType: 'homepage' },
  { id: 'url@example.com', name: 'Spaced Link', version: '5.0', enabled: true, type: 'extension', link: 'https://example.com/x y | z\nw', linkType: 'homepage' },
];

test('buildTxtExport: every add-on is exactly one line with the seven columns, whatever its name holds', () => {
  const txt = sandbox.buildTxtExport(awkwardTxtList, false);
  const rows = txt.split('\r\n').filter((l) => l.includes(' | '));
  assert.strictEqual(rows.length, awkwardTxtList.length, 'one line per add-on');
  for (const row of rows) assert.strictEqual(row.split(' | ').length, 7, row);
  assert.ok(!/[^\r]\n/.test(txt), 'no stray line break anywhere');
});

test('buildTxtExport: backslash, pipe, line break and carriage return are written as \\\\ \\| \\n \\r', () => {
  const rows = sandbox.buildTxtExport(awkwardTxtList, false).split('\r\n');
  assert.ok(rows.some((l) => l.startsWith('Line\\nBreak\\r\\nTool ')), 'line breaks');
  assert.ok(rows.some((l) => l.startsWith('Foo \\| Bar ')), 'pipe');
  assert.ok(rows.some((l) => l.startsWith('\\| Leading and trailing \\| ')), 'pipe at both ends');
  assert.ok(rows.some((l) => l.startsWith('C:\\\\Tools\\\\new \\| \\\\\\| ')), 'backslashes, also in front of a pipe');
});

test('buildTxtExport: a space at the very start or end of a name is written as \\s (the columns are padded with spaces)', () => {
  const txt = sandbox.buildTxtExport([{ id: 'sp@example.com', name: '  Padded Name ', version: '1', enabled: true, type: 'extension', link: 'https://example.com/p', linkType: 'homepage' }], false);
  assert.ok(txt.includes('\\s\\sPadded Name\\s '), txt);
});

test('buildTxtExport: the link and id columns are escaped the same way', () => {
  const row = sandbox.buildTxtExport(awkwardTxtList, false).split('\r\n').find((l) => l.endsWith('url@example.com'));
  assert.ok(row.includes('https://example.com/x y \\| z\\nw'), row);
});

test('buildTxtExport: names without any of these characters are written exactly as before', () => {
  const plain = [{ id: 'p@example.com', name: 'Plain Name', version: '1.0', enabled: true, type: 'extension', link: 'https://example.com/p', linkType: 'amo-exact' }];
  assert.ok(sandbox.buildTxtExport(plain, false).includes('Plain Name | 1.0 | Extension | Enabled  | https://example.com/p | amo-exact | p@example.com'));
});
