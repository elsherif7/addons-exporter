# addons-hub

**Add-ons Hub** is a Firefox WebExtension for managing your installed add-ons. It currently includes **Add-ons Exporter** and **Add-ons Importer**, which let you export your add-ons to a file (HTML, JSON, CSV, or TXT) and reinstall them all on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox, etc.) instead of hunting them down one by one. More tools may be added over time.

**🦊 Get it on Firefox Add-ons:** [Add-ons Hub on AMO](https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/)

---

## Structure

```
addons-hub/
├── manifest.json         # Extension manifest: config, permissions, and background script list
├── icons/                 # Toolbar and extension icons in several standard sizes
├── scripts/               # Build helpers: embed the report icon, inline report.css, syntax-check every source file, set the version
├── tests/                 # Plain Node.js test suite, run via `npm test`
│   ├── run.js                   # Requires every test file, then prints the combined summary
│   ├── golden/                  # Expected output files used by golden.test.js
│   ├── fixtures/                # amo-release.html: a real HTML report from the version released on addons.mozilla.org (import.test.js reads it)
│   ├── helpers.js               # Shared test()/testAsync() harness plus vm-loading and sandbox utilities
│   ├── common.test.js           # Unit tests covering the shared helpers (core.js, page-ui.js and amo.js)
│   ├── script-order.test.js     # Reads manifest.json and every page's <script> tags and checks each script only uses shared names loaded before it in that context
│   ├── theme.test.js            # Tests for the shared light/dark theme logic
│   ├── import.test.js           # Tests covering the import page's parsing and UI logic
│   ├── report-template.test.js  # Tests for all export format builders (HTML, JSON, CSV, TXT) in export-formats.js and report-template.js
│   ├── background.test.js       # Tests covering messaging, AMO lookups, and export logic
│   ├── export.test.js           # Tests covering the export page's picker and click logic
│   ├── golden.test.js           # Compares the exact text of every export format with the files in tests/golden/ (`UPDATE_GOLDEN=1 node tests/run.js` regenerates them)
│   ├── format-contract.test.js  # Pins the data layout of every export next to the format version, so a data change cannot happen without bumping it (a change to only the page's look never needs that)
│   ├── set-version.test.js      # Tests for scripts/set-version.js (the version is changed in package.json and manifest.json together)
│   ├── zip-external.test.js     # Checks the .zip with unzip, Python and bsdtar (whichever are installed), not just with this project's own reader
│   ├── press.test.js            # Tests for the click/tap press-ring feedback in press.js
│   ├── reveal.test.js           # Tests for the opening-reveal timing in reveal.js (including the Export button waiting for the last add-on)
│   ├── settings.test.js         # Tests for the settings page: backup/restore, reset, update check
│   ├── confirmation.test.js     # Tests for the confirmation page's heading/message logic
│   └── structure.test.js        # Cross-page checks: lang attributes, ARIA roles, version consistency
└── src/
    ├── common/
    │   ├── core.js     # Pure shared code, loaded everywhere: the export format registry, the settings schema and loadSettings(), text helpers, display labels
    │   ├── page-ui.js  # Shared code that touches the page (fade to the confirmation page, search filtering, selection count, live name shortening); pages only
    │   ├── theme.js    # Applies the stored light/dark theme on page load
    │   ├── press.js    # Click/tap feedback: a ring bursts out of links/buttons; rows get an inward flash instead
    │   ├── reveal.js   # Opening of the Exporter and Importer pages, timed like the Settings page (parts top to bottom, add-ons cascading in, the Exporter's Export button last)
    │   └── shared.css  # Shared styles used by export, import, settings, and confirmation pages
    ├── background/
    │   ├── background.js       # Handles messaging, export orchestration, and saveExport() (the file, or the zip)
    │   ├── amo.js              # AMO lookups: fetch with retry, name matching, findAmoPage()
    │   ├── export-formats.js   # Builds the JSON, CSV and TXT exports, and puts add-ons in reading order
    │   ├── report-template.js  # Builds the self-contained HTML report
    │   ├── report.css          # Source CSS for the report's inline <style> block; inlined by `npm run build`
    │   └── zip.js              # Tiny ZIP writer: several export formats are saved together as one .zip
    ├── popup/
    │   ├── popup.html  # Markup for the small toolbar popup interface
    │   └── popup.js    # Handles clicks on the popup's export, import, and settings buttons
    ├── export/
    │   ├── export.html  # Page for choosing which installed add-ons to export
    │   └── export.js    # Loads the add-on list and sends the export selection
    ├── import/
    │   ├── import.html  # Page for picking an exported file and add-ons to open
    │   └── import.js    # Parses the exported file and opens the selected tabs
    ├── settings/
    │   ├── settings.html      # Settings page, opened from the popup or the browser's own menu
    │   ├── settings-init.js   # Parser-blocking sync script: pre-applies the saved option states before first paint
    │   └── settings.js        # Settings page logic
    ├── confirmation/
    │   ├── confirmation.html  # Page shown after Add-ons Exporter or Add-ons Importer finishes
    │   └── confirmation.js    # Sets the heading/message based on which tool sent you here
```

