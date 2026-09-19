'use strict';

// Ana pencere/Ayarlar'daki gibi bu pencere de aktif renk tercihine (Otomatik: Discord
// temasından örneklenen; ya da sabit bir ön ayar) uyum sağlasın — bkz. titlebar.js
// applyDynamicPalette, main/dynamicColor.js.
function applyDynamicPalette(palette) {
  if (!palette) return;
  const root = document.documentElement.style;
  root.setProperty('--sc-bg-primary', palette.primary);
  root.setProperty('--sc-bg-secondary', palette.secondary);
  root.setProperty('--sc-bg-tertiary', palette.tertiary);
  root.setProperty('--sc-bg-hover', palette.hover);
  root.setProperty('--sc-text-normal', palette.textNormal);
  root.setProperty('--sc-text-muted', palette.textMuted);
}
// Pencere show:false ile açılıyor -- paleti burada, İLK BOYAMADAN ÖNCE senkron uyguluyoruz ki
// pencere bir an bile varsayılan (theme.css) renkleriyle görünmesin; main süreç ayrıca
// did-finish-load'da aynı paleti tekrar gönderiyor (aşağıdaki dinleyici).
applyDynamicPalette(window.splitcordPicker.getInitialPalette());
window.splitcordPicker.onDynamicColorSampled(applyDynamicPalette);

const emptyHint = document.getElementById('empty-hint');
const tabs = {
  windows: document.getElementById('tab-windows'),
  screens: document.getElementById('tab-screens'),
};
const grids = {
  windows: document.getElementById('grid-windows'),
  screens: document.getElementById('grid-screens'),
};
const selectQuality = document.getElementById('select-quality');
const selectFps = document.getElementById('select-fps');
const toggleAudio = document.getElementById('toggle-audio');

const QUALITY_PRESETS = {
  source: null,
  1440: { width: 2560, height: 1440 },
  1080: { width: 1920, height: 1080 },
  720: { width: 1280, height: 720 },
  480: { width: 854, height: 480 },
  144: { width: 256, height: 144 },
};

let selectedId = null;
let currentTab = 'windows';
let hasSources = false;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function clearSelection() {
  selectedId = null;
  document.querySelectorAll('.source-card.selected').forEach((el) => el.classList.remove('selected'));
}

function selectCard(id, card) {
  clearSelection();
  selectedId = id;
  card.classList.add('selected');
}

function updateEmptyHint() {
  if (!hasSources) return;
  const isEmpty = grids[currentTab].childElementCount === 0;
  emptyHint.hidden = !isEmpty;
  if (isEmpty) emptyHint.textContent = 'Bu sekmede paylaşılabilecek bir şey yok.';
}

function switchTab(name) {
  currentTab = name;
  clearSelection();
  for (const key of Object.keys(tabs)) {
    tabs[key].classList.toggle('active', key === name);
    grids[key].hidden = key !== name;
  }
  updateEmptyHint();
}

for (const [name, button] of Object.entries(tabs)) {
  button.addEventListener('click', () => switchTab(name));
}

// Sekmedeki monitör simgesiyle aynı çizim; "Tüm Ekran" kartlarının etiketinde kullanılıyor.
const MONITOR_ICON_SVG =
  '<svg class="source-icon source-icon-monitor" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="2" y="3" width="20" height="14" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>';

// desktopCapturer ekran adları işletim sistemi diline göre "Screen 1" / "Ekran 1" gelir (tek
// monitörde "Entire screen" olabilir); numarayı addan alıyoruz, yoksa listedeki sıraya düşüyoruz.
function screenLabel(source, index) {
  const match = /(\d+)\s*$/.exec(source.name || '');
  return 'Ekran ' + (match ? match[1] : index + 1);
}

