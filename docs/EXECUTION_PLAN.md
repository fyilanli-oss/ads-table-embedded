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

## Mühendislik bütünlüğü ve review güvence sırası — 18 Ekim 2026

Bağlayıcı belge: `docs/A6_QUALITY_AND_ASSURANCE_GATES.md`

Executable contract: `contracts/a6-quality-and-assurance-gates-v1.json`

CI enforcement: `tests/a6-quality-and-assurance-gates.test.js`

- EO-04 kapanışından hemen sonra ve EO-05 başlamadan önce `A6-TECH-01` bütün
  kodu, Shopify yapısını, provider runtime'larını, Supabase'i, Vercel'i,
  GitHub/CI/lineage'ı ve uçtan uca veri güvenliğini denetler.
- Testlerin geçmesi tek başına yeterli değildir; yanlış davranışın yanlış testle
  korunması, paketler arası eski varsayımlar ve canlı yapı-repository drift'i de
  aranır. P0/P1 ile güvenlik, veri doğruluğu veya review'u etkileyen P2 açıkken
  EO-05 başlamaz.
- `A6-DOCS-01`, A6-TECH-01 düzeltmelerinden sonra ve EO-05'ten önce aktif insan
  okuyucu belgelerini Türkçe standardına getirir; machine contract ve immutable
  evidence toplu çevrilmez.
- EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 baseline'ına karşı delta
  bütünlük denetimi zorunludur.
- `A6-ASSURE-01` EO-08 sonrasında çalışan pre-review doğrulamasıdır; ilk kod
  sağlamlık denetimi değildir. Hiçbir nihai review başvurusu A6-ASSURE-01 PASS
  ve ürün sahibi GO kararı olmadan yapılamaz.
- `A6-TECH-01` ilk denetimi 18 Ekim 2026'da
  `c3faddff97628f372f5cc843f3326fb38de95dfc` başlangıç baseline'ında
  tamamlanmış ve bulgular
  `docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md` içinde kaydedilmiştir.
  P0 yoktur; üç P1 ve EO-05'i engelleyen beş P2 açıktır. Aktif kapı
  `A6-TECH-01_critical_remediation_and_retest`tir; bu kayıt PASS değildir.

F01 düzeltmesinin repository hazırlığı:
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` ve
`contracts/a6-tech-01-f01-migration-lineage-v1.json`. Bu kayıt migration history
repair, canlı uygulama, F01 kapanışı veya EO-05 başlangıcını yetkilendirmez.
Denetim düzeltmeleri F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10
sırasıyla ilerler; F01 kapanmadan F02 başlamaz.

F01 canlı retirement 18 Ekim 2026'da ayrı ürün sahibi onayıyla uygulandı;
postcheck kanıtı `docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
İlk 38 migration değişmedi. Supabase'in verdiği yeni version `20261018152910`
ile repository eşlenmiştir. Ürün sahibi F01 kapanışını ve PR #102 merge'ünü
18 Ekim 2026'da onayladı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
Sıradaki bulgu F02'dir; uygulaması başlamadı. Bu kayıt yeni canlı mutation
veya EO-05 başlangıç yetkisi değildir.

F02'deki tek sahipsiz Google credential, ayrı açık onayla 18 Ekim 2026'da
temizlendi. Üç bağlı credential, üç connection ve sekiz tarihsel kayıt korundu.
Ürün sahibi F02 kapanışını ve PR #104 merge'ünü kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F02_CLOSURE_2026-10-18.json`.
Sıradaki F03 başlamadı; yeni canlı işlem veya EO-05 başlangıcı yetkisi yoktur.

F03 envanter düzeltmesi 18 Ekim 2026'da ürün sahibi kabulünü aldı: 22 Vercel
adı, 1 GitHub workflow secret adı, toplam 23 envanter girdisi; örnek dosya,
contract ve testler eşlendi. Secret değeri okuma veya canlı ayar/deploy işlemi
yok. Kapanış kanıtı `docs/evidence/A6_TECH_01_F03_CLOSURE_2026-10-18.json`.
F01–F03 kapalıdır. Sıradaki F04 başlamadı; EO-05 kapısı hâlâ kapalıdır.

F04 Polaris preload/script eşliği düzeltildi; ayrı onaylı exact-source deploy
sonrası ürün sahibi gerçek Shopify Admin masaüstü ve mobil görünümünü kabul
etti, PR #106 merge'ünü onayladı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F04_CLOSURE_2026-10-18.json`.
Güncel durum F01–F04 kapalı, sıradaki F05 başlamadı ve yetkili değil.
F07 release provenance ve genel EO-05 kapısı açık bulgulara bağlı kalır.

F05 action SHA sabitlemesi ürün sahibi onayıyla repository'de hazırlandı.
Kanıt `docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json`.
Kontrollü güncelleme: resmî release/commit doğrulaması → PR → CI → açık merge
onayı; otomatik merge yoktur. CI ve kabul beklenir, F05 açık ve F06 yetkisizdir.
Canlı workflow dispatch, secret veya deployment değişikliği yapılmadı.

F05 repository düzeltmesinin 425 test/typecheck/build CI sonucu geçti; ürün
sahibi PR #107 merge'ünü ve kapanışı kabul etti. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F05_CLOSURE_2026-10-18.json`.
Güncel F01–F05 kapalıdır; sıradaki F06 başlamadı ve uygulama yetkisi yoktur.
Genel A6-TECH-01 PASS değildir; EO-05 engeli korunur.

F06 server hata logger'ı repository'de hazırlandı. Kanıt:
`docs/evidence/A6_TECH_01_F06_SAFE_ERROR_LOG_2026-10-18.json`.
Ham hata nesnesi loglanmaz; sabit kod/aşama ve izinli route/metot kaydedilir.
CI/merge ve ayrı açık onaylı canlı deploy/doğrulama beklenir; F06 açık kalır.
Bu hazırlık canlı düzeltme kanıtı veya F07 başlangıç yetkisi değildir.

