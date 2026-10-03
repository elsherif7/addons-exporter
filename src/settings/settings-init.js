// Pre-applies saved radio states from the localStorage cache before the
// browser paints the Settings page for the first time.
//
// PLACEMENT: This script is loaded via a parser-blocking <script src> tag
// placed immediately after the three radio groups in settings.html. At that
// parse position, all radio inputs exist in the DOM but the browser has not
// yet painted — a parser-blocking external script halts parsing, runs
// synchronously, then resumes. The browser can only paint after the parser
// yields the call stack, so correcting .checked here is guaranteed to happen
// before the first visible frame.
//
// The Export Format and Display radio groups have no hardcoded `checked`
// attribute in the HTML — this script sets the correct one synchronously
// before any paint, so the user never sees an unselected or wrong state.
// On a fresh install (no cache yet), the defaults (html / on) are applied
// here so the page still shows a selection immediately.
//
// Theme is excluded because theme.js already handles it with its own
// localStorage cache key (addons-hub-theme-cache).
//
// Cache keys must match what settings.js writes after its authoritative
// browser.storage.local read (see the batched init IIFE in settings.js).
//
// Wrapped in try/catch so any localStorage error degrades silently — the
// defaults are still applied from the explicit fallback paths below.

(function () {
  var DEFAULT_FORMAT  = 'html';
  var DEFAULT_SHORTEN = 'on';
  var VALID_FORMATS   = ['html', 'json', 'csv'];
  var VALID_SHORTEN   = ['on', 'off'];

  var fmt     = null;
  var shorten = null;

  try {
    fmt     = localStorage.getItem('addons-hub-settings-exportFormat');
    shorten = localStorage.getItem('addons-hub-settings-shortenNames');
  } catch (e) {
    // localStorage unavailable — fall through to apply defaults below.
  }

  // Validate; fall back to defaults for missing or invalid cache values.
  if (VALID_FORMATS.indexOf(fmt) === -1)   fmt     = DEFAULT_FORMAT;
  if (VALID_SHORTEN.indexOf(shorten) === -1) shorten = DEFAULT_SHORTEN;

  var fmtHtml = document.getElementById('formatHtml');
  var fmtJson = document.getElementById('formatJson');
  var fmtCsv  = document.getElementById('formatCsv');
  if (fmtHtml) fmtHtml.checked = (fmt === 'html');
  if (fmtJson) fmtJson.checked = (fmt === 'json');
  if (fmtCsv)  fmtCsv.checked  = (fmt === 'csv');

  var sOn  = document.getElementById('shortenNamesOn');
  var sOff = document.getElementById('shortenNamesOff');
  if (sOn)  sOn.checked  = (shorten === 'on');
  if (sOff) sOff.checked = (shorten === 'off');
})();
