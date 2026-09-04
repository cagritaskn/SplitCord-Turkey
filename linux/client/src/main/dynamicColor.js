'use strict';

const { readLocalSettings } = require('./localSettings');
const { logEvent } = require('./log');

// Discord sayfasının teması iki şekilde okunabiliyor: (1) Discord'un kendi tanımladığı
// CSS custom property'leri (--background-primary vb.) — EN GÜVENİLİR yöntem çünkü
// doğrudan Discord'un "bu benim tema rengim" dediği değeri veriyor; (2) DOM'da gerçekten
// render edilen bir elementin arkaplanı — yedek yöntem.
//
// (2)'de KRİTİK bir tuzak var: Discord, sayfanın en üstüne kendi sahte pencere
// çerçevesini (data-window-chrome="true" olan bir bar — başlık, gelen kutusu/yardım
// simgeleri) render ediyor. Bunun rengi, sayfanın GERÇEK tema arkaplanı DEĞİL — daha
// önce buraya denk gelip yanlış renk örnekleniyordu. Artık bu bar'ı (ve içindeki her
// şeyi) closest() ile açıkça DIŞLIYORUZ, hem doğrudan adaylarda hem nokta taramasında.
// capturePage() (GPU compositor'dan piksel okuma) bu sandbox'ta GPU sürecini
// kararsızlaştırıp çökmelere yol açtığı için KASITLI olarak kullanılmıyor.
const SAMPLE_SCRIPT = `
(function() {
  // Chromium'un yeni sürümleri getComputedStyle().backgroundColor'ı artık her zaman
  // rgb()/rgba() olarak DEĞİL, kaynak CSS'e göre oklab() (CSS Color Level 4) olarak da
  // döndürebiliyor — Discord'un "Midnight" teması gibi bazı temalarda bu format
  // kullanılıyor. rgb() regex'i oklab() ile eşleşmediği için önceden HER ZAMAN null
  // dönüyordu (bu yüzden "renk bulunamadı" ya da yanlış renk sorunu vardı).
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function linearToSrgb(c) {
    c = clamp01(c);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  function oklabToRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return {
      r: Math.round(linearToSrgb(r) * 255),
      g: Math.round(linearToSrgb(g) * 255),
      b: Math.round(linearToSrgb(bl) * 255),
    };
  }
  function parseColor(str) {
    if (!str) return null;
    const oklabMatch = str.match(/oklab\\(([^)]+)\\)/);
    if (oklabMatch) {
      const parts = oklabMatch[1].trim().split(/\\s*\\/\\s*|\\s+/).map((s) => parseFloat(s));
      const [L, a, b] = parts;
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b) || alpha <= 0.05) return null;
      const rgb = oklabToRgb(L, a, b);
      return { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha };
    }
    const m = str.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    const r = parts[0], g = parts[1], b = parts[2];
    const a = parts.length > 3 ? parts[3] : 1;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || a <= 0.05) return null;
    return { r, g, b, a };
  }
  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const num = parseInt(h.slice(0, 6), 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
  }
  function firstGradientColor(bgImage) {
    const m = bgImage.match(/(rgba?\\([^)]+\\)|#[0-9a-fA-F]{3,8})/);
    if (!m) return null;
    return m[1].startsWith('#') ? hexToRgb(m[1]) : parseColor(m[1]);
  }
  function isWindowChrome(el) {
    return !!(el && el.closest && el.closest('[data-window-chrome]'));
  }
  function checkElement(el) {
    if (!el || isWindowChrome(el)) return null;
    const cs = getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
      const c = firstGradientColor(cs.backgroundImage);
      if (c) return c;
    }
    return parseColor(cs.backgroundColor);
  }

  // 1) Discord'un KENDİ tema değişkenleri — bilinen eski/yeni isimlendirmelerin bir
  // kısmı; sırayla denenir, ilk geçerli (opak) renk kullanılır.
  const varNames = [
    '--background-primary', '--bg-base-primary', '--background-base-lower',
    '--background-secondary', '--bg-surface-raised', '--background-base-lowest',
    '--background-secondary-alt', '--background-tertiary', '--background-floating',
  ];
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of varNames) {
    const raw = rootStyle.getPropertyValue(name);
    if (!raw) continue;
    const trimmed = raw.trim();
    const c = trimmed.startsWith('#') ? hexToRgb(trimmed) : parseColor(trimmed.startsWith('rgb') ? trimmed : \`rgb(\${trimmed})\`);
    if (c) return JSON.stringify(c);
  }

  // 2) DOM'da gerçekten render edilen elementler — sahte pencere çerçevesi (üstteki
  // data-window-chrome bar'ı) hariç tutularak.
  const directCandidates = [document.body, document.documentElement, document.getElementById('app-mount')];
  for (const el of directCandidates) {
    const c = checkElement(el);
    if (c) return JSON.stringify(c);
  }

  // Üstteki data-window-chrome bar'ı genelde ~32-40px yükseklikte — bu bölgeyi atlayıp
  // gerçek içerik alanından örnekliyoruz.
  const points = [
    [Math.floor(window.innerWidth / 2), 60],
    [Math.floor(window.innerWidth / 2), 120],
    [Math.floor(window.innerWidth / 4), 200],
    [Math.floor((window.innerWidth * 3) / 4), 200],
  ];
  for (const [px, py] of points) {
    let el = document.elementFromPoint(px, py);
    let hops = 0;
    while (el && hops < 16) {
      const c = checkElement(el);
      if (c) return JSON.stringify(c);
      el = el.parentElement;
      hops++;
    }
  }
  return 'null';
})();
`;

