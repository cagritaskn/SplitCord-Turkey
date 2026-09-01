'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { logEvent } = require('./log');

// Resmi Discord masaüstü uygulaması kurulduğunda Windows registry'sine kendi 'discord:'
// URI şemasını (HKCU\Software\Classes\discord) kaydediyor — invite/deep-link
// bağlantılarının ("Uygulamada Aç" gibi) bu protokol üzerinden açılması bunun sayesinde.
// Biz de aynı şemaya kaydolup Windows'un varsayılan-uygulama seçicisinde bir SEÇENEK
// hâline geliyoruz.
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

// Discord'un kurulum yolu Squirrel tabanlı (%LOCALAPPDATA%\Discord\Update.exe) — bu,
// resmi masaüstü istemcisinin (Discord PTB/Canary değil, ana sürüm) standart kurulum
// izidir. ÖNEMLİ: Squirrel.Windows kaldırma işleminde Update.exe'yi SİLMİYOR — kurulum
// kökünde kalmaya devam ediyor (canlı olarak doğrulandı), bunun yerine bir ".dead"
// işaretleyici dosyası bırakıyor. Yalnızca Update.exe'nin varlığına bakmak, Discord
// kaldırıldıktan SONRA bile "hâlâ kurulu" sonucu veriyordu — bu yüzden .dead'in YOK
// olduğunu da kontrol ediyoruz.
function isOfficialDiscordInstalled() {
  try {
    const discordDir = path.join(os.homedir(), 'AppData', 'Local', 'Discord');
    const updateExe = path.join(discordDir, 'Update.exe');
    const deadMarker = path.join(discordDir, '.dead');
    return fs.existsSync(updateExe) && !fs.existsSync(deadMarker);
  } catch {
    return false;
  }
}

// Resmi Discord istemcisi SplitCord ile aynı 'discord:' protokol şemasını ve (bazı
// sistemlerde) aynı davet/deep-link akışlarını paylaştığı için kurulu olması istenmiyor —
// "İzinler ve Kontroller" ekranındaki kaldır butonu bunu çağırıyor. Squirrel.Windows
// tabanlı kurulumların standart kaldırma komutu budur (Discord'un kendi Başlat Menüsü
// kısayolu da aynısını kullanıyor); -s olmadan çağırıyoruz ki kullanıcı ilerlemeyi görsün.
function uninstallOfficialDiscord() {
  try {
    const updateExe = path.join(os.homedir(), 'AppData', 'Local', 'Discord', 'Update.exe');
    if (!fs.existsSync(updateExe)) return false;
    const child = spawn(updateExe, ['--uninstall'], { detached: true, stdio: 'ignore' });
    child.unref();
    logEvent('official-discord-uninstall-launched', {});
    return true;
  } catch (err) {
    logEvent('official-discord-uninstall-error', { error: err.message });
    return false;
  }
}

// discord:// URI'lerinin gerçek biçimi belgelenmemiş ama bilinen örüntüler:
//   discord://-/invite/CODE           -> davet
//   discord://-/channels/GUILD/CHANNEL -> kanala git
//   discord://-/users/USER_ID          -> kullanıcı/DM
// "-" kısmı boş bir "host" bileşeni (discord://<host>/<path> biçiminde). Tanınmayan
// biçimler basitçe ana uygulamaya (discord.com/app) düşer.
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
