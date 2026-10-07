// Builds the standalone, self-contained HTML report handed back by
// doExport() in background.js. Pure string templating only - nothing
// here touches browser.* APIs, so it can be loaded and tested on its
// own. Depends on common.js (escapeHtml, byName, LINK_TYPE_LABELS,
// UNCERTAIN_LINK_TYPES, EXPORT_FORMAT_VERSION), which must be loaded
// before this file - see manifest.json's background.scripts order.

// An add-on name (attacker-controlled) containing "</script>" would
// close this tag early when the report is opened directly. Escaping
// "</" as "<\/" stops that - JSON.parse reads it back the same either way.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

// The extension's own icon, embedded as a data URI (not a relative path)
// since the exported report is a standalone file that won't have the
// extension's icons folder sitting next to it once it's saved elsewhere.
const REPORT_ICON_DATA_URI = 'data:image/png;base64,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';

// Builds a plain JSON export. Same payload shape as the embedded
// #addons-exporter-data in the HTML report, just saved as a standalone
// .json file. Importable by the importer the same way HTML is.
function buildJsonExport(list) {
  return JSON.stringify({ formatVersion: EXPORT_FORMAT_VERSION, addons: list }, null, 2);
}

// Builds a CSV export. First line is a format-version comment so the
// importer can validate it without guessing. Second line is the header
// row. One data row per add-on. Fields with commas or quotes are
// quoted and internal quotes are doubled per RFC 4180.
function buildCsvExport(list) {
  const csvField = (val) => {
    let s = String(val == null ? '' : val);
    // A cell starting with =, +, -, @, tab, or CR is read as a formula by
    // Excel/Sheets/LibreOffice once this file is opened in a spreadsheet -
    // and an add-on name is attacker-controlled. A leading apostrophe
    // forces "read as text" in all of them, and disappears from the
    // visible cell content once opened. parseCsvPayload()'s
    // stripCsvFormulaGuard() strips exactly one back off on import.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    // Quote the field if it contains a comma, double-quote, or newline.
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (fields) => fields.map(csvField).join(',');

  const lines = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    row(['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType']),
    ...list.map((a) => row([a.id, a.name, a.version, a.enabled, a.type, a.link, a.linkType])),
  ];
  return lines.join('\r\n');
}

