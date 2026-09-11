'use strict';

window.splitcord.onDynamicColorSampled?.((palette) => {
  const root = document.documentElement.style;
  root.setProperty('--sc-bg-primary', palette.primary);
  root.setProperty('--sc-bg-secondary', palette.secondary);
  root.setProperty('--sc-bg-tertiary', palette.tertiary);
  root.setProperty('--sc-bg-hover', palette.hover);
  root.setProperty('--sc-text-normal', palette.textNormal);
  root.setProperty('--sc-text-muted', palette.textMuted);
});

document.getElementById('btn-close-hostlist').addEventListener('click', () => {
  window.splitcord.window.closeHostlist();
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const autoUpdateToggle = document.getElementById('toggle-hostlist-auto-update');
const intervalSlider = document.getElementById('slider-hostlist-interval');
const intervalValueEl = document.getElementById('slider-hostlist-interval-value');
const btnSyncNow = document.getElementById('btn-sync-hostlist-now');
const hostlistSyncStatus = document.getElementById('hostlist-sync-status');
const btnAddDomain = document.getElementById('btn-add-domain');
const userDomainsListEl = document.getElementById('user-domains-list');
const userDomainsEmptyHint = document.getElementById('user-domains-empty-hint');
const manualEditToggle = document.getElementById('toggle-hostlist-manual-edit');
const manualTextarea = document.getElementById('hostlist-manual-textarea');
const unsavedBar = document.getElementById('unsaved-bar');
const btnSaveChanges = document.getElementById('btn-save-changes');
const btnDiscardChanges = document.getElementById('btn-discard-changes');

// KULLANICI TALEBİ: slider ve manuel düzenleme kutusu, settings.js'teki AYNI ertelenmiş
// kaydetme deseni ("Kaydedilmemiş değişiklikleriniz var" çubuğu) — "Hostlist'i otomatik
// güncelle" switch'i ise (settings.js'teki Tuş Atamaları ana anahtarıyla AYNI mantık) anında
// uygulanır, bu çubuğa DAHİL DEĞİL.
let initialIntervalHours = 2;
let initialManualContent = '';
let pending = {};

function updateUnsavedBar() {
  const dirty = Object.keys(pending).length > 0;
  unsavedBar.hidden = !dirty;
  window.splitcord.window.setHostlistDirty(dirty);
}

function renderUserDomains(domains) {
  userDomainsListEl.innerHTML = '';
  userDomainsEmptyHint.hidden = domains.length > 0;
  domains.forEach((domain) => {
    const row = document.createElement('div');
    row.className = 'sc-hostlist-domain-row';
    row.innerHTML = `
      <span class="sc-hostlist-domain-name">${escapeHtml(domain)}</span>
      <button type="button" class="sc-hostlist-domain-remove" title="Kaldır">✕</button>
    `;
    row.querySelector('.sc-hostlist-domain-remove').addEventListener('click', async () => {
      const btn = row.querySelector('.sc-hostlist-domain-remove');
      btn.disabled = true;
      try {
        await window.splitcord.hostlist.remove(domain);
        await loadHostlist();
      } catch (err) {
        console.error(err);
        btn.disabled = false;
      }
    });
    userDomainsListEl.appendChild(row);
  });
}

async function loadHostlist() {
  const data = await window.splitcord.hostlist.get();
  autoUpdateToggle.checked = !!data.autoUpdateEnabled;
  initialIntervalHours = data.updateIntervalHours ?? 2;
  intervalSlider.value = String(initialIntervalHours);
  intervalValueEl.textContent = `${initialIntervalHours} saat`;
  initialManualContent = data.content ?? '';
  manualTextarea.value = initialManualContent;
  renderUserDomains(data.userAddedDomains ?? []);
  pending = {};
  updateUnsavedBar();
}

autoUpdateToggle.addEventListener('change', async () => {
  autoUpdateToggle.disabled = true;
  try {
    await window.splitcord.hostlist.setSettings(autoUpdateToggle.checked, undefined);
  } catch (err) {
    console.error(err);
    autoUpdateToggle.checked = !autoUpdateToggle.checked;
  } finally {
    autoUpdateToggle.disabled = false;
  }
});

intervalSlider.addEventListener('input', () => {
  const value = Number(intervalSlider.value);
  intervalValueEl.textContent = `${value} saat`;
  if (value === initialIntervalHours) {
    delete pending.updateIntervalHours;
  } else {
    pending.updateIntervalHours = value;
  }
  updateUnsavedBar();
});

// KULLANICI TALEBİ: "Şimdi Güncelle" -- otomatik güncelleme açık/kapalı fark etmeksizin,
// repodaki listeyi HEMEN çeker. Başarılı olunca (yeni girdi eklensin/eklenmesin fark
// etmeksizin) "Varsayılan hostlist başarıyla güncellendi." yazısı gösteriliyor.
btnSyncNow.addEventListener('click', async () => {
  const originalText = btnSyncNow.textContent;
  btnSyncNow.disabled = true;
  btnSyncNow.textContent = 'Güncelleniyor…';
  hostlistSyncStatus.hidden = true;
  try {
    await window.splitcord.hostlist.syncNow();
    await loadHostlist();
    hostlistSyncStatus.textContent = 'Varsayılan hostlist başarıyla güncellendi.';
    hostlistSyncStatus.hidden = false;
  } catch (err) {
    console.error(err);
    hostlistSyncStatus.textContent = `Güncelleme başarısız: ${err.message}`;
    hostlistSyncStatus.hidden = false;
  } finally {
    btnSyncNow.textContent = originalText;
    btnSyncNow.disabled = false;
  }
});

manualEditToggle.addEventListener('change', () => {
  manualTextarea.disabled = !manualEditToggle.checked;
});

manualTextarea.addEventListener('input', () => {
  if (manualTextarea.value === initialManualContent) {
    delete pending.manualContent;
  } else {
    pending.manualContent = manualTextarea.value;
  }
  updateUnsavedBar();
});

btnSaveChanges.addEventListener('click', async () => {
  btnSaveChanges.disabled = true;
  try {
    if ('updateIntervalHours' in pending) {
      await window.splitcord.hostlist.setSettings(undefined, pending.updateIntervalHours);
      initialIntervalHours = pending.updateIntervalHours;
      delete pending.updateIntervalHours;
    }
    if ('manualContent' in pending) {
      const result = await window.splitcord.hostlist.manualSave(pending.manualContent);
      initialManualContent = result?.content ?? pending.manualContent;
      manualTextarea.value = initialManualContent;
      delete pending.manualContent;
    }
    updateUnsavedBar();
  } catch (err) {
    console.error(err);
  } finally {
    btnSaveChanges.disabled = false;
  }
});

btnDiscardChanges.addEventListener('click', () => {
  if ('updateIntervalHours' in pending) {
    intervalSlider.value = String(initialIntervalHours);
    intervalValueEl.textContent = `${initialIntervalHours} saat`;
  }
  if ('manualContent' in pending) {
    manualTextarea.value = initialManualContent;
  }
  pending = {};
  updateUnsavedBar();
});

// KULLANICI TALEBİ: "+" diyaloğu modal.js'in showAlertModal/showConfirmModal'ından FARKLI --
// "Ekle"ye basınca ASENKRON doğrulama (servise gidip normalize/validate) yapması ve
// GEÇERSİZSE diyaloğu KAPATMADAN satır içi hata göstermesi gerekiyor. modal.js'in genel
// "tıkla -> kapan" akışı buna uygun değil, bu yüzden AYNI görsel sınıfları (.sc-modal-*,
// bkz. theme.css) yeniden kullanan, ama kendi kapanma mantığına sahip özel bir diyalog.
function showAddDomainDialog() {
  return new Promise((resolve) => {
    let root = document.getElementById('sc-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'sc-modal-root';
      document.body.appendChild(root);
    }

    const overlay = document.createElement('div');
    overlay.className = 'sc-modal-overlay';
    const box = document.createElement('div');
    box.className = 'sc-modal';
    box.innerHTML = `
      <div class="sc-modal-title">Domain Ekle</div>
      <div class="sc-modal-message">Dışlamak istediğiniz sitenin adresini girin (ör. sahibinden.com).</div>
      <input type="text" class="sc-hostlist-dialog-input" placeholder="ornek.com" autocomplete="off" spellcheck="false" />
      <div class="sc-hostlist-dialog-error" hidden></div>
      <div class="sc-modal-actions">
        <button type="button" class="sc-modal-btn sc-modal-btn-secondary" data-action="cancel">İptal</button>
        <button type="button" class="sc-modal-btn sc-modal-btn-primary" data-action="add">Ekle</button>
      </div>
    `;
    overlay.appendChild(box);
    root.appendChild(overlay);

    const input = box.querySelector('.sc-hostlist-dialog-input');
    const errorEl = box.querySelector('.sc-hostlist-dialog-error');
    const addBtn = box.querySelector('[data-action="add"]');
    const cancelBtn = box.querySelector('[data-action="cancel"]');

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.classList.remove('sc-modal-visible');
      overlay.classList.add('sc-modal-closing');
      setTimeout(() => overlay.remove(), 150);
      resolve(value);
    }

    async function doAdd() {
      const raw = input.value.trim();
      if (!raw) {
        errorEl.textContent = 'Geçersiz URL';
        errorEl.hidden = false;
        return;
      }
      addBtn.disabled = true;
      try {
        const result = await window.splitcord.hostlist.add(raw);
        if (result.error) {
          errorEl.textContent = result.error;
          errorEl.hidden = false;
        } else {
          finish(result.normalizedDomain);
        }
      } catch (err) {
        errorEl.textContent = err.message || 'Geçersiz URL';
        errorEl.hidden = false;
      } finally {
        addBtn.disabled = false;
      }
    }

    addBtn.addEventListener('click', doAdd);
    cancelBtn.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd();
      }
    });
    input.addEventListener('input', () => {
      errorEl.hidden = true;
    });

    function onKeyDown(e) {
      if (e.key === 'Escape') finish(null);
    }
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => {
      overlay.classList.add('sc-modal-visible');
      input.focus();
    });
  });
}

