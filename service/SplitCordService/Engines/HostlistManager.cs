using System.Text.RegularExpressions;
using SplitCord.Service.Config;

namespace SplitCord.Service.Engines;

/// <summary>
/// KULLANICI TALEBİ: Ayarlar > DPI Aşımı > Dışlamalar. Zapret VE Zapret2'nin ORTAK olarak
/// kullandığı, kullanıcı tarafından düzenlenebilen hostlist-exclude dosyasını yönetir.
///
/// Tek, paylaşılan, YAZILABİLİR bir dosya (%ProgramData%\SplitCord\zapret-hostlist-exclude.txt)
/// -- iki motor da winws.exe/winws2.exe'yi bu dosyanın MUTLAK yoluyla başlatıyor (bkz.
/// ZapretEngine/Zapret2Engine SpawnAsync), bu yüzden her motorun kendi farklı çalışma
/// dizini hiç sorun olmuyor. Hem zapret hem zapret2'nin resmi dokümantasyonu, tpws/nfqws'in
/// (ve nfqws2'nin) hostlist dosyalarını değişiklik zamanı/boyutu değiştiğinde OTOMATİK
/// yeniden yüklediğini doğruluyor -- yani buradaki her güncelleme, motorları yeniden
/// başlatmadan KISA SÜREDE kendiliğinden etkili olur.
///
/// "Kullanıcı tarafından eklenen domainler" (Dışlamalar penceresindeki kaldır-butonlu liste)
/// yalnızca AddDomain() ile ("+"" diyaloğu) eklenen girdileri izler -- manuel düzenleme
/// kutusuna doğrudan yazılan satırlar bu izlenen listeye HİÇ girmez (yalnızca dosyada kalır).
/// Bu, kullanıcının açık tercihiyle seçildi (bkz. sohbet geçmişi).
/// </summary>
public sealed class HostlistManager : IHostedService, IDisposable
{
    // repo kökünde tutulan, Windows+Linux ile PAYLAŞILAN kaynak (bkz. resources/zapret-lists/
    // splitcord-exclude.txt) -- kullanıcı bu dosyayı commit/push ederek güncelliyor, servis
    // periyodik olarak buradan yeni girdileri (yalnızca EKLEME, hiçbir zaman SİLME) çekiyor.
    public const string RepoRawUrl = "https://raw.githubusercontent.com/cagritaskn/SplitCord-Turkey/main/resources/zapret-lists/splitcord-exclude.txt";

    public const int MinUpdateIntervalHours = 1;
    public const int MaxUpdateIntervalHours = 24;