// Örnekleme başarısız olduğunda tek seferlik teşhis bilgisi — gerçek Discord DOM'unu
// (sınıf adları, computed style'lar) log'a düşürüp kör tahmin yerine gerçek veriyle
// hangi elementin/CSS değişkeninin doğru olduğunu bulabilmek için.
const DIAGNOSTIC_SCRIPT = `
(function() {
  function describe(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      id: el.id || null,
      cls: (el.className || '').toString().slice(0, 120),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 80),
    };
  }
  const points = [
    [Math.floor(window.innerWidth / 2), 60],
    [Math.floor(window.innerWidth / 2), 120],
    [Math.floor(window.innerWidth / 2), 300],
  ];
  const pointResults = points.map(([x, y]) => {
    const chain = [];
    let el = document.elementFromPoint(x, y);
    let hops = 0;
    while (el && hops < 8) {
      chain.push(describe(el));
      el = el.parentElement;
      hops++;
    }
    return { point: [x, y], chain };
  });
  return JSON.stringify({
    body: describe(document.body),
    html: describe(document.documentElement),
    appMount: describe(document.getElementById('app-mount')),
    htmlClass: (document.documentElement.className || '').toString(),
    pointResults,
  });
})();
`;

const RESAMPLE_INTERVAL_MS = 1000;
// Performans modu açıkken tema takibi tamamen KAPATILMIYOR — yalnızca daha seyrek
// çalışıyor (renk değişimi zaten theme.css'teki [data-performance-mode] kuralı
// sayesinde fade'siz, bir anda uygulanıyor, bu yüzden 1 sn'lik sıklığa gerek yok).
const RESAMPLE_INTERVAL_PERFORMANCE_MODE_MS = 10000;
// Discord'un kendi logosunun döndüğü açılış ekranı henüz kullanıcının gerçek temasını
// yansıtmıyor — gerçek sayfa açılana kadar (client-side geçiş, ikinci bir
// did-finish-load olayı ateşlemiyor) birkaç kez daha örnekleyip son rengin
// "yerleşmesini" sağlıyoruz.
const SETTLE_RESAMPLE_DELAYS_MS = [800, 2500, 5000, 8000, 12000, 18000];

let webviewWebContents = null;
let mainWindowRef = null;
let resampleTimer = null;
let settleTimers = [];
let lastPalette = null;
let onPaletteChanged = null;

function setOnPaletteChanged(callback) {
  onPaletteChanged = callback;
}

