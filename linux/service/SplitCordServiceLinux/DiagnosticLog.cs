using Microsoft.Extensions.Logging;
using SplitCord.ServiceLinux.Config;

namespace SplitCord.ServiceLinux;

/// <summary>Windows karşılığının (service/SplitCordService/DiagnosticLog.cs) birebir portu — tek
/// fark dizin çözümlemesi: `%ProgramData%\SplitCord` yerine `LinuxPaths.DataDirectory`
/// (bkz. Config/LinuxPaths.cs, PORTING_PLAN.md D-3). Dosya 50MB'a ulaştığında TAMAMEN temizlenip
/// bir "temizlendi" satırıyla sıfırdan başlıyor.</summary>
public sealed class DiagnosticLogWriter
{
    private const long MaxBytes = 50L * 1024 * 1024;

    private readonly string _path;
    private readonly object _lock = new();

    public DiagnosticLogWriter()
    {
        _path = Path.Combine(LinuxPaths.DataDirectory, "diagnostic.log");
    }

    public string DirectoryPath => Path.GetDirectoryName(_path)!;

    public void Append(string source, string level, string category, string message)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [{source}] [{level}] [{category}] {message}{Environment.NewLine}";
        lock (_lock)
        {
            try
            {
                if (File.Exists(_path) && new FileInfo(_path).Length >= MaxBytes)
                {
                    File.WriteAllText(_path, $"--- günlük 50MB sınırına ulaştığı için temizlendi ({DateTime.Now:yyyy-MM-dd HH:mm:ss}) ---{Environment.NewLine}");
                }
                File.AppendAllText(_path, line);
            }
            catch
            {
                // Tanılama günlüğü hiçbir koşulda servisi çökertmemeli.
            }
        }
    }
}

/// <summary>Mevcut ILogger&lt;T&gt; altyapısına tek bir provider eklenerek servisin ürettiği HER
/// log satırının ayrıca DiagnosticLogWriter'a da yazılmasını sağlıyor.</summary>
public sealed class DiagnosticFileLoggerProvider : ILoggerProvider
{
    private readonly DiagnosticLogWriter _writer;

    public DiagnosticFileLoggerProvider(DiagnosticLogWriter writer) => _writer = writer;

    public ILogger CreateLogger(string categoryName) => new DiagnosticFileLogger(categoryName, _writer);

    public void Dispose()
    {
    }

    private sealed class DiagnosticFileLogger : ILogger
    {
        private readonly string _category;
        private readonly DiagnosticLogWriter _writer;

        public DiagnosticFileLogger(string category, DiagnosticLogWriter writer)
        {
            _category = category;
            _writer = writer;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            try
            {
                var message = formatter(state, exception);
                if (exception is not null) message += $" | {exception}";
                _writer.Append("service", logLevel.ToString(), _category, message);
            }
            catch
            {
                // Tanılama günlüğü hiçbir koşulda servisi çökertmemeli.
            }
        }
    }
}
