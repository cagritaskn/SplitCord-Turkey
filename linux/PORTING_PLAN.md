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

**Gerçek bir Linux ortamında (dual-boot/VM) canlı test yapmak için buradan başlanıyorsan: doğrudan
§8 "Test Başlangıç Rehberi"ne geç** — ön koşullar, adım adım komutlar ve her adımda hangi risk/karara
(§4/§5) bakman gerektiği orada.

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
| 4 | Zapret motoru (nfqws + NFQUEUE) | **bitti** (kod + `build-zapret.sh` yazıldı + derlendi; NFQUEUE/iptables mantığı canlı DOĞRULANMADI) | 1 |
| 5 | Zapret2 motoru (nfqws2 + native bash) + `fetch-binaries.js`/build script'leri | **bitti** (kod + fetch/build script'leri yazıldı, derlendi; blockcheck2'nin native çıktı formatı hâlâ en büyük açık soru, bkz. R-6) | 1 |
| 6 | systemd paketleme + install/uninstall script'leri | **bitti** (kod yazıldı; gerçek kurulum/systemctl davranışı DOĞRULANMADI) | 1 |
| 7 | Electron istemci portu | **büyük ölçüde bitti** (bkz. §6 — tüm dosyalar kopyalandı/uyarlandı, sözdizimi doğrulandı; canlı çalıştırma DOĞRULANMADI) | 1 |
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
- **D-6** (ön-eğilim ROOT yönünde GÜÇLENDİ, 2026-09-04 — bkz. R-4.3): `gh api` ile bol-van/zapret2
  kaynağı (`common/elevate.sh`) incelendi, blockcheck2.sh'nin KENDİSİ tam root istiyor (`id -u`
  kontrolü, yoksa `sudo`/`su` ile kendini yükseltiyor) — bu yüzden systemd birimi muhtemelen ROOT
  olarak çalışmalı (en azından blockcheck2.sh'yi çağıran Zapret2 motoru için). Capability-scoped
  düşük yetkili kullanıcı seçeneği hâlâ TEORİK olarak mümkün olabilir (blockcheck2.sh'yi ROOT
  gerektirmeyecek şekilde -- ör. ZAPRET_BASE altında zaten kurulmuş bir NFQUEUE kuralıyla --
  çağırma yolu varsa) ama bu ekstra araştırma/canlı test gerektirir. Faz 6'da KESİN karar canlı
  testte verilecek.
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
- **D-11** (2026-09-04, Faz 5 — **DOĞRULANDI**, 2026-09-04): `Zapret2Engine.RunBlockcheck2Async`'in
  blockcheck2.sh'nin native Linux sürümünün KENDİ iç test döngüsü için KENDİ iptables/NFQUEUE
  kuralını yönettiği varsayımı `gh api` ile blockcheck2.sh kaynağı okunarak DOĞRULANDI:
  `QNUM=${QNUM:-$(($$ % 64536 + 1000))}`, `NFT_TABLE=blockcheck$$`, `IPT_OUT_CHAIN=blockcheck_output_$$`
  gibi PID-bazlı, kendi kendine izole değişkenler script içinde tanımlı — script gerçekten kendi
  kuralını kendi yönetiyor. `RunBlockcheck2Async`'e NFQUEUE kurulumu eklemeye GEREK YOK, mevcut hâli
  doğru.
- **D-12** (2026-09-04, kullanıcı sorusu üzerine): **Hedef kapsam TEK, dağıtımdan bağımsız bir hat**
  — ayrı ayrı Ubuntu/Fedora/Arch release'leri YOK. Servis tarafı systemd tabanlı herhangi bir modern
  dağıtımı hedefliyor (Alpine/Void gibi systemd kullanmayanlar kapsam dışı). İstemci paketleme:
  **AppImage birincil** (dağıtımdan bağımsız, FUSE ile çoğu modern dağıtımda çalışır) + isteğe bağlı
  **.deb** (Ubuntu/Debian/Mint için daha doğal kurulum) — ikisi de AYNI GitHub release'inin farklı
  dosyaları, ayrı release hatları değil. Geliştirme/test odağı Ubuntu/Debian ailesi (WSL2'nin
  varsayılanıyla örtüşüyor); diğer dağıtımlar "büyük ihtimalle çalışır ama test edilmedi" olarak
  belgelenecek. Bu, Faz 6 (systemd unit) ve Faz 8'in (electron-builder linux target: AppImage+deb)
  doğrudan temelini oluşturuyor — kullanıcı isterse yeniden açılabilir, ama şu an için karar bu.
- **D-13** (2026-09-04, `gh api` ile doğrulandı): Windows'un aksine bol-van/zapret VE zapret2'nin
  İKİSİ de hazır Linux binary'si YAYINLAMIYOR — yalnızca kaynak tarball'ı. `linux/scripts/
  fetch-binaries.js` bu ikisi için ByeDPI'ninkine benzer bir "indir + `make` ile derle" akışı
  izlemeli (muhtemelen ayrı `build-zapret.sh`/`build-zapret2.sh` script'leri, ya da tek script
  içinde iki hedef) — dnsproxy/nextdns'in "hazır Linux binary'sini indir" akışından FARKLI.
  Kök `Makefile`'daki `make all`/`make systemd` hedefleri ilgili alt dizinleri (nfq veya nfq2,
  ip2net, mdig) derleyip `binaries/my/`'a taşıyor.
