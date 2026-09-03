<#
  SplitCord DPI Service'i ve tum yardimci DPI surecelerini/surucu kayitlarini sistemden
  TAM olarak temizler. Eskiden yalnizca "Stop-Service -Force; sc.exe delete" yapiyordu —
  bu, Stop-Service'in servisin GERCEKTEN durdugunu BEKLEMEDEN donebilmesi yuzunden
  (ozellikle DpiEngineManager'in aday taramasi surerken) servis/alt surecleri (winws.exe/
  ciadpi.exe/goodbyedpi.exe) hala calisir halde birakip dosya kilidi/silinmeyen servis
  kaydi kalintisina yol aciyordu. Simdi: once TUM bilinen alt surecleri zorla sonlandirip,
  servisin GERCEKTEN "Stopped" durumuna gectigini aktif olarak bekliyor, gerekirse servisin
  kendi process'ini de zorla sonlandirip ONDAN SONRA kaydi siliyoruz. Ayrica winws.exe/
  goodbyedpi.exe'nin WinDivert64.sys'i bir CEKIRDEK SURUCUSU olarak SCM'e kaydettigini
  (WinDivertOpen() -> CreateService) ve surec ABRUPT sonlandirilirsa (yukaridaki zorla
  kapatma dahil) bu kaydin sistemde KALABILDIGINI biliyoruz — bu yuzden "WinDivert*" adiyla
  eslesen tum surucu servislerini de ayrica taniyip kaldiriyoruz.

  NOT #1: "#Requires -RunAsAdministrator" BİLEREK yok — NSIS zaten elevation'ı garanti
  ediyor (perMachine=true), ekstra bir kontrole gerek yok.

  NOT #2 — canlı testte bulunan asıl kritik bug: electron-builder'ın standart NSIS kaldırma
  akışı $INSTDIR altındaki dosyaları customUnInstall makrosu ÇAĞRILMADAN ÖNCE siliyor. Bu
  script bu yüzden ARTIK $INSTDIR\resources\service-installer\ konumundan DEĞİL, installer.nsh
  customInit'te (dosyalar silinmeden ÖNCEKİ TEK fırsat) $PLUGINSDIR'a kopyalanmış bir
  nüshadan çalıştırılıyor — bkz. installer.nsh'deki customInit/customUnInstall notları.
  Bu yüzden bundled Cygwin/blockcheck2 dizinini bulmak için KENDİ konumuna ($PSScriptRoot,
  artık $PLUGINSDIR) değil, installer.nsh'nin ayrıca geçtiği -OriginalScriptDir'e güveniyor.
#>
param(
    [string]$ServiceName = "SplitCordDpiService",
    [string]$OriginalScriptDir = $PSScriptRoot
)

$ErrorActionPreference = "Continue"

# NSIS'in sessiz (/S) kaldırma akışını dışarıdan gözlemlemenin başka bir yolu yok -- bu
# script'in gerçekten çalışıp çalışmadığını ve hangi adıma kadar ilerlediğini doğrulamak
# için Program Files/ProgramData'nın DIŞINDA (ikisi de bu kaldırma sırasında silinebiliyor)
# sabit bir konuma adım adım log yazıyoruz.
$logPath = "C:\Users\Public\splitcord-uninstall-log.txt"
function Write-UninstallLog {
    param([string]$Message)
    try {
        $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
        Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
    } catch {}
}

Write-UninstallLog "=== uninstall-service.ps1 basladi (ServiceName=$ServiceName, OriginalScriptDir=$OriginalScriptDir) ==="

function Stop-DpiChildProcesses {
    # Bu isimler yalnizca SplitCord'un kendi bundled binary'lerine ait, sistemde baska bir
    # yazilimla cakisma riski yok -- isimle guvenle kapatilabilir.
    $names = @('winws', 'winws2', 'ciadpi', 'goodbyedpi', 'dnsproxy')
    foreach ($name in $names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }

    # bash.exe GENEL bir isim (Git Bash, WSL, MSYS2 gibi kullanicinin kendi kurdugu baska
    # araclar da kullaniyor) -- isimle sistem genelinde kapatmak kullanicinin ILGISIZ
    # süreçlerini öldürme riski taşır. Yalnızca YOLU bizim bundled Cygwin dizinimizin
    # İÇİNDE olan bash.exe örneklerini hedefliyoruz (blockcheck2.sh'yi çalıştıran bash.exe --
    # bkz. Zapret2Engine.RunBlockcheck2Async). try/catch İLE SARILI: bu adım bir şekilde
    # başarısız olsa bile (ör. WMI/CIM kullanılamıyorsa) script'in geri kalanı (servis
    # durdurma/silme, WinDivert temizliği) MUTLAKA çalışmaya devam etmeli.
    try {
        $bundledCygwinDir = Join-Path $OriginalScriptDir "bin\zapret2\cygwin"
        if (Test-Path $bundledCygwinDir) {
            Get-CimInstance Win32_Process -Filter "Name = 'bash.exe'" -ErrorAction Stop | ForEach-Object {
                if ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($bundledCygwinDir, [System.StringComparison]::OrdinalIgnoreCase)) {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                }
            }
        }
    } catch {
        Write-UninstallLog "Stop-DpiChildProcesses: bash.exe temizligi basarisiz: $($_.Exception.Message)"
    }
}

