'use strict';

const { spawn } = require('node:child_process');

// package.json'daki üst seviye "name" alanıyla AYNI olmak zorunda -- dpkg/apt paketi bu
// isimle tanıyor (bkz. `dpkg -l` çıktısında "splitcord-client-linux").
const PACKAGE_NAME = 'splitcord-client-linux';

// Ayarlar > Hakkında'daki "SplitCord-Turkey'i Kaldır" butonunun arkasındaki gerçek kaldırma
// (bkz. PORTING_PLAN.md D-36/D-37) -- artık .deb'in kendi postrm'i (packaging/deb-postrm.sh)
// DPI servisini de otomatik söktüğü için burada elle uninstall.sh çağırmaya GEREK YOK, tek
// yapılması gereken paketi kaldırmak. `apt-get remove` (PURGE DEĞİL) kullanıcı verisini
// (/var/lib/splitcord) KORUYOR -- Windows'taki NSIS kaldırıcısının varsayılan davranışıyla
// (deleteAppDataOnUninstall AYARLANMAMIŞ, bkz. client/package.json) aynı.
function uninstallApp() {
  return new Promise((resolve, reject) => {
    const proc = spawn('pkexec', ['apt-get', 'remove', '-y', PACKAGE_NAME], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`pkexec bulunamadı. Elle kaldırmak için bir terminalde: sudo apt-get remove ${PACKAGE_NAME}`));
      } else {
        reject(new Error(`pkexec çalıştırılamadı: ${err.message}`));
      }
    });
    proc.on('close', (code, signal) => {
      if (code === 0) { resolve(); return; }
      // pkexec kendisi 126 ile çıkar (kullanıcı parola isteminde İPTAL etti ya da yetki
      // reddedildi) -- bkz. serviceInstaller.js'teki AYNI kural.
      if (code === 126 || signal === 'SIGTERM') { reject(new Error('CANCELLED')); return; }
      reject(new Error(`Kaldırma başarısız (çıkış kodu ${code}): ${stderr.trim() || 'bilinmeyen hata'}`));
    });
  });
}

module.exports = { uninstallApp, PACKAGE_NAME };
