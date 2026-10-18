// Settings page logic. theme.js has already applied the stored theme before
// this runs; this wires the controls to the stored values.

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatBoxes = document.querySelectorAll('input[name="exportFormat"]');
const shortenRadios = document.querySelectorAll('input[name="shortenNames"]');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const settingsFileInput = document.getElementById('settingsFileInput');
const settingsStatusEl = document.getElementById('settingsStatus');

// ActionRow: the Export / Import / Reset rows each have a description and an
// inline status. Activating a row swaps the description for the status;
// restore() brings it back.
//
// Row feedback uses element.animate() (the row's own CSS animations are left
// alone) and is skipped for reduced motion. A finished export/import/reset
// flashes the row green and slides the message in. A cancelled one (file
// dialog dismissed, save cancelled, Cancel in the reset dialog) flashes it
// grey and slides the description back in.
// A message goes away by itself after this long and the description returns.
// Touching anything clears it sooner (see the click handler at the bottom).
const STATUS_AUTO_HIDE_MS = 7000;

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

// After an import, flashes the selected option of each group in turn so you
// can see what the file set.
function flashSelectedOptions() {
  const rows = Array.from(document.querySelectorAll('label.settings-option-row'))
    .filter((row) => typeof row.querySelector === 'function' && row.querySelector('input:checked'));
  rows.forEach((row, i) => flashSuccess(row, 250 + i * 140));
}

function ActionRow(descId, statusId) {
  const descEl   = document.getElementById(descId);
  const statusEl = document.getElementById(statusId);
  let hideTimer = null;

  function cancelAutoHide() {
    if (hideTimer !== null && typeof clearTimeout === 'function') clearTimeout(hideTimer);
    hideTimer = null;
  }

  function show(msg, isError) {
    statusEl.textContent   = msg || '';
    statusEl.style.color   = isError ? 'var(--danger-color)' : 'var(--success-color, var(--text-muted))';
    statusEl.style.display = msg ? '' : 'none';
    if (statusEl.classList) statusEl.classList.toggle('is-success', !!msg && !isError);
    // an untouched message fades away and the description slides back in
    cancelAutoHide();
    if (msg && typeof setTimeout === 'function') {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        restore();
        slideBackIn(descEl);
      }, STATUS_AUTO_HIDE_MS);
    }
  }

  function restore() {
    cancelAutoHide();
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
      if (statusEl.classList) statusEl.classList.remove('is-success');
    }
    if (descEl)   descEl.style.display = '';
  }

  return {
    // empty msg just hides the description
    activate(msg, isError) {
      if (descEl)   descEl.style.display = 'none';
      if (statusEl) show(msg, isError);
    },
    // for after async work finishes
    setMsg(msg, isError) {
      if (!statusEl) return;
      show(msg, isError);
      if (msg && !isError && typeof statusEl.closest === 'function') {
        flashSuccess(statusEl.closest('.settings-option-row'));
      }
    },
    restore,
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

// These re-read all settings in one storage read and tick their own controls.
// They also update the localStorage cache so settings-init.js can set the
// right values before the first paint next time.
async function loadCurrentTheme() {
  const { theme } = await loadSettings();
  for (const radio of themeRadios) {
    radio.checked = radio.value === theme;
  }
  return theme;
}

async function loadCurrentExportFormat() {
  const { exportFormats } = await loadSettings();
  for (const box of formatBoxes) {
    box.checked = exportFormats.includes(box.value);
  }
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.exportFormat, exportFormats.join(',')); } catch (e) {}
}
for (const radio of themeRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    // apply at once, like the report's toggle, not after the save
    applyTheme(radio.value);
    try {
      await browser.storage.local.set({ [THEME_STORAGE_KEY]: radio.value });
    } catch (err) {
      setSettingsStatus('Could not save the theme: ' + err.message, true);
      // put the radio and the page back to what's stored
      applyTheme(await loadCurrentTheme());
    }
  });
}

// Any number of formats can be on, but never none: unticking the last one
// puts it back.
for (const box of formatBoxes) {
  box.addEventListener('change', async () => {
    const ticked = Array.from(formatBoxes).filter((b) => b.checked).map((b) => b.value);
    if (ticked.length === 0) {
      box.checked = true;
      return;
    }
    try {
      await browser.storage.local.set({ [EXPORT_FORMAT_STORAGE_KEY]: serializeExportFormats(ticked) });
      try { localStorage.setItem(SETTINGS_CACHE_KEYS.exportFormat, resolveExportFormats(ticked).join(',')); } catch (e) {}
    } catch (err) {
      setSettingsStatus('Could not save the export format: ' + err.message, true);
      await loadCurrentExportFormat();
    }
  });
}

