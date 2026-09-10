'use strict';

const { ipcRenderer, contextBridge, webFrame } = require('electron');

// TANILAMA: bu preload'un gerçekten çalışıp çalışmadığını ve hangi dünyada (izole/ana)
// olduğunu doğrudan Electron'un kendi process.contextIsolated API'sinden öğreniyoruz.
try {
  ipcRenderer.send('discord-preload:diag', {
    contextIsolated: process.contextIsolated,
    href: typeof location !== 'undefined' ? location.href : null,
  });
} catch (err) {
  try {
    ipcRenderer.send('discord-preload:diag', { error: err.message });
  } catch {}
}

/**
 * KÖK NEDEN (uzun süredir mikrofon/sağırlaştırma tespitinin çalışmamasının sebebi):
 * webview varsayılan olarak contextIsolation=true ile açılıyor — bu, preload'un
 * navigator.mediaDevices.getUserMedia/getDisplayMedia'yı YAMALAMASININ ve
 * window.__splitcordGetMicState ATAMASININ, Discord'un GERÇEK sayfa script'inin
 * çalıştığı "ana dünya" değil, İZOLE bir dünyada olmasına yol açıyordu — yani
 * Discord'un kendi getUserMedia çağrısı hiç bizim yamamızdan GEÇMİYORDU, ve ana
 * süreçteki executeJavaScript() (ana dünyada çalışır) window.__splitcordGetMicState'i
 * hiç GÖRMÜYORDU. `webview webpreferences="contextIsolation=no"` denendi ama Electron
 * bunu (embedder'ın kendisi contextIsolation=true olduğu için) yok saydı — hâlâ
 * izoleydi (process.contextIsolated === true doğrulandı).
 *
 * ÇÖZÜM: webFrame.executeJavaScript() — preload'un (izole dünyadan) kod string'ini
 * doğrudan ANA DÜNYADA çalıştırmasını sağlayan resmi Electron API'si. Yama kodunu
 * bir string olarak burada tanımlayıp bunu kullanarak enjekte ediyoruz; böylece hem
 * Discord'un kendi getUserMedia çağrısı yamamızdan geçiyor hem de
 * window.__splitcordGetMicState, ana süreçteki executeJavaScript()'in (o da ana
 * dünyada çalışıyor) görebileceği yerde tanımlanıyor.
 *
 * Ana dünyada Electron/Node erişimi olmadığı için (nodeIntegration zaten kapalı),
 * getDisplayMedia yamasının ihtiyaç duyduğu tek IPC çağrısı (kaydedilen kalite
 * ayarını okuma) contextBridge.exposeInMainWorld ile köprüleniyor — contextBridge bu
 * tür izole->ana dünya köprülemesi için TAM OLARAK tasarlanmış resmi mekanizma.
 */
try {
  contextBridge.exposeInMainWorld('__splitcordInternal', {
    getLastQuality: () => ipcRenderer.invoke('screen-share-picker:get-last-quality'),
  });
} catch (err) {
  // contextIsolation zaten kapalıysa (beklenmez ama) exposeInMainWorld gereksiz/hata
  // verebilir — bu durumda ana dünya script'i window.__splitcordInternal'ı bulamayınca
  // zaten güvenli şekilde no-op'a düşüyor (aşağıya bakın).
}

