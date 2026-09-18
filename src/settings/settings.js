// Settings page logic. theme.js (loaded in <head>) already applied the
// stored theme before this runs, using its own THEME_STORAGE_KEY,
// resolveTheme(), and applyTheme() - this just wires the radio buttons
// up to reflect and change that same stored value.

const themeRadios = document.querySelectorAll('input[name="theme"]');
const formatRadios = document.querySelectorAll('input[name="exportFormat"]');

async function loadCurrentTheme() {
  let stored;
  try {
    stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  } catch {
    stored = {};
  }
  const current = resolveTheme(stored);
  for (const radio of themeRadios) {
    radio.checked = radio.value === current;
  }
}

async function loadCurrentExportFormat() {
  let stored;
  try {
    stored = await browser.storage.local.get(EXPORT_FORMAT_STORAGE_KEY);
  } catch {
    stored = {};
  }
  const current = (stored && (stored[EXPORT_FORMAT_STORAGE_KEY] === 'html' ||
                               stored[EXPORT_FORMAT_STORAGE_KEY] === 'json' ||
                               stored[EXPORT_FORMAT_STORAGE_KEY] === 'csv'))
    ? stored[EXPORT_FORMAT_STORAGE_KEY]
    : EXPORT_FORMAT_DEFAULT;
  for (const radio of formatRadios) {
    radio.checked = radio.value === current;
  }
}

for (const radio of themeRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    await browser.storage.local.set({ [THEME_STORAGE_KEY]: radio.value });
    applyTheme(radio.value);
  });
}

for (const radio of formatRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    await browser.storage.local.set({ [EXPORT_FORMAT_STORAGE_KEY]: radio.value });
  });
}

loadCurrentTheme();
loadCurrentExportFormat();
