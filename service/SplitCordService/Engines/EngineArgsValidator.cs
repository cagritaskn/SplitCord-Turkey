using System.Text.RegularExpressions;

namespace SplitCord.Service.Engines;

/// <summary>
/// GÜVENLİK: POST /engines/{id}/args üzerinden gelen kullanıcı tanımlı motor argümanlarını doğrular.
/// Motorlar (ciadpi.exe, goodbyedpi.exe, winws.exe, winws2.exe) servis tarafından NT
/// AUTHORITY\SYSTEM oturumunda başlatıldığından, yerel API'ye erişebilen herhangi bir program
/// (standart kullanıcı yetkileriyle bile) bu argümanları kullanarak SYSTEM yetkisiyle dosya
/// yazabilir veya motor içinde keyfi Lua kodu çalıştırabilirdi (winws2, Lua'yı kendi korumalı
/// alanında çalıştırsa da paket içeriğine müdahale ve dosya erişimi riski taşır; winws ve ciadpi
/// ise doğrudan SYSTEM yetkisiyle dosya yazar). Örnekler: winws2'nin --lua-init=&lt;lua kodu&gt; /
/// --lua-init=@dosya.lua seçeneği, winws/winws2'nin --debug=@dosya, --hostlist-auto=dosya ve
/// --wf-save=dosya seçenekleri, ciadpi'nin --cache-dump=dosya / --pidfile=dosya seçenekleri ve
/// @dosya ile verilen argüman dosyası.
///
/// Kurallar:
/// - Kod çalıştıran veya dosya YAZAN seçenekler tamamen yasaktır. getopt_long tarafından kabul
///   edilen kısaltmalar (--lua-ini, --debu=...) ve tek tireli uzun biçimler (-lua-init) de aynı
///   seçenek sayılır. ciadpi için bu seçeneklerin kısa biçimleri (-y, -w, -D, -P) de yasaktır.
/// - --debug yalnızca parametresiz olarak veya tek haneli bir seviyeyle (--debug=1) kabul edilir;
///   dosyaya yazan biçimi (--debug=@dosya) kabul edilmez.
/// - --lua-desync=fonksiyon:... içindeki fonksiyon adı düz bir tanımlayıcı olmalı ve Lua'nın
///   standart global fonksiyonlarından biri (load, dofile, require, ...) olmamalıdır.
/// - "@" veya "$" ile başlayan token'lar (argüman/yapılandırma dosyaları), tırnak işaretleri ve ".."
///   yasaktır.
/// - Mutlak yollar (C:\..., C:göreli, \..., \\sunucu\..., /cygdrive/..., /...) kurulum klasörünü
///   gösterseler bile yasaktır (aksi halde yasak listesinde unutulmuş dosya yazan bir seçenek,
///   örneğin lua\zapret-lib.lua dosyasının üzerine yazabilir). Göreli dosya adlarına (ör.
///   --dpi-desync-fake-tls=tls_clienthello_www_google_com.bin) izin verilir; çünkü bunlar motorun
///   kendi bin klasörüne göre çözümlenir (bkz. her motordaki WorkingDirectory).
///
/// Token'lar, motorların kendi SplitArgs yöntemiyle BİREBİR aynı şekilde ayrılır (boşluklara göre,
/// tırnak işleme OLMADAN): ProcessStartInfo.ArgumentList her token'ı olduğu gibi tek bir argüman
/// olarak ilettiği için burada doğrulanan token'lar motorun gördüğü argümanlarla aynıdır.
///
/// Yasak listesinin kaynakları: ciadpi için vendor/byedpi-src/main.c içindeki seçenek tablosu;
/// winws/winws2 için zapret/zapret2 belgeleri (ikili dosyalar depoda bulunmadığından --help
/// çıktısıyla karşılaştırılamadı).
/// </summary>
public static class EngineArgsValidator
{
    private static readonly string[] ForbiddenLongOptions =
    {
        // winws2 (zapret2) -- seçenek tablosu: zapret2 nfq2/nfqws.c long_options
        "--lua-init",
        "--lua-gc",
        "--writable",
        "--chdir",
        // winws / winws2
        "--hostlist-auto",
        "--hostlist-auto-debug",
        "--wf-save",
        "--user",
        "--uid",
        "--gid",
        // ciadpi (byedpi) + winws (ortak)
        "--pidfile",
        "--daemon",
        // ciadpi
        "--cache-dump",
        "--protect-path",
    };

