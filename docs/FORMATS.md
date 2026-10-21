# Export formats

How the Exporter writes files and how the Importer reads them. Every export lists enabled add-ons first and disabled ones after, each group sorted A→Z by name.

## The formats

| Format | Extension | Notes |
|--------|-----------|-------|
| HTML | `.html` | Readable report with the data embedded. Enabled and Disabled sections. Has a light/dark toggle, remembered in `localStorage` for that file. |
| JSON | `.json` | Same data shape as the HTML report's embedded payload, with each add-on's name first and its id last. One list in the order above. |
| CSV | `.csv` | One row per add-on, name first and id last, RFC 4180. Starts with a byte-order mark so Excel reads non-English names correctly. |
| TXT | `.txt` | A title, then Enabled and Disabled sections with the columns lined up. One add-on per line: `Name \| Version \| Type \| Status \| Link \| LinkType \| Id` |

Names are shortened when **Shorten add-on names** is on (the default). The id is always written.

Export files are named after the browser that made them, for example `Zen Add-ons (2026-10-21_14-05-09).html` or `LibreWolf Add-ons (...).csv`. When the browser cannot be identified, the prefix is left off: `Add-ons (...).html`. A download with several formats keeps that same base name for its `.zip`.

**CSV formula guard.** A name starting with `=`, `+`, `-` or `@` would be read as a formula by a spreadsheet, so it gets a leading apostrophe. The Importer strips exactly one back off, so the name round-trips unchanged.

**TXT escaping.** A backslash, a pipe or a line break in a name is escaped with a backslash (a line break is written as `\n`, and a space at the very start or end as `\s`), so every add-on stays on one line and the Importer restores the name exactly.

## Format version 3 and the source

Every export starts with a `source`: the file's own format version and type, whether it came from a phone or a computer, then where it came from (what the browser is based on, its name and version, and the Add-ons Hub version). For example: a report made on a phone in Firefox 128.0, based on Gecko, with Add-ons Hub 1.2.0.

`device` is `Phone` on Android, `Computer` on Windows, macOS, Linux, ChromeOS and the other desktop platforms, and `Unknown` when neither the platform API nor the user agent can say. It describes the device that made the export, not the browser.

- JSON and the HTML report's data hold it as a `source` object before `addons`, with `fileType` `json` or `html`, in this order: `formatVersion`, `fileType`, `device`, `basedOn`, `browser`, `browserVersion`, `extensionVersion`.
- CSV and TXT hold it as one comment line per field at the very top, in the same order, with `fileType` `csv` or `txt`:
  ```
  # addons-hub-source-formatVersion: ...
  # addons-hub-source-fileType: ...
  # addons-hub-source-device: ...
  # addons-hub-source-basedOn: ...
  # addons-hub-source-browser: ...
  # addons-hub-source-browserVersion: ...
  # addons-hub-source-extensionVersion: ...
  ```
- The Settings file records the format 1 source shape (no `device`) with `fileType` `settings`, because settings files still use their own format version 1.

The browser name comes from Firefox itself, so forks such as LibreWolf or Waterfox are named as they report themselves, and anything with that call is recorded as based on Gecko (a fork that reports itself as Firefox shows as Firefox). Where that call doesn't exist (a future Chrome or Ladybird build) the user agent is used: Edge, Opera, Vivaldi and Chrome are based on Chromium, Safari on WebKit. Anything unknown is written as `Unknown`.

The device comes from `runtime.getPlatformInfo()` (`os` is `android` for a phone, anything else is a computer), falling back to the user agent when that call isn't available.

The Importer still reads format 2 files (the same source without `device`) and format 1 files (which have no source). Every other layout rule stays strict.

## How the Importer reads files

**What counts as one export**

- A `.zip` is read as every export file inside it. Anything that isn't an Add-ons Hub export is ignored.
- A file you choose on its own is an entry of its own, so two files dropped together stay two even when they hold the same add-ons.
- One name in several formats is one entry that shows them, like `Add-ons (.json, .csv)`.
- A `.zip`'s contents are one entry per set of add-on ids. A `.zip` holding just one export is named after the `.zip` itself.
- When a selection holds more than one distinct export, a picker offers **All add-ons** (the default, every export merged with each id kept once) and then each export, the biggest first. Files listing the same ids count as the same export, and the most exact format supplies its data.
- A file that can't be read is named under the list and the rest still load. If nothing can be read, the first reason is shown and nothing loads.

**How files are checked**

- Limits: 10 MB per file, 64 MB for the export files of one `.zip` together.
- A wrong extension, an oversized file, or a missing, non-numeric or unsupported format version is rejected straight away with a plain message. A `.zip` is checked as a whole, so an encrypted, damaged or oversized one is refused too.
- Every reader is strict and accepts only a file laid out exactly as this extension writes it:
  - HTML report (including the one from the release on addons.mozilla.org): for every add-on exactly `id`, `name`, `version`, `enabled`, `type`, `link`, `linkType`, in that order.
  - JSON: exactly `name`, `version`, `type`, `enabled`, `link`, `linkType`, `id`, in that order.
  - CSV: the exact header, then one row per add-on.
  - TXT: exactly seven columns per line (six in a format 1 file), with the id always present.
  - `true`/`false`, `Extension`/`Theme` and `Enabled`/`Disabled` are spelled as written.
- Anything else is rejected with the first problem named, rather than guessed at. The same add-on listed twice is merged into one row.

**Matching what's installed**

- By add-on ID when the file has one. Without an id, or when the id isn't installed, by name: the exact name first, then the shortened form, so an export made with **Shorten add-on names** on still finds its add-on. A short name shared by two installed add-ons is never guessed at.
- The list is split into **Not Installed Yet** (pre-selected) and **Already Installed** (shown for reference).
- Only `http`/`https` links are ever opened. Anything else is flagged and left unselected, since an import file isn't trusted.

## The settings file

**Export Settings** writes a small JSON file named `Add-ons Hub Settings (<timestamp>).json` with the format 1 source shape (no `device`) and exactly three settings, in this order: `theme`, `exportFormat` (a single value, or a list when several are ticked) and `shortenNames`.

**Import Settings** is strict in the same way. The file must hold exactly those three settings in that order, each with a valid value, otherwise it's rejected with the problem named and nothing is changed.
