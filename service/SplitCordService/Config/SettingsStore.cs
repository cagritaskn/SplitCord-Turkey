using System.Text.Json;
using SplitCord.Service.Dns;

namespace SplitCord.Service.Config;

public sealed class ServiceSettings
{
    // Otomatik modun giriş noktası — Zapret2 (blockcheck2 ile otomatik strateji keşfi +
    // ses/UDP doğrulaması, bkz. Zapret2Engine) hem TCP/TLS (metin) hem UDP (ses/WebRTC)
    // trafiğini kapsayabildiği için ilk denenen motor (bkz. DpiEngineManager.SwitchToAsync'teki
    // eskalasyon: Zapret2 -> Zapret -> ByeDPI -> GoodbyeDPI). Zapret, ByeDPI ve GoodbyeDPI
    // sırasıyla ikinci, üçüncü ve son çare olarak devrede.
    public string ActiveEngineId { get; set; } = "zapret2";

    /// <summary>Kapalıyken (varsayılan) ByeDPI yalnızca 9 kişilik kısa/varsayılan aday
    /// listesini tarar. Açıkken bunun ardından ~1000 ek topluluk/fuzzer kaynaklı strateji
    /// de denenir — kapsam artar ama tarama süresi (özellikle hiçbiri çalışmıyorsa) önemli
    /// ölçüde uzayabilir (bkz. ByeDpiEngine.GetCandidateStrategies).</summary>
    public bool ByeDpiUseExtendedCandidates { get; set; } = false;

    /// <summary>true olduğunda ByeDpiEngine, EngineArgs["byedpi"]'nin gerçekten discord.com'a
    /// erişim sağladığı daha önce test edilip doğrulandığını, adaylar arasında yeniden arama
    /// yapmadan doğrudan bu argümanlarla başlayabileceğini bilir. Kullanıcı Ayarlar'dan elle
    /// argüman değiştirdiğinde (bkz. DpiEngineManager.UpdateArgsAsync) tekrar false'a döner.</summary>
    public bool ByeDpiVerified { get; set; } = false;

    /// <summary>ByeDpiVerified ile aynı mantık, GoodbyeDPI için: true olduğunda
    /// EngineArgs["goodbyedpi"]'nin daha önce test edilip gerçekten discord.com'a erişim
    /// sağladığı biliniyor, aday taraması tekrarlanmaz (bkz. GoodbyeDpiEngine.StartAsync).</summary>
    public bool GoodbyeDpiVerified { get; set; } = false;

    /// <summary>ByeDpiVerified ile aynı mantık, Zapret için (bkz. ZapretEngine.StartAsync).</summary>
    public bool ZapretVerified { get; set; } = false;

    /// <summary>ByeDpiVerified ile aynı mantık, Zapret2 için (bkz. Zapret2Engine.StartAsync) —
    /// yalnızca metin/TLS bağlantısının doğrulandığını gösterir, ses için ayrıca bkz.
    /// <see cref="Zapret2VoiceVerified"/>.</summary>
    public bool Zapret2Verified { get; set; } = false;

    /// <summary>Zapret2'nin kayıtlı stratejisiyle STUN Binding Request/Response üzerinden ham
    /// UDP'nin de gerçekten dışarı çıkabildiğinin (Discord sesli kanalının kurulabilir
    /// olduğunun bir göstergesi) doğrulandığını gösterir (bkz. Zapret2Engine.VerifyVoiceAsync).
    /// false ise strateji yalnızca metin/TLS için doğrulanmış demektir, ses belirsizdir.</summary>
    public bool Zapret2VoiceVerified { get; set; } = false;

    /// <summary>Bağlantı testini (kısa HTTP isteği) geçtiği için bir kez "doğrulanmış" sayılıp
    /// sonra gerçek discord.com/app sayfası webview'de yüklenemediği bildirilen argüman
    /// dizileri. Otomatik aday taraması bunları bir daha denemez (bkz. ByeDpiEngine.StartAsync).</summary>
    public List<string> ByeDpiRejectedArgs { get; set; } = new();

    /// <summary>ByeDpiRejectedArgs ile aynı mantık, GoodbyeDPI için (bkz. GoodbyeDpiEngine.StartAsync).</summary>
    public List<string> GoodbyeDpiRejectedArgs { get; set; } = new();

    /// <summary>ByeDpiRejectedArgs ile aynı mantık, Zapret için (bkz. ZapretEngine.StartAsync).</summary>
    public List<string> ZapretRejectedArgs { get; set; } = new();

    /// <summary>ByeDpiRejectedArgs ile aynı mantık, Zapret2 için (bkz. Zapret2Engine.StartAsync).</summary>
    public List<string> Zapret2RejectedArgs { get; set; } = new();

