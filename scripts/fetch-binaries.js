'use strict';

/**
 * GoodbyeDPI ve Zapret (Flowseal/zapret-discord-youtube) Windows binary'lerini pinlenmiş
 * resmi GitHub release'lerinden indirip, ByeDPI'yi ise SplitCord-Turkey'e özel DNS-over-
 * HTTPS yamasıyla kaynaktan derleyip (bkz. build-byedpi.js) repo kökündeki
 * resources/bin/<tool>/ altına yerleştirir. C# servisi (service/SplitCordService) build
 * sırasında bu klasörü kendi çıktı dizinine kopyalar (bkz. SplitCordService.csproj).
 *
 * Kullanım: npm run fetch-binaries
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { buildByeDpi } = require('./build-byedpi');

const RESOURCES_BIN = path.join(__dirname, '..', 'resources', 'bin');

const TARGETS = [
  {
    tool: 'goodbyedpi',
    url: 'https://github.com/ValdikSS/GoodbyeDPI/releases/download/0.2.2/goodbyedpi-0.2.2.zip',
    extract(zip, destDir) {
      const wanted = new Set(['goodbyedpi.exe', 'windivert.dll', 'windivert64.sys']);
      let count = 0;
      for (const entry of zip.getEntries()) {
        const lower = entry.entryName.toLowerCase();
        if (!lower.includes('/x86_64/')) continue;
        const base = path.basename(entry.entryName);
        if (!wanted.has(base.toLowerCase())) continue;
        fs.writeFileSync(path.join(destDir, base), entry.getData());
        count += 1;
      }
      if (count !== wanted.size) {
        throw new Error(`goodbyedpi: beklenen ${wanted.size} dosyadan ${count} tanesi bulundu (zip yapısı değişmiş olabilir)`);
      }
      return count;
    },
  },
  {
    tool: 'zapret',
    url: 'https://github.com/Flowseal/zapret-discord-youtube/releases/download/1.10.2/zapret-discord-youtube-1.10.2.zip',
    extract(zip, destDir) {
      // ZapretEngine.cs, zip'in bin/ (winws.exe + *.bin sahte paket dosyaları) ve
      // lists/ (hostlist/ipset dosyaları) alt klasör yapısının korunmasını bekliyor.
      let count = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName.split('/').slice(1); // kök klasörü (zapret-discord-youtube-x.y.z/) at
        if (parts.length < 2) continue;
        const [topDir] = parts;
        if (topDir !== 'bin' && topDir !== 'lists') continue;
        const outPath = path.join(destDir, ...parts);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, entry.getData());
        count += 1;
      }
      if (count === 0) throw new Error('zapret: bin/ veya lists/ altında dosya bulunamadı (zip yapısı değişmiş olabilir)');
      return count;
    },
  },
  {
    // AdGuard'ın dnsproxy'si — DoQ (DNS-over-QUIC) VE DNSCrypt desteği için kullanılıyor.
    // .NET 8'de System.Net.Quic hâlâ "preview feature" (EnablePreviewFeatures gerektiriyor,
    // üretime çıkan bir uygulamada Microsoft'un önermediği bir risk) ve DNSCrypt'in .NET'te
    // hiç yerleşik desteği olmadığı için ikisini de C#'ta native implemente etmek yerine bu
    // gerçek, aktif geliştirilen Go binary'sini iki ayrı yerel forwarder süreci olarak
    // çalıştırıyoruz (bkz. Dns/DoqProxyProcess.cs, Dns/DnsCryptProxyProcess.cs) — diğer 4
    // motorla aynı "vendored binary + shell out" deseni.
    tool: 'dnsproxy',
    url: 'https://github.com/AdguardTeam/dnsproxy/releases/download/v0.84.1/dnsproxy-windows-amd64-v0.84.1.zip',
    extract(zip, destDir) {
      const wanted = new Set(['dnsproxy.exe']);
      let count = 0;
      for (const entry of zip.getEntries()) {
        const base = path.basename(entry.entryName);
        if (!wanted.has(base.toLowerCase())) continue;
        fs.writeFileSync(path.join(destDir, base), entry.getData());
        count += 1;
      }
      if (count !== wanted.size) {
        throw new Error(`dnsproxy: beklenen ${wanted.size} dosyadan ${count} tanesi bulundu (zip yapısı değişmiş olabilir)`);
      }
      return count;
    },
  },
  {
    // nextdns/nextdns (MIT lisanslı) -- Vodafone TR'de bizim 6 DoH sağlayıcımızın hiçbiri
    // çalışmazken, resmi NextDNS uygulamasının (farklı bir istemci/ağ yığını, AYNI hedefe:
    // dns.nextdns.io) çalıştığı gözlemlendi. Profilsiz/hesapsız modda ("nextdns run -listen",
    // hiç -profile verilmeden) çalıştırılıyor -- bkz. Dns/NextDnsProxyProcess.cs. Kaynak kodu
    // (run.go) incelenip canlı test edildi: profil olmadan sabit olarak
    // "https://dns.nextdns.io/"e gidiyor, hesap/kayıt gerektirmiyor.
    tool: 'nextdns',
    url: 'https://github.com/nextdns/nextdns/releases/download/v1.47.3/nextdns_1.47.3_windows_amd64.zip',
    extract(zip, destDir) {
      const wanted = new Set(['nextdns.exe']);
      let count = 0;
      for (const entry of zip.getEntries()) {
        const base = path.basename(entry.entryName);
        if (!wanted.has(base.toLowerCase())) continue;
        fs.writeFileSync(path.join(destDir, base), entry.getData());
        count += 1;
      }
      if (count !== wanted.size) {
        throw new Error(`nextdns: beklenen ${wanted.size} dosyadan ${count} tanesi bulundu (zip yapısı değişmiş olabilir)`);
      }
      return count;
    },
  },
];

async function download(url) {
  // Node'un yerleşik fetch/undici'si bazı kurumsal/sanal ağ ortamlarında bağlantı
  // zaman aşımına uğrayabiliyor; sistemin curl'ü (Windows 10 1803+ ve Git Bash'te
  // hazır gelir) çok daha güvenilir olduğu için indirmeyi ona devrediyoruz.
  try {
    return execFileSync('curl', ['-sL', '--fail', url], {
      maxBuffer: 200 * 1024 * 1024,
      encoding: 'buffer',
    });
  } catch (err) {
    throw new Error(`İndirme başarısız: ${url}\n${err.message}`);
  }
}

async function fetchTarget(target) {
  console.log(`[${target.tool}] indiriliyor: ${target.url}`);
  const buffer = await download(target.url);
  const zip = new AdmZip(buffer);
  const destDir = path.join(RESOURCES_BIN, target.tool);
  fs.mkdirSync(destDir, { recursive: true });
  const count = target.extract(zip, destDir);
  console.log(`[${target.tool}] tamam (${count} dosya) -> ${destDir}`);
}

async function main() {
  fs.mkdirSync(RESOURCES_BIN, { recursive: true });
  for (const target of TARGETS) {
    await fetchTarget(target);
  }
  buildByeDpi();
  console.log('\nTüm DPI araçları hazır. Servisi yeniden build etmeyi unutma: dotnet build service/SplitCordService');
}

main().catch((err) => {
  console.error('HATA:', err.message);
  process.exitCode = 1;
});
