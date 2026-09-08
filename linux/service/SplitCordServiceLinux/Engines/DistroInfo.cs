namespace SplitCord.ServiceLinux.Engines;

public enum DistroFamily
{
    Unknown,
    Arch,
    FedoraRhel,
    Debian,
    OpenSuse,
}

public sealed record DistroInfo(string? Id, string? PrettyName, DistroFamily Family);

/// <summary>PORT_PLAN_2.md AP-16 (2026-09-09, kullanıcı talebi — "AppImage'e özel olarak dağıtıma
/// özel bir sebeple hata alınırsa görselleştirilsin") — `/etc/os-release`'i okuyup dağıtım
/// ailesini tespit eder, `DependencyChecker`'ın her eksik bağımlılık için kullanıcıya GERÇEKTEN
/// çalıştırılabilir, dağıtıma özel bir kurulum komutu önerebilmesini sağlar (önceki gecenin
/// statik/üç-paket-yöneticisini-birden-listeleyen metnini değiştiriyor).
///
/// DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): `/etc/os-release`
/// formatı standart (systemd/os-release spesifikasyonu) ama gerçek bir Linux'ta hiç test
/// edilmedi.</summary>
public static class DistroDetector
{
    private const string OsReleasePath = "/etc/os-release";

    public static DistroInfo Detect()
    {
        string? id = null;
        string? idLike = null;
        string? prettyName = null;

        try
        {
            foreach (var line in File.ReadLines(OsReleasePath))
            {
                var eq = line.IndexOf('=');
                if (eq < 0) continue;
                var key = line[..eq];
                var value = line[(eq + 1)..].Trim().Trim('"');
                switch (key)
                {
                    case "ID": id = value; break;
                    case "ID_LIKE": idLike = value; break;
                    case "PRETTY_NAME": prettyName = value; break;
                }
            }
        }
        catch
        {
            // /etc/os-release okunamazsa (beklenmez ama) -- Unknown aile, öneri gösterilmez.
        }

        var haystack = $"{id} {idLike}".ToLowerInvariant();
        var family = DistroFamily.Unknown;
        if (haystack.Contains("arch")) family = DistroFamily.Arch;
        else if (haystack.Contains("fedora") || haystack.Contains("rhel") || haystack.Contains("centos"))
            family = DistroFamily.FedoraRhel;
        else if (haystack.Contains("debian") || haystack.Contains("ubuntu")) family = DistroFamily.Debian;
        else if (haystack.Contains("suse")) family = DistroFamily.OpenSuse;

        return new DistroInfo(id, prettyName ?? id, family);
    }
}

/// <summary>Her bilinen eksik bağımlılık (bkz. DependencyChecker.CheckAsync'in ürettiği id'ler) için
/// dağıtım ailesine göre GERÇEK bir paket adı + kurulum komutu önerir. `ciadpi`/`nfqws`/`nfqws2`
/// BİLEREK bu tabloda YOK -- bunlar sistem paketi DEĞİL, AppImage'ın KENDİ gömülü binary'leri;
/// eksik/bozuklarsa bu bir paketleme sorunu (kullanıcının paket yöneticisiyle çözebileceği bir şey
/// değil), bu yüzden öneri yerine "bir hata bildir" mesajı gösterilmeli (bkz. DependencyChecker).</summary>
public static class DistroPackageHints
{
    private static readonly Dictionary<string, Dictionary<DistroFamily, string>> PackageNames = new()
    {
        ["iptables"] = new()
        {
            [DistroFamily.Arch] = "iptables-nft",
            [DistroFamily.FedoraRhel] = "iptables-nft",
            [DistroFamily.Debian] = "iptables",
            [DistroFamily.OpenSuse] = "iptables",
        },
        ["ip6tables"] = new()
        {
            // Aynı paket iptables VE ip6tables'ı BİRLİKTE sağlıyor (xtables-nft-multi) -- ayrı bir
            // paket adı yok, kullanıcıyı yukarıdaki "iptables" önerisine yönlendiriyoruz.
            [DistroFamily.Arch] = "iptables-nft",
            [DistroFamily.FedoraRhel] = "iptables-nft",
            [DistroFamily.Debian] = "iptables",
            [DistroFamily.OpenSuse] = "iptables",
        },
        ["nft"] = new()
        {
            [DistroFamily.Arch] = "nftables",
            [DistroFamily.FedoraRhel] = "nftables",
            [DistroFamily.Debian] = "nftables",
            [DistroFamily.OpenSuse] = "nftables",
        },
    };

    private static readonly Dictionary<DistroFamily, string> InstallCommandTemplate = new()
    {
        [DistroFamily.Arch] = "sudo pacman -S {0}",
        [DistroFamily.FedoraRhel] = "sudo dnf install {0}",
        [DistroFamily.Debian] = "sudo apt install {0}",
        [DistroFamily.OpenSuse] = "sudo zypper install {0}",
    };

    /// <returns>Örn. "sudo pacman -S iptables-nft" -- dağıtım tanınmadıysa ya da bu bağımlılık
    /// bir sistem paketi değilse (ciadpi/nfqws/nfqws2) null döner.</returns>
    public static string? SuggestInstallCommand(string dependencyId, DistroInfo distro)
    {
        if (distro.Family == DistroFamily.Unknown) return null;
        if (!PackageNames.TryGetValue(dependencyId, out var perFamily)) return null;
        if (!perFamily.TryGetValue(distro.Family, out var packageName)) return null;
        if (!InstallCommandTemplate.TryGetValue(distro.Family, out var template)) return null;
        return string.Format(template, packageName);
    }
}
