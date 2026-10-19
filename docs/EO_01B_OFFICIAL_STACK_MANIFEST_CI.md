# EO-01-B — Resmî teknoloji temeli, temiz bağımlılık bildirimi ve olumsuz senaryo kontrolleri

## Analist açıklaması

### İş amacı ve kullanıcı sonucu

Yeni AdsTable embedded uygulamasının teknik temeli, eski repository'nin bağımlılık ağı taşınmadan Shopify'ın resmî başlangıç yoluna sabitlenir. Kullanıcı bu pakette yeni ekran görmez; sonraki ürün kodu temiz ve denetlenebilir temel üzerinde gelişir.

Bu belge 6 Ekim 2026 tarihindeki EO-01-B kararını anlatır. Buradaki sürüm ve yasaklar tarihsel kapsamdır; aynı gün EO-01-C ile değiştirilen Polaris kararı aşağıda ayrıca belirtilmiştir. Güncel yetki Execution Plan ve UI Anayasası'ndadır.

### Tarihsel resmî doğrulama — 6 Ekim 2026

- Shopify çoğu yeni uygulama için React Router şablonunu öneriyor.
- Herkese açık embedded uygulamanın App Home modeli, geliştiricinin barındırdığı iframe'dir.
- O tarihte Production için önerilen Polaris kanalı `polaris-1.js`; kararlı sürüm 1.1'dir.
- Polaris 2.0 yalnız sürüm adayıdır (release candidate); EO-01-B'nin Production temeli değildir.
- React Router şablonunun `package.json` blob'u: `04cae87ee4c267fc4d7e6e3278b42838ac28a13a`.

Resmî kaynaklar:

- https://shopify.dev/docs/apps/build/scaffold-app
- https://shopify.dev/docs/api/libraries-and-templates
- https://shopify.dev/docs/apps/build/app-home
- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning
- https://shopify.dev/docs/apps/build/app-home/polaris2

## Teknoloji kararı

- Framework: Shopify'ın resmî React Router şablon ailesi
- Node.js: `>=22.12`
- Paket yöneticisi: `pnpm@11.25.0`
- Shopify sunucu entegrasyonu: `@shopify/shopify-app-react-router@3.0.1`
- App Bridge React entegrasyonu: `@shopify/app-bridge-react@4.2.4`
- React Router: `7.18.2`; Shopify paketinin eş bağımlılık sınırı `^7.6.2` ile uyumlu
- React: `18.3.1`; resmî şablonun başlangıç sürümü korunur
- Polaris çalışma zamanı: kararlı `polaris-1.js`
- Polaris tip paketi: `@shopify/polaris-types@1.1.0`

> Tarihsel karar notu: EO-01-B'nin bu temeli 6 Ekim 2026'da kabul edildi. Aynı gün ürün sahibinin açık talimatıyla EO-01-C altında Polaris 2.0 RC çalışma zamanı ve eşleşen RC tipleri bunun yerini aldı. Aktif karar için UI Anayasası ve EO-01-C sözleşmesi esastır.

## Bilinçli olarak eklenmeyenler

- Prisma, SQLite ve `@shopify/shopify-app-session-storage-prisma`
- Doğrudan `express` bağımlılığı
- `googleapis`, `@supabase/supabase-js` ve sağlayıcı SDK'ları
- Shopify CLI'nin demo ürün kodu, uygulama adresleri ve örnek webhook'ları
- vite-tsconfig-paths: dosya yolu takma adı kullanılmayacağı için artık önerilmeyen tsconfck dolaylı bağımlılığı temiz ürüne alınmaz
- Vercel/Supabase bağlantısı, ortam değişkeni değerleri ve gizli bilgiler

Oturum ve veri katmanı EO-02'de en az yetkili Supabase kararıyla kurulacaktır. Bu paket veritabanı seçimi yapmaz.

## CI olumsuz senaryo kontrolleri

- Bağımlılık bildirimi yalnız kayıtlı, sürümü tam sabitlenmiş doğrudan bağımlılıkları içerir.
- Eski bağımlılık bildirimi veya lockfile kökeni kabul edilmez.
- Eski sağlayıcı/tablo/yetki/debug/operatör/kabul kimlikleri çalışma zamanı köklerinde yasaktır.
- Ortam değişkeni erişimi izin verilenler listesini aşamaz.
- Bu tarihsel EO-01-B kararında Polaris 2 RC çalışma zamanı referansı aktif kaynak ve yapılandırmada yasaktır.
- `public/`, kök `server.js` ve eski derleme yüzeyi yasaktır.
- Lockfile, değiştirilmesine izin vermeyen kurulumla (frozen install) doğrulanır; bağımlılıkların yaşam döngüsü betikleri CI kurulumu sırasında çalıştırılmaz.

## Kapsam dışı

Üç ürün adresi, Shopify kimlik doğrulama/oturum uygulaması, Vercel önizlemesi, veritabanı, sağlayıcı bağlantısı ve görsel kabul EO-01-B kapsamında değildir.

## Kabul

1. Bağımlılık bildirimi ve lockfile sıfırdan üretilmiştir.
2. Bağımlılık kayıt defteri, her doğrudan paket için zorunlu karar alanlarını içerir.
3. Lockfile'ı değiştirmeyen kurulum geçer.
4. Bütün repository yönetişim ve olumsuz senaryo testleri geçer.
5. GitHub CI geçer.
6. Açık kullanıcı onayı olmadan merge yapılmaz.

## Geri alma

PR merge edilmeden görev dalı bırakılabilir. Merge sonrası sorun çıkarsa EO-01-B merge commit'i revert edilir; EO-01-A'nın temiz repository sınırı korunur.
