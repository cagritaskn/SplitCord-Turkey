#!/usr/bin/env bash
# PORT_PLAN_2.md AP-4/Faz 2 (kapsam genişletmesi, 2026-09-09) — nftables projesinin (netfilter.org)
# `nft` komut satırı aracını indirip derler, linux/resources/bin/nftables/nft olarak yerleştirir.
# AMAÇ: blockcheck2.sh'nin KENDİSİ `nft` komutunu bare isimle doğrudan çağırıyor (bkz.
# EmbeddedTools.cs'in üstündeki not, gerçek kaynakta satır ~207-909) -- `nft` hedef dağıtımda hiç
# kurulu olmayabilir (nadir ama mümkün, özellikle çok minimal/konteyner tabanlı kurulumlarda).
#
# `nft`, `iptables-nft`'ten (build-iptables-nft.sh) FARKLI, AYRI bir upstream proje (netfilter.org/
# projects/nftables) -- ikisi ayrı kaynak ağaçları, ayrı ./configure'lar.
#
# ÖNEMLİ: build-iptables-nft.sh'teki AYNI not burada da geçerli -- bu binary'nin çıktısı Faz 2'nin
# PATH-önceliklendirme mekanizmasına (EmbeddedTools.cs) zaten BAĞLANDI (build-iptables-nft.sh'in
# aksine, bu script AYRICA servis koduna bağlanmayı BEKLEMİYOR — EmbeddedTools.cs zaten
# "nftables" tool klasörünü PATH'e ekliyor, bu script yalnızca o klasörü DOLDURUYOR).
#
# DOĞRULANMADI (bkz. ../PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): bu script HİÇ
# gerçek bir Linux'ta çalıştırılmadı. nftables'ın tam derleme gereksinimleri/configure bayrakları
# BU OTURUMDA İNTERNETTEN DOĞRULANMADI (yalnızca genel bilgiye dayanıyor) -- ilk canlı denemede
# muhtemelen düzeltme gerekecek (tıpkı ../PORTING_PLAN.md D-17'deki zapret/zapret2 script
# bug'ları gibi). Özellikle:
#   - Tam sürüm/tarball URL'i DOĞRULANMADI.
#   - `./configure` bayrakları (`--without-cli` libedit'i, `--disable-python` python binding'lerini
#     devre dışı bırakmak için tahmin edildi -- gerçek nftables configure çıktısına bakılarak
#     düzeltilmesi gerekebilir).
#   - Derleme için `libmnl-dev`/`libnftnl-dev`/`pkg-config`/`bison`/`flex`/`autoconf`/`automake`/
#     `libtool`/`libgmp-dev` gerekebilir -- DOĞRULANMADI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../resources/bin/nftables"
WORK_DIR="$SCRIPT_DIR/../.build-cache/nftables"

NFTABLES_VERSION="${NFTABLES_VERSION:-1.0.9}"
NFTABLES_URL="https://www.netfilter.org/projects/nftables/files/nftables-${NFTABLES_VERSION}.tar.xz"

echo "[nftables] kaynak indiriliyor: $NFTABLES_URL"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
curl -fsSL "$NFTABLES_URL" -o "$WORK_DIR/nftables.tar.xz"
tar -xJf "$WORK_DIR/nftables.tar.xz" -C "$WORK_DIR"

SRC_DIR="$WORK_DIR/nftables-${NFTABLES_VERSION}"
if [ ! -d "$SRC_DIR" ]; then
  echo "HATA: beklenen kaynak dizini bulunamadi: $SRC_DIR (tarball'in ic yapisi degismis olabilir -- NFTABLES_VERSION'i kontrol et)" >&2
  exit 1
fi

echo "[nftables] configure + make..."
(
  cd "$SRC_DIR"
  ./configure --disable-python --without-cli --without-json
  make -j"$(nproc)"
)

# CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-10): "src/nft" kurulum ÖNCESİ GERÇEK bir ELF binary
# DEĞİL, bir libtool SARMALAYICI script'i (LD_LIBRARY_PATH ayarlayıp gerçek binary'yi src/.libs/
# altından exec eden bash script'i, `file` ile doğrulandı) -- bunu AppImage'a kopyalayıp
# çalıştırmaya çalışmak "does not exist" hatasıyla anında başarısız oluyordu (sarmalayıcı,
# build dizinindeki .libs/'e MUTLAK yol referansı veriyor, kopyalandığı yerde o dizin yok).
# Gerçek ELF her zaman "src/.libs/nft" altında.
NFT_BIN="$SRC_DIR/src/.libs/nft"
if [ ! -x "$NFT_BIN" ]; then
  echo "HATA: derleme sonrasi beklenen binary bulunamadi: $NFT_BIN (nftables'in build cikti dosya adi/yapisi degismis olabilir)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$NFT_BIN" "$OUT_DIR/nft"
chmod +x "$OUT_DIR/nft"

"$SCRIPT_DIR/bundle-libs.sh" "$OUT_DIR/nft"

echo "[nftables] tamam -> $OUT_DIR/nft"
