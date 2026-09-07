'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// electron-builder'ın package.json'daki extraResources yapılandırması (bkz. "service-installer"
// hedefi) hem yayınlanmış (dotnet publish) servis binary'lerini HEM `linux/packaging/`'daki
// install.sh/uninstall.sh/systemd/*.service dosyalarını AYNI "service-installer" klasörüne
// birleştiriyor -- yani install.sh'in kendisi de, install.sh'in beklediği "yayınlanmış servis
// çıktısı" da AYNI dizinde duruyor. install.sh çağrısına bu dizini AÇIKÇA ilk argüman olarak
// vermemiz gerekiyor -- script'in kendi varsayılanı (`../service/SplitCordServiceLinux/bin/...`,
// bkz. install.sh) yalnızca GİT REPOSU içinden elle çalıştırıldığında (bkz. PORTING_PLAN.md §8.5)
// doğru, PAKETLENMİŞ bir uygulama içinden çalıştırıldığında YANLIŞ bir yola işaret eder.
function getInstallerDir() {
  return path.join(process.resourcesPath, 'service-installer');
}

// Dev modunda (`electron .`) process.resourcesPath Electron'un KENDİ dahili resources'ına işaret
// eder (bkz. PORTING_PLAN.md D-31'deki AYNI kısıt, updateChecker.js için) -- bu özellik yalnızca
// paketlenmiş (AppImage/.deb) sürümde anlamlı, dev modunda install.sh hiç bulunamaz.
function isInstallerBundled() {
  try {
    return fs.existsSync(path.join(getInstallerDir(), 'install.sh'));
  } catch {
    return false;
  }
}

/** DPI servisini (systemd birimi + /opt/splitcord) kurar -- kök yetki gerektirdiği için
 * `pkexec` (Linux'un GUI parola istemi, Windows'taki UAC'nin karşılığı) ile çalıştırılıyor.
 * Kullanıcı pkexec'in kendi native diyaloğunda parolasını girip onaylamadıkça hiçbir şey
 * olmaz -- bu, ayrı bir "emin misiniz?" onayına gerek bırakmayan yeterli bir izin kapısı. */
function installDpiService() {
  return new Promise((resolve, reject) => {
    const installerDir = getInstallerDir();
    const installScript = path.join(installerDir, 'install.sh');
    if (!fs.existsSync(installScript)) {
      reject(new Error('install.sh bulunamadı -- bu özellik yalnızca paketlenmiş (AppImage/.deb) sürümde çalışır.'));
      return;
    }

    const proc = spawn('pkexec', ['bash', installScript, installerDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      // ENOENT: pkexec sistemde kurulu değil -- son derece nadir (polkit her modern masaüstü
      // dağıtımında varsayılan gelir) ama yine de kullanıcıya elle yapılacak alternatifi
      // gösterebilmek için ayrı bir mesajla fırlatıyoruz.
      if (err.code === 'ENOENT') {
        reject(new Error(`pkexec bulunamadı. Elle kurmak için bir terminalde: sudo bash "${installScript}" "${installerDir}"`));
      } else {
        reject(new Error(`pkexec çalıştırılamadı: ${err.message}`));
      }
    });
    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      // code === 126/127: kullanıcı pkexec diyaloğunu iptal etti ya da parolayı yanlış girdi
      // (polkit'in kendi davranışı) -- bunu genel bir "kurulum başarısız" değil, "iptal edildi"
      // olarak ayırt ediyoruz ki kullanıcı gereksiz bir hata mesajı görmesin.
      if (code === 126 || signal === 'SIGTERM') {
        reject(new Error('CANCELLED'));
        return;
      }
      reject(new Error(`Kurulum başarısız (çıkış kodu ${code}): ${stderr.trim() || 'bilinmeyen hata'}`));
    });
  });
}

module.exports = { installDpiService, isInstallerBundled, getInstallerDir };
