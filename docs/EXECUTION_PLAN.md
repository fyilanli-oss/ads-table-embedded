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


## Parent package Analysis–Design Book closure gate — 9 October 2026

Binding contract: `contracts/a6-parent-package-analysis-design-closure-v1.json`  
CI enforcement: `tests/a6-parent-analysis-design-books.test.js`

- `Done` veya `Accepted` durumundaki her parent paket, teknik olmayan bir okuyucunun iş akışını anlayabileceği kabul edilmiş bir Analysis–Design Book taşır.
- EO-01: `docs/EO_01_ANALYSIS_DESIGN_BOOK.md`
- EO-02: `docs/EO_02_ANALYSIS_DESIGN_BOOK.md`
- EO-03: `docs/EO_03_ANALYSIS_DESIGN_BOOK.md`
- EO-04 ve sonraki parent paketler kendi kitapları oluşmadan kapatılamaz; eksik dosya veya ledger kaydı CI'ı düşürür.
- Kitaplar executable contract ve testlerin yerine geçmez; onları analist diliyle açıklayan operasyonel kütüphane katmanıdır.



## Secret inventory, custody and recovery gate — 10 October 2026

Binding analyst brief: `docs/A6_EO_SECRET_INVENTORY_AND_RECOVERY.md`  
Executable contract: `contracts/a6-eo-secret-inventory-recovery-v1.json`  
CI enforcement: `tests/a6-eo-secret-inventory-recovery.test.js`

- Current baseline is eleven Production Vercel entries and one GitHub Actions secret; the repository stores names and procedures, never values.
- Vercel/GitHub masking is expected write-only behavior and does not mean a value was deleted.
- Secret mutation requires exact-key product-owner approval, impact map, rollback, approved encrypted recovery-vault capture, redeploy/workflow verification and secret-free evidence.
- Existing independent recovery copies are not assumed. A generated encryption key cannot be recreated to decrypt old ciphertext.
- Before the first real provider authorization, the provider-token key recovery gate and the provider-specific inventory extension must pass.
- Production credentials are never copied to Preview or Development; non-production environments require isolated credentials.
- This decision authorizes no secret, provider, database, environment or deployment mutation.


## Cross-cutting safety, capacity and portability freeze — 7 October 2026