F06 düzeltmesi PR #108 ile merge edilip ayrı açık onayla mevcut Production
adresine alındı. Exact kaynak/alias READY doğrulandı; ürün sahibi gerçek Shopify
Admin masaüstü ve mobil normal çalışmayı kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json`.
Kapanış kaydının merge onayı beklenir; F07 başlamadı, EO-05 engeli korunur.

F07 mevcut Production'ın F06'da onaylı exact `main` commit'inden deploy edildiğini
yeniden doğruladı. Güncel main'e göre yalnız altı F06 kapanış dosyası farklı;
diğer 371 kaynak girdisi eşleşir. Kanıt:
`docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json`.
Yeni deploy/secret/config/database işlemi yok. CI ve ürün sahibi kabulü beklenir;
F07 henüz kapanmadı, F08 başlamadı ve EO-05 engeli korunur.

F07 provenance doğrulaması 434 test/typecheck/build CI kapısından geçti;
ürün sahibi kapanışı ve PR #110 merge'ünü kabul etti. Yeni deploy gerekmedi
ve yapılmadı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F07_CLOSURE_2026-10-18.json`.
Güncel F01–F07 kapalıdır; F08 başlamadı/yetkili değil, EO-05 engeli korunur.

F08 iki private privacy tablosunda `workspace_id` FK index hazırlığıdır.
Kanıt `docs/evidence/A6_TECH_01_F08_PRIVACY_INDEXES_2026-10-18.json`.
Yeni migration pending; canlı DDL/DML yapılmadı. Mevcut izole DB workflow'u ile
replay ve sentetik öncesi/sonrası plan kontrolü beklenir. Canlı uygulama ayrı
açık onay, fresh preflight ve postcheck/Advisor kapısından geçer. F08 açık,
F09 başlamadı; veri/silme kuralı/runtime/deploy değişikliği yetkilendirilmedi.

F08 iki index'i ayrı açık onayla canlıya ekledi; Supabase version
`20261018181906` repository'ye SQL içeriği değişmeden eşlendi. 40 applied / 0
pending; önceki migration hash'leri, veri ve güvenlik sınırları korundu.
Security Advisor 0, eksik FK index uyarısı 0. Canlı kanıt:
`docs/evidence/A6_TECH_01_F08_LIVE_ACCEPTANCE_2026-10-18.json`.
Son CI ve açık kapanış/merge kabulü beklenir; F09 başlamadı.

F08 canlı kabul/eşleme sonrası genel CI (437 test/typecheck/build) ve iki izole
40-migration replay geçti. Ürün sahibi kapanışı ve PR #111 merge'ünü kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F08_CLOSURE_2026-10-18.json`.
Güncel F01–F08 kapalı; F09 başlamadı/yetkili değil, genel audit ve EO-05 kapısı
ayrı kapanış/retest kararı olmadan PASS/başlangıç sayılmaz.

F09 primary checkout temizliği doğrulandı; kullanıcı işi veya divergent commit
yoktu. Exact uzak `main`e fast-forward yapıldı, commit/tree ve temiz 0/0 durumu
doğrulandı. Kanıt `docs/evidence/A6_TECH_01_F09_CHECKOUT_SYNC_2026-10-18.json`.
CI/kabul ve PR merge sonrası son primary sync beklenir. F10 başlamadı; canlı
uygulama/database/deploy değişmedi, genel audit/EO-05 kapısı korunur.

F09 kapanış ve PR #112 merge onayı alındı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F09_CLOSURE_2026-10-18.json`.
Önceki hazırlık kayıtları tarihseldir; güncel F01–F09 kapalıdır. Son CI,
merge ve primary checkout'un yeni main ile temiz commit/tree eşliği teslim
kapısıdır; son eşlik PR #112 açıklamasında kalıcılaştırılır. F10 başlamaz,
genel audit PASS veya EO-05 başlangıç yetkisi verilmez.

F10 için ürün sahibi 18 Ekim 2026'da ayrı uyumluluk çalışması bekleyen açık
teknik borç kararını onayladı. Kanıt:
`docs/evidence/A6_TECH_01_F10_DEFERRED_2026-10-18.json`.
F01–F09 kapalı, F10 açık ve tek başına EO-05 engeli değildir. Bu kayıt F10
düzeltmesi/kapanışı, sürüm veya flag değişikliği, genel audit PASS ya da EO-05
başlangıç yetkisi değildir. Genel yeniden test ve kapanış kararı ayrı kalır.

Son yeniden test `cddda0fad4803c9212412211495365c69ed2e884` üzerinde 441 test,
typecheck/build ve production bağımlılık taramasını geçirdi. Tam bağımlılık
taraması geliştirme/build zincirinde 4 yüksek, 3 orta, 1 düşük advisory bildirdi.
Kanıt `docs/evidence/A6_TECH_01_FINAL_RETEST_2026-10-18.json`.
`TECH01-RETEST-SEC01` ayrı, ön P2/güvenlik değerlendirme kaydıdır; F01–F10
tarihsel sırası ve kapanışları değiştirilmez. Etki analizi/düzeltme henüz
yetkili değildir. Genel audit PASS, A6-DOCS-01 ve EO-05 başlangıcı verilmez;
bu kayıt yeni altyapı, yedek, sürüm, provider veya canlı ortam işi açmaz.

Kullanıcı yalnız Vite `7.3.1 → 7.3.5` güvenlik düzeltmesine açık onay verdi.
Registry ve lockfile eşlendi; diğer paket sürümleri aynı kaldı. Vite'nin beş
uyarısı yeni taramada kalktı; kalan 1 yüksek/1 orta/1 düşük advisory açıktır.
Kanıt `docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json`.
Son CI/merge kabulü beklenir. Bu kayıt kalan riskleri, F10'u veya genel audit'i
kapatmaz; canlı deploy, override, ignore veya başka dependency değişimi yetkisi yoktur.

