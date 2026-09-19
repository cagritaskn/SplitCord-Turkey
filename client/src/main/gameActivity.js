'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readLocalSettings } = require('./localSettings');
const { logEvent } = require('./log');
const serviceClient = require('./serviceClient');

// KULLANICI TALEBİ: Steam vb. bir oyun açılınca Discord'da "X oynuyor" görünsün. Discord'un
// web istemcisi oyun algılamayı (masaüstü istemciye özel) yapmıyor; Vesktop/ArmCord'un
// kullandığı arRPC'deki yöntemi izliyoruz: çalışan işlemleri Discord'un herkese açık
// "algılanabilir oyunlar" listesiyle (resources/detectable-games.json, bkz.
// scripts/update-detectable-games.js) eşleştirip, bulunan oyunu webview'deki Discord
// sayfasına LOCAL_ACTIVITY_UPDATE olarak bildiriyoruz (sayfa tarafı: discordWebviewPreload.js
// window.__splitcordRpc). Yalnızca oyun ALGILAMA -- oyunların kendi Rich Presence (IPC)
// sunucusu bilinçli olarak yok.
const SCAN_INTERVAL_MS = 5000;
// Değişiklik olmasa da bu kadar taramada bir tüm etkinlikleri sayfaya yeniden gönderiyoruz:
// sayfa yenilenirse/Discord modülleri geç yüklenirse (ya da giriş yapılırsa) durum kaybolmasın.
const RESYNC_EVERY_SCANS = 12;
const DB_PATH = path.join(__dirname, '..', '..', 'resources', 'detectable-games.json');

let webviewWebContents = null;
let scanTimer = null;
let scanning = false;
let scanCount = 0;
let executableIndex = null;
// Komut satırı argümanı olmadan ayırt edilemeyen ortak dosya adları (ör. "hl2.exe", "javaw.exe").
const argExecutableBasenames = new Set();
// Discord'un "Minecraft" (Java) girdisi: "javaw.exe" + "net.minecraft.client.main.Main".
let minecraftJava = null;
// uygulamaId -> { name, pid, start }
const active = new Map();

function isEnabled() {
  return readLocalSettings().gameActivityEnabled !== false;
}

/** exe adı/yol soneki -> [{ id, name, args }] dizini (ilk kullanımda yüklenir). */
function loadIndex() {
  if (executableIndex) return executableIndex;
  executableIndex = new Map();
  try {
    const games = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    for (const [id, name, executables] of games) {
      for (const exe of executables) {
        const rawName = Array.isArray(exe) ? exe[0] : exe;
        const args = Array.isArray(exe) ? exe[1] : null;
        // ">" öneki arRPC'de "yalnızca dosya adı" demek; dosya adı zaten her zaman
        // aday listesinin ilk elemanı olduğu için öneki atmak yeterli.
        const key = rawName[0] === '>' ? rawName.slice(1) : rawName;
        let bucket = executableIndex.get(key);
        if (!bucket) executableIndex.set(key, (bucket = []));
        bucket.push({ id, name, args });
        if (args) {
          argExecutableBasenames.add(key.split('/').pop());
          if (key === 'javaw.exe' && args.toLowerCase().includes('net.minecraft')) minecraftJava = { id, name };
        }
      }
    }
    logEvent('game-activity-db-loaded', { executables: executableIndex.size });
  } catch (err) {
    logEvent('game-activity-db-error', { error: err.message });
  }
  return executableIndex;
}

/** "c:/oyunlar/x/bin/oyun.exe" -> "oyun.exe", "bin/oyun.exe", "x/bin/oyun.exe", ... (+ 64-bit takı varyantları). */
function candidateNames(fullPath) {
  const segments = fullPath.toLowerCase().replaceAll('\\', '/').split('/');
  const candidates = new Set();
  for (let i = 1; i < segments.length; i++) {
    const suffix = segments.slice(-i).join('/');
    candidates.add(suffix);
    // Discord'un listesi bazı oyunlarda 64-bit takısız adı tutuyor (arRPC ile aynı gevşetme).
    candidates.add(suffix.replace('64', ''));
    candidates.add(suffix.replace('.x64', ''));
    candidates.add(suffix.replace('x64', ''));
    candidates.add(suffix.replace('_64', ''));
  }
  return candidates;
}

