using System.Diagnostics;
using SplitCord.Service.Config;

namespace SplitCord.Service.Engines;

/// <summary>
/// Alternatif DPI aşım motoru. goodbyedpi.exe'yi (ValdikSS/GoodbyeDPI) WinDivert sürücüsüyle
/// sistem geneli paket müdahalesi yapacak şekilde başlatır. Servis SYSTEM oturumunda
/// çalıştığı için WinDivert yüklemesi için ekstra bir UAC istemi gerekmez.
///
/// ByeDPI'deki gibi: motor doğrulanmamışsa (GoodbyeDpiVerified=false), <see cref="CandidateStrategies"/>
/// listesindeki argümanlar sırayla denenir — her adayla goodbyedpi başlatılıp gerçekten
/// discord.com'a ulaşılabiliyor mu diye test edilir (WinDivert sistem geneli çalıştığı için
/// test isteği doğrudan bu sürecin kendi HttpClient'ından yapılıyor, ByeDPI'deki gibi ayrı
/// bir proxy portu yok). İlk çalışan aday kalıcı olarak kaydedilir (EngineArgs +
/// GoodbyeDpiVerified=true), sonraki açılışlarda doğrudan o kullanılır ve yeniden test
/// edilmez. Bu motor genelde ByeDPI'nin TÜM adayları başarısız olduğunda DpiEngineManager
/// tarafından otomatik olarak devreye alınıyor (bkz. DpiEngineManager.SwitchToAsync).
/// </summary>
public sealed class GoodbyeDpiEngine : IDpiEngine
{
    // Kullanıcı tarafından sağlanan orijinal 36 kombinasyonun temizlenmiş hâli:
    // - Bu projede kullanılan GoodbyeDPI v0.2.2 yalnızca -1..-6 modesetlerini tanıyor;
    //   -7/-8/-9 içeren 19 kombinasyon gerçekte GEÇERSİZ ("unknown option") — goodbyedpi.exe
    //   hemen kullanım mesajı basıp çıkıyor, hiçbir zaman çalışmıyordu. Kaldırıldılar.
    // - Canlı teşhis: eklenen bağlantı-testi hata günlüğü (bkz. TestConnectivityAsync)
    //   düz adayların "SSL connection could not be established" ile, 1.1.1.1:53'e DNS
    //   yönlendiren adayların ise 12sn zaman aşımıyla başarısız olduğunu gösterdi — yani
    //   asıl sorun DPI stratejisi değil, standart DNS portu (53) üzerinden 1.1.1.1'e giden
    //   sorguların bu ağda engellenmesi/asılı kalmasıydı. Kullanıcının kendi elle
    //   doğruladığı, gerçekten çalışan komutu ("-5 --set-ttl 5 --dns-addr 77.88.8.8
    //   --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253" — Yandex DNS,
    //   standart olmayan 1253 portu) bunu doğruluyor. Bu yüzden onaylanmış komut BİRİNCİ
    //   aday, ve tüm DNS-yönlendirmeli fallback'ler artık 1.1.1.1:53 yerine aynı Yandex
    //   sunucusunu/1253 portunu kullanıyor.
    private static readonly string[] CandidateStrategies =
    {
        // Kullanıcı tarafından doğrulanmış, gerçekten çalışan tam komut.
        "-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "-5",
        "-6",
        "--auto-ttl",
        "-5 --auto-ttl",
        "-6 --auto-ttl",
        "-5 --wrong-seq",
        "-6 --wrong-seq",
        "--set-ttl 3",
        "-5 --set-ttl 3",
        "-6 --set-ttl 3",
        "-5 --set-ttl 4",
        "-6 --set-ttl 4",
        "-5 --set-ttl 7",
        "-6 --set-ttl 7",
        // Yalnızca yukarıdakilerin TAMAMI başarısız olursa denenen DNS-yönlendirmeli fallback'ler
        // (Yandex DNS, standart olmayan 1253 portu — bkz. yukarıdaki not).
        "-5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "-6 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "--set-ttl 3 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "-5 --set-ttl 3 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "-5 --set-ttl 4 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
        "-5 --set-ttl 7 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253",
    };