## EO-05 mandatory first gate — historical PMax listing-tree evidence

EO-05 scheduler veya Dataset V2 acceptance başlamadan önce Google Performance
Max için versioned historical listing-tree snapshot persistence kurulacak ve
testlerle kilitlenecektir. Bu, EO-05'in ilk zorunlu kapısıdır:

1. Her snapshot verified Reporting Account timezone'u, Campaign ve Asset Group
   kimliği, complete listing-tree rows, source version/hash, `valid_from`,
   `valid_to`, observed-at ve query provenance taşır.
2. Exact historical Asset Group yalnız snapshot satışın tüm provider business-day
   penceresini kapsıyor ve advertised/clicked ürün için tam olarak bir eligible
   Asset Group kanıtlıyorsa üretilebilir.
3. Eksik/partial pencere, gün içi tree değişikliği, çelişkili version/hash veya
   birden fazla eligible Asset Group satış ve Sales Role'u korur; yalnız Channel
   `Unclassified Channel` kalır. Satılan ürün Channel seçmek için kullanılamaz.
4. Bugünkü/current listing tree geçmiş tarih için snapshot veya exact Channel
   üretemez. Snapshot toplama başlamadan önceki günler, provider'dan o güne ait
   exact tarihsel kanıt alınamadıkça geriye dönük tahminle doldurulamaz.
5. Scheduler capture, immutable/versioned persistence, retention, gap detection,
   reconciliation ve resolver'a date-matched evidence delivery birlikte kabul
   edilmeden bu kapı PASS sayılamaz.


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
- Meta's current official Graph/Login/version/account sources were rechecked on 13 October 2026. Production configuration, deployment and desktop Shopify Admin OAuth acceptance passed under separate explicit product-owner authorization. Mobile clean-session acceptance remains open because the attempted browser identity was not an authorized app-role identity; this is not classified as an AdsTable code failure.


## Closed packages: EO-03 and EO-04 / Next gate: A6-TECH-01

- **EO-03-A — Accepted:** Workspace/install-generation-bound OAuth transaction state machine, exact callback allowlist, single-use state claim and live private database boundary passed repository, database and product-owner gates.
- **EO-03-B — Accepted:** Versioned AES-256-GCM token envelope, ciphertext-only vault, live private database boundary, production startup guard and secret-free synthetic runtime acceptance passed.
- **EO-03-C — Accepted:** Fresh provider-verified connected accounts and one canonical Meta/Google Reporting Account are bound beneath the immutable installed-Shopify-store authority. Klaviyo remains one Connected Account with no Reporting Account control. No merchant-selectable store scope exists.
- With explicit approval, the EO-03-C base and corrective Supabase migrations were applied on 9 October 2026. Rollback-scoped synthetic runtime acceptance passed, cleanup is zero, Security Advisor findings are zero and EO-03-C introduced no unindexed-foreign-key finding. No provider API call, provider OAuth, Vercel mutation or production deploy occurred in EO-03-C. The product owner explicitly closed EO-03-C on 9 October 2026; exact evidence is `docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json`.
- **EO-03-D — Accepted:** Reauthorization, atomic credential renewal, two-phase disconnect and same-canonical-connection reconnect passed the complete rollback-scoped live lifecycle scenario. All synthetic rows rolled back to zero, Security Advisor remained at zero, and no provider API/OAuth/Vercel/deploy mutation occurred. Durable evidence: `evidence/eo-03d-live-database-evidence-2026-10-09.json`.
- **EO-03 — Accepted:** All four children are closed with explicit product-owner acceptance.
- **EO-04 — Accepted (18 Ekim 2026):** Ortak adapter, üç provider runtime sınırı, canonical Channel/Sales Role sözleşmesi ve insan tarafından okunabilir scenario matrix ürün sahibi kapanış kabulünü aldı. Meta canlı shape kanıtı, Google test-account review kanıtı ve Klaviyo `environment_not_ready` kanıtı truthful sınırlarıyla korunur.
- Kapanış; Meta gerçek App Role katalog doğrulamasını, Google Explorer-or-higher production kanıtını veya Klaviyo Shopify entegrasyonu sonrası live reporting kanıtını tamamlanmış saymaz. Historical PMax listing-tree persistence EO-05'in ilk zorunlu kapısıdır.
- Geçici Settings taşımasında Meta evidence butonu kaldırılmıştır. Google butonu production evidence alınana, Klaviyo butonu Shopify integration evidence alınana kadar veya EO-05 scheduler kabulü bu taşımanın yerini alana kadar korunur.
- EO-05 başlamaz. Sıradaki zorunlu çalışma `A6-TECH-01`; onun kritik düzeltmeleri ve `A6-DOCS-01` tamamlanmadan EO-05 kapısı açılamaz.

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


## A6-OPS-SHOPIFY-01 — Isolated Shopify embedded pre-production

**Status:** Planned; trigger not reached; implementation not started
**Type:** Independent prerequisite package; outside the A6-EO dependency chain until its activation deadline

Binding analyst brief: `docs/A6_OPS_SHOPIFY_01_ISOLATED_PREPRODUCTION.md`
Executable contract: `contracts/a6-ops-shopify-01-isolated-preproduction-v1.json`