- **D-14** (2026-09-04, `gh api` ile doğrulandı, bu oturumda düzeltildi): `ZapretEngine.cs`/
  `Zapret2Engine.cs`'te İLK yazılan binary yolları ("bin/nfqws", "blockcheck2/nfq2/nfqws2")
  YANLIŞTI — Windows bundle'ının (Flowseal/zapret-discord-youtube, zapret-win-bundle) kendine
  özgü sarmalama dizinlerine dayanıyordu. Gerçek upstream yolları (blockcheck2.sh'nin kendi
  `NFQWS=`/`NFQWS2=` ortam değişkeni varsayılanlarından doğrulandı): `nfq/nfqws` (zapret),
  `nfq2/nfqws2` (zapret2, KÖKTE — "blockcheck2" alt klasörü YOK). Düzeltildi, `dotnet build`
  yeniden başarılı.
- **D-15** (2026-09-04, Faz 6 — D-6'nın SONUÇLANMASI): systemd birimi **root olarak** çalışacak
  şekilde yazıldı (`User=root`) — R-4.3'teki `require_root()` bulgusuna dayanıyor. Capability-scoped
  alternatif TEORİK olarak hâlâ mümkün olabilir ama ek araştırma/canlı test gerektiriyor, şimdilik
  en güvenli/sürprizsiz varsayım root. Kurulum yolu `/opt/splitcord`, veri dizini `/var/lib/splitcord`
  (ayrı tutuluyor, bkz. D-3) — `install.sh`/`uninstall.sh` bu ayrımı kullanıcı verisini
  kurulum/kaldırmadan bağımsız korumak için kullanıyor (`uninstall.sh --purge` olmadan veri
  dizinine hiç dokunmuyor).
- **D-16** (2026-09-04, Faz 7): `linux/client/` neredeyse tamamen `client/`'ın kopyası (serviceClient.js,
  dpiLifecycle.js, permissions.js, window.js, tray.js'in çekirdeği vb. — araştırma bulgusu
  doğrulandı, `process.platform` dallanması hiç yok, hepsi birebir kopyalandı). Gerçek yeni kod
  gereken yerler: `autostart.js` (AppImage için elle `.desktop` dosyası, `.deb`/dev'de Electron'un
  yerleşik API'sine güveniliyor), `updateChecker.js` (`.AppImage` asset tercihi, AppImage kendi
  kendini üzerine kopyalayıp `app.relaunch()`, `.deb` için `shell.openPath` ile paket yöneticisine
  yönlendirme), `protocolHandler.js` (resmi Discord tespiti/kaldırması BİLEREK inert — D-7 gibi
  "düşür" seçeneği, tek güvenilir Linux kurulum izi yok), `ipc.js`'nin `app:uninstall-app`'ı
  (otomatik kaldırma yok, kullanıcıya AppImage-sil/`apt remove`/`uninstall.sh --purge` talimatı).
  `/firewall/*` ve `/system-controls/*`'a bağımlı TÜM kod (serviceClient.js, ipc.js, preload.js,
  settings.js/html'deki firewall izin kartları + Kaspersky/ESET/harici-process kontrol listesi,
  `antivirusInfo.js` — dosya TAMAMEN silindi) kaldırıldı (D-9'un doğal sonucu). `dpiProxy.js`/
  `secureDns.js` sadeleştirildi: GoodbyeDPI'ye özgü "useSystemResolver" dalı TAMAMEN kalktı,
  Chromium DoH'u artık HER ZAMAN zorlanıyor (Zapret/Zapret2'nin ikisi de kendi DNS mekanizmasına
  sahip değil, ikisi de EncryptedDnsForwarder'a bağımlı — GoodbyeDPI'nin aksine). Motor sırası her
  yerde (ENGINE_DESCRIPTIONS, escalation metinleri) Zapret→Zapret2→ByeDPI olarak güncellendi.
  "Windows ile başlat" → "Sistem ile başlat". `electron-builder`'ın `linux` hedefi (AppImage+deb,
  D-12) `linux/client/package.json`'a eklendi.