const MAIN_WORLD_SCRIPT = `
(function() {
  if (window.__splitcordPatched) return; // SPA içi yeniden enjeksiyonlarda çift yamayı engelle
  window.__splitcordPatched = true;

  // --- Ekran paylaşımı kalite yaması + kendi sesimizin yankılanması düzeltmesi ---
  // GERÇEK BUG (kullanıcı raporu): SplitCord-Turkey kullanan biri sistem sesiyle ekran
  // paylaşımı yaptığında, AYNI kanaldaki DİĞER katılımcılar KENDİ seslerini o paylaşımın
  // sesinde geri duyuyordu. Kök neden: Windows'un ses döngü (loopback) yakalaması,
  // paylaşımı yapan kişinin hoparlöründen çıkan HER SESİ (diğer katılımcıların Discord
  // üzerinden çalınan sesleri dahil) yakalıyor ve bunu TEKRAR o kişinin paylaşım sesine
  // katıyor -- yani diğer katılımcılar kendi seslerini bir gecikmeyle geri alıyor (bkz.
  // Vesktop'un aynı bug'ı için commit'i: Vencord/Vesktop@cb9c55f).
  //
  // Electron main process tarafındaki screenSharePicker.js callback'i hâlâ HER ZAMAN
  // sade "audio: 'loopback'" veriyor -- bunu değiştirmedik. Asıl anahtar, Electron'un
  // C++ tarafının (ElectronBrowserContext::DisplayMediaDeviceChosen) bunu otomatik olarak
  // "loopbackWithoutChrome"a (bizim SES ÇIKIŞIMIZ hariç tutulan bir loopback) YÜKSELTMESİ
  // için isteğin restrictOwnAudio bayrağını taşıması gerekiyor -- bu bayrak SAYFANIN
  // (Discord'un) kendi getDisplayMedia() ÇAĞRISINDAN geliyor, bizim main process
  // callback'imizden DEĞİL (bkz. electron/electron#52455, yalnızca Electron 43.4.1+/44+'ta
  // var). Discord kapalı kaynak olduğu ve bu constraint'i kendi isteğine EKLEYİP
  // EKLEMEYECEĞİ bizim kontrolümüzde OLMADIĞI için, aşağıda Discord'un KENDİ constraints
  // nesnesine "audio.restrictOwnAudio: true"yu KENDİMİZ zorla ekliyoruz -- Discord bunu
  // hiç istemese bile devreye giriyor. Ses hiç istenmemişse (audio: false/undefined)
  // DOKUNULMUYOR -- olmayan bir sesi icat etmiyoruz.
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) : null;
  if (originalGetDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = async function patchedGetDisplayMedia(constraints) {
      const patchedConstraints = constraints ? { ...constraints } : {};
      if (patchedConstraints.audio) {
        patchedConstraints.audio = typeof patchedConstraints.audio === 'object'
          ? { ...patchedConstraints.audio, restrictOwnAudio: true }
          : { restrictOwnAudio: true };
      }
      const stream = await originalGetDisplayMedia(patchedConstraints);
      try {
        const quality = window.__splitcordInternal ? await window.__splitcordInternal.getLastQuality() : null;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && quality) {
          const trackConstraints = {};
          if (quality.width && quality.height) {
            trackConstraints.width = { ideal: quality.width };
            trackConstraints.height = { ideal: quality.height };
          }
          if (quality.frameRate) {
            trackConstraints.frameRate = { ideal: quality.frameRate, max: quality.frameRate };
          }
          if (Object.keys(trackConstraints).length > 0) {
            await videoTrack.applyConstraints(trackConstraints);
          }
        }
      } catch (err) {
        console.error('[SplitCord] Ekran paylaşımı kalite ayarı uygulanamadı:', err);
      }
      return stream;
    };
  }

  // --- Mikrofon durumu izleme (bağlı/susturma yedek sinyali) ---
  // Konuşma seviyesi tespiti (AnalyserNode) kaldırıldı — güvenilmez çıktı (kullanıcının
  // ortamında sessizken bile eşiği sürekli aşan bir gürültü tabanı vardı). Susturma artık
  // asıl olarak DOM'daki gerçek ARIA switch'e bakılarak tespit ediliyor (bkz. voiceState.js
  // POLL_SCRIPT); buradaki track.active/enabled yalnızca o switch bulunamazsa yedek olarak
  // kullanılıyor.
  let micTrack = null;
  let getUserMediaCallCount = 0;

  // GERÇEK BUG (kullanıcı raporu): Ayarlar > Ses ve Görüntü > Kamera'da hangi kamera
  // seçilirse seçilsin, AYNI oturum içinde bile hep listedeki İLK kamera çalıştırılmaya
  // çalışılıyordu. Canlı CDP testiyle kök nedeni bulundu: Discord'un kendi kodu
  // getUserMedia'ya deviceId'yi DÜZ BİR STRING olarak veriyor (ör.
  // "video: { width: 387, height: 218, frameRate: 30, deviceId: '<id>' }") -- WebRTC
  // spesifikasyonuna göre bir MediaTrackConstraints alanındaki düz (sarmalanmamış) bir
  // değer her zaman yalnızca "ideal" (tercih, ZORUNLU DEĞİL) sayılır. Elektron 31'in eski
  // Chromium'unda (126) bu "ideal" deviceId pratikte neredeyse her zaman doğru cihazı
  // seçtiriyordu, ama Electron 44'ün Chromium'unda (152) cihaz seçim "fitness distance"
  // algoritması diğer ideal alanlarla (width/height/frameRate) birlikteyken artık bunu
  // güvenilir şekilde onurlandırmıyor -- canlı testte doğrulandı: AYNI ham constraints
  // nesnesiyle her seferinde listedeki ilk kamera (S23 Ultra) döndü, istenen kamera
  // (Logi C270) DEĞİL. Çözüm: deviceId düz bir string olarak geldiğinde burada
  // "{ exact: <id> }" olarak SARMALAYIP zorunlu hale getiriyoruz -- bu, Discord'un kendi
  // kodunu hiç değiştirmeden (kapalı kaynak, değiştiremeyiz) doğru cihazı garantiliyor;
  // canlı testte doğrulandı (aynı ham veriyle artık doğru kamera seçiliyor). Ses (mic)
  // tarafı için de aynı kırılganlık teorik olarak geçerli olabileceğinden simetrik olarak
  // uygulanıyor.
  function forceExactDeviceId(mediaConstraint) {
    if (mediaConstraint && typeof mediaConstraint === 'object' && typeof mediaConstraint.deviceId === 'string') {
      return { ...mediaConstraint, deviceId: { exact: mediaConstraint.deviceId } };
    }
    return mediaConstraint;
  }

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  if (originalGetUserMedia) {
    navigator.mediaDevices.getUserMedia = async function patchedGetUserMedia(constraints) {
      const patchedConstraints = constraints ? {
        ...constraints,
        video: forceExactDeviceId(constraints.video),
        audio: forceExactDeviceId(constraints.audio),
      } : constraints;
      let stream;
      try {
        stream = await originalGetUserMedia(patchedConstraints);
      } catch (err) {
        // "exact" zorunluluğu istenen cihaz o anda gerçekten yoksa/başka bir uygulama
        // tarafından kilitliyse OverconstrainedError fırlatabilir -- bu durumda hiç
        // görüntü/ses ALAMAMAKTANSA, Discord'un ORİJİNAL (ideal, sarmalanmamış) isteğine
        // düşüp en azından ÇALIŞAN bir cihazla devam ediyoruz.
        if (err && err.name === 'OverconstrainedError') {
          stream = await originalGetUserMedia(constraints);
        } else {
          throw err;
        }
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        getUserMediaCallCount++;
        micTrack = audioTrack;
        audioTrack.addEventListener('ended', () => {
          if (micTrack === audioTrack) {
            micTrack = null;
          }
        });
      }
      return stream;
    };
  }

  window.__splitcordGetMicState = function () {
    const active = !!micTrack && micTrack.readyState === 'live';
    return JSON.stringify({
      active: active,
      enabled: active ? micTrack.enabled : false,
      __debug: {
        getUserMediaCallCount: getUserMediaCallCount,
        trackId: micTrack ? micTrack.id : null,
        trackReadyState: micTrack ? micTrack.readyState : null,
        trackEnabledRaw: micTrack ? micTrack.enabled : null,
        trackMuted: micTrack ? micTrack.muted : null,
      },
    });
  };

  // --- Rich Presence köprüsü (arRPC) ---
  // main sürecindeki arRPC sunucusu (bkz. main/richPresence.js) yerel bir RPC istemcisinden
  // (oyun/uygulama) gelen SET_ACTIVITY verisini kendi WebSocket "bridge" sunucusuna
  // (127.0.0.1:1337) yayınlıyor. Burada bu veriyi alıp Discord'un KENDİ web JS paketindeki
  // Flux Dispatcher'ı bulup LOCAL_ACTIVITY_UPDATE olarak dispatch ediyoruz — resmi masaüstü
  // istemcisinin native (IPC) + web (bu dispatch) taraflarının birlikte yaptığı işi taklit
  // ediyoruz. Mantık doğrudan arRPC'nin resmi examples/bridge_mod.js dosyasından alındı
  // (OpenAsar/arrpc, MIT). Discord'un minify edilmiş modülleri arasında sabit string'lere
  // göre arama yapan bu heuristic'ler KIRILGAN: Discord'un web paketi güncellendiğinde
  // bozulabilir — bu durumda yalnızca Rich Presence çalışmaz, try/catch ile izole olduğu
  // için uygulamanın geri kalanı etkilenmez.
  (function setupRichPresenceBridge() {
    let Dispatcher, lookupAsset, lookupApp;
    const apps = {};

    const eachCandidate = (mod, fn) => {
      if (!mod) return;
      try { fn(mod); } catch {}
      try { if (mod.default) fn(mod.default); } catch {}
      try {
        for (const key of Reflect.ownKeys(mod)) {
          try { fn(mod[key]); } catch {}
        }
      } catch {}
    };

    const getWebpackRequire = () => {
      const reqs = [];
      const seen = new Set();

      window.webpackChunkdiscord_app.push([[Symbol()], {}, req => {
        if (req && !seen.has(req)) {
          seen.add(req);
          reqs.push(req);
        }
      }]);
      window.webpackChunkdiscord_app.pop();

      const hasSource = (req, ...needles) => {
        for (const id in req?.m) {
          let source;
          try {
            source = req.m[id]?.toString?.();
          } catch {
            continue;
          }
          if (source && needles.every(needle => source.includes(needle))) return true;
        }
        return false;
      };

      return reqs.find(req =>
        hasSource(req, 'getAssetImage: size must === [') &&
        hasSource(req, 'Invalid Origin', 'coverImage', '.application')
      ) || reqs.at(-1);
    };

    const findModule = (wpRequire, ...needles) => {
      for (const id in wpRequire.m) {
        let source;
        try {
          source = wpRequire.m[id]?.toString?.();
        } catch {
          continue;
        }
        if (!source || !needles.every(needle => source.includes(needle))) continue;
        try {
          return wpRequire(id);
        } catch {}
      }
    };

    const findInCache = (wpRequire, test, depth = 4) => {
      const seen = new WeakSet();
      let found;

      const walk = (value, remainingDepth) => {
        if (found || !value || (typeof value !== 'object' && typeof value !== 'function')) return;
        if (value === window || value === document || value === globalThis) return;
        if (seen.has(value)) return;
        seen.add(value);

        try {
          if (test(value)) {
            found = value;
            return;
          }
        } catch {}

        if (!remainingDepth) return;
        eachCandidate(value, candidate => walk(candidate, remainingDepth - 1));
      };

      for (const id in wpRequire.c) {
        const mod = wpRequire.c[id]?.exports;
        if (!mod) continue;

        walk(mod, depth);
        if (found) return found;
      }
    };

    const handleMessage = async msg => {
      if (!Dispatcher) {
        const wpRequire = getWebpackRequire();

        Dispatcher = findInCache(wpRequire, candidate =>
          candidate &&
          typeof candidate.dispatch === 'function' &&
          typeof candidate.subscribe === 'function'
        );

        const assetMod = findModule(wpRequire, 'getAssetImage: size must === [');
        eachCandidate(assetMod, candidate => {
          if (!lookupAsset && typeof candidate === 'function') {
            const str = candidate.toString();
            if (str.includes('APPLICATION_ASSETS_FETCH_SUCCESS') &&
              str.includes('startsWith("http:")')) {
              lookupAsset = async (appId, name) => (await candidate(appId, [name]))[0];
            }
          }
        });

        const appMod = findModule(wpRequire, 'Invalid Origin', 'coverImage', '.application');
        eachCandidate(appMod, candidate => {
          if (!lookupApp && typeof candidate === 'function') {
            const str = candidate.toString();
            if (str.includes('Invalid Origin') &&
              str.includes('coverImage') &&
              str.includes('.application')) {
              lookupApp = async appId => {
                const socket = {};
                await candidate(socket, appId);
                return socket.application;
              };
            }
          }
        });

        if (!Dispatcher || !lookupAsset || !lookupApp) {
          const missing = [
            !Dispatcher && 'Dispatcher',
            !lookupAsset && 'lookupAsset',
            !lookupApp && 'lookupApp',
          ].filter(Boolean).join(', ');
          throw new Error('Rich Presence köprüsü için Discord dahili modülleri bulunamadı (' + missing + ')');
        }
      }

      if (msg.activity?.assets?.large_image) msg.activity.assets.large_image = await lookupAsset(msg.activity.application_id, msg.activity.assets.large_image);
      if (msg.activity?.assets?.small_image) msg.activity.assets.small_image = await lookupAsset(msg.activity.application_id, msg.activity.assets.small_image);

      if (msg.activity) {
        const appId = msg.activity.application_id;
        if (!apps[appId]) apps[appId] = await lookupApp(appId);

        const app = apps[appId];
        if (!msg.activity.name) msg.activity.name = app.name;
      }

      Dispatcher.dispatch({ type: 'LOCAL_ACTIVITY_UPDATE', ...msg });
    };

    // arRPC sunucusu (main süreçte) sayfa yüklenmesinden biraz sonra hazır olabilir, bu
    // yüzden bağlantı kopukken/başarısızken sessizce yeniden dener — tek seferlik bağlantı
    // denemesi bir yarış durumunda Rich Presence'ı kalıcı olarak devre dışı bırakırdı.
    const connect = () => {
      let ws;
      try {
        ws = new WebSocket('ws://127.0.0.1:1337');
      } catch {
        setTimeout(connect, 5000);
        return;
      }

      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg).catch(err => console.error('[SplitCord] Rich Presence köprüsü mesaj işlenemedi:', err));
        } catch (err) {
          console.error('[SplitCord] Rich Presence köprüsü mesaj ayrıştırılamadı:', err);
        }
      };
      ws.onclose = () => setTimeout(connect, 5000);
      ws.onerror = () => {}; // onclose zaten yeniden bağlanmayı tetikliyor
    };

    connect();
  })();

  // --- KULLANICI TALEBİ: Programda gösterilen TÜM dialoglar bizim temamıza uymalı ---
  // Discord'un kendi sayfası (ve içine enjekte edilen Vencord gibi üçüncü taraf kod)
  // window.alert() çağırdığında normalde Chromium'un native/temasız uyarı kutusu
  // çıkıyordu (canlı testte bulundu: Vencord'un QuickCSS düzenleyicisi bir popup
  // penceresi açamayınca "Failed to open QuickCSS popup" diye TAM OLARAK bunu
  // gösteriyordu -- asıl popup sorunu window.js'teki setWindowOpenHandler'da
  // düzeltildi, ama bu yama Discord/eklenti kodunun çağıracağı HERHANGİ bir alert()
  // için genel bir güvence).
  //
  // window.confirm()/prompt() KASITLI OLARAK burada YOK: bunlar çağıran koda SENKRON
  // bir boolean/string DÖNMESİ gerekiyor (ör. "if (confirm(...)) sil()"), ama bizim
  // enjekte ettiğimiz modal ASENKRON (bir Promise/DOM olayı) -- gerçekten engellemeden
  // sahte bir senkron değer döndürmek (ör. her zaman false) kullanıcı HİÇBİR ŞEY
  // SEÇMEDEN kodun "İptal edildi" gibi davranmasına yol açardı; bu, temasız ama
  // GERÇEKTEN doğru çalışan native confirm'den daha kötü bir regresyon olurdu.
  // alert()'in bu sorunu YOK çünkü dönüş değeri (undefined) hiçbir zaman kontrol
  // akışında kullanılmıyor -- bu yüzden yalnızca o yamalanıyor.
  //
  // Renderer'ımızdaki modal.js'in AYNISI değil (o dosya bu sayfaya hiç yüklenmiyor) --
  // aynı görsel tasarımın (theme.css .sc-modal-* kuralları) bağımsız, kendi kendine
  // yeten bir kopyası; Discord'un sayfası bizim CSS değişkenlerimizi tanımadığı için
  // renkler sabit (theme.css'teki :root değerleriyle birebir aynı) kodlandı.
  (function setupStyledAlert() {
    var STYLE_ID = '__splitcordAlertStyle';
    function ensureStyle() {
      if (document.getElementById(STYLE_ID) || !document.head) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '.__splitcord-alert-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);opacity:0;transition:opacity 120ms ease;font-family:"gg sans","Noto Sans",sans-serif}' +
        '.__splitcord-alert-overlay.__splitcord-alert-visible{opacity:1}' +
        '.__splitcord-alert-box{width:440px;max-width:calc(100vw - 32px);padding:24px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);transform:scale(.96);transition:transform 120ms ease}' +
        '.__splitcord-alert-overlay.__splitcord-alert-visible .__splitcord-alert-box{transform:scale(1)}' +
        '.__splitcord-alert-message{font-size:15px;line-height:1.4;white-space:pre-wrap}' +
        '.__splitcord-alert-actions{margin-top:20px;display:flex;justify-content:flex-end}' +
        '.__splitcord-alert-btn{border:none;border-radius:4px;padding:10px 16px;font-size:14px;font-weight:500;cursor:pointer;color:#fff;background:#5865f2}' +
        '.__splitcord-alert-btn:hover{background:#4752c4}';
      document.head.appendChild(style);
    }

    window.alert = function splitcordStyledAlert(message) {
      if (!document.body) { console.log('[SplitCord alert]', message); return; }
      ensureStyle();
      var overlay = document.createElement('div');
      overlay.className = '__splitcord-alert-overlay';
      var box = document.createElement('div');
      box.className = '__splitcord-alert-box';
      // KULLANICI TALEBİ: Ayarlar > Görünüm'deki renk seçimine uysun -- window.js'te
      // injectMainWorldScript'in ÖNCEDEN yazdığı __splitcordThemeColors (dynamicColor'ın
      // titlebar için kullandığı AYNI palet) varsa onu kullan, yoksa (ör. henüz hiç örnek
      // alınmamışsa) theme.css'teki :root varsayılanlarıyla birebir aynı sabit değerlere düş.
      var colors = window.__splitcordThemeColors || {};
      box.style.background = colors.primary || '#313338';
      box.style.color = colors.textNormal || '#f2f3f5';
      var messageEl = document.createElement('div');
      messageEl.className = '__splitcord-alert-message';
      messageEl.textContent = String(message);
      var actions = document.createElement('div');
      actions.className = '__splitcord-alert-actions';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = '__splitcord-alert-btn';
      btn.textContent = 'Tamam';
      btn.addEventListener('click', function () {
        overlay.classList.remove('__splitcord-alert-visible');
        setTimeout(function () { overlay.remove(); }, 150);
      });
      actions.appendChild(btn);
      box.appendChild(messageEl);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        overlay.classList.add('__splitcord-alert-visible');
        btn.focus();
      });
    };
  })();
})();
`;

