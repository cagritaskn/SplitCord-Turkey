'use strict';

/**
 * Discord'un herkese açık "algılanabilir oyunlar" listesini (Ayarlar > Genel > "Oynanan
 * oyunu Discord'da göster" özelliği bunu kullanıyor, bkz. client/src/main/gameActivity.js)
 * indirip yalnızca bize gereken alanlara küçültür ve hem client/resources/ hem
 * linux/client/resources/ altına yazar.
 *
 * Ham liste ~11,6 MB; başlatıcı (is_launcher) ve macOS girdileri atılıp yalnızca
 * win32 + linux çalıştırılabilirleri tutulunca ~0,85 MB'a iniyor. Linux'ta da win32
 * girdileri gerekli: Proton/Wine oyunlarının işlem satırında Windows .exe yolu görünüyor.
 *
 * Çıktı biçimi: [[uygulamaId, ad, [exeAdı | [exeAdı, argüman], ...]], ...]
 * Çalıştırılabilir adları küçük harfli ve "/" ayraçlı (Discord'un kendi listesindeki gibi).
 *
 * Kaynak sırası: 1) Discord API (bazı ağlarda erişilemeyebilir) 2) arRPC deposundaki
 * (MIT, düzenli güncellenen) aynı listenin kopyası.
 *
 * Kullanım: npm run update-detectable-games
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCES = [
  'https://discord.com/api/v9/applications/detectable',
  'https://raw.githubusercontent.com/OpenAsar/arrpc/main/src/process/detectable.json',
];

const OUT_FILES = [
  path.join(__dirname, '..', 'client', 'resources', 'detectable-games.json'),
  path.join(__dirname, '..', 'linux', 'client', 'resources', 'detectable-games.json'),
];

async function download() {
  let lastError = null;
  for (const url of SOURCES) {
    try {
      console.log(`[games] indiriliyor: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'SplitCord-Turkey-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length < 1000) throw new Error('beklenmeyen/eksik liste');
      return data;
    } catch (err) {
      console.warn(`[games] başarısız (${err.message})`);
      lastError = err;
    }
  }
  throw lastError ?? new Error('hiçbir kaynağa ulaşılamadı');
}

function compact(list) {
  const out = [];
  for (const game of list) {
    const executables = [];
    for (const exe of game.executables ?? []) {
      if (exe.is_launcher || (exe.os !== 'win32' && exe.os !== 'linux')) continue;
      const name = String(exe.name ?? '').toLowerCase().replaceAll('\\', '/');
      if (!name) continue;
      executables.push(exe.arguments ? [name, exe.arguments] : name);
    }
    if (executables.length > 0) out.push([game.id, game.name, executables]);
  }
  return out;
}

(async () => {
  try {
    const compacted = compact(await download());
    const json = JSON.stringify(compacted);
    for (const file of OUT_FILES) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, json);
      console.log(`[games] ${compacted.length} oyun, ${(json.length / 1024).toFixed(0)} KB -> ${file}`);
    }
  } catch (err) {
    console.error('HATA:', err.message);
    process.exitCode = 1;
  }
})();