- The package becomes a hard prerequisite before either a real merchant store is migrated to Shopify for AdsTable use or the first external/non-team user is invited, whichever happens first.
- It requires a dedicated Shopify development app and dev store, a named non-production Shopify configuration, a stable embedded Preview/Staging URL with exact redirects, Preview-specific credentials and persistence isolated from Production.
- A merchant production store cannot substitute for the dev store. Production credential values cannot be copied to Preview or Development, and Preview cannot write Production business data.
- Any real provider-account acceptance remains separately approved, read-only and exact-account-bound. The first explicit or unexplained provider error stops execution; retry or an alternate route requires a new explanation and approval.
- Evidence may later feed A6-EO-08-D, but this package does not declare the product review-ready or advance the active EO parent.
- The product owner accepted planning this package on 17 October 2026 and explicitly deferred implementation. No Shopify, Vercel, database, secret, provider, deployment, migration, invitation, review or merge mutation is authorized by this record.


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
- EO-04 **Accepted** durumundadır. Provider production doğrulamaları kapanışta açıkça devredilmiş, `A6-TECH-01` ise EO-05 öncesindeki aktif zorunlu kapı olarak atanmıştır.


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
- GitHub Actions run `38049487145` passed 163/163 tests, TypeScript verification and preview build. The product owner explicitly accepted EO-04-A and authorized PR #65 merge on 10 October 2026. EO-04-B'nin OAuth official-document ve analyst-brief kapısı 13 Ekim 2026'da geçildi. Production configuration/deployment, tam Windows akışı ve iOS temiz-oturum OAuth başlangıcı kabul edildi. Role sahip olmayan Windows hesabı Android ile aynı beklenen Meta review-öncesi kısıtını üretti; ürün sahibi EO-04-B'ye direct PASS verdi. Meta provider-data sözleşmesi ve runtime uygulaması başlamamıştır.


## 10 October 2026 — EO-04-A product-owner closure

- EO-04-A common adapter contract is **Accepted**.
- Closure covers the provider-neutral runtime, strict types, deterministic fake-provider acceptance and secret-free evidence policy.
- Product-owner acceptance and PR #65 merge authorization were explicit.
- EO-04-B is active. Current official Meta documentation and the OAuth/account-selection analyst brief were accepted on 13 October 2026; repository implementation and CI are the current gate.
- No provider secret, live API call, database mutation, Vercel mutation or deployment is authorized by this closure.


## 13 October 2026 — EO-04-B Meta OAuth/account-selection implementation gate

Binding analyst brief: `docs/EO_04B_META_OAUTH_ACCOUNT_SELECTION.md`
Executable contract: `contracts/eo-04b-meta-oauth-account-selection-v1.json`
CI enforcement: `tests/eo-04b-meta-oauth-account-selection.test.js`

- Meta Graph/Login is pinned to `v26.0`; OAuth requests exactly `ads_read` and returns through the exact embedded callback.
- The working Google behavior is isolated. Meta uses the same accepted product flow: OAuth, automatic advertiser selector, one-to-three selected accounts and exactly one Reporting Account.
- One selected advertiser auto-binds. Two or three require an explicit second Reporting Account choice. Cancel preserves pending state; Resume setup never restarts OAuth.
- Meta token acceptance requires short-to-long-lived exchange, `/debug_token` app/scope/expiry verification and ciphertext-only EO-03-B vault storage.
- `/me/adaccounts` is opaque-cursor paginated with page/account ceilings. Invalid authorization is reauthorization, while an empty list is not fabricated success.
- Disconnect is revoke-first; provider failure preserves local reporting authority.
- OAuth/account selection does not start provider-data collection, scheduling or backfill. Meta provider-data behavior is outside this accepted OAuth slice and has not been authorized or implemented.
- Four Meta environment names are stored only in the name-only inventory; no value is committed or read back.
- Production deployment `dpl_GxV2DQiXYaer24W1247iPAn9N6gR` at commit `f3f0516b5b938b683d10cd14b75947cd805120e0` is READY. Desktop OAuth, account selection, Reporting Account, Cancel/Resume, Disconnect and reconnect are PASS.
- The complete Windows flow passes with the developer-role account. A fresh iPhone Connect transaction correctly opened Meta password authentication. A controlled Windows attempt with a different, non-role Facebook account reproduced Android's exact **App not active** response, proving a Meta pre-review/development-mode user restriction rather than a device or AdsTable code defect. Android fresh-device repetition is optional and no copied OAuth URL/state may be reused.
- Durable evidence: `docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json`. OAuth live acceptance and EO-04-B product-owner acceptance are PASS. Explicit merge authorization was received and PR #68 was squash-merged as `23911ffd565f385c02693ed7a1f3a07f017c30f5`. EO-04-D Klaviyo is next.

### EO-04-D Klaviyo start gate

The accepted start brief is recorded in
`docs/EO_04D_KLAVIYO_OAUTH_ESTIMATED_SPEND_START_BRIEF.md` and
`contracts/eo-04d-klaviyo-oauth-estimated-spend-v1.json`. It preserves the
working OAuth → one verified Connected Account → initial estimated spend →
Update spend / Change value → revoke-first Disconnect behavior on the new EO-03
authority model. Estimated spend uses its own private effective-dated ledger;
provider reporting requests, Channel decisions and cost allocation are outside
this start slice. Product-owner start acceptance was received on 13 October
2026. The repository implementation now contains the OAuth/single-account
foundation plus the private spend-ledger migration, atomic Save and connect,
Update spend, Change value and revoke-first Disconnect code paths. This is
repository evidence plus an explicitly approved live database gate. Migration
`eo04d_klaviyo_spend_ledger` is applied; rollback-scoped synthetic acceptance,
zero residue, zero Security Advisor findings and no new unindexed-FK finding are
recorded in
`docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json`.
Live OAuth, provider-console, Vercel and deployment mutations remain separate
approval gates; Shopify desktop and real-mobile product acceptance are still
open.

### EO-04-D Klaviyo OAuth hardening gate — 17 October 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_OAUTH_HARDENING_BRIEF.md`
Executable contract: `contracts/eo-04d-klaviyo-oauth-hardening-v1.json`
CI enforcement: `tests/eo-04d-klaviyo-oauth-hardening-contract.test.js`

- Product-owner authorization covers repository-only OAuth/token hardening. It
  does not authorize a live provider call, secret, database, environment,
  deployment, UI or provider-console mutation.
- Klaviyo token expiry is retained inside the encrypted token set. Expired,
  near-expiry and legacy tokens without expiry evidence refresh before the
  intended provider request.
- A failed provider request is terminal: it is never followed by token refresh
  or an automatic repeat. Accounts `401`, Accounts `403`, refresh
  `invalid_grant` and authorization-code `invalid_grant` remain distinct.