> **Note:** `manifest.json`'s `browser_specific_settings.gecko.id` is
> `addons-exporter@local` — a legacy id left over from this project's
> previous "Add-ons Exporter" name, before it was renamed to "Add-ons
> Hub". It can't be documented with an inline comment since
> `manifest.json` is parsed as strict JSON (no comments allowed), hence
> the note here instead. Don't change it casually: Firefox uses this id
> to match an installed copy to its future updates, so changing it would
> break update continuity for anyone who already has the extension
> installed.

---

## Installation

> Requires Firefox 109 or newer (the first release with MV3 support).

**1. Install from Firefox Add-ons (recommended)**

> Install directly from the [Firefox Add-ons page](https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/) — the official signed version.

**2. Or load a local copy for development**

1. Clone the repo:
   ```
   git clone https://github.com/elsherif7/addons-hub
   ```
2. Go to `about:debugging#/runtime/this-firefox` and click **"Load Temporary Add-on"**.
3. Select `manifest.json` from the cloned folder.

> A temporarily-loaded add-on is removed when the browser restarts — use the AMO install above for a permanent copy.

---

## Tools

Both are opened from the toolbar icon's popup.

### Add-ons Exporter

Creates a checklist of every installed extension and theme, split into Enabled/Disabled groups with a search box to filter by name. Add-ons are listed in alphabetical order within each group. Each selected add-on's real store page is looked up on `addons.mozilla.org` (by exact ID first, then a fuzzy name search, then its own homepage, and finally a plain AMO search link if none of those find anything), and the result is saved in whichever format(s) you've ticked in Settings — **HTML** (default, human-readable with the data embedded for re-import), **JSON**, **CSV**, or **TXT**. Tick several and they are saved together in one `.zip` (a single Save dialog), all built from the same set of AMO lookups. A row only gets a small label — Possible match, Homepage, or Search results — when the link isn't a confirmed exact match, since a fuzzy match can occasionally point to the wrong add-on. If AMO itself seems to be having trouble (repeated failures, or the lookups are taking a long time), the remaining add-ons get a fallback link instead of hanging indefinitely, and the final status says how many, if any, couldn't be looked up. The HTML report opens in whichever theme Settings is currently set to, and has its own light/dark toggle in the corner — the toggle choice is remembered in `localStorage` so it persists across opens of the same file.

All export formats list enabled add-ons first and disabled ones after, each group sorted A→Z by name. The HTML report and the TXT file show them as Enabled and Disabled sections; JSON and CSV keep one list in that order. With **Shorten add-on names** on (the default), every format uses the short name, and every format also carries each add-on's id.

### Add-ons Importer

Reads a previously exported file (`.html`/`.htm`, `.json`, `.csv`, or `.txt`, up to 10 MB), chosen or dragged in. The file is validated before anything is read from it: an unrecognised extension or an oversized file is rejected immediately with a plain explanation, and a file with a missing, non-numeric, or unsupported format version is rejected the same way — including an export from the original v1.0.0 release, whose file shape predates this version check entirely. Every reader is strict: it accepts only a file laid out exactly as this extension writes it — the HTML report (including the one from the version released on addons.mozilla.org) must hold, for every add-on, exactly the fields `id`, `name`, `version`, `enabled`, `type`, `link` and `linkType`, in that order, and the JSON file exactly `name`, `version`, `type`, `enabled`, `link`, `linkType` and `id`, in that order; the CSV must have the exact header, and the TXT exactly six columns per line, with the id always present; `true`/`false`, `Extension`/`Theme` and `Enabled`/`Disabled` are spelled as written. Anything else is rejected with the first problem named, rather than guessed at.  A duplicate entry in the file (the same add-on listed twice) is merged into one row. It compares the file against what's currently installed, matching by add-on ID when the file has one, and falling back to matching by name otherwise (or when the id in the file doesn't match anything installed). The name match tries the exact name first, then the shortened form, so a file made with **Shorten add-on names** on still finds its add-on even when it has no id; a short name shared by two installed add-ons is never guessed at. The checklist is split into **Not Installed Yet** (pre-selected) and **Already Installed** (shown for reference), so you never need to reopen things you already have. A `.zip` made when several formats were exported is not read directly — unzip it and choose one of the files inside. It opens each pick as a tab rather than installing it directly, which is the workaround for a real limitation: Firefox doesn't allow any extension to install other extensions automatically — a deliberate security restriction, not a limitation of these tools.

### Settings

The Settings page controls **Appearance** (light/dark theme), **Export Format** (HTML/JSON/CSV/TXT — tick one or more; at least one always stays ticked; with one format you get that file, with several they are bundled into a single `.zip`), and **Display** (whether long add-on names are shortened — it applies to the HTML report and to the JSON, CSV and TXT exports alike), plus a few other things below.

