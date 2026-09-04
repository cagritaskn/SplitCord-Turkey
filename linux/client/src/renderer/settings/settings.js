'use strict';

// Windows karşılığından FARK: "goodbyedpi" girdisi YOK (bkz. PORTING_PLAN.md D-2), "WinDivert"
// yerine "NFQUEUE" (Linux'taki paket yakalama mekanizması, bkz. D-5), ve varsayılan/giriş
// noktası motoru artık Zapret (Zapret2 değil, bkz. D-2 — Windows tarafında da bu değişmişti).
const ENGINE_DESCRIPTIONS = {
  zapret: 'Sistem geneli, Discord/YouTube için hazır strateji (NFQUEUE). Tüm uygulamaları etkiler. Varsayılan.',
  zapret2: 'Sistem geneli, Zapret\'in yeni nesil sürümü (NFQUEUE). blockcheck2 ile otomatik strateji bulur, hem metin hem ses (UDP/STUN) bağlantısını ayrıca doğrular.',
  byedpi: 'Yalnızca bu uygulamanın trafiğini kapsayan yerel proxy. Root gerektirmez. Ses bağlantısına destek olması için arka planda ayrıca Zapret de (yalnızca UDP) devreye alınır.',
};

let currentStatus = null;
let selectedEngineId = null;
let lastPrefilledFor = null;
// "Argüman Setini Yasakla" GERÇEKTE hangi motor için (bkz. renderAutomaticStatus).
let rejectCurrentEngineId = null;

// Ana süreçteki dialog.showMessageBoxSync yerine geçen temaya uygun modal köprüsü —
// bkz. client/src/main/themedDialog.js ve renderer/modal.js.
window.splitcord.onShowConfirmModal(async ({ id, ...options }) => {
  const choice = await window.showConfirmModal(options);
  window.splitcord.sendConfirmModalResult(id, choice);
});

const engineListEl = document.getElementById('engine-list');
const argsTextarea = document.getElementById('advanced-args');
const logsBox = document.getElementById('engine-logs');
const automaticStatusEl = document.getElementById('automatic-status');
const btnRejectCurrent = document.getElementById('btn-reject-current');
const rejectedArgsSection = document.getElementById('rejected-args-section');
const rejectedArgsList = document.getElementById('rejected-args-list');
const dpiAutomaticView = document.getElementById('dpi-automatic-view');
const dpiManualView = document.getElementById('dpi-manual-view');
const dpiAdvancedAutomaticSection = document.getElementById('dpi-advanced-automatic-section');
const dpiLogDohSection = document.getElementById('dpi-log-doh-section');
const dpiAdvancedToggle = document.getElementById('toggle-dpi-advanced');
const dpiAdvancedManualSection = document.getElementById('dpi-advanced-manual-section');
const dpiAdvancedManualToggle = document.getElementById('toggle-dpi-advanced-manual');
const dpiActiveEngineInfoEl = document.getElementById('dpi-active-engine-info');
const byedpiExtendedAutomaticToggle = document.getElementById('toggle-byedpi-extended-automatic');
const byedpiExtendedManualToggle = document.getElementById('toggle-byedpi-extended-manual');
const byedpiExtendedManualRow = document.getElementById('byedpi-extended-manual-row');
const restartSearchWrap = document.getElementById('restart-search-wrap');
const btnRestartSearch = document.getElementById('btn-restart-search');
const restartSearchManualWrap = document.getElementById('restart-search-manual-wrap');
const btnRestartSearchManual = document.getElementById('btn-restart-search-manual');
const manualDnsProtocolSelect = document.getElementById('select-manual-dns-protocol');
// Zapret2 tier zaman aşımı slider'ları -- "A" (Otomatik+Gelişmiş) ve "M" (Manuel+Gelişmiş)
// bölümlerinde birer kopya var, ikisi de AYNI iki değeri (Otomatik/Manuel mod süresi)
// yansıtıp senkron kalıyor (bkz. initZapret2TierTimeout).
const z2TimeoutSliders = {
  autoA: document.getElementById('slider-z2-timeout-auto-A'),
  manualA: document.getElementById('slider-z2-timeout-manual-A'),
  autoM: document.getElementById('slider-z2-timeout-auto-M'),
  manualM: document.getElementById('slider-z2-timeout-manual-M'),
};
const z2TimeoutValueEls = {
  autoA: document.getElementById('slider-z2-timeout-auto-A-value'),
  manualA: document.getElementById('slider-z2-timeout-manual-A-value'),
  autoM: document.getElementById('slider-z2-timeout-auto-M-value'),
  manualM: document.getElementById('slider-z2-timeout-manual-M-value'),
};
const btnSaveZ2TimeoutA = document.getElementById('btn-save-z2-timeout-A');
const btnSaveZ2TimeoutM = document.getElementById('btn-save-z2-timeout-M');

let dpiMode = 'automatic';
let dpiAdvanced = false;
let byedpiUseExtendedCandidates = false;
let byedpiExtendedChangeInFlight = false;
let dpiAdvancedManual = false;

function renderActiveEngineInfo() {
  if (!dpiActiveEngineInfoEl || !currentStatus) return;

  const active = currentStatus.engines.find((e) => e.id === currentStatus.activeEngineId);
  if (!currentStatus.switching && active?.verified) {
    // ByeDPI, Zapret'in tüm adayları başarısız olup eskalasyonla devreye girdiğinde, sesi
    // (WebRTC/UDP) düzeltmeye çalışan bağımsız bir Zapret süreci de arka planda çalışıyor
    // olabilir (bkz. DpiEngineManager.SwitchToAsync + ZapretEngine.StartUdpCompanionAsync) —
    // kullanıcı bunun neden olduğunu anlasın diye ayrıca belirtiyoruz.
    const companionNote = currentStatus.zapretUdpCompanionRunning
      ? ' (+ ses için arka planda Zapret UDP eşliği aktif)'
      : '';
    dpiActiveEngineInfoEl.textContent = `Aktif Aşım Yöntemi: ${active.displayName}${companionNote}`;
    dpiActiveEngineInfoEl.hidden = false;
  } else {
    dpiActiveEngineInfoEl.hidden = true;
  }
}

async function renderAutomaticStatus() {
  if (dpiMode !== 'automatic' || !currentStatus) return;

  renderActiveEngineInfo();

  // Halihazırda bir motor/strateji taraması sürerken "Tekrar Arama Başlat" da diğer
  // kilitli öğelerle (motor kartları, Otomatik/Manuel switch) aynı şekilde blur+spinner
  // ile engelleniyor — kullanıcı sürmekte olan bir taramanın üzerine ikincisini tetiklemesin.
  if (restartSearchWrap) restartSearchWrap.classList.toggle('sc-restart-search--locked', currentStatus.switching);

  // Otomatik modda bir motorun TÜM adayları tükenirse DpiEngineManager otomatik olarak
  // zincirdeki sonraki motora geçiyor (Zapret -> Zapret2 -> ByeDPI, bkz. PORTING_PLAN.md D-2)
  // — bu kutu ÖNCEDEN her zaman giriş noktasının durumunu gösteriyordu, escalation sonrası
  // hâlâ eski/başarısız durumu göstermeye devam edip kafa karıştırıyordu. Şimdi GERÇEKTE
  // aktif olan motoru gösteriyor.
  const activeEngineId = getDisplayActiveEngineId(currentStatus);
  const active = currentStatus.engines.find((e) => e.id === activeEngineId);

  // "Argüman Setini Yasakla" artık üç motor için de var (sunucuda /engines/{id}/reject-current
  // olarak genelleştirildi) — bu yüzden hangi motorun args'ını yasaklayacağını bilmek için
  // GERÇEKTE aktif olan motorun id'sini saklıyoruz.
  rejectCurrentEngineId = active?.id ?? null;

  if (!active) {
    automaticStatusEl.textContent = 'Motor bulunamadı.';
    btnRejectCurrent.hidden = true;
  } else if (active.running) {
    automaticStatusEl.textContent = `${active.displayName}: çalışan bir ayar bulundu ve kullanılıyor:\n${active.args || '(boş)'}`;
    btnRejectCurrent.hidden = false;
  } else if (active.detail && active.detail.includes('erişemedi')) {
    const dnsHint = active.id === 'byedpi' ? ' DNS sağlayıcılarını (aşağıdan) değiştirmeyi veya' : '';
    automaticStatusEl.textContent = `${active.displayName}: ${active.detail}\nDenenecek başka strateji kalmadı.${dnsHint} Manuel moda geçip bir motoru elle denemeyi deneyebilirsin.`;
    btnRejectCurrent.hidden = true;
  } else {
    automaticStatusEl.textContent = `${active.displayName}: Discord'a erişebilen bir ayar aranıyor, bu biraz sürebilir…`;
    btnRejectCurrent.hidden = true;
  }

  await renderRejectedArgsList(active?.id ?? null);
}

async function renderRejectedArgsList(engineId) {
  let rejected = [];
  if (engineId) {
    try {
      rejected = (await window.splitcord.dpi.getRejectedArgs(engineId)) ?? [];
    } catch (err) {
      window.splitcord.log('get-rejected-args-error', { id: engineId, error: err.message });
    }
  }

  rejectedArgsSection.hidden = rejected.length === 0;
  rejectedArgsList.innerHTML = '';
  for (const args of rejected) {
    const row = document.createElement('div');
    row.className = 'sc-rejected-item';
    row.innerHTML = `<span>${escapeHtml(args)}</span>`;
    const btn = document.createElement('button');
    btn.textContent = 'Yasağı Kaldır';
    btn.addEventListener('click', async () => {
      window.splitcord.log('unreject-args-click', { id: engineId, args });
      try {
        await window.splitcord.dpi.unrejectArgs(engineId, args);
      } catch (err) {
        window.splitcord.log('unreject-args-error', { id: engineId, args, error: err.message });
      }
      await renderRejectedArgsList(engineId);
    });
    row.appendChild(btn);
    rejectedArgsList.appendChild(row);
  }
}

btnRejectCurrent.addEventListener('click', async () => {
  if (!rejectCurrentEngineId) return;
  window.splitcord.log('reject-current-args-click', { id: rejectCurrentEngineId });
  btnRejectCurrent.disabled = true;
  btnRejectCurrent.textContent = 'Yeni ayar aranıyor…';
  try {
    await window.splitcord.dpi.rejectCurrentArgs(rejectCurrentEngineId);
  } catch (err) {
    window.splitcord.log('reject-current-args-error', { id: rejectCurrentEngineId, error: err.message });
  }
  btnRejectCurrent.disabled = false;
  btnRejectCurrent.textContent = 'Argüman Setini Yasakla';
  await refreshStatus();
});

btnRestartSearch?.addEventListener('click', async () => {
  // CSS zaten sürmekte olan bir tarama sırasında butonu blur+spinner ile engelliyor,
  // ama tıklama olayı yine de DOM'a ulaşabileceği için (pointer-events:none normalde
  // bunu engeller, çift güvence olarak) canlı durumu burada da kontrol ediyoruz.
  if (currentStatus?.switching) return;
  window.splitcord.log('restart-search-click', {});
  // Otomatik modun giriş noktası artık Zapret (bkz. DpiEngineManager.SwitchToAsync).
  await activateEngine('zapret');
});

