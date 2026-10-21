// web-ext settings, read by every `web-ext` command, so lint and build behave
// the same however they're started. Only the extension's own files are linted
// or packaged; everything ignored below is development-only.
export default {
  sourceDir: '.',
  ignoreFiles: [
    // the goldens and the AMO fixture hold inline <script> blocks on purpose.
    // each folder is listed twice: once for the folder entry in the zip and
    // once for the files inside it, which lint checks one by one.
    'tests',
    'tests/**',
    'scripts',
    'scripts/**',
    // web-ext already ignores dotfiles
    'package.json',
    'package-lock.json',
    'README.md',
    'docs',
    'docs/**',
    'LICENSE',
    'coverage',
    'coverage/**',
  ],
};
