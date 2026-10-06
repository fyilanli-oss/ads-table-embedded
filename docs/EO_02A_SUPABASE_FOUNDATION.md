# EO-02-A — Supabase private schema, role ve migration foundation

**Kontrol tarihi:** 6 Ekim 2026  
**Durum:** Accepted  
**Hedef:** `podpwkrpmjiksskxhwsu` / Frankfurt (`eu-central-1`)

## Analist sonucu

Yeni embedded ürün için eski `adstable-dev` projesinden fiziksel olarak ayrılmış, boş PostgreSQL 17.11 data-plane oluşturuldu. Bu paket business tablo veya veri kurmaz; yalnız ilerideki EO-02–EO-06 tablolarının güvenli biçimde kurulacağı private schema, rol ve migration sınırını oluşturur.

## Resmî Supabase kontrolü

6 Ekim 2026 tarihinde aşağıdaki güncel resmî kaynaklar kontrol edildi:

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

Supabase erişimi iki ayrı kapıyla yönetir: nesne yetkileri hangi role erişim verildiğini, RLS ise erişilebilen satırları belirler. Private schema kullanımı tek başına yeterli kabul edilmez; gelecekte oluşturulacak her tenant tablosunda RLS etkin ve forced olacaktır.

## Başlangıç kanıtı

- Project: `ads-table-embedded`
- Project ref: `podpwkrpmjiksskxhwsu`
- Organization: `fyilanli-oss's Org`
- Bölge: Frankfurt
- Maliyet: aylık 0 USD
- PostgreSQL: 17.11 GA
- Uygulama tablosu: 0
- Migration: 0
- Security advisor bulgusu: 0
- Performance advisor bulgusu: 0
- Eski `adstable-dev` mutation: 0

## Kurulacak sınır

Private schema'lar:

- `app`
- `shopify`
- `integrations`
- `analytics`
- `operations`
- `privacy`
- `billing`

Roller:

- `adstable_owner`: Nesnelerin parolasız owner rolü.
- `adstable_migrator`: Migration için LOGIN yetenekli fakat bu aşamada parolası NULL ve bağlantısı etkisiz rol.
- `adstable_runtime`: Uygulama runtime'ı için LOGIN yetenekli fakat bu aşamada parolası NULL ve nesne yetkisi olmayan rol.

Runtime credential'ı bu pakette oluşturulmaz veya Vercel'e verilmez. Credential etkinleştirme, server runtime bağlantı paketi içinde ayrı secret-delivery kapısıyla yapılacaktır.

## Kapsam dışı

- Business tabloları ve RLS policy'leri
- Workspace/install/billing/privacy satırları
- Canlı veri ve sealed token taşıması
- Dataset V2 ve FX rebuild
- Vercel environment credential'ları
- Production cutover
- Legacy Supabase değişikliği

## Uygulama notu

İlk üç uygulama denemesi Supabase'in yönetilen rol sınırlarında transaction içinde reddedildi ve migration history, rol veya şema bırakmadan geri döndü. Kabul edilen zincir iki immutable migration'dan oluşur:

1. `20261006133830 — eo02a_private_schema_roles`
2. `20261006134013 — eo02a_runtime_schema_usage`

İkinci migration, runtime schema `USAGE` yetkisini nesne sahibi bağlamında açıkça verir. Runtime'a `CREATE`, tablo veya DDL yetkisi vermez.

## Canlı kabul sonucu

- Private schema: 7/7, owner `adstable_owner`
- `anon` / `authenticated` / `service_role` private schema usage: 0
- `adstable_runtime` schema usage: 7/7
- `adstable_runtime` schema create: 0
- Runtime table privilege: 0
- Business table: 0
- Üç özel rolde unsafe attribute: 0
- Login rollerinde password: NULL
- Security advisor bulgusu: 0
- Performance advisor bulgusu: 0
- Legacy project mutation: 0
- Repository Governance CI: PASS (runs `37473375975`, `37473569772`)
- Merge: PR #4 / `2ac00f969eb35ac632ead57017753ed495e7b66f`

## Kabul

1. Migration Supabase migration history'de görünür.
2. Yedi private schema'nın owner'ı `adstable_owner` olur.
3. Üç özel rolün tehlikeli attribute sayısı sıfırdır.
4. `anon`, `authenticated` ve `service_role` private schema kullanamaz.
5. Runtime rolü hiçbir tabloya erişemez ve DDL yetkisi taşımaz.
6. Security ve performance advisor sonuçları yeniden temizdir.
7. Repository test/build/CI PASS olur.
8. Merge yalnız açık kullanıcı onayıyla yapılır.

## Kapanış

EO-02-A açık ürün sahibi onayıyla merge edildi. Merge sonrası Supabase katalog ve advisor kontrolleri tekrar PASS oldu. Sıradaki tek child **EO-02-B — Workspace, installation and generation authority**; ayrı başlangıç brief'i olmadan başlanmaz.