function injectMainWorldScript() {
  // KULLANICI TALEBİ: setupStyledAlert (aşağıda) SplitCord-Turkey'in Görünüm'deki renk
  // seçimini yansıtsın -- dynamicColor'ın titlebar için kullandığı AYNI paleti burada
  // senkron olarak okuyup ana dünyaya değişken olarak (MAIN_WORLD_SCRIPT'ten ÖNCE) veriyoruz.
  let themeColors = null;
  try {
    themeColors = ipcRenderer.sendSync('theme:get-colors-sync');
  } catch {}
  const themePrefix = `window.__splitcordThemeColors = ${JSON.stringify(themeColors)};\n`;

  webFrame.executeJavaScript(themePrefix + MAIN_WORLD_SCRIPT).catch((err) => {
    try {
      ipcRenderer.send('discord-preload:diag', { injectError: err.message });
    } catch {}
  });
}

// document-start'ta (bu preload'un çalıştığı an) navigator/window her zaman erişilebilir
// olduğu için enjeksiyon hemen yapılabiliyor. Discord SPA içinde tam sayfa yenilemeden
// dolaştığı için tekrar tekrar çalışmasına gerek yok, ama garanti olsun diye
// DOMContentLoaded'da da bir kez daha deniyoruz (__splitcordPatched bayrağı sayesinde
// güvenli/idempotent).
injectMainWorldScript();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMainWorldScript, { once: true });
}

