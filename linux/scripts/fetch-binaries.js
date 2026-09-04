'use strict';

/**
 * Windows karşılığının (scripts/fetch-binaries.js) Linux portu — dnsproxy ve nextdns'in HAZIR
 * Linux binary'lerini pinlenmiş resmi GitHub release'lerinden indirir; zapret, zapret2 ve
 * ByeDPI'yi ise (hiçbiri hazır Linux binary'si yayınlamıyor, bkz. ../PORTING_PLAN.md D-13)
 * ayrı build-*.sh script'leriyle kaynaktan derleyip hepsini linux/resources/bin/<tool>/ altına
 * yerleştirir. Servis (linux/service/SplitCordServiceLinux) build sırasında bu klasörü kendi
 * çıktı dizinine kopyalar (bkz. SplitCordServiceLinux.csproj).
 *
 * Windows'tan FARK: .zip yerine .tar.gz (Linux release asset'leri bu formatta) — Node'a ek bir
 * npm bağımlılığı (adm-zip'in gzip/tar karşılığı) eklemek yerine sistemin kendi `tar`'ına
 * devrediliyor (Linux'ta her zaman hazır bulunur, bu script zaten yalnızca Linux'ta çalışacak).
 *
 * Kullanım: npm run fetch-binaries (bkz. linux/package.json)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RESOURCES_BIN = path.join(__dirname, '..', 'resources', 'bin');
const SCRIPTS_DIR = __dirname;

// Windows tarafıyla AYNI pinlenmiş sürümler (davranışsal tutarlılık için) — ikisi de gerçek
// Linux asset'lerine sahip olduğu `gh api` ile doğrulandı (2026-09-04).
const TARGETS = [
  {
    tool: 'dnsproxy',
    url: 'https://github.com/AdguardTeam/dnsproxy/releases/download/v0.84.1/dnsproxy-linux-amd64-v0.84.1.tar.gz',
    binaryName: 'dnsproxy',
  },
  {
    tool: 'nextdns',
    url: 'https://github.com/nextdns/nextdns/releases/download/v1.47.3/nextdns_1.47.3_linux_amd64.tar.gz',
    binaryName: 'nextdns',
  },
];

function download(url, destPath) {
  // Windows tarafındaki AYNI gerekçe: sistemin curl'ü Node'un yerleşik fetch'inden daha
  // güvenilir (bazı kurumsal/sanal ağ ortamlarında).
  try {
    execFileSync('curl', ['-fsSL', url, '-o', destPath], { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`İndirme başarısız: ${url}\n${err.message}`);
  }
}

function fetchPrebuiltTarget(target) {
  console.log(`[${target.tool}] indiriliyor: ${target.url}`);
  const destDir = path.join(RESOURCES_BIN, target.tool);
  fs.mkdirSync(destDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), `splitcord-${target.tool}-`));
  try {
    const archivePath = path.join(tmpDir, 'archive.tar.gz');
    download(target.url, archivePath);
    execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir]);

    const foundPath = findFileRecursive(tmpDir, target.binaryName);
    if (!foundPath) {
      throw new Error(`${target.tool}: arşiv içinde "${target.binaryName}" bulunamadı (release yapısı değişmiş olabilir)`);
    }
    const outPath = path.join(destDir, target.binaryName);
    fs.copyFileSync(foundPath, outPath);
    fs.chmodSync(outPath, 0o755);
    console.log(`[${target.tool}] tamam -> ${outPath}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findFileRecursive(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function runBuildScript(scriptName, label) {
  console.log(`\n[${label}] ${scriptName} çalıştırılıyor (kaynaktan derleme, birkaç dakika sürebilir)...`);
  execFileSync('bash', [path.join(SCRIPTS_DIR, scriptName)], { stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(RESOURCES_BIN, { recursive: true });

  for (const target of TARGETS) {
    fetchPrebuiltTarget(target);
  }

  // zapret/zapret2/ByeDPI hiçbiri hazır Linux binary'si yayınlamıyor -- üçü de kaynaktan
  // derleniyor (bkz. build-zapret.sh/build-zapret2.sh/build-byedpi.sh). Derleme başarısız
  // olursa (ör. libnetfilter-queue-dev kurulu değilse) burada AÇIKÇA duruyoruz, sessizce
  // eksik bırakmıyoruz.
  runBuildScript('build-zapret.sh', 'zapret');
  runBuildScript('build-zapret2.sh', 'zapret2');
  runBuildScript('build-byedpi.sh', 'byedpi');

  console.log('\nTüm DPI araçları hazır. Servisi yeniden build etmeyi unutma: dotnet build linux/service/SplitCordServiceLinux');
}

main().catch((err) => {
  console.error('HATA:', err.message);
  process.exitCode = 1;
});
