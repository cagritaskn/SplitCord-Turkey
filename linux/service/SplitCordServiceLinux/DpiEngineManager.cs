using Microsoft.Extensions.Hosting;
using SplitCord.ServiceLinux.Config;
using SplitCord.ServiceLinux.Dns;
using SplitCord.ServiceLinux.Engines;

namespace SplitCord.ServiceLinux;

/// <summary>Windows karşılığının (service/SplitCordService/DpiEngineManager.cs) portu. İki
/// yapısal fark (bkz. PORTING_PLAN.md D-2, D-9):
/// (1) GoodbyeDPI Linux'ta yok — EscalationChain ve tüm motor-id switch'leri 3 motora
///     (zapret, zapret2, byedpi) indirildi.
/// (2) `AntivirusDetected()`/`IsWinDivertBased()` (Kaspersky/ESET'in WinDivert sürücüsünü
///     kilitlemesi sorunu) TAMAMEN DÜŞÜRÜLDÜ — Linux'ta motorlar NFQUEUE üzerinden çalışıyor,
///     WinDivert'in "aynı anda yalnızca TEK bir işleyici" kısıtlaması yok, ve Kaspersky/ESET'in
///     Linux ajanlarının bu şekilde bir çakışmaya yol açtığına dair bir bulgu/varsayım da yok.
///     Escalation artık yalnızca AllCandidatesFailedException'a bakıyor.</summary>
public sealed class DpiEngineManager : IHostedService
{
    private readonly IReadOnlyList<IDpiEngine> _engines;
    private readonly SettingsStore _settings;
    private readonly ILogger<DpiEngineManager> _logger;
    private readonly SemaphoreSlim _switchLock = new(1, 1);
    private string? _activeEngineId;
    private volatile bool _switching;
    private volatile string? _lastAutoScanResult;
    private volatile bool _zapretUdpCompanionRunning;
    private CancellationTokenSource? _scanCts;
    private volatile string? _switchingToEngineId;

    // Otomatik modun tam eskalasyon zinciri: Zapret giriş noktası, sonra Zapret2, son çare
    // ByeDPI (bkz. PORTING_PLAN.md D-2 — GoodbyeDPI yok, Windows'taki 4'lü zincir 3'e indi).
    private static readonly string[] EscalationChain = { "zapret", "zapret2", "byedpi" };

