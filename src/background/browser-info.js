// Works out which browser is running and whether it is on a phone or a
// computer, for the "source" block in every export (see SOURCE_KEYS in
// core.js).
//
// Firefox and its forks report their own name and version through
// browser.runtime.getBrowserInfo(). A fork that calls itself "Firefox" is
// recorded as Firefox, there is nothing else to go on. Browsers without that
// call (Chromium ones, Ladybird...) are recognised from the user agent, so a
// Chromium browser that hides itself (Brave) shows up as Chrome.
//
// browser.runtime.getPlatformInfo().os is "android" for Firefox for Android;
// every other value is a desktop computer. The user agent answers when that
// call isn't there.

// First match wins, so specific names come before the engines they also
// contain (Edge's user agent says "Chrome" too).
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

// What each browser is built on. Unlisted ones count as built on themselves,
// except when getBrowserInfo() exists, which always means Gecko.
const BROWSER_BASES = {
  Edge: 'Chromium', Opera: 'Chromium', Vivaldi: 'Chromium', Chrome: 'Chromium', Brave: 'Chromium',
  LibreWolf: 'Gecko', Waterfox: 'Gecko', Floorp: 'Gecko', Firefox: 'Gecko',
  Safari: 'WebKit', Ladybird: 'Ladybird',
};
function browserBase(name) {
  return Object.prototype.hasOwnProperty.call(BROWSER_BASES, name) ? BROWSER_BASES[name] : name;
}

// { name, version } for a user-agent string, or null if it names no known browser.
function detectBrowserFromUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  for (const [token, name] of BROWSER_USER_AGENT_TOKENS) {
    const m = ua.match(new RegExp(`(?:^|[ (/])${token}/([0-9][0-9A-Za-z.]*)`));
    if (!m) continue;
    // Safari's real version is after "Version/"; "Safari/" is WebKit's.
    const own = name === 'Safari' ? ua.match(/Version\/([0-9][0-9A-Za-z.]*)/) : null;
    return { name, version: own ? own[1] : m[1] };
  }
  return null;
}

// "Phone" for an Android browser, "Computer" for a desktop one. The platform
// API is exact when it is available; the user agent is the fallback.
function deviceFromPlatform(platform, userAgent) {
  const os = platform && typeof platform.os === 'string' ? platform.os : '';
  if (os === 'android') return 'Phone';
  if (os) return 'Computer';
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (/\b(?:Android|iPhone|iPad|Mobile)\b/i.test(ua)) return 'Phone';
  if (/\b(?:Windows|Macintosh|Linux|CrOS|X11)\b/i.test(ua)) return 'Computer';
  return 'Unknown';
}

// The browser part of the export source. Anything it can't find becomes
// "Unknown" / "unknown", and it never throws.
async function getExportSource() {
  let name = '';
  let version = '';
  let basedOn = '';
  let platform = null;
  try {
    if (typeof browser !== 'undefined' && browser.runtime && typeof browser.runtime.getBrowserInfo === 'function') {
      const info = await browser.runtime.getBrowserInfo();
      name = info && info.name;
      version = info && info.version;
      basedOn = 'Gecko';
    }
  } catch { /* fall back to the user agent */ }
  if (!name && typeof navigator !== 'undefined') {
    const found = detectBrowserFromUserAgent(navigator.userAgent);
    if (found) {
      ({ name, version } = found);
      basedOn = browserBase(name);
    }
  }
  try {
    if (typeof browser !== 'undefined' && browser.runtime && typeof browser.runtime.getPlatformInfo === 'function') {
      platform = await browser.runtime.getPlatformInfo();
    }
  } catch { /* fall back to the user agent */ }
  const device = deviceFromPlatform(platform, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  let extensionVersion = '';
  try {
    extensionVersion = browser.runtime.getManifest().version;
  } catch { /* leave it unknown */ }
  return makeBrowserSource(name, version, extensionVersion, basedOn, device);
}
