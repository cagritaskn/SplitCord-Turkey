using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using SplitCord.Service.Config;

namespace SplitCord.Service.Dns;

/// <summary>
/// 127.0.0.1 üzerinde dinleyen, düz UDP DNS sorgularını RFC 8484 formatında bir
/// DNS-over-HTTPS uç noktasına ileten yerel bir köprü. TLS/HTTPS kısmını burada
/// (.NET'in zaten sahip olduğu HttpClient ile) hallediyoruz; böylece özel derlenen
/// ciadpi.exe'ye (bkz. vendor/byedpi-src patch'i) TLS kütüphanesi eklemeye gerek
/// kalmıyor — o yalnızca bu yerel porta düz UDP DNS sorgusu gönderiyor.
///
/// Sağlayıcı listesi SettingsStore.DohProviders'tan gelir (Ayarlar ekranından
/// değiştirilebilir) ve sırayla denenir: bazı ISP'lerde tek bir DoH sağlayıcısı
/// (ör. yalnızca Google) da yavaşlatılıyor/zaman aşımına uğrayabiliyor.
///
/// Yalnızca loopback'te dinlenir: hiçbir zaman dışarıdan erişilebilir değildir,
/// yalnızca bu makinedeki SplitCord-Turkey (ciadpi.exe) tarafından kullanılır.
/// </summary>
public sealed class DohForwarder : IHostedService, IDisposable
{
    public const int Port = 53535;

    // Liste 5 sağlayıcıya çıkarıldığı için (bkz. SettingsStore.DohProviders) her birine
    // 2 sn verilirse en kötü durumda 10 sn'ye çıkabiliyordu — hem ciadpi'nin kendi
    // SC_DOH_TIMEOUT_MS'i hem de ByeDpiEngine'in TestConnectivityAsync zaman aşımı
    // buna göre büyütüldü, ama makul kalması için burada da biraz kısaltıyoruz.
    private static readonly TimeSpan PerProviderTimeout = TimeSpan.FromSeconds(1.5);

    private readonly SettingsStore _settings;
    private readonly ILogger<DohForwarder> _logger;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private UdpClient? _udp;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public DohForwarder(SettingsStore settings, ILogger<DohForwarder> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_udp is not null) return Task.CompletedTask;

        _udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, Port));
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => RunAsync(_udp, _cts.Token));
        _logger.LogInformation(
            "DoH yönlendirici 127.0.0.1:{Port} üzerinde başlatıldı (sağlayıcılar: {Providers})",
            Port, string.Join(" -> ", _settings.Current.DohProviders));
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
                _logger.LogWarning("DoH yönlendirici UDP alım hatası: {Error}", ex.Message);
                continue;
            }

            _logger.LogInformation("DoH sorgusu alındı: {Bytes} bayt, gönderen {From}", result.Buffer.Length, result.RemoteEndPoint);
            _ = HandleQueryAsync(udp, result, ct);
        }
    }

    private async Task HandleQueryAsync(UdpClient udp, UdpReceiveResult query, CancellationToken ct)
    {
        // Her sorguda güncel listeyi okuyoruz: kullanıcı Ayarlar'dan sağlayıcı listesini
        // değiştirirse servis yeniden başlatılmadan bir sonraki sorguda hemen etkili olur.
        var providers = _settings.Current.DohProviders;

        if (providers.Count == 0)
        {
            _logger.LogWarning("DoH sağlayıcı listesi boş, ciadpi sistem çözümleyicisine düşecek");
            return;
        }

        foreach (var endpoint in providers)
        {
            try
            {
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(PerProviderTimeout);

                using var content = new ByteArrayContent(query.Buffer);
                content.Headers.ContentType = new MediaTypeHeaderValue("application/dns-message");

                using var response = await _http.PostAsync(endpoint, content, timeoutCts.Token);
                response.EnsureSuccessStatusCode();
                var answer = await response.Content.ReadAsByteArrayAsync(timeoutCts.Token);

                await udp.SendAsync(answer, query.RemoteEndPoint, ct);
                _logger.LogInformation("DoH yanıtı {Provider} üzerinden alındı: {Bytes} bayt", endpoint, answer.Length);
                return;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                _logger.LogWarning("DoH sağlayıcısı {Provider} başarısız: {Error}", endpoint, ex.Message);
                // sıradaki sağlayıcıyı dene
            }
            catch
            {
                return; // servis kapatılıyor
            }
        }

        _logger.LogWarning("Tüm DoH sağlayıcıları başarısız oldu, ciadpi sistem çözümleyicisine düşecek");
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _udp?.Close();
        _http.Dispose();
    }
}
