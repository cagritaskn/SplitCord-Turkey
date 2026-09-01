#Requires -RunAsAdministrator
param([string]$ServiceName = "SplitCordDpiService")

$ErrorActionPreference = "Stop"

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Write-Host "SplitCord DPI Service kaldirildi."
} else {
    Write-Host "Servis zaten kurulu degil."
}