/**
 * KULLANICI TALEBİ: Vencord (bkz. localSettings.js vencordEnabled notu, varsayılan KAPALI --
 * Discord ToS riski nedeniyle kullanıcı bilerek açmalı). Vencord'un webpack modüllerini
 * yamalayabilmesi için Discord'un GERÇEK script'lerinden (ve onların webpackChunkdiscord_app
 * push'larından) KESİNLİKLE ÖNCE çalışması gerekiyor -- bu yüzden injectMainWorldScript()'le
 * AYNI document-start zamanlamasında, ama ondan ÖNCE tetikleniyor.
 *
 * Neden native bir köprü (VencordNative IPC) YAZMADIK: resources/vencord/browser.js,
 * Vencord'un kendi "web" derleme hedefi (bkz. resources/vencord/SOURCE.txt) -- bu hedefin
 * kendi VencordNativeStub.ts'i zaten localStorage/IndexedDB kullanıyor (gerçek dosya
 * sistemi/Electron IPC'sine hiç ihtiyaç duymuyor), yani paket kendi başına webview'in ana
 * dünyasında çalışmaya hazır. localStorage/IndexedDB partition'a (persist:discord) özel
 * olduğu için Vencord'un ayarları/temaları uygulama yeniden başlatıldığında da kalıcı.
 *
 * GERÇEK BUG (canlı testte bulundu): <webview>'in preload'u SANDBOXED çalışıyor -- burada
 * require('node:fs')/require('node:path') kullanmaya çalışmak "module not found: node:fs"
 * ile İSTİSNAİ ATIYOR ve bu, bu dosyanın TAMAMINI (Vencord'dan bağımsız, önceden çalışan
 * kod dahil -- contextBridge.exposeInMainWorld dahil) sessizce çökertiyordu
 * (webContents.on('preload-error') ile doğrulandı). Bu yüzden dosya okuma işlemi ana
 * sürece taşındı (bkz. ipc.js vencord:get-injection-sync) -- burada yalnızca hazır JS/CSS
 * metnini SENKRON olarak alıyoruz (async bir IPC round-trip'i Discord'un script'leri
 * başlamadan bitiremeyebilir).
 */
function injectVencordIfEnabled() {
  let injection = null;
  try {
    injection = ipcRenderer.sendSync('vencord:get-injection-sync');
  } catch {
    return;
  }
  if (!injection) return;
  if (injection.error) {
    try {
      ipcRenderer.send('discord-preload:diag', { vencordLoadError: injection.error });
    } catch {}
    return;
  }
  const { js: vencordJs, css: vencordCss } = injection;

  // CSS'i ayrı bir <style> etiketi olarak enjekte ediyoruz -- document-start'ta
  // document.head henüz oluşmamış olabilir, bu yüzden setupNativeAppPromptSuppressor'daki
  // AYNI bekleme deseniyle (document.head oluşana kadar kısa aralıklarla tekrar dener)
  // hazır olana kadar bekliyoruz.
  const script = `
    // KULLANICI TALEBİ (2026-09-09): Vencord'un WebScreenShareFixes/WebKeybinds/WebPWA
    // eklentileri kendi kaynağında "enabledByDefault:true" olarak tanımlı -- yani Vencord
    // ilk kez etkinleştirildiğinde bu üçü otomatik AÇIK geliyor, ama bunlar bizim enjeksiyon
    // mimarimizde (gerçek bir tarayıcı eklentisi/Vesktop DEĞİLİZ) sorunlara yol açıyor.
    // Vencord'un KENDİ (pinlenmiş commit'teki) kaynağını yamalamak yerine -- ki bu her
    // build-vencord.js çalıştırmasında/sürüm güncellemesinde kırılgan olurdu -- Vencord
    // henüz hiç çalışmadan ÖNCE localStorage'daki "VencordSettings" JSON'ına bu üç eklenti
    // için AÇIKÇA {enabled:false} yazıyoruz. Vencord'un kendi ayar proxy'si (Settings.ts)
    // bir eklentinin durumunu "target[name] ??= {enabled: required||enabledByDefault||false}"
    // şeklinde YALNIZCA henüz bir kayıt YOKSA hesaplayıp önbelleğe alıyor -- kayıt zaten
    // varsa (aşağıdaki gibi bizim önceden yazdığımız {enabled:false}) onu OLDUĞU GİBİ
    // kullanıyor. Bu yüzden bu kod SADECE ilk kez (henüz bir kayıt yokken) varsayılanı
    // kapalıya çeviriyor -- kullanıcı bunları SONRADAN Vencord ayarlarından elle tekrar
    // açarsa (bu durumda kayıt zaten var olacağı için) bir daha asla ezilmiyor.
    (function __splitcordDisableDefaultVencordPlugins() {
      var DISABLED_BY_DEFAULT = ['WebScreenShareFixes', 'WebKeybinds', 'WebPWA'];
      try {
        var raw = localStorage.getItem('VencordSettings');
        var settings = raw ? JSON.parse(raw) : {};
        if (!settings.plugins) settings.plugins = {};
        var changed = false;
        DISABLED_BY_DEFAULT.forEach(function (name) {
          if (!(name in settings.plugins)) {
            settings.plugins[name] = { enabled: false };
            changed = true;
          }
        });
        if (changed) localStorage.setItem('VencordSettings', JSON.stringify(settings));
      } catch (e) {}
    })();

    ${vencordJs}
    (function() {
      function __splitcordAppendVencordCss() {
        if (!document.head) { setTimeout(__splitcordAppendVencordCss, 20); return; }
        if (document.getElementById('__splitcordVencordCss')) return;
        var style = document.createElement('style');
        style.id = '__splitcordVencordCss';
        style.textContent = ${JSON.stringify(vencordCss)};
        document.head.appendChild(style);
      }
      __splitcordAppendVencordCss();
    })();

    // KULLANICI TALEBİ: Vencord'un bazı özellikleri bizim enjeksiyon mimarimizde
    // (gerçek bir tarayıcı eklentisi DEĞİLİZ) çalışamıyor -- bunları sessizce kırık
    // bırakmak yerine "kullanılamıyor" bilgilendirmesi gösteriyoruz. window.alert
    // burada ZATEN bizim temalı kutumuza yamalı (bkz. MAIN_WORLD_SCRIPT'teki
    // setupStyledAlert -- bu script ondan HEP SONRA çalışıyor, injectMainWorldScript
    // her zaman injectVencordIfEnabled'dan ÖNCE çağrılıyor).
    (function setupSplitcordVencordFeatureBlocks() {
      var UNAVAILABLE_MESSAGE = 'Bu özellik SplitCord-Turkey içerisinde kullanılamıyor.';

      // QuickCSS düzenleyici: VencordNative.quickCss.openEditor() bir "about:blank" popup'ı
      // açıp Monaco editörünü yazıyor -- ama bu popup Vencord'un GERÇEK bir tarayıcı
      // eklentisi olduğunu varsayıp kendi statik dosyalarını (editor.worker.js vb.) bir
      // eklenti sunucusundan (EXTENSION_BASE_URL) çekmeye çalışıyor; bizim ham JS
      // enjeksiyonu yaklaşımımızda böyle bir sunucu YOK, bu yüzden popup sonsuza kadar
      // "loading" kalıp hiçbir zaman gerçek bir editör göstermiyor (canlı testte
      // doğrulandı). VencordNative.quickCss GERÇEK, mutable bir global olduğu için
      // (Discord'un DOM'una bağlı değil) doğrudan üzerine yazmak DOM tıklama
      // yakalamaktan daha güvenilir.
      if (window.VencordNative && window.VencordNative.quickCss) {
        window.VencordNative.quickCss.openEditor = function () {
          window.alert(UNAVAILABLE_MESSAGE);
        };
      }

      // Cloud Integrations: authorizeCloud() (api.vencord.dev'e OAuth) CloudTab.tsx'in
      // kendi modül kapsamına gömülü -- VencordNative gibi mutable bir global üzerinden
      // erişilemiyor, bu yüzden onu tetikleyen İKİ giriş noktasını (switch + "Reauthorise"
      // butonu) Vencord'un kendi KARARLI "vc-form-switch-wrapper"/"vc-cloud-icon-with-
      // button" class'larıyla (Discord'un hash'li class'ları DEĞİL, bu yüzden Discord
      // güncellemelerinden bağımsız) yakalayıp tıklamayı Vencord'un handler'ına ULAŞMADAN
      // engelliyoruz.
      document.addEventListener('click', function (event) {
        var target = event.target;
        var switchWrapper = target && target.closest && target.closest('.vc-form-switch-wrapper');
        var isCloudSwitch = switchWrapper && switchWrapper.textContent.indexOf('Enable Cloud Integrations') !== -1;
        var reauthBtn = target && target.closest && target.closest('.vc-cloud-icon-with-button');
        var isReauthBtn = reauthBtn && reauthBtn.textContent.indexOf('Reauthorise') !== -1;
        if (!isCloudSwitch && !isReauthBtn) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.alert(UNAVAILABLE_MESSAGE);
      }, true);
    })();
  `;

  webFrame.executeJavaScript(script)
    .then(() => webFrame.executeJavaScript('typeof window.Vencord'))
    .then((vencordType) => {
      try {
        ipcRenderer.send('discord-preload:diag', { vencordInjected: true, vencordType });
      } catch {}
    })
    .catch((err) => {
      try {
        ipcRenderer.send('discord-preload:diag', { vencordInjectError: err.message });
      } catch {}
    });
}

