'use strict';

const { session } = require('electron');

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

/**
 * Mikrofon/kamera (sesli-görüntülü konuşma) ve native bildirim izinlerini yalnızca
 * discord.com kökenli içerik için otomatik onaylar. Başka hiçbir origin bu izinleri alamaz.
 */
function registerPermissions() {
  const discordSession = session.fromPartition(DISCORD_PARTITION);

  discordSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details.requestingUrl || webContents.getURL();
    callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(origin));
  });

  discordSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(requestingOrigin),
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

module.exports = { registerPermissions, configureBrowserIdentity, DISCORD_PARTITION };