    /// <summary>Motor id'sine göre kalıcı, kullanıcı tarafından Ayarlar ekranından değiştirilebilen
    /// ek komut satırı argümanları. Zapret için boş string, motorun kendi gömülü resmi Discord
    /// stratejisini (bkz. ZapretEngine.BuildDefaultDiscordStrategyArgs) kullanacağı anlamına gelir.</summary>
    public Dictionary<string, string> EngineArgs { get; set; } = new()
    {
        ["byedpi"] = "--split 1+s --disorder 2 --auto=torst",
        // NOT: goodbyedpi-0.2.2.zip release binary'si yalnızca -1..-6 modesetlerini destekliyor
        // (ana branch README'si daha yeni bir geliştirme sürümünün -7..-9/--wrong-chksum
        // seçeneklerini belgeliyor, ama pinlenmiş 0.2.2 release'inde bu seçenekler yok —
        // gerçek binary ile doğrulanmadan sadece dokümantasyona güvenilmemeli).
        // -5, binary'nin kendi --help çıktısında "(this is the default)" olarak işaretli.
        ["goodbyedpi"] = "-5",
        ["zapret"] = "",
        // Zapret2 için boş string, blockcheck2'nin ilk açılışta bir strateji keşfedeceği
        // anlamına gelir (bkz. Zapret2Engine.StartAsync) — Zapret'in kendi boş-string
        // davranışıyla aynı.
        ["zapret2"] = "",
    };

    /// <summary>Yerel şifreli DNS yönlendiricisinin (bkz. EncryptedDnsForwarder.cs) sırayla
    /// deneyeceği DNS sağlayıcıları — DoH/DoT/DoQ/DNSCrypt karışık olabilir. Kullanıcı
    /// Ayarlar ekranından değiştirebilir; sırayla denenir, ilk başarılı olan kullanılır.
    /// Boşsa yönlendirici hemen çağıranın kendi sistem çözümleyicisine düşmesine izin verir
    /// (ByeDpiEngine.cs'teki resolve() fallback'i devreye girer).
    /// Varsayılan liste yalnızca bilinen/güvenilir genel DoH sağlayıcıları: Cloudflare
    /// (genelde en hızlısı), Google, Quad9 (güvenlik odaklı), OpenDNS (Cisco), AdGuard'ın
    /// FİLTRESİZ (unfiltered) uç noktası — AdGuard'ın varsayılan uç noktası reklam/izleyici
    /// engelliyor, bu da Discord trafiğini beklenmedik şekilde etkileyebileceğinden
    /// bilinçli olarak filtresiz sürüm seçildi. DoT/DoQ/DNSCrypt sağlayıcılar kullanıcı
    /// tarafından elle eklenebilir.</summary>
    public List<DnsProvider> DnsProviders { get; set; } = new()
    {
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.quad9.net/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.google/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://cloudflare-dns.com/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://doh.opendns.com/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://unfiltered.adguard-dns.com/dns-query" },
        // bkz. DnsDefaultProviderPools.Doh'taki aynı not -- profilsiz/hesapsız, canlı
        // doğrulanmış bir yedek DoH sunucusu.
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.nextdns.io/" },
    };

    /// <summary>true olduğunda DnsProtocolScanner'ın (bkz. Dns/DnsProtocolScanner.cs) bu ağda
    /// hangi şifreli DNS protokolünün çalıştığını bir kez keşfedip DnsProviders'ı buna göre
    /// güncellediği biliniyor — bir daha bu tarama yapılmaz (ByeDpiVerified ile aynı mantık).
    /// Kullanıcı Ayarlar'dan DnsProviders'ı elle değiştirirse bu bayrak DOKUNULMAZ (tarama
    /// yalnızca hiç çalışmamışsa devreye girer).</summary>
    public bool DnsProtocolVerified { get; set; } = false;

    /// <summary>DnsProtocolVerified true olduğunda taramayı kazanan protokol — yalnızca
    /// bilgi/tanılama amaçlı (ör. kazanan DoH ise Zapret2Engine bunu blockcheck2'nin kendi
    /// DOH_SERVERS/SECURE_DNS ayarına da yansıtmak için okuyor, bkz. Zapret2Engine.cs).</summary>
    public DnsProtocol? VerifiedDnsProtocol { get; set; } = null;

