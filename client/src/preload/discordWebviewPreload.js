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

  // --- Ekran paylaşımı kalite yaması ---
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) : null;
  if (originalGetDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = async function patchedGetDisplayMedia(constraints) {
      const stream = await originalGetDisplayMedia(constraints);
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

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  if (originalGetUserMedia) {
    navigator.mediaDevices.getUserMedia = async function patchedGetUserMedia(constraints) {
      const stream = await originalGetUserMedia(constraints);
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
})();
`;

function injectMainWorldScript() {
  webFrame.executeJavaScript(MAIN_WORLD_SCRIPT).catch((err) => {
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
 * titlebar.js — AYNI "mod zorla Otomatik + zapret2'den başlat" deseni, öncesine bir de
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
      await ipcRenderer.invoke('dpi:activate-engine', 'zapret2');
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
    container.appendChild(btn);
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
