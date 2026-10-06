# EO-02-B — Workspace, installation and generation authority

**Kontrol tarihi:** 6 Ekim 2026  
**Durum:** Database live accepted; PR CI and merge pending

## Analist sonucu

Bu paket Shopify mağazasını AdsTable tenant'ı yapmaz. Canonical tenant 'workspace_id'dir; Shopify Shop GID yalnız doğrulanmış installation adapter kimliğidir. Görünür mağaza domain'i yönlendirme ve doğrulama bağlamıdır, kalıcı sahiplik anahtarı değildir.

İlk doğrulanmış kurulum tek transaction içinde bir workspace ve generation 1 üretir. Aynı aktif kurulum tekrar açıldığında yeni workspace veya generation oluşmaz. Uninstall, 48 saatlik reinstall yarışı, terminal deletion ve yeni generation üretimi EO-02-D'nin lifecycle otoritesidir; EO-02-B bu durumları kendiliğinden reaktive etmez.

## Resmî kaynak kontrolü

6 Ekim 2026 tarihinde:

- Shopify embedded istek kimliği App Bridge ID token ile doğrulanır.
- ID token API çağrısı yetkisi taşımaz; backend bunu access token'a çevirir.
- Arka plan işleri offline token gerektirir; public app'lerde expiring offline token modeli kullanılmalıdır.
- Admin GraphQL 'shop' sorgusu access token'ın bağlı olduğu Shop kaynağını, 'id' ve 'myshopifyDomain' alanlarıyla doğrular.
- Stabil Admin API tabanı '2026-10'dur.
- Supabase/Postgres tarafında private schema, forced RLS, dar object grant, indexed foreign key ve kısa atomik transaction uygulanır.

Kaynaklar:

- https://shopify.dev/docs/api/usage/versioning
- https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/shop
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Authority akışı

1. Resmî Shopify adapter'ı ID token'ı doğrular.
2. Backend token exchange/authenticator üzerinden Admin API yetkisi alır.
3. 'shop { id myshopifyDomain }' server-side okunur.
4. ID token domain'i ile Admin shop domain'i aynı değilse hiçbir DB yazımı yapılmaz.
5. Shop GID başına transaction advisory lock alınır.
6. İlk kayıt atomik workspace + installation generation 1 üretir.
7. Aktif kayıt zaten varsa aynı workspace/generation döner.
8. Domain değişmişse Shop GID aynı kaldığı sürece ikinci workspace oluşturulmaz; domain history yazılır.
9. Uninstall/deletion durumunda EO-02-D kararı olmadan kayıt reaktive edilmez.

## Veri modeli

- 'app.workspaces': canonical tenant registry.
- 'shopify.installations': Shop GID, canonical domain, workspace bağı, generation ve lifecycle state.
- 'shopify.installation_domain_history': aynı Shop GID için doğrulanmış domain değişiklik izi.

Bütün tablolar private schema'dadır; RLS enabled + forced'dur. 'anon', 'authenticated', 'service_role' ve browser yolu kapalıdır. 'adstable_runtime' doğrudan tablo DML yetkisi almaz; yalnız iki dar server function'ı çağırabilir. DELETE yetkisi verilmez.

## State matrisi

| Durum | Sonuç |
|---|---|
| ID token eksik/geçersiz | Fail-closed, yazım yok |
| ID token domain'i ile Admin shop farklı | Fail-closed, yazım yok |
| İlk doğrulanmış kurulum | Workspace + generation 1 |
| Aktif kurulum tekrar çağrıldı | Aynı workspace + aynı generation |
| Eski doğrulama timestamp'i | Reject, yazım yok |
| Uninstall/deletion pending | EO-02-D olmadan reactivation yok |
| Deleted geçmişi mevcut | Yeni generation yalnız EO-02-D |

## Kapsam sınırı

Bu pakette görünür UI değişikliği yoktur. Raw HTML veya Polaris kararı üretilmez.

Token plaintext'i, sahte token kolonu veya geçici token deposu kurulmaz. Expiring offline token refresh/rotation ve encrypted envelope EO-03-B'de uygulanır. EO-02-D'den önce uninstall, deletion ya da clean-reinstall davranışı uygulanmış sayılmaz.

## Canlı kabul sonucu

- Migration history: 3/3 EO-02-B migration mevcut
- Authority tabloları: 3; RLS enabled + forced: 3/3
- Runtime direct table DML: 0
- Runtime function execute: 2/2
- Data API function execute: 0
- Self-cleaning bootstrap/idempotency/stale/domain-change probe: PASS
- Probe sonrası business row: 0
- Security Advisor: 0
- Performance Advisor: 0
- Evidence: 'docs/evidence/EO_02B_LIVE_ACCEPTANCE_2026-10-06.json'

## Kabul

- Migration, domain service ve contract aynı state matrisini uygular.
- Eşzamanlı ilk bootstrap tek live authority üretir.
- Caller tenant claim'i service arayüzünde yoktur.
- Shop GID kalıcı kimliktir; domain değişimi audit edilir.
- Runtime function-only erişim taşır; doğrudan table DML taşımaz.
- Test, build ve Governance CI PASS olur.
- Supabase canlı uygulaması açık kullanıcı onayıyla PASS oldu; merge ayrı açık kullanıcı onayı olmadan yapılmaz.
