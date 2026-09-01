'use strict';

const { app } = require('electron');

/**
 * Chromium'un kendi DNS çözümleyicisinin modunu ayarlar — motoru aktif hâle getiren
 * applyDpiProxy() tarafından, hangi DPI motorunun aktif olduğuna göre ÇAĞRILIR (bkz.
 * dpiProxy.js). app.whenReady()'den SONRA herhangi bir noktada çağrılabilir.
 *
 * useSystemResolver=false (varsayılan, ByeDPI/Zapret aktifken/hiç motor yokken): DNS-over-HTTPS
 * Google'ın çözümleyicisiyle ZORLANIR — ISP'nin düz DNS yanıtlarını manipüle etmesine karşı.
 * Zapret'in (winws.exe) KENDİ bir DNS/DoH mekanizması yok, bu yüzden bu ayar (sistem/adaptör
 * DNS ayarına dokunmayan, yalnızca bu Electron sürecine özel bir Chromium ayarı) Zapret
 * aktifken de zorlanmaya devam ediyor — aksi hâlde ISP DNS'i potansiyel olarak zehirli/
 * engelliyse Zapret neredeyse her zaman başarısız oluyor (canlı testte doğrulandı).
 *
 * useSystemResolver=true (yalnızca GoodbyeDPI aktifken): secure DNS KAPATILIR, Chromium
 * işletim sisteminin yapılandırdığı çözümleyiciyi kullanır. ÖNEMLİ: GoodbyeDPI kendi DNS
 * yönlendirmesini (--dns-addr/--dnsv6-addr, WinDivert ile SİSTEM GENELİ) yapıyor — bu
 * yalnızca düz UDP:53 sorgularını yakalıyor. Chromium'un DoH'u ZORLANIRSA sorgular bunun
 * yerine dns.google'a düz bir HTTPS bağlantısı olarak gider ve WinDivert'in hiç göremediği
 * bir yoldan geçer — yani motorun kendi DNS düzeltmesi tamamen devre dışı kalır (canlı
 * testte tam olarak bu yaşandı: curl sistem DNS'i üzerinden başarılıyken, zorunlu Google
 * DoH kullanan webview ERR_CONNECTION_RESET ile başarısız oluyordu).
 *
 * ByeDPI aktifken bu ayarın önemi yok: Discord webview'i bir SOCKS5 proxy'ye (ciadpi)
 * yönlendiriliyor; Chromium SOCKS5 proxy'lerde ismi HER ZAMAN proxy tarafında çözdürür
 * (uzak/"socks5h" davranışı, Chromium'da sabit) — asıl DNS çözümlemesi ciadpi.exe
 * içinde olur, Electron'un host resolver ayarından etkilenmez.
 */
function configureSecureDns(useSystemResolver = false) {
  if (useSystemResolver) {
    app.configureHostResolver({ secureDnsMode: 'off' });
  } else {
    app.configureHostResolver({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://dns.google/dns-query'],
    });
  }
}

module.exports = { configureSecureDns };