- Connected Settings inspection remains local and does not call Klaviyo merely
  because the merchant opened Settings.
- The Klaviyo-origin installation transport is a valid future review need, but
  remains deferred until isolated Shopify preproduction and explicit visual
  acceptance. PR #91 is not merge authority for this backend package.


## EO-04-D Klaviyo reporting capability baseline — revalidated 16 October 2026

Official capability record: `docs/decisions/A6_EO_04_D_KLAVIYO_REPORTING_CAPABILITY_BASELINE.md`

- `2026-10-15` revision Campaign Message, `send_channel` ve isteğe bağlı Variation reporting boyutlarını GA olarak belgeler.
- 17 Ekim 2026 ürün sahibi düzeltmesi bağlayıcıdır: Campaign Message ve Flow Message AdsTable Channel'dır; `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Events attribution Campaign Message'ı fakat Campaign Variation'ı içermez. Message biliniyorsa Channel exact kalır; çoklu veya çözülemeyen Variation yalnız Variation çözünürlüğünü etkiler ve `Unclassified Channel` üretmez.
- Flow attribution `Flow Message Variation` veya `Flow Message` ilişkisini açıkça döndürebilir; Variation parent Message'a çözülür ve Channel yine Flow Message kalır.
- Campaign için Values endpoint'i vardır fakat Series endpoint'i yoktur. Günlük grain tek-gün timeframe sorgularıyla korunur; ilk bootstrap yalnız dün ve bugündür. Saatlik refresh/reconciliation kota bütçesi EO-05'e aittir.
- Estimated Email Spend allocation ve Dataset mapping EO-05'e aittir.
- Bu kayıt tek başına API çağrısı, runtime, Dataset, migration, secret, environment veya deployment mutation yetkisi vermez.


## EO-04-E common Channel and product-economics contract gate — 16 October 2026

Binding accepted brief: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`

Executable contract: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`

CI enforcement: `tests/eo-04e-three-provider-channel-product-economics.test.js`

- Meta Channel = Ad; Google Standard Shopping/Search Channel = Ad Group; Google PMax Retail Channel = Asset Group; Klaviyo Campaign Channel = Campaign Message; Klaviyo Flow Channel = Flow Message. Klaviyo `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Sales Role sözlüğü `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve yalnız gerçek ambiguity için `Unclassified` olarak kabul edilmiştir.
- `Zero Value` bir role değil modifier'dır. `Unclassified Channel`, sale kanıtı bulunduğu halde exact Channel çözülemediğini ifade eder.
- PMax broad/overlapping listing üyeliği aşağıya paylaştırılmaz. Search provider-attributed product sale'i bastırılmaz; `Assisted` olur.
- Meta Ad spend ürünlere dağıtılmaz. Google provider product cost gerçek/blended maliyet sayılmaz. Klaviyo Estimated Spend dağıtımı EO-05'e bırakılır.
- `Channel Ad Cost`, `Provider Product Ad Cost` ve EO-05'e ait `Allocated Ad Cost` ayrı kalır. Explicit zero dışındaki eksik/support state'leri sıfır olmaz; product cost satırları Channel toplamını yeniden üretmez.
- Exact provider ürün Ad Cost'u `Cross-sell`, `Assisted`, `Zero Value` veya `Unclassified Channel` nedeniyle silinmez ve ilgili ürün satırında korunur. Exact product cost yoksa Channel toplamı ürünlere tahminî dağıtılmaz; Klaviyo `Triggered` allocation'ı EO-05'e aittir.
- Desteklenen product identity yolları resmî Shopify-managed Facebook & Instagram, Google & YouTube ve Klaviyo entegrasyonlarıdır. Meta ve Google product/variant adayları Shopify Admin API ile doğrulanmadan SKU, ürün adı veya varyant adı yayımlanmaz; manual/third-party feed/catalog bu sürümde kapsam dışıdır.
- Bu contract gate ürün sahibi tarafından 16 Ekim 2026'da bütün olarak kabul edilmiştir. Kabul tek başına provider reporting runtime, canlı provider çağrısı, Dataset V2, migration veya environment/deployment mutation başlatmaz; bunlar ayrı onay kapısındadır.

## EO-04-D Klaviyo reporting runtime foundation — 17 October 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_REPORTING_RUNTIME_BRIEF.md`

Executable contract: `contracts/eo-04d-klaviyo-reporting-runtime-v1.json`

CI enforcement: `tests/eo-04d-klaviyo-reporting-runtime-contract.test.js` and `tests/eo-04d-klaviyo-reporting-runtime.test.js`

- Product owner authorized the repository-only runtime foundation after Campaign and Flow hierarchy examples were accepted.
- Campaign/Flow Message is Channel; Message name is Channel name. `send_channel` is mandatory Medium and Variation never replaces Channel.
- Exact Message with unresolved or multiple Variations remains exact Channel. `Unclassified Channel` is restricted to missing, unresolved or conflicting Message evidence.
- Shopify `Placed Order` is the Reporting API conversion metric; `Ordered Product` is product-sale event evidence. They are never both counted as the same sale.
- Product identifiers remain provider-native observations; Product ID standardization, persistence, scheduler, reconciliation and estimated-spend allocation remain later gates.
- No live Klaviyo call, provider mutation, database/migration, secret/environment, deploy or UI work is authorized by this package.

## EO-04-D Klaviyo reporting authority — 17 October 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_REPORTING_AUTHORITY_BRIEF.md`

Executable contract: `contracts/eo-04d-klaviyo-reporting-authority-v1.json`

CI enforcement: `tests/eo-04d-klaviyo-reporting-authority-contract.test.js` and `tests/eo-04d-klaviyo-reporting-authority.test.js`

- Product owner authorized the repository-only authority/coordinator implementation.
- Active Shopify installation, exactly one canonical Klaviyo Connected Account,
  encrypted credential authority, required read scopes and connected-account
  timezone are mandatory before any reporting family can start.
