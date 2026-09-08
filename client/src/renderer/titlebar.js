'use strict';

// Ana süreçteki dialog.showMessageBoxSync yerine geçen temaya uygun modal köprüsü —
// bkz. client/src/main/themedDialog.js ve renderer/modal.js. settings.js'teki AYNI desen;
// burada da gerekiyor çünkü discordWebviewPreload.js'in enjekte ettiği butonlar (webview
// KENDİ ayrı bir renderer olduğu için window.showConfirmModal'a hiç erişemiyor) onay
// kutusunu showThemedConfirm ile BU pencereyi hedefleyerek istiyor.
window.splitcord.onShowConfirmModal(async ({ id, ...options }) => {
  const choice = await window.showConfirmModal(options);
  window.splitcord.sendConfirmModalResult(id, choice);
});

document.getElementById('btn-minimize')?.addEventListener('click', () => window.splitcord.window.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.splitcord.window.toggleMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.splitcord.window.close());
document.getElementById('btn-settings')?.addEventListener('click', () => window.splitcord.window.openSettings());
document.getElementById('btn-refresh')?.addEventListener('click', async () => {
  // Ses kanalında/aramada DEĞİLSEN kesilecek bir bağlantı yok — onay yalnızca
  // gerçekten bir riski varsa (bağlıyken) gösteriliyor.
  let inCall = false;
  try {
    const state = await window.splitcord.voice.getState();
    inCall = !!state?.connected;
  } catch (err) {
    window.splitcord.log?.('get-voice-state-error', { error: err.message });
  }

  if (inCall) {
    const choice = await window.showConfirmModal({
      title: 'Sayfa yenilensin mi?',
      message: 'Discord sayfası yeniden yüklenecek.',
      detail: 'Bir sesli/görüntülü kanaldaysanız bağlantınız kesilebilir.',
    });
    if (choice !== 0) return;
  }
  refreshConnection();
});

const webview = document.getElementById('discord-webview');
const statusOverlay = document.getElementById('discord-status-overlay');
const statusText = document.getElementById('discord-status-text');

// Ekran paylaşımı kalite/FPS enjeksiyonu için webview'e kendi preload'unu ata — src
// atanmadan/navigasyon başlamadan önce olmalı ki ilk yüklemede de devrede olsun.
if (webview && window.splitcord?.paths?.discordWebviewPreload) {
  webview.setAttribute('preload', window.splitcord.paths.discordWebviewPreload);
}

let retryInFlight = false;
let refreshInFlight = false;

// Fresh install'da (veya servis daha yeni başladıysa) uygulama açılışında BURADAKİ ilk
// refreshConnection() çağrısı, ana süreçteki startConfiguredEngine()'in POST /activate
// isteğini servise ULAŞTIRMASINDAN ÖNCE çalışabiliyor (ikisi bağımsız, senkronize
// edilmemiş iki async akış — bkz. index.js/dpiLifecycle.js). O anki, HENÜZ HİÇ deneme
// yapılmamış anlık görüntüde Zapret2Engine.GetStatus() running=false + detail="Durduruldu"
// döndürüyor (bkz. Zapret2Engine.cs GetStatus) -- bu, GERÇEKTEN durmuş/tükenmiş bir
// taramayla AYNI görünüyor, ama aslında yalnızca "henüz başlamadı" demek; gerçek POST
// servise ulaşıp _switching=true olduğunda birkaç yüz milisaniye içinde çözülüyor (canlı
// testte doğrulandı). Açılıştan sonraki ilk birkaç kontrolde bu belirsiz durumu terminal
// saymayıp kısa aralıklarla sessizce tekrar deniyoruz; grace tükenirse (gerçekten durmuş
// olabilir ihtimaline karşı) normal terminal UI'a düşülüyor.
let startupGraceChecksRemaining = 8;
const STARTUP_GRACE_RETRY_MS = 750;

// Teşhis amaçlı: Discord webview'inin kendi DevTools'unu (Network sekmesi dahil) F12 ile
// aç/kapat. Varsayılan olarak <webview> için bir bağlam menüsü/kısayolu yok, bu yüzden
// elle ekliyoruz.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'F12' || !webview) return;
  if (webview.isDevToolsOpened?.()) webview.closeDevTools();
  else webview.openDevTools();
});

// --- "+" ile harici bir Discord bağlantısı açma ---
// Discord.gg/discord.com URL'i doğrulanıp AYNI webview'e (partition="persist:discord")
// yükleniyor — yani giriş yapılmış Discord hesabının çerezleriyle/oturumuyla açılıyor,
// ayrı/oturumsuz bir pencere DEĞİL.
const DISCORD_LINK_PATTERN = /^https?:\/\/([a-z0-9-]+\.)*discord\.(gg|com)(\/.*)?$/i;
// Düz bir davet kodu (harf/rakam/tire) — URL değil, şema/nokta/eğik çizgi içermiyor.
// Bu haliyle girilirse https://discord.gg/<kod> olarak tamamlanıyor.
const INVITE_CODE_PATTERN = /^[a-z0-9-]+$/i;

const btnOpenLink = document.getElementById('btn-open-link');
const linkOpenerPopover = document.getElementById('link-opener-popover');
const linkOpenerInput = document.getElementById('link-opener-input');
const linkOpenerError = document.getElementById('link-opener-error');
const btnLinkOpenerOpen = document.getElementById('btn-link-opener-open');
const btnLinkOpenerCancel = document.getElementById('btn-link-opener-cancel');

function showLinkOpenerPopover() {
  linkOpenerPopover.hidden = false;
  linkOpenerError.hidden = true;
  linkOpenerInput.value = '';
  linkOpenerInput.focus();
}

function hideLinkOpenerPopover() {
  linkOpenerPopover.hidden = true;
}

btnOpenLink?.addEventListener('click', () => {
  if (linkOpenerPopover.hidden) showLinkOpenerPopover();
  else hideLinkOpenerPopover();
});

btnLinkOpenerCancel?.addEventListener('click', hideLinkOpenerPopover);

async function submitLinkOpener() {
  const input = linkOpenerInput.value.trim();
  if (!input) return;

  let raw;
  if (INVITE_CODE_PATTERN.test(input)) {
    // Sembolsüz düz bir davet kodu — doğrudan discord.gg bağlantısına tamamla.
    raw = `https://discord.gg/${input}`;
  } else {
    raw = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    if (!DISCORD_LINK_PATTERN.test(raw)) {
      linkOpenerError.textContent = 'Davet Bağlantısı/Kodu geçersiz.';
      linkOpenerError.hidden = false;
      window.splitcord.log?.('link-opener-invalid', { input });
      return;
    }
  }

  let openInNewWindow = true;
  try {
    openInNewWindow = await window.splitcord.app.getLinkOpenerNewWindow();
  } catch (err) {
    window.splitcord.log?.('get-link-opener-new-window-error', { error: err.message });
  }

  // Yeni pencere kapalıyken bağlantı ana penceredeki webview'in (dolayısıyla o an
  // varsa sesli/görüntülü kanal bağlantısının) yerine geçiyor — bu yüzden geri
  // alınamaz bu değişiklikten önce onay isteniyor. Yeni pencerede açılırken ana
  // pencere/webview hiç etkilenmediği için onaya gerek yok. Ses kanalında/aramada
  // DEĞİLSEN de kesilecek bir bağlantı olmadığı için onay atlanıyor.
  if (!openInNewWindow) {
    let inCall = false;
    try {
      const state = await window.splitcord.voice.getState();
      inCall = !!state?.connected;
    } catch (err) {
      window.splitcord.log?.('get-voice-state-error', { error: err.message });
    }

    if (inCall) {
      const choice = await window.showConfirmModal({
        title: 'Bağlantı açılsın mı?',
        message: 'Ses bağlantınız geçici olarak kesilebilir.',
        detail: 'Bu bağlantı ana penceredeki mevcut görünümün yerine geçecek.',
      });
      if (choice !== 0) {
        window.splitcord.log?.('link-opener-open-cancelled', { url: raw });
        return;
      }
    }
  }

  window.splitcord.log?.('link-opener-open', { url: raw });
  hideLinkOpenerPopover();

  if (openInNewWindow) {
    window.splitcord.window.openDiscordLink(raw);
  } else if (webview) {
    webview.src = raw;
  }
}

