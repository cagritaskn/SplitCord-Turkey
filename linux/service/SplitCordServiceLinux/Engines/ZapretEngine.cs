using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using SplitCord.ServiceLinux.Dns;
using SplitCord.ServiceLinux.Config;

namespace SplitCord.ServiceLinux.Engines;

/// <summary>
/// Windows karşılığının (service/SplitCordService/Engines/ZapretEngine.cs) portu. En büyük
/// mimari fark: Windows'ta winws.exe kendi `--wf-tcp=/--wf-udp=` bayraklarıyla WinDivert
/// filtresini DOĞRUDAN kuruyordu; Linux'ta bu iki ayrı sorumluluğa bölünüyor —
/// (1) `iptables` ile eşleşen paketleri bir NFQUEUE kuyruğuna yönlendiren bir kural (bu
/// dosyadaki AddNfQueueRulesAsync/RemoveNfQueueRulesAsync), (2) o kuyruğu dinleyip paketleri
/// mangle'layan `nfqws` süreci (`--qnum=N`). `--dpi-desync=*` argüman GRAMERİ Windows'takiyle
/// AYNI (bol-van/zapret'in paylaşılan CLI yüzeyi) — yalnızca paket YAKALAMA mekanizması
/// değişti (bkz. PORTING_PLAN.md D-5).
///
/// DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5, R-4.1/R-4.2/R-4.3): bu dosya hiç gerçek bir
/// Linux çekirdeğinde çalıştırılmadı. iptables kural sözdizimi (özellikle port ARALIĞI
/// 50000:65535'in multiport modülüyle birlikte kullanımı), NFQUEUE'nun tam davranışı ve
/// gereken yetki seti (CAP_NET_ADMIN/CAP_NET_RAW ambient capability yeterli mi yoksa root mu
/// şart) canlı testte kesinleştirilecek.
/// </summary>
public sealed class ZapretEngine : IDpiEngine, IDnsTierAware
{
    // Windows'taki 13 adayla AYNI --dpi-desync argüman içeriği (bkz. Windows dosyasındaki
    // yorumlar: Vodafone TR fake-TLS notu, badseq fooling notu vb. — hepsi hâlâ geçerli,
    // buraya tekrar taşınmadı, gerekçe Windows dosyasında). --wf-tcp=/--wf-udp= düşürüldü;
    // paket seçimi artık AddNfQueueRulesAsync'teki iptables kuralı yapıyor, nfqws yalnızca
    // hangi kuyruğu dinleyeceğini (--qnum) biliyor.
    private static readonly string[] CandidateStrategies =
    {
        "--dpi-desync=fake --dpi-desync-ttl=4",
        "--dpi-desync=fake --dpi-desync-ttl=3",
        "--dpi-desync=fake --dpi-desync-fooling=md5sig",
        "--dpi-desync=fake --dpi-desync-fooling=md5sig --dpi-desync-ttl=3",
        "--dpi-desync=fake --dpi-desync-ttl=1 --dpi-desync-autottl=3",
        "--dpi-desync=multisplit --dpi-desync-split-pos=2",
        "--dpi-desync=fake --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-ttl=4",
        "--dpi-desync=fake --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-fooling=md5sig",
        "--dpi-desync=fake,multisplit --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-split-pos=2",
        "--dpi-desync=fake --dpi-desync-fooling=badseq",
        "--dpi-desync=fake --dpi-desync-fooling=badseq --dpi-desync-ttl=3",
        "--dpi-desync=multisplit --dpi-desync-split-seqovl=1 --dpi-desync-fooling=md5sig",
        "--dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=badseq",
    };

    private const string ConnectivityProbeUrl = "https://discord.com/app";

    // nfqws'in NFQUEUE'ya bağlanıp ilk paketi işlemeye başlaması için kısa bir bekleme
    // (Windows'taki WinDivert sürücü-oturma beklemesinin Linux karşılığı).
    private static readonly TimeSpan DriverAttachDelay = TimeSpan.FromSeconds(1.5);

    private const int SavedArgsRetryAttempts = 3;

