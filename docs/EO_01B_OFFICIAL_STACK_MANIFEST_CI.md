# EO-01-B — Official stack, clean manifest and negative CI

## Analist brief'i

### İş amacı ve kullanıcı sonucu

Yeni AdsTable embedded uygulamasının teknik temeli, eski repository'nin dependency ağını taşımadan Shopify'ın güncel resmî başlangıç yoluna sabitlenir. Kullanıcı bu pakette yeni bir ekran görmez; sonraki bütün ürün kodu temiz ve denetlenebilir bir temel üzerinde gelişir.

### Resmî doğrulama — 6 Ekim 2026

- Shopify çoğu yeni uygulama için React Router template'i öneriyor.
- Public embedded uygulamanın App Home modeli developer-hosted iframe'dir.
- Production için önerilen Polaris kanalı `polaris-1.js`; güncel stable sürüm 1.1'dir.
- Polaris 2.0 yalnız release candidate durumundadır ve production baseline değildir.
- React Router template'in güncel `package.json` blob'u: `04cae87ee4c267fc4d7e6e3278b42838ac28a13a`.

Resmî kaynaklar:

- https://shopify.dev/docs/apps/build/scaffold-app
- https://shopify.dev/docs/api/libraries-and-templates
- https://shopify.dev/docs/apps/build/app-home
- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning
- https://shopify.dev/docs/apps/build/app-home/polaris2

## Stack kararı

- Framework: Shopify'ın resmî React Router template ailesi
- Node.js: `>=22.12`
- Package manager: `pnpm@11.25.0`
- Shopify server integration: `@shopify/shopify-app-react-router@3.0.1`
- App Bridge React integration: `@shopify/app-bridge-react@4.2.4`
- React Router: `7.18.2`; Shopify package peer sınırı `^7.6.2` ile uyumludur
- React: `18.3.1`; resmî template baseline'ı korunur
- Polaris runtime: stable `polaris-1.js`
- Polaris types: `@shopify/polaris-types@1.1.0`

> Tarihsel karar notu: Bu EO-01-B baseline'ı 6 Ekim 2026'da kabul edildi; aynı gün ürün sahibinin açık talimatıyla EO-01-C altında Polaris 2.0 RC runtime ve matching RC types tarafından supersede edildi. Aktif karar için UI Constitution ve EO-01-C contract'ı esastır.

## Bilinçli olarak eklenmeyenler

- Prisma, SQLite ve `@shopify/shopify-app-session-storage-prisma`
- `express` doğrudan dependency'si
- `googleapis`, `@supabase/supabase-js` ve provider SDK'ları
- Shopify CLI'nin demo ürün kodu, route'ları ve örnek webhook'ları
- vite-tsconfig-paths; path alias kullanılmayacağı için deprecated tsconfck transitifi temiz ürüne alınmaz
- Vercel/Supabase bağlantısı, environment değerleri ve secret'lar

Session/data plane EO-02'de least-privilege Supabase kararıyla kurulacaktır. Bu paket database seçimi yapmaz.

## CI negatif kontrolleri

- Manifest yalnız kayıtlı exact direct dependency'leri içerir.
- Eski manifest veya lockfile kökeni kabul edilmez.
- Legacy provider/table/authority/debug/operator/acceptance token'ları runtime köklerinde yasaktır.
- Environment erişimi allowlist dışına çıkamaz.
- Polaris 2 RC runtime referansı active source/config içinde yasaktır.
- `public/`, kök `server.js` ve legacy build yüzeyi yasaktır.
- Lockfile frozen install ile doğrulanır; lifecycle scriptleri CI install sırasında çalıştırılmaz.

## Kapsam dışı

Üç ürün route'u, Shopify authentication/session implementation, Vercel preview, database, provider bağlantısı ve görsel kabul EO-01-B kapsamında değildir.

## Kabul

1. Manifest ve lockfile sıfırdan üretilmiştir.
2. Dependency registry her direct package için zorunlu karar alanlarını içerir.
3. Frozen install PASS olur.
4. Tüm governance/negative testler PASS olur.
5. GitHub CI PASS olur.
6. Açık kullanıcı onayı olmadan merge edilmez.

## Rollback

PR merge edilmeden branch bırakılabilir. Merge sonrası sorun çıkarsa EO-01-B merge commit'i revert edilir; EO-01-A temiz repository sınırı korunur.
