using System.Net.Http.Headers;

namespace SplitCord.ServiceLinux.Dns.Upstreams;

/// <summary>Windows karşılığının birebir portu. RFC 8484 (DNS-over-HTTPS).</summary>
public sealed class DohUpstream : IDnsUpstream
{
    private readonly HttpClient _http;

    public DohUpstream(HttpClient http)
    {
        _http = http;
    }

    public async Task<byte[]> ResolveAsync(DnsProvider provider, byte[] rawQuery, CancellationToken ct)
    {
        using var content = new ByteArrayContent(rawQuery);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/dns-message");

        using var response = await _http.PostAsync(provider.Address, content, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(ct);
    }
}
