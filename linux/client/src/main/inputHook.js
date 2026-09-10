'use strict';

const { logEvent } = require('./log');

// KULLANICI TALEBİ: İleri git/Geri git (varsayılan Mouse4/Mouse5) ve Bas Konuş/
// Susturmak İçin Bas -- Electron'un globalShortcut'ı (Windows RegisterHotKey üzerine
// kurulu) ne mouse tuşu kaydedebiliyor ne de bırakma (keyup) olayı veriyor, bu yüzden
// bu dört eylem için uiohook-napi (kwhat/libuiohook'u saran gerçek düşük seviyeli
// klavye+mouse hook'u) kullanılıyor. BİLİNEN MALİYET (kullanıcıya AskUserQuestion ile
// soruldu, kabul edildi): libuiohook Windows'ta hook_run() içinde WH_KEYBOARD_LL VE
// WH_MOUSE_LL'yi HER ZAMAN BİRLİKTE kuruyor (bkz. src/windows/input_hook.c) -- yani bu
// modül process'e dahil olduğu an WinDivert'e benzer bir "risk tool" AV sınıflandırması
// riski zaten baştan var, sadece Mouse4/5 kullanmak bu riski azaltmıyordu (bu yüzden
// kapsam PTT/PTM'yi de içerecek şekilde genişletildi).
//
// libuiohook'un mouse buton kodları (kwhat/libuiohook include/uiohook.h,
// MOUSE_BUTTON1..5) DOM MouseEvent.button ile ŞÖYLE eşleşiyor (Windows XBUTTON1/2
// üzerinden doğrulandı): DOM button=1 (orta tık) -> uiohook 3, DOM button=3 (dördüncü
// buton/XBUTTON1) -> uiohook 4, DOM button=4 (beşinci buton/XBUTTON2) -> uiohook 5.
// Ayarlar arayüzü (settings.js) kayıt ederken bu DOM->uiohook eşlemesini kullanıp
// sonucu doğrudan "Mouse3"/"Mouse4"/"Mouse5" string'i olarak saklıyor.
//
// KULLANICI'NIN AÇIKÇA İSTEDİĞİ EŞLEME (standart OS/tarayıcı kuralının TERSİ -- normalde
// XBUTTON1/Mouse4 "geri", XBUTTON2/Mouse5 "ileri" sayılır): İleri git = Mouse4,
// Geri git = Mouse5. Varsayılanlar buna göre localSettings.js'te ayarlandı, burada
// yalnızca ham buton kodunu okuyoruz -- yön ataması shortcuts.js'te.
let uIOhook = null;
function getHook() {
  if (!uIOhook) {
    // Gerektiğinde (lazy) yüklüyoruz -- globalShortcutsEnabled kapalıyken veya hiçbir
    // eylem mouse/hold binding'i kullanmıyorken native modülü hiç import etmeyip
    // (ve process'e hiç yüklemeyip) AV yüzeyini gereksiz yere büyütmüyoruz.
    ({ uIOhook } = require('uiohook-napi'));
  }
  return uIOhook;
}

