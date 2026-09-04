using System.Text.Json;
using SplitCord.ServiceLinux.Dns;

namespace SplitCord.ServiceLinux.Config;

/// <summary>Windows karşılığının (service/SplitCordService/Config/SettingsStore.cs) portu.
/// Alan şeması BİREBİR aynı, iki fark: (1) GoodbyeDPI'ye ait alanlar/varsayılanlar yok (bkz.
/// PORTING_PLAN.md D-2 — Linux'ta bu motor hiç yok), (2) Windows tarafındaki eski şema göç
/// mantığı (LegacyDefaultDohProviders/OldDefaultDohProviders/OldDefaultDnsProviderSnapshots) hiç
/// taşınmadı — bunlar Windows'un YILLAR içinde biriken diske-yazılmış eski formatlarını
/// yükseltmek içindi; hiçbir Linux kurulumu bu eski formatlardan hiçbirini hiç yazmadı, bu yüzden
/// taşınacak bir geçmiş yok. Linux tarafı kendi varsayılanıyla başlayıp KENDİ geçmişini
/// biriktirecek (ileride Linux'a özgü bir varsayılan değişikliği olursa, o zaman BURADA yeni bir
/// göç mekanizması eklenir — Windows'takini kopyalamaya gerek yok).</summary>
public sealed class ServiceSettings
{
    // Otomatik modun giriş noktası: Zapret -> Zapret2 -> ByeDPI (bkz. PORTING_PLAN.md D-2).
    public string ActiveEngineId { get; set; } = "zapret";

    /// <summary>Kapalıyken (varsayılan) ByeDPI yalnızca kısa/varsayılan aday listesini tarar.
    /// Açıkken ek topluluk/fuzzer kaynaklı stratejiler de denenir.</summary>
    public bool ByeDpiUseExtendedCandidates { get; set; } = false;

    public bool ByeDpiVerified { get; set; } = false;
    public bool ZapretVerified { get; set; } = false;
    public bool Zapret2Verified { get; set; } = false;

    /// <summary>Zapret2'nin kayıtlı stratejisiyle ham UDP'nin de (ses) gerçekten dışarı
    /// çıkabildiğinin doğrulandığını gösterir.</summary>
    public bool Zapret2VoiceVerified { get; set; } = false;

    public List<string> ByeDpiRejectedArgs { get; set; } = new();
    public List<string> ZapretRejectedArgs { get; set; } = new();
    public List<string> Zapret2RejectedArgs { get; set; } = new();

    /// <summary>Motor id'sine göre kalıcı, kullanıcı tarafından değiştirilebilen ek komut satırı
    /// argümanları. Boş string, motorun kendi varsayılan/keşif davranışını kullanacağı anlamına
    /// gelir. GoodbyeDPI girişi yok (bkz. PORTING_PLAN.md D-2).</summary>
    public Dictionary<string, string> EngineArgs { get; set; } = new()
    {
        ["byedpi"] = "--split 1+s --disorder 2 --auto=torst",
        ["zapret"] = "",
        ["zapret2"] = "",
    };

    /// <summary>Yerel şifreli DNS yönlendiricisinin (bkz. Dns/EncryptedDnsForwarder.cs) sırayla
    /// deneyeceği DNS sağlayıcıları. Windows tarafıyla AYNI varsayılan liste/sıra (bkz.
    /// service/SplitCordService/Config/SettingsStore.cs) — bu, iki platformun bağımsız
    /// geliştirilmiş olmasına rağmen davranışsal olarak tutarlı kalması için bilinçli bir
    /// tercih, kod paylaşımı değil.</summary>
    public List<DnsProvider> DnsProviders { get; set; } = new()
    {
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.google/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://cloudflare-dns.com/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://doh.opendns.com/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://unfiltered.adguard-dns.com/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.quad9.net/dns-query" },
        new() { Protocol = DnsProtocol.Doh, Address = "https://dns.nextdns.io/" },
        new() { Protocol = DnsProtocol.NextDns, Address = "" },
    };

    public bool DnsProtocolVerified { get; set; } = false;
    public DnsProtocol? VerifiedDnsProtocol { get; set; } = null;

    /// <summary>Manuel modun Gelişmiş bölümünden kullanıcının elle sabitlediği DNS protokolü —
    /// null ("Otomatik") ise motorlar kendi DoH→DNSCrypt→DNS'siz tier döngüsünü çalıştırır.</summary>
    public DnsProtocol? ManualDnsProtocol { get; set; } = null;

    public DnsProtocol? Zapret2VerifiedProtocol { get; set; } = null;
    public DnsProtocol? ZapretVerifiedProtocol { get; set; } = null;
    public DnsProtocol? ByeDpiVerifiedProtocol { get; set; } = null;

    /// <summary>Zapret2'nin Otomatik moddaki DNS protokolü tier döngüsünde her bir protokolü
    /// blockcheck2 ile tarama üst sınırı (dakika).</summary>
    public int Zapret2AutomaticTierTimeoutMinutes { get; set; } = 5;

    /// <summary>Aynı, Manuel mod için.</summary>
    public int Zapret2ManualTierTimeoutMinutes { get; set; } = 10;
}

/// <summary>JSON tabanlı, kalıcı basit ayar deposu. Dosya konumu için bkz. LinuxPaths.DataDirectory
/// (Windows'taki %ProgramData%\SplitCord karşılığı, PORTING_PLAN.md D-3).</summary>
public sealed class SettingsStore
{
    private static string FilePath => Path.Combine(LinuxPaths.DataDirectory, "service-settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public ServiceSettings Current { get; private set; }

    private readonly object _lock = new();

    public SettingsStore()
    {
        Current = Load();
    }

    private static ServiceSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                var loaded = JsonSerializer.Deserialize<ServiceSettings>(json);
                if (loaded is not null) return loaded;
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
    /// döner ve hemen diske yazar.</summary>
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
