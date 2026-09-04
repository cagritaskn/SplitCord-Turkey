`vendor/byedpi-src/*.c`/`*.h`'nin bağımsız kopyası (bkz. PORTING_PLAN.md D-4) — SplitCord-Turkey'in
DoH yaması dahil (bkz. proxy.c'deki `sc_doh_resolve`), Windows'takiyle birebir aynı kaynak.

`win_service.c`/`win_service.h` BİLİNÇLİ OLARAK buraya kopyalanmadı — yalnızca Windows Service
sarmalayıcısı, Linux build'inde hiç gerekmiyor (main.c zaten `#ifndef _WIN32` ile bu dosyayı
içermeden derleniyor).

Derleme için bkz. `linux/scripts/build-byedpi.sh` — DOĞRULANMADI, gerçek bir Linux'ta hiç
derlenmedi (bkz. PORTING_PLAN.md §2 madde 5).
