// Which browser is running this extension, for the browser part of the
// "source" every export file records (see SOURCE_KEYS in core.js). Plain
// classic script like the rest of the background:
// detectBrowserFromUserAgent() and getExportSource() are globals.
//
// Firefox (and the forks built on it) can say what they are through
// browser.runtime.getBrowserInfo(), which gives the name the browser reports for
// itself ("Firefox", "Waterfox", "Floorp", ...) and its real version. A fork that
// reports itself as "Firefox" is recorded as Firefox - there is nothing more to
// go on. A browser without that call (Chrome and the other Chromium browsers,
// Ladybird, ...) is recognised from its user-agent text instead, which is why a
// Chromium browser that hides itself (Brave, for example) shows as Chrome.

// Ordered: the first token found wins, so the more specific names come before
// the engine names they also contain (Edge's user agent also says "Chrome").
const BROWSER_USER_AGENT_TOKENS = [
  ['Edg', 'Edge'],
  ['Edge', 'Edge'],
  ['OPR', 'Opera'],
  ['Vivaldi', 'Vivaldi'],
  ['LibreWolf', 'LibreWolf'],
  ['Waterfox', 'Waterfox'],
  ['Floorp', 'Floorp'],
  ['Ladybird', 'Ladybird'],
  ['Firefox', 'Firefox'],
  ['Chrome', 'Chrome'],
  ['Safari', 'Safari'],
];

// What each known browser is built on (its "base"). A browser not listed here
// is recorded as built on itself, except that Firefox's own call (below) always
// means a Gecko-based browser. Firefox and the forks built on it all use the
// engine's name, Gecko, so they read the same as each other.
const BROWSER_BASES = {
  Edge: 'Chromium', Opera: 'Chromium', Vivaldi: 'Chromium', Chrome: 'Chromium', Brave: 'Chromium',
  LibreWolf: 'Gecko', Waterfox: 'Gecko', Floorp: 'Gecko', Firefox: 'Gecko',
  Safari: 'WebKit', Ladybird: 'Ladybird',
};
function browserBase(name) {
  return Object.prototype.hasOwnProperty.call(BROWSER_BASES, name) ? BROWSER_BASES[name] : name;
}

// { name, version } for a user-agent string, or null when it names no known browser.
function detectBrowserFromUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  for (const [token, name] of BROWSER_USER_AGENT_TOKENS) {
    const m = ua.match(new RegExp(`(?:^|[ (/])${token}/([0-9][0-9A-Za-z.]*)`));
    if (!m) continue;
    // Safari's own number is after "Version/"; the one after "Safari/" is WebKit's.
    const own = name === 'Safari' ? ua.match(/Version\/([0-9][0-9A-Za-z.]*)/) : null;
    return { name, version: own ? own[1] : m[1] };
  }
  return null;
}

// The browser part of the source to write into an export: always four clean
// values, "Unknown" / "unknown" for anything that cannot be found. Never
// throws. (The format version and file type are added by makeSource().)
async function getExportSource() {
  let name = '';
  let version = '';
  let basedOn = '';
  try {
    if (typeof browser !== 'undefined' && browser.runtime && typeof browser.runtime.getBrowserInfo === 'function') {
      const info = await browser.runtime.getBrowserInfo();
      name = info && info.name;
      version = info && info.version;
      basedOn = 'Gecko'; // only Firefox and the browsers built on it have this call
    }
  } catch { /* fall back to the user agent below */ }
  if (!name && typeof navigator !== 'undefined') {
    const found = detectBrowserFromUserAgent(navigator.userAgent);
    if (found) {
      ({ name, version } = found);
      basedOn = browserBase(name);
    }
  }
  let extensionVersion = '';
  try {
    extensionVersion = browser.runtime.getManifest().version;
  } catch { /* leave it unknown */ }
  return makeBrowserSource(name, version, extensionVersion, basedOn);
}
