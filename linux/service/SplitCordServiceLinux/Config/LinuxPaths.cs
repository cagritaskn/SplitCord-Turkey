namespace SplitCord.ServiceLinux.Config;

/// <summary>Windows tarafı SYSTEM oturumunda çalıştığı için `%ProgramData%\SplitCord`'a (ortak
/// makine dizini) yazıyordu (bkz. service/SplitCordService/DiagnosticLog.cs ve SettingsStore.cs
/// yorumları). .NET'in `Environment.SpecialFolder.CommonApplicationData`'sı Linux'ta genelde
/// `/usr/share`'a eşleniyor ve normal bir servis kullanıcısı tarafından yazılabilir DEĞİL — bu
/// yüzden burada FHS'ye uygun sabit bir yol kullanılıyor (bkz. ../../PORTING_PLAN.md D-3).
///
/// DOĞRULANMADI: `/var/lib/splitcord` yolu ve `SPLITCORD_DATA_DIR` env-var override'ı henüz
/// gerçek bir systemd biriminde/WSL2'de test edilmedi. D-3, Faz 6'da (systemd paketleme)
/// kesinleştirilecek — o zamana kadar bu dosya tek değişim noktası olsun diye SettingsStore ve
/// DiagnosticLogWriter ikisi de buradan okuyor.</summary>
public static class LinuxPaths
{
    private const string DefaultDataDir = "/var/lib/splitcord";

    /// <summary>SPLITCORD_DATA_DIR ayarlıysa (ör. WSL2'de root olmadan `dotnet run` ile geliştirme
    /// yaparken `~/.local/share/splitcord` gibi kullanıcı-yazılabilir bir yola yönlendirmek için)
    /// onu, yoksa `/var/lib/splitcord`'u kullanır.</summary>
    public static string DataDirectory
    {
        get
        {
            var overridePath = Environment.GetEnvironmentVariable("SPLITCORD_DATA_DIR");
            var dir = string.IsNullOrWhiteSpace(overridePath) ? DefaultDataDir : overridePath;
            Directory.CreateDirectory(dir);
            return dir;
        }
    }
}
