using System.Diagnostics;
using SplitCord.ServiceLinux.Engines;

namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının (service/SplitCordService/Dns/NextDnsProxyProcess.cs) portu —
/// tek fark: bundled binary adı uzantısız "nextdns" (bkz. Engines/BinaryLocator.cs). Bundled
/// nextdns'i profilsiz/hesapsız "run" modunda, yalnızca 127.0.0.1'de dinleyen bir çocuk süreç
/// olarak çalıştırır — sabit olarak dns.nextdns.io'ya gider, "sağlayıcı değişince yeniden
/// başlat" mantığına gerek yok.</summary>
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

    /// <summary>nextdns'in çalıştığından emin olur. Döndürülen true, sürecin bu çağrıda TAZE
    /// başlatıldığını gösterir.</summary>
    public bool EnsureRunning()
    {
        lock (_lock)
        {
            if (_process is { HasExited: false }) return false;

            var exePath = BinaryLocator.Resolve("nextdns", "nextdns");

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
            process.OutputDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[nextdns] {Line}", e.Data); } catch { /* bkz. DnsProxyToolProcess.cs'teki not */ } };
            process.ErrorDataReceived += (_, e) => { try { if (e.Data is not null) _logger.LogInformation("[nextdns stderr] {Line}", e.Data); } catch { /* bkz. DnsProxyToolProcess.cs'teki not */ } };
            process.Exited += (_, _) => { try { _logger.LogWarning("nextdns beklenmedik şekilde durdu"); } catch { /* bkz. DnsProxyToolProcess.cs'teki not */ } };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            _process = process;
            _logger.LogInformation("nextdns başlatıldı: 127.0.0.1:{Port} (profilsiz, dns.nextdns.io)", Port);
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
