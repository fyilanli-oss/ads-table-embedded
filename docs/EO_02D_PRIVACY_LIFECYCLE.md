# EO-02-D — Privacy, uninstall, deletion and clean reinstall

**Kontrol tarihi:** 8 Ekim 2026  
**Durum:** Verification; live database migration PASS, runtime HTTP ve Shopify subscription acceptance bekliyor

## Analist sonucu

EO-02-D, doğrulanmış Shopify webhook teslimatını kalıcı claim'e dönüştürür; uninstall ile fiziksel silmeyi birbirinden ayırır ve bütün silme işlemlerini tek workspace + installation generation sınırına kilitler.

app/uninstalled erişimi durdurur, runtime session'larını siler ve workspace'i askıya alır. Fiziksel silme yapmaz. Shopify resmî sözleşmesine göre shop/redact uninstall'dan en erken 48 saat sonra gelir ve uygulama bu arada yeniden kurulmuşsa gönderilmez. Bu nedenle 48 saat içindeki doğrulanmış reinstall aynı generation'ı reaktive eder. Redaction claim'i geldikten sonra installation deletion_pending olur ve yeni bootstrap silme tamamlanana kadar fail-closed kalır.

Tamamlanan silmeden sonraki reinstall yeni workspace ve önceki manifest generation'ının bir fazlasını üretir. Eski run yalnız eski workspace + generation üzerinde çalışabildiğinden yeni installation'ı silemez.

## Resmî kaynak kontrolü

8 Ekim 2026 tarihinde:

- Public App Store uygulamaları customers/data_request, customers/redact ve shop/redact compliance topic'lerini uygulamak zorundadır.
- HTTPS teslimatında HMAC, app client secret ve ham request body üzerinden doğrulanır.
- Geçersiz compliance HMAC isteği 401 Unauthorized alır.
- X-Shopify-Webhook-Id duplicate teslimat idempotency anahtarıdır.
- Webhook sıralaması garanti edilmez.
- HTTPS teslimatı beş saniye içinde yanıtlanmalıdır; ağır işler dayanıklı claim sonrasında ayrı çalışır.
- Compliance eylemi talebin alınmasından itibaren 30 gün içinde tamamlanır.
- shop/redact uninstall'dan en erken 48 saat sonra gönderilir ve uygulama yeniden kurulmuşsa gönderilmez.
- Uninstall tokenları geçersiz kılar; uninstall/compliance ingress'i shop access token'a bağımlı değildir.
- Supabase private schema, forced RLS ve function-only runtime sınırı korunur.

Kaynaklar:

- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- https://shopify.dev/docs/apps/build/webhooks/troubleshoot
- https://shopify.dev/docs/api/webhooks/2026-07
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/docs/guides/database/postgres/row-level-security

## HMAC ingress

Endpoint: POST /webhooks/shopify

1. Method, JSON content type ve gerekli Shopify header'ları doğrulanır.
2. Raw body, SHOPIFY_API_SECRET ile HMAC-SHA256 doğrulamasından geçer.
3. HMAC geçmeden JSON parse edilmez ve database çağrısı yapılmaz.
4. Yalnız dört izinli topic kabul edilir.
5. Raw body ve customer email/phone saklanmaz; yalnız SHA-256 içerik kanıtı tutulur.
6. Aynı X-Shopify-Webhook-Id tekrar geldiğinde yeni lifecycle sonucu üretilmez.
7. Claim kalıcı olduktan sonra endpoint 202 döndürür. Executor aynı request içinde çalıştırılmaz.

## Veri modeli

- privacy.webhook_claims: Doğrulanmış delivery ID, event ID, topic, workspace/generation, pseudonymous shop fingerprint, payload hash, API version ve zaman kanıtı. Raw payload, shop domain, email ve telefon taşımaz.
- privacy.deletion_runs: Her iş tek workspace, generation ve fingerprint'e bağlıdır. Durumlar pending, running, completed, failed ve superseded'dir.
- privacy.deletion_manifests: Silinen/korunan veri aileleri ile satır sayılarını taşır; silinen kişisel veriyi yeniden saklamaz.

