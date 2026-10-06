# A6 EO-F5 — Embedded-only ürün ve route haritası

**Tarih:** 4 Ekim 2026  
**Durum:** EO-F5 tamamlandı; EO-F6 bekleniyor  
**Etkisi:** Salt-okunur ürün, route ve consumer sözleşmesi. Kod, repository/project, Shopify configuration, provider, veritabanı veya deployment değiştirmez.

## Analist sonucu

Hedef embedded ürün yalnız **üç ana yüzeyden** oluşacaktır:

1. **Funnel** — Shopify App Home
2. **Ad Analysis**
3. **Settings**

Platforms ayrı yüzey değildir; Settings içindeki provider bağlantıları bölümüdür. Dashboard ayrı bir ürün sayfası değildir; Funnel ve Ad Analysis bağlamında açılan grafik panelleri olarak yaşar. Attribution Differences ayrı navigation yüzeyi değildir; **E10-T5-C2-C Cross-platform deepest-grain discovery** tamamlandıktan sonra Ad Analysis içinde açılan bir analiz görünümü olur.

Bu karar yüzey sayısını altıdan üçe indirir. Merchant ürün içinde “hangi ekranda ne var?” sorusuyla uğraşmaz: genel performans Funnel'da, en alt kırılım ve karşılaştırma Ad Analysis'te, bütün kurulum/yönetim işleri Settings'tedir.

## Resmî Shopify kontrolü

4 Ekim 2026 tarihinde güncel resmî kaynaklar yeniden kontrol edildi:

- iframe tabanlı public App Home, App Bridge ve Polaris web components kullanır;
- App Nav'da uygulama adı zaten home route'a gider; ayrı, yinelenen home link'i eklenmez;
- App Nav desktop'ta sidebar, mobile'da dropdown olarak Shopify tarafından sunulur;
- mandatory privacy topic'leri `customers/data_request`, `customers/redact` ve `shop/redact`tir; HMAC doğrulanamayan istek 401 ile reddedilir;
- app-specific webhook subscriptions app configuration üzerinden yönetilmelidir;
- Polaris 2 release-candidate niteliğindedir; mevcut UI Constitution'daki revalidation kapısı korunur.

Kaynaklar:

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components/app-nav
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/build/webhooks/subscribe
- https://shopify.dev/docs/api/webhooks/2025-10

## Üç yüzeyli product shell

| Canonical route | Ana yüzey | İçinde yaşayan işlevler | Review durumu |
|---|---|---|---|
| `/` | Funnel / App Home | Funnel, Table view ve bağlamsal Dashboard grafikleri | Review-critical |
| `/ad-analysis` | Ad Analysis | Deepest-grain analiz, bağlamsal grafikler ve discovery sonrasında Attribution Differences | Review-critical |
| `/settings` | Settings | Currency, Platforms/provider bağlantıları, Klaviyo cost, trial/billing, privacy ve Delete My Data | Review-critical |

### Navigation

Mantıksal ürün sırası:

1. Funnel
2. Ad Analysis
3. Settings

Funnel uygulama adı ve `/` üzerinden home'dur. Shopify'ın resmî home davranışı nedeniyle App Nav içine ikinci bir Funnel satırı eklenmez. Render edilen App Nav öğeleri yalnız **Ad Analysis** ve **Settings** olur.

### Ayrı yüzey olmaktan çıkarılanlar

- **Dashboard:** Ayrı route/nav değildir. Funnel ve Ad Analysis içinde, o ekranın bağlamına göre açılan grafik panelleridir.
- **Platforms:** Ayrı route/nav değildir. Settings içindeki provider connections/setup bölümüdür.
- **Attribution Differences:** Ayrı route/nav değildir. E10-T5-C2-C tamamlandıktan sonra Ad Analysis içinde açılır. Discovery sonucu karşılaştırılabilir grain bulunamazsa sahte ekran açılmaz; `capability_unavailable` gösterilir.
- **Funnel/Table:** Aynı App Home içindeki görünüm seçimidir; ayrı global route değildir.

