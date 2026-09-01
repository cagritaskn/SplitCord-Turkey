using System.Text.Json;

namespace SplitCord.Service.Config;

public sealed class ServiceSettings
{
    // Otomatik modun giriş noktası — Zapret hem TCP/TLS (metin) hem UDP (ses/WebRTC) trafiğini
    // aynı anda kapsayabildiği için ilk denenen motor (bkz. DpiEngineManager.SwitchToAsync'teki
    // eskalasyon: Zapret -> ByeDPI -> GoodbyeDPI). ByeDPI (SOCKS5, yalnızca bu uygulamanın
    // trafiği) ve GoodbyeDPI sırasıyla ikinci ve son çare olarak devrede.
    public string ActiveEngineId { get; set; } = "zapret";

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

    /// <summary>Bağlantı testini (kısa HTTP isteği) geçtiği için bir kez "doğrulanmış" sayılıp
    /// sonra gerçek discord.com/app sayfası webview'de yüklenemediği bildirilen argüman
    /// dizileri. Otomatik aday taraması bunları bir daha denemez (bkz. ByeDpiEngine.StartAsync).</summary>
    public List<string> ByeDpiRejectedArgs { get; set; } = new();

    /// <summary>ByeDpiRejectedArgs ile aynı mantık, GoodbyeDPI için (bkz. GoodbyeDpiEngine.StartAsync).</summary>
    public List<string> GoodbyeDpiRejectedArgs { get; set; } = new();

    /// <summary>ByeDpiRejectedArgs ile aynı mantık, Zapret için (bkz. ZapretEngine.StartAsync).</summary>
    public List<string> ZapretRejectedArgs { get; set; } = new();

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
    };

    /// <summary>ByeDPI'nin yerel DoH yönlendiricisinin (bkz. DohForwarder.cs) sırayla deneyeceği
    /// DNS-over-HTTPS sunucu uç noktaları. Kullanıcı Ayarlar ekranından değiştirebilir; sırayla
    /// denenir, ilk başarılı olan kullanılır. Boşsa yönlendirici hemen sistem çözümleyicisine
    /// düşer (ByeDpiEngine.cs'teki resolve() fallback'i devreye girer).
    /// Yalnızca bilinen/güvenilir genel DoH sağlayıcıları: Cloudflare (genelde en hızlısı),
    /// Google, Quad9 (güvenlik odaklı), OpenDNS (Cisco), AdGuard'ın FİLTRESİZ (unfiltered)
    /// uç noktası — AdGuard'ın varsayılan uç noktası reklam/izleyici engelliyor, bu da
    /// Discord trafiğini beklenmedik şekilde etkileyebileceğinden bilinçli olarak
    /// filtresiz sürüm seçildi.</summary>
    public List<string> DohProviders { get; set; } = new()
    {
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
    };
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

    // Daha önceki sürümlerde diske yazılmış, yalnızca 2 sağlayıcı içeren eski varsayılan
    // liste — kullanıcı bunu hiç elle değiştirmediyse (diskteki liste hâlâ birebir bu ise)
    // yeni genişletilmiş varsayılana yükseltiyoruz. Kullanıcı listeyi özelleştirdiyse
    // (farklıysa) dokunmuyoruz.
    private static readonly List<string> LegacyDefaultDohProviders = new()
    {
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
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
                    if (loaded.DohProviders.SequenceEqual(LegacyDefaultDohProviders))
                    {
                        loaded.DohProviders = new ServiceSettings().DohProviders;
                    }
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
