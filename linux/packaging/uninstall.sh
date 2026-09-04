#!/usr/bin/env bash
# SplitCord DPI Service'i kaldırır. Windows karşılığının (service/installer/uninstall-service.ps1)
# ruhunu taşıyor: servisi durdurup TÜM DPI alt süreçlerini (bkz. Stop-DpiChildProcesses'in Linux
# karşılığı) zorla temizliyor. systemd'nin senkron `systemctl stop`u sayesinde Windows'taki aktif
# bekleme döngüsüne gerek yok.
#
# KULLANICI VERİSİ KORUMASI (bkz. install.sh'teki AYNI not): VARSAYILAN OLARAK /var/lib/splitcord/
# (LinuxPaths.DataDirectory) SİLİNMİYOR -- yalnızca servis + /opt/splitcord + systemd birimi
# kaldırılıyor. Kullanıcı ayarlarını da (doğrulanmış DPI stratejisi, DNS sağlayıcıları) tamamen
# silmek isterse `--purge` bayrağı ile açıkça istemesi gerekiyor (apt purge ile aynı ayrım).
#
# Kullanım: sudo ./uninstall.sh [--purge]
#
# DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5): bu script hiç gerçek bir Linux'ta çalıştırılmadı.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "HATA: bu script root gerektiriyor. 'sudo ./uninstall.sh' ile calistirin." >&2
  exit 1
fi

PURGE=0
if [ "${1:-}" = "--purge" ]; then
  PURGE=1
fi

SERVICE_NAME="splitcord-dpi"
INSTALL_DIR="/opt/splitcord"
UNIT_DEST="/etc/systemd/system/$SERVICE_NAME.service"
DATA_DIR="${SPLITCORD_DATA_DIR:-/var/lib/splitcord}"

stop_dpi_child_processes() {
  # Windows'taki Stop-DpiChildProcesses ile AYNI isim listesi (bkz. uninstall-service.ps1) --
  # bunlar yalnizca SplitCord'un kendi bundled binary'lerine ait, sistemde baska bir yazilimla
  # cakisma riski yok, isimle guvenle kapatilabilir.
  for name in nfqws nfqws2 ciadpi dnsproxy nextdns; do
    pkill -9 -x "$name" 2>/dev/null || true
  done
}

echo "[uninstall] DPI alt surecleri (ilk tur) kapatiliyor..."
stop_dpi_child_processes

if systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
  echo "[uninstall] servis durduruluyor ve devre disi birakiliyor..."
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
else
  echo "[uninstall] servis zaten kurulu degil."
fi

echo "[uninstall] DPI alt surecleri (ikinci tur) kapatiliyor..."
stop_dpi_child_processes

if [ -f "$UNIT_DEST" ]; then
  rm -f "$UNIT_DEST"
  systemctl daemon-reload
  echo "[uninstall] systemd birimi kaldirildi: $UNIT_DEST"
fi

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "[uninstall] $INSTALL_DIR kaldirildi."
fi

if [ "$PURGE" -eq 1 ]; then
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    echo "[uninstall] --purge: kullanici verisi de kaldirildi: $DATA_DIR"
  fi
else
  echo "[uninstall] Kullanici ayarlari KORUNDU: $DATA_DIR (tamamen silmek icin: sudo ./uninstall.sh --purge)"
fi

echo "[uninstall] tamam."
