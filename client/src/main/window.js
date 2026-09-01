'use strict';

const { BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { loadAppIcon } = require('./icon');
const { startDynamicColorSampling } = require('./dynamicColor');
const { startVoiceStatePolling } = require('./voiceState');
const notificationBadge = require('./notificationBadge');
const { readLocalSettings } = require('./localSettings');

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
    startVoiceStatePolling(webContents);
    // Tray ikonundaki okunmamış bildirim rozeti için (bkz. notificationBadge.js, tray.js).
    notificationBadge.startTracking(webContents);
    // Ayarlar > Genel'deki "Bağlantıları varsayılan sistem tarayıcısında aç" — açıksa
    // sistem tarayıcısına yönlendirip Electron'un kendi popup penceresini engelliyoruz;
    // kapalıysa (varsayılan) Electron'un mevcut davranışı (uygulama içi popup pencere)
    // devam ediyor.
    webContents.setWindowOpenHandler(({ url }) => {
      if (readLocalSettings().openLinksExternally) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
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

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function getAttachedWebviewContents() {
  return attachedWebviewContents;
}

module.exports = { createMainWindow, getMainWindow, getAttachedWebviewContents };