btnRestartSearchManual?.addEventListener('click', async () => {
  if (currentStatus?.switching || !selectedEngineId) return;
  window.splitcord.log('restart-search-manual-click', { id: selectedEngineId });
  await activateEngine(selectedEngineId);
});

function applyDpiModeView() {
  document.getElementById('btn-mode-automatic').classList.toggle('active', dpiMode === 'automatic');
  document.getElementById('btn-mode-manual').classList.toggle('active', dpiMode === 'manual');
  dpiAutomaticView.hidden = dpiMode !== 'automatic';
  dpiManualView.hidden = dpiMode !== 'manual';

  // Otomatik'te "Gelişmiş" işaretlenmedikçe çalışan ayar/yasaklı liste gizli kalır;
  // Manuel'de de aynı şekilde argüman düzenleme alanı kendi "Gelişmiş" toggle'ı
  // açılmadıkça gizli kalır (motor listesi/seçimi her zaman görünür).
  dpiAdvancedAutomaticSection.hidden = !(dpiMode === 'automatic' && dpiAdvanced);
  dpiAdvancedManualSection.hidden = !(dpiMode === 'manual' && dpiAdvancedManual);
  dpiLogDohSection.hidden = !((dpiMode === 'automatic' && dpiAdvanced) || (dpiMode === 'manual' && dpiAdvancedManual));
}

// Otomatik<->Manuel geçişi (onay + tarama iptali + tüm motorları durdurma + mod değişimi)
// TAMAMLANMADAN tekrar tetiklenemesin diye mod düğmelerini kilitliyoruz (blur + dönen
// çember, bkz. settings.css'teki .sc-mode-switch--locked).
let modeSwitchInFlight = false;

async function initDpiMode() {
  try {
    dpiMode = await window.splitcord.dpi.getMode();
  } catch (err) {
    window.splitcord.log('get-dpi-mode-error', { error: err.message });
  }
  applyDpiModeView();

  const modeSwitchEl = document.getElementById('dpi-mode-switch');

  for (const btn of document.querySelectorAll('.sc-mode-btn')) {
    btn.addEventListener('click', async () => {
      if (modeSwitchInFlight) return;
      const mode = btn.dataset.mode;
      if (mode === dpiMode) return;

      // Her iki yönde de (Otomatik<->Manuel) o an bir motor/strateji taraması sürüyor
      // olabilir (ByeDPI/Zapret/Zapret2 aday testleri) — onay metnine ekstra bir uyarı
      // ekleniyor; onaylanırsa taramayı VE o an çalışan motoru tamamen durdurup (bkz.
      // aşağıdaki cancelScan + stopAllEngines çağrıları) ANCAK ONDAN SONRA mod geçişini
      // yapıyoruz.
      let scanInProgress = false;
      let statusBeforeChange = null;
      try {
        statusBeforeChange = await window.splitcord.dpi.getStatus();
        scanInProgress = !!statusBeforeChange?.switching;
      } catch (err) {
        window.splitcord.log('get-status-before-mode-change-error', { error: err.message });
      }

      // Manuel'de zaten Zapret taranıyor/aktifken Otomatik'e geçiliyorsa: Otomatik modun
      // giriş noktası da Zapret (bkz. ipc.js dpi:set-mode) — sürmekte olan taramayı iptal
      // edip AYNI motor için sıfırdan yeniden başlatmak, kullanıcı gözünden hiçbir şey
      // değişmeden spinner'ın kesintisiz sürmesine yol açıyordu (taramanın "durmadığı"
      // izlenimi). Bu özel durumda taramayı hiç iptal etmiyoruz, kesintisiz sürmesine
      // izin veriyoruz — ipc.js tarafı da bu durumda motoru yeniden başlatmıyor.
      const carryOverZapret2Scan =
        mode === 'automatic' &&
        scanInProgress &&
        statusBeforeChange &&
        getDisplayActiveEngineId(statusBeforeChange) === 'zapret';

      let detail = 'Mod değişikliği DPI motorunun yeniden başlatılmasına neden olabilir, bu da Discord bağlantısının kısa süreliğine kesilmesine yol açabilir.';
      if (scanInProgress && !carryOverZapret2Scan) {
        detail += ' Şuan aşım testleri yapıldığından bu ayarı değiştirmeniz halinde testler yarıda kalacaktır.';
      }

      const choice = await window.showConfirmModal({
        title: 'DPI Aşımı modu değişecek',
        message: `DPI Aşımı modu "${mode === 'automatic' ? 'Otomatik' : 'Manuel'}" olarak değiştirilsin mi?`,
        detail,
      });
      if (choice !== 0) {
        window.splitcord.log('dpi-mode-change-cancelled', { mode });
        return;
      }

      modeSwitchInFlight = true;
      modeSwitchEl?.classList.add('sc-mode-switch--locked');
      // Aşım hizmeti kartları da geçiş boyunca (henüz view değişmediği için Manuel
      // görünümü hâlâ ekranda kalabiliyor) mod switch'iyle AYNI anda blur+spinner
      // göstersin — bir sonraki periyodik durumu beklemeden hemen uygula.
      renderEngineList();
      try {
        if (scanInProgress && !carryOverZapret2Scan) {
          window.splitcord.log('cancel-scan-click', {});
          try {
            await window.splitcord.dpi.cancelScan();
          } catch (err) {
            window.splitcord.log('cancel-scan-error', { error: err.message });
          }

          // cancelScan yalnızca iptal SİNYALİ gönderir, motorun fiilen durmasını beklemez —
          // stopAllEngines aynı kilidi kullandığı için sürmekte olan iptalin TAMAMEN
          // bitmesini bekleyip sonra her şeyin GERÇEKTEN durduğundan emin oluyor.
          window.splitcord.log('stop-all-before-mode-change-click', {});
          try {
            await window.splitcord.dpi.stopAllEngines();
          } catch (err) {
            window.splitcord.log('stop-all-before-mode-change-error', { error: err.message });
          }
        }

        window.splitcord.log('dpi-mode-changed', { mode });
        try {
          dpiMode = await window.splitcord.dpi.setMode(mode);
        } catch (err) {
          window.splitcord.log('set-dpi-mode-error', { mode, error: err.message });
        }
        applyDpiModeView();
        await refreshStatus();
      } finally {
        modeSwitchInFlight = false;
        modeSwitchEl?.classList.remove('sc-mode-switch--locked');
        // refreshStatus() (yukarıda) modeSwitchInFlight HÂLÂ true iken çalıştığı için
        // kartları kilitli bırakmış olabilir — bayrak sıfırlandıktan sonra bir kez daha
        // render edip kilidi hemen kaldırıyoruz (bir sonraki periyodik durumu beklemeden).
        renderEngineList();
      }
    });
  }

  dpiAdvancedToggle?.addEventListener('change', () => {
    dpiAdvanced = dpiAdvancedToggle.checked;
    window.splitcord.log('dpi-advanced-toggle-changed', { checked: dpiAdvanced });
    applyDpiModeView();
  });

  dpiAdvancedManualToggle?.addEventListener('change', () => {
    dpiAdvancedManual = dpiAdvancedManualToggle.checked;
    window.splitcord.log('dpi-advanced-manual-toggle-changed', { checked: dpiAdvancedManual });
    applyDpiModeView();
  });
}

// ByeDPI "uzun argüman listesi" anahtarı — hem Otomatik'in Gelişmiş bölümünde hem de
// Manuel'de ByeDPI seçiliyken görünür, ikisi de aynı ayarı yansıtır (bkz. renderEngineList
// içindeki byedpiExtendedManualRow görünürlük mantığı). Her değişiklik (tarama sürsün ya
// da sürmesin) ByeDPI'yi yeniden başlattığı için HER ZAMAN onay istenir; onaylanmazsa hem
// tarama hem de anahtar eski hâlinde kalır, onaylanırsa yeni listeyle tarama başlatılır.
function applyByedpiExtendedCandidatesState(enabled) {
  byedpiUseExtendedCandidates = enabled;
  if (byedpiExtendedAutomaticToggle) byedpiExtendedAutomaticToggle.checked = enabled;
  if (byedpiExtendedManualToggle) byedpiExtendedManualToggle.checked = enabled;
}

async function initByedpiExtendedCandidates() {
  try {
    const { enabled } = await window.splitcord.dpi.getByeDpiUseExtendedCandidates();
    applyByedpiExtendedCandidatesState(!!enabled);
  } catch (err) {
    window.splitcord.log('get-byedpi-extended-candidates-error', { error: err.message });
  }

  const handleToggle = async (checkboxEl) => {
    if (byedpiExtendedChangeInFlight) {
      checkboxEl.checked = byedpiUseExtendedCandidates;
      return;
    }
    const newValue = checkboxEl.checked;
    if (newValue === byedpiUseExtendedCandidates) return;

    // Liste tercihi değişikliği HER ZAMAN ByeDPI'yi yeniden başlatıp (bağlantı kısa
    // süreliğine kesilir) sürmekte olan taramayı iptal ettiği için — tarama o an sürüyor
    // olsun ya da olmasın — her değişiklikte onay isteniyor. Onay alınana kadar checkbox'ı
    // eski haline döndürüyoruz ki "Hayır" denildiğinde ne anahtar ne de tarama değişmiş olsun.
    checkboxEl.checked = byedpiUseExtendedCandidates;
    const choice = await window.showConfirmModal({
      title: 'ByeDPI liste tercihini değiştir',
      message: newValue ? 'Uzun argüman listesi açılsın mı?' : 'Uzun argüman listesi kapatılsın mı?',
      detail: 'Liste tercihinizi değiştirdiğinizde bağlantınız kesilir, halihazırda devam eden tarama durdurulur ve yeni liste ile tarama tekrar başlar.',
    });
    if (choice !== 0) {
      window.splitcord.log('byedpi-extended-candidates-change-cancelled', { newValue });
      return;
    }

    byedpiExtendedChangeInFlight = true;
    if (byedpiExtendedAutomaticToggle) byedpiExtendedAutomaticToggle.disabled = true;
    if (byedpiExtendedManualToggle) byedpiExtendedManualToggle.disabled = true;
    try {
      await window.splitcord.dpi.setByeDpiUseExtendedCandidates(newValue);
      applyByedpiExtendedCandidatesState(newValue);
      window.splitcord.log('byedpi-extended-candidates-changed', { newValue });
      // activateEngine, SwitchToAsync'in başındaki _scanCts.Cancel() sayesinde sürmekte
      // olan bir taramayı zaten iptal edip yeni ayarla sıfırdan başlatıyor — tarama
      // sürmüyorsa da doğrudan yeni listeyle bir tarama başlatmış oluyor.
      await activateEngine('byedpi');
    } catch (err) {
      window.splitcord.log('byedpi-extended-candidates-change-error', { error: err.message });
    } finally {
      byedpiExtendedChangeInFlight = false;
      if (byedpiExtendedAutomaticToggle) byedpiExtendedAutomaticToggle.disabled = false;
      if (byedpiExtendedManualToggle) byedpiExtendedManualToggle.disabled = false;
    }
  };

  byedpiExtendedAutomaticToggle?.addEventListener('change', () => handleToggle(byedpiExtendedAutomaticToggle));
  byedpiExtendedManualToggle?.addEventListener('change', () => handleToggle(byedpiExtendedManualToggle));
}