    // ByeDpiEngine'deki gibi: hafif bir API endpoint'i yerine gerçekten webview'in
    // yükleyeceği belgeyi test ediyoruz.
    private const string ConnectivityProbeUrl = "https://discord.com/app";

    // WinDivert sürücüsünün paket filtrelemeye gerçekten başlaması için goodbyedpi.exe
    // başlatıldıktan sonra kısa bir bekleme — ByeDPI'nin WaitForPortAsync'inin karşılığı
    // (burada dinlenen bir yerel port olmadığı için sabit bir süre kullanılıyor).
    private static readonly TimeSpan DriverAttachDelay = TimeSpan.FromSeconds(1.5);

    // İlk açılışta kayıtlı ayarın tek bir geçici aksaklık yüzünden boşa harcanmaması
    // için: aday taramasına düşmeden önce kaç kez GERÇEKTEN (spawn + test) denenir.
    private const int SavedArgsRetryAttempts = 3;

    private readonly SettingsStore _settings;
    private readonly ILogger<GoodbyeDpiEngine> _logger;
    private readonly LogRingBuffer _logs = new(200);
    private Process? _process;
    private bool _lastProbeFailed;

    public string Id => "goodbyedpi";
    public string DisplayName => "GoodbyeDPI";
    public bool RequiresSystemWideAccess => true;

