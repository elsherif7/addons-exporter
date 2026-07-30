const params = new URLSearchParams(window.location.search);
const count = params.get('count');
if (count) {
  document.getElementById('message').innerHTML =
    `Thanks for using <strong>Add-ons Exporter</strong>! Exported ${count} add-ons as <strong>Firefox-Addons.html</strong> to the location you chose.`;
}
