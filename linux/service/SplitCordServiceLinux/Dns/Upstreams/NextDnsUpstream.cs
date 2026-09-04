using System.Net;
using System.Net.Sockets;

namespace SplitCord.ServiceLinux.Dns.Upstreams;

/// <summary>Windows karşılığının birebir portu. DnsProtocol.NextDns — bundled nextdns'e
/// (bkz. NextDnsProxyProcess) düz DNS-wire UDP iletir. Sağlayıcının "Address" alanı burada
/// KULLANILMIYOR — profilsiz modda nextdns'in gideceği yer sabit (dns.nextdns.io).</summary>
public sealed class NextDnsUpstream : IDnsUpstream
{
    private readonly NextDnsProxyProcess _proxy;

    public NextDnsUpstream(NextDnsProxyProcess proxy)
    {
        _proxy = proxy;
    }

    public async Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct)
    {
        var freshlyStarted = _proxy.EnsureRunning();
        if (freshlyStarted)
        {
            await Task.Delay(300, ct);
        }

        using var udp = new UdpClient();
        udp.Connect(IPAddress.Loopback, NextDnsProxyProcess.Port);
        await udp.SendAsync(rawQuery, ct);
        var result = await udp.ReceiveAsync(ct);
        return result.Buffer;
    }
}
