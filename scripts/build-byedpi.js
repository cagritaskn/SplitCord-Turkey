'use strict';

/**
 * vendor/byedpi-src/ altındaki, SplitCord-Turkey'e özel DNS-over-HTTPS yamasını
 * içeren ByeDPI (hufrea/byedpi v0.17.3) kaynağını MinGW-w64 gcc ile derleyip
 * resources/bin/byedpi/ciadpi.exe olarak yerleştirir.
 *
 * Neden resmi release yerine kendi derlememiz var: ciadpi normalde sistemin
 * DNS sunucusunu (getaddrinfo) kullanır; ISP'ler DNS yanıtlarını manipüle
 * edebildiği için proxy.c'deki resolve() fonksiyonu önce SplitCordService'in
 * çalıştırdığı yerel bir DoH yönlendiricisine (127.0.0.1:53535, gerçek DoH
 * isteğini Google'a HTTPS üzerinden yapan) düz UDP DNS sorgusu göndermesi
 * için yamalandı; yönlendirici erişilemezse orijinal getaddrinfo() davranışına
 * düşer. Yama diff olarak değil, doğrudan patched kaynak olarak commitlendi
 * (vendor/byedpi-src) — upstream değişse bile derleme kırılmasın diye.
 *
 * Gereksinim: PATH'te bir MinGW-w64 gcc (Windows native build hedefliyoruz,
 * -lws2_32 -lmswsock ile link ediliyor).
 *
 * Kullanım: npm run build-byedpi (fetch-binaries.js tarafından da çağrılır)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SRC_DIR = path.join(__dirname, '..', 'vendor', 'byedpi-src');
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bin', 'byedpi');
const SOURCES = ['packets.c', 'main.c', 'conev.c', 'proxy.c', 'desync.c', 'mpool.c', 'extend.c', 'win_service.c'];

function buildByeDpi() {
  console.log('[byedpi] SplitCord-Turkey DoH yamalı ciadpi.exe derleniyor (gcc)...');

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`ByeDPI kaynağı bulunamadı: ${SRC_DIR}`);
  }

  execFileSync(
    'gcc',
    [
      '-D_DEFAULT_SOURCE',
      '-I.',
      '-std=c99',
      '-O2',
      '-Wall',
      '-Wno-unused',
      '-Wextra',
      '-Wno-unused-parameter',
      '-pedantic',
      '-o',
      'ciadpi.exe',
      ...SOURCES,
      '-lws2_32',
      '-lmswsock',
    ],
    { cwd: SRC_DIR, stdio: 'inherit' },
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(path.join(SRC_DIR, 'ciadpi.exe'), path.join(OUT_DIR, 'ciadpi.exe'));
  console.log(`[byedpi] tamam -> ${path.join(OUT_DIR, 'ciadpi.exe')}`);
}

if (require.main === module) {
  try {
    buildByeDpi();
  } catch (err) {
    console.error('HATA:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { buildByeDpi };
