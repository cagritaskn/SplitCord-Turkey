'use strict';

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { logEvent } = require('./log');

/**
 * "DPI servisine ulaşılamıyor" (ECONNREFUSED) hatasının bilinen bir nedeni: Windows
 * Defender'ın ML sezgisinin SplitCordService.dll'i yanlış-pozitif işaretleyip karantinaya
 * alması (canlı bir kullanıcıda doğrulandı: Trojan:Script/Wacatac.C!ml, dosya diskten
 * tamamen silindi). Kalıcı çözüm geliştiricinin her sürümde Microsoft'a gönderdiği
 * yanlış-pozitif bildirimi ama incelemesi günler sürebiliyor -- bu arada etkilenen
 * kullanıcılar için bu modül, servis dosyalarının bulunduğu klasörü Defender taramasından
 * muaf tutmayı DENER.
 *
 * KASITLI TASARIM KARARLARI (kurulum sırasında SESSİZCE aynı şeyi yapmak önce denendi,
 * sonra reddedildi -- bkz. sohbet geçmişi):
 * - Yalnızca kullanıcı bir düğmeye TIKLADIĞINDA çalışır (kurulum/ilk açılışta OTOMATİK
 *   DEĞİL). "Taze indirilmiş bir kurulumun kendini sessizce AV'den muaf tutması" tam
 *   olarak kötü amaçlı yazılımların kendini bağışıklamak için kullandığı davranış (MITRE
 *   ATT&CK T1562.001) ve orijinal yanlış-pozitifi tetikleyen DAVRANIŞSAL sezgiyi
 *   güçlendirebilirdi. Kullanıcının açıkça bir UAC istemini onaylayarak tetiklediği tek
 *   seferlik, dar kapsamlı, yalnızca-hata-durumunda-görünen bir eylem çok daha az şüpheli.
 * - Kapsam yalnızca resources/service-installer alt klasörü (tüm $INSTDIR değil) --
 *   Electron/JS kaynaklarını taramadan muaf bırakmıyoruz, yalnızca gerçekten flag yiyen
 *   .NET servis binary'lerinin bulunduğu dar alanı.
 * - -EncodedCommand YOK (AMSI/davranışsal sezgilerin en sık işaretlediği "gizlenmiş
 *   PowerShell" göstergelerinden biri) -- düz, statik, denetlenebilir bir .ps1 içeriği.
 * - Tamper Protection açıkken Add-MpPreference hata FIRLATMADAN sessizce hiçbir şey
 *   yapmayabiliyor (canlı kullanıcıda doğrulandı: IsTamperProtected=True). Bu yüzden
 *   ekleme sonrası listeyi TEKRAR okuyup GERÇEKTEN eklenip eklenmediğini doğruluyoruz --
 *   kullanıcıyı yanlış bir "başarılı" mesajıyla yanıltmamak için. Tamper Protection açıkken
 *   istisna eklemenin TEK güvenilir yolu Windows Güvenliği uygulamasının kendi arayüzü --
 *   bloklanırsa kullanıcıya bunu açıkça söylüyoruz.
 */

const SCRIPT_CONTENT = `
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$ResultPath
)
try {
    $current = (Get-MpPreference).ExclusionPath
    if ($current -contains $InstallDir) {
        Set-Content -Path $ResultPath -Value "ALREADY_PRESENT" -Encoding UTF8
        exit 0
    }

    Add-MpPreference -ExclusionPath $InstallDir -ErrorAction Stop
    Start-Sleep -Milliseconds 300

    $after = (Get-MpPreference).ExclusionPath
    if ($after -contains $InstallDir) {
        Set-Content -Path $ResultPath -Value "OK" -Encoding UTF8
    } else {
        # Add-MpPreference hata firlatmadi ama liste degismedi -- tipik olarak Tamper
        # Protection'in sessiz engellemesi.
        Set-Content -Path $ResultPath -Value "BLOCKED" -Encoding UTF8
    }
} catch {
    Set-Content -Path $ResultPath -Value "ERROR:$($_.Exception.Message)" -Encoding UTF8
}
`.trim();

