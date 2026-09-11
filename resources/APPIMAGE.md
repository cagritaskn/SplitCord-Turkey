# AppImage ile Kullanım (Debian/Ubuntu Tabanlı Olmayan Dağıtımlar)

SplitCord-Turkey'in Linux sürümü öncelikli olarak Debian/Ubuntu tabanlı dağıtımlar (Linux Mint dahil) için `.deb` paketi olarak hazırlanıp test edilir. **Arch, Manjaro, EndeavourOS, Fedora, openSUSE gibi AppImage destekleyen diğer popüler dağıtımlarda** ise program `.deb` yerine **AppImage** formatında sunulur.

> [!NOTE]
> AppImage sürümü, kütüphane/`iptables`/`nftables` gibi bağımlılıkları elden geldiğince kendi içine gömecek şekilde hazırlanmıştır ve teorik olarak çoğu modern (systemd tabanlı) dağıtımda çalışacak şekilde tasarlanmıştır — ama yalnızca Debian/Ubuntu ailesi (Linux Mint üzerinden) canlı olarak test edilmiştir. Diğer dağıtımlarda **"muhtemelen çalışır"** statüsündedir; bir sorunla karşılaşırsanız aşağıdaki "Sorun bildirme" bölümüne bakın.

---

## Kurulum ve ilk çalıştırma

1. **[SplitCord-Turkey-Linux-1.0.3-AMD64.AppImage](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/1.0.3/SplitCord-Turkey-Linux-1.0.3-AMD64.AppImage)** dosyasını indirin. Diğer sürümler için [Releases](https://github.com/cagritaskn/SplitCord-Turkey/releases) sayfasını takip edebilirsiniz.
2. Dosyayı çalıştırılabilir yapın:
   ```bash
   chmod +x SplitCord-Turkey-*.AppImage
   ```
3. Çalıştırın:
   ```bash
   ./SplitCord-Turkey-*.AppImage
   ```
   ya da dosya yöneticinizden çift tıklayarak açabilirsiniz.

> [!IMPORTANT]
> AppImage'ın açılabilmesi için sisteminizde **FUSE** kurulu olmalıdır (çoğu modern masaüstü dağıtımında zaten hazır gelir). "dlopen(): libfuse.so.2" gibi bir hata alırsanız dağıtımınızın paket yöneticisiyle `fuse2`/`fuse` paketini kurmanız gerekir. FUSE'yi hiç kurmak istemiyorsanız, AppImage'ı FUSE'siz çalıştırmak için `--appimage-extract-and-run` bayrağını kullanabilirsiniz:
> ```bash
> ./SplitCord-Turkey-*.AppImage --appimage-extract-and-run
> ```

### Arka plan DPI hizmetini kurma

`.deb`'in aksine AppImage bir "kurulum" yapmaz — yalnızca indirip çalıştırılan taşınabilir bir dosyadır. Bu yüzden arka planda çalışan DPI aşım hizmeti (systemd birimi) otomatik olarak kurulmaz; program ilk açıldığında ekranda **"DPI Servisini Kur"** butonunu göreceksiniz. Butona tıklayıp parolanızı girdiğinizde (bir `pkexec` penceresi açılır — Windows'taki UAC isteminin karşılığıdır) hizmet kurulup başlatılır, bir sonraki açılışlarda bu adımı tekrar görmezsiniz.

---

## Bağımlılık kontrolleri

AppImage, çalışması gereken kütüphaneleri (`libnetfilter_queue`, `libmnl`, `libnfnetlink`, `luajit`) ve araçları (`iptables`/`iptables-nft`, `nft`) kendi içine gömmeye çalışır. Yine de dağıtımınıza özgü bir sebeple bunlardan biri eksik/çalışmıyor olabilir. Bu durumda:

- **Ayarlar > İzinler ve Kontroller** ekranında "AppImage Bağımlılıkları" bölümünden hangi bileşenin eksik olduğunu ve dağıtımınıza özel önerilen kurulum komutunu görebilirsiniz.
- DPI motoru hiçbir ayar bulamadan tükenirse (tüm stratejiler denenip hiçbiri çalışmazsa) ve bunun sebebi gerçekten bir bağımlılık sorunuysa, ana ekranda otomatik olarak **"Bağımlılık Sorunu Tespit Edildi"** butonu belirir — bu buton yalnızca gerçek bir bağımlılık sorunu tespit edildiğinde çıkar, ağ/ISP kaynaklı normal bir "ayar bulunamadı" durumunda görünmez.

---

## Sorun bildirme

Bağımlılık sorunu diyaloğundaki (ya da İzinler ve Kontroller ekranındaki) **"Sorun Bildir"** butonuna tıkladığınızda, dağıtımınız ve eksik bileşenler önceden doldurulmuş şekilde GitHub'da yeni bir issue sayfası açılır — dilerseniz ek bilgi ekleyip gönderebilirsiniz. Bu, özellikle Debian/Ubuntu dışındaki dağıtımlarda karşılaşılan sorunların çözülebilmesi için en değerli geri bildirim yoludur.

Bağımlılık kaynaklı olmayan (ör. genel bir çökme, beklenmeyen bir davranış) sorunlar için de doğrudan [Issues](https://github.com/cagritaskn/SplitCord-Turkey/issues) sayfasından bildirim açabilirsiniz.

---

## Güncelleme

Hakkında ve Güncelleme ekranından "Güncellemeleri Kontrol Et" dediğinizde yeni bir sürüm varsa **"Sürüm Sayfasını Aç"** butonu belirir — bu buton yalnızca ilgili GitHub sürüm sayfasını tarayıcınızda açar, otomatik indirme/kurulum yapmaz. Yeni `.AppImage` dosyasını indirip eski dosyanın üzerine koymanız (ya da eskisini silip yenisini kullanmanız) yeterlidir; ayarlarınız (`~/.config/splitcord-client-linux/`) ve DPI servis ayarlarınız (`/var/lib/splitcord/`) korunur, AppImage dosyasının kendisiyle hiçbir ilgileri yoktur.

---

## Kaldırma

- **Programın kendisi:** indirdiğiniz `.AppImage` dosyasını silmeniz yeterlidir.
- **Arka plan DPI hizmeti:** Hakkında ve Güncelleme ekranındaki **"Servisi Kaldır"** butonuyla (bir `pkexec` parola istemi açılır) systemd birimini ve kurulum dizinini temizleyebilirsiniz — kullanıcı verileriniz (doğrulanmış DPI stratejisi, DNS sağlayıcıları) varsayılan olarak korunur.

---

## Hangi dağıtımlarda çalışması bekleniyor

AppImage formatı, systemd kullanan ve glibc tabanlı (musl değil) modern masaüstü Linux dağıtımlarının çoğunda çalışacak şekilde tasarlandı — Arch, Manjaro, EndeavourOS, Fedora, openSUSE ve benzerleri dahil. Alpine/Void gibi systemd kullanmayan dağıtımlar ile NixOS gibi FHS-dışı dosya yerleşimine sahip dağıtımlar kapsam dışıdır.

Yalnızca Debian/Ubuntu ailesi (Linux Mint) canlı test edildiği için diğer dağıtımlardaki deneyiminiz burada yer almıyorsa lütfen [sorun bildirin](#sorun-bildirme) — geri bildiriminiz doğrudan desteğin genişletilmesine yardımcı olur.
