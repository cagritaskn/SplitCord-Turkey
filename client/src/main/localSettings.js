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
  // akış. 'manual': kullanıcı ByeDPI/GoodbyeDPI/Zapret arasında elle seçim yapıp
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
  // KULLANICI TALEBİ: Ayarlar > Görünüm'de açılınca özel titlebar'a (bkz. titlebar.css
  // .sc-titlebar) CSS "zoom: 0.5" uygulanır -- titlebar'ın layout boyutu (yüksekliği dahil)
  // GERÇEKTEN yarıya iner, içindeki her şey (logo, başlık metni, butonlar) orantılı olarak
  // küçülür; #content-area zaten flex:1 olduğu için boşalan alanı otomatik dolduruyor.
  smallTitlebar: false,
  // KULLANICI TALEBİ: Ayarlar > Görünüm'deki "SplitCord-Turkey başlığını göster/ortala" --
  // ikisi de varsayılan AÇIK (kullanıcının kendi tercihi) -- yalnızca ANA PENCEREdeki
  // "SplitCord-Turkey" başlığını etkiler (bkz. titlebar.css .sc-titlebar-title--app'in
  // üstündeki not, settings.html'in "Ayarlar" başlığı bundan hiç etkilenmiyor).
  showTitle: true,
  // centerTitle yalnızca showTitle açıkken görsel olarak anlamlı (kapalıyken başlık zaten
  // hiç görünmüyor) ama ayrı bir kalıcı değer olarak tutuluyor -- showTitle kapatılıp
  // tekrar açıldığında kullanıcının önceki centerTitle tercihi korunsun diye (autostart/
  // startInBackground'daki AYNI desen, bkz. settings.js updateStartInBackgroundVisibility).
  centerTitle: true,
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
    toggleCamera: '',
    toggleScreenShare: '',
    // KULLANICI TALEBİ: İleri git/Geri git -- varsayılan olarak mouse'un ekstra
    // tuşlarına atanmış (bkz. inputHook.js "Mouse4"/"Mouse5" formatı). DİKKAT: bu,
    // standart OS/tarayıcı kuralının (Mouse4=geri, Mouse5=ileri) TERSİ -- kullanıcının
    // kendi açık talebiyle Mouse4=ileri, Mouse5=geri olarak ayarlandı.
    navigateForward: 'Mouse4',
    navigateBack: 'Mouse5',
    // KULLANICI TALEBİ: Bas Konuş / Susturmak İçin Bas -- varsayılan atanmamış (bkz.
    // shortcuts.js holdActionsMap, inputHook.js "Key:<DOMCode>" formatı).
    pushToTalk: '',
    pushToMute: '',
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
  // sabit kimlikleri (ör. "firewall", "kaspersky", "eset", "service:zapret",
  // "external-goodbyedpi-process") — titlebar'daki genel "Eylem Gerekli" göstergesi
  // (bkz. ipc.js app:get-controls-issue-status) bu listedeki sorunları hasIssue
  // hesabına katmıyor. Kontroller ekranı sorunu yine de göstermeye devam ediyor, yalnızca
  // titlebar uyarısı bastırılıyor.
  ignoredControlIssues: [],
  // Ayarlar > Genel — açıkken Discord'un web istemcisindeki "mikrofonundan ses
  // alamıyor" uyarısı (Hata: 3002) hiç gösterilmez (bkz. discordWebviewPreload.js
  // setupVoiceWarningNoticeHandler). Bu uyarı genelde yanlış alarm olsa da (kullanıcı
  // henüz konuşmadığında da tetikleniyor) yine de gerçek bir mikrofon sorununu
  // gizleyebileceği için varsayılan KAPALI — kullanıcı bilinçli olarak açmalı.
  disableFalseVoiceWarning: false,
  // KULLANICI TALEBİ: Ayarlar > Genel'deki "Hatalı metinleri vurgulamayı devre dışı
  // bırak" -- Chromium'un yerleşik yazım denetleyicisi sohbet kutusunda hatalı/tanınmayan
  // kelimelerin altını kırmızı zikzak çizgiyle çiziyordu. VARSAYILAN AÇIK (yazım denetimi
  // varsayılan olarak KAPALI/gösterilmiyor) -- kullanıcı isterse kapatıp (yazım denetimini
  // AÇIP) geri getirebilir. session.setSpellCheckerEnabled() ile uygulanıyor (bkz.
  // permissions.js applySpellcheckSetting) -- yeniden başlatma GEREKMİYOR, QUIC'in aksine
  // runtime'da anında etkili.
  disableSpellcheckHighlight: true,
  // Ayarlar > Genel'de (ya da webview'de ERR_QUIC_PROTOCOL_ERROR alındığında çıkan
  // "QUIC'i Devre Dışı Bırak" butonundan) kapatılabilir. Zapret2/Zapret/GoodbyeDPI'nin
  // WinDivert filtreleri yalnızca TCP'yi hedefliyor, QUIC (UDP:443) hiçbir DPI aşım
  // motorunun kapsama alanına girmiyor — bazı ISP'ler QUIC'i ayrıca bozup/kesip
  // ERR_QUIC_PROTOCOL_ERROR'a yol açabiliyor. Açıkken Chromium'a 'disable-quic' komut
  // satırı anahtarı verilir (yalnızca app.whenReady()'den ÖNCE etkili olur, bkz.
  // index.js), Discord QUIC hiç denemeden doğrudan TCP/TLS'e (DPI motorlarının
  // kapsama alanına) düşer.
  quicDisabled: false,
  // KULLANICI TALEBİ: Vencord'un (GPL-3.0, github.com/Vendicated/Vencord) "web" hedefi için
  // derlenmiş, salt tarayıcı-uyumlu paketini (resources/vencord/browser.js + browser.css)
  // Discord webview'inin ANA dünyasına enjekte eder (bkz. discordWebviewPreload.js
  // setupVencordInjection). Bu paket masaüstüne özgü değil: Vencord'un kendi
  // VencordNativeStub.ts'i (native/Electron IPC yerine localStorage/IndexedDB kullanıyor)
  // sayesinde native bir köprü YAZMAMIZA gerek kalmadan doğrudan çalışıyor. Varsayılan KAPALI
  // ve değişikliği uygulamak için webview'in yeniden yüklenmesi gerekiyor (bkz. ipc.js
  // vencord:set-enabled) -- ÇÜNKÜ Discord'un ToS'u üçüncü taraf istemci değişikliklerini
  // yasaklıyor (hesap aksiyonu riski DPI aşımından TAMAMEN AYRI bir risk kategorisi);
  // kullanıcı Ayarlar'daki net uyarıyı görüp BİLEREK açmalı.
  vencordEnabled: false,
};

// GERÇEK BUG (canlı testte bulundu): düz {...DEFAULTS, ...saved} yalnızca BİRİNCİ
// seviyeyi birleştiriyor -- "shortcuts" gibi iç içe bir nesne varsa, saved.shortcuts
// DEFAULTS.shortcuts'ın TAMAMININ yerini alır (deep merge DEĞİL). Yani mevcut bir
// kurulumda daha önce kaydedilmiş bir local-settings.json varsa ve biz DEFAULTS.shortcuts'a
// SONRADAN yeni bir eylem eklersek (ör. navigateForward: 'Mouse4'), o eylem eski
// kullanıcılarda hiç var olmaz (undefined -> "atanmamış" gibi davranır, varsayılanı
// asla görmez) -- saved.shortcuts'ta hiç yokken DEFAULTS.shortcuts'ta olan bir anahtar
// sessizce kaybolur. Bu yüzden "shortcuts" özel olarak bir seviye derin birleştiriliyor.
function readLocalSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    const saved = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...saved,
      shortcuts: { ...DEFAULTS.shortcuts, ...(saved.shortcuts || {}) },
    };
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