function getServiceInstallerDir() {
  // Paketlenmiş kurulumda app.getPath('exe'), $INSTDIR\\SplitCord-Turkey.exe'nin kendisi --
  // servis dosyaları $INSTDIR\\resources\\service-installer altında (bkz. package.json
  // extraResources).
  return path.join(path.dirname(app.getPath('exe')), 'resources', 'service-installer');
}

async function addDefenderException() {
  if (!app.isPackaged) {
    return { ok: false, blocked: false, message: 'Bu özellik yalnızca paketlenmiş kurulumda kullanılabilir.' };
  }

  const installDir = getServiceInstallerDir();
  const tmpDir = app.getPath('temp');
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const scriptPath = path.join(tmpDir, `splitcord-defender-exclusion-${uid}.ps1`);
  const resultPath = path.join(tmpDir, `splitcord-defender-exclusion-result-${uid}.txt`);

  const cleanup = () => {
    try { fs.unlinkSync(scriptPath); } catch { /* zaten yoksa sorun değil */ }
    try { fs.unlinkSync(resultPath); } catch { /* zaten yoksa sorun değil */ }
  };

  try {
    fs.writeFileSync(scriptPath, SCRIPT_CONTENT, 'utf8');
  } catch (err) {
    logEvent('defender-exclusion-write-script-failed', { error: err.message });
    return { ok: false, blocked: false, message: err.message };
  }

  return new Promise((resolve) => {
    // Start-Process -Verb RunAs TEK bir UAC istemi tetikler (istemci -- servisin aksine --
    // asla kendisi yönetici olarak çalışmaz, bkz. mimari kuralı; bu yüzden gereken TEK
    // seferlik yükseltmeyi ayrı, kısa ömürlü bir alt süreçle istiyoruz). -Wait, dış
    // (yükseltilmemiş) süreci yükseltilmiş alt süreç bitene kadar bekletir. Elevation
    // sınırını aştığı için stdout doğrudan geri okunamıyor -- sonucu ResultPath'teki
    // dosyadan okuyoruz (bkz. SCRIPT_CONTENT).
    const psArgs = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" -InstallDir "${installDir}" -ResultPath "${resultPath}"`;
    const outerArgs = [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '${psArgs.replace(/'/g, "''")}'`,
    ];

    const child = spawn('powershell.exe', outerArgs, { windowsHide: true });

    child.on('error', (err) => {
      logEvent('defender-exclusion-spawn-error', { error: err.message });
      cleanup();
      resolve({ ok: false, blocked: false, message: err.message });
    });

    child.on('exit', () => {
      let outcome = null;
      try {
        outcome = fs.readFileSync(resultPath, 'utf8').trim();
      } catch {
        // Kullanıcı UAC istemini reddetmiş/kapatmış olabilir -- sonuç dosyası hiç yazılmamış.
      }
      cleanup();

      if (!outcome) {
        logEvent('defender-exclusion-cancelled-or-failed', {});
        resolve({ ok: false, blocked: false, message: 'Yönetici izni verilmedi ya da işlem tamamlanamadı.' });
      } else if (outcome === 'OK' || outcome === 'ALREADY_PRESENT') {
        // İstisna eklenmesi, Defender'ın DAHA ÖNCE karantinaya alıp diskten sildiği
        // dosyayı GERİ GETİRMEZ -- yalnızca BUNDAN SONRA aynı şeyin tekrarlanmasını önler.
        // Kullanıcıya doğru yol göstermek için servis .dll'inin hâlâ diskte olup olmadığını
        // ayrıca kontrol ediyoruz.
        const dllPath = path.join(installDir, 'SplitCordService.dll');
        const dllMissing = !fs.existsSync(dllPath);
        logEvent('defender-exclusion-added', { alreadyPresent: outcome === 'ALREADY_PRESENT', installDir, dllMissing });
        resolve({ ok: true, blocked: false, dllMissing, message: null });
      } else if (outcome === 'BLOCKED') {
        logEvent('defender-exclusion-blocked-by-tamper-protection', { installDir });
        resolve({
          ok: false,
          blocked: true,
          message: 'Windows Defender Kurcalamaya Karşı Koruma (Tamper Protection) etkin olduğu için istisna eklenemedi.',
        });
      } else {
        logEvent('defender-exclusion-error', { outcome });
        resolve({ ok: false, blocked: false, message: outcome.replace(/^ERROR:/, '') });
      }
    });
  });
}

module.exports = { addDefenderException };