injectVencordIfEnabled();

/**
 * Ayarlar > Görünüm'deki "Discord temasına göre otomatik renk" özelliği, ana süreçte
 * (dynamicColor.js) periyodik DOM örneklemesi yaparak çalışıyor — Discord'un kendi hesap
 * ayarlarından tema değiştirildiğinde bunun beklemeden anında tetiklenmesi için, Discord
 * tema değiştiğinde neredeyse anında güncellediği <html>'in class/style'ını bir
 * MutationObserver ile izleyip ana sürece haber veriyoruz. DOM düğümleri (izole/ana
 * dünya farkı olmadan) süreç genelinde PAYLAŞILDIĞI için bu gözlemleme izole preload
 * dünyasından yapılsa da sorunsuz çalışıyor — sorun observe() çağrısının document-start'ta
 * (document.documentElement henüz yokken) senkron çağrılıp sessizce hata fırlatmasıydı;
 * artık documentElement oluşana kadar bekliyor.
 */
(function setupThemeChangeNotifier() {
  let debounceTimer = null;
  function notify() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        ipcRenderer.send('dynamic-color:theme-changed');
      } catch (err) {
        console.error('[SplitCord] Tema değişikliği bildirilemedi:', err);
      }
    }, 150);
  }

  function startObserving() {
    if (!document.documentElement) {
      setTimeout(startObserving, 20);
      return;
    }
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  startObserving();
})();

/**
 * Discord'un Ses ve Video > Tuş Atamaları sayfasında, tarayıcıda özel tuş atamaları
 * desteklenmediğine dair bir uyarı gösteriyor ("Özel tuş atamaları şu an tarayıcıda
 * desteklenmiyor... masaüstü uygulamasını indir"). SplitCord-Turkey'in artık kendi
 * global tuş atama özelliği (bkz. Ayarlar > Tuş Atamaları) olduğu için bu metni,
 * kullanıcıyı gerçekten çalışan yere yönlendiren, TIKLANABİLİR bir nota (tıklanınca
 * 'window:open-settings' IPC kanalıyla ayarlar penceresini doğrudan panel-shortcuts
 * sekmesinde açan bir bağlantıya) değiştiriyoruz.
 *
 * DİL BAĞIMSIZ EŞLEŞTİRME: metnin kendisine (çevrilebilir) değil, içindeki
 * "discord.com/download" bağlantısına bakıyoruz — bir URL, Discord'un dili ne olursa
 * olsun AYNI kalır, bu yüzden kullanıcı Discord'u İngilizce (veya başka bir dilde)
 * kullansa bile bu notice hâlâ bulunup değiştirilebilir. Discord'un CSS modül sınıf
 * adları (ör. "text-sm/medium_cf4812") da derlemeden derlemeye değişen hash'ler olduğu
 * için onlara da bağlı değiliz. Sayfa içeriği DOM'a SONRADAN (SPA navigasyonuyla)
 * eklendiği için bir MutationObserver ile izleniyor.
 */
(function setupKeybindsNoticeReplacer() {
  function tryReplace(el) {
    if (el.dataset.splitcordReplaced === 'true') return;
    if (!el.querySelector('a[href*="discord.com/download"]')) return;

    el.textContent = '';
    el.appendChild(document.createTextNode('Özel/Global tuş atamalarını düzenlemek için '));

    // ipcRenderer'a doğrudan erişimimiz var (bu preload, contextBridge'e ihtiyaç
    // duymadan zaten Node/Electron modüllerine erişebiliyor) — bu yüzden ayarlar
    // penceresini AYNI IPC kanalıyla ('window:open-settings') açabiliyoruz, ana
    // penceredeki "+" ve ayarlar butonlarının kullandığı kanalla birebir aynı.
    const link = document.createElement('a');
    link.textContent = "SplitCord-Turkey'in ayarlar bölümüne";
    link.href = '#';
    link.style.cursor = 'pointer';
    link.style.textDecoration = 'underline';
    link.style.color = 'var(--text-link, #00a8fc)';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      ipcRenderer.send('window:open-settings', 'panel-shortcuts');
    });
    el.appendChild(link);

    el.appendChild(document.createTextNode(' gidin.'));
    el.dataset.splitcordReplaced = 'true';

    // KULLANICI TALEBİ: yalnızca metin içi bağlantı yetersiz görüldü -- mesajın ALTINA,
    // doğrudan ayarlar penceresini Tuş Atamaları sekmesinde açan AYRI bir buton ekleniyor
    // (bkz. setupBanCurrentArgsButton'daki AYNI buton stili -- Discord blurple arka plan).
    // EL'İN KENDİ ÇOCUĞU olarak ekleniyor (sibling DEĞİL): notice kutusu ikon+metni yan yana
    // dizen bir flex satırı olabilir -- el'in dışına sibling eklemek butonu ikonun yanına,
    // "altına" değil "yanına" koyardı. button varsayılan olarak block seviyeli bir kutu
    // olduğu için el'in İÇİNE eklenince satır metninin hemen altına doğal olarak kayıyor.
    if (el.querySelector('[data-splitcord-keybinds-settings-btn]')) return;
    const btn = document.createElement('button');
    btn.textContent = 'SplitCord-Turkey Tuş Atamaları';
    btn.setAttribute('data-splitcord-keybinds-settings-btn', 'true');
    btn.style.display = 'block';
    btn.style.marginTop = '10px';
    btn.style.padding = '6px 14px';
    btn.style.borderRadius = '4px';
    btn.style.border = 'none';
    btn.style.background = '#5865F2';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontFamily = 'inherit';
    btn.addEventListener('click', () => {
      ipcRenderer.send('window:open-settings', 'panel-shortcuts');
    });
    el.appendChild(btn);
  }

  function scanForNotice(root) {
    if (!root.querySelectorAll) return;
    if (root.matches?.('[data-text-variant]')) tryReplace(root);
    root.querySelectorAll('[data-text-variant]').forEach(tryReplace);
  }

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 50);
      return;
    }
    scanForNotice(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          scanForNotice(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserving();
})();

