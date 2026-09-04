#!/usr/bin/env bash
# SplitCord DPI Service'i kurar/günceller: yayınlanmış (dotnet publish) çıktıyı /opt/splitcord'a
# kopyalar, systemd birimini kurup etkinleştirir. Windows karşılığının (service/installer/
# install-service.ps1) ruhunu taşıyor ama systemd'nin kendi senkron stop/enable davranışı
# sayesinde ORADAKİ birçok savunmacı iş parçacığına (aktif bekleme döngüsü, otomatik-yeniden-
# başlatma kaydını önceden sıfırlama) gerek YOK -- bkz. ../PORTING_PLAN.md §6'daki karşılaştırma.
#
# KULLANICI VERİSİ KORUMASI (Windows'taki installer.nsh'nin hard-won dersi, bkz. PORTING_PLAN.md
# Faz 8 notu): bu script /var/lib/splitcord/ (LinuxPaths.DataDirectory, bkz. Config/LinuxPaths.cs)
# altındaki ayar dosyasına HİÇBİR ZAMAN dokunmuyor -- yeniden kurulum/güncelleme sonrası kullanıcının
# doğrulanmış DPI stratejisi/DNS ayarları korunuyor.
#
# Kullanım: sudo ./install.sh [<publish-cikti-dizini>]
#   <publish-cikti-dizini> verilmezse, script'in yanındaki ../service/SplitCordServiceLinux/bin/
#   Release/net8.0/linux-x64/publish/ varsayılır (dotnet publish -c Release -r linux-x64
#   --self-contained sonrası oluşan standart konum).
#
# DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5): bu script hiç gerçek bir Linux'ta çalıştırılmadı.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "HATA: bu script root gerektiriyor (systemd birimi + /opt altına kurulum icin). 'sudo ./install.sh' ile calistirin." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/splitcord"
SERVICE_NAME="splitcord-dpi"
UNIT_SRC="$SCRIPT_DIR/systemd/$SERVICE_NAME.service"
UNIT_DEST="/etc/systemd/system/$SERVICE_NAME.service"

PUBLISH_DIR="${1:-$SCRIPT_DIR/../service/SplitCordServiceLinux/bin/Release/net8.0/linux-x64/publish}"
if [ ! -d "$PUBLISH_DIR" ] || [ ! -f "$PUBLISH_DIR/SplitCordServiceLinux" ]; then
  echo "HATA: yayinlanmis servis bulunamadi: $PUBLISH_DIR" >&2
  echo "Once calistirin: dotnet publish -c Release -r linux-x64 --self-contained linux/service/SplitCordServiceLinux" >&2
  exit 1
fi

echo "[install] servis zaten kuruluysa durduruluyor..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

echo "[install] $PUBLISH_DIR -> $INSTALL_DIR kopyalaniyor..."
mkdir -p "$INSTALL_DIR"
# --delete: eski surumden kalma dosyalari temizler, ama INSTALL_DIR disindaki (/var/lib/splitcord/)
# ayar dosyasina hic dokunmuyor -- veri korumasi INSTALL_DIR'in KENDISININ ayar tutmamasindan
# geliyor (bkz. Config/LinuxPaths.cs, ayrı bir dizin).
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$PUBLISH_DIR/" "$INSTALL_DIR/"
else
  rm -rf "${INSTALL_DIR:?}"/*
  cp -r "$PUBLISH_DIR/." "$INSTALL_DIR/"
fi
chmod +x "$INSTALL_DIR/SplitCordServiceLinux"
find "$INSTALL_DIR/bin" -type f -exec chmod +x {} \; 2>/dev/null || true

echo "[install] systemd birimi kuruluyor: $UNIT_DEST"
cp "$UNIT_SRC" "$UNIT_DEST"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "[install] tamam. Durum: systemctl status $SERVICE_NAME"
