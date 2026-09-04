'use strict';

const { session } = require('electron');
const { getDpiStatus } = require('./serviceClient');
const { DISCORD_PARTITION } = require('./permissions');
const { configureSecureDns } = require('./secureDns');
const { logEvent } = require('./log');

/**
 * DPI Service'ten aktif motoru sorgular ve Discord webview'inin session'ına uygular:
 * - ByeDPI aktifse (yerel SOCKS proxy raporluyorsa) yalnızca bu session'ı ona yönlendirir.
 * - Zapret/Zapret2 gibi sistem geneli motorlar aktifse (proxyAddress yok) veya servise
 *   hiç ulaşılamıyorsa, session'ı 'direct' moda alır (NFQUEUE zaten sistem seviyesinde
 *   işini yapıyor, ya da hiçbir aşım aktif değil).
 *
 * Bu adım atlanırsa webview doğrudan (proxy'siz) bağlanmaya çalışır ve ISP engeli varsa
 * sayfa hiç yüklenmeden boş kalır — bu yüzden pencere oluşturulmadan önce çağrılmalı.
 *
 * Windows karşılığından FARK: orada YALNIZCA GoodbyeDPI kendi DNS yönlendirmesini WinDivert
 * ile sistem geneli yaptığı için (Chromium'un zorunlu DoH'u bunu atlatmasın diye) o motor
 * aktifken sistem çözümleyicisine bırakılıyordu. GoodbyeDPI Linux'ta yok (bkz. PORTING_PLAN.md
 * D-2) — Zapret VE Zapret2'nin ikisi de (Windows'taki Zapret gibi) KENDİ bir DNS mekanizması
 * içermiyor, ikisi de EncryptedDnsForwarder'a bağımlı — bu yüzden Chromium'un DoH'u HER
 * durumda (hangi sistem geneli motor aktif olursa olsun) zorlanmaya devam ediyor, hiçbir
 * motor için sistem çözümleyicisine düşülmüyor.
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
    await configureSecureDns(false);
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
