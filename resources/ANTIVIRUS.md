# Antivirüs Yazılımları ve WinDivert Çakışması

SplitCord-Turkey'deki **Zapret2**, **Zapret** ve **GoodbyeDPI** motorları, Windows'ta ağ paketlerini müdahale etmek için [WinDivert](https://github.com/basil00/WinDivert) adlı açık kaynaklı bir sürücü kullanır. Bazı antivirüs yazılımları, WinDivert'i (veya onu kullanan araçları) "risk aracı" olarak sınıflandırıp engelliyor — bu durumda SplitCord-Turkey bu üç motoru hiç denemeden otomatik olarak atlayıp **ByeDPI**'ye yönlendirir (İzinler ve Kontroller ekranından bu tespiti görebilir, ana ekranda çıkan uyarı penceresinden de bilgi alabilirsiniz).

---

## Neden engelleniyor

WinDivert, Windows işletim sisteminde ağ paketlerini okuyup değiştirmeye yarayan, açık kaynaklı, meşru bir kütüphanedir. Bu tür düşük seviyeli ağ müdahalesi yapabilen araçlar (proxy yazılımları, güvenlik duvarları, ağ izleme araçları dahil), kötüye kullanılabilme potansiyelleri nedeniyle bazı antivirüs motorları tarafından **"not-a-virus:HEUR:RiskTool"** gibi bir kategoriyle işaretlenir. Bu bir virüs tespiti DEĞİLDİR — yazılımın kendisinin kötü amaçlı olduğu anlamına gelmez, yalnızca "bu tür bir araç kötüye kullanılabilir" uyarısıdır.

Kaspersky ve ESET gibi bazı antivirüs yazılımları, bu sınıflandırmayı kullanarak WinDivert'i etkin bir şekilde bloke eder ve bu üç motorun (Zapret2, Zapret, GoodbyeDPI) çalışmasını engeller. Rus hükümetinin internet özgürlüğü kısıtlamalarına yönelik baskıları nedeniyle Kaspersky'nin bu tür DPI aşım araçlarına karşı özellikle daha temkinli/agresif davrandığı biliniyor; bu, WinDivert'in veya SplitCord-Turkey'in kötü amaçlı olduğu anlamına gelmiyor.

---

## Ses Bağlantıları Neden Çalışmayacak (zorunlu)

> [!WARNING]
> Kaspersky veya ESET kaldırılmadığı ya da istisnalara eklenmediği sürece **sesli kanallara hiç katılamazsınız / sesli kanal bağlantılarınız çalışmaz.** Bu, isteğe bağlı bir iyileştirme değil, sesli konuşmanın çalışabilmesi için zorunlu bir gerekliliktir.

ByeDPI yalnızca metin/HTTPS trafiğini (Discord'un web arayüzünün kendisi dahil) kapsayan bir SOCKS5 proxy'sidir; sesli kanallarda kullanılan WebRTC/UDP trafiğini kapsayamaz. Bu yüzden ByeDPI aktifken, sese destek olması için arka planda otomatik olarak yalnızca UDP portlarını hedefleyen ayrı, küçük bir **Zapret** süreci de devreye alınır — ve bu yardımcı süreç de tıpkı GoodbyeDPI/Zapret motorları gibi WinDivert'e bağımlıdır.

Kaspersky veya ESET, WinDivert'i engellediğinde bu ses yardımcı süreci de **hiç başlatılamaz**. Bu durumda:

- Discord'un metin tarafı (mesajlaşma, sunucular, DM'ler) ByeDPI sayesinde normal şekilde çalışmaya devam eder.
- Ancak sesli bir kanala katılmaya çalıştığınızda bağlantı kurulamaz veya sürekli kopar.

Metin trafiğinin aksine sesli bağlantı için WinDivert'siz bir alternatif **yoktur** — bu yüzden sesli kanalları kullanabilmek için aşağıdaki "Ne yapabilirsiniz" bölümündeki **Seçenek 2** (istisna tanımlama) veya **Seçenek 3**'ü (antivirüsü kaldırma) uygulamanız zorunludur; Seçenek 1 (yalnızca ByeDPI) ses için yeterli değildir.

---

## VirusTotal Sonuçları ve SmartScreen Uyarısı

SplitCord-Turkey tamamen açık kaynak kodludur; tüm kaynak kod [GitHub deposundan](https://github.com/cagritaskn/SplitCord-Turkey) incelenebilir, tercih edilirse kendiniz de derleyebilirsiniz. Programı kullanmak istemeyen ve güvenmeyen kullanıcılar programı kullanmak zorunda değildir, kullanmak tamamen sizin inisiyatifinizdedir.

> [!NOTE]
> **[SplitCord-Turkey 0.9.5 kurulum dosyası VirusTotal sonuçları](VIRUSTOTAL_LINK_BURAYA)** — bu tespitlerin sebebi de yukarıda anlatılan WinDivert sınıflandırmasıdır; kurulum dosyasının kendisi arka planda çalışacak bir Windows Service kaydettiği ve sistem üzerinde değişiklik yaptığı için bazı az kullanılan, güvenilirliği düşük antivirüs motorları tarafından hatalı (false positive) olarak işaretlenebilir.

> [!NOTE]
> **SmartScreen "Windows kişisel bilgisayarınızı korudu"** uyarısı, imzalanmamış yazılımların tamamında çalıştırmadan önce görünür. Bunun sebebi, yazılımların uluslararası kod imzalama sertifikasına tabi olma zorunluluğudur. Ancak bu imzalama işlemi döviz kuru üzerinden düzenli ödeme gerektirdiğinden ve bağımsız, gelir elde etmeyen bir geliştirici tarafından hazırlandığından dolayı yazılım imzalanamıyor.

> [!IMPORTANT]
> İndirme yapacağınız her zaman önce adres çubuğuna bakıp URL'ye dikkat edin. SplitCord-Turkey'i yalnızca **[resmi GitHub reposundan](https://github.com/cagritaskn/SplitCord-Turkey)** veya doğrudan **[en güncel kurulum dosyasından](https://github.com/cagritaskn/SplitCord-Turkey/releases/download/0.9.5/SplitCord-Turkey-Setup-0.9.5.exe)** indirip kullanın.

---

## Ne yapabilirsiniz

### Seçenek 1 — ByeDPI ile devam edin (yalnızca metin/mesajlaşma için yeterli)

SplitCord-Turkey, Kaspersky veya ESET tespit ettiğinde otomatik olarak **ByeDPI**'yi kullanır. ByeDPI, WinDivert kullanmayan, yalnızca bu uygulamanın kendi trafiğini kapsayan bir yerel proxy olduğu için antivirüs yazılımlarıyla çakışmaz ve admin yetkisi de gerektirmez. Discord'u yalnızca mesajlaşmak için kullanan kullanıcılar için ek bir işlem yapmadan bu yeterlidir.

> [!NOTE]
> Bu seçenek **sesli kanalları çalıştırmaz** (yukarıdaki "Ses Bağlantıları Neden Çalışmayacak" bölümüne bakın). Sesli kanalları kullanmak istiyorsanız Seçenek 2 veya Seçenek 3'ü uygulamanız gerekir.

### Seçenek 2 — Antivirüs yazılımınıza istisna tanımlayın

Kaspersky/ESET'in kendi ayarlarından, SplitCord-Turkey'in kurulu olduğu **klasörün tamamına** istisna tanımlayarak Zapret2, Zapret ve GoodbyeDPI'yi de kullanabilirsiniz. Varsayılan kurulum yolu:

- `C:\Program Files\SplitCord-Turkey\`

Kurulum sırasında farklı bir klasör seçtiyseniz, istisnayı o klasör için tanımlamanız gerekir.

İstisna nasıl tanımlanır:

- **Kaspersky:** [İstisna klasörü oluşturma rehberi](https://defkey.com/tr/2023/08/25/kaspersky-anti-virus-istisna-olusturma)
- **ESET:** [İstisna klasörü oluşturma rehberi](https://help.eset.com/elga/tr-TR/exclusion.html)

> [!IMPORTANT]
> İstisnaları tanımladıktan sonra yalnızca uygulamayı yeniden başlatmak yeterli DEĞİLDİR — antivirüs yazılımı, istisna tanımlanmadan ÖNCE karantinaya aldığı veya sildiği dosyaları geri getirmediği için **SplitCord-Turkey'i istisna ekledikten sonra tekrar kurmanız (yeniden yüklemeniz) gerekir.**

### Seçenek 3 — Antivirüs yazılımını kaldırın

Kaspersky/ESET'i sisteminizden tamamen kaldırırsanız, Zapret2, Zapret ve GoodbyeDPI motorları hiçbir kısıtlama olmadan çalışır. Yazılımları kaldırdıktan sonra kurulumu tekrar gerçekleştirmeniz gerekebilir.

---

## Bu WinDivert'in güvenilir olmadığı anlamına mı geliyor

Hayır. WinDivert açık kaynaklıdır ve kaynak kodu [buradan](https://github.com/basil00/WinDivert) incelenebilir. GoodbyeDPI, Zapret ve Zapret2 de açık kaynaklıdır — SplitCord-Turkey'in [kaynak kodundan](https://github.com/cagritaskn/SplitCord-Turkey) bu araçları nasıl çalıştırdığımızı görebilirsiniz. "Risk aracı" sınıflandırması, aracın YAPABİLECEKLERİ hakkında genel bir uyarıdır, bu projenin veya WinDivert'in kötü amaçlı olduğu anlamına gelmez.