/** processes: [{ pid, path, args? }] -> Map(uygulamaId -> { name, pid }) */
function matchGames(processes) {
  const index = loadIndex();
  const found = new Map();
  for (const proc of processes) {
    if (!proc.path) continue;
    const lowered = proc.path.toLowerCase().replaceAll('\\', '/');
    // Windows sistem dizini oyun barındırmaz; ~yüzlerce süreci boşuna eşleştirmeyelim.
    if (lowered.startsWith('c:/windows/')) continue;
    for (const candidate of candidateNames(proc.path)) {
      const bucket = index.get(candidate);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (found.has(entry.id)) continue;
        // Bazı girişler yalnızca belirli komut satırı argümanıyla geçerli (ör. Minecraft Java:
        // "javaw.exe" + "net.minecraft.client.main.Main"). Argüman bilgisi YOKSA (Windows'ta
        // servis yalnızca yol veriyor) bu girişi eşleştirmiyoruz -- aksi halde alakasız HER
        // javaw.exe "Minecraft" sanılırdı (arRPC'nin wmic tabanlı Windows tarayıcısındaki
        // aynı yanlış pozitif).
        if (entry.args && (!proc.args || !proc.args.join(' ').includes(entry.args))) continue;
        found.set(entry.id, { name: entry.name, pid: proc.pid });
      }
    }

    // KULLANICI TALEBİ: javaw.exe çalışıyorsa Minecraft say. Discord'un girdisi yalnızca
    // vanilla ana sınıfı ("net.minecraft.client.main.Main") tanıyor; Forge/Fabric gibi modlu
    // ya da üçüncü taraf başlatıcılı sürümlerde ana sınıf farklı olduğundan hiç yakalanmazdı.
    // Komut satırı biliniyorsa içinde "minecraft" geçmesini şart koşuyoruz (alakasız Java
    // uygulamalarını dışarıda bırakmak için); bilinmiyorsa (servis eski/okuyamadı) doğrudan
    // javaw.exe yeterli sayılıyor -- Windows'ta javaw.exe adıyla çalışan başka popüler bir
    // oyun/uygulama yok.
    if (minecraftJava && !found.has(minecraftJava.id) && lowered.endsWith('/javaw.exe')) {
      const commandLine = proc.args ? proc.args.join(' ').toLowerCase() : null;
      if (commandLine === null || commandLine.includes('minecraft')) {
        found.set(minecraftJava.id, { name: minecraftJava.name, pid: proc.pid });
      }
    }
  }
  return found;
}

async function listLinuxProcesses() {
  const entries = await fsp.readdir('/proc');
  const processes = await Promise.all(
    entries.map(async (entry) => {
      const pid = Number(entry);
      if (!(pid > 0)) return null;
      try {
        // Proton/Wine oyunlarında ilk argüman Windows .exe yolu ("Z:\...\oyun.exe") oluyor.
        const parts = (await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
        return parts[0] ? { pid, path: parts[0], args: parts.slice(1) } : null;
      } catch {
        return null;
      }
    }),
  );
  return processes.filter(Boolean);
}

let lastListError = null;

/** null döner = işlem listesi alınamadı (servis kapalı/eski sürüm vb.); bu durumda mevcut durum korunur. */
async function listProcesses() {
  try {
    let processes = null;
    if (process.platform === 'win32') {
      loadIndex();
      const listed = await serviceClient.getRunningProcesses([...argExecutableBasenames]);
      // Servis komut satırını yalnızca istenen dosya adları için veriyor.
      processes = listed.map((p) => (p.commandLine ? { pid: p.pid, path: p.path, args: [p.commandLine] } : { pid: p.pid, path: p.path }));
    } else if (process.platform === 'linux') {
      processes = await listLinuxProcesses();
    }
    lastListError = null;
    return processes;
  } catch (err) {
    // Her 5 saniyede aynı hatayı loglayıp diagnostic.log'u doldurmamak için yalnızca
    // hata metni DEĞİŞTİĞİNDE (ör. eski bir servis sürümünde /processes yokken) kaydediyoruz.
    if (err.message !== lastListError) {
      lastListError = err.message;
      logEvent('game-activity-list-error', { error: err.message });
    }
    return null;
  }
}

function dispatchToPage(payload) {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) return;
  // JSON.stringify çıktısı geçerli bir JS değişmezi; sayfa tarafı tanımlı değilse (henüz
  // yüklenmediyse) sessizce hiçbir şey yapmıyor -- bir sonraki yeniden senkronda tekrar denenir.
  webviewWebContents
    .executeJavaScript(`window.__splitcordRpc && window.__splitcordRpc.set(${JSON.stringify(payload)})`)
    .catch(() => {});
}

