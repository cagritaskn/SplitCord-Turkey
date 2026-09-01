<p align="center">
  <img width="auto" height="128" src="resources/logo.png">
</p>

# <p align="center"><strong>SplitCord-Turkey</strong></p>

**SplitCord-Turkey**, Türkiye'deki bazı internet servis sağlayıcılarının DPI (Deep Packet Inspection) tabanlı kısıtlamaları nedeniyle Discord'a erişimde yaşanan sorunları çözmek için geliştirilmiş, Discord'un web istemcisini saran açık kaynaklı bir Windows masaüstü uygulamasıdır. Electron tabanlı olduğu için tarayıcıya yakın bir ağ parmak izi taşır, üç farklı DPI aşım motorunu (ByeDPI, GoodbyeDPI, Zapret) tek bir arayüzden otomatik olarak dener ve kalıcı bir arka plan hizmeti sayesinde sisteminizi her açtığınızda ekstra bir işlem yapmanıza gerek kalmadan çalışır.

---

## Özellikler

- **Discord'a görsel ve işlevsel olarak birebir yakın bir arayüz.** Kendi özel başlık çubuğu, bildirimleri, tepsi simgesi ve ekran paylaşımı seçicisiyle resmi masaüstü istemcisinin yerini alabilecek şekilde tasarlanmıştır.
- **Üç DPI aşım motoru, tek uygulama:** ByeDPI (yalnızca bu uygulamanın trafiğini kapsayan yerel proxy, admin gerektirmez), GoodbyeDPI ve Zapret (sistem geneli, WinDivert tabanlı). Otomatik modda motorlar sırayla denenir, çalışan ilk ayar kaydedilip kullanılır.
- **Otomatik ve Manuel mod.** Otomatik modda uygulama sizin için en uygun motoru ve stratejiyi bulur; Manuel modda hangi motorun, hangi parametrelerle çalışacağını kendiniz seçebilirsiniz.
- **Sesli kanal desteği.** ByeDPI'nin kapsayamadığı WebRTC/UDP trafiği için, ByeDPI aktifken arka planda otomatik olarak devreye giren bir Zapret UDP eşlik süreci bulunur.
- **Discord Rich Presence desteği.** Resmi olmayan istemcilerde normalde çalışmayan bu özellik, [arRPC](https://github.com/OpenAsar/arrpc) tabanlı yerel bir RPC sunucusu ile desteklenir.
- **İzinler ve Kontroller ekranı.** Güvenlik duvarı izinlerini, çakışabilecek güvenlik yazılımlarını (Kaspersky, ESET) ve elle kurulmuş harici DPI süreçlerini/hizmetlerini tespit edip yönetmenizi sağlar.
- **Kalıcı arka plan hizmeti.** DPI aşımı, SYSTEM yetkisiyle çalışan ayrı bir Windows Service üzerinden yürütülür; Discord penceresini kapatsanız da bağlantı kesilmez, sistem açılışında otomatik başlar.
- **Ekran paylaşımı seçicisi.** Kalite, FPS ve sistem sesi paylaşımını tek pencereden ayarlayabileceğiniz özel bir ekran/pencere paylaşım aracı içerir.
- **Tema desteği.** Discord'un o anki temasından otomatik renk örnekleme veya sabit tema ön ayarları arasında seçim yapabilirsiniz.

---

## Nasıl Çalışır

SplitCord-Turkey iki ayrı bileşenden oluşur:

- **SplitCordDpiService** — SYSTEM yetkisiyle arka planda çalışan bir Windows Service. ByeDPI/GoodbyeDPI/Zapret süreçlerini yönetir, yerel bir REST API (`127.0.0.1` üzerinde) sunar. Kurulum sırasında yalnızca **bir kez** yönetici izni ister; sonrasında hiçbir zaman tekrar UAC istemi çıkmaz. Ayrıca bu hizmet yalnızca SplitCord-Turkey çalışırken işlevini sürdürür.
- **SplitCord-Turkey İstemcisi** — Discord'u saran, hiçbir zaman yükseltilmiş yetkiyle çalışmayan Electron uygulaması. DPI motor seçimi ve durumu için yerel API üzerinden servisle konuşur, kendi başına yetkilendirme yapmaz ve hizmet düzeyinde çalışmaz.

ByeDPI aktifken yalnızca bu uygulamanın trafiği, kendi başlattığı bir SOCKS5 proxy üzerinden yönlendirilir (sisteminizin geri kalanı etkilenmez). GoodbyeDPI ve Zapret ise WinDivert sürücüsü ile sistem genelinde çalışır; bu iki motor aynı anda etkin olamaz, aynı anda yalnızca tek bir motor aktiftir.

---

## Kurulum ve Çalıştırma

En kolay kurulum yöntemi, hazır kurulum dosyasını indirip çalıştırmaktır.

1. [SplitCord-Turkey-Setup-0.5.7.exe](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/0.5.7/SplitCord-Turkey-Setup-0.5.7.exe) dosyasını indirin. Yeni sürümler için [Releases](https://github.com/cagritaskn/SplitCord-Turkey/releases) sayfasını takip edebilirsiniz.
2. İndirilen dosyayı çalıştırın. Kurulum sihirbazı, arka planda çalışacak DPI aşım hizmetini (SplitCordDpiService) kaydedebilmek için yalnızca **bir kez** yönetici (UAC) izni ister; kurulum tamamlandıktan sonra uygulama hiçbir zaman yükseltilmiş yetkiyle çalışmaz.
3. Kurulum bitince SplitCord-Turkey otomatik olarak açılır.

> [!NOTE]
> İlk açılışta uygulama sizin için en uygun DPI aşım motorunu ve ayarını bulmak amacıyla ByeDPI, GoodbyeDPI ve Zapret'i sırayla dener; bu tarama birkaç on saniye sürebilir. Bu süre boyunca "Bağlantı hazırlanıyor…" ekranını görmeniz normaldir, taramanın bitmesini bekleyin.

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

## Ayarlar Ekranları

- **DPI Aşımı:** Otomatik/Manuel mod seçimi, motor kartları, gelişmiş argüman düzenleme, yeniden arama başlatma ve reddedilen ayar listeleri.
- **İzinler ve Kontroller:** Güvenlik duvarı izinleri, resmi Discord uygulamasıyla çakışma kontrolü, Kaspersky/ESET tespiti, çakışabilecek hizmetlerin ve harici DPI süreçlerinin listesi ile ses bağlantısı kontrolleri.
- **Genel:** Otomatik başlatma, bildirim rozeti, performans modu, bağlantıları sistem tarayıcısında açma ve benzeri genel tercihler.
- **Görünüm:** Discord temasından otomatik renk örnekleme veya sabit tema ön ayarları.
- **Tuş Atamaları:** Sesi kapatma/açma, sağırlaştırma ve pencereyi öne getirme için genel (uygulama arka plandayken de çalışan) kısayollar.
- **Hakkında:** Sürüm bilgisi, güncelleme kontrolü ve tüm ayarları sıfırlama.

---

## Önemli Notlar

> [!NOTE]
> **WinDivert** dosyalarının kullanımı Kaspersky ve ESET gibi bazı antivirüs yazılımları tarafından engellenebiliyor. Bu durumda GoodbyeDPI ve Zapret motorları hiç denenmeden otomatik olarak atlanıp doğrudan ByeDPI'ye yönlendirilir; İzinler ve Kontroller ekranından bu tespiti görebilirsiniz. ESET ve Kaspersky isimli antivirüs yazılımları sisteminizde kurulu ise sesli kanallara bağlanmada ve arama yapmada sorunlar yaşayabilirsiniz. Kaspersky ve ESET hakkında daha fazla bilgi için [bu sayfayı](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) ziyaret edebilirsiniz.

> [!NOTE]
> ByeDPI tek başına yalnızca metin/HTTPS trafiğini kapsar; WebRTC üzerinden yürüyen sesli kanal trafiğini kapsayamaz. Bu yüzden ByeDPI devrede olduğunda, sese destek olması için arka planda ayrıca yalnızca UDP portlarını hedefleyen bağımsız bir Zapret süreci de otomatik olarak devreye alınır. Yukarıda da belirtildiği üzere Kaspersky ve ESET'in varlığı halinde Zapret devreye alınamayacağından ses bağlantılarında sorun yaşayabilirsiniz hatta hiç katılamayabilirsiniz. Bunu engellemek için Kaspersky veya ESET'i sisteminizden kaldırabilir ya da bu antivirüs yazılımları içerisinde SplitCord-Turkey klasörünü bir istisna/dışlama olarak ekleyip SplitCord-Turkey'i tekrar kurarak sorunun çözülüp çözülmediğini test edebilirsiniz.

> [!IMPORTANT]
> Discord Rich Presence desteği, Discord'un web JS paketindeki dahili modülleri sabit imzalara göre bulan bir köprü script'ine dayanır. Discord kendi web paketini güncellediğinde bu köprü geçici olarak bozulabilir; böyle bir durumda yalnızca Rich Presence etkilenir, uygulamanın geri kalanı sorunsuz çalışmaya devam eder.

---

## Kullanılan Açık Kaynak Projeler

- **[ByeDPI](https://github.com/hufrea/byedpi)** by **[hufrea](https://github.com/hufrea)**
- **[GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI)** by **[ValdikSS](https://github.com/ValdikSS)**
- **[zapret](https://github.com/bol-van/zapret)** ve **[zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube)** by **[bol-van](https://github.com/bol-van)** / **[Flowseal](https://github.com/Flowseal)**
- **[WinDivert](https://github.com/basil00/WinDivert)** by **[basil00](https://github.com/basil00)**
- **[arRPC](https://github.com/OpenAsar/arrpc)** by **[OpenAsar](https://github.com/OpenAsar)**
- **[Electron](https://github.com/electron/electron)**

---

## Telif Hakkı

```
Copyright (c) 2026 Çağrı Taşkın
```

---

## Sorumluluk Reddi Beyanı

**Bu yazılım eğitim ve kişisel kullanım amacıyla oluşturulmuştur.**

- Bu araç yalnızca kişisel kullanım ve öğrenme amaçlıdır, ticari kullanım için uygun değildir.
- Geliştirici, bu yazılımın kullanımından doğabilecek herhangi bir zarardan sorumlu değildir.
- Kullanıcılar bu yazılımı kendi sorumluluklarında kullanır.
- Yasal düzenlemelere uygun kullanım kullanıcının sorumluluğundadır.

> [!IMPORTANT]
> Bu programın kullanımından doğan her türlü yasal sorumluluk kullanan kişiye aittir. Uygulama yalnızca eğitim ve araştırma amaçlarıyla yazılmıştır; kullanmak ya da kullanmamak kullanıcının kendi seçimidir.
