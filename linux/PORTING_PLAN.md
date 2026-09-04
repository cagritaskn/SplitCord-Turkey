# SplitCord-Turkey Linux Portu — İlerleme ve Karar Takip Dosyası

## 1. Amaç

Bu dosya, SplitCord-Turkey'nin Linux portu için **tek doğruluk kaynağıdır**. Bu iş tek oturumda
bitmeyecek kadar büyük — birden çok, birbirinden bağımsız Claude Code oturumunda ilerleyecek ve her
yeni oturum önceki oturumların konuşma geçmişine erişemeyecek.

**Kural: `linux/` altında herhangi bir dosyaya dokunmadan önce bu dosyanın TAMAMINI oku.** Özellikle
"§6 Şu anki durum / nereden devam edilir" ve "§4 Karar günlüğü" bölümlerini — kararları yeniden
tartışmaya açma, zaten karar verilmiş.

Bu dosyaya dokunan HER oturum, bitmeden önce en az §3 (Faz kontrol listesi) ve §6'yı güncellemeli —
oturum yarıda kesilse bile.

## 2. Değişmez kurallar

1. **Yeni bir `linux/` üst klasörü** kullanılıyor. Mevcut `service/`, `client/`, `vendor/`,
   `resources/`, `scripts/` altındaki (repo kökünde, `linux/` DIŞINDAKİ) HİÇBİR dosyaya
   dokunulmuyor — ekleme dahil. Windows build'i bu portun hiçbir aşamasında bozulmamalı/etkilenmemeli.
2. **Tam bağımsız kopya**: `linux/` kendi başına duran, Windows tarafıyla dosya paylaşmayan bir port.
   Bu, kullanıcının bilinçli tercihiydi (2026-09-04) — bakım tekrarı riskini kabul ediyor, karşılığında
   Windows build'inin asla bozulmayacağından emin olmak istiyor. Ortak bir "çekirdek" paylaşım
   mimarisine (proje referansı, linked files) GEÇİLMEYECEK, bu konu tekrar açılmayacak.
3. Tek repodan hem Windows (mevcut NSIS hattı, değişmeden) hem Linux (`linux/` altındaki yeni hat)
   release edilecek.
