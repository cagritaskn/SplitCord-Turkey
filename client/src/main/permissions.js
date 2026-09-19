'use strict';

const { session } = require('electron');
const { readLocalSettings } = require('./localSettings');

const DISCORD_PARTITION = 'persist:discord';
const ALLOWED_ORIGIN_SUFFIXES = ['discord.com', 'discordapp.com', 'discord.media', 'discord.gg'];
// clipboard-sanitized-write olmadan Discord'un "Kullanıcı ID'sini Kopyala" gibi
// navigator.clipboard.writeText() kullanan tüm özellikleri sessizce başarısız oluyordu
// (normal bir tarayıcı sekmesinde bu izin sorgusu hiç görünmez/otomatik izinlidir, ama
// Electron'un handler'ı her izni bizim listemize göre süzüyor).
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'fullscreen',
  'display-capture',
  'clipboard-read',
  'clipboard-sanitized-write',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return ALLOWED_ORIGIN_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

// GERÇEK BUG (kullanıcı raporu, canlı testte doğrulandı): bir Discord Aktivitesini
// (Wordle) "Pencere Modu"na alınca window.js'teki popout kontrolü isAllowedOrigin()
// kullanıyordu ve pencereyi "harici" sayıp sistem tarayıcısına gönderiyordu -- çünkü
// "Pencere Modu"nun window.open() çağrısı Aktivitenin KENDİ iframe'inden (ör.
// https://<app_id>.discordsays.com) geliyor, discord.com'dan DEĞİL; discordsays.com
// yukarıdaki ALLOWED_ORIGIN_SUFFIXES'te yok.
//
// discordsays.com'u DOĞRUDAN ALLOWED_ORIGIN_SUFFIXES'e EKLEMEDİK: o liste AYNI ZAMANDA
// media/display-capture gibi YÜKSEK RİSKLİ izinleri de kontrol ediyor (bkz. yukarıdaki
// CVE-2026-70599 notu) -- discordsays.com Discord'un KENDİ alan adı olsa da, ÜZERİNDE
// ÇALIŞAN İÇERİK üçüncü taraf (Aktivite geliştiricisi) kodu; bu yüzden Activities'in
// discord.com'un medya izinlerini yanlışlıkla MİRAS ALMASINI ÖNLEMEK zaten bilinçli bir
// tasarım kararıydı, bunu geri almak istemiyoruz. Ama "bu pencere uygulama içinde mi
// yoksa harici tarayıcıda mı açılsın" kararı ÇOK DAHA DÜŞÜK RİSKLİ (ek bir izin/erişim
// VERMİYOR, yalnızca GÖRÜNTÜLEME yerini belirliyor) -- bu yüzden popout kontrolü için
// discordsays.com'u da içeren AYRI, daha geniş bir liste kullanılıyor.
const POPOUT_ALLOWED_ORIGIN_SUFFIXES = [...ALLOWED_ORIGIN_SUFFIXES, 'discordsays.com'];

function isAllowedPopoutOrigin(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return POPOUT_ALLOWED_ORIGIN_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/**
 * Mikrofon/kamera (sesli-görüntülü konuşma) ve native bildirim izinlerini yalnızca
 * discord.com kökenli içerik için otomatik onaylar. Başka hiçbir origin bu izinleri alamaz.
 *
 * GÜVENLİK (CVE-2026-70599, Electron <39.8.7/<40.9.0/<41.2.0 — kullandığımız 31.x de
 * etkileniyor): `requestingUrl` (request handler) ve `requestingOrigin` (check handler)
 * parametreleri, medya izinleri için ÇAPRAZ KÖKENLİ bir alt çerçeveden (ör. Discord
 * "Activities"/oyun gömme ya da üçüncü taraf bir embed) gelen isteklerde YANLIŞLIKLA üst
 * çerçevenin (discord.com) kökenini döndürebiliyor — yani sayfa içine gömülü, listemizde
 * OLMAYAN bir köken, yalnızca üst çerçeve discord.com olduğu için `media`/`display-capture`
 * (ekran paylaşımı) iznini haksız yere alabiliyordu. Electron'un kendi tavsiyesi: medya
 * kontrollerinde `details.securityOrigin` bu hataya kapalı, gerçek isteği yapan çerçevenin
 * kökenini veriyor — bu yüzden mevcutsa ÖNCELİKLE o kullanılıyor, yalnızca securityOrigin
 * doldurulmamışsa (ör. clipboard/notifications gibi medya-dışı izinler) eski alanlara
 * düşülüyor.
 */
function registerPermissions() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);

  discordSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details.securityOrigin || details.requestingUrl || webContents.getURL();
    callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(origin));
  });

  discordSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(details?.securityOrigin || requestingOrigin),
  );
}

