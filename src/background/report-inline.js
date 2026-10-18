// @inline-script-start
// Everything here runs inside the saved report on its own, with no access to
// the extension's scripts or APIs.
var addonListEl = document.getElementById('addonList');
var noSearchMatchesEl = document.getElementById('noSearchMatches');

var THEME_KEY = 'addons-hub-report-theme';
var BAKED_THEME = '__BAKED_THEME__';

// Falls back to the theme baked in at export time.
function loadPersistedTheme() {
  try {
    var stored = localStorage.getItem(THEME_KEY);
    return stored === 'dark' || stored === 'light' ? stored : BAKED_THEME;
  } catch (e) {
    return BAKED_THEME;
  }
}

// Colours only animate for changes after load, never on the first paint.
var themeSwitchTimer = null;
var themeReady = false;

// Mirrors applyTheme() in theme.js. The toggle's icon follows data-theme in
// the CSS, so nothing touches it here.
function applyTheme(theme) {
  var root = document.documentElement;
  var changing = themeReady && root.getAttribute('data-theme') !== theme;
  var reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function update() {
    root.setAttribute('data-theme', theme);
  }
  if (changing && !reduced && document.startViewTransition) {
    document.startViewTransition(update);
  } else {
    if (changing && !reduced) {
      root.classList.add('theme-switching');
      clearTimeout(themeSwitchTimer);
      themeSwitchTimer = setTimeout(function () { root.classList.remove('theme-switching'); }, 800);
    }
    update();
  }
}

var themeToggleEl = document.getElementById('themeToggle');

// the saved choice can differ from the baked-in one
applyTheme(loadPersistedTheme());
themeReady = true;

themeToggleEl.addEventListener('click', function () {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var next = isDark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
});

// Copy of setFilterVisible() and filterAddonRows() in page-ui.js, because a
// saved report can't load that file. Keep them in sync.
function setFilterVisible(el, visible) {
  el.style.display = visible ? '' : 'none';
  if (el.classList) el.classList.toggle('is-filtered', !visible);
}

function filterAddonRows(query) {
  var q = query.trim().toLowerCase();
  var anyMatch = false;
  var groupContainers = addonListEl.querySelectorAll('.group-container');
  for (var i = 0; i < groupContainers.length; i++) {
    var el = groupContainers[i];
    var box = el.querySelector('.group-box');
    var groupHasMatch = false;
    if (box) {
      var rows = box.children;
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].classList.contains('addon-row')) {
          var nameEl = rows[j].querySelector('.addon-name');
          var match = q === '' || (nameEl && nameEl.textContent.toLowerCase().indexOf(q) !== -1);
          setFilterVisible(rows[j], !!match);
          if (match) { groupHasMatch = true; anyMatch = true; }
        }
      }
    }
    setFilterVisible(el, groupHasMatch);
  }
  return anyMatch;
}

document.getElementById('searchInput').addEventListener('input', function (e) {
  var anyMatch = filterAddonRows(e.target.value);
  setFilterVisible(addonListEl, anyMatch);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

// Opening reveal - mirrors src/common/reveal.js (same one the Settings page
// uses): sets --d on the intro, search box and list box (0.16s apart) and
// --rd on the rows (0.08s apart), then takes "revealing" off the list so
// searching doesn't replay it. Skipped for reduced motion.
(function () {
  if (typeof document.querySelector !== 'function' || typeof getComputedStyle !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var card = document.querySelector('.card');
  if (!card || !card.children) return;
  var START = 0.82, PART_STEP = 0.16, ROW_LEAD = 0.08, ROW_STEP = 0.08, ROW_ANIMATED_MAX = 14, ROW_DURATION = 0.55;
  function round(n) { return Math.round(n * 1000) / 1000; }
  var t = START;
  // the list box is the third part; the loop below overrides this when it finds it
  var listBase = START + 2 * PART_STEP + ROW_LEAD;
  Array.prototype.forEach.call(card.children, function (child) {
    if (child.id === 'themeToggle' || child.tagName === 'H1') return;
    if (getComputedStyle(child).display === 'none') return;
    child.style.setProperty('--d', round(t) + 's');
    if (child.classList.contains('checklist-box')) listBase = t + ROW_LEAD;
    t += PART_STEP;
  });
  var list = document.getElementById('addonList');
  if (list) {
    var items = list.querySelectorAll('.group-heading, .addon-row');
    Array.prototype.forEach.call(items, function (item, k) {
      item.style.setProperty('--rd', round(listBase + Math.min(k, ROW_ANIMATED_MAX) * ROW_STEP) + 's');
    });
    var done = listBase + Math.min(items.length, ROW_ANIMATED_MAX) * ROW_STEP + ROW_DURATION + 0.3;
    setTimeout(function () { list.classList.remove('revealing'); }, Math.ceil(done * 1000));
  }
})();

// Press feedback: a ring (a tinted flash for rows) bursts out of whatever is
// pressed. Mirrors src/common/press.js. Uses element.animate() so the page's
// own CSS animations don't restart.
(function () {
  var ROW = '.addon-row';
  var TARGET = '.theme-toggle, a[href]';
  function ringColor() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--press-ring').trim();
      return v || 'rgba(0, 96, 223, 0.4)';
    } catch (e) { return 'rgba(0, 96, 223, 0.4)'; }
  }
  function pulse(el) {
    if (!el || typeof el.animate !== 'function') return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = ringColor();
    el.animate(
      el.matches(ROW)
        ? [{ boxShadow: 'inset 0 0 0 999px ' + c }, { boxShadow: 'inset 0 0 0 999px transparent' }]
        : [{ boxShadow: '0 0 0 2px ' + c }, { boxShadow: '0 0 0 10px transparent' }],
      { duration: 520, easing: 'ease-out' }
    );
  }
  function findTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    // a click on a link pulses the link, not the whole row
    var link = node.closest('a[href]');
    if (link) return link;
    return node.closest(ROW) || node.closest(TARGET);
  }
  if (document.addEventListener) {
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pulse(findTarget(e.target));
    }, true);
    document.addEventListener('click', function (e) {
      if (e.detail === 0) pulse(findTarget(e.target));
    }, true);
  }
})();
