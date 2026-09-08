'use strict';

const { Tray, Menu, app, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const { loadAppIcon, resolveTrayIconPath, writeIconBuffer } = require('./icon');
const { getDpiStatus } = require('./serviceClient');
const voiceState = require('./voiceState');
const notificationBadge = require('./notificationBadge');
const { readLocalSettings } = require('./localSettings');
const { openSettingsWindow } = require('./ipc');
const { logEvent } = require('./log');

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

// PORT_PLAN_2.md AP-4 (kapsam genişletmesi, 2026-09-09): "best-effort TÜM dağıtımlar" hedefiyle
// artık masaüstü ortamı da HİÇ bilinmiyor — D-21'de bulunan AppIndicator/Ayatana sürprizinin
// (bkz. yukarıdaki tray.on('click') yorumu) daha da uç bir hâli, bazı MİNİMAL pencere
// yöneticilerinde (ör. sistem tepsisi barındıran hiçbir bileşen (polybar/waybar/trayer vb.)
// çalışmayan çıplak bir i3/Hyprland/sway kurulumu) `new Tray()` HİÇ BİR StatusNotifierItem
// sunucusu bulamayınca native bir istisna FIRLATABİLİR (DOĞRULANMADI — Electron'un GNOME'daki
// "sessizce görünmez kalma" davranışından farklı olarak, sunucu TAMAMEN yoksa fırlatma ihtimali
// var). Bu, önceden HİÇ try/catch'siz olduğu için TÜM uygulamayı (pencere/motor/webview dahil)
// açılışta çökertirdi — şimdi yalnızca tray özelliğinin kendisi devre dışı kalıyor, uygulamanın
// geri kalanı (ana pencere, DPI motorları) normal çalışmaya devam ediyor.
function createTray(mainWindow) {
  try {
    return createTrayUnsafe(mainWindow);
  } catch (err) {
    logEvent('create-tray-failed', { error: err.message });
    return null;
  }
}

// KULLANICI TALEBİ (2026-09-08, CANLI TESTTE BULUNDU): AppImage'da Cinnamon panelindeki tray
// ikonu GTK'nın genel/gri "resim bulunamadı" simgesiyle geliyordu -- programın KENDİ blurple
// fallback'i DEĞİL, GTK'nın ikonu hiç ÇÖZEMEDİĞİ durumun simgesi. Kök neden: Electron'un Linux
// AppIndicator (libappindicator/Ayatana, Cinnamon'ın kullandığı) arka ucu, bellekteki bir
// nativeImage'ı KENDİSİ bir dosyaya yazıp bir ikon teması yolu olarak kaydetmeye çalışıyor, bu
// iç aktarım asar içinden okunan nativeImage'larda güvenilir çalışmıyor. Düzeltme: nativeImage
// yerine icon.js'in resolveTrayIconPath'inin döndürdüğü GERÇEK (asar dışı, kullanıcı verisi
// dizinindeki) dosya yoluna bir STRING veriyoruz -- Tray()/setImage() path string'i doğrudan
// destekliyor. resolveTrayIconPath başarısız olursa (çok nadir, ör. userData dizini yazılamıyor)
// eski nativeImage yoluna geri düşüyoruz (zararsız, yalnızca en kötü ihtimalde eski bug geri gelir).
function resolveTrayImage(file) {
  const resolvedPath = resolveTrayIconPath(path.join(RESOURCES_DIR, file), file, 32);
  return resolvedPath || loadAppIcon(path.join(RESOURCES_DIR, file), 32);
}

function createTrayUnsafe(mainWindow) {
  tray = new Tray(resolveTrayImage('tray-icon.png'));
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
  // NOT: BrowserWindow.setOverlayIcon() Electron'da YALNIZCA Windows'ta destekleniyor —
  // Linux'ta çağrısı zararsız bir no-op'tur (hata fırlatmaz, hiçbir şey yapmaz). Bildirim
  // rozeti Linux'ta yalnızca tray ikonu üzerinden görünür (bkz. refreshTrayIcon), bu bir
  // kod hatası değil — masaüstü ortamının kendisi zaten tray ikonunu (StatusNotifierItem/
  // libappindicator) desteklemiyorsa (ör. eklenti kurulmamış GNOME) o da görünmeyebilir;
  // bkz. ../../README.md dev-ortamı notu.
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
    refreshContextMenu();
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

  // Linux'ta (libappindicator/Ayatana — Cinnamon/Mint dahil çoğu modern DE'nin kullandığı
  // tray protokolü, bkz. GERÇEK CİHAZDA CANLI TESTTE BULUNDU 2026-09-04) Electron'un
  // 'click'/'right-click' event'leri HİÇ ATEŞLENMİYOR — bu yalnızca Windows/macOS'un XEmbed
  // tabanlı tray'inde çalışan bir varsayımdı, Windows'tan birebir kopyalanmıştı. AppIndicator
  // protokolü tıklamaları uygulamaya iletmiyor, yalnızca setContextMenu ile ÖNCEDEN bağlanmış
  // STATİK bir menüyü DE'nin kendisi gösteriyor — bu yüzden popUpContextMenu (on-demand/taze
  // menü) yerine setContextMenu kullanılıp, menünün içeriği değiştiren her olayda
  // (ses durumu, ana pencere görünürlüğü, DPI durum etiketi) yeniden ayarlanıyor.
  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const refreshContextMenu = () => tray.setContextMenu(buildMenu());
  mainWindow.on('show', refreshContextMenu);
  mainWindow.on('hide', refreshContextMenu);
  // Aşağıdaki refreshStatusLabel() ilk (asenkron) çağrısı sonuçlanana kadar tray'in HİÇ
  // menüsü olmasın istemiyoruz (cachedStatusLabel'ın varsayılan/geçici değeriyle de olsa).
  refreshContextMenu();

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

    // resolveTrayImage/writeIconBuffer notu (yukarıda createTrayUnsafe'te) burada da geçerli:
    // rozetli ikon da renderer'dan gelen bir nativeImage (badgedBaseIcon) DEĞİL, ondan üretilen
    // GERÇEK bir dosya yolu olarak veriliyor -- aksi halde rozet AÇIKKEN de aynı "genel/gri
    // simge" sorunu yaşanabilirdi.
    const badgedPath = showBadge ? writeIconBuffer(badgedBaseIcon.toPNG(), 'tray-icon-badged.png') : null;
    tray.setImage(badgedPath || resolveTrayImage(file));

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

  voiceState.onVoiceStateChanged(() => {
    refreshTrayIcon();
    refreshContextMenu();
  });
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
