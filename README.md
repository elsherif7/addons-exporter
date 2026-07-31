# Add-ons Exporter

A small Firefox (WebExtension) tool that exports your installed add-ons
into an HTML report with real store links, and can automatically open
every add-on's page as a tab on another Gecko-based browser (Firefox,
Zen, LibreWolf, Waterfox, Pale Moon, SeaMonkey) so you can reinstall
everything fast.

## Why

Browsers don't allow one extension to grab the actual code of another
(security restriction), so this tool doesn't copy `.xpi` files directly,
and no extension can auto-install another add-on for you. Instead:

1. Reads your installed add-ons via `browser.management.getAll()`
2. Looks up each one's real page on addons.mozilla.org (AMO) — first by
   exact extension ID, then by name search, falling back to the
   developer's homepage if it isn't listed on AMO at all
3. Downloads a `Firefox-Addons.html` report (you choose where to save
   it), split into **Enabled** / **Disabled** sections, with the raw
   data embedded inside for the Import feature to read back later
4. On the other browser: if Add-ons Exporter is installed there too,
   click its icon → **Import Add-ons** → pick that file → every add-on's
   page opens as a real tab (not a pop-up, since it uses the extension's
   own tab API) → click "Add to Firefox" on each one yourself

## Features

- Popup with two clear actions: **Export Add-ons** and **Import Add-ons**
- Export always asks where to save (native "Save As" dialog)
- Confirmation tab shown after export completes, with links to rate,
  report bugs, or view the source
- AMO lookups have a short timeout so one slow response can't stall
  the whole export
- Import page opens every add-on's page as a real tab — bypasses the
  browser's pop-up blocker entirely, unlike a plain downloaded page

## Installation (temporary, for personal use)

1. Clone or download this repo
2. Go to `about:debugging#/runtime/this-firefox` in your browser
3. Click **"Load Temporary Add-on"** and select `manifest.json`
4. Click the Add-ons Exporter icon in the toolbar

Note: temporary add-ons are removed when the browser restarts, so you'll
reload it each session unless it's packaged and signed (see Roadmap).

## Files

| File                  | Purpose                                                    |
|-----------------------|-------------------------------------------------------------|
| `manifest.json`       | Extension config, permissions, background script            |
| `background.js`       | Export logic, AMO lookups, HTML report generation            |
| `popup.html/js`       | Toolbar popup with Export/Import buttons                      |
| `confirmation.html`  | Tab shown after export completes                              |
| `import.html/js`      | Page to pick a previously exported file and open its tabs     |
| `icons/`              | Toolbar and extension icons (16/32/48/96/128px)                |

## Roadmap

- [x] Phase 1 — Project setup
- [x] Phase 2 — MVP export/import
- [x] Phase 3 — Accurate AMO links via API (by ID, then name)
- [x] Phase 3.5 — Switch export to an HTML report
- [x] Phase 3.6 — One-click export + confirmation tab
- [x] Phase 3.7 — Import feature using the extension's own tabs API to
      avoid pop-up blocking entirely
- [x] Phase 3.8 — Custom icons, consistent styling/wording across pages
- [ ] Phase 4 — Package + sign with `web-ext` for permanent install
- [ ] Phase 5 — Test across Firefox / Zen / LibreWolf / Waterfox
- [ ] Phase 6 — Push to GitHub
- [ ] Phase 7 (optional) — Publish to addons.mozilla.org

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