// Manuel > Gelişmiş'te sabitlenen tek DNS protokolü — yalnızca Manuel'de görünür (bkz.
// settings.html'deki dpi-advanced-manual-section). Değiştirildiğinde HER ZAMAN onay
// istenir (ByeDPI uzun liste anahtarıyla aynı desen): onaylanırsa hem servise kaydedilir
// hem de o an Manuel'de seçili olan motorun taraması (blockcheck2 dahil) sıfırdan başlatılır;
// "Hayır" denirse hem seçim hem de tarama eski hâlinde kalır.
let manualDnsProtocol = '';
let manualDnsProtocolChangeInFlight = false;

async function initManualDnsProtocol() {
  try {
    const { protocol } = await window.splitcord.dpi.getManualDnsProtocol();
    manualDnsProtocol = protocol || '';
    if (manualDnsProtocolSelect) manualDnsProtocolSelect.value = manualDnsProtocol;
  } catch (err) {
    window.splitcord.log('get-manual-dns-protocol-error', { error: err.message });
  }

  manualDnsProtocolSelect?.addEventListener('change', async () => {
    if (manualDnsProtocolChangeInFlight) {
      manualDnsProtocolSelect.value = manualDnsProtocol;
      return;
    }
    const newValue = manualDnsProtocolSelect.value;
    if (newValue === manualDnsProtocol) return;

    // Seçilen <option>'ın kendi metnini select'in değerini eski hâline döndürmeden ÖNCE
    // okuyoruz -- DNS_PROTOCOL_LABELS yalnızca DNS sağlayıcı listesi (doh/dot/doq/dnscrypt)
    // için, "Otomatik"/"DNS'siz" gibi bu açılır menüye özel seçenekleri içermiyor.
    const newOption = Array.from(manualDnsProtocolSelect.options).find((o) => o.value === newValue);
    const label = newOption?.textContent?.trim() || newValue;
    manualDnsProtocolSelect.value = manualDnsProtocol;
    const choice = await window.showConfirmModal({
      title: 'DNS protokolünü değiştir',
      message: `DNS protokolü "${escapeHtml(label)}" olarak sabitlensin mi?`,
      detail: 'Bu değişiklik, halihazırda devam eden taramayı durdurup seçili motoru bu protokolle sıfırdan taramaya başlatır.',
    });
    if (choice !== 0) {
      window.splitcord.log('manual-dns-protocol-change-cancelled', { newValue });
      return;
    }

    manualDnsProtocolChangeInFlight = true;
    manualDnsProtocolSelect.disabled = true;
    try {
      await window.splitcord.dpi.setManualDnsProtocol(newValue || null);
      manualDnsProtocol = newValue;
      manualDnsProtocolSelect.value = newValue;
      window.splitcord.log('manual-dns-protocol-changed', { newValue });
      if (selectedEngineId) {
        await activateEngine(selectedEngineId);
      }
    } catch (err) {
      window.splitcord.log('manual-dns-protocol-change-error', { error: err.message });
    } finally {
      manualDnsProtocolChangeInFlight = false;
      manualDnsProtocolSelect.disabled = false;
    }
  });
}

// Yalnızca Zapret2 için: Otomatik/Manuel modun tier başına blockcheck2 üst sınırı (dakika,
// bağımsız iki değer, 5-60 aralığı) — "A" (Otomatik+Gelişmiş) ve "M" (Manuel+Gelişmiş)
// bölümlerinde birer kopyası var, ikisi de AYNI iki değeri yansıtıp senkron kalıyor (ByeDPI
// uzun liste anahtarıyla aynı desen). Değiştirilince Kaydet butonu belirir; kaydedilince
// onay istenip Zapret2'nin taraması (DNS protokolü sıralamasının başından, DoH'tan itibaren)
// sıfırdan yeniden başlatılır.
let z2TimeoutAutoMinutes = 5;
let z2TimeoutManualMinutes = 10;
let z2TimeoutChangeInFlight = false;

function applyZ2TimeoutSliderValues() {
  if (z2TimeoutSliders.autoA) z2TimeoutSliders.autoA.value = z2TimeoutAutoMinutes;
  if (z2TimeoutSliders.autoM) z2TimeoutSliders.autoM.value = z2TimeoutAutoMinutes;
  if (z2TimeoutSliders.manualA) z2TimeoutSliders.manualA.value = z2TimeoutManualMinutes;
  if (z2TimeoutSliders.manualM) z2TimeoutSliders.manualM.value = z2TimeoutManualMinutes;
  if (z2TimeoutValueEls.autoA) z2TimeoutValueEls.autoA.textContent = `${z2TimeoutAutoMinutes} dk`;
  if (z2TimeoutValueEls.autoM) z2TimeoutValueEls.autoM.textContent = `${z2TimeoutAutoMinutes} dk`;
  if (z2TimeoutValueEls.manualA) z2TimeoutValueEls.manualA.textContent = `${z2TimeoutManualMinutes} dk`;
  if (z2TimeoutValueEls.manualM) z2TimeoutValueEls.manualM.textContent = `${z2TimeoutManualMinutes} dk`;
}

function updateZ2TimeoutSaveButtonsVisibility() {
  const currentAuto = Number(z2TimeoutSliders.autoA?.value ?? z2TimeoutAutoMinutes);
  const currentManual = Number(z2TimeoutSliders.manualA?.value ?? z2TimeoutManualMinutes);
  const changed = currentAuto !== z2TimeoutAutoMinutes || currentManual !== z2TimeoutManualMinutes;
  if (btnSaveZ2TimeoutA) btnSaveZ2TimeoutA.hidden = !changed;
  if (btnSaveZ2TimeoutM) btnSaveZ2TimeoutM.hidden = !changed;
}

async function initZapret2TierTimeout() {
  try {
    const { automaticMinutes, manualMinutes } = await window.splitcord.dpi.getZapret2TierTimeout();
    z2TimeoutAutoMinutes = automaticMinutes ?? 5;
    z2TimeoutManualMinutes = manualMinutes ?? 10;
    applyZ2TimeoutSliderValues();
  } catch (err) {
    window.splitcord.log('get-zapret2-tier-timeout-error', { error: err.message });
  }

  // "auto" slider'lardan biri hareket ettirildiğinde diğer bölümdeki kopyasını (ve tersi
  // "manual" slider çifti) senkron tutuyoruz.
  const syncPairs = [
    [z2TimeoutSliders.autoA, z2TimeoutSliders.autoM, z2TimeoutValueEls.autoA, z2TimeoutValueEls.autoM],
    [z2TimeoutSliders.manualA, z2TimeoutSliders.manualM, z2TimeoutValueEls.manualA, z2TimeoutValueEls.manualM],
  ];
  for (const [sliderX, sliderY, valueElX, valueElY] of syncPairs) {
    if (!sliderX || !sliderY) continue;
    const onInput = (source) => {
      const value = source.value;
      sliderX.value = value;
      sliderY.value = value;
      if (valueElX) valueElX.textContent = `${value} dk`;
      if (valueElY) valueElY.textContent = `${value} dk`;
      updateZ2TimeoutSaveButtonsVisibility();
    };
    sliderX.addEventListener('input', () => onInput(sliderX));
    sliderY.addEventListener('input', () => onInput(sliderY));
  }

  const handleSave = async () => {
    if (z2TimeoutChangeInFlight) return;
    const newAuto = Number(z2TimeoutSliders.autoA?.value ?? z2TimeoutAutoMinutes);
    const newManual = Number(z2TimeoutSliders.manualA?.value ?? z2TimeoutManualMinutes);
    const choice = await window.showConfirmModal({
      title: 'Zapret2 blockcheck zamanaşımını değiştir',
      message: `Otomatik mod ${newAuto} dk, Manuel mod ${newManual} dk (DNS protokolü BAŞINA) olarak kaydedilsin mi?`,
      detail: 'Zapret2 şu an aktif bir blockcheck2 taraması yapıyorsa bu tarama durdurulup DNS protokolü sıralamasının başından (DoH) itibaren yeni süreyle sıfırdan yeniden başlatılır. Zaten çalışan/doğrulanmış bir ayarınız varsa dokunulmaz, yeni süre yalnızca bir sonraki taramada geçerli olur.',
    });
    if (choice !== 0) {
      // Kullanıcı "Hayır" dedi -- slider'ları görsel olarak eski konumuna döndürüyoruz,
      // sürmekte olan bir taramaya (varsa) HİÇ dokunmuyoruz.
      applyZ2TimeoutSliderValues();
      updateZ2TimeoutSaveButtonsVisibility();
      window.splitcord.log('zapret2-tier-timeout-change-cancelled', { newAuto, newManual });
      return;
    }

    z2TimeoutChangeInFlight = true;
    if (btnSaveZ2TimeoutA) btnSaveZ2TimeoutA.disabled = true;
    if (btnSaveZ2TimeoutM) btnSaveZ2TimeoutM.disabled = true;
    try {
      await window.splitcord.dpi.setZapret2TierTimeout(newAuto, newManual);
      z2TimeoutAutoMinutes = newAuto;
      z2TimeoutManualMinutes = newManual;
      applyZ2TimeoutSliderValues();
      updateZ2TimeoutSaveButtonsVisibility();
      window.splitcord.log('zapret2-tier-timeout-changed', { newAuto, newManual });

      // Kullanıcı talebi: kayıtlı VE ÇALIŞAN (doğrulanmış) bir ayar varsa blockcheck2'yi
      // yeniden başlatma -- yeni süre yalnızca BİR SONRAKİ gerçek taramada geçerli olsun.
      // Yalnızca Zapret2 şu an GERÇEKTEN aktif bir blockcheck2 taraması yapıyorsa (henüz
      // doğrulanmış/çalışan bir ayarı yoksa) sıfırdan yeniden başlatıyoruz.
      let isZapret2StableAndVerified = false;
      try {
        const freshStatus = await window.splitcord.dpi.getStatus();
        const z2 = freshStatus?.engines?.find((e) => e.id === 'zapret2');
        isZapret2StableAndVerified = !!(z2?.verified && z2?.running);
      } catch (statusErr) {
        window.splitcord.log('zapret2-tier-timeout-status-check-error', { error: statusErr.message });
      }

      if (!isZapret2StableAndVerified) {
        await activateEngine('zapret2');
      } else {
        window.splitcord.log('zapret2-tier-timeout-restart-skipped-stable', {});
        await refreshStatus();
      }
    } catch (err) {
      window.splitcord.log('zapret2-tier-timeout-change-error', { error: err.message });
    } finally {
      z2TimeoutChangeInFlight = false;
      if (btnSaveZ2TimeoutA) btnSaveZ2TimeoutA.disabled = false;
      if (btnSaveZ2TimeoutM) btnSaveZ2TimeoutM.disabled = false;
    }
  };

  btnSaveZ2TimeoutA?.addEventListener('click', handleSave);
  btnSaveZ2TimeoutM?.addEventListener('click', handleSave);
}

