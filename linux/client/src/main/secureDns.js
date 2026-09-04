'use strict';

const { app } = require('electron');
const { getDnsProviders } = require('./serviceClient');
const { logEvent } = require('./log');

// Chromium'un configureHostResolver API'si YALNIZCA DNS-over-HTTPS destekliyor (secureDnsMode
// 'secure' + https:// sunucu URL'leri) — DoT/DoQ/DNSCrypt için hiçbir seçeneği yok, bu Chromium'un
// kendi platform sınırı. Bu yüzden bu dosyanın kapsamı KALICI olarak DoH ile sınırlı: kullanıcının
// yapılandırdığı sağlayıcı listesinde (bkz. EncryptedDnsForwarder/settings.js) hiç "doh" tipli
// giriş yoksa (yalnızca DoT/DoQ/DNSCrypt seçtiyse) Chromium'un kendi DoH'u aşağıdaki sabit
// varsayılana düşer — bu durumda servis tarafındaki EncryptedDnsForwarder yine de kullanıcının
// tercih ettiği protokolle çalışmaya devam eder, yalnızca Chromium'un KENDİ (ayrı, Electron
// sürecine özel) DoH ayarı bundan etkilenmez.
const FALLBACK_DOH_URL = 'https://dns.google/dns-query';

/**
 * Chromium'un kendi DNS çözümleyicisinin modunu ayarlar — motoru aktif hâle getiren
 * applyDpiProxy() tarafından çağrılır (bkz. dpiProxy.js). app.whenReady()'den SONRA herhangi
 * bir noktada çağrılabilir.
 *
 * Windows karşılığından FARK: orada bir `useSystemResolver` parametresi vardı (yalnızca
 * GoodbyeDPI aktifken true — WinDivert'in kendi DNS yönlendirmesiyle çakışmaması için Chromium'un
 * DoH'unu kapatıp sistem çözümleyicisine bırakıyordu). GoodbyeDPI Linux'ta yok (bkz.
 * PORTING_PLAN.md D-2) ve Zapret/Zapret2'nin hiçbiri kendi bağımsız bir DNS mekanizması
 * içermiyor (ikisi de EncryptedDnsForwarder'a bağımlı) — bu yüzden o parametre TAMAMEN kalktı,
 * DNS-over-HTTPS HER ZAMAN, hangi motor aktif olursa olsun ZORLANIYOR.
 *
 * DoH, kullanıcının Ayarlar'dan yapılandırdığı DNS sağlayıcı listesindeki İLK "doh" tipli
 * girişle (yoksa FALLBACK_DOH_URL ile) zorlanır — ISP'nin düz DNS yanıtlarını manipüle
 * etmesine karşı. ByeDPI aktifken bu ayarın önemi yok: Discord webview'i bir SOCKS5 proxy'ye
 * (ciadpi) yönlendiriliyor; Chromium SOCKS5 proxy'lerde ismi HER ZAMAN proxy tarafında
 * çözdürür (uzak/"socks5h" davranışı, Chromium'da sabit) — asıl DNS çözümlemesi ciadpi
 * içinde olur, Electron'un host resolver ayarından etkilenmez.
 */
async function configureSecureDns() {
  let dohUrl = FALLBACK_DOH_URL;
  try {
    const providers = await getDnsProviders();
    const firstDoh = (providers ?? []).find((p) => p.protocol === 'doh' && p.address);
    if (firstDoh) dohUrl = firstDoh.address;
  } catch (err) {
    // DPI servisine ulaşılamıyor olabilir (henüz kurulmamış/başlamamış) -- sabit
    // varsayılanla devam ediyoruz, uygulama başlangıcını asla bloklamıyoruz.
    logEvent('secure-dns-get-providers-error', { error: err.message });
  }

  app.configureHostResolver({
    secureDnsMode: 'secure',
    secureDnsServers: [dohUrl],
  });
}

module.exports = { configureSecureDns };