**Export Settings** and **Import Settings**, at the bottom of the page, back up and restore all three of the settings above. Export saves them to a small JSON file (the export format is a single value, or a list when several are ticked) named `Add-ons Hub Settings (<timestamp>).json`, which you can use to carry your preferences to another browser or device. Import reads a previously exported settings file and applies it immediately. It is strict: the file must hold exactly the three settings an export writes, in the order it writes them, each with a valid value, otherwise it is rejected with the problem named and nothing is changed.

**Reset** clears all three settings back to their defaults, after a confirmation dialog.

#### A few other things worth knowing

- When the export finishes, the Exporter page fades out and is replaced by the confirmation page in the same tab, rather than opening a second tab. The background script saves the file (or the one `.zip`, when several formats are ticked) directly via the downloads API.
- Add-ons Importer opens the first selected add-on's page as a background tab, then fades out and is replaced by the confirmation page in the same tab right away. The background script keeps opening the remaining add-ons' pages, one after another, while the confirmation page is already showing. Links that can't be opened (not http/https) are skipped and the confirmation page says how many; if none open, the Importer stays put and shows the error.
- AMO lookups are capped at 15 seconds each and 5 in flight at once, so a single slow response can't stall an export. If AMO responds with a rate-limit (429), that one lookup is retried once after a short wait. If lookups keep failing, or the export has been running for 90 seconds, the remaining add-ons skip straight to a fallback link instead of continuing to retry against a struggling API.
- Firefox's own bundled built-ins (New Tab page, default themes) and spell-check dictionaries/language packs are excluded, since they aren't real installed add-ons and have no matching store listing.
- Add-ons Importer only ever opens http/https links; anything else is flagged and left unselected, since an export file's data isn't inherently trusted.
- A CSV export guards against formula injection: an add-on name starting with a character a spreadsheet would read as a formula (`=`, `+`, `-`, `@`) gets a leading apostrophe added so it's treated as plain text instead. Add-ons Importer strips that apostrophe back off, so the name round-trips correctly.
- If every add-on in the file is already installed, Add-ons Importer shows a short note about it — informational only, since there's nothing to open.
- Clicking a link — the **AMO** link on a row, or the links in the About box and on the confirmation page — gives that link its own press ring animation. Clicking elsewhere on a row gives the row a flash instead.

---

## Export formats

| Format | Extension | Re-importable | Description |
|--------|-----------|---------------|-------------|
| HTML | `.html` | ✅ | Human-readable report with embedded data. Opens in any browser. Has a light/dark toggle. |
| JSON | `.json` | ✅ | Machine-readable. Same data shape as the HTML report's embedded payload, with each add-on's name first and its id last. Names are shortened when the setting is on. |
| CSV | `.csv` | ✅ | For spreadsheets. One row per add-on (names shortened when the setting is on), name first and id last, RFC 4180-compliant, formula-injection guarded. Starts with a byte-order mark so Excel reads non-English names correctly. |
| TXT | `.txt` | ✅ | Plain text list for reading: a title, then Enabled and Disabled sections with the columns lined up. One add-on per line: `Name \| Version \| Type \| Status \| Link \| Id`. A backslash, a pipe or a line break in a name is escaped with a backslash (a line break is written as `\n`, and a space at the very start or end as `\s`), so every add-on stays on one line and the Importer restores the name exactly. |

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `management` | To read the list of installed add-ons |
| `downloads` | To save the exported file |
| `storage` | To remember your settings |
| `https://addons.mozilla.org/*` | To look up each add-on's real AMO page |

---

## Privacy

This extension does not collect, store, or transmit any personal data. Your theme, export format, and display preferences are saved locally in your browser profile (never sent anywhere) so they persist between sessions. The only network requests it makes are to `addons.mozilla.org`'s public API: to look up each installed add-on's official listing page during an export, and, if you use **Check now** in Settings, to check the extension's own latest version.

---

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/elsherif7/addons-hub/issues).

**Running the tests**

```
npm test
```

**Changing the version**

The version is written in two files, `package.json` and `manifest.json`, and a test fails if they differ. To change both at once:

```
npm run set-version -- 1.3.0
```

Only the `"version"` line of each file changes.

**Updating the report icon**

If you replace `icons/icon32.png`, run:

```
npm run build
```

This re-encodes the icon as a base64 data URI and writes it into `src/background/report-template.js` (the report is a standalone file and can't reference the icon by path once saved). The test suite will fail with a mismatch error until you do.

**Editing the report's CSS**

The exported HTML report embeds its own CSS since it's a standalone file. Edit `src/background/report.css` directly rather than the embedded string inside `report-template.js`, then run:

```
npm run build
```

The build script inlines `report.css` into `report-template.js`. The test suite will fail with a sync error until you do.

---

## Credits

[Extension](https://icons8.com/icon/80736/puzzle) icon by [Icons8](https://icons8.com).

---

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
