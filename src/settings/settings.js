// Settings page logic. theme.js (loaded in <head>) already applied the
// stored theme before this runs, using its own THEME_STORAGE_KEY,
// resolveTheme(), and applyTheme() - this just wires the radio buttons
// up to reflect and change that same stored value.

// --- Pure functions (exported for testing via vm) ---

const SETTINGS_FILE_FORMAT_VERSION = 1;

// The settings keys this page knows about. Only these are written on
// import - unknown keys from future versions are silently ignored so a
// file from a newer version can still be imported safely.
const KNOWN_SETTINGS_KEYS = [THEME_STORAGE_KEY, EXPORT_FORMAT_STORAGE_KEY];

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

  return { ok: true, settings: validated };
}

// --- DOM wiring ---

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatRadios = document.querySelectorAll('input[name="exportFormat"]');
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
    await browser.storage.local.set({ [THEME_STORAGE_KEY]: radio.value });
    applyTheme(radio.value);
  });
}

for (const radio of formatRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    await browser.storage.local.set({ [EXPORT_FORMAT_STORAGE_KEY]: radio.value });
  });
}

exportSettingsBtn.addEventListener('click', async () => {
  setSettingsStatus('');
  try {
    const stored = await browser.storage.local.get(KNOWN_SETTINGS_KEYS);
    const json = buildSettingsExport(stored);
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
    setSettingsStatus('Settings imported successfully.');
  } catch (err) {
    setSettingsStatus('Import failed: ' + err.message, true);
  }
});

loadCurrentTheme();
loadCurrentExportFormat();

// --- Check for updates ---

const CURRENT_VERSION = '1.2.0';
const AMO_ADDON_ID = 'addons-exporter@local';

document.getElementById('checkUpdateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('checkUpdateBtn');
  const statusRow = document.getElementById('updateStatusRow');
  const statusMsg = document.getElementById('updateStatusMsg');

  btn.disabled = true;
  btn.textContent = 'Checking...';
  statusRow.style.display = 'none';

  try {
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(AMO_ADDON_ID)}/`,
      { credentials: 'omit' }
    );
    if (!res.ok) throw new Error(`AMO returned HTTP ${res.status}`);
    const data = await res.json();
    const latest = data.current_version && data.current_version.version;
    if (!latest) throw new Error('Could not read the latest version from AMO.');

    statusRow.style.display = '';
    if (latest === CURRENT_VERSION) {
      statusMsg.style.color = 'var(--text-muted)';
      statusMsg.textContent = `You're up to date (version ${CURRENT_VERSION})`;
    } else {
      statusMsg.style.color = 'var(--link-accent)';
      statusMsg.innerHTML = `Version ${latest} is available. <a href="https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/" target="_blank" rel="noopener" style="color:var(--link-accent);font-weight:600;">Update on Firefox Add-ons</a>`;
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
