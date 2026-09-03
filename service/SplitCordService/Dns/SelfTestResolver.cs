using System.Net;
using System.Net.Sockets;

namespace SplitCord.Service.Dns;

/// <summary>Zapret ve Zapret2'nin kendi bağlantı öz-testlerinde (TestConnectivityAsync)
/// kullandığı, tek bir hostname çözen paylaşılan yardımcı. Eskiden ikisinin de kendi ayrı
/// DoH istemcisi vardı (biri Cloudflare'e sabit JSON API, diğeri DnsProviders/DohProviders
/// listesini kullanan wire-format istemci) — ikisi de aslında ByeDPI'nin (ciadpi.exe, bkz.
/// vendor/byedpi-src patch'i) zaten konuştuğu AYNI yerel forwarder'a (bkz.
/// EncryptedDnsForwarder, 127.0.0.1:53535) düz DNS-wire UDP sorgusu gönderip aynı yanıtı
/// bekleyebilir. Bu hem kod tekrarını kaldırıyor hem de Zapret/Zapret2'nin öz-testini
/// kullanıcının yapılandırdığı HERHANGİ bir protokole (DoT/DoQ/DNSCrypt dahil) sıfır
/// motor-özel kod ile taşıyor.</summary>
public static class SelfTestResolver
{
    private static readonly TimeSpan QueryTimeout = TimeSpan.FromSeconds(3);

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

    /// <summary>RFC 1035 basit bir A kaydı sorgusu (tek soru, EDNS/ek alan yok) — 12 baytlık
    /// başlık + QNAME (uzunluk-öncelikli etiketler) + QTYPE(A=1) + QCLASS(IN=1). internal:
    /// DnsProtocolScanner de aynı sorgu/ayrıştırma çiftini belirli bir sağlayıcıyı doğrudan
    /// test etmek için kullanıyor.</summary>
    internal static byte[] BuildDnsQuery(string hostname)
    {
        var labels = hostname.Split('.', StringSplitOptions.RemoveEmptyEntries);
        using var ms = new MemoryStream();
        Span<byte> header = stackalloc byte[12];
        Random.Shared.NextBytes(header[..2]); // transaction id
        header[2] = 0x01; header[3] = 0x00;   // flags: recursion desired
        header[4] = 0x00; header[5] = 0x01;   // QDCOUNT = 1
        // ANCOUNT/NSCOUNT/ARCOUNT zaten 0
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

    /// <summary>Wire-format DNS yanıtındaki ilk A kaydını (varsa) ayrıştırır — bizim
    /// gönderdiğimiz tek-soruluk sorguya karşılık gelen yanıtları ele almak için yeterli
    /// minimal bir ayrıştırıcı (isim sıkıştırma işaretçileri dahil, RFC 1035 §4.1.4).</summary>
    internal static IPAddress? ParseFirstARecord(byte[] response)
    {
        if (response.Length < 12) return null;
        var ancount = (response[6] << 8) | response[7];
        if (ancount == 0) return null;

        var offset = 12;
        // Soru bölümünü atla (QNAME + QTYPE(2) + QCLASS(2)).
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

    /// <summary>Bir DNS ismini (etiket dizisi ya da sıkıştırma işaretçisi) atlayıp isimden
    /// SONRAKİ baytın offset'ini döner. Yalnızca ATLAMAK için kullanılıyor, ismin içeriğiyle
    /// ilgilenmiyoruz.</summary>
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
