# addons-exporter

A Firefox WebExtension that exports your installed add-ons to an HTML report, so you can quickly reinstall them all on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox, etc.) instead of hunting them down one by one.

Firefox doesn't allow any extension to install other extensions automatically — that's a deliberate security restriction, not a limitation of this tool. This just makes the manual reinstall process as fast as possible: pick which add-ons to include, export, then pick which of them to open as tabs on the new browser.

**🦊 Get it on Firefox Add-ons:** [addons.mozilla.org/en-US/firefox/addon/add-ons-exporter](https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/)

> New updates are published on the 7th of every month.

---

## Structure

```
addons-exporter/
├── manifest.json        # Extension config, permissions, background script
├── background.js        # Export logic, AMO lookups, HTML report generation
├── shared.css            # Shared styles for export.html / import.html / confirmation.html
├── popup.html            # Toolbar popup UI
├── popup.js              # Popup logic (Export / Import buttons)
├── export.html           # Page to pick which installed add-ons to export
├── export.js             # Export picker logic (loads the list, sends the selection)
├── confirmation.html     # Tab shown after export completes
├── import.html           # Page to pick an exported file and choose which add-ons to open
├── import.js             # Import logic (parses the file, opens the selected tabs)
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

Runs persistently in the background. Listens for messages from `export.html` (list the installed add-ons, then export a chosen subset of them) and opens the confirmation tab once a download starts.

Each export embeds its add-on data as `{ formatVersion, addons }` (see `EXPORT_FORMAT_VERSION`), so `import.js` can detect an incompatible file instead of guessing at its shape.

| Function | Purpose |
|---|---|
| `fetchWithTimeout(url, timeoutMs)` | Wraps `fetch()` with an `AbortController`-based timeout, so a slow/unreachable AMO endpoint can't stall the export indefinitely |
| `findAmoPage(id, name)` | Looks up an add-on's real AMO page — first by exact ID, then by a fuzzy name search — and returns `{ url, matchType }` so the report can show how confident each link is |
| `escapeHtml(str)` | Escapes HTML special characters before inserting text/links into the report |
| `formatExportDate(d)` | Formats the export date shown inside the report, e.g. "July 30, 2026" (no time, full month name) |
| `formatFilenameTimestamp(d)` | Formats a filename-safe date/time (e.g. `2026-08-05_21-30-15`) used in the downloaded file's name |
| `buildHtmlReport(list)` | Builds the full HTML report: Extensions/Themes groups, each split into alphabetized Enabled/Disabled tables, with a Match column showing link confidence, and the raw data embedded for the Import page to read back |
| `mapWithConcurrency(items, limit, fn)` | Runs an async function over a list with at most `limit` calls in flight at once — used to cap concurrent AMO lookups |
| `getExportableAddons()` | Reads installed add-ons and filters to the ones this tool can export (extensions/themes, excluding Firefox's own built-ins) — shared by the picker and the actual export so both always agree on what's eligible |
| `listInstalledAddons()` | Lightweight listing (no AMO lookups) used to populate `export.html`'s checklist |
| `doExport(ids)` | Orchestrates the export: resolves links only for the selected add-ons (or all eligible ones if `ids` is omitted), builds the report, and triggers the download with a timestamped filename |

> AMO lookups run with a bounded timeout (15s per request) and at most 5 in flight at once — accurate over instant, but never allowed to hang forever or risk tripping AMO's rate limiting on a large add-on collection.
>
> Firefox ships some of its own internal features (like the New Tab page and default themes) as hidden built-in extensions, exposed through the same `management` API this tool reads. These are excluded by filtering out ids ending in `@mozilla.org`, since they aren't real installed add-ons and have no matching AMO listing. Spell-check dictionaries and language packs (`dictionary`/`locale` types) are excluded too, since the report only has Extensions/Themes sections.


---

### shared.css — Shared page styles

CSS used by `export.html`, `import.html`, and `confirmation.html`: the page background and card layout, plus the add-on checklist UI (list controls, select all/deselect all, grouped rows, the primary action button, and status text) shared between the export and import pickers. Kept in one file so the two pickers can't visually drift apart from each other — each page's own `<style>` block only holds what's genuinely specific to that page.


---

### popup.html / popup.js — Toolbar Popup

#### 01. Buttons

| Button | Action |
|---|---|
| `Export Add-ons` | Opens `export.html` in a new tab |
| `Import Add-ons` | Opens `import.html` in a new tab |

Both flows now run entirely on their own full-page tab rather than in the popup itself — picking which add-ons to include needs more room than a toolbar popup can offer, and it keeps Export and Import symmetrical.


---

### export.html / export.js — Export Page

#### 01. Flow

Opens with a checklist of every installed, exportable add-on (grouped into Extensions/Themes, alphabetized, disabled ones tagged), fetched from `background.js` via a `listAddons` message — no AMO lookups happen yet at this point. Everything is selected by default.

Use **Select all** / **Deselect all**, or check individual add-ons, then click **Export Selected**. Only the checked add-ons are sent to `background.js` for AMO resolution and included in the downloaded report.

| Function | Purpose |
|---|---|
| `setStatus(msg)` | Updates the status text under the button |
| `renderList(addons)` | Renders the checkbox list, grouped and sorted, from the add-ons `background.js` reports |
| `updateSelectionCount()` | Keeps the "N of M selected" label and the Export button's disabled state in sync with the checkboxes |

> If nothing is selected, `background.js` refuses the export with a clear error rather than generating an empty report.


---

### import.html / import.js — Import Page

#### 01. Flow

Pick a previously exported HTML report — either via the "Choose file" button or by dragging and dropping the file directly onto the picker box. The file is read and validated automatically as soon as it's selected; a successfully parsed file renders a checklist of every add-on it contains (grouped and sorted the same way as the export picker), instead of immediately opening every tab.

Use **Select all** / **Deselect all**, or check individual add-ons, then click **Open Selected in Tabs**. Tabs are opened one at a time with a small stagger between each, rather than all at once, so importing a large collection doesn't burst a lot of sudden load on the browser.

Once a file is selected, its name is shown with a small **×** button to clear the selection and go back to the empty state. Hovering that button shows a custom-styled tooltip instead of the browser's native one.

If any individual link fails to open (a bad or missing URL), that one entry is skipped and counted — the rest of the import still completes. The final status message reports both counts, e.g. "Opened 27 tabs, 1 failed to open".

| Function | Purpose |
|---|---|
| `setStatus(msg)` | Updates the status text under the button |
| `setSelectedFile(file)` | Shared state update used by both the file picker and drag-and-drop, so the UI (filename, remove button, empty state) always stays in sync, and triggers parsing |
| `loadFile(file)` | Reads and validates the file (via `DOMParser`, not a regex — robust to formatting changes and never executes scripts in the parsed document), checks its `formatVersion`, and renders the checklist |
| `renderAddonList(addons)` | Renders the checkbox list in display order, keeping an index back to each item so a checked box always maps to the right link regardless of file ordering |

> Only files with a `formatVersion` this copy of the extension understands are accepted — a missing version or one from a newer release is rejected with a clear message instead of guessing at an unfamiliar data shape.
>
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

## Credits

[Extension](https://icons8.com/icon/80736/puzzle) icon by [Icons8](https://icons8.com).

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
