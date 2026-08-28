browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'listAddons') {
    return listInstalledAddons();
  }
  if (message.type === 'export') {
    return doExport(message.ids).then(() => {
      // Opened from here, not the popup - the popup can close early once
      // the native Save dialog steals focus.
      browser.tabs.create({
        url: browser.runtime.getURL('confirmation.html')
      });
    });
  }
});

const AMO_FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // omit credentials so an AMO login cookie doesn't ride along on what's
    // meant to be an anonymous lookup.
    return await fetch(url, { signal: controller.signal, credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

// Tries an exact ID lookup first, then a name search. Returns
// { url, matchType } or null.
async function findAmoPage(id, name) {
  // 1. Exact lookup by addon ID/GUID
  try {
    const res = await fetchWithTimeout(
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { url: data.url, matchType: 'amo-exact' };
      console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) returned no url field`, data);
    } else if (res.status !== 404) {
      // 404 just means it's not on AMO, not worth a warning.
      console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Exporter] AMO exact lookup for "${name}" (${id}) threw:`, err);
  }

  // 2. Fuzzy search by name
  try {
    const res = await fetchWithTimeout(
      `https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&app=firefox`,
      AMO_FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0 && data.results[0].url) {
        return { url: data.results[0].url, matchType: 'amo-search' };
      }
      console.debug(`[Add-ons Exporter] AMO name search for "${name}" (${id}) returned no usable results`, data);
    } else {
      console.warn(`[Add-ons Exporter] AMO name search for "${name}" (${id}) failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Add-ons Exporter] AMO name search for "${name}" (${id}) threw:`, err);
  }

  return null;
}

function formatFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

// An add-on name (attacker-controlled) containing "</script>" would
// close this tag early when the report is opened directly. Escaping
// "</" as "<\/" stops that - JSON.parse reads it back the same either way.
function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function buildHtmlReport(list) {
  const linkTypeLabels = {
    'amo-exact': 'Exact match',
    'amo-search': 'Possible match',
    'homepage': 'Homepage',
    'amo-search-fallback': 'Search results',
  };
  const uncertainLinkTypes = new Set(['amo-search', 'amo-search-fallback']);

  let idx = 0;
  const row = (a) => {
    const i = idx++;
    const matchLabel = linkTypeLabels[a.linkType] || '';
    const matchClass = uncertainLinkTypes.has(a.linkType) ? ' match-uncertain' : '';
    return `<div class="addon-row">
      <input type="checkbox" id="rcb-${i}" checked>
      <div class="addon-row-body">
        <label for="rcb-${i}">
          <a class="addon-name" href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>
          <span class="addon-version">${escapeHtml(a.version)}</span>
          <span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>
        </label>
      </div>
    </div>`;
  };

  const section = (title, items) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map(row).join('')}`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>My Add-ons - Add-ons Exporter Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f5f7; margin: 0; padding: 60px 20px; color: #222; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 40px; text-align: center; }
  h1 { font-size: 28px; margin: 0 0 16px; }
  p { font-size: 16px; color: #444; line-height: 1.7; margin: 0 0 28px; }
  .cta-link { color: #0060df; font-weight: bold; text-decoration: underline; }
  .list-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  #selectionCount { font-size: 13px; color: #666; }
  .list-controls button {
    background: none;
    border: none;
    color: #1a73e8;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 4px 8px;
  }
  .list-controls button:hover { text-decoration: underline; }
  .search-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    margin-bottom: 10px;
    border: 1px solid #d0d3d9;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
  }
  .search-input:focus { outline: none; border-color: #1f2937; }
  .placeholder-text { padding: 20px; color: #666; font-size: 14px; margin: 0; }
  .checklist-box {
    text-align: left;
    border: 1px solid #e2e4e8;
    border-radius: 8px;
    padding: 4px 0;
    margin-bottom: 30px;
  }
  .group-heading {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #888;
    padding: 10px 14px 4px;
  }
  .addon-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid #f0f1f3;
  }
  .addon-row:last-child { border-bottom: none; }
  .addon-row input[type="checkbox"] { margin-top: 3px; }
  .addon-row-body { flex: 1; min-width: 0; }
  .addon-name { font-size: 14px; font-weight: 600; color: #0060df; text-decoration: none; }
  .addon-name:hover { text-decoration: underline; }
  .addon-version { color: #888; font-size: 12px; margin-left: 6px; }
  .match-label { font-size: 11px; color: #666; margin-left: 8px; }
  .match-uncertain { color: #b45309; font-weight: 600; }
  .primary-btn {
    width: 100%;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    background: #1f2937;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary-btn:hover:not(:disabled) { background: #111827; }
  .primary-btn:disabled { background: #9ca3af; cursor: not-allowed; }
  #status { display: block; text-align: center; font-size: 14px; color: #444; margin-top: 14px; min-height: 18px; }
</style>
</head>
<body>
  <div class="card">
  <h1>Add-ons Exporter</h1>
  <p><em>Tip: on another browser with <a class="cta-link" href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/" target="_blank" rel="noopener">Add-ons Exporter</a> installed, click its toolbar icon and choose "Import Add-ons" to open every link below as a tab automatically. Don't have it yet? Install it from the link above first.</em></p>

  <input type="search" id="searchInput" class="search-input" placeholder="Search add-ons...">

  <div class="list-controls">
    <span>
      <button id="selectAllBtn" type="button">Select all</button>
      <button id="deselectAllBtn" type="button">Deselect all</button>
    </span>
    <span id="selectionCount"></span>
  </div>

  <div class="checklist-box">
    <div id="addonList">
      ${section('Enabled', list.filter(a => a.enabled).sort(byName))}
      ${section('Disabled', list.filter(a => !a.enabled).sort(byName))}
    </div>
    <p id="noSearchMatches" class="placeholder-text" style="display:none;">No add-ons match your search.</p>
  </div>

  <button id="openSelectedBtn" class="primary-btn" type="button">Open Selected</button>
  <span id="status"></span>
  </div>

  <script type="application/json" id="addons-exporter-data">${safeJsonForScriptTag({ formatVersion: EXPORT_FORMAT_VERSION, addons: list })}</script>
  <script>
    // Self-contained - this file has no access to the extension's own
    // scripts or APIs once it's saved and opened on its own.
    var selectionCountEl = document.getElementById('selectionCount');

    function updateSelectionCount() {
      var boxes = document.querySelectorAll('.addon-row input[type="checkbox"]');
      var checked = document.querySelectorAll('.addon-row input[type="checkbox"]:checked').length;
      selectionCountEl.textContent = boxes.length ? (checked + ' of ' + boxes.length + ' selected') : '';
    }

    document.querySelectorAll('.addon-row input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', updateSelectionCount);
    });
    updateSelectionCount();

    // Select all/Deselect all only touch what the current search still
    // shows - same rule as the extension's own export/import pages.
    document.getElementById('selectAllBtn').addEventListener('click', function () {
      document.querySelectorAll('.addon-row').forEach(function (row) {
        if (row.style.display === 'none') return;
        var cb = row.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = true;
      });
      updateSelectionCount();
    });
    document.getElementById('deselectAllBtn').addEventListener('click', function () {
      document.querySelectorAll('.addon-row').forEach(function (row) {
        if (row.style.display === 'none') return;
        var cb = row.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      });
      updateSelectionCount();
    });

    var addonListEl = document.getElementById('addonList');
    var noSearchMatchesEl = document.getElementById('noSearchMatches');

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
          var label = el.querySelector('label');
          var match = q === '' || (label && label.textContent.toLowerCase().indexOf(q) !== -1);
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

    // The add-on name is a real link now - let it navigate. Only block
    // the label's default checkbox-toggle for clicks elsewhere in it
    // (the version text, the match label, empty space).
    addonListEl.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      if (e.target.closest('label')) e.preventDefault();
    });

    function isSafeUrl(link) {
      try {
        var u = new URL(link);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch (e) {
        return false;
      }
    }

    function delay(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    var openSelectedBtn = document.getElementById('openSelectedBtn');
    var statusEl = document.getElementById('status');

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    // Selection is read from every checkbox regardless of the current
    // search - same rule as the extension's own pages, so a checked box
    // that gets hidden by a search isn't silently dropped.
    openSelectedBtn.addEventListener('click', async function () {
      var links = [];
      document.querySelectorAll('.addon-row').forEach(function (row) {
        var cb = row.querySelector('input[type="checkbox"]');
        var a = row.querySelector('.addon-name');
        if (cb && cb.checked && a) links.push(a.href);
      });

      if (links.length === 0) {
        setStatus('Select at least one add-on to open');
        return;
      }

      openSelectedBtn.disabled = true;
      setStatus('Opening ' + links.length + ' tabs...');
      var opened = 0;
      var blocked = 0;
      var failed = 0;
      for (var i = 0; i < links.length; i++) {
        try {
          if (!isSafeUrl(links[i])) throw new Error('unsafe link');
          var w = window.open(links[i], '_blank', 'noopener');
          if (!w) {
            blocked++;
          } else {
            opened++;
          }
        } catch (e) {
          failed++;
        }
        if (i < links.length - 1) await delay(150);
      }
      var msg = 'Opened ' + opened + (opened === 1 ? ' tab' : ' tabs');
      if (blocked > 0) msg += ', ' + blocked + " blocked by your browser's popup blocker";
      if (failed > 0) msg += ', ' + failed + ' failed to open';
      if (blocked > 0) msg += '. Allow popups for this page, then try again.';
      setStatus(msg);
      openSelectedBtn.disabled = false;
    });
  </script>
</body>
</html>`;
}

