// Highest exported-data format version this copy of the extension knows how
// to read. Mirrors EXPORT_FORMAT_VERSION in background.js. A file whose
// embedded formatVersion is higher than this was made by a newer version of
// the extension - its data shape may not match what we expect here, so we
// refuse to guess rather than risk opening bad links.
const SUPPORTED_FORMAT_VERSION = 1;

const statusEl = document.getElementById('status');
const fileNameEl = document.getElementById('fileName');
const fileNameRow = document.getElementById('fileNameRow');
const noFileText = document.getElementById('noFileText');
const fileInput = document.getElementById('fileInput');
const picker = document.getElementById('picker');
const removeFileBtn = document.getElementById('removeFileBtn');

let selectedFile = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setSelectedFile(file) {
  selectedFile = file;
  if (file) {
    fileNameEl.textContent = file.name;
    fileNameRow.style.display = 'flex';
    fileNameRow.style.alignItems = 'center';
    fileNameRow.style.justifyContent = 'center';
    fileNameRow.style.gap = '8px';
    noFileText.style.display = 'none';
  } else {
    fileInput.value = '';
    fileNameRow.style.display = 'none';
    noFileText.style.display = 'block';
  }
  setStatus('');
}

removeFileBtn.addEventListener('click', () => setSelectedFile(null));

document.getElementById('chooseFileBtn').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  setSelectedFile(fileInput.files[0] || null);
});

// Drag and drop: dropping a file directly onto the picker box works the
// same as clicking "Choose file", without needing the native file dialog.
['dragenter', 'dragover'].forEach((eventName) => {
  picker.addEventListener(eventName, (e) => {
    e.preventDefault();
    picker.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  picker.addEventListener(eventName, (e) => {
    e.preventDefault();
    picker.classList.remove('dragover');
  });
});

picker.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

document.getElementById('openAllBtn').addEventListener('click', () => {
  const file = selectedFile;
  if (!file) {
    setStatus('Pick an exported HTML file first');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const html = e.target.result;
      const match = html.match(
        /<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/
      );
      if (!match) {
        setStatus('This file doesn\'t look like an Add-ons Exporter export (no embedded data found)');
        return;
      }
      const parsed = JSON.parse(match[1]);
      const list = parsed && Array.isArray(parsed.addons) ? parsed.addons : null;

      if (!Array.isArray(list) || list.length === 0) {
        setStatus('No add-ons found in that file');
        return;
      }

      // Only accept files that explicitly declare a formatVersion we
      // understand. A missing formatVersion means the file predates
      // versioning (or isn't a real export) and we can't safely assume its
      // data shape - reject it rather than guessing.
      const formatVersion = parsed.formatVersion;
      if (typeof formatVersion !== 'number') {
        setStatus('This file is missing its export format version and can\'t be imported.');
        return;
      }
      if (formatVersion > SUPPORTED_FORMAT_VERSION) {
        setStatus('This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.');
        return;
      }

      setStatus(`Opening ${list.length} tabs...`);
      // browser.tabs.create is an extension API call, not window.open() from
      // a web page, so it is never treated as pop-up spam by the browser.
      let opened = 0;
      let failed = 0;
      for (const item of list) {
        try {
          await browser.tabs.create({ url: item.link, active: false });
          opened++;
        } catch {
          // A single bad/missing link shouldn't stop the rest of the
          // import - skip it and keep going.
          failed++;
        }
      }
      setStatus(failed > 0
        ? `Opened ${opened} tabs, ${failed} failed to open`
        : `Opened ${opened} tabs`);
    } catch (err) {
      setStatus('Error reading file: ' + err.message);
    }
  };
  reader.readAsText(file);
});
