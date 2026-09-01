'use strict';

const { Tray, Menu, app, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const { loadAppIcon } = require('./icon');
const { getDpiStatus } = require('./serviceClient');
const voiceState = require('./voiceState');
const notificationBadge = require('./notificationBadge');
const { readLocalSettings } = require('./localSettings');
const { openSettingsWindow } = require('./ipc');

let tray = null;
let badgedBaseIcon = null;
let overlayDotIcon = null;

const RESOURCES_DIR = path.join(__dirname, '..', '..', 'resources');

// Öncelik sırası önemli: sağırlaştırma zaten mikrofonu da susturuyor sayıldığından en üstte.
// Konuşma tespiti kaldırıldı (güvenilmez çıktı) — ses kanalındayken (susturma/sağırlaştırma
// yoksa) her zaman açık yeşil renkli çember (tray-icon-voice-speaking.png) kullanılıyor.
function iconFileForState(state) {
  if (!state.connected) return 'tray-icon.png';
  if (state.deafened) return 'tray-icon-deafened.png';
  if (state.muted) return 'tray-icon-muted.png';
  return 'tray-icon-voice-speaking.png';
}

function createTray(mainWindow) {
  const icon = loadAppIcon(path.join(RESOURCES_DIR, 'tray-icon.png'), 32);
  tray = new Tray(icon);
  tray.setToolTip('SplitCord-Turkey');

  // Renderer (titlebar.js), temel tray ikonunun üzerine kırmızı bildirim rozeti eklenmiş
  // bir sürümünü bir <canvas> ile üretip burada bunun üzerinden main sürece gönderiyor —
  // main sürecin kendisinde piksel çizim/kompozisyon API'si yok, bu yüzden en basit
  // bağımlılıksız yol bu (bkz. titlebar.js generateBadgedTrayIcon).
  ipcMain.handle('tray:register-badged-icon', (_event, dataUrl) => {
    try {
      badgedBaseIcon = nativeImage.createFromDataURL(dataUrl);
    } catch {
      badgedBaseIcon = null;
    }
    // Rozetin içindeki SAYI değişmiş olabilir (aynı "badge gösteriliyor" durumu içinde) —
    // refreshTrayIcon()'un normal önbellekleme anahtarı yalnızca hangi İKON DOSYASININ
    // gösterileceğine bakıyor, rozetin içeriğine değil; bu yüzden burada anahtarı elle
    // sıfırlayıp yeni görseli GARANTİ uygulatıyoruz.
    currentIconKey = null;
    refreshTrayIcon();
    return true;
  });

  // Görev çubuğundaki UYGULAMA ikonu için — Windows'un kendi setOverlayIcon() API'si,
  // gönderilen küçük ikonu mevcut uygulama ikonunun üzerine kendisi bindiriyor; bu
  // yüzden (tray'in aksine) yalnızca küçük bir nokta yeterli, temel ikonu ayrıca
  // birleştirmeye gerek yok (bkz. titlebar.js generateNotificationBadgeIcons).
  ipcMain.handle('window:register-notification-overlay-icon', (_event, dataUrl) => {
    try {
      overlayDotIcon = nativeImage.createFromDataURL(dataUrl);
      refreshTaskbarOverlay();
    } catch {
      overlayDotIcon = null;
    }
    return true;
  });

  // DPI durumu 15 sn'de bir arkaplanda tazelenip burada önbelleğe alınıyor (HTTP isteği
  // gerektirdiği için sağ tık anında beklemeye değmez); görünürlük ise senkron ve ucuz
  // olduğu için HER sağ tıkta anlık hesaplanıyor — bu sayede etiket asla eski kalmıyor.
  let cachedStatusLabel = 'DPI servisi bulunamadı';

  const refreshStatusLabel = async () => {
    try {
      const status = await getDpiStatus();
      const active = status.engines?.find((e) => e.id === status.activeEngineId);
      cachedStatusLabel = active
        ? `DPI: ${active.displayName} (${active.running ? 'Aktif' : 'Başlatılıyor'})`
        : 'DPI servisi bulunamadı';
    } catch {
      cachedStatusLabel = 'DPI servisi bulunamadı';
    }
  };

  // Ses kanalında/aramadayken sağ tık menüsüne mikrofon/sağırlaştırma/bağlantı kesme
  // eklenir (Discord'un web sayfasındaki ilgili butona programatik tıklama ile).
  const buildMenu = () => {
    const visible = mainWindow.isVisible();
    const state = voiceState.getLastState();

    const items = [
      { label: cachedStatusLabel, enabled: false },
      { type: 'separator' },
      {
        label: visible ? "SplitCord'u Gizle" : "SplitCord'u Göster",
        click: () => {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
    ];

    if (state.connected) {
      items.push(
        { type: 'separator' },
        { label: state.muted ? 'Mikrofonu Aç' : 'Mikrofonu Sustur', click: () => voiceState.toggleMute() },
        { label: state.deafened ? 'Sağırlaştırmayı Kapat' : 'Sağırlaştır', click: () => voiceState.toggleDeafen() },
        { label: 'Bağlantıyı Kes', click: () => voiceState.disconnect() },
      );
    }

    items.push(
      { type: 'separator' },
      { label: 'Ayarlar', click: () => openSettingsWindow() },
      { type: 'separator' },
      {
        label: 'Çıkış',
        click: () => {
          mainWindow.isQuitting = true;
          app.quit();
        },
      },
    );

    return Menu.buildFromTemplate(items);
  };

  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // setContextMenu OS'a "sağ tıklayınca bu menüyü göster" der ve statik bir menüyü
  // önceden bağlar — ama biz her seferinde tazesini istediğimiz için setContextMenu
  // hiç kullanmıyoruz; sağ tıkta menüyü elle (popUpContextMenu ile) gösteriyoruz.
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));

  // Ses durumu (mute/deafen/bağlı) VE okunmamış bildirim rozeti aynı ikonu paylaşıyor —
  // ikisi de değişince aynı fonksiyonu tetikleyip son duruma göre tek bir yerden karar
  // veriyoruz. Rozet yalnızca "standart" (ses kanalında olmayan) ikondayken gösteriliyor.
  // ÖNEMLİ: showBadge, badgedBaseIcon'un GERÇEKTEN hazır olup olmadığını da içermeli —
  // aksi halde ikon henüz hazır değilken hesaplanan key ('...#badge') önbelleğe
  // yazılıyor, ikon SONRADAN hazır olduğunda AYNI key tekrar hesaplanıp "değişmedi"
  // sanılarak güncelleme atlanıyordu (rozet hiç görünmüyordu).
  let currentIconKey = null;
  function refreshTrayIcon() {
    const state = voiceState.getLastState();
    const file = iconFileForState(state);
    const showBadge =
      file === 'tray-icon.png' && !!badgedBaseIcon && notificationBadge.getHasUnread() && readLocalSettings().notificationBadgeEnabled;
    const key = showBadge ? 'tray-icon.png#badge' : file;
    if (key === currentIconKey) return;
    currentIconKey = key;

    tray.setImage(showBadge ? badgedBaseIcon : loadAppIcon(path.join(RESOURCES_DIR, file), 32));

    let tooltip = 'SplitCord-Turkey';
    if (state.connected) {
      tooltip += ` — ${state.deafened ? 'Sağırlaştırıldı' : state.muted ? 'Susturuldu' : 'Ses kanalında'}`;
    } else if (showBadge) {
      tooltip += ' — Okunmamış bildirim';
    }
    tray.setToolTip(tooltip);
  }

  // Görev çubuğu ikonundaki rozet, tray'deki "standart ikon" kısıtlamasına tabi
  // değil — uygulamanın kendi ikonu ses kanalı durumuna göre hiç değişmiyor, bu yüzden
  // yalnızca okunmamış bildirim + ayar açık mı'ya bakıyor.
  function refreshTaskbarOverlay() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const show = !!overlayDotIcon && notificationBadge.getHasUnread() && readLocalSettings().notificationBadgeEnabled;
    mainWindow.setOverlayIcon(show ? overlayDotIcon : null, show ? 'Okunmamış bildirim' : '');
  }

  voiceState.onVoiceStateChanged(() => refreshTrayIcon());
  notificationBadge.setOnChanged(({ unreadCount }) => {
    // Rozetin GÖRSELİ (üzerindeki sayı dahil) main süreçte değil renderer'da (titlebar.js,
    // canvas ile) çiziliyor — bu yüzden burada yalnızca "yeniden çiz" isteği gönderiyoruz;
    // asıl tray/overlay ikonu güncellemesi renderer'ın registerBadgedTrayIcon/
    // registerNotificationOverlayIcon çağrıları geri geldiğinde gerçekleşiyor.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification-badge:count-changed', unreadCount);
    }
    refreshTaskbarOverlay();
  });

  refreshStatusLabel();
  const refreshTimer = setInterval(refreshStatusLabel, 15000);
  app.on('before-quit', () => {
    clearInterval(refreshTimer);
    // Gerçek çıkışta ikonu açıkça yok ediyoruz — Windows'un kendi görev çubuğu bazen
    // süreç sonlandıktan sonra bile bir sonraki fare geçişine kadar "hayalet" bir
    // ikon bırakabiliyor, bunu elle destroy() etmek bu riski azaltıyor.
    if (tray && !tray.isDestroyed()) tray.destroy();
  });

  return tray;
}

module.exports = { createTray };
