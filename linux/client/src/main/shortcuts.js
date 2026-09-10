'use strict';

const { globalShortcut } = require('electron');
const { logEvent } = require('./log');
const { readLocalSettings } = require('./localSettings');
const { getMainWindow } = require('./window');
const voiceState = require('./voiceState');
const navigation = require('./navigation');
const inputHook = require('./inputHook');

// Electron'un globalShortcut API'si SİSTEM GENELİNDE (uygulama arkaplanda/tepside
// olsa bile) çalışan gerçek OS-seviyesi kısayollar kaydeder — Discord'un kendi web
// sayfasının odaktayken dinlediği "yerel" kısayollardan farklı olarak, pencere
// odakta OLMASA DA tetiklenir. Bu tam olarak istenen davranış.
//
// ÖNEMLİ VE KAÇINILMAZ SINIRLAMA: globalShortcut bir kombinasyonu OS seviyesinde ele
// geçirir — bu, o kombinasyonun uygulamamız ODAKTAYKEN bile ÖNCE bize gelip Discord'un
// kendi sayfasına HİÇ ulaşmayacağı anlamına gelir; ayrıca aynı kombinasyon BAŞKA bir
// programda zaten kayıtlıysa register() sessizce false döner (bkz. sonuç loglama).
// AYRICA globalShortcut ne mouse tuşu kaydedebiliyor ne de bırakma (keyup) olayı
// veriyor -- bu yüzden mouse'a bağlı eylemler (İleri/Geri git) VE basılı-tutma
// eylemleri (Bas Konuş/Susturmak İçin Bas) tamamen inputHook.js (uiohook-napi)
// üzerinden yürüyor, globalShortcut'a hiç uğramıyor (bkz. applyShortcutsFromSettings).
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
    // KULLANICI TALEBİ: artık salt "tepsiye küçült" değil, İKİ YÖNLÜ bir anahtar --
    // pencere o an görünürse (tepside DEĞİLSE) tepsiye küçültür (hide), tepsideyse
    // (gizliyse) geri getirir (show+focus). Aynı tuş her iki yönde de kullanılabiliyor.
    minimizeToTray: () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
      } else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    },
    toggleCamera: () => voiceState.toggleCamera(),
    toggleScreenShare: () => voiceState.toggleScreenShare(),
    // KULLANICI TALEBİ: İleri git/Geri git -- Discord'un kendi SPA router'ı üzerinden
    // (bkz. navigation.js) çalışıyor, tarayıcı geçmişi/webContents.goBack DEĞİL.
    navigateForward: () => navigation.goForward(),
    navigateBack: () => navigation.goBack(),
  };
}

// KULLANICI RAPORLARI (Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
// client/src/main/shortcuts.js): Tepsiye Küçült/Geri Al pencereyi küçültüp "anında" geri
// getiriyordu; Kamerayı Aç/Kapat kamerayı kapatıp anında tekrar açıyordu; Ekran
// Paylaşımını Aç/Kapat yayını durdurduktan hemen sonra seçim penceresini tekrar
// açıyordu VE yayın YOKKEN açılan seçim penceresi "İptal"e ya da "Paylaşımı Başlat"a
// basılsa bile hemen geri geliyordu. Hepsi TEK bir fiziksel tuş basışının altta İKİ KEZ
// tetiklenmesiyle birebir uyumlu: DOM'u yeniden sorgulayan TOGGLE_*_SCRIPT'ler (bkz.
// voiceState.js) ilk çağrıda doğru butonu bulup tıklıyor (kamera kapanıyor / yayın
// duruyor), ama DOM hemen SONRAKİ durumu yansıttığı için ikinci (yarış halindeki) çağrı
// KARŞIT butonu bulup tıklıyor (kamera tekrar açılıyor / seçim penceresi tekrar
// tetikleniyor) -- toggleScreenShare'in kendisi idempotent DEĞİL, "şu an ne varsa onun
// tersini yap" mantığında, bu yüzden çift tetiklenme doğrudan görünür hale geliyor.
//
// Kesin kök neden (globalShortcut'ın bazı kombinasyonlarda callback'i iki kez çağırması
// mı, yoksa inputHook.js'teki mousedown press handler'ının -- klavyenin aksine -- "held"
// korumasız olması/fare tuşu "chatter"ı mı) kesinleştirilemedi. Ama HANGİ kaynaktan
// gelirse gelsin aynı belirtiyi verdiği için, TEK bir merkezi noktada (uygulanan HER
// kısayolun tetiklenme anında) kısa bir zaman penceresi içindeki tekrar çağrıları yutan
// genel bir debounce -- ayrı ayrı her eyleme özel yama eklemek yerine -- en sağlam ve
// bakımı en kolay çözüm.
const ACTION_DEBOUNCE_MS = 300;
const lastTriggerAtByAction = new Map();

