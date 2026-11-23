namespace SplitCord.Service.LocalApi;

/// <summary>
/// GÜVENLİK: Yerel API yalnızca 127.0.0.1 üzerinde dinlese de, kullanıcının tarayıcısında açık
/// olan herhangi bir web sayfası 127.0.0.1:58271 adresine istek gönderebilir (gövdesiz POST
/// istekleri CORS preflight tetiklemeden "basit istek" olarak gider -- ör. /stop-all,
/// /settings/reset) veya DNS rebinding yöntemiyle kendi alan adını 127.0.0.1'e çözümleyip
/// yanıtları okuyabilir. Bu ara katman:
///
/// - Host başlığının tam olarak 127.0.0.1:PORT veya localhost:PORT olmasını zorunlu kılar (DNS
///   rebinding saldırısında Host, saldırganın alan adı olur).
/// - Origin başlığı taşıyan HER isteği reddeder: tarayıcılar çapraz kaynaklı fetch/form
///   isteklerine Origin eklerken, Electron ana sürecindeki Node http istemcisi eklemez.
/// - Özel <see cref="ClientHeaderName"/> başlığını zorunlu kılar: tarayıcıda özel bir başlık
///   CORS preflight isteğini gerektirir; servis CORS'a izin vermediği için istek hiç
///   gönderilmez.
///
/// Bu bir kimlik doğrulama DEĞİLDİR: aynı bilgisayarda çalışan yerel bir program bu başlıkları
/// kolayca ekleyebilir. Yerel programlara karşı koruma, SYSTEM düzeyindeki işlemlerin uç
/// noktalarda ayrı ayrı kısıtlanmasıyla sağlanır (bkz. EngineArgsValidator, LocalApiEndpoints).
/// </summary>
public static class LocalApiRequestGuard
{
    public const string ClientHeaderName = "X-SplitCord-Client";

    private static readonly string[] AllowedHosts =
    {
        $"127.0.0.1:{LocalApiConstants.Port}",
        $"localhost:{LocalApiConstants.Port}",
    };

    public static void UseLocalApiRequestGuard(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            var request = context.Request;
            var host = request.Host.Value ?? "";
            var hostOk = AllowedHosts.Any(h => string.Equals(h, host, StringComparison.OrdinalIgnoreCase));

            if (!hostOk
                || request.Headers.ContainsKey("Origin")
                || !request.Headers.ContainsKey(ClientHeaderName))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { error = "İstek reddedildi." });
                return;
            }

            await next();
        });
    }
}