// Klavye tarafı yalnızca Bas Konuş/Susturmak İçin Bas için kullanılıyor -- kayıt
// ederken settings.js'in gönderdiği DOM KeyboardEvent.code string'i buradan uiohook'un
// kendi sayısal tuş koduna çevriliyor (bkz. uiohook-napi UiohookKey sabitleri).
const DOM_CODE_TO_UIOHOOK = {
  Backspace: 0x000E, Tab: 0x000F, Enter: 0x001C, CapsLock: 0x003A, Escape: 0x0001,
  Space: 0x0039, PageUp: 0x0E49, PageDown: 0x0E51, End: 0x0E4F, Home: 0x0E47,
  ArrowLeft: 0xE04B, ArrowUp: 0xE048, ArrowRight: 0xE04D, ArrowDown: 0xE050,
  Insert: 0x0E52, Delete: 0x0E53,
  Digit0: 0x000B, Digit1: 0x0002, Digit2: 0x0003, Digit3: 0x0004, Digit4: 0x0005,
  Digit5: 0x0006, Digit6: 0x0007, Digit7: 0x0008, Digit8: 0x0009, Digit9: 0x000A,
  KeyA: 0x001E, KeyB: 0x0030, KeyC: 0x002E, KeyD: 0x0020, KeyE: 0x0012, KeyF: 0x0021,
  KeyG: 0x0022, KeyH: 0x0023, KeyI: 0x0017, KeyJ: 0x0024, KeyK: 0x0025, KeyL: 0x0026,
  KeyM: 0x0032, KeyN: 0x0031, KeyO: 0x0018, KeyP: 0x0019, KeyQ: 0x0010, KeyR: 0x0013,
  KeyS: 0x001F, KeyT: 0x0014, KeyU: 0x0016, KeyV: 0x002F, KeyW: 0x0011, KeyX: 0x002D,
  KeyY: 0x0015, KeyZ: 0x002C,
  Numpad0: 0x0052, Numpad1: 0x004F, Numpad2: 0x0050, Numpad3: 0x0051, Numpad4: 0x004B,
  Numpad5: 0x004C, Numpad6: 0x004D, Numpad7: 0x0047, Numpad8: 0x0048, Numpad9: 0x0049,
  NumpadMultiply: 0x0037, NumpadAdd: 0x004E, NumpadSubtract: 0x004A,
  NumpadDecimal: 0x0053, NumpadDivide: 0x0E35, NumpadEnter: 0x0E00 | 0x001C,
  F1: 0x003B, F2: 0x003C, F3: 0x003D, F4: 0x003E, F5: 0x003F, F6: 0x0040, F7: 0x0041,
  F8: 0x0042, F9: 0x0043, F10: 0x0044, F11: 0x0057, F12: 0x0058, F13: 0x005B,
  F14: 0x005C, F15: 0x005D, F16: 0x0063, F17: 0x0064, F18: 0x0065, F19: 0x0066,
  F20: 0x0067, F21: 0x0068, F22: 0x0069, F23: 0x006A, F24: 0x006B,
  Semicolon: 0x0027, Equal: 0x000D, Comma: 0x0033, Minus: 0x000C, Period: 0x0034,
  Slash: 0x0035, Backquote: 0x0029, BracketLeft: 0x001A, Backslash: 0x002B,
  BracketRight: 0x001B, Quote: 0x0028,
  ControlLeft: 0x001D, ControlRight: 0x0E1D, AltLeft: 0x0038, AltRight: 0x0E38,
  ShiftLeft: 0x002A, ShiftRight: 0x0036, MetaLeft: 0x0E5B, MetaRight: 0x0E5C,
  NumLock: 0x0045, ScrollLock: 0x0046, PrintScreen: 0x0E37,
  // KULLANICI TALEBİ: Pause/Break tek başına (değiştiricisiz) atanabilmeli -- Electron'un
  // Accelerator string formatında (globalShortcut) "Pause" diye bir tuş adı YOK (bkz.
  // docs/api/accelerator.md), yani bu tuş SADECE bu uiohook tabanlı "Key:" yoluyla
  // desteklenebiliyor -- libuiohook'un kendi C header'ında VC_PAUSE var ama uiohook-napi'nin
  // TS sabitleri arasında (UiohookKey) hiç dışa aktarılmamış, bu yüzden ham değeri
  // (0x0E45) burada elle ekliyoruz.
  Pause: 0x0E45,
};

function parseBinding(value) {
  if (!value) return null;
  const mouseMatch = /^Mouse([3-5])$/.exec(value);
  if (mouseMatch) return { type: 'mouse', code: Number(mouseMatch[1]) };
  if (value.startsWith('Key:')) {
    const code = DOM_CODE_TO_UIOHOOK[value.slice(4)];
    if (code === undefined) return null;
    return { type: 'key', code };
  }
  return null;
}

let running = false;
// press: tek seferlik tetikleyiciler (İleri git/Geri git -- mousedown anında bir defa
// ateşleniyor, OS'un mouse buton tekrarı diye bir kavramı olmadığı için ekstra dedupe
// gerekmiyor). KULLANICI TALEBİ: F1-F12/Insert/Home/Scroll Lock/Num Lock/Caps Lock/
// Pause Break gibi tek başına (değiştiricisiz) atanan tuşlar da klavye tarafında AYNI
// listeye "type: 'key'" olarak giriyor -- bunlar için OS auto-repeat'i mouse'ta OLMAYAN
// bir sorun yaratıyor (basılı tutulan tuş keydown'ı sürekli tekrar gönderir), bu yüzden
// hold handler'lardaki AYNI "held" bayrağı burada da kullanılıyor -- sadece gerçek
// basma anında (basılmamış->basılı geçişte) bir defa fire() çağrılıyor, bırakma (keyup)
// ise sadece bayrağı sıfırlıyor (onUp çağrısı YOK, çünkü bunlar bas-konuş değil, tek
// seferlik eylemler).
let pressHandlers = [];
// hold: basılı tutma süresince aktif kalan eylemler (Bas Konuş/Susturmak İçin Bas).
// OS klavye auto-repeat'i basılı tutulan bir tuş için keydown'ı SÜREKLİ tekrar
// gönderir -- "held" bayrağıyla sadece gerçek geçişte (basılmamış->basılı) onDown,
// (basılı->basılmamış) onUp çağrılıyor.
let holdHandlers = [];