    public GoodbyeDpiEngine(SettingsStore settings, ILogger<GoodbyeDpiEngine> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false }) return;

        _lastProbeFailed = false;

        var rejected = _settings.Current.GoodbyeDpiRejectedArgs;

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
                "GoodbyeDPI kayıtlı ayarı {Max} denemenin tamamında başarısız oldu, aday taramasına geçiliyor: {Args}",
                SavedArgsRetryAttempts, savedArgs);
            _logs.Add("Kayıtlı ayar üç denemede de başarısız oldu, aday taramasına geçiliyor.");
        }

        foreach (var candidate in CandidateStrategies)
        {
            if (candidate == savedArgs) continue; // az önce yukarıda 3 kez denendi
            if (rejected.Contains(candidate))
            {
                _logger.LogInformation("GoodbyeDPI stratejisi atlanıyor (gerçek sayfa yüklemesinde daha önce başarısız oldu): {Args}", candidate);
                continue;
            }
            ct.ThrowIfCancellationRequested();
            if (await TryCandidateAsync(candidate, "Deneniyor", ct)) return;
        }

        _logger.LogError("Denenen hiçbir GoodbyeDPI stratejisi Discord'a erişemedi ({Count} strateji)", CandidateStrategies.Length);
        _logs.Add("Denenen hiçbir strateji Discord'a erişemedi.");
        _lastProbeFailed = true;
        throw new AllCandidatesFailedException(Id);
    }

    /// <summary>Bir adayı başlatıp test eder; çalışıyorsa kaydedip true döner. label yalnızca
    /// günlük mesajı için (hangi aşamada/denemede olunduğunu ayırt etmek için).</summary>
    private async Task<bool> TryCandidateAsync(string candidate, string label, CancellationToken ct)
    {
        _logger.LogInformation("GoodbyeDPI stratejisi deneniyor ({Label}): {Args}", label, candidate);
        _logs.Add($"{label}: {candidate}");

        try
        {
            await SpawnAsync(candidate, ct);
        }
        catch (Exception ex)
        {
            // Bu aday hiç başlayamadıysa (ör. geçersiz argüman kombinasyonu) tüm
            // taramayı durdurmak yerine bir sonraki adaya geç.
            _logger.LogWarning(ex, "GoodbyeDPI stratejisi başlatılamadı: {Args}", candidate);
            _logs.Add($"Başlatılamadı: {ex.Message}");
            return false;
        }

        await Task.Delay(DriverAttachDelay, ct);
        var reachable = await TestConnectivityAsync(TimeSpan.FromSeconds(12));

        if (reachable)
        {
            _logger.LogInformation("GoodbyeDPI stratejisi çalışıyor, kaydediliyor: {Args}", candidate);
            _logs.Add("Bu strateji çalışıyor, kaydedildi.");
            _settings.Current.EngineArgs[Id] = candidate;
            _settings.Current.GoodbyeDpiVerified = true;
            _settings.Save();
            return true;
        }

        _logger.LogWarning("GoodbyeDPI stratejisi Discord'a erişemedi: {Args}", candidate);
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

    public IReadOnlyList<string> GetRecentLogs() => _logs.Snapshot();

    public int? GetOwnProcessId() => _process is { HasExited: false } ? _process.Id : null;

    /// <summary>goodbyedpi.exe'yi verilen argümanlarla başlatır. _process alanı yalnızca
    /// Process.Start() başarılı olursa atanır (aksi halde "başlatılmamış ama null olmayan"
    /// bir nesne kalır ve sonraki her HasExited kontrolü InvalidOperationException fırlatır).</summary>
    private async Task SpawnAsync(string args, CancellationToken ct)
    {
        var exePath = BinaryLocator.Resolve("goodbyedpi", "goodbyedpi.exe");

        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = Path.GetDirectoryName(exePath),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var arg in SplitArgs(args)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.Exited += (_, _) => _logger.LogWarning("GoodbyeDPI beklenmedik şekilde durdu");

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
        _logger.LogInformation("GoodbyeDPI başlatıldı (args: {Args})", args);

        // Exited event'inin (anında çöken kötü argümanlar için) işlenmesine kısa bir pay.
        await Task.Delay(50, ct);
    }

    // Canlı testte doğrulandı: GoodbyeDPI'nin fake-packet/TTL tekniği aktif olduktan hemen
    // sonraki İLK birkaç bağlantı denemesi bazen ERR_CONNECTION_RESET'e benzer bir
    // sıfırlanmayla başarısız olup hemen ardından KALICI olarak istikrar kazanabiliyor
    // (kullanıcının Discord webview'inde gözlemlendi: ilk birkaç yükleme resetlendi, sonraki
    // denemeler sürekli başarılı oldu). Tek bir denemeyle "başarısız" damgalayıp gerçekte
    // çalışan bir adayı haksız yere elemek yerine birkaç kez deniyoruz.
    private const int ConnectivityTestAttempts = 2;
    private static readonly TimeSpan ConnectivityRetryDelay = TimeSpan.FromSeconds(1.5);

    /// <summary>WinDivert sistem geneli çalıştığı için (ByeDPI'nin aksine ayrı bir proxy
    /// portu yok) bu sürecin KENDİ HttpClient isteği de goodbyedpi'nin paket müdahalesine
    /// tabi oluyor — bu yüzden doğrudan discord.com/app'e normal bir istek atıp test
    /// edebiliyoruz. Herhangi bir HTTP yanıtı (hata durum kodu dahil) "erişilebilir" sayılır.</summary>
    private async Task<bool> TestConnectivityAsync(TimeSpan timeout)
    {
        for (var attempt = 1; attempt <= ConnectivityTestAttempts; attempt++)
        {
            try
            {
                using var client = new HttpClient { Timeout = timeout };
                using var response = await client.GetAsync(ConnectivityProbeUrl);
                return true;
            }
            catch (Exception ex)
            {
                // Hatanın GERÇEK nedenini (TLS güven hatası, bağlantı reddedildi, zaman aşımı
                // vb.) görünür kılıyoruz — önceden sessizce yutuluyordu ve "neden başarısız
                // oldu" teşhis edilemiyordu.
                _logger.LogWarning("GoodbyeDPI bağlantı testi hatası (deneme {Attempt}/{Max}): {Error}", attempt, ConnectivityTestAttempts, ex.Message);
                _logs.Add($"Bağlantı testi hatası (deneme {attempt}/{ConnectivityTestAttempts}): {ex.Message}");
                if (attempt < ConnectivityTestAttempts) await Task.Delay(ConnectivityRetryDelay);
            }
        }
        return false;
    }

    private static IEnumerable<string> SplitArgs(string args) =>
        args.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
