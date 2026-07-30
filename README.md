# Add-ons Exporter

A small Firefox (WebExtension) tool that exports your installed add-ons
into a clean, printable HTML report with real store links — so you can
move your add-ons list to another Gecko-based browser (Firefox, Zen,
LibreWolf, Waterfox, Pale Moon, SeaMonkey) and reinstall everything fast.

## Why

Browsers don't allow one extension to grab the actual code of another
(security restriction), so this tool doesn't copy `.xpi` files directly.
Instead it:

1. Reads your installed add-ons via `browser.management.getAll()`
2. Looks up each one's real page on addons.mozilla.org (AMO) — first by
   exact extension ID, then by name search, falling back to the
   developer's homepage if it isn't listed on AMO at all
3. Downloads a single `Firefox-Addons.html` report, split into
   **Enabled** / **Disabled** sections
4. On the new browser, open that HTML file and either click links one by
   one, or check the ones you want and click **"Open checked in new
   tabs"** to open several at once

## Features

- One click on the toolbar icon — no popup, exports immediately
- Downloads like a normal browser download (respects your
  "always ask where to save" setting)
- Confirmation tab shown after export completes
- Exported report includes:
  - Enabled / Disabled sections
  - Print button
  - Copy list as plain text
  - Checkboxes + "select all" + "open checked in new tabs"

## Installation (temporary, for personal use)

1. Clone or download this repo
2. Go to `about:debugging#/runtime/this-firefox` in your browser
3. Click **"Load Temporary Add-on"** and select `manifest.json`
4. Click the Add-ons Exporter icon in the toolbar to export

Note: temporary add-ons are removed when the browser restarts, so you'll
reload it each session unless it's packaged and signed (see Roadmap).

## Files

| File                 | Purpose                                            |
|----------------------|-----------------------------------------------------|
| `manifest.json`      | Extension config, permissions, background script    |
| `background.js`      | Export logic, AMO lookups, HTML report generation   |
| `confirmation.html`  | Tab shown after export completes                    |
| `confirmation.js`    | Fills in the extension count on the confirmation tab |

## Roadmap

- [x] Phase 1 — Project setup
- [x] Phase 2 — MVP export/import
- [x] Phase 3 — Accurate AMO links via API (by ID, then name)
- [x] Phase 3.5 — Switch export to a printable HTML report
- [x] Phase 3.6 — One-click export on icon click + confirmation tab
- [x] Phase 3.7 — Checkboxes to open selected links in new tabs
- [ ] Phase 4 — Package + sign with `web-ext` for permanent install
- [ ] Phase 5 — Test across Firefox / Zen / LibreWolf / Waterfox
- [ ] Phase 6 — Push to GitHub
- [ ] Phase 7 (optional) — Publish to addons.mozilla.org

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