function matchesKey(handler, code) {
  return handler.type === 'key' && handler.code === code;
}
function matchesMouse(handler, code) {
  return handler.type === 'mouse' && handler.code === code;
}

function onKeydown(e) {
  for (const h of holdHandlers) {
    if (matchesKey(h, e.keycode) && !h.held) {
      h.held = true;
      h.onDown();
    }
  }
  for (const h of pressHandlers) {
    if (matchesKey(h, e.keycode) && !h.held) {
      h.held = true;
      h.fire();
    }
  }
}
function onKeyup(e) {
  for (const h of holdHandlers) {
    if (matchesKey(h, e.keycode) && h.held) {
      h.held = false;
      h.onUp();
    }
  }
  for (const h of pressHandlers) {
    if (matchesKey(h, e.keycode)) h.held = false;
  }
}
// GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
// client/src/main/inputHook.js): İleri Git/Geri Git (varsayılan Mouse4/Mouse5) tek bir
// fiziksel tık ile birden fazla kez tetiklenip istenenden çok daha fazla ileri/geri
// gidiyordu. Kök neden: pressHandlers için onKeydown'daki "held" koruması (basılmamış ->
// basılı geçişte BİR KEZ fire, bırakılana kadar tekrar fire ETME) burada mouse tarafında
// HİÇ yoktu -- bazı fare/sürücülerin bir tuş tutulurken (ya da temas titremesiyle) birden
// fazla mousedown olayı göndermesi doğrudan birden fazla fire()'a çıkıyordu. Artık
// klavyedekiyle AYNI desen: onMousedown yalnızca basılmamış->basılı geçişte fire ediyor,
// onMouseup bayrağı sıfırlıyor (bir sonraki gerçek basışın yine fire edebilmesi için).
function onMousedown(e) {
  for (const h of holdHandlers) {
    if (matchesMouse(h, e.button) && !h.held) {
      h.held = true;
      h.onDown();
    }
  }
  for (const h of pressHandlers) {
    if (matchesMouse(h, e.button) && !h.held) {
      h.held = true;
      h.fire();
    }
  }
}
function onMouseup(e) {
  for (const h of holdHandlers) {
    if (matchesMouse(h, e.button) && h.held) {
      h.held = false;
      h.onUp();
    }
  }
  for (const h of pressHandlers) {
    if (matchesMouse(h, e.button)) h.held = false;
  }
}

function ensureStarted() {
  if (running) return;
  try {
    const hook = getHook();
    hook.on('keydown', onKeydown);
    hook.on('keyup', onKeyup);
    hook.on('mousedown', onMousedown);
    hook.on('mouseup', onMouseup);
    hook.start();
    running = true;
    logEvent('input-hook-started', {});
  } catch (err) {
    logEvent('input-hook-start-error', { error: err.message });
  }
}

function ensureStopped() {
  if (!running) return;
  try {
    getHook().stop();
  } catch (err) {
    logEvent('input-hook-stop-error', { error: err.message });
  }
  running = false;
  logEvent('input-hook-stopped', {});
}

// shortcuts.js her applyShortcutsFromSettings() çağrısında bunu çağırıyor -- mevcut
// tüm press/hold kayıtlarını atıp verilen listeye göre baştan kuruyor. Hiçbir eylem
// mouse/hold binding'i KULLANMIYORSA native hook tamamen durduruluyor (kaynak/AV
// yüzeyini gereksiz büyütmemek için).
function configure(items) {
  if (holdHandlers.some((h) => h.held)) {
    // Ayarlar değişirken (ör. kullanıcı bir binding'i kaydederken) bir tuş basılı
    // kalmış olabilir -- yeniden kurmadan önce yarım kalmış "basılı" durumları kapat.
    holdHandlers.forEach((h) => { if (h.held) { try { h.onUp(); } catch { /* yut */ } } });
  }
  pressHandlers = [];
  holdHandlers = [];
  for (const item of items) {
    const parsed = parseBinding(item.binding);
    if (!parsed) continue;
    if (item.isHold) {
      holdHandlers.push({ ...parsed, onDown: item.onDown, onUp: item.onUp, held: false });
    } else {
      pressHandlers.push({ ...parsed, fire: item.onTrigger, held: false });
    }
  }
  if (pressHandlers.length || holdHandlers.length) {
    ensureStarted();
  } else {
    ensureStopped();
  }
}

module.exports = { configure, parseBinding };
