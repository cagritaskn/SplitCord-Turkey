'use strict';

const ENGINE_DESCRIPTIONS = {
  byedpi: 'Yalnızca bu uygulamanın trafiğini kapsayan yerel proxy. Admin gerektirmez. Varsayılan. Ses bağlantısına destek olması için arka planda ayrıca Zapret de (yalnızca UDP) devreye alınır.',
  goodbyedpi: 'Sistem geneli paket müdahalesi (WinDivert). Tüm uygulamaları etkiler.',
  zapret: "Sistem geneli, Discord/YouTube için hazır strateji (WinDivert). Tüm uygulamaları etkiler.",
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

  // Otomatik modda ByeDPI'nin TÜM adayları tükenirse DpiEngineManager otomatik olarak
  // GoodbyeDPI'ye, o da tükenirse Zapret'e geçiyor — bu kutu ÖNCEDEN her zaman ByeDPI'nin
  // durumunu gösteriyordu, escalation sonrası hâlâ ByeDPI'nin (artık pasif) eski/başarısız
  // durumunu göstermeye devam edip kafa karıştırıyordu. Şimdi GERÇEKTE aktif olan motoru
  // gösteriyor.
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
      // olabilir (ByeDPI/GoodbyeDPI/Zapret aday testleri) — onay metnine ekstra bir uyarı
      // ekleniyor; onaylanırsa taramayı VE o an çalışan motoru tamamen durdurup (bkz.
      // aşağıdaki cancelScan + stopAllEngines çağrıları) ANCAK ONDAN SONRA mod geçişini
      // yapıyoruz.
      let scanInProgress = false;
      try {
        const status = await window.splitcord.dpi.getStatus();
        scanInProgress = !!status?.switching;
      } catch (err) {
        window.splitcord.log('get-status-before-mode-change-error', { error: err.message });
      }

      let detail = 'Mod değişikliği DPI motorunun yeniden başlatılmasına neden olabilir, bu da Discord bağlantısının kısa süreliğine kesilmesine yol açabilir.';
      if (scanInProgress) {
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
        if (scanInProgress) {
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
  // ByeDPI ise gösterilir (GoodbyeDPI/Zapret'in bu ayarla bir ilgisi yok).
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
const openLinksExternallyToggle = document.getElementById('toggle-open-links-externally');
const linkOpenerNewWindowToggle = document.getElementById('toggle-link-opener-new-window');
const performanceModeToggle = document.getElementById('toggle-performance-mode');
const notificationBadgeToggle = document.getElementById('toggle-notification-badge');
const disableFalseVoiceWarningToggle = document.getElementById('toggle-disable-false-voice-warning');
const dohTextarea = document.getElementById('doh-providers');
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

// "Arkaplanda başlat" satırı yalnızca "Windows ile başlat" işaretliyken (ya da
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

async function initDohProviders() {
  try {
    const providers = await window.splitcord.dpi.getDohProviders();
    dohTextarea.value = (providers ?? []).join('\n');
  } catch (err) {
    dohTextarea.value = '';
    console.error(err);
    window.splitcord.log('get-doh-providers-error', { error: err.message });
  }
}

document.getElementById('btn-save-doh').addEventListener('click', async () => {
  const providers = dohTextarea.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  window.splitcord.log('save-doh-click', { providers });
  try {
    const saved = await window.splitcord.dpi.setDohProviders(providers);
    dohTextarea.value = (saved ?? []).join('\n');
  } catch (err) {
    console.error(err);
    window.splitcord.log('save-doh-error', { providers, error: err.message });
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
// Güvenlik duvarı izinleri (hem ciadpi hem de uygulamanın kendisi için) kasıtlı olarak
// "Görmezden Gel" ile kapatılamıyor — eksik izin, DPI aşımını veya ses bağlantısını
// gerçekten bozabileceği için titlebar'daki "Eylem Gerekli" butonu izin verilene kadar
// her zaman görünür kalmalı (bkz. ipc.js app:get-controls-issue-status).
// İzin eksikliği yüzünden Discord'a hiç erişilemiyor olabilir (çalışan/doğrulanmış bir
// ayar yok) — bu durumda izin verildikten sonra kullanıcının ayrıca "Tekrar Arama
// Başlat"a basmasına gerek kalmadan arama otomatik en baştan başlasın: Otomatik moddaysa
// otomatik giriş noktasından (Zapret) sırayla, Manuel moddaysa yalnızca o an seçili olan
// hizmet içinde (bkz. btnRestartSearch/btnRestartSearchManual — aynı activateEngine yolu).
async function restartSearchAfterFirewallGrantIfNeeded() {
  await refreshStatus();
  if (!currentStatus || currentStatus.switching) return;
  if (dpiMode === 'automatic') {
    const active = currentStatus.engines.find((e) => e.id === getDisplayActiveEngineId(currentStatus));
    if (!active?.running) {
      window.splitcord.log('firewall-grant-restart-search', { mode: 'automatic' });
      await activateEngine('zapret');
    }
  } else if (dpiMode === 'manual' && selectedEngineId) {
    const active = currentStatus.engines.find((e) => e.id === selectedEngineId);
    if (!active?.running) {
      window.splitcord.log('firewall-grant-restart-search', { mode: 'manual', id: selectedEngineId });
      await activateEngine(selectedEngineId);
    }
  }
}

const firewallIconEl = document.getElementById('permission-firewall-icon');
const btnGrantFirewall = document.getElementById('btn-grant-firewall');

async function refreshFirewallPermission() {
  try {
    const { granted } = await window.splitcord.dpi.getFirewallStatus();
    firewallIconEl.textContent = granted ? '✓' : '✗';
    firewallIconEl.className = `sc-permission-icon ${granted ? 'sc-permission-icon--ok' : 'sc-permission-icon--missing'}`;
    btnGrantFirewall.hidden = granted;
  } catch (err) {
    firewallIconEl.textContent = '?';
    firewallIconEl.className = 'sc-permission-icon';
    btnGrantFirewall.hidden = true;
    window.splitcord.log('get-firewall-status-error', { error: err.message });
  }
}

btnGrantFirewall?.addEventListener('click', async () => {
  window.splitcord.log('grant-firewall-permission-click', {});
  btnGrantFirewall.disabled = true;
  let granted = false;
  try {
    const result = await window.splitcord.dpi.grantFirewallPermission();
    granted = !!result?.granted;
  } catch (err) {
    window.splitcord.log('grant-firewall-permission-error', { error: err.message });
  }
  btnGrantFirewall.disabled = false;
  await refreshFirewallPermission();
  if (granted) await restartSearchAfterFirewallGrantIfNeeded();
});

refreshFirewallPermission();
setInterval(refreshFirewallPermission, 15000);

const appFirewallIconEl = document.getElementById('permission-app-firewall-icon');
const btnGrantAppFirewall = document.getElementById('btn-grant-app-firewall');

async function refreshAppFirewallPermission() {
  try {
    const { granted } = await window.splitcord.dpi.getAppFirewallStatus();
    appFirewallIconEl.textContent = granted ? '✓' : '✗';
    appFirewallIconEl.className = `sc-permission-icon ${granted ? 'sc-permission-icon--ok' : 'sc-permission-icon--missing'}`;
    btnGrantAppFirewall.hidden = granted;
  } catch (err) {
    appFirewallIconEl.textContent = '?';
    appFirewallIconEl.className = 'sc-permission-icon';
    btnGrantAppFirewall.hidden = true;
    window.splitcord.log('get-app-firewall-status-error', { error: err.message });
  }
}

btnGrantAppFirewall?.addEventListener('click', async () => {
  window.splitcord.log('grant-app-firewall-permission-click', {});
  btnGrantAppFirewall.disabled = true;
  let granted = false;
  try {
    const result = await window.splitcord.dpi.grantAppFirewallPermission();
    granted = !!result?.granted;
  } catch (err) {
    window.splitcord.log('grant-app-firewall-permission-error', { error: err.message });
  }
  btnGrantAppFirewall.disabled = false;
  await refreshAppFirewallPermission();
  if (granted) await restartSearchAfterFirewallGrantIfNeeded();
});

refreshAppFirewallPermission();
setInterval(refreshAppFirewallPermission, 15000);

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
const controlsListEl = document.getElementById('controls-list');

function controlRow(labelHtml, actionButtons) {
  const row = document.createElement('div');
  row.className = 'sc-permission-row';
  row.innerHTML = `<div class="sc-permission-info">${labelHtml}</div>`;
  const buttons = Array.isArray(actionButtons) ? actionButtons : [actionButtons];
  for (const btn of buttons) {
    if (btn) row.appendChild(btn);
  }
  return row;
}

function makeInfoButton(text, onClick) {
  const btn = document.createElement('button');
  btn.className = 'sc-btn sc-btn--primary';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function makeActionButton(text, onClick) {
  const btn = document.createElement('button');
  btn.className = 'sc-btn sc-btn--danger';
  btn.textContent = text;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await onClick();
    } catch (err) {
      window.splitcord.log('control-action-error', { error: err.message });
    }
    await refreshSystemControls();
  });
  return btn;
}

async function refreshSystemControls() {
  let status;
  try {
    status = await window.splitcord.dpi.getSystemControlsStatus();
  } catch (err) {
    controlsListEl.innerHTML = `<div class="sc-hint">Kontrol edilemedi: ${escapeHtml(err.message)}</div>`;
    window.splitcord.log('get-system-controls-status-error', { error: err.message });
    return;
  }

  controlsListEl.innerHTML = '';
  let anyIssue = false;

  if (status.kasperskyDetected) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        '<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>Kaspersky çalışıyor. DPI aşımıyla çakışabilir, GoodbyeDPI ve Zapret kullanımı için kaldırmanız gerekiyor.</span>',
        [
          makeInfoButton('Daha Fazla Bilgi', () => window.showAntivirusDetectedModal('kaspersky')),
          makeIgnoreButton('kaspersky'),
        ],
      ),
    );
  }

  if (status.esetDetected) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        '<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>ESET çalışıyor. DPI aşımıyla çakışabilir, GoodbyeDPI ve Zapret kullanımı için kaldırmanız gerekiyor.</span>',
        [
          makeInfoButton('Daha Fazla Bilgi', () => window.showAntivirusDetectedModal('eset')),
          makeIgnoreButton('eset'),
        ],
      ),
    );
  }

  for (const svc of status.conflictingServicesInstalled ?? []) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        `<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>${escapeHtml(svc.displayName)} hizmeti (${escapeHtml(svc.serviceName)}) kurulu, çakışma yaratabilir</span>`,
        [
          makeActionButton('Hizmeti Kaldır', () => window.splitcord.dpi.removeConflictingService(svc.serviceName)),
          makeIgnoreButton(`service:${svc.serviceName}`),
        ],
      ),
    );
  }

  for (const proc of status.externalGoodbyeDpiProcesses ?? []) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        `<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>Harici goodbyedpi.exe (PID ${proc.pid})</span>`,
        [
          makeActionButton('Sonlandır', () => window.splitcord.dpi.killProcess(proc.pid)),
          makeIgnoreButton('external-goodbyedpi-process'),
        ],
      ),
    );
  }

  for (const proc of status.externalZapretProcesses ?? []) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        `<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>Harici winws.exe / Zapret (PID ${proc.pid})</span>`,
        [
          makeActionButton('Sonlandır', () => window.splitcord.dpi.killProcess(proc.pid)),
          makeIgnoreButton('external-zapret-process'),
        ],
      ),
    );
  }

  for (const proc of status.extraCiadpiProcesses ?? []) {
    anyIssue = true;
    controlsListEl.appendChild(
      controlRow(
        `<span class="sc-permission-icon sc-permission-icon--missing">!</span><span>Fazladan ciadpi.exe (PID ${proc.pid}) — SplitCord'un yönettiği dışında</span>`,
        [
          makeActionButton('Sonlandır', () => window.splitcord.dpi.killProcess(proc.pid)),
          makeIgnoreButton('extra-ciadpi-process'),
        ],
      ),
    );
  }

  if (!anyIssue) {
    controlsListEl.appendChild(controlRow('<span class="sc-permission-icon sc-permission-icon--ok">✓</span><span>Herhangi bir çakışma tespit edilmedi</span>', null));
  }
}

refreshSystemControls();
setInterval(refreshSystemControls, 20000);

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
      await window.splitcord.app.openDownloadedUpdate();
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
    window.splitcord.app.openDownloadedUpdate().catch((err) => {
      window.splitcord.log('update-auto-open-error', { error: err.message });
    });
  } catch (err) {
    aboutUpdateStatus.textContent = `Güncelleme indirilemedi: ${err.message}`;
    window.splitcord.log('download-update-error', { error: err.message });
  }
  btnInstallUpdate.disabled = false;
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
  initOpenLinksExternallyToggle(),
  initLinkOpenerNewWindowToggle(),
  initPerformanceModeToggle(),
  initNotificationBadgeToggle(),
  initDisableFalseVoiceWarningToggle(),
]).then(() => updateUnsavedBar());
initThemePicker();
initDohProviders();
initByedpiExtendedCandidates();
initDpiMode().then(() => refreshStatus());
setInterval(refreshStatus, 5000);