    // ciadpi karşılıkları: -y (--cache-dump), -w (--pidfile), -D (--daemon), -P (--protect-path).
    // GoodbyeDPI'daki -w geçerli bir seçenek olduğundan bu kontrol yalnızca byedpi motoru için
    // geçerlidir.
    private static readonly char[] ByeDpiForbiddenShortOptions = { 'y', 'w', 'D', 'P' };

    // Yasaklı bir seçeneğin öneki olan ancak kendi başlarına geçerli TAM adlar olan
    // seçenekler (getopt_long tam eşleşmeyi kısaltmaya tercih eder): --hostlist,
    // --hostlist-auto seçeneğinin önekidir.
    private static readonly HashSet<string> AllowedExactOptions = new(StringComparer.Ordinal)
    {
        "--hostlist",
    };

    // Kaçış dizisi biçimindeki ciadpi değerleri (ör. "--oob-data \x48"): dosya yolu değildir.
    private static readonly Regex HexEscapeValue = new(@"^(\\x[0-9A-Fa-f]{2})+$", RegexOptions.Compiled);

    private static readonly Regex AllowedDebugToken = new(@"^-{1,2}debug(=[0-9])?$", RegexOptions.Compiled);
    private static readonly Regex LuaIdentifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

    // Lua 5.x standart global'leri: --lua-desync bunları bir "desync fonksiyonu" olarak
    // çağırmamalıdır.
    private static readonly HashSet<string> ForbiddenLuaFunctions = new(StringComparer.Ordinal)
    {
        "_G", "_ENV", "assert", "collectgarbage", "coroutine", "debug", "dofile", "error",
        "getfenv", "getmetatable", "io", "ipairs", "load", "loadfile", "loadstring", "math",
        "module", "next", "os", "package", "pairs", "pcall", "print", "rawequal", "rawget",
        "rawlen", "rawset", "require", "select", "setfenv", "setmetatable", "string", "table",
        "tonumber", "tostring", "type", "unpack", "utf8", "xpcall",
        // zapret-lib.lua içindeki luaexec, "code" parametresini load() ile keyfi Lua kodu olarak
        // çalıştırır (winws2 korumalı alan kullansa bile trafik manipülasyonu ve dosya erişimi
        // açısından güvensizdir).
        "luaexec",
    };

    private static readonly char[] ValueSeparators = { '=', '@', ':', ',' };

    // winws.exe (zapret) ve winws2.exe (zapret2) Cygwin ile derlenmiştir. Cygwin çalışma
    // zamanı, varsayılan olarak Cygwin dışı bir süreçten (servisten) gelen komut satırını bir
    // POSIX kabuğu gibi YENİDEN işler (tırnak kaldırma, süslü parantez açılımı, glob ve ters
    // eğik çizgi kaçışları). Bu durumda motorun gördüğü argüman burada doğrulanan token'dan
    // farklı olabilir. İki katmanlı koruma uygulanır: motorlar CYGWIN=noglob ortam değişkeniyle
    // başlatılır (bu işlemleri tamamen kapatır) VE bu işleme mekanizmasını tetikleyen
    // karakterler Cygwin motorları için yasaklanır (yerleşik aday listelerinin hiçbiri bunları
    // kullanmaz). Tek tırnak tüm motorlar için yasaktır.
    private static readonly HashSet<string> CygwinEngines = new(StringComparer.Ordinal) { "zapret", "zapret2" };
    private static readonly char[] CygwinSpecialChars = { '{', '}', '*', '?', '[', ']', '(', ')', '\\', '~' };

    /// <summary>Geçersizse <see cref="ArgumentException"/> fırlatır (hata mesajı istemciye
    /// gösterilir).</summary>
    public static void Validate(string engineId, string args)
    {
        var error = GetError(engineId, args);
        if (error is not null) throw new ArgumentException(error);
    }

    /// <summary>Argüman dizisi güvenliyse null; değilse kullanıcıya gösterilecek hata mesajı.</summary>
    public static string? GetError(string engineId, string args)
    {
        foreach (var token in args.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var error = GetTokenError(engineId, token);
            if (error is not null)
            {
                return $"Güvenlik nedeniyle argümana izin verilmiyor: {token} ({error})";
            }
        }
        return null;
    }