/**
 * KULLANICI TALEBİ: Discord'un KENDİ "Bas-Konuş (Sınırlı)" özelliği (Ayarlar > Ses ve
 * Görüntü > Ses sayfası) SplitCord-Turkey'in GLOBAL Bas-Konuş sisteminden (bkz.
 * shortcuts.js holdActionsMap/pushToTalk+pushToMute, voiceState.js setMuted) TAMAMEN
 * BAĞIMSIZ, PARALEL çalışıyordu -- ikisi AYNI ANDA aktifse çakışıyor: Discord'un kendi
 * PTT'si yalnızca SEKME ÖN PLANDAYKEN çalışan, KENDİ ayrı tuş atamasına bağlı bir JS
 * seviyesinde "ses kapısı"; bizim sistemimiz ise OS seviyesinde (uiohook, pencere odakta
 * OLMASA BİLE) çalışıp doğrudan Discord'un GERÇEK sustur switch'ini tetikliyor (bkz.
 * voiceState.js SET_MUTE_SCRIPT). Discord'un kendi PTT'si AÇIK ama KENDİ tuşu
 * atanmamışsa, bizim sistemimiz mikrofonu mantıken açsa (sustur switch'ini kapatsa) bile
 * Discord'un kendi PTT kapısı hiç açılmadığı için ses YİNE DE gitmeyebiliyordu -- iki
 * ayrı, çakışan "doğruluk kaynağı".
 *
 * ÇÖZÜM: Discord'un kendi Bas-Konuş (Sınırlı) switch'ini ZORLA KAPALI tutuyoruz (KAPALIYKEN
 * Discord "Ses Aktivasyonu" moduna döner, mikrofon sürekli açık kalır ama bizim
 * setMuted() çağrılarımız GERÇEK sustur switch'ini tetiklediği için nihai sonuç yine
 * doğru oluyor) ve kullanıcının yanlışlıkla tekrar açmasını önlemek için devre dışı
 * bırakıyoruz; hem switch'in hem de altındaki "Bas-Konuş Tuş Ataması" satırının yanına
 * kullanıcıyı SplitCord-Turkey'in KENDİ Tuş Atamaları sayfasına yönlendiren bir not
 * ekliyoruz.
 *
 * DİL BAĞIMSIZ EŞLEŞTİRME: metne değil, Discord'un KENDİ, dilden bağımsız
 * `data-nav-anchor-key="voice_push_to_talk_setting"` / `"voice_push_to_talk_keybind_setting"`
 * özniteliklerine bakılıyor (Discord'un bu sayfadaki her ayar satırına verdiği, kendi
 * arama/derin bağlantı sistemi için kullandığı sabit anchor -- CSS modül hash'lerinden
 * FARKLI olarak İSTİKRARLI, canlı DOM'da doğrulandı).
 */
(function setupPushToTalkOverride() {
  function forceSwitchOff(row) {
    const input = row.querySelector('input[type="checkbox"][role="switch"]');
    if (!input) return;
    if (input.checked) input.click();
    input.disabled = true;
    const label = input.closest('label');
    if (label) {
      label.style.opacity = '0.5';
      label.style.pointerEvents = 'none';
    }
  }

  function injectNote(row) {
    if (row.querySelector('[data-splitcord-ptt-note]')) return;
    const note = document.createElement('div');
    note.setAttribute('data-splitcord-ptt-note', 'true');
    note.style.marginTop = '8px';
    note.style.fontSize = '12px';
    note.style.color = 'var(--text-muted, #949ba4)';
    note.appendChild(
      document.createTextNode(
        "Bu ayar, SplitCord-Turkey'in her durumda (pencere arkaplanda olsa bile) çalışan global " +
          'Bas-Konuş sistemiyle çakıştığı için devre dışı bırakıldı. Tuş atamak için ',
      ),
    );
    const link = document.createElement('a');
    link.textContent = "SplitCord-Turkey'in Tuş Atamaları ayarlarına";
    link.href = '#';
    link.style.cursor = 'pointer';
    link.style.textDecoration = 'underline';
    link.style.color = 'var(--text-link, #00a8fc)';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      ipcRenderer.send('window:open-settings', 'panel-shortcuts');
    });
    note.appendChild(link);
    note.appendChild(document.createTextNode(' git.'));
    row.appendChild(note);
  }

  function disableKeybindRow(row) {
    if (row.dataset.splitcordPttKeybindDisabled === 'true') return;
    row.dataset.splitcordPttKeybindDisabled = 'true';
    row.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    row.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';
    });
    row.style.opacity = '0.5';
  }

  function tryApply(row) {
    if (row.dataset.splitcordPttChecked === 'true') return;
    row.dataset.splitcordPttChecked = 'true';
    forceSwitchOff(row);
    injectNote(row);
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches?.('[data-nav-anchor-key="voice_push_to_talk_setting"]')) tryApply(root);
    root.querySelectorAll('[data-nav-anchor-key="voice_push_to_talk_setting"]').forEach(tryApply);

    if (root.matches?.('[data-nav-anchor-key="voice_push_to_talk_keybind_setting"]')) disableKeybindRow(root);
    root.querySelectorAll('[data-nav-anchor-key="voice_push_to_talk_keybind_setting"]').forEach(disableKeybindRow);
  }

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 50);
      return;
    }
    scan(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserving();
})();

/**
 * Discord'un web istemcisi, mikrofondan ses algılayamadığında "Görünen o ki, Discord
 * mikrofonundan ses alamıyor" uyarısını (Hata: 3002) gösteriyor — bu genelde YANLIŞ ALARM
 * (kullanıcı henüz konuşmadığında da tetikleniyor). Ayarlar > Genel'deki "Hatalı ses
 * uyarısını devre dışı bırak" AÇIKKEN bu uyarı hiç gösterilmiyor; KAPALIYKEN (varsayılan)
 * mesaj daha az alarmcı bir metinle değiştiriliyor, "Ayarlar'a git" butonu "Ses
 * ayarlarına git" olarak yeniden adlandırılıyor (DAVRANIŞINA dokunmadan — Discord'un kendi
 * click handler'ı React tarafından tutuluyor, yalnızca metnini değiştiriyoruz) ve yanına
 * kullanıcıyı doğrudan SplitCord-Turkey'in ilgili ayarına götüren yeni bir buton ekleniyor.
 *
 * DİL BAĞIMSIZ EŞLEŞTİRME: mesajın kendisine değil, Discord'un HER dilde aynı kalan hata
 * KODUNA ("3002") bakılıyor — setupKeybindsNoticeReplacer'daki aynı prensip. Discord'un
 * CSS modül sınıf adları da derlemeden derlemeye değişen hash'ler içeriyor (ör.
 * "errorCodeNoticeText_b68a35"), bu yüzden TAM class adına değil, [class*="..."] gibi
 * "içerir" seçicilere bağlı kalınıyor.
 */