`/dashboard`, `/platforms`, `/attribution-differences`, `/analysis`, `/shopify/app/*` ve `/funnel` hedef canonical route değildir. Eski runtime cutover'a kadar kendi eski route'larının sahibi olmaya devam eder; yeni runtime'da ikinci ürün ağacı kurulmaz.

## Giriş ve onboarding resolver

Her UI isteği server-side doğrulanmış Shopify session'dan shop, installation generation ve `workspace_id` türetir. Query/body içindeki workspace veya shop authority değildir.

Resolver sırası:

1. Shopify session yok/geçersiz → fail-closed embedded authentication response; standalone login yok.
2. Installation bootstrap eksik/geçersiz → managed install/bootstrap.
3. Billing entitlement yok/expired → `/settings` plan/trial bölümü.
4. Reporting currency yok → `/settings` currency bölümü.
5. Aktif, doğrulanmış provider hesabı yok → `/settings` Platforms bölümü.
6. Klaviyo seçili ve Email Monthly Plan Cost eksik → `/settings` Platforms/Klaviyo cost bölümü.
7. Hazır → `/` Funnel.

Deep link doğrudan Ad Analysis'e gelse de aynı guard çalışır. Tamamlanınca güvenli return target allowlist ile korunur; dış URL, secret, PII veya caller-supplied tenant taşınmaz.

## Authenticated BFF sınırı

UI yalnız aynı-origin server BFF route'larını tüketir; browser database client veya provider token görmez. Aşağıdaki endpoint'ler ürün yüzeyi değil, üç yüzeyin server data sözleşmeleridir.

| Method ve route | Tüketen yüzey | İşlev |
|---|---|---|
| `GET /api/app/context` | Tümü | Session, onboarding, entitlement, currency ve provider readiness |
| `GET /api/workspace/settings` | Settings | Reporting currency ve gösterilebilir ayarlar |
| `PATCH /api/workspace/settings/reporting-currency` | Settings | Merchant currency seçimi |
| `GET /api/providers` | Settings | Meta/Google Ads/Klaviyo bağlantı özeti |
| `GET /api/providers/:provider/accounts` | Settings | Verified account discovery |
| `PUT /api/providers/:provider/active-account` | Settings | Canonical reporting account seçimi |
| `POST /api/providers/:provider/disconnect` | Settings | Connection lifecycle |
| `GET /api/providers/klaviyo/email-spend-history` | Settings | Versionlı maliyet geçmişi |
| `POST /api/providers/klaviyo/email-spend-history` | Settings | Effective-date maliyet kaydı |
| `GET /api/reports/funnel` | Funnel | Funnel/Table read model |
| `GET /api/reports/dashboard` | Funnel + Ad Analysis | Bağlamsal grafik verisi; ayrı sayfa üretmez |
| `GET /api/reports/ad-analysis` | Ad Analysis | Kanıtlı deepest-grain read model |
| `GET /api/reports/attribution-differences` | Ad Analysis | Discovery sonrası salt-okunur karşılaştırma |
| `GET /api/refresh/status` | Funnel + Ad Analysis | Freshness/finality; refresh başlatmaz |
| `GET /api/billing/entitlement` | Settings | Trial/subscription truth |
| `POST /api/billing/subscribe` | Settings | Shopify billing onay akışı |
| `POST /api/privacy/deletion-requests` | Settings | Delete My Data talebi |
| `GET /api/privacy/deletion-requests/:requestId` | Settings | Aynı workspace için durum |

Exact request/response şemaları EO-02–EO-07 paketlerinde versionlanır. Ayrı API endpoint'i ayrı navigation yüzeyi anlamına gelmez.

## OAuth ve callback

- `POST /api/providers/:provider/oauth/start`
- `GET /api/providers/:provider/oauth/callback`