/**
 * Electron'un varsayılan User-Agent'ı "...Chrome/x.y Electron/x.y.z Safari/537.36" gibi
 * "Electron" ibaresi taşır. Discord'un web istemcisi bunu görünce "resmi masaüstü
 * uygulamasının bozuk/eksik bir kopyası" sanıp bazı özellikleri (ör. ekran paylaşımı)
 * "önce uygulamayı indir" mesajıyla engelliyor. UA'yı normal bir masaüstü Chrome'a
 * çevirince Discord bizi sıradan bir tarayıcı sekmesi gibi görüyor ve web tabanlı
 * (getDisplayMedia) ekran paylaşımı akışını (ki Chrome'da zaten çalışıyor) kullanıyor.
 * Chrome sürüm numarasını process.versions.chrome'dan alıyoruz ki Electron güncellensin
 * diye elle güncellemek gerekmesin.
 */
function configureBrowserIdentity() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
  discordSession.setUserAgent(userAgent);
}

/**
 * KULLANICI TALEBİ: Ayarlar > Genel > "Hatalı metinleri vurgulamayı devre dışı bırak" --
 * Chromium'un yerleşik yazım denetleyicisini (sohbet kutusundaki kırmızı zikzak altı
 * çizgi) açıp kapatır. session.setSpellCheckerEnabled() QUIC'in aksine yalnızca
 * app.whenReady() öncesinde DEĞİL, runtime'da HER AN çağrılabiliyor -- bu yüzden hem
 * başlangıçta (index.js) hem de ayar her değiştiğinde (ipc.js) yeniden çağrılıyor,
 * yeniden başlatma gerekmiyor.
 */
function applySpellcheckSetting(disableHighlight) {
  const discordSession = session.fromPartition(DISCORD_PARTITION);
  discordSession.setSpellCheckerEnabled(!disableHighlight);
}

