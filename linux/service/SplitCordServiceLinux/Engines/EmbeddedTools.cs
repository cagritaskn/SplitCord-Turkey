namespace SplitCord.ServiceLinux.Engines;

/// <summary>PORT_PLAN_2.md AP-4/Faz 2 (2026-09-09 kapsam genişletmesi — bkz. plan dosyasındaki
/// "hedef dağıtım listesi kaldırıldı, best-effort TÜM dağıtımlar" kararı): `blockcheck2.sh`'nin
/// KENDİSİ (bkz. gerçek kaynağı, `.build-cache/zapret2/zapret2-v1.0.5/blockcheck2.sh` satır
/// ~190-210/800-909) `iptables`/`ip6tables`/`nft`'i DOĞRUDAN, bare komut adıyla (PATH üzerinden)
/// çağırıyor — bizim kendi `RunIptablesAsync` çağrılarımız gibi tek bir C# çağrı noktası değil,
/// harici bir bash script. Bu yüzden "bundled binary'yi kullan" stratejisi (tek bir dosya yoluna
/// işaret etmek) burada işlemiyor -- bunun yerine gömülü araçların bulunduğu dizinleri
/// (build-iptables-nft.sh + build-nftables.sh'in ürettiği) child process'in PATH'ine ÖNE
/// EKLİYORUZ, böylece hem bizim kendi RunIptablesAsync çağrılarımız HEM DE blockcheck2.sh'nin
/// bare "iptables"/"ip6tables"/"nft" çağrıları aynı çözümü buluyor -- sistemde zaten kuruluysa
/// onu, yoksa (ya da varsa bile ÖNCELİKLİ olarak) gömülü kopyayı kullanır.
///
/// DOĞRULANMADI (bkz. PORTING_PLAN.md §2 madde 5, PORT_PLAN_2.md §1 madde 5): PATH'e ekleme
/// mantığının kendisi basit/standart ama build-iptables-nft.sh/build-nftables.sh'in ÜRETTİĞİ
/// binary'lerin gerçekten çalıştığı hiç canlı test edilmedi.</summary>
public static class EmbeddedTools
{
    private static readonly string[] ToolFolders = { "iptables-nft", "nftables" };

    /// <summary>Mevcut PATH'in başına, VARSA (bkz. yukarıdaki not — build script'i başarısız
    /// olduysa/hiç çalıştırılmadıysa dizin hiç oluşmaz, bu durumda sessizce atlanır) gömülü araç
    /// dizinlerini ekler. Sistemde zaten `iptables`/`nft` kuruluysa bile gömülü kopya ÖNCELİKLİ
    /// oluyor (Faz 2'nin patchelf ile hazırladığı, hedef dağıtımdan bağımsız kopya -- sistemdekinin
    /// eksik/uyumsuz olma ihtimaline karşı en güvenilir seçenek).</summary>
    public static string PathWithEmbeddedToolsFirst()
    {
        var existingPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        var embeddedDirs = ToolFolders
            .Select(BinaryLocator.ToolDir)
            .Where(Directory.Exists);

        var prefix = string.Join(':', embeddedDirs);
        return string.IsNullOrEmpty(prefix) ? existingPath : $"{prefix}:{existingPath}";
    }
}
