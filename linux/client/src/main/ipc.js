'use strict';

const { app, ipcMain, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { getMainWindow, getAttachedWebviewContents } = require('./window');
const serviceClient = require('./serviceClient');
const { isAutoStartEnabled, isStartInBackgroundEnabled, applyAutoStart } = require('./autostart');
const { applyDpiProxy } = require('./dpiProxy');
const { logEvent } = require('./log');
const { readLocalSettings, writeLocalSettings, resetLocalSettings } = require('./localSettings');
const updateChecker = require('./updateChecker');
const dynamicColor = require('./dynamicColor');
const { isDefaultProtocolHandler, isOfficialDiscordInstalled, uninstallOfficialDiscord } = require('./protocolHandler');
const { showThemedConfirm } = require('./themedDialog');
const voiceState = require('./voiceState');
const notificationBadge = require('./notificationBadge');
const { applyShortcutsFromSettings } = require('./shortcuts');
const { installDpiService, uninstallDpiService, isInstallerBundled } = require('./serviceInstaller');
const { uninstallApp: uninstallAppPackage } = require('./appUninstaller');
const { isAppImage, getPackagingKind } = require('./packagingInfo');
const { loadAppIcon } = require('./icon');
const backgroundPriority = require('./backgroundPriority');
const { applySpellcheckSetting } = require('./permissions');

let settingsWindow = null;
// Ayarlar penceresindeki kaydedilmemiş değişiklik durumu, renderer'dan
// 'settings-window:set-dirty' ile senkronize edilir — pencere kapanma denemesinde
// (bizim butonumuz, Alt+F4, vs. fark etmeksizin) bu bayrağa bakılır.
let hasUnsavedChanges = false;

// Ana penceredeki renk yeniden örneklendiğinde, ayarlar penceresi açıksa onun
// arkaplanını da canlı olarak güncelle.
dynamicColor.setOnPaletteChanged((palette) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('app:dynamic-color-sampled', palette);
  }
});

