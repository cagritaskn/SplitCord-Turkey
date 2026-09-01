'use strict';

const { globalShortcut } = require('electron');
const { logEvent } = require('./log');
const { readLocalSettings } = require('./localSettings');
const { getMainWindow } = require('./window');
const voiceState = require('./voiceState');

// Electron'un globalShortcut API'si SİSTEM GENELİNDE (uygulama arkaplanda/tepside
// olsa bile) çalışan gerçek OS-seviyesi kısayollar kaydeder — Discord'un kendi web
// sayfasının odaktayken dinlediği "yerel" kısayollardan farklı olarak, pencere
// odakta OLMASA DA tetiklenir. Bu tam olarak istenen davranış.
//
// ÖNEMLİ VE KAÇINILMAZ SINIRLAMA: globalShortcut bir kombinasyonu OS seviyesinde ele
// geçirir — bu, o kombinasyonun uygulamamız ODAKTAYKEN bile ÖNCE bize gelip Discord'un
// kendi sayfasına HİÇ ulaşmayacağı anlamına gelir; ayrıca aynı kombinasyon BAŞKA bir
// programda zaten kayıtlıysa register() sessizce false döner (bkz. sonuç loglama).
//
// Eylem->işlev eşlemesi ve gerçek buton tıklama mantığı artık voiceState.js'te (aria
// switch tabanlı, doğrulanmış) — burada tekrarlanmıyor.
function actionsMap() {
  return {
    toggleMute: () => voiceState.toggleMute(),
    toggleDeafen: () => voiceState.toggleDeafen(),
    disconnect: () => voiceState.disconnect(),
    bringToFront: () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    minimizeToTray: () => {
      const win = getMainWindow();
      if (win) win.hide();
    },
  };
}

// Ayarlar > Tuş Atamaları'ndan her değişiklikte (ana anahtar veya tek bir kombinasyon)
// yeniden çağrılıyor — mevcut tüm kayıtları temizleyip ayarlara göre baştan kuruyor.
// Her eylem için register() sonucunu (başarılı/başarısız — ör. kombinasyon başka bir
// programda zaten kayıtlıysa) bir sonuç haritası olarak döndürüyor ki ayarlar penceresi
// kullanıcıya geri bildirim verebilsin.
function applyShortcutsFromSettings() {
  globalShortcut.unregisterAll();
  const settings = readLocalSettings();
  const results = {};
  if (!settings.globalShortcutsEnabled) {
    logEvent('global-shortcuts-disabled', {});
    return results;
  }

  const actions = actionsMap();
  const bindings = settings.shortcuts || {};
  for (const [name, accelerator] of Object.entries(bindings)) {
    if (!accelerator) continue;
    const action = actions[name];
    if (!action) continue;
    const ok = globalShortcut.register(accelerator, () => {
      logEvent('global-shortcut-triggered', { name, accelerator });
      action();
    });
    results[name] = ok;
    logEvent(ok ? 'global-shortcut-registered' : 'global-shortcut-register-failed', { name, accelerator });
  }
  return results;
}

function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = { applyShortcutsFromSettings, unregisterGlobalShortcuts };
