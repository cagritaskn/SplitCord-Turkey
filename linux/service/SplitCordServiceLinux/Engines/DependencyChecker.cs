using System.Diagnostics;

namespace SplitCord.ServiceLinux.Engines;

public sealed record DependencyCheckItem(string Id, string Label, bool Ok, string? Detail, string? FixHint);

public sealed record DependencyCheckResult(DistroInfo Distro, IReadOnlyList<DependencyCheckItem> Items);

/// <summary>PORT_PLAN_2.md AP-5/Faz 3 — İzinler ve Kontroller panelindeki (yalnızca AppImage
/// istemcisinde gösterilen, bkz. settings.js) "AppImage Bağımlılıkları" bölümünün servis tarafı.
///
/// Bu sınıf paketleme türünden (deb/AppImage) TAMAMEN BAĞIMSIZ (bkz. PORT_PLAN_2.md §1 madde 4) —
/// servis hangi istemciyle başlatıldığını hiç bilmiyor/bilmemeli, yalnızca "bu makinede motorların
/// gerçekten çalışabilmesi için gereken şeyler var mı" sorusuna cevap veriyor. `.deb` kurulumunda
/// bu kontrollerin hepsi zaten `apt`'ın kendi bağımlılık çözümü sayesinde OK dönmesi beklenir;
/// AppImage'da ise PORT_PLAN_2.md Faz 2'nin (patchelf ile kütüphane/iptables-nft gömme) CANLI
/// DOĞRULANMAMIŞ olması ihtimaline karşı bir teşhis katmanı.
///
/// DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): bu sınıf hiç gerçek
/// bir Linux'ta çalıştırılmadı. "error while loading shared libraries" dize eşleşmesi glibc'nin
/// dinamik bağlayıcısının (ld.so) STDERR'e yazdığı GERÇEK, kararlı bir mesaj biçimi (glibc
/// sürümleri arasında değişmez) ama canlı doğrulanana kadar teorik kabul edilmeli.</summary>
public static class DependencyChecker
{
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(3);

    public static async Task<DependencyCheckResult> CheckAsync()
    {
        var distro = DistroDetector.Detect();
        var items = new List<DependencyCheckItem>
        {
            await CheckFirewallToolAsync("iptables", "iptables / iptables-nft", "--version",
                "Zapret/Zapret2 motorları NFQUEUE kuralı ekleyemez, paket yakalayamaz.", distro),
            await CheckFirewallToolAsync("ip6tables", "ip6tables / ip6tables-nft", "--version",
                "Zapret2'nin blockcheck2 taraması IPv6 kontrolünde başarısız olabilir.", distro),
            await CheckFirewallToolAsync("nft", "nft (nftables)", "--version",
                "Zapret2'nin blockcheck2 taraması kendi NFQUEUE kuralını kuramaz, strateji bulamayabilir.", distro),
            await CheckBinaryAsync("byedpi", "ciadpi", "ByeDPI (ciadpi)"),
            await CheckBinaryAsync("zapret/nfq", "nfqws", "Zapret (nfqws)"),
            await CheckBinaryAsync("zapret2/nfq2", "nfqws2", "Zapret2 (nfqws2)"),
        };
        return new DependencyCheckResult(distro, items);
    }

    /// <summary>iptables/ip6tables/nft -- ÜÇÜ DE hem bizim kendi kodumuz (RunIptablesAsync) hem
    /// blockcheck2.sh'nin KENDİSİ (bkz. EmbeddedTools.cs'in notu) tarafından bare komut adıyla
    /// çağrılıyor -- bu yüzden EmbeddedTools'un AYNI PATH önceliklendirmesini kullanıyoruz, ki
    /// "OK" burada gerçekten "motor çalışırken de bulunacak" anlamına gelsin (yalnızca sistem
    /// PATH'ine bakıp gömülü kopyayı hiç hesaba katmayan yanıltıcı bir kontrol olmasın). Bunlar
    /// GERÇEK sistem paketleri olduğu için (DistroPackageHints.cs'teki tabloda VAR) eksikse
    /// dağıtıma özel bir kurulum komutu önerilebiliyor -- bkz. FixHint.</summary>
    private static async Task<DependencyCheckItem> CheckFirewallToolAsync(string command, string label, string probeArg, string missingConsequence, DistroInfo distro)
    {
        var (ok, detail) = await TryRunAsync(command, EmbeddedTools.PathWithEmbeddedToolsFirst(), probeArg);
        if (ok) return new DependencyCheckItem(command, label, true, null, null);

        var fixHint = DistroPackageHints.SuggestInstallCommand(command, distro);
        return new DependencyCheckItem(command, label, false, detail ?? $"{command} bulunamadı veya çalıştırılamadı. {missingConsequence}", fixHint);
    }

