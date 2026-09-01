; electron-builder NSIS custom kurulum adımları.
; perMachine=true olduğu için kurucu zaten yönetici olarak çalışıyor,
; bu yüzden aşağıdaki PowerShell çağrıları ekstra bir UAC istemi tetiklemez.
; Tek UAC istemi tüm kurulum süreci için burada, bir kez gerçekleşir.
;
; nsExec::ExecToLog (düz ExecWait yerine) süreci görünür bir konsol penceresi
; açmadan çalıştırır ve çıktısını yine de kurulum log'una yazar; -WindowStyle Hidden
; da PowerShell'in kendisine ek bir güvence olarak eklendi.

!macro customInstall
  DetailPrint "SplitCord DPI Service kuruluyor..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-installer\install-service.ps1" -ExePath "$INSTDIR\resources\service-installer\SplitCordService.exe"'
  Pop $0
  DetailPrint "SplitCord DPI Service kurulum çıkış kodu: $0"

  ; Sessiz (/S) kurulum — yalnızca otomatik güncelleme akışında (updateChecker.js) kullanılır —
  ; normal sihirbazın "bitince çalıştır" adımını hiç göstermiyor, bu yüzden uygulamayı burada
  ; elle başlatıyoruz. explorer.exe üzerinden başlatmak, kurucunun kendi (yönetici) bağlamını
  ; devralmadan normal kullanıcı yetkisiyle çalışmasını sağlıyor — Electron istemcisi ASLA
  ; yönetici olarak çalışmamalı (mimarinin temel kuralı, bkz. servis/istemci ayrımı).
  IfSilent 0 +2
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\SplitCord-Turkey.exe"'
!macroend

!macro customUnInstall
  DetailPrint "SplitCord DPI Service kaldırılıyor..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-installer\uninstall-service.ps1"'
  Pop $0
  DetailPrint "SplitCord DPI Service kaldırma çıkış kodu: $0"

  ; Kaldırma GERÇEK bir temizlik olmalı: hem Electron istemcisinin kullanıcı verisini
  ; (local-settings.json + Discord oturumu/çerezleri persist:discord partition'ında
  ; saklanıyor) hem de servisin kendi DPI ayarlarını (%ProgramData%\SplitCord — doğrulanmış
  ; ByeDPI stratejisi, DoH sağlayıcıları, vb.) siliyoruz. Servis yukarıda zaten durdurulup
  ; kaydı silindiği için (senkron nsExec::ExecToLog çağrısı) dosya kilidi riski yok.
  ; Aksi halde yeniden kurulumda eski hesap/ayarlar sessizce geri geliyordu.
  DetailPrint "Kullanıcı ayarları ve Discord oturumu temizleniyor..."
  RMDir /r "$APPDATA\splitcord-client"

  DetailPrint "Servis ayarları temizleniyor..."
  RMDir /r "$%ProgramData%\SplitCord"
!macroend