    public DpiEngineManager(IEnumerable<IDpiEngine> engines, SettingsStore settings, ILogger<DpiEngineManager> logger)
    {
        _engines = engines.ToList();
        _settings = settings;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Servis systemd altında ayakta durur, ama motoru burada OTOMATİK BAŞLATMIYORUZ:
        // motorun ömrü Electron client'ın ömrüne bağlı — client açılınca /engines/{id}/activate
        // ile başlatılması, client gerçekten kapanınca /stop-all ile durdurulması bekleniyor.
        _activeEngineId = _settings.Current.ActiveEngineId;
        if (_engines.All(e => e.Id != _activeEngineId)) _activeEngineId = "zapret";

        _logger.LogInformation("DPI Service hazır (tercih edilen motor: {Id}), istemciden başlatma komutu bekleniyor", _activeEngineId);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var engine in _engines)
            await engine.StopAsync(cancellationToken);
        await StopZapretUdpCompanionAsync();
    }

    /// <summary>Electron client gerçekten kapanırken çağırır: hangi motor aktifse durdurur,
    /// tercih edilen motor kimliğini değiştirmeden bırakır.</summary>
    public async Task StopAllAsync()
    {
        await _switchLock.WaitAsync();
        try
        {
            foreach (var engine in _engines)
                await engine.StopAsync(CancellationToken.None);
            await StopZapretUdpCompanionAsync();
        }
        finally
        {
            _switchLock.Release();
        }
    }

    private async Task StopZapretUdpCompanionAsync()
    {
        var zapret = _engines.OfType<ZapretEngine>().FirstOrDefault();
        if (zapret is null) return;
        await zapret.StopUdpCompanionAsync();
        _zapretUdpCompanionRunning = false;
    }

    /// <summary>ByeDPI zaten metin/HTTPS'i kendi SOCKS5 proxy'si üzerinden taşıyor ama sese
    /// (WebRTC/UDP) hiç dokunamıyor — bu yüzden ByeDPI'nin TCP'sine karışmayan, yalnızca UDP
    /// portlarını filtreleyen bağımsız bir Zapret süreci de ARKA PLANDA devreye sokuluyor.</summary>
    private async Task StartZapretUdpCompanionAsync()
    {
        var zapret = _engines.OfType<ZapretEngine>().FirstOrDefault();
        if (zapret is null) return;
        try
        {
            await zapret.StartUdpCompanionAsync(CancellationToken.None);
            _zapretUdpCompanionRunning = zapret.IsUdpCompanionRunning;
        }
        catch (Exception companionEx)
        {
            _logger.LogWarning(companionEx, "Zapret UDP eşlik süreci başlatılamadı, ByeDPI yine de aktif kalıyor");
        }
    }

    /// <summary>allowEscalation=false (Manuel moddan gelen çağrılarda kullanılır): kullanıcı
    /// AÇIKÇA bu motoru seçtiği için, tükenmesi durumunda BAŞKA bir motora OTOMATİK geçilmez.</summary>
    public async Task SwitchToAsync(string engineId, bool allowEscalation = true)
    {
        var target = _engines.FirstOrDefault(e => e.Id == engineId)
            ?? throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        _scanCts?.Cancel();

        await _switchLock.WaitAsync();
        _switching = true;
        _switchingToEngineId = engineId;
        if (engineId == "zapret") _lastAutoScanResult = null;

        var scanCts = new CancellationTokenSource();
        _scanCts = scanCts;
        try
        {
            var previousEngineId = _activeEngineId;

            foreach (var engine in _engines)
                await engine.StopAsync(CancellationToken.None);
            await StopZapretUdpCompanionAsync();

            if (target is IDnsTierAware tierAwareTarget) tierAwareTarget.IsManualActivation = !allowEscalation;

            try
            {
                await target.StartAsync(scanCts.Token);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Tarama kullanıcı tarafından durduruldu ({Id})", engineId);
                await target.StopAsync(CancellationToken.None);
                return;
            }
            catch (AllCandidatesFailedException) when (allowEscalation && EscalationChain.Contains(engineId))
            {
                _logger.LogWarning("{Id} tükendi, otomatik geçiş deneniyor...", engineId);

                var escalationOrder = EscalationChain.SkipWhile(id => id != engineId).Skip(1);
                var escalated = false;
                var cancelled = false;
                foreach (var nextEngineId in escalationOrder)
                {
                    var nextEngine = _engines.FirstOrDefault(e => e.Id == nextEngineId);
                    if (nextEngine is null) continue;

                    _switchingToEngineId = nextEngineId;
                    if (nextEngine is IDnsTierAware nextTierAware) nextTierAware.IsManualActivation = false;
                    try
                    {
                        await nextEngine.StartAsync(scanCts.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        _logger.LogInformation("Tarama kullanıcı tarafından durduruldu ({Id})", nextEngineId);
                        await nextEngine.StopAsync(CancellationToken.None);
                        cancelled = true;
                        break;
                    }
                    catch (AllCandidatesFailedException)
                    {
                        continue;
                    }
                    catch (Exception nextEx)
                    {
                        _logger.LogError(nextEx, "{Id} otomatik geçiş denemesinde başlatılamadı", nextEngineId);
                        continue;
                    }

                    _activeEngineId = nextEngineId;
                    _settings.Current.ActiveEngineId = nextEngineId;
                    _settings.Save();
                    escalated = true;

                    if (nextEngineId == "byedpi")
                    {
                        await StartZapretUdpCompanionAsync();
                    }
                    break;
                }

                if (cancelled) return;
                if (escalated) return;

                _logger.LogError("Otomatik taramada denenen hiçbir motor/strateji Discord'a erişemedi");
                _lastAutoScanResult = "exhausted";
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "{Id} başlatılamadı", engineId);

                if (allowEscalation && previousEngineId is not null && previousEngineId != engineId)
                {
                    var previous = _engines.FirstOrDefault(e => e.Id == previousEngineId);
                    if (previous is not null)
                    {
                        try
                        {
                            await previous.StartAsync(CancellationToken.None);
                        }
                        catch (Exception fallbackEx)
                        {
                            _logger.LogError(fallbackEx, "Önceki motora ({Id}) geri dönülemedi", previousEngineId);
                        }
                    }
                }
                else
                {
                    _activeEngineId = engineId;
                    _settings.Current.ActiveEngineId = engineId;
                    _settings.Save();
                }

                throw;
            }

            _activeEngineId = engineId;
            _settings.Current.ActiveEngineId = engineId;
            _settings.Save();

            if (engineId == "byedpi")
            {
                await StartZapretUdpCompanionAsync();
            }
        }
        finally
        {
            _switching = false;
            _switchingToEngineId = null;
            _scanCts = null;
            scanCts.Dispose();
            _switchLock.Release();
        }
    }

    public void CancelCurrentScan()
    {
        _scanCts?.Cancel();
    }

    public async Task UpdateArgsAsync(string engineId, string args, bool restart = true)
    {
        var target = _engines.FirstOrDefault(e => e.Id == engineId)
            ?? throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        await _switchLock.WaitAsync();
        try
        {
            _settings.Current.EngineArgs[engineId] = args;
            switch (engineId)
            {
                case "byedpi":
                    _settings.Current.ByeDpiVerified = true;
                    break;
                case "zapret":
                    _settings.Current.ZapretVerified = true;
                    break;
                case "zapret2":
                    _settings.Current.Zapret2Verified = true;
                    break;
            }
            _settings.Save();

            if (restart)
            {
                foreach (var engine in _engines.Where(e => e.Id != engineId))
                    await engine.StopAsync(CancellationToken.None);

                await target.StopAsync(CancellationToken.None);
                await target.StartAsync(CancellationToken.None);

                _activeEngineId = engineId;
                _settings.Current.ActiveEngineId = engineId;
                _settings.Save();
            }
        }
        finally
        {
            _switchLock.Release();
        }
    }

    /// <summary>Otomatik moddaki "Argüman Setini Yasakla" butonu için: şu anda kayıtlı/kullanılan
    /// ByeDPI argüman setini kalıcı olarak reddedilenler listesine ekler, doğrulamayı sıfırlar
    /// ve (o an aktifse) motoru yeniden başlatarak reddedilenler dışındaki bir sonraki adaydan
    /// taramayı yeniden tetikler.</summary>
    public async Task RejectCurrentByeDpiArgsAsync(bool allowEscalation = true)
    {
        var byeDpi = _engines.OfType<ByeDpiEngine>().FirstOrDefault()
            ?? throw new InvalidOperationException("ByeDPI motoru bulunamadı");

        await _switchLock.WaitAsync();
        try
        {
            await byeDpi.ReportRealWorldFailureAsync();
        }
        finally
        {
            _switchLock.Release();
        }

        if (_activeEngineId == "byedpi")
        {
            await SwitchToAsync("byedpi", allowEscalation);
        }
    }

    public async Task ReportEngineFailureAsync(string engineId, bool allowEscalation)
    {
        if (!_engines.Any(e => e.Id == engineId))
            throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        if (engineId == "byedpi")
        {
            await RejectCurrentByeDpiArgsAsync(allowEscalation);
            return;
        }

        await _switchLock.WaitAsync();
        try
        {
            switch (engineId)
            {
                case "zapret":
                    _settings.Current.ZapretVerified = false;
                    break;
                case "zapret2":
                    _settings.Current.Zapret2Verified = false;
                    _settings.Current.Zapret2VoiceVerified = false;
                    break;
            }
            _settings.Save();
        }
        finally
        {
            _switchLock.Release();
        }

        if (_activeEngineId == engineId)
        {
            await SwitchToAsync(engineId, allowEscalation);
        }
    }

    /// <summary>Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" için.</summary>
    public async Task ResetSettingsAsync()
    {
        await _switchLock.WaitAsync();
        try
        {
            foreach (var engine in _engines)
            {
                await engine.StopAsync(CancellationToken.None);
                engine.ClearLogs();
            }
            await StopZapretUdpCompanionAsync();

            _settings.Reset();
            _activeEngineId = _settings.Current.ActiveEngineId;
        }
        finally
        {
            _switchLock.Release();
        }
    }

    private List<string> GetRejectedArgsList(string engineId) => engineId switch
    {
        "byedpi" => _settings.Current.ByeDpiRejectedArgs,
        "zapret" => _settings.Current.ZapretRejectedArgs,
        "zapret2" => _settings.Current.Zapret2RejectedArgs,
        _ => throw new ArgumentException($"Bilinmeyen motor: {engineId}"),
    };

    public IReadOnlyList<string> GetRejectedArgs(string engineId) => GetRejectedArgsList(engineId);

    public void UnrejectArgs(string engineId, string args)
    {
        GetRejectedArgsList(engineId).Remove(args);
        _settings.Save();
    }

    public async Task RejectCurrentArgsAsync(string engineId, bool allowEscalation = true)
    {
        if (engineId == "byedpi")
        {
            await RejectCurrentByeDpiArgsAsync(allowEscalation);
            return;
        }

        if (!_engines.Any(e => e.Id == engineId))
            throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        await _switchLock.WaitAsync();
        try
        {
            var currentArgs = _settings.Current.EngineArgs.GetValueOrDefault(engineId, "");
            var rejectedList = GetRejectedArgsList(engineId);
            if (!string.IsNullOrEmpty(currentArgs) && !rejectedList.Contains(currentArgs))
            {
                rejectedList.Add(currentArgs);
            }
            switch (engineId)
            {
                case "zapret":
                    _settings.Current.ZapretVerified = false;
                    break;
                case "zapret2":
                    _settings.Current.Zapret2Verified = false;
                    _settings.Current.Zapret2VoiceVerified = false;
                    break;
            }
            _settings.Save();
        }
        finally
        {
            _switchLock.Release();
        }

        if (_activeEngineId == engineId)
        {
            await SwitchToAsync(engineId, allowEscalation);
        }
    }

    public object GetStatus()
    {
        var engines = _engines.Select(e =>
        {
            var s = e.GetStatus();
            var verified = e.Id switch
            {
                "byedpi" => _settings.Current.ByeDpiVerified,
                "zapret" => _settings.Current.ZapretVerified,
                "zapret2" => _settings.Current.Zapret2Verified,
                _ => false,
            };
            return new
            {
                s.Id,
                s.DisplayName,
                s.Running,
                s.RequiresSystemWideAccess,
                s.ProxyAddress,
                s.Detail,
                Args = _settings.Current.EngineArgs.GetValueOrDefault(e.Id, ""),
                Verified = verified,
            };
        });

        return new
        {
            activeEngineId = _activeEngineId,
            switching = _switching,
            switchingToEngineId = _switchingToEngineId,
            autoScanResult = _lastAutoScanResult,
            zapretUdpCompanionRunning = _zapretUdpCompanionRunning,
            engines,
        };
    }

    public IReadOnlyList<string> GetLogs(string engineId) =>
        _engines.FirstOrDefault(e => e.Id == engineId)?.GetRecentLogs() ?? Array.Empty<string>();
}
