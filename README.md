<p align="center">
  <img width="auto" height="128" src="resources/logo.png">
</p>

# <p align="center"><strong>SplitCord-Turkey</strong></p>

**SplitCord-Turkey**, Türkiye'deki bazı internet servis sağlayıcılarının DPI (Deep Packet Inspection) tabanlı kısıtlamaları nedeniyle Discord'a erişimde yaşanan sorunları çözmek için geliştirilmiş, Discord'un web istemcisini saran açık kaynaklı bir Windows masaüstü uygulamasıdır. Electron tabanlı olduğu için tarayıcıya yakın bir ağ parmak izi taşır, dört farklı DPI aşım motorunu (Zapret, Zapret2, ByeDPI, GoodbyeDPI) tek bir arayüzden otomatik olarak dener, şifreli DNS desteğiyle DNS tabanlı engellemelere karşı da dayanıklıdır ve kalıcı bir arka plan hizmeti sayesinde sisteminizi her açtığınızda ekstra bir işlem yapmanıza gerek kalmadan çalışır. Resmi Discord Windows uygulamasının yapabildiği çoğu şeyi yapabilecek şekilde tasarlandı ve Vencord'u da isteğe bağlı şekilde destekliyor. Tam otomatik çalışma odaklı hazırlanmış olsa da manuel ve gelişmiş ayarlamalar yapmaya da izin verir.

---

## Windows Kullanımı

Windows için hazırlanmış kurulum paketini çalıştırarak SplitCord-Turkey'i kurup kullanmaya başlayabilirsiniz.

1. **[SplitCord-Turkey-Setup-1.0.3.exe](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/1.0.3/SplitCord-Turkey-Setup-1.0.3.exe)** dosyasını indirin. Diğer sürümler için [Releases](https://github.com/cagritaskn/SplitCord-Turkey/releases) sayfasını takip edebilirsiniz.
2. İndirilen dosyayı çalıştırın. SmartScreen uyarısı görürseniz **(Windows kişisel bilgisayarınızı korudu başlıklı)** pencerede bulunan **Ek bilgi** kısmına tıklayıp daha sonra **Yine de çalıştır** butonuna tıklayın. Set-up, arka planda çalışacak DPI aşım hizmetini (SplitCordDpiService) kaydedebilmek için yönetici izni isteyebilir; kurulum tamamlandıktan sonra uygulama hiçbir zaman yükseltilmiş yetkiyle çalışmaz (Yönetici izni istemez).
3. Kurulum bitince SplitCord-Turkey'i çalıştırın.
4. İlk açılışta uygulama sizin için en uygun DPI aşım motorunu ve ayarını bulmak amacıyla Zapret, Zapret2, ByeDPI ve GoodbyeDPI'yi sırayla dener; bu tarama birkaç dakika sürebilir. Bu süre boyunca "Bağlantı hazırlanıyor…" ekranını görmeniz normaldir, taramanın bitmesini bekleyin.
5. Eğer programın başlık çubuğunda ya da bir uyarı kutucuğunda **"Eylem Gerekiyor"** ifadesini görürseniz bu uyarıya tıklayarak gerekli eylemleri uygulamanız gerekir, aksi halde SplitCord-Turkey beklendiği gibi çalışmayabilir.

> [!NOTE]
> **Kaspersky** veya **ESET** isimli antivirüs yazılımları sisteminizde kuruluysa doğru ve çalışan bir ayar bulmakta, sesli sohbet kanallarına bağlanmakta ve çeşitli farklı işlevlerde sorunlar yaşarsınız. Kaspersky ve ESET hakkında daha fazla bilgi için [bu sayfayı](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) ziyaret edebilirsiniz.

---

## Linux Kullanımı

SplitCord-Turkey'in Debian/Ubuntu tabanlı dağıtımlar için (Linux Mint'te test edildi) `.deb` paketi olarak sunulan bir Linux sürümü de bulunur. Motor seti Windows'tan biraz farklıdır: WinDivert yerine NFQUEUE/iptables kullanılır, GoodbyeDPI Linux'a özgü bir karşılığı olmadığı için bulunmaz — Otomatik modun motor sırası **Zapret → Zapret2 → ByeDPI**'dir.

