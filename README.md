# addons-exporter

A Firefox WebExtension that exports your installed add-ons to an HTML report, so you can quickly reinstall them all on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox, etc.) instead of hunting them down one by one.

Firefox doesn't allow any extension to install other extensions automatically — that's a deliberate security restriction, not a limitation of this tool. This just makes the manual reinstall process as fast as possible: pick which add-ons to include, export, then pick which of them to open as tabs on the new browser.

**🦊 Get it on Firefox Add-ons:** [addons.mozilla.org/en-US/firefox/addon/add-ons-exporter](https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/)

> New updates are published on the 1st of odd-numbered months (January, March, May, July, September, November).
>
> Security issues or broken/critical bugs are fixed and released immediately, outside that schedule.

---

## Structure

```
addons-exporter/
├── manifest.json        # Extension config, permissions, background script
├── common.js             # Shared helpers (escapeHtml, isSafeUrl, byName, filterAddonRows) and the export format version
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

**1. Install from Firefox Add-ons (recommended)**

> Install directly from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/add-ons-exporter/) — the signed, permanent version.

**2. Or load a local copy for development**

1. Clone the repo:
   ```
   git clone https://github.com/elsherif7/addons-exporter
   ```
2. Go to `about:debugging#/runtime/this-firefox` and click **"Load Temporary Add-on"**.
3. Select `manifest.json` from the cloned folder.

> A temporarily-loaded add-on is removed when the browser restarts — use the AMO install above for a permanent copy.

---

## How it works

**Export** — click the toolbar icon → **Export Add-ons** to open a checklist of every installed extension and theme, split into Enabled/Disabled groups and alphabetized within each. Pick which ones to include, or use Select all / Deselect all, then click **Export Selected**. Each selected add-on's real store page is looked up on `addons.mozilla.org` (by exact ID first, then a fuzzy name search, then its own homepage as a last resort), and the result is saved as a single HTML report — human-readable on its own, with the underlying data embedded for the Import page to read back. A row only gets a small label — Possible match, Homepage, or Search results — when the link isn't a confirmed exact match, since a fuzzy match can occasionally point to the wrong add-on.

**Import** — click **Import Add-ons**, then choose or drag in a previously exported report. It's read and validated automatically as soon as it's selected, and only accepted if its embedded format version is one this copy of the extension understands — anything missing or newer is rejected with a clear message rather than guessed at. It's automatically compared against what's currently installed (matched by add-on ID, falling back to name for older exports), so the checklist splits into **Not Installed Yet** (pre-selected) and **Already Installed** (shown for reference, not pre-selected) — no need to reopen things you already have. Pick what to open and click **Open Selected**; tabs open one at a time with a short stagger between each, rather than all at once.

A few other things worth knowing:

- The confirmation tab opens from the background script itself once a download starts, not from the popup — so it still appears even if the popup's own tab has already closed.
- AMO lookups are capped at 15 seconds each and 5 in flight at once, so a slow AMO response can't stall an export, and a large add-on collection can't trip AMO's rate limiting.
- Firefox's own bundled built-ins (New Tab page, default themes) and spell-check dictionaries/language packs are excluded, since they aren't real installed add-ons and have no matching store listing.
- Import only ever opens http/https links; anything else is flagged and left unselected, since an export file's data isn't inherently trusted.
- If every add-on in the file is already installed, Import shows a short note about it — informational only, since there's nothing to open.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `management` | To read the list of installed add-ons |
| `downloads` | To save the exported HTML report |
| `https://addons.mozilla.org/*` | To look up each add-on's real AMO page |

> Manifest V3, requiring Firefox 109 or newer (the first release with MV3 support). Migrated from Manifest V2.
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
