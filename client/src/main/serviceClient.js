'use strict';

const http = require('node:http');

// SplitCord DPI Service'in service/SplitCordService/LocalApi/LocalApiConstants.cs içinde
// sabitlenmiş yerel API portu. Yalnızca 127.0.0.1 üzerinde dinlenir.
const SERVICE_HOST = '127.0.0.1';
const SERVICE_PORT = 58271;

// Hızlı, salt-okunur çağrılar için (status/logs) kısa zaman aşımı: servis kapalıysa
// hemen anlaşılsın.
const DEFAULT_TIMEOUT_MS = 5000;

// ByeDPI doğrulanmamışsa /activate ve /args, discord.com/app'i gerçekten yükleyip
// yükleyemediğini görmek için birden çok stratejiyi sırayla dener (bkz. ByeDpiEngine.cs).
// ByeDPI'nin TÜM 9 adayı da başarısız olursa DpiEngineManager otomatik olarak GoodbyeDPI'nin
// (bkz. GoodbyeDpiEngine.cs), o da tükenirse Zapret'in kendi listesine geçiyor. GoodbyeDPI/
// Zapret'in fake-packet/TTL teknikleri canlı testte bazen İLK bağlantı denemesini
// sıfırlayıp hemen ardından istikrar kazandığı için (bkz. TestConnectivityAsync) her aday
// artık tek deneme yerine 2 deneme alıyor — en kötü senaryoda (9 x ~15sn ByeDPI) +
// (23 x ~27sn GoodbyeDPI) + (7 x ~27sn Zapret) ≈ 945sn'ye kadar sürebilir. Bu çağrılar buna
// göre çok daha uzun bir zaman aşımına ihtiyaç duyar, yoksa servis hâlâ (sessizce,
// arkaplanda) test ederken istemci vazgeçip "DPI servisine ulaşılamıyor" gibi yanlış bir
// hata gösterir.
const LONG_RUNNING_TIMEOUT_MS = 1200000;

