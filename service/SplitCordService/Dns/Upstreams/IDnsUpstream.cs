namespace SplitCord.Service.Dns.Upstreams;

/// <summary>Tek bir şifreli DNS protokolü için "ham DNS-wire sorgu bayt dizisini al, ham
/// DNS-wire yanıt bayt dizisini döndür" sözleşmesi. EncryptedDnsForwarder her sağlayıcının
/// protokolüne göre bu arayüzün bir uygulamasına dispatch eder.</summary>
public interface IDnsUpstream
{
    Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct);
}
