// Settings page logic. theme.js (loaded in <head>) already applied the
// stored theme before this runs, using its own THEME_STORAGE_KEY,
// resolveTheme(), and applyTheme() - this just wires the radio buttons
// up to reflect and change that same stored value.

// --- Pure functions (exported for testing via vm) ---

const SETTINGS_FILE_FORMAT_VERSION = 1;

// The settings keys this page knows about. Only these are written on
// import - unknown keys from future versions are silently ignored so a
// file from a newer version can still be imported safely.
const KNOWN_SETTINGS_KEYS = [
  THEME_STORAGE_KEY,
  EXPORT_FORMAT_STORAGE_KEY,
  SHORT_NAME_STORAGE_KEY,
];

// Builds the settings export object from the current stored values.
// settings is a plain object: { theme: '...', exportFormat: '...' }.
function buildSettingsExport(settings) {
  const out = {};
  for (const key of KNOWN_SETTINGS_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return JSON.stringify({ formatVersion: SETTINGS_FILE_FORMAT_VERSION, settings: out }, null, 2);
}

// Validates and parses a settings file's text. Returns
// { ok: true, settings: {...} } or { ok: false, error: '...' }.
// Throws on malformed JSON - callers handle that in their own try/catch.
function parseSettingsFile(text) {
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Hub settings file.' };
  }
  if (typeof parsed.formatVersion !== 'number') {
    return { ok: false, error: 'This file is missing its format version and can\'t be imported.' };
  }
  if (parsed.formatVersion > SETTINGS_FILE_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Hub. Please update the extension and try again.' };
  }
  if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
    return { ok: false, error: 'This file doesn\'t contain valid settings.' };
  }

  // Only keep known, valid values — unknown keys from future versions
  // are dropped rather than stored, so stale or unrecognised values
  // can't silently corrupt the stored settings.
  const validated = {};
  const t = parsed.settings[THEME_STORAGE_KEY];
  if (t === 'light' || t === 'dark') validated[THEME_STORAGE_KEY] = t;

  const f = parsed.settings[EXPORT_FORMAT_STORAGE_KEY];
  if (f === 'html' || f === 'json' || f === 'csv') validated[EXPORT_FORMAT_STORAGE_KEY] = f;

  const s = parsed.settings[SHORT_NAME_STORAGE_KEY];
  if (s === 'on' || s === 'off') validated[SHORT_NAME_STORAGE_KEY] = s;

  return { ok: true, settings: validated };
}

// Compares two dot-separated version strings numerically, segment by
// segment - so "1.10" is correctly newer than "1.9", unlike a plain
// string/lexicographic comparison (or the strict equality check this
// replaced, which called anything not byte-identical to the current
// version "available", even a local build that's actually newer than
// what's on AMO). A missing trailing segment counts as 0, so "1.2"
// equals "1.2.0". Returns -1 if a < b, 1 if a > b, 0 if equal.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

// --- DOM wiring ---

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatRadios = document.querySelectorAll('input[name="exportFormat"]');
const shortenRadios = document.querySelectorAll('input[name="shortenNames"]');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const settingsFileInput = document.getElementById('settingsFileInput');
const settingsStatusEl = document.getElementById('settingsStatus');

function setSettingsStatus(msg, isError = false) {
  settingsStatusEl.textContent = msg;
  settingsStatusEl.className = isError ? 'error' : '';
}

async function loadCurrentTheme() {
  let stored;
  try {
    stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  } catch {
    stored = {};
  }
  const current = resolveTheme(stored);
  for (const radio of themeRadios) {
    radio.checked = radio.value === current;
  }
}

async function loadCurrentExportFormat() {
  let stored;
  try {
    stored = await browser.storage.local.get(EXPORT_FORMAT_STORAGE_KEY);
  } catch {
    stored = {};
  }
  const current = (stored && (stored[EXPORT_FORMAT_STORAGE_KEY] === 'html' ||
                               stored[EXPORT_FORMAT_STORAGE_KEY] === 'json' ||
                               stored[EXPORT_FORMAT_STORAGE_KEY] === 'csv'))
    ? stored[EXPORT_FORMAT_STORAGE_KEY]
    : EXPORT_FORMAT_DEFAULT;
  for (const radio of formatRadios) {
    radio.checked = radio.value === current;
  }
}

