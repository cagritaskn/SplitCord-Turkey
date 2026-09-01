using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Linq;
using SplitCord.Service.Config;

namespace SplitCord.Service.Engines;

/// <summary>
/// Varsayılan/ana DPI aşım motoru. ciadpi.exe'yi (hufrea/byedpi) yerel bir SOCKS5 proxy
/// olarak başlatır. Admin yetkisi gerektirmez; yalnızca Electron client'ın Discord webview
/// session'ı bu proxy'ye yönlendirilir, sistemin geri kalanı etkilenmez.
///
/// ISP'ye göre hangi desync stratejisinin işe yarayacağı önceden bilinemediği için:
/// motor doğrulanmamışsa (ByeDpiVerified=false), <see cref="GetCandidateStrategies"/>'in
/// döndürdüğü listedeki argümanlar sırayla denenir — her adayla ciadpi başlatılıp gerçekten
/// discord.com'a ulaşılabiliyor mu diye test edilir. İlk çalışan aday kalıcı olarak
/// kaydedilir (EngineArgs + ByeDpiVerified=true), sonraki açılışlarda doğrudan o
/// kullanılır ve yeniden test edilmez.
/// </summary>
public sealed class ByeDpiEngine : IDpiEngine
{
    // Sıralama önem taşıyor: en yüksek güvenilirlikli/doğrulanmış adaylar önce denenir.
    // 1-2: kullanıcı tarafından Türkiye'de çalıştığı doğrulanmış argümanlar.
    // 3: bu projenin ilk sürümünden kalan makul genel varsayılan.
    // 4-5: ByeDPI'nin kendi README'sindeki resmi kullanım örnekleri.
    // 6-7: topluluk kaynaklarında (Türkiye odaklı) paylaşılan ek stratejiler.
    // 8: "-s1 -At -d2 -r1+s -An" — 2 numaralı adayın -f-1'siz (fake paket TTL'i olmayan) hâli.
    // 9: çok adımlı/ağır bir desync zinciri (birden çok -s/-d/-o kombinasyonunu art arda dener).
    // Kisa/varsayilan liste: 9 adet elle secilmis/dogrulanmis strateji. ByeDpiUseExtendedCandidates
    // kapaliyken (varsayilan) yalnizca bu liste taranir.
    private static readonly string[] ShortCandidateStrategies =
    {
        "-r 1+s",
        "-s1 -At -d2 -f-1 -r1+s -An",
        "--split 1+s --disorder 2 --auto=torst",
        "--disorder 1 --auto=torst --tlsrec 1+s",
        "--fake -1 --ttl 8",
        "--split 1 --disorder 3+s --mod-http=h,d --auto=torst --tlsrec 1+s",
        "-s1 -d1 -At -r1+s -An",
        "-s1 -At -d2 -r1+s -An",
        "-Ku -a1 -An -d1 -s0+s -d3+s -s6+s -d9+s -s12+s -d15+s -s20+s -d25+s -s30+s -d35+s -At,r,s -s1 -q1 -At,r,s -s5 -o25000+s -At,r,s -o1 -d1 -r1+s -t10 -b1500 -s0+s -d3+s -At,r,s -f-1 -r1+s -At,r,s -s1 -o1+s -s-1",
    };

