# PORT_PLAN_2.md AP-6/AP-9/Faz 5 -- TASLAK, TAMAMLANMAMIŞ, YAYINLANMADI.
#
# Kullanıcının kendi sıralaması: AppImage canlı doğrulanıp stabil hâle gelmeden bu paket
# tamamlanmıyor (bkz. PORT_PLAN_2.md §9). electron-builder'ın kendi "rpm" hedefi BİLEREK
# KULLANILMIYOR -- AUR'daki PKGBUILD gibi burada da "-bin" deseni tercih edildi (zaten üretilmiş
# AppImage'ı %prep/%install'da --appimage-extract ile açıp paketleyen), electron-builder'ın
# afterRemove'unun RPM'in %postun $1 argüman modelini (AP-9) doğru ele almayacağı endişesiyle.
#
# DOĞRULANMADI: hiç `rpmbuild` ile denenmedi. Version/Source0 URL'i gerçek bir AppImage release'i
# yayınlanmadan doldurulamaz.

Name:           splitcord-turkey
Version:        0.0.0
Release:        1%{?dist}
Summary:        Discord DPI aşımı istemcisi (AppImage'dan paketlenmiş)
License:        Unknown
URL:            https://github.com/cagritaskn/SplitCord-Turkey
Source0:        https://github.com/cagritaskn/SplitCord-Turkey/releases/download/v%{version}/SplitCord-Turkey-Linux-%{version}-AMD64.AppImage
BuildArch:      x86_64
# PORT_PLAN_2.md AP-4/Faz 2 sayesinde libnetfilter_queue/libmnl/libnfnetlink/luajit/iptables-nft
# AppImage'ın içine GÖMÜLÜ olması bekleniyor -- Faz 2 canlı doğrulanana kadar bu liste iyimser
# bir varsayım, DOĞRULANMADI.
Requires:       glibc

%description
SplitCord-Turkey, Discord'un ağ trafiğini DPI aşımı motorlarıyla (Zapret/Zapret2/ByeDPI) çalıştıran
bir Electron istemcisi + arkaplan systemd servisi.

%global __os_install_post %{nil}

%prep
# Kaynak zaten bir binary (AppImage) -- klasik %prep/tar açma adımı yok.

%build
# Derleme yok -- AppImage zaten önceden derlenmiş.

%install
cp %{SOURCE0} %{_builddir}/splitcord-turkey.AppImage
chmod +x %{_builddir}/splitcord-turkey.AppImage
(cd %{_builddir} && ./splitcord-turkey.AppImage --appimage-extract)

mkdir -p %{buildroot}/opt/splitcord-turkey
cp -r %{_builddir}/squashfs-root/* %{buildroot}/opt/splitcord-turkey/
# DOĞRULANMADI: AppImage'ın gerçek squashfs iç yapısı hiç incelenmedi -- yukarıdaki kopyalama
# adımı TAHMİNİ (bkz. PKGBUILD'deki AYNI not), gerçek bir --appimage-extract çıktısına bakılarak
# düzeltilmesi gerekiyor.

mkdir -p %{buildroot}%{_unitdir}
install -m644 %{_builddir}/squashfs-root/service-installer/systemd/splitcord-dpi.service %{buildroot}%{_unitdir}/splitcord-dpi.service 2>/dev/null || true

%files
/opt/splitcord-turkey
%{_unitdir}/splitcord-dpi.service

# PORT_PLAN_2.md AP-9: %postun burada $1 argümanına göre dallanıyor -- bu, dpkg'nin remove/purge
# modelinden farklı bir RPM YAPISI (aynı script, argümanla ayrım) ama SEMANTİK OLARAK ["tam
# kaldırma" vs "yükseltme"] AYNI ayrımı hedefliyor. DOĞRULANMADI, hiç gerçek bir
# `rpm -e`/yükseltme ile denenmedi.
%post
INSTALLER_DIR=/opt/splitcord-turkey/service-installer
if [ -f "$INSTALLER_DIR/install.sh" ]; then
  bash "$INSTALLER_DIR/install.sh" "$INSTALLER_DIR" || \
    echo "UYARI: DPI servisi kurulamadı -- uygulama içinden 'DPI Servisini Kur' ile elle deneyebilirsin."
fi

%postun
if [ "$1" = "0" ]; then
  # $1==0: tam kaldırma (yükseltme SÜRMÜYOR) -- kullanıcı verisi (/var/lib/splitcord) yine de
  # KORUNUYOR, yalnızca servis/systemd birimi kaldırılıyor (Windows NSIS'in ve .deb'in
  # varsayılan davranışıyla TUTARLI kalması için).
  UNINSTALL_SCRIPT=/opt/splitcord/uninstall.sh
  if [ -f "$UNINSTALL_SCRIPT" ]; then
    bash "$UNINSTALL_SCRIPT" || true
  fi
fi

%changelog
# TODO: gerçek release'ler yayınlandıkça doldur
