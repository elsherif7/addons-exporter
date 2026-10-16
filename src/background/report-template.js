// Builds the HTML report returned by doExport() in background.js:
// buildHtmlReport(). Pure string templating only - nothing here touches
// browser.* APIs, so it can be loaded and tested on its own. Needs core.js
// (escapeHtml, byName, LINK_TYPE_LABELS, UNCERTAIN_LINK_TYPES,
// EXPORT_FORMAT_VERSION, groupForReading) and report-assets.generated.js
// (REPORT_CSS, REPORT_INLINE_SCRIPT, REPORT_ICON_DATA_URI) loaded before it -
// see manifest.json's background.scripts order. The JSON, CSV and TXT builders are
// in export-formats.js.

// An add-on name (attacker-controlled) containing "</script>" would
// close this tag early when the report is opened directly. Escaping
// "</" as "<\/" stops that - JSON.parse reads it back the same either way.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

// THE DATA CONTRACT OF THE HTML REPORT. The page around it (layout, colours,
// the theme button, animation) can change freely, but the data block that
// goes into #addons-exporter-data is what the Importer reads, and it must stay
// exactly what the version released on addons.mozilla.org wrote:
//   { "formatVersion": 2, "source": { browser, basedOn, browserVersion, extensionVersion },
//     "addons": [ { id, name, version, enabled, type, link, linkType }, ... ] }
// in that order, with full (never shortened) names. (Format version 1, which
// the release on addons.mozilla.org wrote, had no "source"; the Importer still
// reads it.) Writing the fields out one
// by one here keeps the order fixed whatever the caller's objects look like.
// Changing any of this means bumping EXPORT_FORMAT_VERSION (see
// tests/format-contract.test.js, which fails until the change is deliberate).
function htmlDataAddon(a) {
  return {
    id: a.id,
    name: a.name,
    version: a.version,
    enabled: a.enabled,
    type: a.type,
    link: a.link,
    linkType: a.linkType,
  };
}

// The report's own script (report-inline.js, built into REPORT_INLINE_SCRIPT),
// with the starting theme filled in, indented to sit inside the <script> tag.
function reportInlineScript(theme) {
  return REPORT_INLINE_SCRIPT
    .replace('__BAKED_THEME__', theme)
    .split('\n')
    .map((line) => (line ? '    ' + line : line))
    .join('\n');
}

// "Exported from Firefox 128.0 with Add-ons Hub 1.2.0" - the visible form of the
// source recorded in the report's data. Parts that are not known are left out.
function sourceNote(source) {
  const s = normalizeSource(source);
  const withExtension = s.extensionVersion === UNKNOWN_SOURCE.extensionVersion ? '' : ` with Add-ons Hub ${s.extensionVersion}`;
  return escapeHtml(`Exported from ${sourceLabel(s)}${withExtension}`);
}

// theme is 'light' or 'dark' - the report's starting appearance,
// baked in from whatever the exporter's own Settings said at export
// time (see doExport()'s call site). The toggle button lets anyone
// viewing the report flip it, and the choice is persisted in
// localStorage so it survives between opens of the same file.
// Falls back to the baked-in value if localStorage is unavailable.
function buildHtmlReport(list, theme, shorten = true, source = UNKNOWN_SOURCE) {
  const startingTheme = theme === 'dark' ? 'dark' : 'light';
  const grouped = groupForReading(list);

  const row = (a) => {
    const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
    const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';
    const match = matchLabel ? `<span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>` : '';
    const displayShortName = escapeHtml(shorten ? shortName(a.name) : a.name);
    const typeText = typeLabel(a.type);
    return `<div class="addon-row">
      <span class="addon-row-info"><span class="addon-name">${displayShortName}</span>
      <span class="addon-version">${escapeHtml(a.version)}</span>
      <span class="match-label">${escapeHtml(typeText)}</span>
      ${match}</span>
      <a class="match-label" href="${escapeHtml(a.link)}" target="_blank" rel="noopener">AMO</a>
    </div>`;
  };

  const section = (title, items) => items.length
    ? `<div class="group-container"><div class="group-heading">${title} (${items.length})</div><div class="group-box">${items.map(row).join('')}</div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${startingTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add-ons Exporter</title>
<link rel="icon" href="${REPORT_ICON_DATA_URI}">
<style>
${REPORT_CSS}
</style>
</head>
<body>
  <div class="card">
  <button type="button" id="themeToggle" class="theme-toggle">
    ${startingTheme === 'dark'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path transform="scale(-1,1) translate(-24,0)" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    }
  </button>
  <h1>Add-ons Exporter</h1>
  <p class="intro-text"><strong>Tip:</strong> on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/" target="_blank" rel="noopener">Add-ons Hub</a> installed, click its toolbar icon, choose <strong>Add-ons Importer</strong>, and select this file - any add-ons you don't already have will be pre-selected to open.</p>
  <p class="intro-text source-note">${sourceNote(source)}</p>

  <input type="search" id="searchInput" class="search-input" placeholder="Search add-ons...">

  <div class="checklist-box">
    <div id="addonList" class="revealing">
      <div class="groups-outer-box">
        ${section('Enabled', grouped.enabled)}
        ${section('Disabled', grouped.disabled)}
      </div>
    </div>
    <p id="noSearchMatches" class="placeholder-text" style="display:none;">No add-ons match your search.</p>
  </div>
  </div>

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, source: normalizeSource(source), addons: list.map(htmlDataAddon) })}</script>
  <script>
${reportInlineScript(startingTheme)}
  </script>
</body>
</html>`;
}
