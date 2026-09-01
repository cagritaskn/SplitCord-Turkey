'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, shell } = require('electron');

const REPO = 'cagritaskn/SplitCord-Turkey';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// GitHub API, User-Agent header'ı olmayan istekleri 403 ile reddediyor.
const USER_AGENT = 'SplitCord-Turkey-UpdateChecker';

// İndirilen kurulum dosyası hep aynı sabit ada kaydediliyor — "zaten indirilmiş mi"
// durumunu ayrıca bir yerde tutmaya gerek kalmadan, bir sonraki indirmede üzerine yazılıyor.
const DOWNLOAD_PATH = path.join(os.tmpdir(), 'SplitCord-Turkey-Update.exe');

function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT, ...options.headers } }, (res) => {
        // GitHub release asset indirme linkleri (S3'e) 302 ile yönlendiriyor.
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
          // 404, GitHub'ın "bu repo'da henüz hiç release yok" (ya da repo henüz
          // yayınlanmadı) yanıtı — bunu ağ/API hatası olarak değil, "güncelleme yok"
          // olarak ele almak için body'yi yine de (varsa) parse edip döndürüyoruz;
          // asıl "gerçek hata" ayrımı yalnızca 500+ için geçerli.
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

// "v0.2.0" -> [0,2,0]; sürüm karşılaştırması semver'in basit bir alt kümesi (major.minor.patch).
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

/** @returns {Promise<{available: boolean, latestVersion?: string, downloadUrl?: string, releaseNotes?: string}>} */
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

  const asset = (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'));
  if (!asset) {
    // Yeni bir tag var ama henüz kurulum dosyası eklenmemiş (taslak/hazırlanıyor release) —
    // kullanıcıya "güncelleme var" deyip indirilecek bir şey sunmamak yanıltıcı olur.
    return { available: false, latestVersion };
  }

  return {
    available: true,
    latestVersion,
    downloadUrl: asset.browser_download_url,
    releaseNotes: release.body || '',
  };
}

/** Kurulum dosyasını indirir — kurmuyor. Kurulum, kullanıcının kendisinin açıp normal
 * (sessiz olmayan) kurulum sihirbazını takip etmesiyle yapılıyor; bkz. openDownloadedUpdate.
 * Bu sayede ne otomatik kapatma/UAC'siz SYSTEM kurulumu gibi karmaşık bir akışa ne de
 * her güncellemede beklenmedik bir kapanmaya gerek kalıyor — kullanıcı istediği zaman,
 * normal bir .exe kurulumunda olduğu gibi kurulumu tamamlar. */
async function downloadUpdate(downloadUrl) {
  await downloadFile(downloadUrl, DOWNLOAD_PATH);
}

/** İndirilen kurulum dosyasını normal (sessiz olmayan) şekilde açar — işletim sistemi
 * kendi UAC istemini ve kurulum sihirbazını gösterir, tıpkı kullanıcı .exe dosyasını
 * elle çift tıklamış gibi. */
async function openDownloadedUpdate() {
  if (!fs.existsSync(DOWNLOAD_PATH)) {
    throw new Error('İndirilen güncelleme dosyası bulunamadı, tekrar indir.');
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
