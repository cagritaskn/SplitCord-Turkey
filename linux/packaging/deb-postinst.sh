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

# CANLI TESTTE BULUNAN GERÇEK BUG (2026-09-07): electron-builder'ın deb hedefi chrome-sandbox'ı
# doğru izinlerle (root:root, setuid 4755) paketlemiyor -- kurulumdan sonra 0777/root:root olarak
# kalıyor, yani SUID sandbox çalışmıyor. Bunun görünmeyen ama gerçek sonucu: Electron bu durumda
# kendi süreçlerine (namespace sandbox kurabilmek için) `no_new_privs=1` uyguluyor, ve bu bayrak
# TÜM alt süreçlere miras kalıyor -- uygulama içinden `spawn('pkexec', ...)` ile yapılan HER
# yetki yükseltme (appUninstaller.js, serviceInstaller.js) "pkexec must be setuid root" hatasıyla
# (exit code 127) başarısız oluyordu, pkexec kendisi diskte doğru setuid olsa bile. Düzeltme:
# izinleri burada elle düzeltiyoruz (script zaten root olarak çalışıyor, ek bir parola istemine
# gerek yok).
CHROME_SANDBOX="/opt/SplitCord-Turkey/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
  chown root:root "$CHROME_SANDBOX" || true
  chmod 4755 "$CHROME_SANDBOX" || true
fi

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