btnLinkOpenerOpen?.addEventListener('click', submitLinkOpener);
linkOpenerInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitLinkOpener();
  else if (event.key === 'Escape') hideLinkOpenerPopover();
});

document.addEventListener('click', (event) => {
  if (!linkOpenerPopover.hidden && !event.target.closest('.sc-link-opener')) {
    hideLinkOpenerPopover();
  }
});

// getStatus() teorik olarak IPC/servis tarafında bir yerde askıda kalırsa (ör. daha
// önce gözlemlenen, log bırakmadan takılı kalan "Bağlantı hazırlanıyor…" durumu),
// refreshConnection'ın sonsuza kadar beklememesi için ek bir güvenlik zaman aşımı.
const STATUS_TIMEOUT_MS = 8000;

function timeout(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

const statusLogBackdrop = document.getElementById('discord-status-log-backdrop');
const btnStatusToggleLog = document.getElementById('btn-status-toggle-log');
const statusActions = document.getElementById('discord-status-actions');

btnStatusToggleLog?.addEventListener('click', () => {
  if (!statusOverlay) return;
  const nowVisible = !statusOverlay.hasAttribute('data-log-visible');
  if (nowVisible) statusOverlay.setAttribute('data-log-visible', '');
  else statusOverlay.removeAttribute('data-log-visible');
  window.splitcord.log?.('status-log-toggle', { visible: nowVisible });
});
const btnStatusRetryAuto = document.getElementById('btn-status-retry-auto');
const btnStatusManualSetup = document.getElementById('btn-status-manual-setup');
const btnStatusOpenPermissions = document.getElementById('btn-status-open-permissions');
const btnStatusDisableQuic = document.getElementById('btn-status-disable-quic');
const btnStatusAddDefenderException = document.getElementById('btn-status-add-defender-exception');
const btnStatusRejectUnstableArgs = document.getElementById('btn-status-reject-unstable-args');
const btnStatusRetryManual = document.getElementById('btn-status-retry-manual');

// isError=false (varsayılan): bir şey hâlâ deneniyor demektir, spinner döner.
// isError=true: kesin/geçici olarak duraklamış bir durum (kullanıcı elle Yenile'ye
// basmadıkça otomatik değişmeyecek) — spinnerın dönmesi yanıltıcı olurdu.
function showStatus(message, isError = false) {
  if (!statusOverlay) return;
  statusText.textContent = message;
  if (isError) statusOverlay.setAttribute('data-error', '');
  else statusOverlay.removeAttribute('data-error');
  if (isError) clearStatusScanLog();
  if (statusActions) statusActions.hidden = true;
  [
    btnStatusRetryAuto,
    btnStatusManualSetup,
    btnStatusOpenPermissions,
    btnStatusDisableQuic,
    btnStatusAddDefenderException,
    btnStatusRejectUnstableArgs,
    btnStatusRetryManual,
  ].forEach((btn) => {
    if (btn) btn.hidden = true;
  });
  statusOverlay.hidden = false;
}

function hideStatus() {
  if (statusOverlay) statusOverlay.hidden = true;
  clearStatusScanLog();
}

// CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-07, Linux istemcisinde bulunup buraya da uygulandı):
// hem did-finish-load'daki "gerçekten Discord'a mı ulaşıldı" kontrolü hem de did-fail-load'ın
// "sayfa zaten kendiliğinden toparlandı mı" kontrolü webview.getURL()'e güveniyordu -- ama bir
// yükleme bir hatayla Chromium'un kendi dahili hata sayfasına (chrome-error://chromewebdata/)
// düşünce, getURL() GERÇEKTE gösterilen chrome-error:// adresini DEĞİL, DENENEN hedefi (ör.
// "https://discord.com/login") döndürmeye devam ediyordu -- bu iki kontrol yanlış pozitif
// üretip siyah/boş hata sayfasını "gerçek Discord yüklendi" sanıyordu. Bu, önceden 2sn'de bir
// koşulsuz tekrar deneme (flaşlanan yükleniyor ekranı) sayesinde çoğunlukla kendiliğinden
// düzeliyordu; gereksiz tekrarları önleyen düzeltme bu güvenlik ağını kaldırınca kullanıcı
// KALICI olarak siyah hata sayfasında takılı kalabiliyordu. Düzeltme: webview.getURL() yerine
// sayfanın KENDİ location.href'ini (executeJavaScript ile) okuyoruz -- hata sayfalarında bile
// script çalıştırma çalışıyor.
async function getWebviewRealUrl() {
  try {
    const href = await webview?.executeJavaScript?.('location.href');
    if (typeof href === 'string' && href) return href;
  } catch (err) {
    window.splitcord.log?.('get-webview-real-url-error', { error: err.message });
  }
  return webview?.getURL?.() ?? '';
}

// Otomatik tarama sürerken (status.switching) arka planda hangi hizmetin/ayarın o an
// denendiğini gösteren bulanık günlük akışı — bkz. index.html'deki #discord-status-log-backdrop.
function clearStatusScanLog() {
  if (!statusOverlay) return;
  statusOverlay.removeAttribute('data-scanning');
  statusOverlay.removeAttribute('data-log-visible');
  if (statusLogBackdrop) statusLogBackdrop.textContent = '';
}

// Zapret2'nin DoH→DNSCrypt→DoT→DoQ→DNS'siz dış döngüsündeki tier sayısı (bkz.
// DnsProtocolTiers.Order) -- tahmini üst sınır süresini hesaplamak için kullanılıyor.
const ZAPRET2_DNS_TIER_COUNT = 5;

// "Bağlantı hazırlanıyor…"un yanında Zapret2 için gösterilecek tahmini üst sınır (dakika):
// Ayarlar > DPI Aşımı > Gelişmiş'teki slider'dan (Otomatik/Manuel modun kendi değeri) × 5
// DNS protokolü/tier'i (kullanıcı talebi). Gerçek süre çoğunlukla çok daha kısa olur (ilk
// çalışan ayar bulunur bulunmaz durulur) -- bu yalnızca "en kötü senaryo" üst sınırı.
async function getZapret2EstimatedMaxMinutes() {
  try {
    const [tierTimeout, mode] = await Promise.all([
      window.splitcord.dpi.getZapret2TierTimeout(),
      window.splitcord.dpi.getMode(),
    ]);
    const perTierMinutes = mode === 'manual' ? tierTimeout.manualMinutes : tierTimeout.automaticMinutes;
    return perTierMinutes * ZAPRET2_DNS_TIER_COUNT;
  } catch (err) {
    window.splitcord.log?.('zapret2-estimate-max-minutes-error', { error: err.message });
    return null;
  }
}

async function updateStatusScanLog(engineId, engines) {
  if (!statusOverlay || !statusLogBackdrop || !engineId) return;
  statusOverlay.setAttribute('data-scanning', '');

  const engine = engines?.find((e) => e.id === engineId);
  const label = engine?.displayName ?? engineId;

  // Zapret2 için ana durum metnini de aşamaya göre güncelliyoruz -- kullanıcı talebi:
  // (a) kayıtlı ayar art arda yeniden deneniyorsa (bkz. Zapret2Engine.GetStatus() "Kayıtlı
  // ayar deneniyor (N/M)" detail'i) bu GERÇEKTEN görünsün, motor her deneme arasında kısa
  // süreliğine durduğu için yanlışlıkla "Durduruldu" sanılmasın; (b) genel "hazırlanıyor"
  // aşamasında ise tahmini üst sınır süresi de eklensin.
  if (engineId === 'zapret2' && engine?.detail?.startsWith('Kayıtlı ayar deneniyor')) {
    showStatus(`Discord'a erişilemiyor.\n${engine.detail}`);
  } else if (engineId === 'zapret2') {
    const estimateMinutes = await getZapret2EstimatedMaxMinutes();
    showStatus(
      estimateMinutes
        ? `Bağlantı hazırlanıyor… (Zapret2 en fazla ~${estimateMinutes} dk sürebilir)`
        : 'Bağlantı hazırlanıyor…',
    );
  }

  try {
    const logs = await window.splitcord.dpi.getLogs(engineId);
    const recent = logs.slice(-12);
    statusLogBackdrop.textContent = recent.length
      ? `${label} deneniyor…\n${recent.join('\n')}`
      : `${label} deneniyor…`;
  } catch {
    // Günlük akışı yalnızca kozmetik bir arka plan efekti — alınamazsa sessizce geç.
  }
}

// Otomatik tarama tükendiğinde (denenen hiçbir motor/strateji Discord'a erişemediğinde)
// ya da Kaspersky/ESET tespit edildiği için Zapret/GoodbyeDPI hiç denenemediğinde — kullanıcıya
// ne yapabileceğine dair eylem butonları da gösteriyor. Bunlar kullanıcı müdahalesi
// olmadan kendiliğinden değişmeyecek kesin durumlar (isError=true, spinner durur).
function showStatusWithActions(message, buttonsToShow) {
  showStatus(message, true);
  if (statusActions) statusActions.hidden = false;
  buttonsToShow.forEach((btn) => {
    if (btn) btn.hidden = false;
  });
}

btnStatusOpenPermissions?.addEventListener('click', () => {
  window.splitcord.log?.('status-open-permissions-click', {});
  window.splitcord.window.openSettings('panel-permissions');
});

// did-fail-load'ın vazgeçme dalının (aşağıda) gösterdiği "Argüman Setini Yasakla" düğmesi
// hangi motoru hedefleyecek -- düğme tıklanana kadar bu değer korunuyor (bir sonraki
// refreshConnection/did-fail-load turunda showStatus() zaten düğmeyi gizleyip bu bilgiyi
// geçersiz kılıyor, bu yüzden ekstra bir temizliğe gerek yok).
let rejectBannerEngineId = null;

// KULLANICI TALEBİ (canlı kullanıcıda gözlemlendi: Zapret2'nin kayıtlı ayarı bir saniyeliğine
// Discord'u yükleyip sonra ERR_CONNECTION_RESET ile döngüye giriyordu): bu, ipc.js'teki
// dpi:reject-current-args handler'ının ZATEN mod-farkında olan (bkz. oradaki not) genel
// "Argüman Setini Yasakla" mekanizmasını kullanıyor -- Otomatik'te motor tükenirse zincirdeki
// bir sonrakine geçilir, Manuel'de yalnızca SEÇİLİ/aktif motor için yeniden aranır.
btnStatusRejectUnstableArgs?.addEventListener('click', async () => {
  if (!rejectBannerEngineId) return;
  window.splitcord.log?.('status-reject-unstable-args-click', { id: rejectBannerEngineId });
  btnStatusRejectUnstableArgs.disabled = true;
  btnStatusRejectUnstableArgs.textContent = 'Yeni ayar aranıyor…';
  try {
    await window.splitcord.dpi.rejectCurrentArgs(rejectBannerEngineId);
  } catch (err) {
    window.splitcord.log?.('status-reject-unstable-args-error', { id: rejectBannerEngineId, error: err.message });
  }
  btnStatusRejectUnstableArgs.disabled = false;
  btnStatusRejectUnstableArgs.textContent = 'Argüman Setini Yasakla';
  rejectBannerEngineId = null;
  await refreshConnection();
});

// KULLANICI TALEBİ: ENGINE_MAX_AUTO_RETRIES tükenip "vazgeçildi" ekranı geldiğinde, kullanıcının
// argüman setini yasaklamadan/mod değiştirmeden AYNI ayarla tam bir yeni denemelik döngüyü daha
// başlatabilmesi için — özellikle önyükleme sonrası ağın geç oturması gibi geçici durumlarda
// (bkz. ENGINE_MAX_AUTO_RETRIES üstündeki not) kullanıcının yalnızca birkaç saniye daha
// beklemesi yeterli olabiliyor.
btnStatusRetryManual?.addEventListener('click', async () => {
  window.splitcord.log?.('status-retry-manual-click', {});
  btnStatusRetryManual.disabled = true;
  engineFailCount = 0;
  await refreshConnection();
  btnStatusRetryManual.disabled = false;
});

// "DPI servisine ulaşılamıyor" (ECONNREFUSED) durumunun bilinen bir nedeni: Windows
// Defender'ın servis .dll'ini yanlış-pozitif işaretleyip karantinaya alması (bkz.
// defenderExclusion.js'teki ayrıntılı not). Bu, yalnızca o durumda gösterilen, kullanıcının
// açıkça tetiklediği bir kurtarma eylemi -- bir UAC istemi tetikler.
btnStatusAddDefenderException?.addEventListener('click', async () => {
  window.splitcord.log?.('status-add-defender-exception-click', {});
  const originalLabel = btnStatusAddDefenderException.textContent;
  btnStatusAddDefenderException.disabled = true;
  btnStatusAddDefenderException.textContent = 'Yönetici izni bekleniyor…';
  try {
    const result = await window.splitcord.app.addDefenderException();
    if (result.ok && result.dllMissing) {
      // İstisna eklemek, Defender'ın DAHA ÖNCE sildiği dosyayı geri getirmez -- yalnızca
      // BUNDAN SONRA aynısının tekrarlanmasını önler. Dosya hâlâ eksikse kurulum onarımı
      // (installer'ı tekrar çalıştırmak) gerekiyor.
      await window.showAlertModal({
        title: 'İstisna eklendi, ama bir adım daha gerekiyor',
        message: 'Windows Defender istisnası eklendi, ancak servis dosyası daha önce silinmiş görünüyor.',
        detail: 'SplitCord-Turkey kurulum dosyasını (indirdiğin .exe) tekrar çalıştır — istisna artık devrede olduğu için dosya bu sefer silinmeden geri yüklenecek.',
      });
    } else if (result.ok) {
      await window.showAlertModal({
        title: 'İstisna eklendi',
        message: 'Windows Defender istisnası eklendi. Yeniden deneniyor…',
      });
    } else if (result.blocked) {
      await window.showAlertModal({
        title: 'İstisna eklenemedi',
        message: result.message,
        detail: 'Windows Güvenliği > Virüs ve tehdit koruması > Ayarları yönet altından "Kurcalamaya Karşı Koruma"yı geçici olarak kapatıp tekrar deneyebilir, ya da istisnayı doğrudan aynı ekrandaki "Dışlamalar" bölümünden elle ekleyebilirsin.',
      });
    } else {
      await window.showAlertModal({
        title: 'İstisna eklenemedi',
        message: result.message || 'Bilinmeyen bir hata oluştu.',
      });
    }
  } catch (err) {
    window.splitcord.log?.('status-add-defender-exception-error', { error: err.message });
    await window.showAlertModal({ title: 'İstisna eklenemedi', message: err.message });
  } finally {
    btnStatusAddDefenderException.disabled = false;
    btnStatusAddDefenderException.textContent = originalLabel;
    refreshConnection();
  }
});

// ipc.js'teki app:set-quic-disabled handler'ı KENDİ onay diyaloğunu (yeniden başlatma
// gerektiği için) zaten gösteriyor -- burada AYRICA window.showConfirmModal ile önceden
// sormuyoruz, aksi halde kullanıcı üst üste iki onay ekranı görürdü. Ayarlar > Genel'deki
// toggle da AYNI handler'ı çağırıyor, tek doğruluk kaynağı bu (bkz. ipc.js notu).
btnStatusDisableQuic?.addEventListener('click', async () => {
  window.splitcord.log?.('status-disable-quic-click', {});
  btnStatusDisableQuic.disabled = true;
  try {
    await window.splitcord.app.setQuicDisabled(true);
  } catch (err) {
    window.splitcord.log?.('status-disable-quic-error', { error: err.message });
  } finally {
    btnStatusDisableQuic.disabled = false;
  }
});

btnStatusManualSetup?.addEventListener('click', async () => {
  window.splitcord.log?.('status-manual-setup-click', {});
  try {
    const mode = await window.splitcord.dpi.getMode();
    if (mode === 'automatic') await window.splitcord.dpi.setMode('manual');
  } catch (err) {
    window.splitcord.log?.('status-manual-setup-error', { error: err.message });
  }
  window.splitcord.window.openSettings('panel-dpi');
});

btnStatusRetryAuto?.addEventListener('click', async () => {
  const choice = await window.showConfirmModal({
    title: 'Otomatik arama başlatılsın mı?',
    message: 'Zapret2, Zapret, ByeDPI ve GoodbyeDPI ayarları en baştan sırayla denenecek.',
    detail: 'Bu işlem birkaç dakika sürebilir; süre boyunca "Bağlantı hazırlanıyor…" gösterilecek.',
  });
  if (choice !== 0) return;

  window.splitcord.log?.('status-retry-auto-click', {});
  btnStatusRetryAuto.disabled = true;
  try {
    const mode = await window.splitcord.dpi.getMode();
    if (mode === 'manual') await window.splitcord.dpi.setMode('automatic');
  } catch (err) {
    window.splitcord.log?.('status-retry-auto-mode-error', { error: err.message });
  }

  // activateEngine() taramanın TAMAMI (birkaç dakikaya kadar) bitene kadar çözülmüyor —
  // bunu burada beklemek yerine arkaplanda başlatıp refreshConnection()'ın kendi
  // switching-farkında yoklama döngüsüne (3 sn'de bir) ilerlemeyi göstermesine bırakıyoruz.
  showStatus('Bağlantı hazırlanıyor…');
  // Otomatik modun giriş noktası artık Zapret (bkz. DpiEngineManager.SwitchToAsync).
  window.splitcord.dpi.activateEngine('zapret').catch((err) => {
    window.splitcord.log?.('status-retry-auto-activate-error', { error: err.message });
  });
  btnStatusRetryAuto.disabled = false;
  refreshConnection();
});

// Bir tarama SONUÇLANDIĞINDA (çalışan bir ayar bulundu YA DA tüm denemeler tükendi) ve
// Kaspersky/ESET tespit edildiyse, kullanıcı Kontroller ekranını hiç açmasa da onu
// proaktif olarak bilgilendiriyoruz (bkz. antivirusInfo.js). Kullanıcı talebi: bu dialog
// 15 dakika içinde EN FAZLA BİR KEZ gösterilsin — eskiden yalnızca "bu tarama başına bir
// kez" (yeni bir tarama başladığında sıfırlanan bir bayrak) idi, ama Otomatik moddaki bir
// motor arka arkaya birden çok kez yeniden tarayabildiği için (ör. uygulama sık sık
// yeniden başlatıldığında) bu, kullanıcıyı kısa aralıklarla aynı dialog'la boğabiliyordu.
// localStorage kullanıyoruz ki bu süre uygulama kapatılıp açılsa bile korunsun (renderer
// belleği her yeniden başlatmada sıfırlanır, localStorage sıfırlanmaz).
const ANTIVIRUS_DIALOG_LAST_SHOWN_KEY = 'splitcord-antivirus-dialog-last-shown-at';
const ANTIVIRUS_DIALOG_THROTTLE_MS = 15 * 60 * 1000;

function canShowAntivirusDialog() {
  try {
    const lastShownAt = Number(localStorage.getItem(ANTIVIRUS_DIALOG_LAST_SHOWN_KEY) || 0);
    return Date.now() - lastShownAt >= ANTIVIRUS_DIALOG_THROTTLE_MS;
  } catch {
    // localStorage erişilemezse (ör. gizli/kısıtlı depolama) güvenli varsayılan: göster.
    return true;
  }
}

function markAntivirusDialogShown() {
  try {
    localStorage.setItem(ANTIVIRUS_DIALOG_LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    // Yazılamazsa bir sonraki kontrolde tekrar denenir; kritik değil.
  }
}

async function maybeShowAntivirusDialog(scanConcluded) {
  if (!scanConcluded || !canShowAntivirusDialog()) return;
  try {
    const systemControls = await window.splitcord.dpi.getSystemControlsStatus();
    if (systemControls?.kasperskyDetected || systemControls?.esetDetected) {
      const kind = systemControls.kasperskyDetected ? 'kaspersky' : 'eset';
      window.splitcord.log?.('antivirus-dialog-shown', { kind });
      markAntivirusDialogShown();
      window.showAntivirusDetectedModal(kind);
    }
  } catch (err) {
    window.splitcord.log?.('get-system-controls-status-error', { error: err.message });
  }
}

// DPI durumunu sorgular; motor gerçekten çalışıyorsa Discord'u (yeniden) yükler,
// çalışmıyorsa Discord'un olması gereken yerde nedenini gösterir.
async function refreshConnection() {
  if (refreshInFlight) {
    window.splitcord.log?.('refresh-skipped-already-running', {});
    return;
  }
  refreshInFlight = true;
  window.splitcord.log?.('refresh-start', {});
  showStatus('Bağlantı hazırlanıyor…');

  try {
    let status;
    try {
      status = await Promise.race([
        window.splitcord.dpi.getStatus(),
        timeout(STATUS_TIMEOUT_MS, 'getStatus zaman aşımına uğradı (renderer tarafı güvenlik zaman aşımı)'),
      ]);
    } catch (err) {
      window.splitcord.log?.('refresh-get-status-failed', { error: err.message });
      const message = `DPI servisine ulaşılamıyor.\n${err.message}`;
      // ECONNREFUSED: servis hiç ayakta değil. Bunun bilinen bir nedeni Windows Defender'ın
      // servis .dll'ini yanlış-pozitif işaretleyip karantinaya alması (bkz.
      // defenderExclusion.js) -- yalnızca bu spesifik durumda kurtarma düğmesini
      // gösteriyoruz, ör. zaman aşımı gibi alakasız hatalarda değil.
      if (/ECONNREFUSED/.test(err.message) && btnStatusAddDefenderException) {
        showStatusWithActions(message, [btnStatusAddDefenderException]);
      } else {
        showStatus(message, true);
      }
      return;
    }

    // Servis o an bir motor/strateji arıyorsa (ör. ByeDPI'nin tüm adayları başarısız olup
    // GoodbyeDPI'nin kendi aday listesine otomatik geçilirken) o anki adayın "running=false"
    // görünmesi GEÇİCİ ve NORMAL — bunu hata sayıp spinner'ı durdurmuyoruz, "Bağlantı
    // hazırlanıyor…" göstermeye devam edip birkaç saniye sonra sessizce tekrar deniyoruz.
    if (status.switching) {
      window.splitcord.log?.('connection-status-switching', { activeEngineId: status.activeEngineId });
      updateStatusScanLog(status.switchingToEngineId || status.activeEngineId, status.engines);
      setTimeout(refreshConnection, 3000);
      return;
    }

    const active = status.engines?.find((e) => e.id === status.activeEngineId);
    window.splitcord.log?.('connection-status', { activeEngineId: status.activeEngineId, active });

    // Tarama sonuçlandı mı: ya çalışan bir ayar bulundu, ya da (autoScanResult 'antivirus'
    // ise Zapret/GoodbyeDPI atlanıp ByeDPI de denenmiş VE başarısız olmuş demektir, ya da
    // 'exhausted' ise tüm motorlar tükenmiştir) — ikisi de terminal bir durumdur.
    maybeShowAntivirusDialog(!!active?.running || status.autoScanResult === 'antivirus' || status.autoScanResult === 'exhausted');

    if (active?.running) {
      // ÖNEMLİ: burada hideStatus() ÇAĞIRMIYORUZ — "motor çalışıyor" sunucu tarafında
      // yalnızca process ayakta demek, GERÇEKTEN Discord sayfasının yüklendiği anlamına
      // gelmiyor. Önceden burada hemen hideStatus() çağrılıyordu, overlay kayboluyor,
      // webview'in kendi boş/gri arkaplanı bir an görünüyordu, sonra sayfa yüklenemezse
      // (bkz. did-fail-load) overlay HEMEN geri geliyordu — istikrarsız bağlantılarda
      // (ör. GoodbyeDPI'nin "fake packet" tekniğinin birkaç denemede oturması gereken
      // durumlar) bu, ekranın sürekli flaşlanmasına yol açıyordu. Artık overlay yalnızca
      // did-finish-load GERÇEKTEN discord.com'a ulaşıldığını doğruladığında kapanıyor —
      // o ana kadar tek, kesintisiz bir "yükleniyor" durumu gösteriliyor.
      showStatus('Discord yükleniyor…');
      if (webview?.src) {
        webview.reload();
      } else if (webview) {
        webview.src = 'https://discord.com/app';
      }
    } else if (status.autoScanResult === 'antivirus') {
      showStatusWithActions(
        'Kaspersky/ESET gibi bir güvenlik yazılımı tespit edildiği için sonraki ayar denemelerine geçilemiyor.',
        [btnStatusOpenPermissions],
      );
    } else if (status.autoScanResult === 'exhausted') {
      showStatusWithActions('Çalışan hiçbir ayar bulunamadı.', [btnStatusRetryAuto, btnStatusManualSetup]);
    } else if (startupGraceChecksRemaining > 0) {
      // Henüz kesin bir sonuç (running/antivirus/exhausted) yok -- açılış sonrası olası
      // startConfiguredEngine() yarışını (yukarıdaki not) atlatmak için terminal UI'ı
      // göstermeden kısa bir süre sessizce tekrar deniyoruz.
      startupGraceChecksRemaining -= 1;
      window.splitcord.log?.('connection-status-startup-grace-retry', { remaining: startupGraceChecksRemaining });
      setTimeout(refreshConnection, STARTUP_GRACE_RETRY_MS);
      return;
    } else {
      // Kullanıcı talebi: bu "Durduruldu" tipi kesin/duraklamış durumun altında HER ZAMAN
      // "Otomatik Arama Başlat" butonu bulunsun — kullanıcı Manuel moddaysa bile tek
      // tıkla Otomatik moda geçip taramayı sıfırdan başlatabilsin (bkz. aşağıdaki
      // btnStatusRetryAuto click handler'ı — zaten hem mod geçişini hem sıfırdan
      // taramayı yapıyor).
      showStatusWithActions(`Discord'a erişilemiyor.\n${active?.detail ?? 'DPI motoru çalışmıyor.'}`, [btnStatusRetryAuto]);
    }
  } finally {
    refreshInFlight = false;
  }
}

// did-fail-load anında yeniden denemek (refreshConnection -> webview.reload()) BAZEN
// başka bir did-fail-load'ı tetikleyebiliyor — gecikmesiz/sınırsız tekrar bu döngüyü
// tetikleyip "Bağlantı hazırlanıyor…" yazısının sürekli flaşlanmasına yol açıyordu. Bu
// yüzden denemeler arasına gerçek bir bekleme koyuyoruz ve bir noktadan sonra (sürekli
// tekrar başarısız oluyorsa) doğrulamayı sıfırlayıp yeniden aday taramasını tetikliyoruz —
// kullanıcı elle "Yenile"ye basana kadar sessizce dönüp durmuyoruz.
// Canlı testte gözlemlendi: GoodbyeDPI'nin fake-packet tekniği bazen 4-5 deneme sonra
// istikrar kazanıyor — eşik çok düşük tutulunca, tam istikrar kazanmak ÜZEREYKEN "kalıcı
// olarak bozuk" sanılıp gereksiz yere yeniden taranıyordu. Eşiği yükseltmek doğal istikrar
// kazanmaya yetecek kadar pay bırakıyor. ÖNEMLİ: bu eşik ve bekleme ByeDPI için de AYNI —
// eskiden ByeDPI herhangi bir did-fail-load'da (tek bir geçici sıfırlanmada bile) hemen
// argümanı reddedip yeniden tarıyordu, diğer motorlara hiç tanınmayan bir sabırsızlıkla;
// artık hepsi aynı şekilde bekliyor. KULLANICI TALEBİ: eşik 5'e düşürülmüştü, GoodbyeDPI'nin
// 4-5 denemede istikrar kazanma riskiyle çelişiyordu — 8'de bırakılmasına karar verildi.
let engineFailCount = 0;
// KULLANICI TALEBİ (2026-09-07, Linux istemcisinde bulunan gerçek bir zamanlama sorununa
// dayanarak, buraya da uygulandı): önyükleme sonrası bazı ağlarda genel bağlantının (muhtemelen
// ISP/yönlendirici tarafındaki bağlantı izleme/DNS tablolarının) tam oturması ~20-25 saniye
// sürebiliyor -- DPI motorunun KENDİSİ genelde 1-2 saniyede hazır oluyor, GECİKME motorda
// değil. Eski eşik (8 deneme x 2sn = 16sn) bu pencereyi kapatmadan pes ediyordu; kullanıcı
// "vazgeçti" ekranını görüp elle Yenile'ye bastığında ağ zaten oturmuş oluyor, bu yüzden hemen
// çalışıyordu. 20'ye çıkarmak (20 x 2sn = 40sn) bu pencereyi rahat karşılıyor.
const ENGINE_MAX_AUTO_RETRIES = 20;
const ENGINE_RETRY_DELAY_MS = 2000;

webview?.addEventListener('did-fail-load', async (event) => {
  window.splitcord.log?.('did-fail-load', {
    url: event.validatedURL,
    isMainFrame: event.isMainFrame,
    errorCode: event.errorCode,
    errorDescription: event.errorDescription,
  });

  // -3 = ERR_ABORTED: genelde reload/navigasyon değişikliği sırasında oluşur, gerçek hata değil.
  if (!event.isMainFrame || event.errorCode === -3) return;

  // ERR_QUIC_PROTOCOL_ERROR (ve QUIC'in diğer hata türleri): hiçbir DPI aşım motoru
  // QUIC/UDP trafiğine dokunmuyor (WinDivert filtreleri yalnızca --wf-tcp-out ile TCP'yi
  // hedefliyor), bu yüzden bunu "motor/strateji artık çalışmıyor" sanıp aşağıdaki normal
  // yeniden tarama akışına sokmak anlamsız -- hiçbir strateji değişikliği bunu düzeltmez.
  // Bunun yerine kullanıcıya doğrudan QUIC'i kapatma seçeneği sunuyoruz (bkz.
  // btnStatusDisableQuic click handler'ı / ipc.js app:set-quic-disabled).
  if (/QUIC/i.test(event.errorDescription || '')) {
    window.splitcord.log?.('did-fail-load-quic-error', { errorDescription: event.errorDescription });
    showStatusWithActions(
      `Discord yüklenemedi (${event.errorDescription}).\nBu, bazı ağlarda QUIC protokolünün düzgün çalışmamasından kaynaklanıyor olabilir.`,
      [btnStatusDisableQuic],
    );
    return;
  }

  if (retryInFlight) return;
  retryInFlight = true;

  try {
    let status;
    try {
      status = await window.splitcord.dpi.getStatus();
    } catch (err) {
      window.splitcord.log?.('did-fail-load-get-status-error', { error: err.message });
    }

    engineFailCount += 1;
    if (engineFailCount > ENGINE_MAX_AUTO_RETRIES) {
      // KULLANICI TALEBİ (canlı kullanıcıda gözlemlendi: Zapret2'nin kayıtlı ayarı bir
      // saniyeliğine Discord'u yükleyip sonra ERR_CONNECTION_RESET ile bu döngüye giriyordu):
      // eskiden burada SESSİZCE reportEngineFailure/reportByeDpiFailure çağrılıp otomatik
      // yeniden tarama tetiklenir, sayfa da yeniden yüklenmeye (webview.reload) devam
      // ederdi. Artık sayfayı BİR DAHA yeniden yüklemiyoruz ve kullanıcıya açıkça soruyoruz:
      // argüman seti stabil değil, yasaklamak ister misin? (bkz. aşağıdaki
      // btnStatusRejectUnstableArgs click handler'ı -- rejectCurrentArgs zaten mod-farkında,
      // Otomatik'te motor tükenirse zincirdeki bir sonrakine geçer, Manuel'de yalnızca
      // SEÇİLİ motor için yeniden arar).
      window.splitcord.log?.('did-fail-load-give-up', { activeEngineId: status?.activeEngineId, count: engineFailCount });
      engineFailCount = 0;
      if (btnStatusRetryManual) btnStatusRetryManual.textContent = `Tekrar Dene (${ENGINE_MAX_AUTO_RETRIES} Kez)`;
      if (status?.activeEngineId && btnStatusRejectUnstableArgs) {
        rejectBannerEngineId = status.activeEngineId;
        showStatusWithActions(
          `${ENGINE_MAX_AUTO_RETRIES} denemenin ardından kayıtlı ayar ile yine Discord'a erişilemedi.\nKullanılan argüman seti ile Discord'a erişim stabil değil. Argüman setini yasaklayarak farklı argüman setleri için kontrol başlatabilirsiniz.`,
          [btnStatusRejectUnstableArgs, btnStatusRetryManual],
        );
      } else {
        showStatusWithActions(
          `Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nYenile'ye tekrar basmayı deneyin.`,
          [btnStatusRetryManual],
        );
      }
    } else {
      showStatus(
        `Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nDPI motorunun başlatılması zaman alabilir. Lütfen biraz bekleyin.\nTekrar deneniyor… (${engineFailCount}/${ENGINE_MAX_AUTO_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, ENGINE_RETRY_DELAY_MS));

      // CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-07, Linux istemcisinde bulunup buraya da
      // uygulandı — bkz. linux/client/src/renderer/titlebar.js'teki AYNI düzeltme): bu bekleme
      // sırasında sayfa KENDİLİĞİNDEN (bu hatanın ait olduğu reload'un kendisi milisaniyeler
      // içinde toparlanıp did-finish-load'u ZATEN tetiklemiş olabilir) başarıyla yüklenmiş
      // olabiliyordu -- aşağıdaki refreshConnection() bunu HİÇ KONTROL ETMEDEN koşulsuz
      // webview.reload() çağırıyordu, bu da ZATEN İYİ ÇALIŞAN sayfayı gereksiz yere yeniden
      // yükleyip AYNI geçici hatayı (ve dolayısıyla AYNI 2sn'lik yeniden deneme döngüsünü)
      // yeniden tetikliyordu — "Discord yükleniyor…" ekranının sürekli flaşlanmasının kök
      // nedeni buydu. Düzeltme: yeniden yüklemeden önce sayfanın zaten gerçekten yüklü/başarılı
      // olup olmadığını kontrol ediyoruz; öyleyse gereksiz reload'u ATLIYORUZ.
      const currentUrl = await getWebviewRealUrl();
      const alreadyLoaded = /^https:\/\/(www\.)?discord\.com\//.test(currentUrl) && webview?.isLoading?.() === false;
      if (alreadyLoaded) {
        window.splitcord.log?.('did-fail-load-already-recovered', { url: currentUrl });
        engineFailCount = 0;
        hideStatus();
        return;
      }

      await refreshConnection();
    }
  } catch (err) {
    window.splitcord.log?.('did-fail-load-recovery-error', { error: err.message });
    showStatus(`Discord'a erişilemiyor.\n${err.message}`, true);
  } finally {
    retryInFlight = false;
  }
});

webview?.addEventListener('did-finish-load', async () => {
  // did-fail-load'dan hemen sonra Chromium kendi dahili hata sayfasına (chrome-error://
  // veya benzeri) düşüp onu BAŞARIYLA yüklüyor — bu da hemen ardından bir did-finish-load
  // tetikliyor. webview.src (ayarladığımız hedef) her zaman aynı kaldığı için önceden bunu
  // "gerçek başarı" sanıp engineFailCount'u sıfırlıyorduk, bu da vazgeçme sınırını hiç
  // devreye girmeden 2 saniyede bir SONSUZA KADAR tekrar denemeye yol açıyordu. Gerçekte
  // hangi URL'in yüklendiğini (bkz. getWebviewRealUrl üstündeki not — webview.getURL()
  // GÜVENİLMEZ, chrome-error:// sayfalarında bile denenen hedefi döndürüyordu) kontrol edip
  // yalnızca GERÇEKTEN discord.com'a ulaşıldıysa "başarı" sayıyoruz.
  const loadedUrl = await getWebviewRealUrl();
  const isRealDiscordPage = /^https:\/\/(www\.)?discord\.com\//.test(loadedUrl);
  window.splitcord.log?.('did-finish-load', { url: loadedUrl, isRealDiscordPage });
  if (!isRealDiscordPage) return;

  engineFailCount = 0;
  hideStatus();
});

// Webview'in renderer süreci çökerse (ör. bellek baskısı) did-fail-load/did-finish-load
// hiç tetiklenmez ve arayüz sonsuza kadar son gösterdiği durumda takılı kalır. Bunu
// yakalayıp kullanıcıya açıkça bildiriyoruz ve otomatik olarak yeniden yüklemeyi deniyoruz.
webview?.addEventListener('render-process-gone', (event) => {
  window.splitcord.log?.('render-process-gone', { reason: event.reason });
  showStatus(`Discord sayfası beklenmedik şekilde kapandı (${event.reason}).\nYeniden yükleniyor…`);
  try {
    webview.reload();
  } catch (err) {
    window.splitcord.log?.('render-process-gone-reload-error', { error: err.message });
  }
});

// Ayarlar'dan DPI motoru değiştirildiğinde veya uygulama ilk açılışta motoru
// başlatıp proxy'yi uyguladığında ana süreç bu olayı gönderir.
window.splitcord.onDpiEngineChanged?.(() => {
  refreshConnection();
  checkControlsIssues();
});

// discord:// bir bağlantıyla (davet, kanal, kullanıcı) başlatıldığımızda veya uygulama
// zaten açıkken böyle bir bağlantıya tekrar tıklandığında ana süreç bu olayı gönderir.
window.splitcord.onNavigateToDiscordUrl?.((url) => {
  window.splitcord.log?.('protocol-navigate', { url });
  if (webview) webview.src = url;
});

// --- İzinler ve Kontroller uyarısı ---
// Ayarlar > İzinler ve Kontroller ekranındaki HERHANGİ bir kırmızı-X durumu (Güvenlik
// Duvarı izni verilmemiş, resmi Discord uygulaması kurulu, Kaspersky tespit edildi,
// çakışabilecek bir hizmet ya da harici process bulundu) titlebar'da tek, genel bir
// "Eylem Gerekli" uyarısı olarak gösteriliyor. Tıklanınca doğrudan o ekrana götürüyor.
const btnActionRequired = document.getElementById('btn-action-required');
btnActionRequired?.addEventListener('click', () => {
  window.splitcord.window.openSettings('panel-permissions');
});

async function checkControlsIssues() {
  if (!btnActionRequired) return;
  try {
    const { hasIssue } = await window.splitcord.app.getControlsIssueStatus();
    btnActionRequired.hidden = !hasIssue;
  } catch {
    // Servise ulaşılamıyorsa uyarı gösterme — zaten üstteki genel bağlantı hatası görünür.
    btnActionRequired.hidden = true;
  }
}

checkControlsIssues();
setInterval(checkControlsIssues, 30000);
// Ayarlar > İzinler ve Kontroller'de bir "Görmezden Gel" değişikliği ya da bir izin
// verildiğinde 30sn'lik periyodik yoklamayı beklemeden hemen güncellensin.
window.splitcord.onControlsIssueStatusChanged?.(checkControlsIssues);

// --- Güncelleme kontrolü ---
// İndirme bitince kurulum dosyası bir KEZ otomatik açılır (kullanıcı ikinci bir tıklamaya
// gerek kalmadan kurulum sihirbazını görür) — ama kurulum kendisi hâlâ NORMAL (sessiz
// olmayan) şekilde çalışıyor: Windows'un kendi UAC istemini ve sihirbazı gösteriyor,
// otomatik/sessiz kurulum KASITLI olarak kullanılmıyor (bkz. updateChecker.js'teki not).
// Kullanıcı sihirbazı kapatıp kurulumu tamamlamazsa, buton "Güncellemeyi Kur" olarak
// kalmaya devam eder — tekrar indirmeden, elle tekrar açabilir.
const btnUpdateAvailable = document.getElementById('btn-update-available');
let pendingUpdateInfo = null;
let updateDownloaded = false;
// GERÇEK BUG (canlı testte bulundu): openDownloadedUpdate() (shell.openPath) kurucu
// pencerenin GERÇEKTEN görünür hâle gelmesi bir-iki saniye sürebiliyor (ör. Defender'ın
// yeni/imzasız bir exe'yi ilk kez taraması) — ama buton bu çağrı tamamlanır tamamlanmaz
// (henüz pencere görünmeden) yeniden tıklanabilir hâle geliyordu. Kullanıcı sihirbazı
// hemen görmeyince sabırsızlanıp AYNI saniye içinde tekrar tıklıyor, bu da installer.exe'nin
// İKİNCİ bir kopyasını (ve İKİNCİ bir UAC istemini) başlatıyor — iki kurucu süreç aynı anda
// aynı dosyaları/servisi değiştirmeye çalışınca kurulum bozuluyor, "her ikisini de onayladım
// ama kurulum hiç uygulanmadı" şikayetinin kök nedeni tam olarak buydu (loglarda "update-
// auto-open" ile "open-update-click"in aynı saniyede art arda geldiği doğrulandı). Kısa bir
// soğuma penceresi bu yarışı engelliyor.
let installerLaunchCooldownUntil = 0;
const INSTALLER_LAUNCH_COOLDOWN_MS = 6000;

async function openDownloadedUpdateGuarded() {
  if (Date.now() < installerLaunchCooldownUntil) return;
  installerLaunchCooldownUntil = Date.now() + INSTALLER_LAUNCH_COOLDOWN_MS;
  await window.splitcord.app.openDownloadedUpdate();
}

window.splitcord.onUpdateAvailable?.((info) => {
  pendingUpdateInfo = info;
  updateDownloaded = false;
  if (btnUpdateAvailable) {
    btnUpdateAvailable.hidden = false;
    btnUpdateAvailable.textContent = 'Güncelleme Mevcut';
  }
});

btnUpdateAvailable?.addEventListener('click', async () => {
  if (!pendingUpdateInfo?.downloadUrl) return;

  if (updateDownloaded) {
    window.splitcord.log?.('update-open-click', { version: pendingUpdateInfo.latestVersion });
    try {
      await openDownloadedUpdateGuarded();
    } catch (err) {
      window.splitcord.log?.('update-open-error', { error: err.message });
      await window.showAlertModal({
        title: 'Güncelleme açılamadı',
        message: err.message,
      });
    }
    return;
  }

  const choice = await window.showConfirmModal({
    title: 'Güncelleme mevcut',
    message: `SplitCord-Turkey ${pendingUpdateInfo.latestVersion} mevcut. İndirilsin mi?`,
    detail: 'İndirme bitince kurulum dosyası açılabilir, normal kurulum sihirbazıyla elle kurabilirsin.',
  });
  if (choice !== 0) return;

  btnUpdateAvailable.disabled = true;
  btnUpdateAvailable.textContent = 'İndiriliyor…';
  window.splitcord.log?.('update-download-start', { version: pendingUpdateInfo.latestVersion });
  try {
    await window.splitcord.app.downloadUpdate(pendingUpdateInfo.downloadUrl);
    updateDownloaded = true;
    btnUpdateAvailable.textContent = 'Güncellemeyi Kur';
    // İndirme biter bitmez kurulum sihirbazını bir kez otomatik aç — kullanıcı ikinci bir
    // tıklamaya gerek kalmadan devam edebilsin. Açma başarısız olursa (ör. shell.openPath
    // hatası) sessizce yut — buton zaten "Güncellemeyi Kur" durumunda kalıyor, kullanıcı
    // tıklayarak tekrar deneyebilir.
    window.splitcord.log?.('update-auto-open', { version: pendingUpdateInfo.latestVersion });
    openDownloadedUpdateGuarded().catch((err) => {
      window.splitcord.log?.('update-auto-open-error', { error: err.message });
    });
  } catch (err) {
    window.splitcord.log?.('update-download-error', { error: err.message });
    await window.showAlertModal({
      title: 'Güncelleme başarısız',
      message: `Güncelleme indirilemedi: ${err.message}`,
    });
    btnUpdateAvailable.textContent = 'Güncelleme Mevcut';
  }
  btnUpdateAvailable.disabled = false;
});

// --- Discord temasına göre otomatik renk (Ayarlar > Görünüm) ---
// Ana süreç (dynamicColor.js) Discord sayfasının en üstünden örneklediği rengi HSL
// paletine çevirip burada CSS değişkenlerine uyguluyoruz — theme.css'teki transition
// tanımları sayesinde geçiş bir anda değil yumuşak (fade) oluyor. Kapatılırsa
// theme.css'teki sabit Discord-koyu varsayılana dönüyoruz.
function applyDynamicPalette(palette) {
  const root = document.documentElement.style;
  root.setProperty('--sc-bg-primary', palette.primary);
  root.setProperty('--sc-bg-secondary', palette.secondary);
  root.setProperty('--sc-bg-tertiary', palette.tertiary);
  root.setProperty('--sc-bg-hover', palette.hover);
  root.setProperty('--sc-text-normal', palette.textNormal);
  root.setProperty('--sc-text-muted', palette.textMuted);
}

window.splitcord.onDynamicColorSampled?.(applyDynamicPalette);

// --- Performans modu: fade geçişlerini theme.css'teki [data-performance-mode] kuralıyla kapatır ---
function applyPerformanceModeAttr(enabled) {
  if (enabled) document.documentElement.setAttribute('data-performance-mode', '');
  else document.documentElement.removeAttribute('data-performance-mode');
}
window.splitcord.app.getPerformanceMode().then(applyPerformanceModeAttr).catch(() => {});
window.splitcord.onPerformanceModeChanged?.(applyPerformanceModeAttr);

// --- KULLANICI TALEBİ: Daha küçük başlık çubuğu -- titlebar.css'teki
// [data-small-titlebar] .sc-titlebar { zoom: 0.5 } kuralını tetikler. ---
function applySmallTitlebarAttr(enabled) {
  if (enabled) document.documentElement.setAttribute('data-small-titlebar', '');
  else document.documentElement.removeAttribute('data-small-titlebar');
}
window.splitcord.app.getSmallTitlebar().then(applySmallTitlebarAttr).catch(() => {});
window.splitcord.onSmallTitlebarChanged?.(applySmallTitlebarAttr);

// --- KULLANICI TALEBİ: "SplitCord-Turkey başlığını göster/ortala" -- ikisi de varsayılan
// AÇIK geldiği için (bkz. localSettings.js), titlebar.css'teki kurallar TERSİNE çalışıyor:
// data-title-hidden/data-title-left "kapalı" durumunu (override) temsil ediyor, enabled=true
// (varsayılan) herhangi bir attribute GEREKTİRMİYOR. Yalnızca ANA PENCEREyi etkiliyor (bkz.
// titlebar.css .sc-titlebar-title--app'in notu) -- settings.js'te bir karşılığı YOK.
function applyShowTitleAttr(enabled) {
  if (enabled === false) document.documentElement.setAttribute('data-title-hidden', '');
  else document.documentElement.removeAttribute('data-title-hidden');
}
window.splitcord.app.getShowTitle().then(applyShowTitleAttr).catch(() => {});
window.splitcord.onShowTitleChanged?.(applyShowTitleAttr);

function applyCenterTitleAttr(enabled) {
  if (enabled === false) document.documentElement.setAttribute('data-title-left', '');
  else document.documentElement.removeAttribute('data-title-left');
}
window.splitcord.app.getCenterTitle().then(applyCenterTitleAttr).catch(() => {});
window.splitcord.onCenterTitleChanged?.(applyCenterTitleAttr);

// KULLANICI TALEBİ: Ayarlar > Genel'deki "Vencord'u etkinleştir" -- yeni enjeksiyon kararı
// yalnızca webview'in kendi preload'unun document-start'ta SENKRON okuduğu değeri
// etkiliyor (bkz. ipc.js vencord:get-enabled-sync notu), yani ancak BİR SONRAKİ
// navigasyonda devreye girebilir. Ayarlar penceresi kapanana kadar beklemek yerine
// hemen webview.reload() ile o navigasyonu tetikliyoruz.
window.splitcord.onVencordEnabledChanged?.(() => {
  webview?.reload();
});

// --- Bildirim rozeti (tray ikonu + görev çubuğu ikonu) ---
// Ana süreçte piksel çizim/kompozisyon API'si yok — bu yüzden ikonları bir <canvas> ile
// burada (renderer'da) çizip PNG data URL olarak main sürece gönderiyoruz. capturePage()
// DEĞİL (bu sandbox'ta GPU çökmelerine yol açtığı için kasıtlı olarak kullanılmıyor) —
// Canvas 2D toDataURL() tamamen ayrı, güvenli bir kod yolu.
//
// İki farklı ikon üretiliyor:
// 1) Tray: Tray.setImage() TÜM ikonu değiştirir, bu yüzden temel tray-icon.png'nin
//    üzerine rozet çizilmiş TAM bir kompozit gerekiyor.
// 2) Görev çubuğu: BrowserWindow.setOverlayIcon() Windows'un kendisi tarafından mevcut
//    uygulama ikonunun üzerine bindiriliyor — bu yüzden yalnızca küçük bir nokta yeterli,
//    temel ikonu ayrıca çizmeye gerek yok.
//
// count: 1-9 arası ise rakamın kendisi, 9'dan büyükse "9+" yazılır; null/0 ise (sayı
// bilinmiyorsa, ör. yalnızca nokta/yıldız önekiyle işaretli okunmamışlar) sayısız düz
// bir nokta çizilir.
function drawBadgeDot(ctx, cx, cy, r, count) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ed4245';
  ctx.fill();

  if (count) {
    const label = count > 9 ? '9+' : String(count);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(r * (label.length > 1 ? 1.15 : 1.4))}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + r * 0.06);
  }
}

let cachedBaseTrayImg = null;
function loadBaseTrayImg() {
  if (cachedBaseTrayImg) return Promise.resolve(cachedBaseTrayImg);
  const img = new Image();
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => {
      cachedBaseTrayImg = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error('tray-icon.png yüklenemedi'));
  });
  img.src = '../../resources/tray-icon.png';
  return loaded;
}

