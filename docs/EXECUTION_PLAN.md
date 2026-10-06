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

## Active package: EO-01

- **EO-01-A:** Fork veya bulk copy olmadan ayrı temiz repository ve fiziksel sınır kurulur.
- **EO-01-B:** Güncel resmî Shopify stack seçilir; temiz dependency manifest/lockfile ile forbidden import/route/table/environment CI kontrolleri kurulur.
- **EO-01-C:** `/`, `/ad-analysis`, `/settings` için truthful empty shell hazırlanır ve preview-only deploy edilir.

EO-01 ürün verisi çekmez, live token taşımaz, business database schema kurmaz, production routing değiştirmez ve review-ready iddiasında bulunmaz.

## Current official baseline

6 Ekim 2026 tarihinde Shopify'ın resmî App Home ve scaffold belgeleri kontrol edildi:

- Public App Store backend uygulaması developer-hosted iframe App Home modelini kullanır.
- Temiz başlangıç için resmî React Router template temel alınır.
- App Bridge ve stable Polaris web components ürün shell'inin zorunlu arayüz katmanıdır.
- Polaris web components 1.1 stable; 2.0 release candidate olduğu için baseline seçilmemiştir.

EO-01-B dependency pinlemeden ve EO-07 UI implementasyonundan önce resmî sürümler tekrar doğrulanır.
