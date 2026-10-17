// Settings page logic. theme.js (loaded in <head>) already applied the
// stored theme before this runs, using its own THEME_STORAGE_KEY,
// resolveTheme(), and applyTheme() - this just wires the radio buttons
// up to reflect and change that same stored value.

// --- DOM wiring ---

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatBoxes = document.querySelectorAll('input[name="exportFormat"]');
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
//    message in (see .is-success in settings.css);
//  - a cancelled one (dismissed file dialog, cancelled save dialog, Cancel in
//    the reset dialog) flashes the row soft grey and slides its description
//    back in from the left.
// A message in the Export / Import / Reset rows stays for this long if nobody
// touches anything, then goes away by itself and the row's description comes
// back. (Touching anything clears it sooner - see the click handler below.)
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
    // A message that nobody touches goes away by itself: the description
    // comes back (sliding in, like after a cancel - but without the grey flash).
    cancelAutoHide();
    if (msg && typeof setTimeout === 'function') {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        restore();
        slideBackIn(descEl);
      }, STATUS_AUTO_HIDE_MS);
    }
  }

  // Restore description, clear status.
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

// Each of these re-reads ALL settings through the shared loader (one storage
// read) and ticks its own controls. They also keep the localStorage cache in
// step, so settings-init.js can apply the right values before the first paint
// on the next open.
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

// The export formats are tick boxes: any number can be on, but never none -
// unticking the last one just puts it back (there must be something to export).
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
      setSettingsStatus('Could not save export format: ' + err.message, true);
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

// The source the settings file records (which browser and extension version
// made it) - the same one the add-on exports carry. browser-info.js lives in
// the background, so ask it; if that call ever fails, the file falls back to
// the same "Unknown" the exporter uses.
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
      setTimeout(() => URL.revokeObjectURL(url), 30000);
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

// Load all three settings in a single storage read so they're all
// applied at once — one round-trip instead of three sequential ones,
// which reduces the window where the hardcoded HTML defaults are visible.
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
  // Write the confirmed values to the localStorage cache so settings-init.js
  // can pre-apply them synchronously before the first paint on the next open.
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.exportFormat, exportFormats.join(',')); } catch (e) {}
  try { localStorage.setItem(SETTINGS_CACHE_KEYS.shortenNames, shortenNames); } catch (e) {}
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
  // Layout, tint and blur all live in settings.css (.s-overlay): the dialog
  // fills the viewport and the page behind stays visible, just softened.

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

  // Makes the rest of the page unreachable by keyboard while the dialog
  // is open, so Tab can't escape it.
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

// Keep this page's options in step with the stored settings when they change
// from somewhere else: another Settings tab, a settings import, a reset. (The
// theme itself is applied by theme.js; this keeps the radio buttons honest.)
// Programmatically ticking a radio or box does not fire its change event, so this
// cannot loop back into saving.
onSettingsChanged((changed) => {
  if (changed.includes('theme')) loadCurrentTheme();
  if (changed.includes('exportFormats')) loadCurrentExportFormat();
  if (changed.includes('shortenNames')) loadCurrentShortenNames();
});

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
