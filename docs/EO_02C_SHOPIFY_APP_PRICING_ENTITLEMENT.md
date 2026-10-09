# EO-02-C — Shopify App Pricing trial, subscription and entitlement

**Kontrol tarihi:** 8 Ekim 2026  
**Durum:** Database ve null/trial/active provider kabulü PASS; browser/response/log sızıntı kontrolü PASS; runtime adapter ve doğrulanmış internal caller hazır; Production database Secret aktivasyonu ve canlı persistence kanıtı açık

## Analist sonucu

AdsTable'ın Shopify-origin merchant ücretlendirmesi Shopify App Pricing tarafından yönetilir. AdsTable abonelik veya trial üretmez; yalnız Shopify Partner API'nin doğrulanmış `activeSubscription(appId, shopId)` sonucunu workspace entitlement projection'ına dönüştürür.

On dört günlük trial Shopify planında tanımlanır. Shopify son 180 gündeki kullanılmış trial günlerini takip ettiği için uninstall/reinstall trial'ı sıfırlamaz. Local `trial_ledger` yalnız Shopify'ın bildirdiği trial durumunun denetim izidir; erişim verme yetkisi yoktur.

## Güncel resmî kaynak kararı

6 Ekim 2026 tarihinde aşağıdaki Shopify belgeleri kontrol edildi:

- Yeni public app'lerde desteklenen fiyat modelleri için varsayılan yöntem Shopify App Pricing'dir.
- Plan, fiyat ve trial Partner Dashboard/App Store listing tarafında tanımlanır.
- Uygulama `appSubscriptionCreate` veya framework `billing.request` ile yeni charge oluşturmaz.
- Merchant planı Shopify'ın hosted plan selection sayfasında seçer.
- Canlı subscription gerçeği Partner API `2026-07` `activeSubscription` sorgusundan okunur.
- Query `null` döndürürse aktif contract yoktur.
- Trial sırasında `trialEndsAt` dolu, `currentBillingCycle` null'dır; trial bittiğinde bunun tersi geçerlidir.
- Shopify App Pricing billing lifecycle webhook'u göndermez. Redirect sonrasında ve redirect dışı cancellation/freeze değişiklikleri için Partner API yeniden sorgulanır.
- Partner API client'ı organization-scoped secret kullanır ve `Manage apps` yetkisi ister; limit client başına saniyede dört istektir.

Kaynaklar:

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials
- https://shopify.dev/docs/api/partner/latest
- https://shopify.dev/docs/api/partner/latest/active-subscription

## 7 Ekim 2026 Partner API canlı yetki kanıtı

- Shopify Partner API client: `AdsTable Entitlement Runtime`
- Client ID: `38724`
- Yetki: yalnız `Manage apps`
- Kapalı yetkiler: `View financials`, `Manage app subscriptions`, `Manage themes`
- API sürümü: `2026-07`
- Salt-okunur GraphiQL sorgusu: `app(id: "gid://partners/App/432251994113") { id name }`
- Doğrulanan sonuç: `gid://partners/App/432251994113` / `AdsTable`
- Access token repository'ye, kanıt dosyasına, sohbete veya loga yazılmadı.
- Bu kanıt yalnız organization-scoped client authentication ve `Manage apps` erişimini doğrular. Plan oluşturulmadan ve mağaza uygulamayı seçmeden `activeSubscription` trial/active/null kabulü tamamlanmış sayılmaz.
- Vercel secret aktivasyonu, exact runtime environment adları ve tüketici startup guard'ı dondurulmadan yapılmaz.

## 8 Ekim 2026 canlı trial sonucu