(function setupVoiceWarningNoticeHandler() {
  function findMessageTextNode(container) {
    // Mesaj metni, notice container'ının DOĞRUDAN bir metin düğümü (span/div'e
    // sarılmamış) — kapatma butonu (div), hata kodu (span) ve "Ayarlar'a git" butonu
    // (button) ELEMENT düğümleri, mesajın kendisi ise aralarındaki düz metin.
    for (const node of container.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return node;
      }
    }
    return null;
  }

  function applyTreatment(container, disabled) {
    if (disabled) {
      container.style.display = 'none';
      return;
    }

    const textNode = findMessageTextNode(container);
    if (textNode) {
      textNode.textContent = 'Görünen o ki, Discord mikrofonundan ses alamıyor. Bu henüz konuşmadığın için de olabilir.';
    }

    const goToSettingsBtn = container.querySelector('button');
    if (!goToSettingsBtn) return;
    goToSettingsBtn.textContent = 'Ses ayarlarına git';

    if (container.querySelector('[data-splitcord-disable-voice-warning-btn]')) return;
    const disableBtn = document.createElement('button');
    disableBtn.textContent = 'SplitCord-Turkey ayarlarında bu uyarıyı devre dışı bırak';
    disableBtn.setAttribute('data-splitcord-disable-voice-warning-btn', 'true');
    // Discord'un kendi butonuyla aynı görünüm sınıfını paylaşıyor ki stilsiz kalmasın.
    disableBtn.className = goToSettingsBtn.className;
    disableBtn.style.marginLeft = '8px';
    disableBtn.addEventListener('click', () => {
      ipcRenderer.send('window:open-settings', 'panel-general', 'row-disable-false-voice-warning');
    });
    goToSettingsBtn.insertAdjacentElement('afterend', disableBtn);
  }

  function tryHandle(el) {
    if (el.dataset.splitcordVoiceWarningChecked === 'true') return;
    const text = el.textContent || '';
    if (!text.includes('3002')) return;

    const container = el.closest('[class*="notice"]');
    if (!container || container.dataset.splitcordVoiceWarningChecked === 'true') return;
    el.dataset.splitcordVoiceWarningChecked = 'true';
    container.dataset.splitcordVoiceWarningChecked = 'true';

    ipcRenderer
      .invoke('app:get-disable-false-voice-warning')
      .then((disabled) => applyTreatment(container, !!disabled))
      .catch((err) => console.error('[SplitCord] Ses uyarısı ayarı okunamadı:', err));
  }

  function scanForNotice(root) {
    if (!root.querySelectorAll) return;
    if (root.matches?.('[class*="errorCodeNoticeText"]')) tryHandle(root);
    root.querySelectorAll('[class*="errorCodeNoticeText"]').forEach(tryHandle);
  }

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 50);
      return;
    }
    scanForNotice(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          scanForNotice(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserving();
})();

/**
 * Discord'un KENDİ "bağlantı kurulamadı / uzun süre yüklenemedi" durumunda gösterdiği statik
 * yükleme kabuğu (React tam devreye girmeden önceki basit HTML — bu yüzden diğer React
 * bileşenlerine kıyasla çok daha kararlı/nadiren değişen bir yapı; "BİLİYOR MUYDUN?" ipucu +
 * Discord logosu + "Bağlantı sorunları mı? Bize bildir!" + Twitter/X ve Sunucu Durumu
 * bağlantıları) kullanıcı talebiyle "Kullanılan Argüman Setini Yasaklamayı Deneyin" butonu
 * ekleniyor — tıklanınca (onaydan sonra) o an aktif motorun kayıtlı argüman setini reddedip
 * Otomatik moda geçip sıfırdan bir tarama başlatıyor (btnStatusRetryAuto'nun — bkz.
 * titlebar.js — AYNI "mod zorla Otomatik + zapret'ten başlat" deseni, öncesine bir de
 * reddetme adımı eklenmiş hâli).
 *
 * DİL BAĞIMSIZ EŞLEŞTİRME: metne değil (Discord'un dili her neyse bu ekran ona göre
 * değişir), Discord'un HER dilde AYNI kalan sabit bağlantılarına (resmi durum sayfası
 * discordstatus.com, resmi Twitter/X hesabı) bakılıyor — setupKeybindsNoticeReplacer/
 * setupVoiceWarningNoticeHandler'daki AYNI ilke. NOT: bu ekranın gerçek DOM'u bu oturumda
 * canlı olarak doğrulanamadı (ISP bu makinede discord.com'u DNS/SNI seviyesinde engelliyor,
 * yalnızca SplitCord-Turkey'in kendi DPI aşımı üzerinden erişilebiliyor) — eşleştirme
 * Discord'un uzun süredir DEĞİŞMEYEN, herkese açık durum sayfası adresine dayanıyor; hedef
 * bağlantı hiç bulunamazsa buton sessizce hiç eklenmez (diğer enjeksiyonlarla aynı, zararsız
 * başarısızlık deseni).
 */
(function setupBanCurrentArgsButton() {
  function findFooterAnchor(root) {
    return root.querySelector(
      'a[href*="discordstatus.com"], a[href*="twitter.com/discord"], a[href*="x.com/discord"]',
    );
  }

  async function handleClick(button) {
    if (button.dataset.splitcordBusy === 'true') return;
    // window.confirm() yerine bizim temamıza uyan modal — bkz. ipc.js'teki
    // webview:confirm-ban-current-args (ana pencereyi hedefleyip showThemedConfirm ile açar).
    let confirmed = false;
    try {
      confirmed = await ipcRenderer.invoke('webview:confirm-ban-current-args');
    } catch (err) {
      console.error('[SplitCord] Onay kutusu açılamadı:', err);
      return;
    }
    if (!confirmed) return;

    const originalText = button.textContent;
    button.dataset.splitcordBusy = 'true';
    button.disabled = true;
    button.textContent = 'Yeni ayar aranıyor…';
    try {
      const status = await ipcRenderer.invoke('dpi:get-status');
      const activeEngineId = status?.activeEngineId;
      if (activeEngineId) {
        await ipcRenderer.invoke('dpi:reject-current-args', activeEngineId);
      }
      const mode = await ipcRenderer.invoke('dpi:get-mode');
      if (mode === 'manual') {
        await ipcRenderer.invoke('dpi:set-mode', 'automatic');
      }
      await ipcRenderer.invoke('dpi:activate-engine', 'zapret');
    } catch (err) {
      console.error('[SplitCord] Argüman seti yasaklanamadı:', err);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      button.dataset.splitcordBusy = 'false';
    }
  }

  function tryInject(root) {
    const anchor = findFooterAnchor(root);
    if (!anchor) return;

    const container = anchor.closest('div')?.parentElement || anchor.parentElement;
    if (!container || container.querySelector('[data-splitcord-ban-args-btn]')) return;

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-splitcord-ban-args-wrapper', 'true');
    wrapper.style.marginTop = '12px';
    wrapper.style.textAlign = 'center';

    const warning = document.createElement('div');
    warning.setAttribute('data-splitcord-ban-args-warning', 'true');
    warning.style.maxWidth = '360px';
    warning.style.margin = '0 auto';
    warning.style.color = '#faa61a';
    warning.style.fontSize = '12px';
    warning.style.lineHeight = '1.4';
    warning.textContent =
      '⚠️ Lütfen biraz sabredin. SplitCord-Turkey\'in bağlantınızı hazırlaması biraz zaman ' +
      'alabilir. Eğer 5 dakikadan fazla süredir bekliyorsanız aşağıdaki butonla argüman ' +
      'setini yasaklamayı deneyebilirsiniz.';
    wrapper.appendChild(warning);

    const btn = document.createElement('button');
    btn.textContent = 'Kullanılan Argüman Setini Yasaklamayı Deneyin';
    btn.setAttribute('data-splitcord-ban-args-btn', 'true');
    btn.style.marginTop = '12px';
    btn.style.padding = '6px 14px';
    btn.style.borderRadius = '4px';
    btn.style.border = 'none';
    btn.style.background = '#5865F2';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontFamily = 'inherit';
    btn.addEventListener('click', () => handleClick(btn));
    wrapper.appendChild(btn);

    container.appendChild(wrapper);
  }

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 50);
      return;
    }
    tryInject(document.body);
    const observer = new MutationObserver(() => tryInject(document.body));
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserving();
})();