// Caps how many AMO lookups run at once, so a big add-on collection
// doesn't trip AMO's rate limiting.
const AMO_LOOKUP_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Shared by listInstalledAddons() and doExport() so both always agree on
// which add-ons are eligible.
async function getExportableAddons() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch {
    throw new Error('Could not read your installed add-ons. Try reloading the extension, or check that it still has permission to manage add-ons.');
  }

  // Also excludes 'dictionary'/'locale' items - the report only has
  // Enabled/Disabled sections, so they'd be counted but never shown.
  return all.filter(a =>
    (a.type === 'extension' || a.type === 'theme') && !a.id.endsWith('@mozilla.org')
  );
}

async function listInstalledAddons() {
  const extensions = await getExportableAddons();
  return extensions.map(a => ({
    id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type
  }));
}

// Don't add a setInterval() keep-alive here. Firefox already resets the
// idle-suspend timer while export.js's sendMessage() call is pending
// (bug 1851373) - a manual timer was tried before and still got killed
// with the background page anyway.
async function doExport(ids) {
  let extensions = await getExportableAddons();

  if (Array.isArray(ids)) {
    const idSet = new Set(ids);
    extensions = extensions.filter(a => idSet.has(a.id));
  }

  if (extensions.length === 0) {
    throw new Error('No add-ons selected to export.');
  }

  const total = extensions.length;
  let done = 0;
  const reportProgress = () => {
    done++;
    browser.runtime.sendMessage({ type: 'exportProgress', done, total }).catch(() => {});
  };

  const list = await mapWithConcurrency(extensions, AMO_LOOKUP_CONCURRENCY, async (a) => {
    const amoMatch = await findAmoPage(a.id, a.name);
    let link;
    let linkType;
    if (amoMatch && isSafeUrl(amoMatch.url)) {
      link = amoMatch.url;
      linkType = amoMatch.matchType;
    } else if (a.homepageUrl && isSafeUrl(a.homepageUrl)) {
      link = a.homepageUrl;
      linkType = 'homepage';
    } else {
      link = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
      linkType = 'amo-search-fallback';
    }
    reportProgress();
    return { id: a.id, name: a.name, version: a.version, enabled: a.enabled, type: a.type, link, linkType };
  });

  const html = buildHtmlReport(list);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  // saveAs: true = always show the native "Save As" dialog, letting the
  // user pick the folder and filename themselves.
  await browser.downloads.download({
    url,
    filename: `Firefox-Addons (${formatFilenameTimestamp(new Date())}).html`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
