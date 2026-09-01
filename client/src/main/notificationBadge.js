'use strict';

const { logEvent } = require('./log');

// Discord'un sekme başlığı okunmamış mesaj/mention olduğunda değişiyor (ör. "(3) Discord
// | #kanal" gibi bir sayı öneki, ya da mention'sız okunmamışlarda bir nokta/yıldız işareti
// öneki). Bunu DOM'a hiç dokunmadan, doğrudan Electron'un webContents 'page-title-updated'
// olayından okuyoruz — periyodik executeJavaScript ile DOM taramasından çok daha ucuz ve
// (Discord'un DOM yapısındaki değişikliklerden bağımsız olduğu için) daha az kırılgan.
const UNREAD_COUNT_PATTERN = /^\((\d+)\)/;
const UNREAD_DOT_PATTERN = /^[•*]\s/;

let hasUnread = false;
// Sayı öneki varsa (ör. "(3)") gerçek okunmamış/mention sayısı; yalnızca nokta/yıldız
// öneki varsa (sayı bilinmiyorsa) null — rozet o zaman sayısız, düz bir nokta olarak çizilir.
let unreadCount = null;
let onChanged = null;

function setOnChanged(callback) {
  onChanged = callback;
}

function getHasUnread() {
  return hasUnread;
}

function getUnreadCount() {
  return unreadCount;
}

function evaluateTitle(title) {
  const t = title || '';
  const countMatch = t.match(UNREAD_COUNT_PATTERN);
  const nextHasUnread = !!countMatch || UNREAD_DOT_PATTERN.test(t);
  const nextCount = countMatch ? parseInt(countMatch[1], 10) : null;
  if (nextHasUnread !== hasUnread || nextCount !== unreadCount) {
    hasUnread = nextHasUnread;
    unreadCount = nextCount;
    logEvent('notification-badge-changed', { hasUnread, unreadCount, title });
    if (onChanged) onChanged({ hasUnread, unreadCount });
  }
}

function startTracking(webContents) {
  evaluateTitle(webContents.getTitle());
  webContents.on('page-title-updated', (_event, title) => evaluateTitle(title));
}

// Rozet ayarı (Genel > Bildirim Rozeti) değiştiğinde tray.js'in ikonu yeniden
// değerlendirmesi için — durum kendisi değişmese bile dinleyiciyi tetikler.
function forceRefresh() {
  if (onChanged) onChanged({ hasUnread, unreadCount });
}

module.exports = { startTracking, getHasUnread, getUnreadCount, setOnChanged, forceRefresh };
