using System.Net;
using System.Net.Sockets;

namespace SplitCord.Service.Dns.Upstreams;

/// <summary>DNSCrypt — .NET'te yerleşik desteği olmadığı ve kendi kripto protokolünü
/// (X25519 + XSalsa20-Poly1305 el sıkışması, sertifika/anahtar rotasyonu) sıfırdan yazmak
/// yüksek bakım riski taşıdığı için bundled dnsproxy.exe'ye (AdGuard) devrediyoruz; burada
/// yalnızca ona düz UDP DNS iletiyoruz — tıpkı DoqUpstream gibi.</summary>
public sealed class DnsCryptUpstream : IDnsUpstream
{
    private readonly DnsCryptProxyProcess _proxy;

    public DnsCryptUpstream(DnsCryptProxyProcess proxy)
    {
        _proxy = proxy;
    }

    public async Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct)
    {
        var freshlyStarted = _proxy.EnsureRunning(provider.Address);
        if (freshlyStarted)
        {
            await Task.Delay(300, ct);
        }

        using var udp = new UdpClient();
        udp.Connect(IPAddress.Loopback, DnsCryptProxyProcess.Port);
        await udp.SendAsync(rawQuery, ct);
        var result = await udp.ReceiveAsync(ct);
        return result.Buffer;
    }
}
