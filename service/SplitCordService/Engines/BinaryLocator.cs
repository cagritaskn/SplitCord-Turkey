namespace SplitCord.Service.Engines;

/// <summary>
/// scripts/fetch-binaries.js tarafından resources/bin/&lt;tool&gt;/ altına indirilen ve
/// build sırasında csproj Content Include ile bin/&lt;tool&gt;/ olarak kopyalanan
/// DPI aracı çalıştırılabilirlerini bulur.
/// </summary>
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
                $"{relativeExePath} bulunamadı: {path}. Repo kökünde 'npm run fetch-binaries' çalıştırıldı mı ve servis yeniden build edildi mi?",
                path);
        }
        return path;
    }
}
