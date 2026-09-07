#!/usr/bin/env bash
# electron-builder'ın .deb hedefi için "afterInstall" script'i (bkz. client/package.json
# build.deb.afterInstall) -- dpkg bunu paket dosyaları ZATEN diske yazıldıktan SONRA,
# "configure" aşamasında ROOT olarak çalıştırır (`sudo dpkg -i`/`sudo apt install` zaten
# root gerektirdiği için burada AYRICA bir pkexec/parola istemine gerek YOK).
#
# Amaç: kullanıcı .deb'i kurar kurmaz DPI servisi (systemd birimi) de otomatik kurulmuş
# olsun -- uygulama içinden ayrı bir "DPI Servisini Kur" adımına (bkz. serviceInstaller.js/
# titlebar.js) normal şartlarda hiç gerek kalmasın; o buton yalnızca bu adım BAŞARISIZ
# olursa (ör. NFQUEUE modülleri yüklenemedi) elle kurtarma yolu olarak kalıyor.
#
# electron-builder'ın "afterInstall" script'i doğrudan `sh` ile çalıştırıyor, argüman
# GEÇMİYOR -- bu yüzden yükleme dizinini kendimiz, productName'e göre SABİT olarak biliyoruz
# (bkz. package.json "productName": "SplitCord-Turkey").
set -euo pipefail

INSTALLER_DIR="/opt/SplitCord-Turkey/resources/service-installer"

if [ -f "$INSTALLER_DIR/install.sh" ]; then
  echo "[splitcord] DPI servisi kuruluyor..."
  if bash "$INSTALLER_DIR/install.sh" "$INSTALLER_DIR"; then
    echo "[splitcord] DPI servisi kuruldu."
  else
    # Kasıtlı olarak paket kurulumunu BAŞARISIZ SAYMIYORUZ (exit 1 vermiyoruz) -- istemci
    # uygulaması yine de açılıp çalışabilir, yalnızca DPI aşımı devre dışı kalır ve kullanıcı
    # uygulama içindeki "DPI Servisini Kur" butonuyla elle tekrar deneyebilir.
    echo "[splitcord] UYARI: DPI servisi kurulamadı -- uygulama içinden 'DPI Servisini Kur' ile tekrar deneyebilirsiniz." >&2
  fi
else
  echo "[splitcord] UYARI: install.sh bulunamadı ($INSTALLER_DIR) -- DPI servisi kurulamadı." >&2
fi

exit 0
