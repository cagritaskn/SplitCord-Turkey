using SplitCord.ServiceLinux.Config;
using SplitCord.ServiceLinux.Dns;
using SplitCord.ServiceLinux.Engines;

namespace SplitCord.ServiceLinux.LocalApi;

using SplitCord.ServiceLinux;

public sealed record ActivateEngineResponseError(string error);
public sealed record SetArgsPayload(string? Args, bool Restart = true);
public sealed record DnsProviderPayload(string Protocol, string Address);
public sealed record SetDnsProvidersPayload(List<DnsProviderPayload>? Providers);
public sealed record SetManualDnsProtocolPayload(string? Protocol);
public sealed record SetZapret2TierTimeoutPayload(int? AutomaticMinutes, int? ManualMinutes);
public sealed record DiagnosticLogPayload(string? Tag, string? Level, string? Message);
public sealed record UnrejectArgsPayload(string Args);
public sealed record SetByeDpiExtendedCandidatesPayload(bool Enabled);

/// <summary>Windows karşılığının (service/SplitCordService/LocalApi/LocalApiEndpoints.cs) portu.
/// Windows'tan FARK (bkz. PORTING_PLAN.md D-2, D-9): `/firewall/*` (PowerShell NetSecurity
/// tabanlıydı, FirewallHelper — Linux'ta loopback trafiği normalde hiç filtrelenmiyor, bu
/// kavram gerekmiyor) ve `/system-controls/*` (SystemControlsHelper — Kaspersky/ESET'in
/// WinDivert'i kilitlemesi sorununun Linux karşılığı yok, GoodbyeDPI de zaten yok) uç noktaları
/// TAMAMEN DÜŞÜRÜLDÜ. Bunları çağıran Electron istemci kodu Faz 7'de bu iki uç nokta grubunu
/// hiç çağırmayacak şekilde uyarlanacak (bkz. PORTING_PLAN.md Faz 7 dosya listesi).
/// 127.0.0.1 üzerinde dinlenir, Windows tarafıyla AYNI request/response şekli — istemci tarafı
/// (serviceClient.js) hiçbir değişiklik yapmadan bu uç noktaları da kullanabiliyor.</summary>
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
        // ortak (ByeDPI/Zapret/Zapret2, her biri kendi reddedilenler listesini tutuyor).
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

        app.MapPost("/engines/byedpi/report-failure", async (ByeDpiEngine engine, DpiEngineManager mgr) =>
        {
            await engine.ReportRealWorldFailureAsync();
            return Results.Ok(mgr.GetStatus());
        });

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

        app.MapPost("/stop-all", async (DpiEngineManager mgr) =>
        {
            await mgr.StopAllAsync();
            return Results.Ok(mgr.GetStatus());
        });

        app.MapGet("/dns-providers", (SettingsStore settings) =>
            Results.Ok(settings.Current.DnsProviders
                .Where(p => p.Protocol != DnsProtocol.NextDns)
                .Select(p => new DnsProviderPayload(p.Protocol.ToString().ToLowerInvariant(), p.Address))));

        app.MapPost("/dns-providers", (SetDnsProvidersPayload payload, SettingsStore settings) =>
        {
            var providers = new List<DnsProvider>();
            foreach (var item in payload.Providers ?? new List<DnsProviderPayload>())
            {
                var address = item.Address?.Trim() ?? "";
                if (address.Length == 0) continue;

                if (!Enum.TryParse<DnsProtocol>(item.Protocol, ignoreCase: true, out var protocol))
                {
                    return Results.BadRequest(new { error = $"Bilinmeyen DNS protokolü: {item.Protocol}" });
                }

                string? validationError = protocol switch
                {
                    DnsProtocol.Doh when !address.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                        => $"Geçersiz DoH adresi (https:// ile başlamalı): {address}",
                    DnsProtocol.DnsCrypt when !address.StartsWith("sdns://", StringComparison.OrdinalIgnoreCase)
                        => $"Geçersiz DNSCrypt adresi (sdns:// ile başlamalı): {address}",
                    DnsProtocol.NextDns => "Bu protokol elle eklenemez.",
                    _ => null,
                };
                if (validationError is not null)
                {
                    return Results.BadRequest(new { error = validationError });
                }

                providers.Add(new DnsProvider { Protocol = protocol, Address = address });
            }

            providers.AddRange(settings.Current.DnsProviders.Where(p => p.Protocol == DnsProtocol.NextDns));

            settings.Current.DnsProviders = providers;
            settings.Save();
            return Results.Ok(settings.Current.DnsProviders
                .Where(p => p.Protocol != DnsProtocol.NextDns)
                .Select(p => new DnsProviderPayload(p.Protocol.ToString().ToLowerInvariant(), p.Address)));
        });

        app.MapGet("/manual-dns-protocol", (SettingsStore settings) =>
            Results.Ok(new { protocol = settings.Current.ManualDnsProtocol?.ToString().ToLowerInvariant() }));

        app.MapPost("/manual-dns-protocol", (SetManualDnsProtocolPayload payload, SettingsStore settings) =>
        {
            if (string.IsNullOrWhiteSpace(payload.Protocol))
            {
                settings.Current.ManualDnsProtocol = null;
            }
            else if (Enum.TryParse<DnsProtocol>(payload.Protocol, ignoreCase: true, out var protocol))
            {
                settings.Current.ManualDnsProtocol = protocol;
            }
            else
            {
                return Results.BadRequest(new { error = $"Bilinmeyen DNS protokolü: {payload.Protocol}" });
            }

            settings.Save();
            return Results.Ok(new { protocol = settings.Current.ManualDnsProtocol?.ToString().ToLowerInvariant() });
        });

        const int MinTierTimeoutMinutes = 5;
        const int MaxTierTimeoutMinutes = 60;
        app.MapGet("/zapret2/tier-timeout", (SettingsStore settings) => Results.Ok(new
        {
            automaticMinutes = settings.Current.Zapret2AutomaticTierTimeoutMinutes,
            manualMinutes = settings.Current.Zapret2ManualTierTimeoutMinutes,
        }));

        app.MapPost("/zapret2/tier-timeout", (SetZapret2TierTimeoutPayload payload, SettingsStore settings) =>
        {
            if (payload.AutomaticMinutes is { } automatic)
            {
                if (automatic < MinTierTimeoutMinutes || automatic > MaxTierTimeoutMinutes)
                {
                    return Results.BadRequest(new { error = $"Otomatik mod süresi {MinTierTimeoutMinutes}-{MaxTierTimeoutMinutes} dakika arasında olmalı" });
                }
                settings.Current.Zapret2AutomaticTierTimeoutMinutes = automatic;
            }

            if (payload.ManualMinutes is { } manual)
            {
                if (manual < MinTierTimeoutMinutes || manual > MaxTierTimeoutMinutes)
                {
                    return Results.BadRequest(new { error = $"Manuel mod süresi {MinTierTimeoutMinutes}-{MaxTierTimeoutMinutes} dakika arasında olmalı" });
                }
                settings.Current.Zapret2ManualTierTimeoutMinutes = manual;
            }

            settings.Save();
            return Results.Ok(new
            {
                automaticMinutes = settings.Current.Zapret2AutomaticTierTimeoutMinutes,
                manualMinutes = settings.Current.Zapret2ManualTierTimeoutMinutes,
            });
        });

        app.MapPost("/diagnostic-log", (DiagnosticLogPayload payload, DiagnosticLogWriter diagnosticLog) =>
        {
            diagnosticLog.Append("client", payload.Level ?? "Information", payload.Tag ?? "renderer", payload.Message ?? "");
            return Results.Ok();
        });

        app.MapGet("/diagnostic-log/location", (DiagnosticLogWriter diagnosticLog) =>
            Results.Ok(new { directory = diagnosticLog.DirectoryPath }));

        app.MapGet("/byedpi/use-extended-candidates", (SettingsStore settings) =>
            Results.Ok(new { enabled = settings.Current.ByeDpiUseExtendedCandidates }));

        app.MapPost("/byedpi/use-extended-candidates", (SetByeDpiExtendedCandidatesPayload payload, SettingsStore settings) =>
        {
            settings.Current.ByeDpiUseExtendedCandidates = payload.Enabled;
            settings.Save();
            return Results.Ok(new { enabled = settings.Current.ByeDpiUseExtendedCandidates });
        });

        app.MapPost("/settings/reset", async (DpiEngineManager mgr) =>
        {
            await mgr.ResetSettingsAsync();
            return Results.Ok(mgr.GetStatus());
        });

        app.MapPost("/scan/cancel", (DpiEngineManager mgr) =>
        {
            mgr.CancelCurrentScan();
            return Results.Ok();
        });
    }
}
