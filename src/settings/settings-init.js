// Sets the saved radios and tick boxes from the localStorage cache before the
// first paint of the Settings page.
//
// It's a parser-blocking <script src> placed right after the option groups in
// settings.html. At that point the inputs exist but nothing has been painted,
// and the parser waits for the script, so setting .checked here happens
// before the first frame. The Export Format boxes and the Display radios have
// no hardcoded `checked` in the HTML; with no cache yet (fresh install) the
// defaults are applied here.
//
// Theme is left to theme.js (its own cache key). The cache keys are in core.js
// (SETTINGS_CACHE_KEYS), shared with settings.js. A localStorage error just
// falls back to the defaults.

(function () {
  var DEFAULT_FORMAT  = EXPORT_FORMAT_DEFAULT;
  var DEFAULT_SHORTEN = SHORT_NAME_DEFAULT;
  // from the registry in core.js, so a new format needs no change here
  var VALID_FORMATS   = EXPORT_FORMATS;

  var fmt     = null;
  var shorten = null;

  try {
    fmt     = localStorage.getItem(SETTINGS_CACHE_KEYS.exportFormat);
    shorten = localStorage.getItem(SETTINGS_CACHE_KEYS.shortenNames);
  } catch (e) {
    // no localStorage: defaults below
  }

  // cached as one format or several joined by commas ('html,json'); unknown
  // ones are dropped, none left means the default
  var fmtList = [];
  if (typeof fmt === 'string') {
    fmtList = fmt.split(',').filter(function (f) { return VALID_FORMATS.indexOf(f) !== -1; });
  }
  if (fmtList.length === 0) fmtList = [DEFAULT_FORMAT];

  if (!isValidShortenNames(shorten)) shorten = DEFAULT_SHORTEN;

  // one tick box per registry format, id "format" + capitalised id
  // (html -> formatHtml); settings.html must match, a test checks it
  VALID_FORMATS.forEach(function (id) {
    var box = document.getElementById('format' + id.charAt(0).toUpperCase() + id.slice(1));
    if (box) box.checked = (fmtList.indexOf(id) !== -1);
  });

  var sOn  = document.getElementById('shortenNamesOn');
  var sOff = document.getElementById('shortenNamesOff');
  if (sOn)  sOn.checked  = (shorten === 'on');
  if (sOff) sOff.checked = (shorten === 'off');
})();
