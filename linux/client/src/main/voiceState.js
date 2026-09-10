'use strict';

const { logEvent } = require('./log');
const { readLocalSettings } = require('./localSettings');
const { isPickerPending } = require('./screenSharePicker');

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

// GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
// client/src/main/voiceState.js): Kamera/Ekran Paylaşımı aç/kapat kısayolları, YALNIZCA
// sesli bağlantıda bulunulan sunucu/kanal o an EKRANDA SEÇİLİYKEN çalışıyordu. Kök neden:
// sol alttaki HER ZAMAN görünen "Ses Bağlantısı Kuruldu" kompakt panelindeki Kamera/Ekran
// Paylaşımı butonlarının `aria-label` özniteliği YOK -- bunun yerine `aria-describedby`
// ile ayrı bir tooltip elemanına işaret ediyorlar (o eleman hover ETMEDEN de DOM'da mevcut
// ve okunabilir, yalnızca görünürlüğü hover'a bağlı). Kanalın TAM (genişletilmiş) araç
// çubuğu -- YALNIZCA o kanal ekrandayken var olan -- AYNI düğmelerin `aria-label`
// KULLANAN bir kopyasını render ediyor; eski `document.querySelectorAll('[aria-label]')`
// sorgumuz kompakt paneldeki (her zaman mevcut) düğmeleri bu yüzden hiç bulamıyordu.
// getAccessibleLabel() ikisini de kapsıyor: önce doğrudan aria-label'a bakıyor, yoksa
// aria-describedby'nin işaret ettiği elemanın metnine düşüyor -- hangi görünüm render
// edilmiş olursa olsun aynı düğmeyi buluyor.
const GET_ACCESSIBLE_LABEL_FN = `
function getAccessibleLabel(el) {
  const direct = el.getAttribute('aria-label');
  if (direct) return direct;
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const tip = document.getElementById(describedBy);
    if (tip && tip.textContent) return tip.textContent;
  }
  return '';
}
function findButtonByAccessibleLabel(exactLabels) {
  return Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => {
    const label = getAccessibleLabel(el).toLowerCase();
    return exactLabels.includes(label);
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

// KULLANICI TALEBİ: Bas Konuş / Susturmak İçin Bas -- ikisi de bas-tut mantığıyla
// çalışıyor (tuş basılıyken bir yöne, bırakılınca diğer yöne zorluyor). Kör bir
// toggleMute() burada YANLIŞ olurdu: tuş tekrarı (OS auto-repeat) veya art üste hızlı
// basma/bırakma durumunda çift tetiklenip durumu ters çevirebilir. Bunun yerine mevcut
// gerçek switch durumunu okuyup İSTENEN duruma zaten eşitse hiç tıklamayan, idempotent
// bir "setMuted" kullanıyoruz (bkz. shortcuts.js holdActionsMap).
const SET_MUTE_SCRIPT = (desiredMuted) => `
(function() {
  ${FIND_SWITCH_FN}
  const btn = findSwitch(['sustur', 'mute', 'mikrofon']);
  if (!btn) return;
  const current = btn.getAttribute('aria-checked') === 'true';
  if (current !== ${desiredMuted ? 'true' : 'false'}) btn.click();
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

// KULLANICI TALEBİ: Kamera aç/kapat -- canlı testte doğrulandı: bu buton role="switch"
// DEĞİL, sıradan bir <button>; açık/kapalı durumu ARIA switch'lerdeki gibi aria-checked
// ile değil, etiketin KENDİSİ "Kamerayı Aç" <-> "Kamerayı Kapat" olarak değişerek
// belirtiliyor. "Daha Fazla Kamera Seçeneği" gibi AYNI "kamera" kelimesini içeren ama
// alakasız bir buton da var -- bu yüzden findControlButton'daki genel alt-dize eşleşmesi
// YETERSİZ (o buton da yanlışlıkla eşleşirdi); tam etiket eşleşmesi kullanılıyor.
const TOGGLE_CAMERA_SCRIPT = `
(function() {
  ${GET_ACCESSIBLE_LABEL_FN}
  const btn = findButtonByAccessibleLabel(['kamerayı aç', 'kamerayı kapat', 'turn on camera', 'turn off camera']);
  if (btn) btn.click();
})();
`;

// KULLANICI TALEBİ: Ekran paylaşımı aç/kapat -- canlı testte doğrulandı: "Ekranını
// Paylaş" butonu paylaşım AKTİFKEN DE aynı etiketle kalıyor (tıklanınca yeniden kaynak
// seçici açıyor, kapatmıyor) -- asıl "durdur" kontrolü TAMAMEN AYRI bir yerde, sol alttaki
// "Yayın Aktif" panelinde "Yayını Durdur" etiketli bir buton olarak duruyor. Bu yüzden
// doğru sırayla önce "Yayını Durdur" aranıyor (varsa paylaşım zaten aktif, onu durdurur);
// yoksa "Ekranını Paylaş" tıklanıp SplitCord-Turkey'in kendi ekran seçici penceresi
// açılıyor (manuel tıklamayla BİREBİR aynı davranış -- kaynak seçimi hâlâ gerekiyor).
const TOGGLE_SCREEN_SHARE_SCRIPT = `
(function() {
  ${GET_ACCESSIBLE_LABEL_FN}
  const stopBtn = findButtonByAccessibleLabel(['yayını durdur', 'stop streaming']);
  if (stopBtn) { stopBtn.click(); return; }
  const shareBtn = findButtonByAccessibleLabel(['ekranını paylaş', 'share your screen']);
  if (shareBtn) shareBtn.click();
})();
`;

let webviewWebContents = null;
let mainWindowRef = null;
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
  // KULLANICI TALEBİ: tam ekran oyunlarda FPS düşüşü -- Performans Modu açıkken VE
  // pencere odaksızken (ör. bir oyunun arkasında açık kalması) bu yoklamayı atlıyoruz;
  // forceLog=true (Ayarlar'daki "Şimdi Kontrol Et") İSTİSNA, kullanıcı elle istediğinde
  // her zaman çalışır. Tray ikonu bir sonraki odaklanmada en fazla mevcut aralık kadar
  // (5 sn) geriden gelir -- salt kozmetik bir gecikme, bkz. backgroundPriority.js'teki
  // aynı temayı işleyen ayrıntılı not.
  if (!forceLog && readLocalSettings().performanceMode && mainWindowRef && !mainWindowRef.isDestroyed() && !mainWindowRef.isFocused()) {
    return;
  }
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

function startVoiceStatePolling(webContents, mainWindow) {
  webviewWebContents = webContents;
  mainWindowRef = mainWindow || null;
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

function setMuted(desiredMuted) {
  webviewWebContents?.executeJavaScript(SET_MUTE_SCRIPT(desiredMuted)).catch(() => {});
}

function toggleCamera() {
  webviewWebContents?.executeJavaScript(TOGGLE_CAMERA_SCRIPT).catch(() => {});
}

// GERÇEK BUG (Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
// client/src/main/voiceState.js): ekran paylaşımı seçici penceresi AÇIKKEN (henüz bir
// kaynak seçilmeden) aynı kısayol tekrar tekrar kullanılınca, her basış Discord'un
// "Ekranını Paylaş" butonuna YENİDEN tıklayıp YENİ bir getDisplayMedia() isteği
// başlatıyordu. Chromium bu istekleri SIRAYLA işlediği için (bkz. screenSharePicker.js
// isPickerPending yorumu) bu istekler görünmez şekilde kuyruğa giriyor, kullanıcı ilk
// seçiciyi kapatınca/seçim yapınca sıradaki istek kendi seçici penceresini açıveriyordu
// -- kullanıcıya "kapattığım pencere geri geliyor" gibi görünüyordu. Bir seçici zaten
// açık/beklemedeyken tekrar tıklamayı burada engellemek kökten çözüyor.
function toggleScreenShare() {
  if (isPickerPending()) return;
  webviewWebContents?.executeJavaScript(TOGGLE_SCREEN_SHARE_SCRIPT).catch(() => {});
}

module.exports = { startVoiceStatePolling, getLastState, onVoiceStateChanged, pollNow, toggleMute, toggleDeafen, disconnect, toggleCamera, toggleScreenShare, setMuted };
