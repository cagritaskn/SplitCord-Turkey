'use strict';

const { session, desktopCapturer, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { DISCORD_PARTITION, isAllowedOrigin } = require('./permissions');
const dynamicColor = require('./dynamicColor');
const { loadAppIcon } = require('./icon');

// Seçici penceresinde en son seçilen kalite/FPS — discordWebviewPreload.js bunu
// getDisplayMedia() akışı elde edildikten sonra IPC ile okuyup video track'e
// applyConstraints() ile uyguluyor (Electron'un kendi seçici API'si çözünürlük/FPS
// kısıtlaması geçirmeye izin vermiyor, bu yüzden bu dolaylı yolu kullanıyoruz).
let lastQuality = null;

// GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor — bkz.
// client/src/main/screenSharePicker.js): global kısayollardaki bir çift-tetiklenme
// yüzünden (bkz. shortcuts.js'teki genel debounce) Discord'un "Ekranını Paylaş" butonu
// tek bir kullanıcı eyleminde İKİ KEZ tıklanabiliyordu -- bu da
// setDisplayMediaRequestHandler'ı iki kez, dolayısıyla pickSource()'u iki kez çağırıp İKİ
// AYRI seçici PENCERESİ açıyordu (aşağıdaki pickSource()'taki "ender durum" yorumu bunu
// zaten öngörmüştü, ama yalnızca SONUÇ çapraz-kirlenmesine karşı korunuyordu, ikinci
// pencerenin AÇILMASINI engellemiyordu). Sonuç: kullanıcı üstteki (ikinci) pencereyi
// kapatınca/seçince alttaki (ilk, hâlâ açık) pencere ortaya çıkıyor ve "İptal'e/Başlat'a
// basmama rağmen pencere geri geliyor" gibi görünüyordu. shortcuts.js'teki debounce kök
// nedeni (çift tetiklenmeyi) çözüyor, ama bu bayrak yine de ikinci bir savunma katmanı:
// bir seçici zaten açıkken gelen YENİ bir istek anında reddedilir (ikinci bir pencere
// ASLA açılmaz).
let pickerPending = false;

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
      // GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor — bkz.
      // client/src/main/screenSharePicker.js): Electron'un kendi dokümantasyonu reddetmek
      // için `callback({})` (video/audio alanı olmayan bir nesne) çağırmayı öneriyor, ama
      // Electron'un C++ tarafındaki DisplayMediaDeviceChosen (electron_browser_context.cc),
      // `video_requested` true iken (ekran paylaşımında HER ZAMAN true) ve callback'e
      // verilen nesnede "video" alanı YOKSA `ThrowTypeError("Video was requested, but no
      // video stream was provided")` fırlatıyor -- bu senkron try/catch'imizin
      // YAKALAYAMADIĞI bir main-process hatası/reddi olarak yüzeye çıkıyor ve index.js'teki
      // genel uncaughtException/unhandledRejection yakalayıcısı bunu app.exit(1) ile TÜM
      // uygulamayı kapatarak "işliyor" (bkz. electron/electron#45517, #47980). AYNI
      // dosyadaki `DisplayMediaDeviceChosen`'ın BAŞINDA ise `result->IsNullOrUndefined()`
      // kontrolü var -- callback'e `null` (ya da hiç argüman) verilirse bu THROW'A HİÇ
      // GİRMEDEN, sessizce INVALID_DISPLAY_CAPTURE_CONSTRAINTS ile erken dönüyor. Bu yüzden
      // reddetmek için `callback({})` DEĞİL, `callback(null)` kullanılmalı.

      // GÜVENLİK (CVE-2026-70599'a karşı ek savunma katmanı, Windows istemcisinde bulundu
      // — bkz. permissions.js'teki ayrıntılı not): `display-capture` izni permissions.js'te
      // zaten origin'e göre süzülüyor, ama setDisplayMediaRequestHandler AYRI bir Electron
      // API'si -- izin katmanında (Electron'un kendi CVE'si ya da ileride başka bir sürüm
      // hatası yüzünden) bir kaçak olsa bile, ekran paylaşımı seçicisinin KENDİSİ yalnızca
      // discord.com kökenli isteklere açık olsun diye burada AYRICA doğruluyoruz. Sayfa
      // içine gömülü çapraz kökenli bir iframe (ör. üçüncü taraf embed/activity) bu
      // seçiciyi hiç göremeyecek.
      if (!isAllowedOrigin(request.securityOrigin)) {
        console.error('Ekran paylaşımı reddedildi: izin verilmeyen köken:', request.securityOrigin);
        callback(null);
        return;
      }

      if (pickerPending) {
        console.error('Ekran paylaşımı reddedildi: seçici zaten açık (bkz. yukarıdaki pickerPending notu).');
        callback(null);
        return;
      }
      pickerPending = true;

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
        callback(null);
        return;
      }

      const chosen = sources.find((s) => s.id === picked.id);
      if (!chosen) {
        callback(null);
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
      callback(null);
    } finally {
      pickerPending = false;
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

    // GÜVENLİK/DOĞRULUK (Windows istemcisinde bulundu, buraya da aynen uygulanıyor): bu
    // ipcMain.on dinleyicileri GLOBAL -- bir istek işlenirken (ör. Discord'un aynı anda
    // birden fazla getDisplayMedia() çağrısı yapması gibi ender bir durumda) ikinci bir
    // pickSource() çağrısı da AYNI kanal adlarına kendi dinleyicisini eklerdi; event.sender
    // kontrolü olmadan HER iki dinleyici de ateşlenip birbirinin sonucunu çalardı (yanlış
    // pencereden gelen bir seçim başka bir isteği yanlışlıkla sonuçlandırabilirdi).
    // event.sender'ı bu pickSource() çağrısının KENDİ picker penceresiyle karşılaştırarak
    // yalnızca kendi isteğimize ait mesajları işliyoruz.
    const onChoose = (event, result) => {
      if (event.sender !== picker.webContents) return;
      finish(result);
    };
    const onCancel = (event) => {
      if (event.sender !== picker.webContents) return;
      finish(null);
    };
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
      // GERÇEK BUG (canlı bulundu): icon verilmezse taskbar'da Electron'un varsayılan
      // simgesi görünüyordu -- ana pencere/tray'de kullanılan marka simgesiyle aynısı
      // burada da açıkça set ediliyor.
      icon: loadAppIcon(path.join(__dirname, '..', '..', 'resources', 'icon.png')),
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

// GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
// client/src/main/screenSharePicker.js): pickerPending bayrağı, aynı web sayfası
// içinden gelen AYNI ANDA (gerçekten eşzamanlı) ikinci bir isteği reddediyordu -- ama
// Discord'un/Chromium'un getDisplayMedia() çağrılarını SIRAYLA işlediği ortaya çıktı:
// kullanıcı "Ekranını Paylaş" butonuna arka arkaya (aralıklı da olsa, her biri kendi
// başına geçerli bir tetiklenme) birden fazla kez bastığında, İKİNCİ istek bizim
// handler'ımıza yalnızca BİRİNCİSİ (callback'i çağırıp) TAMAMEN BİTTİKTEN SONRA
// ulaşıyor -- yani pickerPending o anda çoktan false'a dönmüş oluyor, ikinci pencerenin
// açılmasını hiç engellemiyor. Kullanıcı ilk pencereyi kapatınca (isteği
// sonuçlandırınca) ikincisi "sıradan" çıkıp beliriyordu. Gerçek çözüm bu yüzden burada
// DEĞİL -- voiceState.js'in toggleScreenShare()'i, "Ekranını Paylaş" butonuna TEKRAR
// tıklamadan ÖNCE bu bayrağı kontrol etmeli (bkz. oradaki kullanım). Burada yalnızca
// dışa aktarılıyor.
function isPickerPending() {
  return pickerPending;
}

module.exports = { registerScreenSharePicker, isPickerPending };
