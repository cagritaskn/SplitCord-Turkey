'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// Windows karşılığının (client/src/main/autostart.js) portu. Windows'ta getLoginItemSettings()
// registry'deki kayıtlı komut satırını 'args' ile birebir karşılaştırıyordu.
//
// CANLI TESTTE DOĞRULANAN GERÇEK BUG (2026-09-05, bkz. PORTING_PLAN.md §2 madde 5): Electron'un
// app.setLoginItemSettings()/getLoginItemSettings() API'leri yalnızca Windows ve macOS'ta
// implemente edilmiş (bkz. node_modules/electron/electron.d.ts -- ikisi de "@platform
// darwin,win32" olarak işaretli). Linux'ta bu ikisi de SESSİZCE HİÇBİR ŞEY YAPMAYAN (no-op)
// çağrılar: setLoginItemSettings hiçbir ".desktop" girişi oluşturmuyor, getLoginItemSettings
// her zaman openAtLogin:false dönüyor. Önceki port bu no-op'lara (yalnızca AppImage için elle
// yazılan bir .desktop dosyasına DEĞİL) güveniyordu -- bu yüzden .deb kurulumunda "sistemle
// başlat" ayarı hem GERÇEKTE hiç uygulanmıyor (açılışta program başlamıyor) hem de her okunuşta
// (Ayarlar ekranı, ya da index.js'teki "varsayılan olarak aç" mantığı) her zaman kapalı
// görünüyordu. Düzeltme: paketleme türünden (deb/AppImage) BAĞIMSIZ olarak Linux'ta HER ZAMAN
// ~/.config/autostart/*.desktop dosyasını elle yazıp okuyoruz -- XDG Autostart spesifikasyonu
// masaüstü ortamından bağımsız çalışan tek güvenilir mekanizma.
const HIDDEN_ARGS = ['--hidden'];
const DESKTOP_FILE_NAME = 'com.splitcord.turkey.autostart.desktop';
const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, DESKTOP_FILE_NAME);

function isAppImage() {
  return !!process.env.APPIMAGE;
}

// AppImage kendini geçici bir noktaya mount edip oradan çalıştığı için process.execPath
// yanlış/geçici bir yola işaret ediyor -- APPIMAGE ortam değişkeni (AppImage runtime'ının
// kendi ayarladığı, GERÇEK .AppImage dosyasının yolunu içeren değişken) kullanılmalı. .deb
// kurulumunda ve dev modunda process.execPath (app.getPath('exe')) doğru/kalıcı yolu verir
// (ör. /opt/SplitCord-Turkey/splitcord-turkey).
function resolveExePath() {
  if (isAppImage()) return process.env.APPIMAGE;
  return app.getPath('exe');
}

function readAutostartFile() {
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

function writeAutostartFile(enabled, startInBackground) {
  if (!enabled) {
    try {
      fs.unlinkSync(AUTOSTART_FILE);
    } catch {
      // zaten yoksa sorun değil
    }
    return;
  }

  const exePath = resolveExePath();
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
  return readAutostartFile().openAtLogin;
}

function isStartInBackgroundEnabled() {
  const state = readAutostartFile();
  return state.openAtLogin && state.hidden;
}

function applyAutoStart(enabled, startInBackground) {
  writeAutostartFile(enabled, startInBackground);
}

module.exports = { isAutoStartEnabled, isStartInBackgroundEnabled, applyAutoStart };
