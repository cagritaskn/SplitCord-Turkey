using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using SplitCord.Service.Config;

namespace SplitCord.Service.Engines;

/// <summary>
/// Alternatif DPI aşım motoru. winws.exe'yi (bol-van/zapret) WinDivert sürücüsüyle sistem
/// geneli çalıştırır.
///
/// ByeDPI/GoodbyeDPI'deki gibi: motor doğrulanmamışsa (ZapretVerified=false), <see
/// cref="CandidateStrategies"/> listesindeki argümanlar sırayla denenir — her adayla winws
/// başlatılıp gerçekten discord.com'a ulaşılabiliyor mu diye test edilir (WinDivert sistem
/// geneli çalıştığı için test isteği doğrudan bu sürecin kendi HttpClient'ından yapılıyor,
/// GoodbyeDPI'deki gibi). İlk çalışan aday kalıcı olarak kaydedilir (EngineArgs +
/// ZapretVerified=true), sonraki açılışlarda doğrudan o kullanılır. Bu motor genelde
/// GoodbyeDPI'nin de TÜM adayları başarısız olduğunda DpiEngineManager tarafından otomatik
/// olarak devreye alınıyor (bkz. DpiEngineManager.SwitchToAsync/TryEscalateAsync).
/// </summary>
public sealed class ZapretEngine : IDpiEngine
{
    // Kullanıcı tarafından sağlanan, sırayla denenecek hazır kombinasyonlar.
    //
    // ÖNEMLİ: --wf-udp aralığı 50000-65535 olarak GENİŞLETİLDİ (önceden yalnızca 443 ve
    // sabit 50000/50100 portlarını — ya da en fazla 50000-50099'u — kapsıyordu). Discord'un
    // sesli kanal (WebRTC/RTP) trafiği 50000-65535 arasında HER SEFERİNDE FARKLI, dinamik bir
    // UDP portu kullanıyor; dar aralık yüzünden gerçek bir sesli görüşmenin portu WinDivert
    // filtresine hiç girmiyor, dolayısıyla desync taktikleri o trafiğe hiç uygulanmıyordu.
    // Canlı belirti: metin/gateway sorunsuz ama sesli kanala bağlanma sürekli düşüyordu
    // (Superonline gibi UDP'yi hedefleyen ISP'lerde) — ByeDPI zaten yalnızca bu uygulamanın
    // kendi SOCKS5 proxy'si üzerinden TCP/TLS taşıdığı için (WebRTC medyası tarayıcılarda
    // proxy'yi atlar) sese hiç dokunamıyor; bu yüzden ses sorunu ancak sistem geneli çalışan
    // Zapret/GoodbyeDPI ile çözülebilir, ve Zapret'in UDP filtresi doğru portları kapsamalı.
    private static readonly string[] CandidateStrategies =
    {
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-ttl=4",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-ttl=3",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fooling=md5sig",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fooling=md5sig --dpi-desync-ttl=3",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-ttl=1 --dpi-desync-autottl=3",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=multisplit --dpi-desync-split-pos=2",

        // Vodafone TR gibi salt "fake" paketini (rastgele/sentetik payload) SNI seviyesinde
        // ayırt edip filtreleyebilen daha katı DPI'lara karşı: fake paketin içeriği olarak
        // GERÇEK, tanıdık bir alan adına (google.com) ait TLS ClientHello kullanılıyor — bu
        // ISP'nin whitelist'inde olma ihtimali sentetik paketten çok daha yüksek. Dosya zaten
        // Flowseal/zapret-discord-youtube ile birlikte geliyor (bkz. resources/bin/zapret/bin).
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-ttl=4",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-fooling=md5sig",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake,multisplit --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin --dpi-desync-split-pos=2",

        // "badseq" fooling (paketin TCP sequence numarasını bozarak DPI'nin fake paketi asıl
        // akışın parçası sanmasını engelliyor) — yalnızca ttl/md5sig fooling'i denemek yeterli
        // gelmeyen bazı ISP'lerde (ör. Vodafone TR raporu) etkili olduğu biliniyor.
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fooling=badseq",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-fooling=badseq --dpi-desync-ttl=3",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=multisplit --dpi-desync-split-seqovl=1 --dpi-desync-fooling=md5sig",
        "--wf-tcp=80,443 --wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fooling=badseq",
    };

    private const string ConnectivityProbeUrl = "https://discord.com/app";

    // WinDivert sürücüsünün paket filtrelemeye gerçekten başlaması için winws.exe
    // başlatıldıktan sonra kısa bir bekleme (GoodbyeDpiEngine ile aynı yaklaşım).
    private static readonly TimeSpan DriverAttachDelay = TimeSpan.FromSeconds(1.5);

