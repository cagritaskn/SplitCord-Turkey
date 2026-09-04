using System.Net;
using System.Net.Sockets;

namespace SplitCord.ServiceLinux.Dns.Upstreams;

/// <summary>Windows karşılığının birebir portu. DoQ (RFC 9250) — .NET'in System.Net.Quic'i hâlâ
/// preview feature olduğu için gerçek QUIC işini bundled dnsproxy'ye (AdGuard) devrediyoruz;
/// burada yalnızca ona düz UDP DNS iletiyoruz.</summary>
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
            await Task.Delay(300, ct);
        }

        using var udp = new UdpClient();
        udp.Connect(IPAddress.Loopback, DoqProxyProcess.Port);
        await udp.SendAsync(rawQuery, ct);
        var result = await udp.ReceiveAsync(ct);
        return result.Buffer;
    }
}
