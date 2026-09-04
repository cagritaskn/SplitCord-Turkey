#!/usr/bin/env bash
# bol-van/zapret'in (v1, ZapretEngine.cs'in kullandığı) kaynağını indirip derler,
# linux/resources/bin/zapret/nfq/ altına yerleştirir.
#
# DOĞRULANDI (2026-09-04, `gh api repos/bol-van/zapret` ile): bu proje hazır Linux binary'si
# YAYINLAMIYOR, yalnızca kaynak tarball'ı (bkz. ../PORTING_PLAN.md R-4.1/D-13). Kök Makefile'daki
# `make systemd` hedefi nfq/ dizinini derleyip nfqws'i binaries/my/'a taşıyor, nfq/ altında da bir
# sembolik bağlantı bırakıyor. `--dpi-desync-fake-tls=tls_clienthello_www_google_com.bin` argümanı
# (bkz. ZapretEngine.cs CandidateStrategies) nfqws'in WorkingDirectory'sine göre RELATİF bir yol —
# bu yüzden bu .bin dosyası nfqws ile AYNI dizine (files/fake/'den) kopyalanıyor.
#
# GEREKSİNİMLER (Debian/Ubuntu paket adları — bkz. ../PORTING_PLAN.md D-12, R-4.2/nfq/Makefile
# LIBS_LINUX): build-essential, libnetfilter-queue-dev, libnfnetlink-dev, libmnl-dev, zlib1g-dev.
# DOĞRULANMADI: bu paket listesi gerçek bir Debian/Ubuntu'da hiç denenmedi.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../resources/bin/zapret"
WORK_DIR="$SCRIPT_DIR/../.build-cache/zapret"

ZAPRET_VERSION="${ZAPRET_VERSION:-72.13}"
ZAPRET_URL="https://github.com/bol-van/zapret/releases/download/v${ZAPRET_VERSION}/zapret-v${ZAPRET_VERSION}.tar.gz"

echo "[zapret] kaynak indiriliyor: $ZAPRET_URL"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
curl -fsSL "$ZAPRET_URL" -o "$WORK_DIR/zapret.tar.gz"
tar -xzf "$WORK_DIR/zapret.tar.gz" -C "$WORK_DIR"

SRC_DIR="$WORK_DIR/zapret-${ZAPRET_VERSION}"
if [ ! -d "$SRC_DIR" ]; then
  echo "HATA: beklenen kaynak dizini bulunamadi: $SRC_DIR (tarball'in ic yapisi degismis olabilir)" >&2
  exit 1
fi

echo "[zapret] nfqws deriliyor (make systemd)..."
make -C "$SRC_DIR" systemd

NFQWS_BIN="$SRC_DIR/nfq/nfqws"
if [ ! -x "$NFQWS_BIN" ]; then
  echo "HATA: derleme sonrasi nfqws bulunamadi: $NFQWS_BIN" >&2
  exit 1
fi

mkdir -p "$OUT_DIR/nfq"
cp "$NFQWS_BIN" "$OUT_DIR/nfq/nfqws"
chmod +x "$OUT_DIR/nfq/nfqws"

# ZapretEngine.cs'in CandidateStrategies'inde "--dpi-desync-fake-tls=tls_clienthello_www_google_com.bin"
# olarak referans verilen dosya -- nfqws ile AYNI dizinde olmali (bkz. yukaridaki not).
cp "$SRC_DIR/files/fake/tls_clienthello_www_google_com.bin" "$OUT_DIR/nfq/tls_clienthello_www_google_com.bin"

echo "[zapret] tamam -> $OUT_DIR/nfq/nfqws"