    /// <summary>ciadpi/nfqws/nfqws2 -- BİLEREK `FixHint` YOK (bkz. DistroPackageHints.cs'in üst
    /// notu): bunlar sistem paketi DEĞİL, AppImage'ın KENDİ gömülü binary'leri -- eksik/bozuklarsa
    /// kullanıcının paket yöneticisiyle çözebileceği bir şey değil, bir PAKETLEME sorunu. İstemci
    /// tarafı (bkz. settings.js/titlebar.js) bu durumda "bir hata bildir" akışını öne çıkarıyor.</summary>
    private static async Task<DependencyCheckItem> CheckBinaryAsync(string toolFolder, string exeName, string label)
    {
        string path;
        try
        {
            path = BinaryLocator.Resolve(toolFolder, exeName);
        }
        catch (Exception ex)
        {
            return new DependencyCheckItem(exeName, label, false, ex.Message, null);
        }

        // Motorların kendi argümanlarıyla (uzun sürebilen/kural ekleyen) çağırmak yerine zararsız,
        // hızlı bir bayrakla (--help) yalnızca "dinamik bağlayıcı bu binary'yi açabiliyor mu"
        // sorusuna cevap arıyoruz -- gerçek motor davranışını hiç etkilemiyor.
        var (ok, detail) = await TryRunAsync(path, pathOverride: null, "--help");
        return new DependencyCheckItem(exeName, label, ok, ok ? null : detail, null);
    }

    private static async Task<(bool ok, string? detail)> TryRunAsync(string fileName, string? pathOverride, params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        // pathOverride verilmişse (bkz. CheckFirewallToolAsync -- bare komut adıyla çağrılan
        // iptables/ip6tables/nft için) PATH'i buna göre ayarlıyoruz; BinaryLocator'dan gelen
        // MUTLAK yollar (ciadpi/nfqws/nfqws2) için PATH'in hiç önemi yok, null geçiliyor.
        if (pathOverride is not null) psi.Environment["PATH"] = pathOverride;
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        try
        {
            using var process = Process.Start(psi);
            if (process is null) return (false, "Süreç başlatılamadı.");

            var stderrTask = process.StandardError.ReadToEndAsync();
            try
            {
                await process.WaitForExitAsync().WaitAsync(ProbeTimeout);
            }
            catch (TimeoutException)
            {
                // --help/--version birkaç saniyede dönmeliydi -- takılıp kaldıysa (beklenmez) süreci
                // öldürüp "çalışıyor" sayıyoruz (dinamik bağlayıcı sorunu değil, farklı bir sorun).
                try { process.Kill(entireProcessTree: true); } catch { /* zararsız */ }
                return (true, null);
            }

            var stderr = await stderrTask;
            // "--help" bazı araçlarda (ör. nfqws) bilinmeyen bir bayrak olarak algılanıp hata
            // koduyla çıkabilir -- bunu OK sayıyoruz, ÖNEMLİ olan dinamik bağlayıcının binary'yi
            // AÇABİLMİŞ olması (yani exit code her ne olursa olsun süreç gerçekten BAŞLADIYSA
            // eksik .so sorunu YOK demektir). Yalnızca ld.so'nun kendi karakteristik hata mesajını
            // (glibc'nin sabit biçimi) arıyoruz.
            if (stderr.Contains("error while loading shared libraries", StringComparison.Ordinal))
            {
                var missingLib = stderr.Split('\n').FirstOrDefault(l => l.Contains("error while loading shared libraries", StringComparison.Ordinal))?.Trim();
                return (false, missingLib ?? "Eksik bir paylaşımlı kütüphane (.so) yüzünden çalıştırılamadı.");
            }
            return (true, null);
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            // ENOENT (dosya/komut hiç yok, PATH'te değil) ya da EACCES (chmod +x/noexec mount) —
            // ikisi de burada aynı şekilde raporlanıyor, tam ayrım kullanıcı için önemli değil.
            return (false, $"Çalıştırılamadı: {ex.Message}");
        }
        catch (Exception ex)
        {
            return (false, $"Çalıştırılamadı: {ex.Message}");
        }
    }
}
