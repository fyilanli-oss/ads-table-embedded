# AdsTable Embedded Execution Plan

## Authority

Bu repository onaylı A6-EO embedded-only temiz yeniden kuruluş programını uygular.

- Karar kaynağı: `fyilanli-oss/ads-table-dev`
- Kaynak karar commit'i: `3416ee736fc3c53910e5e6571a7b8f445c4ce3cd`
- Legacy repository'den as-is taşınan application/runtime modülü: **0**
- Legacy repository EO-09 cutover tamamlanana kadar containment ve rollback hattıdır.

## Product boundary

- Shopify embedded iframe application
- Aktif providerlar: Meta, Google Ads, Klaviyo
- Canonical yüzeyler: Funnel App Home (`/`), Ad Analysis (`/ad-analysis`), Settings (`/settings`)
- EO-08 review gate ve ayrıca açık cutover kararı gelene kadar preview-only
- EO-01 sırasında production domain, Shopify app config, provider, live data/token veya legacy retirement mutation yoktur.

## Ordered program

1. **EO-01 — Clean runtime shell, CI and dependency boundary**
2. **EO-02 — Workspace, installation, billing/trial and privacy foundations**
3. **EO-03 — Canonical OAuth, connection and token vault**
4. **EO-04 — Meta, Google Ads and Klaviyo adapters**
5. **EO-05 — Scheduler, Dataset V2, FX, maturity and reconciliation**
6. **EO-06 — Formula, Query and same-origin BFF/API**
7. **EO-07 — Shopify-native three-surface UI**
8. **EO-08 — Carry rehearsal, parity, canary and rollback**
9. **EO-09 — Authority cutover stabilization and consumer-zero**
10. **EO-10 — Legacy archive, retention and controlled retirement**

Aynı anda yalnız bir parent paket aktiftir. Executable paket tablosu `contracts/a6-eo-implementation-master-v1.json` dosyasındadır.


## Frozen product decision: EO-07 three-surface UI — 7 October 2026

Binding analyst brief: `docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md`  
Executable contract: `contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json`

- Funnel App Home, Ad Analysis and Settings table/control/workflow behavior is frozen without advancing EO-07 or authorizing UI implementation.
- Funnel contextual dashboard work is waiting for the product-owner relationship-graph reference package; unrelated classic-chart assumptions are forbidden.
- Ad Analysis charts remain blocked until EO-07-C verifies the deepest analytical leaf and both exact earring/cross-sell fixtures independently for Meta, Google Ads and Klaviyo.
- Settings has no chart surface.
- The working legacy Settings flow is interaction evidence only; legacy source, styling and retired-provider UI are not copied.

## Active package: EO-02

- **EO-01-A — Accepted:** Fork veya bulk copy olmadan ayrı temiz repository ve fiziksel sınır kuruldu. Kabul commit'i: `cb02ef7c2e9236ab50da792f21d667fae91cbccd`.
- **EO-01-B — Accepted:** Güncel resmî Shopify stack, temiz dependency manifest/lockfile ve negatif CI kapıları merge edildi. Kabul commit'i: `111e7dec66c84c48be43930f3496ea5b0f918949`.
- **EO-01-C — Accepted:** Polaris 2.0 RC üç-route truthful preview shell ürün sahibi tarafından görsel olarak kabul edildi ve merge edildi. Kabul commit'i: `76ea38a474c701d69871f73ba713376e3a7d623e`.
- **EO-02-A — Accepted:** Ayrı Frankfurt Supabase projesinde private schema, owner/migrator/runtime rol sınırı ve temiz migration zinciri canlı olarak doğrulandı; PR #4 merge commit'i: `2ac00f969eb35ac632ead57017753ed495e7b66f`.
- **EO-02-B — Accepted:** Workspace, installation ve generation authority migration zinciri canlı Supabase'de PASS oldu; self-cleaning bootstrap/idempotency/stale/domain-change probe sonrası business row sıfır, Security ve Performance Advisor temizdir. PR #6 merge commit'i: `edc9e21588f5a32bea139b754ea0108c9809cf27`.
- **EO-02-C — Verification:** Shopify App Pricing + Partner API authority modeli donduruldu; server resolver, forced-RLS billing projection ve self-cleaning Supabase probe PASS oldu. 7 Ekim 2026'da yalnız `Manage apps` yetkili Partner API client oluşturuldu ve `2026-07` GraphiQL üzerinden AdsTable uygulama kimliği canlı PASS oldu; access token kanıta veya repository'ye yazılmadı. Partner Dashboard'da 14 günlük plan/trial ayarı, exact Vercel runtime secret aktivasyonu ve gerçek trial/active/null kabulü açık insan kapısıdır.
- **EO-02-D — Not started:** EO-02-C canlı Partner API kabulü tamamlanmadan başlamaz.

EO-02-A business tablo veya veri kurmaz, runtime credential'ı etkinleştirmez, canlı token/veri taşımaz, Vercel environment değiştirmez ve legacy Supabase projesine dokunmaz.

## Current official baseline

6 Ekim 2026 tarihinde Shopify'ın resmî App Home ve scaffold belgeleri kontrol edildi:

- Public App Store backend uygulaması developer-hosted iframe App Home modelini kullanır.
- Temiz başlangıç için resmî React Router template temel alınır.
- App Bridge ve Shopify Polaris web components ürün shell'inin zorunlu arayüz katmanıdır.
- Ürün sahibinin 6 Ekim 2026 tarihli açık kararıyla aktif baseline `polaris-2.0-rc.js` ve exact `@shopify/polaris-types@2.0.0-rc.2`'dir; RC riski kabul edilmiştir ve stable 1.x'e otomatik dönüş yapılamaz.

EO-01-B dependency pinlemeden ve EO-07 UI implementasyonundan önce resmî sürümler tekrar doğrulanır.


## Current Supabase baseline

6 Ekim 2026 tarihinde Supabase'in resmî API security, Postgres roles, RLS, connection ve breaking-change belgeleri kontrol edildi.

- Yeni project: `podpwkrpmjiksskxhwsu`, Frankfurt, PostgreSQL 17.11 GA.
- Private schema: `app`, `shopify`, `integrations`, `analytics`, `operations`, `privacy`, `billing`.
- Data API rolleri private schema'lara erişemez.
- Runtime şema kullanabilir fakat schema oluşturamaz ve henüz hiçbir tablo yetkisi yoktur.
- Runtime/migrator parolaları NULL'dır; Vercel bağlantısı bu paketin kapsamı değildir.
- Security ve performance advisor bulgusu sıfırdır.

## Current Shopify billing baseline

6 Ekim 2026 tarihinde Shopify'ın resmî Shopify App Pricing ve Partner API belgeleri kontrol edildi:

- Yeni public app için desteklenen fiyat modelinde varsayılan otorite Shopify App Pricing'dir; Manual Billing API legacy'dir.
- Plan, fiyat ve 14 günlük trial Shopify tarafında yaşar; AdsTable `appSubscriptionCreate` veya local trial grant üretmez.
- Canonical subscription read modeli Partner API `2026-07` `activeSubscription(appId, shopId)` sorgusudur.
- Trial kullanımı Shopify tarafından 180 günlük dönem boyunca izlenir; reinstall trial'ı sıfırlamaz.
- Shopify App Pricing billing webhook'u göndermez; redirect, app entry ve entitlement-korumalı işlerde kontrollü Partner API reconciliation gerekir.
- Bir aktif Reporting Store dahildir; aday tespiti ve aktif store değişimi ücret oluşturmaz.