async function loadCurrentShortenNames() {
  const { shortenNames } = await loadSettings();
  for (const radio of shortenRadios) {
    radio.checked = radio.value === shortenNames;
  }
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.shortenNames, shortenNames); } catch (e) {}
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

// The settings file records the same source as the exports. browser-info.js is
// in the background, so ask it; on failure the file gets the exporter's
// "Unknown".
async function getSettingsSource() {
  try {
    return await browser.runtime.sendMessage({ type: 'getExportSource' });
  } catch {
    return UNKNOWN_BROWSER;
  }
}

exportSettingsBtn.addEventListener('click', async () => {
  clearAllRows();
  exportRow.activate('');
  try {
    const stored = await browser.storage.local.get(KNOWN_SETTINGS_KEYS);
    const json = buildSettingsExport(withSettingsDefaults(stored), await getSettingsSource());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timestamp = formatFilenameTimestamp(new Date());
    const filename = `Add-ons Hub Settings (${timestamp}).json`;

    try {
      await browser.downloads.download({ url, filename, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS);
    }

    exportRow.setMsg('Settings exported.');
  } catch (err) {
    // dismissing the save dialog rejects with "canceled", which isn't a failure
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

// fires when the file dialog is dismissed without choosing
settingsFileInput.addEventListener('cancel', () => {
  importRow.cancelled();
});

settingsFileInput.addEventListener('change', async () => {
  const file = settingsFileInput.files[0];
  settingsFileInput.value = '';
  if (!file) {
    // for browsers that don't fire `cancel`
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
    await browser.storage.local.set(result.settings);
    applyTheme(result.settings[THEME_STORAGE_KEY]);
    await loadCurrentTheme();
    await loadCurrentExportFormat();
    await loadCurrentShortenNames();
    importRow.setMsg('Settings imported successfully.');
    flashSelectedOptions();
  } catch (err) {
    importRow.setMsg('Import failed: ' + err.message, true);
  }
});

// One storage read for all three, so they apply together and the hardcoded
// HTML defaults are visible for as short a time as possible.
(async () => {
  const { theme, exportFormats, shortenNames } = await loadSettings();
  for (const radio of themeRadios) {
    radio.checked = radio.value === theme;
  }
  applyTheme(theme);
  for (const box of formatBoxes) {
    box.checked = exportFormats.includes(box.value);
  }
  for (const radio of shortenRadios) {
    radio.checked = radio.value === shortenNames;
  }
  // cache for settings-init.js
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.exportFormat, exportFormats.join(',')); } catch (e) {}
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.shortenNames, shortenNames); } catch (e) {}
})();

const CURRENT_VERSION = browser.runtime.getManifest().version;

const versionLink = document.getElementById('versionLink');
if (versionLink) {
  versionLink.textContent = CURRENT_VERSION;
  versionLink.href = `https://github.com/elsherif7/addons-hub/releases/tag/v${CURRENT_VERSION}`;
}

// Set while the reset dialog is open, so reopening the page can dismiss it
// like Cancel but quietly (the reveal is replaying at that moment).
let dismissResetDialog = null;

