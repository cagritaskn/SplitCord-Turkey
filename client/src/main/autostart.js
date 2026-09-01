'use strict';

const { app } = require('electron');

// Windows'ta getLoginItemSettings(), verilen 'args' ile registry'deki kayıtlı komut
// satırını birebir karşılaştırıyor. Otomatik başlatma AÇIKKEN iki alt durum var:
// normal (görünür) başlangıç → args=[], "Arkaplanda başlat" da açık → args=['--hidden']
// (window.js bu argümanı okuyup pencereyi göstermeden başlatıyor). Bu yüzden "otomatik
// başlatma açık mı" sorusu HER İKİ args varyantını da kontrol etmek zorunda.
const HIDDEN_ARGS = ['--hidden'];

function isAutoStartEnabled() {
  return app.getLoginItemSettings({ args: [] }).openAtLogin || app.getLoginItemSettings({ args: HIDDEN_ARGS }).openAtLogin;
}

function isStartInBackgroundEnabled() {
  return app.getLoginItemSettings({ args: HIDDEN_ARGS }).openAtLogin;
}

// İki ayrı toggle (autostart + arkaplanda başlat) TEK bir login-item kaydına
// (openAtLogin + args) karşılık geldiği için her ikisini birlikte uyguluyoruz —
// biri değişince diğerinin mevcut durumu korunarak kayıt yeniden yazılıyor.
function applyAutoStart(enabled, startInBackground) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled && startInBackground ? HIDDEN_ARGS : [],
  });
}

module.exports = { isAutoStartEnabled, isStartInBackgroundEnabled, applyAutoStart };
