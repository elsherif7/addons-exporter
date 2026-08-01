# addons-exporter

A personal Firefox WebExtension that exports my installed add-ons to an HTML report, so I can quickly reinstall them all on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox, etc.) instead of hunting them down one by one.

Firefox doesn't allow any extension to install other extensions automatically — that's a deliberate security restriction, not a limitation of this tool. This just makes the manual reinstall process as fast as possible: one click to export, one click to open every add-on's real page as a tab on the new browser.

---

## Structure

```
addons-exporter/
├── manifest.json        # Extension config, permissions, background script
├── background.js        # Export logic, AMO lookups, HTML report generation
├── popup.html            # Toolbar popup UI
├── popup.js              # Popup logic (Export / Import buttons)
├── confirmation.html     # Tab shown after export completes
├── import.html           # Page to pick an exported file and open its tabs
├── import.js             # Import logic (reads file, opens tabs)
└── icons/                # Toolbar and extension icons (16/32/48/96/128px)
```

---

## Installation

**01. Install from Firefox Add-ons (recommended)**

> Install directly from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/) — the signed, permanent version.

**02. Or load a local copy for development**

```
git clone https://github.com/elsherif7/addons-exporter
```

> Go to `about:debugging#/runtime/this-firefox`, click **"Load Temporary Add-on"**, and select `manifest.json`.
>
> A temporarily-loaded add-on is removed when the browser restarts — use the AMO install above for a permanent copy.

---

## Files

### background.js — Export logic & AMO lookups

#### 01. What it does

Runs persistently in the background. Listens for the popup's export message, reads all installed add-ons, looks up each one's real store page, and builds the downloadable HTML report.

| Function | Purpose |
|---|---|
| `findAmoPage(id, name)` | Looks up an add-on's real AMO page — first by exact ID, then by name search, then falls back to its own homepage |
| `escapeHtml(str)` | Escapes HTML special characters before inserting text/links into the report |
| `formatExportDate(d)` | Formats the export date as e.g. "July 30, 2026" (no time, full month name) |
| `buildHtmlReport(list)` | Builds the full HTML report, split into Enabled/Disabled sections, with the raw data embedded for the Import page to read back |
| `doExport()` | Orchestrates the whole export: reads add-ons, resolves links, builds the report, triggers the download |

> No timeout is set on the AMO fetch calls — an accurate link is worth waiting for over a fast but wrong fallback.


---

### popup.html / popup.js — Toolbar Popup

#### 01. Buttons

| Button | Action |
|---|---|
| `Export Add-ons` | Sends an export message to `background.js`, then opens the confirmation tab |
| `Import Add-ons` | Opens `import.html` in a new tab |

> Export logic runs in the background script, not the popup itself — this avoids a bug where the popup closes early when the native "Save As" dialog steals focus, which would otherwise skip the confirmation step.


---

### import.html / import.js — Import Page

#### 01. Flow

Pick a previously exported `Firefox-Addons.html` file, and every add-on link inside it opens as a real browser tab.

| Function | Purpose |
|---|---|
| `setStatus(msg)` | Updates the status text under the buttons |
| File picker | Reads the chosen file, regex-extracts the embedded JSON data, opens each link via `browser.tabs.create` |

> Uses the extension's own Tabs API rather than a plain webpage's `window.open()` — so nothing gets blocked as a pop-up.


---

### confirmation.html — Post-Export Tab

Static page shown automatically after export completes. Confirms the file was saved, and links to rate the extension, report bugs, or view the source on GitHub.


---

### manifest.json — Extension Configuration

| Permission | Why it's needed |
|---|---|
| `management` | To read the list of installed add-ons |
| `downloads` | To save the exported HTML report |
| `https://addons.mozilla.org/*` | To look up each add-on's real AMO page |

> Manifest V2 — Firefox has committed to supporting it indefinitely, and none of MV3's changes (which mainly affect network-blocking extensions) apply to what this tool does.
>
> Declares `data_collection_permissions: { required: ["none"] }` — this extension collects zero personal data.


---

## Privacy

This extension does not collect, store, or transmit any personal data. The only network requests it makes are to `addons.mozilla.org`'s public API, to look up each installed add-on's official listing page.

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/elsherif7/addons-exporter/issues).

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