    // Genisletilmis liste: yukaridaki 9 adaya ek olarak ~1000 topluluk/fuzzer kaynakli
    // strateji. ByeDpiUseExtendedCandidates ACIKKEN kisa listenin ARDINDAN bunlar da
    // denenir (bkz. GetCandidateStrategies). Tarama suresi onemli olcude uzayabilir.
    private static readonly string[] ExtendedCandidateStrategies =
    {
        @"-q1 -ea",
        @"--tlsrec -5+s",
        @"--oob -5 --oob-data a",
        @"--disoob -5 --oob-data a",
        @"--oob 1+s --oob-data a",
        @"-r 2+sm",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 2+sm --oob -9+n --disorder -5+he --auto none",
        @"-r 1+s -At,r,s",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 7+hm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -3+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 10+ne --mod-http d,r --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -4+se --disoob 2+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 1+he --tlsrec 2+ne --disorder 6+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder -2+h --split -5+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -6+nm --split -9+he --disorder 1+hm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split -6+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 1+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 7+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -1+s --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -2+s --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 10+hm --disoob 6+nm --oob-data \x48 --mod-http h,d --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -9+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 4+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob 9+n --disoob -6+nm --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -9+nm --oob-data \x48 --disoob -7+h --oob -6+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -9+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -1+ne --tlsrec 4+h --tlsrec 3+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake 0+he --oob 6+nm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -3+h --oob-data \x48 --tlsrec -3+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec -4+s --tlsrec 7+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 3+se --disorder -8+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec -1+h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -2+he --fake 5+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 1+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake -8+ne --fake-data :\xbb\x1a\x02\xfa\x43\x9d\x6d\x99\x75\x87 --fake 10+nm --ttl 12 --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 4+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 9+n --disoob -9+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -4+n --fake 6+sm --tlsrec 7+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 7+s --split 5+he --split -8+sm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -5+s --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 2+he --oob 9+nm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -3+nm --fake-data :\x2d\xf5\x3b\xb5\x78\x4a\x5a\x81 --tlsrec -5+ne --disoob -4+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 6+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -4+se --oob 10+sm --mod-http h,d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 7+n --fake -3+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake 6+n --fake-sni apple.com --fake-tls-mod r --fake 1+he --fake-offset -7+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -8+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake 10+he --disorder 4+n --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 9+sm --disoob 5+s --fake 7+hm --fake-sni apple.com --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split -2+nm --tlsrec -3+n --split -3+he --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake -4+sm --fake 2+se --fake-sni ozon.ru --split 0+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -4+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 2+s --tlsrec -2+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 0+he --tlsrec 4+n --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 10+hm --split -1+nm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 10+s --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob 9+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split -2+se --tlsrec 0+h --mod-http h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 3+nm --disoob 2+n --oob -2+n --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -4+sm --split -8+nm --fake 0+nm --ttl 4 --fake-data :\x65\x6d\x67\x6f\x71\xa6\xa7\x39\x6c\x76\xf7\x12\xa0\xda\xc7\x14\x95\x6e\xe1\x14\xd1\x1c\xac\x8f\xe1\xba\x1f\x5d --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 9+nm --fake -6+nm --ttl 11 --disorder 2+sm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -1+n --oob 5+sm --tlsrec 7+s --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 5+se --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 1+ne --fake -7+nm --ttl 2 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 3+hm --oob-data \x48 --oob 1+s --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob -4+nm --disoob -5+nm --oob -6+se --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -8+ne --fake -8+h --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -8+hm --oob 6+he --oob-data \x48 --mod-http r,h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 8+nm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 0+sm --disorder -7+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split -9+se --mod-http d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 4+se --tlsrec 0+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 2+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 4+s --fake-data :\x06\x0e\xe5\x2f\x60\x07\x82\x1d\xbb\x5c\xc4\xe4\x86 --fake-tls-mod o --mod-http d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -4+he --tlsrec -2+he --disoob -10+nm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 4+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -4+he --oob-data \x48 --fake 6+s --ttl 2 --fake-tls-mod r --disoob -5+sm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 4+h --oob -1+ne --disorder -2+se --mod-http h,d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -5+h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -1+h --disoob 0+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 1+he --fake -2+hm --fake-sni ozon.ru --mod-http d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 4+se --split 5+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob 6+ne --oob -8+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 2+s --tlsrec -8+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 6+n --disorder -8+hm --tlsrec 10+nm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -1+ne --oob -1+h --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake 1+n --fake-offset -7+se --oob 6+s --disoob 10+he --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 10+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split 8+sm --tlsrec -4+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 8+n --split 3+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 9+se --oob -10+s --mod-http h,d --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake 2+sm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -4+nm --split -2+ne --oob -3+sm --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -7+nm --fake 7+s --fake-tls-mod r --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder -3+he --disoob 10+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 8+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 1+h --tlsrec 9+se --tlsrec 2+ne --drop-sack --mod-http d --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder 4+he --tlsrec -7+nm --oob -9+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 0+hm --disorder 7+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 6+se --fake 9+nm --disorder 9+h --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 2+n --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -9+he --disorder 8+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder -7+ne --oob -5+s --fake -2+sm --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -3+nm --fake -4+se --ttl 8 --disoob -9+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -1+nm --oob-data \x48 --split -4+sm --disoob 0+se --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -10+h --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 5+sm --tlsrec 0+hm --fake 6+hm --ttl 4 --fake-tls-mod r --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -8+s --fake-data :\x8a\x42\xc1\xe2\x8b\x90\x5a\x39\x46\xa6\x8a\xc4\x38 --split 3+se --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake 9+he --ttl 3 --oob 8+h --oob-data \x48 --disorder -8+he --mod-http h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split 6+n --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 9+sm --mod-http d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec -7+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder -8+hm --fake -10+n --ttl 10 --fake-sni apple.com --oob 9+he --oob-data \x48 --mod-http r,h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split -7+se --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -10+ne --disorder -1+nm --tlsrec -6+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -1+he --fake -4+hm --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -3+sm --fake -10+n --fake-offset -9+hm --fake-sni ozon.ru --oob -8+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 6+ne --disoob 2+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -3+h --mod-http d,r --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 5+sm --tlsrec 0+nm --oob 10+n --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 6+nm --disoob 4+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -6+n --disorder -8+he --split -5+hm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 10+he --oob -4+nm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 2+nm --fake -7+n --fake-offset 7+sm --tlsrec 9+he --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake -8+nm --tlsrec -3+sm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 10+s --fake-data :\x8d\x70\x93\x18\xd3\x1d\xd5\xcf\xf4\x4d\xd8\x75\x61\xc6\x5b\xed\x0f\x6c\x75\x80\x7f\x96\xe3\xf9\x4e\x86\x7d --fake-sni apple.com --fake-tls-mod r --split 7+s --disorder 10+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 8+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 7+n --disoob -9+hm --oob-data \x48 --drop-sack --mod-http h,d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split -6+s --disoob 6+h --disorder 4+s --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -5+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -2+he --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 8+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 5+h --disorder 0+ne --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -6+s --oob-data \x48 --oob 7+se --split -4+n --mod-http r,h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob -7+s --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 5+h --oob -4+h --oob -9+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 0+nm --disorder -1+sm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -7+ne --mod-http d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -4+se --fake -7+se --fake-tls-mod o --disorder 1+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec -1+se --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 1+sm --disoob 8+s --fake 9+n --fake-offset 6+nm --fake-sni apple.com --fake-tls-mod o --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 6+s --oob -10+hm --oob-data \x48 --drop-sack --mod-http d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob 5+ne --oob 2+he --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disorder 2+sm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -6+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split -3+s --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -10+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -3+h --fake-offset 2+n --fake-data :\x4c\x40\x89\xfd\x14\x9b\xda\x18\xaf\xd9\x65\x94\xdc\xeb\xcb\xc6\xa4\xe5\x02\xb6\x53\x8d\x56\x90\x04 --disoob 4+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 3+n --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake 10+hm --fake-data :\x82\xd5\x9e\x05\xe9\xd4\x6c\x68\x88\x59\x34\x98 --disoob 6+nm --oob -10+he --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 2+sm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -10+se --split 5+ne --oob 2+sm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 2+nm --fake 4+se --fake-offset 6+hm --fake-sni ozon.ru --fake-tls-mod r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -1+n --split -1+he --fake -4+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -3+nm --disoob -4+s --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 3+n --disoob 6+n --mod-http r,h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 7+se --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob 10+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 5+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 1+n --oob-data \x48 --disorder -4+ne --mod-http h,d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 9+he --ttl 3 --disoob -3+h --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder -8+sm --disoob -10+sm --mod-http h,d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 1+h --split 8+hm --disoob -4+he --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec -7+sm --split -7+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 7+sm --fake-data :\xcb\x19\x37\x12 --fake-tls-mod r --oob -3+n --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder -9+ne --disoob 7+nm --split -3+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 6+nm --ttl 11 --fake-tls-mod o --disorder 1+s --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 3+s --mod-http r,h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 1+he --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 9+n --oob -6+n --mod-http h,d --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 1+sm --oob 10+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -9+n --oob 10+n --tlsrec 7+se --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -8+sm --oob -8+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -8+hm --fake-offset 0+h --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder 10+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -4+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split -1+ne --split -3+nm --tlsrec -8+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -4+s --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split -8+he --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 6+n --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 2+s --disoob 3+he --fake -10+h --mod-http d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 10+h --oob-data \x48 --fake -10+se --ttl 12 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder 8+nm --oob -5+nm --fake -6+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 8+ne --disorder -6+n --split 4+h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 0+h --disorder 2+he --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 8+sm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 4+s --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob 7+s --tlsrec 10+s --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -6+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -9+hm --tlsrec -4+s --disorder 8+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -3+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -7+ne --disoob 1+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec 3+se --oob 2+se --disorder 5+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -1+ne --disoob 1+h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 10+ne --disorder 1+n --disoob 0+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 5+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake -2+se --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -7+s --split 8+hm --split -4+ne --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 6+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 9+sm --oob-data \x48 --disoob -8+ne --disoob 2+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 0+h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 7+se --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 4+sm --split -2+n --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -3+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 0+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -10+hm --oob-data \x48 --disorder 7+sm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -7+sm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 1+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake 6+s --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -5+s --oob-data \x48 --tlsrec -7+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 9+s --fake 8+sm --fake-data :\xe3\xf3\x00\x80\x8a\xed\x52\x66\x10\x93 --fake-sni apple.com --disoob -5+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -6+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 5+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 4+s --oob 4+hm --split -6+sm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 5+h --fake 9+sm --disorder 8+s --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 6+ne --oob -5+h --oob-data \x48 --split -3+he --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -2+hm --fake -10+sm --fake-sni ozon.ru --oob -4+n --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 10+ne --tlsrec -5+s --oob -9+he --mod-http h,d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -5+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob -9+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split -5+s --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 5+hm --tlsrec -2+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -7+hm --fake-offset 4+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -3+h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 2+nm --tlsrec 7+se --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake 2+nm --disoob 1+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 2+se --tlsrec 9+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 6+se --fake 7+he --fake-sni apple.com --oob -1+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 8+nm --split -6+sm --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -6+se --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 5+sm --oob -5+s --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 10+s --disorder -9+he --oob -5+he --mod-http h,d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 5+s --oob -7+sm --split 1+s --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -6+ne --fake-offset -8+n --ttl 12 --fake-data :\x12\xdd\x3d\x7a\xa8\xfa\x1c\x6b\x08\x37\x27\x9f\xe8 --fake-sni apple.com --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -8+sm --oob-data \x48 --mod-http d,r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec -1+nm --disoob -3+sm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 0+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec -5+se --oob -1+sm --oob-data \x48 --fake 1+sm --ttl 10 --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -9+hm --disoob 2+nm --tlsrec 8+n --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -1+h --oob-data \x48 --disoob -3+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -6+nm --fake-data :\xaf\x7d\xa8\xbc\x3b\x9d\x59\x58\x45\x13\x85\x9e\x65\xd5\xb4\x11\x52 --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 8+h --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -9+h --oob 4+sm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -10+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 1+nm --split -1+hm --mod-http d,r --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder -3+ne --split 0+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -3+hm --mod-http h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 7+n --tlsrec -8+nm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 0+h --oob -4+he --oob -8+hm --oob-data \x48 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -3+sm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -4+ne --disorder 3+he --split -8+s --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 10+s --fake -3+s --fake-data :\x69\xdb\x36\xa9\x1f\x56\x33\x80\xdb\xa8\xb8\xad\x2b\x24\x86\x48\x00\x44\x49\xc2\x1c\xb0\x6c\xc7\xd3\x1d\x45\xea\x43\xb7\xae --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 2+he --disoob 4+sm --tlsrec -8+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 1+ne --disoob 4+he --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 9+nm --disorder -5+s --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 9+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 10+nm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 7+hm --oob -6+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -1+he --oob-data \x48 --oob 0+hm --oob-data \x48 --disoob 0+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -3+sm --disorder 8+hm --fake 4+he --fake-data :\xec\x41 --fake-sni apple.com --mod-http d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob -5+ne --drop-sack --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -7+se --disoob -9+h --disorder 9+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split -9+ne --oob -6+n --oob-data \x48 --mod-http r,h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 0+h --disoob -10+hm --fake 10+ne --drop-sack --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 0+ne --disorder 10+ne --fake -2+he --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -3+s --split 7+h --fake 7+hm --ttl 9 --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 9+se --fake -9+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 1+h --tlsrec 9+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disorder -8+se --tlsrec -6+hm --tlsrec -3+nm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -5+hm --tlsrec 8+h --fake 1+nm --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake -9+sm --ttl 6 --fake-sni apple.com --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 5+nm --split 9+he --oob 3+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -5+h --split 3+n --disorder 5+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 1+s --tlsrec 2+hm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 9+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -9+ne --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 7+n --tlsrec -10+n --disorder 1+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -8+ne --mod-http d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 6+n --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -10+se --tlsrec -7+he --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -9+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 7+h --fake -9+h --tlsrec 6+n --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -9+ne --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 3+h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split -9+hm --split 1+h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -2+he --oob -8+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 6+nm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 0+he --disorder -3+n --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec -3+nm --split -5+s --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 0+se --disoob -7+hm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -10+he --disoob 5+hm --tlsrec 10+se --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob -7+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob -9+he --oob-data \x48 --fake 5+sm --fake-data :\x20\xb9\xbd\x9c\x36\x40\x3f\xd5\xfb\x1b\xf8\xa6\xb8\xbc\x69\x39\xed\x18 --disoob 9+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -8+h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake -10+hm --fake-sni apple.com --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 7+ne --oob-data \x48 --tlsrec 7+n --oob 2+s --oob-data \x48 --mod-http d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 6+n --fake 10+n --fake-sni ozon.ru --fake -10+hm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob 4+hm --split 8+he --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -4+h --tlsrec 3+ne --tlsrec -8+n --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split -1+s --disorder -5+hm --fake 10+se --fake-sni ozon.ru --mod-http d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 8+h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 1+nm --fake 4+hm --fake-offset -8+h --fake-sni ozon.ru --disoob -1+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 10+se --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 8+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -4+n --tlsrec -7+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 7+sm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -4+ne --oob-data \x48 --fake -3+hm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -10+s --fake-offset 4+s --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 8+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 6+sm --oob-data \x48 --fake -8+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 10+se --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 1+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -9+hm --split 1+he --tlsrec -9+ne --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder -9+ne --disorder 5+h --disoob 7+sm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 6+h --ttl 5 --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob -10+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split 5+n --disorder 10+se --tlsrec -2+sm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -2+hm --fake-offset -1+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 10+se --fake-data :\xf1\x15\x83\xdd\x3c\x5d\x3d\x7e\x81\xf5\x7d\xab\xcc\xef\x06\x33\x2b\x68\x44\x01 --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 3+nm --mod-http h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 9+h --mod-http h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 6+h --drop-sack --mod-http r,h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -4+ne --fake-tls-mod r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -5+sm --split -8+h --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -3+nm --fake 9+ne --ttl 5 --fake-sni ozon.ru --fake-tls-mod r --disorder 8+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 5+hm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -3+ne --disoob -2+he --disoob 1+h --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 3+se --oob 3+n --fake 8+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec 2+ne --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 10+s --fake -10+se --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 0+s --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -5+nm --fake -5+s --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 3+hm --tlsrec 4+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 7+nm --fake-data :\xc2\x64\x61\xa0\x0b\x56\xbc\x66\x54 --fake-sni ozon.ru --fake -4+s --fake-offset 5+ne --fake-data :\x04\x4a\x19\xf6\xd7\x67\x7e\xd9\x6c\xd9\xd9\x65\xa1\xea\x51\xed\xcc\xfc\xd9\xea\xb5\xbb\xf5 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 3+s --split 7+h --oob -3+hm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 10+he --oob-data \x48 --disorder 10+h --oob 3+n --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 8+n --mod-http h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 4+h --fake 5+se --fake-sni apple.com --fake 4+se --fake-sni ozon.ru --mod-http h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -1+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 2+se --oob -10+hm --split 7+se --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake -8+ne --fake-offset 7+hm --disorder -8+nm --disoob -8+sm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 2+nm --split -1+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder 8+he --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder 8+nm --oob -8+sm --fake 0+sm --ttl 7 --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -4+hm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 5+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 2+hm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -6+ne --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -2+n --oob 9+h --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 10+s --fake 10+n --ttl 10 --oob 10+se --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 4+he --disorder 2+ne --split 2+h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -5+nm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 2+n --disorder -6+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -4+ne --disorder -2+s --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 1+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 0+n --fake 9+ne --fake-data :\x7c\x0f\x0c\xf2\x0e\xd5\x7d\x89\x6a\x29\x88\xaf\xb6\x5b\xb9\x15\x11\x2d\x96\xc0\xbb --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 1+ne --disorder -10+nm --fake -2+sm --ttl 12 --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake -7+ne --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob -1+hm --fake 3+n --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -5+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -7+nm --split -6+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 2+h --disorder -6+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -4+h --oob 9+he --tlsrec 0+ne --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split -5+se --oob 8+sm --fake 4+n --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 2+hm --tlsrec -10+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob -9+h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 9+h --ttl 5 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 2+hm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split 8+se --tlsrec -2+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake -4+n --fake-tls-mod o --split 6+se --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split -8+ne --tlsrec 1+ne --split 3+he --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -6+nm --disorder 3+se --disorder 5+hm --mod-http d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 2+he --tlsrec 8+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 0+h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split -7+s --fake 7+h --fake-data :\xd0\x39\x37\xa1\xa0\x56\xc4\xa5\x8a\x2c\xb8\xdb\xe2\x87\xdb\x1e\x91\xc6\x30 --tlsrec -5+h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -7+ne --disorder 6+nm --oob 5+hm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder -9+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -9+he --fake-sni apple.com --fake -3+s --fake-data :\x86\xe7\xd2\x28\x89\xce\x6d\x30\xef\x14 --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -9+he --disoob -9+n --oob -6+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec -6+n --oob 9+n --tlsrec 7+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec -2+ne --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 1+h --oob 0+hm --split -7+sm --drop-sack --mod-http r,h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -6+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec -3+ne --oob 7+nm --tlsrec -8+n --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -3+se --split 3+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 7+s --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 0+sm --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec -9+sm --split -2+s --disorder 6+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -4+sm --tlsrec -7+n --oob -3+se --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob -3+ne --fake 7+h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 1+hm --fake -1+ne --fake-data :\x5e\x30\xe0\x08\x76\xcb --oob 7+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake -4+se --ttl 11 --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -7+sm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec 0+sm --disoob -5+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -5+se --tlsrec -2+s --oob -2+se --oob-data \x48 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 1+hm --disoob -1+ne --fake 4+h --ttl 5 --fake-data :\x27\xa5\x30\xc5 --fake-sni apple.com --fake-tls-mod r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 9+nm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -1+s --disoob -1+se --oob-data \x48 --disorder 2+se --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake -4+ne --ttl 6 --disorder -10+sm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -10+n --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -9+nm --tlsrec 8+se --disorder -5+hm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split -5+ne --disoob 5+he --oob-data \x48 --split 7+nm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -10+n --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -10+s --fake-offset 9+sm --fake-data :\x7c\x71\xa7\xbf\xfb --tlsrec -9+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 10+n --oob-data \x48 --split 3+ne --tlsrec 0+se --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 10+nm --split 1+nm --split -8+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split -5+s --oob 10+se --mod-http r,h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -2+se --fake 6+sm --fake-tls-mod r --disorder 4+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 6+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder -9+n --fake -9+nm --fake-tls-mod o --disorder 0+n --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -9+s --fake -9+ne --ttl 4 --mod-http h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -6+h --oob 2+nm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 9+sm --disorder 4+hm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 1+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 8+ne --oob-data \x48 --split -6+sm --disorder 1+he --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec 8+hm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -6+h --disorder -8+sm --split -7+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 5+nm --oob-data \x48 --oob -5+sm --oob-data \x48 --tlsrec -4+h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -9+sm --ttl 12 --split 2+nm --disoob 2+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob -8+ne --disoob -3+se --disoob -6+se --mod-http h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 6+ne --split -2+n --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake -4+nm --fake-offset 8+hm --fake-data :\x97\x8c\x7b\xff\x12\x7b\x6f\x8d\x29\x8c\x03\x3e\x29\xe7\x5d\x7c\x0b\x5d --fake-sni ozon.ru --fake-tls-mod o --disorder 2+hm --disoob 7+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 9+he --fake-sni apple.com --fake -9+s --disoob -5+s --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 9+sm --disoob -8+h --oob-data \x48 --tlsrec -6+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 3+hm --fake-offset -7+sm --fake-sni ozon.ru --oob -4+sm --disoob 7+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 9+ne --tlsrec 4+nm --disorder 9+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -3+se --tlsrec -3+nm --oob -4+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -3+s --fake-data :\x0a --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split 10+he --split -2+nm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -2+h --disoob 7+h --disorder -2+h --mod-http d,r --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder -8+n --tlsrec 3+sm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -1+h --oob 4+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake 1+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -4+se --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 7+nm --oob 3+se --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -7+sm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 8+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -6+hm --oob -10+ne --disoob -9+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 6+n --oob -5+s --tlsrec -10+hm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake 0+h --ttl 9 --tlsrec 4+se --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 5+sm --oob-data \x48 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 10+se --disorder -3+sm --mod-http d --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder 2+s --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 8+ne --mod-http d,r --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 9+se --oob 3+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -4+ne --tlsrec 3+sm --disorder -4+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -10+se --fake-data :\x41\x56\x15\x61\xdf\x14\x30\xc6\xf1\xa5\x6e\x4b\xd3\xce --disorder 6+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob 3+se --split 7+s --fake 7+s --fake-offset -6+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -4+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -3+n --fake 0+hm --ttl 2 --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake -6+sm --fake-sni apple.com --fake 8+s --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -4+se --disoob -7+hm --split 9+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -7+he --tlsrec 8+nm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 1+hm --tlsrec 10+ne --disorder 5+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -1+se --fake -6+hm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -4+se --split 2+s --disoob -5+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 0+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 5+nm --split 3+he --disoob -10+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 4+sm --disoob 4+sm --disoob 4+sm --drop-sack --mod-http r,h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 1+s --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 3+se --disoob 7+n --disorder -3+nm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 1+s --fake 6+nm --split 0+sm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake -6+n --fake-tls-mod o --fake -10+sm --fake-data :\xa2\xdf\xd0\xbb\x88\x54\x57\x0d\xc9\xf4\x0b\xda\x2a\xa9\xcc\x1a\x83\xab\x98\xbb\x46 --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec -8+s --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 9+n --disorder -7+ne --split -8+sm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder 9+nm --fake -3+n --tlsrec -8+he --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -5+he --disoob -3+sm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -7+n --mod-http h,d --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 5+h --disoob -7+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -7+ne --oob-data \x48 --oob -4+h --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -1+he --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -7+nm --fake -9+n --ttl 6 --disoob 1+h --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -1+sm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 4+hm --split -2+hm --disorder 8+n --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -8+h --tlsrec 4+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -6+he --oob-data \x48 --disoob -1+h --disoob 3+sm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake -6+ne --ttl 8 --oob 1+s --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec 5+h --tlsrec -4+se --tlsrec -2+h --mod-http d,r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 6+n --tlsrec 6+hm --fake 3+se --fake-data :\x5d\x13\xfe\xa3\xe7\xa2\x70\xfe\x9d\xf6\x7f\xc9\xc9\x2b\x35\x53\x28\x36\xa4\xc0\xa7\xcc\x5b\x6c\xad\x2d\xae\xad --fake-sni apple.com --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob -7+he --tlsrec 6+ne --oob 10+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 10+h --oob 0+h --oob-data \x48 --split -2+sm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob 1+he --oob-data \x48 --split 8+nm --oob -7+nm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 9+nm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -4+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 6+h --oob -10+hm --oob-data \x48 --mod-http h,d --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -4+he --disoob 8+nm --oob-data \x48 --fake -4+se --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 2+h --oob -6+n --disorder -3+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake 10+ne --ttl 5 --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 1+hm --tlsrec 8+h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder -6+se --fake 1+se --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake 9+h --split -7+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 9+n --oob-data \x48 --oob -6+se --disoob 10+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 0+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -9+se --fake-offset 7+n --fake-sni ozon.ru --mod-http h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 4+n --oob -8+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -1+nm --oob -10+n --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 7+h --fake-offset 7+hm --fake-tls-mod o --drop-sack --mod-http h,d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disorder -8+n --disoob -6+he --fake -7+ne --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -9+hm --split -2+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -7+h --disoob 4+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 4+ne --disorder -2+he --mod-http h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -1+he --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -1+nm --disorder 9+hm --disoob 2+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -2+h --disorder 1+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob 2+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 4+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 3+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob -10+n --split 5+he --tlsrec 0+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -1+sm --split -9+hm --oob -3+n --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 0+se --disoob 10+sm --mod-http h,d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 8+n --oob 8+hm --fake -2+hm --fake-offset 6+nm --drop-sack --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -5+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split -7+h --split -4+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 2+hm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 5+h --fake-sni ozon.ru --disorder -10+se --oob 3+ne --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -7+sm --oob 3+n --drop-sack --mod-http d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -10+s --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 1+hm --tlsrec 8+s --fake 4+hm --fake-tls-mod r --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -3+sm --oob 4+sm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split -8+s --disorder 6+h --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake -8+hm --split -10+hm --disorder 1+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 6+s --tlsrec -6+s --disoob 0+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -4+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -9+s --disoob -10+nm --disorder 3+ne --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -9+hm --disoob -7+he --oob-data \x48 --fake 10+sm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -7+he --disoob -2+ne --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 5+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split 4+sm --oob 10+nm --disoob 10+h --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 3+se --tlsrec 1+hm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake 8+s --fake-offset 3+ne --ttl 10 --fake-tls-mod o --disoob -10+s --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -3+nm --fake-sni ozon.ru --fake 10+h --disorder -9+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 5+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 10+se --disorder -3+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -2+ne --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 6+he --tlsrec -7+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 9+h --ttl 4 --tlsrec -3+sm --disoob 5+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split 9+nm --split 9+n --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake 3+ne --ttl 2 --mod-http d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 8+nm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake 7+h --fake-data :\xf5\x00\xe4\x4c\x4f\x76\x1d\x70\xa6\x6a\x52\xd9\x5d\x44\x8c\xcb\x68\xf1\xc3\xf8\x80\x95\xba\x13\x89 --oob -1+s --fake 3+he --fake-offset 3+h --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -2+se --ttl 8 --disoob -8+ne --mod-http h,d --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 9+hm --oob-data \x48 --disoob 10+h --drop-sack --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder -7+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 9+sm --fake-data :\x86\x26\xbf\xa2\x83\x7f\xf0\x30\xbb\x79\x88\x3c\xe2\x78\xa7\x6c\xd7\x9c\xc6\x8c\xaf\x06\xd0\x72\xe3\x13\x3e --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -5+se --fake-data :\x97\xc6\xce\x84\x1c\xe7\x58\x47\x02\x7b --fake-sni apple.com --fake 4+he --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -1+ne --disoob 2+hm --split 9+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -1+hm --fake 3+s --fake-data :\xb9\xf9\xf9\x0e\x3a\x13\x61\xce\x4c\x32\xe2\xf6\x2c\x95\xb9\x5e\xf9\xb1\x0d\xe1\x41\x19\x88\xf6\xd8\x96\x91\x26\x40\x01\x16\x37 --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -9+n --split -3+sm --disoob 3+ne --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -4+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -6+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 10+n --oob -4+se --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -10+hm --disoob 7+se --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob 9+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 2+h --disorder -10+ne --disoob 10+he --mod-http h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 3+n --fake-data :\xb6\x96\xcf\x15\x37\x45\x6b\xd8\x43\x58\xef\x58\x87\x25\x54\x05\x4c --disorder 10+se --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 10+he --fake 6+h --fake-data :\x12\x4d\xed\x01\x48\x48\xda --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 4+sm --split 2+ne --disorder -10+se --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -3+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 8+he --split -3+s --tlsrec -2+hm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 5+nm --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake 8+ne --ttl 7 --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 2+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob 1+se --tlsrec -7+he --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 10+nm --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 8+sm --disorder -4+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 5+he --tlsrec 6+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -3+h --disorder 8+hm --disoob 0+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -7+he --fake 3+se --ttl 12 --fake-sni ozon.ru --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder -3+nm --disoob -3+hm --fake -7+nm --fake-offset 4+s --ttl 8 --fake-data :\xd2\x6f\x44\x74\x49\x3c\xfe\x70\x3b\x67\xcc\x3a\x74\xbc\xe3\x30\x5d\xe7\x6a\x0d\x80\x26\x29\x94\x26 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -4+n --oob-data \x48 --oob 3+s --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 9+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 1+ne --disorder -1+se --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake 10+nm --fake-data :\xe1\xb1\x0a\xf9\xb9\x46\x5b\x67\x34\xd7\xf5\x58\x1c\xb8\xa0\xe3\xc1\xe1\xf8\xfc\x6c\x69\xf7\xa3\xe0\xe0 --tlsrec -2+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -8+ne --disorder 1+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -3+sm --disoob -4+he --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 2+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob -3+n --oob -7+se --oob-data \x48 --disoob 9+h --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -1+s --fake-offset 9+sm --fake-data :\x27\xda\xff\x68\x1e\x56\x64\x9f\x24\x41\x71\xb5\x11\xe7\xe7\xab\x11\x91\x42\x4d\x4a\x38\xdf\x2c --disorder 8+s --fake -4+sm --ttl 6 --fake-data :\x52 --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 0+se --mod-http h,d --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --split 7+n --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 3+he --oob -1+n --oob -2+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -8+ne --oob-data \x48 --tlsrec 3+hm --fake 6+hm --fake-data :\xcf\x5b\x97\x54\x8f\xf1\x54 --fake-tls-mod r --mod-http r,h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder -8+ne --mod-http h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 2+he --fake -8+sm --fake-sni ozon.ru --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -1+hm --oob 5+se --mod-http h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -1+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -3+nm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -6+n --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -8+h --disorder 7+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -10+n --disoob -10+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 2+se --mod-http d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split -1+he --split 8+h --mod-http r,h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake -1+hm --fake -9+s --ttl 11 --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -2+s --fake -3+hm --fake-offset -1+sm --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 7+nm --oob -5+he --oob-data \x48 --split -5+se --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 4+se --fake-sni apple.com --tlsrec -5+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 8+sm --disoob -9+h --disorder -3+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -7+se --oob 8+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 1+sm --fake 1+se --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -7+sm --tlsrec 1+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 5+h --disorder 5+ne --disoob 5+s --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake 1+se --fake-sni ozon.ru --split -5+nm --split 8+n --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 0+hm --fake -8+se --ttl 11 --tlsrec 6+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -2+n --fake-sni ozon.ru --split -4+h --disorder -10+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 10+n --disorder 8+ne --split 10+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 7+hm --oob 10+h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -2+ne --fake-offset -6+h --ttl 3 --fake-tls-mod o --disorder 2+h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -7+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -8+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 8+sm --tlsrec 5+hm --split -5+s --mod-http d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -4+nm --oob-data \x48 --tlsrec -5+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -3+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec -6+nm --disoob -8+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -6+hm --fake-data :\x47\x4c\xea\xfb\x38\x57\xb6\xb1\x71\x58 --oob 3+ne --oob -9+hm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 3+se --oob 3+sm --fake 3+se --fake-data :\xa0\x86\x26\x45\xb9\xf0\xaa\x93\xe8\x22\x95\x23\x43\xaa\x1f\xe4\xf3 --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -8+sm --disorder 9+n --fake 7+s --fake-sni apple.com --fake-tls-mod o --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -1+nm --fake-offset -5+se --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 1+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 2+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -3+nm --disorder -8+n --oob -10+sm --oob-data \x48 --mod-http d --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -1+sm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec -8+sm --tlsrec -1+s --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 3+ne --disorder -7+ne --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -5+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -10+n --oob 5+h --disorder -3+sm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake -7+s --fake-data :\x26\x8c\x40\x39\xa9\x00\xf8\x8a\x77 --disoob 2+sm --tlsrec 3+s --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob -10+h --split -3+hm --tlsrec -4+n --mod-http h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -9+ne --disorder 7+n --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -6+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -10+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -7+he --fake 8+s --oob 2+sm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split -3+n --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 4+s --fake -9+nm --disoob 8+nm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 10+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 7+he --disoob -6+nm --oob-data \x48 --tlsrec 5+se --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -4+ne --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -5+he --oob-data \x48 --split 1+hm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 7+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 9+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -4+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -6+ne --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -5+s --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake 9+ne --fake-tls-mod o --disorder -1+h --disoob 3+h --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 1+se --disorder -7+h --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -3+he --disoob 2+he --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 7+he --disorder 2+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 0+s --fake -6+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split 2+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 7+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 2+he --split -8+he --disorder -6+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake 9+n --fake-tls-mod o --split -8+sm --mod-http h,d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -9+se --fake -3+h --fake-offset 9+sm --ttl 6 --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -8+sm --tlsrec -10+hm --oob 1+he --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -7+nm --tlsrec -10+se --disorder -3+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -3+s --disorder -9+hm --tlsrec -3+ne --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 9+se --split -2+se --oob -4+ne --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 1+hm --split -2+sm --split 9+nm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 5+h --split -7+nm --split -4+he --mod-http h,d --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 10+s --disoob 4+s --oob-data \x48 --mod-http d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 3+h --fake -1+ne --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec 8+s --fake -9+s --fake 1+ne --fake-offset 6+s --ttl 2 --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake -1+n --fake-data :\x77\x9c\x86\x30\xaa\xe4\xe4\xc1\x48\x4b\x86\x47\x6c\x20\x9b\xea --fake -6+he --fake-data :\x31\x2f\x04\x65\x3e\x06\x12\x77\xb3\xc1\xd3\x2e\xd3\x85\x8e\x48\xe0\x8c\xb2\xb2\x63\xe2\xc3\x18\x1d\x22 --disorder 3+sm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 0+h --oob-data \x48 --disoob 1+ne --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split 6+ne --fake -6+he --fake-data :\x07\x27\x6c\x2a\x6b\x26\xbc\x69\x5d\x73\x9f\xb7\x6a\xa2\xd0\xf5\x6a\x5d\x9e\x8e\x8c\x0c\x4d\xbf\xa4\x56\x3d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -8+ne --oob 7+n --oob 6+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 8+se --oob-data \x48 --oob 1+he --oob-data \x48 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 1+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 9+h --oob-data \x48 --fake -4+h --fake-data :\x22\x89\x80\x71\xa5\x39\xc3\x30\x53\x3e\xbf\x65\xbe\xb7\x69\x5b\xa8\xf5\x20 --disoob -2+hm --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 5+h --split 2+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 6+ne --disoob 8+sm --mod-http d --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 3+ne --tlsrec 5+nm --disoob 4+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 4+sm --fake-sni ozon.ru --split -4+ne --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -7+s --disorder -10+s --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -1+hm --oob 3+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec -5+nm --tlsrec -10+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 8+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -7+s --tlsrec -8+ne --oob -1+s --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -8+hm --split 5+n --disoob 2+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 5+nm --tlsrec -3+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -8+ne --mod-http h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 0+s --oob 7+ne --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake 7+sm --fake-offset 5+h --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 1+se --tlsrec -10+n --disoob -10+sm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 1+s --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob 0+hm --fake 6+se --fake-offset 1+nm --fake-sni ozon.ru --tlsrec 0+s --mod-http d,r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -1+ne --split -7+hm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -2+h --oob -1+n --mod-http d --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -10+ne --disorder 1+hm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -8+h --fake -5+n --fake-tls-mod o --fake 3+sm --fake-tls-mod r --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -6+n --disoob -3+se --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake -7+se --disorder -3+nm --disoob -7+se --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 6+se --oob-data \x48 --fake -8+hm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob -8+n --disoob 1+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -5+h --fake-data :\x92\xc6\x0b\x8a\x9d\x1e\xf1\xb3\xac\xb5\x4a\xbb\x9f\x07\xb4\x6e --disorder -5+n --oob -3+se --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 6+hm --split 0+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 6+s --fake -7+s --fake-data :\x37\x1f\xec\x15\xb8\xd7\xc6\x13\x6a\x8e\x85\x3a\x8d\xc1\xca\xd5\x47\x1a\xa9\xf0\x18\xb0\x18 --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 0+h --disoob -8+hm --disoob -4+ne --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -9+n --tlsrec -4+h --split -2+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob 10+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder -6+h --oob -10+n --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 3+ne --oob-data \x48 --disoob -9+s --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -8+se --split -8+s --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake 4+hm --ttl 8 --fake-tls-mod o --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 5+hm --oob 5+hm --disorder -2+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -10+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -3+h --oob -3+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 10+nm --disorder 9+nm --split 3+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -7+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -2+ne --fake -7+se --oob 10+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob -2+n --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 4+nm --tlsrec -4+s --mod-http h --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 6+n --oob 7+se --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -3+h --disoob -8+hm --oob -4+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -8+he --disoob -10+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -8+se --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake -7+se --oob -8+se --disoob 4+h --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -9+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob 2+ne --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder 2+nm --fake 7+n --fake-offset -9+n --fake-sni ozon.ru --fake-tls-mod r --split 5+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 0+sm --tlsrec -3+h --oob 6+hm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake -7+s --fake-sni apple.com --disorder 0+he --tlsrec -6+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 8+ne --fake-tls-mod r --oob 1+se --oob-data \x48 --split 8+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -10+he --split 3+h --split 4+s --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 6+ne --split -7+s --disorder 8+se --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -3+hm --disorder -3+he --split 5+ne --drop-sack --mod-http d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 10+ne --oob 7+ne --disoob 6+h --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 0+hm --ttl 8 --fake -10+nm --fake-sni apple.com --fake-tls-mod r --disoob -1+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 2+n --split 10+ne --disorder -1+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 5+n --tlsrec -6+sm --disorder -5+he --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder -5+he --disorder 3+n --disorder -5+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 6+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -8+n --oob -9+he --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -1+s --disoob 8+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -3+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -8+h --mod-http d --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 2+ne --disoob -9+nm --disorder 6+ne --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake 10+h --fake-tls-mod o --oob -10+n --fake 4+sm --ttl 5 --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 10+he --tlsrec 1+hm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 7+se --disoob 9+n --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 7+he --disoob 8+hm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec -7+hm --disorder -5+n --disorder 1+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split -1+nm --split -8+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 10+ne --split -10+ne --fake 7+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disorder 9+h --tlsrec 7+n --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -4+hm --disorder -8+n --mod-http h,d --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --fake 8+h --fake-offset 0+se --fake 2+hm --fake -2+ne --fake-sni ozon.ru --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split -4+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -7+nm --disorder 1+nm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -7+h --oob -4+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -2+nm --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec 10+s --tlsrec 6+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob 10+s --oob-data \x48 --tlsrec 2+he --split -7+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec -5+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 6+h --split -10+ne --oob 1+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 8+n --fake -1+s --fake 4+s --fake-offset 2+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -7+n --disorder 9+nm --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split -7+he --fake -2+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 0+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -2+he --oob-data \x48 --disoob 9+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -10+sm --oob 7+se --disoob 0+se --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder -5+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 3+nm --fake -7+s --fake-data :\x7f\x97\xf0\xf3 --disoob -6+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split -5+se --tlsrec -1+h --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 2+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 4+he --tlsrec 10+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 9+nm --oob 3+nm --fake 5+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 8+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 10+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -3+he --oob 3+s --fake -3+sm --fake-data :\x5e\x0c\x70\x98\xe3\x96\x5e\x38\x03 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -4+se --disoob -6+s --tlsrec 6+n --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -2+ne --fake 6+hm --fake-tls-mod r --fake 7+nm --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -3+sm --oob-data \x48 --fake 7+hm --ttl 5 --tlsrec 3+sm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 4+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -2+ne --disorder -6+nm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 0+ne --split 0+se --tlsrec -5+h --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 0+n --tlsrec 8+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -7+se --fake-tls-mod o --oob -4+nm --oob-data \x48 --tlsrec 6+nm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob -8+hm --oob 7+hm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disoob -4+s --oob 3+ne --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob -1+he --oob-data \x48 --fake 10+se --drop-sack --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec -1+n --fake 0+s --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 3+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -1+hm --disoob 0+he --split 10+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 3+s --disorder 9+s --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec -5+se --disorder 7+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec 10+nm --fake -10+nm --fake-data :\x0a\x3c\x6c\xb2\x58\x2c\xde\x3c\xf5\xfc\x82\x72\xa9\xa5\xd6\xa0\xba\xa4\xbc --disoob -10+se --drop-sack --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -5+se --fake -9+hm --fake-offset -7+s --mod-http h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 6+hm --oob -1+ne --fake 0+ne --ttl 11 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 3+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 9+nm --disorder -8+h --disorder -8+ne --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 6+h --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -2+nm --disorder 3+h --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -6+ne --tlsrec -5+nm --disorder -9+he --mod-http h,d --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 2+nm --oob-data \x48 --tlsrec -4+he --split -1+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob -9+s --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split 0+sm --tlsrec 6+nm --disoob 3+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 4+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 5+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -5+n --split -2+s --oob -3+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 4+nm --mod-http d,r --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 5+hm --split 10+h --split 4+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 7+n --tlsrec 6+hm --tlsrec -2+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob -5+hm --oob 0+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -10+s --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 1+hm --fake 5+sm --ttl 10 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 8+hm --disoob -3+s --disoob -10+hm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder 10+s --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -10+nm --split -6+sm --disorder -5+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder -1+nm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -8+nm --fake -3+se --ttl 2 --tlsrec 9+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 8+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -10+sm --split 0+h --split 4+se --mod-http d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disoob 9+sm --tlsrec -1+ne --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec 9+s --split -1+h --split -5+ne --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 8+h --disorder 3+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -7+sm --oob-data \x48 --disoob 5+se --oob 10+s --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake -7+se --ttl 9 --disorder 9+sm --fake -8+ne --fake-data :\xa7\x51\xa8\xe5\x57\xc4\x04\x0c\x81\x3b\xc3\x6e --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -4+n --fake 1+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split 1+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 5+h --ttl 3 --fake-data :\xfc\x3e\x21\x4c\x3f\x80\xad\x6b\x0e\xcb\x8b\xfc\x57\xb6\xe5\xa5\xc5\x56\x82 --split -5+he --disoob -2+se --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -5+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 3+he --disoob 0+hm --split -8+nm --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --split -8+he --oob 0+ne --disoob 5+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 1+he --fake -2+h --ttl 6 --split -4+hm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --oob -5+n --disoob 0+s --disoob 9+nm --mod-http d,r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -5+he --fake 1+n --ttl 10 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 10+he --oob-data \x48 --oob -2+se --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -5+ne --split -2+n --fake 5+he --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 0+hm --disorder 5+hm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob -10+h --oob 0+se --tlsrec 2+ne --drop-sack --mod-http d --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 8+he --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake 8+h --tlsrec -3+s --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 3+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 8+he --oob -8+hm --split 8+n --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -3+sm --fake 4+se --fake-offset 9+se --fake-data :\x2c\x24\xbe\xab\x03\xb8\x4e --fake-sni ozon.ru --split -2+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec 6+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 3+he --drop-sack --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec -6+n --split -9+se --mod-http h,d --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob 1+nm --disoob -7+s --split -5+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -6+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 1+sm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --fake 6+se --fake-offset 4+sm --fake-tls-mod r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -9+sm --oob-data \x48 --tlsrec 10+h --disoob -5+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder 9+ne --drop-sack --mod-http h,d --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 9+nm --disoob -10+se --disorder -1+n --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake -9+ne --oob -8+n --oob-data \x48 --split -6+n --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob -1+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -8+ne --split 0+h --disorder 2+hm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -4+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -4+n --disorder -7+nm --mod-http d --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -5+sm --fake-data :\x6c\x4a\x86\xf8\x15\x3b\xed\x72\x28\xac --mod-http d --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob -5+sm --fake -9+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --oob 8+hm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split 6+he --disoob 10+h --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 8+ne --split 1+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --split 1+he --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder -4+sm --mod-http r,h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 6+s --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 10+ne --oob -8+sm --oob-data \x48 --tlsrec -2+se --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disorder 9+hm --oob 7+nm --fake 3+ne --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob -9+se --oob -2+hm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -4+n --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 3+hm --disorder 8+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec -8+se --disoob -10+se --disoob -1+ne --oob-data \x48 --mod-http d --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake 1+nm --fake-offset 7+hm --fake-data :\xd8\x9d\x2b\x03\xcf\x7d\x8e\x51\x40\x3d\x01\x0d\x61 --fake-sni apple.com --fake 3+s --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --disorder -1+nm --fake -9+he --fake-offset 2+hm --fake-data :\x96\x09 --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 4+nm --tlsrec -7+ne --tlsrec 5+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -2+nm --tlsrec -9+sm --oob -8+ne --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 7+h --oob-data \x48 --split -10+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --tlsrec 6+hm --tlsrec 4+hm --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --fake 2+nm --ttl 12 --fake-data :\xfb\xd0\xa2\x8b\x91\x0d\x50\x56\x39 --disoob 10+s --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --fake 5+n --ttl 11 --mod-http d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder -9+se --split -2+sm --oob 8+n --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec 4+se --oob 5+h --oob 4+n --oob-data \x48 --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -3+n --oob 7+hm --disorder -6+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -8+s --disorder 6+n --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --split 1+s --mod-http d,r --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder 7+nm --fake 6+s --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -9+sm --fake 2+n --fake-data :\xaf\x91\x38\x7f\x6b\xd2\xc2\x74\xf7\x0d\x87\x5c\x95\xe1 --fake 2+ne --fake-offset 1+se --fake-sni apple.com --fake-tls-mod r --mod-http d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -5+h --fake-tls-mod o --mod-http h,d --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob 2+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob 8+n --disorder -7+hm --tlsrec 3+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake 1+he --ttl 3 --disorder -6+s --tlsrec 9+nm --mod-http d --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --disorder -7+s --split 9+ne --fake 7+h --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 7+hm --fake 6+se --fake-data :\xf9\x17\xa8\x37\xcf\x32\x86\x4f\x2c\x29\x0f\x3d\x9e\x31\xc9 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec 4+he --disoob 10+he --fake 1+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disorder 3+hm --tlsrec -3+h --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 6+h --fake-offset -6+sm --ttl 9 --fake-sni ozon.ru --fake-tls-mod o --disorder -7+sm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob 3+n --disoob 8+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 2+hm --disorder -6+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 1+nm --split 0+he --mod-http r,h --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 3+ne --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -1+n --oob 3+ne --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -10+se --disorder -9+n --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -9+nm --fake -9+he --fake-offset 5+h --disorder -9+n --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --oob 0+s --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder -4+hm --split -10+nm --disorder -5+se --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -6+n --disoob 9+hm --disoob -5+n --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 7+he --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec 1+ne --disoob 0+se --fake 10+he --fake-offset -9+n --ttl 10 --fake-data :\x8c\x17\x33\x79\x6f\x83\x12\x06\xb2\x88\x06\xd2\xe1\xb7\x9c\x62\x18\xdc\xc1\x44\x1e\x3c\x94\x79 --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --tlsrec -10+s --disoob 10+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disoob 2+h --fake 6+hm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 1+sm --oob-data \x48 --split 2+n --oob -1+nm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -6+sm --tlsrec -9+n --tlsrec -3+hm --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --split -8+n --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -6+n --disoob 3+ne --disoob 10+sm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec -5+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -9+hm --disoob -7+n --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split 3+he --disoob 8+sm --mod-http h,d,r --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec -1+h --split 6+ne --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --split -9+he --oob -4+hm --split 2+n --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake -5+h --fake-offset -10+s --fake-data :\x43\x08\xd3\x1f\x07\x52\xdc\xa1\x3d\x27\x70\xcd\x73\xe0\x0d\xc8\xe5\xb2\xe5\xfa\x0d\xac\x19 --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -4+s --tlsrec -9+se --disoob -7+ne --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split -6+hm --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob -6+s --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split 10+n --split 1+ne --split -2+n --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 2+se --oob -8+he --disoob 8+s --mod-http d,r --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -3+s --fake-offset 10+se --disorder -10+he --fake 3+he --fake-offset 9+h --fake-data :\x0d\x1d\xc8\xe0\x1f\x5c\xb9\xfd\x83\x2f\x1e --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 0+h --oob-data \x48 --disoob -6+s --fake -2+he --fake-offset 4+he --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --tlsrec 4+h --oob -10+he --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 7+se --disoob 4+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --split 7+sm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 1+se --split -7+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 9+n --split 2+he --tlsrec -10+se --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake -7+h --ttl 11 --fake-data :\x74\x15\x5c\x97\xf3\xe6\xb4\x17\x91\x2b\xfe\x8e\x1a\xeb\xc3\xf6\x4c\xd3\xdc\x83\x52\x42\xeb\xa1\x1d\x0f\x81\xb3\x2c\x27\xee\x8a --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 1+se --oob 1+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disorder -7+se --disoob 4+s --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split -2+s --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -7+ne --split 4+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec -10+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disoob 8+n --mod-http r,h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -10+nm --disoob -6+s --oob-data \x48 --drop-sack --mod-http h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob 0+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake 5+n --ttl 4 --split -4+nm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 5+nm --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 4+h --oob-data \x48 --disorder 8+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --tlsrec -7+nm --fake -1+h --fake-tls-mod r --mod-http r,h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --oob 3+s --mod-http d --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 3+nm --split 1+hm --tlsrec -9+hm --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --oob -9+he --disorder -2+s --mod-http r,h --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --oob 0+sm --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob -5+nm --tlsrec -6+sm --tlsrec 4+nm --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --disorder -3+h --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 4+n --drop-sack --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --split -2+nm --disorder 9+se --oob 10+he --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disoob -7+s --fake -4+hm --fake-offset 7+he --fake-data :\x39\x0d\x15\x4b\x19\xbc\xd8\x95\x64\x76\xab\x45\x48\x1e\x68\xff\x9b\xa1\x9e --fake-tls-mod o --oob 8+sm --mod-http h,d --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --tlsrec -4+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split -1+hm --fake -8+he --fake-offset -3+h --fake-data :\xd8\xa4\xfb\x2b\xdd\x70\xa3\xac\x8f\x7c\xec\x7a\x1c\x3c\xdf\xcd\x16\x5a\x31\xc5\x16\x37\x69\xe2\x81\xcb --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -10+ne --disorder 7+h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --split -5+hm --fake 2+h --ttl 8 --disoob 8+ne --oob-data \x48 --mod-http d,r --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --split 2+se --mod-http d --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --tlsrec 9+ne --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --tlsrec -4+se --drop-sack --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --disorder -3+s --disorder 4+he --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --disorder 1+he --disorder -3+ne --oob 7+ne --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 0+hm --tlsrec 3+nm --mod-http d --auto none",
        @"--proto udp --udp-fake 1 --auto none --proto tls,http --tlsrec 5+hm --disorder 10+s --disorder 4+n --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 5+n --oob-data \x48 --disorder -3+he --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake 0+sm --disoob 0+ne --oob-data \x48 --oob 9+nm --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --oob -7+hm --fake -6+hm --ttl 3 --fake-data :\x07\x62\xd6\x6a\xca\x57\x4d\xbf\xa7\x0f\x28\xdb --fake -2+nm --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob 10+he --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --fake 0+hm --fake-data :\x89\xad --disorder -3+ne --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --fake -2+s --fake-sni apple.com --fake-tls-mod o --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob -9+he --mod-http d --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --oob -10+s --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 3+h --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --fake -4+nm --fake 4+sm --tlsrec -2+se --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake -4+se --fake-data :\x3d\x97\x4a\x9f\x02\xb2\xf5\xed\x37\x1d\x12\x09\x7f\x3e\xd7\xd2\x49\x9a --fake-sni ozon.ru --fake-tls-mod r --drop-sack --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disorder 8+he --disoob 3+se --disoob -1+h --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disoob 5+sm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 1+hm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --oob 9+he --tlsrec 0+nm --oob 2+se --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake 9+sm --fake-data :\x2b\x20\x23\x5f\x76\x01\x70\x10\xf4\xcf\xbb\xe6\x96 --disorder 2+ne --disoob -5+se --mod-http d,r --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --fake 2+s --fake-tls-mod r --split -2+se --fake 6+ne --fake-sni apple.com --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disorder 1+h --tlsrec 3+he --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -6+hm --tlsrec 8+nm --mod-http h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --disoob 7+se --mod-http h --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob -10+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob -8+se --fake 8+s --fake-sni apple.com --disorder -5+sm --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --fake -8+s --disoob 0+he --split 2+sm --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --disoob 9+hm --oob-data \x48 --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --disoob 8+se --auto none",
        @"--proto udp --udp-fake 5 --auto none --proto tls,http --tlsrec -6+nm --auto none",
        @"--proto udp --udp-fake 9 --auto none --proto tls,http --tlsrec 3+s --split 5+nm --oob -3+ne --mod-http h,d --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --oob 6+hm --oob-data \x48 --fake 1+n --fake-sni ozon.ru --fake 6+hm --fake-data :\x8e\x3b\xe2\x2e\xd2\xbb\xfc\xd5\x9c\x25\xf2\x65\xb2\x63\x6d\x80\x48\x8f\x59\x00\x5a\x71\x5e\x9c\x90\xa7 --fake-tls-mod o --drop-sack --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --tlsrec 7+nm --drop-sack --mod-http d,r --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob 9+h --auto none",
        @"--proto udp --udp-fake 8 --auto none --proto tls,http --fake -10+n --ttl 6 --fake-sni ozon.ru --fake 10+hm --fake-data :\x15\x3e --auto none",
        @"--proto udp --udp-fake 12 --auto none --proto tls,http --disorder 2+se --fake 3+hm --ttl 10 --fake-data :\xbb\xb2\x65\x29\x81\x2f\x2c\x40\x52\x21\xbf\x35\x03\x81\x90\x5a\xd7\xe9\xed\xfd\x4e\x2d\x49\x2c\x46\xaa\x2f\x63\x0d\x8a\x4d --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --fake -2+nm --fake-offset 4+n --ttl 8 --disorder -1+ne --oob -6+n --mod-http r,h --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disorder 7+se --disorder 9+he --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --disoob 6+se --split -6+h --disoob 1+se --drop-sack --auto none",
        @"--proto udp --udp-fake 10 --auto none --proto tls,http --split 5+s --auto none",
        @"--proto udp --udp-fake 7 --auto none --proto tls,http --tlsrec -5+s --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --split 1+hm --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob -9+h --auto none",
        @"--proto udp --udp-fake 6 --auto none --proto tls,http --oob -7+se --auto none",
        @"--proto udp --udp-fake 4 --auto none --proto tls,http --disoob 0+sm --drop-sack --auto none",
        @"--proto udp --udp-fake 2 --auto none --proto tls,http --disoob 8+se --oob-data \x48 --drop-sack --auto none",
        @"--proto udp --udp-fake 11 --auto none --proto tls,http --oob -6+n --auto none",
        @"--proto udp --udp-fake 3 --auto none --proto tls,http --fake 9+he --tlsrec -8+nm --auto none",
    };

