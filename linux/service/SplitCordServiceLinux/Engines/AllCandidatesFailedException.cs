namespace SplitCord.ServiceLinux.Engines;

/// <summary>Windows karşılığının birebir portu. Bir motorun elindeki TÜM aday stratejileri
/// sırayla deneyip hiçbirinin gerçekten Discord'a erişim sağlayamadığını bildirmek için.</summary>
public sealed class AllCandidatesFailedException : Exception
{
    public string EngineId { get; }

    public AllCandidatesFailedException(string engineId)
        : base($"{engineId}: denenen hiçbir strateji Discord'a erişemedi")
    {
        EngineId = engineId;
    }
}
