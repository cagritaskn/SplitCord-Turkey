using System.Net;
using System.Net.Sockets;

namespace SplitCord.Service.Dns.Upstreams;

/// <summary>DnsProtocol.NextDns -- bundled nextdns.exe'ye (bkz. NextDnsProxyProcess) düz
/// DNS-wire UDP iletir, tıpkı DoqUpstream/DnsCryptUpstream'in kendi dnsproxy.exe süreçlerine
/// yaptığı gibi. Sağlayıcının "Address" alanı burada KULLANILMIYOR -- profilsiz modda
/// nextdns.exe'nin gideceği yer sabit (dns.nextdns.io), seçilecek bir upstream yok.</summary>
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