## 5. Risk kaydı

| ID | Risk | Önem | Durum | Not |
|---|---|---|---|---|
| R-1 | WSL2/hedef Linux ortamında NFQUEUE modülleri (nfnetlink_queue, xt_NFQUEUE) çalışmayabilir | YÜKSEK | açık | Faz 4-5'i gerçek VM/cloud'a itebilir; canlı test başlayınca ilk kontrol edilecek şey |
| R-4.1 | ~~bol-van/zapret hazır Linux binary yayınlıyor mu~~ | — | **ÇÖZÜLDÜ (2026-09-04)** | `gh api repos/bol-van/zapret/releases` ile doğrulandı: HAYIR, yalnızca kaynak tarball'ı (`zapret-vX.Y.tar.gz`/`.zip`) yayınlıyor, prebuilt binary yok. `linux/scripts/build-zapret.sh`/`build-zapret2.sh` yazılmalı (bkz. §6) — kök `Makefile`'daki `make all`/`make systemd` hedefi `nfq`/`nfq2`, `ip2net`, `mdig`'i derleyip `binaries/my/`'a taşıyor, orijinal dizinde sembolik bağlantı bırakıyor. |
| R-4.2 | iptables/nftables uyumluluğu | ORTA | **BÜYÜK ÖLÇÜDE ÇÖZÜLDÜ** | blockcheck2.sh (`common/fwtype.sh`) `nft` + çekirdek≥4.16 varsa nftables'ı, yoksa iptables'ı KENDİSİ otomatik seçiyor — kendi kuralları için bizim hiçbir şey yapmamıza gerek yok. Bizim KENDİ `iptables` çağrılarımız (ZapretEngine/Zapret2Engine SpawnAsync) hâlâ düz `iptables` komutunu varsayıyor — D-12'nin hedef kapsamı (Ubuntu/Debian ailesi) bu komutu `iptables-nft` shim'i üzerinden zaten sağlıyor, bu yüzden şimdilik yeterli sayılıyor; farklı bir dağıtımda gerçek sorun çıkarsa `fwtype.sh`'daki gibi bir `nft` algılaması eklenebilir. |
| R-4.3 | `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW` yeterli mi, yoksa root mu şart | YÜKSEK | **KISMEN ÇÖZÜLDÜ, D-6'yı ROOT yönüne çeviriyor** | `common/elevate.sh`'teki `require_root()` blockcheck2.sh'nin KENDİSİNİN `id -u -ne 0` kontrolüyle tam root istediğini (yoksa `sudo`/`su` ile kendini yükselttiğini) doğruluyor. Servis systemd biriminin root olarak çalışması gerektiği anlamına geliyor (en azından blockcheck2.sh'yi çağırdığı sürece) — capability-scoped kullanıcı seçeneği muhtemelen pratik değil. R-1 (NFQUEUE modülleri) hâlâ ayrı, açık bir risk. |
| R-5 | blockcheck2.sh'nin native bash çıktısı, Cygwin bash'te doğrulanmış regex'lerle (WorkingStrategyRegex vb.) birebir eşleşmeyebilir | DÜŞÜK-ORTA | açık | Faz 5'te canlı test gerekli |
| R-6 | blockcheck2.sh'nin native Linux çıktısında "daemon" adının GERÇEKTEN "nfqws2" olduğu ve `--wf-tcp-out=` yerine port bilgisi hiç içermeyen bir format kullandığı VARSAYILDI | ORTA | açık | `NFQWS2=.../nfq2/nfqws2` değişken adı R-7'yi doğruladı ama "daemon" olarak loglanan İSMİN tam olarak "nfqws2" mi basıldığı (script kaynağında `curl_test_*` fonksiyonlarının log formatı ayrıca incelenmedi) hâlâ açık — Faz 5 canlı testinde İLK kontrol edilecek şey |
| R-7 | ~~binary dizin yapıları VARSAYILDI~~ | — | **ÇÖZÜLDÜ (2026-09-04)** | `gh api` ile bol-van/zapret ve zapret2 kaynağı incelendi: gerçek yollar `nfq/nfqws` (zapret) ve `nfq2/nfqws2` (zapret2, KÖKTE — "blockcheck2" adında bir alt klasör YOK). `ZapretEngine.cs`/`Zapret2Engine.cs`'teki YANLIŞ `bin/`/`blockcheck2/nfq2/` yolları bu oturumda DÜZELTİLDİ, `dotnet build` yeniden doğrulandı. |