// highlight: paneldeki belirli bir kontrolü (ör. bir toggle satırını) geçici olarak
// vurgulamak için opsiyonel bir öğe id'si — bkz. discordWebviewPreload.js'deki
// "SplitCord-Turkey ayarlarında bu uyarıyı devre dışı bırak" butonu, settings.js'teki
// highlightControl().
function openSettingsWindow(panel, highlight) {
  if (settingsWindow) {
    logEvent('settings-window-focused', {});
    settingsWindow.show();
    settingsWindow.focus();
    if (panel) settingsWindow.webContents.send('settings-window:navigate', panel, highlight);
    return;
  }

  logEvent('settings-window-open', {});
  hasUnsavedChanges = false;

  settingsWindow = new BrowserWindow({
    width: 860,
    height: 660,
    resizable: false,
    frame: false,
    backgroundColor: '#313338',
    parent: getMainWindow() || undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Ana pencerede olduğu gibi kapalı: preload.js require('node:path')/require('node:url')
      // kullanıyor, bunlar sandbox'lı preload'larda desteklenmiyor — sandbox açık kalırsa
      // preload sessizce başarısız oluyor ve window.splitcord hiç tanımlanmıyor (bkz.
      // "Unable to load preload script... module not found: node:path").
      sandbox: false,
    },
  });

  // Ayarlar penceresindeki target="_blank" bağlantılar (ör. Hakkında'daki GitHub linki,
  // Kaspersky uyarı modalındaki ANTIVIRUS.md linki) — webContents.setWindowOpenHandler
  // TANIMLI DEĞİLSE Electron varsayılan olarak yeni pencereyi REDDEDİYOR, yani bu handler
  // olmadan bu linkler tıklanınca sessizce hiçbir şey olmuyordu. Ana penceredeki Discord
  // webview'in kendi handler'ıyla (bkz. window.js) aynı mantık: her zaman sistem
  // tarayıcısında aç, uygulama içi bir popup pencere hiç oluşturma.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const hash = highlight ? `${panel}|${highlight}` : panel;
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'), hash ? { hash } : undefined);

  // Ayarlar penceresi arkaplanı da ana penceredeki gibi dinamik renk paletini
  // kullanıyor — pencere ilk açıldığında son bilinen paleti hemen gönderiyoruz,
  // 30 saniyelik döngünün bir sonraki turunu beklemeye gerek yok.
  settingsWindow.webContents.on('did-finish-load', () => {
    const palette = dynamicColor.getLastPalette();
    if (palette) settingsWindow.webContents.send('app:dynamic-color-sampled', palette);
  });

  let closeConfirmPending = false;
  settingsWindow.on('close', (event) => {
    if (!hasUnsavedChanges) return;
    // Onay asenkron (temaya uygun modal renderer'da gösteriliyor) olduğu için native
    // 'close' olayını burada HER ZAMAN durdurup, kullanıcı seçimi geldikten sonra
    // gerekiyorsa pencereyi tekrar close() ediyoruz — o ikinci çağrıda
    // hasUnsavedChanges zaten false olacağından bu handler baştaki satırda erken
    // dönüp kapanışı engellemeyecek.
    event.preventDefault();
    if (closeConfirmPending) return;
    closeConfirmPending = true;
    logEvent('settings-window-close-dialog-shown', {});
    showThemedConfirm(settingsWindow, {
      type: 'warning',
      buttons: ['Kaydetmeden Kapat', 'İptal'],
      defaultId: 1,
      cancelId: 1,
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Kaydedilmemiş değişiklikleriniz var. Yine de kapatmak istiyor musunuz?',
    }).then((choice) => {
      closeConfirmPending = false;
      if (choice !== 0) {
        logEvent('settings-window-close-cancelled', {});
        return;
      }
      logEvent('settings-window-close-discarded-changes', {});
      hasUnsavedChanges = false;
      settingsWindow?.close();
    });
  });

  settingsWindow.on('closed', () => {
    logEvent('settings-window-closed', {});
    settingsWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getMainWindow()?.close());
  ipcMain.on('window:open-settings', (_event, panel, highlight) => openSettingsWindow(panel, highlight));
  ipcMain.on('settings-window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.on('settings-window:set-dirty', (_event, dirty) => {
    hasUnsavedChanges = dirty;
  });

  ipcMain.handle('dpi:get-status', () => serviceClient.getDpiStatus());

  ipcMain.handle('dpi:activate-engine', async (_event, id) => {
    // Manuel moddan gelen bir çağrıysa (kullanıcı Ayarlar > DPI Aşımı > Manuel'de bir motor
    // kartına tıkladı) kullanıcı AÇIKÇA bu motoru seçti — tükenirse BAŞKA bir motora
    // otomatik geçilmesini istemiyoruz. Yalnızca Otomatik mod (Zapret giriş noktası)
    // escalation'a izin veriyor.
    const allowEscalation = readLocalSettings().dpiMode === 'automatic';
    logEvent('activate-engine', { id, allowEscalation });
    // serviceClient.activateEngine bir aday taraması gerektiriyorsa (motor doğrulanmamışsa)
    // dakikalarca sürebilir — bunu burada beklemeden ÖNCE ana pencereye haber veriyoruz ki
    // kendi 3sn'lik durum yoklama döngüsünü (refreshConnection) hemen başlatsın. Aksi hâlde
    // ana pencere taramanın TAMAMEN bitmesine kadar hiçbir şey bilmiyordu — ne "Bağlantı
    // hazırlanıyor" arkasındaki canlı günlük gösteriliyordu (switching=true hiç
    // yakalanmıyordu), ne de tarama bitince sayfa otomatik yeniden yükleniyordu (yalnızca
    // başarı durumunda gönderilen tek seferlik sinyale bağımlıydı).
    getMainWindow()?.webContents.send('dpi:engine-changed');
    try {
      const result = await serviceClient.activateEngine(id, allowEscalation);
      // Aktif motor değişti: Discord session'ının proxy'sini yeni motora göre güncelle
      // ve webview'i yeniden yükle ki yeni bağlantı gerçekten yeni proxy üzerinden gitsin.
      await applyDpiProxy();
      getMainWindow()?.webContents.send('dpi:engine-changed');
      return result;
    } catch (err) {
      logEvent('activate-engine-error', { id, error: err.message });
      // Başarısız oldu (ör. denenen hiçbir strateji Discord'a erişemedi) — ana pencere hâlâ
      // "switching" yoklama döngüsündeyse bunu status.switching=false + autoScanResult/detail
      // üzerinden zaten kendi başına yakalayacak, ama yine de haber verelim ki beklemeden
      // hemen güncel durumu göstersin.
      getMainWindow()?.webContents.send('dpi:engine-changed');
      throw err;
    }
  });

  // confirmRestart=true (Manuel moddaki DPI Aşımı ekranından gelir): motoru hemen yeniden
  // başlatmadan önce kullanıcıya sorar. "Hayır" derse argümanlar kaydedilir ama çalışan
  // süreç dokunulmadan bırakılır (restart=false) — değişiklik motorun bir sonraki
  // başlangıcında etkili olur.
  ipcMain.handle('dpi:set-args', async (_event, id, args, options = {}) => {
    const confirmRestart = options?.confirmRestart ?? false;
    logEvent('set-engine-args', { id, args, confirmRestart });

    let restart = true;
    if (confirmRestart) {
      const choice = await showThemedConfirm(settingsWindow, {
        type: 'question',
        buttons: ['Evet', 'Hayır'],
        defaultId: 0,
        cancelId: 1,
        title: 'Yeniden başlatma gerekiyor',
        message: 'Bu değişikliğin uygulanması için DPI motorunun yeniden başlatılması gerekiyor. Şimdi yeniden başlatılsın mı?',
        detail: "Hayır'ı seçerseniz ayar kaydedilir ama motor bir sonraki başlatılışına kadar eski haliyle çalışmaya devam eder.",
      });
      restart = choice === 0;
      logEvent('set-engine-args-restart-choice', { id, restart });
    }

    // KULLANICI TALEBİ (2026-09-07): restart=true olduğunda serviceClient.setEngineArgs()
    // TAMAMLANMADAN (DpiEngineManager.UpdateArgsAsync -> SwitchToAsync, kayıtlı ayar
    // denemesi/tam tarama yüzünden dakikalarca sürebilir) önce ana pencereye HABER VERMİYORDUK
    // -- bu yüzden "Kaydet"e basınca, önceden yüklenmiş bir Discord sayfası varsa, arayüz
    // TÜM işlem bitene kadar hiçbir şey olmuyormuş gibi (eski sayfa/duruma takılı) görünüyordu,
    // yeni denemenin GERÇEKTEN başladığı hiç yansımıyordu. Şimdi restart tetiklenir tetiklenmez
    // (asıl HTTP çağrısının sonucunu beklemeden) haber veriyoruz ki renderer'ın refreshConnection()'ı
    // hemen "Bağlantı hazırlanıyor…" (switching=true) durumunu göstersin.
    if (restart) {
      getMainWindow()?.webContents.send('dpi:engine-changed');
    }

    try {
      const result = await serviceClient.setEngineArgs(id, args, restart);
      if (restart) {
        await applyDpiProxy();
        getMainWindow()?.webContents.send('dpi:engine-changed');
      }
      return result;
    } catch (err) {
      logEvent('set-engine-args-error', { id, error: err.message });
      if (restart) getMainWindow()?.webContents.send('dpi:engine-changed');
      throw err;
    }
  });

  ipcMain.handle('dpi:get-logs', (_event, id) => serviceClient.getEngineLogs(id));

  ipcMain.handle('dpi:report-byedpi-failure', async () => {
    // Kullanıcı Manuel modda AÇIKÇA ByeDPI'yı seçmiş olabilir — bu durumda yeniden tarama
    // tükenirse BAŞKA bir motora otomatik geçilmesini istemiyoruz (bkz. dpi:activate-engine).
    const allowEscalation = readLocalSettings().dpiMode === 'automatic';
    logEvent('byedpi-failure-reported', { allowEscalation });
    getMainWindow()?.webContents.send('dpi:engine-changed');
    try {
      await serviceClient.reportByeDpiFailure();
      // Reddedilenler listesine eklendi; şimdi listede kalan bir sonraki adayı dene.
      const result = await serviceClient.activateEngine('byedpi', allowEscalation);
      await applyDpiProxy();
      getMainWindow()?.webContents.send('dpi:engine-changed');
      return result;
    } catch (err) {
      logEvent('byedpi-failure-report-error', { error: err.message });
      getMainWindow()?.webContents.send('dpi:engine-changed');
      throw err;
    }
  });

  // Zapret2/Zapret'in genel karşılığı: webview'de (titlebar.js) o motorun doğrulanmış
  // ayarı birkaç otomatik yeniden denemeden sonra hâlâ kalıcı olarak çalışmıyorsa çağrılır.
  // ByeDPI için de çalışır (dpi:report-byedpi-failure ile aynı akışa yönlenir).
  ipcMain.handle('dpi:report-engine-failure', async (_event, id) => {
    const allowEscalation = readLocalSettings().dpiMode === 'automatic';
    logEvent('engine-failure-reported', { id, allowEscalation });
    getMainWindow()?.webContents.send('dpi:engine-changed');
    try {
      const result = await serviceClient.reportEngineFailure(id, allowEscalation);
      await applyDpiProxy();
      getMainWindow()?.webContents.send('dpi:engine-changed');
      return result;
    } catch (err) {
      logEvent('engine-failure-report-error', { id, error: err.message });
      getMainWindow()?.webContents.send('dpi:engine-changed');
      throw err;
    }
  });

  ipcMain.on('renderer:log-event', (_event, tag, data) => logEvent(tag, data));

  ipcMain.handle('app:get-autostart', () => isAutoStartEnabled());
  ipcMain.handle('app:set-autostart', (_event, enabled) => {
    logEvent('set-autostart', { enabled });
    try {
      // Autostart kapatılırsa "arkaplanda başlat" tercihi de anlamsızlaşıyor (login item
      // tamamen kaldırılıyor); açılırken önceki arkaplan tercihini koruyoruz.
      applyAutoStart(enabled, isStartInBackgroundEnabled());
      return isAutoStartEnabled();
    } catch (err) {
      logEvent('set-autostart-error', { enabled, error: err.message });
      throw err;
    }
  });

  ipcMain.handle('app:get-start-in-background', () => isStartInBackgroundEnabled());
  ipcMain.handle('app:set-start-in-background', (_event, enabled) => {
    logEvent('set-start-in-background', { enabled });
    try {
      applyAutoStart(isAutoStartEnabled(), enabled);
      return isStartInBackgroundEnabled();
    } catch (err) {
      logEvent('set-start-in-background-error', { enabled, error: err.message });
      throw err;
    }
  });

  ipcMain.handle('app:get-gpu-acceleration', () => readLocalSettings().gpuAcceleration);
  ipcMain.handle('app:set-gpu-acceleration', async (_event, enabled) => {
    const current = readLocalSettings().gpuAcceleration;
    if (enabled === current) return current;

    // GERÇEK BUG DÜZELTMESİ: bu handler daha önce mainWindow.isQuitting'i HİÇ
    // ayarlamıyordu — app.quit() çağrılınca window.js'teki close handler'ı
    // (isQuitting olmadığı için) preventDefault()+hide() yapıp uygulamanın GERÇEKTEN
    // kapanmasını engelliyordu. Sonuç: eski süreç zombi olarak tekil-örnek kilidini
    // elinde tutmaya devam ediyor, app.relaunch()'in başlattığı YENİ süreç bu kilide
    // takılıp kendini "ikinci örnek" sanıp eski (DPI motoru artık durdurulmuş, o
    // yüzden "Discord'a bağlanılamadı" veren) zombi pencereyi öne çıkarıyordu — tam
    // olarak kullanıcının tarif ettiği belirti.
    const choice = await showThemedConfirm(settingsWindow, {
      type: 'question',
      buttons: ['Evet', 'Hayır'],
      defaultId: 0,
      cancelId: 1,
      title: 'Yeniden başlatma gerekiyor',
      message: `GPU hızlandırmasını ${enabled ? 'açmak' : 'kapatmak'} için programın tamamen yeniden başlatılması gerekiyor. Şimdi yeniden başlatılsın mı?`,
      detail: "Hayır'ı seçerseniz bu ayar değiştirilmeden mevcut haliyle kalır.",
    });
    if (choice !== 0) {
      logEvent('gpu-acceleration-change-cancelled', { enabled });
      return current;
    }

    // app.exit() DEĞİL app.quit() kullanıyoruz: exit() 'before-quit' hook'unu (DPI
    // motorlarını düzgün durduran) atlayıp sert bir çıkış yapıyordu.
    try {
      writeLocalSettings({ gpuAcceleration: enabled });
      logEvent('gpu-acceleration-changed', { enabled });
    } catch (err) {
      logEvent('gpu-acceleration-change-error', { enabled, error: err.message });
      throw err;
    }
    hasUnsavedChanges = false;

    const mw = getMainWindow();
    if (mw) mw.isQuitting = true; // gerçek çıkış: pencere close handler'ı artık engellemiyor
    app.relaunch();
    app.quit();
    return enabled;
  });

  // Ayarlar > Genel'deki toggle VE webview'de ERR_QUIC_PROTOCOL_ERROR alındığında
  // titlebar'da çıkan "QUIC'i Devre Dışı Bırak" butonu AYNI handler'ı çağırıyor —
  // senkron kalmaları için ayrı bir yol yok, tek doğruluk kaynağı bu. GPU
  // hızlandırmasındaki desenin birebir aynısı (onay + yeniden başlatma) — TEK fark,
  // onay diyaloğunun her zaman settingsWindow'a DEĞİL, isteği yapan pencereye
  // (ana pencere ya da ayarlar penceresi, hangisi çağırdıysa) gönderilmesi: buton ana
  // pencerede ve ayarlar penceresi çoğunlukla hiç açık olmadığı için showThemedConfirm
  // kapalı/null bir settingsWindow'a gönderilirse sessizce "Hayır" sonucu dönüp
  // kullanıcı hiçbir onay ekranı GÖRMEDEN işlem iptal edilirdi.
  ipcMain.handle('app:get-quic-disabled', () => readLocalSettings().quicDisabled ?? false);
  ipcMain.handle('app:set-quic-disabled', async (event, enabled) => {
    const current = readLocalSettings().quicDisabled ?? false;
    if (enabled === current) return current;

    const requesterWindow = BrowserWindow.fromWebContents(event.sender);
    const choice = await showThemedConfirm(requesterWindow, {
      type: 'question',
      buttons: ['Evet', 'Hayır'],
      defaultId: 0,
      cancelId: 1,
      title: 'Yeniden başlatma gerekiyor',
      message: `QUIC protokolünü ${enabled ? 'devre dışı bırakmak' : 'tekrar etkinleştirmek'} için programın tamamen yeniden başlatılması gerekiyor. Şimdi yeniden başlatılsın mı?`,
      detail: "Hayır'ı seçerseniz bu ayar değiştirilmeden mevcut haliyle kalır.",
    });
    if (choice !== 0) {
      logEvent('quic-disabled-change-cancelled', { enabled });
      return current;
    }

    try {
      writeLocalSettings({ quicDisabled: enabled });
      logEvent('quic-disabled-changed', { enabled });
    } catch (err) {
      logEvent('quic-disabled-change-error', { enabled, error: err.message });
      throw err;
    }
    hasUnsavedChanges = false;

    const mw = getMainWindow();
    if (mw) mw.isQuitting = true; // gerçek çıkış: pencere close handler'ı artık engellemiyor
    app.relaunch();
    app.quit();
    return enabled;
  });

  // DPI Aşımı ekranındaki Otomatik/Manuel toggle — yalnızca istemci tarafında (yerel
  // ayar) hangi görünümün gösterileceğini belirler. Otomatik'e geçilince Zapret'in
  // (Otomatik modun giriş noktası — bkz. DpiEngineManager.SwitchToAsync) gerçekten aktif
  // motor olduğundan emin olunur.
  ipcMain.handle('dpi:get-mode', () => readLocalSettings().dpiMode);
  ipcMain.handle('dpi:set-mode', async (_event, mode) => {
    logEvent('set-dpi-mode', { mode });
    try {
      writeLocalSettings({ dpiMode: mode });
      if (mode === 'automatic') {
        // Manuel'den gelirken zaten Zapret aktif/taranıyorsa o tarama hiç iptal edilmeden
        // burada da dokunmadan bırakılıyor — aksi hâlde zaten sürmekte olan aynı taramayı
        // sıfırdan yeniden başlatıp kullanıcı gözünden hiçbir şey değişmemiş gibi görünürdü.
        let status = null;
        try {
          status = await serviceClient.getDpiStatus();
        } catch (err) {
          logEvent('get-status-before-set-mode-error', { error: err.message });
        }
        const currentEngineId = status?.switching ? status.switchingToEngineId : status?.activeEngineId;
        if (currentEngineId !== 'zapret') {
          await serviceClient.activateEngine('zapret');
          await applyDpiProxy();
          getMainWindow()?.webContents.send('dpi:engine-changed');
        }
      }
      return mode;
    } catch (err) {
      logEvent('set-dpi-mode-error', { mode, error: err.message });
      throw err;
    }
  });

  // Ayarlar > DPI Aşımı'ndaki Otomatik'ten Manuel'e geçiş onayında, o an sürmekte olan
  // bir motor/strateji taraması varsa durdurmak için (bkz. settings.js initDpiMode).
  ipcMain.handle('dpi:cancel-scan', () => serviceClient.cancelScan());

  // Ayarlar > DPI Aşımı'ndaki Otomatik<->Manuel mod geçişi onayında — cancelScan yalnızca
  // iptal SİNYALİ gönderip hemen dönüyor (motorun fiilen durmasını BEKLEMİYOR); bu da tüm
  // motorların GERÇEKTEN durduğundan emin olup (aynı _switchLock'u kullandığı için sürmekte
  // olan bir iptalin tamamen bitmesini bekliyor) ancak ONDAN SONRA mod geçişinin yapılmasını
  // sağlıyor.
  ipcMain.handle('dpi:stop-all', async () => {
    logEvent('stop-all-before-mode-change', {});
    const result = await serviceClient.stopAllEngines();
    getMainWindow()?.webContents.send('dpi:engine-changed');
    return result;
  });

  // "DPI Servisini Kur" butonu (bkz. titlebar.js) VE ilk açılış otomatik kurulumu (bkz.
  // index.js) için ortak -- ikisi de AYNI pkexec tabanlı install.sh çağrısını kullanıyor.
  ipcMain.handle('dpi:is-installer-bundled', () => isInstallerBundled());
  ipcMain.handle('dpi:install-service', async () => {
    logEvent('dpi-install-service-requested', {});
    try {
      await installDpiService();
      logEvent('dpi-install-service-succeeded', {});
      return { ok: true };
    } catch (err) {
      const cancelled = err.message === 'CANCELLED';
      logEvent('dpi-install-service-failed', { error: err.message, cancelled });
      return { ok: false, cancelled, error: cancelled ? null : err.message };
    }
  });

  // KULLANICI TALEBİ (2026-09-08): AppImage'a özel "Servisi Kaldır" butonu (bkz. settings.js
  // btnRemoveDpiService) -- installDpiService'in ayna görevi, AYNI CANCELLED/hata sözleşmesini
  // kullanıyor.
  ipcMain.handle('dpi:uninstall-service', async () => {
    logEvent('dpi-uninstall-service-requested', {});
    try {
      await uninstallDpiService();
      logEvent('dpi-uninstall-service-succeeded', {});
      return { ok: true };
    } catch (err) {
      const cancelled = err.message === 'CANCELLED';
      logEvent('dpi-uninstall-service-failed', { error: err.message, cancelled });
      return { ok: false, cancelled, error: cancelled ? null : err.message };
    }
  });

  // Üç motor için de ortak (ByeDPI/Zapret/Zapret2) — Otomatik moddaki "Argüman Setini
  // Yasakla" butonu, hangi motor o an aktifse onun id'sini gönderiyor.
  ipcMain.handle('dpi:get-rejected-args', (_event, id) => serviceClient.getRejectedArgs(id));
  ipcMain.handle('dpi:reject-current-args', async (_event, id) => {
    // "Argüman Setini Yasakla" hem Otomatik hem Manuel modda var (bkz. settings.js
    // btnRejectCurrent/btnRejectCurrentManual) -- allowEscalation'ı diğer handler'larla
    // (activateEngine, reportEngineFailure) AYNI şekilde o an okunan dpiMode'a göre
    // hesaplıyoruz: Manuel'den çağrılırsa false kalır (IsManualActivation=true olarak
    // kalmaya devam eder, zincire otomatik eskalasyon YAPILMAZ, yalnızca SEÇİLİ motorun
    // kendi adayları arasında yeniden aranır).
    const allowEscalation = readLocalSettings().dpiMode === 'automatic';
    logEvent('reject-current-args', { id, allowEscalation });
    getMainWindow()?.webContents.send('dpi:engine-changed');
    try {
      const result = await serviceClient.rejectCurrentArgs(id, allowEscalation);
      await applyDpiProxy();
      getMainWindow()?.webContents.send('dpi:engine-changed');
      return result;
    } catch (err) {
      logEvent('reject-current-args-error', { id, error: err.message });
      getMainWindow()?.webContents.send('dpi:engine-changed');
      throw err;
    }
  });

  // discordWebviewPreload.js'teki "Kullanılan Argüman Setini Yasaklamayı Deneyin" butonu
  // için — webview KENDİ ayrı bir renderer (Discord'un sayfası), ana penceredeki
  // window.showConfirmModal'a hiç erişemiyor (ayrı DOM/JS realm'i). showThemedConfirm ana
  // pencereyi hedefleyip 'modal:show-confirm' gönderiyor, ana penceredeki köprü (bkz.
  // titlebar.js'in en üstü, settings.js'teki AYNI desen) bunu window.showConfirmModal'a
  // çeviriyor -- yani onay kutusu GERÇEKTEN ana pencerede, bizim temamızla açılıyor, native
  // bir Windows dialog'u değil.
  ipcMain.handle('webview:confirm-ban-current-args', async () => {
    const choice = await showThemedConfirm(getMainWindow(), {
      type: 'question',
      buttons: ['Evet', 'Vazgeç'],
      defaultId: 0,
      cancelId: 1,
      title: 'Argüman seti yasaklansın mı?',
      message: 'Şu an kullanılan argüman seti yasaklanıp Otomatik modda sıfırdan bir tarama başlatılacak.',
      detail: 'Bu işlem birkaç dakika sürebilir.',
    });
    return choice === 0;
  });
  ipcMain.handle('dpi:unreject-args', async (_event, id, args) => {
    logEvent('unreject-args', { id, args });
    try {
      return await serviceClient.unrejectArgs(id, args);
    } catch (err) {
      logEvent('unreject-args-error', { id, args, error: err.message });
      throw err;
    }
  });

  // ByeDPI "uzun argüman listesi" anahtarı — sürmekte olan bir tarama varsa onu iptal
  // edip yeniden başlatma kararı (onay dahil) renderer tarafında (settings.js) veriliyor;
  // burada yalnızca servise kaydediyoruz.
  ipcMain.handle('dpi:get-byedpi-use-extended-candidates', () => serviceClient.getByeDpiUseExtendedCandidates());
  ipcMain.handle('dpi:set-byedpi-use-extended-candidates', async (_event, enabled) => {
    logEvent('set-byedpi-use-extended-candidates', { enabled });
    try {
      return await serviceClient.setByeDpiUseExtendedCandidates(enabled);
    } catch (err) {
      logEvent('set-byedpi-use-extended-candidates-error', { enabled, error: err.message });
      throw err;
    }
  });

  // Manuel > Gelişmiş'ten sabitlenen tek DNS protokolü — aynı desen: sürmekte olan bir
  // taramayı iptal edip yeniden başlatma kararı (onay dahil) renderer tarafında veriliyor,
  // burada yalnızca servise kaydediyoruz.
  ipcMain.handle('dpi:get-manual-dns-protocol', () => serviceClient.getManualDnsProtocol());
  ipcMain.handle('dpi:set-manual-dns-protocol', async (_event, protocol) => {
    logEvent('set-manual-dns-protocol', { protocol });
    try {
      return await serviceClient.setManualDnsProtocol(protocol);
    } catch (err) {
      logEvent('set-manual-dns-protocol-error', { protocol, error: err.message });
      throw err;
    }
  });

  // Yalnızca Zapret2 için: Otomatik/Manuel modun tier başına blockcheck2 üst sınırı (dakika,
  // bağımsız iki değer). Aynı desen: sürmekte olan bir taramayı iptal edip yeniden başlatma
  // kararı (onay dahil) renderer tarafında veriliyor.
  ipcMain.handle('dpi:get-zapret2-tier-timeout', () => serviceClient.getZapret2TierTimeout());
  ipcMain.handle('dpi:set-zapret2-tier-timeout', async (_event, automaticMinutes, manualMinutes) => {
    logEvent('set-zapret2-tier-timeout', { automaticMinutes, manualMinutes });
    try {
      return await serviceClient.setZapret2TierTimeout(automaticMinutes, manualMinutes);
    } catch (err) {
      logEvent('set-zapret2-tier-timeout-error', { automaticMinutes, manualMinutes, error: err.message });
      throw err;
    }
  });

  // Windows karşılığındaki dpi:get-firewall-status/grant-firewall-permission/get-app-firewall-
  // status/grant-app-firewall-permission handler'ları BİLEREK YOK — Linux servisi /firewall/*
  // uç noktalarını hiç sunmuyor (bkz. PORTING_PLAN.md D-9).

  ipcMain.handle('app:get-open-links-externally', () => readLocalSettings().openLinksExternally);
  ipcMain.handle('app:set-open-links-externally', (_event, enabled) => {
    logEvent('set-open-links-externally', { enabled });
    writeLocalSettings({ openLinksExternally: enabled });
    return enabled;
  });

  ipcMain.handle('app:get-link-opener-new-window', () => readLocalSettings().linkOpenerNewWindow);
  ipcMain.handle('app:set-link-opener-new-window', (_event, enabled) => {
    logEvent('set-link-opener-new-window', { enabled });
    writeLocalSettings({ linkOpenerNewWindow: enabled });
    return enabled;
  });

  // "+" ile eklenen bir discord.gg/discord.com bağlantısını, ana penceredeki webview'in
  // yerine geçmeden, kendi persist:discord oturumunu (dolayısıyla giriş yapılmış hesabın
  // çerezlerini) paylaşan ayrı bir pencerede açar. URL doğrulaması renderer'da zaten
  // yapılıyor (bkz. titlebar.js DISCORD_LINK_PATTERN) ama burada da tekrarlanıyor —
  // preload/contextBridge üzerinden main sürece keyfi bir URL geçirilebileceği ihtimaline
  // karşı savunma amaçlı.
  const DISCORD_LINK_PATTERN = /^https?:\/\/([a-z0-9-]+\.)*discord\.(gg|com)(\/.*)?$/i;
  ipcMain.handle('window:open-discord-link', (_event, url) => {
    if (typeof url !== 'string' || !DISCORD_LINK_PATTERN.test(url)) {
      throw new Error('invalid discord url');
    }
    logEvent('discord-link-window-open', { url });
    const linkWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      parent: getMainWindow() || undefined,
      // GERÇEK BUG (canlı bulundu, ekran paylaşımı seçicisiyle aynı kök neden): icon
      // verilmezse taskbar'da Electron'un varsayılan simgesi görünüyordu.
      icon: loadAppIcon(path.join(__dirname, '..', '..', 'resources', 'icon.png')),
      webPreferences: {
        partition: 'persist:discord',
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Davet kabul/red edildiğinde Discord'un kendi SPA yönlendirmesi bu pencereyi
    // /app veya /channels/ altına taşır — bu, kullanıcının işini bitirdiği anlamına
    // geldiği için pencereyi otomatik kapatıyoruz. İlk navigasyon (loadURL'in kendisi,
    // ör. discord.gg -> discord.com/invite/xyz yönlendirmesi) kasıtlı olarak atlanıyor;
    // yalnızca ONDAN SONRAKİ (davet sayfasından uygulamaya geçişi temsil eden)
    // navigasyonlar kontrol ediliyor.
    const APP_SHELL_PATTERN = /^https:\/\/discord\.com\/(app(\/|$|\?)|channels\/)/i;
    let hasNavigatedOnce = false;
    const maybeAutoCloseOnAppShell = (navUrl) => {
      if (!hasNavigatedOnce) {
        hasNavigatedOnce = true;
        return;
      }
      if (APP_SHELL_PATTERN.test(navUrl) && !linkWindow.isDestroyed()) {
        logEvent('discord-link-window-auto-close', { url: navUrl });
        linkWindow.close();
      }
    };
    linkWindow.webContents.on('did-navigate', (_navEvent, navUrl) => maybeAutoCloseOnAppShell(navUrl));
    linkWindow.webContents.on('did-navigate-in-page', (_navEvent, navUrl) => maybeAutoCloseOnAppShell(navUrl));

    linkWindow.loadURL(url);
    return true;
  });

  ipcMain.handle('app:get-performance-mode', () => readLocalSettings().performanceMode);
  ipcMain.handle('app:set-performance-mode', (_event, enabled) => {
    logEvent('set-performance-mode', { enabled });
    writeLocalSettings({ performanceMode: enabled });
    // dynamicColor.js/voiceState.js kendi zamanlama döngülerinde bir sonraki turda bu
    // ayarı okuyup davranışlarını buna göre ayarlıyor — ekstra müdahaleye gerek yok.
    // backgroundPriority.js İSTİSNA: odak/blur olayı beklemeden, kullanıcı performans
    // modunu oyun sırasında (pencere zaten odaksızken) AÇARSA/KAPATIRSA hemen etkili olsun.
    backgroundPriority.reevaluate();
    getMainWindow()?.webContents.send('app:performance-mode-changed', enabled);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('app:performance-mode-changed', enabled);
    }
    return enabled;
  });

  // KULLANICI TALEBİ: Ayarlar > Görünüm'deki "Daha küçük başlık çubuğu" -- performanceMode
  // ile AYNI yayın deseni (hem ana pencereye hem açıksa ayarlar penceresine gönderiliyor,
  // ikisi de kendi titlebar.js'inde dinliyor).
  ipcMain.handle('app:get-small-titlebar', () => readLocalSettings().smallTitlebar);
  ipcMain.handle('app:set-small-titlebar', (_event, enabled) => {
    logEvent('set-small-titlebar', { enabled });
    writeLocalSettings({ smallTitlebar: enabled });
    getMainWindow()?.webContents.send('app:small-titlebar-changed', enabled);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('app:small-titlebar-changed', enabled);
    }
    return enabled;
  });

  // KULLANICI TALEBİ: Ayarlar > Görünüm'deki "SplitCord-Turkey başlığını göster/ortala" --
  // smallTitlebar'ın AKSİNE yalnızca ANA PENCEREyi ilgilendiriyor (bkz. titlebar.css
  // .sc-titlebar-title--app'in üstündeki not) -- bu yüzden settingsWindow'a hiç
  // yayınlanmıyor, orada dinleyen/etkilenen bir şey yok.
  ipcMain.handle('app:get-show-title', () => readLocalSettings().showTitle);
  ipcMain.handle('app:set-show-title', (_event, enabled) => {
    logEvent('set-show-title', { enabled });
    writeLocalSettings({ showTitle: enabled });
    getMainWindow()?.webContents.send('app:show-title-changed', enabled);
    return enabled;
  });

  ipcMain.handle('app:get-center-title', () => readLocalSettings().centerTitle);
  ipcMain.handle('app:set-center-title', (_event, enabled) => {
    logEvent('set-center-title', { enabled });
    writeLocalSettings({ centerTitle: enabled });
    getMainWindow()?.webContents.send('app:center-title-changed', enabled);
    return enabled;
  });

  // KULLANICI TALEBİ: Ayarlar > Vencord panelindeki "Vencord'u etkinleştir" -- diğer
  // toggle'ların aksine ertelenmiş kaydetme (unsaved-bar) DEĞİL, tıklandığı anda onay
  // isteyip cevaba göre HEMEN uygulanıyor (bkz. settings.js initVencordToggle). Bu yüzden
  // "get" hâlâ sade ama "set" yerine bu onay akışını da içeren tek bir handler var.
  // discordWebviewPreload.js'in enjeksiyon kararını (document-start'ta, webview'in kendi
  // preload'u tarafından SENKRON okunması gerekiyor) ilgilendirdiği için AYRICA
  // sendSync/event.returnValue kullanan bir kanal daha var (aşağıda) -- oradaki normal
  // ipcMain.handle ile karışmasın.
  ipcMain.handle('app:get-vencord-enabled', () => readLocalSettings().vencordEnabled);

  // KULLANICI TALEBİ: switch'e tıklanınca (Kaydet'e basılana kadar bekletmeden) onay
  // isteniyor -- "Evet" denirse hemen kaydedilip webview yeniden yükleniyor, "Hayır"
  // denirse hiçbir şey değişmiyor (renderer checkbox'ı geri alıyor). Etkinleştirme ve
  // devre dışı bırakma için AYRI metinler + sesli sohbetteyken EK bir uyarı satırı
  // (bkz. voiceState.getLastState().connected) kullanıcı talebiyle birebir eklendi.
  ipcMain.handle('app:request-vencord-toggle', async (_event, desired) => {
    const connected = voiceState.getLastState().connected;
    const voiceWarning = 'Ayrıca şuanki sesli sohbetiniz geçici olarak kesintiye uğrayabilir.';

    const options = desired
      ? {
          type: 'question',
          buttons: ['Evet', 'Hayır'],
          defaultId: 0,
          cancelId: 1,
          title: "Vencord'u Etkinleştir",
          message: "Vencord, Discord için daha fazla özelleştirme, ek özellik ve eklentileri kullanabileceğiniz bir moddur. Ancak Discord'un Hizmet Şartları üçüncü taraf değişiklikleri yasaklayabiliyor. Bu durumda hesabınıza uygulanabilecek herhangi bir işlemden siz sorumlu olacaksınız. Riski kabul ediyorsanız aktifleştirin.",
          detail: connected ? voiceWarning : undefined,
        }
      : {
          type: 'question',
          buttons: ['Evet', 'Hayır'],
          defaultId: 0,
          cancelId: 1,
          title: "Vencord'u Devre Dışı Bırak",
          message: "Vencord'u pasif hale getirmek istediğinizden emin misiniz?",
          detail: connected ? voiceWarning : undefined,
        };

    const choice = await showThemedConfirm(settingsWindow, options);
    const confirmed = choice === 0;
    logEvent('vencord-toggle-choice', { desired, connected, confirmed });
    if (!confirmed) return { applied: false, enabled: !desired };

    writeLocalSettings({ vencordEnabled: desired });
    // Yalnızca ANA PENCEREdeki webview'i ilgilendiriyor -- titlebar.js bunu dinleyip
    // webview.reload() çağırıyor (yeni enjeksiyon kararı ancak bir sonraki navigasyonda/
    // document-start'ta etkili olabiliyor).
    getMainWindow()?.webContents.send('app:vencord-enabled-changed', desired);
    return { applied: true, enabled: desired };
  });

  // KULLANICI TALEBİ: Vencord panelindeki "Vencord Ayarlarını Göster" butonu -- Vencord
  // kendi ayarlarını Discord'un KENDİ Kullanıcı Ayarları modaline bir "Vencord" sekmesi
  // olarak ekliyor (bkz. Vencord'un _core/settings.tsx'indeki "vencord_main" -> "_panel"
  // deseni, diğer Vencord eklentilerinin de SettingsRouter.openUserSettings("<key>_panel")
  // ile kullandığı AYNI mekanizma). Bu yüzden bizim ayarlar penceremizden DEĞİL, ana
  // pencerenin webview'inde (Vencord'un GERÇEKTEN çalıştığı ana dünya) çalıştırıyoruz.
  // Ayarlar penceresi ana pencerenin child'ı olduğu için onu kapatmadan mainWindow'u
  // öne almak Vencord'un açtığı modali GİZLEYEBİLİYORDU -- bu yüzden önce kapatıyoruz.
  ipcMain.handle('app:open-vencord-settings', () => {
    const webview = getAttachedWebviewContents();
    if (!webview || webview.isDestroyed()) return false;
    webview
      .executeJavaScript('window.Vencord?.Webpack?.Common?.SettingsRouter?.openUserSettings("vencord_main_panel")')
      .catch((err) => logEvent('open-vencord-settings-error', { error: err.message }));
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    return true;
  });

  // KULLANICI TALEBİ: Vencord panelindeki "Vencord Sürümü" satırı -- Vencord'un kendi
  // çalışma zamanı API'sinden (belgelenmemiş, değişebilir) okumak yerine, build-vencord.js
  // tarafından derleme anında yazılan sabit resources/vencord/version.json'dan okunuyor --
  // daha güvenilir, Vencord'un iç yapısına bağımlı değil.
  ipcMain.handle('app:get-vencord-version', () => {
    try {
      const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'vencord', 'version.json'), 'utf8');
      return JSON.parse(raw).version ?? null;
    } catch {
      return null;
    }
  });
  // discordWebviewPreload.js document-start'ta (webview'in kendi izole preload dünyasında)
  // çalışıyor -- o an ana pencereyle normal async IPC round-trip'i bekleyecek zaman/mimari
  // yok (enjeksiyon Discord'un kendi script'lerinden ÖNCE tamamlanmalı), bu yüzden senkron
  // ipcRenderer.sendSync kullanıyor.
  //
  // CANLI TESTTE BULUNAN GERÇEK BUG (Windows tarafında bulundu, Linux'ta da AYNI Electron
  // davranışı geçerli): <webview>'in preload'u SANDBOXED çalışıyor (Electron 20+'ta webview
  // preload'ları için varsayılan) -- require('node:fs')/require('node:path') preload'ın
  // kendi izole dünyasında MEVCUT DEĞİL ("module not found: node:fs"), ve bu hata sessizce
  // preload'un TAMAMINI (contextBridge.exposeInMainWorld dahil, Vencord'dan TAMAMEN
  // BAĞIMSIZ önceden çalışan kod da dahil) çökertiyordu -- webContents.on('preload-error')
  // ile canlı doğrulandı. Bu yüzden dosya OKUMA işlemini (fs erişimi olan) buraya, ana
  // sürece taşıdık; preload artık yalnızca hazır JS/CSS metnini IPC üzerinden alıyor.
  ipcMain.on('vencord:get-injection-sync', (event) => {
    const enabled = readLocalSettings().vencordEnabled;
    if (!enabled) {
      event.returnValue = null;
      return;
    }
    try {
      const vencordDir = path.join(__dirname, '..', '..', 'resources', 'vencord');
      const js = fs.readFileSync(path.join(vencordDir, 'browser.js'), 'utf8');
      const css = fs.readFileSync(path.join(vencordDir, 'browser.css'), 'utf8');
      event.returnValue = { js, css };
    } catch (err) {
      event.returnValue = { error: err.message };
    }
  });

  // KULLANICI TALEBİ: Discord webview'ine enjekte edilen temalı diyalog kutusu (bkz.
  // discordWebviewPreload.js setupStyledAlert) SplitCord-Turkey'in Ayarlar > Görünüm'deki
  // renk seçimine (Otomatik/Aydınlık/Kül/Karanlık/Abanoz) uymuyordu -- sabit kodlanmış
  // renkler kullanıyordu. dynamicColor.getLastPalette() ana pencerenin titlebar'ının
  // KENDİSİNİN kullandığı AYNI palet -- document-start'ta senkron olarak (aynı gerekçeyle,
  // bkz. vencord:get-injection-sync notu) buradan okunuyor. Tema ÇALIŞMA SIRASINDA
  // değişirse (ör. Otomatik yeniden örnekleme) bu diyalog yalnızca bir sonraki webview
  // navigasyonunda güncellenir -- diyaloglar nadir/tek seferlik olduğu için bu bilinen,
  // kabul edilmiş bir sınırlama.
  ipcMain.on('theme:get-colors-sync', (event) => {
    event.returnValue = dynamicColor.getLastPalette();
  });

  ipcMain.handle('app:get-theme-mode', () => readLocalSettings().themeMode);
  ipcMain.handle('app:set-theme-mode', (_event, mode) => {
    logEvent('set-theme-mode', { mode });
    writeLocalSettings({ themeMode: mode });
    if (mode === 'automatic') {
      // Hemen yeniden örnekle — bir sonraki 30 sn'lik döngüyü beklemeye gerek yok.
      dynamicColor.sampleAndApply();
    } else {
      dynamicColor.applyStaticTheme(mode);
    }
    return mode;
  });

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('app:check-for-update', async () => {
    logEvent('check-for-update', {});
    try {
      const result = await updateChecker.checkForUpdate();
      logEvent('check-for-update-result', result);
      if (result.available) {
        getMainWindow()?.webContents.send('app:update-available', result);
      }
      return result;
    } catch (err) {
      logEvent('check-for-update-error', { error: err.message });
      throw err;
    }
  });

  ipcMain.handle('app:download-update', async (_event, downloadUrl) => {
    logEvent('download-update', { downloadUrl });
    try {
      await updateChecker.downloadUpdate(downloadUrl);
    } catch (err) {
      logEvent('download-update-error', { error: err.message });
      throw err;
    }
  });

  ipcMain.handle('app:open-downloaded-update', async () => {
    logEvent('open-downloaded-update', {});
    try {
      await updateChecker.openDownloadedUpdate();
    } catch (err) {
      logEvent('open-downloaded-update-error', { error: err.message });
      throw err;
    }
    // updateChecker.openDownloadedUpdate() (bkz. D-38) `pkexec dpkg -i` başarıyla bittiğinde
    // zaten kendi app.relaunch()+app.quit()'ini çağırıyor -- buradaki ikinci quit çağrısı bu
    // yüzden zararsız bir no-op, yalnızca eski (shell.openPath tabanlı, kurulumun kullanıcının
    // ELİYLE bir paket yöneticisi sihirbazında tamamlanmasını beklediği) tasarımdan kalma bir
    // güvenlik ağı olarak bırakıldı.
    logEvent('quit-for-update-install', {});
    const mw = getMainWindow();
    if (mw) mw.isQuitting = true; // pencere close handler'ı tray'e gizlemek yerine gerçekten kapatsın
    setImmediate(() => app.quit());
  });

  ipcMain.handle('app:open-diagnostic-log-location', async () => {
    logEvent('open-diagnostic-log-location', {});
    try {
      const { directory } = await serviceClient.getDiagnosticLogLocation();
      await shell.openPath(directory);
    } catch (err) {
      logEvent('open-diagnostic-log-location-error', { error: err.message });
      throw err;
    }
  });

  ipcMain.handle('app:get-protocol-handler-status', () => ({
    officialDiscordInstalled: isOfficialDiscordInstalled(),
    isDefaultHandler: isDefaultProtocolHandler(),
  }));

  // Ayarlar > İzinler ve Kontroller'deki "Görmezden Gel" ile kapatılan sorun türleri —
  // bkz. localSettings.js ignoredControlIssues. Kontroller ekranı sorunu göstermeye
  // devam eder, yalnızca titlebar'daki genel uyarı bu listedekileri saymaz.
  ipcMain.handle('app:get-ignored-control-issues', () => readLocalSettings().ignoredControlIssues ?? []);
  ipcMain.handle('app:set-control-issue-ignored', (_event, issueId, ignored) => {
    logEvent('set-control-issue-ignored', { issueId, ignored });
    const current = readLocalSettings().ignoredControlIssues ?? [];
    const next = ignored
      ? Array.from(new Set([...current, issueId]))
      : current.filter((id) => id !== issueId);
    writeLocalSettings({ ignoredControlIssues: next });
    // Titlebar'daki "Eylem Gerekli" butonu 30sn'lik periyodik yoklamayı beklemeden hemen
    // güncellensin diye ana pencereye haber veriyoruz (bkz. titlebar.js checkControlsIssues).
    getMainWindow()?.webContents.send('app:controls-issue-status-changed');
    return next;
  });

  // Titlebar'daki genel "Eylem Gerekli" göstergesi için. Windows karşılığı Güvenlik Duvarı
  // izni + Kaspersky/ESET-WinDivert çakışması + harici process tespitini de kapsıyordu —
  // bunların Linux karşılığı yok (bkz. PORTING_PLAN.md D-9), bu yüzden yalnızca resmi
  // Discord tespiti kaldı (ki o da protocolHandler.js'te BİLEREK hep false — bkz. oradaki not).
  ipcMain.handle('app:get-controls-issue-status', async () => {
    const ignored = new Set(readLocalSettings().ignoredControlIssues ?? []);
    const activeIssues = [];
    if (isOfficialDiscordInstalled()) activeIssues.push('official-discord');
    const hasIssue = activeIssues.some((id) => !ignored.has(id));
    return { hasIssue };
  });

  ipcMain.handle('app:uninstall-official-discord', () => {
    logEvent('uninstall-official-discord-click', {});
    return uninstallOfficialDiscord();
  });

  // Windows karşılığındaki app:open-default-apps-settings (ms-settings:defaultapps) BİLEREK
  // YOK — Linux'ta masaüstü ortamına göre değişen, tek bir karşılığı olmayan bir ayar ekranı
  // (GNOME Ayarlar, KDE Sistem Ayarları vb. hepsi farklı) — bkz. PORTING_PLAN.md Faz 7 notu.
  // dpi:get-system-controls-status/kill-process/remove-conflicting-service de aynı gerekçeyle
  // (D-9) yok.

  ipcMain.handle('dpi:get-dns-providers', () => serviceClient.getDnsProviders());
  ipcMain.handle('dpi:set-dns-providers', async (_event, providers) => {
    logEvent('set-dns-providers', { providers });
    try {
      return await serviceClient.setDnsProviders(providers);
    } catch (err) {
      logEvent('set-dns-providers-error', { providers, error: err.message });
      throw err;
    }
  });

  // Ayarlar > İzinler ve Kontroller'deki ses durumu tanılama paneli — tray ikonunun
  // arama/mikrofon/sağırlaştırma algılamasının gerçekten doğru çalıştığını test
  // edebilmek için canlı durumu gösteriyor.
  ipcMain.handle('voice:get-state', () => voiceState.getLastState());
  ipcMain.handle('voice:poll-now', async () => {
    logEvent('voice-state-poll-now', {});
    return voiceState.pollNow();
  });
  voiceState.onVoiceStateChanged((state) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('voice:state-changed', state);
    }
  });

  // Ayarlar > Tuş Atamaları — global (sistem geneli, arkaplandayken de çalışan)
  // kısayollar. Her değişiklikte applyShortcutsFromSettings() mevcut tüm kayıtları
  // silip ayarlara göre baştan kuruyor; register() başarısız olursa (kombinasyon
  // başka bir programda zaten kayıtlıysa) sonuç haritası üzerinden bildiriyor.
  ipcMain.handle('app:get-shortcuts', () => {
    const settings = readLocalSettings();
    return { enabled: settings.globalShortcutsEnabled, bindings: settings.shortcuts };
  });
  ipcMain.handle('app:set-shortcuts-enabled', (_event, enabled) => {
    writeLocalSettings({ globalShortcutsEnabled: enabled });
    logEvent('set-shortcuts-enabled', { enabled });
    applyShortcutsFromSettings();
    return enabled;
  });
  ipcMain.handle('app:set-shortcut-binding', (_event, action, accelerator) => {
    const settings = readLocalSettings();
    const bindings = { ...settings.shortcuts, [action]: accelerator };
    writeLocalSettings({ shortcuts: bindings });
    logEvent('set-shortcut-binding', { action, accelerator });
    const results = applyShortcutsFromSettings();
    return { bindings, ok: accelerator ? !!results[action] : true };
  });

  // Discord webview'indeki "mikrofonundan ses alamıyor" (Hata: 3002) uyarısını
  // bastırmak için — bkz. discordWebviewPreload.js setupVoiceWarningNoticeHandler.
  // ipcRenderer.invoke ile doğrudan webview preload'undan da çağrılıyor.
  ipcMain.handle('app:get-disable-false-voice-warning', () => readLocalSettings().disableFalseVoiceWarning ?? false);
  ipcMain.handle('app:set-disable-false-voice-warning', (_event, enabled) => {
    writeLocalSettings({ disableFalseVoiceWarning: enabled });
    logEvent('set-disable-false-voice-warning', { enabled });
    return enabled;
  });

  // KULLANICI TALEBİ: Ayarlar > Genel > "Hatalı metinleri vurgulamayı devre dışı bırak"
  // -- QUIC'in aksine yeniden başlatma GEREKMİYOR, session.setSpellCheckerEnabled()
  // runtime'da anında etkili (bkz. permissions.js applySpellcheckSetting).
  ipcMain.handle('app:get-disable-spellcheck-highlight', () => readLocalSettings().disableSpellcheckHighlight ?? true);
  ipcMain.handle('app:set-disable-spellcheck-highlight', (_event, enabled) => {
    writeLocalSettings({ disableSpellcheckHighlight: enabled });
    logEvent('set-disable-spellcheck-highlight', { enabled });
    applySpellcheckSetting(enabled);
    return enabled;
  });

  // Tray ikonundaki okunmamış bildirim rozeti (bkz. notificationBadge.js, tray.js).
  ipcMain.handle('app:get-notification-badge-enabled', () => readLocalSettings().notificationBadgeEnabled);
  ipcMain.handle('app:set-notification-badge-enabled', (_event, enabled) => {
    writeLocalSettings({ notificationBadgeEnabled: enabled });
    logEvent('set-notification-badge-enabled', { enabled });
    notificationBadge.forceRefresh();
    return enabled;
  });

  // Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" — hem servis tarafındaki DPI
  // ayarlarını hem istemcinin kendi yerel ayarlarını hem de Discord oturumunu (çerezler/
  // localStorage/önbellek) fabrika durumuna döndürüp uygulamayı yeniden başlatır.
  ipcMain.handle('app:reset-all-settings', async () => {
    logEvent('reset-all-settings', {});

    try {
      await serviceClient.resetServiceSettings();
    } catch (err) {
      // Servise ulaşılamasa bile istemci tarafını sıfırlamaya devam ediyoruz — kullanıcı
      // "sıfırla" dedi, servis o an kapalı olsa bile en azından client verisi temizlenmeli.
      logEvent('reset-all-settings-service-error', { error: err.message });
    }

    try {
      const discordSession = session.fromPartition('persist:discord');
      await discordSession.clearStorageData();
      await discordSession.clearCache();
    } catch (err) {
      logEvent('reset-all-settings-session-error', { error: err.message });
    }

    resetLocalSettings();

    const mw = getMainWindow();
    if (mw) mw.isQuitting = true; // gerçek çıkış: pencere close handler'ı artık engellemiyor
    app.relaunch();
    app.quit();
  });

  // Ayarlar > Hakkında'daki "SplitCord-Turkey'i Kaldır" (bkz. PORTING_PLAN.md D-37) — .deb
  // ARTIK TEK dağıtım formatı olduğu ve postrm (packaging/deb-postrm.sh) DPI servisini de
  // otomatik söktüğü için (bkz. D-36), burada tek yapılması gereken paketi kaldırmak:
  // `pkexec apt-get remove` (appUninstaller.js) hem uygulamayı hem servisi TEK ADIMDA temizler.
  // Windows karşılığı NSIS kaldırıcısını ShellExecute ile (otomatik UAC) açıp HEMEN app.quit()
  // çağırıyordu; burada FARK OLARAK pkexec'in kendi işlemi bitene (resolve/reject) kadar
  // BEKLİYORUZ çünkü Linux'ta dosyaları o an çalışan bir process'ten silmek (Windows'un aksine)
  // sorunsuz — kaldırma gerçekten TAMAMLANDIKTAN sonra uygulamayı kapatmak, kullanıcıya "başarılı
  // oldu mu" belirsizliği bırakmıyor ve bir hata olursa (ör. apt kilidi) düzgün bir mesaj
  // gösterebiliyoruz.
  ipcMain.handle('app:uninstall-app', async () => {
    logEvent('uninstall-app-click', {});

    // PORT_PLAN_2.md AP-3: AppImage'da kurulum kavramı yok (apt paketi hiç yok), bu yüzden
    // appUninstaller.js'in `pkexec apt-get remove` çağrısı burada anlamsız/hatalı olurdu --
    // appUninstaller.js'in KENDİSİ hiç değiştirilmedi (bkz. PORT_PLAN_2.md §1 madde 2), yalnızca
    // buraya, çağrıdan ÖNCE bir koruma eklendi. Renderer tarafında buton zaten AppImage'da
    // gizleniyor (bkz. settings.js) -- bu yalnızca ikinci bir güvenlik ağı.
    if (isAppImage()) {
      throw new Error('AppImage sürümünde ayrı bir kaldırma adımına gerek yok -- AppImage dosyasını silmen yeterli.');
    }

    try {
      await Promise.race([
        serviceClient.stopAllEngines(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (err) {
      logEvent('uninstall-app-stop-engines-error', { error: err.message });
    }

    try {
      await uninstallAppPackage();
    } catch (err) {
      const cancelled = err.message === 'CANCELLED';
      logEvent('uninstall-app-failed', { error: err.message, cancelled });
      throw cancelled ? err : new Error(`Kaldırma başarısız: ${err.message}`);
    }

    logEvent('uninstall-app-succeeded', {});
    const mw = getMainWindow();
    if (mw) mw.isQuitting = true; // gerçek çıkış: pencere close handler'ı artık engellemiyor
    app.quit();
  });

  // PORT_PLAN_2.md Faz 4 — renderer'ın deb/AppImage'a göre dallanabilmesi (Kaldır butonunu
  // gizlemek, Hakkında panelindeki güncelleme butonunun davranışını değiştirmek, İzinler
  // panelindeki AppImage bağımlılık bölümünü göstermek/gizlemek) için tek, paylaşılan kaynak.
  ipcMain.handle('app:get-packaging-kind', () => getPackagingKind());

  // PORT_PLAN_2.md AP-2 — AppImage'ın basitleştirilmiş güncelleme akışı: indirme/kurulum YOK,
  // yalnızca release sayfasını tarayıcıda açıyor. .deb'in download-update/open-downloaded-update
  // handler'ları (yukarıda) TEK SATIR değişmedi, bu tamamen ayrı/ek bir handler.
  ipcMain.handle('app:open-release-page', async (_event, releaseUrl) => {
    logEvent('open-release-page', { releaseUrl });
    try {
      await updateChecker.openReleasePage(releaseUrl);
    } catch (err) {
      logEvent('open-release-page-error', { error: err.message });
      throw err;
    }
  });

  // PORT_PLAN_2.md AP-5/Faz 3 — servisin YENİ /dependency-check uç noktasının ince bir geçişi.
  // Uç nokta her iki paketleme türünde de var (servis deb/AppImage ayrımını bilmiyor, bkz.
  // PORT_PLAN_2.md §1 madde 4) ama İzinler panelinde yalnızca AppImage'da GÖSTERİLİYOR (bkz.
  // settings.js) -- .deb zaten apt'ın kendi dependency çözümüyle bu kütüphaneleri garantiliyor
  // (bkz. PORT_PLAN_2.md §10 madde 3'teki açık not).
  ipcMain.handle('dpi:dependency-check', () => serviceClient.getDependencyCheck());

  // PORT_PLAN_2.md AP-16 (2026-09-09, kullanıcı talebi) — AppImage'a özgü bağımlılık/dağıtım
  // uyarı diyaloğundaki "Sorun Bildir" butonu. Repo/temel URL'i BİLEREK renderer'dan gelen bir
  // parametre DEĞİL, burada sabit -- renderer yalnızca başlık/gövde METNİNİ belirliyor, keyfi bir
  // URL açma yüzeyi oluşturmuyoruz (openReleasePage'in aksine, o zaten GitHub API'sinden gelen
  // güvenilir bir URL'i açıyordu).
  ipcMain.handle('app:open-issue-page', async (_event, { title, body }) => {
    const url = `https://github.com/cagritaskn/SplitCord-Turkey/issues/new?title=${encodeURIComponent(title || '')}&body=${encodeURIComponent(body || '')}`;
    logEvent('open-issue-page', { title });
    try {
      await shell.openExternal(url);
    } catch (err) {
      logEvent('open-issue-page-error', { error: err.message });
      throw err;
    }
  });
}

module.exports = { registerIpcHandlers, openSettingsWindow };
