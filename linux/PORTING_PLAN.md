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
| 0 | İskelet + bu takip dosyası | **devam ediyor** | 1 |
| 1 | Dev/test ortamı canlı doğrulaması (WSL2/VM NFQUEUE+systemd) | **ertelendi** (kullanıcı henüz Linux ortamı kurmadı) | 0 |
| 2 | Servis iskeleti: Kestrel API + SettingsStore + DNS forwarder (motor yok) | başlanmadı | 0 |
| 3 | ByeDPI motoru | başlanmadı | 0 |
| 4 | Zapret motoru (nfqws + NFQUEUE) | başlanmadı | 0 |
| 5 | Zapret2 motoru (nfqws2 + native bash) | başlanmadı | 0 |
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

## 5. Risk kaydı

| ID | Risk | Önem | Durum | Not |
|---|---|---|---|---|
| R-1 | WSL2/hedef Linux ortamında NFQUEUE modülleri (nfnetlink_queue, xt_NFQUEUE) çalışmayabilir | YÜKSEK | açık | Faz 4-5'i gerçek VM/cloud'a itebilir; canlı test başlayınca ilk kontrol edilecek şey |
| R-4.1 | bol-van/zapret hazır Linux binary yayınlıyor mu, yoksa kaynaktan mı derlenmeli | ORTA | açık | Faz 4 başlamadan (GitHub releases sayfası) kontrol edilmeli |
| R-4.2 | iptables/nftables uyumluluğu (modern dağıtımlarda `iptables-nft` shim'i genelde sorunsuz ama doğrulanmadı) | ORTA | açık | Canlı testte doğrulanacak |
| R-4.3 | `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW` yeterli mi, yoksa root mu şart | YÜKSEK | açık | R-1'in devamı; Faz 6'daki D-6 kararını doğrudan etkiler |
| R-5 | blockcheck2.sh'nin native bash çıktısı, Cygwin bash'te doğrulanmış regex'lerle (WorkingStrategyRegex vb.) birebir eşleşmeyebilir | DÜŞÜK-ORTA | açık | Faz 5'te canlı test gerekli |

## 6. Şu anki durum / nereden devam edilir

**Aktif faz:** 0 (iskelet + bu dosya) tamamlanıyor, ardından Faz 1 BEKLENMEDEN Faz 2'ye geçilecek.

**Son yapılan:** `linux/` klasör iskeleti oluşturuldu (`service/SplitCordServiceLinux/{Config,Dns/Upstreams,Engines,LocalApi}`,
`vendor/byedpi-src`, `resources/bin`, `scripts`, `packaging/systemd`, `client/src/{main,preload,renderer}`,
`client/build`), bu takip dosyası yazıldı.

**Sıradaki somut adım:** `linux/README.md` ve `linux/.gitignore` yazılacak, sonra Faz 2'ye geçilecek:
`linux/service/SplitCordServiceLinux/SplitCordServiceLinux.csproj` oluşturulacak (net8.0, RID
linux-x64, SelfContained=true, `Microsoft.Extensions.Hosting.Systemd` paketi), ardından `Program.cs`
(`.UseSystemd()`), `LocalApi/LocalApiConstants.cs` (port 58271 — Windows'taki ile AYNI, referans:
`service/SplitCordService/LocalApi/LocalApiConstants.cs`), `LocalApi/LocalApiEndpoints.cs`,
`Config/SettingsStore.cs`, `Dns/**` sınıfları (referans: `service/SplitCordService/Dns/**`).

**Başarısız/bekleyen bir şey yok** — bu, ilk oturum.

## 7. Ortam notları

Henüz kurulu bir Linux dev/test ortamı yok. Kullanıcı, sistemine ayrı bir Linux boot kurup Claude
Code'u oradan çalıştırdığında bu bölüm o oturumda dolduracak: dağıtım/sürüm, `wsl.conf`/VM detayı,
`systemd` durumu, `lsmod | grep nfnetlink_queue` sonucu, kullanılan capability seti.
