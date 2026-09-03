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
    if (status?.switching) {
      // Servis tarafında zaten bir tarama sürüyor (ör. uygulama az önce kapanıp yeniden
      // açıldı, önceki oturumdan kalma bir tarama hâlâ devam ediyor). Yine de activate
      // çağırmak DpiEngineManager.SwitchToAsync'in tepesindeki KOŞULSUZ _scanCts.Cancel()
      // yüzünden bu taramayı GEREKSİZ YERE iptal edip DoH tier'inden SIFIRDAN başlatırdı --
      // canlı testte doğrulandı: özellikle Zapret2'nin dakikalarca sürebilen DNS tier
      // taramasında, uygulama her yeniden açıldığında ilerleme sıfırlanıyor, kullanıcı
      // "Discord'a Erişilemiyor" ekranında sıkışmış gibi görünen bir döngüye giriyordu
      // (aslında ISP/strateji sorunu değildi -- her yeniden başlatma taramayı baştan
      // atıyordu). Sürmekte olan taramaya dokunmadan bırakıyoruz; renderer'ın kendi 3sn'lik
      // yoklama döngüsü (refreshConnection) zaten ilerlemeyi gösterecek.
      return;
    }
    const active = status?.engines?.find((e) => e.id === status.activeEngineId);
    if (active?.running) {
      // Hedef motor zaten çalışıyor -- activate çağırmak yine de DpiEngineManager.
      // SwitchToAsync'in "TÜM motorları durduruyoruz -- HEDEF dahil" adımı yüzünden bu
      // ZATEN İYİ ÇALIŞAN süreci durdurup sıfırdan yeniden başlatırdı. Bu, özellikle
      // Zapret2/WinDivert'te (bkz. Zapret2Engine.TryCandidateAsync üstündeki kararlılık
      // notları) az önce kapanan bir winws2.exe'nin hemen ardından yeniden başlatılan
      // örneğin geçici olarak bağlantı testinden geçemeyip gereksiz bir yeniden tarama
      // döngüsüne girmesine yol açabiliyordu (canlı testte doğrulandı: art arda iki
      // uygulama yeniden başlatması arasında zaten doğrulanmış/çalışan bir strateji
      // gereksiz yere yeniden test edilip bir anlığına "SSL connection could not be
      // established" hatalarıyla başarısız oluyordu). Dokunmadan bırakıyoruz.
      return;
    }
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