4. **GoodbyeDPI motoru Linux'ta YOK.** WinDivert/NDIS'e özgü, gerçek bir Linux karşılığı yok; Zapret'in
   nfqws'i (NFQUEUE üzerinden) aynı teknik alanı zaten kapsıyor. Linux'ta motor sırası: **Zapret →
   Zapret2 → ByeDPI** (3 motor, Windows'taki 4 değil).
5. **Canlı Linux testi kullanıcı tarafında, henüz yok.** Kullanıcının şu an eline hazır bir Linux
   ortamı yok; ileride sistemine ikinci bir boot olarak Linux kurup Claude Code'u ORADAN çalıştırıp
   canlı test yapacak (2026-09-04 kararı). Bu yüzden: kod, dokümantasyona/upstream projelerin kendi
   Linux talimatlarına dayanarak **teorik olarak doğru** yazılıyor; gerçek bir Linux çekirdeğinde HİÇ
   test edilmedi. Her dosyanın başına, doğrulanmamış varsayım içeriyorsa açık bir not eklenmeli (bkz.
   §5 Risk kaydı ve §6). Canlı doğrulama, kullanıcı kendi Linux ortamını kurunca ayrı bir oturumda
   yapılacak — o oturum bu dosyanın §6'sından devam edecek.

## 3. Faz kontrol listesi

| Faz | Açıklama | Durum | Oturum |
|---|---|---|---|
| 0 | İskelet + bu takip dosyası | **bitti** | 1 |
| 1 | Dev/test ortamı canlı doğrulaması (WSL2/VM NFQUEUE+systemd) | **ertelendi** (kullanıcı henüz Linux ortamı kurmadı) | 0 |
| 2 | Servis iskeleti: Kestrel API + SettingsStore + DNS forwarder (motor yok) | **bitti** (kod yazıldı + `dotnet build` başarılı; canlı çalıştırma DOĞRULANMADI) | 1 |
| 3 | ByeDPI motoru | **bitti** (kod yazıldı + derlendi; `linux/scripts/build-byedpi.sh` ile gerçek Linux derlemesi ve canlı test DOĞRULANMADI) | 1 |
| 4 | Zapret motoru (nfqws + NFQUEUE) | **bitti** (kod yazıldı + derlendi; nfqws binary fetch script'i henüz yok — bkz. §6; NFQUEUE/iptables mantığı canlı DOĞRULANMADI) | 1 |
| 5 | Zapret2 motoru (nfqws2 + native bash) | **büyük ölçüde bitti** (kod yazıldı + derlendi; birden çok DOĞRULANMADI notu var, bkz. §6 — blockcheck2'nin native çıktı formatı en büyük açık soru) | 1 |
| 6 | systemd paketleme + install/uninstall script'leri | başlanmadı | 0 |
| 7 | Electron istemci portu | başlanmadı | 0 |
| 8 | Paketleme & release hattı | başlanmadı | 0 |
| 9 | (opsiyonel) İyileştirmeler | başlanmadı | 0 |

## 4. Karar günlüğü (append-only — asla silinmez/değiştirilmez, yalnızca yeni madde eklenir)

- **D-1** (2026-09-04, Faz 0): Tam bağımsız kopya, Windows ile dosya paylaşımı yok. Alternatif
  (proje referansı/linked files ile paylaşılan çekirdek) kullanıcıya sunuldu, açıkça reddedildi.
- **D-2** (2026-09-04, Faz 0): GoodbyeDPI Linux'ta yok; motor sırası Zapret → Zapret2 → ByeDPI.
  Gerekçe: WinDivert/NDIS'e özgü, gerçek Linux portu yok; nfqws aynı teknik alanı kapsıyor.
- **D-3** (Faz 2'de kesinleştirilecek): `SettingsStore` yolu Linux'ta önerilen `/var/lib/splitcord/`
  (systemd-yönetimli, capability/root sahipli deployment modeliyle uyumlu). WSL2 dev-mode için
  `~/.local/share/splitcord` gibi bir env-var override gerekebilir — henüz kesinleşmedi.
- **D-4** (2026-09-04, Faz 0): ByeDPI kaynağı `vendor/byedpi-src/`'den BİREBİR kopyalanacak (Windows'ta
  zaten doğrulanmış SplitCord DoH yaması dahil), hufrea/byedpi'den yeniden vendor edilmeyecek.
- **D-5** (Faz 4'te kesinleştirilecek): NFQUEUE kural yönetimi — motor sınıflarından inline `iptables`
  çağrıları (mevcut mimariyle tutarlı, ön-eğilim bu) vs ayrı `setup-nftables.sh` script'i.
- **D-6** (Faz 6'da kesinleştirilecek): systemd birimi özel düşük yetkili kullanıcı + ambient
  capability (Faz 1 doğrularsa ön-eğilim bu) vs tam root.
- **D-7** (Faz 7'de kesinleştirilecek): uygulama-içi uninstall — `pkexec` tabanlı script vs bu
  özelliği tamamen düşürüp paket yöneticisine bırakmak.
- **D-8** (2026-09-04, Faz 0): Faz 1'in canlı doğrulaması ertelendi; Faz 2 ve sonrası, canlı test
  BEKLENMEDEN teorik/dokümantasyon-tabanlı olarak yazılacak. Her dosyaya doğrulanmamış varsayımlar
  açıkça not düşülecek. Bkz. §2 madde 5.
- **D-9** (2026-09-04, Faz 2): `SystemControlsHelper`/`FirewallHelper`'ın (Kaspersky/ESET-WinDivert
  çakışma tespiti, PowerShell NetSecurity tabanlı güvenlik duvarı izni) Linux karşılığı YOK —
  `/system-controls/*` ve `/firewall/*` uç noktaları `LocalApiEndpoints.cs`'e hiç eklenmedi. Faz 7'de
  Electron istemcisi bu iki uç nokta grubunu HİÇ çağırmayacak şekilde uyarlanmalı.
- **D-10** (2026-09-04, Faz 4): NFQUEUE kural yönetimi D-5'te "inline iptables çağrıları" olarak
  KESİNLEŞTİ (ZapretEngine.cs/Zapret2Engine.cs'de uygulandı) — ayrı bir `setup-nftables.sh`
  script'i YAZILMADI. Kuyruk numaraları: Zapret ana motor=100, Zapret'in ByeDPI-eşlik UDP
  süreci=101, Zapret2=102 (üçü de birbirinden farklı, escalation sırasında çakışma olmasın diye).
  `--queue-bypass` bilinçli tercih edildi: nfqws/nfqws2 çökerse/başlamazsa paketler DÜŞÜRÜLMEK
  yerine normal geçsin (internet'i tamamen kesen bir başarısızlık modundan kaçınmak için).
- **D-11** (2026-09-04, Faz 5): `Zapret2Engine.RunBlockcheck2Async`'in blockcheck2.sh'nin native
  Linux sürümünün KENDİ iç test döngüsü için KENDİ iptables/NFQUEUE kuralını yönettiği VARSAYILDI
  — bu metot kendi başına hiçbir iptables kuralı kurmuyor. DOĞRULANMADI, canlı testte ilk
  kontrol edilecek noktalardan biri (yanlışsa RunBlockcheck2Async'e de ZapretEngine'deki gibi bir
  NFQUEUE kurulumu eklenmesi gerekir).

## 5. Risk kaydı

| ID | Risk | Önem | Durum | Not |
|---|---|---|---|---|
| R-1 | WSL2/hedef Linux ortamında NFQUEUE modülleri (nfnetlink_queue, xt_NFQUEUE) çalışmayabilir | YÜKSEK | açık | Faz 4-5'i gerçek VM/cloud'a itebilir; canlı test başlayınca ilk kontrol edilecek şey |
| R-4.1 | bol-van/zapret hazır Linux binary yayınlıyor mu, yoksa kaynaktan mı derlenmeli | ORTA | açık | Faz 4 başlamadan (GitHub releases sayfası) kontrol edilmeli |
| R-4.2 | iptables/nftables uyumluluğu (modern dağıtımlarda `iptables-nft` shim'i genelde sorunsuz ama doğrulanmadı) | ORTA | açık | Canlı testte doğrulanacak |
| R-4.3 | `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW` yeterli mi, yoksa root mu şart | YÜKSEK | açık | R-1'in devamı; Faz 6'daki D-6 kararını doğrudan etkiler |
| R-5 | blockcheck2.sh'nin native bash çıktısı, Cygwin bash'te doğrulanmış regex'lerle (WorkingStrategyRegex vb.) birebir eşleşmeyebilir | DÜŞÜK-ORTA | açık | Faz 5'te canlı test gerekli |
| R-6 | blockcheck2.sh'nin native Linux çıktısında "daemon" adının GERÇEKTEN "nfqws2" olduğu ve `--wf-tcp-out=` yerine port bilgisi hiç içermeyen bir format kullandığı VARSAYILDI (CandidateLineRegex/WfTcpOutRegex, bkz. D-11 ve Zapret2Engine.cs'teki notlar) | ORTA | açık | Faz 5 canlı testinde İLK kontrol edilecek şey — yanlışsa regex'ler ve BuildConnectivityProbeUrl güncellenmeli |
| R-7 | `linux/resources/bin/zapret/bin/nfqws` ve `linux/resources/bin/zapret2/blockcheck2/nfq2/nfqws2` yollarının GERÇEK bol-van/zapret ve zapret2 Linux paketlerinin dizin yapısıyla eşleştiği VARSAYILDI — hiçbir fetch script'i henüz bu paketleri indirmiyor (bkz. §6) | ORTA | açık | `linux/scripts/fetch-binaries.js` yazılırken (henüz yazılmadı) kesinleşecek |

## 6. Şu anki durum / nereden devam edilir

**Aktif faz:** 5 büyük ölçüde bitti. Faz 6'ya (systemd paketleme) geçilebilir, ya da Faz 5'in
eksiklerinden biri (fetch-binaries.js) önce tamamlanabilir — ikisi de sırada, kesin öncelik yok.

**Bu oturumda tamamlanan (Faz 0, 2, 3, 4, 5):**
- `linux/` klasör iskeleti + bu takip dosyası + `README.md` + `.gitignore` (Faz 0).
- `linux/service/SplitCordServiceLinux/` — TAM bir .NET 8 projesi: `.csproj` (net8.0, linux-x64,
  SelfContained, `Microsoft.Extensions.Hosting.Systemd`), `Program.cs` (`.UseSystemd()`, motor sırası
  Zapret→Zapret2→ByeDPI), `Config/{LinuxPaths,SettingsStore}.cs`, `DiagnosticLog.cs`,
  `Dns/**` (EncryptedDnsForwarder + tüm proxy process sınıfları + Upstreams/**, hepsi Windows'un
  birebir portu), `LocalApi/{LocalApiConstants,LocalApiEndpoints}.cs` (firewall/system-controls uç
  noktaları BİLEREK YOK, bkz. D-9), `DpiEngineManager.cs` (GoodbyeDPI/antivirus-tespiti çıkarıldı,
  bkz. D-2/D-9), `Engines/{IDpiEngine,EngineStatus,LogRingBuffer,AllCandidatesFailedException,
  BinaryLocator,ByeDpiEngine,ZapretEngine,Zapret2Engine}.cs`.
- `linux/vendor/byedpi-src/` — `vendor/byedpi-src/*.c/*.h`'nin birebir kopyası (`win_service.c/.h`
  HARİÇ, bkz. D-4).
- `linux/scripts/build-byedpi.sh` — Linux gcc build script'i (Windows'un `build-byedpi.js`'inin portu).
- **`dotnet build` bu oturumda GERÇEKTEN çalıştırıldı ve 0 hatayla BAŞARILI oldu** (yalnızca 2 zararsız
  CA1416 platform-uyumluluk uyarısı — `BinaryLocator.cs`'teki `File.{Get,Set}UnixFileMode` çağrıları
  için, beklenen/doğru davranış). Bu, TÜM C# kodunun sözdizimsel/tür açısından tutarlı olduğunu
  kanıtlıyor — ama hiçbir şey gerçek bir Linux'ta ÇALIŞTIRILMADI (derleme ≠ çalışma zamanı doğruluğu).

**Bu oturumda YAPILMAYAN, sıradaki somut adımlar (öncelik sırasıyla değil, hepsi Faz 5-6 kapsamında):**
1. `linux/scripts/fetch-binaries.js` HENÜZ YAZILMADI — `ZapretEngine`/`Zapret2Engine`/DNS proxy
   sınıflarının beklediği `linux/resources/bin/{zapret,zapret2,dnsproxy,nextdns}/...` yolları şu an
   hiçbir şey tarafından doldurulmuyor. Referans: Windows'taki `scripts/fetch-binaries.js` — dnsproxy/
   nextdns için yalnızca Linux asset URL'lerine (`*-linux-amd64-*.tar.gz`) çevirip tar.gz açma mantığı
   eklemek yeterli (bkz. R-7'nin ikinci yarısı); zapret/zapret2 için bol-van/zapret ve bol-van/zapret2
   GitHub sayfaları önce ziyaret edilip gerçek release/dizin yapısı GÖRÜLMELİ (R-4.1, R-7).
2. `linux/packaging/systemd/splitcord-dpi.service` + `linux/packaging/install.sh`/`uninstall.sh`
   henüz yazılmadı (Faz 6, D-6'nın kesinleşmesini bekliyor — capability-scoped user mi root mu).
3. Faz 5'teki en büyük açık soru (R-6): blockcheck2.sh'nin native Linux çıktı formatının GERÇEKTEN
   `CandidateLineRegex`/`WorkingStrategyRegex`'in beklediği gibi "nfqws2" ismini kullanıp kullanmadığı,
   ve "daemon args" satırının port bilgisi içerip içermediği (`WfTcpOutRegex`) — yalnızca gerçek bir
   çalıştırmayla öğrenilebilir.
4. Faz 7 (Electron istemci portu) hiç başlamadı.

**Bilinen, henüz çözülmemiş açık teknik sorular** (D-11, R-6, R-7 dışında): `RunBlockcheck2Async`'in
kendi NFQUEUE kuralını kurup kurmadığı belirsiz olduğu için, eğer Faz 6 öncesi Faz 5'i canlı test
etmeye çalışılırsa muhtemelen İLK gerçek engel bu olacak.

## 7. Ortam notları

Henüz kurulu bir Linux dev/test ortamı yok. `dotnet build` bu Windows makinesinde `linux-x64` RID
hedefiyle SORUNSUZ çalışıyor (cross-compile — IL üretimi platform bağımsız, `SelfContained=true`
`dotnet publish`'in bir linux-x64 runtime pack indirmesi gerekebilir, bu da denenmedi). Kullanıcı
sistemine ayrı bir Linux boot kurup Claude Code'u oradan çalıştırdığında bu bölüm o oturumda
doldurulacak: dağıtım/sürüm, `wsl.conf`/VM detayı, `systemd` durumu, `lsmod | grep nfnetlink_queue`
sonucu, kullanılan capability seti.