1. [Releases](https://github.com/cagritaskn/SplitCord-Turkey/releases) sayfasından [SplitCord-Turkey-Linux-1.0.3-AMD64.deb](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/1.0.3/SplitCord-Turkey-Linux-1.0.3-AMD64.deb) dosyasını indirin.
2. Paketi kurun:
   ```bash
   sudo dpkg -i SplitCord-Turkey-Linux-1.0.3-AMD64.deb
   ```
   ya da 
   Linux dağıtımınız destekliyorsa .deb dosyasına çift tıklayıp çalıştırarak kurun.
   Kurulum sırasında DPI aşım hizmeti (systemd birimi) otomatik olarak etkinleştirilip başlatılır, ekstra bir adım gerekmez.
3. Kurulum bitince SplitCord-Turkey'i çalıştırın; ilk açılıştaki motor taraması Windows ile aynı şekilde işler (bkz. yukarıdaki Windows adımları 4-5).
4. Kaldırmak için:
   ```bash
   sudo apt remove splitcord-client-linux      # ayarları korur
   sudo apt purge splitcord-client-linux       # ayarları da siler
   ```
   ya da 
   SplitCord-Turkey ayarlarında Hakkında ve Güncelleme sayfasından SplitCord-Turkey'i kaldır butonu ile kaldırabilirsiniz.

> [!NOTE]
> Debian/Ubuntu tabanlı olmayan *AppImage destekleyen popüler Linux dağıtımları* (Arch, Manjaro, EndeavourOS, Fedora, openSUSE gibi) dağıtımları için AppImage ile kullanım hakkında daha fazla bilgi [bu sayfada](resources/APPIMAGE.md) mevcut.

---

## Karşılaşılabilecek Sorunlar

### **Sistem Geneli Aşımlarda (Zapret, Zapret2 ve GoodbyeDPI) Belirli Siteler/Uygulamalara Erişimin Kaybedilmesi Durumunda**
DPI Aşımı ayarlarından **Gelişmiş** seçeneğini aktifleştirin, ardından aşağı kaydırıp **Argüman Setini Yasakla** butonunu bulup tıklayın. Sorun devam ederse bu işlemi tekrar edin. Yine sonuç alamazsanız DPI aşım motorunu değşitirmeyi deneyin. (Örn. Zapret2 -> Zapret) Ayrıca SplitCord-Turkey'i sonlandırdığınızda hiçbir aşım motorunun çalışmayacağı, bu sebeple erişim kaybettiğiniz site/uygulamalara SplitCord-Turkey'den çıkış yaptıktan sonra erişebileceğinizi unutmayın. Eğer herhangi bir aşım motoru aktifken bir siteye/uygulamaya erişmekte sorun yaşıyorsanız, lütfen [Github Issues sayfasında bir rapor oluşturarak](https://github.com/cagritaskn/SplitCord-Turkey/issues) bildirin. Ayrıca DPI Aşımı ayarlarındaki **Dışlamalar** penceresinden erişim sorunu yaşadığınız domaini manuel olarak ekleyerek o domain için DPI aşım tekniğinin hiç uygulanmamasını sağlayabilir, böylece o domain aşımdan etkilenmeden normal şekilde çalışmaya devam edebilir.

### **QUIC Hatası Almanız Durumunda**
Genel ayarlarda bulunan **QUIC devre dışı** seçeneğini aktifleştirip yeniden arama başlatmayı deneyin.

### **Ekran Paylaşımı Panelinde Tercih Ettiğiniz Uygulamanın Bulunmaması Durumunda**
SplitCord-Turkey, Chromium tabanlı bir Discord sunduğu için tam ekran uygulamalar ekran paylaşım panelinde görülemeyebilir. Bu sebeple tam ekran uygulama/oyun destekliyorsa pencere modunu çerçevesiz pencereli (windowed borderless) moduna alarak ekran paylaşımını tekrar deneyin.

### **DPI Motoruna Bağlanılamama Hatası Aldığınızda**
**SplitCordDpiService.dll** dosyası her güncellendiğinde yeni bir hash'e sahip olduğundan Microsoft Defender'ın makine öğrenmesine bağlı zararlı yazlım tespitinde hatalı olarak flaglenebiliyor. Bu durumun yaşanmaması adına her release'ten sonra Microsoft'a dosya örneği ve inceleme talebi gönderiliyor ve kabul ediliyor ancak bu manuel bir işlem olduğundan gözden kaçtığında DLL dosyasının Defender tarafından silinmesi ihtimali bulunuyor. Bu yaşandığında DPI motoruna erişlemediğine ilişkin hata alınabiliyor. Eğer bu durum gerçekleşirse Defender üzerinden ilgili DLL dosyası ya da SplitCord-Turkey'in kurulum klasörünü Defender istisnalarına ekleyip tekrar kurulum yaparak sorunu çözebilirsiniz. Ayrıntılı açıklama ve çözüm adımları için [ANTIVIRUS.md](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) sayfasına bakın.

### **ECONNREFUSED Hatası Almanız Durumunda**
Uygulama günlüğünde ya da hata mesajında **ECONNREFUSED** (`127.0.0.1:58271`) görüyorsanız bu, yukarıdaki "DPI Motoruna Bağlanılamama Hatası" ile aynı sorundur — arka plan hizmeti Windows Defender tarafından yanlış pozitif olarak karantinaya alındığı için başlayamıyordur. Ayrıntılı açıklama ve çözüm adımları için [ANTIVIRUS.md](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) sayfasına bakın.

### **Sesli Görüşmeye Bağlantı Sorunu Yaşadığınızda**
Ayarlardaki DPI Aşımı bölümünde **Gelişmiş** seçeneğini aktifleştirip **Argüman Setini Yasakla** butonunu kullanarak o an aktif olan argüman setini yasaklayabilirsiniz. Bu sayede sonraki taramada bu argüman seti atlanacak ve sonraki argüman setleri denenecektir.

### **Herhangi Bir Sebeple Sayfanın Takılı Kalması Durumunda**
Ayarlardaki Hakkında ve Güncelleme bölümünde bulunan **Tüm Ayarları Sıfırla** butonunu kullanarak programı en baştaki haline getirebilirsiniz.

---

## Özellikler

- **Discord'a görsel ve işlevsel olarak birebir yakın bir arayüz.** Kendi özel başlık çubuğu, bildirimleri, tepsi simgesi ve ekran paylaşımı seçicisiyle resmi masaüstü istemcisinin yerini alabilecek şekilde tasarlanmıştır.
- **Dört DPI aşım motoru, tek uygulama:** Zapret (sistem geneli, WinDivert tabanlı — Otomatik modun giriş noktasıdır), Zapret2 (sistem geneli, WinDivert tabanlı — blockcheck2 ile otomatik strateji keşfi yapar), ByeDPI (yalnızca bu uygulamanın trafiğini kapsayan yerel proxy) ve GoodbyeDPI (sistem geneli, WinDivert tabanlı). Otomatik modda motorlar sırayla denenir, çalışan ilk ayar kaydedilip kullanılır.
- **Otomatik ve Manuel mod.** Otomatik modda uygulama sizin için en uygun motoru ve stratejiyi bulur; Manuel modda hangi motorun, hangi parametrelerle çalışacağını kendiniz seçebilirsiniz.
- **Dışlamalar (hostlist) yönetimi.** Zapret ve Zapret2 sistem geneli çalışırken, DPI aşım tekniğinin (fake paket/parçalama vb.) hiç uygulanmayacağı domainleri (ve alt alan adlarını) DPI Aşımı > Dışlamalar penceresinden yönetebilirsiniz — kendi domaininizi ekleyip kaldırabilir, listeyi manuel olarak da düzenleyebilirsiniz. Liste, SplitCord-Turkey'in resmi deposundaki güncel listeyle otomatik (belirlediğiniz aralıkta) ya da "Şimdi Güncelle" butonuyla elle senkronize edilir; sizin eklediğiniz domainler bu güncellemeyle asla silinmez.
- **Şifreli DNS desteği (DoH/DNSCrypt, isteğe bağlı DoT/DoQ).** DNS seviyesinde yaşanan engellemelere karşı Zapret/Zapret2/ByeDPI, DoH → DNSCrypt → DNS'siz sırasıyla otomatik olarak dener (DoT/DoQ sabit 853 portunda çalıştığı ve birçok ISP tarafından protokole bakılmaksızın toptan engellendiği için otomatik sıradan çıkarıldı, Manuel moddan hâlâ elle sabitlenebilir); DoH sağlayıcıları arasında, diğerlerinin tamamı engellendiğinde devreye giren bir NextDNS yedeği de bulunur. Sağlayıcıları Ayarlar ekranından kendiniz de özelleştirebilirsiniz.
- **Sesli kanal desteği.** ByeDPI'nin kapsayamadığı WebRTC/UDP trafiği için, ByeDPI aktifken arka planda otomatik olarak devreye giren bir Zapret UDP eşlik süreci bulunur.
- **Global Klavye Kısayolları.** Mikrofonu sustur/aç, sağırlaştır, bağlantıyı kes, kamerayı aç/kapat, ekran paylaşımını aç/kapat, pencereyi öne al, tepsiye küçült/geri al, sohbette ileri/geri git ve Bas-Konuş/Susturmak İçin Bas — hepsi uygulama arka planda ya da odak dışındayken bile çalışır; Discord'un kendi (yalnızca sekme ön plandayken çalışan) Bas-Konuş özelliğinin yerini alır.
- **Performans Modu.** Pencere odak dışındayken bazı arkaplan işlemlerinin sıklığını azaltarak tam ekran oyunlarda yaşanabilecek FPS düşüşünü engeller.
- **Discord Rich Presence desteği.** Resmi olmayan istemcilerde normalde çalışmayan bu özellik, [arRPC](https://github.com/OpenAsar/arrpc) tabanlı yerel bir RPC sunucusu ile desteklenir.
- **İzinler ve Kontroller ekranı.** Güvenlik duvarı izinlerini, çakışabilecek güvenlik yazılımlarını (Kaspersky, ESET) ve elle kurulmuş harici DPI süreçlerini/hizmetlerini tespit edip yönetmenizi sağlar.
- **Kalıcı arka plan hizmeti.** DPI aşımı, SYSTEM yetkisiyle çalışan ayrı bir Windows hizmeti üzerinden yürütülür; Discord penceresini kapatsanız da bağlantı kesilmez, sistem açılışında otomatik başlar.
- **Birleşik tanılama günlüğü.** Programın ve hizmetin yaptığı her şey, sorun bildirirken paylaşabileceğiniz tek bir dosyada (en fazla 50 MB) tutulur; Hakkında ve Güncelleme ekranından tek tıkla açılabilir.
- **Ekran paylaşımı seçicisi.** Kalite, FPS ve sistem sesi paylaşımını tek pencereden ayarlayabileceğiniz özel bir ekran/pencere paylaşım aracı içerir.
- **Tema desteği.** Discord'un o anki temasından otomatik renk örnekleme veya sabit tema ön ayarları arasında seçim yapabilirsiniz.
- **Kolay kaldırma.** Windows'un dahili program ekleme ve kaldırma menülerinden SplitCord-Turkey'i kolaylıkla kaldırabilirsiniz; kaldırma işlemi hizmeti, tüm DPI aşım süreçlerini ve WinDivert sürücü kayıtlarını da tam olarak temizler.
- **Kendi kendine kurtarma.** Discord uzun süre bağlanamadığında, Discord'un kendi yükleme ekranında beliren bir butonla mevcut ayarı yasaklayıp Otomatik moddan sıfırdan bir tarama başlatabilirsiniz.
- **Program içinden davet bağlantısı açma.** Discord davet bağlantılarını programın başlık çubuğunda bulunan "+" butonu ile kullanarak davetleri sistem geneli aşım olmayan durumlarda kolayca açabilirsiniz.
- **İsteğe bağlı Vencord entegrasyonu.** Ayarlar > Vencord'dan, Discord'a özel tema ve eklenti (plugin) desteği ekleyen [Vencord](https://github.com/Vendicated/Vencord)'u etkinleştirebilirsiniz. Discord'un Hizmet Şartları üçüncü taraf istemci değişikliklerini yasaklayabildiği için etkinleştirme/devre dışı bırakma öncesi net bir risk uyarısıyla onay istenir (sesli sohbetteyken uygulanırsa bağlantınızın kısa süreliğine kesilebileceği de ayrıca belirtilir). Vencord'un kendi ayarlarını Discord'un Kullanıcı Ayarları içinden açan bir kısayol da eklenir. Vencord'un QuickCSS düzenleyicisi ve Bulut Entegrasyonu gibi bazı özellikleri bizim mimarimizde desteklenmez; bunlara erişmeye çalıştığınızda bunu belirten bir bilgi kutusu gösterilir.

---

## Nasıl Çalışır

SplitCord-Turkey her platformda iki ayrı bileşenden oluşur: arka planda çalışan bir **DPI aşım hizmeti** ve Discord'u saran, hiçbir zaman yükseltilmiş yetkiyle çalışmayan bir **Electron istemcisi**. İstemci, motor seçimi ve durumu için yerel bir REST API (`127.0.0.1` üzerinde) üzerinden hizmetle konuşur; kendi başına yetkilendirme yapmaz ve hizmet düzeyinde çalışmaz.

Her iki platformda da Chromium'un yerleşik **ECH (Encrypted Client Hello)** desteği etkinleştirilir — bu, TLS ClientHello'daki SNI (hangi siteye bağlanıldığı) bilgisini şifreleyerek DPI'nin yalnızca SNI'ye bakarak engellemesini zorlaştıran ek bir katmandır. Discord/Cloudflare tarafında gerçek bir ECH config yayınlanmıyorsa bağlantı hiç bozulmadan, sessizce eski (ECH'siz) TLS'e düşer.

### Windows

**SplitCordDpiService**, SYSTEM yetkisiyle arka planda çalışan bir Windows Service'tir. Zapret, Zapret2, ByeDPI ve GoodbyeDPI süreçlerini yönetir. Kurulum sırasında yalnızca **bir kez** yönetici izni ister; sonrasında hiçbir zaman tekrar UAC istemi çıkmaz. Bu hizmet yalnızca SplitCord-Turkey çalışırken işlevini sürdürür.

ByeDPI aktifken yalnızca bu uygulamanın trafiği, kendi başlattığı bir SOCKS5 proxy üzerinden yönlendirilir (sisteminizin geri kalanı etkilenmez). Zapret, Zapret2 ve GoodbyeDPI ise **WinDivert** sürücüsü ile sistem genelinde çalışır; bu üç motordan aynı anda yalnızca biri aktif olabilir.

Otomatik modun giriş noktası **Zapret**'tir: önceden bilinen, hızlıca denenen sabit bir strateji listesi kullanır. Zapret tükenirse sırasıyla **Zapret2** (bol-van/zapret2 projesinin resmi keşif aracı olan **blockcheck2**'yi kullanarak discord.com için gerçekten çalışan bir strateji arar, hem metin/TLS hem de sesli (UDP/STUN) bağlantıyı doğrular — sabit listeye kıyasla çok daha kapsamlı ama daha uzun sürebilir), ByeDPI ve GoodbyeDPI denenir.

### Linux

Arka plan hizmeti bir **systemd birimi** olarak çalışır. Motor seti Windows'tan biraz farklıdır: WinDivert yerine **NFQUEUE/iptables** kullanılır, GoodbyeDPI'nin Linux'a özgü bir karşılığı olmadığı için bulunmaz.

ByeDPI, Windows'takiyle aynı şekilde yalnızca bu uygulamanın trafiğini kapsayan yerel bir SOCKS5 proxy'sidir. Zapret ve Zapret2 ise NFQUEUE/iptables kuralları ile sistem genelinde çalışır; bu iki motordan aynı anda yalnızca biri aktif olabilir.

Otomatik modun motor sırası **Zapret → Zapret2 → ByeDPI**'dir — mantık Windows ile birebir aynıdır (Zapret sabit strateji listesiyle başlar, tükenirse Zapret2'nin blockcheck2 taraması, o da tükenirse ByeDPI devreye girer), yalnızca GoodbyeDPI adımı eksiktir. AppImage sürümünde ayrıca bir bağımlılık kontrolü katmanı bulunur (bkz. [AppImage kullanım rehberi](resources/APPIMAGE.md)).

---

## Ayarlar Ekranları

- **DPI Aşımı:** Otomatik/Manuel mod seçimi, motor kartları, gelişmiş argüman düzenleme, DNS protokolü sırası ve sağlayıcıları, Zapret2 blockcheck2 tarama zamanaşımı, yeniden arama başlatma, reddedilen ayar listeleri ve (Zapret/Zapret2 aktifken görünen) Dışlamalar penceresi — DPI aşımından muaf tutulacak domainleri ekleme/kaldırma, manuel liste düzenleme ve otomatik/elle güncelleme.
- **İzinler ve Kontroller:** Güvenlik duvarı izinleri, resmi Discord uygulamasıyla çakışma kontrolü, Kaspersky/ESET tespiti, çakışabilecek hizmetlerin ve harici DPI süreçlerinin listesi ile ses bağlantısı kontrolleri.
- **Genel:** Otomatik başlatma, bildirim rozeti, performans modu, bağlantıları sistem tarayıcısında açma, yazım denetimi vurgusunu kapatma, QUIC'i devre dışı bırakma ve benzeri genel tercihler.
- **Görünüm:** Discord temasından otomatik renk örnekleme veya sabit tema ön ayarları.
- **Tuş Atamaları:** Bas-Konuş, Susturmak İçin Bas, mikrofon sustur/aç, sağırlaştır, bağlantıyı kes, kamerayı aç/kapat, ekran paylaşımını aç/kapat, pencereyi öne al, tepsiye küçült/geri al ve sohbette ileri/geri git için genel (uygulama arka plandayken de çalışan) kısayollar.
- **Vencord:** Vencord'u onaylı şekilde etkinleştirme/devre dışı bırakma, Vencord'un kendi ayarlarını açma, durum ve sürüm bilgisi.
- **Hakkında ve Güncelleme:** Sürüm bilgisi, güncelleme kontrolü, tanılama günlüğü dosya konumunu açma ve tüm ayarları sıfırlama.

---

## Önemli Notlar

> [!NOTE]
> **WinDivert** dosyalarının kullanımı Kaspersky ve ESET gibi bazı antivirüs yazılımları tarafından engellenebiliyor. Bu durumda Zapret, Zapret2 ve GoodbyeDPI motorları hiç denenmeden otomatik olarak atlanıp doğrudan ByeDPI'ye yönlendirilir; İzinler ve Kontroller ekranından bu tespiti görebilir, ana ekranda çıkan uyarı penceresinden de bilgi alabilirsiniz. ESET ve Kaspersky isimli antivirüs yazılımları sisteminizde kurulu ise sesli kanallara bağlanmada ve arama yapmada sorunlar yaşayabilirsiniz. Kaspersky ve ESET hakkında daha fazla bilgi için [bu sayfayı](https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md) ziyaret edebilirsiniz.

> [!NOTE]
> ByeDPI tek başına yalnızca metin/HTTPS trafiğini kapsar; WebRTC üzerinden yürüyen sesli kanal trafiğini kapsayamaz. Bu yüzden ByeDPI devrede olduğunda, sese destek olması için arka planda ayrıca yalnızca UDP portlarını hedefleyen bağımsız bir Zapret süreci de otomatik olarak devreye alınır. Yukarıda da belirtildiği üzere Kaspersky ve ESET'in varlığı halinde Zapret devreye alınamayacağından ses bağlantılarında sorun yaşayabilirsiniz hatta hiç katılamayabilirsiniz. Bunu engellemek için Kaspersky veya ESET'i sisteminizden kaldırabilir ya da bu antivirüs yazılımları içerisinde SplitCord-Turkey klasörünü bir istisna/dışlama olarak ekleyip SplitCord-Turkey'i tekrar kurarak sorunun çözülüp çözülmediğini test edebilirsiniz.

> [!IMPORTANT]
> Discord Rich Presence desteği, Discord'un web JS paketindeki dahili modülleri sabit imzalara göre bulan bir köprü script'ine dayanır. Discord kendi web paketini güncellediğinde bu köprü geçici olarak bozulabilir; böyle bir durumda yalnızca Rich Presence etkilenir, uygulamanın geri kalanı sorunsuz çalışmaya devam eder.

> [!WARNING]
> **Vencord** varsayılan olarak KAPALIDIR ve DPI aşımından tamamen ayrı bir risk taşır: Discord'un Hizmet Şartları üçüncü taraf istemci değişikliklerini yasaklayabiliyor. Etkinleştirmeden önce uygulama içinde bu risk açıkça belirtilir ve onayınız istenir — etkinleştirmek tamamen isteğe bağlıdır ve sorumluluk kullanıcıya aittir. Sorun çıkarabileceği düşünülen bazı Vencord eklentileri varsayılan olarak devre dışı bırakılmıştır.

---

## Windows İçin Derleme

SplitCord-Turkey, kaynak koddan da derlenerek çalıştırılabilir.

### Gereksinimler

- **.NET 8.0 SDK** veya üzeri
- **Node.js 22.12** veya üzeri (Electron 44'ün gerektirdiği minimum sürüm)
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

## Linux İçin Derleme

Linux sürümü de aynı şekilde kaynak koddan derlenebilir; kaynak dosyalar `linux/` alt klasöründedir.

### Gereksinimler

- **.NET 8.0 SDK** veya üzeri
- **Node.js 22.12** veya üzeri (Electron 44'ün gerektirdiği minimum sürüm)
- Debian/Ubuntu tabanlı bir dağıtım (Linux Mint dahil)
- Derleme bağımlılıkları: `build-essential`, `libnetfilter-queue-dev`, `libnfnetlink-dev`, `libmnl-dev`, `libcap-dev`, `libsystemd-dev`, `zlib1g-dev`, `libluajit-5.1-dev`

### Derleme Adımları

1. **Bağımlılıkları yükleyin**
   ```bash
   cd linux/client
   npm install
   ```

2. **DPI araçlarının ikili dosyalarını indirip derleyin** (zapret/zapret2/ByeDPI kaynaktan derlenir, birkaç dakika sürebilir)
   ```bash
   node ../scripts/fetch-binaries.js
   ```

3. **Paketleri oluşturun** (bu adım, .NET servisini de otomatik olarak derler; hem `.deb` hem AppImage aynı anda üretilir)
   ```bash
   npm run dist
   ```

4. Oluşan `linux/client/dist/SplitCord-Turkey-Linux-*.deb` dosyasını `sudo dpkg -i` ile kurun.

### AppImage Derleme

Yukarıdaki `npm run dist` komutu, Debian/Ubuntu tabanlı olmayan dağıtımlar (Arch, Fedora, openSUSE gibi) için `linux/client/dist/SplitCord-Turkey-Linux-*.AppImage` dosyasını da **aynı anda ve ek bir komuta gerek olmadan** üretir — çıktı, kaynak koddan derleme yapılan **gerçek bir Linux makinesinde** oluşturulmalıdır (electron-builder, AppImage'ı paketlemek için gerekli `mksquashfs` gibi Linux'a özgü araçları kendi içinde indirir, bu yüzden Windows'tan çapraz derleme yapılamaz).

AppImage'ın kurulum gerektirmeyen yapısı, bağımlılık kontrolleri ve dağıtıma özgü notlar için [AppImage kullanım rehberine](resources/APPIMAGE.md) bakabilirsiniz.

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
- **[Vencord](https://github.com/Vendicated/Vencord)** by **[Vendicated](https://github.com/Vendicated)**
- **[Electron](https://github.com/electron/electron)**

---
## Özel Teşekkürler
- Yazılımın geliştirilmesine katkıda bulunan **[Techolay.net](https://techolay.net/sosyal/)** kurucusu **[Recep Baltaş](https://www.youtube.com/@Techolay/)**'a çok teşekkür ederim.

### Test Edenler:
- [git-phan](https://github.com/git-phan) - Debugging
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
