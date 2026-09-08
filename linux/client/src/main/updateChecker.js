'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { app, shell } = require('electron');
const { isAppImage } = require('./packagingInfo');

// Windows karşılığının (client/src/main/updateChecker.js) portu. checkForUpdate()'in GitHub
// API mantığı (release/tag/sürüm karşılaştırma) BİREBİR aynı — tek fark asset seçimi ve
// "indirilen dosyayı aç" adımı (bkz. openDownloadedUpdate), ikisi de platforma özgü.
const REPO = 'cagritaskn/SplitCord-Turkey';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const USER_AGENT = 'SplitCord-Turkey-UpdateChecker';

const DOWNLOAD_PATH = path.join(os.tmpdir(), 'SplitCord-Turkey-Update.deb');

function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT, ...options.headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(get(res.headers.location, options));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

function getJson(url) {
  return get(url).then(
    (res) =>
      new Promise((resolve, reject) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 500) {
            reject(new Error(`GitHub API hata döndürdü: ${res.statusCode}`));
            return;
          }
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            if (res.statusCode === 404) parsed.__notFound = true;
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      }),
  );
}

function parseVersion(v) {
  return (v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Windows'ta ".exe" ile bitene bakıyordu; Linux'ta artık TEK dağıtım formatı ".deb" (bkz.
 * PORTING_PLAN.md D-36 — AppImage kaldırıldı). Release'ler artık iki mimari için ayrı ayrı
 * yayınlanıyor (bkz. PORTING_PLAN.md D-41), dosya adı deseni:
 * "SplitCord-Turkey-Linux-<sürüm>-AMD64.deb" / "...-ARM64.deb" — bu yüzden yalnızca ".deb"
 * ile bitene bakmak YETMEZ, çalışan sistemin mimarisiyle EŞLEŞEN dosyayı seçmemiz gerekiyor.
 * Yanlış mimarideki bir .deb'i indirip `dpkg -i` ile kurmaya çalışmak (mimari uyuşmazlığı
 * hatasıyla) başarısız olur — bu yüzden eşleşme bulunamazsa (desteklenmeyen bir mimaride
 * çalışıyoruz ya da release'de o mimari için asset yok) BİLEREK `undefined` dönüyoruz,
 * "ilk bulunan .deb'i al" gibi riskli bir varsayılana DÜŞMÜYORUZ. */
function pickAsset(assets) {
  const lower = (name) => name.toLowerCase();
  const archSuffix = process.arch === 'arm64' ? '-arm64.deb' : process.arch === 'x64' ? '-amd64.deb' : null;
  if (!archSuffix) return undefined;
  return assets.find((a) => lower(a.name).endsWith(archSuffix));
}

/** @returns {Promise<{available: boolean, latestVersion?: string, downloadUrl?: string, releaseNotes?: string, assetName?: string}>} */
async function checkForUpdate() {
  const release = await getJson(API_URL);
  if (!release || release.__notFound || release.message === 'Not Found') {
    return { available: false };
  }
  const latestVersion = release.tag_name;
  const currentVersion = app.getVersion();

  if (!isNewer(latestVersion, currentVersion)) {
    return { available: false, latestVersion };
  }

  // PORT_PLAN_2.md AP-2/Faz 4: release.html_url GitHub API'sinin HER release nesnesinde zaten
  // döndürdüğü, o release'in web sayfasına giden bağlantı -- AppImage tarafı artık indirme/kurulum
  // YAPMIYOR, yalnızca bu sayfayı tarayıcıda açıyor (bkz. openReleasePage).
  const releaseUrl = release.html_url || `https://github.com/${REPO}/releases/tag/${latestVersion}`;

  // ÖNEMLİ AYRIM: AppImage tarafı hiçbir asset İNDİRMİYOR (yalnızca sürüm sayfasını açıyor), bu
  // yüzden "güncelleme mevcut mu" sorusunu bir .deb asset'inin bulunup bulunmadığına
  // BAĞLAMAMALI -- pickAsset() yalnızca "*-amd64.deb"/"*-arm64.deb" arıyor (bkz. altında), bir
  // release yalnızca AppImage asset'i içerse bile (ki gelecekte böyle olabilir) AppImage
  // kullanıcısı hâlâ doğru şekilde "yeni sürüm var" görmeli. .deb tarafı ise asset'i GERÇEKTEN
  // indirip kuracağı için eşleşen asset yoksa "güncelleme yok" demeye devam etmeli (ESKİ davranış,
  // hiç değişmedi).
  if (isAppImage()) {
    return { available: true, latestVersion, releaseUrl };
  }

  const asset = pickAsset(release.assets || []);
  if (!asset) {
    return { available: false, latestVersion, releaseUrl };
  }

  return {
    available: true,
    latestVersion,
    downloadUrl: asset.browser_download_url,
    releaseNotes: release.body || '',
    assetName: asset.name,
    releaseUrl,
  };
}

/** PORT_PLAN_2.md AP-2: AppImage'ın güncelleme akışı -- `.deb`'in indir+`pkexec dpkg -i` (D-38)
 * akışının AYNISI DEĞİL, kullanıcının kendi tercihiyle basitleştirildi: yeni sürüm mevcutsa
 * yalnızca GitHub release sayfasını tarayıcıda açıyoruz, indirme/kurulum kullanıcının kendi elinde
 * (indirdiği yeni AppImage'ı eskisinin üzerine koyması gibi). Kök/pkexec gerektiren bir adım YOK.
 * `.deb` tarafının downloadUpdate/installDownloadedUpdate/openDownloadedUpdate'i bu fonksiyondan
 * TAMAMEN bağımsız, hiç değişmedi. */
function openReleasePage(releaseUrl) {
  if (!releaseUrl) {
    throw new Error('Sürüm sayfası adresi yok -- önce güncellemeleri kontrol et.');
  }
  return shell.openExternal(releaseUrl);
}

async function downloadUpdate(downloadUrl) {
  await downloadFile(downloadUrl, DOWNLOAD_PATH);
}

/** Windows'un "indirilen .exe'yi normal şekilde aç, Windows kurulum sihirbazını göstersin"
 * akışının burada karşılığı: `pkexec dpkg -i` ile indirilen `.deb`'i doğrudan kuruyoruz (bkz.
 * serviceInstaller.js/appUninstaller.js'teki AYNI pkexec deseni) — bu, Windows'taki UAC'nin
 * kavramsal karşılığı, kullanıcı yalnızca BİR KEZ parolasını/onayını veriyor.
 *
 * DÜZELTİLDİ (2026-09-05, gerçek bir Linux'ta CANLI TESTTE bulunan KRİTİK BUG — bkz.
 * PORTING_PLAN.md D-38): önceki tasarım `shell.openPath(DOWNLOAD_PATH)` ile masaüstü
 * ortamının KENDİ `.deb` işleyicisine (gdebi/GNOME Software vb.) güveniyordu — bu ikili olarak
 * İKİ SEBEPTEN çalışmıyordu: (1) `DOWNLOAD_PATH` hâlâ AppImage döneminden kalma ".AppImage"
 * uzantısıyla oluşturuluyordu (dosyanın GERÇEK içeriği bir `.deb` olsa bile) — `xdg-mime query
 * filetype` bunu içeriğe değil UZANTIYA bakarak `application/vnd.appimage` olarak yanlış
 * tanıyordu, bu mimetype için kayıtlı bir varsayılan uygulama da olmadığından `xdg-open`
 * SESSİZCE hiçbir şey yapmıyordu (gerçek testte doğrulandı: exit code 0, hiçbir pencere/işlem
 * açılmadı). (2) Uzantı düzeltilse bile (`.deb`), doğru bir GUI paket kurucusunun (GDebi vb.)
 * hedef sistemde kurulu olduğu GARANTİ DEĞİL (D-12'nin geniş Ubuntu/Debian ailesi hedefinde
 * bazı dağıtımlarda hiç yok) — kurulu değilse yine sessizce hiçbir şey olmazdı. Artık dış bir
 * GUI aracına bağımlı olmayan, zaten kanıtlanmış `pkexec` yoluna geçildi. */
function installDownloadedUpdate() {
  return new Promise((resolve, reject) => {
    const proc = spawn('pkexec', ['dpkg', '-i', DOWNLOAD_PATH], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`pkexec bulunamadı. Elle kurmak için bir terminalde: sudo dpkg -i "${DOWNLOAD_PATH}"`));
      } else {
        reject(new Error(`pkexec çalıştırılamadı: ${err.message}`));
      }
    });
    proc.on('close', (code, signal) => {
      if (code === 0) { resolve(); return; }
      if (code === 126 || signal === 'SIGTERM') { reject(new Error('CANCELLED')); return; }
      reject(new Error(`Kurulum başarısız (çıkış kodu ${code}): ${stderr.trim() || 'bilinmeyen hata'}`));
    });
  });
}

async function openDownloadedUpdate() {
  if (!fs.existsSync(DOWNLOAD_PATH)) {
    throw new Error('İndirilen güncelleme dosyası bulunamadı, tekrar indir.');
  }

  await installDownloadedUpdate();

  // dpkg -i ile ÇALIŞMAKTA OLAN bu uygulamanın kendi dosyaları üzerine yazıldı (Linux'ta bu
  // sorunsuz — açık dosya tanıtıcıları eski inode'u tutmaya devam eder, bkz. D-31'in AYNI
  // rename/inode mantığı). Yeni sürümün devreye girmesi için yeniden başlatmak gerekiyor.
  app.relaunch();
  app.quit();
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    get(url)
      .then((res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`İndirme başarısız: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .catch(reject);
  });
}

module.exports = { checkForUpdate, downloadUpdate, openDownloadedUpdate, openReleasePage };