Provider allowlist yalnız `meta|google-ads|klaviyo`dur. Start verified Shopify session ve workspace-owned transaction ister. Callback state, PKCE/nonce ve TTL doğrulaması yapmadan token exchange veya connection write yapmaz. Başarılı/iptal/hata dönüş hedefi yalnız `/settings` içindeki Platforms bölümüdür.

TikTok ve Pinterest hedef provider allowlist'ine girmez; güncel EO kararı E10-T5C4'teki eski aktif-provider gösterimini geçersiz kılar.

## Shopify webhooks

Tek canonical ingress: `POST /webhooks/shopify`.

Raw body korunur; HMAC ve topic allowlist doğrulaması JSON işleme ve DB yazısından önce yapılır. Desteklenen topic sınıfları:

- `customers/data_request`
- `customers/redact`
- `shop/redact`
- `app/uninstalled`
- billing entitlement değişimini taşıyan resmî topic — exact API name EO-02'de güncel resmî dokümanla dondurulur

Her teslim idempotent webhook claim üretir. Unknown topic fail-closed olur. Privacy topic'leri UI session veya aktif installation gerektirmez; HMAC + shop/install generation binding kullanır.

## Internal runtime girişleri

| Route | Caller | Kural |
|---|---|---|
| `POST /internal/jobs/hourly-refresh` | Yalnız Vercel Cron/internal signed caller | Merchant/UI çağıramaz; shard + lease + idempotent upsert |
| `GET /healthz` | Platform health probe | Secret, provider/tenant detail veya DB row döndürmez |

Hourly refresh yalnız AdsTable-owned scheduler tarafından başlatılır. Sayfa açılması, grafik panelinin açılması, browser reload veya birden fazla Shopify kullanıcısı refresh üretmez. İlk bootstrap yalnız yesterday + today; rolling reconciliation/finality EO-05'e tabidir.

## Production yüzeyinden yasaklanan route sınıfları

Hedef build aşağıdakileri route olarak içeremez:

- `/api/e10/*` acceptance/preflight/probe yolları
- `*/runtime/preflight`, `*/runtime/acceptance`
- historical inventory ve manual historical fetch
- controlled reset, journey diagnostic, flow-event inventory
- raw provider response/metric discovery/operator selection route'ları
- test, debug, synthetic-data ve secret inspection yolları
- standalone `/login`, `/signup`, `/auth/*`, legacy dashboard
- browser-triggered manual refresh
- generic proxy veya caller-supplied URL/tenant route'u

Gerekli tanılama ayrı operator aracı/CI evidence olarak çalışır; production product router'a bağlanmaz.

## Journey, state ve evidence kapıları

| Journey | Ana yüzey | Zorunlu görünür state | Done evidence |
|---|---|---|---|
| Install/session | App shell | loading, auth failure, forbidden | desktop/mobile session + tamper negative |
| Trial/billing | Settings | trial, active, expired, billing_error | billing reconciliation; EO-02 |
| Currency | Settings | required, saved, invalid | server read-back + audit |
| Connect/reconnect | Settings / Platforms bölümü | loading, cancel, error, reauthorization_required | provider identity/read probe |
| Account selection | Settings / Platforms bölümü | empty, partial, forbidden, error | read-back + ownership |
| Klaviyo cost | Settings / Platforms bölümü | required, active, validation_error | versionlı history + allocation |
| Hourly refresh | System; status Funnel/Ad Analysis | queued, running, partial, stale, final | run/checkpoint/reconciliation |
| Funnel + grafikler | Funnel | loading, empty, partial, stale, reauth, error | API/UI parity, desktop/mobile |
| Deepest-grain + grafikler | Ad Analysis | same states + unavailable dimensions | provider raw/normalized parity |
| Attribution Differences | Ad Analysis; discovery sonrası | capability_unavailable dahil | scope/grain capability + non-mutating proof |
| Delete My Data | Settings | confirm, queued, running, complete, failed | idempotency + deletion manifest |
| Uninstall | Lifecycle | UI erişimi yok | webhook claim + stopped leases |
| Clean reinstall | Onboarding | yeni generation | generation isolation + 48h race tests |

