using System.Net;
using System.Net.Sockets;

namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/SelfTestResolver.cs) birebir
/// portu — hiç platforma özgü kod içermiyor. Zapret ve Zapret2'nin kendi bağlantı öz-testlerinde
/// kullandığı, tek bir hostname çözen paylaşılan yardımcı; ByeDPI'nin (ciadpi) zaten konuştuğu
/// AYNI yerel forwarder'a (bkz. EncryptedDnsForwarder, 127.0.0.1:53535) düz DNS-wire UDP sorgusu
/// gönderip yanıt bekler.</summary>
public static class SelfTestResolver
{
    // Windows tarafında CANLI TESTTE BULUNAN, formülün NEDEN böyle hesaplandığını açıklayan iki
    // bug (bkz. Windows service/SplitCordService/Dns/SelfTestResolver.cs'teki tam not): (1)
    // sabit kısa bir QueryTimeout, DnsProviders listesindeki ilk birkaç sağlayıcı engellendiğinde
    // listenin sonundaki GERÇEKTEN çalışan bir sağlayıcıya sıra gelmeden dolup bağlantı testini
    // haksız yere başarısız sayıyordu; (2) NextDns DoH tier'ine ek bir sağlayıcı olarak
    // eklendiğinde bu formül güncellenmemiş, payı sıfıra indirmişti. Bu yüzden burada
    // DohTierExtraEntryCount de toplama katılıyor — ApplyTier'ın gerçekte eklediği sağlayıcı
    // sayısıyla bu hesap birbirinden bağımsız sürüklenemez.
    private static readonly TimeSpan QueryTimeout = TimeSpan.FromSeconds(
        EncryptedDnsForwarder.PerProviderTimeout.TotalSeconds *
        (DnsDefaultProviderPools.Doh.Count + DnsProtocolTiers.DohTierExtraEntryCount + 1));

    public static async Task<IPAddress?> ResolveAsync(string hostname, CancellationToken ct)
    {
        try
        {
            using var udp = new UdpClient();
            udp.Connect(IPAddress.Loopback, EncryptedDnsForwarder.Port);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(QueryTimeout);

            var query = BuildDnsQuery(hostname);
            await udp.SendAsync(query, timeoutCts.Token);

            var result = await udp.ReceiveAsync(timeoutCts.Token);
            return ParseFirstARecord(result.Buffer);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>RFC 1035 basit bir A kaydı sorgusu (tek soru, EDNS/ek alan yok).</summary>
    internal static byte[] BuildDnsQuery(string hostname)
    {
        var labels = hostname.Split('.', StringSplitOptions.RemoveEmptyEntries);
        using var ms = new MemoryStream();
        Span<byte> header = stackalloc byte[12];
        Random.Shared.NextBytes(header[..2]); // transaction id
        header[2] = 0x01; header[3] = 0x00;   // flags: recursion desired
        header[4] = 0x00; header[5] = 0x01;   // QDCOUNT = 1
        ms.Write(header);
        foreach (var label in labels)
        {
            var bytes = System.Text.Encoding.ASCII.GetBytes(label);
            ms.WriteByte((byte)bytes.Length);
            ms.Write(bytes);
        }
        ms.WriteByte(0x00); // kök
        ms.WriteByte(0x00); ms.WriteByte(0x01); // QTYPE = A
        ms.WriteByte(0x00); ms.WriteByte(0x01); // QCLASS = IN
        return ms.ToArray();
    }

    /// <summary>Wire-format DNS yanıtındaki ilk A kaydını (varsa) ayrıştırır.</summary>
    internal static IPAddress? ParseFirstARecord(byte[] response)
    {
        if (response.Length < 12) return null;
        var ancount = (response[6] << 8) | response[7];
        if (ancount == 0) return null;

        var offset = 12;
        offset = SkipDnsName(response, offset);
        if (offset < 0 || offset + 4 > response.Length) return null;
        offset += 4;

        for (var i = 0; i < ancount && offset < response.Length; i++)
        {
            offset = SkipDnsName(response, offset);
            if (offset < 0 || offset + 10 > response.Length) return null;

            var type = (response[offset] << 8) | response[offset + 1];
            var rdlength = (response[offset + 8] << 8) | response[offset + 9];
            offset += 10;
            if (offset + rdlength > response.Length) return null;

            if (type == 1 && rdlength == 4) // A kaydı
            {
                return new IPAddress(response.AsSpan(offset, 4));
            }
            offset += rdlength;
        }
        return null;
    }

    private static int SkipDnsName(byte[] data, int offset)
    {
        while (offset < data.Length)
        {
            var len = data[offset];
            if (len == 0) return offset + 1;
            if ((len & 0xC0) == 0xC0) return offset + 2; // sıkıştırma işaretçisi: sabit 2 bayt
            offset += 1 + len;
        }
        return -1;
    }
}
