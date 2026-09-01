'use strict';

// Kaspersky/ESET tespit edildiğinde gösterilen bilgilendirme modalı — hem Ayarlar >
// İzinler ve Kontroller'deki "Daha Fazla Bilgi" butonundan (settings.js) hem de ana
// penceredeki otomatik tarama sonuçlandığında (bkz. titlebar.js) tetikleniyor, bu
// yüzden içerik tek bir yerde tutuluyor — modal.js'e bağımlı, ondan SONRA yüklenmeli.
(function () {
  const CONTENT = {
    kaspersky: {
      title: 'Kaspersky Tespit Edildi',
      message:
        "Kaspersky, WinDivert ile çalışan DPI aşım yöntemlerini etkisiz kılıyor. Kaspersky programını sisteminizden kaldırmadığınız sürece SplitCord-Turkey'i tam verim ile kullanamayacaksınız ve ses bağlantılarında sorun yaşayacaksınız.",
    },
    eset: {
      title: 'ESET Tespit Edildi',
      message:
        "ESET, WinDivert ile çalışan DPI aşım yöntemlerini etkisiz kılabiliyor. ESET programını sisteminizden kaldırmadığınız (veya SplitCord'un kullandığı araçlara istisna tanımlamadığınız) sürece SplitCord-Turkey'i tam verim ile kullanamayabilirsiniz.",
    },
  };

  window.showAntivirusDetectedModal = function (kind) {
    const content = CONTENT[kind];
    if (!content) return Promise.resolve();
    return window.showAlertModal({
      title: content.title,
      message: content.message,
      link: {
        url: 'https://github.com/cagritaskn/SplitCord-Turkey/blob/main/resources/ANTIVIRUS.md',
        label: 'Daha fazla bilgi',
      },
    });
  };
})();