## 6. Şu anki durum / nereden devam edilir

**Aktif faz:** 7 büyük ölçüde tamamlandı. Sırada **Faz 8** (paketleme & release hattı) — ya da
kullanıcı Linux ortamını kurup canlı doğrulamaya (Faz 1 + tüm DOĞRULANMADI notları) geçebilir.

**Bu oturumda tamamlanan (Faz 0, 2, 3, 4, 5 — TAMAMI):**
- `linux/` klasör iskeleti + bu takip dosyası + `README.md` + `.gitignore` + `.gitattributes`
  (CRLF'e karşı `eol=lf`) + `package.json` (`npm run fetch-binaries` kısayolu) (Faz 0).
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
- `linux/scripts/{fetch-binaries.js, build-byedpi.sh, build-zapret.sh, build-zapret2.sh}` —
  DÖRDÜ de yazıldı. `fetch-binaries.js` dnsproxy/nextdns'in HAZIR Linux binary'lerini indirip
  (`*-linux-amd64-*.tar.gz`, Windows'takiyle AYNI pinlenmiş sürümler), ardından üç build script'ini
  sırayla çağırıyor. `build-zapret.sh`/`build-zapret2.sh` GERÇEK `gh api` araştırmasıyla (bkz. D-13,
  D-14, R-4.1/R-7 ÇÖZÜLDÜ) yazıldı: bol-van/zapret ve zapret2'nin İKİSİ de kaynak tarball'ı indirilip
  `make systemd` ile derleniyor, çıktılar `resources/bin/{zapret,zapret2}/`'a yerleştiriliyor. Debian/
  Ubuntu derleme bağımlılıkları (`libnetfilter-queue-dev` vb.) script yorumlarında belgelendi ama
  GERÇEKTE bir Debian/Ubuntu'da hiç denenmedi (DOĞRULANMADI).
- `linux/.build-cache/` (build-zapret*.sh'nin geçici indirme/derleme dizini) `.gitignore`'a eklendi.
- **`dotnet build` bu oturumda GERÇEKTEN çalıştırıldı ve 0 hatayla BAŞARILI oldu** (yalnızca 2 zararsız
  CA1416 platform-uyumluluk uyarısı). Bu, TÜM C# kodunun sözdizimsel/tür açısından tutarlı olduğunu
  kanıtlıyor — ama hiçbir shell script (fetch-binaries.js, build-*.sh) ve hiçbir şey gerçek bir
  Linux'ta ÇALIŞTIRILMADI (derleme ≠ çalışma zamanı doğruluğu).
- **`gh api` ile bol-van/zapret ve bol-van/zapret2'nin GERÇEK GitHub kaynağı incelendi** (2026-09-04)
  — bu, R-4.1 ve R-7'yi ÇÖZDÜ, R-4.2/R-4.3'ü büyük ölçüde netleştirdi ve D-14'te belgelenen bir
  YANLIŞ dizin-yapısı varsayımını (bu oturumun kendi hatası) düzeltti. Detaylar §4/§5'te.

**Bu oturumda tamamlanan (Faz 6):**
- `linux/packaging/systemd/splitcord-dpi.service` — `User=root` (bkz. D-15/R-4.3),
  `Restart=on-failure`, `ExecStart=/opt/splitcord/SplitCordServiceLinux`, `Type=notify`
  (DOĞRULANMADI: `Microsoft.Extensions.Hosting.Systemd`'nin sd_notify entegrasyonu canlı
  test edilmedi — sorun çıkarsa `Type=simple`'a düşülebilir).
- `linux/packaging/install.sh` — yayınlanmış çıktıyı `/opt/splitcord`'a kopyalar, birimi kurup
  `systemctl enable --now` yapar; `/var/lib/splitcord/` (kullanıcı verisi) AYRI bir dizin olduğu
  için kurulum/güncelleme sırasında hiç dokunulmuyor (Windows'taki installer.nsh veri-kaybı
  dersinin doğrudan karşılığı, bkz. D-15).
- `linux/packaging/uninstall.sh` — servisi durdurur, DPI alt süreçlerini (nfqws/nfqws2/ciadpi/
  dnsproxy/nextdns) zorla temizler, birimi ve `/opt/splitcord`'u kaldırır — VARSAYILAN OLARAK
  `/var/lib/splitcord/`'a dokunmaz, yalnızca açık `--purge` bayrağıyla siler (apt purge deseni).
- Windows'un `install-service.ps1`/`uninstall-service.ps1`'indeki savunmacı desenlerin (aktif
  bekleme döngüsü, otomatik-yeniden-başlatma kaydını önceden sıfırlama, WinDivert sürücü kaydı
  temizliği) ÇOĞU systemd'nin kendi senkron `stop`/`enable` davranışı ve NFQUEUE'nun kalıcı
  sürücü kaydı gerektirmemesi sayesinde GEREKSİZ hale geldi — bilerek taşınmadı, gerekçesi
  script yorumlarında.

**Bu oturumda tamamlanan (Faz 7 — büyük ölçüde):**
- `linux/client/` — `client/`'ın (neredeyse) tamamının kopyası: `src/{main,preload,renderer}/**`,
  `resources/**`, `build/icon.png`, hepsi `linux/client/package.json` ile (bkz. D-16 detayları).
- Gerçek yeni kod: `autostart.js` (AppImage `.desktop` elle yazımı), `updateChecker.js` (AppImage
  kendi kendini üzerine kopyalayıp relaunch, `.deb` paket yöneticisine yönlendirme),
  `protocolHandler.js` (resmi Discord tespiti inert), `ipc.js`'nin `app:uninstall-app`'ı (talimat
  metni), `linux/client/package.json`'ın `linux: {target: [AppImage, deb]}` build config'i.
- Kaldırılan (D-9'un doğal sonucu): `serviceClient.js`/`ipc.js`/`preload.js`'teki TÜM firewall/
  system-controls fonksiyonları, `settings.js`/`settings.html`'deki firewall izin kartları +
  Kaspersky/ESET/harici-process kontrol listesi UI'ı, `antivirusInfo.js` (dosya TAMAMEN silindi,
  2 HTML'deki `<script>` etiketleri de kaldırıldı), `titlebar.js`'teki throttle/localStorage
  antivirus-dialog mantığı (artık no-op).
- Sadeleştirilen: `dpiProxy.js`/`secureDns.js` (GoodbyeDPI'ye özgü `useSystemResolver` dalı
  TAMAMEN kalktı — Zapret/Zapret2'nin ikisi de EncryptedDnsForwarder'a bağımlı, GoodbyeDPI'nin
  aksine kendi DNS mekanizmaları yok, bu yüzden Chromium DoH'u HER motor için zorlanıyor).
- Motor sırası/isimleri her yerde (ENGINE_DESCRIPTIONS, escalation onay metinleri, "Windows ile
  başlat"→"Sistem ile başlat") güncellendi.
- **TÜM değiştirilen/yeni JS dosyaları `node --check` ile sözdizimi doğrulandı, hepsi geçti** —
  ama hiçbiri gerçek Electron içinde ÇALIŞTIRILMADI (bkz. §2 madde 5).

**Faz 7'de henüz yapılmayan/gözden geçirilmemiş küçük artıklar (canlı test öncesi göz atılabilir,
bloklayıcı değil):** `window.js` hiç detaylı incelenmedi (muhtemelen sorunsuz — frameless pencere
davranışı Electron'da platform bağımsız); `richPresence.js`/arrpc'nin native process-scanning
kısmı (yalnızca Windows'ta implemente, Linux'ta IPC-socket yolu zaten çalışıyor — bkz. Windows
araştırması) hiç dokunulmadı, gerekmiyor da; `resources/*.png` ikonları Windows'unkiyle AYNI
kopyalandı, Linux'a özel bir ikon seti (ör. farklı boyutlar) hazırlanmadı.

**Sıradaki somut adım (Faz 8 — Paketleme & release hattı):** `linux/scripts/build-release.sh`
(dotnet publish → electron-builder → AppImage+deb, bkz. plan onayının Faz 8 tanımı). CI eklemek
(`.github/workflows/`) `linux/` dışında bir ekleme olacağı için ÖNCE KULLANICIYA SORULMALI (bkz.
plan onayının Faz 8 notu — bu hâlâ geçerli bir kısıtlama).

**Bundan sonraki açık teknik sorular (canlı test gerektiriyor, kod yazarak çözülemez):**
- R-1 / R-4.3'ün geri kalanı: gerçek NFQUEUE modül desteği ve capability/root gereksinimi.
- R-5/R-6: blockcheck2.sh'nin native çıktı formatının regex'lerle tam eşleşip eşleşmediği.
- Derleme bağımlılıklarının (`libnetfilter-queue-dev` vb.) gerçek paket adları/eksiksizliği.
- AppImage self-update akışı (dosya üzerine yazma + relaunch) ve `.desktop` autostart dosyasının
  gerçekten bir masaüstü ortamı tarafından okunduğu.

Faz 8 (paketleme) BİLİNÇLİ OLARAK ERTELENDİ — kullanıcı talebi: önce Faz 1-7'nin tamamı gerçek bir
Linux'ta test edilip doğrulanacak, paketleme/release ondan SONRA yapılacak. Canlı test için bkz.
**§8 Test Başlangıç Rehberi** — kullanıcı Linux kurup oradan (yeni bir Claude Code oturumuyla)
başladığında ihtiyaç duyacağı HER ŞEY (paket bağımlılıkları, adım adım komutlar, risk/karar
kimlikleriyle eşleştirilmiş bir kontrol listesi) orada.

## 7. Ortam notları

Henüz kurulu bir Linux dev/test ortamı yok. `dotnet build` bu Windows makinesinde `linux-x64` RID
hedefiyle SORUNSUZ çalışıyor (cross-compile — IL üretimi platform bağımsız, `SelfContained=true`
`dotnet publish`'in bir linux-x64 runtime pack indirmesi gerekebilir, bu da denenmedi). Kullanıcı
sistemine ayrı bir Linux boot kurup Claude Code'u oradan çalıştırdığında bu bölüm o oturumda
doldurulacak: dağıtım/sürüm, `wsl.conf`/VM detayı, `systemd` durumu, `lsmod | grep nfnetlink_queue`
sonucu, kullanılan capability seti.

## 8. Test Başlangıç Rehberi (Linux'a geçince buradan başla)

Bu bölüm, kullanıcı gerçek bir Linux ortamı kurup (dual-boot/VM) oradan yeni bir Claude Code
oturumu başlattığında sıfırdan hiçbir şey aramadan teste geçebilmesi için var. **Sıra önemli** —
her adım bir öncekinin üzerine kuruluyor. Faz 8 (paketleme/release) kullanıcı talebiyle BİLEREK
buraya dahil değil — önce Faz 1-7'nin TAMAMI burada doğrulanacak.

### 8.1 Ön koşullar (Ubuntu/Debian ailesi — bkz. D-12)

```bash
sudo apt update
sudo apt install -y build-essential pkg-config git curl dnsutils \
  libnetfilter-queue-dev libnfnetlink-dev libmnl-dev zlib1g-dev \
  libluajit-5.1-dev iptables
```

DOĞRULANMADI: bu paket listesi (özellikle `libluajit-5.1-dev` — zapret2/nfq2/Makefile'daki
`LUA_JIT=1` varsayılanı için) gerçek bir Debian/Ubuntu'da hiç denenmedi. `make systemd` bir
"paket bulunamadı" (pkg-config) hatasıyla başarısız olursa, eksik `-dev` paketini hata
mesajından bulup buraya (ve `build-zapret.sh`/`build-zapret2.sh`'nin başındaki yorum bloğuna)
ekle.

.NET 8 SDK (apt'ta yoksa/eskiyse resmi script):
```bash
curl -sSL https://dot.net/v1/dotnet-install.sh -o dotnet-install.sh
chmod +x dotnet-install.sh
./dotnet-install.sh --channel 8.0
export PATH="$PATH:$HOME/.dotnet"   # kalıcı olması için ~/.bashrc'ye de ekle
dotnet --version   # 8.x göstermeli
```

Node.js/npm (Electron istemcisi için — 20 LTS önerilir, [nodejs.org](https://nodejs.org) veya
dağıtımın kendi paketi):
```bash
node --version   # varsa
npm --version
```

Repo: aynı repoyu (`git clone` ya da zaten aynı diskte varsa mevcut checkout) kullan. **İlk iş her
zaman**: bu dosyanın (`linux/PORTING_PLAN.md`) TAMAMINI oku, özellikle §2 (değişmez kurallar) ve
§4 (karar günlüğü) — hiçbir kararı yeniden tartışma.

### 8.2 Binary'leri indir/derle

```bash
cd linux
node scripts/fetch-binaries.js
```

Bu tek komut dnsproxy+nextdns'i indirir, ardından `build-byedpi.sh`/`build-zapret.sh`/
`build-zapret2.sh`'yi sırayla çalıştırır (hepsi kaynaktan derler — bkz. D-13). Herhangi biri
başarısız olursa (muhtemelen eksik bir `-dev` paketi) burada durup önce onu çöz. Başarılı
çıktı: `linux/resources/bin/{byedpi,zapret,zapret2,dnsproxy,nextdns}/` altında çalıştırılabilir
dosyalar olmalı.

### 8.3 Servisi ayrı (systemd'siz) çalıştırıp temel duman testi yap

```bash
cd linux/service/SplitCordServiceLinux
dotnet build
sudo dotnet run
```

(Şimdilik `sudo` ile — Zapret/Zapret2 zaten root istiyor, bkz. R-4.3/D-6; ayrı bir terminalde
test komutlarını çalıştır.)

```bash
curl http://127.0.0.1:58271/status
```

Boş bir motor listesiyle (henüz hiçbiri aktive edilmedi) düzgün bir JSON dönmeli — **Faz 2'nin
canlı doğrulaması budur.**

### 8.4 Motorları TEK TEK aktive edip test et

**ByeDPI (root gerektirmez, ilk denenecek — en basit motor):**
```bash
curl -X POST http://127.0.0.1:58271/engines/byedpi/activate
curl http://127.0.0.1:58271/status
```
`running: true` ve bir `proxyAddress` (socks5://127.0.0.1:...) görülmeli. **Faz 3'ün canlı
doğrulaması.**

**DNS forwarder (ayrı bir terminalde):**
```bash
dig @127.0.0.1 -p 53535 discord.com
```
Gerçek A kayıtları dönmeli (EncryptedDnsForwarder'ın DoH ile çalıştığının kanıtı).

**Zapret (root + NFQUEUE gerekiyor — R-1/R-4.3'ü burada ilk kez gerçekten test ediyorsun):**
```bash
curl -X POST http://127.0.0.1:58271/engines/zapret/activate
sudo iptables -L OUTPUT -n | grep NFQUEUE   # kuralın gerçekten eklendiğini gör
curl http://127.0.0.1:58271/engines/zapret/logs
```
Burada başarısız olursa (`iptables: command not found`, "Operation not permitted", ya da
`nfqws` hiç paket görmüyor) **R-1/R-4.3 açık risklerine düş** — sonucu (tam hata mesajı) §5
risk kaydına ve §7 ortam notlarına işle. **Faz 4'ün canlı doğrulaması.**

**Zapret2 (blockcheck2 — R-6'nın kritik testi):**
```bash
curl -X POST http://127.0.0.1:58271/engines/zapret2/activate
```
Bu dakikalarca sürebilir (blockcheck2 gerçek bir tarama yapıyor). Sürerken:
```bash
tail -f /var/lib/splitcord/diagnostic.log   # ya da $SPLITCORD_DATA_DIR ayarlıysa o yol
```
çıktısında **"nfqws2" kelimesinin GERÇEKTEN geçip geçmediğine** (R-6, `CandidateLineRegex`/
`WorkingStrategyRegex`'in beklediği) ve "AVAILABLE" satırlarının doğru ayrıştırılıp
ayrıştırılmadığına (adayın gerçekten yakalanıp `TryCandidateAsync`'e geçtiğine) bak. Regex
hiç eşleşmiyorsa `Zapret2Engine.cs`'teki `CandidateLineRegex`/`WorkingStrategyRegex`'i GERÇEK
çıktı formatına göre güncellemek gerekecek — bu oturumda tahmin edilen en yüksek ihtimalli
düzeltme noktası. **Faz 5'in canlı doğrulaması.**

Her adımda `/status` ve `/engines/{id}/logs` uç noktalarını kontrol ederek ilerle; bir motor
takılırsa `POST /stop-all` ile hepsini durdurup bir sonrakine geç.

### 8.5 systemd kurulumu (Faz 6'nın canlı doğrulaması)

```bash
cd linux
dotnet publish -c Release -r linux-x64 --self-contained \
  -o service/SplitCordServiceLinux/bin/Release/net8.0/linux-x64/publish \
  service/SplitCordServiceLinux/SplitCordServiceLinux.csproj
sudo packaging/install.sh
sudo systemctl status splitcord-dpi
curl http://127.0.0.1:58271/status
sudo systemctl reboot   # (isteğe bağlı) reboot sonrası hâlâ ayakta mı diye kontrol için
```
Sonra bir güncelleme/yeniden kurulum senaryosunu da dene (idempotency):
```bash
sudo packaging/install.sh   # ikinci kez çalıştır, hata vermemeli
sudo packaging/uninstall.sh   # --purge OLMADAN -- /var/lib/splitcord korunmalı
ls /var/lib/splitcord   # hâlâ orada olmalı
```

### 8.6 Electron istemcisi (Faz 7'nin canlı doğrulaması)

```bash
cd linux/client
npm install
npm start
```
Uygulama açılıp servise bağlanmalı, motor kartları (Zapret/Zapret2/ByeDPI — GoodbyeDPI GÖRÜNMEMELİ)
Ayarlar > DPI Aşımı'nda listelenmeli. AppImage'a özgü autostart/güncelleme akışlarını test etmek
için önce paketlemek gerekir (Faz 8) — bu aşamada `npm start` (dev modu) ile temel UI/motor
etkileşimini doğrulamak yeterli.

### 8.7 Her adımdan sonra

Bulduğun her şeyi (başarı ya da başarısızlık) **hemen** şu dosyaya işle — bir sonraki oturum
(hafızasız) senin bulduklarını buradan okuyacak:
- §3 (faz durumu): "DOĞRULANMADI" → "DOĞRULANDI (tarih)" ya da bulunan gerçek soruna göre güncelle.
- §5 (risk kaydı): R-1/R-4.2/R-4.3/R-5/R-6 satırlarını gerçek sonuçla doldur.
- §7 (ortam notları): dağıtım/sürüm, `lsmod` çıktısı, kullanılan capability/root durumu.
- §6 (nereden devam edilir): hangi adımda kaldığını, sıradaki somut adımı YENİDEN yaz (ekleme).

Bir düzeltme gerekiyorsa (ör. R-6'daki regex yanlış çıkarsa) doğrudan ilgili dosyayı düzelt,
`dotnet build`/`node --check` ile yeniden doğrula, commit'le, ve §4'e (karar günlüğü) YENİ bir
madde (D-17, ...) olarak ekle — var olanları silme/değiştirme, yalnızca ekle.
