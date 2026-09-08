'use strict';

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { isAppImage } = require('./packagingInfo');

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
    if (!fs.existsSync(path.join(installerDir, 'install.sh'))) {
      reject(new Error('install.sh bulunamadı -- bu özellik yalnızca paketlenmiş (AppImage/.deb) sürümde çalışır.'));
      return;
    }

    // CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-10): AppImage'da installerDir (process.resourcesPath),
    // AppImage'ın kendi FUSE bağlama noktasının (/tmp/.mount_XXXX/resources/...) İÇİNDE duruyor --
    // bu bağlama, çalıştıran kullanıcının KENDİ uid'siyle, "allow_other" OLMADAN yapılıyor (AppImage
    // runtime'ının kendi varsayılanı). Sonucu: pkexec ile ROOT olarak çalıştırılan bash bile bu
    // dizindeki dosyaları OKUYAMIYOR (canlı testte doğrulandı: "pkexec cat .../install.sh" ->
    // "Erişim engellendi", dosya izinleri ls'te 777 görünse bile -- bu normal POSIX izin
    // denetimi DEĞİL, FUSE'nin kendi mount-seviyesi erişim kısıtlaması). bash bunu "Permission
    // denied" görüp 126 ile çıkıyor -- aşağıdaki kod bu 126'yı "kullanıcı pkexec diyaloğunu iptal
    // etti" sanıp YANLIŞ bir "CANCELLED" hatası gösteriyordu; kullanıcı GERÇEKTE hiçbir şey iptal
    // etmemişti, kurulum FUSE izni yüzünden hiç denenmemişti bile. .deb'de installerDir normal
    // bir ext4 yolu (/opt/SplitCord-Turkey/...) olduğu için bu sorun hiç yaşanmıyordu (madde 1.2
    // gereği .deb dalı burada TEK SATIR değişmedi -- yalnızca AppImage'da devreye giren YENİ bir
    // ön adım eklendi). Düzeltme: AppImage'da kurulum dosyalarını ÖNCE FUSE dışına (izinleri
    // KORUYARAK, `cp -a`) gerçek bir /tmp dizinine kopyalayıp pkexec'i O kopyaya karşı çalıştırıyoruz
    // -- kopya normal bir dosya sistemi yolu olduğu için root'un erişimini hiçbir şey engellemiyor.
    let effectiveDir = installerDir;
    let tempDirToCleanup = null;
    if (isAppImage()) {
      try {
        tempDirToCleanup = fs.mkdtempSync(path.join(os.tmpdir(), 'splitcord-install-'));
        execFileSync('cp', ['-a', `${installerDir}/.`, tempDirToCleanup]);
        effectiveDir = tempDirToCleanup;
      } catch (err) {
        reject(new Error(`Kurulum dosyaları geçici bir dizine kopyalanamadı: ${err.message}`));
        return;
      }
    }
    const installScript = path.join(effectiveDir, 'install.sh');

    const cleanup = () => {
      if (!tempDirToCleanup) return;
      try {
        fs.rmSync(tempDirToCleanup, { recursive: true, force: true });
      } catch {
        // en iyi çaba -- kalırsa yalnızca /tmp'de zararsız bir artık kalır
      }
    };

    const proc = spawn('pkexec', ['bash', installScript, effectiveDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      cleanup();
      // ENOENT: pkexec sistemde kurulu değil -- son derece nadir (polkit her modern masaüstü
      // dağıtımında varsayılan gelir) ama yine de kullanıcıya elle yapılacak alternatifi
      // gösterebilmek için ayrı bir mesajla fırlatıyoruz.
      if (err.code === 'ENOENT') {
        reject(new Error(`pkexec bulunamadı. Elle kurmak için bir terminalde: sudo bash "${installScript}" "${effectiveDir}"`));
      } else {
        reject(new Error(`pkexec çalıştırılamadı: ${err.message}`));
      }
    });
    proc.on('close', (code, signal) => {
      cleanup();
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

/** DPI servisini (systemd birimi + /opt/splitcord) kaldırır -- installDpiService ile AYNI FUSE
 * kısıtı burada da geçerli (uninstall.sh da installerDir/AppImage FUSE bağlamasının içinde),
 * bu yüzden AYNI kopyala-sonra-pkexec deseni tekrarlanıyor. uninstall.sh kendi başına yeterli
 * (yalnızca opsiyonel --purge argümanı alıyor, installerDir'e ihtiyacı yok) -- kullanıcı verisini
 * KORUMAK için --purge GEÇMİYORUZ (bu, "Ayarlar > Tüm Ayarları Sıfırla" ile karışmasın diye
 * kasıtlı bir seçim; --purge kullanıcının DPI stratejisi/DNS ayarlarını da siler). */
function uninstallDpiService() {
  return new Promise((resolve, reject) => {
    const installerDir = getInstallerDir();
    if (!fs.existsSync(path.join(installerDir, 'uninstall.sh'))) {
      reject(new Error('uninstall.sh bulunamadı -- bu özellik yalnızca paketlenmiş (AppImage/.deb) sürümde çalışır.'));
      return;
    }

    let effectiveDir = installerDir;
    let tempDirToCleanup = null;
    if (isAppImage()) {
      try {
        tempDirToCleanup = fs.mkdtempSync(path.join(os.tmpdir(), 'splitcord-uninstall-'));
        execFileSync('cp', ['-a', `${installerDir}/.`, tempDirToCleanup]);
        effectiveDir = tempDirToCleanup;
      } catch (err) {
        reject(new Error(`Kaldırma dosyaları geçici bir dizine kopyalanamadı: ${err.message}`));
        return;
      }
    }
    const uninstallScript = path.join(effectiveDir, 'uninstall.sh');

    const cleanup = () => {
      if (!tempDirToCleanup) return;
      try {
        fs.rmSync(tempDirToCleanup, { recursive: true, force: true });
      } catch {
        // en iyi çaba -- kalırsa yalnızca /tmp'de zararsız bir artık kalır
      }
    };

    const proc = spawn('pkexec', ['bash', uninstallScript], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      cleanup();
      if (err.code === 'ENOENT') {
        reject(new Error(`pkexec bulunamadı. Elle kaldırmak için bir terminalde: sudo bash "${uninstallScript}"`));
      } else {
        reject(new Error(`pkexec çalıştırılamadı: ${err.message}`));
      }
    });
    proc.on('close', (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      if (code === 126 || signal === 'SIGTERM') {
        reject(new Error('CANCELLED'));
        return;
      }
      reject(new Error(`Kaldırma başarısız (çıkış kodu ${code}): ${stderr.trim() || 'bilinmeyen hata'}`));
    });
  });
}

module.exports = { installDpiService, uninstallDpiService, isInstallerBundled, getInstallerDir };
