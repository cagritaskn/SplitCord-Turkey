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

builder.Services.AddSingleton<DohForwarder>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DohForwarder>());

builder.Services.AddSingleton<ByeDpiEngine>();
builder.Services.AddSingleton<GoodbyeDpiEngine>();
builder.Services.AddSingleton<ZapretEngine>();
// Sıra Zapret, ByeDPI, GoodbyeDPI — Otomatik modun yeni giriş noktası/eskalasyon sırasıyla
// (bkz. DpiEngineManager.SwitchToAsync) ve Manuel moddaki motor kart sırasıyla (bu liste
// sırası doğrudan DpiEngineManager._engines'e, oradan da GetStatus().engines'e yansıyor)
// tutarlı olsun diye.
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ZapretEngine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<ByeDpiEngine>());
builder.Services.AddSingleton<IDpiEngine>(sp => sp.GetRequiredService<GoodbyeDpiEngine>());

builder.Services.AddSingleton<DpiEngineManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DpiEngineManager>());

var app = builder.Build();
app.MapDpiEndpoints();
app.Run();
