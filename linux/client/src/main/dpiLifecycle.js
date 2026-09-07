'use strict';

const { app } = require('electron');
const serviceClient = require('./serviceClient');
const { logEvent } = require('./log');

// Sistem açılışında istemci (autostart ile artık GERÇEKTEN erken açılıyor, bkz. autostart.js
// düzeltmesi) ile DPI Service'in systemd birimi (network-online.target'ı bekleyip kendi
// Kestrel HTTP dinleyicisini ayağa kaldırması birkaç saniye sürebilir) arasında bir yarış
// var -- CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-07): startConfiguredEngine() servise TEK
// seferlik bir getDpiStatus() çağrısı atıyordu; istemci servisten önce açılıp bu çağrı
// ECONNREFUSED ile anında başarısız olursa (servis portu henüz dinlemiyor), motor HİÇ
// aktive edilmiyordu ve bir daha da denenmiyordu -- yalnızca console.error'a düşüyordu,
// kullanıcı elle Ayarlar'dan dokunana ya da uygulamayı yeniden açana kadar (o zaman servis
// çoktan ayakta olduğu için çalışıyordu) sessizce böyle kalıyordu. Düzeltme: yalnızca servise
// ulaşmanın kendisi (getDpiStatus) başarısız olduğu sürece artan aralıklarla yeniden dene --
// servise bir kez ulaşılabildiğinde (durum ne olursa olsun) döngüden çıkılıyor, devamı zaten
// eskisi gibi tek seferlik mantıkla ilerliyor.
const SERVICE_WAIT_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 5000, 5000, 5000, 5000];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDpiStatusWithRetry() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await serviceClient.getDpiStatus();
    } catch (err) {
      if (attempt >= SERVICE_WAIT_RETRY_DELAYS_MS.length) throw err;
      logEvent('dpi-service-not-ready-retry', { attempt: attempt + 1, error: err.message });
      await delay(SERVICE_WAIT_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * DPI motorunun (ByeDPI/Zapret/Zapret2) ömrünü bu Electron uygulamasının ömrüne bağlar:
 * uygulama açılınca tercih edilen motoru başlatır, uygulama gerçekten kapanırken
 * (tray'e küçültme değil, asıl çıkış) durdurur. DPI Service'in kendisi (systemd birimi,
 * root) bundan bağımsız arkaplanda ayakta kalmaya devam eder — yalnızca içindeki
 * motor süreçleri (ciadpi/nfqws/nfqws2) başlatılıp durduruluyor.
 */
async function startConfiguredEngine() {
  try {
    const status = await getDpiStatusWithRetry();
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
    logEvent('dpi-engine-autostart-failed', { error: err.message });
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