- Metrics, Campaign Values, Flow Values and Ordered Product Events execute in
  that order. The first provider error stops all remaining families; successful
  earlier rows are not publishable partial output.
- Metrics and Events exhaust official `links.next` cursors. Values accepts only
  an explicit same-origin/same-endpoint continuation; the runtime never invents
  a cursor omitted by the 2026-10-15 response schema.
- Successful empty Campaign, Flow or Event results remain
  `not_observed_in_this_execution`, never numeric zero.
- Ordered Product normalization preserves provider-native product fields and
  Campaign/Flow attribution IDs without requesting profile data. Product ID
  standardization and Dataset V2 publication remain later gates.
- No live Klaviyo call, provider mutation, database/migration, Dataset V2,
  secret/environment, deploy or UI work is authorized by this package.

## EO-04-D temporary Klaviyo live-evidence trigger — 18 Ekim 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_LIVE_EVIDENCE_TRIGGER_BRIEF.md`

Executable contract: `contracts/eo-04d-klaviyo-live-evidence-trigger-v1.json`

CI enforcement: `tests/eo-04d-klaviyo-live-evidence-trigger.test.js`

- Ürün sahibi geçici `Run Klaviyo evidence` taşımasını ve 18 Ekim 2026'da
  Production deploy adımını onayladı. Canlı provider çağrısı ve Sample Data
  üretimi kapalıdır.
- Tarih merchant'tan alınmaz; bağlı Klaviyo hesabının timezone'una göre güncel
  business date server tarafında hesaplanır.
- Kalıcı reporting runtime metrics, Campaign Values, Flow Values, Ordered
  Product Events ve resolution ailelerini tek denemede çalıştırır. İlk hata
  kalan aileleri durdurur; retry, fallback ve partial publication yoktur.
- UI ve safe log yalnız satır/durum/sınıflandırma sayılarını taşır. Raw satır,
  isim, ID, profil/PII, ticari değer, request ID, cursor/hash, token veya
  credential taşımaz.
- Klaviyo custom ecommerce sample data, kanonik `integration.name = Shopify`
  metric kanıtı değildir ve Shopify-native ürün satışı kabulünün yerine geçmez.
- Exact commit `b675885469effe9f3d9cb58135fa27d0219dcbb7`, Production
  deployment `dpl_FBfQ8t9mV4vw4PZkKmtgbjDbDqdy` olarak `READY` oldu ve gerçek
  Shopify Admin Settings görünümü ürün sahibi tarafından kabul edildi. Ayrı
  onaylı tek Klaviyo çağrısı ilk `metrics` ailesinde
  `KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID` ile retry yapmadan durdu;
  sonraki sorgu aileleri başlamadı ve hiçbir database/Dataset write oluşmadı.
  Ürün sahibinin Klaviyo Metrics incelemesinde Shopify integration bulunmadı;
  yalnız Klaviyo ve API integration adları görüldü. Sonuç kod/provider hatası
  değil `environment_not_ready — shopify_integration_absent` olarak kaydedildi.
  Geçici buton gerçek Shopify entegrasyonu sonrası doğrulama için korunur; ek
  canlı çağrı kapalıdır. Kalıcı kanıt:
  `docs/evidence/EO_04D_KLAVIYO_ENVIRONMENT_NOT_READY_2026-10-18.json`.

## EO-04-D Klaviyo sales-attribution resolution — 17 October 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_ATTRIBUTION_RESOLUTION_BRIEF.md`

Executable contract: `contracts/eo-04d-klaviyo-attribution-resolution-v1.json`

CI enforcement: `tests/eo-04d-klaviyo-attribution-resolution-contract.test.js`
and `tests/eo-04d-klaviyo-attribution-resolution.test.js`

- Product owner accepted the repository-only resolution contract. One Ordered
  Product event remains one sale fact; Placed Order reporting conversions never
  create a second product sale.
- Provider Message attribution is the only Channel authority. A known Message
  remains exact when catalog name, Medium or Variation is unresolved.
- Campaign Message sales are Assisted until exact content-product evidence can
  prove Advertised or Cross-sell. Flow Message sales are Triggered.
- Missing or conflicting Message evidence preserves the sale once under
  Unclassified Channel with Sales Role Unclassified; timing or report totals
  cannot resolve ambiguity.
- Resolution runs after all provider families and remains atomic. No live
  Klaviyo call, database/migration, Dataset V2, secret/environment, deploy or UI
  work is authorized by this package.

## EO-04-D Klaviyo reauthorization truth correction — 17 October 2026

Binding analyst brief: `docs/EO_04D_KLAVIYO_REAUTHORIZATION_TRUTH_BRIEF.md`

Executable contract: `contracts/eo-04d-klaviyo-reauthorization-truth-v1.json`

- A canonical `reauthorization_required` lifecycle state must appear in
  Settings as `Reauthorization required`, never `Not connected`.
- Settings inspection remains local-only. It does not refresh credentials,
  call Klaviyo or retry the failed provider request.
- Only `connected` remains reporting authority and historical spend periods
  remain intact.
- OAuth reauthorization can resume fresh account verification while the prior
  account and spend history remain preserved; reporting does not reopen until
  setup completion succeeds.
- EO-05 must identify the missing business-date interval created while
  authorization was unavailable, run bounded backfill/reconciliation and keep
  missing, partial, stale, recovered, provisional and final states distinct.
  Missing dates can never be silently converted to zero.
- Repository implementation and the separately approved additive live database
  migration are complete. Durable acceptance evidence is
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_LIVE_DATABASE_ACCEPTANCE_2026-10-17.json`;
  Supabase Security Advisor remains at zero findings. Exact commit
  `9bc3108d366a58ce9ff92a293681245a0c380462` was separately authorized and
  deployed to Production as `dpl_8QgriVfjig4RjxC7hwpwtBJ77n8F`; Vercel reached
  `READY`, assigned `embedded.adstable.app` without alias error and returned no
  deployment-scoped error/fatal log. The product owner accepted real Shopify
  Admin Settings on desktop and mobile. Provider calls and merge remain
  separately gated. Visual evidence is
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_VISUAL_ACCEPTANCE_2026-10-17.json`.