for (const radio of themeRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    try {
      await browser.storage.local.set({ [THEME_STORAGE_KEY]: radio.value });
      applyTheme(radio.value);
    } catch (err) {
      setSettingsStatus('Could not save theme: ' + err.message, true);
      await loadCurrentTheme(); // the write failed - revert the radio to what's actually stored
    }
  });
}

for (const radio of formatRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    try {
      await browser.storage.local.set({ [EXPORT_FORMAT_STORAGE_KEY]: radio.value });
    } catch (err) {
      setSettingsStatus('Could not save export format: ' + err.message, true);
      await loadCurrentExportFormat();
    }
  });
}

async function loadCurrentShortenNames() {
  let stored;
  try {
    stored = await browser.storage.local.get(SHORT_NAME_STORAGE_KEY);
  } catch {
    stored = {};
  }
  const current = (stored && (stored[SHORT_NAME_STORAGE_KEY] === 'on' ||
                               stored[SHORT_NAME_STORAGE_KEY] === 'off'))
    ? stored[SHORT_NAME_STORAGE_KEY]
    : SHORT_NAME_DEFAULT;
  for (const radio of shortenRadios) {
    radio.checked = radio.value === current;
  }
}

for (const radio of shortenRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    try {
      await browser.storage.local.set({ [SHORT_NAME_STORAGE_KEY]: radio.value });
    } catch (err) {
      setSettingsStatus('Could not save the display setting: ' + err.message, true);
      await loadCurrentShortenNames();
    }
  });
}

// Fills in the default value for any of the three known settings that
// aren't in `stored` yet - a pristine profile has never written any of
// them, so exporting straight from storage.local.get() produced an empty
// {} settings object that couldn't be re-imported (nothing in it passed
// parseSettingsFile's "no recognised settings" check). Only used by the
// Export handler below - buildSettingsExport() itself is unchanged, and
// still only writes whatever it's actually given.
function withSettingsDefaults(stored) {
  const fmt = stored && stored[EXPORT_FORMAT_STORAGE_KEY];
  const shorten = stored && stored[SHORT_NAME_STORAGE_KEY];
  return {
    [THEME_STORAGE_KEY]: resolveTheme(stored),
    [EXPORT_FORMAT_STORAGE_KEY]: (fmt === 'html' || fmt === 'json' || fmt === 'csv') ? fmt : EXPORT_FORMAT_DEFAULT,
    [SHORT_NAME_STORAGE_KEY]: (shorten === 'on' || shorten === 'off') ? shorten : SHORT_NAME_DEFAULT,
  };
}

