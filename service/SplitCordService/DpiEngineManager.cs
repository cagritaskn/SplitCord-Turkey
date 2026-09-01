using Microsoft.Extensions.Hosting;
using SplitCord.Service.Config;
using SplitCord.Service.Engines;

namespace SplitCord.Service;

/// <summary>
/// Aktif DPI motorunun tekil orkestrasyonu. GoodbyeDPI ve Zapret aynı WinDivert sürücüsünü
/// kullandığı için aynı anda birden fazla motorun çalışmasına asla izin verilmez:
/// SwitchToAsync her zaman önce tüm diğer motorları durdurur, sonra hedefi başlatır.
/// </summary>
public sealed class DpiEngineManager : IHostedService
{
    private readonly IReadOnlyList<IDpiEngine> _engines;
    private readonly SettingsStore _settings;
    private readonly ILogger<DpiEngineManager> _logger;
    private readonly SemaphoreSlim _switchLock = new(1, 1);
    private string? _activeEngineId;
    // Bir motor/strateji taraması sürerken (ör. ByeDPI'nin 9, sonra otomatik geçilen
    // GoodbyeDPI'nin 36 adayı sırayla denenirken) durum sorgulayan istemcinin, o anki
    // adayın geçici olarak "running=false" görünmesini GERÇEK bir hata sanmaması için —
    // GetStatus() bunu ayrıca döndürüyor (bkz. Electron tarafında titlebar.js refreshConnection).
    private volatile bool _switching;
    // Zapret'in (Otomatik modun giriş noktası) tüm stratejileri tükenip otomatik geçiş
    // denendiğinde son ne olduğunu GetStatus() üzerinden istemciye bildirmek için: null
    // (normal), "antivirus" (Kaspersky/ESET gibi kendini koruyan bir güvenlik yazılımı
    // tespit edildiği için Zapret/GoodbyeDPI hiç denenmedi) veya "exhausted" (hepsi
    // denendi, hiçbiri çalışmadı). Her yeni SwitchToAsync("zapret") çağrısında sıfırlanır.
    private volatile string? _lastAutoScanResult;
    // Otomatik modda Zapret'in tüm adayları başarısız olup ByeDPI'ye eskalasyonla
    // geçildiğinde, ByeDPI'nin metin/HTTPS trafiğine hiç dokunmadan yalnızca sesi (UDP)
    // düzeltmeye çalışan bağımsız bir Zapret süreci (bkz. ZapretEngine.StartUdpCompanionAsync).
    private volatile bool _zapretUdpCompanionRunning;
    // Şu an sürmekte olan bir motor/strateji taramasını (Ayarlar > DPI Aşımı'ndaki
    // Otomatik'ten Manuel'e geçiş onayı sonrası) durdurabilmek için — SwitchToAsync her
    // çağrıldığında YENİDEN oluşturulur, tarama bitince (başarı/başarısızlık fark etmeksizin)
    // null'a döner. CancellationTokenSource.Cancel() thread-safe olduğu için ayrı bir
    // kilide gerek yok.
    private CancellationTokenSource? _scanCts;
    // Tarama sürerken (_switching=true) GERÇEKTE hangi motorun test edildiğini istemciye
    // bildirmek için — _activeEngineId tarama bitene kadar hâlâ ÖNCEKİ motoru gösteriyor,
    // bu yüzden Ayarlar ekranındaki motor listesi (settings.js renderEngineList) "Başlatılıyor"
    // rozetini bunun yerine bu alana bakarak doğru karta (yeni hedefe, eskisine değil) koyuyor.
    // ByeDPI tükenip otomatik GoodbyeDPI/Zapret'e geçildiğinde de güncellenir (bkz. aşağıdaki
    // escalationOrder döngüsü).
    private volatile string? _switchingToEngineId;

    public DpiEngineManager(IEnumerable<IDpiEngine> engines, SettingsStore settings, ILogger<DpiEngineManager> logger)
    {
        _engines = engines.ToList();
        _settings = settings;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Servis Windows başlangıcında SYSTEM olarak ayakta durur (elevation için), ama
        // motoru burada OTOMATİK BAŞLATMIYORUZ: motorun ömrü artık Electron client'ın
        // ömrüne bağlı — client açılınca /engines/{id}/activate ile başlatılması,
        // client gerçekten kapanınca /stop-all ile durdurulması bekleniyor.
        _activeEngineId = _settings.Current.ActiveEngineId;
        if (_engines.All(e => e.Id != _activeEngineId)) _activeEngineId = "zapret";

        _logger.LogInformation("DPI Service hazır (tercih edilen motor: {Id}), istemciden başlatma komutu bekleniyor", _activeEngineId);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        // Servisin kendisi durduruluyorsa (ör. makine kapanışı) güvenlik amacıyla
        // hâlâ çalışan bir motor varsa temizle.
        foreach (var engine in _engines)
            await engine.StopAsync(cancellationToken);
        await StopZapretUdpCompanionAsync();
    }

