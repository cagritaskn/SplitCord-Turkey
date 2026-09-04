#!/usr/bin/env bash
# bol-van/zapret2'nin (Zapret2Engine.cs'in kullandığı) kaynağını indirip derler,
# linux/resources/bin/zapret2/ altına blockcheck2.sh'nin çalışması için gereken TÜM runtime
# ağacını (script'ler + derlenmiş binary'ler) yerleştirir.
#
# DOĞRULANDI (2026-09-04, `gh api repos/bol-van/zapret2` ile): bu proje de hazır Linux binary'si
# YAYINLAMIYOR (bkz. ../PORTING_PLAN.md R-4.1/D-13). blockcheck2.sh REPO KÖKÜNDE duruyor --
# "blockcheck2" adında bir alt klasör YOK (bkz. D-14, Zapret2Engine.cs'teki düzeltme). nfqws2'nin
# gerçek yolu blockcheck2.sh'nin kendi "NFQWS2=${ZAPRET_BASE}/nfq2/nfqws2" varsayılanından
# doğrulandı.
#
# GEREKSİNİMLER (Debian/Ubuntu paket adları — bkz. ../PORTING_PLAN.md D-12, nfq2/Makefile
# LIBS_LINUX + Lua bağımlılığı): build-essential, libnetfilter-queue-dev, libnfnetlink-dev,
# libmnl-dev, zlib1g-dev, libluajit-5.1-dev (ya da liblua5.1-0-dev), pkg-config. DOĞRULANMADI:
# bu paket listesi gerçek bir Debian/Ubuntu'da hiç denenmedi.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../resources/bin/zapret2"
WORK_DIR="$SCRIPT_DIR/../.build-cache/zapret2"

ZAPRET2_VERSION="${ZAPRET2_VERSION:-1.0.5}"
ZAPRET2_URL="https://github.com/bol-van/zapret2/releases/download/v${ZAPRET2_VERSION}/zapret2-v${ZAPRET2_VERSION}.tar.gz"

echo "[zapret2] kaynak indiriliyor: $ZAPRET2_URL"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
curl -fsSL "$ZAPRET2_URL" -o "$WORK_DIR/zapret2.tar.gz"
tar -xzf "$WORK_DIR/zapret2.tar.gz" -C "$WORK_DIR"

SRC_DIR="$WORK_DIR/zapret2-${ZAPRET2_VERSION}"
if [ ! -d "$SRC_DIR" ]; then
  echo "HATA: beklenen kaynak dizini bulunamadi: $SRC_DIR (tarball'in ic yapisi degismis olabilir)" >&2
  exit 1
fi

echo "[zapret2] nfqws2/ip2net/mdig deriliyor (make systemd)..."
make -C "$SRC_DIR" systemd

for bin in nfq2/nfqws2 ip2net/ip2net mdig/mdig; do
  if [ ! -e "$SRC_DIR/$bin" ]; then
    echo "HATA: derleme sonrasi bulunamadi: $SRC_DIR/$bin" >&2
    exit 1
  fi
done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# blockcheck2.sh'nin calisma zamaninda ihtiyac duydugu TUM runtime agaci -- kaynak (.c/.h)
# dosyalari HARIC, yalnizca script'ler + derlenmis binary'ler (-L: sembolik baglantilari
# gercek dosyaya cozerek kopyalar, cunku Makefile "make systemd" sonrasi binaries/my/'a TASIYIP
# orijinal konumda sembolik baglanti birakiyor).
cp "$SRC_DIR/blockcheck2.sh" "$OUT_DIR/blockcheck2.sh"
cp -r "$SRC_DIR/blockcheck2.d" "$OUT_DIR/blockcheck2.d"
cp -r "$SRC_DIR/common" "$OUT_DIR/common"
cp "$SRC_DIR/config.default" "$OUT_DIR/config.default"
cp -r "$SRC_DIR/lua" "$OUT_DIR/lua"

mkdir -p "$OUT_DIR/nfq2" "$OUT_DIR/ip2net" "$OUT_DIR/mdig"
cp -L "$SRC_DIR/nfq2/nfqws2" "$OUT_DIR/nfq2/nfqws2"
cp -L "$SRC_DIR/ip2net/ip2net" "$OUT_DIR/ip2net/ip2net"
cp -L "$SRC_DIR/mdig/mdig" "$OUT_DIR/mdig/mdig"
chmod +x "$OUT_DIR/blockcheck2.sh" "$OUT_DIR/nfq2/nfqws2" "$OUT_DIR/ip2net/ip2net" "$OUT_DIR/mdig/mdig"
find "$OUT_DIR/common" "$OUT_DIR/blockcheck2.d" -type f -name "*.sh" -exec chmod +x {} \;

echo "[zapret2] tamam -> $OUT_DIR/blockcheck2.sh (+ nfq2/nfqws2, ip2net/ip2net, mdig/mdig, lua/, common/, blockcheck2.d/)"