    // Ana motorun kullandığı NFQUEUE kuyruk numarası (TCP 80/443 + UDP 443,50000-65535).
    private const int NfQueueNum = 100;
    // UDP eşlik sürecinin (yalnızca ses, bkz. StartUdpCompanionAsync) AYRI kuyruk numarası —
    // pratikte ikisi asla aynı anda çalışmıyor (DpiEngineManager motor değişiminde hepsini
    // durduruyor, eşlik yalnızca ByeDPI aktifken devrede) ama savunmacı olarak ayrı tutuluyor.
    private const int UdpCompanionNfQueueNum = 101;

    private const string UdpCompanionArgs = "--dpi-desync=fake --dpi-desync-ttl=4";

    private readonly SettingsStore _settings;
    private readonly ILogger<ZapretEngine> _logger;
    private readonly LogRingBuffer _logs = new(200);
    private Process? _process;
    private Process? _udpCompanionProcess;
    private bool _lastProbeFailed;

    public string Id => "zapret";
    public string DisplayName => "Zapret";
    public bool RequiresSystemWideAccess => true;

    public bool IsManualActivation { get; set; }

    public ZapretEngine(SettingsStore settings, ILogger<ZapretEngine> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false }) return;

        _lastProbeFailed = false;

        var rejected = _settings.Current.ZapretRejectedArgs;

        _settings.Current.EngineArgs.TryGetValue(Id, out var savedArgs);
        if (!string.IsNullOrWhiteSpace(savedArgs) && !rejected.Contains(savedArgs))
        {
            if (_settings.Current.ZapretVerifiedProtocol is { } savedProtocol)
            {
                DnsProtocolTiers.ApplyTier(_settings, savedProtocol);
            }

            for (var attempt = 1; attempt <= SavedArgsRetryAttempts; attempt++)
            {
                var label = $"Kayıtlı ayar deneniyor ({attempt}/{SavedArgsRetryAttempts})";
                if (await TryCandidateAsync(savedArgs, label, ct)) return;
            }
            _logger.LogWarning(
                "Zapret kayıtlı ayarı {Max} denemenin tamamında başarısız oldu, aday taramasına geçiliyor: {Args}",
                SavedArgsRetryAttempts, savedArgs);
            _logs.Add("Kayıtlı ayar üç denemede de başarısız oldu, aday taramasına geçiliyor.");
        }

        if (IsManualActivation && _settings.Current.ManualDnsProtocol is { } pinnedProtocol)
        {
            DnsProtocolTiers.ApplyTier(_settings, pinnedProtocol);
            _logger.LogInformation("Zapret: Manuel modda sabitlenen DNS protokolü {Protocol} ile aday listesi taranıyor", pinnedProtocol);
            _logs.Add($"Manuel modda sabitlenen DNS protokolü ({pinnedProtocol}) ile aday listesi taranıyor...");

            if (await ScanCandidatesAsync(savedArgs, rejected, ct))
            {
                if (pinnedProtocol == DnsProtocol.None) DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
                return;
            }

            DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
            _logger.LogError("Zapret: sabitlenen DNS protokolü {Protocol} ile hiçbir strateji Discord'a erişemedi", pinnedProtocol);
            _logs.Add($"Sabitlenen DNS protokolü ({pinnedProtocol}) ile hiçbir strateji Discord'a erişemedi.");
            _lastProbeFailed = true;
            throw new AllCandidatesFailedException(Id);
        }

        foreach (var protocol in DnsProtocolTiers.Order)
        {
            DnsProtocolTiers.ApplyTier(_settings, protocol);
            _logger.LogInformation("Zapret: DNS protokolü {Protocol} aktifken aday listesi taranıyor", protocol);
            _logs.Add($"DNS protokolü {protocol} aktifken aday listesi taranıyor...");

            if (await ScanCandidatesAsync(savedArgs, rejected, ct))
            {
                if (protocol == DnsProtocol.None) DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
                return;
            }
        }

        DnsProtocolTiers.RestoreDefaultAfterNoneTier(_settings);
        _logger.LogError("Denenen hiçbir Zapret stratejisi/DNS protokolü kombinasyonu Discord'a erişemedi ({Count} strateji x {Tiers} protokol/tier)", CandidateStrategies.Length, DnsProtocolTiers.Order.Length);
        _logs.Add("Denenen hiçbir strateji/DNS protokolü kombinasyonu Discord'a erişemedi.");
        _lastProbeFailed = true;
        throw new AllCandidatesFailedException(Id);
    }

    private async Task<bool> ScanCandidatesAsync(string? savedArgs, List<string> rejected, CancellationToken ct)
    {
        foreach (var candidate in CandidateStrategies)
        {
            if (candidate == savedArgs) continue;
            if (rejected.Contains(candidate))
            {
                _logger.LogInformation("Zapret stratejisi atlanıyor (gerçek sayfa yüklemesinde daha önce başarısız oldu): {Args}", candidate);
                continue;
            }
            ct.ThrowIfCancellationRequested();
            if (await TryCandidateAsync(candidate, "Deneniyor", ct)) return true;
        }
        return false;
    }

    private async Task<bool> TryCandidateAsync(string candidate, string label, CancellationToken ct)
    {
        _logger.LogInformation("Zapret stratejisi deneniyor ({Label}): {Args}", label, candidate);
        _logs.Add($"{label}: {candidate}");

        try
        {
            await SpawnAsync(candidate, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Zapret stratejisi başlatılamadı: {Args}", candidate);
            _logs.Add($"Başlatılamadı: {ex.Message}");
            return false;
        }

        await Task.Delay(DriverAttachDelay, ct);
        var reachable = await TestConnectivityAsync(TimeSpan.FromSeconds(12));

        if (reachable)
        {
            _logger.LogInformation("Zapret stratejisi çalışıyor, kaydediliyor: {Args}", candidate);
            _logs.Add("Bu strateji çalışıyor, kaydedildi.");
            _settings.Current.EngineArgs[Id] = candidate;
            _settings.Current.ZapretVerified = true;
            _settings.Current.DnsProtocolVerified = true;
            _settings.Current.ZapretVerifiedProtocol = _settings.Current.VerifiedDnsProtocol;
            _settings.Save();
            return true;
        }

        _logger.LogWarning("Zapret stratejisi Discord'a erişemedi: {Args}", candidate);
        _logs.Add("Bu strateji Discord'a erişemedi.");
        await StopAsync(ct);
        return false;
    }

    public async Task StopAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false } process)
        {
            try
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _process = null;
        await RemoveNfQueueRulesAsync(NfQueueNum, includeTcp: true, includeUdp: true);
    }

    public EngineStatus GetStatus()
    {
        var running = _process is { HasExited: false };
        string detail;
        if (running) detail = "Aktif (sistem geneli)";
        else if (_lastProbeFailed) detail = "Denenen hiçbir strateji Discord'a erişemedi";
        else detail = "Durduruldu";

        return new EngineStatus(Id, DisplayName, running, RequiresSystemWideAccess, null, detail);
    }

    public bool IsUdpCompanionRunning => _udpCompanionProcess is { HasExited: false };

    /// <summary>Otomatik modda ByeDPI, Zapret'in tüm adayları başarısız olup eskalasyonla
    /// devreye girdiğinde çağrılır: ByeDPI zaten metin/HTTPS trafiğini kendi SOCKS5 proxy'si
    /// üzerinden taşıyor, bu ayrı nfqws süreci yalnızca UDP (ses) portlarını mangle'lıyor.
    /// İdempotent: zaten çalışıyorsa no-op.</summary>
    public async Task StartUdpCompanionAsync(CancellationToken ct)
    {
        if (_udpCompanionProcess is { HasExited: false }) return;

        await AddNfQueueRulesAsync(UdpCompanionNfQueueNum, includeTcp: false, includeUdp: true);

        var exePath = BinaryLocator.Resolve("zapret", Path.Combine("nfq", "nfqws"));
        var binDir = Path.GetDirectoryName(exePath)!;

        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = binDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add($"--qnum={UdpCompanionNfQueueNum}");
        foreach (var arg in SplitArgs(UdpCompanionArgs)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add($"[UDP eşlik] {e.Data}"); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add($"[UDP eşlik] {e.Data}"); };
        process.Exited += (_, _) => { try { _logger.LogWarning("Zapret UDP eşlik süreci beklenmedik şekilde durdu"); } catch { /* bkz. DnsProxyToolProcess.cs'teki not */ } };

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zapret UDP eşlik süreci başlatılamadı");
            process.Dispose();
            await RemoveNfQueueRulesAsync(UdpCompanionNfQueueNum, includeTcp: false, includeUdp: true);
            return;
        }

        _udpCompanionProcess = process;
        _udpCompanionProcess.BeginOutputReadLine();
        _udpCompanionProcess.BeginErrorReadLine();
        _logger.LogInformation("Zapret UDP eşlik süreci (ses için) başlatıldı: {Args}", UdpCompanionArgs);
        _logs.Add($"[UDP eşlik] ByeDPI ile birlikte, yalnızca ses (UDP) için başlatılıyor: {UdpCompanionArgs}");

        await Task.Delay(DriverAttachDelay, ct);
    }

    public async Task StopUdpCompanionAsync()
    {
        if (_udpCompanionProcess is { HasExited: false } process)
        {
            try
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _udpCompanionProcess = null;
        await RemoveNfQueueRulesAsync(UdpCompanionNfQueueNum, includeTcp: false, includeUdp: true);
    }

    public IReadOnlyList<string> GetRecentLogs() => _logs.Snapshot();
    public void ClearLogs() => _logs.Clear();

    public int? GetOwnProcessId() => _process is { HasExited: false } ? _process.Id : null;
    public int? GetUdpCompanionProcessId() => _udpCompanionProcess is { HasExited: false } ? _udpCompanionProcess.Id : null;

    /// <summary>nfqws'i verilen argümanlarla, kendi NFQUEUE kuyruğu kurulduktan sonra başlatır.
    /// Windows'taki Win32Exception(740) (yetersiz yetki) karşılığı Linux'ta iptables/nfqws'in
    /// CAP_NET_ADMIN/CAP_NET_RAW olmadan "Operation not permitted" ile başarısız olmasıdır —
    /// DOĞRULANMADI, bkz. PORTING_PLAN.md R-4.3.</summary>
    private async Task SpawnAsync(string args, CancellationToken ct)
    {
        await AddNfQueueRulesAsync(NfQueueNum, includeTcp: true, includeUdp: true);

        var exePath = BinaryLocator.Resolve("zapret", Path.Combine("nfq", "nfqws"));
        var binDir = Path.GetDirectoryName(exePath)!;

        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = binDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add($"--qnum={NfQueueNum}");
        foreach (var arg in SplitArgs(args)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.Exited += (_, _) => { try { _logger.LogWarning("Zapret (nfqws) beklenmedik şekilde durdu"); } catch { /* bkz. DnsProxyToolProcess.cs'teki not */ } };

        try
        {
            process.Start();
        }
        catch
        {
            process.Dispose();
            await RemoveNfQueueRulesAsync(NfQueueNum, includeTcp: true, includeUdp: true);
            throw;
        }

        _process = process;
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _logger.LogInformation("Zapret başlatıldı (args: {Args})", args);

        await Task.Delay(50, ct);
    }

    private const int ConnectivityTestAttempts = 2;
    private static readonly TimeSpan ConnectivityRetryDelay = TimeSpan.FromSeconds(1.5);

    private async Task<bool> TestConnectivityAsync(TimeSpan timeout)
    {
        for (var attempt = 1; attempt <= ConnectivityTestAttempts; attempt++)
        {
            try
            {
                using var handler = new SocketsHttpHandler
                {
                    ConnectCallback = async (context, ct) =>
                    {
                        var ip = await SelfTestResolver.ResolveAsync(context.DnsEndPoint.Host, ct)
                            ?? throw new InvalidOperationException($"DNS ile {context.DnsEndPoint.Host} çözümlenemedi");
                        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                        try
                        {
                            await socket.ConnectAsync(ip, context.DnsEndPoint.Port, ct);
                            return new NetworkStream(socket, ownsSocket: true);
                        }
                        catch
                        {
                            socket.Dispose();
                            throw;
                        }
                    },
                };
                using var client = new HttpClient(handler) { Timeout = timeout };
                using var response = await client.GetAsync(ConnectivityProbeUrl);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Zapret bağlantı testi hatası (deneme {Attempt}/{Max}): {Error}", attempt, ConnectivityTestAttempts, ex.Message);
                _logs.Add($"Bağlantı testi hatası (deneme {attempt}/{ConnectivityTestAttempts}): {ex.Message}");
                if (attempt < ConnectivityTestAttempts) await Task.Delay(ConnectivityRetryDelay);
                continue;
            }
        }
        return false;
    }

    private static IEnumerable<string> SplitArgs(string args) =>
        args.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>DOĞRULANMADI (bkz. PORTING_PLAN.md R-4.2): TCP 80/443 ve UDP 443,50000-65535'i
    /// (Discord metin+ses trafiği, Windows'taki --wf-tcp=/--wf-udp= ile AYNI port kümesi)
    /// verilen NFQUEUE kuyruğuna yönlendiren iptables kuralları ekler. `--queue-bypass`
    /// BİLEREK kullanılıyor: nfqws herhangi bir sebeple çökerse/başlamazsa paketler
    /// SESSİZCE DÜŞÜRÜLMEK yerine normal şekilde geçsin (Discord'un WinDivert'siz Windows
    /// fallback davranışına en yakın karşılık) — internet erişimini tamamen kesen bir
    /// başarısızlık modundan kaçınmak için bilinçli bir tercih.</summary>
    private static async Task AddNfQueueRulesAsync(int queueNum, bool includeTcp, bool includeUdp)
    {
        if (includeTcp)
        {
            await RunIptablesAsync("-I", "OUTPUT", "-p", "tcp", "-m", "multiport", "--dports", "80,443",
                "-j", "NFQUEUE", "--queue-num", queueNum.ToString(), "--queue-bypass");
        }
        if (includeUdp)
        {
            await RunIptablesAsync("-I", "OUTPUT", "-p", "udp", "-m", "multiport", "--dports", "443,50000:65535",
                "-j", "NFQUEUE", "--queue-num", queueNum.ToString(), "--queue-bypass");
        }
    }

    /// <summary>AddNfQueueRulesAsync'in eklediği kuralları kaldırır — motor durdurulduğunda
    /// (ya da başlatma başarısız olduğunda) MUTLAKA çağrılmalı, aksi halde kalıntı bir kural
    /// bir sonraki motor denemesinde (nfqws artık dinlemiyorken --queue-bypass sayesinde
    /// paketler yine de geçer, ama gereksiz/yanlış bir kuyruğa yönlendirme kalıntısı olarak
    /// birikir). "-D" (delete) "-I" (insert) ile TAM AYNI argüman listesini kullanır — iptables
    /// bunu, kuralın kendisini eşleştirip silmek için gerektirir.</summary>
    private static async Task RemoveNfQueueRulesAsync(int queueNum, bool includeTcp, bool includeUdp)
    {
        if (includeTcp)
        {
            await RunIptablesAsync("-D", "OUTPUT", "-p", "tcp", "-m", "multiport", "--dports", "80,443",
                "-j", "NFQUEUE", "--queue-num", queueNum.ToString(), "--queue-bypass");
        }
        if (includeUdp)
        {
            await RunIptablesAsync("-D", "OUTPUT", "-p", "udp", "-m", "multiport", "--dports", "443,50000:65535",
                "-j", "NFQUEUE", "--queue-num", queueNum.ToString(), "--queue-bypass");
        }
    }

    private static async Task RunIptablesAsync(params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "iptables",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        try
        {
            using var process = Process.Start(psi);
            if (process is null) return;
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            // Kural silme (-D) başarısız olabilir (ör. kural zaten yoksa, "Bad rule" hatası
            // verir) -- bu, motor zaten temiz bir durumdaysa BEKLENEN bir durum, servisi
            // çökertmemeli. Ekleme (-I) başarısızlığı da (ör. yetki yoksa) burada sessizce
            // yutuluyor -- nfqws zaten kendi başlatma hatasını (Process.Start exception'ı)
            // ayrı bildirecek, kullanıcıya iki farklı hata mesajı göstermemek için.
        }
        catch
        {
            // iptables sistemde yoksa/PATH'te değilse ya da başka bir sebeple başlatılamazsa
            // -- yine sessizce geç, nfqws'in kendi hatası zaten görünür olacak.
        }
    }
}