/**
 * KULLANICI TALEBİ: Discord'un web istemcisi, hesaptan çıkış yapıldığında (ya da girişsiz
 * kök sayfaya gidildiğinde) "Discord Uygulaması Algılandı" başlıklı, "Uygulamayı Aç"/
 * "Tarayıcıda Devam Et" seçenekli bir ekran gösterebiliyor -- bu ekranın hiç görünmemesi
 * isteniyor. ÖNEMLİ: resmi Discord masaüstü uygulaması sistemde kurulu OLMASA BİLE bu ekran
 * çıkıyor (kullanıcı tarafından doğrulandı) -- yani bu, OS seviyesinde gerçek bir "discord://
 * için kayıtlı bir uygulama var mı" kontrolüne dayanmıyor, Discord'un web istemcisinin
 * KENDİ, koşulsuz bir "masaüstü uygulamasını dene" teşviki (birçok web sitesinin mobil/
 * masaüstü ziyaretçilere gösterdiği "uygulamada aç" banner'ıyla AYNI kategoriden bir desen).
 *
 * NEDEN User-Agent DEĞİŞTİRİLMİYOR: permissions.js configureBrowserIdentity()'deki AYNI
 * sınıftan bir sorunu (Discord'un "Electron" ibaresi görünce bizi "bozuk resmi uygulama
 * kopyası" sanıp ekran paylaşımını "önce indir" mesajıyla engellemesi) zaten UA'yı sıradan
 * bir Chrome tarayıcısına çevirerek çözmüştük -- UA'yı Discord'un GERÇEK masaüstü istemcisi
 * gibi görünecek şekilde ("discord/"/"Electron/" ekleyerek) değiştirmek bu ekranı da
 * çözebilirdi AMA ekran paylaşımı düzeltmesini GERİ ALIRDI (Discord'u yeniden "gerçek
 * masaüstü istemcisiyim" sanmaya döndürüp web tabanlı getDisplayMedia akışını devre dışı
 * bırakırdı) -- bu yüzden DOM seviyesinde, dosyadaki diğer enjeksiyonlarla (setupKeybinds
 * NoticeReplacer, setupVoiceWarningNoticeHandler) AYNI desenle susturuluyor.
 *
 * KULLANICI DÜZELTMESİ (buton bulup tıklamak YERİNE): Discord'un "devam et" butonunu DOM'da
 * arayıp tıklamak (önceki tasarım) Discord'un iç diyalog yapısına bağımlı, kırılgan bir
 * sezgiydi. Bunun yerine, ekran tespit edilir edilmez webview'ı doğrudan Discord'un normal
 * uygulama adresine (`https://discord.com/app` -- titlebar.js'in webview.src için zaten
 * kullandığı AYNI, bilinen-doğru adres) yönlendiriyoruz -- Discord'un kendi "devam et"
 * mantığına hiç güvenmeden, kesin/öngörülebilir bir hedefe gidiyoruz.
 *
 * DİL BAĞIMSIZ EŞLEŞTİRME: bu ekranın varlığı, `discord://` ile başlayan bir href'in DOM'da
 * bulunmasıyla tespit ediliyor (native app'e devretmenin TEK yolu bu, Discord'un dili ne
 * olursa olsun aynı kalır) -- dosyadaki diğer enjeksiyonlarla (setupKeybindsNoticeReplacer
 * vb.) AYNI ilke.
 *
 * BİLİNEN KÜÇÜK RİSK: bu eşleştirme yalnızca BU EKRANA özgü değil -- Discord'un normal,
 * OTURUM AÇMIŞ arayüzünde (ör. bir "uygulamada aç" bağlantısı içeren nadir bir yer)
 * benzer bir `discord://` href'i teorik olarak bulunursa, o durumda da /app'e yönlendirme
 * tetiklenir (zararsız -- zaten /app'e gitmiş oluruz, ama beklenmedik bir navigasyon olur).
 * DOĞRULANMADI: bu ekran bu oturumda canlı olarak incelenemedi (yalnızca bir ekran
 * görüntüsünden yola çıkıldı).
 */
(function setupNativeAppPromptSuppressor() {
  let redirected = false;

  function tryRedirect(root) {
    if (redirected) return;
    const appLink = root.querySelector?.('[href^="discord://"]');
    if (!appLink) return;
    redirected = true;
    window.location.replace('https://discord.com/app');
  }

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 50);
      return;
    }
    tryRedirect(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (redirected) break;
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          tryRedirect(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserving();
})();

/**
 * KULLANICI TALEBİ: Discord'un kendi Kullanıcı Ayarları kenar çubuğunun en üstüne (Hesap
 * seçeneğinin hemen üstüne) "SplitCord-Turkey Ayarları" adında bir öğe eklenir; tıklanınca
 * bizim Ayarlar penceremiz açılır.
 *
 * "Hesap" öğesini bulmak için Discord'un CSS module hash'lerini (ör. item_caf372 -- her
 * derlemede değişir) SABİT KODLAMIYORUZ; onun yerine canlı testte doğrulanan, çok daha
 * kararlı bir işaretleyici kullanıyoruz: data-list-item-id="settings-sidebar___account_panel"
 * (test/otomasyon amaçlı, insan tarafından verilmiş bir kimlik gibi görünüyor, build hash'i
 * değil). Yeni öğeyi bu gerçek öğenin (ve tüm <li> kapsayıcısının) TAM bir klonu olarak
 * oluşturuyoruz -- böylece Discord'un o AN kullandığı hangi hash/stil olursa olsun otomatik
 * eşleşiyor, kendi tarafımızda hiçbir class adı tahmin etmemize gerek kalmıyor.
 *
 * DOM işlemleri (izole preload dünyasından) doğrudan çalışıyor çünkü DOM düğümleri süreç
 * genelinde paylaşılıyor -- bu yüzden webFrame.executeJavaScript'e hiç gerek yok, ve
 * ipcRenderer.send('window:open-settings') doğrudan buradan (titlebar.js'in kendi ayarlar
 * butonuyla AYNI kanal) çağrılabiliyor.
 */
(function setupSettingsShortcut() {
  const ACCOUNT_ITEM_SELECTOR = '[data-list-item-id="settings-sidebar___account_panel"]';
  const INSERTED_ID = '__splitcordSettingsShortcut';

  function tryInsert() {
    if (document.getElementById(INSERTED_ID)) return;
    const accountItem = document.querySelector(ACCOUNT_ITEM_SELECTOR);
    if (!accountItem) return;
    const li = accountItem.closest('li') || accountItem.parentElement;
    const list = li?.parentElement;
    if (!list) return;

    const clonedLi = li.cloneNode(true);
    clonedLi.id = INSERTED_ID;

    // Klonlanan <li>, "Hesap" öğesinin alt navigasyon kapsayıcısını (varsa) da kopyalar --
    // bizim öğemizin böyle bir alt menüsü olmamalı.
    clonedLi.querySelectorAll('[class*="subnavContainer"]').forEach((el) => el.remove());

    const clonedItem = clonedLi.querySelector(ACCOUNT_ITEM_SELECTOR) || clonedLi.firstElementChild;
    if (clonedItem) {
      clonedItem.removeAttribute('data-list-item-id');
      clonedItem.removeAttribute('aria-current');
      Array.from(clonedItem.classList || []).forEach((cls) => {
        if (/^active/i.test(cls)) clonedItem.classList.remove(cls);
      });

      const textEl = clonedItem.querySelector('[data-text-variant]');
      if (textEl) textEl.textContent = 'SplitCord-Turkey Ayarları';

      // KULLANICI TALEBİ: "Hesap" öğesinden miras kalan kişi ikonu yerine Discord'un
      // KENDİ dişli/ayarlar ikonunu kullan -- sol alttaki kullanıcı panelindeki
      // "Kullanıcı Ayarları" butonunun İÇİNDEKİ <svg>'nin İÇERİĞİNİ (defs/path) alıp
      // klonun KENDİ <svg> kapsayıcısına yazıyoruz. Kapsayıcıyı (class'ları, viewBox'ı
      // OLDUĞU GİBİ) DEĞİL sadece iç çizimi değiştiriyoruz ki kenar çubuğunun diğer
      // ikonlarıyla AYNI boyutlandırma/hizalama korunsun.
      const gearIconSvg = document.querySelector('[aria-label="Kullanıcı Ayarları"] svg');
      const ourIconSvg = clonedItem.querySelector('svg');
      if (gearIconSvg && ourIconSvg) {
        ourIconSvg.innerHTML = gearIconSvg.innerHTML;
      }

      // Discord'un kendi tıklama/yönlendirme mantığına HİÇ ulaşmasın diye capture
      // aşamasında yakalayıp durduruyoruz (klon zaten React'in event delegation ağacının
      // parçası DEĞİL, ama yine de garanti olsun).
      clonedItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        try {
          ipcRenderer.send('window:open-settings');
        } catch (err) {
          console.error('[SplitCord] Ayarlar penceresi açılamadı:', err);
        }
      }, true);
    }

    list.insertBefore(clonedLi, list.firstChild);
  }

  tryInsert();
  const observer = new MutationObserver(tryInsert);
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
      tryInsert();
    }, { once: true });
  }
})();