## EO-04 Meta retained live-shape evidence — 16 October 2026

- Safe production evidence completed against commit `8a7b0ca9645f46080f8fe0e69f18efe5e5638613`; no runtime error, retry, next-provider start or database write was observed.
- One Ad row proves provider presence only, not numeric Dataset V2 publication. `impressions` and `spend` are accepted direct provider evidence.
- `clicks`, `inline_link_clicks` and array-shaped `outbound_clicks` remain separate Ad Click candidates. `landing_page_view` is not Session. Purchase, checkout and add-to-cart were not evidenced.
- The successful `product_id` request returned an empty page. Its canonical support state is `not_observed_in_this_execution`; empty is neither a product zero nor a global unsupported verdict.
- User-supplied Amazon-destination context is recorded separately from provider evidence. A later product gate requires a Meta catalog-linked product ad and separate authorization; repeating the same flow is not required.
- Durable sanitized evidence: `docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.

## EO-04-B Meta App Role readiness gate — 17 October 2026

- Binding analyst brief: `docs/EO_04B_META_APP_ROLE_READINESS_BRIEF.md`; executable contract: `contracts/eo-04b-meta-app-role-readiness-v1.json`.
- Stage 1 is restricted real-account acceptance by an invited App Tester who separately has legitimate access to the target ad account. It does not broaden `ads_read`, permit public customers or replace later Business Verification/Advanced Access/App Review gates.
- Server Graph requests require `appsecret_proof`. Expired or rejected authorization moves the canonical connection to `reauthorization_required` without provider retry.
- Real-account acceptance completes bounded opaque pagination for both Ad/Channel and `product_id` families before returning either result. Cursor loops, page/row ceilings and first provider errors fail closed.
- The temporary Meta evidence button is removed from Settings. Reporting Account and Disconnect remain; the authenticated non-visual acceptance route stays available for a separately authorized call.
- Shopify migration, official Facebook & Instagram catalog synchronization, product/variant identity continuity, App Tester/ad-account access and a real delivered catalog-ad date are provider-day prerequisites. Their absence is not silently treated as empty or unsupported evidence.
- The product owner authorized a preview-only deployment for desktop/mobile Settings visual acceptance on 17 October 2026. Production deployment, Meta role/account, live provider call, secret/environment and database-schema mutation remain unauthorized.

## EO-04-C Google reporting runtime start gate — 16 October 2026

Binding accepted brief: `docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md`

Executable contract: `contracts/eo-04c-google-reporting-runtime-v1.json`

CI enforcement: `tests/eo-04c-google-reporting-runtime-contract.test.js`

- Standard Shopping and Search preserve Ad Group Channel; Performance Max Retail preserves Asset Group Channel.
- PMax product sale and Sales Role survive broad listing trees. Exact Asset Group is resolved from the advertised product only when exactly one eligible listing tree matches.
- One eligible `All products` Asset Group is exact. Multiple overlapping `All products`, category or other broad trees remain `Unclassified Channel`; the sale is neither dropped nor distributed.
- A current listing tree never resolves an earlier sale by itself. Exact historical Channel requires versioned listing-tree evidence valid for the complete sale business-date window; tree changes or incomplete temporal evidence retain the sale under `Unclassified Channel`.
- `cart_data_sales_view` advertised-product, sold-product, units, revenue and lead/cross-sell evidence remains separate from aggregate `asset_group_product_group_view` evidence.
- Provider Product Ad Cost remains on the advertised product and is never moved to a Cross-sell sold product. Allocation remains EO-05 work.
- Missing Cart Data configuration, empty success, absent fields, unsupported fields and explicit numeric zero remain separate states.
- The product owner accepted the analyst brief and separately authorized the bounded repository runtime implementation on 16 October 2026. The runtime now contains nine read-only GAQL families, raw page/evidence preservation, Sales Role classification and temporally safe PMax listing-tree resolution under synthetic repository tests.
- Google test accounts are not used as reporting evidence because they do not serve ads or generate the required performance and Cart Data sales facts. Repository fixtures prove only AdsTable logic and never provider behavior.
- The runtime implementation was accepted and squash-merged as `752cc1988323c238297d00516e7b7009432032c2` on 16 October 2026.
- The product owner accepted and authorized the bounded repository implementation of the Google live-evidence trigger on 16 October 2026. Its analyst brief is `docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md` and executable contract is `contracts/eo-04c-google-live-evidence-trigger-v1.json`.
- The trigger runs account context, Cart Data sales, product performance, current PMax listing tree and PMax Asset Group performance sequentially for the last 30 completed Reporting Account business dates. First error stops all remaining families; there is no retry or fallback.
- The exact trigger commit was deployed to Production and visually accepted in real Shopify Admin at 1280 px desktop and 320 px mobile on 16 October 2026. The first separately authorized live request stopped without retry and exposed an observability defect: only `GOOGLE_LIVE_EVIDENCE_FAILED` reached the UI and no bounded failure evidence reached the runtime log.
- The product owner authorized a narrow correction on 16 October 2026: failed executions must log only safe stage, query-family, source/provider code, provider HTTP status and provider-response-observed state. Raw messages, identifiers, request IDs, rows, tokens and credentials remain prohibited. A second live request and merge remain separately gated.
- The product owner authorized a single request-scoped access-token refresh before Google evidence queries on 16 October 2026. Commit `960ad41a7db9446e4be147f18d33d946c8324ae5` was deployed as `dpl_EsUUG8fEiQnPrxSWj7EBT8joPoTX`; one separately authorized live execution completed all five query families without retry or runtime error.
- The completed execution returned no observed Campaign, Cart Data sales, Shopping product, current PMax listing-tree or PMax Asset Group performance rows for 16 September through 15 October 2026 in `Europe/Istanbul`. This is not numeric zero, global unsupported evidence or Dataset V2 authority. Retained evidence is `docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.
- The retained live execution used a combined account context from `campaign`; therefore its zero Campaign rows also suppressed `customer.test_account` and left the selected account type unproven. Before another live call, account identity had to be separated to a `FROM customer` query while Campaign inventory remained `FROM campaign`. That evidence record itself authorized neither another live call nor the correction.
- The product owner separately authorized that narrow correction on 16 October 2026. Repository runtime version `1.1.0` now runs `account_identity` from `customer` before the separate `campaign_context` inventory query from `campaign`; an empty Campaign result can no longer hide account-type evidence. No deployment or additional live provider call is authorized by this implementation approval.
- The product owner separately authorized Production deployment on 16 October 2026. Exact commit `53730bee401c79600570f199bd9967cf2d560c8a` was deployed as `dpl_GFNme3aUQUJ25723fwU3e7HU235p`; state was `READY`, `embedded.adstable.app` was assigned without alias error, and the initial deployment-scoped error/fatal scan was clean. No additional live Google request is authorized by this deployment approval.
- The separately authorized follow-up request returned `customer.test_account=true` successfully. Google did not return a provider error; runtime version `1.1.0` converted that classification into the internal `GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE` failure and stopped before the remaining read-only families.
- Google Ads API access, OAuth restricted-scope verification and demo-account policies were rechecked on 16 October 2026. The product owner accepted one shared pre/post-review runtime: retain independent account identity, classify `test_observed` without a critical error, complete the bounded read-only families, expose only safe counts, and label the result as test-account demo output that is not production performance evidence. No review-only branch, fabricated row, Dataset publication, deployment or additional provider request is authorized by this repository implementation decision.
- Repository runtime version `1.2.0` implements that decision. Local verification passed 289/289 tests, TypeScript verification, production build and diff checks.
- The product owner separately authorized Production deployment on 16 October 2026. Exact commit `16a54df48e853c282d9c3481fb9e3b7c2b2ca16d` was deployed as `dpl_AQWkrVxdQvVzxPQkeNbhwXXwcXXQ`; Vercel reported `READY`, assigned `embedded.adstable.app` without alias error, and the initial deployment-scoped error/fatal scan was clean. The product owner accepted the real Shopify Admin Settings result on desktop and mobile. At that point, another live provider request and merge were still separately gated.
- The product owner explicitly authorized merge. PR #85 was merged into `main` as `54c427733cd51ba8600016941ce7afdd24ac2e64` on 16 October 2026. The merge did not create a second automatic Vercel Production deployment. The test-account review demo is accepted and merged; production performance evidence remains pending Google Ads API Explorer-or-higher access, and another live provider request remains separately gated.
- The product owner separately authorized one live test-account review-demo execution on 16 October 2026. The real Shopify Admin terminal state verified `test_observed` and completed all six read-only query families without provider error, runtime error or retry. Campaign context, Cart Data sales, Shopping product performance, current PMax listing tree and PMax Asset Group performance each returned zero rows. Those empty results mean only `not_observed_in_this_execution`; they do not prove numeric zero, global unsupported behavior, Product ID support, Sales Role support or Production performance. Durable bounded evidence is `docs/evidence/EO_04C_GOOGLE_TEST_ACCOUNT_REVIEW_EVIDENCE_2026-10-16.json`. Google access-level and test-account documentation was rechecked: Explorer-or-higher adds Production account access without removing Test account access, so the shared query structure remains unchanged. Production evidence and every further live provider call remain separately gated.

