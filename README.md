# addons-hub

**Add-ons Hub** is a Firefox WebExtension for managing your installed add-ons. It currently includes **Add-ons Exporter** and **Add-ons Importer**, which let you export them to an HTML report and reinstall them all on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox, etc.) instead of hunting them down one by one. More tools may be added over time.

**🦊 Get it on Firefox Add-ons:** [Add-ons Hub on AMO](https://addons.mozilla.org/en-US/firefox/addon/add-ons-hub/)

> New updates are published on the 1st of odd-numbered months (January, March, May, July, September, November).
>
> Security issues or broken/critical bugs are fixed and released immediately, outside that schedule.

---

## Structure

```
addons-hub/
├── manifest.json         # Extension manifest: config, permissions, and background script list
├── tests/                 # Plain Node.js test suite, run via node tests/run.js
│   ├── run.js                   # Requires every test file, then prints the combined summary
│   ├── helpers.js               # Shared test()/testAsync() harness plus vm-loading and sandbox utilities
│   ├── common.test.js           # Unit tests covering every helper function in common.js
│   ├── import.test.js           # Tests covering the import page's parsing and UI logic
│   ├── report-template.test.js  # Tests for the standalone HTML report template builder
│   ├── background.test.js       # Tests covering messaging, AMO lookups, and export logic
│   └── export.test.js           # Tests covering the export page's picker and click logic
└── src/
    ├── common/
    │   ├── common.js   # Shared helper functions used across every page and script
    │   └── shared.css  # Shared styles used by export, import, and confirmation pages
    ├── background/
    │   ├── background.js       # Handles messaging, AMO lookups, and export orchestration logic
    │   └── report-template.js  # Builds the self-contained HTML report returned by doExport()
    ├── popup/
    │   ├── popup.html  # Markup for the small toolbar popup interface
    │   └── popup.js    # Handles clicks on the popup's export and import buttons
    ├── export/
    │   ├── export.html  # Page for choosing which installed add-ons to export
    │   └── export.js    # Loads the add-on list and sends the export selection
    ├── import/
    │   ├── import.html  # Page for picking an exported file and add-ons to open
    │   └── import.js    # Parses the exported file and opens the selected tabs
    ├── confirmation/
    │   └── confirmation.html  # Tab shown to the user after export finishes
    └── icons/             # Toolbar and extension icons in several standard sizes
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

> Requires Firefox 109 or newer (the first release with MV3 support), or Firefox for Android 113 or newer.

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

### Add-ons Exporter

Creates a checklist of every installed extension and theme, split into Enabled/Disabled groups with a search box to filter by name. Each selected add-on's real store page is looked up on `addons.mozilla.org` (by exact ID first, then a fuzzy name search, then its own homepage as a last resort), and the result is saved as a single HTML report — human-readable on its own, with the underlying data embedded for Add-ons Importer to read back. A row only gets a small label — Possible match, Homepage, or Search results — when the link isn't a confirmed exact match, since a fuzzy match can occasionally point to the wrong add-on.

### Add-ons Importer

Reads a previously exported report, chosen or dragged in, validating it automatically and rejecting anything with a missing or unsupported format version rather than guessing. It compares the report against what's currently installed (matched by add-on ID, falling back to name for older exports), splitting the checklist into **Not Installed Yet** (pre-selected) and **Already Installed** (shown for reference) — so you never need to reopen things you already have. It opens each pick as a tab rather than installing it directly, which is the workaround for a real limitation: Firefox doesn't allow any extension to install other extensions automatically — a deliberate security restriction, not a limitation of these tools.

#### A few other things worth knowing

- On desktop, the confirmation tab opens from the background script itself once the file downloads, not from the popup — so it still appears even if the popup's own tab has already closed. On Firefox for Android, the platform doesn't allow the background script to trigger the download itself, so Add-ons Exporter does it directly and opens the confirmation tab once the download is picked up.
- AMO lookups are capped at 15 seconds each and 5 in flight at once, so a slow AMO response can't stall an export, and a large add-on collection can't trip AMO's rate limiting.
- Firefox's own bundled built-ins (New Tab page, default themes) and spell-check dictionaries/language packs are excluded, since they aren't real installed add-ons and have no matching store listing. On Firefox for Android, its own bundled components (ad-blocking telemetry, reader view, etc.) are excluded the same way.
- Add-ons Importer only ever opens http/https links; anything else is flagged and left unselected, since an export file's data isn't inherently trusted.
- If every add-on in the file is already installed, Add-ons Importer shows a short note about it — informational only, since there's nothing to open.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `management` | To read the list of installed add-ons |
| `downloads` | To save the exported HTML report |
| `https://addons.mozilla.org/*` | To look up each add-on's real AMO page |

---

## Privacy

This extension does not collect, store, or transmit any personal data. The only network requests it makes are to `addons.mozilla.org`'s public API, to look up each installed add-on's official listing page.

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/elsherif7/addons-hub/issues).

## Credits

[Extension](https://icons8.com/icon/80736/puzzle) icon by [Icons8](https://icons8.com).

## License

GNU General Public License v3.0 — see the [LICENSE](./LICENSE) file for details.
