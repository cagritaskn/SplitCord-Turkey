using System.Diagnostics;
using SplitCord.Service.Engines;

namespace SplitCord.Service.Dns;

/// <summary>DoQ ve DNSCrypt için ortak: AdGuard'ın dnsproxy'sini (bkz. resources/bin/dnsproxy,
/// scripts/fetch-binaries.js) 127.0.0.1'de düz UDP DNS dinleyip TEK bir upstream'e (mevcut
/// ayarlardaki İLK ilgili protokol tipli sağlayıcıya) yönlendiren bir çocuk süreç olarak
/// çalıştırır. .NET 8'de System.Net.Quic'in hâlâ "preview feature" olması (canlı testte
/// doğrulandı: derleyici CA2252 veriyor) ve DNSCrypt'in .NET'te hiç yerleşik desteği olmaması
/// nedeniyle ikisi de bu gerçek, aktif geliştirilen Go aracına devrediliyor — diğer 4 motorla
/// aynı "vendored binary + shell out" deseni. dnsproxy'nin hem "-u quic://host:port" hem
/// "-u sdns://..." upstream biçimlerini desteklediği canlı testte doğrulandı.
///
/// Birden fazla aynı-protokol girişi varsa yalnızca ilki kullanılır (v1 kapsamı, kasıtlı bir
/// basitleştirme — bilinçli olarak dnsproxy'nin KENDİ çoklu-upstream fallback mantığına
/// karışmıyoruz, tekilleştirme EncryptedDnsForwarder'ın kendi sağlayıcı listesi döngüsünde
/// zaten oluyor).</summary>
public abstract class DnsProxyToolProcess
{
    private readonly ILogger _logger;
    private readonly object _lock = new();
    private Process? _process;
    private string? _runningAddress;

    protected DnsProxyToolProcess(ILogger logger)
    {
        _logger = logger;
    }

    protected abstract int LocalPort { get; }
    protected abstract string LogLabel { get; }

    /// <summary>Sağlayıcının ham "Address" alanından (host/host:port ya da sdns:// stamp'i)
    /// dnsproxy'nin "-u" argümanına verilecek tam değeri üretir.</summary>
    protected abstract string BuildUpstreamArg(string providerAddress);

    /// <summary>Verilen sağlayıcı adresiyle dnsproxy'nin çalıştığından emin olur — zaten AYNI
    /// adresle çalışıyorsa dokunmaz, farklıysa yeniden başlatır. Döndürülen true, sürecin bu
    /// çağrıda TAZE başlatıldığını gösterir (çağıran taraf UDP portunun bağlanması için kısa
    /// bir süre beklemeli, bkz. DoqUpstream/DnsCryptUpstream).</summary>
    public bool EnsureRunning(string providerAddress)
    {
        lock (_lock)
        {
            if (_process is { HasExited: false } && _runningAddress == providerAddress) return false;

            StopLocked();

            var exePath = BinaryLocator.Resolve("dnsproxy", "dnsproxy.exe");
            var upstreamArg = BuildUpstreamArg(providerAddress);

            var psi = new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-l"); psi.ArgumentList.Add("127.0.0.1");
            psi.ArgumentList.Add("-p"); psi.ArgumentList.Add(LocalPort.ToString());
            psi.ArgumentList.Add("-u"); psi.ArgumentList.Add(upstreamArg);
            psi.ArgumentList.Add("--cache"); // tekrarlayan sorgularda gereksiz round-trip'i önler

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // KRİTİK — servis çökmesi: bu handler'lar (Process.OutputDataReceived/ErrorDataReceived/
            // Exited) ayrı bir ThreadPool iş parçacığında, servisin geri kalanından TAMAMEN bağımsız
            // olarak tetikleniyor. Servis kapanışı/yeniden başlaması sırasında EventLog logger
            // provider'ı ÇOKTAN dispose edilmişken bu süreçlerden biri (ör. dnsproxy.exe) TAM O ANDA
            // çıkış yaparsa, _logger.Log* çağrısı ObjectDisposedException fırlatıyor — bu bir
            // ThreadPool callback'i içinde YAKALANMADIĞI için .NET SÜRECİN TAMAMINI çöktürüyor
            // (canlı testte Windows Olay Günlüğü'nde doğrulandı: SplitCordService.exe tamamen
            // sonlanmıştı). Loglamanın kendisi asla kritik değil — try/catch ile yutuluyor.
            process.OutputDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[dnsproxy/{Label}] {Line}", LogLabel, e.Data); } catch { /* bkz. yukarıdaki not */ } };
            process.ErrorDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[dnsproxy/{Label} stderr] {Line}", LogLabel, e.Data); } catch { /* bkz. yukarıdaki not */ } };
            process.Exited += (_, _) => { try { _logger.LogWarning("dnsproxy ({Label}) beklenmedik şekilde durdu", LogLabel); } catch { /* bkz. yukarıdaki not */ } };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            _process = process;
            _runningAddress = providerAddress;
            _logger.LogInformation("dnsproxy ({Label}) başlatıldı: 127.0.0.1:{Port} -> {Upstream}", LogLabel, LocalPort, upstreamArg);
            return true;
        }
    }

    public void Stop()
    {
        lock (_lock)
        {
            StopLocked();
        }
    }

    private void StopLocked()
    {
        if (_process is { HasExited: false } process)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* zaten sonlanmış olabilir */ }
        }
        _process = null;
        _runningAddress = null;
    }
}
