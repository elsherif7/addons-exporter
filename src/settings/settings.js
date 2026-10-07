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

// --- DOM wiring ---

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatRadios = document.querySelectorAll('input[name="exportFormat"]');
const shortenRadios = document.querySelectorAll('input[name="shortenNames"]');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const settingsFileInput = document.getElementById('settingsFileInput');
const settingsStatusEl = document.getElementById('settingsStatus');

// ---------------------------------------------------------------------------
// ActionRow — shared system for the three action rows (Export / Import / Reset).
// Each row has a description <span> and an inline status <span>. Activating a
// row hides its description and shows a status message in its place. Calling
// restore() on any row (or clearAllRows()) brings the description back.
// ---------------------------------------------------------------------------
// Row feedback, all done with element.animate() so the row's own CSS
// animations are left alone, and all skipped for reduced motion:
//  - a finished export / import / reset flashes its row green and slides the
//    message in (see .is-success in settings.html);
//  - a cancelled one (dismissed file dialog, cancelled save dialog, Cancel in
//    the reset dialog) flashes the row soft grey and slides its description
//    back in from the left.
const SUCCESS_FLASH = 'rgba(46, 160, 67, 0.32)';
const CANCEL_FLASH = 'rgba(128, 128, 128, 0.3)';

function motionAllowed(el) {
  if (!el || typeof el.animate !== 'function') return false;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function flashRow(el, color, delayMs = 0) {
  if (!motionAllowed(el)) return;
  el.animate(
    [{ boxShadow: 'inset 0 0 0 999px ' + color }, { boxShadow: 'inset 0 0 0 999px transparent' }],
    { duration: 1000, delay: delayMs, easing: 'ease-out' }
  );
}

function flashSuccess(el, delayMs = 0) { flashRow(el, SUCCESS_FLASH, delayMs); }
function flashCancel(el) { flashRow(el, CANCEL_FLASH); }

function slideBackIn(el) {
  if (!motionAllowed(el)) return;
  el.animate(
    [{ opacity: 0, transform: 'translateX(-16px)' }, { opacity: 1, transform: 'none' }],
    { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  );
}

// After an import, flashes the selected option in each group (appearance,
// export format, display) one after another, top to bottom, so you can see
// what the imported file just set.
function flashSelectedOptions() {
  const rows = Array.from(document.querySelectorAll('label.settings-option-row'))
    .filter((row) => typeof row.querySelector === 'function' && row.querySelector('input:checked'));
  rows.forEach((row, i) => flashSuccess(row, 250 + i * 140));
}

function ActionRow(descId, statusId) {
  const descEl   = document.getElementById(descId);
  const statusEl = document.getElementById(statusId);

  function show(msg, isError) {
    statusEl.textContent   = msg || '';
    statusEl.style.color   = isError ? 'var(--danger-color)' : 'var(--success-color, var(--text-muted))';
    statusEl.style.display = msg ? '' : 'none';
    if (statusEl.classList) statusEl.classList.toggle('is-success', !!msg && !isError);
  }

  // Restore description, clear status.
  function restore() {
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
      if (statusEl.classList) statusEl.classList.remove('is-success');
    }
    if (descEl)   descEl.style.display = '';
  }

  return {
    // Hide description, show msg in its place (empty msg = just hide desc).
    activate(msg, isError) {
      if (descEl)   descEl.style.display = 'none';
      if (statusEl) show(msg, isError);
    },
    // Show msg, keeping description hidden (used after async work completes).
    setMsg(msg, isError) {
      if (!statusEl) return;
      show(msg, isError);
      if (msg && !isError && typeof statusEl.closest === 'function') {
        flashSuccess(statusEl.closest('.settings-option-row'));
      }
    },
    restore,
    // The user backed out: restore the description, with the cancel feedback.
    cancelled() {
      restore();
      if (descEl) {
        slideBackIn(descEl);
        if (typeof descEl.closest === 'function') flashCancel(descEl.closest('.settings-option-row'));
      }
    },
    isActive() {
      return statusEl && statusEl.style.display !== 'none';
    },
  };
}

const exportRow = ActionRow('exportSettingsDesc', 'exportSettingsStatus');
const importRow = ActionRow('importSettingsDesc', 'importSettingsStatus');
const resetRow  = ActionRow('resetSettingsDesc',  'resetSettingsStatus');

function clearAllRows() {
  exportRow.restore();
  importRow.restore();
  resetRow.restore();
  settingsStatusEl.textContent = '';
  settingsStatusEl.className   = '';
}

function setSettingsStatus(msg, isError = false) {
  settingsStatusEl.textContent = msg;
  settingsStatusEl.className   = isError ? 'error' : '';
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
  return current;
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
  // Keep the localStorage cache in sync so settings-init.js can apply
  // the correct value before the first paint on the next page open.
  try { localStorage.setItem('addons-hub-settings-exportFormat', current); } catch (e) {}
}
for (const radio of themeRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    // Switch the page at once, exactly like the report's toggle does - the
    // animation starts the moment you click, not after the save has finished.
    applyTheme(radio.value);
    try {
      await browser.storage.local.set({ [THEME_STORAGE_KEY]: radio.value });
    } catch (err) {
      setSettingsStatus('Could not save theme: ' + err.message, true);
      // The write failed - put the radio AND the page back to what's actually stored.
      applyTheme(await loadCurrentTheme());
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
  // Keep the localStorage cache in sync so settings-init.js can apply
  // the correct value before the first paint on the next page open.
  try { localStorage.setItem('addons-hub-settings-shortenNames', current); } catch (e) {}
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
  clearAllRows();
  exportRow.activate('');
  try {
    const stored = await browser.storage.local.get(KNOWN_SETTINGS_KEYS);
    const json = buildSettingsExport(withSettingsDefaults(stored));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const filename = `Add-ons Hub Settings (${timestamp}).json`;

    let platform;
    try {
      platform = await browser.runtime.getPlatformInfo();
    } catch {
      platform = { os: 'unknown' };
    }

    if (platform.os === 'android') {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      try {
        await new Promise((resolve) => {
          let settled = false;
          let fallbackTimer;
          const hintTimer = setTimeout(() => {
            setSettingsStatus('Saving. Tap \u201cDownload\u201d in the prompt if asked\u2026');
          }, 1500);
          const proceed = () => {
            if (settled) return;
            settled = true;
            clearTimeout(hintTimer);
            browser.downloads.onCreated.removeListener(onCreated);
            clearTimeout(fallbackTimer);
            resolve();
          };
          const onCreated = () => proceed();
          browser.downloads.onCreated.addListener(onCreated);
          fallbackTimer = setTimeout(proceed, 5000);
          link.click();
        });
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } else {
      try {
        await browser.downloads.download({ url, filename, saveAs: true });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    }

    exportRow.setMsg('Settings exported.');
  } catch (err) {
    // Dismissing the save dialog makes downloads.download reject with a
    // "canceled" error - that's the user backing out, not a failure.
    if (/cancel/i.test(err && err.message ? err.message : '')) {
      exportRow.cancelled();
      return;
    }
    exportRow.setMsg('Export failed: ' + err.message, true);
  }
});

importSettingsBtn.addEventListener('click', () => {
  clearAllRows();
  importRow.activate('');
  settingsFileInput.click();
});

// `cancel` fires when the user dismisses the file dialog without choosing
// a file — restore the Import row description in that case.
settingsFileInput.addEventListener('cancel', () => {
  importRow.cancelled();
});

settingsFileInput.addEventListener('change', async () => {
  const file = settingsFileInput.files[0];
  settingsFileInput.value = '';
  if (!file) {
    // Fallback for browsers that don't fire `cancel`.
    importRow.cancelled();
    return;
  }
  try {
    const text = await file.text();
    const result = parseSettingsFile(text);
    if (!result.ok) {
      importRow.setMsg(result.error, true);
      return;
    }
    if (Object.keys(result.settings).length === 0) {
      importRow.setMsg('No recognised settings found in that file.', true);
      return;
    }
    await browser.storage.local.set(result.settings);
    if (result.settings[THEME_STORAGE_KEY]) {
      applyTheme(result.settings[THEME_STORAGE_KEY]);
    }
    await loadCurrentTheme();
    await loadCurrentExportFormat();
    await loadCurrentShortenNames();
    importRow.setMsg('Settings imported successfully.');
    flashSelectedOptions();
  } catch (err) {
    importRow.setMsg('Import failed: ' + err.message, true);
  }
});

// Load all three settings in a single storage read so they're all
// applied at once — one round-trip instead of three sequential ones,
// which reduces the window where the hardcoded HTML defaults are visible.
(async () => {
  const { theme, exportFormat, shortenNames } = await getStoredSettings();
  for (const radio of themeRadios) {
    radio.checked = radio.value === theme;
  }
  applyTheme(theme);
  for (const radio of formatRadios) {
    radio.checked = radio.value === exportFormat;
  }
  for (const radio of shortenRadios) {
    radio.checked = radio.value === shortenNames;
  }
  // Write the confirmed values to the localStorage cache so settings-init.js
  // can pre-apply them synchronously before the first paint on the next open.
  try { localStorage.setItem('addons-hub-settings-exportFormat', exportFormat); } catch (e) {}
  try { localStorage.setItem('addons-hub-settings-shortenNames', shortenNames); } catch (e) {}
})();

// --- Check for updates ---

const CURRENT_VERSION = browser.runtime.getManifest().version;

// Update the version link in the About section to match the manifest version.
const versionLink = document.getElementById('versionLink');
if (versionLink) {
  versionLink.textContent = CURRENT_VERSION;
  versionLink.href = `https://github.com/elsherif7/addons-hub/releases/tag/v${CURRENT_VERSION}`;
}

// --- Reset Settings ---

document.getElementById('resetSettingsBtn').addEventListener('click', function () {
  const resetBtn = this;
  clearAllRows();
  resetRow.activate('');

  const overlay = document.createElement('div');
  overlay.className = 's-overlay';
  // Fills the whole viewport and centres the dialog in it, however far down
  // the page is scrolled. The tint and blur live in settings.html (.s-overlay)
  // so the page behind stays visible, just softened.
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;z-index:1000;';

  const dialog = document.createElement('div');
  dialog.className = 's-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'resetDialogTitle');
  dialog.style.cssText = 'background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:24px 28px;min-width:300px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.2);';

  const title = document.createElement('div');
  title.id = 'resetDialogTitle';
  title.style.cssText = 'font-size:18px;font-weight:700;color:var(--text);text-align:center;margin-bottom:16px;';
  title.textContent = 'Settings';

  const message = document.createElement('p');
  message.style.cssText = 'font-size:14px;color:var(--text-secondary);margin:0 0 18px;';
  message.textContent = 'Reset all settings to their defaults? This will clear your theme, export format, and display choices.';

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'rsCancel';
  cancelBtn.className = 's-modal-btn hub-btn';
  cancelBtn.textContent = 'Cancel';

  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'rsConfirm';
  confirmBtn.className = 's-modal-btn s-modal-btn-danger hub-btn';
  confirmBtn.textContent = 'Reset';

  buttonRow.append(cancelBtn, confirmBtn);
  dialog.append(title, message, buttonRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Makes the rest of the page unreachable by keyboard/assistive tech
  // while the dialog is open, so Tab can't escape it - simpler and more
  // robust than intercepting every Tab keypress by hand.
  const others = Array.from(document.body.children).filter((el) => el !== overlay);
  others.forEach((el) => { el.inert = true; });

  cancelBtn.focus();

  // The page behind stays visible (blurred) but is frozen while the dialog is
  // open: no scrolling by wheel, touch, keyboard or scrollbar. Hiding the
  // root's overflow covers all of those at once; the padding stands in for
  // the scrollbar that disappears, so the page doesn't jump sideways. Both
  // are put back exactly as they were when the dialog closes. (Scrolling by
  // code, like the scroll to the top after a reset, still works.)
  const root = document.documentElement;
  const savedOverflow = root.style.overflow;
  const savedPaddingRight = root.style.paddingRight;
  const scrollbarWidth = (typeof window !== 'undefined' && root.clientWidth)
    ? Math.max(0, window.innerWidth - root.clientWidth)
    : 0;
  root.style.overflow = 'hidden';
  if (scrollbarWidth > 0) root.style.paddingRight = scrollbarWidth + 'px';
  // Belt and braces for wheel and touch drags that start over the backdrop.
  overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  new Promise((resolve) => {
    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      const finish = () => {
        root.style.overflow = savedOverflow;
        root.style.paddingRight = savedPaddingRight;
        others.forEach((el) => { el.inert = false; });
        overlay.remove();
        // Return focus to what opened the dialog, without scrolling back to
        // it - after a reset the page has just been taken to the top.
        resetBtn.focus({ preventScroll: true });
      };
      // The dialog leaves the way it came in: it shrinks and fades while the
      // blurred backdrop clears. Skipped (removed at once) when animation is
      // unavailable or reduced motion is on.
      const reduced = typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced && typeof overlay.animate === 'function' && typeof dialog.animate === 'function') {
        dialog.animate(
          [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(0.94)' }],
          { duration: 220, easing: 'ease-in', fill: 'forwards' }
        );
        overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' })
          .finished.then(finish, finish);
      } else {
        finish();
      }
      resolve(result);
    }
    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
  }).then((confirmed) => {
    if (!confirmed) {
      resetRow.cancelled();
      return;
    }
    // Take the user back to the top right away while the dialog fades out.
    scrollSettingsToTop();
    return browser.storage.local.remove([THEME_STORAGE_KEY, EXPORT_FORMAT_STORAGE_KEY, SHORT_NAME_STORAGE_KEY])
      .then(() => {
        applyTheme('light');
        return loadCurrentTheme();
      })
      .then(() => loadCurrentExportFormat())
      .then(() => loadCurrentShortenNames())
      .then(() => {
        resetRow.setMsg('Settings reset to defaults.');
        // Play the whole opening reveal again from the top, now showing the
        // defaults, so the reset feels like the page being set up afresh.
        lastEntranceAt = Date.now();
        replayEntrance();
      })
      .catch((err) => { resetRow.setMsg('Could not reset settings: ' + err.message, true); });
  });
});

// Firefox reuses an already-open Settings tab (runtime.openOptionsPage just
// switches to it), so the page never reloads and its opening animation would
// not play again. The popup's Settings button sends a message after opening
// it, and this plays the whole reveal again and scrolls back to the top
// (smoothly, or instantly with reduced motion). Deliberately NOT triggered
// by merely switching back to the tab: the reveal takes about two seconds,
// and replaying it every time would hide the page and lose your scroll
// position. The time check keeps a brand-new tab, which is already playing
// its own reveal, from restarting it.
let lastEntranceAt = Date.now();

function scrollSettingsToTop() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  const reduced = typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, left: 0, behavior: reduced ? 'auto' : 'smooth' });
}

function replayEntranceIfIdle() {
  const now = Date.now();
  if (now - lastEntranceAt < 2500) return;
  lastEntranceAt = now;
  replayEntrance();
}

if (browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'replaySettingsEntrance') {
      scrollSettingsToTop();
      replayEntranceIfIdle();
    }
  });
}

// Clear the settings status message whenever the user interacts with
// anything on the page — radio change, button click, file input — so it
// doesn't linger after they've moved on to something else.
// The export/import handlers already call setSettingsStatus('') at the
// start of each action, so this is just a safety net for everything else.
if (document.addEventListener) {
  document.addEventListener('click', (e) => {
    if (e.target === exportSettingsBtn || e.target === importSettingsBtn) return;
    if (e.target === document.getElementById('resetSettingsBtn')) return;
    const anyActive = exportRow.isActive() || importRow.isActive() || resetRow.isActive() ||
      settingsStatusEl.textContent !== '';
    if (anyActive) clearAllRows();
  });
}