# 0) KRİTİK — canlı testte bulunan bir bug: servis kurulumu sırasında (install-service.ps1)
#    Windows'a "servis beklenmedik şekilde sonlanırsa 3 kez otomatik yeniden başlat" kaydı
#    yazılıyor (sc.exe failure /RESTART). Bu, NORMAL çalışma sırasında yararlı bir güvenlik
#    ağı, ama KALDIRMA sırasında aşağıdaki Stop-Service çağrısı .NET Generic Host'un kendi
#    shutdown zaman aşımı yüzünden "beklenmedik sonlanma" gibi algılanabiliyor — SCM servisi
#    5 saniye sonra OTOMATİK YENİDEN BAŞLATIYOR. Kaldırma başlamadan ÖNCE bu otomatik-
#    yeniden-başlatma kaydını sıfırlıyoruz.
$svcExists = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Write-UninstallLog "Adim 0: servis kaydi mevcut mu = $([bool]$svcExists), durum = $($svcExists.Status)"
if ($svcExists) {
    sc.exe failure $ServiceName reset= 0 actions= "" | Out-Null
    sc.exe config $ServiceName start= demand | Out-Null
    Write-UninstallLog "Adim 0: otomatik yeniden baslatma kaydi sifirlandi"
}

# 1) Servis kendi StopAsync'inde bu surecleri zaten durdurmaya calisiyor, ama bu uzun
#    surebiliyor (aday taramasi) — servisi durdurmadan ONCE zorla kapatarak hem bu
#    beklemeyi ortadan kaldiriyoruz hem de servis hic yanit vermese bile surecler kesin
#    olarak olmus oluyor.
Write-UninstallLog "Adim 1: DPI alt surecleri (ilk tur) zorla kapatiliyor"
Stop-DpiChildProcesses

# 2) Servisi durdur ve GERCEKTEN durana kadar bekle (Stop-Service -Force senkron degildir —
#    Windows'un kendi SCM zaman asimindan once sessizce geri donebilir).
if ($svcExists) {
    Write-UninstallLog "Adim 2: Stop-Service cagriliyor"
    try { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue } catch {
        Write-UninstallLog "Adim 2: Stop-Service istisna: $($_.Exception.Message)"
    }

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') { break }
        Start-Sleep -Milliseconds 500
    }

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Write-UninstallLog "Adim 2: bekleme sonrasi durum = $($svc.Status)"

    # Hala durmadiysa (servis surecinin kendisi hung/yanitsiz kalmis olabilir) son care
    # olarak process'i dogrudan zorla sonlandiriyoruz.
    if ($svc -and $svc.Status -ne 'Stopped') {
        $killed = Get-Process -Name 'SplitCordService' -ErrorAction SilentlyContinue
        Write-UninstallLog "Adim 2: hala durmadi, process dogrudan zorla kapatiliyor (PID: $($killed.Id -join ','))"
        $killed | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    sc.exe delete $ServiceName | Out-Null
    Write-UninstallLog "Adim 2: sc.exe delete cagrildi"
    Write-Host "SplitCord DPI Service kaldirildi."
} else {
    Write-Host "Servis zaten kurulu degil."
}

# 3) Servis kapanirken alt surecleri kendi de oldurmus olabilir ama garanti olsun diye
#    (ve process'in dogrudan zorla kapatildigi durumda alt surecler oksuz kalmis olabilir)
#    bir kez daha temizliyoruz.
Write-UninstallLog "Adim 3: DPI alt surecleri (ikinci tur) zorla kapatiliyor"
Stop-DpiChildProcesses

# 4) WinDivert surucu kaydi kalintisi: adi surume gore degisebildigi icin ("WinDivert",
#    "WinDivert64" vb.) desenle tariyoruz, bulunan her surucu servisini durdurup siliyoruz.
Write-UninstallLog "Adim 4: WinDivert surucu kayitlari taraniyor"
Get-Service -Name 'WinDivert*' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        sc.exe delete $_.Name | Out-Null
        Write-UninstallLog "Adim 4: WinDivert surucu kaydi kaldirildi: $($_.Name)"
        Write-Host "WinDivert surucu kaydi kaldirildi: $($_.Name)"
    } catch {
        Write-UninstallLog "Adim 4: WinDivert surucu kaldirma istisnasi ($($_.Name)): $($_.Exception.Message)"
    }
}

$finalSvc = Get-Process -Name 'SplitCordService' -ErrorAction SilentlyContinue
Write-UninstallLog "=== uninstall-service.ps1 bitti (SplitCordService hala calisiyor mu = $([bool]$finalSvc)) ==="
