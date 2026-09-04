'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

// app.disableHardwareAcceleration() yalnızca app 'ready' olmadan ÖNCE çağrılabilir,
// yani bu ayarı Electron tam olarak başlamadan (app.getPath('userData') güvenle
// kullanılabilir olsa da) senkron şekilde okuyabilmemiz gerekiyor. Bu yüzden DPI
// Service'in HTTP API'sine değil, doğrudan bir yerel JSON dosyasına yazıyoruz.
function getSettingsPath() {
  try {
    return path.join(app.getPath('userData'), 'local-settings.json');
  } catch {
    // app.getPath bazı erken çağrılarda başarısız olabilir; en kötü ihtimalle
    // standart Windows yolunu elle kur.
    return path.join(os.homedir(), 'AppData', 'Roaming', 'splitcord-client', 'local-settings.json');
  }
}

const DEFAULTS = {
  gpuAcceleration: true,
  // 'automatic': ByeDPI argümanlarını sırayla deneyip çalışanı otomatik kaydeden mevcut
  // akış. 'manual': kullanıcı ByeDPI/Zapret/Zapret2 arasında elle seçim yapıp
  // argümanları kendi düzenleyebilir (bkz. settings.js panel-dpi).
  dpiMode: 'automatic',
  // 'automatic': pencere/titlebar rengi Discord sayfasının arkaplanından canlı olarak
  // örnekleniyor (bkz. dynamicColor.js). 'light'/'ash'/'dark'/'onyx': sabit bir tohum
  // renkten (aynı göreceli palet mantığıyla) üretilen sabit tema.
  themeMode: 'automatic',
  // Açıkken (varsayılan) Discord içindeki harici linkler sistemin varsayılan
  // tarayıcısında açılır; kapalıyken Electron'un kendi yeni pencere davranışıyla
  // (uygulama içi bir popup penceresi) açılır (bkz. window.js setWindowOpenHandler).
  openLinksExternally: true,
  // Kapalıyken (varsayılan): titlebar'daki "+" butonuyla eklenen discord.gg/discord.com
  // bağlantıları ana penceredeki webview'in yerini alır. Açıkken ayrı bir
  // BrowserWindow'da (aynı persist:discord oturumuyla) açılır (bkz. titlebar.js
  // submitLinkOpener).
  linkOpenerNewWindow: false,
  // Açıkken: dinamik renk örnekleme/geçiş animasyonları ve periyodik arkaplan
  // taramaları gibi göreceli olarak pahalı işler devre dışı kalır (bkz. ipc.js,
  // dynamicColor.js, theme.css performance-mode kuralı).
  performanceMode: false,
  // Ayarlar > Tuş Atamaları'ndaki ana anahtar — kapalıyken aşağıdaki hiçbir kombinasyon
  // sistem genelinde kayıtlı olmuyor (bkz. shortcuts.js applyShortcutsFromSettings).
  globalShortcutsEnabled: true,
  // Her eylem için Electron accelerator string'i (ör. "CommandOrControl+Shift+D");
  // boş string = atanmamış. toggleMute/toggleDeafen'ın varsayılanları önceki (sabit
  // kodlanmış) sürümle aynı tutuldu ki mevcut kullanıcılar bir davranış kaybetmesin.
  shortcuts: {
    toggleMute: 'CommandOrControl+Alt+Shift+M',
    toggleDeafen: 'CommandOrControl+Shift+D',
    disconnect: '',
    bringToFront: 'CommandOrControl+Shift+H',
    minimizeToTray: '',
  },
  // Ayarlar > Genel'de kapatılabilir — açıkken (varsayılan) tray ikonu "standart"
  // durumdayken (ses kanalında değilken) okunmamış Discord bildirimi varsa ikona kırmızı
  // bir rozet ekleniyor (bkz. notificationBadge.js, tray.js).
  notificationBadgeEnabled: true,
  // Otomatik başlatma/arkaplanda başlatma tercihleri bu dosyada DEĞİL, doğrudan OS
  // login item kaydında tutuluyor (bkz. autostart.js) — bu bayrak yalnızca "varsayılan
  // açık" durumunun bir KEZ uygulanıp uygulanmadığını izlemek için var; kullanıcı
  // sonradan kapatırsa bir sonraki açılışta tekrar zorla açılmasın diye (bkz. index.js).
  autostartDefaultApplied: false,
  // Ayarlar > İzinler ve Kontroller'de "Görmezden Gel" ile kapatılan sorun türlerinin
  // sabit kimlikleri — titlebar'daki genel "Eylem Gerekli" göstergesi (bkz. ipc.js
  // app:get-controls-issue-status) bu listedeki sorunları hasIssue hesabına katmıyor.
  // Windows'ta "firewall"/"kaspersky"/"eset"/"service:*"/"external-*-process" gibi birçok
  // ek kimlik vardı — Linux'ta yalnızca "official-discord" gerçekçi (bkz. PORTING_PLAN.md
  // D-9, protocolHandler.js).
  ignoredControlIssues: [],
  // Ayarlar > Genel — açıkken Discord'un web istemcisindeki "mikrofonundan ses
  // alamıyor" uyarısı (Hata: 3002) hiç gösterilmez (bkz. discordWebviewPreload.js
  // setupVoiceWarningNoticeHandler). Bu uyarı genelde yanlış alarm olsa da (kullanıcı
  // henüz konuşmadığında da tetikleniyor) yine de gerçek bir mikrofon sorununu
  // gizleyebileceği için varsayılan KAPALI — kullanıcı bilinçli olarak açmalı.
  disableFalseVoiceWarning: false,
  // Ayarlar > Genel'de (ya da webview'de ERR_QUIC_PROTOCOL_ERROR alındığında çıkan
  // "QUIC'i Devre Dışı Bırak" butonundan) kapatılabilir. Zapret2/Zapret'in NFQUEUE
  // kuralları yalnızca TCP'yi hedefliyor, QUIC (UDP:443) hiçbir DPI aşım
  // motorunun kapsama alanına girmiyor — bazı ISP'ler QUIC'i ayrıca bozup/kesip
  // ERR_QUIC_PROTOCOL_ERROR'a yol açabiliyor. Açıkken Chromium'a 'disable-quic' komut
  // satırı anahtarı verilir (yalnızca app.whenReady()'den ÖNCE etkili olur, bkz.
  // index.js), Discord QUIC hiç denemeden doğrudan TCP/TLS'e (DPI motorlarının
  // kapsama alanına) düşer.
  quicDisabled: false,
};

function readLocalSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeLocalSettings(partial) {
  const current = readLocalSettings();
  const next = { ...current, ...partial };
  try {
    const settingsPath = getSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  } catch {
    // Diske yazılamazsa bile bellekteki değeri döndür; bir sonraki açılışta
    // varsayılana döner ama en azından bu oturumda uygulama çökmez.
  }
  return next;
}

// Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" için — dosyayı silmek, bir sonraki
// readLocalSettings() çağrısının saf DEFAULTS dönmesi için yeterli.
function resetLocalSettings() {
  try {
    fs.unlinkSync(getSettingsPath());
  } catch {
    // Dosya zaten yoksa (ör. hiç ayar değiştirilmemişse) sorun değil.
  }
  return { ...DEFAULTS };
}

module.exports = { readLocalSettings, writeLocalSettings, resetLocalSettings };
