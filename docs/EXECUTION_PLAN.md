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

## Active package: EO-02

- **EO-01-A — Accepted:** Fork veya bulk copy olmadan ayrı temiz repository ve fiziksel sınır kuruldu. Kabul commit'i: `cb02ef7c2e9236ab50da792f21d667fae91cbccd`.
- **EO-01-B — Accepted:** Güncel resmî Shopify stack, temiz dependency manifest/lockfile ve negatif CI kapıları merge edildi. Kabul commit'i: `111e7dec66c84c48be43930f3496ea5b0f918949`.
- **EO-01-C — Accepted:** Polaris 2.0 RC üç-route truthful preview shell ürün sahibi tarafından görsel olarak kabul edildi ve merge edildi. Kabul commit'i: `76ea38a474c701d69871f73ba713376e3a7d623e`.
- **EO-02-A — Accepted:** Ayrı Frankfurt Supabase projesinde private schema, owner/migrator/runtime rol sınırı ve temiz migration zinciri canlı olarak doğrulandı; PR #4 merge commit'i: `2ac00f969eb35ac632ead57017753ed495e7b66f`.
- **EO-02-B — Ready:** Workspace, installation ve generation authority başlangıç brief'i bekliyor.\n- **EO-02-C/D — Not started:** EO-02-B kabulünden önce başlamaz.

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