    /// <summary>Manuel modun Gelişmiş bölümünden kullanıcının elle sabitlediği DNS protokolü —
    /// null ("Otomatik") ise Zapret2/Zapret/ByeDPI kendi DoH→DoT→DoQ→DNSCrypt 4 tier'lik
    /// döngüsünü olduğu gibi çalıştırır. Bir değer sabitlenmişse (yalnızca IsManualActivation
    /// true iken, yani Manuel modda etkili — bkz. IDnsTierAware) motorlar 4 tier'i denemek
    /// yerine YALNIZCA bu protokolü kullanır (bkz. Dns/DnsProtocolTiers.ManualPinnedProtocolTimeout
    /// — Zapret2/blockcheck2 için 15 dakikalık üst sınır, diğer motorlarda sabit aday listesi
    /// zaten kendiliğinden sonlandığı için üst sınıra gerek yok). GoodbyeDPI bu ayardan
    /// etkilenmez (DNS tier döngüsünün tamamen dışında).</summary>
    public DnsProtocol? ManualDnsProtocol { get; set; } = null;

    /// <summary>Kayıtlı EngineArgs[engineId] stratejisinin HANGİ DNS protokolüyle birlikte
    /// doğrulandığı — VerifiedDnsProtocol'den (tek, paylaşılan, "en son hangi motor hangi
    /// protokolü denedi" bilgisini tutan alan) FARKLI olarak, HER MOTOR KENDİ kombosunu ayrı
    /// hatırlıyor. Kullanıcı talebi: kayıtlı bir ayar varsa (ister Otomatik ister Manuel modda)
    /// motor DOĞRUDAN bu ayar+protokol KOMBOSUYLA başlatılmalı — yalnızca argüman string'ini
    /// değil, hangi DnsProviders tier'iyle birlikte doğrulandığını da. Bu alan olmadan, ARADA
    /// başka bir motor (ör. ByeDPI) kendi tier döngüsüyle paylaşılan DnsProviders'ı
    /// DEĞİŞTİRMİŞSE, bu motorun kayıtlı ayarı YANLIŞ bir DNS protokolüyle yeniden denenip
    /// (aslında çalışan bir kombinasyon) haksız yere başarısız sayılabilirdi. StartAsync'teki
    /// kayıtlı-ayar hızlı yolu, denemeden ÖNCE DnsProviders'ı bu alana göre yeniden kuruyor.</summary>
    public DnsProtocol? Zapret2VerifiedProtocol { get; set; } = null;

    /// <summary>Zapret2VerifiedProtocol ile aynı mantık, Zapret için.</summary>
    public DnsProtocol? ZapretVerifiedProtocol { get; set; } = null;

    /// <summary>Zapret2VerifiedProtocol ile aynı mantık, ByeDPI için.</summary>
    public DnsProtocol? ByeDpiVerifiedProtocol { get; set; } = null;

    /// <summary>Zapret2'nin Otomatik moddaki (allowEscalation=true, yani IsManualActivation=false)
    /// DNS protokolü tier döngüsünde HER bir protokolü blockcheck2 ile tarama üst sınırı
    /// (dakika) — kullanıcı talebi: Ayarlar > DPI Aşımı > Gelişmiş'ten 5-60 dakika arasında
    /// özelleştirilebilir bir slider ile ayarlanıyor. Varsayılan 5 (eski sabit değerle aynı).</summary>
    public int Zapret2AutomaticTierTimeoutMinutes { get; set; } = 5;

    /// <summary>Zapret2AutomaticTierTimeoutMinutes ile aynı mantık, Manuel mod
    /// (IsManualActivation=true) için. Varsayılan 10 (eski sabit değerle aynı).</summary>
    public int Zapret2ManualTierTimeoutMinutes { get; set; } = 10;
}

