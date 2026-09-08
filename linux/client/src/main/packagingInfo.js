'use strict';

// PORT_PLAN_2.md AP-1/madde 1.3 -- deb/AppImage ayrımının TEK, paylaşılan tespit noktası. autostart.js
// içindeki private isAppImage() kopyasına DOKUNULMADI (zaten çalışıyor, ayrı bırakıldı) -- bu modül
// yalnızca appUninstaller/updateChecker/ipc/renderer gibi YENİ tüketiciler için var, ikisi de aynı
// process.env.APPIMAGE kontrolüne dayanıyor (AppImage runtime'ının kendi ayarladığı değişken).
function isAppImage() {
  return !!process.env.APPIMAGE;
}

/** @returns {'appimage'|'deb'} -- şu an yalnızca bu iki paketleme türü var (dev modu da 'deb' gibi
 * davranır, çünkü .deb'in çalışma zamanı davranışı "kurulum zaten var" varsayımına en yakın olan). */
function getPackagingKind() {
  return isAppImage() ? 'appimage' : 'deb';
}

module.exports = { isAppImage, getPackagingKind };
