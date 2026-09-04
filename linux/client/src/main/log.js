'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let logFilePath = null;
let serviceClient = null;

function getServiceClient() {
  // Tembel yükleniyor: serviceClient.js bu dosyayı gerektirmiyor ama döngüsel bir
  // gereksinim riskinden kesin olarak kaçınmak için erken require edilmiyor.
  if (!serviceClient) serviceClient = require('./serviceClient');
  return serviceClient;
}

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
 *
 * Aynı satır, servisin tuttuğu TEK birleşik tanılama dosyasına (bkz. DiagnosticLog.cs,
 * %ProgramData%\SplitCord\diagnostic.log) da en iyi çaba ile iletilir — servis henüz
 * başlamamışsa/kapalıysa bu sessizce başarısız olur, istemciyi hiçbir şekilde etkilemez.
 */
function logEvent(tag, data) {
  const line = `[${new Date().toISOString()}] [${tag}] ${JSON.stringify(data)}`;
  try {
    fs.appendFileSync(getLogFilePath(), line + '\n');
  } catch {
    // Loglama kritik değil, dosyaya yazılamazsa sessizce geç.
  }
  console.log(line);
  try {
    getServiceClient()
      .postDiagnosticLog(tag, 'Information', JSON.stringify(data))
      .catch(() => {});
  } catch {
    // yoksay
  }
}

module.exports = { logEvent, getLogFilePath };
