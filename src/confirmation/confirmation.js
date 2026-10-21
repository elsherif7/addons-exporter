// Shown after the Exporter or Importer finishes, in the same tab. ?from= is
// set by those pages (via goToConfirmation()), so it's always one of two
// fixed values. For export, ?format= names the file type(s) used.

const params = new URLSearchParams(location.search);
const from = params.get('from');
// one format, or several joined with commas (e.g. 'html,json')
const formats = resolveExportFormats(params.get('format'));
const zipped = formats.length > 1 && params.get('zip') === '1';
// Import only: how many add-ons failed to open. Anything but a positive whole
// number is ignored.
const failedParam = params.get('failed') || '';
const failedCount = /^\d{1,4}$/.test(failedParam) ? Number(failedParam) : 0;

function buildExportMessage(container) {
  const article = indefiniteArticleFor(formatLabel(formats[0]));
  const exporterStrong = document.createElement('strong');
  exporterStrong.textContent = 'Add-ons Exporter';
  const importerStrong = document.createElement('strong');
  importerStrong.textContent = 'Add-ons Importer';
  container.append(
    'Thanks for using ', exporterStrong,
    `. Your add-ons were exported as ${article} `
  );
  appendFormatLabels(container, formats);
  if (zipped) {
    container.append(', saved together in one .zip file. On another browser, choose ', importerStrong, ' and select the .zip as it is, no need to unzip it.');
    return;
  }
  container.append('. On another browser, choose ', importerStrong, ' to select which ones to install.');
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
// #message has fallback text in the HTML. Clear it first, build() appends.
const messageEl = document.getElementById('message');
messageEl.textContent = '';
build(messageEl);