async function generateNotificationBadgeIcons(count) {
  try {
    const img = await loadBaseTrayImg();

    const traySize = 32;
    const trayCanvas = document.createElement('canvas');
    trayCanvas.width = traySize;
    trayCanvas.height = traySize;
    const trayCtx = trayCanvas.getContext('2d');
    trayCtx.drawImage(img, 0, 0, traySize, traySize);
    const trayR = traySize * 0.28;
    drawBadgeDot(trayCtx, traySize - trayR * 0.9, trayR * 0.9, trayR, count);
    const trayDataUrl = trayCanvas.toDataURL('image/png');

    const overlaySize = 16;
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = overlaySize;
    overlayCanvas.height = overlaySize;
    const overlayCtx = overlayCanvas.getContext('2d');
    drawBadgeDot(overlayCtx, overlaySize / 2, overlaySize / 2, overlaySize / 2 - 1, count);
    const overlayDataUrl = overlayCanvas.toDataURL('image/png');

    const [trayOk, overlayOk] = await Promise.all([
      window.splitcord.app.registerBadgedTrayIcon(trayDataUrl),
      window.splitcord.app.registerNotificationOverlayIcon(overlayDataUrl),
    ]);
    window.splitcord.log?.('notification-badge-icons-generated', { trayOk, overlayOk, count });
  } catch (err) {
    window.splitcord.log?.('tray-badge-generate-error', { error: err.message });
  }
}

generateNotificationBadgeIcons(null);
window.splitcord.onNotificationCountChanged?.((count) => generateNotificationBadgeIcons(count));

// Bu pencerede yakalanmayan bir hata olursa yine de log dosyasına düşsün.
window.addEventListener('error', (event) => {
  window.splitcord.log?.('main-window-uncaught-error', { message: event.message, filename: event.filename, line: event.lineno });
});
window.addEventListener('unhandledrejection', (event) => {
  window.splitcord.log?.('main-window-unhandled-rejection', { reason: String(event.reason?.message ?? event.reason) });
});

refreshConnection();