function debounced(name, fn) {
  return (...args) => {
    const now = Date.now();
    const last = lastTriggerAtByAction.get(name) || 0;
    if (now - last < ACTION_DEBOUNCE_MS) return;
    lastTriggerAtByAction.set(name, now);
    fn(...args);
  };
}

// KULLANICI TALEBİ: Bas Konuş / Susturmak İçin Bas -- basılı tutma süresince bir
// yöne, bırakılınca diğer yöne zorlayan çift; bkz. voiceState.js setMuted (idempotent,
// kör toggle DEĞİL). Bu ikisi globalShortcut'ın register/press modeline hiç girmiyor,
// tamamen inputHook.js'in press/held ayrımına (onDown/onUp) dayanıyor.
function holdActionsMap() {
  return {
    pushToTalk: { onDown: () => voiceState.setMuted(false), onUp: () => voiceState.setMuted(true) },
    pushToMute: { onDown: () => voiceState.setMuted(true), onUp: () => voiceState.setMuted(false) },
  };
}

const HOLD_ACTIONS = ['pushToTalk', 'pushToMute'];

// Ayarlar > Tuş Atamaları'ndan her değişiklikte (ana anahtar veya tek bir kombinasyon)
// yeniden çağrılıyor — mevcut tüm kayıtları (hem globalShortcut hem inputHook)
// temizleyip ayarlara göre baştan kuruyor. Her eylem için register() sonucunu (ör.
// kombinasyon başka bir programda zaten kayıtlıysa) bir sonuç haritası olarak
// döndürüyor ki ayarlar penceresi kullanıcıya geri bildirim verebilsin -- mouse/hold
// binding'leri için OS-seviyesi bir çakışma kavramı olmadığından bunlar için sonuç
// her zaman true.
function applyShortcutsFromSettings() {
  globalShortcut.unregisterAll();
  const settings = readLocalSettings();
  const results = {};
  if (!settings.globalShortcutsEnabled) {
    inputHook.configure([]);
    logEvent('global-shortcuts-disabled', {});
    return results;
  }

  const actions = actionsMap();
  const holds = holdActionsMap();
  const bindings = settings.shortcuts || {};
  const inputHookItems = [];

  for (const [name, value] of Object.entries(bindings)) {
    if (!value) continue;

    if (HOLD_ACTIONS.includes(name)) {
      const holdFns = holds[name];
      if (!holdFns) continue;
      inputHookItems.push({
        binding: value,
        isHold: true,
        onDown: () => {
          logEvent('global-shortcut-hold-down', { name, binding: value });
          holdFns.onDown();
        },
        onUp: () => {
          logEvent('global-shortcut-hold-up', { name, binding: value });
          holdFns.onUp();
        },
      });
      results[name] = true;
      continue;
    }

    const action = actions[name];
    if (!action) continue;

    const parsed = inputHook.parseBinding(value);
    if (parsed) {
      inputHookItems.push({
        binding: value,
        isHold: false,
        onTrigger: debounced(name, () => {
          logEvent('global-shortcut-triggered', { name, binding: value });
          action();
        }),
      });
      results[name] = true;
      continue;
    }

    const ok = globalShortcut.register(value, debounced(name, () => {
      logEvent('global-shortcut-triggered', { name, accelerator: value });
      action();
    }));
    results[name] = ok;
    logEvent(ok ? 'global-shortcut-registered' : 'global-shortcut-register-failed', { name, accelerator: value });
  }

  inputHook.configure(inputHookItems);
  return results;
}

function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
  inputHook.configure([]);
}

module.exports = { applyShortcutsFromSettings, unregisterGlobalShortcuts };
