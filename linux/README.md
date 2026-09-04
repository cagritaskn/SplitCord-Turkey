# SplitCord-Turkey — Linux Portu

SplitCord-Turkey'nin Linux karşılığı. Bu klasör, repo kökündeki Windows tarafından (`service/`,
`client/`, `vendor/`, `resources/`, `scripts/`) **tamamen bağımsız** bir kopyadır — hiçbiri
birbirine dokunmaz, ikisi de aynı repodan ayrı ayrı release edilir.

**Önce şunu oku: [`PORTING_PLAN.md`](PORTING_PLAN.md)** — bu portun tüm ilerlemesi, kararları ve
açık riskleri orada tutuluyor. Bu iş birden çok oturumda ilerliyor; her yeni oturum önce o dosyayı
okumalı.

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

Henüz canlı bir Linux test ortamı yok (bkz. PORTING_PLAN.md §7). Kod, upstream projelerin (bol-van/zapret,
bol-van/zapret2, hufrea/byedpi) kendi Linux desteğine dayanarak yazılıyor ama gerçek bir Linux
çekirdeğinde doğrulanmadı. Önerilen sıra: WSL2 (systemd + NFQUEUE) → özel WSL2 kernel → yerel VM →
cloud VM. Detay için PORTING_PLAN.md §"Test/geliştirme ortamı önerisi"ne bakın.

## Windows tarafıyla paylaşılan tek şey

Yerel REST API portu (58271) ve genel istek/yanıt şekli bilinçli olarak AYNI tutuluyor — ama bu bir
kod paylaşımı değil, iki bağımsız implementasyonun aynı sözleşmeye uymasıdır.