    public static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "SplitCord", "zapret-hostlist-exclude.txt");

    private static readonly Regex SchemeRegex = new(@"^[a-zA-Z][a-zA-Z0-9+.-]*://", RegexOptions.Compiled);
    // En az iki etiket (label) zorunlu -- bu, "com"/"net" gibi çıplak TLD'lerin ve ".com" gibi
    // öndeki etiketi boş girdilerin otomatik olarak reddedilmesini sağlıyor (kullanıcı talebi:
    // "TLD'ler girilemeyecek, girilirse internet erişim sorunları yaşanabilir" -- bir TLD'yi
    // tamamen dışlamak o TLD'deki HER SİTEYİ zapret'in desync koruması dışına iter).
    private static readonly Regex HostnameRegex = new(
        @"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$",
        RegexOptions.Compiled);

    private readonly SettingsStore _settings;
    private readonly ILogger<HostlistManager> _logger;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly object _fileLock = new();
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public HostlistManager(SettingsStore settings, ILogger<HostlistManager> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        EnsureSeeded();
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => RunPeriodicSyncLoopAsync(_cts.Token));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        return Task.CompletedTask;
    }

    public void Dispose() => _cts?.Dispose();

    /// <summary>Yazılabilir dosya hiç yoksa (ilk kurulum ya da elle silinmiş), bundled
    /// (salt okunur) varsayılan listeden tohumlar -- bkz. resources/zapret-lists/
    /// splitcord-exclude.txt, ZapretEngine'in bin/zapret/lists/ altına kopyalanan kopyası
    /// (csproj'daki ikinci Content Include bloğu). İnternet erişimi olmasa BİLE (ör. DPI
    /// aşımı henüz hiç çalışmamışken) makul bir varsayılan liste devrede olsun diye.</summary>
    private void EnsureSeeded()
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath)!;
            Directory.CreateDirectory(dir);
            if (File.Exists(FilePath)) return;

            var bundledSeed = Path.Combine(BinaryLocator.ToolDir("zapret"), "lists", "splitcord-exclude.txt");
            if (File.Exists(bundledSeed))
            {
                File.Copy(bundledSeed, FilePath);
                _logger.LogInformation("Hostlist dosyası bundled varsayılandan tohumlandı: {Path}", FilePath);
            }
            else
            {
                File.WriteAllText(FilePath, "");
                _logger.LogWarning("Bundled hostlist varsayılanı bulunamadı ({Seed}), boş dosyayla başlanıyor", bundledSeed);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Hostlist dosyası tohumlanamadı");
        }
    }

    public string GetContent()
    {
        lock (_fileLock)
        {
            try { return File.ReadAllText(FilePath); }
            catch { return ""; }
        }
    }

    private static List<string> ParseLines(string content) =>
        content
            .Split('\n')
            .Select(l => l.TrimEnd('\r').Trim())
            .Where(l => l.Length > 0)
            .ToList();

    /// <summary>Manuel düzenleme kutusundan gelen ham içeriği OLDUĞU GİBİ (satır satır trim
    /// dışında hiçbir doğrulama/normalize YAPMADAN) kaydeder -- "Gelişmiş"/manuel modun bu
    /// uygulamadaki diğer yerlerdeki (ör. ham DPI argüman düzenleme) aynı "güven ve kısıtlama"
    /// felsefesiyle tutarlı. HostlistUserAddedDomains İZLENEN LİSTESİNE KASITLI OLARAK
    /// DOKUNMUYOR -- yalnızca "+" diyaloğuyla eklenenler o listede izleniyor (bkz. sınıf üstü not).</summary>
    public void SetContentManual(string content)
    {
        lock (_fileLock)
        {
            var lines = ParseLines(content);
            File.WriteAllText(FilePath, string.Join('\n', lines) + (lines.Count > 0 ? "\n" : ""));
        }
    }

    public IReadOnlyList<string> GetUserAddedDomains() => _settings.Current.HostlistUserAddedDomains;

    /// <summary>rawInput'u normalize edip (şema/yol/port temizleme, küçük harfe çevirme)
    /// doğrular; geçerliyse dosyaya ve izlenen kullanıcı listesine ekler. Zaten mevcutsa
    /// (ör. repo'nun temel listesinde ya da daha önce eklenmişse) hata VERMEZ, idempotent
    /// olarak başarı döner -- kullanıcıya "eklendi" onayını göstermek için (bkz. istemci).</summary>
    public (bool Ok, string? NormalizedDomain, string? Error) AddDomain(string rawInput)
    {
        var (normalized, error) = NormalizeAndValidate(rawInput);
        if (normalized is null) return (false, null, error);

        lock (_fileLock)
        {
            var lines = ParseLines(GetContent());
            if (!lines.Contains(normalized, StringComparer.OrdinalIgnoreCase))
            {
                lines.Add(normalized);
                File.WriteAllText(FilePath, string.Join('\n', lines) + "\n");
            }
        }

        if (!_settings.Current.HostlistUserAddedDomains.Contains(normalized, StringComparer.OrdinalIgnoreCase))
        {
            _settings.Current.HostlistUserAddedDomains.Add(normalized);
            _settings.Save();
        }

        return (true, normalized, null);
    }

    /// <summary>Yalnızca kullanıcının "+" diyaloğuyla eklediği bir domaini kaldırır -- hem
    /// dosyadan hem izlenen listeden. Repo'nun temel listesindeki bir girdiyi kaldırmak
    /// İÇİN DEĞİL (o zaten bu listede görünmez, bkz. GetUserAddedDomains).</summary>
    public bool RemoveUserDomain(string domain)
    {
        var normalized = domain.Trim().ToLowerInvariant();
        var removedFromTracked = _settings.Current.HostlistUserAddedDomains
            .RemoveAll(d => string.Equals(d, normalized, StringComparison.OrdinalIgnoreCase)) > 0;

        lock (_fileLock)
        {
            var lines = ParseLines(GetContent());
            var removedFromFile = lines.RemoveAll(l => string.Equals(l, normalized, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removedFromFile)
            {
                File.WriteAllText(FilePath, string.Join('\n', lines) + (lines.Count > 0 ? "\n" : ""));
            }
        }

        if (removedFromTracked) _settings.Save();
        return removedFromTracked;
    }

    /// <summary>Repodaki paylaşılan listeyi çekip, o listede olup mevcut dosyada OLMAYAN her
    /// satırı dosyanın SONUNA ekler -- ASLA hiçbir satırı SİLMEZ (kullanıcı talebi: "kullanıcının
    /// eklediği domainler kesinlikle silinmeyecek"; silme yapmadığı için repo'daki temel
    /// girdiler de dolaylı olarak hep korunmuş olur). Eklenen satır sayısını döndürür.</summary>
    public async Task<int> SyncFromRepoAsync(CancellationToken ct)
    {
        string repoContent;
        try
        {
            repoContent = await _http.GetStringAsync(RepoRawUrl, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Hostlist repo senkronu başarısız (ağ/erişim sorunu olabilir): {Error}", ex.Message);
            return 0;
        }

        var repoLines = ParseLines(repoContent);
        int addedCount;
        lock (_fileLock)
        {
            var currentLines = ParseLines(GetContent());
            var currentSet = new HashSet<string>(currentLines, StringComparer.OrdinalIgnoreCase);
            var newOnes = repoLines.Where(l => !currentSet.Contains(l)).ToList();
            addedCount = newOnes.Count;
            if (addedCount > 0)
            {
                currentLines.AddRange(newOnes);
                File.WriteAllText(FilePath, string.Join('\n', currentLines) + "\n");
            }
        }

        _settings.Current.HostlistLastSyncUtc = DateTime.UtcNow;
        _settings.Save();

        if (addedCount > 0)
        {
            _logger.LogInformation("Hostlist repo senkronu: {Count} yeni girdi eklendi", addedCount);
        }
        return addedCount;
    }

    private async Task RunPeriodicSyncLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (_settings.Current.HostlistAutoUpdateEnabled)
            {
                try { await SyncFromRepoAsync(ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Hostlist periyodik senkron döngüsünde beklenmedik hata");
                }
            }

            var hours = Math.Clamp(_settings.Current.HostlistUpdateIntervalHours, MinUpdateIntervalHours, MaxUpdateIntervalHours);
            try { await Task.Delay(TimeSpan.FromHours(hours), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>KULLANICI TALEBİ: girdinin başındaki http(s):// temizlenir, yol/sorgu/port
    /// atılır, küçük harfe çevrilir. Subdomain varsa OLDUĞU GİBİ korunur (ör.
    /// "forum.sahibinden.com" -> "forum.sahibinden.com", "sahibinden.com" değil). En az iki
    /// etiket zorunlu olduğu için çıplak TLD'ler ("com", ".net") otomatik reddedilir.</summary>
    internal static (string? Normalized, string? Error) NormalizeAndValidate(string rawInput)
    {
        if (string.IsNullOrWhiteSpace(rawInput)) return (null, "Geçersiz URL");

        var s = rawInput.Trim();
        s = SchemeRegex.Replace(s, "");

        var cutIdx = s.IndexOfAny(new[] { '/', '?', '#' });
        if (cutIdx >= 0) s = s[..cutIdx];

        var colonIdx = s.IndexOf(':');
        if (colonIdx >= 0) s = s[..colonIdx];

        s = s.Trim().TrimEnd('.').ToLowerInvariant();

        if (!HostnameRegex.IsMatch(s)) return (null, "Geçersiz URL");

        return (s, null);
    }
}