Eksik veri sıfıra çevrilmez. `unsupported`, `unknown`, `partial`, `stale`, `reauthorization_required` ve `capability_unavailable` ayrı product truth state'leridir.

## UI Constitution eşlemesi

Bu paket UI kodu yazmaz. EO-07 öncesinde üç ana ekranın her biri için analist brief, state/copy matrisi ve exact Shopify component/property/variant eşlemesi hazırlanacaktır.

Dondurulan shell yönü:

- App navigation: resmî App Bridge/Polaris `s-app-nav` / `s-link`
- Page shell: `s-page`
- Birincil/ikincil eylemler: `s-button`
- Form alanları: resmî Polaris web components
- Grafik panelini açan kontrol: güncel resmî disclosure/action karşılığı doğrulanmadan seçilmez
- Banner/notice/badge/table/empty state: yalnız güncel resmî karşılık doğrulanırsa
- raw HTML action control, `s-clickable` button taklidi, inline CSS, literal renk ve custom Shopify-look yasak

EO-07 başladığında Polaris stabil/RC durumu yeniden doğrulanır. Desktop ve gerçek Shopify Admin mobile 320px kanıtı ile açık ürün sahibi kabulü olmadan ekran Done/merge olamaz.

## DB consumer map

| Consumer | Okuma | Yazma |
|---|---|---|
| Session/onboarding guard | `shopify.installations`, `app.*`, `billing.*`, `integrations.provider_connections` | bootstrap transaction dışında yok |
| Settings | `app.*`, `billing.*`, `privacy.*`, `integrations.*`, `analytics.email_spend_history` | currency, connection/account, spend history, billing intent, deletion request |
| Funnel | `analytics.*`, `operations.reconciliation_ledger` | yok |
| Ad Analysis | `analytics.*`, `operations.reconciliation_ledger` | yok |
| Hourly refresh | `integrations.*`, `app.workspace_settings` | `analytics.*`, `operations.*` |
| Webhooks/lifecycle | `shopify.installations` | `privacy.*`, `billing.*`, installation state |
| Migration/cutover | restricted source manifests | allowlisted EO-F4 carry only |

UI, browser ve App Bridge hiçbir schema'ya doğrudan bağlanmaz. BFF caller-supplied workspace kabul etmez.

## Önceki contract'larla çatışma çözümü

- E10-T5C7'deki altı öğeli navigasyon artık üç ürün yüzeyine konsolide edilmiştir.
- Funnel root/app-name home'dur; App Nav'da yinelenmez.
- Dashboard ayrı route değildir; Funnel ve Ad Analysis bağlamındaki grafik panelleridir.
- Platforms ayrı route değildir; Settings içindeki provider bağlantıları bölümüdür.
- Attribution Differences ayrı route değildir; E10-T5-C2-C sonrasında Ad Analysis içine girer.
- E10-T5C4'te TikTok active görünümü geçersizdir; aktif providerlar Meta, Google Ads ve Klaviyo'dur.
- Billing ayrı global nav değildir; Settings içindedir.
- Manual Refresh yoktur; kullanıcı yalnız freshness/run status görür.

## Kabul sonucu

EO-F5 **PASS**:

- top-level product surface: 3
- canonical embedded UI route: 3
- rendered App Nav link: 2 — home olan Funnel yinelenmez
- active provider: 3
- standalone Dashboard/Platforms/Attribution route: 0
- standalone UI/auth route: 0
- production debug/operator/acceptance route: 0
- browser-triggered refresh route: 0
- direct browser DB access: 0
- implementation/production/provider/DB/deployment mutation: 0
- sıradaki kapı: **EO-F6 — Repair vs re-establishment effort and risk comparison**

Bu paket EO-F7 GO vermez, yeni repository/project oluşturmaz, Shopify app URL'sini değiştirmez, webhook kaydetmez ve mevcut runtime'ı kapatmaz.
