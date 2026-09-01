'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let logFilePath = null;

function getLogFilePath() {
  if (!logFilePath) {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'splitcord.log');
  }
  return logFilePath;
}

/**
 * Uygulama pencereli/konsolsuz çalıştığında (kurulu .exe) console.log kaybolur;
 * bu yüzden hata ayıklama için kalıcı bir dosyaya da yazıyoruz.
 * Konum: app.getPath('userData')\splitcord.log (genelde %APPDATA%\SplitCord-Turkey\splitcord.log)
 */
function logEvent(tag, data) {
  const line = `[${new Date().toISOString()}] [${tag}] ${JSON.stringify(data)}`;
  try {
    fs.appendFileSync(getLogFilePath(), line + '\n');
  } catch {
    // Loglama kritik değil, dosyaya yazılamazsa sessizce geç.
  }
  console.log(line);
}

module.exports = { logEvent, getLogFilePath };
