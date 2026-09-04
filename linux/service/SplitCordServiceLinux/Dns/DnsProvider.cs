namespace SplitCord.ServiceLinux.Dns;

// Windows karşılığının (service/SplitCordService/Dns/DnsProvider.cs) birebir portu — hiçbir
// platforma özgü kod içermiyor, yalnızca namespace değişti.

public enum DnsProtocol
{
    Doh,
    Dot,
    Doq,
    DnsCrypt,
    /// <summary>Aslında DoH (RFC 8484), ama bundled nextdns'in (bkz. NextDnsProxyProcess) KENDİ
    /// ağ yığınından geçiyor — profilsiz/hesapsız, sabit olarak dns.nextdns.io'ya.</summary>
    NextDns,
    /// <summary>DoH/DNSCrypt'in ikisi de başarısız olursa denenen son "tier" — EncryptedDnsForwarder'ı
    /// hiç zorlamadan motorun/sistemin kendi normal DNS çözümlemesine bırakılması.</summary>
    None,
}

/// <summary>Tek bir şifreli DNS sağlayıcı girişi: protokol + o protokole özgü tek bir adres alanı.</summary>
public sealed class DnsProvider
{
    public DnsProtocol Protocol { get; set; }
    public string Address { get; set; } = "";
}

/// <summary>DoT ve DoQ'nun paylaştığı "host" / "host:port" adres ayrıştırması.</summary>
public static class DnsAddressParser
{
    public const int DefaultTlsPort = 853;

    public static (string Host, int Port) ParseHostPort(string address)
    {
        var trimmed = address.Trim();

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
