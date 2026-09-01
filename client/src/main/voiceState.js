'use strict';

const { logEvent } = require('./log');
const { readLocalSettings } = require('./localSettings');

// Discord'un ses kanalı/arama durumunu webview DOM'undan okuyoruz — resmi bir API yok.
//
// GEÇMİŞ DÜZELTMELER (özet): aria-label'a göre mute/deafen butonu arama defalarca kırıldı
// (katılımcı listesindeki "İsim, Sağırlaştırıldı" durum göstergeleriyle karışma, vb.).
// WebRTC tabanlı getUserMedia izleme (discordWebviewPreload.js) eklendi ama webview'in
// varsayılan contextIsolation=true'su yüzünden İZOLE bir dünyada çalışıyordu — Discord'un
// GERÇEK getUserMedia çağrısı hiç yamamızdan geçmiyordu. Bu artık discordWebviewPreload.js
// içinde webFrame.executeJavaScript() ile ANA DÜNYAYA enjekte edilerek düzeltildi.
//
// GERÇEK TEŞHİS VERİSİYLE BULUNAN GÜNCEL DAVRANIŞ (bu dosyanın şu anki mantığının temeli):
// 1) Güncel Discord arayüzünde eski sabit [Sustur][Sağırlaştır]...[Bağlantıyı Kes] araç
//    çubuğu YOK — "Bağlantıyı Kes" butonunun yanında artık "Krisp Gürültü Azaltma" ve
//    genişleyebilir bir "Ses Panelini Aç" butonu var. Bu yüzden "bağlı" tespiti artık
//    YALNIZCA "Bağlantıyı Kes" butonunun varlığına (ya da WebRTC track'in canlı olmasına)
//    dayanıyor.
// 2) Susturma: Discord'un Krisp gürültü azaltma hattı AYRI/işlenmiş bir track kullanıyor —
//    bizim yakaladığımız ham getUserMedia track'i susturmada HİÇ değişmiyor
//    (enabled/readyState/muted hepsi sabit kalıyor, gerçek veriyle doğrulandı). Gerçek
//    sinyal DOM'da bulundu: role="switch", aria-label="Sustur" olan gerçek bir ARIA
//    switch — aria-checked="true" iken susturulmuş (class'ında "redGlow" de var). WebRTC
//    sinyali yalnızca bu switch bulunamazsa yedek olarak kullanılıyor.
// 3) Sağırlaştırma AÇMA tray'den çalışıyordu ama KAPATMA çalışmıyordu — kök neden: eski
//    TOGGLE_DEAFEN_SCRIPT "sağırlaştır" geçen İLK etiketli elemanı tıklıyordu; sağırlaştırma
//    AÇIKKEN "Ses Panelini Aç" butonunun etiketi "Sağırlaştırılmışken ses paneli devre dışı
//    kalır" olarak DEĞİŞİYOR ve bu (DEVRE DIŞI/tıklanamaz) buton döküman sırasında gerçek
//    sağırlaştırma switch'inden ÖNCE bulunuyordu — yani kapatma denemesi aslında devre dışı,
//    işe yaramaz bir butona tıklıyordu. Artık mute ile aynı şekilde role="switch" olan
//    GERÇEK sağırlaştırma switch'i hedefleniyor, bu karışıklığı tamamen atlıyor.
// 4) Konuşma seviyesi tespiti (WebRTC AnalyserNode) kaldırıldı — kullanıcının ortamında
//    sessizken bile eşiği sürekli aşan bir gürültü tabanı vardı, güvenilir hale
//    getirilemedi; artık yalnızca connected/muted/deafened izleniyor.
const POLL_SCRIPT = `
(function() {
  function isRealButton(el) {
    return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
  }
  function findControlButton(substrings, root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('[aria-label]')).find((el) => {
      const label = (el.getAttribute('aria-label') || '');
      if (!isRealButton(el) || label.includes(',')) return false;
      return substrings.some((s) => label.toLowerCase().includes(s));
    });
  }
  function findSwitch(substrings) {
    return Array.from(document.querySelectorAll('[role="switch"][aria-label]')).find((el) => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return substrings.some((s) => label.includes(s));
    });
  }

  const disconnectBtn = findControlButton([
    'disconnect', 'bağlantıyı kes', 'leave call', 'aramadan ayrıl', 'end call', 'aramayı sonlandır',
  ]);

  let micState = { active: false, enabled: false };
  let micStateError = null;
  if (typeof window.__splitcordGetMicState === 'function') {
    try { micState = JSON.parse(window.__splitcordGetMicState()); } catch (e) { micStateError = e.message; }
  } else {
    micStateError = 'window.__splitcordGetMicState tanımlı değil (preload yüklenmemiş olabilir)';
  }

  const connected = !!disconnectBtn || micState.active;
  if (!connected) {
    return JSON.stringify({
      connected: false,
      __diag: { micState: micState, micStateError: micStateError, hasDisconnectBtn: false },
    });
  }

  const muteSwitchBtn = findSwitch(['sustur', 'mute', 'mikrofon']);
  const muted = muteSwitchBtn
    ? muteSwitchBtn.getAttribute('aria-checked') === 'true'
    : (micState.active ? !micState.enabled : true);

  const deafenSwitchBtn = findSwitch(['sağırlaştır', 'deafen']);
  let deafened;
  let audioPanelLabel = null;
  if (deafenSwitchBtn) {
    deafened = deafenSwitchBtn.getAttribute('aria-checked') === 'true';
  } else {
    // Yedek: gerçek switch bulunamazsa "Ses Panelini Aç" butonunun sağırlaştırılmışken
    // değişen etiketine bak (bkz. yukarıdaki not 3).
    const audioPanelBtn = Array.from(document.querySelectorAll('[aria-label]')).find((el) => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return isRealButton(el) && (label.includes('ses paneli') || label.includes('audio panel'));
    });
    audioPanelLabel = audioPanelBtn ? (audioPanelBtn.getAttribute('aria-label') || '') : null;
    deafened = !!(audioPanelLabel && /sağırlaş|deafen/i.test(audioPanelLabel));
  }

  return JSON.stringify({
    connected: true,
    muted: muted,
    deafened: deafened,
    __diag: {
      micState: micState,
      hasDisconnectBtn: true,
      audioPanelLabel: audioPanelLabel,
      muteSwitchLabel: muteSwitchBtn ? muteSwitchBtn.getAttribute('aria-label') : null,
      muteSwitchChecked: muteSwitchBtn ? muteSwitchBtn.getAttribute('aria-checked') : null,
      deafenSwitchLabel: deafenSwitchBtn ? deafenSwitchBtn.getAttribute('aria-label') : null,
      deafenSwitchChecked: deafenSwitchBtn ? deafenSwitchBtn.getAttribute('aria-checked') : null,
    },
  });
})();
`;

