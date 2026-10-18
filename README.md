# addons-hub

**Add-ons Hub** is a Firefox WebExtension for managing your installed add-ons. It currently has two tools, **Add-ons Exporter** and **Add-ons Importer**: export your add-ons to a file (HTML, JSON, CSV or TXT) and reinstall them on another Gecko-based browser (Firefox, Zen, LibreWolf, Waterfox...) instead of hunting them down one by one. More tools may come later.

**🦊 Get it on Firefox Add-ons:** [Add-ons Hub on AMO](https://addons.mozilla.org/en-US/firefox/addon/addons-hub/)

---

## Structure

```
addons-hub/
├── manifest.json     # extension manifest: permissions, background scripts
├── icons/            # toolbar and extension icons
├── docs/             # file formats and development notes
├── scripts/          # build and maintenance helpers
├── tests/            # test suite, run with `npm test`
└── src/
    ├── common/       # shared code and styles
    ├── background/   # export, AMO lookups, report and zip builders
    ├── popup/        # the toolbar popup
    ├── export/       # Add-ons Exporter page
    ├── import/       # Add-ons Importer page and file readers
    ├── settings/     # Settings page
    └── confirmation/ # page shown after an export or import
```

Every file is described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Installation

**From Firefox Add-ons (recommended):** install it from the [Firefox Add-ons page](https://addons.mozilla.org/en-US/firefox/addon/addons-hub/), the official signed version.

> Requires Firefox 128 or newer.

**A local copy for development:**

1. Clone the repo:
   ```
   git clone https://github.com/elsherif7/addons-hub
   ```
2. Go to `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
3. Select `manifest.json` from the cloned folder.

A temporary add-on is removed when the browser restarts, so use the AMO install for a permanent copy.

---

## How to use it

Click the toolbar icon and pick a tool. If it's already open, the popup brings that tab to the front instead of opening a second one.

### Add-ons Exporter

Lists every installed extension and theme (Enabled and Disabled, A→Z) with a search box. Tick the ones you want and click **Export Selected**.

- Each add-on's store page is looked up on `addons.mozilla.org` (exact ID, then a name search, then its homepage, then a plain AMO search link). A small label shows when a link isn't a confirmed exact match.
- The file is saved in the format(s) you ticked in Settings. Tick several and they're saved together in one `.zip`.
- If AMO is slow or failing, the remaining add-ons get a fallback link instead of hanging, and the final message says how many couldn't be looked up.
- The HTML report has its own light/dark toggle and works on any browser.

### Add-ons Importer

Pick one or more exported files (HTML, JSON, CSV, TXT, or the `.zip` the Exporter makes), or drag them in. The add-ons you don't have yet are pre-selected, and the ones you already have are listed too, for reference. Click **Open Selected** and each one opens in its own tab, where you click **Add to Firefox**.

Firefox doesn't let extensions install other extensions automatically, so opening the tabs is as far as any extension can go.

How files are read, and what gets rejected, is in [docs/FORMATS.md](docs/FORMATS.md).

### Settings

- **Appearance:** light or dark theme.
- **Export Format:** HTML, JSON, CSV or TXT. Tick one or more, at least one always stays ticked.
- **Display:** whether long add-on names are shortened (HTML report, JSON, CSV and TXT alike).
- **Export Settings / Import Settings:** back up your settings to a small JSON file and restore them, on this or another browser.
- **Reset:** back to the defaults, after a confirmation.

---

## Export formats

| Format | Extension | Re‑importable | Description |
|--------|-----------|---------------|-------------|
| HTML | `.html` | Yes | Readable report with the data embedded. Opens in any browser, light/dark toggle. |
| JSON | `.json` | Yes | Machine-readable, same data as the HTML report's embedded payload. |
| CSV | `.csv` | Yes | For spreadsheets. One row per add-on. Guarded against formula injection. |
| TXT | `.txt` | Yes | Plain text, with Enabled and Disabled sections and aligned columns. |

Every format carries each add-on's id, and uses the short name when **Shorten add-on names** is on (the default). The exact layouts are in [docs/FORMATS.md](docs/FORMATS.md).

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

This extension does not collect, store or transmit any personal data. Your theme, export format and display preferences are saved locally in your browser profile and never sent anywhere. The only network requests it makes go to `addons.mozilla.org`'s public API, to look up each add-on's listing page during an export. Files you import are read on your computer only.

---

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/elsherif7/addons-hub/issues). To work on the code, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Credits

[Extension](https://icons8.com/icon/80736/puzzle) icon by [Icons8](https://icons8.com).

---

## License

GNU General Public License v3.0, see the [LICENSE](./LICENSE) file for details.
