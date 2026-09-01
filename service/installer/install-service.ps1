#Requires -RunAsAdministrator
<#
  SplitCord DPI Service'i Windows Service olarak kurar ve baslatir.
  Bu betik projedeki TEK elevation noktasidir: bir kez calistirilir (yonetici olarak),
  servis SYSTEM oturumunda otomatik baslangica alinir; sonrasinda Electron client hicbir
  zaman UAC istemez, servisle yalnizca yerel HTTP API uzerinden konusur.
#>
param(
    [string]$ServiceName = "SplitCordDpiService",
    [string]$ExePath = (Join-Path $PSScriptRoot "..\SplitCordService\bin\Release\net8.0-windows\publish\SplitCordService.exe")
)

$ErrorActionPreference = "Stop"

$resolvedExe = (Resolve-Path $ExePath -ErrorAction Stop).Path

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Servis zaten kurulu, durdurup guncelleniyor..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
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