// Tarama sürerken (switching=true) sunucu activeEngineId'yi tarama bitene kadar hâlâ
// ÖNCEKİ motoru gösteriyor olarak bırakıyor — bu yüzden "hangi motor şu an geçerli"
// sorulduğunda (varsayılan seçim, Başlatılıyor rozeti) her yerde bunun yerine
// switchingToEngineId'nin işaret ettiği GERÇEK hedefi kullanıyoruz.
function getDisplayActiveEngineId(status) {
  return status.switching && status.switchingToEngineId
    ? status.switchingToEngineId
    : status.activeEngineId;
}

async function refreshStatus() {
  try {
    currentStatus = await window.splitcord.dpi.getStatus();
  } catch (err) {
    currentStatus = null;
    window.splitcord.log('get-status-error', { error: err.message });
    engineListEl.innerHTML = `<div class="sc-hint">DPI servisine ulaşılamıyor: ${escapeHtml(err.message)}<br/>Servisin kurulu ve çalışır durumda olduğundan emin ol (service/installer/install-service.ps1).</div>`;
    automaticStatusEl.textContent = 'DPI servisine ulaşılamıyor.';
    return;
  }
  selectedEngineId = selectedEngineId || getDisplayActiveEngineId(currentStatus);
  renderEngineList();
  await renderAutomaticStatus();
  await refreshLogs();
}

// true olduğu sürece (bir onay sonrası activateEngine çağrısı beklenirken VEYA
// currentStatus.switching sunucu tarafında true olduğunda) TÜM kartlar kilitleniyor
// (blur + dönen çember, tıklamalar yok sayılıyor) — kullanıcı bir geçiş TAMAMEN
// bitmeden/başarısız olmadan başka bir değişiklik tetikleyemesin diye.
let engineSwitchInFlight = false;

function renderEngineList() {
  if (!currentStatus) return;
  selectedEngineId = selectedEngineId || getDisplayActiveEngineId(currentStatus);

  // ByeDPI'ye özgü "uzun argüman listesi" anahtarı Manuel'de yalnızca seçili motor
  // ByeDPI ise gösterilir (Zapret/Zapret2'nin bu ayarla bir ilgisi yok).
  if (byedpiExtendedManualRow) byedpiExtendedManualRow.hidden = selectedEngineId !== 'byedpi';

  // Manuel'deki "Tekrar Arama Başlat" her zaman SEÇİLİ motor için çalışır (Otomatik'teki
  // sabit ByeDPI hedefli sürümünün aksine) — buton metni de seçili motora göre güncelleniyor.
  const selectedEngineForRestart = currentStatus.engines.find((e) => e.id === selectedEngineId);
  if (btnRestartSearchManual) {
    btnRestartSearchManual.textContent = selectedEngineForRestart
      ? `${selectedEngineForRestart.displayName} İçin Tekrar Arama Başlat`
      : 'Tekrar Arama Başlat';
  }
  if (restartSearchManualWrap) {
    restartSearchManualWrap.classList.toggle('sc-restart-search--locked', currentStatus.switching);
  }

  engineListEl.innerHTML = '';

  const displayActiveEngineId = getDisplayActiveEngineId(currentStatus);
  // modeSwitchInFlight: Manuel<->Otomatik geçişi sürerken (bkz. initDpiMode) — geçiş
  // bitene kadar Manuel görünümü hâlâ ekranda kalabiliyor (view değişimi en sonda
  // yapılıyor), bu yüzden kartlar da mod switch'iyle AYNI anda kilitlenip blur+spinner
  // göstermeli, yalnızca sürmekte olan bir taramaya (currentStatus.switching) değil.
  const isLocked = engineSwitchInFlight || currentStatus.switching || modeSwitchInFlight;

  for (const engine of currentStatus.engines) {
    const isActive = engine.id === displayActiveEngineId;
    const isSelected = engine.id === selectedEngineId;

    if (isSelected && lastPrefilledFor !== selectedEngineId) {
      argsTextarea.value = engine.args ?? '';
      lastPrefilledFor = selectedEngineId;
    }

    const card = document.createElement('div');
    card.className = `sc-engine-card${isSelected ? ' selected' : ''}${isLocked ? ' sc-engine-card--locked' : ''}`;
    card.innerHTML = `
      <div class="sc-engine-card-content">
        <div>
          <div class="sc-engine-name">${escapeHtml(engine.displayName)}</div>
          <div class="sc-engine-desc">${escapeHtml(ENGINE_DESCRIPTIONS[engine.id] ?? '')}</div>
        </div>
        <div class="sc-engine-badges">
          ${
            isActive
              ? `<span class="sc-engine-badge${engine.running ? ' sc-engine-badge--running' : ''}">${engine.running ? 'Aktif' : 'Başlatılıyor'}</span>`
              : '<span class="sc-engine-badge">Pasif</span>'
          }
          ${engine.requiresSystemWideAccess ? '<span class="sc-engine-badge sc-engine-badge--system">Sistem geneli</span>' : ''}
        </div>
      </div>
      <div class="sc-engine-card-spinner"></div>
    `;
    card.addEventListener('click', async () => {
      // Kilitliyken (bu kartın oluşturulduğu andan sonra bir geçiş başlamış olabilir)
      // tıklamayı yok say — engineSwitchInFlight/currentStatus.switching'i CANLI okuyoruz,
      // kartın oluşturulduğu andaki isLocked anlık görüntüsüne değil.
      if (engineSwitchInFlight || currentStatus?.switching) return;

      if (engine.id === getDisplayActiveEngineId(currentStatus)) return;

      // selectedEngineId (ve dolayısıyla highlight/argüman metin kutusu) onaydan ÖNCE
      // DEĞİŞTİRİLMİYOR — "Hayır" denildiğinde highlight'ın yine de tıklanan karta
      // geçmesine yol açıyordu. Yalnızca kullanıcı GERÇEKTEN onaylarsa güncelleniyor.
      const choice = await window.showConfirmModal({
        title: 'DPI Aşımı yöntemi değişecek',
        message: `Aktif DPI aşım yöntemi "${escapeHtml(engine.displayName)}" olarak değiştirilsin mi?`,
        detail: 'Yöntem değişikliği önceki motorun durdurulup yenisinin başlatılmasına neden olur, bu da Discord bağlantısının kısa süreliğine kesilmesine yol açabilir.',
      });
      if (choice !== 0) {
        window.splitcord.log('engine-switch-cancelled', { id: engine.id });
        return;
      }

      selectedEngineId = engine.id;
      argsTextarea.value = engine.args ?? '';
      lastPrefilledFor = selectedEngineId;

      engineSwitchInFlight = true;
      renderEngineList();
      try {
        await activateEngine(engine.id);
      } finally {
        engineSwitchInFlight = false;
        renderEngineList();
      }
    });
    engineListEl.appendChild(card);
  }
}

async function activateEngine(id) {
  window.splitcord.log('engine-activate-click', { id });
  try {
    await window.splitcord.dpi.activateEngine(id);
  } catch (err) {
    console.error(err);
    window.splitcord.log('engine-activate-error', { id, error: err.message });
  }
  await refreshStatus();
}

async function refreshLogs() {
  if (!selectedEngineId) return;
  try {
    const logs = await window.splitcord.dpi.getLogs(selectedEngineId);
    logsBox.textContent = logs.length ? logs.join('\n') : '(henüz log yok)';
  } catch {
    logsBox.textContent = '—';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

document.getElementById('btn-close-settings').addEventListener('click', () => {
  window.splitcord.log('settings-close-button-click', {});
  window.splitcord.window.closeSettings();
});

document.getElementById('btn-save-args').addEventListener('click', async () => {
  if (!selectedEngineId) return;
  window.splitcord.log('save-args-click', { id: selectedEngineId, args: argsTextarea.value });
  try {
    // Manuel moddaki her ayar değişikliği yeniden başlatma onayı istiyor (bkz. ipc.js
    // dpi:set-args handler'ı) — kullanıcı "Hayır" derse ayar kaydedilir ama motor
    // dokunulmadan bırakılır.
    await window.splitcord.dpi.setArgs(selectedEngineId, argsTextarea.value, { confirmRestart: true });
  } catch (err) {
    console.error(err);
    window.splitcord.log('save-args-error', { id: selectedEngineId, error: err.message });
  }
  await refreshStatus();
});

function selectPanel(panelId) {
  const item = document.querySelector(`.sc-settings-nav-item[data-panel="${panelId}"]`);
  if (!item) return;
  document.querySelectorAll('.sc-settings-nav-item').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.sc-panel').forEach((el) => {
    el.hidden = true;
  });
  item.classList.add('active');
  document.getElementById(panelId).hidden = false;
}

// Belirli bir kontrolü (ör. bir toggle satırını) geçici olarak vurgulamak için — Discord
// webview'indeki "SplitCord-Turkey ayarlarında bu uyarıyı devre dışı bırak" gibi butonlar
// kullanıcıyı doğrudan ilgili ayara götürüyor (bkz. discordWebviewPreload.js).
function highlightControl(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('sc-highlight-flash');
  // Aynı öğe art arda birden fazla kez vurgulanmak istenirse animasyonun yeniden
  // BAŞLAMASI için bir reflow tetikliyoruz — sınıf zaten varken tekrar eklemek CSS
  // animasyonunu yeniden tetiklemez.
  void el.offsetWidth;
  el.classList.add('sc-highlight-flash');
  setTimeout(() => el.classList.remove('sc-highlight-flash'), 2200);
}

function navigateToPanel(panelId, highlightId) {
  if (!panelId || !document.getElementById(panelId)) return;
  selectPanel(panelId);
  if (highlightId) {
    // Panel geçişinin/DOM'un oturması için bir sonraki frame'i bekle.
    requestAnimationFrame(() => highlightControl(highlightId));
  }
}

document.querySelectorAll('.sc-settings-nav-item').forEach((item) => {
  item.addEventListener('click', () => selectPanel(item.dataset.panel));
});

// Titlebar'daki "Eylem Gerekli" gibi butonlar ya da Discord webview içindeki bilgi
// notları (ör. sesli uyarı devre dışı bırakma butonu) ayarları doğrudan belirli bir
// sekmeyle (ve isteğe bağlı olarak belirli bir kontrolü vurgulayarak) açabiliyor — bu,
// pencere ilk kez açılırken URL hash'i olarak ("panel-general|row-..." biçiminde),
// zaten açıkken de bir IPC olayı (panel, highlight) olarak gelir.
if (location.hash) {
  const [panelId, highlightId] = location.hash.slice(1).split('|');
  navigateToPanel(panelId, highlightId);
}
window.splitcord.onSettingsNavigate?.((panelId, highlightId) => navigateToPanel(panelId, highlightId));

