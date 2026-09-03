using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using SplitCord.Service.Config;
using SplitCord.Service.Dns;

namespace SplitCord.Service.Engines;

/// <summary>
/// Otomatik modun yeni giriş noktası: bol-van/zapret2'nin Windows portu (winws2.exe).
/// ZapretEngine'in aksine sabit/elle yazılmış bir aday listesi kullanmıyor — Zapret2'nin
/// kendi resmi keşif aracı olan blockcheck2'yi (bkz. bol-van/zapret-win-bundle,
/// resources/bin/zapret2/blockcheck2/blockcheck2.sh) BATCH=1 ile programatik olarak
/// çalıştırıp discord.com için gerçekten çalışan bir winws2 stratejisi arıyor. blockcheck2
/// yalnızca TCP/TLS/HTTP3 test ediyor (UDP/ses'e hiç dokunmuyor) — bu yüzden bulunan
/// strateji ile winws2 başlatıldıktan sonra ayrıca bir STUN Binding Request/Response
/// (RFC 5389) ile ham UDP'nin bu strateji altında gerçekten dışarı çıkıp çıkamadığı da
/// test ediliyor (bkz. VerifyVoiceAsync). blockcheck2 hiç strateji bulamazsa (ya da bulduğu
/// hiçbiri gerçek discord.com bağlantısında doğrulanamazsa) AllCandidatesFailedException
/// fırlatılır — DpiEngineManager bunu yakalayıp zincirdeki bir sonraki motora (Zapret →
/// ByeDPI → GoodbyeDPI) otomatik eskalasyon yapar.
/// </summary>
public sealed class Zapret2Engine : IDpiEngine, IDnsTierAware
{
    private const string ConnectivityProbeUrl = "https://discord.com/app";

    // blockcheck2'nin "quick" taramasındaki temel HTTP grubu (standard/10-http-basic.sh,
    // curl_test_http fonksiyonu — script kaynağından doğrulandı) YALNIZCA düz HTTP (port 80)
    // trafiğini test ediyor; bulduğu adayın WinDivert filtresi de bu yüzden yalnızca
    // "--wf-tcp-out=80" oluyor, 443'e (HTTPS) hiç dokunmuyor — erken durdurma mekanizmamız
    // (bkz. RunBlockcheck2Async'teki earlyStopCts) ilk "AVAILABLE" sinyalinde durduğu için
    // aynı adayın 443/HTTPS için de geçerli olup olmadığını hiç öğrenmiyoruz. Kayıtlı ayarı
    // yeniden doğrularken (TryCandidateAsync, skipHttpConnectivityCheck=false) sabit olarak
    // https://discord.com/app (443) test ediyorduk — stratejinin ETKİ ETMEDİĞİ bir portu
    // test etmek demekti. Canlı testte doğrulandı: bu yüzden "kayıtlı ayar" hızlı yolu
    // HER ZAMAN (20/20) başarısız oluyordu, oysa AYNI strateji gerçek Discord webview'inde
    // (443/HTTPS) sorunsuz çalışıyordu — muhtemelen bu ağda asıl engel DNS seviyesinde olup
    // DoH ile zaten aşıldığından, 443 bu stratejiye hiç ihtiyaç duymadan geçebiliyor.
    // Adayın GERÇEKTEN filtrelediği porta göre doğru test URL'ini seçiyoruz.
    private static readonly Regex WfTcpOutRegex = new(@"--wf-tcp-out=(?<ports>\S+)", RegexOptions.Compiled);

    private static string BuildConnectivityProbeUrl(string candidate)
    {
        var match = WfTcpOutRegex.Match(candidate);
        if (match.Success)
        {
            var ports = match.Groups["ports"].Value.Split(',', StringSplitOptions.RemoveEmptyEntries);
            if (ports.Contains("80") && !ports.Contains("443"))
            {
                return "http://discord.com/app";
            }
        }
        return ConnectivityProbeUrl;
    }

    // WinDivert sürücüsünün paket filtrelemeye gerçekten başlaması için winws2.exe
    // başlatıldıktan sonra kısa bir bekleme (ZapretEngine/GoodbyeDpiEngine ile aynı yaklaşım).
    private static readonly TimeSpan DriverAttachDelay = TimeSpan.FromSeconds(1.5);

    // İlk açılışta kayıtlı ayarın tek bir geçici aksaklık yüzünden boşa harcanmaması için:
    // blockcheck2 taramasına düşmeden önce kaç kez GERÇEKTEN (spawn + test) denenir. Diğer
    // motorlardan (SavedArgsRetryAttempts=3) daha yüksek: Zapret2'nin (winws2.exe + WinDivert)
    // ilk oturması diğerlerine göre biraz daha uzun sürebiliyor. Canlı testte doğrulandı: bu
    // strateji genelde ilk birkaç denemede WinDivert'in henüz tam oturmamış olması yüzünden
    // "SSL connection could not be established" ile başarısız olup (ExitCode=-1 — bkz.
    // TryCandidateAsync'teki StopAsync çağrısı, winws2.exe'nin kendisi çökmüyor, biz
    // durduruyoruz) sonraki denemelerde çalışıyor — kullanıcı talebiyle 6'dan 20'ye çıkarıldı.
    private const int SavedArgsRetryAttempts = 20;

    // blockcheck2'nin kendisi (bkz. blockcheck2.sh dokümantasyonu/kaynağı) yalnızca TCP/TLS/
    // HTTP3 engellemesini test ediyor, UDP/ses için hiçbir doğrulama yapmıyor. Discord'un
    // GERÇEK ses/RTP medya sunucuları oturuma özel, bölgeye göre atanan ve her görüşmede
    // değişen sunucular olduğu için sabit bir "Discord STUN sunucusu" hostname'i bulup
    // hardcode etmek pratik bir çözüm değil (hangi sunucuyu seçersek seçelim, gerçek bir
    // görüşmenin kullanacağı sunucudan farklı olacak). Buradaki asıl soru zaten "bu winws2
    // stratejisi altında ham UDP dışarı çıkıp gerçek bir yanıt alabiliyor mu" — bunun için
    // herkese açık, her zaman ayakta genel bir STUN sunucusu teşhis gücü açısından eşdeğer.
    private static readonly (string Host, int Port)[] StunProbeTargets =
    {
        ("stun.l.google.com", 19302),
        ("stun1.l.google.com", 19302),
    };

    private static readonly Regex WorkingStrategyRegex = new(
        @"!!!!!\s+\S+:\s+working strategy found for ipv\d+\s+(?<domain>\S+)\s*:\s*(?<daemon>\S+)\s+(?<strategy>.+?)\s*!!!!!",
        RegexOptions.Compiled);