- Shopify App Store registration tamamlandı; public `AdsTable Monthly` planı `USD 24.99 / 30 gün`, 14 günlük trial ve `/` welcome link ile oluşturuldu.
- Yeni app `adstable-1` Shopify Admin handle'ıyla `adstable-development.myshopify.com` development store'a kuruldu; iframe hedefi `embedded.adstable.app`, client ID `58c91f39f69ca282a94ba06e9648be9e` olarak doğrulandı.
- Store ve app farklı Dev Dashboard organizasyonlarında olduğu için plan `Free for partners and developers` seçeneğiyle ücret olmadan test edildi.
- Partner API trial cevabı `trialEndsAt=2026-10-22T08:02:49Z`, `currentBillingCycle=null`, `pendingUpdate=null` ve handle `adstable-monthly` döndürdü.
- Development-store effective fiyatı `USD 0.0`, `price.active=false` geldi. Resmî Partner API sözleşmesine göre `price.active` fiyat sürümünün güncelliğidir; abonelik veya entitlement aktiflik bayrağı değildir.
- Eski runtime'ın `price.active === true` şartı bu canlı yanıtı yanlış reddediyordu. Kod, contract ve test bu bulguya göre düzeltilmeden trial persistence PASS sayılmaz.
- Secret içermeyen kısmi kanıt: `docs/evidence/EO_02C_LIVE_ACCEPTANCE_2026-10-08.json`.

## 8 Ekim 2026 canlı active sonucu

- `adstable-development.myshopify.com`, Shopify'ın otomatik oluşturduğu `shopify-test` private planına hedef mağaza olarak eklendi.
- Shopify onay ekranı planın ücretsiz olduğunu ve faturalandırma yapılmayacağını açıkça gösterdi; dönüş URL'i `plan_handle=shopify-test` taşıdı.
- Partner API `activeSubscription` sonucu `trialEndsAt=null`, `billingPeriod=EVERY_30_DAYS`, `cancelAtEndOfCycle=false` ve `pendingUpdate=null` döndürdü.
- Current billing cycle `2026-10-08T08:45:05Z → 2026-11-07T08:45:05Z` olarak oluştu.
- Subscription item handle `shopify-test`; effective fiyat `USD 0.0`; `price.active=true` gözlendi.
- Bu sonuç active provider durumunu PASS yapar. Runtime DB projection/persistence ve secret/log/browser sızıntı kontrolleri tamamlanmadan EO-02-C kapanmaz.

## 8 Ekim 2026 runtime persistence preflight sonucu

- Production deployment `dpl_CtweiU8YdzpoAxXKFibrDtwBgxyN`, source commit `2afe0083efe269574dc5f1759fe7762fe18a87a2` ve Vercel Production environment metadata'sı salt okunur denetlendi.
- Production'da yalnız üç Shopify Partner anahtarı vardır; Supabase server runtime bağlantısı tanımlı değildir.
- Repository'de Partner API normalizer/orchestrator ve database functions hazırdır; fakat canlı database repository adapter'ı ve onu çağıran production reconciliation akışı yoktur.
- Canlı Supabase sayımları: workspace 0, installation 0, subscription 0, entitlement 0, trial ledger 0.
- Bu durum provider veya Supabase arızası değildir. Eksik implementation nedeniyle provider PASS sonucu database'e kendiliğinden yazılamaz.
- Production HTML, altı istemci asset'i ve son 24 saat Vercel runtime logları tarandı. Server-only değişken adı, Partner endpoint kimliği, App GID, access-token header/değeri, authorization header, cookie veya session sızıntısı bulunmadı; dört sızıntı kapısı PASS oldu.
- EO-02-C kapanmadan önce server-only least-privilege database bağlantısı, gerçek repository adapter'ı ve public olmayan doğrulanmış reconciliation tetikleyicisi branch/CI/live evidence ile tamamlanmalıdır. Geçici public test endpoint'i açılamaz.

## 8 Ekim 2026 runtime persistence implementation sonucu

- Supabase'in güncel resmî serverless bağlantı sözleşmesine göre transaction pooler (`6543`) seçildi; session pooler ve browser Data API kullanılmadı.
- Server-only `ADSTABLE_RUNTIME_DATABASE_URL`, yalnız `adstable_runtime.podpwkrpmjiksskxhwsu` kullanıcısını, Frankfurt pooler hostunu, `postgres` veritabanını ve `sslmode=require` değerini kabul eden fail-closed startup guard'a bağlandı.
- `pg@8.23.0` ile function instance başına en fazla bir bağlantılık pool kuruldu; transaction mode nedeniyle prepared statement kullanılmadı.
- Repository adapter'ı doğrudan tablo DML yapmaz; yalnız `shopify.bootstrap_installation` ve `billing.apply_shopify_app_pricing_snapshot` function'larını parametreli sorgularla çağırır.
- Internal reconciliation caller, önce Shopify ID token session ve Admin shop kimliğini doğrulayan installation bootstrap'ı çalıştırır; caller-supplied workspace veya public test endpoint'i kabul etmez.
- Kod, test ve build sonucu canlı aktivasyonun yerine geçmez. Production database Secret henüz girilmedi ve gerçek provider sonucunun Supabase projection'ına yazıldığı henüz kanıtlanmadı; EO-02-C `Verification` kalır.