    /// <summary>Token güvenliyse null; değilse kısa bir gerekçe.</summary>
    public static string? GetTokenError(string engineId, string token)
    {
        if (token.StartsWith('@') || token.StartsWith('$'))
            return "argüman dosyaları yüklenemez";

        // Tırnak içine alınmış token'larla seçenek adı gizleme girişimlerine hiç alan
        // bırakmıyoruz (Cygwin motorları tek tırnakları da alıntı olarak değerlendirir, bkz.
        // CygwinEngines notu).
        if (token.Contains('"') || token.Contains('\''))
            return "tırnak karakterlerine izin verilmez";

        if (CygwinEngines.Contains(engineId) && token.IndexOfAny(CygwinSpecialChars) >= 0)
            return "bu motor için { } * ? [ ] ( ) \\ ~ karakterlerine izin verilmez";

        if (token.Contains(".."))
            return "üst klasör (..) içeren yollara izin verilmez";

        // ciadpi'nin satır içi veri biçimi (ör. "--fake-data :\x16\x03..."): dosya yolu
        // değildir.
        if (token.StartsWith(':'))
            return null;

        if (engineId == "byedpi" && IsForbiddenByeDpiShortOption(token))
            return "bu seçeneğe izin verilmez";

        var optionName = GetLongOptionName(token);
        if (optionName is not null && optionName.Length >= 4)
        {
            if ("--debug".StartsWith(optionName, StringComparison.Ordinal))
            {
                if (!AllowedDebugToken.IsMatch(token)) return "--debug yalnızca bir seviyeyle kullanılabilir";
            }
            else if (!AllowedExactOptions.Contains(optionName)
                && ForbiddenLongOptions.Any(f => f.StartsWith(optionName, StringComparison.Ordinal)))
            {
                return "bu seçeneğe izin verilmez";
            }

            // Kısaltmalar dahil (--lua-des=...): --lua-desync seçeneğinin tek anlamlı
            // önekleri.
            if ("--lua-desync".StartsWith(optionName, StringComparison.Ordinal))
            {
                var eq = token.IndexOf('=');
                var func = eq < 0 ? "" : token[(eq + 1)..].Split(':')[0];
                if (!LuaIdentifier.IsMatch(func) || ForbiddenLuaFunctions.Contains(func))
                    return "geçersiz --lua-desync fonksiyonu";
            }
        }

        // Token'ın kendisi ve her ayırıcıdan sonraki bölüm olası bir dosya yolu olarak kontrol
        // edilir (ör. "--blacklist C:\x" -> "C:\x", "--blob=ad:@C:\x" -> "C:\x",
        // "--debug=@/x").
        if (IsRootedPath(token)) return "mutlak dosya yollarına izin verilmez";
        for (var i = 0; i < token.Length; i++)
        {
            if (Array.IndexOf(ValueSeparators, token[i]) >= 0 && IsRootedPath(token[(i + 1)..]))
                return "mutlak dosya yollarına izin verilmez";
        }

        return null;
    }

    /// <summary>"--ad[=değer]" veya getopt_long_only biçimindeki "-ad[=değer]" için "--ad"; tek
    /// harfli kısa seçenekler (-r, -At,r,s) ve seçenek olmayan token'lar için null.</summary>
    private static string? GetLongOptionName(string token)
    {
        string body;
        if (token.StartsWith("--", StringComparison.Ordinal)) body = token[2..];
        else if (token.Length > 2 && token[0] == '-' && char.IsLetter(token[1]) && char.IsLetter(token[2])) body = token[1..];
        else return null;

        var eq = body.IndexOf('=');
        return "--" + (eq >= 0 ? body[..eq] : body).ToLowerInvariant();
    }

    /// <summary>ciadpi kısa seçenekleri: "-y dosya", "-ydosya" veya birleşik bayraklar ("-NDy").
    /// Birleşik bir bayrak grubu (yalnızca harflerden oluşan bir token), yasaklı bir harf
    /// içeriyorsa yine reddedilir -- argüman alan bir seçenekten sonraki harfler gerçekte o
    /// seçeneğin değeri olsa bile (ör. "-Ay"); bu temkinli yaklaşım geçerli adayların hiçbirini
    /// etkilemez.</summary>
    private static bool IsForbiddenByeDpiShortOption(string token)
    {
        if (token.Length < 2 || token[0] != '-' || token[1] == '-') return false;
        if (Array.IndexOf(ByeDpiForbiddenShortOptions, token[1]) >= 0) return true;
        return token.Skip(1).All(char.IsAsciiLetter)
            && token.Skip(1).Any(c => Array.IndexOf(ByeDpiForbiddenShortOptions, c) >= 0);
    }

    private static bool IsRootedPath(string candidate)
    {
        if (candidate.Length == 0 || HexEscapeValue.IsMatch(candidate)) return false;
        return candidate[0] is '\\' or '/'
            || (candidate.Length >= 2 && char.IsAsciiLetter(candidate[0]) && candidate[1] == ':');
    }
}
