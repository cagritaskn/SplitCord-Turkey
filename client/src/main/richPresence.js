'use strict';

const { logEvent } = require('./log');

// Discord'un yerel RPC sunucularının (isimlendirilmiş boru + 6463-6472 WebSocket) açık
// kaynak bir implementasyonu — arRPC (OpenAsar, MIT). Discord'un web istemcisi (bizim
// sardığımız discord.com/app) tarayıcı içinden yerel bir boru/soket AÇAMAZ, bu yüzden
// Rich Presence normalde yalnızca resmi masaüstü istemcisinde çalışır. arRPC tam olarak bu
// native tarafı (oyunların/uygulamaların bağlandığı sunucuyu) taklit ediyor; karşı tarafta,
// Discord'un kendi web JS paketindeki durumu GERÇEKTEN uygulayan (Flux dispatch) kodu ise
// discordWebviewPreload.js'teki enjekte edilmiş köprü script'i çalıştırıyor (bkz. oradaki
// setupRichPresenceBridge yorumu). Aynı mimariyi ArmCord, Vesktop ve Vencord'un
// "WebRichPresence (arRPC)" eklentisi de kullanıyor — kendi başımıza reverse-engineering
// yapmak yerine bu olgun, üzerinde topluluk testi yapılmış implementasyona dayanıyoruz.
//
// NOT: arRPC "type": "module" (yalnızca ESM) olduğu için CommonJS ana sürecimizden dinamik
// import() ile yükleniyor. Paketin "exports" alanı olmadığından src/bridge.js gibi alt yol
// importları Node tarafından serbestçe çözülüyor.
let started = false;

async function startRichPresence() {
  if (started) return;
  started = true;

  try {
    const { default: RPCServer } = await import('arrpc/src/server.js');
    const Bridge = await import('arrpc/src/bridge.js');

    const server = await new RPCServer();
    server.on('activity', (data) => Bridge.send(data));

    logEvent('rich-presence-started', {});
  } catch (err) {
    // arRPC'nin kendisi, boru/port zaten kullanımdaysa (ör. gerçek Discord masaüstü aynı
    // anda açık) sıradakini deneyerek bununla başa çıkıyor — buraya düşen bir hata gerçekten
    // beklenmeyen bir durumdur. Rich Presence olmadan da uygulamanın geri kalanı sorunsuz
    // çalışmaya devam etmeli, bu yüzden hatayı yalnızca logluyoruz.
    started = false;
    logEvent('rich-presence-start-error', { error: err.message });
  }
}

module.exports = { startRichPresence };
