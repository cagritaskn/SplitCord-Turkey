'use strict';

const { session, desktopCapturer, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { DISCORD_PARTITION } = require('./permissions');
const dynamicColor = require('./dynamicColor');

// Seçici penceresinde en son seçilen kalite/FPS — discordWebviewPreload.js bunu
// getDisplayMedia() akışı elde edildikten sonra IPC ile okuyup video track'e
// applyConstraints() ile uyguluyor (Electron'un kendi seçici API'si çözünürlük/FPS
// kısıtlaması geçirmeye izin vermiyor, bu yüzden bu dolaylı yolu kullanıyoruz).
let lastQuality = null;

/**
 * Electron, tarayıcıların aksine getDisplayMedia() için kendiliğinden bir "hangi ekranı/
 * pencereyi paylaşacaksın" seçici sunmuyor — bunu uygulamanın kendisinin sağlaması
 * gerekiyor (bkz. desktopCapturer). Discord'un web istemcisi ekran paylaşımı isteyince
 * bu handler devreye girer, kaynakları listeler, küçük bir seçim penceresi gösterir.
 */
function registerScreenSharePicker() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);

  discordSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        // picker.html'deki .source-thumb ile aynı 16:9 oranı — kaynağın gerçek en/boy
        // oranı ne olursa olsun (dikey/kare/geniş pencereler dahil) kart görünümünde
        // hep aynı, öngörülebilir bir kırpma yapılsın diye istek oranı görüntülenen
        // kutunun oranıyla eşleştiriliyor.
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });

      const picked = await pickSource(sources);
      if (!picked) {
        callback({});
        return;
      }

      const chosen = sources.find((s) => s.id === picked.id);
      if (!chosen) {
        callback({});
        return;
      }

      lastQuality = { width: picked.width, height: picked.height, frameRate: picked.frameRate };

      // Kullanıcı seçici penceresindeki "Ses" anahtarını kapatırsa, Discord ses istemiş
      // olsa bile (request.audioRequested) bilgisayar sesi PAYLAŞILMIYOR — iki koşul da
      // (Discord'un isteği + kullanıcının tercihi) sağlanmalı. ÖNEMLİ: Electron'un
      // setDisplayMediaRequestHandler'ı "audio: undefined" değerini KABUL ETMİYOR
      // ("audio must be a WebFrameMain, 'loopback' or 'loopbackWithMute'" hatasıyla
      // çöküyor) — ses paylaşılmayacaksa alan tamamen ATLANMALI, undefined olarak
      // set edilmemeli.
      const callbackOptions = { video: chosen };
      if (request.audioRequested && picked.sendAudio) callbackOptions.audio = 'loopback';
      callback(callbackOptions);
    } catch (err) {
      console.error('Ekran paylaşımı seçici hatası:', err);
      callback({});
    }
  });

  ipcMain.handle('screen-share-picker:get-last-quality', () => lastQuality);
}

/** @returns {Promise<{id: string, width?: number, height?: number, frameRate?: number, sendAudio?: boolean} | null>} */
function pickSource(sources) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
      if (!picker.isDestroyed()) picker.close();
    };

    const onChoose = (_event, result) => finish(result);
    const onCancel = () => finish(null);
    const cleanup = () => {
      ipcMain.removeListener('screen-share-picker:choose', onChoose);
      ipcMain.removeListener('screen-share-picker:cancel', onCancel);
    };

    ipcMain.on('screen-share-picker:choose', onChoose);
    ipcMain.on('screen-share-picker:cancel', onCancel);

    const picker = new BrowserWindow({
      width: 760,
      height: 500,
      frame: false,
      resizable: false,
      backgroundColor: '#2b2d31',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'screenSharePickerPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    picker.on('closed', () => finish(null));

    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send(
        'screen-share-picker:sources',
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        })),
      );
      // Ana pencere/Ayarlar'daki gibi son bilinen renk paletini hemen gönderiyoruz —
      // pencere ilk açılışta theme.css'teki sabit koyu varsayılanla değil, doğru
      // temayla görünsün diye 30sn'lik döngünün bir sonraki turunu beklemiyoruz.
      const palette = dynamicColor.getLastPalette();
      if (palette) picker.webContents.send('app:dynamic-color-sampled', palette);
      picker.show();
    });

    picker.loadFile(path.join(__dirname, '..', 'renderer', 'screen-picker', 'picker.html'));
  });
}

module.exports = { registerScreenSharePicker };
