'use strict';

// PORT_PLAN_2.md AP-16 (2026-09-09, kullanıcı talebi) — hem ana pencere (titlebar.js, DPI motoru
// tükendiğinde) hem Ayarlar > İzinler paneli (settings.js, "Eylem Gerekiyor" butonu) AYNI
// `/dependency-check` sonucundan AYNI görsel uyarıyı/"Sorun Bildir" gövdesini üretmesi gerektiği
// için (kod tekrarı yerine) tek, paylaşılan bir yardımcı — modal.js'in yüklendiği AYNI şekilde
// hem index.html hem settings.html'e <script> olarak eklendi.
(function () {
  // ciadpi/nfqws/nfqws2 -- DistroPackageHints.cs'te BİLEREK karşılığı yok (bkz. oradaki not):
  // bunlar AppImage'ın KENDİ gömülü binary'leri, bir paket yöneticisiyle kurulamaz -- eksik/bozuk
  // olmaları bir PAKETLEME sorunu, kullanıcıya "paketi kur" değil "bir hata bildir" gösterilmeli.
  const PACKAGING_OWNED_IDS = new Set(['ciadpi', 'nfqws', 'nfqws2']);

  function buildDependencyDiagnostic(result) {
    const items = result?.items || [];
    const missing = items.filter((item) => !item.ok);
    const distro = result?.distro || {};
    const distroLabel = distro.prettyName || distro.id || 'Bilinmeyen dağıtım';

    if (missing.length === 0) {
      return { hasIssue: false };
    }

    const lines = missing.map((item) => {
      const parts = [`• ${item.label}`];
      if (item.detail) parts.push(`  ${item.detail}`);
      if (item.fixHint) {
        parts.push(`  Önerilen çözüm: ${item.fixHint}`);
      } else if (PACKAGING_OWNED_IDS.has(item.id)) {
        parts.push('  Bu, paket yöneticinle çözebileceğin bir şey değil -- AppImage paketlemesiyle ilgili bir sorun olabilir, lütfen bildir.');
      }
      return parts.join('\n');
    });

    const issueTitle = `AppImage bağımlılık sorunu: ${distroLabel}`;
    const issueBody = [
      `**Dağıtım:** ${distroLabel} (id: ${distro.id || 'bilinmiyor'}, aile: ${distro.family || 'bilinmiyor'})`,
      '',
      '**Eksik/çalışmayan bileşenler:**',
      ...missing.map((item) => `- ${item.label}${item.detail ? ` — ${item.detail}` : ''}`),
      '',
      '(Bu şablon otomatik dolduruldu, lütfen sorunla ilgili ek bilgi/adım eklemekten çekinme.)',
    ].join('\n');

    return {
      hasIssue: true,
      title: `⚠ Bağımlılık Sorunu Tespit Edildi (${distroLabel})`,
      message: 'DPI aşımı, bazı eksik sistem bileşenleri yüzünden düzgün çalışmıyor olabilir.',
      detail: lines.join('\n\n'),
      issueTitle,
      issueBody,
    };
  }

  window.buildDependencyDiagnostic = buildDependencyDiagnostic;
})();
