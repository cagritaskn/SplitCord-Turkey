#!/usr/bin/env bash
# PORT_PLAN_2.md AP-4/Faz 2 — nftables projesinin (netfilter.org) `iptables` (nft backend) kaynağını
# indirip derler, linux/resources/bin/iptables-nft/iptables olarak yerleştirir. AMAÇ: hedef dağıtımda
# `iptables`/`iptables-nft` hiç kurulu olmasa bile (özellikle Arch tabanlı dağıtımlarda varsayılan
# DEĞİL, bkz. PORT_PLAN_2.md AP-10) Zapret/Zapret2 motorlarının NFQUEUE kuralı ekleyebilmesi.
#
# ÖNEMLİ -- BU SCRIPT'İN ÇIKTISI HENÜZ SERVİS KODUNA BAĞLANMADI (bkz. PORT_PLAN_2.md §6 sonu,
# §10 madde 2): ZapretEngine.cs/Zapret2Engine.cs hâlâ sistemin PATH'indeki "iptables"ı çağırıyor.
# Bu script yalnızca binary'yi ÜRETİYOR — bir sonraki oturumda, bu binary'nin GERÇEKTEN çalıştığı
# canlı test edildikten SONRA ZapretEngine.cs/Zapret2Engine.cs'in RunIptablesAsync'i (ve
# Zapret2Engine.cs'teki benzer çağrı) BinaryLocator.Resolve("iptables-nft", "iptables") ile önce
# gömülü kopyaya bakacak şekilde güncellenmeli (sistemde bulamazsa mevcut PATH aramasına düşerek).
#
# DOĞRULANMADI (bkz. ../PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): bu script HİÇ
# gerçek bir Linux'ta çalıştırılmadı. nftables'ın build sistemi zapret/zapret2'den (düz Makefile)
# FARKLI -- GNU Autotools (./configure) kullanıyor, ilk canlı denemede muhtemelen 1-2 düzeltme
# gerekecek (tıpkı ../PORTING_PLAN.md D-17'deki zapret/zapret2 script bug'ları gibi). Özellikle:
#   - Tam sürüm/tarball URL'i DOĞRULANMADI (netfilter.org'un dosya barındırma yapısı zamanla
#     değişebiliyor) -- ilk denemede 404 alınırsa https://www.netfilter.org/projects/iptables/
#     sayfasından güncel sürüm/URL'i teyit et.
#   - `./configure` bayrakları (`--enable-nftables`, `--disable-nftables`, ya da ikisini de
#     üreten varsayılan davranış) DOĞRULANMADI.
#   - Derleme için `libmnl-dev`/`libnftnl-dev`/`pkg-config`/`autoconf`/`automake`/`libtool` gerekebilir
#     (build-zapret2.sh'nin gereksinim listesine benzer şekilde -dev paketleri) -- DOĞRULANMADI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../resources/bin/iptables-nft"
WORK_DIR="$SCRIPT_DIR/../.build-cache/iptables-nft"

IPTABLES_VERSION="${IPTABLES_VERSION:-1.8.11}"
# CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-10): netfilter.org artık iptables tarball'larını
# .tar.bz2 DEĞİL .tar.xz olarak yayınlıyor (1.8.9/1.8.10/1.8.11 hepsi doğrulandı) -- eski
# .tar.bz2 adı 404 veriyordu (yalnızca çok eski 1.8.8 hâlâ .tar.bz2 olarak duruyor).
IPTABLES_URL="https://www.netfilter.org/projects/iptables/files/iptables-${IPTABLES_VERSION}.tar.xz"

echo "[iptables-nft] kaynak indiriliyor: $IPTABLES_URL"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
curl -fsSL "$IPTABLES_URL" -o "$WORK_DIR/iptables.tar.xz"
tar -xJf "$WORK_DIR/iptables.tar.xz" -C "$WORK_DIR"

SRC_DIR="$WORK_DIR/iptables-${IPTABLES_VERSION}"
if [ ! -d "$SRC_DIR" ]; then
  echo "HATA: beklenen kaynak dizini bulunamadi: $SRC_DIR (tarball'in ic yapisi degismis olabilir -- IPTABLES_VERSION'i kontrol et)" >&2
  exit 1
fi

echo "[iptables-nft] configure + make (nft backend)..."
(
  cd "$SRC_DIR"
  ./configure --enable-nftables --disable-shared
  make -j"$(nproc)"
)

IPTABLES_BIN="$SRC_DIR/iptables/xtables-nft-multi"
if [ ! -x "$IPTABLES_BIN" ]; then
  echo "HATA: derleme sonrasi beklenen binary bulunamadi: $IPTABLES_BIN (nftables'in build cikti dosya adi/yapisi degismis olabilir)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
# xtables-nft-multi tek bir binary, iptables/iptables-save/iptables-restore/ip6tables vb. hepsini
# argv[0]'a göre seçiyor (busybox tarzı) -- blockcheck2.sh HEM "iptables" HEM "ip6tables"ı bare
# komut adıyla çağırıyor (bkz. PORT_PLAN_2.md/EmbeddedTools.cs'in notu, gerçek kaynakta satır
# ~190-201), bu yüzden ikisini de AYNI binary'nin farklı adlarla kopyaları olarak üretiyoruz (kopya,
# sembolik bağlantı DEĞİL -- AppImage'ın squashfs'i sembolik bağlantıları her zaman aynı şekilde
# korumayabilir, kopya daha güvenli/basit).
cp "$IPTABLES_BIN" "$OUT_DIR/iptables"
cp "$IPTABLES_BIN" "$OUT_DIR/ip6tables"
chmod +x "$OUT_DIR/iptables" "$OUT_DIR/ip6tables"

"$SCRIPT_DIR/bundle-libs.sh" "$OUT_DIR/iptables"
# ip6tables ile iptables AYNI dosya İÇERİĞİ (cp, sembolik bağlantı değil) -- bundle-libs.sh'in
# oluşturduğu lib/ klasörü ikisi için de zaten ORTAK (aynı OUT_DIR'de), ip6tables için AYRICA
# çağırmaya gerek yok (RPATH zaten patchelf ile ikisine de tek tek uygulanmalı çünkü patchelf
# dosyanın KENDİSİNE yazıyor, kopya olduğu için birbirinden bağımsız iki dosya).
"$SCRIPT_DIR/bundle-libs.sh" "$OUT_DIR/ip6tables"

echo "[iptables-nft] tamam -> $OUT_DIR/iptables (+ ip6tables)"
