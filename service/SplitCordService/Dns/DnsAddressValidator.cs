using System.Text.RegularExpressions;

namespace SplitCord.Service.Dns;

/// <summary>
/// GÜVENLİK: Kullanıcı tanımlı DNS sağlayıcı adreslerini doğrular. DoH adresleri, SYSTEM
/// olarak çalışan blockcheck2.sh betiğine DOH_SERVERS ortam değişkeni içinde BOŞLUKLARLA
/// birleştirilerek aktarılır; betik bu listeyi boşluklardan ayırıp her parçayı curl'e TEK bir
/// argüman olarak geçirir (blockcheck2.sh doh_find_working/doh_resolve). Eskiden yalnızca
/// "https://" öneki kontrol edildiği için boşluk içeren bir adres curl'e fazladan seçenekler
/// geçirebiliyordu. Artık hiçbir adres boşluk, kontrol karakteri veya tırnak içeremez ve her
/// protokol kendi biçimine uymak zorundadır.
/// </summary>
public static class DnsAddressValidator
{
    private const int MaxLength = 2048;
    private static readonly Regex HostPort = new(@"^[A-Za-z0-9.\-:\[\]]{1,260}$", RegexOptions.Compiled);
    private static readonly Regex SdnsStamp = new(@"^sdns://[A-Za-z0-9_\-=]+$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Adres geçerliyse null; değilse kullanıcıya gösterilecek hata mesajı.</summary>
    public static string? GetError(DnsProtocol protocol, string? address)
    {
        if (protocol == DnsProtocol.NextDns)
            return string.IsNullOrEmpty(address) ? null : "Bu protokol elle eklenemez.";

        if (string.IsNullOrEmpty(address)) return "DNS adresi boş.";
        if (address.Length > MaxLength) return "DNS adresi çok uzun.";
        if (address.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c is '"' or '\'' or '`'))
            return $"DNS adresi boşluk, tırnak işareti veya kontrol karakteri içeremez: {address}";

        return protocol switch
        {
            DnsProtocol.Doh => Uri.TryCreate(address, UriKind.Absolute, out var uri)
                && uri.Scheme == Uri.UriSchemeHttps && uri.Host.Length > 0
                    ? null
                    : $"Geçersiz DoH adresi (https:// ile başlayan geçerli bir URL olmalıdır): {address}",
            DnsProtocol.DnsCrypt => SdnsStamp.IsMatch(address)
                ? null
                : $"Geçersiz DNSCrypt adresi (sdns:// ile başlamalıdır): {address}",
            DnsProtocol.Dot or DnsProtocol.Doq => HostPort.IsMatch(address)
                ? null
                : $"Geçersiz sunucu adresi (host veya host:port biçiminde olmalıdır): {address}",
            _ => "Bilinmeyen DNS protokolü.",
        };
    }
}
