using System.Diagnostics;

namespace SplitCord.Service;

public sealed record DetectedProcess(int Pid, string Name);
public sealed record ConflictingServiceInfo(string ServiceName, string DisplayName);

public sealed record SystemControlsStatus(
    bool KasperskyDetected,
    bool EsetDetected,
    List<ConflictingServiceInfo> ConflictingServicesInstalled,
    List<DetectedProcess> ExternalGoodbyeDpiProcesses,
    List<DetectedProcess> ExternalZapretProcesses,
    List<DetectedProcess> ExtraCiadpiProcesses,
    List<DetectedProcess> ExternalZapret2Processes)
{
    // Zapret/GoodbyeDPI'nin dayandığı WinDivert sürücüsüyle çakışabilen, kendini koruyan
    // (zorla durdurulamayan) güvenlik yazılımları — DpiEngineManager bunlardan biri
    // varken bu iki motoru hiç denemeden atlıyor (bkz. SwitchToAsync).
    public bool AntivirusConflictDetected => KasperskyDetected || EsetDetected;
}

/// <summary>
/// "İzinler ve Kontroller" ekranındaki tespit/kontrol mantığı. Buradaki her şey DPI aşımını
/// bozabilecek, programımızın dışında çalışan şeyleri (başka bir güvenlik yazılımı, elle
/// kurulmuş GoodbyeDPI/Zapret servisleri, unutulmuş/fazladan ciadpi.exe kopyaları) tespit
/// edip mümkün olanları (Kaspersky hariç — bir antivirüsü başka bir programın zorla
/// durdurması hem güvenli hem de genelde mümkün değil, kendini korur) durdurma imkanı sunar.
/// </summary>
public static class SystemControlsHelper
{
    // DPI aşımıyla çakışabilecek, kullanıcının kendi başına (SplitCord dışında) kurmuş
    // olabileceği Windows Service'ler. Zapret/GoodbyeDPI kendi resmi kurulum betikleriyle
    // (service.bat / service_install_*.cmd) böyle bir servis olarak kurulabiliyor; WireSock
    // ve ProxiFyre de aynı WinDivert sürücüsünü paylaşan, birbirinden bağımsız üçüncü parti
    // araçlar — hepsi aynı anda yalnızca bir tüketiciye bağlanabilen sürücüyü kilitleyip
    // bizim GoodbyeDPI/Zapret motorlarımızın başlamasını engelleyebiliyor.
    private static readonly (string ServiceName, string DisplayName)[] KnownConflictingServices =
    {
        ("zapret", "Zapret"),
        ("wiresock-client-service", "WireSock"),
        ("ProxiFyreService", "ProxiFyre"),
        ("GoodbyeDPI", "GoodbyeDPI"),
    };

    public static SystemControlsStatus GetStatus(int? ownGoodbyeDpiPid, int? ownZapretPid, int? ownByeDpiPid, int? ownZapretCompanionPid = null, int? ownZapret2Pid = null)
    {
        var kaspersky = Process.GetProcessesByName("avp").Length > 0
            || Process.GetProcessesByName("avpui").Length > 0;

        var eset = Process.GetProcessesByName("egui").Length > 0
            || Process.GetProcessesByName("ekrn").Length > 0;

        var externalGoodbyeDpi = Process.GetProcessesByName("goodbyedpi")
            .Where(p => p.Id != ownGoodbyeDpiPid)
            .Select(p => new DetectedProcess(p.Id, p.ProcessName))
            .ToList();

        var externalZapret = Process.GetProcessesByName("winws")
            .Where(p => p.Id != ownZapretPid && p.Id != ownZapretCompanionPid)
            .Select(p => new DetectedProcess(p.Id, p.ProcessName))
            .ToList();

        var extraCiadpi = Process.GetProcessesByName("ciadpi")
            .Where(p => p.Id != ownByeDpiPid)
            .Select(p => new DetectedProcess(p.Id, p.ProcessName))
            .ToList();

        var externalZapret2 = Process.GetProcessesByName("winws2")
            .Where(p => p.Id != ownZapret2Pid)
            .Select(p => new DetectedProcess(p.Id, p.ProcessName))
            .ToList();

        var conflictingServices = KnownConflictingServices
            .Where(s => IsServiceInstalled(s.ServiceName))
            .Select(s => new ConflictingServiceInfo(s.ServiceName, s.DisplayName))
            .ToList();

        return new SystemControlsStatus(
            kaspersky,
            eset,
            conflictingServices,
            externalGoodbyeDpi,
            externalZapret,
            extraCiadpi,
            externalZapret2);
    }

    public static void KillProcess(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Süreç zaten kapanmış olabilir — sessizce yok say, çağıran taraf zaten
            // durumu yeniden sorgulayıp güncel listeyi gösterecek.
        }
    }

    /// <summary>Bilinen çakışan servislerden birini durdurup kaldırır. Güvenlik için yalnızca
    /// <see cref="KnownConflictingServices"/> listesindeki isimler kabul edilir — istemciden
    /// gelen keyfi bir servis adıyla sc.exe çalıştırılmıyor.</summary>
    public static void RemoveConflictingService(string serviceName)
    {
        var known = KnownConflictingServices.FirstOrDefault(s => string.Equals(s.ServiceName, serviceName, StringComparison.OrdinalIgnoreCase));
        if (known.ServiceName is null) return;

        RunAndForget("sc.exe", new[] { "stop", known.ServiceName });
        // "stop" asenkron döner — servis gerçekten durmadan "delete" çağrılırsa servis
        // yalnızca "silinmek üzere işaretlenir" ve tüm handle'lar (ör. sürücü) kapanana/
        // yeniden başlatılana kadar tam silinmeyebilir. Kısa bir pay bırakıyoruz.
        Thread.Sleep(1500);
        RunAndForget("sc.exe", new[] { "delete", known.ServiceName });
    }

    private static bool IsServiceInstalled(string serviceName)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "sc.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("query");
            psi.ArgumentList.Add(serviceName);
            using var process = Process.Start(psi);
            if (process is null) return false;
            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit(3000);
            // sc query, servis GERÇEKTEN kayıtlıysa (durumu ne olursa olsun — STOPPED dahil)
            // 0 döner; servis hiç yoksa 1060 (ERROR_SERVICE_DOES_NOT_EXIST) döner.
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static void RunAndForget(string fileName, IEnumerable<string> arguments)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var arg in arguments) psi.ArgumentList.Add(arg);
            Process.Start(psi);
        }
        catch
        {
            // yoksay
        }
    }
}