    private string[] GetCandidateStrategies() =>
        _settings.Current.ByeDpiUseExtendedCandidates
            ? ShortCandidateStrategies.Concat(ExtendedCandidateStrategies).ToArray()
            : ShortCandidateStrategies;

    // Hafif bir API endpoint'i yerine gerçekten webview'in yükleyeceği belgeyi (discord.com/app)
    // test ediyoruz: bazı ISP'lerde küçük/tek istekler DPI'yi atlatabilirken tam sayfa yüklemesi
    // hâlâ engellenebiliyor (gözlemlendi: /api/v9/gateway geçti ama gerçek sayfa ERR_SOCKS_
    // CONNECTION_FAILED/ERR_CERTIFICATE_INVALID/ERR_CONNECTION_CLOSED ile başarısız oldu).
    private const string ConnectivityProbeUrl = "https://discord.com/app";

    // İlk açılışta kayıtlı ayarın tek bir geçici aksaklık yüzünden boşa harcanmaması
    // için: aday taramasına düşmeden önce kaç kez GERÇEKTEN (spawn + test) denenir.
    private const int SavedArgsRetryAttempts = 3;

    private readonly SettingsStore _settings;
    private readonly ILogger<ByeDpiEngine> _logger;
    private readonly LogRingBuffer _logs = new(200);
    private Process? _process;
    private int _port;
    private bool _lastProbeFailed;

