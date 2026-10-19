# EO-02-A — Supabase özel şema, rol ve migration temeli

**Kontrol tarihi:** 6 Ekim 2026

**Durum:** Kabul edildi

**Hedef:** `podpwkrpmjiksskxhwsu` / Frankfurt (`eu-central-1`)

## Analist sonucu

Yeni embedded ürün için eski `adstable-dev` projesinden fiziksel olarak ayrılmış, boş PostgreSQL 17.11 veri katmanı oluşturuldu. Bu paket iş verisi tablosu veya veri kurmaz; yalnız ilerideki EO-02–EO-06 tablolarının güvenle kurulacağı özel şema, rol ve veritabanı değişiklik kaydı (migration) sınırını oluşturur.

Bu belge 6 Ekim 2026'daki EO-02-A kapsamını anlatır. Sıfır tablo/migration ve aylık maliyet gibi başlangıç değerleri bugünkü proje envanteri veya fiyat bilgisi değildir. Güncel durum için Execution Plan geçerlidir.

## Tarihsel resmî Supabase kontrolü

6 Ekim 2026 tarihinde aşağıdaki resmî kaynaklar kontrol edildi:

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

Erişim iki ayrı kapıyla yönetilir: nesne yetkileri hangi rolün nesneye erişebileceğini; satır düzeyi güvenlik (RLS) hangi satırlara erişilebileceğini belirler. Özel şema tek başına yeterli değildir. Gelecekte oluşturulacak her kiracı tablosunda RLS etkinleştirilecek ve zorunlu uygulanacaktır.

## Başlangıç kanıtı

- Proje: `ads-table-embedded`
- Proje kimliği: `podpwkrpmjiksskxhwsu`
- Organizasyon: `fyilanli-oss's Org`
- Bölge: Frankfurt
- O tarihteki maliyet: aylık 0 USD
- PostgreSQL: 17.11 GA
- Uygulama tablosu: 0
- Migration: 0
- Security Advisor bulgusu: 0
- Performance Advisor bulgusu: 0
- Eski `adstable-dev` projesinde değişiklik: 0

## Kurulacak sınır

Özel şemalar:

- `app`
- `shopify`
- `integrations`
- `analytics`
- `operations`
- `privacy`
- `billing`

Roller:

- `adstable_owner`: Nesnelerin parolasız sahip rolü.
- `adstable_migrator`: Migration için giriş yapabilen (LOGIN), fakat bu aşamada parolası NULL ve bağlantısı etkisiz rol.
- `adstable_runtime`: Uygulamanın çalışma zamanı için giriş yapabilen (LOGIN), fakat bu aşamada parolası NULL ve nesne yetkisi olmayan rol.

Çalışma zamanı erişim bilgisi bu pakette oluşturulmaz veya Vercel'e verilmez. Etkinleştirme, sunucu bağlantısı paketindeki ayrı gizli bilgi teslim kapısıyla yapılacaktır.

## Kapsam dışı

- İş verisi tabloları ve RLS kuralları
- Çalışma alanı, kurulum, faturalandırma ve gizlilik satırları
- Canlı veri ve şifreli token taşıması
- Dataset V2 ve FX'in yeniden oluşturulması
- Vercel ortam değişkenlerindeki erişim bilgileri
- Eski yapıdan yeni yapıya nihai canlı geçiş (Production cutover)
- Eski Supabase projesinde değişiklik

## Uygulama notu

İlk üç uygulama denemesi Supabase'in yönetilen rol sınırlarında veritabanı işlemi içinde reddedildi; migration geçmişi, rol veya şema bırakmadan geri alındı. Bu tarihsel olay yeni deneme izni değildir. Kabul edilen zincir iki değişmez migration'dan oluşur:

1. `20261006133830 — eo02a_private_schema_roles`
2. `20261006134013 — eo02a_runtime_schema_usage`

İkinci migration, çalışma zamanının şema `USAGE` yetkisini nesne sahibi bağlamında açıkça verir. Çalışma zamanına `CREATE`, tablo veya DDL yetkisi vermez.

## Canlı kabul sonucu

- Özel şema: 7/7; sahip `adstable_owner`
- `anon` / `authenticated` / `service_role` özel şema kullanım yetkisi: 0
- `adstable_runtime` şema kullanım yetkisi: 7/7
- `adstable_runtime` şema oluşturma yetkisi: 0
- Çalışma zamanının tablo yetkisi: 0
- İş verisi tablosu: 0
- Üç özel rolde güvensiz rol özelliği: 0
- Giriş yapabilen rollerin parolası: NULL
- Security Advisor bulgusu: 0
- Performance Advisor bulgusu: 0
- Eski projede değişiklik: 0
- Repository Governance CI: PASS (koşular `37473375975`, `37473569772`)
- Merge: PR #4 / `2ac00f969eb35ac632ead57017753ed495e7b66f`

## Kabul

1. Migration, Supabase migration geçmişinde görünür.
2. Yedi özel şemanın sahibi `adstable_owner` olur.
3. Üç özel rolün tehlikeli özellik sayısı sıfırdır.
4. `anon`, `authenticated` ve `service_role` özel şemaları kullanamaz.
5. Çalışma zamanı rolü hiçbir tabloya erişemez ve DDL yetkisi taşımaz.
6. Security Advisor ve Performance Advisor sonuçları yeniden temizdir.
7. Repository testleri, derleme ve CI geçer.
8. Merge yalnız açık kullanıcı onayıyla yapılır.

## Kapanış

EO-02-A açık ürün sahibi onayıyla merge edildi. Merge sonrası Supabase katalog ve Advisor kontrolleri tekrar geçti. O tarihteki tek sonraki alt paket **EO-02-B — Çalışma alanı, kurulum ve kurulum nesli yetkisi** idi; ayrı başlangıç açıklaması olmadan başlanmaz.
