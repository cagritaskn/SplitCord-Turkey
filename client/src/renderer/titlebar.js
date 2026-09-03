'use strict';

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
  [btnStatusRetryAuto, btnStatusManualSetup, btnStatusOpenPermissions, btnStatusDisableQuic].forEach((btn) => {
    if (btn) btn.hidden = true;
  });
  statusOverlay.hidden = false;
}

function hideStatus() {
  if (statusOverlay) statusOverlay.hidden = true;
  clearStatusScanLog();
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
  // Otomatik modun giriş noktası artık Zapret2 (bkz. DpiEngineManager.SwitchToAsync).
  window.splitcord.dpi.activateEngine('zapret2').catch((err) => {
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
      showStatus(`DPI servisine ulaşılamıyor.\n${err.message}`, true);
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
// artık hepsi aynı şekilde bekliyor.
let engineFailCount = 0;
const ENGINE_MAX_AUTO_RETRIES = 8;
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
      // Birkaç yeniden deneme sonrası hâlâ başarısız — geçici bir sıfırlanma değil,
      // kayıtlı ayar kalıcı olarak çalışmıyor gibi görünüyor. Motoru DEĞİŞTİRMİYORUZ,
      // yalnızca AYNI motorun doğrulamasını sıfırlayıp yeniden aday taramasını tetikliyoruz
      // (Manuel moddaysa BAŞKA bir motora geçmeden — bkz. ipc.js'teki allowEscalation).
      window.splitcord.log?.('did-fail-load-give-up', { activeEngineId: status?.activeEngineId, count: engineFailCount });
      engineFailCount = 0;
      if (status?.activeEngineId === 'byedpi') {
        showStatus(`Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nFarklı bir ByeDPI stratejisi deneniyor…`);
        await window.splitcord.dpi.reportByeDpiFailure();
      } else if (status?.activeEngineId) {
        showStatus(`Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nKayıtlı ayar artık çalışmıyor gibi görünüyor, yeniden aranıyor…`);
        await window.splitcord.dpi.reportEngineFailure(status.activeEngineId);
      } else {
        showStatus(`Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nYenile'ye tekrar basmayı deneyin.`, true);
      }
    } else {
      showStatus(`Discord yüklenemedi (${event.errorDescription || event.errorCode}).\nTekrar deneniyor…`);
      await new Promise((resolve) => setTimeout(resolve, ENGINE_RETRY_DELAY_MS));
      await refreshConnection();
    }
  } catch (err) {
    window.splitcord.log?.('did-fail-load-recovery-error', { error: err.message });
    showStatus(`Discord'a erişilemiyor.\n${err.message}`, true);
  } finally {
    retryInFlight = false;
  }
});

webview?.addEventListener('did-finish-load', () => {
  // did-fail-load'dan hemen sonra Chromium kendi dahili hata sayfasına (chrome-error://
  // veya benzeri) düşüp onu BAŞARIYLA yüklüyor — bu da hemen ardından bir did-finish-load
  // tetikliyor. webview.src (ayarladığımız hedef) her zaman aynı kaldığı için önceden bunu
  // "gerçek başarı" sanıp engineFailCount'u sıfırlıyorduk, bu da vazgeçme sınırını hiç
  // devreye girmeden 2 saniyede bir SONSUZA KADAR tekrar denemeye yol açıyordu. Gerçekte
  // hangi URL'in yüklendiğini (webview.getURL()) kontrol edip yalnızca GERÇEKTEN
  // discord.com'a ulaşıldıysa "başarı" sayıyoruz.
  const loadedUrl = webview.getURL?.() ?? '';
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
      await window.splitcord.app.openDownloadedUpdate();
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
    window.splitcord.app.openDownloadedUpdate().catch((err) => {
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
