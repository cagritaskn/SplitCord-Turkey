'use strict';

/**
 * Vencord'un (GPL-3.0, github.com/Vendicated/Vencord) "web" hedefini (masaüstüne özgü
 * olmayan, native köprüye ihtiyaç duymayan tarayıcı-uyumlu paket -- bkz.
 * browser/VencordNativeStub.ts) pinlenmiş bir commit'ten, YALNIZCA aşağıdaki
 * REMOVED_PLUGIN_DIRS'teki eklenti klasörleri silinerek (başka hiçbir kaynak değişikliği
 * yapılmadan) derleyip hem client/resources/vencord/ hem linux/client/resources/vencord/
 * altına kopyalar (paket platformdan bağımsız, iki istemci de AYNI dosyaları kullanıyor).
 *
 * resources/bin/ ve vendor/byedpi-src'in derleme çıktısıyla AYNI gerekçe: üçüncü taraf
 * kod repoya commitlenmiyor, npm run build-vencord ile yeniden üretiliyor (bkz. .gitignore).
 *
 * Gereksinim: git, ve pnpm (yoksa `npm install -g pnpm` ile kurulur).
 *
 * Kullanım: npm run build-vencord
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VENCORD_REPO = 'https://github.com/Vendicated/Vencord.git';
// KASITLI PİNLENDİ: Vencord'un webpack iç yapısına yaptığı yamalar Discord güncellemeleriyle
// kırılabiliyor -- rastgele bir "latest" clone yerine canlı testte doğrulanmış, bilinen-
// çalışan bir commit'e sabitlendi. Güncellemek isteyen biri bu hash'i bilerek değiştirmeli.
const VENCORD_COMMIT = '59a54286542651fff5ea53f0ce6cadf2a6aa7521';

// KULLANICI TALEBİ: Vencord ilk kez etkinleştirildiğinde "WebScreenShare" eklentisi
// (src/plugins/webScreenShare.browser) varsayılan AÇIK geliyordu. Bu eklenti start()'ta
// navigator.mediaDevices.getDisplayMedia'yı KENDİ Vencord seçici modalıyla değiştiriyor --
// SplitCord-Turkey'in kendi ekran paylaşımı seçicisi/kalite mantığıyla (bkz.
// screenSharePicker.js, discordWebviewPreload.js) doğrudan ÇAKIŞIYOR. Ayarda "kapalı"
// varsayılanı seçmek yalnızca YENİ profilleri kapsardı (eski profillerde eklenti zaten
// "açık" olarak kayıtlı) -- bu yüzden eklenti derleme anında komple kaldırılıyor.
// (Komşu "WebScreenShareFixes" eklentisi -- bitrate sınırını kaldırıp CPU sızıntısını
// düzeltiyor, getDisplayMedia'ya dokunmuyor -- KASITLI OLARAK kalıyor.)
// Pin güncellenirken klasör yeniden adlandırıldıysa derleme bilerek hata verir.
const REMOVED_PLUGIN_DIRS = ['src/plugins/webScreenShare.browser'];

const OUT_DIRS = [
  path.join(__dirname, '..', 'client', 'resources', 'vencord'),
  path.join(__dirname, '..', 'linux', 'client', 'resources', 'vencord'),
];
const ARTIFACTS = ['browser.js', 'browser.css', 'browser.js.LEGAL.txt'];

function ensurePnpm() {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' });
  } catch {
    console.log('[vencord] pnpm bulunamadı, kuruluyor (npm install -g pnpm)...');
    execFileSync('npm', ['install', '-g', 'pnpm'], { stdio: 'inherit', shell: true });
  }
}

function buildVencord() {
  ensurePnpm();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitcord-vencord-'));
  const srcDir = path.join(workDir, 'Vencord');
  try {
    console.log(`[vencord] klonlanıyor (${VENCORD_COMMIT})...`);
    execFileSync('git', ['clone', '--quiet', VENCORD_REPO, srcDir], { stdio: 'inherit' });
    execFileSync('git', ['checkout', '--quiet', VENCORD_COMMIT], { cwd: srcDir, stdio: 'inherit' });

    for (const relDir of REMOVED_PLUGIN_DIRS) {
      const target = path.join(srcDir, relDir);
      if (!fs.existsSync(target)) {
        throw new Error(`Kaldırılacak eklenti klasörü bulunamadı (pin güncellemesinde yeniden adlandırılmış/kaldırılmış olabilir): ${relDir}`);
      }
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[vencord] eklenti kaldırıldı: ${relDir}`);
    }

    console.log('[vencord] bağımlılıklar kuruluyor (pnpm install)...');
    execFileSync('pnpm', ['install'], { cwd: srcDir, stdio: 'inherit', shell: true });

    console.log('[vencord] web hedefi derleniyor (pnpm buildWebStandalone)...');
    execFileSync('pnpm', ['buildWebStandalone'], { cwd: srcDir, stdio: 'inherit', shell: true });

    // Ayarlar > Vencord'daki "Vencord Sürümü" satırı için -- Vencord'un çalışma zamanı
    // API'sinden (belgelenmemiş) okumak yerine derleme anında sabit bir dosyaya yazılıyor
    // (bkz. ipc.js app:get-vencord-version).
    const vencordPackageJson = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
    const versionInfo = { version: vencordPackageJson.version, commit: VENCORD_COMMIT };

    const distDir = path.join(srcDir, 'dist');
    for (const outDir of OUT_DIRS) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const file of ARTIFACTS) {
        fs.copyFileSync(path.join(distDir, file), path.join(outDir, file));
      }
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(versionInfo, null, 2));
      console.log(`[vencord] tamam -> ${outDir}`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    buildVencord();
  } catch (err) {
    console.error('HATA:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { buildVencord, VENCORD_COMMIT };