    // blockcheck2, "working strategy found" özet satırını yalnızca bir test GRUBUNU tamamen
    // bitirdikten SONRA yazıyor — ama her TEK denemenin sonucunu (aday + AVAILABLE/UNAVAILABLE)
    // çok daha erken, iki ayrı satır hâlinde basıyor:
    //   "- curl_test_http ipv4 discord.com : winws2 <strateji argümanları>"
    //   "!!!!! AVAILABLE !!!!!"  (ya da "curl: (NN) ..." + "UNAVAILABLE code=NN")
    // Canlı testte doğrulandı: bu ilk AVAILABLE'a kadar dakikalarca sürebilen aynı grup
    // içinde onlarca varyasyon daha deneniyor — yalnızca özet satırını beklemek, çoktan
    // AVAILABLE çıkmış bir adayı kaçırıp taramayı gereksiz uzatıyordu (kullanıcı bunu canlı
    // testte gözlemledi: AVAILABLE loglandığı hâlde blockcheck2 durmadan devam etti). Bu
    // yüzden aday satırını (aşağıdaki regex) bir sonraki AVAILABLE ile eşleştirip AYNI erken-
    // durdurma mekanizmasını (earlyStopCts) çok daha erken tetikliyoruz.
    private static readonly Regex CandidateLineRegex = new(
        @"^-\s+curl_test\S*\s+ipv\d+\s+\S+\s*:\s*winws2\s+(?<strategy>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex AvailableLineRegex = new(@"^!+\s*AVAILABLE\s*!+$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // blockcheck2, "standard" test dizinindeki tüm yöntemleri (HTTP/HTTPS/QUIC, birden çok
    // desync varyasyonu) sırayla dener — tek bir alan adı için bile birkaç dakika sürebilir.
    // Client tarafındaki LONG_RUNNING_TIMEOUT_MS (20dk) ile tutarlı bir üst sınır.
    private static readonly TimeSpan BlockcheckTimeout = TimeSpan.FromMinutes(20);

    private readonly SettingsStore _settings;
    private readonly ILogger<Zapret2Engine> _logger;
    private readonly LogRingBuffer _logs = new(200);
    private Process? _process;
    // blockcheck2'yi çalıştıran bash.exe süreci — winws2 aday süreci (_process) ile AYNI
    // anda ikisi birden var olmaz (biri keşif aşamasında, diğeri doğrulama aşamasında
    // kullanılıyor), ama StopAsync'in her ikisini de bilmesi/öldürebilmesi gerekiyor
    // (bkz. RunBlockcheck2Async'teki not).
    private Process? _blockcheckProcess;
    private bool _lastProbeFailed;

    // Kayıtlı ayar hızlı yolunun (bkz. StartAsync üstü) hangi denemede olduğu — GetStatus()
    // bunu "Kayıtlı ayar deneniyor (N/M)" olarak Detail'e yansıtıyor ki istemci tarafı bu
    // aşamada motor an be an durup kalkarken (her deneme kendi winws2.exe'sini spawn edip
    // öldürüyor) kullanıcıya yanlışlıkla "Durduruldu" göstermesin (kullanıcı talebi). 0 =
    // şu an bu aşamada değil.
    private volatile int _savedArgsAttempt;

    public string Id => "zapret2";
    public string DisplayName => "Zapret2";
    public bool RequiresSystemWideAccess => true;

    /// <summary>DpiEngineManager.SwitchToAsync, hedefe StartAsync çağırmadan hemen önce bunu
    /// allowEscalation'a göre ayarlıyor (true=Otomatik giriş noktası → false, yani
    /// IsManualActivation=false; false=Manuel açık seçim → IsManualActivation=true) — bkz.
    /// oradaki OfType&lt;Zapret2Engine&gt;() deseni. DNS protokol tier döngüsünün (bkz.
    /// Dns/DnsProtocolTiers.cs) tier başına üst sınırını belirlemek için kullanılıyor: Manuel'de
    /// blockcheck2 kullanılırken 10dk, Otomatik'te 5dk (kullanıcı talebi).</summary>
    public bool IsManualActivation { get; set; }

    public Zapret2Engine(SettingsStore settings, ILogger<Zapret2Engine> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false }) return;

        _lastProbeFailed = false;

        var rejected = _settings.Current.Zapret2RejectedArgs;

        // Yalnızca BU StartAsync çağrısı boyunca yaşayan bir hafıza: blockcheck2 SCANLEVEL=quick +
        // erken-durdurma sayesinde deterministik çalışıyor -- aynı ağ koşullarında hep AYNI
        // ilk-uygun adayı buluyor. Bir aday gerçek doğrulamada (TestConnectivityAsync ya da
        // "doğrulama sırasında beklenmedik durdu") başarısız olduğunda, blockcheck2'yi tekrar
        // baştan çalıştırdığımızda YİNE aynı adayı bulup üst sınırın (5-15dk) TAMAMINI bu TEK
        // adayı boşuna denemekle harcıyorduk (canlı testte doğrulandı: aynı aday ~16 saniyede bir
        // art arda 10+ kez denenip her seferinde aynı şekilde başarısız oldu). RunBlockcheck2Async'in
        // erken-durdurma mekanizması bu sette olan bir adayı görürse DURMUYOR, blockcheck2'nin bir
        // SONRAKİ (test dosyasındaki farklı bir) adaya geçmesine izin veriyor.
        //
        // KULLANICI TALEBİ (bu turda bulunan ayrı bir loop bugı): kalıcı olarak reddedilmiş
        // (Zapret2RejectedArgs) bir argüman seti blockcheck2'nin bulduğu İLK aday olduğunda, eskiden
        // bu liste burada DEĞİL, yalnızca aşağıdaki foreach içinde (candidate doğrulamaya hiç
        // girmeden "rejected.Contains" ile) kontrol ediliyordu -- ama RunBlockcheck2Async'in erken
        // durdurma mekanizması bunu BİLMEDİĞİ için blockcheck2'yi TAM OLARAK bu reddedilmiş adayı
        // bulur bulmaz durduruyordu, foreach de onu atlayıp triedAndFailed'a hiç EKLEMİYORDU --
        // sonuç: bir sonraki while turunda blockcheck2 yeniden baştan çalıştırılıp deterministik
        // olarak YİNE aynı reddedilmiş adayı buluyor, sonsuz döngüye giriyordu (zapret2 hiç
        // başlamıyordu). Kalıcı reddedilenler listesini BAŞTAN triedAndFailed'a dahil ederek
        // RunBlockcheck2Async'in erken durdurma mekanizması bu adayları hiç görmüyormuş gibi atlayıp
        // blockcheck2'nin AYNI çalıştırma içinde farklı, reddedilmemiş bir adaya geçmesini sağlıyoruz
        // -- zapret2 yalnızca gerçekten yeni ve reddedilmemiş bir ayar bulunduğunda başlatılıyor.
        var triedAndFailed = new HashSet<string>(rejected, StringComparer.Ordinal);

        // Kayıtlı bir ayar varsa (daha önce belirli bir DNS protokolü aktifken doğrulanmış bir
        // (protokol, strateji) ikilisi — DnsProviders o tier'de bırakıldığı için burada AYRICA
        // bir tier değişikliği yapmıyoruz), blockcheck2 taramasına (dakikalar sürebilir) hiç
        // düşmeden önce onu GERÇEKTEN doğrulayarak art arda SavedArgsRetryAttempts kez dener
        // (bkz. ZapretEngine'deki aynı desen) — ses doğrulaması burada TEKRARLANMIYOR, ilk
        // keşifte belirlenen Zapret2VoiceVerified değeri kalıcı kabul ediliyor (her normal
        // açılışta ekstra bir STUN gidiş-dönüşüyle gecikmemek için).
        _settings.Current.EngineArgs.TryGetValue(Id, out var savedArgs);
        if (!string.IsNullOrWhiteSpace(savedArgs) && !rejected.Contains(savedArgs))
        {
            // Kullanıcı talebi: kayıtlı ayar, DOĞRUDAN doğrulandığı DNS protokolüyle birlikte
            // yeniden denenmeli — ARADA başka bir motor DnsProviders'ı değiştirmiş olsa bile
            // (bkz. SettingsStore.Zapret2VerifiedProtocol'deki not). Kayıt yoksa (ör. eski bir
            // ayar dosyasından yükseltme) mevcut DnsProviders'a olduğu gibi güveniyoruz.
            if (_settings.Current.Zapret2VerifiedProtocol is { } savedProtocol)
            {
                DnsProtocolTiers.ApplyTier(_settings, savedProtocol);
            }

            try
            {
                for (var attempt = 1; attempt <= SavedArgsRetryAttempts; attempt++)
                {
                    _savedArgsAttempt = attempt;
                    var label = $"Kayıtlı ayar deneniyor ({attempt}/{SavedArgsRetryAttempts})";
                    if (await TryCandidateAsync(savedArgs, label, ct, verifyVoice: false)) return;
                }
            }
            finally
            {
                _savedArgsAttempt = 0;
            }
            _logger.LogWarning(
                "Zapret2 kayıtlı ayarı {Max} denemenin tamamında başarısız oldu, DNS protokolü tier taramasına geçiliyor: {Args}",
                SavedArgsRetryAttempts, savedArgs);
            _logs.Add($"Kayıtlı ayar {SavedArgsRetryAttempts} denemenin tamamında başarısız oldu, DNS protokolü tier taramasına geçiliyor.");
        }

