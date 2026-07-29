const params = new URLSearchParams(window.location.search);
const count = params.get('count');
if (count) {
  document.getElementById('message').textContent =
    `Exported ${count} extensions and downloaded to your computer. Check your Downloads folder for my-extensions.html.`;
}
