using System.Diagnostics;
using SplitCord.ServiceLinux.Engines;

namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/DnsProxyToolProcess.cs) portu —
/// tek fark: bundled binary adı uzantısız "dnsproxy" (bkz. Engines/BinaryLocator.cs). AdGuard'ın
/// dnsproxy'sini (bkz. resources/bin/dnsproxy, scripts/fetch-binaries.js) 127.0.0.1'de düz UDP
/// DNS dinleyip TEK bir upstream'e yönlendiren bir çocuk süreç olarak çalıştırır.</summary>
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
    /// çağrıda TAZE başlatıldığını gösterir.</summary>
    public bool EnsureRunning(string providerAddress)
    {
        lock (_lock)
        {
            if (_process is { HasExited: false } && _runningAddress == providerAddress) return false;

            StopLocked();

            var exePath = BinaryLocator.Resolve("dnsproxy", "dnsproxy");
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
            psi.ArgumentList.Add("--cache");

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // Windows tarafındaki AYNI kritik not: bu handler'lar ayrı bir ThreadPool iş
            // parçacığında çalışıyor, servis kapanışı sırasında logger dispose edilmişken
            // tetiklenirlerse try/catch olmadan TÜM SÜRECİ çöktürebiliyorlar.
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
