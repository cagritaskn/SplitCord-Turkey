using System.Net.Security;
using System.Net.Sockets;

namespace SplitCord.Service.Dns.Upstreams;

/// <summary>RFC 7858 (DNS-over-TLS): host:853'e (port belirtilmemişse) TLS ile bağlanır,
/// sorguyu 2 baytlık big-endian uzunluk ön ekiyle yazar, yanıtı aynı çerçevelemeyle okur.
/// Sorgu başına yeni bağlantı açılır (pipelining/keep-alive yok) — bu sorgu hacminde
/// basitlik, boşta kalan bağlantıların ömür yönetimindeki hatalardan daha değerli.</summary>
public sealed class DotUpstream : IDnsUpstream
{
    public async Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct)
    {
        var (host, port) = DnsAddressParser.ParseHostPort(provider.Address);

        using var tcp = new TcpClient();
        await tcp.ConnectAsync(host, port, ct);

        using var ssl = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
        await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host }, ct);

        var lengthPrefix = new byte[2];
        lengthPrefix[0] = (byte)(rawQuery.Length >> 8);
        lengthPrefix[1] = (byte)(rawQuery.Length & 0xFF);
        await ssl.WriteAsync(lengthPrefix, ct);
        await ssl.WriteAsync(rawQuery, ct);
        await ssl.FlushAsync(ct);

        var responseLengthPrefix = new byte[2];
        await ReadExactAsync(ssl, responseLengthPrefix, ct);
        var responseLength = (responseLengthPrefix[0] << 8) | responseLengthPrefix[1];

        var response = new byte[responseLength];
        await ReadExactAsync(ssl, response, ct);
        return response;
    }

    private static async Task ReadExactAsync(Stream stream, byte[] buffer, CancellationToken ct)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), ct);
            if (read == 0) throw new IOException("DoT bağlantısı yanıt tamamlanmadan kapandı");
            offset += read;
        }
    }
}