btnAddDomain.addEventListener('click', async () => {
  const normalizedDomain = await showAddDomainDialog();
  if (!normalizedDomain) return;
  await loadHostlist();
  await window.showAlertModal({
    title: 'Domain eklendi',
    message: `"${normalizedDomain}" dışlama listesine eklendi.`,
    detail: 'Değişikliğin etkili olması için birkaç saniye ile birkaç dakika arasında bir süre gerekebilir.',
  });
});

loadHostlist().catch((err) => console.error(err));

// KULLANICI TALEBİ (2026-09-11): AppImage'a özel -- kurulu servis eskiyse (bkz. ipc.js
// dpi:is-service-outdated) burada uyarı gösterip tek tıkla güncelleme sunuyoruz. .deb'de
// isServiceOutdated() her zaman false döndüğü için bu banner hiçbir zaman görünmez.
const hostlistOutdatedBanner = document.getElementById('hostlist-outdated-banner');
const btnUpdateServiceHostlist = document.getElementById('btn-update-service-hostlist');

window.splitcord.dpi
  .isServiceOutdated()
  .then((outdated) => {
    hostlistOutdatedBanner.hidden = !outdated;
  })
  .catch((err) => window.splitcord.log?.('hostlist-check-service-outdated-error', { error: err.message }));

btnUpdateServiceHostlist?.addEventListener('click', async () => {
  const originalText = btnUpdateServiceHostlist.textContent;
  btnUpdateServiceHostlist.disabled = true;
  btnUpdateServiceHostlist.textContent = 'Güncelleniyor… (parola isteyen bir pencere açılabilir)';
  try {
    const result = await window.splitcord.dpi.installService();
    if (result.ok) {
      hostlistOutdatedBanner.hidden = true;
      await loadHostlist();
    } else if (!result.cancelled) {
      await window.showAlertModal({ title: 'Güncelleme başarısız', message: result.error });
    }
  } catch (err) {
    await window.showAlertModal({ title: 'Güncelleme başarısız', message: err.message });
  } finally {
    btnUpdateServiceHostlist.disabled = false;
    btnUpdateServiceHostlist.textContent = originalText;
  }
});
