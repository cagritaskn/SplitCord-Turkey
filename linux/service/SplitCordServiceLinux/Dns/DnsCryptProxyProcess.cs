namespace SplitCord.ServiceLinux.Dns;

/// <summary>Windows karşılığının birebir portu. DNSCrypt sağlayıcıları için dnsproxy'yi
/// "-u sdns://..." ile yapılandırır. Ortak süreç yönetimi için bkz. DnsProxyToolProcess.cs.</summary>
public sealed class DnsCryptProxyProcess : DnsProxyToolProcess
{
    public const int Port = 53538;

    public DnsCryptProxyProcess(ILogger<DnsCryptProxyProcess> logger) : base(logger)
    {
    }

    protected override int LocalPort => Port;
    protected override string LogLabel => "DNSCrypt";

    protected override string BuildUpstreamArg(string providerAddress) => providerAddress;
}
