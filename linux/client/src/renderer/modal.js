'use strict';

// Windows'un yerleşik dialog.showMessageBoxSync/confirm()/alert() kutularının yerini
// alan, temaya (theme.css --sc-* değişkenleri) uyan özel modal. Hem ana pencere
// (titlebar.js) hem de ayarlar penceresi (settings.js) tarafından, ana sürecin
// 'modal:show-confirm' IPC olayı üzerinden ya da doğrudan kullanılabilir.
(function () {
  function ensureRoot() {
    let root = document.getElementById('sc-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'sc-modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  // buttons: string[]; defaultId: Enter'a basınca seçilecek/başlangıçta odaklanacak
  // buton; cancelId: Escape'e basınca seçilecek buton. dialog.showMessageBoxSync ile
  // aynı sözleşme: Promise, seçilen butonun index'i ile resolve olur.
  // link: { url, label } — opsiyonel, tıklanabilir tek bir bağlantı satırı ekler.
  // message/detail her zaman textContent ile (innerHTML DEĞİL) render ediliyor — bu
  // modal harici kaynaklardan gelen metinlerle de (ör. ağ hata mesajları) çağrılabiliyor,
  // bu yüzden kasıtlı olarak HTML enjeksiyonuna kapalı; bağlantı için ayrı, güvenli bir
  // <a> elemanı kullanılıyor.
  function showModal({ title, message, detail, link, buttons, defaultId = 0, cancelId = 0 }) {
    return new Promise((resolve) => {
      const root = ensureRoot();
      const overlay = document.createElement('div');
      overlay.className = 'sc-modal-overlay';

      const box = document.createElement('div');
      box.className = 'sc-modal';

      if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'sc-modal-title';
        titleEl.textContent = title;
        box.appendChild(titleEl);
      }

      if (message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'sc-modal-message';
        messageEl.textContent = message;
        box.appendChild(messageEl);
      }

      if (detail) {
        const detailEl = document.createElement('div');
        detailEl.className = 'sc-modal-detail';
        detailEl.textContent = detail;
        box.appendChild(detailEl);
      }

      if (link?.url) {
        const linkEl = document.createElement('a');
        linkEl.className = 'sc-modal-link';
        linkEl.href = link.url;
        linkEl.target = '_blank';
        linkEl.rel = 'noopener';
        linkEl.textContent = link.label || link.url;
        box.appendChild(linkEl);
      }

      const actions = document.createElement('div');
      actions.className = 'sc-modal-actions';
      const buttonEls = [];

      let settled = false;
      function finish(index) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        overlay.classList.remove('sc-modal-visible');
        overlay.classList.add('sc-modal-closing');
        setTimeout(() => overlay.remove(), 150);
        resolve(index);
      }

      buttons.forEach((label, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-modal-btn ' + (index === defaultId ? 'sc-modal-btn-primary' : 'sc-modal-btn-secondary');
        btn.textContent = label;
        btn.addEventListener('click', () => finish(index));
        buttonEls.push(btn);
        actions.appendChild(btn);
      });

      box.appendChild(actions);
      overlay.appendChild(box);
      root.appendChild(overlay);

      function onKeyDown(event) {
        if (event.key === 'Escape') finish(cancelId);
        else if (event.key === 'Enter') finish(defaultId);
      }
      document.addEventListener('keydown', onKeyDown);

      requestAnimationFrame(() => {
        overlay.classList.add('sc-modal-visible');
        (buttonEls[defaultId] || buttonEls[0])?.focus();
      });
    });
  }

  window.showConfirmModal = function (options) {
    return showModal({ buttons: ['Evet', 'Hayır'], defaultId: 0, cancelId: 1, ...options });
  };

  window.showAlertModal = function (options) {
    return showModal({ buttons: ['Tamam'], defaultId: 0, cancelId: 0, ...options }).then(() => undefined);
  };
})();
