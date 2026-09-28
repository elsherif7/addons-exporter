// Confirmation tab shown after Add-ons Exporter or Add-ons Importer
// finishes. Which one it is comes from a ?from= query param set by
// whichever page opened this tab (background.js and export.js for
// export, import.js for import) - not user input, so the values below
// are always one of these two fixed, trusted strings.
// For export, a ?format= param carries the file type (html/json/csv)
// so the message can name the actual format used.

const FORMAT_LABELS = {
  json: 'JSON file',
  csv: 'CSV file',
};

function exportFormatLabel(fmt) {
  return FORMAT_LABELS[fmt] || 'HTML report';
}

const params = new URLSearchParams(location.search);
const from = params.get('from');
const format = params.get('format') || 'html';

function buildExportMessage(container) {
  const label = exportFormatLabel(format);
  const article = indefiniteArticleFor(label);
  const exporterStrong = document.createElement('strong');
  exporterStrong.textContent = 'Add-ons Exporter';
  const importerStrong = document.createElement('strong');
  importerStrong.textContent = 'Add-ons Importer';
  container.append(
    'Thanks for using ', exporterStrong,
    `. Your add-ons were exported as ${article} ${label}. On another browser, choose `,
    importerStrong, ' to select which ones to install.'
  );
}

function buildImportMessage(container) {
  const importerStrong = document.createElement('strong');
  importerStrong.textContent = 'Add-ons Importer';
  const addToFirefoxStrong = document.createElement('strong');
  addToFirefoxStrong.textContent = 'Add to Firefox';
  container.append(
    'Thanks for using ', importerStrong,
    '. Each selected add-on is opening in its own tab \u2014 click ',
    addToFirefoxStrong, ' on each one to finish installing it.'
  );
}

const MESSAGES = {
  export: { title: 'Add-ons Exporter', build: buildExportMessage },
  import: { title: 'Add-ons Importer', build: buildImportMessage },
};

const { title, build } = MESSAGES[from] || MESSAGES.export;

document.title = title;
document.getElementById('heading').textContent = title;
// #message ships with static fallback text in the HTML. Cleared first,
// since build() appends - without this the message showed twice (the
// old innerHTML assignment replaced it implicitly).
const messageEl = document.getElementById('message');
messageEl.textContent = '';
build(messageEl);
