using SplitCord.Service.Config;
using SplitCord.Service.Engines;

namespace SplitCord.Service.LocalApi;

public sealed record ActivateEngineResponseError(string error);
public sealed record SetArgsPayload(string? Args, bool Restart = true);
public sealed record SetDohProvidersPayload(List<string>? Providers);
public sealed record UnrejectArgsPayload(string Args);
public sealed record SetByeDpiExtendedCandidatesPayload(bool Enabled);
public sealed record KillProcessPayload(int Pid);
public sealed record RemoveServicePayload(string ServiceName);
public sealed record GrantAppFirewallPayload(string ExePath);

/// <summary>127.0.0.1 üzerinde dinlenen, Electron client'ın DPI motorlarını sorgulayıp
/// değiştirmesini sağlayan minimal REST API.</summary>
public static class LocalApiEndpoints
{
    public static void MapDpiEndpoints(this WebApplication app)
    {
        app.MapGet("/status", (DpiEngineManager mgr) => Results.Ok(mgr.GetStatus()));

        app.MapPost("/engines/{id}/activate", async (string id, DpiEngineManager mgr, bool allowEscalation = true) =>
        {
            try
            {
                await mgr.SwitchToAsync(id, allowEscalation);
                return Results.Ok(mgr.GetStatus());
            }
            catch (Exception ex)
            {
                // ArgumentException (bilinmeyen motor) dışında, ör. goodbyedpi.exe/winws.exe
                // yeterli yetkiyle çalışmıyorsa Win32Exception de buradan yakalanır; her iki
                // durumda da istemciye ham 500 yerine anlaşılır bir hata mesajı döner.
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPost("/engines/{id}/args", async (string id, SetArgsPayload payload, DpiEngineManager mgr) =>
        {
            try
            {
                await mgr.UpdateArgsAsync(id, payload.Args ?? "", payload.Restart);
                return Results.Ok(mgr.GetStatus());
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Otomatik moddaki "Argüman Setini Yasakla" / yasaklı liste yönetimi — üç motor için de
        // ortak (ByeDPI/GoodbyeDPI/Zapret, her biri kendi reddedilenler listesini tutuyor).
        app.MapGet("/engines/{id}/rejected-args", (string id, DpiEngineManager mgr) =>
        {
            try
            {
                return Results.Ok(mgr.GetRejectedArgs(id));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPost("/engines/{id}/reject-current", async (string id, DpiEngineManager mgr, bool allowEscalation = true) =>
        {
            try
            {
                await mgr.RejectCurrentArgsAsync(id, allowEscalation);
                return Results.Ok(mgr.GetStatus());
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPost("/engines/{id}/unreject", (string id, UnrejectArgsPayload payload, DpiEngineManager mgr) =>
        {
            try
            {
                mgr.UnrejectArgs(id, payload.Args);
                return Results.Ok(mgr.GetRejectedArgs(id));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapGet("/engines/{id}/logs", (string id, DpiEngineManager mgr) => Results.Ok(mgr.GetLogs(id)));

        // Electron client, "doğrulanmış" bir ByeDPI stratejisiyle bile gerçek discord.com/app
        // sayfası webview'de yüklenemediğinde (did-fail-load, ana çerçeve) çağırır. Bu argümanı
        // kalıcı olarak reddeder ve motoru durdurur; istemcinin ardından tekrar activate
        // çağırması, listede kalan bir sonraki adaya geçilmesini sağlar.
        app.MapPost("/engines/byedpi/report-failure", async (ByeDpiEngine engine, DpiEngineManager mgr) =>
        {
            await engine.ReportRealWorldFailureAsync();
            return Results.Ok(mgr.GetStatus());
        });

        // GoodbyeDPI/Zapret için genel karşılığı: webview'de o motorun "doğrulanmış" ayarı
        // birkaç yeniden deneme sonrası hâlâ kalıcı olarak çalışmıyorsa çağrılır — o motorun
        // doğrulamasını sıfırlar ve (o an aktifse) yeniden aday taramasını tetikler. ByeDPI
        // için de çalışır (mevcut reddet+yeniden tara akışına yönlendirir).
        app.MapPost("/engines/{id}/report-engine-failure", async (string id, DpiEngineManager mgr, bool allowEscalation = true) =>
        {
            try
            {
                await mgr.ReportEngineFailureAsync(id, allowEscalation);
                return Results.Ok(mgr.GetStatus());
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Electron client gerçekten kapanırken (tray "Çıkış" değil, asıl app.quit() öncesi) çağırır.
        app.MapPost("/stop-all", async (DpiEngineManager mgr) =>
        {
            await mgr.StopAllAsync();
            return Results.Ok(mgr.GetStatus());
        });

        // ByeDPI'nin yerel DoH yönlendiricisinin (bkz. DohForwarder.cs) hangi DNS-over-HTTPS
        // sunucularını sırayla deneyeceği. Değişiklik anında etkili olur, servis yeniden
        // başlatmaya gerek yoktur (DohForwarder her sorguda güncel listeyi okur).
        app.MapGet("/doh-providers", (SettingsStore settings) => Results.Ok(settings.Current.DohProviders));

        app.MapPost("/doh-providers", (SetDohProvidersPayload payload, SettingsStore settings) =>
        {
            var providers = (payload.Providers ?? new List<string>())
                .Select(p => p.Trim())
                .Where(p => p.Length > 0)
                .ToList();

            var invalid = providers.FirstOrDefault(p => !p.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
            if (invalid is not null)
            {
                return Results.BadRequest(new { error = $"Geçersiz DoH adresi (https:// ile başlamalı): {invalid}" });
            }

            settings.Current.DohProviders = providers;
            settings.Save();
            return Results.Ok(settings.Current.DohProviders);
        });

        // ByeDPI "uzun argüman listesi" anahtarı — kapalıyken (varsayılan) yalnızca 9
        // kişilik kısa listeyi, açıkken bunun ardından ~1000 ek stratejiyi de tarar (bkz.
        // ByeDpiEngine.GetCandidateStrategies). Burada yalnızca kaydediyoruz; sürmekte olan
        // bir taramayı iptal edip yeniden başlatma kararı (onay dahil) istemci tarafında
        // yönetiliyor (bkz. settings.js).
        app.MapGet("/byedpi/use-extended-candidates", (SettingsStore settings) =>
            Results.Ok(new { enabled = settings.Current.ByeDpiUseExtendedCandidates }));

        app.MapPost("/byedpi/use-extended-candidates", (SetByeDpiExtendedCandidatesPayload payload, SettingsStore settings) =>
        {
            settings.Current.ByeDpiUseExtendedCandidates = payload.Enabled;
            settings.Save();
            return Results.Ok(new { enabled = settings.Current.ByeDpiUseExtendedCandidates });
        });

        // ciadpi.exe, yerel SOCKS5 portunu dinlemeye başladığında Windows bazı sistemlerde
        // Güvenlik Duvarı izni istiyor; kullanıcı "İzin Ver"e tıklamazsa bağlantı
        // etkilenebiliyor. Servis SYSTEM'de çalıştığı için izin kuralını popup'ı
        // beklemeden doğrudan biz ekleyebiliyoruz (bkz. FirewallHelper).
        app.MapGet("/firewall/byedpi/status", async () =>
        {
            var exePath = BinaryLocator.Resolve("byedpi", "ciadpi.exe");
            var granted = await FirewallHelper.IsCiadpiAllowedAsync(exePath);
            return Results.Ok(new { granted });
        });

        // "İzinler ve Kontroller" — DPI aşımını bozabilecek, programımız dışında çalışan
        // şeylerin (Kaspersky, elle kurulmuş GoodbyeDPI/Zapret servisleri, fazladan
        // ciadpi.exe kopyaları) tespiti ve (mümkün olanların) durdurulması.
        app.MapGet("/system-controls/status", (ByeDpiEngine byeDpi, GoodbyeDpiEngine goodbyeDpi, ZapretEngine zapret) =>
            Results.Ok(SystemControlsHelper.GetStatus(goodbyeDpi.GetOwnProcessId(), zapret.GetOwnProcessId(), byeDpi.GetOwnProcessId(), zapret.GetUdpCompanionProcessId())));

        app.MapPost("/system-controls/kill-process", (KillProcessPayload payload) =>
        {
            SystemControlsHelper.KillProcess(payload.Pid);
            return Results.Ok();
        });

        app.MapPost("/system-controls/remove-service", (RemoveServicePayload payload) =>
        {
            SystemControlsHelper.RemoveConflictingService(payload.ServiceName);
            return Results.Ok();
        });

        app.MapPost("/firewall/byedpi/grant", async () =>
        {
            var exePath = BinaryLocator.Resolve("byedpi", "ciadpi.exe");
            await FirewallHelper.GrantCiadpiAccessAsync(exePath);
            var granted = await FirewallHelper.IsCiadpiAllowedAsync(exePath);
            return Results.Ok(new { granted });
        });

        // SplitCord-Turkey.exe (Electron client) için aynı kontrol — client kendi exe
        // yolunu bildiği için (app.getPath('exe')) burada payload olarak gönderiyor.
        app.MapGet("/firewall/app/status", async (string exePath) =>
        {
            var granted = await FirewallHelper.IsAppAllowedAsync(exePath);
            return Results.Ok(new { granted });
        });

        app.MapPost("/firewall/app/grant", async (GrantAppFirewallPayload payload) =>
        {
            await FirewallHelper.GrantAppAccessAsync(payload.ExePath);
            var granted = await FirewallHelper.IsAppAllowedAsync(payload.ExePath);
            return Results.Ok(new { granted });
        });

        // Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" — servis tarafındaki tüm DPI
        // ayarlarını (aktif motor, doğrulanmış ByeDPI stratejisi, DoH sağlayıcıları, motor
        // argümanları, reddedilen argümanlar) fabrika varsayılanlarına döndürür. Electron
        // client bunu, kendi yerel ayarlarını ve Discord oturumunu sıfırlamadan önce/sonra
        // çağırıp ardından uygulamayı yeniden başlatır.
        app.MapPost("/settings/reset", async (DpiEngineManager mgr) =>
        {
            await mgr.ResetSettingsAsync();
            return Results.Ok(mgr.GetStatus());
        });

        // Ayarlar > DPI Aşımı'ndaki Otomatik'ten Manuel'e geçiş onayında — o an sürmekte
        // olan bir motor/strateji taraması (ByeDPI/GoodbyeDPI/Zapret aday testleri) varsa
        // durdurmak için. Sürmekte olan bir tarama yoksa no-op'tur.
        app.MapPost("/scan/cancel", (DpiEngineManager mgr) =>
        {
            mgr.CancelCurrentScan();
            return Results.Ok();
        });
    }
}
