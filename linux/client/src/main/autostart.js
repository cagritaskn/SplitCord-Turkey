'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// Windows karşılığının (client/src/main/autostart.js) portu. Windows'ta getLoginItemSettings()
// registry'deki kayıtlı komut satırını 'args' ile birebir karşılaştırıyordu — Linux'ta Electron
// bunu bir masaüstü giriş dosyası (~/.config/autostart/*.desktop) yazarak/okuyarak simüle ediyor.
//
// DOĞRULANMADI (bkz. ../../PORTING_PLAN.md §2 madde 5): Electron'un yerleşik setLoginItemSettings/
// getLoginItemSettings'i .deb kurulumunda (gerçek, sabit bir /usr/bin/... yolu ve kurulu bir
// .desktop girişi olduğu için) muhtemelen düzgün çalışıyor, ama AppImage'da GÜVENİLİR DEĞİL —
// AppImage kendini geçici bir noktaya mount edip oradan çalıştığı için Electron'un varsayılan
// mekanizması (kendi exe yolunu bulup bir .desktop yazma) yanlış/geçici bir yola işaret edebilir.
// Bu yüzden AppImage'da (process.env.APPIMAGE — AppImage runtime'ının kendi ayarladığı, GERÇEK
// .AppImage dosyasının yolunu içeren ortam değişkeni) ELLE bir .desktop dosyası yazıp okuyoruz;
// .deb/dev modunda Electron'un yerleşik API'sine güveniyoruz.
const HIDDEN_ARGS = ['--hidden'];
const DESKTOP_FILE_NAME = 'com.splitcord.turkey.autostart.desktop';
const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, DESKTOP_FILE_NAME);

function isAppImage() {
  return !!process.env.APPIMAGE;
}

function readAppImageAutostart() {
  try {
    const content = fs.readFileSync(AUTOSTART_FILE, 'utf8');
    return {
      openAtLogin: /^X-GNOME-Autostart-enabled=true$/m.test(content),
      hidden: /--hidden/.test(content),
    };
  } catch {
    return { openAtLogin: false, hidden: false };
  }
}

function writeAppImageAutostart(enabled, startInBackground) {
  if (!enabled) {
    try {
      fs.unlinkSync(AUTOSTART_FILE);
    } catch {
      // zaten yoksa sorun değil
    }
    return;
  }

  const exePath = process.env.APPIMAGE;
  const args = startInBackground ? ` ${HIDDEN_ARGS.join(' ')}` : '';
  // Yol boşluk içerebilir -- tırnak içine alınıyor.
  const execLine = `"${exePath}"${args}`;
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=SplitCord-Turkey',
    `Exec=${execLine}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');

  fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
  fs.writeFileSync(AUTOSTART_FILE, content, { mode: 0o644 });
}

function isAutoStartEnabled() {
  if (isAppImage()) return readAppImageAutostart().openAtLogin;
  return app.getLoginItemSettings({ args: [] }).openAtLogin || app.getLoginItemSettings({ args: HIDDEN_ARGS }).openAtLogin;
}

function isStartInBackgroundEnabled() {
  if (isAppImage()) {
    const state = readAppImageAutostart();
    return state.openAtLogin && state.hidden;
  }
  return app.getLoginItemSettings({ args: HIDDEN_ARGS }).openAtLogin;
}

function applyAutoStart(enabled, startInBackground) {
  if (isAppImage()) {
    writeAppImageAutostart(enabled, startInBackground);
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled && startInBackground ? HIDDEN_ARGS : [],
  });
}

module.exports = { isAutoStartEnabled, isStartInBackgroundEnabled, applyAutoStart };
