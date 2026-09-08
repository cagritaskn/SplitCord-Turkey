#!/usr/bin/env bash
# PORT_PLAN_2.md AP-4/Faz 2 — bir binary'nin bağlı olduğu, glibc'nin KENDİ temel kütüphaneleri
# DIŞINDAKİ paylaşımlı kütüphaneleri (.so) binary'nin yanındaki bir lib/ klasörüne kopyalar ve
# `patchelf --set-rpath` ile binary'ye "önce yanındaki lib/'e bak" der -- AppImage'ın hedef
# dağıtımda hangi -dev paketlerinin kurulu olduğuna bakmadan çalışabilmesi için (bkz. PORT_PLAN_2.md
# AP-4: "her açılışta paket yöneticisiyle otomatik kur" YERİNE build zamanında gömme).
#
# Kullanım: bundle-libs.sh <binary-yolu>
#   binary'nin bulunduğu dizinde bir "lib/" alt klasörü oluşturur (yoksa), eksik kütüphaneleri
#   oraya kopyalar, RPATH'i "$ORIGIN/lib" olarak ayarlar. Birden fazla binary AYNI dizindeyse
#   (ör. zapret2'nin nfqws2/ip2net/mdig'i FARKLI alt klasörlerde olduğu için her biri kendi
#   lib/'ini alır -- paylaşım YOK, basitlik için, disk maliyeti önemsiz) art arda çağrılabilir.
#
# LGPL notu (bkz. PORT_PLAN_2.md §6): libnetfilter_queue/libmnl/libnfnetlink LGPL -- bu yüzden
# TAM STATİK link değil, .so dosyasını AYNEN kopyalayıp RPATH ile göstermek tercih edildi (dinamik
# link, LGPL'in kütüphanenin değiştirilebilir kalması şartına daha uygun).
#
# DOĞRULANMADI (bkz. ../PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): bu script hiç
# gerçek bir Linux'ta çalıştırılmadı. `patchelf`'in build makinesinde kurulu olması gerekiyor
# (Debian/Ubuntu'da `apt install patchelf`, Arch'ta `pacman -S patchelf`) -- fetch-binaries.js bu
# ön koşulu KONTROL ETMİYOR, eksikse bu script açıkça hata verip duracak (aşağıdaki `command -v`
# kontrolü).
set -euo pipefail

BIN_PATH="${1:?Kullanım: bundle-libs.sh <binary-yolu>}"
if [ ! -f "$BIN_PATH" ]; then
  echo "HATA: binary bulunamadı: $BIN_PATH" >&2
  exit 1
fi

if ! command -v patchelf >/dev/null 2>&1; then
  echo "HATA: patchelf bulunamadı. Kurulum: 'sudo apt install patchelf' (Debian/Ubuntu) ya da 'sudo pacman -S patchelf' (Arch)." >&2
  exit 1
fi

BIN_DIR="$(cd "$(dirname "$BIN_PATH")" && pwd)"
LIB_DIR="$BIN_DIR/lib"
mkdir -p "$LIB_DIR"

# glibc'nin AppImage'ın "eski glibc'de derle, yeni glibc'de çalıştır" stratejisiyle zaten hedef
# sistemde bulunacağı varsayılan, GÖMÜLMEYEN temel kütüphaneleri -- bunları gömmek hem gereksiz
# (her zaman orada olacaklar) hem de RİSKLİ (hedefin glibc'siyle çakışıp ABI uyumsuzluğu
# yaratabilir, AppImage'ların glibc'yi KENDİLERİ asla bundle ETMEMESİNİN sebebi tam da bu).
BASELINE_PATTERN='^(linux-vdso|ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so|libresolv\.so|libnsl\.so)'

echo "[bundle-libs] $BIN_PATH bağımlılıkları taranıyor..."
COPIED_ANY=0
# ldd çıktı biçimi: "  libfoo.so.1 => /gerçek/yol/libfoo.so.1 (0xADDR)" ya da statik/vdso için
# "=>" olmayan satırlar -- yalnızca gerçek bir yola çözülen ("=>" olan) satırları işliyoruz.
while read -r line; do
  lib_name="$(echo "$line" | awk '{print $1}')"
  lib_real_path="$(echo "$line" | awk '{print $3}')"

  if [ -z "$lib_name" ] || [ -z "$lib_real_path" ] || [ "$lib_real_path" = "not" ]; then
    continue # "=> not found" ya da ayrıştırılamayan satır -- ldd'nin kendisi zaten eksik libi bildirir
  fi
  if echo "$lib_name" | grep -qE "$BASELINE_PATTERN"; then
    continue # glibc çekirdek kütüphanesi -- bilerek GÖMÜLMÜYOR (yukarıdaki not)
  fi

  echo "  [bundle-libs] gömülüyor: $lib_name ($lib_real_path)"
  cp -L "$lib_real_path" "$LIB_DIR/$lib_name"
  COPIED_ANY=1
done < <(ldd "$BIN_PATH" 2>/dev/null | grep '=>' || true)

if [ "$COPIED_ANY" -eq 1 ]; then
  patchelf --set-rpath '$ORIGIN/lib' "$BIN_PATH"
  echo "[bundle-libs] tamam -> $LIB_DIR (+ RPATH ayarlandı)"
else
  echo "[bundle-libs] gömülecek ek kütüphane yok (yalnızca glibc çekirdeğine bağlı) -- $BIN_PATH değişmedi"
  rmdir "$LIB_DIR" 2>/dev/null || true
fi
