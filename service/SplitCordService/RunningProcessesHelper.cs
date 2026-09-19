using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace SplitCord.Service;

public sealed record RunningProcessInfo(int Pid, string Path, string? CommandLine);

/// <summary>
/// Çalışan işlemlerin TAM yürütülebilir yollarını verir -- Ayarlar > Genel'deki "Oynanan
/// oyunu Discord'da göster" özelliği (bkz. client/src/main/gameActivity.js) oyunları
/// Discord'un algılanabilir-oyun listesiyle bu yollar üzerinden eşleştiriyor.
///
/// Neden servis: Discord'un listesindeki Windows girdilerinin ~%83'ü "klasör/oyun.exe"
/// biçiminde (yalnızca dosya adı yetmiyor), Electron/Node'da ise başka bir işlemin tam
/// yolunu veren yerleşik bir API yok; eskiden bunun için kullanılan `wmic` ise güncel
/// Windows 11 sürümlerinde artık kurulu gelmiyor. Servis LocalSystem olarak çalıştığı için
/// (kullanıcı oturumundaki dahil) tüm işlemleri sorgulayabiliyor, PowerShell/harici süreç
/// başlatmaya da gerek kalmıyor.
///
/// Komut satırı YALNIZCA istenen dosya adları için döndürülüyor (bkz. argsFor): Discord'un
/// listesinde bazı oyunlar ortak bir exe'yi paylaşıp yalnızca argümanla ayrılıyor
/// ("hl2.exe -game garrysmod" / "-game tf", "javaw.exe ... net.minecraft..."); ama her
/// işlemin komut satırını yerel API'de herkese açmak gereksiz bir gizlilik yüzeyi olurdu
/// (komut satırlarında parola/anahtar bulunabiliyor).
/// </summary>
public static class RunningProcessesHelper
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    // NtQueryInformationProcess bilgi sınıfı (Windows 8.1+, PROCESS_QUERY_LIMITED_INFORMATION yetiyor).
    private const int ProcessCommandLineInformation = 60;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder exeName, ref uint size);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr buffer, int length, out int returnLength);

    /// <param name="argsFor">Komut satırı istenen dosya adları (küçük harfli, ör. "javaw.exe"); null/boş = hiçbiri.</param>
    public static List<RunningProcessInfo> List(ISet<string>? argsFor = null)
    {
        var result = new List<RunningProcessInfo>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                // 0 = Idle, 4 = System: yolları yok.
                if (process.Id <= 4) continue;
                var handle = OpenProcess(ProcessQueryLimitedInformation, false, process.Id);
                if (handle == IntPtr.Zero) continue;
                try
                {
                    var path = TryGetImagePath(handle);
                    if (string.IsNullOrEmpty(path)) continue;

                    string? commandLine = null;
                    if (argsFor is { Count: > 0 } && argsFor.Contains(Path.GetFileName(path).ToLowerInvariant()))
                        commandLine = TryGetCommandLine(handle);

                    result.Add(new RunningProcessInfo(process.Id, path, commandLine));
                }
                finally
                {
                    CloseHandle(handle);
                }
            }
        }
        return result;
    }

    // Process.MainModule 32/64-bit uyuşmazlığında ve korumalı işlemlerde atıyor;
    // QueryFullProcessImageName + PROCESS_QUERY_LIMITED_INFORMATION ise (korumalı olanlar
    // hariç) hepsinde çalışıyor ve çok daha ucuz. Başarısız olan işlem sessizce atlanır.
    private static string? TryGetImagePath(IntPtr handle)
    {
        var buffer = new StringBuilder(1024);
        var size = (uint)buffer.Capacity;
        return QueryFullProcessImageNameW(handle, 0, buffer, ref size) ? buffer.ToString() : null;
    }

    // ProcessCommandLineInformation, başka bir işlemin PEB'ini elle okumaya gerek bırakmadan
    // (WMI/harici süreç yok) komut satırını bir UNICODE_STRING olarak, dizenin kendisi de aynı
    // tamponun içinde olacak şekilde veriyor. Servis x64 olduğundan UNICODE_STRING düzeni:
    // Length(2) MaximumLength(2) dolgu(4) Buffer(8).
    private static string? TryGetCommandLine(IntPtr handle)
    {
        _ = NtQueryInformationProcess(handle, ProcessCommandLineInformation, IntPtr.Zero, 0, out var needed);
        if (needed <= 0 || needed > 1 << 20) return null;

        var buffer = Marshal.AllocHGlobal(needed);
        try
        {
            if (NtQueryInformationProcess(handle, ProcessCommandLineInformation, buffer, needed, out _) < 0) return null;
            var byteLength = Marshal.ReadInt16(buffer, 0);
            if (byteLength <= 0) return null;
            var stringPointer = Marshal.ReadIntPtr(buffer, 8);
            return Marshal.PtrToStringUni(stringPointer, byteLength / 2);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}
