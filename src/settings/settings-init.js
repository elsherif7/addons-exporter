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
// The Export Format tick boxes and the Display radio group have no hardcoded `checked`
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
  var VALID_FORMATS   = ['html', 'json', 'csv', 'txt'];
  var VALID_SHORTEN   = ['on', 'off'];

  var fmt     = null;
  var shorten = null;

  try {
    fmt     = localStorage.getItem('addons-hub-settings-exportFormat');
    shorten = localStorage.getItem('addons-hub-settings-shortenNames');
  } catch (e) {
    // localStorage unavailable — fall through to apply defaults below.
  }

  // The cached export format is one format or several joined by commas
  // (e.g. 'html,json'). Keep only the known ones; none left means the default.
  var fmtList = [];
  if (typeof fmt === 'string') {
    fmtList = fmt.split(',').filter(function (f) { return VALID_FORMATS.indexOf(f) !== -1; });
  }
  if (fmtList.length === 0) fmtList = [DEFAULT_FORMAT];

  // Validate; fall back to defaults for missing or invalid cache values.
  if (VALID_SHORTEN.indexOf(shorten) === -1) shorten = DEFAULT_SHORTEN;

  var fmtHtml = document.getElementById('formatHtml');
  var fmtJson = document.getElementById('formatJson');
  var fmtCsv  = document.getElementById('formatCsv');
  var fmtTxt  = document.getElementById('formatTxt');
  if (fmtHtml) fmtHtml.checked = (fmtList.indexOf('html') !== -1);
  if (fmtJson) fmtJson.checked = (fmtList.indexOf('json') !== -1);
  if (fmtCsv)  fmtCsv.checked  = (fmtList.indexOf('csv') !== -1);
  if (fmtTxt)  fmtTxt.checked  = (fmtList.indexOf('txt') !== -1);

  var sOn  = document.getElementById('shortenNamesOn');
  var sOff = document.getElementById('shortenNamesOff');
  if (sOn)  sOn.checked  = (shorten === 'on');
  if (sOff) sOff.checked = (shorten === 'off');
})();
