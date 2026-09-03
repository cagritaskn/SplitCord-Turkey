namespace SplitCord.Service.Dns;

public enum DnsProtocol
{
    Doh,
    Dot,
    Doq,
    DnsCrypt,
    /// <summary>Aslında DoH (RFC 8484), ama bizim kendi DohUpstream/HttpClient'ımız yerine
    /// bundled nextdns.exe'nin (bkz. NextDnsProxyProcess) KENDİ ağ yığınından geçiyor —
    /// profilsiz/hesapsız, sabit olarak dns.nextdns.io'ya. Kullanıcı talebiyle eklendi:
    /// Vodafone TR'de bizim 6 DoH adresimizin (dns.nextdns.io dahil) HİÇBİRİ çalışmadığında,
    /// resmi NextDNS uygulamasının (farklı/Go tabanlı bir istemci) AYNI sunucuya başarıyla
    /// bağlanabildiği gözlemlendi — bunun istemcinin TLS parmak izinden mi yoksa başka bir
    /// nedenden mi kaynaklandığı kesin değil, bu yüzden deneysel bir ek katman olarak
    /// (Doh girdisinin YANINDA, onun YERİNE değil) tutuluyor.</summary>
    NextDns,
    /// <summary>DoH/DoT/DoQ/DNSCrypt'in dördü de başarısız olursa denenen son "tier" —
    /// EncryptedDnsForwarder'ı hiç zorlamadan (DnsProviders boş bırakılıp) motorun/sistemin
    /// kendi normal DNS çözümlemesine bırakılması (kullanıcı talebi: "No DNS" — bazı
    /// engelleme türleri DNS-tabanlı olmadığı için şifreli DNS hiç gerekmeyebilir, son çare
    /// olarak denenmeye değer). Hiçbir DnsProvider girdisi BU protokolle işaretlenmez — yalnızca
    /// DnsProtocolTiers.Order içinde bir sıra/tier kimliği olarak kullanılır.</summary>
    None,
}

/// <summary>Tek bir şifreli DNS sağlayıcı girişi: protokol + o protokole özgü tek bir adres
/// alanı. DoH: tam "https://.../dns-query" URL'i. DoT/DoQ: "host" ya da "host:port" (port
/// verilmezse <see cref="DnsAddressParser.DefaultTlsPort"/> varsayılır). DNSCrypt:
/// "sdns://..." stamp'i (bkz. DnsCryptUpstream, Faz 3).</summary>
public sealed class DnsProvider
{
    public DnsProtocol Protocol { get; set; }
    public string Address { get; set; } = "";
}

/// <summary>DoT ve DoQ'nun paylaştığı "host" / "host:port" adres ayrıştırması (RFC 7858 ve
/// RFC 9250 ikisi de varsayılan olarak 853 numaralı portu kullanıyor) — ikisinin de aynı
/// mantığı ayrı ayrı yazmaması için tek yerde.</summary>
public static class DnsAddressParser
{
    public const int DefaultTlsPort = 853;

    public static (string Host, int Port) ParseHostPort(string address)
    {
        var trimmed = address.Trim();

        // IPv6 literal "[::1]:853" ya da salt "[::1]" biçimi.
        if (trimmed.StartsWith('['))
        {
            var closeBracket = trimmed.IndexOf(']');
            if (closeBracket > 0)
            {
                var host = trimmed[1..closeBracket];
                if (closeBracket + 2 < trimmed.Length && trimmed[closeBracket + 1] == ':' &&
                    int.TryParse(trimmed[(closeBracket + 2)..], out var portFromBracket))
                {
                    return (host, portFromBracket);
                }
                return (host, DefaultTlsPort);
            }
        }

        var lastColon = trimmed.LastIndexOf(':');
        if (lastColon > 0 && int.TryParse(trimmed[(lastColon + 1)..], out var port))
        {
            return (trimmed[..lastColon], port);
        }

        return (trimmed, DefaultTlsPort);
    }
}
