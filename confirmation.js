const params = new URLSearchParams(window.location.search);
const count = params.get('count');
if (count) {
  document.getElementById('message').textContent =
    `Exported ${count} add-ons and downloaded to your computer. Check your Downloads folder for Firefox-Addons.html.`;
}