const autostartToggle = document.getElementById('toggle-autostart');
const startInBackgroundToggle = document.getElementById('toggle-start-in-background');
const rowStartInBackground = document.getElementById('row-start-in-background');
const gpuToggle = document.getElementById('toggle-gpu');
const quicToggle = document.getElementById('toggle-quic');
const openLinksExternallyToggle = document.getElementById('toggle-open-links-externally');
const linkOpenerNewWindowToggle = document.getElementById('toggle-link-opener-new-window');
const performanceModeToggle = document.getElementById('toggle-performance-mode');
const notificationBadgeToggle = document.getElementById('toggle-notification-badge');
const disableFalseVoiceWarningToggle = document.getElementById('toggle-disable-false-voice-warning');
const dnsProvidersListEl = document.getElementById('dns-providers-list');
const unsavedBar = document.getElementById('unsaved-bar');
const btnSaveChanges = document.getElementById('btn-save-changes');
const btnDiscardChanges = document.getElementById('btn-discard-changes');

// TÜM ayarlar penceresindeki toggle'lar aynı ertelenmiş kaydetme desenini kullanıyor
// (tutarlılık için — bazıları anında uygulansa bile "Kaydedilmemiş değişiklikleriniz
// var" çubuğu her toggle değişiminde görünüyor). "change" dinleyicileri KASITLI
// olarak başlangıç değeri IPC'den gelip uygulanana kadar bağlanmıyor — dinleyici
// hemen bağlanıp initial değer hâlâ null iken bir şekilde tetiklendiğinde
// (ör. tarayıcının form durumu geri yükleme davranışı), checked !== null olduğu için
// "değişiklik var" sanılıp bar'ın gerçekte hiçbir şey değişmediği halde görünmesine
// yol açıyordu.
const initialGeneral = {
  autostart: null,
  startInBackground: null,
  gpuAcceleration: null,
  quicDisabled: null,
  openLinksExternally: null,
  linkOpenerNewWindow: null,
  performanceMode: null,
  notificationBadge: null,
  disableFalseVoiceWarning: null,
};
let pendingGeneral = {};

function updateUnsavedBar() {
  const dirty = Object.keys(pendingGeneral).length > 0;
  unsavedBar.hidden = !dirty;
  window.splitcord.window.setDirty(dirty);
}

// "Arkaplanda başlat" satırı yalnızca "Sistem ile başlat" işaretliyken (ya da
// kaydedilmemiş bir değişiklikle işaretlenmek üzereyken) anlamlı — currentAutostart
// hem başlangıç değerini hem de henüz kaydedilmemiş kullanıcı seçimini yansıtıyor.
function updateStartInBackgroundVisibility() {
  const currentAutostart = 'autostart' in pendingGeneral ? pendingGeneral.autostart : initialGeneral.autostart;
  rowStartInBackground.hidden = !currentAutostart;
}

// "change" dinleyicileri KASITLI olarak başlangıç değeri IPC'den gelip uygulanana
// kadar bağlanmıyor — daha önce dinleyici hemen bağlanıp initialGeneral hâlâ null
// iken bir şekilde tetiklendiğinde (ör. tarayıcının form durumu geri yükleme
// davranışı), checked !== null olduğu için "değişiklik var" sanılıp bar'ın
// gerçekte hiçbir şey değişmediği halde görünmesine yol açıyordu.
async function initAutoStartToggle() {
  let value = autostartToggle.checked;
  try {
    value = await window.splitcord.app.getAutoStart();
    autostartToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-autostart-error', { error: err.message });
  }
  initialGeneral.autostart = value;
  updateStartInBackgroundVisibility();

  autostartToggle.addEventListener('change', () => {
    if (autostartToggle.checked === initialGeneral.autostart) {
      delete pendingGeneral.autostart;
    } else {
      pendingGeneral.autostart = autostartToggle.checked;
    }
    window.splitcord.log('autostart-toggle-changed', { checked: autostartToggle.checked });
    updateStartInBackgroundVisibility();
    updateUnsavedBar();
  });
}

async function initStartInBackgroundToggle() {
  let value = startInBackgroundToggle.checked;
  try {
    value = await window.splitcord.app.getStartInBackground();
    startInBackgroundToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-start-in-background-error', { error: err.message });
  }
  initialGeneral.startInBackground = value;

  startInBackgroundToggle.addEventListener('change', () => {
    if (startInBackgroundToggle.checked === initialGeneral.startInBackground) {
      delete pendingGeneral.startInBackground;
    } else {
      pendingGeneral.startInBackground = startInBackgroundToggle.checked;
    }
    window.splitcord.log('start-in-background-toggle-changed', { checked: startInBackgroundToggle.checked });
    updateUnsavedBar();
  });
}

async function initGpuToggle() {
  let value = gpuToggle.checked;
  try {
    value = await window.splitcord.app.getGpuAcceleration();
    gpuToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-gpu-acceleration-error', { error: err.message });
  }
  initialGeneral.gpuAcceleration = value;

  gpuToggle.addEventListener('change', () => {
    if (gpuToggle.checked === initialGeneral.gpuAcceleration) {
      delete pendingGeneral.gpuAcceleration;
    } else {
      pendingGeneral.gpuAcceleration = gpuToggle.checked;
    }
    window.splitcord.log('gpu-toggle-changed', { checked: gpuToggle.checked });
    updateUnsavedBar();
  });
}

async function initQuicToggle() {
  let value = quicToggle.checked;
  try {
    value = await window.splitcord.app.getQuicDisabled();
    quicToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-quic-disabled-error', { error: err.message });
  }
  initialGeneral.quicDisabled = value;

  quicToggle.addEventListener('change', () => {
    if (quicToggle.checked === initialGeneral.quicDisabled) {
      delete pendingGeneral.quicDisabled;
    } else {
      pendingGeneral.quicDisabled = quicToggle.checked;
    }
    window.splitcord.log('quic-toggle-changed', { checked: quicToggle.checked });
    updateUnsavedBar();
  });
}

async function initOpenLinksExternallyToggle() {
  let value = openLinksExternallyToggle.checked;
  try {
    value = await window.splitcord.app.getOpenLinksExternally();
    openLinksExternallyToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-open-links-externally-error', { error: err.message });
  }
  initialGeneral.openLinksExternally = value;

  openLinksExternallyToggle.addEventListener('change', () => {
    if (openLinksExternallyToggle.checked === initialGeneral.openLinksExternally) {
      delete pendingGeneral.openLinksExternally;
    } else {
      pendingGeneral.openLinksExternally = openLinksExternallyToggle.checked;
    }
    window.splitcord.log('open-links-externally-toggle-changed', { checked: openLinksExternallyToggle.checked });
    updateUnsavedBar();
  });
}

async function initLinkOpenerNewWindowToggle() {
  let value = linkOpenerNewWindowToggle.checked;
  try {
    value = await window.splitcord.app.getLinkOpenerNewWindow();
    linkOpenerNewWindowToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-link-opener-new-window-error', { error: err.message });
  }
  initialGeneral.linkOpenerNewWindow = value;

  linkOpenerNewWindowToggle.addEventListener('change', () => {
    if (linkOpenerNewWindowToggle.checked === initialGeneral.linkOpenerNewWindow) {
      delete pendingGeneral.linkOpenerNewWindow;
    } else {
      pendingGeneral.linkOpenerNewWindow = linkOpenerNewWindowToggle.checked;
    }
    window.splitcord.log('link-opener-new-window-toggle-changed', { checked: linkOpenerNewWindowToggle.checked });
    updateUnsavedBar();
  });
}

async function initPerformanceModeToggle() {
  let value = performanceModeToggle.checked;
  try {
    value = await window.splitcord.app.getPerformanceMode();
    performanceModeToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-performance-mode-error', { error: err.message });
  }
  initialGeneral.performanceMode = value;

  performanceModeToggle.addEventListener('change', () => {
    if (performanceModeToggle.checked === initialGeneral.performanceMode) {
      delete pendingGeneral.performanceMode;
    } else {
      pendingGeneral.performanceMode = performanceModeToggle.checked;
    }
    window.splitcord.log('performance-mode-toggle-changed', { checked: performanceModeToggle.checked });
    updateUnsavedBar();
  });
}

async function initNotificationBadgeToggle() {
  let value = notificationBadgeToggle.checked;
  try {
    value = await window.splitcord.app.getNotificationBadgeEnabled();
    notificationBadgeToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-notification-badge-enabled-error', { error: err.message });
  }
  initialGeneral.notificationBadge = value;

  notificationBadgeToggle.addEventListener('change', () => {
    if (notificationBadgeToggle.checked === initialGeneral.notificationBadge) {
      delete pendingGeneral.notificationBadge;
    } else {
      pendingGeneral.notificationBadge = notificationBadgeToggle.checked;
    }
    window.splitcord.log('notification-badge-toggle-changed', { checked: notificationBadgeToggle.checked });
    updateUnsavedBar();
  });
}

async function initDisableFalseVoiceWarningToggle() {
  let value = disableFalseVoiceWarningToggle.checked;
  try {
    value = await window.splitcord.app.getDisableFalseVoiceWarning();
    disableFalseVoiceWarningToggle.checked = value;
  } catch (err) {
    console.error(err);
    window.splitcord.log('get-disable-false-voice-warning-error', { error: err.message });
  }
  initialGeneral.disableFalseVoiceWarning = value;

  disableFalseVoiceWarningToggle.addEventListener('change', () => {
    if (disableFalseVoiceWarningToggle.checked === initialGeneral.disableFalseVoiceWarning) {
      delete pendingGeneral.disableFalseVoiceWarning;
    } else {
      pendingGeneral.disableFalseVoiceWarning = disableFalseVoiceWarningToggle.checked;
    }
    window.splitcord.log('disable-false-voice-warning-toggle-changed', { checked: disableFalseVoiceWarningToggle.checked });
    updateUnsavedBar();
  });
}

// --- Görünüm > Tema seçici (anında uygulanır, DPI Otomatik/Manuel toggle'ıyla aynı
// desen — bir renk paletini "önizleyip sonra kaydet" değil, doğrudan seçmek daha
// doğal olduğu için kaydedilmemiş değişiklikler akışına dahil edilmiyor). ---
let currentThemeMode = 'automatic';

function applyThemeSwatchActiveState() {
  document.querySelectorAll('.sc-theme-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === currentThemeMode);
  });
}

async function initThemePicker() {
  try {
    currentThemeMode = await window.splitcord.app.getThemeMode();
  } catch (err) {
    window.splitcord.log('get-theme-mode-error', { error: err.message });
  }
  applyThemeSwatchActiveState();

  document.querySelectorAll('.sc-theme-swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.theme;
      if (mode === currentThemeMode) return;
      window.splitcord.log('theme-mode-changed', { mode });
      try {
        currentThemeMode = await window.splitcord.app.setThemeMode(mode);
      } catch (err) {
        window.splitcord.log('set-theme-mode-error', { mode, error: err.message });
      }
      applyThemeSwatchActiveState();
    });
  });
}

