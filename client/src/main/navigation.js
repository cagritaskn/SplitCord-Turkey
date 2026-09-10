'use strict';

const { logEvent } = require('./log');

// KULLANICI TALEBİ: İleri git / Geri git -- Discord'un KENDİ SPA router'ının
// goBack/goForward fonksiyonlarını (modal kapatma kontrolü dahil) çağırıyoruz;
// TARAYICI history.back()/forward() veya webContents.goBack()/goForward() KASITLI
// OLARAK KULLANILMIYOR -- onlar tam sayfa yeniden yüklemesine yol açabilir, bu da web
// wrapper olduğumuz için ses/görüntü bağlantısının kesilmesi gibi ciddi sorunlar
// yaratır. Canlı testte doğrulandı: bu yöntemde URL değişiyor ama did-finish-load HİÇ
// tetiklenmiyor (gerçek bir SPA route değişimi, sayfa yeniden yükleme değil).
//
// Discord'un webpack modül ID'leri derlemeler arası SABİT DEĞİL -- modülü her zaman
// çalışma anında, "goBack"/"goForward" çağıran fonksiyonların KAYNAK KODUNU arayarak
// buluyoruz (Vencord/BetterDiscord'un kullandığı standart webpack-require yakalama
// tekniğiyle -- Vencord kurulu olmasına bağlı DEĞİL, webpackChunkdiscord_app her zaman
// var). Sonuç sayfa-global bir önbellekte (__splitcordNavFns) tutuluyor ki her
// tıklamada yüzlerce modülü yeniden taramayalım.
const NAV_SCRIPT = (direction) => `
(function() {
  function findNavFns() {
    if (window.__splitcordNavFns) return window.__splitcordNavFns;
    const found = {};
    try {
      window.webpackChunkdiscord_app.push([[Symbol('splitcord-nav-lookup')], {}, (req) => {
        for (const id in req.c) {
          const mod = req.c[id];
          const exp = mod && mod.exports;
          if (!exp || typeof exp !== 'object') continue;
          for (const key in exp) {
            let val;
            try { val = exp[key]; } catch (e) { continue; }
            if (typeof val !== 'function') continue;
            let src;
            try { src = val.toString(); } catch (e) { continue; }
            if (!found.goBack && src.includes('.goBack()')) found.goBack = val;
            if (!found.goForward && src.includes('.goForward()')) found.goForward = val;
          }
          if (found.goBack && found.goForward) break;
        }
      }]);
    } catch (e) {
      return { error: 'lookup-failed: ' + e.message };
    }
    if (!found.goBack || !found.goForward) return { error: 'nav-functions-not-found' };
    window.__splitcordNavFns = found;
    return found;
  }

  const fns = findNavFns();
  if (fns.error) return JSON.stringify({ ok: false, error: fns.error });
  try {
    fns['${direction}']();
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'call-failed: ' + e.message });
  }
})();
`;

let webviewWebContents = null;

function attachWebContents(webContents) {
  webviewWebContents = webContents;
}

async function runNav(direction) {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) return;
  try {
    const raw = await webviewWebContents.executeJavaScript(NAV_SCRIPT(direction));
    const result = raw ? JSON.parse(raw) : { ok: false, error: 'no-result' };
    if (!result.ok) logEvent('navigate-error', { direction, error: result.error });
  } catch (err) {
    logEvent('navigate-error', { direction, error: err.message });
  }
}

function goBack() {
  return runNav('goBack');
}

function goForward() {
  return runNav('goForward');
}

module.exports = { attachWebContents, goBack, goForward };
