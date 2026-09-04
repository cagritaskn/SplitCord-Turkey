using System.Net;
using System.Net.Sockets;
using SplitCord.ServiceLinux.Config;
using SplitCord.ServiceLinux.Dns.Upstreams;

namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/EncryptedDnsForwarder.cs) birebir
/// portu — hiç platforma özgü kod içermiyor (System.Net.Sockets.UdpClient tamamen taşınabilir).
/// 127.0.0.1 üzerinde dinleyen, düz UDP DNS sorgularını kullanıcının yapılandırdığı şifreli DNS
/// sağlayıcılarına (DoH/DNSCrypt/NextDns — DoT/DoQ elle sabitlenebilir) ileten yerel bir köprü.
/// ByeDPI'nin (ciadpi, bkz. vendor/byedpi-src) ve Zapret/Zapret2'nin öz-testinin (bkz.
/// SelfTestResolver) konuştuğu AYNI dış sözleşme (127.0.0.1:53535'te düz DNS-wire UDP).</summary>
public sealed class EncryptedDnsForwarder : IHostedService, IDisposable
{
    public const int Port = 53535;

    internal static readonly TimeSpan PerProviderTimeout = TimeSpan.FromSeconds(1.5);

    private readonly SettingsStore _settings;
    private readonly ILogger<EncryptedDnsForwarder> _logger;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly DoqProxyProcess _doqProxyProcess;
    private readonly DnsCryptProxyProcess _dnsCryptProxyProcess;
    private readonly NextDnsProxyProcess _nextDnsProxyProcess;
    private readonly IReadOnlyDictionary<DnsProtocol, IDnsUpstream> _upstreams;
    private UdpClient? _udp;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public EncryptedDnsForwarder(
        SettingsStore settings,
        ILogger<EncryptedDnsForwarder> logger,
        DoqProxyProcess doqProxyProcess,
        DnsCryptProxyProcess dnsCryptProxyProcess,
        NextDnsProxyProcess nextDnsProxyProcess)
    {
        _settings = settings;
        _logger = logger;
        _doqProxyProcess = doqProxyProcess;
        _dnsCryptProxyProcess = dnsCryptProxyProcess;
        _nextDnsProxyProcess = nextDnsProxyProcess;
        _upstreams = new Dictionary<DnsProtocol, IDnsUpstream>
        {
            [DnsProtocol.Doh] = new DohUpstream(_http),
            [DnsProtocol.Dot] = new DotUpstream(),
            [DnsProtocol.Doq] = new DoqUpstream(_doqProxyProcess),
            [DnsProtocol.DnsCrypt] = new DnsCryptUpstream(_dnsCryptProxyProcess),
            [DnsProtocol.NextDns] = new NextDnsUpstream(_nextDnsProxyProcess),
        };
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_udp is not null) return Task.CompletedTask;

        _udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, Port));
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => RunAsync(_udp, _cts.Token));
        _logger.LogInformation(
            "Şifreli DNS yönlendirici 127.0.0.1:{Port} üzerinde başlatıldı (sağlayıcılar: {Providers})",
            Port, string.Join(" -> ", _settings.Current.DnsProviders.Select(p => $"{p.Protocol}:{p.Address}")));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        _udp?.Close();
        _udp = null;
        return Task.CompletedTask;
    }

    private async Task RunAsync(UdpClient udp, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult result;
            try
            {
                result = await udp.ReceiveAsync(ct);
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("DNS yönlendirici UDP alım hatası: {Error}", ex.Message);
                continue;
            }

            _logger.LogInformation("DNS sorgusu alındı: {Bytes} bayt, gönderen {From}", result.Buffer.Length, result.RemoteEndPoint);
            _ = HandleQueryAsync(udp, result, ct);
        }
    }

    private async Task HandleQueryAsync(UdpClient udp, UdpReceiveResult query, CancellationToken ct)
    {
        var providers = _settings.Current.DnsProviders;

        if (providers.Count == 0)
        {
            _logger.LogWarning("DNS sağlayıcı listesi boş, çağıran taraf sistem çözümleyicisine düşecek");
            return;
        }

        foreach (var provider in providers)
        {
            if (!_upstreams.TryGetValue(provider.Protocol, out var upstream)) continue;

            try
            {
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(PerProviderTimeout);

                var answer = await upstream.ResolveAsync(provider, query.Buffer, timeoutCts.Token);

                await udp.SendAsync(answer, query.RemoteEndPoint, ct);
                _logger.LogInformation("DNS yanıtı {Protocol}:{Provider} üzerinden alındı: {Bytes} bayt", provider.Protocol, provider.Address, answer.Length);
                return;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                _logger.LogWarning("DNS sağlayıcısı {Protocol}:{Provider} başarısız: {Error}", provider.Protocol, provider.Address, ex.Message);
            }
            catch
            {
                return; // servis kapatılıyor
            }
        }

        _logger.LogWarning("Tüm DNS sağlayıcıları başarısız oldu, çağıran taraf sistem çözümleyicisine düşecek");
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _udp?.Close();
        _doqProxyProcess.Stop();
        _dnsCryptProxyProcess.Stop();
        _nextDnsProxyProcess.Stop();
        _http.Dispose();
    }
}
