#Requires -RunAsAdministrator
<#
  SplitCord DPI Service'i Windows Service olarak kurar ve baslatir.
  Bu betik projedeki TEK elevation noktasidir: bir kez calistirilir (yonetici olarak),
  servis SYSTEM oturumunda otomatik baslangica alinir; sonrasinda Electron client hicbir
  zaman UAC istemez, servisle yalnizca yerel HTTP API uzerinden konusur.

  NOT — canlı testte uninstall-service.ps1'de bulunan bug BURADA da mümkündü: eski bir
  kurulumdan (özellikle bu sağlamlaştırmadan ÖNCEKİ bir sürümden) kalma servis "beklenmedik
  sonlanmada otomatik yeniden başlat" kaydına sahipse, düz "Stop-Service -Force; sc.exe
  delete" bu yeniden başlatmayla yarışabiliyor — servis siliniyor GİBİ görünüp arkada
  otomatik olarak yeniden canlanabiliyor, "New-Service" de aynı isimle çakışıp
  başarısız olabiliyordu. Eskiyi temizleme adımı artık uninstall-service.ps1'deki AYNI
  sağlamlaştırılmış deseni kullanıyor: önce otomatik-yeniden-başlatma kaydı sıfırlanıyor,
  sonra servisin GERÇEKTEN durduğu aktif olarak bekleniyor, hâlâ durmadıysa süreç doğrudan
  zorla sonlandırılıyor, ayrıca artık DPI alt süreçleri ve WinDivert sürücü kayıtları da
  (eski, hatalı şekilde kalmış bir kurulumdan miras kalmış olabilecekleri için) temizleniyor.
#>
param(
    [string]$ServiceName = "SplitCordDpiService",
    [string]$ExePath = (Join-Path $PSScriptRoot "..\SplitCordService\bin\Release\net8.0-windows\publish\SplitCordService.exe")
)

$ErrorActionPreference = "Stop"

$resolvedExe = (Resolve-Path $ExePath -ErrorAction Stop).Path

function Stop-DpiChildProcesses {
    # bkz. uninstall-service.ps1'deki aynı fonksiyon/notlar -- bu isimler yalnızca
    # SplitCord'un kendi bundled binary'lerine ait, sistem genelinde güvenle kapatılabilir.
    $names = @('winws', 'winws2', 'ciadpi', 'goodbyedpi', 'dnsproxy')
    foreach ($name in $names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Servis zaten kurulu, durdurup guncelleniyor..."

    # Eski kurulumun kendi otomatik-yeniden-baslatma kaydi varsa (asagida YENIDEN
    # yazilacak zaten), Stop-Service'in bununla yarismasini onlemek icin once sifirliyoruz.
    sc.exe failure $ServiceName reset= 0 actions= "" | Out-Null

    Stop-DpiChildProcesses
    try { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue } catch {}

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') { break }
        Start-Sleep -Milliseconds 500
    }

    # Hala durmadiysa (eski servis surecinin kendisi hung/yanitsiz kalmis olabilir) son
    # care olarak process'i dogrudan zorla sonlandiriyoruz -- New-Service'in ayni isimle
    # cakismasini onlemek icin bu adim kritik.
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
        Get-Process -Name 'SplitCordService' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    Stop-DpiChildProcesses
}

# Eski, hatali sekilde kalmis bir kurulumdan miras kalmis olabilecek WinDivert surucu
# kayitlarini da (adi surume gore degisebildigi icin desenle) temizliyoruz -- bkz.
# uninstall-service.ps1'deki ayni adim, gerekce orada.
Get-Service -Name 'WinDivert*' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        sc.exe delete $_.Name | Out-Null
    } catch {}
}

New-Service -Name $ServiceName `
    -BinaryPathName "`"$resolvedExe`"" `
    -DisplayName "SplitCord DPI Bypass Service" `
    -Description "SplitCord Turkey icin arkaplanda calisan DPI asim servisi (ByeDPI/GoodbyeDPI/Zapret)." `
    -StartupType Automatic | Out-Null

# Servis coksede otomatik yeniden baslatilsin (WinDivert surucu yuklemesi ilk denemede
# nadiren basarisiz olabiliyor).
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Start-Service -Name $ServiceName

Write-Host "SplitCord DPI Service kuruldu ve baslatildi."
Write-Host "Durumu kontrol etmek icin: sc query $ServiceName"