    /// <summary>Electron client gerçekten kapanırken çağırır: hangi motor aktifse durdurur,
    /// tercih edilen motor kimliğini (bir sonraki açılışta hangisinin başlatılacağını)
    /// değiştirmeden bırakır.</summary>
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

    /// <summary>ByeDPI + Zapret-UDP hibrit eşliğini (bkz. escalationOrder içindeki
    /// başlatma) durdurur — herhangi bir motor değişikliğinde/tam durdurmada çağrılmalı ki
    /// arkada unutulmuş bir winws.exe süreci kalmasın.</summary>
    private async Task StopZapretUdpCompanionAsync()
    {
        var zapret = _engines.OfType<ZapretEngine>().FirstOrDefault();
        if (zapret is null) return;
        await zapret.StopUdpCompanionAsync();
        _zapretUdpCompanionRunning = false;
    }

    /// <summary>ByeDPI zaten metin/HTTPS'i kendi SOCKS5 proxy'si üzerinden taşıyor ama sese
    /// (WebRTC/UDP) hiç dokunamıyor (bkz. ZapretEngine.StartUdpCompanionAsync'teki not) —
    /// bu yüzden ByeDPI'nin TCP'sine karışmayan, yalnızca UDP portlarını filtreleyen
    /// bağımsız bir Zapret süreci de ARKA PLANDA (best-effort, doğrulama YAPILMADAN)
    /// devreye sokuluyor. ByeDPI ister eskalasyonla (Otomatik mod) ister doğrudan (Manuel
    /// modda kullanıcının kartına tıklaması) devreye girsin fark etmiyor — ikisinde de
    /// çağrılır. Bu asla ana akışı BLOKLAMAMALI/BAŞARISIZ ETMEMELİ.</summary>
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
    /// AÇIKÇA bu motoru seçtiği için, tükenmesi durumunda BAŞKA bir motora OTOMATİK
    /// geçilmez — yalnızca Otomatik moddaki ByeDPI giriş noktası (dpi:set-mode('automatic'),
    /// "Otomatik Taramayı Tekrarla" butonu) escalation'a izin verir.</summary>
    public async Task SwitchToAsync(string engineId, bool allowEscalation = true)
    {
        // Zapret Otomatik modun giriş noktası (bkz. escalationOrder aşağıda: Zapret ->
        // ByeDPI -> GoodbyeDPI) — Kaspersky ya da ESET kuruluysa WinDivert tabanlı Zapret'i
        // hiç denemeden doğrudan ByeDPI'ye yönlendiriyoruz. Aksi hâlde Zapret'in tüm
        // adayları (muhtemelen hepsi bu yüzden başarısız) sırayla denenip zaman kaybettirir
        // — eski davranışta bu kontrol yalnızca ByeDPI'den GoodbyeDPI/Zapret'e eskalasyon
        // anında yapılıyordu, şimdi giriş noktasının kendisi için de gerekiyor.
        if (engineId == "zapret" && allowEscalation
            && SystemControlsHelper.GetStatus(
                    _engines.FirstOrDefault(e => e.Id == "goodbyedpi")?.GetOwnProcessId(),
                    _engines.FirstOrDefault(e => e.Id == "zapret")?.GetOwnProcessId(),
                    _engines.FirstOrDefault(e => e.Id == "byedpi")?.GetOwnProcessId())
                .AntivirusConflictDetected)
        {
            _logger.LogWarning("Kaspersky/ESET tespit edildi, Zapret denemesine hiç geçilmiyor, doğrudan ByeDPI'ye yönlendiriliyor");
            _lastAutoScanResult = "antivirus";
            await SwitchToAsync("byedpi", allowEscalation);
            return;
        }

        var target = _engines.FirstOrDefault(e => e.Id == engineId)
            ?? throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        // Şu an BAŞKA bir motorun taraması sürüyorsa (_switchLock tutuluyorsa) onu hemen
        // durduruyoruz — aksi hâlde bu çağrı, önceki tarama TAMAMEN bitene kadar (dakikalarca
        // sürebilir) _switchLock.WaitAsync()'de sessizce kuyrukta bekleyip kullanıcıya "hiçbir
        // şey olmuyor" izlenimi veriyordu. CancellationTokenSource.Cancel() thread-safe
        // olduğu için kilidi almadan önce çağırmak güvenli.
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

            // TÜM motorları durduruyoruz — HEDEF dahil. Hedefi hariç tutmak (yalnızca
            // "diğerlerini" durdurmak) ciddi bir hataya yol açıyordu: hedef motor zaten
            // çalışıyorsa (ör. Argüman Setini Yasakla / ReportEngineFailureAsync o an aktif
            // olan motoru yeniden tarıyor) target.StartAsync() SADECE "if (_process is
            // { HasExited: false }) return;" koruması yüzünden SESSİZCE HİÇBİR ŞEY
            // YAPMADAN dönüyordu — yasaklanan/bozuk argüman set'i hiç yeniden taranmadan
            // ÇALIŞMAYA DEVAM EDİYORDU (canlı testte doğrulandı).
            foreach (var engine in _engines)
                await engine.StopAsync(CancellationToken.None);
            // ByeDPI+Zapret-UDP hibrit eşliği (varsa) de her motor değişikliğinde temizleniyor
            // — yalnızca ByeDPI eskalasyonla aktifken anlamlı, aşağıda yeniden başlatılıyor.
            await StopZapretUdpCompanionAsync();

            try
            {
                await target.StartAsync(scanCts.Token);
            }
            catch (OperationCanceledException)
            {
                // Ayarlar > DPI Aşımı'ndan Otomatik'ten Manuel'e geçiş onayı üzerine
                // CancelCurrentScan() çağrıldı — o an test edilen adayın süreci hâlâ
                // çalışıyor olabilir, temizleyip sessizce dur (hata sayılmıyor).
                _logger.LogInformation("Tarama kullanıcı tarafından durduruldu ({Id})", engineId);
                await target.StopAsync(CancellationToken.None);
                return;
            }
            catch (AllCandidatesFailedException) when (engineId == "zapret" && allowEscalation)
            {
                // Zapret'in TÜM stratejileri tükendi — otomatik olarak ByeDPI'nin, o da
                // tükenirse GoodbyeDPI'nin kendi aday listesine geçiyoruz. AYNI kilit altında;
                // SwitchToAsync'i recursive ÇAĞIRMIYORUZ (_switchLock SemaphoreSlim(1,1),
                // yeniden giriş yapılamaz — deadlock olurdu), bu yüzden mantık satır içi.
                _logger.LogWarning("Zapret'in tüm stratejileri başarısız oldu, otomatik geçiş deneniyor...");

                var escalationOrder = new[] { "byedpi", "goodbyedpi" };
                var escalated = false;
                var cancelled = false;
                foreach (var nextEngineId in escalationOrder)
                {
                    var nextEngine = _engines.FirstOrDefault(e => e.Id == nextEngineId);
                    if (nextEngine is null) continue;

                    // GoodbyeDPI de WinDivert tabanlı — Kaspersky/ESET varsa ByeDPI zaten
                    // denendi (aşağıda), bu ikinci WinDivert denemesini de atlayıp doğrudan
                    // tükendi sayıyoruz.
                    if (nextEngineId == "goodbyedpi"
                        && SystemControlsHelper.GetStatus(
                                _engines.FirstOrDefault(e => e.Id == "goodbyedpi")?.GetOwnProcessId(),
                                _engines.FirstOrDefault(e => e.Id == "zapret")?.GetOwnProcessId(),
                                _engines.FirstOrDefault(e => e.Id == "byedpi")?.GetOwnProcessId())
                            .AntivirusConflictDetected)
                    {
                        // Kaspersky/ESET, WinDivert tabanlı GoodbyeDPI/Zapret ile çakışabildiği
                        // için (kendini koruyan bir antivirüs, zorla durdurulamıyor) hiç
                        // denenmiyor — kullanıcıya "İzinler ve Kontroller"e yönlendiren bir
                        // mesaj gösterilmesi Electron tarafının sorumluluğunda (bkz. titlebar.js).
                        _logger.LogWarning("Kaspersky/ESET tespit edildi, GoodbyeDPI denemesine geçilmiyor");
                        _lastAutoScanResult = "antivirus";
                        continue;
                    }

                    _switchingToEngineId = nextEngineId;
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
                        // Bu motor da tükendi, sıradakine geç.
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

                    // ByeDPI eskalasyonla devreye girdi — ses (WebRTC/UDP) desteği için Zapret
                    // UDP eşliğini de başlatıyoruz (bkz. StartZapretUdpCompanionAsync).
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

                // Kullanıcı hiç DPI korumasız kalmasın diye yeni motor başlayamazsa önceki
                // aktif motora geri dönmeyi deniyoruz — AMA yalnızca allowEscalation=true
                // ise (Otomatik mod). allowEscalation=false ise (Manuel moddan gelen bir
                // çağrı) bu da "başka bir motora otomatik geçiş" sayılır — kullanıcı AÇIKÇA
                // bu motoru seçti, sessizce önceki motora dönmesini istemiyoruz; hiçbir motor
                // çalışmadan bırakıp hatayı olduğu gibi bildiriyoruz.
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
                    // Geri dönülmedi (Manuel mod ya da önceki motor yok): _activeEngineId'yi
                    // eski (artık ÇALIŞMAYAN) motorda bırakmak yerine, kullanıcının AÇIKÇA
                    // seçtiği bu motora (denendi ama başarısız oldu) güncelliyoruz. Aksi hâlde
                    // istemci tarafı (did-fail-load, Ayarlar'daki "Başlatılıyor"/"Pasif"
                    // rozetleri) hâlâ ÇALIŞMAYAN eski bir motoru "aktif" sanıp ona göre yanlış
                    // kararlar (ör. yanlış motoru yeniden taramaya çalışmak) verebiliyordu.
                    _activeEngineId = engineId;
                    _settings.Current.ActiveEngineId = engineId;
                    _settings.Save();
                }

                throw;
            }

            _activeEngineId = engineId;
            _settings.Current.ActiveEngineId = engineId;
            _settings.Save();

            // ByeDPI DOĞRUDAN (eskalasyon olmadan) devreye girdi — bu, Manuel modda
            // kullanıcının ByeDPI kartına elle tıklaması dahil her durumu kapsıyor. Ses
            // desteği için Zapret UDP eşliğini burada da başlatıyoruz (bkz.
            // StartZapretUdpCompanionAsync) — eskalasyon yolundakiyle birebir aynı mantık.
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

    /// <summary>Ayarlar > DPI Aşımı'ndaki Otomatik/Manuel geçiş onayında, o an bir motor/
    /// strateji taraması sürüyorsa (ByeDPI/GoodbyeDPI/Zapret aday testleri) bu taramayı
    /// durdurmak için çağrılır. Sürmekte olan bir tarama yoksa (zaten null) no-op'tur.
    /// CancellationTokenSource.Cancel() thread-safe olduğu için ekstra bir kilide gerek yok.</summary>
    public void CancelCurrentScan()
    {
        _scanCts?.Cancel();
    }

    /// <summary>restart=false: yeni argümanlar kaydedilir ama o an çalışan süreç dokunulmadan
    /// bırakılır (Manuel moddaki "yeniden başlatma onayı" akışında kullanıcı "Hayır" derse) —
    /// değişiklik yalnızca motorun bir sonraki (elle veya uygulama yeniden başlatılarak
    /// tetiklenecek) başlangıcında etkili olur.</summary>
    public async Task UpdateArgsAsync(string engineId, string args, bool restart = true)
    {
        var target = _engines.FirstOrDefault(e => e.Id == engineId)
            ?? throw new ArgumentException($"Bilinmeyen motor: {engineId}");

        await _switchLock.WaitAsync();
        try
        {
            _settings.Current.EngineArgs[engineId] = args;
            // Kullanıcı Ayarlar'dan elle argüman girdi: bunu doğrulanmış kabul edip doğrudan
            // kullan, otomatik aday-tarama listesini tekrar devreye sokma (üç motor için de
            // aynı mantık — yalnızca byedpi için yapılıyordu, goodbyedpi/zapret manuel
            // düzenlemesi de artık aynı şekilde işaretleniyor).
            switch (engineId)
            {
                case "byedpi":
                    _settings.Current.ByeDpiVerified = true;
                    break;
                case "goodbyedpi":
                    _settings.Current.GoodbyeDpiVerified = true;
                    break;
                case "zapret":
                    _settings.Current.ZapretVerified = true;
                    break;
            }
            _settings.Save();

            if (restart)
            {
                // Kullanıcı Manuel modda bir motor seçip AÇIKÇA argüman kaydettiğinde, o
                // motor henüz aktif olmasa bile ARTIK aktif motor bu olmalı ve GİRİLEN
                // argümanlarla çalıştırılmalı. Önceden yalnızca motor zaten aktifse yeniden
                // başlatılıyordu — başka bir motor aktifken "Kaydet"e basmak sessizce
                // hiçbir şey yapmıyordu (ayar kaydediliyordu ama hiçbir zaman çalıştırılmıyordu).
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
    /// taramayı yeniden tetikler. allowEscalation, yalnızca ByeDPI'nin (yeniden taramadan sonra
    /// da) tükenmesi durumunda GoodbyeDPI/Zapret'e otomatik geçilip geçilemeyeceğini belirler
    /// (bkz. SwitchToAsync) — Manuel moddan gelen çağrılarda false olmalı.</summary>
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

    /// <summary>Electron client, GERÇEK Discord webview'inde bir motorun (ByeDPI/GoodbyeDPI/
    /// Zapret) hâlihazırda "doğrulanmış" sayılan ayarının artık kalıcı olarak çalışmadığını
    /// (birkaç otomatik yeniden deneme sonrası hâlâ başarısızsa) tespit ettiğinde çağırır.
    /// ByeDPI için mevcut reddet+yeniden tara akışına (RejectCurrentByeDpiArgsAsync) yönlendirir;
    /// GoodbyeDPI/Zapret'in ByeDPI'deki gibi kalıcı bir "reddedilenler" listesi yok — sadece
    /// doğrulamayı sıfırlayıp (o an aktiflerse) yeniden aday taramasını tetikliyoruz.</summary>
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
                case "goodbyedpi":
                    _settings.Current.GoodbyeDpiVerified = false;
                    break;
                case "zapret":
                    _settings.Current.ZapretVerified = false;
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

    /// <summary>Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" için: tüm motorları durdurur ve
    /// servis ayarlarını (aktif motor, doğrulanmış ByeDPI stratejisi, DoH sağlayıcıları, motor
    /// argümanları, reddedilen argüman listesi) fabrika varsayılanlarına döndürür. Motoru
    /// tekrar BAŞLATMIYOR — Electron client, kendi yerel ayarlarını da sıfırlayıp yeniden
    /// başladığında normal açılış akışı (startConfiguredEngine) motoru zaten aktive edecek.</summary>
    public async Task ResetSettingsAsync()
    {
        await _switchLock.WaitAsync();
        try
        {
            foreach (var engine in _engines)
                await engine.StopAsync(CancellationToken.None);
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
        "goodbyedpi" => _settings.Current.GoodbyeDpiRejectedArgs,
        "zapret" => _settings.Current.ZapretRejectedArgs,
        _ => throw new ArgumentException($"Bilinmeyen motor: {engineId}"),
    };

    public IReadOnlyList<string> GetRejectedArgs(string engineId) => GetRejectedArgsList(engineId);

    public void UnrejectArgs(string engineId, string args)
    {
        GetRejectedArgsList(engineId).Remove(args);
        _settings.Save();
    }

    /// <summary>Otomatik moddaki "Argüman Setini Yasakla" butonunun GENEL karşılığı: ByeDPI
    /// için mevcut RejectCurrentByeDpiArgsAsync akışına yönlendirir (kendi ByeDpiEngine'e özel
    /// ReportRealWorldFailureAsync mantığını kullanıyor); GoodbyeDPI/Zapret için o motorun şu
    /// anki argümanını KENDİ reddedilenler listesine ekler, doğrulamayı sıfırlar ve (o an
    /// aktifse) yeniden aday taramasını tetikler.</summary>
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
                case "goodbyedpi":
                    _settings.Current.GoodbyeDpiVerified = false;
                    break;
                case "zapret":
                    _settings.Current.ZapretVerified = false;
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
                "goodbyedpi" => _settings.Current.GoodbyeDpiVerified,
                "zapret" => _settings.Current.ZapretVerified,
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
            // ByeDPI, Zapret'e eskalasyonla ulaşıldığında sesi (UDP) de düzeltmeye çalışan
            // bağımsız Zapret sürecinin o an çalışıp çalışmadığı (bkz. escalationOrder içindeki
            // StartUdpCompanionAsync çağrısı) — Electron tarafı bunu ayrı bir bilgi notu olarak
            // gösterebilir.
            zapretUdpCompanionRunning = _zapretUdpCompanionRunning,
            engines,
        };
    }

    public IReadOnlyList<string> GetLogs(string engineId) =>
        _engines.FirstOrDefault(e => e.Id == engineId)?.GetRecentLogs() ?? Array.Empty<string>();
}
