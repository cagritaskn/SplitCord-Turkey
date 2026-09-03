; electron-builder NSIS custom kurulum adımları.
; perMachine=true olduğu için kurucu zaten yönetici olarak çalışıyor,
; bu yüzden aşağıdaki PowerShell çağrıları ekstra bir UAC istemi tetiklemez.
; Tek UAC istemi tüm kurulum süreci için burada, bir kez gerçekleşir.
;
; nsExec::ExecToLog (düz ExecWait yerine) süreci görünür bir konsol penceresi
; açmadan çalıştırır ve çıktısını yine de kurulum log'una yazar; -WindowStyle Hidden
; da PowerShell'in kendisine ek bir güvence olarak eklendi.

; KRİTİK — kullanıcı verisi kaybı: eski bir sürüm zaten kuruluyken yeni installer
; çalıştırıldığında, kurulum akışının bir yerinde (electron-builder'ın "assisted"/
; oneClick:false NSIS akışında TAM olarak ne zaman tetiklendiği bizim için opak) eski
; sürümün customUnInstall'ı da devreye girip kullanıcı verisini silebiliyor.
; customUnInstall'daki ${isUpdated} koruması (bkz. aşağı) TEK BAŞINA bunu her zaman
; engellemedi (canlı testte doğrulandı: koruma eklendikten SONRA bile bir güncelleme
; sırasında service-settings.json'ın silindiği görüldü — electron-builder'ın bu bayrağı
; assisted kurulum akışında ne zaman true/false yaptığı belgelenmemiş/güvenilir değil).
; Bu yüzden DAHA GÜVENİLİR, mekanizmadan bağımsız bir ikinci güvenlik ağı kuruyoruz:
; kurulumun EN BAŞINDA (herhangi bir dosya silinmeden/uninstall tetiklenmeden ÖNCE)
; kullanıcı verisini geçici bir NSIS eklenti dizinine ($PLUGINSDIR, kurulum bitince
; otomatik temizlenir) YEDEKLİYORUZ; customInstall'da bu yedek varsa VE asıl konum
; (muhtemelen bir uninstall tarafından silindiği için) GERÇEKTEN boşsa geri yüklüyoruz.
; Yedek yoksa (ilk kurulum) ya da asıl konum zaten doluysa (veri hiç silinmemiş) hiçbir
; şey yapılmıyor — bu yüzden hem ilk kurulumu hem "isUpdated koruması zaten işe yaradı"
; durumunu bozmuyor.
;
; KRİTİK #2 — canlı testte bulunan, çok daha temel bir bug: uninstall-service.ps1'i
; customUnInstall içinden "$INSTDIR\resources\service-installer\uninstall-service.ps1"
; yolundan çalıştırmaya çalışıyorduk — ama electron-builder'ın standart NSIS kaldırma akışı
; $INSTDIR altındaki dosyaları customUnInstall ÇAĞRILMADAN ÖNCE siliyor, script HİÇ
; ÇALIŞMADAN "dosya bulunamadı" ile başarısız oluyordu (canlı testte NSIS'in kendi
; FileExists kontrolüyle kesin olarak doğrulandı). "Dosyalar silinmeden önce script'i
; customInit'te $PLUGINSDIR'a kopyala" gibi bir ilk düzeltme de İŞE YARAMADI — çünkü
; customInit YALNIZCA KURULUMUN kendi .onInit'ine ekleniyor, bağımsız "Uninstall.exe"
; çalıştırıldığında (customInit'in asıl kullanım senaryosu olan "yeni sürüm kurulurken
; eskiyi sessizce kaldırma" DIŞINDA) hiç tetiklenmiyor (canlı testte ayrı bir NSIS
; FileWrite işaretiyle doğrulandı). KALICI ÇÖZÜM: script'i $INSTDIR'daki kopyaya hiç
; bağımlı olmadan, NSIS'in "File" komutuyla DERLEME ZAMANINDA doğrudan kaldırıcı .exe'nin
; İÇİNE gömüyoruz (electron-builder'ın kendi NSIS derlemesi sırasında, ${__FILEDIR__} bu
; installer.nsh'nin kendi dizinini verir) — çalışma zamanında $PLUGINSDIR'a çıkarılan bu
; gömülü kopya, $INSTDIR'da NE OLURSA OLSUN her zaman mevcut.
; KRİTİK #3 — asıl kök neden (bu turda, electron-builder'ın kendi şablon kaynağı
; doğrudan okunarak bulundu): electron-builder'ın çalışan uygulamayı kapatan
; CHECK_APP_RUNNING/taskkill adımı (installSection.nsh) yalnızca "install" Section'ında
; çalışıyor — customInit ise .onInit içinde, o Section'dan ÖNCE tetikleniyor
; (installer.nsi:70-74 vs installSection.nsh:33-38). Yani güncelleme sırasında bu
; yedekleme, kullanıcı henüz kapatılmamış ESKİ uygulama HÂLÂ AÇIKKEN çalışıyordu.
; Chromium, persist:discord partition'ındaki Cookies/LevelDB/IndexedDB dosyalarını
; uygulama açıkken kilitli tutar; CopyFiles /SILENT bu kilitli dosyaları hatasız/sessizce
; ATLAR. Sonuç: yedek "var" görünüyordu ama TAM OLARAK giriş oturumunu tutan dosyalar
; eksikti — restore sonrası hesap/oturum kayboluyordu, kilitli olmayan diğer ayarlar ise
; sorunsuz görünüyordu. Düzeltme: yedeklemeden ÖNCE, hâlâ açık olabilecek eski uygulamayı
; burada kendimiz kapatıp dosya tanıtıcılarının serbest kalmasını bekliyoruz —
; electron-builder'ın kendi taskkill'i daha sonra (Section içinde) yine çalışacak, o an
; süreç zaten kapalı olduğu için zararsız bir no-op'a dönüşecek.
!macro customInit
  InitPluginsDir

  DetailPrint "Varsa açık SplitCord-Turkey oturumu kapatılıyor (veri yedeklemesi öncesi)..."
  nsExec::Exec 'taskkill /im "SplitCord-Turkey.exe" /t'
  Sleep 2000
  nsExec::Exec 'taskkill /f /im "SplitCord-Turkey.exe" /t'
  Sleep 500

  ${IfNot} ${FileExists} "$APPDATA\splitcord-client\*.*"
  ${Else}
    CreateDirectory "$PLUGINSDIR\sc-backup-appdata"
    CopyFiles /SILENT "$APPDATA\splitcord-client\*.*" "$PLUGINSDIR\sc-backup-appdata"
  ${EndIf}

  ${IfNot} ${FileExists} "$%ProgramData%\SplitCord\*.*"
  ${Else}
    CreateDirectory "$PLUGINSDIR\sc-backup-programdata"
    CopyFiles /SILENT "$%ProgramData%\SplitCord\*.*" "$PLUGINSDIR\sc-backup-programdata"
  ${EndIf}
