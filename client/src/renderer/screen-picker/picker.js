'use strict';

// Ana pencere/Ayarlar'daki gibi bu pencere de aktif renk tercihine (Otomatik: Discord
// temasından örneklenen; ya da sabit bir ön ayar) uyum sağlasın — bkz. titlebar.js
// applyDynamicPalette, main/dynamicColor.js.
function applyDynamicPalette(palette) {
  const root = document.documentElement.style;
  root.setProperty('--sc-bg-primary', palette.primary);
  root.setProperty('--sc-bg-secondary', palette.secondary);
  root.setProperty('--sc-bg-tertiary', palette.tertiary);
  root.setProperty('--sc-bg-hover', palette.hover);
  root.setProperty('--sc-text-normal', palette.textNormal);
  root.setProperty('--sc-text-muted', palette.textMuted);
}
window.splitcordPicker.onDynamicColorSampled(applyDynamicPalette);

const emptyHint = document.getElementById('empty-hint');
const sectionWindows = document.getElementById('section-windows');
const sectionScreens = document.getElementById('section-screens');
const gridWindows = document.getElementById('grid-windows');
const gridScreens = document.getElementById('grid-screens');
const selectQuality = document.getElementById('select-quality');
const selectFps = document.getElementById('select-fps');
const toggleAudio = document.getElementById('toggle-audio');
const btnShare = document.getElementById('btn-share');

const QUALITY_PRESETS = {
  source: null,
  1080: { width: 1920, height: 1080 },
  720: { width: 1280, height: 720 },
  480: { width: 854, height: 480 },
};

let selectedId = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function selectCard(id, card) {
  selectedId = id;
  document.querySelectorAll('.source-card.selected').forEach((el) => el.classList.remove('selected'));
  card.classList.add('selected');
  btnShare.disabled = false;
}

function renderCard(source, container) {
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = `
    ${source.thumbnail ? `<img class="source-thumb" src="${source.thumbnail}" alt="" />` : '<div class="source-thumb"></div>'}
    <div class="source-label">
      ${source.appIcon ? `<img class="source-icon" src="${source.appIcon}" alt="" />` : ''}
      <span class="source-name">${escapeHtml(source.name)}</span>
    </div>
  `;
  card.addEventListener('click', () => selectCard(source.id, card));
  card.addEventListener('dblclick', () => {
    selectCard(source.id, card);
    shareSelected();
  });
  container.appendChild(card);
}

window.splitcordPicker.onSources((sources) => {
  gridWindows.innerHTML = '';
  gridScreens.innerHTML = '';
  selectedId = null;
  btnShare.disabled = true;

  if (!sources.length) {
    emptyHint.textContent = 'Paylaşılabilecek bir ekran/pencere bulunamadı.';
    emptyHint.hidden = false;
    sectionWindows.hidden = true;
    sectionScreens.hidden = true;
    return;
  }
  emptyHint.hidden = true;

  // desktopCapturer kaynak id'leri "window:XX:YY" ya da "screen:ZZ:0" biçiminde —
  // program pencerelerini ("Pencereler") ve tam monitörleri ("Ekranlar") bu önekle ayırıyoruz.
  const windows = sources.filter((s) => s.id.startsWith('window:'));
  const screens = sources.filter((s) => s.id.startsWith('screen:'));

  sectionWindows.hidden = windows.length === 0;
  for (const source of windows) renderCard(source, gridWindows);

  sectionScreens.hidden = screens.length === 0;
  for (const source of screens) renderCard(source, gridScreens);
});

function shareSelected() {
  if (!selectedId) return;
  const preset = QUALITY_PRESETS[selectQuality.value];
  window.splitcordPicker.choose({
    id: selectedId,
    width: preset?.width,
    height: preset?.height,
    frameRate: Number(selectFps.value),
    sendAudio: toggleAudio.checked,
  });
}

btnShare.addEventListener('click', shareSelected);
document.getElementById('btn-cancel').addEventListener('click', () => window.splitcordPicker.cancel());
