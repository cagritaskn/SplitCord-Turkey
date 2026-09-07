#!/usr/bin/env bash
# electron-builder'ın .deb hedefi için "afterRemove" script'i (bkz. client/package.json
# build.deb.afterRemove) -- dpkg'nin kendi postrm mekanizmasıyla AYNI şekilde ilk argüman
# olarak eylemi alır (Debian policy §6.5): "remove", "purge" ya da bir upgrade sırasında
# "upgrade"/"failed-upgrade" gibi ARA değerler de gelebilir -- DPI servisini yalnızca GERÇEK
# bir kaldırmada (remove/purge) söküyoruz, bir sürüm YÜKSELTMESİ sırasında DEĞİL (yoksa her
# `apt upgrade`'de servis gereksiz yere durup yeniden kurulurdu).
#
# ÖNEMLİ (canlı testte bulunan gerçek bug, 2026-09-05): Debian policy §6.5'e göre postrm,
# paket dosyaları (`/opt/SplitCord-Turkey/**`) SİLİNDİKTEN SONRA çalışır -- yani bu noktada
# `/opt/SplitCord-Turkey/resources/service-installer/uninstall.sh` ARTIK DİSKTE YOK (ilk
# denemede tam olarak bu yüzden hiçbir şey silinmiyordu, script sessizce no-op oluyordu).
# Bunun yerine install.sh'in KENDİ install.sh -> /opt/splitcord KOPYASINI (bkz. install.sh,
# deb-postinst.sh'in çağırdığı script) kullanıyoruz: /opt/splitcord dpkg'nin paket dosya
# listesinde YOK (install.sh tarafından yan etki olarak oluşturuluyor), bu yüzden dpkg'nin
# kendi dosya temizliğinden ETKİLENMİYOR ve postrm zamanında hâlâ diskte duruyor.
set -euo pipefail

ACTION="${1:-}"
UNINSTALL_SCRIPT="/opt/splitcord/uninstall.sh"
DATA_DIR="/var/lib/splitcord"

# ÖNEMLİ (canlı testte bulunan İKİNCİ gerçek bug, 2026-09-05): dpkg TEK BİR `dpkg --purge`/
# `apt purge` çağrısında BİLE postrm'i İKİ KEZ çağırıyor -- önce "remove", SONRA (ayrı bir
# çağrı olarak) "purge" (bkz. Debian policy §6.5). "remove" adımı yukarıdaki uninstall.sh'i
# ZATEN çalıştırıp /opt/splitcord'u (dolayısıyla uninstall.sh'in KENDİSİNİ de) sildiği için,
# "purge" adımı çalıştığında UNINSTALL_SCRIPT artık diskte YOK -- bu yüzden "purge" dalı ona
# GÜVENMİYOR, kullanıcı verisini kendisi doğrudan siliyor. (uninstall.sh hâlâ duruyorsa --
# yalnızca postrm doğrudan "purge" ile, "remove" adımı hiç çalışmadan tetiklenirse mümkün --
# o durumda da onu kullanmak zararsız, servis/opt temizliğini de üstlenmiş olur.)
case "$ACTION" in
  remove)
    if [ -f "$UNINSTALL_SCRIPT" ]; then
      echo "[splitcord] DPI servisi kaldırılıyor (kullanıcı verisi korunuyor)..."
      bash "$UNINSTALL_SCRIPT" || true
    fi
    ;;
  purge)
    echo "[splitcord] DPI servisi VE kullanıcı verisi kaldırılıyor..."
    if [ -f "$UNINSTALL_SCRIPT" ]; then
      bash "$UNINSTALL_SCRIPT" --purge || true
    elif [ -d "$DATA_DIR" ]; then
      rm -rf "$DATA_DIR"
    fi
    ;;
  *)
    # upgrade/failed-upgrade/disappear vb. -- dokunma.
    ;;
esac

exit 0
