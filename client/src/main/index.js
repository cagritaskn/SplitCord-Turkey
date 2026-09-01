'use strict';

const { app } = require('electron');
const { createMainWindow, getMainWindow } = require('./window');
const { applyShortcutsFromSettings, unregisterGlobalShortcuts } = require('./shortcuts');
const { createTray } = require('./tray');
const { registerPermissions, configureBrowserIdentity } = require('./permissions');
const { registerIpcHandlers } = require('./ipc');
const { applyDpiProxy } = require('./dpiProxy');
const { startConfiguredEngine, registerShutdownHook } = require('./dpiLifecycle');
const { configureSecureDns } = require('./secureDns');
const { readLocalSettings, writeLocalSettings } = require('./localSettings');
const { applyAutoStart } = require('./autostart');
const { registerScreenSharePicker } = require('./screenSharePicker');
const updateChecker = require('./updateChecker');
const { logEvent } = require('./log');
const { registerProtocolHandler, extractProtocolUrlFromArgv, parseDiscordUri } = require('./protocolHandler');
const { startRichPresence } = require('./richPresence');
const serviceClient = require('./serviceClient');

// Ana süreçte yakalanmamış bir hata (ör. arRPC köprü portu çakışması, beklenmeyen bir
// çökme) Electron'un varsayılan hata penceresini gösterse de süreci HER ZAMAN güvenilir
// şekilde sonlandırmıyor — bu da (ör. arRPC'nin tuttuğu 1337 portu gibi) zombi bir süreç
// kalıp bir SONRAKİ açılışın AYNI hatayla tekrar çökmesine yol açabiliyor. Bu yüzden böyle
// bir hata olduğunda: aktif DPI motorlarını (varsa) durdurup, süreci TAMAMEN (app.exit,
// normal 'before-quit' akışını beklemeden) sonlandırıyoruz. DPI Service'in kendisi (SYSTEM,
// bağımsız Windows Service) bundan etkilenmiyor/kapanmıyor — yalnızca bu istemcinin kendi
// süreçleri/portları ve servisteki aktif motor süreçleri (ciadpi.exe/goodbyedpi.exe/
// winws.exe) temizleniyor, servis kaydedilmiş ayarlarla ayakta kalmaya devam ediyor.
let handlingFatalError = false;
async function handleFatalMainProcessError(err) {
  if (handlingFatalError) return;
  handlingFatalError = true;

  logEvent('fatal-main-process-error', { error: err?.message, stack: err?.stack });

  try {
    // stopAllEngines'in kendi zaman aşımı 20 dakikaya kadar çıkabiliyor (aday taraması
    // sürüyorsa) — çöken bir süreçte bu kadar beklemek anlamsız, 5sn'de sınırlıyoruz.
    await Promise.race([
      serviceClient.stopAllEngines(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (stopErr) {
    logEvent('fatal-main-process-error-stop-failed', { error: stopErr.message });
  }

  app.exit(1);
}

process.on('uncaughtException', handleFatalMainProcessError);
process.on('unhandledRejection', (reason) => {
  handleFatalMainProcessError(reason instanceof Error ? reason : new Error(String(reason)));
});

function navigateToProtocolUrl(mainWindow, argv) {
  const protocolUrl = extractProtocolUrlFromArgv(argv);
  if (!protocolUrl) return;
  const targetUrl = parseDiscordUri(protocolUrl);
  logEvent('protocol-url-activated', { protocolUrl, targetUrl });
  mainWindow.webContents.send('app:navigate-to-discord-url', targetUrl);
}

// Windows'ta protokol aktivasyonu (discord:// bir bağlantıya tıklanması) macOS'taki gibi
// 'open-url' olayı DEĞİL, uygulamayı "SplitCord-Turkey.exe discord://..." şeklinde yeni
// bir argümanla başlatmak (ya da tekil örnek kilidi varsa 'second-instance'a
// yönlendirmek) olarak geliyor — bu yüzden hem ilk açılışta process.argv'yi hem de
// second-instance'ın kendi argv'sini kontrol etmemiz gerekiyor.

// Bazı ortamlarda (GPU sürücüsü/VM kombinasyonuna bağlı) Chromium'un GPU süreciyle
// ilgili kararsızlıklar görülebilir; Ayarlar > Genel'den kapatılabilir. Bu API
// yalnızca whenReady()'den ÖNCE çağrılabildiği için ayar, DPI Service'in HTTP
// API'sinden değil, senkron okunan yerel bir dosyadan geliyor (bkz. localSettings.js).
if (!readLocalSettings().gpuAcceleration) {
  app.disableHardwareAcceleration();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      navigateToProtocolUrl(win, argv);
    }
  });

  app.whenReady().then(async () => {
    // Otomatik başlatma + arkaplanda başlatma varsayılan olarak açık gelsin, ama
    // yalnızca BİR KEZ — kullanıcı sonradan Ayarlar'dan kapatırsa bir sonraki açılışta
    // tekrar zorla açılmamalı (bkz. localSettings.js autostartDefaultApplied).
    if (!readLocalSettings().autostartDefaultApplied) {
      applyAutoStart(true, true);
      writeLocalSettings({ autostartDefaultApplied: true });
    }

    configureSecureDns();
    registerPermissions();
    configureBrowserIdentity();
    registerScreenSharePicker();
    registerShutdownHook();
    registerProtocolHandler();
    startRichPresence();

    // Pencereyi hemen göster (renderer "Bağlantı hazırlanıyor…" durumunu gösterir);
    // ByeDPI doğrulanmamışsa birden çok stratejiyi sırayla deneyip test etmek onlarca
    // saniye sürebilir, bu yüzden pencere açılışını buna bekletmiyoruz.
    const mainWindow = createMainWindow();
    createTray(mainWindow);
    registerIpcHandlers();
    // Ayarlar > Tuş Atamaları'ndaki ana anahtar/kombinasyonlara göre kaydediyor — bir
    // ayar değiştiğinde ipc.js aynı fonksiyonu tekrar çağırarak yeniden kuruyor.
    applyShortcutsFromSettings();
    app.on('will-quit', unregisterGlobalShortcuts);

    // Motoru başlat, sonra webview navigasyona başlamadan önce Discord session'ının
    // proxy'sini ayarla — sıra önemli: proxy uygulanmadan önce motor çalışır durumda
    // olmalı, yoksa proxyAddress henüz yok diye 'direct' moda düşer. Bitince renderer'a
    // haber ver ki webview'e ilk kez src atansın (ya da hata mesajı gösterilsin).
    await startConfiguredEngine();
    await applyDpiProxy();
    mainWindow.webContents.send('dpi:engine-changed');

    // Uygulama discord:// bir bağlantı ile SIFIRDAN başlatıldıysa (ör. tekil örnek
    // kilidini biz aldık, ikinci bir kopya değil) argv'de protokol URL'i olabilir —
    // yukarıdaki normal discord.com/app navigasyonundan SONRA gönderiyoruz ki
    // webview zaten var olsun ve deep-link hedefi normal navigasyonu ezsin.
    navigateToProtocolUrl(mainWindow, process.argv);

    // Açılışta otomatik güncelleme kontrolü — sessizce (hata varsa sadece log'a düşer,
    // kullanıcıyı rahatsız etmez); bulunursa titlebar'daki "Güncelleme Mevcut" butonu
    // 'app:update-available' olayıyla görünür hale gelir.
    updateChecker
      .checkForUpdate()
      .then((result) => {
        logEvent('startup-update-check-result', result);
        if (result.available) {
          mainWindow.webContents.send('app:update-available', result);
        }
      })
      .catch((err) => logEvent('startup-update-check-error', { error: err.message }));
  });

  // Bildirimlerin ve arkaplan durumunun çalışmaya devam etmesi için tüm pencereler
  // kapansa bile uygulamayı sonlandırmıyoruz; gerçek çıkış yalnızca tray menüsünden.
  app.on('window-all-closed', () => {});
}