    public string Id => "byedpi";
    public string DisplayName => "ByeDPI";
    public bool RequiresSystemWideAccess => false;

    public ByeDpiEngine(SettingsStore settings, ILogger<ByeDpiEngine> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false }) return;

        _lastProbeFailed = false;

        var rejected = _settings.Current.ByeDpiRejectedArgs;

        // Kayıtlı bir ayar varsa (doğrulanmış olsun ya da olmasın — doğrulama ör.
        // webview'de gerçek bir hata bildirilip ReportRealWorldFailureAsync çağrıldığında
        // sıfırlanmış olabilir ama ayar hâlâ kayıtlı kalır), aday taramasına hiç
        // düşmeden önce onu GERÇEKTEN doğrulayarak (spawn + port + bağlantı testi) art
        // arda SavedArgsRetryAttempts kez dener — tek seferlik bir ağ/sürücü aksaklığı
        // yüzünden hâlâ çalışan bir ayarın boşa (gereksiz bir yeniden taramaya
        // düşülerek) harcanmaması için. Kullanıcı bu ayarı AÇIKÇA yasakladıysa
        // (Argüman Setini Yasakla) hiç denemiyoruz.
        _settings.Current.EngineArgs.TryGetValue(Id, out var savedArgs);
        if (!string.IsNullOrWhiteSpace(savedArgs) && !rejected.Contains(savedArgs))
        {
            for (var attempt = 1; attempt <= SavedArgsRetryAttempts; attempt++)
            {
                _logger.LogInformation("ByeDPI kayıtlı ayar ile başlatılıyor (deneme {Attempt}/{Max}): {Args}", attempt, SavedArgsRetryAttempts, savedArgs);
                _logs.Add($"Kayıtlı ayar deneniyor ({attempt}/{SavedArgsRetryAttempts}): {savedArgs}");
                await SpawnAsync(savedArgs, ct);
                var reachable = await WaitForPortAsync(_port, TimeSpan.FromSeconds(3))
                    && await TestConnectivityAsync(TimeSpan.FromSeconds(12));

                if (reachable)
                {
                    _logger.LogInformation("ByeDPI kayıtlı ayarı çalışıyor: {Args}", savedArgs);
                    _logs.Add("Kayıtlı ayar çalışıyor.");
                    _settings.Current.EngineArgs[Id] = savedArgs;
                    _settings.Current.ByeDpiVerified = true;
                    _settings.Save();
                    return;
                }

                _logger.LogWarning("ByeDPI kayıtlı ayarı bu denemede Discord'a erişemedi (deneme {Attempt}/{Max}): {Args}", attempt, SavedArgsRetryAttempts, savedArgs);
                _logs.Add($"Kayıtlı ayar bu denemede başarısız oldu ({attempt}/{SavedArgsRetryAttempts}).");
                await StopAsync(ct);
            }
            _logger.LogWarning("ByeDPI kayıtlı ayarı {Max} denemenin tamamında başarısız oldu, aday taramasına geçiliyor: {Args}", SavedArgsRetryAttempts, savedArgs);
            _logs.Add("Kayıtlı ayar üç denemede de başarısız oldu, aday taramasına geçiliyor.");
        }

        var candidateStrategies = GetCandidateStrategies();
        foreach (var candidate in candidateStrategies)
        {
            if (candidate == savedArgs) continue; // az önce yukarıda 3 kez denendi
            if (rejected.Contains(candidate))
            {
                _logger.LogInformation("ByeDPI stratejisi atlanıyor (gerçek sayfa yüklemesinde daha önce başarısız oldu): {Args}", candidate);
                continue;
            }

            ct.ThrowIfCancellationRequested();
            _logger.LogInformation("ByeDPI stratejisi deneniyor: {Args}", candidate);
            _logs.Add($"Deneniyor: {candidate}");
            await SpawnAsync(candidate, ct);

            // DoH sağlayıcı listesi 5'e çıkarıldı (DohForwarder her birine ~1.5 sn veriyor,
            // en kötü durumda ~7.5 sn) — bu süre dolmadan bağlantı testi zaman aşımına
            // uğrarsa, çalışabilecek bir sağlayıcıya hiç sıra gelmeden aday haksız yere
            // "başarısız" işaretlenirdi.
            var reachable = await WaitForPortAsync(_port, TimeSpan.FromSeconds(3))
                && await TestConnectivityAsync(TimeSpan.FromSeconds(12));

            if (reachable)
            {
                _logger.LogInformation("ByeDPI stratejisi çalışıyor, kaydediliyor: {Args}", candidate);
                _logs.Add("Bu strateji çalışıyor, kaydedildi.");
                _settings.Current.EngineArgs[Id] = candidate;
                _settings.Current.ByeDpiVerified = true;
                _settings.Save();
                return;
            }

            _logger.LogWarning("ByeDPI stratejisi Discord'a erişemedi: {Args}", candidate);
            _logs.Add("Bu strateji Discord'a erişemedi.");
            await StopAsync(ct);
        }

        _logger.LogError("Denenen hiçbir ByeDPI stratejisi Discord'a erişemedi ({Count} strateji)", candidateStrategies.Length);
        _logs.Add("Denenen hiçbir strateji Discord'a erişemedi.");
        _lastProbeFailed = true;
        // DpiEngineManager bunu yakalayıp otomatik olarak GoodbyeDPI'nin kendi aday
        // listesine geçiyor (bkz. DpiEngineManager.SwitchToAsync).
        throw new AllCandidatesFailedException(Id);
    }

    public async Task StopAsync(CancellationToken ct)
    {
        if (_process is { HasExited: false } process)
        {
            try
            {
                process.Kill(entireProcessTree: true);
                // Motorlar arası geçişte bir sonraki motor başlamadan önce bu sürecin
                // (ve tuttuğu portun/sürücü tanıtıcısının) GERÇEKTEN kapandığından emin
                // olmak için kısa bir süre bekliyoruz — Kill() OS seviyesinde asenkron,
                // hemen dönmesi sürecin fiilen sonlandığı anlamına gelmiyor.
                await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { /* süreç zaten sonlanmış olabilir veya bekleme zaman aşımına uğradı */ }
        }
        _process = null;
    }

    public EngineStatus GetStatus()
    {
        var running = _process is { HasExited: false };
        string detail;
        if (running) detail = "Aktif (yalnızca bu uygulama)";
        else if (_lastProbeFailed) detail = "Denenen hiçbir strateji Discord'a erişemedi";
        else detail = "Durduruldu";

        return new EngineStatus(
            Id, DisplayName, running, RequiresSystemWideAccess,
            running ? $"socks5://127.0.0.1:{_port}" : null,
            detail);
    }

    public IReadOnlyList<string> GetRecentLogs() => _logs.Snapshot();

    public int? GetOwnProcessId() => _process is { HasExited: false } ? _process.Id : null;

    /// <summary>Electron client, "doğrulanmış" sayılan stratejiyle bile gerçek discord.com/app
    /// sayfası yüklenemediğini bildirdiğinde çağrılır (webview'in did-fail-load'ı, ana çerçeve
    /// için). Bu argümanı kalıcı olarak reddedilenler listesine ekler ki bir daha aynı hatalı
    /// sonuca düşülmesin, ve motoru durdurur — DpiEngineManager çağıran tarafından yeniden
    /// başlatılıp listede kalan bir sonraki adaya geçilmesi beklenir.</summary>
    public async Task ReportRealWorldFailureAsync()
    {
        var badArgs = _settings.Current.EngineArgs.GetValueOrDefault(Id, "");
        if (!string.IsNullOrEmpty(badArgs) && !_settings.Current.ByeDpiRejectedArgs.Contains(badArgs))
        {
            _logger.LogWarning("ByeDPI stratejisi gerçek sayfa yüklemesinde başarısız oldu, reddedilenlere ekleniyor: {Args}", badArgs);
            _settings.Current.ByeDpiRejectedArgs.Add(badArgs);
        }
        _settings.Current.ByeDpiVerified = false;
        _settings.Save();
        await StopAsync(CancellationToken.None);
    }

    /// <summary>ciadpi.exe'yi verilen argümanlarla başlatır. _process alanı yalnızca
    /// Process.Start() başarılı olursa atanır (aksi halde "başlatılmamış ama null olmayan"
    /// bir nesne kalır ve sonraki her HasExited kontrolü InvalidOperationException fırlatır).</summary>
    private async Task SpawnAsync(string args, CancellationToken ct)
    {
        var exePath = BinaryLocator.Resolve("byedpi", "ciadpi.exe");
        _port = GetFreeTcpPort();

        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add(_port.ToString());
        // ciadpi varsayılan olarak tamamen sessizdir (params.debug=0, LOG() hiçbir şey
        // basmaz); Ayarlar ekranındaki log görüntüleyicinin bir işe yaraması için seviye 1
        // (bağlantı/resolve/desync özeti — seviye 2'nin paket bazlı ayrıntısı kadar gürültülü
        // değil) log çıktısını her zaman açıyoruz. ciadpi bunu stderr'e yazıyor, zaten
        // ErrorDataReceived ile yakalıyoruz.
        psi.ArgumentList.Add("-x");
        psi.ArgumentList.Add("1");
        foreach (var arg in SplitArgs(args)) psi.ArgumentList.Add(arg);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logs.Add(e.Data); };
        process.Exited += (_, _) => _logger.LogWarning("ByeDPI (ciadpi.exe) beklenmedik şekilde durdu");

        try
        {
            process.Start();
        }
        catch
        {
            process.Dispose();
            throw;
        }

        _process = process;
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _logger.LogInformation("ByeDPI başlatıldı, port {Port}, args: {Args}", _port, args);

        // ciadpi'nin SOCKS portunu dinlemeye başlaması için WaitForPortAsync zaten bekliyor,
        // ama Exited event'inin (anında çöken kötü argümanlar için) işlenmesine de kısa bir
        // pay bırakalım.
        await Task.Delay(50, ct);
    }

    /// <summary>ciadpi'nin bu instance için açtığı SOCKS5 proxy üzerinden gerçekten
    /// discord.com'a ulaşılabiliyor mu diye HTTP isteğiyle test eder. Herhangi bir HTTP
    /// yanıtı (hata durum kodu dahil) "erişilebilir" sayılır — bizi ilgilendiren DPI'nin
    /// bağlantıyı koparıp koparmadığı, Discord'un tam olarak ne döndürdüğü değil.</summary>
    private async Task<bool> TestConnectivityAsync(TimeSpan timeout)
    {
        try
        {
            using var handler = new HttpClientHandler
            {
                Proxy = new WebProxy(new Uri($"socks5://127.0.0.1:{_port}")),
                UseProxy = true,
            };
            using var client = new HttpClient(handler) { Timeout = timeout };
            using var response = await client.GetAsync(ConnectivityProbeUrl);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ByeDPI bağlantı testi hatası: {Error}", ex.Message);
            _logs.Add($"Bağlantı testi hatası: {ex.Message}");
            return false;
        }
    }

    private static IEnumerable<string> SplitArgs(string args) =>
        args.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static int GetFreeTcpPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task<bool> WaitForPortAsync(int port, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var probe = new TcpClient();
                var connectTask = probe.ConnectAsync(IPAddress.Loopback, port);
                var completed = await Task.WhenAny(connectTask, Task.Delay(200));
                if (completed == connectTask && probe.Connected) return true;
            }
            catch
            {
                // henüz dinlemiyor, tekrar dene
            }
            await Task.Delay(100);
        }
        return false;
    }
}
