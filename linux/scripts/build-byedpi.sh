#!/usr/bin/env bash
# Windows karşılığının (scripts/build-byedpi.js) Linux portu. linux/vendor/byedpi-src/
# altındaki, SplitCord-Turkey'e özel DNS-over-HTTPS yamasını içeren ByeDPI (hufrea/byedpi)
# kaynağını sistemin gcc'siyle derleyip linux/resources/bin/byedpi/ciadpi olarak yerleştirir.
#
# Windows'tan FARK: win_service.c derleme listesine hiç dahil değil (Linux'ta gerekmiyor,
# main.c zaten onu `#ifndef _WIN32` ile içermeden derliyor) ve -lws2_32/-lmswsock yerine
# hiçbir ekstra Windows kütüphanesi link edilmiyor.
#
# DOĞRULANMADI: bu script hiç gerçek bir Linux'ta çalıştırılmadı (bkz. ../PORTING_PLAN.md
# §2 madde 5, D-8). desync.c/conev.c'nin event döngüsü Linux'ta epoll kullanıyor olabilir
# (glibc'nin bir parçası, ekstra -l bayrağı gerekmez) -- gerçek derlemede bir bağlama
# (linker) hatası çıkarsa eksik kütüphane burada eklenmeli.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../vendor/byedpi-src"
OUT_DIR="$SCRIPT_DIR/../resources/bin/byedpi"

SOURCES=(packets.c main.c conev.c proxy.c desync.c mpool.c extend.c)

echo "[byedpi] SplitCord-Turkey DoH yamali ciadpi deriliyor (gcc, Linux)..."

if [ ! -d "$SRC_DIR" ]; then
  echo "HATA: ByeDPI kaynagi bulunamadi: $SRC_DIR" >&2
  exit 1
fi

gcc \
  -D_DEFAULT_SOURCE \
  -I. \
  -std=c99 \
  -O2 \
  -Wall \
  -Wno-unused \
  -Wextra \
  -Wno-unused-parameter \
  -pedantic \
  -o "$SRC_DIR/ciadpi" \
  "${SOURCES[@]/#/$SRC_DIR/}"

mkdir -p "$OUT_DIR"
cp "$SRC_DIR/ciadpi" "$OUT_DIR/ciadpi"
chmod +x "$OUT_DIR/ciadpi"

echo "[byedpi] tamam -> $OUT_DIR/ciadpi"
