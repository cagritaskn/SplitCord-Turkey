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
 * applyDpiProxy() tarafından, hangi DPI motorunun aktif olduğuna göre ÇAĞRILIR (bkz.
 * dpiProxy.js). app.whenReady()'den SONRA herhangi bir noktada çağrılabilir.
 *
 * useSystemResolver=false (varsayılan, ByeDPI/Zapret/Zapret2 aktifken/hiç motor yokken):
 * DNS-over-HTTPS, kullanıcının Ayarlar'dan yapılandırdığı DNS sağlayıcı listesindeki İLK
 * "doh" tipli girişle (yoksa FALLBACK_DOH_URL ile) ZORLANIR — ISP'nin düz DNS yanıtlarını
 * manipüle etmesine karşı. Zapret'in (winws.exe) KENDİ bir DNS/DoH mekanizması yok, bu
 * yüzden bu ayar (sistem/adaptör DNS ayarına dokunmayan, yalnızca bu Electron sürecine özel
 * bir Chromium ayarı) Zapret aktifken de zorlanmaya devam ediyor — aksi hâlde ISP DNS'i
 * potansiyel olarak zehirli/engelliyse Zapret neredeyse her zaman başarısız oluyor (canlı
 * testte doğrulandı).
 *
 * useSystemResolver=true (yalnızca GoodbyeDPI aktifken): secure DNS KAPATILIR, Chromium
 * işletim sisteminin yapılandırdığı çözümleyiciyi kullanır. ÖNEMLİ: GoodbyeDPI kendi DNS
 * yönlendirmesini (--dns-addr/--dnsv6-addr, WinDivert ile SİSTEM GENELİ) yapıyor — bu
 * yalnızca düz UDP:53 sorgularını yakalıyor. Chromium'un DoH'u ZORLANIRSA sorgular bunun
 * yerine yapılandırılan DoH sunucusuna düz bir HTTPS bağlantısı olarak gider ve WinDivert'in
 * hiç göremediği bir yoldan geçer — yani motorun kendi DNS düzeltmesi tamamen devre dışı
 * kalır (canlı testte tam olarak bu yaşandı: curl sistem DNS'i üzerinden başarılıyken,
 * zorunlu Google DoH kullanan webview ERR_CONNECTION_RESET ile başarısız oluyordu).
 *
 * ByeDPI aktifken bu ayarın önemi yok: Discord webview'i bir SOCKS5 proxy'ye (ciadpi)
 * yönlendiriliyor; Chromium SOCKS5 proxy'lerde ismi HER ZAMAN proxy tarafında çözdürür
 * (uzak/"socks5h" davranışı, Chromium'da sabit) — asıl DNS çözümlemesi ciadpi.exe
 * içinde olur, Electron'un host resolver ayarından etkilenmez.
 */
async function configureSecureDns(useSystemResolver = false) {
  if (useSystemResolver) {
    app.configureHostResolver({ secureDnsMode: 'off' });
    return;
  }

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