btnSaveChanges.addEventListener('click', async () => {
  window.splitcord.log('save-changes-click', { pending: { ...pendingGeneral } });
  btnSaveChanges.disabled = true;
  try {
    if ('autostart' in pendingGeneral) {
      await window.splitcord.app.setAutoStart(pendingGeneral.autostart);
      initialGeneral.autostart = pendingGeneral.autostart;
      delete pendingGeneral.autostart;
      updateStartInBackgroundVisibility();
    }
    if ('startInBackground' in pendingGeneral) {
      await window.splitcord.app.setStartInBackground(pendingGeneral.startInBackground);
      initialGeneral.startInBackground = pendingGeneral.startInBackground;
      delete pendingGeneral.startInBackground;
    }
    if ('openLinksExternally' in pendingGeneral) {
      await window.splitcord.app.setOpenLinksExternally(pendingGeneral.openLinksExternally);
      initialGeneral.openLinksExternally = pendingGeneral.openLinksExternally;
      delete pendingGeneral.openLinksExternally;
    }
    if ('linkOpenerNewWindow' in pendingGeneral) {
      await window.splitcord.app.setLinkOpenerNewWindow(pendingGeneral.linkOpenerNewWindow);
      initialGeneral.linkOpenerNewWindow = pendingGeneral.linkOpenerNewWindow;
      delete pendingGeneral.linkOpenerNewWindow;
    }
    if ('performanceMode' in pendingGeneral) {
      await window.splitcord.app.setPerformanceMode(pendingGeneral.performanceMode);
      initialGeneral.performanceMode = pendingGeneral.performanceMode;
      delete pendingGeneral.performanceMode;
    }
    if ('notificationBadge' in pendingGeneral) {
      await window.splitcord.app.setNotificationBadgeEnabled(pendingGeneral.notificationBadge);
      initialGeneral.notificationBadge = pendingGeneral.notificationBadge;
      delete pendingGeneral.notificationBadge;
    }
    if ('disableFalseVoiceWarning' in pendingGeneral) {
      await window.splitcord.app.setDisableFalseVoiceWarning(pendingGeneral.disableFalseVoiceWarning);
      initialGeneral.disableFalseVoiceWarning = pendingGeneral.disableFalseVoiceWarning;
      delete pendingGeneral.disableFalseVoiceWarning;
    }
    if ('gpuAcceleration' in pendingGeneral) {
      // ipc.js artık burada bir "yeniden başlatılsın mı?" onay diyaloğu gösteriyor.
      // Onaylanırsa uygulama gerçekten kapanıp yeniden açılacak (bu pencere de
      // onunla kapanacak, aşağıdaki temizliğe gerek kalmıyor) — dönen değer
      // istenen değerle AYNIYSA bu olmuş demektir. Kullanıcı "Hayır" derse dönen
      // değer DEĞİŞMEMİŞ (eski) değerdir — checkbox'ı gerçek duruma geri alıyoruz.
      const applied = await window.splitcord.app.setGpuAcceleration(pendingGeneral.gpuAcceleration);
      if (applied === pendingGeneral.gpuAcceleration) {
        return;
      }
      window.splitcord.log('gpu-acceleration-change-cancelled', {});
      gpuToggle.checked = applied;
      initialGeneral.gpuAcceleration = applied;
      delete pendingGeneral.gpuAcceleration;
    }
    if ('quicDisabled' in pendingGeneral) {
      // bkz. yukarıdaki gpuAcceleration bloğundaki AYNI not -- ipc.js'teki
      // app:set-quic-disabled da kendi onay diyaloğunu gösterip onaylanırsa
      // uygulamayı yeniden başlatıyor.
      const applied = await window.splitcord.app.setQuicDisabled(pendingGeneral.quicDisabled);
      if (applied === pendingGeneral.quicDisabled) {
        return;
      }
      window.splitcord.log('quic-disabled-change-cancelled', {});
      quicToggle.checked = applied;
      initialGeneral.quicDisabled = applied;
      delete pendingGeneral.quicDisabled;
    }
    updateUnsavedBar();
  } catch (err) {
    console.error(err);
    window.splitcord.log('save-changes-error', { error: err.message });
  } finally {
    btnSaveChanges.disabled = false;
  }
});

btnDiscardChanges.addEventListener('click', () => {
  window.splitcord.log('discard-changes-click', { pending: { ...pendingGeneral } });
  // Her togglei GERÇEKTE kaydedilmiş son değerine (initialGeneral) geri alıyoruz —
  // henüz uygulanmamış pendingGeneral'i tamamen atıyoruz.
  if ('autostart' in pendingGeneral) autostartToggle.checked = initialGeneral.autostart;
  if ('startInBackground' in pendingGeneral) startInBackgroundToggle.checked = initialGeneral.startInBackground;
  if ('gpuAcceleration' in pendingGeneral) gpuToggle.checked = initialGeneral.gpuAcceleration;
  if ('quicDisabled' in pendingGeneral) quicToggle.checked = initialGeneral.quicDisabled;
  if ('openLinksExternally' in pendingGeneral) openLinksExternallyToggle.checked = initialGeneral.openLinksExternally;
  if ('linkOpenerNewWindow' in pendingGeneral) linkOpenerNewWindowToggle.checked = initialGeneral.linkOpenerNewWindow;
  if ('performanceMode' in pendingGeneral) performanceModeToggle.checked = initialGeneral.performanceMode;
  if ('notificationBadge' in pendingGeneral) notificationBadgeToggle.checked = initialGeneral.notificationBadge;
  if ('disableFalseVoiceWarning' in pendingGeneral) disableFalseVoiceWarningToggle.checked = initialGeneral.disableFalseVoiceWarning;
  pendingGeneral = {};
  updateStartInBackgroundVisibility();
  updateUnsavedBar();
});

// --- Tuş Atamaları (anında uygulanır — ertelenmiş "Kaydedilmemiş değişiklikler"
// akışına dahil DEĞİL, DPI Otomatik/Manuel ve tema seçici gibi anında etkili). ---
const shortcutsEnabledToggle = document.getElementById('toggle-shortcuts-enabled');
const shortcutsList = document.getElementById('shortcuts-list');
const shortcutsHint = document.getElementById('shortcuts-hint');
const SHORTCUT_ACTIONS = ['toggleMute', 'toggleDeafen', 'disconnect', 'bringToFront', 'minimizeToTray'];
let currentShortcuts = {};
let recordingAction = null;
let recordingKeydownHandler = null;

function formatAccelerator(accelerator) {
  if (!accelerator) return 'Atanmamış';
  return accelerator.replace('CommandOrControl', 'Ctrl');
}

function renderShortcutRow(action) {
  const btn = shortcutsList.querySelector(`.sc-shortcut-input[data-action="${action}"]`);
  if (!btn) return;
  btn.textContent = formatAccelerator(currentShortcuts[action]);
  btn.classList.remove('sc-shortcut-recording');
}

function renderAllShortcutRows() {
  SHORTCUT_ACTIONS.forEach(renderShortcutRow);
}

// Global kısayol için en az bir değiştirici (Ctrl/Alt/Shift/Win) zorunlu tutuluyor —
// aksi halde sıradan yazarken bile tetiklenecek, sistem genelinde tehlikeli bir
// kombinasyon (ör. yalnızca "A") kaydedilebilirdi.
const SHORTCUT_SPECIAL_KEY_MAP = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Enter: 'Return',
};

function acceleratorKeyFromEvent(event) {
  const key = event.key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (SHORTCUT_SPECIAL_KEY_MAP[key]) return SHORTCUT_SPECIAL_KEY_MAP[key];
  return null;
}

function isModifierKey(key) {
  return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta';
}

function stopRecording(action, keepCustomLabel) {
  if (recordingKeydownHandler) {
    window.removeEventListener('keydown', recordingKeydownHandler, true);
    recordingKeydownHandler = null;
  }
  recordingAction = null;
  if (!keepCustomLabel) renderShortcutRow(action);
}

async function finishRecording(action, btn, accelerator) {
  stopRecording(action, true);

  const duplicateAction = SHORTCUT_ACTIONS.find((a) => a !== action && currentShortcuts[a] === accelerator);
  if (duplicateAction) {
    shortcutsHint.textContent = 'Bu kombinasyon zaten başka bir eyleme atanmış.';
    renderShortcutRow(action);
    return;
  }

  btn.textContent = formatAccelerator(accelerator);
  try {
    const result = await window.splitcord.app.setShortcutBinding(action, accelerator);
    currentShortcuts = result.bindings;
    shortcutsHint.textContent = result.ok
      ? ''
      : 'Bu tuş kombinasyonu başka bir uygulama tarafından zaten kullanılıyor olabilir, kaydedilemedi.';
    if (!result.ok) window.splitcord.log('shortcut-register-failed', { action, accelerator });
    renderShortcutRow(action);
  } catch (err) {
    window.splitcord.log('set-shortcut-binding-error', { action, error: err.message });
    renderShortcutRow(action);
  }
}

function startRecording(action) {
  if (recordingAction) stopRecording(recordingAction, false);
  recordingAction = action;
  const btn = shortcutsList.querySelector(`.sc-shortcut-input[data-action="${action}"]`);
  btn.textContent = 'Tuşlara basın… (Esc: iptal)';
  btn.classList.add('sc-shortcut-recording');
  shortcutsHint.textContent = '';

  recordingKeydownHandler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stopRecording(action, false);
      return;
    }
    if (isModifierKey(event.key)) return;

    const parts = [];
    if (event.ctrlKey) parts.push('CommandOrControl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Super');

    if (parts.length === 0) {
      btn.textContent = 'En az bir değiştirici tuş gerekli (Ctrl/Alt/Shift)…';
      return;
    }

    const mainKey = acceleratorKeyFromEvent(event);
    if (!mainKey) {
      btn.textContent = 'Desteklenmeyen tuş, başka bir tuş deneyin…';
      return;
    }

    parts.push(mainKey);
    finishRecording(action, btn, parts.join('+'));
  };
  window.addEventListener('keydown', recordingKeydownHandler, true);
}

shortcutsList?.querySelectorAll('.sc-shortcut-input').forEach((btn) => {
  btn.addEventListener('click', () => startRecording(btn.dataset.action));
});

shortcutsList?.querySelectorAll('.sc-shortcut-clear').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    if (recordingAction === action) stopRecording(action, false);
    try {
      const result = await window.splitcord.app.setShortcutBinding(action, '');
      currentShortcuts = result.bindings;
      shortcutsHint.textContent = '';
      renderShortcutRow(action);
    } catch (err) {
      window.splitcord.log('clear-shortcut-binding-error', { action, error: err.message });
    }
  });
});