## Runtime environment sözleşmesi

8 Ekim 2026 tarihinde Shopify'ın resmî plan yönlendirme örneği, Vercel'in Config/Secret environment belgeleri ve Supabase'in secure data/serverless transaction pooler belgeleri yeniden kontrol edildi.

| Anahtar | Tür | Vercel kapsamı | Kural |
|---|---|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | Config | Production | Exact değer `5235756` |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Secret | Production | Değer repository, kanıt, browser ve loglarda bulunmaz |
| `SHOPIFY_APP_GID` | Config | Production | Exact değer `gid://shopify/App/432251994113` |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Secret | Production | Yalnız transaction pooler, `adstable_runtime` rolü, project ref `podpwkrpmjiksskxhwsu`, port `6543`, database `postgres` ve `sslmode=require`; değer hiçbir kanıta yazılmaz |

Preview ve Development production Partner API tokenını veya Production database Secret'ını alamaz ve canlı Partner API/database çağrısı yapamaz. Eksik veya bozuk runtime configuration erişim vermez. Partner API endpoint'i yalnız organization ID ve sabit `2026-07` sürümünden server tarafında üretilir. Environment değişikliği mevcut deployment'ı değiştirmez; yeni deployment gerekir.

Bu sözleşmenin dondurulması database Secret değerinin Vercel'e girildiği anlamına gelmez. Production database Secret aktivasyonu, yeni deployment ve gerçek `trial | active | null` persistence kabulü açık insan kapısı olarak bekler.

## Yetki ve durum akışı

1. Shopify ID token ve Admin shop doğrulamasından geçen aktif installation generation alınır.
2. Server-configured App GID ve doğrulanmış Shop GID ile Partner API çağrılır.
3. Response içindeki Shop GID ve canonical domain installation ile aynı değilse yazım yapılmaz.
4. Aktif trial sonucu `trial`, aktif billing cycle sonucu `active` entitlement üretir.
5. `activeSubscription: null` sonucu `subscription_required` üretir.
6. HTTP/GraphQL hata, bozuk response veya kimlik uyuşmazlığı eski projection'ı aktif saymaz ve yeni projection yazmaz.
7. Eski tarihli snapshot reddedilir.
8. Entitlement tüketicisi kendi freshness eşiğini verir; eşikten eski projection DB resolver tarafından döndürülmez.
9. Hosted-plan dönüşü, stale app entry ve entitlement korumalı background iş öncesinde canonical durum yeniden doğrulanır.

## Veri modeli

- `billing.workspace_subscriptions`: Shopify App Pricing active/null sonucunun generation-bound projection'ı.
- `billing.workspace_entitlements`: `trial | active | subscription_required` erişim kararının installation-generation-bound projection'ı.
- `billing.trial_ledger`: Shopify-owned trial snapshotlarının immutable, idempotent gözlem izi.

Üç tablo private schema'dadır, RLS enabled + forced'dur. Browser/Data API rolleri ve `service_role` erişemez. `adstable_runtime` doğrudan table DML taşımaz; yalnız snapshot apply ve fresh entitlement resolve function'larını çağırabilir.

## Kurulu Shopify mağazasına bağlı abonelik

Abonelik, doğrulanmış app installation mağazasına aittir.

- Bir installation generation yalnız kendi Shopify mağazası için entitlement üretir.
- Provider hesabı, pixel veya domain abonelik kapsamını başka mağazaya taşıyamaz.
- İkinci Shopify mağazası ayrı installation, workspace ve subscription gerektirir.
- Merchant-selectable commerce-store kontrolü yoktur.

## Fail-closed matrisi

| Shopify/Partner sonucu | AdsTable durumu | Erişim |
|---|---|---|
| Future `trialEndsAt`, cycle yok | `trial` | Açık |
| Current billing cycle mevcut | `active` | Açık |
| `activeSubscription: null` | `subscription_required` | Kapalı |
| API/GraphQL hata | `unknown` | Kapalı; son projection overwrite edilmez |
| Shop identity uyuşmazlığı | `unknown` | Kapalı; yazım yok |
| Stale snapshot | Değişmez | Reject |
| Freshness eşiğinden eski projection | Stale | Resolver sonuç döndürmez |

