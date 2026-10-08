# AdsTable Embedded Execution Plan

## Authority

Bu repository onaylı A6-EO embedded-only temiz yeniden kuruluş programını uygular.

- Aktif karar kaynağı: bu repository ve `docs/EXECUTION_PLAN.md`
- İlk kuruluş provenance/evidence kaynağı: `fyilanli-oss/ads-table-dev` commit `3416ee736fc3c53910e5e6571a7b8f445c4ce3cd`
- Legacy repository aktif karar otoritesi değildir; yalnız referans, kanıt, containment ve rollback kaynağıdır.
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


## Cross-cutting safety, capacity and portability freeze — 7 October 2026

Binding analyst brief: `docs/A6_EO_CROSS_CUTTING_SAFETY_CAPACITY_FREEZE.md`  
Executable contract: `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

- Hourly refresh is staggered and limited to today+yesterday; provider-specific deep reconciliation runs every 24 hours and governs truthful finality.
- Summary/Table custom ranges are limited to 90 days, Daily to 31 days; compare uses equal non-overlapping periods in the Reporting Store timezone.
- Production acceptance targets are critical DB RPO ≤15 minutes, Dataset V2 RPO ≤60 minutes, degraded RTO ≤60 minutes and full RTO ≤240 minutes.
- Supabase capacity is measured, not inferred from workspace count. The target is 2,000 certified active workspaces with 4,000-workspace stress evidence and at least 30% headroom.
- The scale ladder remains inside measured PostgreSQL/Supabase scaling first; a database-platform migration cannot be an outage response.
- Export is outside the first review slice; when introduced it must be asynchronous and isolated from the interactive query pool.
- This cross-cutting decision changes no package status and authorizes no live infrastructure mutation.

## Demo fixture, export reference and Shopify dev-store boundary — 7 October 2026

Binding analyst brief: `docs/A6_EO_DEMO_FIXTURE_EXPORT_REFERENCE.md`  
Executable contract: `contracts/a6-eo-demo-fixture-export-reference-v1.json`

- The legacy dashboard HTML is reference and fixture raw material only; no HTML/JavaScript is copied into the new runtime.
- Its 1,000-row, 50-day synthetic dataset is routed to EO-05/06/07/08 as a clean Dataset V2 fixture, UI acceptance source, Shopify dev-store demo and deterministic capacity-generator seed.
- Every normalized row is marked synthetic and non-provider truth. It cannot prove provider capability, native attribution, finality, real zero, product attribution or cross-sell.
- Export behavior is captured as post-review reference only; export implementation remains outside the first review slice.
- A dedicated Shopify dev store/workspace may later demonstrate embedded UI truthfully without fake provider connections.
- The source fixture is insufficient for product/cross-sell acceptance; EO-07-C retains that separate live-evidence gate.
- This decision changes no package status and authorizes no dev-store, provider, production or database mutation.

## A6-EO-07 three-surface UI product freeze — 7 October 2026

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
- **EO-02-C — Verification:** Shopify App Pricing + Partner API authority modeli, forced-RLS billing projection ve Supabase probe hazırdır. 8 Ekim 2026'da App Store registration, Production Vercel Partner secret/deployment ve `activeSubscription` null/trial/active provider kabulü PASS oldu. Trial, public `AdsTable Monthly` planında effective `USD 0.0` ve `price.active=false`; active durum, hedef mağazaya açılan private `shopify-test` planında `trialEndsAt=null`, geçerli billing cycle, effective `USD 0.0` ve `price.active=true` döndürdü. Fiyat-sürümü metadata düzeltmesi PR #18 ile merge edilip Production'a alındı. Browser/response/application/platform log sızıntı kontrolleri PASS oldu. PR #23 ile Supabase Root CA doğrulamalı transaction-pooler TLS Production'a alındı; Shopify Admin desktop ilk yükleme ve tam sayfa reload PASS oldu. Canlı database artık bir workspace, generation-1 active installation, ciphertext-only runtime session, active subscription projection ve active entitlement taşır; Reporting Store limiti 1, aday tespiti ve store değişimi ücret bayrakları false'tur. Gerçek mobil Shopify uygulamasında Funnel, Ad Analysis, Settings ve tam uygulama kapatıp yeniden açma kabulü PASS oldu; canlı projection sayıları tutarlı ve kontrol edilen Vercel runtime penceresi hatasız kaldı. Açık ürün sahibi kapanış onayı kaydedilmeden paket kapanmaz ve EO-02-D başlamaz.
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

8 Ekim 2026 tarihinde Shopify'ın resmî Shopify App Pricing ve Partner API belgeleri yeniden kontrol edildi:

- Yeni public app için desteklenen fiyat modelinde varsayılan otorite Shopify App Pricing'dir; Manual Billing API legacy'dir.
- Plan, fiyat ve 14 günlük trial Shopify tarafında yaşar; AdsTable `appSubscriptionCreate` veya local trial grant üretmez.
- Canonical subscription read modeli Partner API `2026-07` `activeSubscription(appId, shopId)` sorgusudur.
- `price.active` yalnız fiyat sürümünün güncel katalog fiyatı olup olmadığını gösterir; subscription veya entitlement aktiflik bayrağı değildir.
- Trial kullanımı Shopify tarafından 180 günlük dönem boyunca izlenir; reinstall trial'ı sıfırlamaz.
- Shopify App Pricing billing webhook'u göndermez; redirect, app entry ve entitlement-korumalı işlerde kontrollü Partner API reconciliation gerekir.
- Bir aktif Reporting Store dahildir; aday tespiti ve aktif store değişimi ücret oluşturmaz.


## A6-EO-07-B Funnel visualization reference — 7 October 2026

- Product-owner graph reference is accepted and bound by `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md` and `contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json`.
- Performance relates Sales, Revenue and Spend. Intent relates Add to Cart, Checkout, Abandoned and Purchase.
- User-facing terminology is `Sales`; internal `sales_value` may remain an implementation key.
- Current period uses solid and comparison uses dashed encoding; meaning of favorable/unfavorable change comes from the metric contract.
- Chart, selected-point detail, KPI summary and table must use one BFF/query/formula authority.
- SVG/Canvas is permitted only within the chart data plane. All surrounding UI remains exact official Polaris/App Bridge.
- Ad Analysis charts remain blocked until A6-EO-07-C evidence and a separate accepted graph brief.
- No new package was opened; A6-EO-07 status did not advance and implementation/live mutation remains unauthorized.


## A6-OPS-LOCAL-01 — One-time local safety cleanup

**Status:** Ready; execution not started  
**Type:** Independent operational package; outside the A6-EO dependency chain

- **A6-OPS-LOCAL-01-A — Read-only inventory and freeze:** Enumerate AdsTable roots, status, branches, stashes, worktrees, common Git metadata and local-only candidates without mutation.
- **A6-OPS-LOCAL-01-B — Classification and remote-equivalence proof:** Separate meaningful work, secrets/backups, disposable outputs, active/archiveable worktrees and stale metadata; prove GitHub equivalence before cleanup.
- **A6-OPS-LOCAL-01-C — Recoverable cleanup execution:** Only after a fresh manifest and separate user approval, archive eligible managed worktrees and remove proven disposable material from exact validated roots.
- **A6-OPS-LOCAL-01-D — Closure evidence:** Prove zero meaningful local-only project work, intact anchor/common metadata, readable remote equivalents and recorded exceptions.

Opening this package authorizes no deletion. It does not change the 10 A6-EO parents, 43 stable EO children, current A6-EO-02-C gate or any product implementation sequence. Recurrence is prevented by the mandatory end-of-package local-only-zero gate.


### EO-02-C corrective gate — Shopify runtime authentication bridge

EO-02-C internal caller kodu tek başına canlı tetikleyici değildir. `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md` ve `contracts/eo-02c-shopify-runtime-auth-bridge-v1.json` PASS olmadan database Secret etkinleştirilemez, EO-02-C kapatılamaz ve EO-02-D başlatılamaz. Ürün URL'leri ve mevcut preview görünümü korunur.
