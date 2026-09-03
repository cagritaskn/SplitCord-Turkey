'use strict';

const { app, ipcMain, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { getMainWindow } = require('./window');
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

    try {
      const result = await serviceClient.setEngineArgs(id, args, restart);
      if (restart) {
        await applyDpiProxy();
        getMainWindow()?.webContents.send('dpi:engine-changed');
      }
      return result;
    } catch (err) {
      logEvent('set-engine-args-error', { id, error: err.message });
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

  // GoodbyeDPI/Zapret'in genel karşılığı: webview'de (titlebar.js) o motorun doğrulanmış
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

  // DPI Aşımı ekranındaki Otomatik/Manuel toggle — yalnızca istemci tarafında (yerel
  // ayar) hangi görünümün gösterileceğini belirler. Otomatik'e geçilince Zapret2'nin
  // (Otomatik modun giriş noktası — bkz. DpiEngineManager.SwitchToAsync) gerçekten aktif
  // motor olduğundan emin olunur.
  ipcMain.handle('dpi:get-mode', () => readLocalSettings().dpiMode);
  ipcMain.handle('dpi:set-mode', async (_event, mode) => {
    logEvent('set-dpi-mode', { mode });
    try {
      writeLocalSettings({ dpiMode: mode });
      if (mode === 'automatic') {
        // Manuel'den gelirken zaten Zapret2 aktif/taranıyorsa (bkz. settings.js
        // carryOverZapret2Scan) o tarama hiç iptal edilmeden burada da dokunmadan
        // bırakılıyor — aksi hâlde zaten sürmekte olan aynı taramayı sıfırdan yeniden
        // başlatıp kullanıcı gözünden hiçbir şey değişmemiş gibi görünürdü.
        let status = null;
        try {
          status = await serviceClient.getDpiStatus();
        } catch (err) {
          logEvent('get-status-before-set-mode-error', { error: err.message });
        }
        const currentEngineId = status?.switching ? status.switchingToEngineId : status?.activeEngineId;
        if (currentEngineId !== 'zapret2') {
          await serviceClient.activateEngine('zapret2');
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

  // Üç motor için de ortak (ByeDPI/GoodbyeDPI/Zapret) — Otomatik moddaki "Argüman Setini
  // Yasakla" butonu, hangi motor o an aktifse onun id'sini gönderiyor.
  ipcMain.handle('dpi:get-rejected-args', (_event, id) => serviceClient.getRejectedArgs(id));
  ipcMain.handle('dpi:reject-current-args', async (_event, id) => {
    // Bu buton yalnızca Otomatik modda göründüğü için allowEscalation=true her zaman
    // doğru, ama yine de dpiMode'a göre hesaplıyoruz (diğer handler'larla tutarlı olsun diye).
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

  ipcMain.handle('dpi:get-firewall-status', () => serviceClient.getFirewallStatus());
  ipcMain.handle('dpi:grant-firewall-permission', async () => {
    logEvent('grant-firewall-permission', {});
    try {
      const result = await serviceClient.grantFirewallPermission();
      getMainWindow()?.webContents.send('app:controls-issue-status-changed');
      return result;
    } catch (err) {
      logEvent('grant-firewall-permission-error', { error: err.message });
      throw err;
    }
  });

  ipcMain.handle('dpi:get-app-firewall-status', () => serviceClient.getAppFirewallStatus(app.getPath('exe')));
  ipcMain.handle('dpi:grant-app-firewall-permission', async () => {
    logEvent('grant-app-firewall-permission', {});
    try {
      const result = await serviceClient.grantAppFirewallPermission(app.getPath('exe'));
      getMainWindow()?.webContents.send('app:controls-issue-status-changed');
      return result;
    } catch (err) {
      logEvent('grant-app-firewall-permission-error', { error: err.message });
      throw err;
    }
  });

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
    // dynamicColor.js kendi zamanlama döngüsünde bir sonraki turda bu ayarı okuyup
    // örnekleme sıklığını (1 sn / 10 sn) buna göre ayarlıyor — burada ekstra bir
    // müdahaleye gerek yok.
    getMainWindow()?.webContents.send('app:performance-mode-changed', enabled);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('app:performance-mode-changed', enabled);
    }
    return enabled;
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

  // Titlebar'daki genel "Eylem Gerekli" göstergesi için — Ayarlar > İzinler ve
  // Kontroller ekranındaki TÜM kırmızı-X durumlarını (Güvenlik Duvarı izni, resmi
  // Discord uygulaması kurulu, Kaspersky/ESET, çakışabilecek hizmet/harici process) tek
  // bir bayrakta topluyor — "Görmezden Gel" ile kapatılmış sorun türleri hariç. Servise
  // ulaşılamıyorsa ilgili kontrol sessizce atlanıyor — zaten genel bağlantı hatası ayrıca
  // görünür, burada yanlış alarm vermek istemiyoruz.
  ipcMain.handle('app:get-controls-issue-status', async () => {
    let firewallGranted = true;
    let appFirewallGranted = true;
    let systemControls = null;
    try {
      const firewall = await serviceClient.getFirewallStatus();
      firewallGranted = firewall?.granted !== false;
    } catch (err) {
      logEvent('get-controls-issue-status-firewall-error', { error: err.message });
    }
    try {
      const appFirewall = await serviceClient.getAppFirewallStatus(app.getPath('exe'));
      appFirewallGranted = appFirewall?.granted !== false;
    } catch (err) {
      logEvent('get-controls-issue-status-app-firewall-error', { error: err.message });
    }
    try {
      systemControls = await serviceClient.getSystemControlsStatus();
    } catch (err) {
      logEvent('get-controls-issue-status-system-controls-error', { error: err.message });
    }

    const ignored = new Set(readLocalSettings().ignoredControlIssues ?? []);
    const activeIssues = [];
    if (isOfficialDiscordInstalled()) activeIssues.push('official-discord');
    if (systemControls?.kasperskyDetected) activeIssues.push('kaspersky');
    if (systemControls?.esetDetected) activeIssues.push('eset');
    for (const svc of systemControls?.conflictingServicesInstalled ?? []) {
      activeIssues.push(`service:${svc.serviceName}`);
    }
    if ((systemControls?.externalGoodbyeDpiProcesses?.length ?? 0) > 0) activeIssues.push('external-goodbyedpi-process');
    if ((systemControls?.externalZapretProcesses?.length ?? 0) > 0) activeIssues.push('external-zapret-process');
    if ((systemControls?.extraCiadpiProcesses?.length ?? 0) > 0) activeIssues.push('extra-ciadpi-process');

    // Güvenlik duvarı izinleri kasıtlı olarak "Görmezden Gel" listesinden muaf — eksik
    // izin, DPI aşımını veya ses bağlantısını gerçekten bozabileceği için ignore edilip
    // edilmediğine bakılmaksızın her zaman "Eylem Gerekli" olarak sayılıyor.
    const hasIssue = !firewallGranted || !appFirewallGranted || activeIssues.some((id) => !ignored.has(id));
    return { hasIssue };
  });

  ipcMain.handle('app:uninstall-official-discord', () => {
    logEvent('uninstall-official-discord-click', {});
    return uninstallOfficialDiscord();
  });

  ipcMain.handle('app:open-default-apps-settings', () => {
    logEvent('open-default-apps-settings', {});
    shell.openExternal('ms-settings:defaultapps');
  });

  ipcMain.handle('dpi:get-system-controls-status', () => serviceClient.getSystemControlsStatus());
  ipcMain.handle('dpi:kill-process', async (_event, pid) => {
    logEvent('kill-process', { pid });
    try {
      return await serviceClient.killProcess(pid);
    } catch (err) {
      logEvent('kill-process-error', { pid, error: err.message });
      throw err;
    }
  });
  ipcMain.handle('dpi:remove-conflicting-service', async (_event, serviceName) => {
    logEvent('remove-conflicting-service', { serviceName });
    try {
      return await serviceClient.removeConflictingService(serviceName);
    } catch (err) {
      logEvent('remove-conflicting-service-error', { serviceName, error: err.message });
      throw err;
    }
  });

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

  // Ayarlar > Hakkında'daki "SplitCord-Turkey'i Kaldır" — NSIS'in ürettiği resmi kaldırıcıyı
  // (kendi elevation'ını kendi ister) çalıştırmadan ÖNCE, dosyaların silinmesine engel
  // olabilecek her şeyi burada elden geldiğince temizliyoruz: servisten tüm motorları
  // durdurmasını istiyoruz (best-effort — servis o an yanıt vermese bile devam ediyoruz,
  // asıl garanti kaldırıcının kendi customUnInstall adımındaki uninstall-service.ps1'de,
  // o script winws.exe/ciadpi.exe/goodbyedpi.exe'yi zaten zorla kapatıp WinDivert sürücü
  // kalıntılarını da temizliyor). Kaldırıcı elektron paketinin YANINDA duruyor (electron-
  // builder'ın standart "Uninstall <productName>.exe" çıktısı) — sabit isim yerine desenle
  // arıyoruz ki productName ileride değişirse kırılmasın.
  ipcMain.handle('app:uninstall-app', async () => {
    logEvent('uninstall-app-click', {});

    try {
      await Promise.race([
        serviceClient.stopAllEngines(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (err) {
      logEvent('uninstall-app-stop-engines-error', { error: err.message });
    }

    const installDir = path.dirname(process.execPath);
    let uninstallerName;
    try {
      uninstallerName = fs.readdirSync(installDir).find((f) => /^Uninstall .*\.exe$/i.test(f));
    } catch (err) {
      logEvent('uninstall-app-readdir-error', { error: err.message });
    }

    if (!uninstallerName) {
      logEvent('uninstall-app-not-found', { installDir });
      throw new Error('Kaldırıcı bulunamadı (yalnızca kurulmuş sürümde kullanılabilir).');
    }

    const uninstallerPath = path.join(installDir, uninstallerName);
    logEvent('uninstall-app-launching', { uninstallerPath });

    // shell.openPath (ShellExecuteEx tabanlı) kullanıyoruz — kaldırıcının .exe manifestindeki
    // requireAdministrator, yalnızca ShellExecute üzerinden başlatılırsa otomatik UAC istemi
    // gösteriyor; düz child_process.spawn (CreateProcess tabanlı) manifest elevation'ı
    // TETİKLEMEZ, sessizce "yükseltme gerekli" hatasıyla başarısız olurdu.
    const openError = await shell.openPath(uninstallerPath);
    if (openError) {
      logEvent('uninstall-app-open-error', { error: openError });
      throw new Error(`Kaldırıcı başlatılamadı: ${openError}`);
    }

    const mw = getMainWindow();
    if (mw) mw.isQuitting = true;
    app.quit();
  });
}

module.exports = { registerIpcHandlers, openSettingsWindow };
