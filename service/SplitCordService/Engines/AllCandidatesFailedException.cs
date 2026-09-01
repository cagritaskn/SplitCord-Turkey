namespace SplitCord.Service.Engines;

/// <summary>Bir motorun (ör. ByeDPI, GoodbyeDPI) elindeki TÜM aday stratejileri sırayla
/// deneyip hiçbirinin gerçekten Discord'a erişim sağlayamadığını bildirmek için —
/// DpiEngineManager bunu yakalayıp (ByeDPI için) otomatik olarak GoodbyeDPI'nin kendi
/// aday listesine geçmek gibi bir sonraki motora geçiş kararı vermek için kullanır.</summary>
public sealed class AllCandidatesFailedException : Exception
{
    public string EngineId { get; }

    public AllCandidatesFailedException(string engineId)
        : base($"{engineId}: denenen hiçbir strateji Discord'a erişemedi")
    {
        EngineId = engineId;
    }
}