## Bu pakette bilinçli olarak yapılmayanlar

- Partner Dashboard'da fiyat/plan oluşturma veya yayınlama
- Production fiyat kararı
- Partner API access tokenının Vercel Production Secret olarak aktive edilmesi
- Settings billing UI
- Uninstall, privacy deletion ve clean reinstall
- Provider OAuth veya Reporting Account seçimi

Bu dış kapsam maddeleri uygulanmış sayılmaz. Plan/secret aktivasyonu ve canlı Partner API acceptance ayrıca açık insan kapısıdır.

## Canlı kabul yürütme planı

Canlı yürütme sırası ve secret-free kanıt şeması aşağıdaki bağlayıcı dosyalarda donduruldu:

- `docs/runbooks/EO_02C_LIVE_ACCEPTANCE_RUNBOOK.md`
- `docs/evidence/EO_02C_LIVE_ACCEPTANCE_TEMPLATE.json`

Development store kabul sırası `null → intended USD 24.99 / 14-day trial → Shopify $0 private no-trial test plan ile active` şeklindedir. Sıra, Shopify'ın 180 günlük trial kullanım takibi nedeniyle rastgele tekrar edilemez. Bu kayıt planın oluşturulduğu, tokenın Vercel'e girildiği veya canlı kabulün geçtiği anlamına gelmez.

## Kabul

- Contract, server resolver ve migration aynı authority/state matrisini uygular.
- Manual Billing API yeni subscription yolu olarak kullanılamaz.
- Partner API hatası entitlement'a dönüşmez.
- Trial local olarak yeniden başlatılamaz.
- Entitlement doğrulanmış kurulu Shopify mağazasına ve installation generation'a bağlıdır.
- Provider bağlantısı veya hesap değişikliği billing scope'u değiştiremez.
- Repository test/build/CI PASS olmalıdır.
- Supabase migration ve self-cleaning behavioral probe canlı PASS oldu; üç billing tablosunun RLS/forced RLS sonucu 3/3, runtime direct DML sonucu 0, runtime function access sonucu 2/2, Security ve Performance Advisor sonucu 0/0 ve kalan probe satırı 0'dır.
- Evidence: `docs/evidence/EO_02C_DATABASE_ACCEPTANCE_2026-10-06.json`.
- Partner Dashboard plan/trial ayarı, exact Vercel runtime secret aktivasyonu ve gerçek null/trial/active provider kabulü PASS olmuştur. Browser/response/application/platform log sızıntı kontrolleri PASS olmuştur. Runtime DB projection/persistence, eksik server database bağlantısı ve repository adapter'ı tamamlanana kadar açık kalır; Partner API client oluşturma ve `Manage apps` authentication kapısı 7 Ekim 2026'da PASS olmuştur.


## 8 Ekim 2026 authenticated runtime corrective bulgusu

- Main üzerindeki ürün route'ları yalnız preview yüzeyidir; resmi Shopify server adapterı, `authenticate.admin` Admin layout'u ve kalıcı session storage yoktur.
- Internal reconciliation caller doğrudan public edilmemiştir; bu doğrudur, ancak çağrılabilir güvenli Production boundary de henüz yoktur.
- Bu nedenle yalnız database Secret ve yeni deployment canlı persistence üretemez. Secret aktivasyonu güvenli biçimde durduruldu.
- Düzeltme kararı: `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md` ve `contracts/eo-02c-shopify-runtime-auth-bridge-v1.json`.
- EO-02-C, authenticated runtime bridge, ciphertext-only session persistence ve gerçek canlı projection kanıtı PASS olmadan kapanmaz.

## 9 Ekim 2026 düzeltmesi

Önceki seçilebilir mağaza entitlement varsayımı aktif modelden kaldırıldı. Runtime DTO ve billing projection yalnız Shopify App Pricing erişim durumunu taşır. İleri yönlü düzeltici migration eski üç metadata kolonunu kaldırır; uygulanmış migration ve tarihsel kabul kanıtları değiştirilmez. Canlı migration ayrı açık onay gerektirir. Bağlayıcı contract: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.