    // İlk açılışta kayıtlı ayarın tek bir geçici aksaklık yüzünden boşa harcanmaması
    // için: aday taramasına düşmeden önce kaç kez GERÇEKTEN (spawn + test) denenir.
    private const int SavedArgsRetryAttempts = 3;

    // "UDP eşlik" süreci — bkz. StartUdpCompanionAsync. --wf-tcp YOK: yalnızca Discord'un
    // ses/görüntü (WebRTC/RTP) trafiğinin kullandığı UDP port aralığını filtreliyor,
    // ByeDPI'nin kendi SOCKS5 proxy'si üzerinden geçen HTTPS/WSS trafiğine hiç dokunmuyor.
    // HTTPS tabanlı bağlantı testi UDP/ses başarısını doğrulayamadığı için (RTP'nin TLS
    // handshake'i gibi taklit edilebilir bir yapısı yok) burada aday tarama YOK — sabit,
    // makul bir varsayılan strateji.
    private const string UdpCompanionArgs = "--wf-udp=443,50000-65535 --dpi-desync=fake --dpi-desync-ttl=4";

    private readonly SettingsStore _settings;
    private readonly ILogger<ZapretEngine> _logger;
    private readonly LogRingBuffer _logs = new(200);
    private Process? _process;
    private Process? _udpCompanionProcess;
    private bool _lastProbeFailed;

    public string Id => "zapret";
    public string DisplayName => "Zapret";
    public bool RequiresSystemWideAccess => true;

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