async function initShortcutsPanel() {
  try {
    const { enabled, bindings } = await window.splitcord.app.getShortcuts();
    shortcutsEnabledToggle.checked = enabled;
    shortcutsList?.classList.toggle('sc-shortcuts-disabled', !enabled);
    currentShortcuts = bindings || {};
  } catch (err) {
    window.splitcord.log('get-shortcuts-error', { error: err.message });
    currentShortcuts = {};
  }
  renderAllShortcutRows();

  shortcutsEnabledToggle.addEventListener('change', async () => {
    const enabled = shortcutsEnabledToggle.checked;
    shortcutsList?.classList.toggle('sc-shortcuts-disabled', !enabled);
    window.splitcord.log('shortcuts-enabled-toggle-changed', { enabled });
    try {
      await window.splitcord.app.setShortcutsEnabled(enabled);
    } catch (err) {
      window.splitcord.log('set-shortcuts-enabled-error', { error: err.message });
    }
  });
}

initShortcutsPanel();

const DNS_PROTOCOL_LABELS = {
  doh: 'DNS-over-HTTPS',
  dot: 'DNS-over-TLS',
  doq: 'DNS-over-QUIC',
  dnscrypt: 'DNSCrypt',
};

const DNS_PROTOCOL_PLACEHOLDERS = {
  doh: 'https://dns.google/dns-query',
  dot: '1.1.1.1:853',
  doq: 'dns.adguard-dns.com:853',
  dnscrypt: 'sdns://...',
};

// Sunucudan gelen/kaydedilecek çalışma kopyası -- her satır { protocol, address }.
let dnsProviderRows = [];