!macroend

!macro customInstall
  ; bkz. yukarıdaki customInit notu — servis başlamadan (ve kendi varsayılan ayar
  ; dosyasını diske yazmadan) ÖNCE, olası bir silinmeyi geri yüklüyoruz.
  ${IfNot} ${FileExists} "$APPDATA\splitcord-client\*.*"
  ${AndIf} ${FileExists} "$PLUGINSDIR\sc-backup-appdata\*.*"
    DetailPrint "Kullanıcı ayarları önceki sürümden geri yükleniyor..."
    CreateDirectory "$APPDATA\splitcord-client"
    CopyFiles /SILENT "$PLUGINSDIR\sc-backup-appdata\*.*" "$APPDATA\splitcord-client"
  ${EndIf}

  ${IfNot} ${FileExists} "$%ProgramData%\SplitCord\*.*"
  ${AndIf} ${FileExists} "$PLUGINSDIR\sc-backup-programdata\*.*"
    DetailPrint "Servis ayarları önceki sürümden geri yükleniyor..."
    CreateDirectory "$%ProgramData%\SplitCord"
    CopyFiles /SILENT "$PLUGINSDIR\sc-backup-programdata\*.*" "$%ProgramData%\SplitCord"
  ${EndIf}

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

  ; bkz. yukarıdaki "KRİTİK #2" notu — $INSTDIR'daki kopyaya (silinmiş olabilir) hiç
  ; bağımlı olmadan, DERLEME ZAMANINDA kaldırıcının içine gömülmüş kopyayı $PLUGINSDIR'a
  ; çıkarıyoruz. -OriginalScriptDir, script'in KENDİ (artık $PLUGINSDIR'da olan) konumu
  ; yerine bundled Cygwin/blockcheck2 dizinlerini hâlâ doğru bulabilmesi için orijinal
  ; kurulum yolunu veriyor (o dizin de silinmiş olabilir, script bunu try/catch ile
  ; zaten zarafetle atlıyor).
  SetOutPath "$PLUGINSDIR"
  File "/oname=uninstall-service.ps1" "${PROJECT_DIR}\..\service\installer\uninstall-service.ps1"

  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\uninstall-service.ps1" -OriginalScriptDir "$INSTDIR\resources\service-installer"'
  Pop $0
  DetailPrint "SplitCord DPI Service kaldırma çıkış kodu: $0"

  ; electron-builder'ın NSIS şablonu (uninstaller.nsh, Section "un.install") bu
  ; customUnInstall makrosunu YALNIZCA kullanıcının Denetim Masası'ndan/kısayoldan GERÇEKTEN
  ; kaldırma yaptığı durumda DEĞİL, YENİ bir sürüm kurulurken kurulumun kendi içinden
  ; TETİKLEDİĞİ dahili (sessiz) uninstall adımında da çağırabiliyor. electron-builder'ın
  ; kendi ${isUpdated} bayrağıyla bunu ayırt etmeye çalışıyoruz (kendi
  ; "DELETE_APP_DATA_ON_UNINSTALL" mantığı da bunun için ${ifNot} ${isUpdated} kullanıyor)
  ; ama bu TEK BAŞINA yeterli değil (bkz. customInit'teki yedekleme notu — asıl güvenlik
  ; ağı orada) — yine de burada da bırakıyoruz, ikisi birlikte çift katmanlı koruma sağlıyor.
  ${ifNot} ${isUpdated}
    ; Kaldırma GERÇEK bir temizlik olmalı: hem Electron istemcisinin kullanıcı verisini
    ; (local-settings.json + Discord oturumu/çerezleri persist:discord partition'ında
    ; saklanıyor) hem de servisin kendi DPI ayarlarını (%ProgramData%\SplitCord — doğrulanmış
    ; ByeDPI stratejisi, DNS sağlayıcıları, vb.) siliyoruz. uninstall-service.ps1 artık
    ; yalnızca servis kaydını silmekle kalmıyor — winws.exe/ciadpi.exe/goodbyedpi.exe'yi
    ; zorla kapatıp servisin GERÇEKTEN durduğunu bekliyor ve WinDivert sürücü kalıntılarını
    ; da temizliyor (bkz. o dosyadaki not) — bu yüzden burada da artık dosya kilidi riski yok.
    ; Aksi halde yeniden kurulumda eski hesap/ayarlar sessizce geri geliyordu.
    DetailPrint "Kullanıcı ayarları ve Discord oturumu temizleniyor..."
    ; canlı testte doğrulandı: Electron istemcisi (splitcord.log'a yazan) az önce
    ; kapanmışsa bir dosya tanıtıcısı (ör. Windows Defender'ın anlık taraması) bir an
    ; için hâlâ serbest kalmamış olabiliyor, TEK bir RMDir denemesi bu yüzden sessizce
    ; eksik/kısmi kalabiliyordu — birkaç kez, artan bir bekleme ile tekrar deniyoruz
    ; (klasör zaten yoksa/silindiyse bu no-op, zararsız).
    RMDir /r "$APPDATA\splitcord-client"
    ${If} ${FileExists} "$APPDATA\splitcord-client\*.*"
      Sleep 2000
      RMDir /r "$APPDATA\splitcord-client"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\splitcord-client\*.*"
      Sleep 3000
      RMDir /r "$APPDATA\splitcord-client"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\splitcord-client\*.*"
      Sleep 5000
      RMDir /r "$APPDATA\splitcord-client"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\splitcord-client\*.*"
      Sleep 8000
      RMDir /r "$APPDATA\splitcord-client"
    ${EndIf}

    DetailPrint "Servis ayarları temizleniyor..."
    RMDir /r "$%ProgramData%\SplitCord"
  ${endIf}

  ; Kaldırma GERÇEKTEN tam olmalı: electron-builder'ın kendi otomatik üretilen dosya
  ; silme listesi, "resources\service-installer\" altındaki .NET servis dosyalarını
  ; (extraResources ile kopyalanıyor, normal "File" paketleme akışının dışında) kapsamıyor
  ; gibi görünüyor — canlı testte doğrulandı: servis tamamen durdurulmuş olmasına rağmen bu
  ; dosyalar kaldırma sonrası hâlâ diskte kalıyordu. NOT: burada TÜM "$INSTDIR"'ı silmeyi
  ; DENEDİK ama başarısız oldu — o anda ÇALIŞMAKTA OLAN "Uninstall SplitCord-Turkey.exe"
  ; da $INSTDIR'ın kendisinin İÇİNDE yaşıyor, kendi çalışan .exe'sini/üst dizinini
  ; silemiyor (Windows dosya kilidi). Bu yüzden yalnızca UNINSTALLER'IN KENDİSİNİ
  ; İÇERMEYEN alt dizini hedefliyoruz.
  RMDir /r "$INSTDIR\resources\service-installer"
!macroend