exportSettingsBtn.addEventListener('click', async () => {
  setSettingsStatus('');
  try {
    const stored = await browser.storage.local.get(KNOWN_SETTINGS_KEYS);
    const json = buildSettingsExport(withSettingsDefaults(stored));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const filename = `Add-ons Hub Settings (${timestamp}).json`;
    try {
      await browser.downloads.download({ url, filename, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    setSettingsStatus('Settings exported.');
  } catch (err) {
    setSettingsStatus('Export failed: ' + err.message, true);
  }
});

importSettingsBtn.addEventListener('click', () => {
  setSettingsStatus('');
  settingsFileInput.click();
});

settingsFileInput.addEventListener('change', async () => {
  const file = settingsFileInput.files[0];
  settingsFileInput.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const result = parseSettingsFile(text);
    if (!result.ok) {
      setSettingsStatus(result.error, true);
      return;
    }
    if (Object.keys(result.settings).length === 0) {
      setSettingsStatus('No recognised settings found in that file.', true);
      return;
    }
    await browser.storage.local.set(result.settings);
    // Re-apply theme immediately if it was in the file.
    if (result.settings[THEME_STORAGE_KEY]) {
      applyTheme(result.settings[THEME_STORAGE_KEY]);
    }
    // Refresh all radio buttons to reflect the newly applied values.
    await loadCurrentTheme();
    await loadCurrentExportFormat();
    await loadCurrentShortenNames();
    setSettingsStatus('Settings imported successfully.');
  } catch (err) {
    setSettingsStatus('Import failed: ' + err.message, true);
  }
});

loadCurrentTheme();
loadCurrentExportFormat();
loadCurrentShortenNames();

// --- Check for updates ---

const CURRENT_VERSION = browser.runtime.getManifest().version;

// Update the version link in the About section to match the manifest version.
const versionLink = document.getElementById('versionLink');
if (versionLink) {
  versionLink.textContent = CURRENT_VERSION;
  versionLink.href = `https://github.com/elsherif7/addons-hub/releases/tag/v${CURRENT_VERSION}`;
}
const AMO_ADDON_ID = 'addons-exporter@local';
// Covers the whole request, body read included - fetchJsonWithTimeout()
// (common.js) is what actually enforces this, unlike the plain fetch()
// this replaced, which had nothing that could ever time it out.
const UPDATE_CHECK_TIMEOUT_MS = 15000;

document.getElementById('checkUpdateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('checkUpdateBtn');
  const statusRow = document.getElementById('updateStatusRow');
  const statusMsg = document.getElementById('updateStatusMsg');

  btn.disabled = true;
  btn.textContent = 'Checking...';
  statusRow.style.display = 'none';

  try {
    const result = await fetchJsonWithTimeout(
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(AMO_ADDON_ID)}/`,
      UPDATE_CHECK_TIMEOUT_MS
    );
    // A 404 here specifically means our own listed add-on ID wasn't
    // found - unlike background.js's AMO lookups (which have a fallback
    // link for that), that's a real problem for this one direct check.
    if (!result.ok || result.status === 404) {
      throw new Error(result.error || `AMO returned HTTP ${result.status}`);
    }
    const latest = result.data && result.data.current_version && result.data.current_version.version;
    if (!latest) throw new Error('Could not read the latest version from AMO.');

    statusRow.style.display = '';
    if (compareVersions(CURRENT_VERSION, latest) >= 0) {
      // Equal or newer (a dev build ahead of the published version)
      // both count as "up to date" - only a genuinely newer AMO version
      // should ever say otherwise.
      statusMsg.style.color = 'var(--text-muted)';
      statusMsg.textContent = `You're up to date (version ${CURRENT_VERSION})`;
    } else {
      statusMsg.style.color = 'var(--link-accent)';
      // Built with textContent/createElement, not innerHTML - `latest`
      // comes straight from AMO's API response and must never be
      // treated as markup.
      statusMsg.textContent = `Version ${latest} is available. `;
      const link = document.createElement('a');
      link.href = 'https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/';
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.color = 'var(--link-accent)';
      link.style.fontWeight = '600';
      link.textContent = 'Update on Firefox Add-ons';
      statusMsg.appendChild(link);
    }
  } catch (err) {
    statusRow.style.display = '';
    statusMsg.style.color = 'var(--danger-color)';
    statusMsg.textContent = 'Could not check for updates: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check now';
  }
});

// --- Reset Settings ---

document.getElementById('resetSettingsBtn').addEventListener('click', function() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
  overlay.innerHTML = `
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:24px 28px;min-width:300px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="font-size:18px;font-weight:700;color:var(--text);text-align:center;margin-bottom:16px;">Settings</div>
      <p style="font-size:14px;color:var(--text-secondary);margin:0 0 18px;">Reset all settings to their defaults? This will clear your theme and export format choices.</p>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="rsCancel" class="s-modal-btn">Cancel</button>
        <button id="rsConfirm" class="s-modal-btn s-modal-btn-danger">Reset</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  new Promise((resolve) => {
    overlay.querySelector('#rsCancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('#rsConfirm').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  }).then((confirmed) => {
    if (!confirmed) return;
    return browser.storage.local.remove([THEME_STORAGE_KEY, EXPORT_FORMAT_STORAGE_KEY, SHORT_NAME_STORAGE_KEY])
      .then(() => {
        applyTheme('light');
        return loadCurrentTheme();
      })
      .then(() => loadCurrentExportFormat())
      .then(() => loadCurrentShortenNames())
      .then(() => { setSettingsStatus('Settings reset to defaults.'); })
      .catch((err) => { setSettingsStatus('Could not reset settings: ' + err.message, true); });
  });
});
