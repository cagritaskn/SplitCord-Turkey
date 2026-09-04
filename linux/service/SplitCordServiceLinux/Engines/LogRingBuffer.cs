namespace SplitCord.ServiceLinux.Engines;

/// <summary>Windows karşılığının birebir portu. Bir motorun stdout/stderr çıktısından son N
/// satırı tutan basit, thread-safe halka tampon.</summary>
public sealed class LogRingBuffer
{
    private readonly int _capacity;
    private readonly Queue<string> _lines = new();
    private readonly object _lock = new();

    public LogRingBuffer(int capacity) => _capacity = capacity;

    public void Add(string line)
    {
        lock (_lock)
        {
            _lines.Enqueue(line);
            while (_lines.Count > _capacity) _lines.Dequeue();
        }
    }

    public IReadOnlyList<string> Snapshot()
    {
        lock (_lock) return _lines.ToArray();
    }

    public void Clear()
    {
        lock (_lock) _lines.Clear();
    }
}
