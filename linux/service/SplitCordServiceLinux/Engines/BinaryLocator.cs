namespace SplitCord.ServiceLinux.Engines;

/// <summary>Windows karşılığının portu. scripts/fetch-binaries.js/build-byedpi.sh tarafından
/// resources/bin/&lt;tool&gt;/ altına indirilen/derlenen ve build sırasında csproj Content
/// Include ile bin/&lt;tool&gt;/ olarak kopyalanan DPI aracı çalıştırılabilirlerini bulur.
///
/// Windows'tan FARK: dosya adları uzantısız (ör. "dnsproxy", "nfqws" — .exe yok). Ayrıca
/// Linux'ta arşivden çıkan/kopyalanan bir dosyanın çalıştırılabilir (execute) biti
/// VARSAYILAN OLARAK KAPALI olabilir (Windows'ta bu kavram yok, .exe uzantısı yeterliydi) —
/// bu yüzden Resolve() her bulduğu dosyaya defensif olarak chmod +x uyguluyor.
///
/// DOĞRULANMADI: gerçek bir Linux'ta hiç çalıştırılmadı (bkz. ../../PORTING_PLAN.md §2 madde 5).</summary>
public static class BinaryLocator
{
    public static string ToolDir(string toolFolder) =>
        Path.Combine(AppContext.BaseDirectory, "bin", toolFolder);

    public static string Resolve(string toolFolder, string relativeExePath)
    {
        var path = Path.Combine(ToolDir(toolFolder), relativeExePath);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"{relativeExePath} bulunamadı: {path}. linux/scripts/fetch-binaries.js (ya da build-byedpi.sh) çalıştırıldı mı ve servis yeniden build edildi mi?",
                path);
        }

        EnsureExecutable(path);
        return path;
    }

    /// <summary>chmod +x karşılığı — .NET 7+'ta File.SetUnixFileMode ile, P/Invoke ya da harici
    /// bir "chmod" süreci başlatmadan. Zaten çalıştırılabilirse (fetch/build script'i doğru
    /// izinle bıraktıysa) no-op'a yakın, ucuz bir işlem.</summary>
    private static void EnsureExecutable(string path)
    {
        try
        {
            var mode = File.GetUnixFileMode(path);
            const UnixFileMode executeBits = UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;
            if ((mode & executeBits) != executeBits)
            {
                File.SetUnixFileMode(path, mode | executeBits);
            }
        }
        catch
        {
            // Dosya sistemi Unix izinlerini desteklemiyorsa (beklenmez ama) ya da izin hatası
            // varsa sessizce geç -- Process.Start zaten kendi hata mesajını verecek.
        }
    }
}
