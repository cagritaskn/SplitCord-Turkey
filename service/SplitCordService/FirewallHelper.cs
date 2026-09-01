using System.Diagnostics;

namespace SplitCord.Service;

/// <summary>
/// ciadpi.exe için Windows Güvenlik Duvarı izin kuralını kontrol eder/oluşturur.
/// Servis SYSTEM oturumunda çalıştığı için (bkz. install-service.ps1) PowerShell'in
/// NetSecurity modülü üzerinden kural eklemek herhangi bir UAC istemi TETİKLEMİYOR —
/// bu yüzden Windows'un kendi "İzin Ver" popup'ını yeniden tetiklemeye çalışmak yerine
/// (bunun için genel bir API yok) kuralı doğrudan biz oluşturuyoruz.
///
/// Rastgele/önceden var olan sistem kurallarını ayrıştırmak yerine kendi sabit isimli
/// kuralımızın var olup olmadığına bakıyoruz — bu, netsh'in yerelleştirilmiş (Türkçe/
/// İngilizce farklı) metin çıktısını ayrıştırmaktan çok daha güvenilir.
/// </summary>
public static class FirewallHelper
{
    private const string CiadpiRuleDisplayName = "SplitCord-Turkey ByeDPI";

    // SplitCord-Turkey.exe (Electron client) sesli kanallar için WebRTC/UDP dinlemesi
    // yaptığında Windows bazı sistemlerde "ortak ve özel ağlar" izni istiyor; kullanıcı
    // bu popup'ta "İptal Et"e tıklarsa ses bağlantısı etkilenebiliyor. ciadpi.exe kuralıyla
    // aynı mantık: servis SYSTEM'de çalıştığı için kuralı popup'ı beklemeden biz ekleyebiliyoruz.
    private const string AppRuleDisplayName = "SplitCord-Turkey Client";

    public static Task<bool> IsCiadpiAllowedAsync(string exePath) => IsRuleAllowedAsync(CiadpiRuleDisplayName);

    public static Task GrantCiadpiAccessAsync(string exePath) => GrantAccessAsync(CiadpiRuleDisplayName, exePath);

    public static Task<bool> IsAppAllowedAsync(string exePath) => IsRuleAllowedAsync(AppRuleDisplayName);

    public static Task GrantAppAccessAsync(string exePath) => GrantAccessAsync(AppRuleDisplayName, exePath);

    private static async Task<bool> IsRuleAllowedAsync(string ruleDisplayName)
    {
        var script = $"if (Get-NetFirewallRule -DisplayName '{ruleDisplayName}' -ErrorAction SilentlyContinue) " +
                     "{ Write-Output 'EXISTS' } else { Write-Output 'MISSING' }";
        var output = await RunPowerShellAsync(script);
        return output.Contains("EXISTS", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task GrantAccessAsync(string ruleDisplayName, string exePath)
    {
        // Tek tırnaklı PowerShell string içinde tek tırnak kaçışı '' şeklindedir.
        var escapedPath = exePath.Replace("'", "''");
        var script =
            $"if (-not (Get-NetFirewallRule -DisplayName '{ruleDisplayName}' -ErrorAction SilentlyContinue)) {{ " +
            $"New-NetFirewallRule -DisplayName '{ruleDisplayName}' -Direction Inbound -Action Allow " +
            $"-Program '{escapedPath}' -Profile Any -Enabled True | Out-Null }}";
        await RunPowerShellAsync(script);
    }

    private static async Task<string> RunPowerShellAsync(string script)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add(script);

        using var process = new Process { StartInfo = psi };
        process.Start();
        var stdout = await process.StandardOutput.ReadToEndAsync();
        await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return stdout;
    }
}
