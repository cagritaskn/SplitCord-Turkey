'use strict';

const { BrowserWindow, shell, nativeTheme } = require('electron');
const path = require('node:path');
const { loadAppIcon } = require('./icon');
const { startDynamicColorSampling, setOnPaletteChanged } = require('./dynamicColor');
const { startVoiceStatePolling } = require('./voiceState');
const navigation = require('./navigation');
const notificationBadge = require('./notificationBadge');
const { readLocalSettings } = require('./localSettings');
const { startBackgroundPriorityManagement } = require('./backgroundPriority');
const { isAllowedPopoutOrigin } = require('./permissions');

// KULLANICI TALEBİ: uygulama içinde açılan pencereler (popout'lar, Vencord popup'ları
// vb.) VARSAYILAN Electron çerçevesini kullanıyor -- bu THEME'e (aydınlık/karanlık) hiç
// saygı göstermiyordu, Windows'ta hep AÇIK renkli bir native başlık çubuğu gösteriyordu.
// nativeTheme.themeSource Windows 10 1809+'ta TÜM yeni pencerelerin native başlık çubuğu/
// çerçeve rengini etkiliyor -- dynamicColor.js'in canlı örneklediği palete göre (isDark)
// senkronize ediliyor. (Ana pencerenin kendi özel/çerçevesiz başlık çubuğu zaten
// theme.css üzerinden ayrı yönetiliyor, bundan etkilenmiyor.)
setOnPaletteChanged((palette) => {
  nativeTheme.themeSource = palette.isDark ? 'dark' : 'light';
});

// KULLANICI TALEBİ: popout pencerelerinde (Discord Aktiviteleri/yayınları "Pencere
// Modu"na alındığında) Discord'un kendi window.open() çağrısındaki boyut bilgisini
// (features string'i, ör. "width=1280,height=720") kullanıyoruz -- statik bir boyut
// yerine Discord'un GERÇEKTEN istediği boyutu onurlandırmak daha doğru. Kullanıcı
// talebi üzerine yüksekliğe küçük bir pay ekleniyor (popout'un kendi başlık/kontrol
// çubuğu genelde bu kadar yer kaplıyor, aksi halde içerik hafif kırpılmış görünüyordu).
const POPOUT_EXTRA_HEIGHT = 60;
const POPOUT_FALLBACK_WIDTH = 960;
const POPOUT_FALLBACK_HEIGHT = 760;

function parseWindowFeatures(features) {
  const result = {};
  if (!features) return result;
  for (const part of features.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey && rawKey.trim();
    if (!key || rawValue === undefined) continue;
    const num = Number(rawValue.trim());
    if (!Number.isNaN(num) && rawValue.trim() !== '') result[key] = num;
  }
  return result;
}