function renderDnsProviderRows() {
  dnsProvidersListEl.innerHTML = '';
  dnsProviderRows.forEach((row, index) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'sc-dns-provider-row';
    rowEl.innerHTML = `
      <select class="sc-dns-provider-protocol">
        ${Object.entries(DNS_PROTOCOL_LABELS)
          .map(([value, label]) => `<option value="${value}"${row.protocol === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
          .join('')}
      </select>
      <input type="text" class="sc-dns-provider-address" value="${escapeHtml(row.address ?? '')}" placeholder="${escapeHtml(DNS_PROTOCOL_PLACEHOLDERS[row.protocol] ?? '')}" />
      <button type="button" class="sc-dns-provider-remove" title="Kaldır">✕</button>
    `;

    rowEl.querySelector('.sc-dns-provider-protocol').addEventListener('change', (e) => {
      dnsProviderRows[index].protocol = e.target.value;
      renderDnsProviderRows();
    });
    rowEl.querySelector('.sc-dns-provider-address').addEventListener('input', (e) => {
      dnsProviderRows[index].address = e.target.value;
    });
    rowEl.querySelector('.sc-dns-provider-remove').addEventListener('click', () => {
      dnsProviderRows.splice(index, 1);
      renderDnsProviderRows();
    });

    dnsProvidersListEl.appendChild(rowEl);
  });
}

async function initDnsProviders() {
  try {
    const providers = await window.splitcord.dpi.getDnsProviders();
    dnsProviderRows = (providers ?? []).map((p) => ({ protocol: p.protocol, address: p.address }));
  } catch (err) {
    dnsProviderRows = [];
    console.error(err);
    window.splitcord.log('get-dns-providers-error', { error: err.message });
  }
  renderDnsProviderRows();
}

document.getElementById('btn-add-dns-provider').addEventListener('click', () => {
  dnsProviderRows.push({ protocol: 'doh', address: '' });
  renderDnsProviderRows();
});

document.getElementById('btn-save-dns-providers').addEventListener('click', async () => {
  const providers = dnsProviderRows
    .map((row) => ({ protocol: row.protocol, address: (row.address ?? '').trim() }))
    .filter((row) => row.address.length > 0);
  window.splitcord.log('save-dns-providers-click', { providers });
  try {
    const saved = await window.splitcord.dpi.setDnsProviders(providers);
    dnsProviderRows = (saved ?? []).map((p) => ({ protocol: p.protocol, address: p.address }));
    renderDnsProviderRows();
  } catch (err) {
    console.error(err);
    window.splitcord.log('save-dns-providers-error', { providers, error: err.message });
    showTemporaryError(err.message);
  }
});

// --- "Görmezden Gel" — İzinler ve Kontroller'deki herhangi bir sorun için titlebar'daki
// genel "Eylem Gerekli" göstergesini bastırma (bkz. ipc.js app:get-controls-issue-status).
// Kontroller/İzinler listesi sorunu GÖSTERMEYE devam eder — yalnızca titlebar uyarısı
// bu sorun türü için bastırılır, başka görmezden gelinmemiş bir sorun varsa buton yine
// de görünür kalır (hasIssue hesaplaması ipc.js tarafında yapılıyor).
let ignoredControlIssues = new Set();

async function loadIgnoredControlIssues() {
  try {
    const list = await window.splitcord.app.getIgnoredControlIssues();
    ignoredControlIssues = new Set(list ?? []);
  } catch (err) {
    window.splitcord.log('get-ignored-control-issues-error', { error: err.message });
  }
}

async function toggleIgnoreControlIssue(issueId) {
  const nextIgnored = !ignoredControlIssues.has(issueId);
  window.splitcord.log('control-issue-ignore-toggle', { issueId, ignored: nextIgnored });
  try {
    const list = await window.splitcord.app.setControlIssueIgnored(issueId, nextIgnored);
    ignoredControlIssues = new Set(list ?? []);
  } catch (err) {
    window.splitcord.log('control-issue-ignore-toggle-error', { issueId, error: err.message });
  }
}

// Dinamik olarak yeniden oluşturulan satırlar (Kontroller listesi) için — her çağrıda
// yeni bir buton döner.
function makeIgnoreButton(issueId) {
  const isIgnored = ignoredControlIssues.has(issueId);
  const btn = document.createElement('button');
  btn.className = 'sc-btn';
  btn.textContent = isIgnored ? 'Tekrar Göster' : 'Görmezden Gel';
  btn.title = isIgnored
    ? 'Bu sorun için titlebar\'daki "Eylem Gerekli" uyarısı gizlendi — tekrar göstermek için tıkla.'
    : 'Bu sorun için titlebar\'daki "Eylem Gerekli" uyarısını gizle (başka görmezden gelinmemiş bir sorun yoksa buton kaybolur).';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await toggleIgnoreControlIssue(issueId);
    await refreshSystemControls();
  });
  return btn;
}

// Statik satırlar (Güvenlik Duvarı İzni, Resmi Discord Uygulaması) için — buton bir kez
// oluşturulup satıra ekleniyor, her yenilemede yalnızca etiketi güncelleniyor (aynı satırın
// diğer elemanları gibi, bkz. refreshFirewallPermission/refreshProtocolHandlerStatus).
function attachStaticIgnoreToggle(containerEl, issueId, onChanged) {
  const btn = document.createElement('button');
  btn.className = 'sc-btn';
  containerEl.appendChild(btn);

  function render() {
    const isIgnored = ignoredControlIssues.has(issueId);
    btn.textContent = isIgnored ? 'Tekrar Göster' : 'Görmezden Gel';
    btn.title = isIgnored
      ? 'Bu sorun için titlebar\'daki "Eylem Gerekli" uyarısı gizlendi — tekrar göstermek için tıkla.'
      : 'Bu sorun için titlebar\'daki "Eylem Gerekli" uyarısını gizle (başka görmezden gelinmemiş bir sorun yoksa buton kaybolur).';
  }
  render();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await toggleIgnoreControlIssue(issueId);
    render();
    btn.disabled = false;
    if (onChanged) onChanged();
  });

  return { btn, render };
}

loadIgnoredControlIssues();

// --- İzinler paneli ---
// Windows karşılığındaki Güvenlik Duvarı izin kartları (hem ciadpi hem de uygulamanın kendisi
// için) BİLEREK YOK — Linux'ta loopback trafiği normalde hiç filtrelenmediği için bu kavram
// gerekmiyor (bkz. PORTING_PLAN.md D-9, ipc.js/preload.js'te de karşılık gelen kod yok).

// --- Discord uygulaması ---
const discordAppIconEl = document.getElementById('permission-discord-app-icon');
const discordAppLabelEl = document.getElementById('permission-discord-app-label');
const btnUninstallDiscord = document.getElementById('btn-uninstall-discord');
const discordAppIgnoreToggle = attachStaticIgnoreToggle(
  btnUninstallDiscord.parentElement,
  'official-discord',
);

async function refreshProtocolHandlerStatus() {
  try {
    const { officialDiscordInstalled } = await window.splitcord.app.getProtocolHandlerStatus();
    // Burada "iyi" durum resmi Discord uygulamasının KURULU OLMAMASI (SplitCord onunla
    // aynı 'discord:' protokolünü/deep-link akışlarını paylaşıyor) — bu yüzden ikon VE
    // metin, ham officialDiscordInstalled değerine göre değişiyor.
    discordAppIconEl.textContent = officialDiscordInstalled ? '✗' : '✓';
    discordAppIconEl.className = `sc-permission-icon ${officialDiscordInstalled ? 'sc-permission-icon--missing' : 'sc-permission-icon--ok'}`;
    discordAppLabelEl.textContent = officialDiscordInstalled
      ? 'Resmi Discord uygulaması yüklü, çakışma yaşanabilir'
      : 'Resmi Discord uygulaması yüklü değil';
    btnUninstallDiscord.hidden = !officialDiscordInstalled;
    discordAppIgnoreToggle.btn.hidden = !officialDiscordInstalled;
    discordAppIgnoreToggle.render();
  } catch (err) {
    window.splitcord.log('get-protocol-handler-status-error', { error: err.message });
  }
}

btnUninstallDiscord?.addEventListener('click', async () => {
  const choice = await window.showConfirmModal({
    title: 'Discord Uygulaması Kaldırılacak',
    message: 'Resmi Discord masaüstü uygulaması kaldırılsın mı?',
    detail: 'Discord kendi kaldırma sihirbazı açılacak. Bu işlem SplitCord tarafından geri alınamaz.',
  });
  if (choice !== 0) {
    window.splitcord.log('uninstall-official-discord-cancelled', {});
    return;
  }

  window.splitcord.log('uninstall-official-discord-confirmed', {});
  try {
    await window.splitcord.app.uninstallOfficialDiscord();
  } catch (err) {
    window.splitcord.log('uninstall-official-discord-error', { error: err.message });
  }
});

refreshProtocolHandlerStatus();
setInterval(refreshProtocolHandlerStatus, 15000);

// --- Kontroller (İzinler ve Kontroller paneli) ---
// Windows karşılığındaki Kaspersky/ESET-WinDivert çakışma tespiti + harici winws/ciadpi/
// goodbyedpi süreç/hizmet taraması BİLEREK YOK — bu kavramların (WinDivert sürücü tekelinin
// bir güvenlik yazılımı tarafından tutulması) Linux'ta (NFQUEUE tabanlı motorlar) bir
// karşılığı yok (bkz. PORTING_PLAN.md D-9).

// --- Ses Durumu Tanılama (İzinler ve Kontroller paneli) ---
const voiceStateIcons = {
  connected: document.getElementById('voice-state-connected-icon'),
  muted: document.getElementById('voice-state-muted-icon'),
  deafened: document.getElementById('voice-state-deafened-icon'),
};

function renderVoiceState(state) {
  for (const key of Object.keys(voiceStateIcons)) {
    const icon = voiceStateIcons[key];
    if (!icon) continue;
    const on = !!state?.[key];
    icon.textContent = on ? '✓' : '✗';
    icon.className = `sc-permission-icon ${on ? 'sc-permission-icon--ok' : 'sc-permission-icon--neutral'}`;
  }
}

window.splitcord.voice
  .getState()
  .then(renderVoiceState)
  .catch((err) => window.splitcord.log('get-voice-state-error', { error: err.message }));

window.splitcord.onVoiceStateChanged?.(renderVoiceState);

// --- Hakkında ve Güncelleme paneli ---
const btnCheckUpdate = document.getElementById('btn-check-update');
const btnInstallUpdate = document.getElementById('btn-install-update');
const aboutUpdateStatus = document.getElementById('about-update-status');
let lastUpdateInfo = null;
let updateDownloaded = false;
// bkz. titlebar.js'teki AYNI koruma ve oradaki not — openDownloadedUpdate() (shell.openPath)
// kurucu penceresi görünene kadar bir-iki saniye geçebiliyor, bu sırada buton hemen tekrar
// tıklanabilir hâle gelince kullanıcı sabırsızlanıp ikinci bir kurulum işlemi (ve ikinci bir
// UAC istemi) daha başlatabiliyordu — iki kurucu süreç aynı anda çakışınca kurulum
// tamamlanmadan her şey kapanıyordu.
let installerLaunchCooldownUntil = 0;
const INSTALLER_LAUNCH_COOLDOWN_MS = 6000;

async function openDownloadedUpdateGuarded() {
  if (Date.now() < installerLaunchCooldownUntil) return;
  installerLaunchCooldownUntil = Date.now() + INSTALLER_LAUNCH_COOLDOWN_MS;
  await window.splitcord.app.openDownloadedUpdate();
}

window.splitcord.app
  .getVersion()
  .then((v) => {
    document.getElementById('about-version').textContent = v;
  })
  .catch(() => {});

btnCheckUpdate?.addEventListener('click', async () => {
  window.splitcord.log('check-update-click', {});
  btnCheckUpdate.disabled = true;
  aboutUpdateStatus.textContent = 'Kontrol ediliyor…';
  try {
    lastUpdateInfo = await window.splitcord.app.checkForUpdate();
    updateDownloaded = false;
    if (lastUpdateInfo.available) {
      aboutUpdateStatus.textContent = `Yeni sürüm mevcut: ${lastUpdateInfo.latestVersion}`;
      btnInstallUpdate.hidden = false;
      btnInstallUpdate.textContent = 'Güncellemeyi İndir';
    } else {
      aboutUpdateStatus.textContent = 'En güncel sürümü kullanıyorsun.';
      btnInstallUpdate.hidden = true;
    }
  } catch (err) {
    aboutUpdateStatus.textContent = `Güncelleme kontrol edilemedi: ${err.message}`;
    window.splitcord.log('check-update-error', { error: err.message });
  }
  btnCheckUpdate.disabled = false;
});

// İndirme bitince kurulum dosyası bir KEZ otomatik açılır — kullanıcı işletim sisteminin
// kendi UAC istemini ve kurulum sihirbazını görüp süreci kendi kontrolünde tamamlar
// (bkz. titlebar.js'teki aynı desen, updateChecker.js'teki gerekçe notu). Sihirbaz
// kapatılıp kurulum tamamlanmazsa buton "Güncellemeyi Kur" olarak kalır, tekrar
// indirmeden elle tekrar açılabilir.
btnInstallUpdate?.addEventListener('click', async () => {
  if (!lastUpdateInfo?.downloadUrl) return;

  if (updateDownloaded) {
    window.splitcord.log('open-update-click', { version: lastUpdateInfo.latestVersion });
    try {
      await openDownloadedUpdateGuarded();
    } catch (err) {
      aboutUpdateStatus.textContent = `Güncelleme açılamadı: ${err.message}`;
      window.splitcord.log('open-update-error', { error: err.message });
    }
    return;
  }

  window.splitcord.log('download-update-click', { version: lastUpdateInfo.latestVersion });
  btnInstallUpdate.disabled = true;
  aboutUpdateStatus.textContent = 'İndiriliyor…';
  try {
    await window.splitcord.app.downloadUpdate(lastUpdateInfo.downloadUrl);
    updateDownloaded = true;
    aboutUpdateStatus.textContent = 'İndirme tamamlandı, kurulum sihirbazı açılıyor…';
    btnInstallUpdate.textContent = 'Güncellemeyi Kur';
    // İndirme biter bitmez kurulum sihirbazını bir kez otomatik aç. Açma başarısız olursa
    // sessizce yut — buton zaten "Güncellemeyi Kur" durumunda kalıyor, kullanıcı tıklayarak
    // tekrar deneyebilir.
    window.splitcord.log('update-auto-open', { version: lastUpdateInfo.latestVersion });
    openDownloadedUpdateGuarded().catch((err) => {
      window.splitcord.log('update-auto-open-error', { error: err.message });
    });
  } catch (err) {
    aboutUpdateStatus.textContent = `Güncelleme indirilemedi: ${err.message}`;
    window.splitcord.log('download-update-error', { error: err.message });
  }
  btnInstallUpdate.disabled = false;
});

const btnOpenDiagnosticLogLocation = document.getElementById('btn-open-diagnostic-log-location');
btnOpenDiagnosticLogLocation?.addEventListener('click', async () => {
  window.splitcord.log('open-diagnostic-log-location-click', {});
  btnOpenDiagnosticLogLocation.disabled = true;
  try {
    await window.splitcord.app.openDiagnosticLogLocation();
  } catch (err) {
    aboutUpdateStatus.textContent = `Günlük dosyası konumu açılamadı: ${err.message}`;
    window.splitcord.log('open-diagnostic-log-location-click-error', { error: err.message });
  }
  btnOpenDiagnosticLogLocation.disabled = false;
});

const btnResetAllSettings = document.getElementById('btn-reset-all-settings');
btnResetAllSettings?.addEventListener('click', async () => {
  const choice = await window.showConfirmModal({
    title: 'Tüm ayarlar sıfırlansın mı?',
    message: 'Program ayarları ve Discord oturumu (giriş yapmış hesabınız dahil) tamamen sıfırlanacak.',
    detail: 'Bu işlem geri alınamaz. Sıfırlama tamamlanınca program otomatik olarak yeniden başlayacak.',
  });
  if (choice !== 0) return;

  btnResetAllSettings.disabled = true;
  btnResetAllSettings.textContent = 'Sıfırlanıyor…';
  window.splitcord.log('reset-all-settings-click', {});
  try {
    await window.splitcord.app.resetAllSettings();
  } catch (err) {
    // Uygulama bu noktada zaten yeniden başlıyor olmalı; yine de bir hata sızarsa
    // butonu kullanılabilir hale geri getiriyoruz.
    window.splitcord.log('reset-all-settings-error', { error: err.message });
    btnResetAllSettings.disabled = false;
    btnResetAllSettings.textContent = 'Tüm Ayarları Sıfırla';
  }
});

// Windows karşılığı burada bir onay diyaloğundan sonra resmi kaldırma sihirbazını açıyordu —
// Linux'ta TEKİL bir kaldırıcı yok (bkz. PORTING_PLAN.md D-7, ipc.js'teki app:uninstall-app
// notu). Buton yine de motorları best-effort durdurup açıklayıcı bir bilgilendirme fırlatan
// aynı IPC çağrısını yapıyor; burada onu bir onay diyaloğu yerine doğrudan bilgilendirme
// modalıyla gösteriyoruz (ipc.js'in hata mesajı zaten AppImage/.deb talimatlarını içeriyor).
const btnUninstallApp = document.getElementById('btn-uninstall-app');
btnUninstallApp?.addEventListener('click', async () => {
  window.splitcord.log('uninstall-app-click', {});
  btnUninstallApp.disabled = true;
  try {
    await window.splitcord.app.uninstallApp();
  } catch (err) {
    window.splitcord.log('uninstall-app-error', { error: err.message });
    await window.showConfirmModal({
      title: 'Elle kaldırma gerekiyor',
      message: err.message,
      buttons: ['Tamam'],
      defaultId: 0,
      cancelId: 0,
    });
  } finally {
    btnUninstallApp.disabled = false;
  }
});

function showTemporaryError(message) {
  const original = logsBox.textContent;
  logsBox.textContent = `HATA: ${message}`;
  setTimeout(() => {
    logsBox.textContent = original;
  }, 4000);
}

// Bu pencerede yakalanmayan bir hata olursa (beklenmeyen bir kod yolu, vs.) yine de
// log dosyasına düşsün — sessizce kaybolup "neden çalışmadı" sorusuna yol açmasın.
window.addEventListener('error', (event) => {
  window.splitcord.log('settings-uncaught-error', { message: event.message, filename: event.filename, line: event.lineno });
});
window.addEventListener('unhandledrejection', (event) => {
  window.splitcord.log('settings-unhandled-rejection', { reason: String(event.reason?.message ?? event.reason) });
});

// Ana penceredeki dinamik renk paletini (Discord temasından örneklenen) ayarlar
// penceresinin arkaplanına da uygula — theme.css'teki transition tanımları sayesinde
// fade ile geçiyor. ipc.js, pencere açılır açılmaz son bilinen paleti zaten gönderiyor.
window.splitcord.onDynamicColorSampled?.((palette) => {
  const root = document.documentElement.style;
  root.setProperty('--sc-bg-primary', palette.primary);
  root.setProperty('--sc-bg-secondary', palette.secondary);
  root.setProperty('--sc-bg-tertiary', palette.tertiary);
  root.setProperty('--sc-bg-hover', palette.hover);
  root.setProperty('--sc-text-normal', palette.textNormal);
  root.setProperty('--sc-text-muted', palette.textMuted);
});

function applyPerformanceModeAttr(enabled) {
  if (enabled) document.documentElement.setAttribute('data-performance-mode', '');
  else document.documentElement.removeAttribute('data-performance-mode');
}
window.splitcord.app.getPerformanceMode().then(applyPerformanceModeAttr).catch(() => {});
window.splitcord.onPerformanceModeChanged?.(applyPerformanceModeAttr);

window.splitcord.log('settings-window-loaded', {});

// Her ihtimale karşı: iki anahtar da yüklendikten sonra bar'ın kesinlikle temiz
// (gizli) bir durumda başladığından emin ol.
Promise.all([
  initAutoStartToggle(),
  initStartInBackgroundToggle(),
  initGpuToggle(),
  initQuicToggle(),
  initOpenLinksExternallyToggle(),
  initLinkOpenerNewWindowToggle(),
  initPerformanceModeToggle(),
  initNotificationBadgeToggle(),
  initDisableFalseVoiceWarningToggle(),
]).then(() => updateUnsavedBar());
initThemePicker();
initDnsProviders();
initByedpiExtendedCandidates();
initManualDnsProtocol();
initZapret2TierTimeout();
initDpiMode().then(() => refreshStatus());
setInterval(refreshStatus, 5000);
