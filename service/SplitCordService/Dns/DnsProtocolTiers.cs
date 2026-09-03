using SplitCord.Service.Config;

namespace SplitCord.Service.Dns;

/// <summary>Zapret2/Zapret/ByeDPI'nin kendi tarama döngülerini saran DoH→DNSCrypt→(DNS'siz) dış
/// döngüsü için paylaşılan sıra + yardımcı. Her motor kendi StartAsync'inde bu sırayla ilerler:
/// bir tier'i "aktif" yapmak (ApplyTier), motorun KENDİ mevcut tarama mekanizmasını (blockcheck2
/// ya da sabit aday listesi) o tier aktifken baştan çalıştırmak demek — iki ayrı/bağımsız süreç
/// değil, protokol+strateji birlikte aynı gerçek taramadan çıkıyor (kullanıcı talebi).
/// GoodbyeDPI bilerek bu döngünün dışında (DNS'i WinDivert ile paket seviyesinde sabit bir IP'ye
/// yönlendiriyor, EncryptedDnsForwarder'dan hiç geçmiyor — bkz. GoodbyeDpiEngine.cs'teki not).</summary>
public static class DnsProtocolTiers
{
    // DoT ve DoQ kullanıcı talebiyle otomatik taramadan (bu sıradan) ÇIKARILDI: ikisi de sabit
    // 853 portunda çalışıyor, birçok ISP protokole hiç bakmadan bu portu toptan engelliyor --
    // yani gerçek bir ISP engeliyle karşılaşıldığında neredeyse hiç kazanmadan yalnızca tier
    // süresini (Otomatik 5dk/Manuel 10-20dk) boşa harcıyorlardı. DoQ ayrıca QUIC'in ağda genel
    // olarak çalışmasına bağımlı (bkz. ERR_QUIC_PROTOCOL_ERROR ile ilgili not) -- ISP QUIC'e
    // müdahale ediyorsa zaten sistematik olarak başarısız oluyordu. DoH (443, sıradan HTTPS'ten
    // ayırt edilmesi zor) ve DNSCrypt (nadir kullanıldığı için özel hedeflenmesi daha az olası)
    // pratikte gerçekten işe yarayan protokoller. DotUpstream/DoqUpstream ve
    // DnsDefaultProviderPools.Dot/Doq BİLEREK silinmedi -- Manuel > Gelişmiş'ten kullanıcı
    // kendi ağında çalıştığını bildiği bir protokolü hâlâ elle sabitleyebilir (bkz.
    // SettingsStore.ManualDnsProtocol), yalnızca OTOMATİK sıradan çıkarıldı.
    public static readonly DnsProtocol[] Order = { DnsProtocol.Doh, DnsProtocol.DnsCrypt, DnsProtocol.None };
    public static readonly TimeSpan ManualPinnedProtocolTimeout = TimeSpan.FromMinutes(15);

    // ApplyTier'ın DoH tier'ine eklediği ekstra (NextDns) girdi sayısı -- SelfTestResolver.
    // QueryTimeout bunu DnsDefaultProviderPools.Doh.Count'a EKLEYEREK hesaplıyor. Burada TEK
    // bir sabitte tutulmasının nedeni: bu değer güncellenip ApplyTier'daki eklenen girdi
    // sayısı değişirse (ör. ileride ikinci bir deneysel girdi daha eklenirse), SelfTestResolver
    // otomatik olarak doğru toplamı hesaplasın -- CANLI TESTTE BULUNAN BUG (bkz. SelfTestResolver
    // içindeki not): NextDns girdisi eklendiğinde bu sabit GÜNCELLENMEMİŞTİ, DoH tier'i artık
    // gerçekte 7 sağlayıcı deniyorken QueryTimeout hâlâ 6 sağlayıcıya göre (payı SIFIRA indirecek
    // şekilde) hesaplanıyordu -- "yükleme ekranında sık takılma" olarak geri bildirilen
    // regresyonun kök nedeni buydu.
    public const int DohTierExtraEntryCount = 1;

    /// <summary>SettingsStore.DnsProviders'ı verilen protokolün doğrulanmış varsayılan havuzuyla
    /// (bkz. DnsDefaultProviderPools) değiştirip kaydeder — EncryptedDnsForwarder bir sonraki
    /// sorguda bunu otomatik kullanır (ByeDPI'nin ciadpi.exe'si ve Zapret/Zapret2'nin
    /// SelfTestResolver üzerinden yaptığı doğrulama dahil), ayrı bir mekanizma gerekmiyor.</summary>
    public static void ApplyTier(SettingsStore settings, DnsProtocol protocol)
    {
        var providers = DnsDefaultProviderPools.Get(protocol)
            .Select(address => new DnsProvider { Protocol = protocol, Address = address })
            .ToList();

        // DoH tier'ine kullanıcı talebiyle bir istisna: bundled nextdns.exe'yi (bkz.
        // NextDnsProxyProcess) AYNI DoH hedefine (dns.nextdns.io) FARKLI bir istemciyle
        // (Go tabanlı, bizim .NET HttpClient'ımızdan farklı TLS yığını) ulaşan deneysel bir
        // ek yol olarak listenin sonuna ekliyoruz -- Doh girdisinin YERİNE değil, YANINA.
        if (protocol == DnsProtocol.Doh)
        {
            providers.Add(new DnsProvider { Protocol = DnsProtocol.NextDns, Address = "" });
        }

        settings.Current.DnsProviders = providers;
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
