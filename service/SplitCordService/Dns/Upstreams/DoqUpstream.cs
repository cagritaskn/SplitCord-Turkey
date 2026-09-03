using System.Net;
using System.Net.Sockets;

namespace SplitCord.Service.Dns.Upstreams;

/// <summary>DoQ (RFC 9250) — .NET'in System.Net.Quic'i .NET 8'de hâlâ preview feature
/// olduğu için (bkz. DnsProxyToolProcess.cs'teki not) gerçek QUIC işini bundled dnsproxy.exe'ye
/// (AdGuard) devrediyoruz; burada yalnızca ona düz UDP DNS iletiyoruz — tıpkı ciadpi.exe'nin
/// bize (EncryptedDnsForwarder) konuştuğu gibi.</summary>
public sealed class DoqUpstream : IDnsUpstream
{
    private readonly DoqProxyProcess _proxy;

    public DoqUpstream(DoqProxyProcess proxy)
    {
        _proxy = proxy;
    }

    public async Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct)
    {
        var freshlyStarted = _proxy.EnsureRunning(provider.Address);
        if (freshlyStarted)
        {
            // dnsproxy.exe'nin yerel UDP portunu bağlaması için kısa bir bekleme (diğer
            // motorlardaki spawn+WaitForPortAsync deseniyle aynı ruhta) — yalnızca TAZE
            // başlatıldığında, zaten çalışıyorsa hiç beklemiyoruz.
            await Task.Delay(300, ct);
        }

        using var udp = new UdpClient();
        udp.Connect(IPAddress.Loopback, DoqProxyProcess.Port);
        await udp.SendAsync(rawQuery, ct);
        var result = await udp.ReceiveAsync(ct);
        return result.Buffer;
    }
}
