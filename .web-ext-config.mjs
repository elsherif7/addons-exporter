// web-ext's own settings, read by every `web-ext` command - the pinned one
// behind `npm run lint:ext` and any `web-ext` you run yourself. Keeping them
// here means `web-ext lint` and `web-ext build` behave the same however they
// are started, instead of only when the ignore list is repeated on the command
// line.
//
// Only the files that make up the extension itself are linted or packaged.
// Everything listed below is development-only:
export default {
  sourceDir: '.',
  ignoreFiles: [
    // Tests, fixtures and the golden reports. The goldens and the AMO fixture
    // hold inline <script> blocks on purpose - that is what a saved report is.
    'tests/**',
    // Build and maintenance tooling: build-assets.js, check-syntax.js,
    // set-version.js, clean.py.
    'scripts/**',
    // Project files that are not part of the extension. (Dotfiles such as
    // .gitignore and .c8rc.json are already ignored by web-ext itself.)
    'package.json',
    'package-lock.json',
    'README.md',
    'LICENSE',
    'coverage/**',
  ],
};
