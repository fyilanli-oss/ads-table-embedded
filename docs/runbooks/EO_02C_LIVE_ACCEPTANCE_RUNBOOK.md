# EO-02-C — Shopify App Pricing canlı kabul runbook'u

**Kontrol tarihi:** 7 Ekim 2026  
**Canlı uygulama tarihi:** Kart doğrulama bekleme süresi sonrasında  
**Durum:** Hazır; hiçbir canlı mutation bu belge hazırlanırken yapılmadı

## Amaç

Shopify App Pricing planını, Partner API Production secret sınırını ve AdsTable entitlement projection'ını tek kontrollü akışta `null → trial → active` durumlarıyla doğrulamak. Bu runbook EO-02-C'yi otomatik olarak kapatmaz; her adımın kanıtı ve açık ürün sahibi kabulü gerekir.

## Resmî kaynaklar

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page
- https://shopify.dev/docs/api/partner/latest/active-subscription
- https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/environment-variables/sensitive-environment-variables

Shopify aynı Partner organizasyonundaki development store'un kullanılabilir ücretli planları gerçek ücret olmadan seçmesine izin verir ve effective price'ı sıfır olan subscription contract oluşturur. Vercel Secret değerleri kaydedildikten sonra okunamaz; environment değişikliği yalnız yeni deployment'a uygulanır.

## İnsan kapıları

Aşağıdaki işlemler kullanıcı görünür onayı olmadan yapılmaz:

1. App Store registration kart doğrulaması ve tek seferlik ücret.
2. Public planın kaydedilmesi veya yayımlanması.
3. Partner API access tokenının Vercel Production Secret olarak girilmesi.
4. Production deployment.
5. Development store üzerinde plan seçimi veya plan değişimi.

## Dondurulmuş plan

| Alan | Değer |
|---|---|
| Public plan adı | AdsTable Monthly |
| Billing | Monthly |
| Fiyat | USD 24.99 |
| Trial | 14 gün |
| Welcome link | `/` |
| Development store test | Aynı Partner organizasyonunda ücret yok |
| Private acceptance planı | Shopify'ın `$0 private test plan`ı, trial yok |
| Aynı anda aktif subscription | Bir |

Private test plan yalnız `active` durum şeklinin canlı kabulü içindir; merchant-facing fiyat teklifi değildir.

## Aşama 0 — Salt-okunur preflight

- GitHub `main`, production deployment SHA ve mevcut Vercel environment anahtar adları kaydedilir.
- Vercel değerleri okunmaz veya dışarı aktarılmaz.
- Partner API client'ın yalnız `Manage apps` yetkisi taşıdığı doğrulanır.
- Development store'un app ile aynı Partner organizasyonuna ait olduğu doğrulanır.
- Kanıt dosyasına token, session, cookie, authorization header, PII veya tam response header yazılamaz.

Başarısızlıkta hiçbir mutation yapılmaz.

## Aşama 1 — Null kabulü

Plan seçilmeden önce `activeSubscription` sorgulanır.

Beklenen:

- HTTP ve GraphQL başarılıdır.
- `data.activeSubscription === null`.
- AdsTable projection `subscription_required` olur.
- Erişim fail-closed kalır.
- Son doğrulanmış aktif projection hata cevabıyla overwrite edilmez.

API/GraphQL hata `null` sayılmaz ve aşama PASS olamaz.

## Aşama 2 — Intended public plan ve trial kabulü

1. Public plan `USD 24.99 / month`, `14-day trial`, welcome link `/` olarak kaydedilir.
2. Development store hosted plan selection sayfasından bu planı seçer.
3. Shopify yönlendirmesi tamamlanınca Partner API anında yeniden sorgulanır.

Beklenen:

- `activeSubscription` null değildir.
- `trialEndsAt` gelecektedir.
- `currentBillingCycle === null`.
- Subscription item handle kaydedilir; fiyat yalnız redacted business evidence olarak yazılır.
- AdsTable projection `trial` olur ve Reporting Store limiti 1 kalır.
- Candidate detection ve store switch charge üretmez.

Bu development store için trial tekrarına güvenilmez; Shopify 180 günlük trial kullanımını izler.

## Aşama 3 — Active kabulü

Trial kanıtı alındıktan sonra aynı development store, trial içermeyen Shopify `$0 private test plan`ına geçirilir. Bu plan gerçek merchant teklifi değildir ve ücret oluşturmaz.

Beklenen canlı sonuç:

- `trialEndsAt === null`.
- `currentBillingCycle.startTime` ve `endTime` doludur.
- Active item `price.active === true`.
- AdsTable projection `active` olur.
- Test contract effective recurring price'ı sıfır olabilir; ürünün public fiyatı yine USD 24.99'dur.

Shopify farklı bir response şekli döndürürse yorum yapılmaz; ham redacted response kaydedilir ve contract güncellemesi için durulur.

## Aşama 4 — Vercel Production aktivasyonu

| Anahtar | Vercel türü | Scope |
|---|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | Config | Production |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Secret | Production |
| `SHOPIFY_APP_GID` | Config | Production |

Kurallar:

- Exact Config değerleri contract'tan alınır.
- Token kullanıcı tarafından doğrudan Vercel Secret alanına girilir; chat, terminal argümanı, local env dosyası veya clipboard kanıtına yazılmaz.
- Preview ve Development production tokenı almaz.
- Env değişikliği sonrası yeni production deployment zorunludur.
- Deployment source SHA, env key metadata ve health sonucu kaydedilir; değerler kaydedilmez.

## Aşama 5 — Sızıntı ve persistence kabulü

- Browser bundle ve response'larda üç server-only değerin hiçbirinin bulunmadığı doğrulanır.
- Application ve platform loglarında token veya authorization header bulunmadığı doğrulanır.
- DB projection; shop GID, canonical domain ve install generation ile eşleşir.
- Stale snapshot reddedilir.
- Runtime direct table DML taşımaz; yalnız izinli functions kullanılır.
- `null`, `trial` ve `active` gerçek sıfır/unknown ile karıştırılmaz.

## Rollback

Herhangi bir aşama başarısızsa:

1. Entitlement fail-closed kalır; hata `subscription_required` veya `active` diye yorumlanmaz.
2. Yeni deployment production authority yapılmaz veya önceki güvenli deployment geri alınır.
3. Token şüphesi varsa Shopify Partner Dashboard'da rotate/revoke edilir.
4. Vercel Production Secret kaldırılır/değiştirilir ve yeni deployment alınır; eski deployment'ın env değişikliğinden etkilenmediği kabul edilir.
5. Public plan veya trial üzerinde ikinci deneme yapılmadan önce başarısızlığın nedeni kayda alınır.
6. EO-02-C `Verification` durumunda kalır; EO-02-D başlamaz.

## PASS koşulu

- Üç subscription durumu gerçek Partner API cevabıyla doğrulandı.
- Production Secret sınırı ve yeni deployment doğrulandı.
- Projection/fail-closed davranışı PASS.
- Secret/PII sızıntısı yok.
- Evidence JSON secret içermeden tamamlandı.
- PR ve zorunlu CI PASS.
- Ürün sahibi EO-02-C kapanışını açıkça kabul etti.