// list is the resolved add-ons array (see doExport() for its shape).
// theme is 'light' or 'dark' - the report's starting appearance,
// baked in from whatever the exporter's own Settings said at export
// time (see doExport()'s call site). The toggle button lets anyone
// viewing the report flip it, and the choice is persisted in
// localStorage so it survives between opens of the same file.
// Falls back to the baked-in value if localStorage is unavailable.
function buildHtmlReport(list, theme, shorten = true) {
  const startingTheme = theme === 'dark' ? 'dark' : 'light';

  const row = (a) => {
    const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
    const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';
    const match = matchLabel ? `<span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>` : '';
    const displayShortName = escapeHtml(shorten ? shortName(a.name) : a.name);
    const typeLabel = a.type === 'theme' ? 'Theme' : 'Extension';
    return `<div class="addon-row">
      <span class="addon-row-info"><span class="addon-name">${displayShortName}</span>
      <span class="addon-version">${escapeHtml(a.version)}</span>
      <span class="match-label">${escapeHtml(typeLabel)}</span>
      ${match}</span>
      <a class="match-label" href="${escapeHtml(a.link)}" target="_blank" rel="noopener" style="color:var(--link-accent);text-decoration:none;flex-shrink:0;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">AMO</a>
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
  /* Same variable names/values as shared.css, duplicated here since
     the report is a standalone file with no access to that file once
     saved. Accent colors (link/warning) get their own lighter
     dark-mode values for contrast, same reasoning as shared.css. */
  :root {
    --bg: #f4f5f7;
    --card-bg: #fff;
    --card-shadow: 0 1px 4px rgba(0,0,0,0.08);
    --card-border: transparent;
    --text: #222;
    --text-secondary: #444;
    --text-muted: #666;
    --text-faint: #707070;
    --border: #d0d3d9;
    --border-soft: #e2e4e8;
    --border-faint: #f0f1f3;
    --hover-bg: #fafbfc;
    --btn-bg: #1f2937;
    --link-accent: #0060df;
    --warn-color: #b45309;
    --danger-color: #c0392b;
    --press-ring: rgba(0, 96, 223, 0.4);
    --motion-fast: 0.2s;
    --motion-normal: 0.4s;
    --motion-slow: 0.6s;
    --motion-search: 0.3s;
    --motion-theme: 0.6s;
    --motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    --motion-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  @supports (animation-timing-function: linear(0, 1)) {
    :root {
      --motion-spring: linear(0, 0.046, 0.163, 0.321, 0.495, 0.666, 0.819, 0.946, 1.042, 1.109, 1.147, 1.162, 1.159, 1.143, 1.118, 1.09, 1.062, 1.036, 1.014, 0.997, 0.985, 0.977, 0.974, 0.974, 0.976, 0.979, 0.984, 0.989, 1);
    }
  }
  :root[data-theme="dark"] {
    --bg: #15171c;
    --card-bg: #1e2128;
    --card-shadow: 0 1px 4px rgba(0,0,0,0.4);
    --card-border: #2a2e37;
    --text: #e8e9ec;
    --text-secondary: #c3c5ca;
    --text-muted: #9199a3;
    --text-faint: #8890a0;
    --border: #3a3f4b;
    --border-soft: #2f333c;
    --border-faint: #262932;
    --hover-bg: #262a33;
    --btn-bg: #374151;
    --link-accent: #6ea8fe;
    --warn-color: #f0a838;
    --danger-color: #ef6a5e;
    --press-ring: rgba(110, 168, 254, 0.5);
  }
  /* Vertical padding uses vmin (not vw) so it also scales down on
     short landscape viewports, where vw alone would keep it large
     even though height is what's actually constrained there. */
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); margin: 0; padding: clamp(24px, 8vmin, 60px) clamp(14px, 5vw, 20px); color: var(--text); box-sizing: border-box; overflow-wrap: break-word; }
  .card { position: relative; max-width: 640px; margin: 0 auto; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; box-shadow: var(--card-shadow); padding: clamp(20px, 6vmin, 40px); text-align: center; box-sizing: border-box; }
  h1 { font-size: clamp(22px, 6vw, 28px); margin: 0 0 16px; }
  p { font-size: 16px; color: var(--text-secondary); line-height: 1.7; margin: 0 0 28px; }
  /* Staged opening reveal - same as "staged" in shared.css, which a saved
     report cannot load. First only the page background shows, then the
     empty card UNFOLDS downward, then the title settles in as its letters
     tighten up, then the intro, the search box and the list wipe in from
     the left, one after another. backwards fill throughout: nothing shows
     before its turn, and no held keyframe overrides :hover. */
  @keyframes hub-unfold {
    from { opacity: 0; transform: translateY(20px); clip-path: inset(0 0 100% 0 round 12px); }
    to   { opacity: 1; transform: none; clip-path: inset(-60px round 12px); }
  }
  @keyframes hub-title-in {
    from { opacity: 0; transform: translateY(12px); letter-spacing: 0.16em; }
    to   { opacity: 1; transform: none; letter-spacing: 0em; }
  }
  @keyframes hub-wipe-in {
    from { opacity: 0; transform: translateX(-14px); clip-path: inset(0 100% 0 0 round 8px); }
    to   { opacity: 1; transform: none; clip-path: inset(-8px round 8px); }
  }
  @keyframes hub-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .card { animation: hub-unfold 0.8s var(--motion-ease) backwards; animation-delay: 0.15s; }
  .card > h1 { animation: hub-title-in 0.6s var(--motion-ease) backwards; animation-delay: 0.55s; }
  /* The theme toggle is absolutely positioned inside the card; it just
     fades in with the title. */
  .card > .theme-toggle { animation: hub-fade-in var(--motion-normal) ease backwards; animation-delay: 0.55s; }
  .card > p { animation: hub-wipe-in 0.55s var(--motion-ease) backwards; animation-delay: 0.7s; }
  .cta-link { color: var(--link-accent); font-weight: bold; text-decoration: none; }
  .cta-link:hover { text-decoration: underline; }
  .theme-toggle {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border-soft);
    background: var(--card-bg);
    color: var(--text);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, border-color 0.12s, transform 0.1s;
  }
  .theme-toggle:hover { background: var(--hover-bg); border-color: var(--btn-bg); transform: scale(1.02); }
  .theme-toggle:active { transform: scale(0.9); }
  .search-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    margin-bottom: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    background: var(--card-bg);
    color: var(--text);
    transition: border-color 0.12s, transform 0.1s;
  }
  .search-input:focus { outline: none; border-color: var(--btn-bg); transform: scale(1.01); }
  .search-input:hover { border-color: var(--btn-bg); transform: scale(1.01); }
  .placeholder-text { padding: 20px; color: var(--text-muted); font-size: 14px; margin: 0; }
  #noSearchMatches { border: 1px solid var(--border); border-radius: 10px; text-align: center; animation: hub-fade-in var(--motion-normal) ease backwards; }
  .checklist-box {
    text-align: left;
    overflow-x: hidden;
    padding: 4px 0;
    margin-bottom: 20px;
  }
  .groups-outer-box {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .group-container { margin-bottom: 20px; }
  .group-container:last-child { margin-bottom: 0; }
  .group-box {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .group-box:last-child { margin-bottom: 0; }
  .group-heading {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    padding: 0 0 8px 2px;
  }
  .addon-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-soft);
    user-select: none;
    transition: background 0.12s, transform 0.1s;
    /* Search fade (see .is-filtered below). The line above is the
       fallback for Firefox versions that don't understand allow-discrete. */
    transition: background 0.12s, transform 0.1s,
      opacity var(--motion-search) ease, display var(--motion-search) allow-discrete;
  }
  .addon-row-info { flex: 1; }
  .addon-row:last-child { border-bottom: none; }
  .addon-row:hover { background: var(--hover-bg); transform: scale(1.01); }
  .addon-row:active { transform: scale(0.985); }
  :root[data-theme="dark"] .addon-row:hover { background: #2e3340; }
  .group-container { transition: opacity var(--motion-search) ease, display var(--motion-search) allow-discrete; }
  #addonList { transition: opacity var(--motion-search) ease, display var(--motion-search) allow-discrete; }
  /* Search filtering: the inline script sets display:none AND .is-filtered
     when a row or group stops matching (and removes both when it matches
     again), which the transitions above turn into a fade out / fade in.
     Where unsupported it is simply instant. */
  .addon-row.is-filtered, .group-container.is-filtered, #addonList.is-filtered { opacity: 0; }
  @starting-style {
    .addon-row, .group-container, #addonList { opacity: 0; }
  }
  .addon-name { font-size: 14px; font-weight: 600; color: var(--text); }
  .addon-version { color: var(--text-faint); font-size: 12px; margin-left: 6px; }
  .match-label { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
  .match-label[href]:hover { text-decoration: underline; }
  .match-uncertain { color: var(--warn-color); font-weight: 600; }

  /* The rest of the opening reveal (see the staged block near the top).
     Kept down here, after the .search-input and .checklist-box rules they
     extend, because the drift tests read the first rule of each selector. */
  .card > .search-input { animation: hub-wipe-in 0.55s var(--motion-ease) backwards; animation-delay: 0.82s; }
  .card > .checklist-box { animation: hub-wipe-in 0.55s var(--motion-ease) backwards; animation-delay: 0.94s; }

  /* Light/dark switch. Where the browser supports view transitions
     (Firefox 144+), theme.js wraps the theme change in
     document.startViewTransition(): the old page stays fully visible while
     the new theme fades in on top of it - a plain, clean cross-fade, with no
     blur or zoom. Everywhere else, theme.js adds .theme-switching to <html>
     for a moment instead, and every color glides from one theme to the
     other. Neither runs on first page load. */
  ::view-transition-old(root),
  ::view-transition-new(root) {
    mix-blend-mode: normal;
    animation-duration: var(--motion-theme);
    animation-timing-function: ease-in-out;
  }
  ::view-transition-old(root) { animation: none; z-index: 1; }
  ::view-transition-new(root) { animation-name: hub-theme-in; z-index: 2; }
  @keyframes hub-theme-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  :root.theme-switching,
  :root.theme-switching *,
  :root.theme-switching *::before,
  :root.theme-switching *::after {
    transition: background-color var(--motion-theme) ease-in-out, color var(--motion-theme) ease-in-out,
      border-color var(--motion-theme) ease-in-out, box-shadow var(--motion-theme) ease-in-out,
      fill var(--motion-theme) ease-in-out, stroke var(--motion-theme) ease-in-out !important;
  }

  /* The sun/moon icon spins and pops in each time it is swapped. */
  @keyframes hub-icon-spin {
    from { opacity: 0; transform: rotate(-200deg) scale(0.3); }
    to   { opacity: 1; transform: none; }
  }
  .theme-toggle svg { animation: hub-icon-spin 0.7s var(--motion-spring) backwards; }

  /* Nothing should be caught mid-fade when the report is printed or saved
     as a PDF. */
  @media print {
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
    .addon-row, .group-container, #addonList { opacity: 1 !important; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.001ms !important;
      animation-duration: 0.001ms !important;
      animation-delay: 0s !important;
    }
    .theme-toggle:hover, .theme-toggle:active,
    .search-input:hover, .addon-row:hover {
      transform: none !important;
    }
  }
</style>
</head>
<body>
  <div class="card">
  <button type="button" id="themeToggle" class="theme-toggle" aria-label="${startingTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}">
    ${startingTheme === 'dark'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path transform="scale(-1,1) translate(-24,0)" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    }
  </button>
  <h1>Add-ons Exporter</h1>
  <p><strong>Tip:</strong> on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/" target="_blank" rel="noopener">Add-ons Hub</a> installed, click its toolbar icon, choose <strong>Add-ons Importer</strong>, and select this file - any add-ons you don't already have will be pre-selected to open.</p>

  <input type="search" id="searchInput" class="search-input" placeholder="Search add-ons...">

  <div class="checklist-box">
    <div id="addonList">
      <div class="groups-outer-box">
        ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
        ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}
      </div>
    </div>
    <p id="noSearchMatches" class="placeholder-text" style="display:none;">No add-ons match your search.</p>
  </div>
  </div>

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
  <script>
    // @inline-script-start
    // Self-contained - this file has no access to the extension's own
    // scripts or APIs once it's saved and opened on its own.
    var addonListEl = document.getElementById('addonList');
    var noSearchMatchesEl = document.getElementById('noSearchMatches');

    var THEME_KEY = 'addons-hub-report-theme';
    var BAKED_THEME = '${startingTheme}';

    // Reads the persisted theme from localStorage, falling back to the
    // baked-in value if localStorage is unavailable or has nothing stored.
    function loadPersistedTheme() {
      try {
        var stored = localStorage.getItem(THEME_KEY);
        return stored === 'dark' || stored === 'light' ? stored : BAKED_THEME;
      } catch (e) {
        return BAKED_THEME;
      }
    }

    var SUN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var MOON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path transform="scale(-1,1) translate(-24,0)" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

    // Colors glide between themes (see .theme-switching in the CSS), but
    // only for changes after the page has loaded, never the first paint.
    var themeSwitchTimer = null;
    var themeReady = false;

    // Mirrors applyTheme() in theme.js: view transitions (new theme fades
    // in over the old one) where supported, a color glide otherwise,
    // nothing on first load or for reduced motion.
    function applyTheme(theme) {
      var root = document.documentElement;
      var changing = themeReady && root.getAttribute('data-theme') !== theme;
      var reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      function update() {
        root.setAttribute('data-theme', theme);
        themeToggleEl.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
        themeToggleEl.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      }
      if (changing && !reduced && document.startViewTransition) {
        document.startViewTransition(update);
      } else {
        if (changing && !reduced) {
          root.classList.add('theme-switching');
          clearTimeout(themeSwitchTimer);
          themeSwitchTimer = setTimeout(function () { root.classList.remove('theme-switching'); }, 800);
        }
        update();
      }
    }

    var themeToggleEl = document.getElementById('themeToggle');

    // Apply persisted theme on load (may differ from the baked-in default).
    applyTheme(loadPersistedTheme());
    themeReady = true;

    themeToggleEl.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = isDark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });

    // NOTE: mirrors setFilterVisible() and filterAddonRows() in common.js. Duplicated here
    // because this report is self-contained and can't load common.js
    // once saved elsewhere. Keep both copies in sync if you change this.
    function setFilterVisible(el, visible) {
      el.style.display = visible ? '' : 'none';
      if (el.classList) el.classList.toggle('is-filtered', !visible);
    }

    function filterAddonRows(query) {
      var q = query.trim().toLowerCase();
      var anyMatch = false;
      // querySelectorAll (not addonListEl.children) so this keeps working
      // regardless of nesting depth - see the same change in common.js's
      // filterAddonRows().
      var groupContainers = addonListEl.querySelectorAll('.group-container');
      for (var i = 0; i < groupContainers.length; i++) {
        var el = groupContainers[i];
        var box = el.querySelector('.group-box');
        var groupHasMatch = false;
        if (box) {
          var rows = box.children;
          for (var j = 0; j < rows.length; j++) {
            if (rows[j].classList.contains('addon-row')) {
              var nameEl = rows[j].querySelector('.addon-name');
              var match = q === '' || (nameEl && nameEl.textContent.toLowerCase().indexOf(q) !== -1);
              setFilterVisible(rows[j], !!match);
              if (match) { groupHasMatch = true; anyMatch = true; }
            }
          }
        }
        setFilterVisible(el, groupHasMatch);
      }
      return anyMatch;
    }

    document.getElementById('searchInput').addEventListener('input', function (e) {
      var anyMatch = filterAddonRows(e.target.value);
      setFilterVisible(addonListEl, anyMatch);
      noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
    });

    // Click/tap feedback: a ring (or, for rows, a tinted flash) bursts out
    // of whatever is pressed. Mirrors src/common/press.js, which a saved
    // report can't load. Uses element.animate() so the page's own CSS
    // animations are never restarted by a press.
    (function () {
      var ROW = '.addon-row';
      var TARGET = '.theme-toggle, a[href]';
      function ringColor() {
        try {
          var v = getComputedStyle(document.documentElement).getPropertyValue('--press-ring').trim();
          return v || 'rgba(0, 96, 223, 0.4)';
        } catch (e) { return 'rgba(0, 96, 223, 0.4)'; }
      }
      function pulse(el) {
        if (!el || typeof el.animate !== 'function') return;
        if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var c = ringColor();
        el.animate(
          el.matches(ROW)
            ? [{ boxShadow: 'inset 0 0 0 999px ' + c }, { boxShadow: 'inset 0 0 0 999px transparent' }]
            : [{ boxShadow: '0 0 0 0 ' + c }, { boxShadow: '0 0 0 12px transparent' }],
          { duration: 520, easing: 'ease-out' }
        );
      }
      function findTarget(node) {
        if (!node || typeof node.closest !== 'function') return null;
        return node.closest(ROW) || node.closest(TARGET);
      }
      if (document.addEventListener) {
        document.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          pulse(findTarget(e.target));
        }, true);
        document.addEventListener('click', function (e) {
          if (e.detail === 0) pulse(findTarget(e.target));
        }, true);
      }
    })();
  </script>
</body>
</html>`;
}
