namespace SplitCord.Service.Dns;

/// <summary>Her protokol için bilinen/güvenilir varsayılan sağlayıcı havuzu — canlı testte
/// (127.0.0.1:53535'e ham DNS-wire UDP sorgusu) tek tek doğrulandı, DnsProtocolScanner'ın
/// otomatik tarayacağı adaylar bunlar. DoH listesi zaten SettingsStore'daki eski varsayılanla
/// birebir aynı (değiştirilmedi).</summary>
public static class DnsDefaultProviderPools
{
    public static readonly IReadOnlyList<string> Doh = new[]
    {
        // Kullanıcı talebiyle Quad9 AdGuard'ın arkasına alındı: canlı testte, Quad9'un DoH
        // uç noktası bizim isteklerimize tutarlı şekilde "505 HTTP Version Not Supported"
        // ile yanıt veriyordu (yavaş bir zaman aşımı değil, hızlı ama HER SEFERİNDE
        // başarısız bir yanıt) — listenin başında olduğu için her çözümleme bu garantili
        // başarısızlıkla başlayıp bir sonrakine düşüyordu. Sıralamada en arkaya değil,
        // AdGuard'ın hemen ardına alındı ki tamamen işe yaramaz sayılmasın.
        "https://dns.google/dns-query",
        "https://cloudflare-dns.com/dns-query",
        "https://doh.opendns.com/dns-query",
        "https://unfiltered.adguard-dns.com/dns-query",
        "https://dns.quad9.net/dns-query",
        // Kullanıcı talebiyle eklendi: Vodafone TR'de yukarıdaki 5 sağlayıcının TAMAMI
        // başarısız olurken NextDNS'in kendi altyapısı (kullanıcı NextDNS'i sistem geneli
        // çalıştırdığında) çalışıyordu. Kaynak kodu incelendi (github.com/nextdns/nextdns,
        // run.go) ve canlı olarak doğrulandı: profil ID GEREKMİYOR -- profilsiz istek
        // "https://dns.nextdns.io/"e gidiyor ve düz, hesapsız/ücretsiz bir RFC 8484 DoH
        // sunucusu gibi yanıt veriyor (curl ile ham DoH sorgusu gönderilip discord.com için
        // gerçek A kayıtları alındı, HTTP 200). Ek bir binary/süreç GEREKMİYOR -- bizim
        // DohUpstream'imiz zaten aynı protokolü konuşuyor, yalnızca listeye bir adres daha.
        // Listenin SONUNA eklendi: mevcut 5 sağlayıcı zaten kanıtlanmış/varsayılan, bu yalnızca
        // hepsi engellendiğinde devreye giren EK bir yedek.
        "https://dns.nextdns.io/",
    };

    // NOT: cloudflare-dns.com (hostname) canlı testte DoT'ta zaman aşımına uğradı, ama aynı
    // sunucunun düz IP'si (1.1.1.1) çalıştı — bu makinedeki sistem çözümleyicisinin
    // (DotUpstream sunucu hostname'ini SİSTEM DNS'i ile çözüyor, kendi forwarder'ımızla değil
    // — aksi hâlde çözümleme için çözümleyiciye ihtiyaç duyan bir döngü olurdu) bu hostname'i
    // çözmekte sorun yaşadığının bir göstergesi. Bu yüzden DoT/DoQ varsayılanlarında mümkün
    // olduğunca düz IP tercih ediliyor.
    public static readonly IReadOnlyList<string> Dot = new[]
    {
        "1.1.1.1:853",
        "dns.google:853",
        "dns.quad9.net:853",
        "unfiltered.adguard-dns.com:853",
        "family.adguard-dns.com:853",
    };

    // NOT: Cloudflare'in DoQ'su (hem hostname hem düz IP 1.1.1.1 ile) canlı testte İKİSİNDE
    // DE başarısız oldu (DoT'un aksine, bu hostname çözümleme sorunu değil — Cloudflare'in
    // bu ağda QUIC:853 üzerinden gerçekten erişilemez olduğunun göstergesi). Bu yüzden
    // Cloudflare listeye alınmadı; yalnızca canlı testte GERÇEKTEN çalıştığı doğrulanan 4
    // adres var (5 değil — sahte bir 5. adres eklemek yerine dürüst kalındı).
    public static readonly IReadOnlyList<string> Doq = new[]
    {
        "unfiltered.adguard-dns.com:853",
        "dns.quad9.net:853",
        "family.adguard-dns.com:853",
        "dns.adguard-dns.com:853",
    };

    // Resmi DNSCrypt/dnscrypt-resolvers genel listesinden (github.com/DNSCrypt/dnscrypt-resolvers)
    // çekilen gerçek stamp'ler, canlı testte tek tek doğrulandı.
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
        // özel durum ile ekleniyor (bkz. DnsProtocolTiers.ApplyTier), "Address" alanı da
        // kullanılmıyor (NextDnsUpstream sabit olarak profilsiz nextdns.exe'ye gidiyor).
        DnsProtocol.NextDns => Array.Empty<string>(),
        // "No DNS" tier'inin havuzu yok -- bkz. DnsProtocolTiers.ApplyTier'daki özel durum.
        DnsProtocol.None => Array.Empty<string>(),
        _ => throw new ArgumentOutOfRangeException(nameof(protocol)),
    };
}
