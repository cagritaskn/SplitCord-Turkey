'use strict';

// dialog.showMessageBoxSync yerine, hedef pencerenin kendi renderer'ında (temaya uyan
// modal.js aracılığıyla) bir onay kutusu gösterip sonucu geri bekleyen köprü. Ana süreç
// tarafında senkron çalışan native dialog'un aksine burada asenkron: 'modal:show-confirm'
// olayını hedef pencereye gönderip, renderer kullanıcı seçimini 'modal:confirm-result'
// ile geri bildirene kadar bekliyoruz.
const { ipcMain } = require('electron');

let requestSeq = 0;
const pendingRequests = new Map();

function showThemedConfirm(win, options) {
  if (!win || win.isDestroyed()) {
    return Promise.resolve(options.cancelId ?? 0);
  }
  const id = ++requestSeq;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    win.webContents.send('modal:show-confirm', { id, ...options });
  });
}

ipcMain.on('modal:confirm-result', (_event, id, choice) => {
  const resolve = pendingRequests.get(id);
  if (!resolve) return;
  pendingRequests.delete(id);
  resolve(choice);
});

module.exports = { showThemedConfirm };
