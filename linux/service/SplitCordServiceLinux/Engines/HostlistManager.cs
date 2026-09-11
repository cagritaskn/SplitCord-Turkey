using System.Text.RegularExpressions;
using SplitCord.ServiceLinux.Config;

namespace SplitCord.ServiceLinux.Engines;

/// <summary>
/// Windows istemcisinde bulundu, buraya da aynen uygulanıyor -- bkz.
/// service/SplitCordService/Engines/HostlistManager.cs (aynı davranış, tek fark: yazılabilir
/// dosya konumu %ProgramData%\SplitCord yerine LinuxPaths.DataDirectory).
///
/// KULLANICI TALEBİ: Ayarlar > DPI Aşımı > Dışlamalar. Zapret VE Zapret2'nin ORTAK olarak
/// kullandığı, kullanıcı tarafından düzenlenebilen hostlist-exclude dosyasını yönetir. Tek,
/// paylaşılan, YAZILABİLİR bir dosya -- iki motor da nfqws/nfqws2'yi bu dosyanın MUTLAK
/// yoluyla başlatıyor (bkz. ZapretEngine/Zapret2Engine SpawnAsync), bu yüzden her motorun
/// kendi farklı çalışma dizini hiç sorun olmuyor. Hem zapret hem zapret2'nin resmi
/// dokümantasyonu, hostlist dosyalarının değişiklik zamanı/boyutu değiştiğinde OTOMATİK
/// yeniden yüklendiğini doğruluyor.
/// </summary>
public sealed class HostlistManager : IHostedService, IDisposable
{
    public const string RepoRawUrl = "https://raw.githubusercontent.com/cagritaskn/SplitCord-Turkey/main/resources/zapret-lists/splitcord-exclude.txt";

    public const int MinUpdateIntervalHours = 1;
    public const int MaxUpdateIntervalHours = 24;

    public static string FilePath => Path.Combine(LinuxPaths.DataDirectory, "zapret-hostlist-exclude.txt");

    private static readonly Regex SchemeRegex = new(@"^[a-zA-Z][a-zA-Z0-9+.-]*://", RegexOptions.Compiled);
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

    public void SetContentManual(string content)
    {
        lock (_fileLock)
        {
            var lines = ParseLines(content);
            File.WriteAllText(FilePath, string.Join('\n', lines) + (lines.Count > 0 ? "\n" : ""));
        }
    }

    public IReadOnlyList<string> GetUserAddedDomains() => _settings.Current.HostlistUserAddedDomains;

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
