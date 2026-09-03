using System.Net.Http.Headers;

namespace SplitCord.Service.Dns.Upstreams;

/// <summary>RFC 8484 (DNS-over-HTTPS): ham DNS-wire sorguyu application/dns-message olarak
/// POST eder, ham yanıt baytlarını olduğu gibi döner. Eskiden DohForwarder.HandleQueryAsync
/// içindeydi, davranış değişmeden buraya taşındı.</summary>
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