        // Manuel > Gelişmiş'ten kullanıcı tek bir DNS protokolü sabitlediyse (bkz.
        // SettingsStore.ManualDnsProtocol), 4 tier'lik döngüye hiç girmiyoruz — YALNIZCA o
        // protokolle, sabit 15 dakikalık bir üst sınır içinde blockcheck2 taranıyor (kullanıcı
        // talebi: "yalnızca o DNS protokolü ile 15 dakika boyunca blockcheck2 taraması
        // yapılsın"). Yalnızca Manuel açık seçimde etkili — Otomatik giriş noktasında bu ayar
        // yok sayılır, olağan 4 tier'lik döngü çalışır.
        if (IsManualActivation && _settings.Current.ManualDnsProtocol is { } pinnedProtocol)
        {
            if (await ScanProtocolWithinBudgetAsync(pinnedProtocol, DnsProtocolTiers.ManualPinnedProtocolTimeout, savedArgs, rejected, triedAndFailed, ct))
            {
                // Kullanıcı "DNS'siz" protokolünü sabitlemiş olabilir -- bkz.
                // RestoreDefaultAfterNoneTier'daki not, DnsProviders'ı bilerek boş bırakmıyoruz.
                if (pinnedProtocol == DnsProtocol.None) DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
                return;
            }

            DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
            _logger.LogError("blockcheck2: Manuel modda sabitlenen DNS protokolü {Protocol} ile çalışan bir strateji bulunamadı", pinnedProtocol);
            _logs.Add($"Sabitlenen DNS protokolü ({pinnedProtocol}) ile çalışan bir strateji bulunamadı.");
            _lastProbeFailed = true;
            throw new AllCandidatesFailedException(Id);
        }

        // DoH→DoT→DoQ→DNSCrypt dış döngüsü (kullanıcı talebi — bkz. plan Faz 9 v2): her tier
        // "aktif" yapılıp (ApplyTier: DnsProviders o tier'in havuzuna ayarlanır) blockcheck2 o
        // tier aktifken üst sınır (Otomatik 5dk/Manuel 10dk) dolana kadar TEKRAR TEKRAR baştan
        // çalıştırılır — canlı ağ üzerinden test ettiği için her çalıştırmada bulduğu aday hafif
        // değişebilir, ayrıca gerçek doğrulama adımı (TryCandidateAsync→SelfTestResolver) o
        // tier'in protokolünü kullanır. Bir (protokol, aday) ikilisi doğrulanırsa hemen kaydedip
        // dönülür; 4 tier de tükenirse (hiçbirinde hiçbir ayar bulunamazsa) AllCandidatesFailedException
        // fırlatılır — DpiEngineManager bunu yakalayıp Zapret'e (Zapret2'ye değil) eskalasyon
        // yapar, Zapret de KENDİ DoH→DoT→DoQ→DNSCrypt döngüsünü sıfırdan dener.
        // Kullanıcı talebi: Ayarlar > DPI Aşımı > Gelişmiş'teki slider'dan özelleştirilebilir
        // (5-60dk, bkz. SettingsStore.Zapret2AutomaticTierTimeoutMinutes/Zapret2ManualTierTimeoutMinutes).
        var perTierTimeout = TimeSpan.FromMinutes(IsManualActivation
            ? _settings.Current.Zapret2ManualTierTimeoutMinutes
            : _settings.Current.Zapret2AutomaticTierTimeoutMinutes);
        foreach (var protocol in DnsProtocolTiers.Order)
        {
            if (await ScanProtocolWithinBudgetAsync(protocol, perTierTimeout, savedArgs, rejected, triedAndFailed, ct))
            {
                // "No DNS" tier'i kazandıysa DnsProviders bilerek boş kaldı (bkz.
                // RestoreDefaultAfterNoneTier'daki not) -- kullanıcı talebi: sonraki aşım
                // yöntemleri/motorlar için şifreli DNS tekrar devreye girmeli.
                if (protocol == DnsProtocol.None) DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
                return;
            }
        }

