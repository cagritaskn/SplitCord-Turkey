using SplitCord.ServiceLinux.Config;

namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/DnsProtocolTiers.cs) birebir
/// portu — Zapret2/Zapret/ByeDPI'nin kendi tarama döngülerini saran DoH→DNSCrypt→(DNS'siz) dış
/// döngüsü için paylaşılan sıra + yardımcı. Linux'ta GoodbyeDPI hiç yok (bkz. PORTING_PLAN.md
/// D-2), bu yüzden "GoodbyeDPI bu döngünün dışında" notu burada anlamsız — 3 motorun ÜÇÜ de bu
/// döngüye giriyor.</summary>
public static class DnsProtocolTiers
{
    // DoT ve DoQ otomatik taramadan bilerek ÇIKARILDI (Windows tarafındaki AYNI gerekçe: sabit
    // 853 portu birçok ISP tarafından toptan engelleniyor). DotUpstream/DoqUpstream ve
    // DnsDefaultProviderPools.Dot/Doq BİLEREK silinmedi — Manuel > Gelişmiş'ten kullanıcı elle
    // sabitleyebilir, yalnızca OTOMATİK sıradan çıkarıldı.
    public static readonly DnsProtocol[] Order = { DnsProtocol.Doh, DnsProtocol.DnsCrypt, DnsProtocol.None };
    public static readonly TimeSpan ManualPinnedProtocolTimeout = TimeSpan.FromMinutes(15);

    // ApplyTier'ın DoH tier'ine eklediği ekstra (NextDns) girdi sayısı — SelfTestResolver.
    // QueryTimeout bunu DnsDefaultProviderPools.Doh.Count'a EKLEYEREK hesaplıyor (bkz.
    // SelfTestResolver.cs'teki not — Windows tarafında canlı testte bulunan bir margin bug'ının
    // aynısına buradan da düşmemek için tek bir sabitte tutuluyor).
    public const int DohTierExtraEntryCount = 1;

    /// <summary>SettingsStore.DnsProviders'ı verilen protokolün doğrulanmış varsayılan havuzuyla
    /// (bkz. DnsDefaultProviderPools) değiştirip kaydeder — EncryptedDnsForwarder bir sonraki
    /// sorguda bunu otomatik kullanır.</summary>
    public static void ApplyTier(SettingsStore settings, DnsProtocol protocol)
    {
        var providers = DnsDefaultProviderPools.Get(protocol)
            .Select(address => new DnsProvider { Protocol = protocol, Address = address })
            .ToList();

        if (protocol == DnsProtocol.Doh)
        {
            providers.Add(new DnsProvider { Protocol = DnsProtocol.NextDns, Address = "" });
        }

        settings.Current.DnsProviders = providers;
        settings.Current.VerifiedDnsProtocol = protocol;
        settings.Save();
    }

    /// <summary>DnsProtocol.None tier'i ApplyTier ile DnsProviders'ı BİLEREK boşaltır. None
    /// tier'i denendikten SONRA (kazandı ya da kazanmadı fark etmeksizin) her zaman çağrılmalı.</summary>
    public static void RestoreDefaultAfterNoneTier(SettingsStore settings)
    {
        if (settings.Current.DnsProviders.Count == 0)
        {
            ApplyTier(settings, DnsProtocol.Doh);
        }
    }
}

/// <summary>Zapret2/Zapret/ByeDPI'nin ortak uyguladığı arayüz: DpiEngineManager.SwitchToAsync,
/// hedef motoru başlatmadan hemen önce IsManualActivation'ı allowEscalation'a göre ayarlıyor.</summary>
public interface IDnsTierAware
{
    bool IsManualActivation { get; set; }
}