Bütün tablolar private privacy schema'sındadır; RLS enabled + forced'dur. Browser, anon, authenticated, service_role ve runtime doğrudan table DML alamaz.

## Lifecycle state matrisi

| Olay | Mevcut state | Sonuç |
|---|---|---|
| İlk doğrulanmış install | kayıt yok | Yeni workspace, generation 1 |
| Aktif app tekrar açıldı | active | Aynı workspace/generation |
| app/uninstalled | active | uninstall_pending_redaction, workspace suspended, sessions deleted |
| Reinstall | uninstall_pending_redaction | Aynı generation reactivated |
| shop/redact | uninstall_pending_redaction | Generation-locked deletion run queued |
| shop/redact | active | ignored_reinstalled, silme yok |
| Bootstrap | deletion_pending | Fail-closed |
| Executor tamamlandı | deletion_pending | Installation/billing/session/domain history deleted; workspace archived |
| Reinstall | terminal deletion tamamlandı | Yeni workspace, generation N+1 |
| Eski executor | replacement generation var | superseded; yeni veriye dokunamaz |

## Delete my data

Merchant isteği yalnız server-verified Admin shop identity ve exact install generation ile açılır. İstek installation'ı deletion_pending yapar, session'ları kaldırır ve aynı executor'a girer. Shopify subscription authority Shopify'da kalır; bu işlem subscription iptali değildir. Görünür Settings eylemi ve açık kullanıcı metni EO-07-A'da bağlanacaktır.

## Customer privacy request sınırı

Bugünkü clean foundation customer-level veri saklamaz. Bu nedenle customers/data_request ve customers/redact run'ı no_customer_data manifestiyle kapanır. EO-03/04/05'te eklenecek her yeni veri ailesi, kullanılmadan önce deletion registry ve EO-02-D regression acceptance kapsamına eklenmek zorundadır. Eksik kayıt sessiz başarı sayılamaz.

## Canlı uygulama kapısı

8 Ekim 2026'da ayrı açık kullanıcı onayıyla canlı Supabase migration uygulandı. `docs/evidence/EO_02D_DATABASE_ACCEPTANCE_2026-10-08.json` şu kapıları kanıtlar:

1. Repository test, typecheck, build ve Governance CI PASS.
2. Migration SQL review ve canlı migration PASS.
3. Üç privacy tablosunda RLS enabled + forced, doğrudan rol erişimleri kapalı ve Security Advisor sıfır bulgu PASS.
4. Migration öncesi/sonrası mevcut workspace ve installation sayıları aynı; production verisi silinmedi, sentetik satır bırakılmadı.
5. Supabase yönetim bağlantısının `adstable_runtime` rolünü taklit edememesi beklenen least-privilege sınırıdır; aynı yol yeniden zorlanmayacaktır.

Kalan kapılar:

1. PR #27 için ayrı açık merge onayı.
2. Merge sonrası production application deploy.
3. Deployed runtime üzerinden invalid HMAC 401 ve valid claim 202 kabulü.
4. Exact Shopify app configuration link/read, app-specific webhook subscription deploy ve test delivery.
5. Sentetik lifecycle acceptance: uninstall, duplicate, reinstall, redaction, executor replay, N+1 reinstall ve stale executor containment.
6. Gerçek merchant verisi silmeden ürün sahibi kapanış kabulü.

## Rollback

Migration additive'dir ve eski üç-parametreli bootstrap overload'unu ilk rollout sırasında korur. Canlı rollout DB-first, application-second ilerler. Endpoint subscription etkinleştirilmeden önce runtime ve migration birlikte doğrulanır. İlk acceptance yalnız sentetik kayıtlarla yapılır.
