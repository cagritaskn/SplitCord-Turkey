<p align="center">
  <img width="auto" height="128" src="resources/logo.png">
</p>

# <p align="center"><strong>SplitCord-Turkey</strong></p>

**SplitCord-Turkey**, Türkiye'deki bazı internet servis sağlayıcılarının DPI (Deep Packet Inspection) tabanlı kısıtlamaları nedeniyle Discord'a erişimde yaşanan sorunları çözmek için geliştirilmiş, Discord'un web istemcisini saran açık kaynaklı bir Windows masaüstü uygulamasıdır. Electron tabanlı olduğu için tarayıcıya yakın bir ağ parmak izi taşır, dört farklı DPI aşım motorunu (Zapret, Zapret2, ByeDPI, GoodbyeDPI) tek bir arayüzden otomatik olarak dener, şifreli DNS (DoH/DoT/DoQ/DNSCrypt) desteğiyle DNS tabanlı engellemelere karşı da dayanıklıdır ve kalıcı bir arka plan hizmeti sayesinde sisteminizi her açtığınızda ekstra bir işlem yapmanıza gerek kalmadan çalışır.

---

## Kurulum ve Çalıştırma

Windows için hazırlanmış kurulum paketini çalıştırarak SplitCord-Turkey'i kurup kullanmaya başlayabilirsiniz.

