# SplitCord-Turkey — Linux Portu

SplitCord-Turkey'nin Linux karşılığı. Bu klasör, repo kökündeki Windows tarafından (`service/`,
`client/`, `vendor/`, `resources/`, `scripts/`) **tamamen bağımsız** bir kopyadır — hiçbiri
birbirine dokunmaz, ikisi de aynı repodan ayrı ayrı release edilir.

**Önce şunu oku: [`PORTING_PLAN.md`](PORTING_PLAN.md)** — bu portun tüm ilerlemesi, kararları ve
açık riskleri orada tutuluyor. Bu iş birden çok oturumda ilerliyor; her yeni oturum önce o dosyayı
okumalı.

**AppImage desteği (Fedora/Manjaro/Arch/openSUSE/EndeavourOS hedefli) üzerinde çalışıyorsan ayrıca
[`PORT_PLAN_2.md`](PORT_PLAN_2.md)'yi de oku** — `.deb` hattına DOKUNMADAN AppImage eklemek için
açılan ayrı bir takip dosyası, kendi karar günlüğü/faz listesi var.

## Mimari (Windows tarafıyla aynı fikir, farklı uygulama)

- **`service/SplitCordServiceLinux/`** — bir systemd servisi olarak çalışan .NET 8 servisi. Aynı
  yerel REST API'yi (127.0.0.1:58271) sunar, aynı 3 motor mimarisini kullanır: **Zapret** (nfqws +
  Linux NFQUEUE/iptables), **Zapret2** (nfqws2 + blockcheck2.sh, native bash — Cygwin yok),
  **ByeDPI** (ciadpi, SOCKS5 proxy, root gerektirmez). GoodbyeDPI Linux'ta yok (bkz. PORTING_PLAN.md
  D-2).
- **`client/`** — aynı Electron istemcisinin Linux'a paketlenmiş hali (AppImage + deb).
- **`vendor/byedpi-src/`** — ByeDPI'nin bağımsız kaynak kopyası (Windows'takiyle aynı, `win_service.c`
  Linux build'inde derlenmez).
- **`scripts/`** — Linux binary'lerini indiren/derleyen script'ler (`fetch-binaries.js`,
  `build-byedpi.sh`).
- **`packaging/`** — systemd unit dosyası + install/uninstall script'leri.

## Dev ortamı durumu

Linux Mint üzerinde canlı olarak test edildi ve çalışıyor — hem `.deb` hem AppImage paketleme
hattı doğrulandı. Diğer dağıtımlar (Debian/Ubuntu ailesi dışındakiler) best-effort/teorik olarak
hazırlandı ama ayrıca canlı test edilmedi.

## Windows tarafıyla paylaşılan tek şey

Yerel REST API portu (58271) ve genel istek/yanıt şekli bilinçli olarak AYNI tutuluyor — ama bu bir
kod paylaşımı değil, iki bağımsız implementasyonun aynı sözleşmeye uymasıdır.