/// <summary>JSON tabanlı, %ProgramData%\SplitCord altında kalıcı basit ayar deposu.
/// SYSTEM oturumunda çalışan servis için kullanıcı profiline değil ortak makine
/// dizinine yazmak gerekiyor.</summary>
public sealed class SettingsStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "SplitCord",
        "service-settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public ServiceSettings Current { get; private set; }

    private readonly object _lock = new();

    public SettingsStore()
    {
        Current = Load();
    }

    // Daha önceki sürümlerde diske yazılmış, yalnızca 2 sağlayıcı içeren ÇOK eski varsayılan
    // liste (DohProviders: List<string> şemasındayken).
    private static readonly List<string> LegacyDefaultDohProviders = new()
    {
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
    };

    // DohProviders'ın (List<string>) DnsProviders'a (List<DnsProvider>) tipli hale
    // getirilmeden HEMEN ÖNCEKİ 5'li varsayılan listesi — bu da artık "eski" sayılıyor.
    private static readonly List<string> OldDefaultDohProviders = new()
    {
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
    };

    // Kullanıcı talebiyle DnsProviders varsayılan SIRASI değişti (Quad9, Google, Cloudflare,
    // OpenDNS, AdGuard) -- typed DnsProviders şemasındaki HEMEN ÖNCEKİ sıra, bkz. Load()'daki
    // aynı desenle (OldDefaultDohProviders) çalışan yükseltme kontrolü.
    private static readonly List<string> OldDefaultDnsProviderOrder = new()
    {
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
    };

    // Yukarıdaki sıra değişikliğinden HEMEN SONRA, dns.nextdns.io eklenmeden ÖNCEKİ 5'li liste
    // (Quad9 önce) -- bu iki eski liste, UpgradeDefaultDnsProviderOrder'da AYRI AYRI kontrol
    // edilip ikisi de doğrudan GÜNCEL (6'lı) varsayılana yükseltiliyor.
    private static readonly List<string> PreNextDnsDohOrder = new()
    {
        "https://dns.quad9.net/dns-query",
        "https://dns.google/dns-query",
        "https://cloudflare-dns.com/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
    };

    private static ServiceSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                var loaded = JsonSerializer.Deserialize<ServiceSettings>(json);
                if (loaded is not null)
                {
                    MigrateLegacyDohProviders(loaded, json);
                    UpgradeDefaultDnsProviderOrder(loaded);
                    return loaded;
                }
            }
        }
        catch
        {
            // Bozuk/okunamayan ayar dosyası -> varsayılanlara dön.
        }
        return new ServiceSettings();
    }

    /// <summary>Eski şema (List&lt;string&gt; "DohProviders", hepsi https:// URL'i) yeni tipli
    /// şemaya (List&lt;DnsProvider&gt; "DnsProviders") geçmeden önce yazılmış bir ayar dosyası
    /// olabilir. System.Text.Json bilmediği "DohProviders" alanını SESSİZCE yok sayıp
    /// DnsProviders'ı alan başlatıcısındaki (yeni) varsayılanda bırakır — bu da kullanıcının
    /// özelleştirdiği listeyi sessizce KAYBEDER. Bunu önlemek için dosyayı ayrıca ham
    /// JsonDocument olarak da okuyup eski "DohProviders" alanı varsa elle taşıyoruz.</summary>
    private static void MigrateLegacyDohProviders(ServiceSettings loaded, string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("DohProviders", out var legacyProp) || legacyProp.ValueKind != JsonValueKind.Array)
        {
            return; // zaten yeni şema (ya da hiç DohProviders yok) -- yapılacak bir şey yok
        }

        var legacyUrls = legacyProp.EnumerateArray()
            .Select(e => e.GetString())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!)
            .ToList();

        if (legacyUrls.SequenceEqual(LegacyDefaultDohProviders) || legacyUrls.SequenceEqual(OldDefaultDohProviders))
        {
            // Kullanıcı hiç özelleştirmemiş -- yeni tipli varsayılana yükselt.
            loaded.DnsProviders = new ServiceSettings().DnsProviders;
        }
        else
        {
            // Kullanıcı özelleştirmiş -- her URL'i kaybetmeden DoH tipli girişe sarmalıyoruz
            // (eski şema zaten yalnızca https:// URL'lerini kabul ediyordu, bkz.
            // LocalApiEndpoints'teki eski doğrulama).
            loaded.DnsProviders = legacyUrls.Select(u => new DnsProvider { Protocol = DnsProtocol.Doh, Address = u }).ToList();
        }
    }

    /// <summary>MigrateLegacyDohProviders'daki AYNI desen, typed DnsProviders şeması için:
    /// kullanıcı listeyi hiç özelleştirmemişse (hâlâ bilinen ESKİ varsayılanlardan birinde
    /// duruyorsa) GÜNCEL varsayılana yükseltir. Kullanıcı sırayı/listeyi değiştirmişse
    /// DOKUNULMAZ.</summary>
    private static void UpgradeDefaultDnsProviderOrder(ServiceSettings loaded)
    {
        var addresses = loaded.DnsProviders
            .Where(p => p.Protocol == DnsProtocol.Doh)
            .Select(p => p.Address)
            .ToList();

        if (loaded.DnsProviders.Count != addresses.Count) return; // DoH dışı bir giriş var, elle özelleştirilmiş

        if (addresses.SequenceEqual(OldDefaultDnsProviderOrder) || addresses.SequenceEqual(PreNextDnsDohOrder))
        {
            loaded.DnsProviders = new ServiceSettings().DnsProviders;
        }
    }

    public void Save()
    {
        lock (_lock)
        {
            var dir = Path.GetDirectoryName(FilePath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, JsonOptions));
        }
    }

    /// <summary>Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" için — fabrika varsayılanlarına
    /// döner ve hemen diske yazar (motor durdurma/yeniden aktifleştirme çağıranın, yani
    /// DpiEngineManager.ResetSettingsAsync'in sorumluluğunda).</summary>
    public void Reset()
    {
        lock (_lock)
        {
            Current = new ServiceSettings();
            var dir = Path.GetDirectoryName(FilePath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, JsonOptions));
        }
    }
}