const POLL_INTERVAL_MS = 1500;
// Performans modunda daha az sıklıkla yokluyoruz (her executeJavaScript çağrısı bir
// miktar CPU harcıyor) — mikrofon/sağırlaştırma göstergesi biraz daha geç güncellenir
// ama kaynak kullanımı azalır.
const POLL_INTERVAL_MS_PERFORMANCE = 5000;

const FIND_SWITCH_FN = `
function findSwitch(substrings) {
  return Array.from(document.querySelectorAll('[role="switch"][aria-label]')).find((el) => {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    return substrings.some((s) => label.includes(s));
  });
}
`;

const FIND_BUTTON_FN = `
function isRealButton(el) {
  return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
}
function findControlButton(substrings) {
  return Array.from(document.querySelectorAll('[aria-label]')).find((el) => {
    const label = (el.getAttribute('aria-label') || '');
    if (!isRealButton(el) || label.includes(',')) return false;
    return substrings.some((s) => label.toLowerCase().includes(s));
  });
}
`;

// Sustur/sağırlaştır artık gerçek ARIA switch'ler üzerinden hedefleniyor (bkz. yukarıdaki
// not 3) — "Bağlantıyı Kes" ise sıradan bir eylem butonu (role="switch" değil).
const TOGGLE_MUTE_SCRIPT = `
(function() {
  ${FIND_SWITCH_FN}
  const btn = findSwitch(['sustur', 'mute', 'mikrofon']);
  if (btn) btn.click();
})();
`;