function request(method, urlPath, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: SERVICE_HOST,
        port: SERVICE_PORT,
        path: urlPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (err) {
            reject(err);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed?.error || `DPI servisi hata döndürdü: ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        });
      },
    );
    req.on('error', (err) => reject(new Error(`DPI servisine bağlanılamadı: ${err.message}`)));
    req.on('timeout', () => req.destroy(new Error('DPI servisine bağlanılamadı (zaman aşımı)')));
    if (payload) req.write(payload);
    req.end();
  });
}

const getDpiStatus = () => request('GET', '/status');
// allowEscalation=false: Manuel moddan gelen çağrılarda kullanılır — kullanıcı AÇIKÇA bu
// motoru seçtiği için, tükenmesi durumunda BAŞKA bir motora OTOMATİK geçilmesini istemiyoruz.
const activateEngine = (id, allowEscalation = true) =>
  request('POST', `/engines/${encodeURIComponent(id)}/activate?allowEscalation=${allowEscalation}`, null, LONG_RUNNING_TIMEOUT_MS);
const setEngineArgs = (id, args, restart = true) =>
  request('POST', `/engines/${encodeURIComponent(id)}/args`, { args, restart }, LONG_RUNNING_TIMEOUT_MS);
const getEngineLogs = (id) => request('GET', `/engines/${encodeURIComponent(id)}/logs`);
const stopAllEngines = () => request('POST', '/stop-all', null, LONG_RUNNING_TIMEOUT_MS);
const reportByeDpiFailure = () => request('POST', '/engines/byedpi/report-failure', null, LONG_RUNNING_TIMEOUT_MS);
// GoodbyeDPI/Zapret'in genel karşılığı: webview'de o motorun doğrulanmış ayarı birkaç
// yeniden denemeden sonra hâlâ kalıcı olarak çalışmıyorsa çağrılır (bkz. titlebar.js).
const reportEngineFailure = (id, allowEscalation = true) =>
  request('POST', `/engines/${encodeURIComponent(id)}/report-engine-failure?allowEscalation=${allowEscalation}`, null, LONG_RUNNING_TIMEOUT_MS);
const getDnsProviders = () => request('GET', '/dns-providers');
const setDnsProviders = (providers) => request('POST', '/dns-providers', { providers });

// Manuel > Gelişmiş'ten sabitlenen tek DNS protokolü — protocol=null/undefined "Otomatik"
// (5 tier'lik DoH→DNSCrypt→DoT→DoQ→DNS'siz döngüsü) anlamına gelir.
const getManualDnsProtocol = () => request('GET', '/manual-dns-protocol');
const setManualDnsProtocol = (protocol) => request('POST', '/manual-dns-protocol', { protocol: protocol || null });

// Yalnızca Zapret2 için: DoH/DNSCrypt/DoT/DoQ/DNS'siz tier döngüsünde her bir protokolü
// blockcheck2 ile tarama üst sınırı (dakika) — Otomatik ve Manuel modun bağımsız değerleri var.
const getZapret2TierTimeout = () => request('GET', '/zapret2/tier-timeout');
const setZapret2TierTimeout = (automaticMinutes, manualMinutes) =>
  request('POST', '/zapret2/tier-timeout', { automaticMinutes: automaticMinutes ?? null, manualMinutes: manualMinutes ?? null });

// İstemcinin kendi olay günlüğünü (bkz. ipc.js logEvent) servisin tuttuğu TEK birleşik
// tanılama dosyasına iletmek için — en iyi çaba, servis kapalıysa/ulaşılamıyorsa sessizce
// yok sayılır (çağıran taraf zaten catch ediyor).
const postDiagnosticLog = (tag, level, message) => request('POST', '/diagnostic-log', { tag, level, message });
const getDiagnosticLogLocation = () => request('GET', '/diagnostic-log/location');

// Üç motor için de ortak (ByeDPI/GoodbyeDPI/Zapret).
const getRejectedArgs = (id) => request('GET', `/engines/${encodeURIComponent(id)}/rejected-args`);
// Reddedilenler listesine ekleyip yeniden aday taraması başlattığı için (aynı activate
// gibi) uzun sürebilir.
const rejectCurrentArgs = (id, allowEscalation = true) =>
  request('POST', `/engines/${encodeURIComponent(id)}/reject-current?allowEscalation=${allowEscalation}`, null, LONG_RUNNING_TIMEOUT_MS);
const unrejectArgs = (id, args) => request('POST', `/engines/${encodeURIComponent(id)}/unreject`, { args });

// ByeDPI "uzun argüman listesi" anahtarı — kapalıyken yalnızca 9 kişilik kısa listeyi,
// açıkken bunun ardından ~1000 ek stratejiyi de tarar.
const getByeDpiUseExtendedCandidates = () => request('GET', '/byedpi/use-extended-candidates');
const setByeDpiUseExtendedCandidates = (enabled) => request('POST', '/byedpi/use-extended-candidates', { enabled });

const getFirewallStatus = () => request('GET', '/firewall/byedpi/status');
const grantFirewallPermission = () => request('POST', '/firewall/byedpi/grant');

const getAppFirewallStatus = (exePath) => request('GET', `/firewall/app/status?exePath=${encodeURIComponent(exePath)}`);
const grantAppFirewallPermission = (exePath) => request('POST', '/firewall/app/grant', { exePath });

const getSystemControlsStatus = () => request('GET', '/system-controls/status');
const killProcess = (pid) => request('POST', '/system-controls/kill-process', { pid });
const removeConflictingService = (serviceName) => request('POST', '/system-controls/remove-service', { serviceName });

// Ayarlar > Hakkında'daki "Tüm Ayarları Sıfırla" — tüm motorları durdurup servis
// ayarlarını fabrika varsayılanlarına döndürdüğü için (aynı activate gibi) uzun sürebilir.
const resetServiceSettings = () => request('POST', '/settings/reset', null, LONG_RUNNING_TIMEOUT_MS);

// Ayarlar > DPI Aşımı'ndaki Otomatik'ten Manuel'e geçiş onayında, o an sürmekte olan bir
// motor/strateji taramasını durdurmak için — hızlı bir çağrı (yalnızca bir iptal bayrağı
// tetikliyor), varsayılan kısa zaman aşımı yeterli.
const cancelScan = () => request('POST', '/scan/cancel');

module.exports = {
  getDpiStatus,
  activateEngine,
  setEngineArgs,
  getEngineLogs,
  stopAllEngines,
  reportByeDpiFailure,
  reportEngineFailure,
  getDnsProviders,
  setDnsProviders,
  getManualDnsProtocol,
  setManualDnsProtocol,
  getZapret2TierTimeout,
  setZapret2TierTimeout,
  postDiagnosticLog,
  getDiagnosticLogLocation,
  getRejectedArgs,
  rejectCurrentArgs,
  unrejectArgs,
  getByeDpiUseExtendedCandidates,
  setByeDpiUseExtendedCandidates,
  getFirewallStatus,
  grantFirewallPermission,
  getAppFirewallStatus,
  grantAppFirewallPermission,
  getSystemControlsStatus,
  killProcess,
  removeConflictingService,
  resetServiceSettings,
  cancelScan,
};