        // Kayıtlı bir ayar varsa (doğrulanmış olsun ya da olmasın — doğrulama ör.
        // webview'de gerçek bir hata bildirilip ReportEngineFailureAsync çağrıldığında
        // sıfırlanmış olabilir ama ayar hâlâ kayıtlı kalır), aday taramasına hiç
        // düşmeden önce onu GERÇEKTEN doğrulayarak (spawn + sürücü oturma süresi +
        // bağlantı testi) art arda SavedArgsRetryAttempts kez dener — tek seferlik bir
        // ağ/sürücü aksaklığı yüzünden hâlâ çalışan bir ayarın boşa (gereksiz bir
        // yeniden taramaya düşülerek) harcanmaması için. Kullanıcı bu ayarı AÇIKÇA
        // yasakladıysa (Argüman Setini Yasakla) hiç denemiyoruz.
        _settings.Current.EngineArgs.TryGetValue(Id, out var savedArgs);
        if (!string.IsNullOrWhiteSpace(savedArgs) && !rejected.Contains(savedArgs))
        {
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

        foreach (var candidate in CandidateStrategies)
        {
            if (candidate == savedArgs) continue; // az önce yukarıda 3 kez denendi
            if (rejected.Contains(candidate))
            {
                _logger.LogInformation("Zapret stratejisi atlanıyor (gerçek sayfa yüklemesinde daha önce başarısız oldu): {Args}", candidate);
                continue;
            }
            ct.ThrowIfCancellationRequested();
            if (await TryCandidateAsync(candidate, "Deneniyor", ct)) return;
        }

        _logger.LogError("Denenen hiçbir Zapret stratejisi Discord'a erişemedi ({Count} strateji)", CandidateStrategies.Length);
        _logs.Add("Denenen hiçbir strateji Discord'a erişemedi.");
        _lastProbeFailed = true;
        throw new AllCandidatesFailedException(Id);
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
                // WinDivert sürücüsü GoodbyeDPI/Zapret arasında paylaşılıyor ve aynı anda
                // yalnızca birine bağlanabiliyor — bir sonraki motor başlamadan önce bu
                // sürecin (ve sürücü tanıtıcısının) GERÇEKTEN kapandığından emin olmak için
                // kısa bir süre bekliyoruz (Kill() OS seviyesinde asenkron).
                await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _process = null;
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
    /// devreye girdiğinde çağrılır (bkz. DpiEngineManager.SwitchToAsync): ByeDPI zaten
    /// metin/HTTPS trafiğini kendi SOCKS5 proxy'si üzerinden taşıyor, bu ayrı winws.exe
    /// süreci yalnızca UDP (ses) portlarını filtreliyor — ByeDPI'nin TCP akışına hiç
    /// karışmıyor. İdempotent: zaten çalışıyorsa no-op.</summary>
    public async Task StartUdpCompanionAsync(CancellationToken ct)
    {
        if (_udpCompanionProcess is { HasExited: false }) return;

        var exePath = BinaryLocator.Resolve("zapret", Path.Combine("bin", "winws.exe"));
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
        foreach (var arg in SplitArgs(UdpCompanionArgs)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add($"[UDP eşlik] {e.Data}"); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add($"[UDP eşlik] {e.Data}"); };
        process.Exited += (_, _) => _logger.LogWarning("Zapret UDP eşlik süreci beklenmedik şekilde durdu");

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Zapret UDP eşlik süreci başlatılamadı");
            process.Dispose();
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
    }

    public IReadOnlyList<string> GetRecentLogs() => _logs.Snapshot();

    public int? GetOwnProcessId() => _process is { HasExited: false } ? _process.Id : null;

    // ByeDPI'ye eşlik eden UDP-only winws.exe süreci de bizim başlattığımız, kasıtlı bir
    // süreç — "Harici winws" tespitinin bunu yabancı/unutulmuş bir kopya sanıp uyarmaması
    // için ana zapret sürecinin PID'i gibi bu da bilinen/kendi PID listemize dahil edilmeli
    // (bkz. SystemControlsHelper.GetStatus).
    public int? GetUdpCompanionProcessId() => _udpCompanionProcess is { HasExited: false } ? _udpCompanionProcess.Id : null;

    /// <summary>winws.exe'yi verilen argümanlarla başlatır. _process alanı yalnızca
    /// Process.Start() başarılı olursa atanır (aksi halde "başlatılmamış ama null olmayan"
    /// bir nesne kalır ve sonraki her HasExited kontrolü InvalidOperationException fırlatır).
    /// winws.exe admin/SYSTEM yetkisi olmadan başlatılırsa Win32Exception(740) fırlatır.</summary>
    private async Task SpawnAsync(string args, CancellationToken ct)
    {
        var exePath = BinaryLocator.Resolve("zapret", Path.Combine("bin", "winws.exe"));
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
        foreach (var arg in SplitArgs(args)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.Exited += (_, _) => _logger.LogWarning("Zapret (winws.exe) beklenmedik şekilde durdu");

        try
        {
            process.Start();
        }
        catch
        {
            process.Dispose();
            throw;
        }

        _process = process;
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _logger.LogInformation("Zapret başlatıldı (args: {Args})", args);

        await Task.Delay(50, ct);
    }

    // GoodbyeDpiEngine'deki gibi: fake-packet/TTL tabanlı tekniklerde ilk birkaç bağlantı
    // denemesi geçici olarak sıfırlanıp hemen ardından istikrar kazanabiliyor — tek denemeyle
    // gerçekte çalışan bir adayı haksız yere elemek yerine birkaç kez deniyoruz.
    private const int ConnectivityTestAttempts = 2;
    private static readonly TimeSpan ConnectivityRetryDelay = TimeSpan.FromSeconds(1.5);

    /// <summary>Zapret'in (winws.exe) GoodbyeDPI'nin --dns-addr'ı gibi kendi bir DNS/DoH
    /// mekanizması yok — sistem çözümleyicisine (ISP DNS'i potansiyel olarak zehirli/engelli
    /// olabilir) bırakılırsa test neredeyse her zaman başarısız oluyordu (canlı testte
    /// doğrulandı). Bu yüzden ismi kendimiz Cloudflare'in DoH uç noktasından (1.1.1.1,
    /// IP harfiyen kullanıldığı için bu isteğin kendisi bile sistem DNS'ine bağımlı değil)
    /// çözüp SocketsHttpHandler.ConnectCallback ile doğrudan o IP'ye bağlanıyoruz — TLS SNI
    /// yine de context.DnsEndPoint.Host'tan (discord.com) geliyor, yani sertifika doğrulaması
    /// normal şekilde çalışıyor.</summary>
    private static async Task<IPAddress?> ResolveViaDohAsync(string hostname, CancellationToken ct)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            client.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/dns-json");
            using var response = await client.GetAsync($"https://1.1.1.1/dns-query?name={hostname}&type=A", ct);
            response.EnsureSuccessStatusCode();
            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.TryGetProperty("Answer", out var answers))
            {
                foreach (var answer in answers.EnumerateArray())
                {
                    if (answer.TryGetProperty("type", out var type) && type.GetInt32() == 1
                        && answer.TryGetProperty("data", out var data)
                        && IPAddress.TryParse(data.GetString(), out var ip))
                    {
                        return ip;
                    }
                }
            }
        }
        catch
        {
            // aşağıda null dönülüp çağıran tarafta hata olarak ele alınıyor
        }
        return null;
    }

    /// <summary>WinDivert sistem geneli çalıştığı için (ByeDPI'nin aksine ayrı bir proxy
    /// portu yok) bu sürecin KENDİ isteği de winws'nin paket müdahalesine tabi oluyor — bu
    /// yüzden doğrudan discord.com/app'e normal bir istek atıp test edebiliyoruz. Herhangi
    /// bir HTTP yanıtı (hata durum kodu dahil) "erişilebilir" sayılır. DNS çözümlemesi
    /// yukarıdaki ResolveViaDohAsync ile yapılıyor (bkz. üstteki not).</summary>
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
                        var ip = await ResolveViaDohAsync(context.DnsEndPoint.Host, ct)
                            ?? throw new InvalidOperationException($"DoH ile {context.DnsEndPoint.Host} çözümlenemedi");
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
}
