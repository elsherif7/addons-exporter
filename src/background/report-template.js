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
    const s = String(val == null ? '' : val);
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
function buildHtmlReport(list, theme) {
  const startingTheme = theme === 'dark' ? 'dark' : 'light';

  const row = (a) => {
    const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
    const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';
    const match = matchLabel ? `<span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>` : '';
    return `<div class="addon-row">
      <a class="addon-name" href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>
      <span class="addon-version">${escapeHtml(a.version)}</span>
      ${match}
    </div>`;
  };

  const section = (title, items) => items.length
    ? `<div class="group-box"><div class="group-heading">${title} (${items.length})</div>${items.map(row).join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html data-theme="${startingTheme}">
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
    --text: #222;
    --text-secondary: #444;
    --text-muted: #666;
    --text-faint: #888;
    --border: #d0d3d9;
    --border-soft: #e2e4e8;
    --border-faint: #f0f1f3;
    --hover-bg: #fafbfc;
    --btn-bg: #1f2937;
    --link-accent: #0060df;
    --warn-color: #b45309;
  }
  :root[data-theme="dark"] {
    --bg: #15171c;
    --card-bg: #1e2128;
    --card-shadow: 0 1px 4px rgba(0,0,0,0.4);
    --text: #e8e9ec;
    --text-secondary: #c3c5ca;
    --text-muted: #9199a3;
    --text-faint: #7d848f;
    --border: #3a3f4b;
    --border-soft: #2f333c;
    --border-faint: #262932;
    --hover-bg: #262a33;
    --btn-bg: #374151;
    --link-accent: #6ea8fe;
    --warn-color: #f0a838;
  }
  /* Vertical padding uses vmin (not vw) so it also scales down on
     short landscape viewports, where vw alone would keep it large
     even though height is what's actually constrained there. */
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); margin: 0; padding: clamp(24px, 8vmin, 60px) clamp(14px, 5vw, 20px); color: var(--text); box-sizing: border-box; overflow-wrap: break-word; }
  .card { position: relative; max-width: 640px; margin: 0 auto; background: var(--card-bg); border-radius: 12px; box-shadow: var(--card-shadow); padding: clamp(20px, 6vmin, 40px); text-align: center; box-sizing: border-box; }
  h1 { font-size: clamp(22px, 6vw, 28px); margin: 0 0 16px; }
  p { font-size: 16px; color: var(--text-secondary); line-height: 1.7; margin: 0 0 28px; }
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
  .theme-toggle:hover { background: var(--hover-bg); border-color: var(--btn-bg); transform: scale(1.08); }
  .theme-toggle:active { transform: scale(0.95); }
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
  .search-input:focus { outline: none; border-color: var(--btn-bg); }
  .search-input:hover { border-color: var(--btn-bg); transform: scale(1.01); }
  .placeholder-text { padding: 20px; color: var(--text-muted); font-size: 14px; margin: 0; }
  .checklist-box {
    text-align: left;
    max-height: min(360px, 55vh);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 4px 0;
    margin-bottom: 20px;
  }
  .group-box {
    border: 1px solid var(--border-soft);
    border-radius: 8px;
    margin-bottom: 16px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .group-box:last-child { margin-bottom: 0; }
  .group-heading {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    padding: 10px 14px 4px;
  }
  .addon-row {
    padding: 10px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 8px;
    margin: 6px 8px;
    transition: background 0.12s, border-color 0.12s, transform 0.1s;
  }
  .addon-row:hover { background: var(--hover-bg); border-color: var(--btn-bg); transform: scale(1.01); }
  .addon-name { font-size: 14px; font-weight: 600; color: var(--link-accent); text-decoration: none; }
  .addon-name:hover { text-decoration: underline; }
  .addon-version { color: var(--text-faint); font-size: 12px; margin-left: 6px; }
  .match-label { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
  .match-uncertain { color: var(--warn-color); font-weight: 600; }
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
  <p><strong>Tip:</strong> on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/" target="_blank" rel="noopener">Add-ons Hub</a> installed, click its toolbar icon and choose <strong>Add-ons Importer</strong> to open every link below as a tab automatically.</p>

  <input type="search" id="searchInput" class="search-input" placeholder="Search add-ons...">

  <div class="checklist-box">
    <div id="addonList">
      ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
      ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}
    </div>
    <p id="noSearchMatches" class="placeholder-text" style="display:none;">No add-ons match your search.</p>
  </div>
  </div>

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
  <script>
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

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      themeToggleEl.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
      themeToggleEl.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }

    var themeToggleEl = document.getElementById('themeToggle');

    // Apply persisted theme on load (may differ from the baked-in default).
    applyTheme(loadPersistedTheme());

    themeToggleEl.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = isDark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });

    // NOTE: mirrors filterAddonRows() in common.js. Duplicated here
    // because this report is self-contained and can't load common.js
    // once saved elsewhere. Keep both copies in sync if you change this.
    // Both copies intentionally match against .addon-name only, not the
    // version number or match-type labels.
    function filterAddonRows(query) {
      var q = query.trim().toLowerCase();
      var heading = null;
      var headingHasMatch = false;
      var anyMatch = false;
      var finishHeading = function () {
        if (heading) heading.style.display = headingHasMatch ? '' : 'none';
      };
      var children = addonListEl.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el.classList.contains('group-heading')) {
          finishHeading();
          heading = el;
          headingHasMatch = false;
        } else if (el.classList.contains('addon-row')) {
          var nameEl = el.querySelector('.addon-name');
          var match = q === '' || (nameEl && nameEl.textContent.toLowerCase().indexOf(q) !== -1);
          el.style.display = match ? '' : 'none';
          if (match) { headingHasMatch = true; anyMatch = true; }
        }
      }
      finishHeading();
      return anyMatch;
    }

    document.getElementById('searchInput').addEventListener('input', function (e) {
      var anyMatch = filterAddonRows(e.target.value);
      noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
    });
  </script>
</body>
</html>`;
}