function getLastPalette() {
  return lastPalette;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbStr([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

// Tek bir örneklenen renkten, Discord'un kendi koyu temasındaki gibi birbirinden
// GÖRECELİ olarak ayırt edilebilen bir palet üretir: primary (ana içerik),
// secondary (titlebar), tertiary (input/log kutuları), hover, ve okunaklılık için
// arkaplanın parlaklığına göre seçilen metin renkleri.
function buildPalette(r, g, b) {
  const [h, sRaw, l] = rgbToHsl(r, g, b);
  // Aşırı doygun (neon) renkler arayüzü yorucu yapabiliyor — makul bir tavana çekiyoruz.
  const s = clamp(sRaw, 0, 45);
  const isDark = l < 50;

  const primary = hslToRgb(h, s, l);
  const secondary = hslToRgb(h, s, clamp(l + (isDark ? -3 : 3), 2, 98));
  const tertiary = hslToRgb(h, s, clamp(l + (isDark ? -9 : 9), 1, 99));
  const hover = hslToRgb(h, s, clamp(l + (isDark ? 6 : -6), 2, 98));

  const textNormal = isDark ? 'rgb(242, 243, 245)' : 'rgb(6, 6, 7)';
  const textMuted = isDark ? 'rgba(242, 243, 245, 0.65)' : 'rgba(6, 6, 7, 0.65)';

  return {
    primary: rgbStr(primary),
    secondary: rgbStr(secondary),
    tertiary: rgbStr(tertiary),
    hover: rgbStr(hover),
    textNormal,
    textMuted,
    isDark,
  };
}

function hexToRgbArr(hex) {
  const h = hex.replace('#', '');
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Görünüm > Tema'daki sabit ön ayarlar — her biri de aynı buildPalette() göreceli
// paletiyle işleniyor (yalnızca "tohum" renk sabit, geri kalan renkler ve okunaklı
// metin rengi otomatik hesaplanıyor) ki Otomatik moddaki gibi tutarlı görünsünler.
const THEME_PRESETS = {
  light: '#ffffff',
  ash: '#323339',
  dark: '#1d1d21',
  onyx: '#000000',
};

function applyStaticTheme(mode) {
  const hex = THEME_PRESETS[mode];
  if (!hex) return;
  const [r, g, b] = hexToRgbArr(hex);
  const palette = buildPalette(r, g, b);
  lastPalette = palette;
  logEvent('static-theme-applied', { mode, palette });

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app:dynamic-color-sampled', palette);
  }
  if (onPaletteChanged) onPaletteChanged(palette);
}

function setWebviewWebContents(webContents, mainWindow) {
  webviewWebContents = webContents;
  mainWindowRef = mainWindow;
}

async function sampleAndApply() {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) return;
  const settings = readLocalSettings();
  if (settings.themeMode !== 'automatic') return;
  if (!mainWindowRef || mainWindowRef.isDestroyed() || !mainWindowRef.isVisible()) return;

  try {
    const raw = await webviewWebContents.executeJavaScript(SAMPLE_SCRIPT);
    const sampled = raw && raw !== 'null' ? JSON.parse(raw) : null;
    if (!sampled) {
      const diag = await webviewWebContents.executeJavaScript(DIAGNOSTIC_SCRIPT).catch((e) => `DIAG_ERROR: ${e.message}`);
      logEvent('dynamic-color-not-found', { url: webviewWebContents.getURL(), diag });
      return;
    }

    const r = clamp(Math.round(sampled.r), 0, 255);
    const g = clamp(Math.round(sampled.g), 0, 255);
    const b = clamp(Math.round(sampled.b), 0, 255);

    const palette = buildPalette(r, g, b);
    lastPalette = palette;
    logEvent('dynamic-color-applied', { sampled: { r, g, b }, palette });

    mainWindowRef.webContents.send('app:dynamic-color-sampled', palette);
    if (onPaletteChanged) onPaletteChanged(palette);
  } catch (err) {
    logEvent('dynamic-color-sample-error', { error: err.message });
  }
}

function clearSettleTimers() {
  settleTimers.forEach(clearTimeout);
  settleTimers = [];
}

let themeChangeDebounce = null;

function startDynamicColorSampling(webContents, mainWindow) {
  setWebviewWebContents(webContents, mainWindow);

  webContents.on('did-finish-load', () => {
    clearSettleTimers();
    // Discord'un açılış/logo ekranı henüz gerçek temayı yansıtmıyor; gerçek sayfa
    // client-side yüklendiğinde ikinci bir did-finish-load olayı olmadığı için
    // birkaç kez tekrar örnekleyip son (muhtemelen doğru) rengin kalmasını sağlıyoruz.
    settleTimers = SETTLE_RESAMPLE_DELAYS_MS.map((delay) => setTimeout(sampleAndApply, delay));
  });

  // discordWebviewPreload.js'teki MutationObserver, Discord hesap ayarlarından tema
  // değiştirildiğinde <html>'in class/style'ı değişir değişmez bunu bildiriyor — böylece
  // aşağıdaki 30 saniyelik döngüyü beklemeden neredeyse anında yeniden örnekleme yapılıyor.
  // webContents.ipc, bu webview'e özel (scoped) olduğu için webview yeniden
  // eklenirse/değişirse eski dinleyicilerin birikmesi sorun olmuyor.
  webContents.ipc.on('dynamic-color:theme-changed', () => {
    if (themeChangeDebounce) clearTimeout(themeChangeDebounce);
    themeChangeDebounce = setTimeout(sampleAndApply, 150);
  });

  // setInterval DEĞİL kendi kendini yeniden zamanlayan bir setTimeout döngüsü
  // kullanıyoruz — çünkü performans modu her an açılıp kapanabiliyor ve döngünün BİR
  // SONRAKİ turunda güncel ayarı (1 sn / 10 sn) yansıtması gerekiyor.
  if (resampleTimer) clearTimeout(resampleTimer);
  const scheduleNextResample = () => {
    const delay = readLocalSettings().performanceMode ? RESAMPLE_INTERVAL_PERFORMANCE_MODE_MS : RESAMPLE_INTERVAL_MS;
    resampleTimer = setTimeout(async () => {
      await sampleAndApply();
      scheduleNextResample();
    }, delay);
  };
  scheduleNextResample();
}

module.exports = { startDynamicColorSampling, sampleAndApply, getLastPalette, setOnPaletteChanged, applyStaticTheme };
