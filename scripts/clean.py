#!/usr/bin/env python3
"""Delete this project's throwaway folders and files.

Run it whenever the folder feels cluttered - from anywhere:

    python scripts/clean.py             # delete everything it lists
    python scripts/clean.py --dry-run   # only show what would go
    python scripts/clean.py --path DIR  # clean DIR instead of the repo root

Everything it removes is something a tool made and can make again: node_modules
comes back with `npm ci`, coverage with `npm run test:coverage`,
web-ext-artifacts with `npm run lint:ext`. Nothing else is ever touched.

To keep it useful as the project grows, add a new folder to DIRS, or a new file
name / extension to FILE_NAMES / FILE_SUFFIXES. Folders named in NEVER_ENTER are
never opened and never deleted - they hold input, not output.
"""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
from pathlib import Path

# Whole folders to remove, wherever they turn up. One of these is taken whole -
# it is never searched inside.
DIRS = {
    # npm
    "node_modules",
    # test and lint reports
    "coverage",
    "htmlcov",
    ".nyc_output",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    # bundlers and build output
    "dist",
    "build",
    ".next",
    ".parcel-cache",
    ".turbo",
    ".cache",
    # Python
    "__pycache__",
    ".venv",
    "venv",
    # Firefox extension builds
    "web-ext-artifacts",
}

# Single files to remove, by exact name.
FILE_NAMES = {
    ".DS_Store",        # macOS folder metadata
    "Thumbs.db",        # Windows thumbnail cache
    "desktop.ini",
    ".eslintcache",
    ".stylelintcache",
    ".coverage",        # pytest-cov's data file (its report folder is "coverage")
}

# Single files to remove, by lower-case extension.
FILE_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".zip",             # Add-ons Hub's own exports, and web-ext builds
    ".xpi",
}

# Never opened, never removed: version control, the tests, and anything called
# "fixtures" - input data that can look just like output (tests/fixtures is
# compared byte-for-byte, so it has to survive a clean).
NEVER_ENTER = {".git", "tests", "fixtures"}


def human(size: float) -> str:
    """A byte count as something readable, e.g. "5.8 MB"."""
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def size_of(path: Path) -> int:
    """Bytes held by a file, or by everything under a folder."""
    if path.is_symlink() or path.is_file():
        try:
            return path.lstat().st_size
        except OSError:
            return 0
    total = 0
    for base, _dirs, files in os.walk(path, onerror=lambda _err: None):
        for name in files:
            try:
                total += (Path(base) / name).lstat().st_size
            except OSError:
                pass
    return total


def _clear_readonly(func, target) -> None:
    """rmtree's retry hook: Windows marks npm's files read-only."""
    try:
        os.chmod(target, stat.S_IWRITE)
    except OSError:
        pass
    func(target)


def remove(path: Path) -> None:
    """Delete a file, a symlink, or a whole folder - read-only files included."""
    if path.is_symlink() or path.is_file():
        try:
            os.chmod(path, stat.S_IWRITE)
        except OSError:
            pass
        path.unlink()
        return
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_clear_readonly)
    else:
        shutil.rmtree(path, onerror=lambda func, target, _err: _clear_readonly(func, target))


def find(root: Path) -> list[Path]:
    """Every artefact under root, in a stable order."""
    found: list[Path] = []
    for base, dirnames, filenames in os.walk(root, topdown=True, onerror=lambda _err: None):
        here = Path(base)

        # Take whole folders and stop descending into them, so nothing inside
        # one is listed as well.
        found.extend(here / name for name in dirnames if name in DIRS)
        dirnames[:] = [
            name for name in dirnames
            if name not in DIRS and name not in NEVER_ENTER
        ]

        found.extend(
            here / name for name in filenames
            if name in FILE_NAMES or Path(name).suffix.lower() in FILE_SUFFIXES
        )
    return sorted(found)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Delete this project's throwaway folders and files.")
    parser.add_argument("--path", help="clean this folder instead of the repo root")
    parser.add_argument("--dry-run", action="store_true",
                        help="only list what would be deleted")
    args = parser.parse_args()

    root = Path(args.path).resolve() if args.path else Path(__file__).resolve().parent.parent
    if not root.is_dir():
        print(f"Not a folder: {root}", file=sys.stderr)
        return 1

    targets = find(root)
    print(f"Cleaning {root}{' (dry run)' if args.dry_run else ''}")
    if not targets:
        print("  nothing to clean - already tidy.")
        return 0

    sized = [(path, size_of(path)) for path in targets]
    total = sum(size for _path, size in sized)
    for path, size in sized:
        print(f"  {human(size):>9}  {path.relative_to(root)}")

    if args.dry_run:
        print(f"\nWould delete {len(sized)} item(s), freeing {human(total)}. Nothing was touched.")
        return 0

    failed = 0
    for path, _size in sized:
        try:
            remove(path)
        except OSError as err:
            failed += 1
            print(f"  could not delete {path}: {err}", file=sys.stderr)

    print(f"\nDeleted {len(sized) - failed} item(s), freeing {human(total)}.")
    if failed:
        print(f"{failed} item(s) could not be removed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
