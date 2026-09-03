using SplitCord.Service.Config;

namespace SplitCord.Service.Dns;

/// <summary>Zapret2/Zapret/ByeDPI'nin kendi tarama döngülerini saran DoH→DoT→DoQ→DNSCrypt dış
/// döngüsü için paylaşılan sıra + yardımcı. Her motor kendi StartAsync'inde bu sırayla ilerler:
/// bir tier'i "aktif" yapmak (ApplyTier), motorun KENDİ mevcut tarama mekanizmasını (blockcheck2
/// ya da sabit aday listesi) o tier aktifken baştan çalıştırmak demek — iki ayrı/bağımsız süreç
/// değil, protokol+strateji birlikte aynı gerçek taramadan çıkıyor (kullanıcı talebi).
/// GoodbyeDPI bilerek bu döngünün dışında (DNS'i WinDivert ile paket seviyesinde sabit bir IP'ye
/// yönlendiriyor, EncryptedDnsForwarder'dan hiç geçmiyor — bkz. GoodbyeDpiEngine.cs'teki not).</summary>
public static class DnsProtocolTiers
{
    // Sıra kullanıcı talebiyle belirlendi: DoH, DNSCrypt, DoT, DoQ, son çare olarak hiç DNS
    // zorlamadan (None -- bkz. DnsProtocol.None'daki not) motorun/sistemin kendi normal
    // çözümlemesine bırakma.
    public static readonly DnsProtocol[] Order = { DnsProtocol.Doh, DnsProtocol.DnsCrypt, DnsProtocol.Dot, DnsProtocol.Doq, DnsProtocol.None };
    public static readonly TimeSpan ManualPinnedProtocolTimeout = TimeSpan.FromMinutes(15);

    /// <summary>SettingsStore.DnsProviders'ı verilen protokolün doğrulanmış varsayılan havuzuyla
    /// (bkz. DnsDefaultProviderPools) değiştirip kaydeder — EncryptedDnsForwarder bir sonraki
    /// sorguda bunu otomatik kullanır (ByeDPI'nin ciadpi.exe'si ve Zapret/Zapret2'nin
    /// SelfTestResolver üzerinden yaptığı doğrulama dahil), ayrı bir mekanizma gerekmiyor.</summary>
    public static void ApplyTier(SettingsStore settings, DnsProtocol protocol)
    {
        settings.Current.DnsProviders = DnsDefaultProviderPools.Get(protocol)
            .Select(address => new DnsProvider { Protocol = protocol, Address = address })
            .ToList();
        settings.Current.VerifiedDnsProtocol = protocol;
        settings.Save();
    }

    /// <summary>DnsProtocol.None tier'i (kullanıcı talebi: "No DNS") ApplyTier ile
    /// DnsProviders'ı BİLEREK boşaltır — EncryptedDnsForwarder'ın hiç zorlanmadan motorun/
    /// sistemin kendi normal çözümlemesine düşmesini test etmek için. Ama DnsProviders PAYLAŞILAN
    /// ve KALICI bir ayar: yalnızca o an taranan motoru değil, EncryptedDnsForwarder'a bağlı HER
    /// ŞEYİ (diğer motorların kendi taramaları, Electron'un secureDns.js'i vb.) etkiliyor. None
    /// tier'i kazanırsa (ya da tükenip bir sonraki motora/GoodbyeDPI'ye — ki o bu döngüye hiç
    /// girmiyor — eskalasyon olursa) boş bırakılırsa şifreli DNS sessizce süresiz kapalı kalır.
    /// Bu yüzden None tier'i denendikten SONRA (kazandı ya da kazanmadı fark etmeksizin) her
    /// zaman çağrılmalı — kullanıcı talebi: "sonraki aşım yöntemlerinde tekrar devreye girmeli".</summary>
    public static void RestoreDefaultAfterNoneTier(SettingsStore settings)
    {
        if (settings.Current.DnsProviders.Count == 0)
        {
            ApplyTier(settings, DnsProtocol.Doh);
        }
    }
}

/// <summary>Zapret2/Zapret/ByeDPI'nin ortak uyguladığı arayüz: DpiEngineManager.SwitchToAsync,
/// hedef motoru başlatmadan hemen önce IsManualActivation'ı allowEscalation'a göre ayarlıyor
/// (true=Otomatik giriş noktası → false; false=Manuel açık seçim → true). Motor bunu hem tier
/// başına üst sınırı belirlemek (Zapret2: Manuel'de 10dk/Otomatik'te 5dk) hem de kullanıcının
/// Manuel > Gelişmiş'ten sabitlediği tek bir DNS protokolü varsa (bkz. SettingsStore.
/// ManualDnsProtocol) 4 tier'lik döngüyü atlayıp yalnızca o protokolü denemek için kullanır.
/// GoodbyeDPI bilerek bunu uygulamıyor (DNS tier döngüsünün tamamen dışında).</summary>
public interface IDnsTierAware
{
    bool IsManualActivation { get; set; }
}