1. **[SplitCord-Turkey-Setup-0.9.8.exe](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/0.9.8/SplitCord-Turkey-Setup-0.9.8.exe)** dosyasını indirin. Diğer sürümler için [Releases](https://github.com/cagritaskn/SplitCord-Turkey/releases) sayfasını takip edebilirsiniz.
2. İndirilen dosyayı çalıştırın. SmartScreen uyarısı görürseniz **(Windows kişisel bilgisayarınızı korudu başlıklı)** pencerede bulunan **Ek bilgi** kısmına tıklayıp daha sonra **Yine de çalıştır** butonuna tıklayın. Set-up, arka planda çalışacak DPI aşım hizmetini (SplitCordDpiService) kaydedebilmek için yönetici izni isteyebilir; kurulum tamamlandıktan sonra uygulama hiçbir zaman yükseltilmiş yetkiyle çalışmaz (Yönetici izni istemez).
3. Kurulum bitince SplitCord-Turkey'i çalıştırın.
4. İlk açılışta uygulama sizin için en uygun DPI aşım motorunu ve ayarını bulmak amacıyla Zapret, Zapret2, ByeDPI ve GoodbyeDPI'yi sırayla dener; bu tarama birkaç dakika sürebilir. Bu süre boyunca "Bağlantı hazırlanıyor…" ekranını görmeniz normaldir, taramanın bitmesini bekleyin.
5. Eğer programın başlık çubuğunda ya da bir uyarı kutucuğunda **"Eylem Gerekiyor"** ifadesini görürseniz bu uyarıya tıklayarak gerekli eylemleri uygulamanız gerekir, aksi halde SplitCord-Turkey beklendiği gibi çalışmayabilir.

> [!NOTE]
> **Kaspersky** veya **ESET** isimli antivirüs yazılımları sisteminizde kuruluysa doğru ve çalışan bir ayar bulmakta, sesli sohbet kanallarına bağlanmakta ve çeşitli farklı işlevlerde sorunlar yaşarsınız. Kaspersky ve ESET hakkında daha fazla bilgi için [bu sayfayı](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) ziyaret edebilirsiniz.

---

## Özellikler

- **Discord'a görsel ve işlevsel olarak birebir yakın bir arayüz.** Kendi özel başlık çubuğu, bildirimleri, tepsi simgesi ve ekran paylaşımı seçicisiyle resmi masaüstü istemcisinin yerini alabilecek şekilde tasarlanmıştır.
- **Dört DPI aşım motoru, tek uygulama:** Zapret (sistem geneli, WinDivert tabanlı — Otomatik modun giriş noktasıdır), Zapret2 (sistem geneli, WinDivert tabanlı — blockcheck2 ile otomatik strateji keşfi yapar), ByeDPI (yalnızca bu uygulamanın trafiğini kapsayan yerel proxy) ve GoodbyeDPI (sistem geneli, WinDivert tabanlı). Otomatik modda motorlar sırayla denenir, çalışan ilk ayar kaydedilip kullanılır.
- **Otomatik ve Manuel mod.** Otomatik modda uygulama sizin için en uygun motoru ve stratejiyi bulur; Manuel modda hangi motorun, hangi parametrelerle çalışacağını kendiniz seçebilirsiniz.
- **Şifreli DNS desteği (DoH/DNSCrypt, isteğe bağlı DoT/DoQ).** DNS seviyesinde yaşanan engellemelere karşı Zapret/Zapret2/ByeDPI, DoH → DNSCrypt → DNS'siz sırasıyla otomatik olarak dener (DoT/DoQ sabit 853 portunda çalıştığı ve birçok ISP tarafından protokole bakılmaksızın toptan engellendiği için otomatik sıradan çıkarıldı, Manuel moddan hâlâ elle sabitlenebilir); DoH sağlayıcıları arasında, diğerlerinin tamamı engellendiğinde devreye giren bir NextDNS yedeği de bulunur. Sağlayıcıları Ayarlar ekranından kendiniz de özelleştirebilirsiniz.
- **Sesli kanal desteği.** ByeDPI'nin kapsayamadığı WebRTC/UDP trafiği için, ByeDPI aktifken arka planda otomatik olarak devreye giren bir Zapret UDP eşlik süreci bulunur.
- **Discord Rich Presence desteği.** Resmi olmayan istemcilerde normalde çalışmayan bu özellik, [arRPC](https://github.com/OpenAsar/arrpc) tabanlı yerel bir RPC sunucusu ile desteklenir.
- **İzinler ve Kontroller ekranı.** Güvenlik duvarı izinlerini, çakışabilecek güvenlik yazılımlarını (Kaspersky, ESET) ve elle kurulmuş harici DPI süreçlerini/hizmetlerini tespit edip yönetmenizi sağlar.
- **Kalıcı arka plan hizmeti.** DPI aşımı, SYSTEM yetkisiyle çalışan ayrı bir Windows hizmeti üzerinden yürütülür; Discord penceresini kapatsanız da bağlantı kesilmez, sistem açılışında otomatik başlar.
- **Birleşik tanılama günlüğü.** Programın ve hizmetin yaptığı her şey, sorun bildirirken paylaşabileceğiniz tek bir dosyada (en fazla 50 MB) tutulur; Hakkında ve Güncelleme ekranından tek tıkla açılabilir.
- **Ekran paylaşımı seçicisi.** Kalite, FPS ve sistem sesi paylaşımını tek pencereden ayarlayabileceğiniz özel bir ekran/pencere paylaşım aracı içerir.
- **Tema desteği.** Discord'un o anki temasından otomatik renk örnekleme veya sabit tema ön ayarları arasında seçim yapabilirsiniz.
- **Kolay kaldırma.** Windows'un dahili program ekleme ve kaldırma menülerinden SplitCord-Turkey'i kolaylıkla kaldırabilirsiniz; kaldırma işlemi hizmeti, tüm DPI aşım süreçlerini ve WinDivert sürücü kayıtlarını da tam olarak temizler.
- **Kendi kendine kurtarma.** Discord uzun süre bağlanamadığında, Discord'un kendi yükleme ekranında beliren bir butonla mevcut ayarı yasaklayıp Otomatik moddan sıfırdan bir tarama başlatabilirsiniz.

---

## Nasıl Çalışır

SplitCord-Turkey iki ayrı bileşenden oluşur:

- **SplitCordDpiService** — SYSTEM yetkisiyle arka planda çalışan bir Windows Service. Zapret/Zapret2/ByeDPI/GoodbyeDPI süreçlerini yönetir, yerel bir REST API (`127.0.0.1` üzerinde) sunar. Kurulum sırasında yalnızca **bir kez** yönetici izni ister; sonrasında hiçbir zaman tekrar UAC istemi çıkmaz. Ayrıca bu hizmet yalnızca SplitCord-Turkey çalışırken işlevini sürdürür.
- **SplitCord-Turkey İstemcisi** — Discord'u saran, hiçbir zaman yükseltilmiş yetkiyle çalışmayan Electron uygulaması. DPI motor seçimi ve durumu için yerel API üzerinden servisle konuşur, kendi başına yetkilendirme yapmaz ve hizmet düzeyinde çalışmaz.

ByeDPI aktifken yalnızca bu uygulamanın trafiği, kendi başlattığı bir SOCKS5 proxy üzerinden yönlendirilir (sisteminizin geri kalanı etkilenmez). Zapret, Zapret2 ve GoodbyeDPI ise WinDivert sürücüsü ile sistem genelinde çalışır; bu üç motordan aynı anda yalnızca biri aktif olabilir.

Otomatik modun giriş noktası **Zapret**'tir: önceden bilinen, hızlıca denenen sabit bir strateji listesi kullanır. Zapret tükenirse sırasıyla **Zapret2** (bol-van/zapret2 projesinin resmi keşif aracı olan **blockcheck2**'yi kullanarak discord.com için gerçekten çalışan bir strateji arar, hem metin/TLS hem de sesli (UDP/STUN) bağlantıyı doğrular — sabit listeye kıyasla çok daha kapsamlı ama daha uzun sürebilir), ByeDPI ve GoodbyeDPI denenir.

---

## Ayarlar Ekranları

- **DPI Aşımı:** Otomatik/Manuel mod seçimi, motor kartları, gelişmiş argüman düzenleme, DNS protokolü sırası ve sağlayıcıları, Zapret2 blockcheck2 tarama zamanaşımı, yeniden arama başlatma ve reddedilen ayar listeleri.
- **İzinler ve Kontroller:** Güvenlik duvarı izinleri, resmi Discord uygulamasıyla çakışma kontrolü, Kaspersky/ESET tespiti, çakışabilecek hizmetlerin ve harici DPI süreçlerinin listesi ile ses bağlantısı kontrolleri.
- **Genel:** Otomatik başlatma, bildirim rozeti, performans modu, bağlantıları sistem tarayıcısında açma, QUIC devre dışı bırakma ve benzeri genel tercihler.
- **Görünüm:** Discord temasından otomatik renk örnekleme veya sabit tema ön ayarları.
- **Tuş Atamaları:** Sesi kapatma/açma, sağırlaştırma ve pencereyi öne getirme için genel (uygulama arka plandayken de çalışan) kısayollar.
- **Hakkında:** Sürüm bilgisi, güncelleme kontrolü, tanılama günlüğü dosya konumunu açma ve tüm ayarları sıfırlama.

---

## Önemli Notlar

> [!NOTE]
> **WinDivert** dosyalarının kullanımı Kaspersky ve ESET gibi bazı antivirüs yazılımları tarafından engellenebiliyor. Bu durumda Zapret, Zapret2 ve GoodbyeDPI motorları hiç denenmeden otomatik olarak atlanıp doğrudan ByeDPI'ye yönlendirilir; İzinler ve Kontroller ekranından bu tespiti görebilir, ana ekranda çıkan uyarı penceresinden de bilgi alabilirsiniz. ESET ve Kaspersky isimli antivirüs yazılımları sisteminizde kurulu ise sesli kanallara bağlanmada ve arama yapmada sorunlar yaşayabilirsiniz. Kaspersky ve ESET hakkında daha fazla bilgi için [bu sayfayı](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) ziyaret edebilirsiniz.

> [!NOTE]
> ByeDPI tek başına yalnızca metin/HTTPS trafiğini kapsar; WebRTC üzerinden yürüyen sesli kanal trafiğini kapsayamaz. Bu yüzden ByeDPI devrede olduğunda, sese destek olması için arka planda ayrıca yalnızca UDP portlarını hedefleyen bağımsız bir Zapret süreci de otomatik olarak devreye alınır. Yukarıda da belirtildiği üzere Kaspersky ve ESET'in varlığı halinde Zapret devreye alınamayacağından ses bağlantılarında sorun yaşayabilirsiniz hatta hiç katılamayabilirsiniz. Bunu engellemek için Kaspersky veya ESET'i sisteminizden kaldırabilir ya da bu antivirüs yazılımları içerisinde SplitCord-Turkey klasörünü bir istisna/dışlama olarak ekleyip SplitCord-Turkey'i tekrar kurarak sorunun çözülüp çözülmediğini test edebilirsiniz.

> [!IMPORTANT]
> Discord Rich Presence desteği, Discord'un web JS paketindeki dahili modülleri sabit imzalara göre bulan bir köprü script'ine dayanır. Discord kendi web paketini güncellediğinde bu köprü geçici olarak bozulabilir; böyle bir durumda yalnızca Rich Presence etkilenir, uygulamanın geri kalanı sorunsuz çalışmaya devam eder.

---

## Sıfırdan Derleme

SplitCord-Turkey, kaynak koddan da derlenerek çalıştırılabilir.

### Gereksinimler

- **.NET 8.0 SDK** veya üzeri
- **Node.js 18** veya üzeri
- **Windows 10/11** işletim sistemi

### Derleme Adımları

1. **Bağımlılıkları yükleyin**
   ```bash
   cd client
   npm install
   ```

2. **DPI araçlarının ikili dosyalarını indirin**
   ```bash
   node ../scripts/fetch-binaries.js
   ```

3. **Kurulum paketini oluşturun** (bu adım, C# servisini de otomatik olarak derler)
   ```bash
   npm run dist
   ```

4. Oluşan `client/dist/SplitCord-Turkey-Setup-*.exe` dosyasını çalıştırarak kurulumu tamamlayın.

> [!NOTE]
> Yalnızca geliştirme amacıyla çalıştırmak isterseniz, servisi `service/installer/install-service.ps1` betiğiyle (yönetici olarak) kurduktan sonra `client` klasöründe `npm start` komutunu kullanabilirsiniz.

---

## Kullanılan Açık Kaynak Projeler

- **[DPIscord](https://github.com/alimali54/DPIscord)** by **[alimali54](https://github.com/alimali54)**
- **[ByeDPI](https://github.com/hufrea/byedpi)** by **[hufrea](https://github.com/hufrea)**
- **[GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI)** by **[ValdikSS](https://github.com/ValdikSS)**
- **[zapret](https://github.com/bol-van/zapret)** ve **[zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube)** by **[bol-van](https://github.com/bol-van)** / **[Flowseal](https://github.com/Flowseal)**
- **[zapret2](https://github.com/bol-van/zapret2)** by **[bol-van](https://github.com/bol-van)**
- **[dnsproxy](https://github.com/AdguardTeam/dnsproxy)** by **[AdguardTeam](https://github.com/AdguardTeam)**
- **[nextdns](https://github.com/nextdns/nextdns)** by **[NextDNS](https://github.com/nextdns)**
- **[WinDivert](https://github.com/basil00/WinDivert)** by **[basil00](https://github.com/basil00)**
- **[arRPC](https://github.com/OpenAsar/arrpc)** by **[OpenAsar](https://github.com/OpenAsar)**
- **[Electron](https://github.com/electron/electron)**

---
## Özel Teşekkürler
- Yazılımın geliştirilmesine katkıda bulunan **[Techolay.net](https://techolay.net/sosyal/)** kurucusu **[Recep Baltaş](https://www.youtube.com/@Techolay/)**'a çok teşekkür ederim.

### Test Edenler:
- [alperenkrpnr](https://github.com/alperenkrpnr) - Debugging
- nexos - Vodafone
- dominos41 - Kablonet
- Deranged, amevoid, [alperenkrpnr](https://github.com/alperenkrpnr), Ekincanbey, [yigitacarli](https://github.com/yigitacarli) - SuperOnline
- [hus58](https://github.com/hus58) - Millenicom
- rafetlannister - Teknosanet


## Telif Hakkı

```
Copyright (c) 2026 Çağrı Taşkın
```

---

## Bağış ve Destek

Bu programı kullanmak tamamen ücretsizdir. Kullanımından herhangi bir gelir elde etmiyorum. Ancak çalışmalarıma devam edebilmem için aşağıda bulunan bağış adreslerinden beni destekleyebilirsiniz. Github üzerinden (bu sayfanın en üstünden) projeye yıldız da bırakabilirsiniz.

**GitHub Sponsor:**

[![Sponsor](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/cagritaskn)

**Patreon:**

[![Static Badge](https://img.shields.io/badge/cagritaskn-purple?logo=patreon&label=Patreon)](https://www.patreon.com/cagritaskn/membership)

---

## Sorumluluk Reddi Beyanı

**Bu yazılım eğitim ve kişisel kullanım amacıyla oluşturulmuştur.**

- Bu araç yalnızca kişisel kullanım ve öğrenme amaçlıdır, ticari kullanım için uygun değildir.
- Geliştirici, bu yazılımın kullanımından doğabilecek herhangi bir zarardan sorumlu değildir.
- Kullanıcılar bu yazılımı kendi sorumluluklarında kullanır.
- Yasal düzenlemelere uygun kullanım kullanıcının sorumluluğundadır.

> [!IMPORTANT]
> Bu programın kullanımından doğan her türlü yasal sorumluluk kullanan kişiye aittir. Uygulama yalnızca eğitim ve araştırma amaçlarıyla yazılmıştır; kullanmak ya da kullanmamak kullanıcının kendi seçimidir.