        // 4 gerçek protokol de (ve son çare "DNS'siz" tier'i de) tükendi -- DnsProviders'ı
        // bilerek boş bırakmıyoruz (bkz. RestoreDefaultAfterNoneTier).
        DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);

        _logger.LogError("blockcheck2: {Count} DNS protokolü/tier'inin hiçbirinde çalışan bir strateji bulunamadı", DnsProtocolTiers.Order.Length);
        _logs.Add($"{DnsProtocolTiers.Order.Length} DNS protokolü/tier'inin (DoH/DNSCrypt/DoT/DoQ/DNS'siz) hiçbirinde çalışan bir strateji bulunamadı.");
        _lastProbeFailed = true;
        throw new AllCandidatesFailedException(Id);
    }

    /// <summary>Verilen protokolü "aktif" yapıp (ApplyTier) süre dolana kadar blockcheck2'yi
    /// TEKRAR TEKRAR baştan çalıştırır, bulduğu her adayı gerçek doğrulamadan geçirir — bir aday
    /// doğrulanırsa true döner (StartAsync bu durumda hemen return eder), süre dolup hiçbiri
    /// doğrulanmazsa false döner (StartAsync bir sonraki protokole/hataya geçer). Hem 4 tier'lik
    /// döngü hem de Manuel'de sabitlenen tek-protokol yolu tarafından ortak kullanılıyor.</summary>
    private async Task<bool> ScanProtocolWithinBudgetAsync(DnsProtocol protocol, TimeSpan budget, string? savedArgs, List<string> rejected, HashSet<string> triedAndFailed, CancellationToken ct)
    {
        DnsProtocolTiers.ApplyTier(_settings, protocol);
        _logger.LogInformation("Zapret2: DNS protokolü {Protocol} aktifken blockcheck2 taranıyor (üst sınır {Timeout})", protocol, budget);
        _logs.Add($"DNS protokolü {protocol} aktifken taranıyor (üst sınır {budget}).");

        var deadline = DateTime.UtcNow + budget;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();

            List<string> candidates;
            try
            {
                candidates = await RunBlockcheck2Async(ct, forceDoh: protocol == DnsProtocol.Doh, excludeCandidates: triedAndFailed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "blockcheck2 çalıştırılamadı");
                _logs.Add($"blockcheck2 çalıştırılamadı: {ex.Message}");
                _lastProbeFailed = true;
                throw new AllCandidatesFailedException(Id);
            }

            if (candidates.Count == 0)
            {
                _logger.LogWarning("blockcheck2 ({Protocol}) çalışan bir strateji bulamadı, süre kaldıysa yeniden denenecek", protocol);
                continue;
            }

            foreach (var candidate in candidates)
            {
                if (candidate == savedArgs) continue; // az önce yukarıda 3 kez denendi
                if (rejected.Contains(candidate))
                {
                    // Bu tarama BAŞLARKEN triedAndFailed zaten rejected'ın tamamıyla dolduruldu
                    // (bkz. StartAsync'teki not), bu yüzden normalde buraya hiç düşülmemeli --
                    // ama tarama SÜRERKEN kullanıcı ayrı bir uçtan (ör. Ayarlar ekranından) yeni
                    // bir strateji reddettiyse (rejected canlı/paylaşılan liste), o adayı da
                    // burada triedAndFailed'a ekleyip AYNI loop bugının bu geç-reddetme
                    // senaryosunda da oluşmasını engelliyoruz.
                    _logger.LogInformation("Zapret2 stratejisi atlanıyor (daha önce reddedildi): {Args}", candidate);
                    triedAndFailed.Add(candidate);
                    continue;
                }
                ct.ThrowIfCancellationRequested();
                if (await TryCandidateAsync(candidate, "blockcheck2 adayı deneniyor", ct, verifyVoice: true, skipHttpConnectivityCheck: true)) return true;
                // Bu oturumda bir daha aynı adayı bulup boşuna denemeyelim -- bkz. triedAndFailed
                // üstündeki not. RunBlockcheck2Async bunu görünce erken durmayıp bir sonraki
                // adaya geçecek.
                triedAndFailed.Add(candidate);
            }
            // hiçbiri doğrulanmadı -- süre kaldıysa while koşulu blockcheck2'yi aynı protokol
            // altında baştan yeniden dener.
        }

        _logger.LogWarning("Zapret2: DNS protokolü {Protocol} ile üst sınır içinde çalışan bir ayar bulunamadı", protocol);
        _logs.Add($"DNS protokolü {protocol} ile üst sınır içinde çalışan bir ayar bulunamadı.");
        return false;
    }

    /// <summary>blockcheck2.sh'yi (bkz. resources/bin/zapret2/blockcheck2/) bundled Cygwin
    /// bash'i üzerinden BATCH=1 (etkileşimli soruları atlar) ve DOMAINS=discord.com ile
    /// çalıştırır, stdout'unu satır satır okuyup "!!!!! ... working strategy found ...
    /// !!!!!" desenindeki, daemon'u winws2 olan satırları ayrıştırır. Servis zaten SYSTEM
    /// olarak çalıştığı için .cmd sarmalayıcısının kullandığı elevator'a gerek yok —
    /// bash.exe doğrudan çağrılıyor.</summary>
    private async Task<List<string>> RunBlockcheck2Async(CancellationToken ct, bool forceDoh, HashSet<string> excludeCandidates)
    {
        var bashPath = BinaryLocator.Resolve("zapret2", Path.Combine("cygwin", "bin", "bash.exe"));
        var blockcheck2Dir = Path.Combine(BinaryLocator.ToolDir("zapret2"), "blockcheck2");
        if (!File.Exists(Path.Combine(blockcheck2Dir, "blockcheck2.sh")))
        {
            throw new FileNotFoundException("blockcheck2.sh bulunamadı", blockcheck2Dir);
        }

        // Kullanıcı talebiyle bulunan gerçek bir kararlılık sorunu: WinDivert sürücüsü aynı
        // anda yalnızca TEK bir işleyiciye bağlanabiliyor. blockcheck2.sh'nin KENDİ iç test
        // döngüsü de winws2.exe kullanıyor — önceki bir denemeden (kayıtlı ayar hızlı yolu ya
        // da bir önceki blockcheck2 çalıştırması) kalma artık bir winws2.exe hâlâ ayaktaysa,
        // blockcheck2'nin KENDİ adayları da WinDivert tanıtıcısını alamayıp TEK BİR ÇALIŞAN
        // strateji bile bulamadan boş dönüyordu (canlı testte doğrulandı: "blockcheck2 ayar
        // bulup çalıştırmaya başlamıyor"). Önceden bu temizlik yalnızca blockcheck2 BİTTİKTEN
        // sonra (finally bloğunda) yapılıyordu -- başlamadan ÖNCE değil. Burada da çağırarak
        // blockcheck2'nin KENDİ taraması da her zaman boş bir WinDivert tanıtıcısıyla başlasın.
        KillStrayWinws2Processes();
        await Task.Delay(300, ct);

        var psi = new ProcessStartInfo
        {
            FileName = bashPath,
            WorkingDirectory = blockcheck2Dir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        // NOT: -i (etkileşimli) veya --login KULLANMIYORUZ — canlı testte doğrulandı, ikisi
        // de yönlendirilmiş (redirected) stdio ile gerçek bir TTY olmadan çalıştırıldığında
        // sorunlu: -i "cannot set terminal process group" hatasıyla script'i BOZUYOR (satırlar
        // birbirine karışıp syntax error veriyor), --login ise CWD'yi kullanıcı home
        // dizinine taşıyıp yan etki olarak skeleton dotfile'lar oluşturuyor. Düz (non-
        // interactive, non-login) bash PATH'i /etc/profile'dan almadığı için (dirname/grep/
        // uname gibi temel Cygwin araçları bile bulunamıyordu) PATH'i burada elle kuruyoruz.
        psi.ArgumentList.Add("./blockcheck2.sh");
        var cygwinDir = Path.Combine(BinaryLocator.ToolDir("zapret2"), "cygwin");
        // KRİTİK: bundled Cygwin dağıtımındaki boş dizinler (tmp, var/run, var/log, home, ...)
        // yalnızca bir ".gitkeep" placeholder dosyası içeriyor — electron-builder'ın
        // extraResources kopyalama adımı nokta ile başlayan dosyaları atlıyor, bu da İÇİNDE
        // BAŞKA HİÇBİR ŞEY olmayan bu dizinlerin paketlenmiş/kurulu sürümde HİÇ VAR
        // OLMAMASINA yol açıyor (canlı testte doğrulandı: kurulu sürümde cygwin/tmp yoktu).
        // Sonuç: blockcheck2.sh'nin her aday için "-D $hdrt" ile /tmp altına yazmaya çalıştığı
        // başlık dosyası için curl HER ZAMAN "curl: (23) Failed writing received data to
        // disk/application" hatası veriyordu — TÜM stratejiler "UNAVAILABLE" görünüp
        // blockcheck2 hiçbir zaman çalışan bir strateji bulamıyordu. Burada elle oluşturuyoruz.
        foreach (var requiredDir in new[] { "tmp", "var/tmp", "var/run", "var/log", "home" })
        {
            Directory.CreateDirectory(Path.Combine(cygwinDir, requiredDir.Replace('/', Path.DirectorySeparatorChar)));
        }
        var posixCygBin = ToPosixPath(Path.Combine(cygwinDir, "bin"));
        var posixCygLocalBin = ToPosixPath(Path.Combine(cygwinDir, "usr", "local", "bin"));
        psi.Environment["PATH"] = $"{posixCygBin}:{posixCygLocalBin}:{Environment.GetEnvironmentVariable("PATH")}";
        psi.Environment["BATCH"] = "1";
        psi.Environment["DOMAINS"] = "discord.com";
        psi.Environment["IPVS"] = "4";
        psi.Environment["TEST"] = "standard";
        // "standard" test dizini onlarca desync varyasyonu içeriyor — SCANLEVEL=quick
        // olmadan (yani "standard" tarama derinliğinde) her biri denenip dakikalarca
        // sürebiliyor (canlı testte doğrulandı). "quick", bir test grubunda ÇALIŞAN ilk
        // strateji bulunur bulunmaz o gruptan çıkıyor — otomatik/ilk-açılış taraması için
        // kapsamlılıktan çok hız önemli olduğundan tercih edildi.
        psi.Environment["SCANLEVEL"] = "quick";
        // DOH_SERVERS/SECURE_DNS'e genel olarak BİLEREK müdahale ETMİYORUZ: blockcheck2.sh
        // kendi DNS zehirlenmesi tespitini/DoH aramasını (bkz. script çıktısındaki "searching
        // working DoH server") kendi özenle seçilmiş varsayılan sağlayıcı listesiyle ve kendi
        // curl çağrısıyla uyumlu şekilde yapıyor — bunu bizim listemizle zorlamak bu kendi
        // kendine yeten mekanizmayı bozma riski taşıyor. TEK istisna: StartAsync'teki DoH→DoT→
        // DoQ→DNSCrypt dış döngüsü (bkz. Dns/DnsProtocolTiers.cs) şu an DoH tier'ini deniyorsa
        // (forceDoh) — blockcheck2'nin DOH_SERVERS/SECURE_DNS mekanizması yalnızca DoH URL'i
        // kabul ediyor (script kaynağı incelendi, DoT/DoQ/DNSCrypt için hiçbir yerleşik desteği
        // yok), bu yüzden yalnızca bu durumda DnsProviders'taki (zaten DoH tier'ine ayarlı)
        // AYNI adresleri ona da veriyoruz — kullanıcı talebi, ve script'in kendi beklediği
        // formatla (DoH URL listesi) birebir uyumlu olduğu için güvenli. DoT/DoQ/DNSCrypt
        // tier'lerinde blockcheck2 kendi varsayılan DNS'inde kalır (yalnızca bizim gerçek
        // doğrulama adımımız, bkz. Dns/SelfTestResolver.cs/TestConnectivityAsync, o protokolü
        // kullanır — blockcheck2 yine de baştan yeniden çalıştırılıyor, bkz. StartAsync'teki not).
        if (forceDoh)
        {
            var dohAddresses = _settings.Current.DnsProviders
                .Where(p => p.Protocol == DnsProtocol.Doh)
                .Select(p => p.Address);
            psi.Environment["SECURE_DNS"] = "1";
            psi.Environment["DOH_SERVERS"] = string.Join(" ", dohAddresses);
        }

        var candidates = new List<string>();
        // blockcheck2.sh "standard" test dizinindeki TÜM script'leri (10-http-basic, 15-misc,
        // 17-oob, 20-multi, ...) sırayla dener — SCANLEVEL=quick yalnızca BİR grup İÇİNDE ilk
        // başarılı denemeden sonra o gruptan çıkıyor, ama bir strateji bulununca TÜM taramayı
        // durdurmuyor; onlarca script'in hepsi bitene kadar dakikalarca sürmeye devam ediyor.
        // Otomatik/ilk-açılış taraması için gerçek darboğaz bu — kapsamlı bir aday LİSTESİ
        // toplamak yerine, İLK çalışan stratejiyi bulur bulmaz (aşağıdaki earlyStopCts ile)
        // süreci öldürüp doğrudan o tek adayın gerçek doğrulamasına (TryCandidateAsync)
        // geçiyoruz. Bu adayın doğrulaması başarısız olursa (candidates.Count==1 tükenirse)
        // AllCandidatesFailedException'a düşülür — o zaman kullanıcı "Tekrar Tara"ya basıp
        // yeniden dener (reddedilen stratejiyi kalıcı olarak dışlama seçeneği ayrı bir işte).
        using var earlyStopCts = new CancellationTokenSource();
        string? pendingCandidate = null;
        void AddCandidateAndStop(string strategy)
        {
            strategy = strategy.Trim();
            if (candidates.Contains(strategy)) return;
            // Bu oturumda bu aday zaten denenip başarısız olduysa (bkz. StartAsync'teki
            // triedAndFailed notu) burada DURMUYORUZ — blockcheck2'nin deterministik davranışı
            // yüzünden aksi hâlde her seferinde AYNI bilinen-kötü adayı bulup üst sınırın
            // tamamını boşa harcardık. Script'in bir sonraki (farklı) adaya geçmesine izin
            // veriyoruz.
            if (excludeCandidates.Contains(strategy))
            {
                _logs.Add($"[blockcheck2] '{strategy}' bu oturumda zaten denenmişti, atlanıyor, taramaya devam ediliyor...");
                return;
            }
            candidates.Add(strategy);
            try { earlyStopCts.Cancel(); } catch { /* zaten iptal edilmiş olabilir */ }
        }
        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            _logs.Add($"[blockcheck2] {e.Data}");

            // Erken sinyal: "- curl_test_http ipvN domain : winws2 <strateji>" satırının hemen
            // ardından gelen "!!!!! AVAILABLE !!!!!" — bkz. CandidateLineRegex/AvailableLineRegex
            // üstündeki not. Bu, özet ("working strategy found") satırından çok daha erken gelir.
            var candidateMatch = CandidateLineRegex.Match(e.Data);
            if (candidateMatch.Success)
            {
                pendingCandidate = candidateMatch.Groups["strategy"].Value;
                return;
            }
            if (pendingCandidate is not null)
            {
                if (AvailableLineRegex.IsMatch(e.Data.Trim()))
                {
                    AddCandidateAndStop(pendingCandidate);
                }
                pendingCandidate = null; // UNAVAILABLE ya da başka bir satır -- sıfırla
            }

            // Yedek sinyal: bir grubun TAMAMI bitince yazılan özet satırı (yukarıdaki erken
            // sinyal her nedense kaçırılırsa diye).
            var match = WorkingStrategyRegex.Match(e.Data);
            if (match.Success && string.Equals(match.Groups["daemon"].Value, "winws2", StringComparison.OrdinalIgnoreCase))
            {
                AddCandidateAndStop(match.Groups["strategy"].Value);
            }
        };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add($"[blockcheck2 stderr] {e.Data}"); };

        _logger.LogInformation("blockcheck2 başlatılıyor (discord.com için strateji taraması)");
        _logs.Add("blockcheck2 başlatılıyor, bu birkaç dakika sürebilir...");

        process.Start();
        // KRİTİK: bu süreç (bash.exe + altındaki blockcheck2.sh/winws2.exe) StopAsync'in
        // bildiği tek alan olan _process'e DEĞİL, ayrı bir alana atanıyordu — önceki halinde
        // hiç atanmıyordu, bu yüzden Otomatik'ten Manuel'e geçilip CancelCurrentScan()
        // çağrıldığında (bkz. DpiEngineManager) yalnızca C# tarafındaki WaitForExitAsync
        // beklemesi kesiliyor, ama GERÇEK bash/winws2 süreçleri arka planda ÇALIŞMAYA
        // DEVAM EDİYORDU — bu da bir sonraki taramanın WinDivert'i zaten kilitli bulup
        // hiçbir adayı doğrulayamamasına (kullanıcının bildirdiği "Manuel'e alınca Zapret2
        // tekrar aramaya başlamıyor" sorununa) yol açıyordu. Şimdi _blockcheckProcess'e
        // atanıp StopAsync'in de bunu öldürmesi sağlanıyor.
        _blockcheckProcess = process;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct, earlyStopCts.Token);
            timeoutCts.CancelAfter(BlockcheckTimeout);
            try
            {
                await process.WaitForExitAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException)
            {
                // ct (gerçek kullanıcı iptali), earlyStopCts (ilk çalışan strateji bulundu) ya
                // da yalnızca BlockcheckTimeout'umuz mu tetiklendi fark etmeksizin, süreç
                // GERÇEKTEN sonlandırılmalı — aksi hâlde yukarıdaki yorumda anlatılan sızıntı oluşur.
                try { process.Kill(entireProcessTree: true); } catch { /* zaten sonlanmış olabilir */ }
                try { await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* en iyi çaba */ }

                if (ct.IsCancellationRequested)
                {
                    // Gerçek kullanıcı iptali — DpiEngineManager.SwitchToAsync'teki
                    // "Tarama kullanıcı tarafından durduruldu" yakalayıcısına ulaşması için
                    // yeniden fırlatılıyor (yoksa sessizce boş bir aday listesi dönüp
                    // AllCandidatesFailedException'a düşülür, ki bu yanlış olurdu).
                    throw;
                }

                if (earlyStopCts.IsCancellationRequested)
                {
                    _logger.LogInformation("blockcheck2 ilk çalışan stratejiyi buldu, tarama erken durduruldu: {Strategy}", candidates.FirstOrDefault());
                    _logs.Add("İlk çalışan strateji bulundu, tarama erken durduruldu.");
                }
                else
                {
                    _logger.LogWarning("blockcheck2 zaman aşımına uğradı ({Timeout}), sonlandırıldı", BlockcheckTimeout);
                    _logs.Add("blockcheck2 zaman aşımına uğradı, sonlandırıldı.");
                }
            }
        }
        finally
        {
            _blockcheckProcess = null;
            // bkz. KillStrayWinws2Processes üstündeki not: blockcheck2.sh'nin KENDİ iç test
            // döngüsünden kalma winws2.exe örnekleri olabilir — bunlar temizlenmeden bir sonraki
            // SpawnAsync WinDivert tanıtıcısını alamayabilir.
            KillStrayWinws2Processes();
        }

        _logger.LogInformation("blockcheck2 tamamlandı, {Count} winws2 adayı bulundu", candidates.Count);
        _logs.Add($"blockcheck2 tamamlandı, {candidates.Count} aday bulundu.");
        return candidates;
    }

    /// <summary>Cygwin'in bash'i, PATH gibi ortam değişkenlerinde Windows tarzı ("C:\...")
    /// yollar yerine "/cygdrive/c/..." biçimini bekliyor.</summary>
    private static string ToPosixPath(string windowsPath) =>
        "/cygdrive/" + char.ToLowerInvariant(windowsPath[0]) + windowsPath[2..].Replace('\\', '/');

    /// <param name="skipHttpConnectivityCheck">true iken: aday blockcheck2'nin KENDİ curl
    /// tabanlı testinden (gerçek discord.com'a bu strateji altında ulaşılabildiğini zaten
    /// kanıtlayan "!!!!! AVAILABLE !!!!!") geliyor demektir — kullanıcı talebi: blockcheck2
    /// zaten bunu kanıtladığı için burada AYRICA bir HTTP testi TEKRARLANMIYOR (gereksiz
    /// olmasının yanında, her ek HTTP round-trip'i de bir süre boşa harcıyor). false iken
    /// (kayıtlı ayarın yeniden denenmesi — bkz. StartAsync üstü): blockcheck2 az önce
    /// ÇALIŞMADI, bu yüzden GERÇEK bir HTTP testi burada yapılıyor.</param>
    private async Task<bool> TryCandidateAsync(string candidate, string label, CancellationToken ct, bool verifyVoice, bool skipHttpConnectivityCheck = false)
    {
        _logger.LogInformation("Zapret2 stratejisi deneniyor ({Label}): {Args}", label, candidate);
        _logs.Add($"{label}: {candidate}");

        try
        {
            await SpawnAsync(candidate, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Zapret2 stratejisi başlatılamadı: {Args}", candidate);
            _logs.Add($"Başlatılamadı: {ex.Message}");
            return false;
        }

        await Task.Delay(DriverAttachDelay, ct);

        if (skipHttpConnectivityCheck)
        {
            _logs.Add("blockcheck2 zaten discord.com'a ulaşılabildiğini kanıtladı, ayrıca HTTP testi tekrarlanmıyor.");
        }
        else
        {
            var reachable = await TestConnectivityAsync(TimeSpan.FromSeconds(12), BuildConnectivityProbeUrl(candidate));
            if (!reachable)
            {
                _logger.LogWarning("Zapret2 stratejisi Discord'a erişemedi: {Args}", candidate);
                _logs.Add("Bu strateji Discord'a erişemedi.");
                await StopAsync(ct);
                return false;
            }
        }

        // KRİTİK — canlı testte doğrulanan bir yarış: winws2.exe süreci KENDİLİĞİNDEN çok erken
        // sonlanabiliyor, ama WinDivert sürücüsünde kurduğu paket filtresi süreç öldükten SONRA
        // da kısa süre etkili kalmaya devam edebiliyor — bu yüzden yukarıdaki HTTP testi (yapıldıysa)
        // hâlâ başarılı dönebiliyor. Kaydetmeden önce sürecin GERÇEKTEN hâlâ ayakta olduğunu
        // kontrol ediyoruz.
        if (_process is not { HasExited: false })
        {
            _logger.LogWarning("Zapret2 stratejisi doğrulama sırasında beklenmedik şekilde durdu, başarısız sayılıyor: {Args}", candidate);
            _logs.Add("Bu strateji doğrulama sırasında beklenmedik şekilde durdu, başarısız sayıldı.");
            return false;
        }

        var voiceVerified = false;
        if (verifyVoice)
        {
            voiceVerified = await VerifyVoiceAsync();
            _logs.Add(voiceVerified
                ? "Ses (UDP/STUN) doğrulaması BAŞARILI — bu strateji altında ham UDP gidiş-dönüş yapabiliyor."
                : "Ses (UDP/STUN) doğrulaması başarısız — yalnızca metin/TLS için doğrulanmış sayılıyor.");
        }

        // Ses testi sürerken de ölmüş olabilir -- kaydetmeden hemen önce son bir kez daha
        // kontrol ediyoruz.
        if (_process is not { HasExited: false })
        {
            _logger.LogWarning("Zapret2 stratejisi ses doğrulaması sırasında beklenmedik şekilde durdu, başarısız sayılıyor: {Args}", candidate);
            _logs.Add("Bu strateji ses doğrulaması sırasında beklenmedik şekilde durdu, başarısız sayıldı.");
            return false;
        }

        _logger.LogInformation("Zapret2 stratejisi çalışıyor, kaydediliyor: {Args} (ses doğrulandı: {Voice})", candidate, voiceVerified);
        _logs.Add("Bu strateji çalışıyor, kaydedildi.");
        _settings.Current.EngineArgs[Id] = candidate;
        _settings.Current.Zapret2Verified = true;
        // DnsProviders zaten bu adayın doğrulandığı tier'e ayarlı (bkz. StartAsync'teki
        // DnsProtocolTiers.ApplyTier çağrısı) -- burada yalnızca "bir protokol gerçekten
        // doğrulanmış bir ayarla çalışıyor" bilgisini teşhis amaçlı işaretliyoruz.
        _settings.Current.DnsProtocolVerified = true;
        // Bu MOTORA ÖZEL kombo hafızası -- bkz. alan tanımındaki not. VerifiedDnsProtocol
        // paylaşılan/tanılama amaçlı alan, bu ise Zapret2'nin "kayıtlı ayarım şu protokolle
        // doğrulandı" bilgisini KALICI olarak saklıyor.
        _settings.Current.Zapret2VerifiedProtocol = _settings.Current.VerifiedDnsProtocol;
        if (verifyVoice) _settings.Current.Zapret2VoiceVerified = voiceVerified;
        _settings.Save();
        return true;
    }

    /// <summary>candidate stratejisiyle zaten çalışmakta olan winws2.exe altında, RFC 5389
    /// STUN Binding Request/Response ile ham UDP'nin bu strateji altında gerçekten dışarı
    /// çıkıp geçerli bir yanıt alabildiğini doğrular (bkz. sınıf üstü StunProbeTargets
    /// yorumu — neden Discord'a özel bir hostname yerine genel bir STUN sunucusu
    /// kullanıldığı). Herhangi bir hedeften geçerli bir Binding Response alınırsa true.</summary>
    private async Task<bool> VerifyVoiceAsync()
    {
        foreach (var (host, port) in StunProbeTargets)
        {
            try
            {
                if (await SendStunBindingRequestAsync(host, port, TimeSpan.FromSeconds(4)))
                {
                    _logger.LogInformation("STUN ses doğrulaması başarılı: {Host}:{Port}", host, port);
                    return true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "STUN ses doğrulaması hatası: {Host}:{Port}", host, port);
            }
        }
        return false;
    }

    private static async Task<bool> SendStunBindingRequestAsync(string host, int port, TimeSpan timeout)
    {
        var addresses = await System.Net.Dns.GetHostAddressesAsync(host);
        var address = addresses.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork) ?? addresses.FirstOrDefault();
        if (address is null) return false;

        var transactionId = new byte[12];
        Random.Shared.NextBytes(transactionId);

        // RFC 5389: 20 bayt başlık — tip(2) + uzunluk(2) + magic cookie(4) + transaction id(12).
        var request = new byte[20];
        request[0] = 0x00; request[1] = 0x01; // Binding Request
        request[2] = 0x00; request[3] = 0x00; // uzunluk: 0 (attribute yok)
        request[4] = 0x21; request[5] = 0x12; request[6] = 0xA4; request[7] = 0x42; // magic cookie
        Buffer.BlockCopy(transactionId, 0, request, 8, 12);

        using var udp = new UdpClient();
        udp.Client.ReceiveTimeout = (int)timeout.TotalMilliseconds;
        await udp.SendAsync(request, request.Length, host, port);

        using var timeoutCts = new CancellationTokenSource(timeout);
        UdpReceiveResult result;
        try
        {
            result = await udp.ReceiveAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            return false;
        }

        var response = result.Buffer;
        if (response.Length < 20) return false;
        // Binding Success Response = 0x0101, magic cookie ve transaction id eşleşmeli.
        var isSuccessResponse = response[0] == 0x01 && response[1] == 0x01;
        var cookieMatches = response[4] == 0x21 && response[5] == 0x12 && response[6] == 0xA4 && response[7] == 0x42;
        var transactionMatches = response.AsSpan(8, 12).SequenceEqual(transactionId);
        return isSuccessResponse && cookieMatches && transactionMatches;
    }

    public async Task StopAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false } process)
        {
            try
            {
                process.Kill(entireProcessTree: true);
                // WinDivert sürücüsü Zapret2/Zapret/GoodbyeDPI arasında paylaşılıyor ve aynı
                // anda yalnızca birine bağlanabiliyor — bir sonraki motor başlamadan önce bu
                // sürecin (ve sürücü tanıtıcısının) GERÇEKTEN kapandığından emin olmak için
                // kısa bir süre bekliyoruz (Kill() OS seviyesinde asenkron).
                await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _process = null;

        // blockcheck2 keşif taraması sürüyorsa (bkz. RunBlockcheck2Async) onu da durduruyoruz
        // — RunBlockcheck2Async kendi içinde de iptal/zaman aşımında bunu öldürüyor, ama
        // DpiEngineManager başka bir motora geçerken StopAsync'i doğrudan çağırdığı için
        // (bkz. SwitchToAsync'teki "TÜM motorları durduruyoruz" adımı) burada da ele
        // alınması gerekiyor.
        if (_blockcheckProcess is { HasExited: false } blockcheckProcess)
        {
            try
            {
                blockcheckProcess.Kill(entireProcessTree: true);
                await blockcheckProcess.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _blockcheckProcess = null;

        // Kullanıcı talebiyle bulunan gerçek bir kararlılık sorunu: blockcheck2.sh'nin KENDİ
        // iç test döngüsünden kalma, _process/_blockcheckProcess alanlarımızca hiç
        // TAKİP EDİLMEYEN winws2.exe örnekleri olabilir (bkz. KillStrayWinws2Processes
        // üstündeki not — Cygwin'in kendi süreç ağacı .NET'in entireProcessTree Kill()'ının
        // HER ZAMAN yakalayabildiği bir yapı değil). Bu motor durdurulduğunda (ör. tray'den
        // "Çıkış" → /stop-all, ya da DpiEngineManager başka bir motora geçerken) böyle bir
        // artık süreç temizlenmeden bırakılırsa, uygulama yeniden açıldığında hem "kayıtlı
        // ayar" hızlı yolu HEM DE blockcheck2'nin kendi taraması WinDivert tanıtıcısını
        // alamayıp HİÇBİR strateji doğrulayamıyordu (canlı testte doğrulandı) — DNS/ISP ile
        // ilgisi yok, tamamen bu artık süreç yüzünden. Motor durdurulduğunda sistem genelinde
        // GERÇEKTEN sıfır winws2.exe kalmasını garanti ediyoruz.
        KillStrayWinws2Processes();
    }

    public EngineStatus GetStatus()
    {
        var running = _process is { HasExited: false } || _blockcheckProcess is { HasExited: false };
        string detail;
        // Kayıtlı ayar hızlı yolu her denemede kendi winws2.exe'sini spawn edip (başarısızsa)
        // hemen öldürüyor -- bu yüzden "running" bu aşamada sürekli true/false arasında
        // flaşlanabiliyor. Gerçek durumu ("hâlâ deneniyor", henüz vazgeçilmedi) her ikisinin
        // önüne alarak gösteriyoruz.
        if (_savedArgsAttempt > 0) detail = $"Kayıtlı ayar deneniyor ({_savedArgsAttempt}/{SavedArgsRetryAttempts})";
        else if (running) detail = "Aktif (sistem geneli)";
        else if (_lastProbeFailed) detail = "blockcheck2 çalışan bir strateji bulamadı veya doğrulayamadı";
        else detail = "Durduruldu";

        return new EngineStatus(Id, DisplayName, running, RequiresSystemWideAccess, null, detail);
    }

    public IReadOnlyList<string> GetRecentLogs() => _logs.Snapshot();
    public void ClearLogs() => _logs.Clear();

    public int? GetOwnProcessId() => _process is { HasExited: false } ? _process.Id : null;

    /// <summary>WinDivert sürücüsü aynı anda yalnızca TEK bir işleyiciye (winws2.exe örneğine)
    /// bağlanabiliyor. blockcheck2.sh KENDİ iç test döngüsünde kısa ömürlü winws2.exe süreçleri
    /// başlatıp durduruyor (bkz. "preparing winws2 redirection" log satırları) — bunlar
    /// _blockcheckProcess/_process alanlarımızca TAKİP EDİLMİYOR (blockcheck2.sh'nin Cygwin
    /// altındaki kendi süreç ağacı, .NET'in entireProcessTree Kill()'ının HER ZAMAN güvenilir
    /// şekilde yakalayabildiği bir alt süreç olmayabiliyor). Canlı testte doğrulandı: blockcheck2
    /// bir strateji bulup erken durduktan sonra "Bu strateji çalışıyor, kaydedildi." loglanıyor,
    /// ama kazanan strateji için SpawnAsync ile başlattığımız YENİ (kalıcı olması gereken)
    /// winws2.exe örneği WinDivert tanıtıcısını (handle) alamayıp birkaç saniye içinde kendiliğinden
    /// (OS seviyesinde HİÇBİR crash raporu olmadan, yani sessizce) çıkıyordu. Adı geçen HER
    /// winws2.exe sürecini (bizim başlattığımız/izlediğimiz olsun olmasın) sistem genelinde zorla
    /// sonlandırıp, bir sonraki spawn'ın GERÇEKTEN boş bir WinDivert tanıtıcısıyla başlamasını
    /// garanti ediyoruz — hem blockcheck2 bitince (RunBlockcheck2Async) hem her SpawnAsync'ten
    /// hemen önce çağrılıyor.</summary>
    private void KillStrayWinws2Processes()
    {
        Process[] stray;
        try { stray = Process.GetProcessesByName("winws2"); }
        catch { return; }

        foreach (var strayProcess in stray)
        {
            using (strayProcess)
            {
                try
                {
                    strayProcess.Kill(entireProcessTree: true);
                    strayProcess.WaitForExit(2000);
                }
                catch { /* zaten sonlanmış olabilir */ }
            }
        }
    }

    /// <summary>winws2.exe'yi verilen argümanlarla başlatır (ZapretEngine.SpawnAsync ile
    /// aynı desen — nfqws2 tabanlı motorların CLI argüman yüzeyi zapret1 ile uyumlu).</summary>
    private async Task SpawnAsync(string args, CancellationToken ct)
    {
        var exePath = BinaryLocator.Resolve("zapret2", Path.Combine("blockcheck2", "nfq2", "winws2.exe"));
        var binDir = Path.GetDirectoryName(exePath)!;

        // Bu adayı başlatmadan ÖNCE WinDivert tanıtıcısını tutuyor olabilecek her türlü artık
        // winws2.exe'yi (blockcheck2'nin kendi iç testinden ya da önceki bir adaydan kalma)
        // temizliyoruz — bkz. üstteki KillStrayWinws2Processes notu. Kill() OS seviyesinde
        // asenkron olduğu için sürücünün gerçekten serbest kaldığından emin olmak adına kısa
        // bir bekleme ekleniyor.
        KillStrayWinws2Processes();
        await Task.Delay(300, ct);

        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = binDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        // GERÇEK KÖK NEDEN (canlı testte ExitCode tanısıyla kesin olarak doğrulandı:
        // -1073741515 = 0xC0000135 = Windows'un STATUS_DLL_NOT_FOUND'u): winws2.exe bir Cygwin
        // ikili dosyası, cygwin1.dll'e (bkz. zapret2/cygwin/bin/cygwin1.dll) ihtiyaç duyuyor
        // ama bu DLL kendi dizininde (nfq2/) DEĞİL, ayrı bir Cygwin bin dizininde duruyor.
        // blockcheck2.sh winws2'yi HER ZAMAN bash.exe'nin İÇİNDEN çalıştırıyor (bkz.
        // RunBlockcheck2Async'in bash.exe için ayarladığı PATH) — winws2.exe bu PATH'i
        // MİRAS ALDIĞI için Windows cygwin1.dll'i bulabiliyor. Biz KENDİ SpawnAsync'imizde
        // winws2.exe'yi bash OLMADAN doğrudan başlatıyoruz ve PATH'e Cygwin bin dizinini HİÇ
        // eklemiyorduk — bu yüzden Windows cygwin1.dll'i (muhtemelen başka bağımlı DLL'leri de)
        // bulamayıp süreci KENDİ KODU HİÇ ÇALIŞMADAN (hata çıktısı olmadan, ~1-2 saniyede)
        // sonlandırıyordu. Bu, önceki "lua-init eksik" teorisinden daha temel bir sorun —
        // --lua-init doğru olsa bile DLL yüklenemediği için hiçbir zaman devreye giremiyordu.
        var cygwinBinDir = Path.Combine(BinaryLocator.ToolDir("zapret2"), "cygwin", "bin");
        psi.Environment["PATH"] = $"{cygwinBinDir};{Environment.GetEnvironmentVariable("PATH")}";

        // KRİTİK KÖK NEDEN (canlı testte blockcheck2.sh kaynağı okunarak doğrulandı,
        // blockcheck2.sh:951/954/962 — pktws_start): blockcheck2.sh winws2/nfqws2'yi HER ZAMAN
        // "--lua-init=@zapret-lib.lua --lua-init=@zapret-antidpi.lua" ile başlatıyor — bu iki
        // Lua modülü, "--lua-desync=X" adıyla verilen tekniklerin (http_hostcase, oob,
        // hostfakesplit, ...) GERÇEK implementasyonlarını içeriyor. Biz KENDİ SpawnAsync'imizde
        // bugüne kadar SADECE adayın çıplak argümanlarını (ör. "--lua-desync=http_hostcase:...")
        // veriyorduk, bu iki --lua-init bayrağını HİÇ eklemiyorduk — bu yüzden winws2.exe,
        // "--lua-desync=X" tekniğinin implementasyonunu bulamayıp (Lua modülleri hiç
        // yüklenmemişken) genelde spawn'dan 1-2 saniye sonra, hiçbir hata çıktısı vermeden
        // sessizce çöküyordu (canlı testte 10+ kez, aynı desende doğrulandı). blockcheck2.sh'nin
        // KENDİ davranışını birebir kopyalayıp bu iki bayrağı adayın argümanlarından ÖNCE
        // ekliyoruz.
        var blockcheck2Dir = Path.GetDirectoryName(binDir)!; // nfq2'nin bir üstü
        var luaLibPath = Path.Combine(blockcheck2Dir, "lua", "zapret-lib.lua");
        var luaAntidpiPath = Path.Combine(blockcheck2Dir, "lua", "zapret-antidpi.lua");
        if (File.Exists(luaLibPath) && File.Exists(luaAntidpiPath))
        {
            psi.ArgumentList.Add($"--lua-init=@{luaLibPath}");
            psi.ArgumentList.Add($"--lua-init=@{luaAntidpiPath}");
        }
        else
        {
            _logger.LogWarning("zapret-lib.lua/zapret-antidpi.lua bulunamadı ({LibPath}), --lua-desync teknikleri çalışmayabilir", luaLibPath);
        }

        foreach (var arg in SplitArgs(args)) psi.ArgumentList.Add(arg);

        _logger.LogInformation("Zapret2 winws2.exe tam komut satırı: {Exe} {Args}", exePath, string.Join(' ', psi.ArgumentList));
        _logs.Add($"[tanı] tam komut satırı: {string.Join(' ', psi.ArgumentList)}");

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        // bkz. Dns/DnsProxyToolProcess.cs'teki not: servis kapanışı sırasında EventLog provider'ı
        // dispose edilmişken bu handler tetiklenirse çıplak bir _logger.Log* çağrısı TÜM SERVİSİ
        // çöktürüyor (ThreadPool callback'inde yakalanmayan istisna, canlı testte doğrulandı) —
        // try/catch ile yutuluyor.
        process.Exited += (sender, _) =>
        {
            try
            {
                var exitCode = -1;
                try { exitCode = ((Process)sender!).ExitCode; } catch { /* tanıtıcı zaten kapanmış olabilir */ }
                _logger.LogWarning("Zapret2 (winws2.exe) beklenmedik şekilde durdu (ExitCode={ExitCode})", exitCode);
                _logs.Add($"[tanı] winws2.exe durdu, ExitCode={exitCode}");
            }
            catch { /* bkz. yukarıdaki not */ }
        };

        try
        {
            process.Start();
        }
        catch
        {
            process.Dispose();
            throw;
        }

        _process = process;
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _logger.LogInformation("Zapret2 başlatıldı (args: {Args})", args);

        await Task.Delay(50, ct);
    }

    // GoodbyeDPI/Zapret'teki gibi: fake-packet/TTL tabanlı tekniklerde ilk birkaç bağlantı
    // denemesi geçici olarak sıfırlanıp hemen ardından istikrar kazanabiliyor — tek denemeyle
    // gerçekte çalışan bir adayı haksız yere elemek yerine birkaç kez deniyoruz.
    private const int ConnectivityTestAttempts = 2;
    private static readonly TimeSpan ConnectivityRetryDelay = TimeSpan.FromSeconds(1.5);

    /// <summary>DNS çözümlemesi artık SelfTestResolver ile yapılıyor — ByeDPI'nin (ciadpi.exe)
    /// zaten konuştuğu AYNI yerel EncryptedDnsForwarder'a (bkz. Dns/SelfTestResolver.cs) düz
    /// DNS-wire UDP sorgusu gönderiyor, bu yüzden kullanıcının yapılandırdığı HERHANGİ bir
    /// protokolü (DoH/DoT/DoQ/DNSCrypt) motor-özel kod yazmadan otomatik kullanır (eskiden
    /// burada ZapretEngine'den bağımsız, ayrı bir wire-format DoH istemcisi vardı). WinDivert
    /// sistem geneli çalıştığı için bu sürecin kendi DNS isteği de winws2'nin paket
    /// müdahalesine tabi oluyor (bkz. TestConnectivityAsync).</summary>
    private async Task<bool> TestConnectivityAsync(TimeSpan timeout, string probeUrl)
    {
        for (var attempt = 1; attempt <= ConnectivityTestAttempts; attempt++)
        {
            try
            {
                using var handler = new SocketsHttpHandler
                {
                    ConnectCallback = async (context, ct) =>
                    {
                        var ip = await SelfTestResolver.ResolveAsync(context.DnsEndPoint.Host, ct)
                            ?? throw new InvalidOperationException($"DNS ile {context.DnsEndPoint.Host} çözümlenemedi");
                        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                        try
                        {
                            await socket.ConnectAsync(ip, context.DnsEndPoint.Port, ct);
                            return new NetworkStream(socket, ownsSocket: true);
                        }
                        catch
                        {
                            socket.Dispose();
                            throw;
                        }
                    },
                    // KRİTİK — canlı testte bulunan bir bug: "http://discord.com/app" (bkz.
                    // BuildConnectivityProbeUrl) discord.com'un kendisi tarafından HTTPS'e
                    // (301/302) yönlendiriliyor. AllowAutoRedirect varsayılan olarak true
                    // olduğu için HttpClient bu yönlendirmeyi SESSİZCE takip edip AYNI handler
                    // (yani AYNI, yalnızca port 80'i filtreleyen winws2 stratejisi) üzerinden
                    // port 443'e YENİ bir bağlantı deniyordu — bu strateji 443'e hiç
                    // dokunmadığı için o ikinci bağlantı her zaman "SSL connection could not
                    // be established" ile başarısız oluyordu, port 80 testinin KENDİSİ
                    // aslında geçmiş olsa bile. Yönlendirmeyi TAKİP ETMİYORUZ — amaç zaten
                    // yalnızca "bu strateji altında port 80'e normal bir HTTP isteği
                    // atılabiliyor mu" (blockcheck2'nin curl_test_http'sinin sınadığı ile
                    // birebir aynı şey), 3xx de dahil HERHANGİ bir HTTP yanıtı bunu kanıtlar.
                    AllowAutoRedirect = false,
                };
                using var client = new HttpClient(handler) { Timeout = timeout };
                using var response = await client.GetAsync(probeUrl);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Zapret2 bağlantı testi hatası (deneme {Attempt}/{Max}): {Error}", attempt, ConnectivityTestAttempts, ex.Message);
                _logs.Add($"Bağlantı testi hatası (deneme {attempt}/{ConnectivityTestAttempts}): {ex.Message}");
                if (attempt < ConnectivityTestAttempts) await Task.Delay(ConnectivityRetryDelay);
                continue;
            }
        }
        return false;
    }

    private static IEnumerable<string> SplitArgs(string args) =>
        args.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
