using SplitCord.Service;
using SplitCord.Service.Config;
using SplitCord.Service.Dns;
using SplitCord.Service.Engines;
using SplitCord.Service.LocalApi;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWindowsService(options => options.ServiceName = "SplitCordDpiService");

builder.WebHost.ConfigureKestrel(options =>
{
    // Yalnızca loopback: bu API asla dış ağdan erişilebilir olmamalı.
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
builder.Services.AddSingleton<EncryptedDnsForwarder>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<EncryptedDnsForwarder>());

builder.Services.AddSingleton<ByeDpiEngine>();
builder.Services.AddSingleton<GoodbyeDpiEngine>();
builder.Services.AddSingleton<ZapretEngine>();
builder.Services.AddSingleton<Zapret2Engine>();
// Sıra Zapret2, Zapret, ByeDPI, GoodbyeDPI — Otomatik modun yeni giriş noktası/eskalasyon
// sırasıyla (bkz. DpiEngineManager.SwitchToAsync) ve Manuel moddaki motor kart sırasıyla
// (bu liste sırası doğrudan DpiEngineManager._engines'e, oradan da GetStatus().engines'e
// yansıyor) tutarlı olsun diye.
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<Zapret2Engine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ZapretEngine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ByeDpiEngine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<GoodbyeDpiEngine>());

builder.Services.AddSingleton<DpiEngineManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DpiEngineManager>());

var app = builder.Build();
app.MapDpiEndpoints();
app.Run();
