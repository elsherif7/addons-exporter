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

const MESSAGES = {
  export: {
    title: 'Add-ons Exporter',
    message: `Thanks for using <strong>Add-ons Exporter</strong>. Your add-ons were exported as a ${exportFormatLabel(format)}. On another browser, choose <strong>Add-ons Importer</strong> to select which ones to install.`,
  },
  import: {
    title: 'Add-ons Importer',
    message: 'Thanks for using <strong>Add-ons Importer</strong>. Each selected add-on has opened in its own tab \u2014 click <strong>Add to Firefox</strong> on each one to finish installing it.',
  },
};

const { title, message } = MESSAGES[from] || MESSAGES.export;

document.title = title;
document.getElementById('heading').textContent = title;
document.getElementById('message').innerHTML = message;
