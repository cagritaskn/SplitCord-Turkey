namespace SplitCord.Service.Engines;

/// <summary>
/// ByeDPI/GoodbyeDPI/Zapret gibi bir DPI aşım motorunun DpiEngineManager tarafından
/// tekdüze şekilde başlatılıp durdurulabilmesi için uyması gereken sözleşme.
/// </summary>
public interface IDpiEngine
{
    string Id { get; }
    string DisplayName { get; }

    /// <summary>true ise motor WinDivert ile sistem genelini etkiler (GoodbyeDPI, Zapret).
    /// false ise yalnızca kendi süreç trafiğini kapsayan yerel bir proxy'dir (ByeDPI).</summary>
    bool RequiresSystemWideAccess { get; }

    Task StartAsync(CancellationToken ct);
    Task StopAsync(CancellationToken ct);
    EngineStatus GetStatus();
    IReadOnlyList<string> GetRecentLogs();

    /// <summary>İzinler ve Kontroller ekranındaki "başka bir kaynaktan başlatılmış aynı isimli
    /// süreç" tespitinin, bizim kendi yönettiğimiz süreci yanlışlıkla "harici/fazladan" olarak
    /// göstermemesi için — null ise şu an bu motora ait çalışan bir süreç yok.</summary>
    int? GetOwnProcessId();
}
