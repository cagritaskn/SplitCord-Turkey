namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/DnsDefaultProviderPools.cs) birebir
/// portu. Bu adresler saf DNS protokolü seviyesinde çalışıyor (işletim sisteminden bağımsız),
/// Windows tarafında canlı testte doğrulanmış aynı liste burada da geçerli sayılıyor — DoH/DNSCrypt
/// sunucularının kendisi platforma göre farklı davranmaz.</summary>
public static class DnsDefaultProviderPools
{
    public static readonly IReadOnlyList<string> Doh = new[]
    {
        // Quad9 canlı testte (Windows) tutarlı şekilde "505 HTTP Version Not Supported"
        // döndürdüğü için AdGuard'ın arkasına alındı.
        "https://dns.google/dns-query",
        "https://cloudflare-dns.com/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
        "https://dns.quad9.net/dns-query",
        // Vodafone TR'de yukarıdaki 5 sağlayıcının TAMAMI başarısız olduğu bir senaryoda
        // profilsiz/hesapsız NextDNS DoH uç noktası çalışıyordu (bkz. NextDnsUpstream).
        "https://dns.nextdns.io/",
    };

    public static readonly IReadOnlyList<string> Dot = new[]
    {
        "1.1.1.1:853",
        "dns.google:853",
        "dns.quad9.net:853",
        "unfiltered.adguard-dns.com:853",
        "family.adguard-dns.com:853",
    };

    public static readonly IReadOnlyList<string> Doq = new[]
    {
        "unfiltered.adguard-dns.com:853",
        "dns.quad9.net:853",
        "family.adguard-dns.com:853",
        "dns.adguard-dns.com:853",
    };

    // Resmi DNSCrypt/dnscrypt-resolvers genel listesinden (github.com/DNSCrypt/dnscrypt-resolvers)
    // çekilen gerçek stamp'ler — Windows tarafıyla AYNI, protokol seviyesinde platforma bağlı değil.
    public static readonly IReadOnlyList<string> DnsCrypt = new[]
    {
        "sdns://AgcAAAAAAAAABzEuMC4wLjEAEmRucy5jbG91ZGZsYXJlLmNvbQovZG5zLXF1ZXJ5",
        "sdns://AgUAAAAAAAAABzguOC44LjggalBisNF41VbxY7E7Gw8ZQ10CWIKRzHVYnf7m6xHI1cMHOC44LjguOAovZG5zLXF1ZXJ5",
        "sdns://AQMAAAAAAAAADDkuOS45Ljk6ODQ0MyBnyEe4yHWM0SAkVUO-dWdG3zTfHYTAC4xHA2jfgh2GPhkyLmRuc2NyeXB0LWNlcnQucXVhZDkubmV0",
        "sdns://AQMAAAAAAAAAETk0LjE0MC4xNC4xNDo1NDQzINErR_JS3PLCu_iZEIbq95zkSV2LFsigxDIuUso_OQhzIjIuZG5zY3J5cHQuZGVmYXVsdC5uczEuYWRndWFyZC5jb20",
        "sdns://AQMAAAAAAAAAETk0LjE0MC4xNC4xNTo1NDQzILgxXdexS27jIKRw3C7Wsao5jMnlhvhdRUXWuMm1AFq6ITIuZG5zY3J5cHQuZmFtaWx5Lm5zMS5hZGd1YXJkLmNvbQ",
    };

    public static IReadOnlyList<string> Get(DnsProtocol protocol) => protocol switch
    {
        DnsProtocol.Doh => Doh,
        DnsProtocol.Dot => Dot,
        DnsProtocol.Doq => Doq,
        DnsProtocol.DnsCrypt => DnsCrypt,
        // NextDns'in kendi havuzu yok -- ApplyTier'da DoH tier'ine EK bir girdi olarak
        // özel durum ile ekleniyor.
        DnsProtocol.NextDns => Array.Empty<string>(),
        DnsProtocol.None => Array.Empty<string>(),
        _ => throw new ArgumentOutOfRangeException(nameof(protocol)),
    };
}
