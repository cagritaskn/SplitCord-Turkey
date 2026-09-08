DPI araçlarının Linux ikililerini indiren/derleyen script'ler.

- `fetch-binaries.js` — hepsini sırayla çalıştıran ana giriş noktası (dnsproxy/nextdns hazır
  binary indirir; zapret/zapret2/byedpi/iptables-nft/nftables kaynaktan derler).
- `build-byedpi.sh`, `build-zapret.sh`, `build-zapret2.sh` — ilgili motorun kaynağını indirip derler.
- `build-iptables-nft.sh`, `build-nftables.sh` — AppImage'ın içine gömülecek `iptables`/`ip6tables`/`nft`'i derler.
- `bundle-libs.sh` — bir binary'nin bağlı olduğu paylaşımlı kütüphaneleri yanına kopyalayıp RPATH ayarlar.
