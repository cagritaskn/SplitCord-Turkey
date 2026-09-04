using Microsoft.Extensions.Hosting.Systemd;
using SplitCord.ServiceLinux;
using SplitCord.ServiceLinux.Config;
using SplitCord.ServiceLinux.Dns;
using SplitCord.ServiceLinux.Engines;
using SplitCord.ServiceLinux.LocalApi;

// DOĞRULANMADI: bu dosya hiç gerçek bir systemd altında çalıştırılmadı (bkz.
// ../PORTING_PLAN.md §2 madde 5, D-8). Windows karşılığı service/SplitCordService/Program.cs'in
// birebir eşleniği — tek fark UseWindowsService()->UseSystemd() ve GoodbyeDpiEngine'in hiç
// kayıtlı olmaması (bkz. PORTING_PLAN.md D-2).

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSystemd();

builder.WebHost.ConfigureKestrel(options =>
{
    // Yalnızca loopback: bu API asla dış ağdan erişilebilir olmamalı. Windows tarafıyla AYNI
    // port (LocalApiConstants.Port) — istemci (Electron) tarafı hiçbir değişiklik yapmadan
    // aynı 127.0.0.1:<port> adresine konuşabilsin diye.
    options.Listen(System.Net.IPAddress.Loopback, LocalApiConstants.Port);
});

builder.Services.AddSingleton<SettingsStore>();

// Tanılama için: servisin ürettiği HER log satırı (tüm motorlar, DNS forwarder, LocalApi vs.)
// ve istemcinin kendi olay günlüğü (bkz. POST /diagnostic-log) TEK bir dosyada toplanıyor.
var diagnosticLogWriter = new DiagnosticLogWriter();
builder.Services.AddSingleton(diagnosticLogWriter);
builder.Logging.AddProvider(new DiagnosticFileLoggerProvider(diagnosticLogWriter));

builder.Services.AddSingleton<DoqProxyProcess>();
builder.Services.AddSingleton<DnsCryptProxyProcess>();
builder.Services.AddSingleton<NextDnsProxyProcess>();
builder.Services.AddSingleton<EncryptedDnsForwarder>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<EncryptedDnsForwarder>());

builder.Services.AddSingleton<ByeDpiEngine>();
builder.Services.AddSingleton<ZapretEngine>();
builder.Services.AddSingleton<Zapret2Engine>();
// Sıra Zapret, Zapret2, ByeDPI — GoodbyeDPI Linux'ta yok (bkz. PORTING_PLAN.md D-2). Otomatik
// modun giriş noktası/eskalasyon sırasıyla (bkz. DpiEngineManager.SwitchToAsync) ve Manuel
// moddaki motor kart sırasıyla tutarlı olsun diye.
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ZapretEngine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<Zapret2Engine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ByeDpiEngine>());

builder.Services.AddSingleton<DpiEngineManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DpiEngineManager>());

var app = builder.Build();
app.MapDpiEndpoints();
app.Run();
