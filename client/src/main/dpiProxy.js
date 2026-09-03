'use strict';

const { session } = require('electron');
const { getDpiStatus } = require('./serviceClient');
const { DISCORD_PARTITION } = require('./permissions');
const { configureSecureDns } = require('./secureDns');
const { logEvent } = require('./log');

/**
 * DPI Service'ten aktif motoru sorgular ve Discord webview'inin session'ına uygular:
 * - ByeDPI aktifse (yerel SOCKS proxy raporluyorsa) yalnızca bu session'ı ona yönlendirir.
 * - GoodbyeDPI/Zapret gibi sistem geneli motorlar aktifse (proxyAddress yok) veya servise
 *   hiç ulaşılamıyorsa, session'ı 'direct' moda alır (WinDivert zaten sistem seviyesinde
 *   işini yapıyor, ya da hiçbir aşım aktif değil).
 *
 * Bu adım atlanırsa webview doğrudan (proxy'siz) bağlanmaya çalışır ve ISP engeli varsa
 * sayfa hiç yüklenmeden boş kalır — bu yüzden pencere oluşturulmadan önce çağrılmalı.
 */
async function applyDpiProxy() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);

  try {
    const status = await getDpiStatus();
    const active = status.engines?.find((e) => e.id === status.activeEngineId);
    if (active?.running && active.proxyAddress) {
      await discordSession.setProxy({ proxyRules: active.proxyAddress });
      await configureSecureDns(false);
      logEvent('proxy-applied', { engineId: active.id, proxyAddress: active.proxyAddress });
      return { applied: true, proxyAddress: active.proxyAddress };
    }
    // Yalnızca GoodbyeDPI kendi DNS yönlendirmesini WinDivert ile sistem geneli yapıyor
    // (--dns-addr/--dnsv6-addr) — Chromium'un zorunlu DoH'u bunu ATLATIP sorguları
    // dns.google'a düz bir HTTPS bağlantısı olarak gönderir, motorun DNS düzeltmesi hiç
    // devreye girmez (bkz. secureDns.js). Bu yüzden YALNIZCA GoodbyeDPI aktifken sistem
    // çözümleyicisine bırakıyoruz. Zapret'in (winws.exe) KENDİ bir DNS/DoH mekanizması
    // yok — sistem çözümleyicisine bırakılırsa (ISP DNS'i potansiyel olarak zehirli/
    // engelli) neredeyse her zaman başarısız oluyor (canlı testte doğrulandı). Bu yüzden
    // Zapret aktifken Google DoH ZORLANMAYA DEVAM EDİYOR — bu, sistem/adaptör DNS
    // ayarlarına dokunmayan, yalnızca bu Electron sürecine özel bir ayar (bkz. secureDns.js).
    await configureSecureDns(active?.running && active.id === 'goodbyedpi');
    logEvent('proxy-direct', { activeEngineId: status.activeEngineId, detail: active?.detail });
  } catch (err) {
    // DPI Service kurulu değil veya çalışmıyor; aşağıda direct moda düşülüyor.
    await configureSecureDns(false);
    logEvent('proxy-direct-fallback', { error: err.message });
  }

  await discordSession.setProxy({ mode: 'direct' });
  return { applied: false, proxyAddress: null };
}

module.exports = { applyDpiProxy };