function renderCard(source, container, screenIndex = null) {
  const isScreen = screenIndex !== null;
  const name = isScreen ? screenLabel(source, screenIndex) : source.name;
  const icon = isScreen
    ? MONITOR_ICON_SVG
    : source.appIcon
      ? `<img class="source-icon" src="${source.appIcon}" alt="" />`
      : '';
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = `
    <div class="source-thumb-wrap">
      ${source.thumbnail ? `<img class="source-thumb" src="${source.thumbnail}" alt="" />` : ''}
      <button class="source-share-btn" type="button">Ekran Paylaş</button>
    </div>
    <div class="source-label">
      ${icon}
      <span class="source-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    </div>
  `;
  // Kartın herhangi bir yerine (önizleme, isim, "Ekran Paylaş" düğmesi) tek tıklamak yayını
  // başlatır -- düğme yalnızca görsel bir ipucu, tıklaması karta yükselip aynı işi yapıyor.
  card.addEventListener('click', () => {
    selectCard(source.id, card);
    shareSelected();
  });
  container.appendChild(card);
}

window.splitcordPicker.onSources((sources) => {
  grids.windows.innerHTML = '';
  grids.screens.innerHTML = '';
  clearSelection();

  if (!sources.length) {
    hasSources = false;
    emptyHint.textContent = 'Paylaşılabilecek bir ekran/pencere bulunamadı.';
    emptyHint.hidden = false;
    grids.windows.hidden = true;
    grids.screens.hidden = true;
    return;
  }
  hasSources = true;

  // desktopCapturer kaynak id'leri "window:XX:YY" ya da "screen:ZZ:0" biçiminde —
  // program pencerelerini ("Uygulamalar") ve tam monitörleri ("Tüm Ekran") bu önekle ayırıyoruz.
  const windows = sources.filter((s) => s.id.startsWith('window:'));
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  for (const source of windows) renderCard(source, grids.windows);
  screens.forEach((source, index) => renderCard(source, grids.screens, index));

  switchTab(windows.length > 0 || screens.length === 0 ? 'windows' : 'screens');
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

document.getElementById('btn-cancel').addEventListener('click', () => window.splitcordPicker.cancel());

// Exclusive tam ekran oyunları pencere listesinde görünmez (Windows/Chromium bu pencereleri
// normal pencere olarak listelemiyor) -- kullanıcıya nedenini ve çözümünü uygulamanın diğer
// diyaloglarıyla aynı modal'da anlatıyoruz.
document.getElementById('btn-missing-games').addEventListener('click', () => {
  window.showAlertModal({
    title: 'Oyunlarım neden listede yok?',
    message:
      'Exclusive (özel) tam ekran modunda çalışan oyunlar ekranı doğrudan kendi kontrolüne alır ve ' +
      'normal bir pencere gibi davranmaz. Bu yüzden uygulama pencereleri listesinde görüntülenemezler.',
    detail:
      'Çözüm: Oyunun görüntü ayarlarından ekran modunu "Çerçevesiz tam ekran" (Borderless / Windowed ' +
      'Fullscreen) olarak değiştirin. Bu modda oyun normal bir pencere gibi çalıştığı için listede ' +
      'görünür. Oyununuzun ekran modunu değiştirdikten sonra bu pencereyi tekrar açmanız gerekebilir. ' +
      'Alternatif bir çözüm olarak tüm ekranı paylaştığınızda oyunlarınız ekran paylaşımında görüntülenebilir.',
  });
});

document.addEventListener('keydown', (event) => {
  // Bir modal açıkken Esc/Enter yalnızca modal'a ait olmalı (Esc seçiciyi kapatmamalı,
  // Enter seçili kaynağı paylaşmamalı).
  if (document.querySelector('.sc-modal-overlay')) return;
  if (event.key === 'Escape') window.splitcordPicker.cancel();
  // Odaklı bir düğme/seçim kutusundayken Enter o öğenin kendi işini yapsın (ör. yukarıdaki bağlantı).
  else if (event.key === 'Enter' && selectedId && !event.target.closest?.('button, select')) shareSelected();
});
