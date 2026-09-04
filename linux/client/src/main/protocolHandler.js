'use strict';

const { app } = require('electron');
const { logEvent } = require('./log');

// Windows karşılığının (client/src/main/protocolHandler.js) portu. setAsDefaultProtocolClient/
// isDefaultProtocolClient Electron'da Linux'ta da çalışır (xdg-mime/masaüstü dosyası üzerinden) —
// bu kısım DEĞİŞMEDİ. parseDiscordUri/extractProtocolUrlFromArgv de saf metin işleme, platformdan
// bağımsız, DEĞİŞMEDİ.
const PROTOCOL = 'discord';

function registerProtocolHandler() {
  if (!app.isDefaultProtocolClient(PROTOCOL)) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
  logEvent('protocol-handler-registered', { isDefault: app.isDefaultProtocolClient(PROTOCOL) });
}

function isDefaultProtocolHandler() {
  return app.isDefaultProtocolClient(PROTOCOL);
}

// Windows karşılığı, resmi Discord'un Squirrel.Windows tabanlı kurulumunu (%LOCALAPPDATA%\
// Discord\Update.exe) tespit edip kaldırabiliyordu — Linux'ta resmi Discord .deb/AppImage/
// Flatpak/Snap gibi BİRDEN ÇOK farklı yoldan kurulabiliyor, tek bir güvenilir kurulum izi yok.
// Bu yüzden bu iki fonksiyon BİLEREK inert (hep "kurulu değil"/"yapılamadı") bırakıldı —
// ipc.js/settings.js'teki "İzinler ve Kontroller" akışı bu sayede hiç değişiklik gerektirmeden
// çalışmaya devam ediyor, yalnızca resmi Discord çakışma uyarısı Linux'ta hiç gösterilmiyor.
// DOĞRULANMADI/gelecekte iyileştirilebilir (bkz. PORTING_PLAN.md Faz 9): gerçek bir tespit
// `/usr/share/discord`, `/opt/discord`, Flatpak (`com.discordapp.Discord`) gibi bilinen
// yolların kontrolüyle ya da `xdg-mime query default x-scheme-handler/discord` ile eklenebilir.
function isOfficialDiscordInstalled() {
  return false;
}

function uninstallOfficialDiscord() {
  return false;
}

function parseDiscordUri(uri) {
  try {
    const withoutScheme = uri.replace(/^discord:\/\//i, '');
    const path = withoutScheme.replace(/^-\/?/, '').replace(/^\/+/, '');

    const inviteMatch = path.match(/^invite\/([A-Za-z0-9-]+)/);
    if (inviteMatch) return `https://discord.com/invite/${inviteMatch[1]}`;

    const channelsMatch = path.match(/^channels\/(.+)/);
    if (channelsMatch) return `https://discord.com/channels/${channelsMatch[1]}`;

    const usersMatch = path.match(/^users\/(.+)/);
    if (usersMatch) return `https://discord.com/users/${usersMatch[1]}`;

    return 'https://discord.com/app';
  } catch {
    return 'https://discord.com/app';
  }
}

function extractProtocolUrlFromArgv(argv) {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}://`)) || null;
}

module.exports = {
  registerProtocolHandler,
  isDefaultProtocolHandler,
  isOfficialDiscordInstalled,
  uninstallOfficialDiscord,
  parseDiscordUri,
  extractProtocolUrlFromArgv,
};
