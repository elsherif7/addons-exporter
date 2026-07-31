const statusEl = document.getElementById('status');
const fileNameEl = document.getElementById('fileName');
const fileInput = document.getElementById('fileInput');

function setStatus(msg) {
  statusEl.textContent = msg;
}

document.getElementById('chooseFileBtn').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  fileNameEl.textContent = fileInput.files[0] ? fileInput.files[0].name : 'No file selected';
  setStatus('');
});

document.getElementById('openAllBtn').addEventListener('click', () => {
  const file = fileInput.files[0];
  if (!file) {
    setStatus('Pick a Firefox-Addons.html file first');
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
      const list = JSON.parse(match[1]);
      if (!Array.isArray(list) || list.length === 0) {
        setStatus('No add-ons found in that file');
        return;
      }

      setStatus(`Opening ${list.length} tabs...`);
      // browser.tabs.create is an extension API call, not window.open() from
      // a web page, so it is never treated as pop-up spam by the browser.
      for (const item of list) {
        await browser.tabs.create({ url: item.link, active: false });
      }
      setStatus(`Opened ${list.length} tabs`);
    } catch (err) {
      setStatus('Error reading file: ' + err.message);
    }
  };
  reader.readAsText(file);
});
