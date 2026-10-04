// Confirmation page shown after Add-ons Exporter or Add-ons Importer
// finishes. It replaces the Exporter/Importer page in the same tab. Which
// one it is comes from a ?from= query param set by that page (export.js
// or import.js, via goToConfirmation()) - not user input, so the values
// below are always one of these two fixed, trusted strings.
// For export, a ?format= param carries the file type (html/json/csv)
// so the message can name the actual format used.

const params = new URLSearchParams(location.search);
const from = params.get('from');
const format = params.get('format') || 'html';
// Import only: how many selected add-ons failed to open, if any. Parsed
// strictly - anything but a positive whole number is ignored.
const failedParam = params.get('failed') || '';
const failedCount = /^\d{1,4}$/.test(failedParam) ? Number(failedParam) : 0;

function buildExportMessage(container) {
  const label = formatLabel(format);
  const article = indefiniteArticleFor(label);
  const exporterStrong = document.createElement('strong');
  exporterStrong.textContent = 'Add-ons Exporter';
  const importerStrong = document.createElement('strong');
  importerStrong.textContent = 'Add-ons Importer';
  const labelStrong = document.createElement('strong');
  labelStrong.textContent = label;
  container.append(
    'Thanks for using ', exporterStrong,
    `. Your add-ons were exported as ${article} `, labelStrong,
    '. On another browser, choose ', importerStrong, ' to select which ones to install.'
  );
}

function buildImportMessage(container) {
  const importerStrong = document.createElement('strong');
  importerStrong.textContent = 'Add-ons Importer';
  const addToFirefoxStrong = document.createElement('strong');
  addToFirefoxStrong.textContent = 'Add to Firefox';
  container.append(
    'Thanks for using ', importerStrong,
    '. Each selected add-on is opening in its own tab. Click ',
    addToFirefoxStrong, ' on each one to finish installing it.'
  );
  if (failedCount > 0) {
    container.append(` ${failedCount} ${failedCount === 1 ? 'add-on' : 'add-ons'} could not be opened.`);
  }
}

const MESSAGES = {
  export: { title: 'Add-ons Exporter', build: buildExportMessage },
  import: { title: 'Add-ons Importer', build: buildImportMessage },
};

const { title, build } = Object.hasOwn(MESSAGES, from) ? MESSAGES[from] : MESSAGES.export;

document.title = title;
document.getElementById('heading').textContent = title;
// #message ships with static fallback text in the HTML. Cleared first,
// since build() appends - without this the message showed twice (the
// old innerHTML assignment replaced it implicitly).
const messageEl = document.getElementById('message');
messageEl.textContent = '';
build(messageEl);