document.getElementById('resetSettingsBtn').addEventListener('click', function () {
  const resetBtn = this;
  clearAllRows();
  resetRow.activate('');

  const overlay = document.createElement('div');
  overlay.className = 's-overlay';

  const dialog = document.createElement('div');
  dialog.className = 's-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'resetDialogTitle');
  dialog.setAttribute('aria-describedby', 'resetDialogMessage');

  const title = document.createElement('div');
  title.id = 'resetDialogTitle';
  title.className = 's-dialog-title';
  title.textContent = 'Settings';

  const message = document.createElement('p');
  message.id = 'resetDialogMessage';
  message.className = 's-dialog-message';
  message.textContent = 'Reset all settings to their defaults? This will clear your theme, export format, and display choices.';

  const buttonRow = document.createElement('div');
  buttonRow.className = 's-dialog-buttons';

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

  // so Tab can't leave the dialog
  const others = Array.from(document.body.children).filter((el) => el !== overlay);
  others.forEach((el) => { el.inert = true; });

  cancelBtn.focus();

  // The page behind is frozen while the dialog is open (no wheel, touch,
  // keyboard or scrollbar scrolling). Hiding the root's overflow covers all of
  // them; the padding replaces the vanished scrollbar so the page doesn't jump.
  // Both are restored on close. Scrolling from code still works.
  const root = document.documentElement;
  const savedOverflow = root.style.overflow;
  const savedPaddingRight = root.style.paddingRight;
  const scrollbarWidth = (typeof window !== 'undefined' && root.clientWidth)
    ? Math.max(0, window.innerWidth - root.clientWidth)
    : 0;
  root.style.overflow = 'hidden';
  if (scrollbarWidth > 0) root.style.paddingRight = scrollbarWidth + 'px';
  // wheel and touch drags that start over the backdrop
  overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  new Promise((resolve) => {
    let closed = false;
    // `silent`: dismissed by the page being reopened, not by the user, so the
    // Reset row doesn't flash "cancelled" under the replaying reveal
    function close(result, silent) {
      if (closed) return;
      closed = true;
      const finish = () => {
        root.style.overflow = savedOverflow;
        root.style.paddingRight = savedPaddingRight;
        others.forEach((el) => { el.inert = false; });
        overlay.remove();
        dismissResetDialog = null;
        // no scrolling back: after a reset the page was just taken to the top
        resetBtn.focus({ preventScroll: true });
      };
      // shrinks and fades out; removed at once without animation or with reduced motion
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
      resolve({ confirmed: result, silent: !!silent });
    }
    dismissResetDialog = (silent) => close(false, silent);
    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
  }).then(({ confirmed, silent }) => {
    if (!confirmed) {
      // dismissed by a reopen, the caller already reset every row
      if (silent) resetRow.restore();
      else resetRow.cancelled();
      return;
    }
    scrollPageToTop();
    return browser.storage.local.remove([THEME_STORAGE_KEY, EXPORT_FORMAT_STORAGE_KEY, SHORT_NAME_STORAGE_KEY])
      .then(() => {
        applyTheme('light');
        return loadCurrentTheme();
      })
      .then(() => loadCurrentExportFormat())
      .then(() => loadCurrentShortenNames())
      .then(() => {
        resetRow.setMsg('Settings reset to defaults.');
        // replay the reveal, now showing the defaults
        lastEntranceAt = Date.now();
        replayEntrance();
      })
      .catch((err) => { resetRow.setMsg('Could not reset settings: ' + err.message, true); });
  });
});

// Firefox reuses an open Settings tab (openOptionsPage just switches to it),
// so the page doesn't reload and its opening wouldn't play again. The popup's
// Settings button sends a message after opening it; this scrolls to the top,
// closes anything left open (the reset dialog, a row message) and replays the
// reveal, so it looks freshly opened. Switching back to the tab doesn't
// count: the reveal takes about two seconds and would hide the page and lose
// your scroll position. The time check stops a brand-new tab, already playing
// its own reveal, from restarting it.
let lastEntranceAt = Date.now();

function replayEntranceIfIdle() {
  const now = Date.now();
  if (now - lastEntranceAt < 2500) return;
  lastEntranceAt = now;
  replayEntrance();
}

if (browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'replaySettingsEntrance') {
      scrollPageToTop();
      if (dismissResetDialog) dismissResetDialog(true);
      clearAllRows();
      replayEntranceIfIdle();
    }
  });
}

// Keeps the options in step when settings change elsewhere (another Settings
// tab, an import, a reset). theme.js applies the theme itself. Ticking a
// radio from code doesn't fire its change event, so this can't loop back into
// saving.
onSettingsChanged((changed) => {
  if (changed.includes('theme')) loadCurrentTheme();
  if (changed.includes('exportFormats')) loadCurrentExportFormat();
  if (changed.includes('shortenNames')) loadCurrentShortenNames();
});

// Any interaction clears lingering status messages. The export/import
// handlers already clear them at the start; this covers everything else.
if (document.addEventListener) {
  document.addEventListener('click', (e) => {
    if (e.target === exportSettingsBtn || e.target === importSettingsBtn) return;
    if (e.target === document.getElementById('resetSettingsBtn')) return;
    const anyActive = exportRow.isActive() || importRow.isActive() || resetRow.isActive() ||
      settingsStatusEl.textContent !== '';
    if (anyActive) clearAllRows();
  });
}
