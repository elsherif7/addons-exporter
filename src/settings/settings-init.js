// Pre-applies the saved option states (radios and tick boxes) from the localStorage cache before the
// browser paints the Settings page for the first time.
//
// PLACEMENT: This script is loaded via a parser-blocking <script src> tag
// placed immediately after the three option groups in settings.html. At that
// parse position, all the inputs exist in the DOM but the browser has not
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
// The cache keys themselves live in core.js (SETTINGS_CACHE_KEYS), shared
// with settings.js, so the two can never drift apart.
//
// Wrapped in try/catch so any localStorage error degrades silently — the
// defaults are still applied from the explicit fallback paths below.

(function () {
  var DEFAULT_FORMAT  = EXPORT_FORMAT_DEFAULT;
  var DEFAULT_SHORTEN = SHORT_NAME_DEFAULT;
  // The format list comes from the registry in core.js (loaded before this
  // script), so a new format needs no change here.
  var VALID_FORMATS   = EXPORT_FORMATS;

  var fmt     = null;
  var shorten = null;

  try {
    fmt     = localStorage.getItem(SETTINGS_CACHE_KEYS.exportFormat);
    shorten = localStorage.getItem(SETTINGS_CACHE_KEYS.shortenNames);
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
  if (!isValidShortenNames(shorten)) shorten = DEFAULT_SHORTEN;

  // One tick box per registry format, id "format" + the id with a capital
  // first letter (html -> formatHtml). settings.html has to match the
  // registry; a test checks it.
  VALID_FORMATS.forEach(function (id) {
    var box = document.getElementById('format' + id.charAt(0).toUpperCase() + id.slice(1));
    if (box) box.checked = (fmtList.indexOf(id) !== -1);
  });

  var sOn  = document.getElementById('shortenNamesOn');
  var sOff = document.getElementById('shortenNamesOff');
  if (sOn)  sOn.checked  = (shorten === 'on');
  if (sOff) sOff.checked = (shorten === 'off');
})();