// KULLANICI TALEBİ (kullanıcı raporu, canlı testte doğrulandı): Vencord etkinken Eklentiler
// (Plugins) sekmesi sorunsuz çalışıyor ama Temalar (Themes) ve Online Themes sekmesinden
// yüklenen HİÇBİR tema uygulanmıyordu. Kök neden: Vencord'un "web" hedefi (bkz.
// client/resources/vencord/browser.js) tema CSS'ini doğrudan inline <style> içeriği olarak
// DEĞİL, her temayı bir Blob'a sarıp URL.createObjectURL() ile blob: URL'sine çevirip
// "@import url(\"blob:...\")" şeklinde enjekte ediyor (eklenti CSS'i ise doğrudan inline
// metin -- bu yüzden yalnızca temalar etkileniyordu). Discord'un KENDİ, hiç dokunmadığımız
// Content-Security-Policy başlığındaki style-src yönergesi blob: kaynağına izin vermediği
// için tarayıcı bu @import'u REDDEDİYORDU (konsolda "violates... style-src" hatası) -- tema
// listede görünüp anahtarı açılabiliyordu ama görsel olarak HİÇBİR ZAMAN uygulanmıyordu.
// Vesktop gibi diğer Electron tabanlı Vencord sarmalayıcılarının kullandığı standart çözüm:
// Discord partition'ının yanıt başlıklarını yakalayıp style-src'ye blob:'u EKLEMEK (mevcut
// yönergeyi değiştirmeden, yalnızca genişleterek). Yalnızca Vencord etkinken uygulanıyor --
// canlı ayar her yanıtta okunuyor, bu yüzden kullanıcı Vencord'u kapatırsa (sayfa yeniden
// yüklendiğinde) gevşetme de devre dışı kalır.
//
// İKİNCİ BUG (kullanıcı raporu, canlı testte doğrulandı): style-src düzeltmesinden sonra bile
// Online Themes sekmesine bir tema linki (ör. https://refact0r.github.io/.../theme.css)
// girilince tema hâlâ uygulanmıyordu. Kaynak kodu okuyarak (client/resources/vencord/browser.js,
// Yc() fonksiyonu) doğrulandı: Online Themes linkleri fetch() ile İNDİRİLMİYOR -- ham link
// doğrudan "@import url(\"<link>\");" olarak bir <style> etiketine yazılıyor (yalnızca Local
// Themes -- yani dosyadan yüklenenler -- blob:'a çevriliyor). Tarayıcının @import'u YÜKLEME
// işlemi de style-src (style-src-elem'e düşülüyorsa ona) tarafından denetleniyor, connect-src'ye
// değil -- bu yüzden ilk denemede (yanlışlıkla connect-src'ye https: eklenerek) sorun
// ÇÖZÜLMEMİŞTİ; canlı testte "@import" hâlâ "violates... style-src" hatasıyla reddediliyordu.
// Asıl düzeltme: style-src(-elem)'e blob:'un yanına https: de EKLEMEK (rastgele bir HTTPS
// kaynağından stylesheet yüklenebilsin diye). connect-src'ye https: eklenmesi zararsız olduğu
// için (ve Vencord eklentilerinin kendi fetch() çağrıları için işe yarayabileceğinden) o da
// korunuyor.
//
// ÜÇÜNCÜ BUG (aynı canlı test turunda ortaya çıktı): style-src düzeltmesiyle CSS'in kendisi
// yüklenmeye başlayınca, bu sefer temanın İÇİNDE referans verdiği özel bir font dosyası
// (ör. https://refact0r.github.io/.../asciid.woff) font-src tarafından reddedildi -- aynı
// sınıftan bir sorun, temaların arka plan resmi gibi img-src'ye giren kaynakları da aynı
// şekilde etkileyebilir. Bu yüzden font-src ve img-src'ye de https: EKLENİYOR.
//
// Ek risk yaratmıyor: Vencord zaten sayfa içinde tam JS çalıştırma yetkisine sahip
// (DOM/localStorage erişimi vb.), kullanıcı üçüncü taraf eklenti/tema yüklemeyi zaten kabul
// etmiş oluyor.
const RELAXED_CSP_DIRECTIVES_REGEX = /(style-src(?:-elem)?|connect-src|font-src|img-src)([^;]*)/gi;

function relaxCspForVencordThemes() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);
  discordSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders;
    if (!headers || !readLocalSettings().vencordEnabled) {
      callback({});
      return;
    }
    const cspKey = Object.keys(headers).find((h) => h.toLowerCase() === 'content-security-policy');
    if (cspKey) {
      headers[cspKey] = headers[cspKey].map((value) =>
        value.replace(RELAXED_CSP_DIRECTIVES_REGEX, (_match, directive, rest) => {
          const isStyleDirective = directive.toLowerCase().startsWith('style-src');
          const addition = isStyleDirective ? 'blob: https:' : 'https:';
          return `${directive}${rest} ${addition}`;
        }),
      );
    }
    callback({ responseHeaders: headers });
  });
}

module.exports = {
  registerPermissions,
  configureBrowserIdentity,
  isAllowedOrigin,
  isAllowedPopoutOrigin,
  applySpellcheckSetting,
  relaxCspForVencordThemes,
  DISCORD_PARTITION,
};
