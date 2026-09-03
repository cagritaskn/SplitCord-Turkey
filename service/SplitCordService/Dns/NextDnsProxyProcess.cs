using System.Diagnostics;
using SplitCord.Service.Engines;

namespace SplitCord.Service.Dns;

/// <summary>Bundled nextdns.exe'yi (bkz. resources/bin/nextdns, scripts/fetch-binaries.js)
/// profilsiz/hesapsız "run" modunda, yalnızca 127.0.0.1'de dinleyen bir çocuk süreç olarak
/// çalıştırır — DnsProxyToolProcess'ten (AdGuard'ın dnsproxy'sine özel "-l/-p/-u" sözdizimi)
/// KASITLI olarak türemiyor, çünkü nextdns.exe'nin CLI'si tamamen farklı ve burada "hangi
/// upstream'e git" diye bir seçim de yok — profilsiz modda nextdns.exe zaten sabit olarak
/// dns.nextdns.io'ya gidiyor (kaynak kodu incelendi: run.go, profil boşsa
/// "https://dns.nextdns.io/" + "" = "https://dns.nextdns.io/"). Yani DoQ/DNSCrypt'teki gibi
/// "sağlayıcı değişince yeniden başlat" mantığına hiç gerek yok, tek bir sabit yapılandırmayla
/// servis ömrü boyunca (ilk kullanımda) bir kez başlatılıp öyle kalıyor.
///
/// -control ile KENDİMİZE özel bir kontrol soketi adı veriyoruz: canlı testte, varsayılan adla
/// ("nextdns-cli") resmi NextDNS uygulaması aynı makinede kuruluysa/çalışıyorsa isim çakışması
/// (izin hatası) oluştuğu görüldü -- bu hata DNS dinleyicisini engellemiyor (yalnızca kontrol
/// soketi/"nextdns log" gibi komutlar etkileniyor, bizim hiç kullanmadığımız bir özellik) ama
/// yine de kendi adımızı kullanmak daha temiz.</summary>
public sealed class NextDnsProxyProcess
{
    public const int Port = 53539;

    private readonly ILogger<NextDnsProxyProcess> _logger;
    private readonly object _lock = new();
    private Process? _process;

    public NextDnsProxyProcess(ILogger<NextDnsProxyProcess> logger)
    {
        _logger = logger;
    }

    /// <summary>nextdns.exe'nin çalıştığından emin olur. Döndürülen true, sürecin bu çağrıda
    /// TAZE başlatıldığını gösterir (çağıran taraf UDP portunun bağlanması için kısa bir süre
    /// beklemeli, bkz. DoqUpstream/DnsCryptUpstream'deki aynı desen).</summary>
    public bool EnsureRunning()
    {
        lock (_lock)
        {
            if (_process is { HasExited: false }) return false;

            var exePath = BinaryLocator.Resolve("nextdns", "nextdns.exe");

            var psi = new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("run");
            psi.ArgumentList.Add("-listen"); psi.ArgumentList.Add($"127.0.0.1:{Port}");
            psi.ArgumentList.Add("-control"); psi.ArgumentList.Add("splitcord-nextdns");
            psi.ArgumentList.Add("-cache-size"); psi.ArgumentList.Add("0");

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // bkz. DnsProxyToolProcess.cs'teki AYNI kritik not: bu handler'lar ayrı bir
            // ThreadPool iş parçacığında çalışıyor, servis kapanışı sırasında logger dispose
            // edilmişken tetiklenirlerse try/catch olmadan TÜM SÜRECİ çöktürebiliyorlardı.
            process.OutputDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[nextdns] {Line}", e.Data); } catch { /* bkz. yukarıdaki not */ } };
            process.ErrorDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[nextdns stderr] {Line}", e.Data); } catch { /* bkz. yukarıdaki not */ } };
            process.Exited += (_, _) => { try { _logger.LogWarning("nextdns.exe beklenmedik şekilde durdu"); } catch { /* bkz. yukarıdaki not */ } };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            _process = process;
            _logger.LogInformation("nextdns.exe başlatıldı: 127.0.0.1:{Port} (profilsiz, dns.nextdns.io)", Port);
            return true;
        }
    }

    public void Stop()
    {
        lock (_lock)
        {
            if (_process is { HasExited: false } process)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* zaten sonlanmış olabilir */ }
            }
            _process = null;
        }
    }
}
