namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının birebir portu. DoQ (RFC 9250) sağlayıcıları için dnsproxy'yi
/// "-u quic://host:port" ile yapılandırır. Ortak süreç yönetimi için bkz. DnsProxyToolProcess.cs.</summary>
public sealed class DoqProxyProcess : DnsProxyToolProcess
{
    public const int Port = 53537;

    public DoqProxyProcess(ILogger<DoqProxyProcess> logger) : base(logger)
    {
    }

    protected override int LocalPort => Port;
    protected override string LogLabel => "DoQ";

    protected override string BuildUpstreamArg(string providerAddress)
    {
        var (host, port) = DnsAddressParser.ParseHostPort(providerAddress);
        return $"quic://{host}:{port}";
    }
}