let mainWindow = null;
let attachedWebviewContents = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    backgroundColor: '#313338',
    show: false,
    icon: loadAppIcon(path.join(__dirname, '..', '..', 'resources', 'icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Pencere tepsiye küçültülüp gizlense (arkaplanda) bile sesli/görüntülü konuşma
      // ve ekran paylaşımının kesilmemesi için Chromium'un varsayılan arkaplan
      // kısıtlamasını (timer/animasyon yavaşlatma) kapatıyoruz.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // <webview> kendi ayrı WebContents'i olduğu için üstteki backgroundThrottling:false
  // otomatik miras kalmıyor — Discord'un asıl içeriğini barındıran webview'in kendi
  // WebContents'inde de açıkça kapatmamız gerekiyor.
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setBackgroundThrottling(false);
    // Ayarlar > Görünüm'deki "Discord temasına göre otomatik renk" — titlebar/pencere
    // arkaplanını Discord sayfasının en üstündeki renge göre canlı olarak ayarlar.
    startDynamicColorSampling(webContents, mainWindow);
    // Tray ikonunu ses kanalı/arama durumuna göre değiştirmek için (bkz. tray.js).
    startVoiceStatePolling(webContents, mainWindow);
    // Global Tuş Atamaları > İleri git / Geri git (bkz. navigation.js, shortcuts.js).
    navigation.attachWebContents(webContents);
    // Tray ikonundaki okunmamış bildirim rozeti için (bkz. notificationBadge.js, tray.js).
    notificationBadge.startTracking(webContents);
    // Ayarlar > Genel'deki "Bağlantıları varsayılan sistem tarayıcısında aç" — açıksa
    // sistem tarayıcısına yönlendirip Electron'un kendi popup penceresini engelliyoruz;
    // kapalıysa (varsayılan) Electron'un mevcut davranışı (uygulama içi popup pencere)
    // devam ediyor.
    //
    // GERÇEK BUG (canlı testte bulundu): bu kontrol http(s) dışı URL'leri de "harici link"
    // sayıp shell.openExternal'a veriyordu -- Vencord'un QuickCSS düzenleyicisi (ve benzeri
    // uygulama-içi popup'lar) window.open("about:blank", ...) çağırıyor, bu da Windows'un
    // "about" protokolü için hiç uygulama bulamayıp "Microsoft Store'da ara" diyaloğunu
    // göstermesine, ardından pencere reddedildiği (deny) için Vencord'un kendi
    // "if (!win) alert(...)" dalına düşmesine yol açıyordu. "Harici link" kavramı yalnızca
    // gerçek web adresleri (http/https) için anlamlı -- about:/blob:/data: gibi uygulama-içi
    // popup'lar HER ZAMAN normal bir Electron alt penceresi olarak açılmalı.
    webContents.setWindowOpenHandler(({ url, features }) => {
      // GERÇEK BUG (kullanıcı raporu, canlı testte doğrulandı -- bir Aktivite'yi (Wordle)
      // "Pencere Modu"na alınca discord.com kökenli bir URL sistem tarayıcısında (Chrome)
      // açılıyordu): "harici link" kontrolü discord.com'un KENDİ pencerelerini (aktivite/
      // yayın "Pencere Modu" popout'ları) de "harici" sayıyordu, çünkü tek kontrol http(s)
      // olup olmadığıydı, kökene hiç bakmıyordu. discord.com (ve alt kökenleri) kökenli bir
      // pencere GERÇEKTEN harici DEĞİL -- bu yüzden permissions.js'teki AYNI izin verilen
      // köken listesiyle (permissions.js isAllowedPopoutOrigin -- discordsays.com/Aktivite
      // iframe'lerini de kapsayan AYRI/daha geniş bir liste, bkz. o dosyadaki not) süzülüyor;
      // yalnızca GERÇEKTEN başka bir siteye
      // (ör. bir mesajdaki linke tıklanması) giden pencereler "harici" sayılıyor. KULLANICI
      // TALEBİ ÜZERİNE: discord.com kökenli pencereler "Bağlantıları varsayılan sistem
      // tarayıcısında aç" ayarından TAMAMEN BAĞIMSIZ olarak HER ZAMAN uygulama içinde açılır
      // -- o ayar yalnızca GERÇEKTEN harici sitelere uygulanıyor.
      const isDiscordOwnWindow = /^https?:\/\//i.test(url) && isAllowedPopoutOrigin(url);
      const isExternalWebLink = /^https?:\/\//i.test(url) && !isDiscordOwnWindow;
      if (isExternalWebLink && readLocalSettings().openLinksExternally) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      // discord.com kökenli pencereler (popout'lar dahil) uygulama içi bir Electron
      // penceresi olarak açılıyor -- overrideBrowserWindowOptions ile bizim marka
      // simgemiz ve koyu bir arkaplan (Discord'un kendi arkaplanıyla aynı -- pencere
      // ilk açılırken beyaz bir yanıp sönme olmasın diye) veriliyor, aksi halde
      // Electron'un varsayılan (simgesiz/beyaz) penceresi görünürdü. Menü çubuğu
      // (File/Edit/View/Window) aşağıdaki did-create-window'da kaldırılıyor -- burada
      // henüz gerçek BrowserWindow nesnesi yok, yalnızca seçenekler.
      const overrideBrowserWindowOptions = {
        icon: loadAppIcon(path.join(__dirname, '..', '..', 'resources', 'icon.png')),
        backgroundColor: '#313338',
      };
      if (isDiscordOwnWindow) {
        const parsedFeatures = parseWindowFeatures(features);
        overrideBrowserWindowOptions.width = parsedFeatures.width || POPOUT_FALLBACK_WIDTH;
        overrideBrowserWindowOptions.height = parsedFeatures.height
          ? parsedFeatures.height + POPOUT_EXTRA_HEIGHT
          : POPOUT_FALLBACK_HEIGHT;
      }
      return { action: 'allow', overrideBrowserWindowOptions };
    });
    // KULLANICI TALEBİ: popout/aktivite pencerelerinde (ve genel olarak uygulama içinde
    // açılan tüm pencerelerde) File/Edit/View/Window gibi bir masaüstü tarayıcı menü
    // çubuğu ANLAMSIZ -- removeMenu() ile tamamen kaldırılıyor (autoHideMenuBar'ın aksine
    // Alt tuşuyla bile geri gelmiyor). setWindowOpenHandler yalnızca SEÇENEKLERİ
    // belirleyebiliyor, gerçek BrowserWindow nesnesine burada (pencere oluşturulduktan
    // hemen sonra) erişiliyor.
    webContents.on('did-create-window', (childWindow, details) => {
      childWindow.removeMenu();
      // GERÇEK BUG (kullanıcı raporu, canlı testte doğrulandı): Aktivite (Wordle)
      // "Etkinlikten Ayrıl" ile bitirildiğinde, popout penceresi KENDİ KENDİNE
      // KAPANMIYORDU -- Discord'un popout sayfası (discord.com/popout) aktivite
      // bittiğinde window.close() hiç ÇAĞIRMIYOR, yalnızca kendi İÇİNDE normal ses
      // kanalı görünümüne (Aktivite Seç butonu, "Nasıl geçti?" anketi) dönüyor. Bu
      // yüzden aktivitenin/yayının GERÇEKTEN bitip bitmediğini KENDİMİZ tespit edip
      // pencereyi biz kapatıyoruz: Aktivite iframe'i (discordsays.com) VEYA bir yayın
      // <video> elemanı DAHA ÖNCE vardı ve şimdi YOKSA (geçiş anı), popout'un artık
      // gösterecek içeriği kalmadığı anlamına gelir. Canlı testte doğrulandı: Aktivite
      // bitişi bu şekilde doğru tespit edilip pencere kapatılıyor. Yayın (ekran
      // paylaşımı) bitişi için AYNI mantık uygulandı (<video> kontrolü) ama gerçek bir
      // yayınla canlı doğrulanamadı (test sırasında aktif bir yayın yoktu) -- makul bir
      // genelleme, Discord'un popout'u yayın bittiğinde <video> elemanını kaldırması
      // beklenir.
      const isDiscordPopout = /^https?:\/\//i.test(details.url) && isAllowedPopoutOrigin(details.url);
      if (!isDiscordPopout) return;
      childWindow.webContents.once('did-finish-load', () => {
        childWindow.webContents.executeJavaScript(`
          (function() {
            function hasActiveContent() {
              return !!(document.querySelector('iframe[src*="discordsays.com"]') || document.querySelector('video'));
            }
            let wasActive = hasActiveContent();
            const observer = new MutationObserver(() => {
              const isActive = hasActiveContent();
              if (wasActive && !isActive) {
                window.close();
              }
              wasActive = isActive;
            });
            observer.observe(document.body, { childList: true, subtree: true });
          })();
        `).catch(() => {});
      });
    });
    attachedWebviewContents = webContents;
    webContents.on('destroyed', () => {
      if (attachedWebviewContents === webContents) attachedWebviewContents = null;
    });
  });

  // Windows ile otomatik başlatma "--hidden" argümanıyla gelir (bkz. autostart.js):
  // bu durumda pencereyi göstermeden yalnızca tray'de arkaplanda başlıyoruz.
  const startHidden = process.argv.includes('--hidden');
  if (!startHidden) {
    mainWindow.once('ready-to-show', () => mainWindow.show());
  }

  // Resmi Discord istemcisiyle aynı davranış: pencereyi kapatmak uygulamayı kapatmaz,
  // arka planda kalır (bildirimler ve DPI durumu böylece çalışmaya devam eder).
  // Gerçek çıkış yalnızca tray menüsünden (mainWindow.isQuitting=true set edilerek) yapılır.
  mainWindow.on('close', (event) => {
    if (!mainWindow.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // KULLANICI TALEBİ: tam ekran oyunlarda (League of Legends gibi) FPS düşüşü --
  // yalnızca Ayarlar > Performans Modu açıkken devreye giriyor (bkz. backgroundPriority.js).
  startBackgroundPriorityManagement(mainWindow);

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function getAttachedWebviewContents() {
  return attachedWebviewContents;
}

module.exports = { createMainWindow, getMainWindow, getAttachedWebviewContents };
