# EO-02-C corrective gate — Shopify runtime authentication bridge

**Kontrol tarihi:** 8 Ekim 2026  
**Durum:** Karar donduruldu; implementation başlamadan önce executable contract bağlayıcıdır  
**Paket:** A6-EO-02-C içinde corrective gate; yeni parent veya paralel hat değildir

## Analist sonucu

EO-02-C runtime persistence adapterı ve internal reconciliation callerı kod seviyesinde hazırdır, fakat Production uygulamasında callerı çalıştıracak doğrulanmış Shopify server boundary bulunmamaktadır. Mevcut üç ürün URL'i yalnız preview route'udur; `shopify.server.ts`, `authenticate.admin(request)` kullanan pathless Admin layout, kalıcı session storage ve gerekli Production environment sözleşmesi yoktur.

Bu nedenle yalnız `ADSTABLE_RUNTIME_DATABASE_URL` ekleyip deploy etmek canlı persistence kanıtı üretemez. Database Secret aktivasyonu, bu corrective gate PASS olmadan yasaktır.

## Resmî kaynak kontrolü

8 Ekim 2026 tarihinde aşağıdaki güncel Shopify kaynakları kontrol edildi:

- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
- https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
- https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts
- https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app.tsx

Shopify'ın resmî React Router sözleşmesine göre embedded ürün route'ları authenticated Admin layout altında yaşar, her Admin isteği `authenticate.admin(request)` ile doğrulanır, framework kalıcı session storage kullanır ve public app expiring offline access token modelini etkinleştirir.

## Düzeltme kapsamı

1. URL'leri değiştirmeyen pathless authenticated Admin layout.
2. Resmî `@shopify/shopify-app-react-router` `shopifyApp` ve `authenticate.admin` sınırı.
3. Supabase private schema üzerinde ciphertext-only Shopify session envelope.
4. `adstable_runtime` için function-only session repository; doğrudan table DML yok.
5. Node `crypto` AES-256-GCM; anahtar yalnız Vercel Production Secret'ta, versioned ve repository/log/browser dışında.
6. Expiring offline access tokens.
7. Doğrulanmış ID token domain'i ile Admin GraphQL `shop { id myshopifyDomain }` kimliğinin eşleştirilmesi.
8. Doğrulanmış uygulama girişinde EO-02-C reconciliation callerının idempotent çalıştırılması.
9. Gerçek Shopify Admin session, Supabase persistence, browser/response/log secret taraması ve explicit ürün sahibi kabulü.

## UI analist brief'i

- Kullanıcı amacı: Merchant AdsTable'ı Shopify Admin içinde mevcut üç URL ve mevcut preview görünümüyle açar; authentication arka planda gerçekleşir.
- Başlangıç: Uygulama Shopify Admin içinden açılır ve App Bridge ID token üretir.
- Başarı: İstek doğrulanır, mevcut Funnel/Ad Analysis/Settings preview yüzeyi değişmeden render edilir ve server-only entitlement reconciliation çalışır.
- Error: Authentication veya persistence başarısızlığında korunan veri render edilmez; fail-closed error boundary kullanılır.
- Değişmeyecek UI: Görünen metinler, route URL'leri, Polaris 2.0 RC baseline ve mevcut preview content.
- Kapsam dışı: Settings ürün davranışı, provider OAuth/Reporting Account seçimi, yeni grafik veya yeni görsel component.

### Exact Shopify component mapping

| Görünür öğe | Exact component | Karar |
|---|---|---|
| Embedded provider | `AppProvider` from `@shopify/shopify-app-react-router/react` | Resmî App Bridge/React Router boundary |
| Sayfa/section/text/link | Mevcut `s-page`, `s-section`, `s-paragraph`, `s-link` | Görünüm ve metin değişmez |
| Auth error | Framework `boundary.error` ve `boundary.headers` | Özel modal/button/error taklidi yok |
| Navigation | Mevcut üç URL | URL ve bilgi mimarisi değişmez |

Raw HTML action/form, özel CSS, literal renk, özel component ve public test endpoint'i eklenmez.

## Runtime environment sözleşmesi

| Anahtar | Tür | Scope |
|---|---|---|
| `SHOPIFY_API_KEY` | Config | Production |
| `SHOPIFY_API_SECRET` | Secret | Production |
| `SHOPIFY_APP_URL` | Config | Production |
| `SCOPES` | Config | Production |
| `ADSTABLE_SESSION_ENCRYPTION_KEY_V1` | Secret | Production |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Secret | Production |

Preview ve Development Production credential'larını alamaz. Secret değeri chat, repository, terminal argümanı, kanıt veya loga yazılmaz. Environment değişikliği yeni Production deployment olmadan etkin sayılmaz.

## Kabul kapıları

- Contract/negative tests PASS.
- Migration canlı Supabase'e ayrı açık kullanıcı onayıyla uygulanır.
- Session tablosunda plaintext token, refresh token, secret veya JSON bulunmaz.
- Runtime direct table DML sıfır; yalnız izinli session ve entitlement functions çalışır.
- `/`, `/ad-analysis`, `/settings` URL'leri korunur.
- Unauthenticated/direct request fail-closed olur.
- Gerçek Shopify Admin desktop ve en az 320 px mobil kabulü PASS olur.
- Gerçek authenticated request workspace/install/subscription/entitlement projection'ını üretir.
- Secret/browser/HTTP/application/platform log taraması PASS olur.
- PR ve zorunlu CI PASS olur.
- EO-02-C yalnız explicit ürün sahibi kapanış kararıyla Accepted olur.

## Rollback

Yeni deployment production authority yapılmadan önce CI ve preview doğrulanır. Canlı hata halinde deployment geri alınır; yeni session/database secret kaldırılır veya rotate edilir; encrypted session rows ilgili güvenli migration rollback/retention kararına göre ele alınır. Eski public preview deployment güvenli geri dönüş noktasıdır.
