'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, shell } = require('electron');

// Windows karşılığının (client/src/main/updateChecker.js) portu. checkForUpdate()'in GitHub
// API mantığı (release/tag/sürüm karşılaştırma) BİREBİR aynı — tek fark asset seçimi ve
// "indirilen dosyayı aç" adımı (bkz. openDownloadedUpdate), ikisi de platforma özgü.
const REPO = 'cagritaskn/SplitCord-Turkey';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const USER_AGENT = 'SplitCord-Turkey-UpdateChecker';

const DOWNLOAD_PATH = path.join(os.tmpdir(), 'SplitCord-Turkey-Update.AppImage');

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

function isAppImage() {
  return !!process.env.APPIMAGE;
}

/** Windows'ta ".exe" ile bitene bakıyordu; burada önce ".AppImage" (dağıtımdan bağımsız,
 * bkz. PORTING_PLAN.md D-12) tercih ediliyor, yoksa ".deb"ye düşülüyor. */
function pickAsset(assets) {
  const lower = (name) => name.toLowerCase();
  return (
    assets.find((a) => lower(a.name).endsWith('.appimage')) ||
    assets.find((a) => lower(a.name).endsWith('.deb'))
  );
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

  const asset = pickAsset(release.assets || []);
  if (!asset) {
    return { available: false, latestVersion };
  }

  return {
    available: true,
    latestVersion,
    downloadUrl: asset.browser_download_url,
    releaseNotes: release.body || '',
    assetName: asset.name,
  };
}

async function downloadUpdate(downloadUrl) {
  await downloadFile(downloadUrl, DOWNLOAD_PATH);
  fs.chmodSync(DOWNLOAD_PATH, 0o755);
}

/** Windows'un "indirilen .exe'yi normal şekilde aç, Windows kurulum sihirbazını göstersin"
 * akışının burada tam karşılığı yok — iki farklı yol izleniyor:
 *
 * AppImage: kendi kendini güncelleyen bir ikili dosya olduğu için, indirilen YENİ AppImage
 * çalışmakta olan AppImage'in ÜZERİNE (process.env.APPIMAGE — AppImage runtime'ının kendi
 * ayarladığı, gerçek .AppImage dosyasının yolu) kopyalanıp uygulama aynı yoldan yeniden
 * başlatılıyor. Linux'ta çalışmakta olan bir dosyanın üzerine yazmak (Windows'un aksine)
 * SORUNSUZ çalışır -- eski süreç kendi açık dosya tanıtıcısını (inode) süreç sonlanana kadar
 * tutmaya devam eder, yeni içerik bir sonraki çalıştırmada devreye girer.
 *
 * .deb (ya da AppImage değilse, ör. dev modu): en güvenli/en az sürpriz veren yol kullanıcıyı
 * masaüstü ortamının kendi .deb işleyicisine (gdebi/GNOME Software vb.) yönlendirmek --
 * `shell.openPath` bunu tetikler, ama kurulum için kullanıcının kendi onayı/şifresi gerekir
 * (Windows'taki UAC'nin kavramsal karşılığı).
 *
 * DOĞRULANMADI (bkz. ../../PORTING_PLAN.md §2 madde 5): AppImage kendi kendini değiştirme
 * akışı hiç gerçek bir Linux'ta test edilmedi -- özellikle AppImage'in bulunduğu dizine yazma
 * izni olmayan bir kurulumda (ör. salt-okunur bir konum) bu adım başarısız olur, hata mesajı
 * kullanıcıya "elle indirip değiştirmesi" gerektiğini söylemeli. */
async function openDownloadedUpdate() {
  if (!fs.existsSync(DOWNLOAD_PATH)) {
    throw new Error('İndirilen güncelleme dosyası bulunamadı, tekrar indir.');
  }

  if (isAppImage()) {
    const currentAppImagePath = process.env.APPIMAGE;
    try {
      fs.copyFileSync(DOWNLOAD_PATH, currentAppImagePath);
      fs.chmodSync(currentAppImagePath, 0o755);
    } catch (err) {
      throw new Error(
        `Güncelleme dosyası "${currentAppImagePath}" konumuna kopyalanamadı (yazma izni olmayabilir): ${err.message}. ` +
          `İndirilen dosyayı (${DOWNLOAD_PATH}) elle bu konuma taşımanız gerekebilir.`,
      );
    }
    app.relaunch();
    app.quit();
    return;
  }

  const err = await shell.openPath(DOWNLOAD_PATH);
  if (err) throw new Error(err);
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

module.exports = { checkForUpdate, downloadUpdate, openDownloadedUpdate };