function activityPayload(id, info) {
  return {
    socketId: String(id),
    pid: info.pid,
    activity: {
      application_id: id,
      name: info.name,
      type: 0,
      flags: 0,
      metadata: {},
      timestamps: { start: info.start },
    },
  };
}

function clearPayload(id, pid) {
  return { socketId: String(id), pid, activity: null };
}

function resyncAll() {
  for (const [id, info] of active) dispatchToPage(activityPayload(id, info));
}

async function scanOnce() {
  if (scanning) return;
  scanning = true;
  try {
    const processes = await listProcesses();
    if (!processes) return;
    const found = matchGames(processes);

    for (const [id, game] of found) {
      if (active.has(id)) continue;
      const info = { name: game.name, pid: game.pid, start: Date.now() };
      active.set(id, info);
      logEvent('game-activity-detected', { id, name: info.name, pid: info.pid });
      dispatchToPage(activityPayload(id, info));
    }
    for (const [id, info] of [...active]) {
      if (found.has(id)) continue;
      active.delete(id);
      logEvent('game-activity-lost', { id, name: info.name });
      dispatchToPage(clearPayload(id, info.pid));
    }

    scanCount += 1;
    if (scanCount % RESYNC_EVERY_SCANS === 0) resyncAll();
  } catch (err) {
    logEvent('game-activity-scan-error', { error: err.message });
  } finally {
    scanning = false;
  }
}

function stopScanning() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
}

function scheduleNextScan() {
  scanTimer = setTimeout(async () => {
    await scanOnce();
    if (scanTimer) scheduleNextScan();
  }, SCAN_INTERVAL_MS);
  // Tarama döngüsü uygulamanın kapanmasını engellemesin.
  scanTimer.unref?.();
}

function clearAllActivities() {
  for (const [id, info] of active) dispatchToPage(clearPayload(id, info.pid));
  active.clear();
}

/** Ayarlar'dan açılıp/kapatılınca (ve başlangıçta) çağrılır. */
function applyEnabledSetting() {
  stopScanning();
  if (!isEnabled()) {
    clearAllActivities();
    logEvent('game-activity-disabled', {});
    return;
  }
  scanCount = 0;
  scanOnce().finally(() => {
    if (isEnabled() && !scanTimer) scheduleNextScan();
  });
}

function start(webContents) {
  webviewWebContents = webContents;

  // Discord sayfası yüklendiğinde (ya da yenilendiğinde) mevcut etkinlikleri yeniden bildir.
  webContents.on('did-finish-load', () => resyncAll());

  // Sayfa tarafındaki köprünün teşhis kayıtları (Dispatcher bulundu/bulunamadı vb.) --
  // webContents.ipc bu webview'e özel olduğu için webview yenilense de birikme olmuyor.
  webContents.ipc.on('game-activity:page-log', (_event, tag, data) => {
    logEvent(`game-activity-page-${String(tag).slice(0, 40)}`, data ?? {});
  });

  applyEnabledSetting();
}

module.exports = { start, applyEnabledSetting, matchGames, candidateNames };