Binding analyst brief: `docs/A6_EO_CROSS_CUTTING_SAFETY_CAPACITY_FREEZE.md`  
Executable contract: `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

- Hourly refresh is staggered and limited to today+yesterday; provider-specific deep reconciliation runs every 24 hours and governs truthful finality.
- Summary/Table custom ranges are limited to 90 days, Daily to 31 days; compare uses equal non-overlapping periods in the installed Shopify shop timezone.
- Production acceptance targets are critical DB RPO ≤15 minutes, Dataset V2 RPO ≤60 minutes, degraded RTO ≤60 minutes and full RTO ≤240 minutes.
- Supabase capacity is measured, not inferred from workspace count. The target is 2,000 certified active workspaces with 4,000-workspace stress evidence and at least 30% headroom.
- Zorunlu test merdiveni: EO-05 başlamadan workload budget + index/query-plan baseline; EO-05 içinde 2,000-workspace hourly scheduler, 4,000-workspace compressed stress ve 24 saatlik 2,000-workspace soak; EO-06 içinde Summary/Daily/Compare/Table sorgu karakterizasyonu ve export çıkmadan export yük testi; EO-08 içinde production-shape restore/load provası.
- The scale ladder remains inside measured PostgreSQL/Supabase scaling first; a database-platform migration cannot be an outage response.
- Export is outside the first review slice; when introduced it must be asynchronous and isolated from the interactive query pool.
- This cross-cutting decision changes no package status and authorizes no live infrastructure mutation.

## Demo fixture, export reference and Shopify dev-store boundary — 7 October 2026

Binding analyst brief: `docs/A6_EO_DEMO_FIXTURE_EXPORT_REFERENCE.md`  
Executable contract: `contracts/a6-eo-demo-fixture-export-reference-v1.json`

- The legacy dashboard HTML is reference and fixture raw material only; no HTML/JavaScript is copied into the new runtime.
- Its 1,000-row, 50-day synthetic dataset is routed to EO-05/06/07/08 as a clean Dataset V2 fixture, UI acceptance source, Shopify dev-store demo and deterministic capacity-generator seed.
- Supabase kapasite koşuları raw HTML'i çalıştırmaz; yalnız normalize edilmiş deterministic generator seed'ini kullanır.
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

## Accepted foundation: EO-02

- **EO-01-A — Accepted:** Fork veya bulk copy olmadan ayrı temiz repository ve fiziksel sınır kuruldu. Kabul commit'i: `cb02ef7c2e9236ab50da792f21d667fae91cbccd`.
- **EO-01-B — Accepted:** Güncel resmî Shopify stack, temiz dependency manifest/lockfile ve negatif CI kapıları merge edildi. Kabul commit'i: `111e7dec66c84c48be43930f3496ea5b0f918949`.
- **EO-01-C — Accepted:** Polaris 2.0 RC üç-route truthful preview shell ürün sahibi tarafından görsel olarak kabul edildi ve merge edildi. Kabul commit'i: `76ea38a474c701d69871f73ba713376e3a7d623e`.
- **EO-02-A — Accepted:** Ayrı Frankfurt Supabase projesinde private schema, owner/migrator/runtime rol sınırı ve temiz migration zinciri canlı olarak doğrulandı; PR #4 merge commit'i: `2ac00f969eb35ac632ead57017753ed495e7b66f`.
- **EO-02-B — Accepted:** Workspace, installation ve generation authority migration zinciri canlı Supabase'de PASS oldu; self-cleaning bootstrap/idempotency/stale/domain-change probe sonrası business row sıfır, Security ve Performance Advisor temizdir. PR #6 merge commit'i: `edc9e21588f5a32bea139b754ea0108c9809cf27`.
- **EO-02-C — Accepted:** Shopify App Pricing + Partner API authority modeli, forced-RLS billing projection ve Supabase probe hazırdır. 8 Ekim 2026'da App Store registration, Production Vercel Partner secret/deployment ve `activeSubscription` null/trial/active provider kabulü PASS oldu. Trial, public `AdsTable Monthly` planında effective `USD 0.0` ve `price.active=false`; active durum, hedef mağazaya açılan private `shopify-test` planında `trialEndsAt=null`, geçerli billing cycle, effective `USD 0.0` ve `price.active=true` döndürdü. Fiyat-sürümü metadata düzeltmesi PR #18 ile merge edilip Production'a alındı. Browser/response/application/platform log sızıntı kontrolleri PASS oldu. PR #23 ile Supabase Root CA doğrulamalı transaction-pooler TLS Production'a alındı; Shopify Admin desktop ilk yükleme ve tam sayfa reload PASS oldu. Canlı database bir workspace, generation-1 active installation, ciphertext-only runtime session, active subscription projection ve active entitlement taşır. 9 Ekim 2026'da entitlement'ın seçilebilir mağaza metadata'sı taşımasının yanlış olduğu saptandı; aktif model kurulu Shopify mağazasına kilitlendi. Ayrı açık ürün sahibi onayıyla düzeltici migration canlı Supabase'e uygulandı; eski üç metadata kolonu kaldırıldı, mevcut entitlement satırı korundu, function-only runtime sınırı ve sıfır Security Advisor bulgusu doğrulandı. Gerçek mobil Shopify uygulamasında Funnel, Ad Analysis, Settings ve tam uygulama kapatıp yeniden açma kabulü PASS oldu; canlı projection sayıları tutarlı ve kontrol edilen Vercel runtime penceresi hatasız kaldı. Teknik canlı kabul kapılarının tamamı PASS oldu. Stale snapshot rejection önceki canlı database acceptance kanıtından bağlandı; ürün sahibi 8 Ekim 2026'da açık kapanış kabulünü verdi. Teknik açık kalem sıfırdır.
- **EO-02-D — Accepted:** Privacy/uninstall/deletion/clean-reinstall ingress'i, private forced-RLS queue/manifest modeli, exact Shopify app configuration ve deployed invalid-HMAC 401 kabulü PASS oldu. 9 Ekim 2026'da Supabase Cron worker ve PostgreSQL conditional-expression düzeltmesi canlıya uygulandı. 08:00 UTC doğal Cron koşusu sentetik `customer_data_request` run'ını tek denemede `completed/no_customer_data` manifestiyle tamamladı; replay sıfır iş seçti, application runtime worker ve fiziksel executor çalıştıramıyor, Security Advisor sıfır ve sentetik temizliği sıfır kalan kayıtla PASS oldu. Kalıcı kanıt `docs/evidence/EO_02D_DURABLE_WORKER_LIVE_2026-10-09.json` dosyasındadır. Ürün sahibi 9 Ekim 2026'da açık kapanış kabulünü verdi; teknik açık kalem sıfırdır.

EO-02-A business tablo veya veri kurmaz, runtime credential'ı etkinleştirmez, canlı token/veri taşımaz, Vercel environment değiştirmez ve legacy Supabase projesine dokunmaz.


## EO-04-A common adapter start brief — 10 October 2026

Binding analyst brief: `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md`  
Executable start contract: `contracts/eo-04a-common-adapter-start-brief-v1.json`  
CI enforcement: `tests/eo-04a-common-adapter-start-brief.test.js`

- EO-04 is active only at the EO-04-A start-brief gate; common-adapter implementation has not started.
- Installed Shopify Store remains immutable commerce authority. Provider account, domain, pixel, URL, UTM, click ID or campaign name cannot create or switch workspace/store scope.
- Only an explicit provider zero becomes zero. Empty, absent, unsupported, permission-denied, ambiguous, provisional, partial and failed remain distinct states.
- Canonical Funnel demand is fixed to ten raw facts: impression, ad click, session, spend, ATC count/value, checkout count/value and purchase count/value; provider-native field names cannot change this contract.
- Meta and Google Ads allow one to three provider-verified advertiser accounts. Google Manager/MCC accounts are access paths only and are never selectable Reporting Accounts or Funnel entities. Klaviyo binds exactly one verified account and is never labelled an Ad Account.
- The binding analyst brief records the exact 17-step OAuth-to-first-data order; initial bootstrap remains yesterday then today, while hourly refresh and reconciliation remain EO-05 responsibilities.
- Pagination is opaque, bounded, idempotent and complete-before-publish; a missing page cannot become a complete snapshot.
- Retry is bounded and limited to documented transient failures; rate-limit recovery metadata wins over guessed delays.
- Raw evidence is private, bounded, sanitized and content-hashed; tokens, credentials and profile-level personal data are forbidden.
- EO-04-A creates no provider secret and makes no live provider/API, database, Vercel or deployment mutation.
- Meta-specific implementation remains blocked because its current official Graph rate-limit/error pages returned HTTP 429 during the control check; EO-04-B must re-open them successfully before code.


## Closed package: EO-03 / Next ready package: EO-04

- **EO-03-A — Accepted:** Workspace/install-generation-bound OAuth transaction state machine, exact callback allowlist, single-use state claim and live private database boundary passed repository, database and product-owner gates.
- **EO-03-B — Accepted:** Versioned AES-256-GCM token envelope, ciphertext-only vault, live private database boundary, production startup guard and secret-free synthetic runtime acceptance passed.
- **EO-03-C — Accepted:** Fresh provider-verified connected accounts and one canonical Meta/Google Reporting Account are bound beneath the immutable installed-Shopify-store authority. Klaviyo remains one Connected Account with no Reporting Account control. No merchant-selectable store scope exists.
- With explicit approval, the EO-03-C base and corrective Supabase migrations were applied on 9 October 2026. Rollback-scoped synthetic runtime acceptance passed, cleanup is zero, Security Advisor findings are zero and EO-03-C introduced no unindexed-foreign-key finding. No provider API call, provider OAuth, Vercel mutation or production deploy occurred. The product owner explicitly closed EO-03-C on 9 October 2026; exact evidence is `docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json`.
- **EO-03-D — Accepted:** Reauthorization, atomic credential renewal, two-phase disconnect and same-canonical-connection reconnect passed the complete rollback-scoped live lifecycle scenario. All synthetic rows rolled back to zero, Security Advisor remained at zero, and no provider API/OAuth/Vercel/deploy mutation occurred. Durable evidence: `evidence/eo-03d-live-database-evidence-2026-10-09.json`.
- **EO-03 — Accepted:** All four children are closed with explicit product-owner acceptance. **EO-04 — Active:** EO-04-A is Accepted. EO-04-B is at the current official-document and analyst-brief gate; no provider-specific or live API implementation has started.

## EO-03-C official provider baseline — 9 Ekim 2026

Shopify authentication/access-token authority, Meta official Marketing API collection, Google Ads access model and `ListAccessibleCustomers`, Klaviyo OAuth/Get Account, Supabase changelog/functions/RLS belgeleri kontrol edildi. Provider-specific HTTP discovery remains EO-04; EO-03-C accepts only short-lived verified evidence and fails closed on stale, cross-provider or merchant-entered account identity.

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
- Her Shopify app installation yalnız kendi doğrulanmış mağazası için workspace ve subscription üretir; ikinci mağaza ayrı installation ve subscription gerektirir.


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

## 9 Ekim 2026 — Installed shop authority corrective gate

- Merchant-selectable store scope kaldırıldı; Shopify embedded workspace'in commerce otoritesi verified ID token + Admin GraphQL `shop` ile belirlenen kurulu Shopify mağazasıdır.
- Provider Reporting Account seçimi downstream'dir ve kurulu mağazayı değiştiremez.
- Provider entity'leri kurulu mağazaya deterministik bağlanamıyorsa hesap bağlı kalabilir fakat reporting authority olamaz; Dataset V2 ve SnapshotJob fail-closed durur.
- İkinci Shopify mağazası ayrı app installation, workspace ve subscription gerektirir. WooCommerce, BigCommerce ve Magento Shopify embedded workspace'e commerce source olarak giremez.
- EO-02-B/EO-02-C repository düzeltmesi, CI ve ayrı açık onaylı canlı Supabase migration 9 Ekim 2026'da tamamlandı. Canlı kanıt `docs/evidence/EO_02BC_INSTALLED_SHOP_AUTHORITY_LIVE_2026-10-09.json` dosyasındadır; EO-02-D kapanış hattı bu düzeltmeden sonra devam eder.
- Authority: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.


## 9 Ekim 2026 — EO-02-D-C1 durable deletion worker corrective gate

- Production incelemesi, doğrulanmış privacy claim ve deletion run üretildiğini fakat kuyruğu tüketen kalıcı worker bulunmadığını kanıtladı.
- Seçilen mimari Supabase Cron / pg_cron'dur; Vercel Cron, HTTP hop veya yeni environment secret eklenmez.
- Her 5 dakikada 25 run; advisory lock, row lock, idempotent generation boundary ve bounded retry uygulanır.
- Application runtime fiziksel silme executor'ını doğrudan çağıramaz.
- 20 denemeyi tüketen run sessiz başarı sayılmaz; görünür failed durumda operasyon müdahalesi bekler.
- Authority: `docs/EO_02D_DURABLE_DELETION_WORKER.md` ve `contracts/eo-02d-durable-deletion-worker-v1.json`.
- Repository değişikliği canlı mutation yetkisi değildir; canlı Supabase migration ve sentetik kabul ayrı açık kullanıcı onayı gerektirir.


## 9 Ekim 2026 — EO-03-D provider connection lifecycle acceptance

- EO-03-D **Accepted** durumundadır; rollback-scoped canlı senaryonun tüm aşamaları PASS, sentetik kalıntı sıfır ve EO-03 ana paket kapanışı ürün sahibi onayıyla tamamlanmıştır.
- Yalnız `connected` lifecycle durumu reporting authority'dir. `reauthorization_required`, `disconnect_pending` ve `disconnected` yeni veri işini fail-closed durdurur.
- Renewal yeni şifreli credential zarfı hazır olduktan sonra expected-version + unique-event-id ile atomik swap yapar; eski zarf swap sonrasında aynı transaction içinde silinir.
- Disconnect iki aşamalıdır. Geçici veya belirsiz provider revoke sonucu başarı sayılmaz; bağlantı `disconnect_pending` kalır. Final disconnect geçmiş analitiği silmez.
- Reconnect aynı canonical connection kimliğini kullanır; yeni credential ve güncel provider hesap kanıtı zorunludur.
- Meta için uydurma refresh-grant davranışı yoktur. Google Ads ve Klaviyo `invalid_grant` sonucu reauthorization gerektirir; Klaviyo token/revoke host'u `a.klaviyo.com` olarak sabittir.
- Authority: `docs/EO_03D_PROVIDER_CONNECTION_LIFECYCLE.md` ve `contracts/eo-03d-provider-connection-lifecycle-v1.json`.
- Base migration ile dört ileri-yönlü düzeltme canlı Supabase'de uygulanmış ve doğrulanmıştır. Bu kabul provider API çağrısı, canlı provider OAuth, provider-console mutation, Vercel mutation veya production deploy içermez.
- EO-04 **Active** durumundadır. `A6-EO-04-A` başlangıç brief'i ürün sahibi tarafından kabul edilmiş ve provider-neutral implementation hazırlanmıştır; CI ve final ürün sahibi kabulü tamamlanmadan EO-04-B başlatılmaz.


## 10 October 2026 — EO-04-A common adapter implementation gate

- Product owner accepted the EO-04-A analyst brief before implementation.
- Common runtime and strict types are now `app/lib/providers/common-adapter.server.js` and `app/lib/providers/common-adapter.server.d.ts`.
- Meta, Google Ads and Klaviyo answer the same ten canonical raw-metric questions; their native request shapes remain provider-specific children.
- Support capability and observation result are separate. Only explicit provider numeric zero becomes zero.
- Pagination is complete-before-publish. Cursor loops, conflicting replay, missing pages, schema failures and exhausted budgets publish no rows.
- Retry is bounded and restricted to normalized documented transient classes. Auth, permission, validation and deterministic scope failures are not retried.
- Provider evidence is bounded, sanitized and content-hashed; secret and personal-data patterns are redacted.
- Deterministic synthetic behavior is covered by `tests/eo-04a-common-adapter.test.js`.
- No live provider call, secret read/write, database mutation, Vercel mutation or deployment occurs in EO-04-A.
- GitHub Actions run `38049487145` passed 163/163 tests, TypeScript verification and preview build. The product owner explicitly accepted EO-04-A and authorized PR #65 merge on 10 October 2026. EO-04-B may begin only with its current official-document and analyst-brief gate; provider implementation and live mutation remain unauthorized.


## 10 October 2026 — EO-04-A product-owner closure

- EO-04-A common adapter contract is **Accepted**.
- Closure covers the provider-neutral runtime, strict types, deterministic fake-provider acceptance and secret-free evidence policy.
- Product-owner acceptance and PR #65 merge authorization were explicit.
- EO-04-B is now the active start gate: current official Meta documentation and an analyst brief must be accepted before provider-specific code.
- No provider secret, live API call, database mutation, Vercel mutation or deployment is authorized by this closure.
