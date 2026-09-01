'use strict';

const { app } = require('electron');
const serviceClient = require('./serviceClient');

/**
 * DPI motorunun (ByeDPI/GoodbyeDPI/Zapret) ömrünü bu Electron uygulamasının ömrüne bağlar:
 * uygulama açılınca tercih edilen motoru başlatır, uygulama gerçekten kapanırken
 * (tray'e küçültme değil, asıl çıkış) durdurur. DPI Service'in kendisi (Windows Service,
 * SYSTEM) bundan bağımsız arkaplanda ayakta kalmaya devam eder — yalnızca içindeki
 * motor süreçleri (ciadpi.exe/goodbyedpi.exe/winws.exe) başlatılıp durduruluyor.
 */
async function startConfiguredEngine() {
  try {
    const status = await serviceClient.getDpiStatus();
    if (status?.activeEngineId) {
      await serviceClient.activateEngine(status.activeEngineId);
    }
  } catch (err) {
    console.error('DPI motoru başlatılamadı (DPI Service kurulu ve çalışıyor mu?):', err.message);
  }
}

function registerShutdownHook() {
  let stopped = false;

  app.on('before-quit', async (event) => {
    if (stopped) return;
    event.preventDefault();

    try {
      await serviceClient.stopAllEngines();
    } catch (err) {
      console.error('DPI motorları durdurulurken hata:', err.message);
    }

    stopped = true;
    app.quit();
  });
}

module.exports = { startConfiguredEngine, registerShutdownHook };
