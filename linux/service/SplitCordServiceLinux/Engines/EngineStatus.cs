namespace SplitCord.ServiceLinux.Engines;

public sealed record EngineStatus(
    string Id,
    string DisplayName,
    bool Running,
    bool RequiresSystemWideAccess,
    string? ProxyAddress,
    string? Detail);