## EO-04-C Google 2026 access/review corrective — 17 October 2026

- Google'ın 9 Eylül 2026 geçiş dokümanı, access-level sayfası, OAuth production-readiness kuralları, Ads API security requirements ve policy/demo süreci resmî kaynaklardan yeniden kontrol edildi. Bağlayıcı karar `docs/decisions/A6_EO_04_C_GOOGLE_2026_ACCESS_REVIEW_CORRECTIVE.md`; executable contract `contracts/eo-04c-google-2026-access-review-corrective-v1.json` içindedir.
- İlk gerçek-hesap geliştirme hedefi Explorer access'tir. Google Ads API access seviyesi OAuth istemcisinin bağlı olduğu Google Cloud Project'e aittir; OAuth public verification ayrı bir dış-kullanıcı kapısıdır.
- Google Ads API v25 için `GOOGLE_ADS_DEVELOPER_TOKEN` yalnız geçiş uyumluluğudur: varsa header gönderilir, yoksa runtime fail etmez. Mevcut Production secret bu paketle değiştirilmez veya silinmez.
- HTTP 401, Cloud Project access eksikliği, 2-Step Verification eksikliği, diğer permission/scope 403'leri ve `AUTHORIZATION_ERROR` ayrı fail-closed sınıflardır. Hiçbiri otomatik retry, project değişimi veya alternatif auth rotası başlatmaz.
- Historical PMax doğruluğu korunur: bugünkü listing tree geçmiş satışı exact çözemez. Tam business-day snapshot yoksa satış ve Sales Role korunur, Channel `Unclassified Channel` kalır. Versioned snapshot persistence A6-EO-05 sorumluluğudur.
- Ürün sahibi 17 Ekim 2026'da bu repository düzeltme paketini onaylamıştır. Onay Google başvurusu, canlı provider çağrısı, Cloud Project/OAuth/secret/environment değişikliği, deployment, database, Dataset V2 veya UI mutation'ı yetkilendirmez.
- Ürün sahibi gerekli CI sonrasında merge'i açıkça onaylamıştır. PR #89, 17 Ekim 2026'da `main` üzerine `ff54d518b7c93ba576c9943a7c8d66a7ea511de6` olarak squash-merge edilmiştir. Explorer başvurusu, ilk Production çağrısı ve her provider mutation'ı ayrı kapıda kalır.
