'use strict';

const os = require('node:os');
const { app } = require('electron');
const { readLocalSettings } = require('./localSettings');
const { logEvent } = require('./log');

// KULLANICI TALEBİ: tam ekran oyunlarda (League of Legends gibi) FPS düşüşü şikayeti --
// kök neden büyük olasılıkla window.js'teki KASITLI backgroundThrottling:false (ses/
// görüntü bağlantısının pencere tepside/arkaplandayken kesilmemesi için, bkz. o dosyadaki
// not) -- bunu geri açmak aynı eski bug'ı geri getirebilir, o yüzden dokunulmuyor. Bunun
// yerine JS timer/rAF davranışına HİÇ dokunmayan, tamamen farklı bir mekanizma
// kullanılıyor: Node'un yerleşik os.setPriority()'si (Windows'ta SetPriorityClass'a,
// Linux'ta nice değerine denk gelir, YENİ bir native bağımlılık GEREKMİYOR) ile uygulamanın
// TÜM alt süreçlerinin (main/gpu/renderer/utility -- app.getAppMetrics() ile listeleniyor)
// OS zamanlama önceliği düşürülüyor. Bu, soket/timer/WebRTC'yi DURDURMUYOR -- sadece CPU
// çakışması olduğunda (ör. oyun CPU/GPU talep ederken) OS'un bu sürece daha az zaman
// ayırmasını sağlıyor; boşta bir sistemde ölçülebilir bir maliyeti yok. KULLANICI TALEBİ
// ÜZERİNE yalnızca Ayarlar > Performans Modu AÇIKKEN VE pencere odaktan çıktığında
// devreye giriyor -- varsayılan davranış değişmiyor.
let mainWindowRef = null;
let lowered = false;

function setAllProcessPriorities(priority) {
  for (const proc of app.getAppMetrics()) {
    try {
      os.setPriority(proc.pid, priority);
    } catch {
      // Bazı alt süreçler (ör. tam o anda kapanmakta olan bir sandbox süreci) başarısız
      // olabilir -- tek bir PID'in başarısız olması diğerlerini etkilemesin.
    }
  }
}

function lowerPriority() {
  if (lowered) return;
  lowered = true;
  setAllProcessPriorities(os.constants.priority.PRIORITY_BELOW_NORMAL);
  logEvent('background-priority-lowered', {});
}

function restorePriority() {
  if (!lowered) return;
  lowered = false;
  setAllProcessPriorities(os.constants.priority.PRIORITY_NORMAL);
  logEvent('background-priority-restored', {});
}

// Yalnızca odak durumuna bakılıyor -- isVisible()/isMinimized() KASITLI OLARAK
// kontrol edilmiyor: pencere görünür ama odaksız kalabilir (ör. tam ekran bir oyunun
// arkasında açık kalması), bu özelliğin tam olarak hedeflediği senaryo bu.
function evaluate() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  const settings = readLocalSettings();
  if (!settings.performanceMode || mainWindowRef.isFocused()) {
    restorePriority();
  } else {
    lowerPriority();
  }
}

function startBackgroundPriorityManagement(mainWindow) {
  mainWindowRef = mainWindow;
  mainWindow.on('focus', evaluate);
  mainWindow.on('blur', evaluate);
  mainWindow.on('closed', () => {
    restorePriority();
    mainWindowRef = null;
  });
}

// Ayarlar > Performans Modu değiştirildiğinde (ipc.js) çağrılıyor -- kullanıcı oyun
// sırasında performans modunu AÇARSA (pencere zaten odaksızsa) hemen etkili olsun,
// KAPATIRSA hemen normale dönsün.
function reevaluate() {
  evaluate();
}

module.exports = { startBackgroundPriorityManagement, reevaluate };
