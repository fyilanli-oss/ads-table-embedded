# EO-01-C — Three-route truthful preview shell

## Analist brief'i

### İş amacı ve kullanıcı sonucu

Yeni embedded-only uygulamanın üç canonical ürün adresi ilk kez çalışan bir Vercel Preview üzerinde görünür. Ekranlar bağlantı, veri veya tamamlanmış ürün davranışı iddia etmez.

### Exact görünür metin ve durumlar

| Route | Heading | Section | Truthful empty copy |
|---|---|---|---|
| `/` | Funnel | Reporting preview | No reporting data is available in this preview. Connections and data loading will be added in later EO packages. |
| `/ad-analysis` | Ad Analysis | Analysis preview | No advertising analysis is available in this preview. No provider data has been requested or inferred. |
| `/settings` | Settings | Configuration preview | Connections and configuration are not available in this preview. Existing accounts, tokens, and settings remain unchanged. |

Bu pakette async işlem ve mutation yoktur. Loading, cancel ve success durumları uygulanamaz; connected durumu iddia edilmez. Root error boundary yalnız preview sayfasının açılamadığını ve hiçbir verinin değiştirilmediğini söyler.

### Shopify component mapping

| Görünür öğe | Exact component | Property | Kaynak |
|---|---|---|---|
| Sayfa | `s-page` | `heading` | https://shopify.dev/docs/api/app-home/latest |
| İçerik grubu | `s-section` | `heading` | https://shopify.dev/docs/api/app-home/latest |
| Metin | `s-paragraph` | — | https://shopify.dev/docs/api/app-home/latest |
| Preview route sırası | `s-stack` | `direction=inline`, `gap=base` | https://shopify.dev/docs/api/app-home/latest/web-components |
| Route bağlantısı | `s-link` | `href` | https://shopify.dev/docs/api/app-home/latest/web-components |

Kontrol tarihi: **6 Ekim 2026**. Ürün sahibinin açık kararıyla runtime `polaris-2.0-rc.js`, exact type paketi `@shopify/polaris-types@2.0.0-rc.2` olarak eşlenir; özel CSS, raw action control ve literal renk kullanılmaz. Shopify'ın RC değişim riski kabul edilir, stable 1.x'e otomatik geri dönüş yapılmaz.

`2.0.0-rc.2` 5 Ekim 2026'da yayımlandığı için pnpm'in 24 saatlik minimum release-age kapısında yalnız bu resmî Shopify paketi için dar bir istisna kayıtlıdır. Diğer supply-chain kontrolleri değişmez.

## Görsel kabul kanıtı — 6 Ekim 2026

- Kaynak commit: `622fcc8ebdef8df852ec4c345143335126144f9f`
- Vercel Preview deployment: `dpl_BiCqUCRDcYD3kUifEw7wztgufTsm`
- `/`, `/ad-analysis`, `/settings`: HTTP 200
- Canlı yanıtta tek Polaris runtime: `polaris-2.0-rc.js`; `polaris-1.js`: yok
- Desktop ve 320 px mobil teknik görünüm kontrolü: PASS
- Ürün sahibi görsel kabulü: 6 Ekim 2026 tarihinde alındı
- Merge: ayrı açık kullanıcı onayı bekliyor

### Vercel eşlemesi

Vercel'in resmî React Router preset'i `@vercel/react-router@1.3.7` ile SSR build hazırlanır. Yeni proje Git entegrasyonu ve production promotion olmadan oluşturulur; yalnız görev dalı commit'inden Preview deployment üretilir.

Resmî kaynaklar:

- https://vercel.com/docs/frameworks/frontend/react-router
- https://vercel.com/docs/deployments
- https://vercel.com/docs/cli/deploy

### Değişmeyecek davranış ve kapsam dışı

- Shopify OAuth/session yok.
- Supabase veya başka database yok.
- Meta, Google Ads ve Klaviyo isteği yok.
- Environment secret yok.
- Production deploy/domain/App URL değişikliği yok.
- EO-07 final görsel ürün uygulaması yok.

### Kabul ve rollback

Test, typecheck, build ve GitHub CI geçer. Üç Preview route HTTP 200 döner; desktop ve 320 px mobil görüntü kullanıcıya sunulur. Kullanıcı görsel kabulü ve ayrı merge onayı olmadan paket tamamlanmaz. Rollback, Preview deployment ve görev branch'inin kaldırılmasıdır; production etkisi yoktur.
