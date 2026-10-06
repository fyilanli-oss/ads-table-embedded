# EO-02-C — Shopify App Pricing trial, subscription and entitlement

**Kontrol tarihi:** 6 Ekim 2026  
**Durum:** Implementation ready; database and live Partner API acceptance pending

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
- `billing.workspace_entitlements`: `trial | active | subscription_required` erişim kararı ve Reporting Store hakkı.
- `billing.trial_ledger`: Shopify-owned trial snapshotlarının immutable, idempotent gözlem izi.

Üç tablo private schema'dadır, RLS enabled + forced'dur. Browser/Data API rolleri ve `service_role` erişemez. `adstable_runtime` doğrudan table DML taşımaz; yalnız snapshot apply ve fresh entitlement resolve function'larını çağırabilir.

## Reporting Store fiyat sınırı

İlk entitlement aynı anda bir aktif Reporting Store içerir.

- Yeni aday mağaza tespiti ek ücret değildir.
- Aktif Reporting Store değişimi ek ücret değildir.
- Geçmiş mağaza verisinin korunması ek ücret değildir.
- Aynı anda birden fazla aktif mağazayı yenileme ve karşılaştırma ilk review diliminin dışındaki gelecekteki ayrı entitlement'tır.

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
- Partner API client/token oluşturma
- Vercel secret aktivasyonu
- Settings billing UI
- Uninstall, privacy deletion ve clean reinstall
- Provider OAuth veya Reporting Store seçimi

Bu dış kapsam maddeleri uygulanmış sayılmaz. Plan/secret aktivasyonu ve canlı Partner API acceptance ayrıca açık insan kapısıdır.

## Kabul

- Contract, server resolver ve migration aynı authority/state matrisini uygular.
- Manual Billing API yeni subscription yolu olarak kullanılamaz.
- Partner API hatası entitlement'a dönüşmez.
- Trial local olarak yeniden başlatılamaz.
- Bir aktif Reporting Store hakkı DB constraint ile sabittir.
- Candidate detection ve store switch billing event değildir.
- Repository test/build/CI PASS olmalıdır.
- Supabase migration, self-cleaning behavioral probe ve advisor sonuçları ayrıca canlı doğrulanmalıdır.