const TOGGLE_DEAFEN_SCRIPT = `
(function() {
  ${FIND_SWITCH_FN}
  const btn = findSwitch(['sağırlaştır', 'deafen']);
  if (btn) btn.click();
})();
`;

const DISCONNECT_SCRIPT = `
(function() {
  ${FIND_BUTTON_FN}
  const btn = findControlButton(['disconnect', 'bağlantıyı kes', 'leave call', 'aramadan ayrıl', 'end call', 'aramayı sonlandır']);
  if (btn) btn.click();
})();
`;

let webviewWebContents = null;
let pollTimer = null;
let lastState = { connected: false, muted: false, deafened: false };
// Birden fazla dinleyici olabiliyor: tray.js ikonu güncellemek için, ayarlar
// penceresindeki tanılama paneli ise canlı durumu göstermek için (bkz. ipc.js).
let stateChangedListeners = [];

function onVoiceStateChanged(callback) {
  stateChangedListeners.push(callback);
}

function getLastState() {
  return lastState;
}

async function poll(forceLog = false) {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) return;
  try {
    const raw = await webviewWebContents.executeJavaScript(POLL_SCRIPT);
    const state = raw ? JSON.parse(raw) : { connected: false };
    const normalized = {
      connected: !!state.connected,
      muted: !!state.muted,
      deafened: !!state.deafened,
    };
    const changed =
      normalized.connected !== lastState.connected ||
      normalized.muted !== lastState.muted ||
      normalized.deafened !== lastState.deafened;
    lastState = normalized;
    // changed=false olsa bile forceLog isteniyorsa (bkz. pollNow) yine de logluyoruz —
    // tespit HİÇ değişmiyorsa (ör. hep connected:false takılıysa) normal koşulda diag
    // hiç loglanmıyordu, bu da neden çalışmadığını görmeyi imkansız kılıyordu.
    if (changed || forceLog) {
      logEvent('voice-state-changed', { ...normalized, diag: state.__diag, forced: forceLog && !changed });
    }
    if (changed) {
      stateChangedListeners.forEach((listener) => listener(normalized));
    }
  } catch (err) {
    logEvent('voice-state-poll-error', { error: err.message });
  }
}

// Ayarlar penceresindeki "Şimdi Kontrol Et" butonu için — bir sonraki zamanlanmış
// yoklamayı (1.5 sn / performans modunda 5 sn) beklemeden anında güncel durumu döndürür.
async function pollNow() {
  await poll(true);
  return getLastState();
}

function scheduleNextPoll() {
  const interval = readLocalSettings().performanceMode ? POLL_INTERVAL_MS_PERFORMANCE : POLL_INTERVAL_MS;
  pollTimer = setTimeout(async () => {
    await poll();
    scheduleNextPoll();
  }, interval);
}

function startVoiceStatePolling(webContents) {
  webviewWebContents = webContents;
  webContents.ipc.on('discord-preload:diag', (_event, info) => {
    logEvent('discord-preload-diag', info);
  });
  if (pollTimer) clearTimeout(pollTimer);
  poll();
  scheduleNextPoll();
}

function toggleMute() {
  webviewWebContents?.executeJavaScript(TOGGLE_MUTE_SCRIPT).catch(() => {});
}

function toggleDeafen() {
  webviewWebContents?.executeJavaScript(TOGGLE_DEAFEN_SCRIPT).catch(() => {});
}

function disconnect() {
  webviewWebContents?.executeJavaScript(DISCONNECT_SCRIPT).catch(() => {});
}

module.exports = { startVoiceStatePolling, getLastState, onVoiceStateChanged, pollNow, toggleMute, toggleDeafen, disconnect };
