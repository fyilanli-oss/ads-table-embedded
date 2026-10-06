# A6 EO-F4 — Schema, data carry ve Supabase data-plane kararı

**Tarih:** 4 Ekim 2026  
**Durum:** EO-F4 tamamlandı; EO-F5 bekleniyor  
**Etkisi:** Salt-okunur karar ve taşıma sözleşmesi. Yeni Supabase project oluşturmaz, canlı şema/veri/credential değiştirmez.

## Analist sonucu

Hedef embedded-only ürün için **ayrı Supabase project** seçilmiştir.

Bu kararın nedeni mevcut verinin büyüklüğü değil, authority izolasyonudur. Mevcut project 55 migration boyunca standalone kullanıcı, V1 analytics, legacy provider/token, geçici yük testi ve embedded canonical yapıları aynı fiziksel sınırda biriktirmiştir. Aynı project içinde özel rol teknik olarak mümkün olsa da yanlış grant, eski function veya yeni bir import üzerinden legacy authority'ye dönme riski kalır.

Yeni project temiz migration history, private schema'lar, dar yetkili runtime rolü ve sıfır legacy nesneyle başlayacaktır. Mevcut project cutover sonrasındaki consumer-zero ve rollback kapıları tamamlanana kadar silinmez veya daraltılmaz.

## Resmî Supabase kontrolü

4 Ekim 2026 tarihli resmî kaynak kontrolü:

- `service_role` Data API üzerinden RLS'yi bypass eder; yeni runtime'a verilemez.
- Trusted server doğrudan Postgres connection kullanabilir.
- Vercel gibi serverless runtime için Supavisor transaction mode uygundur; prepared statements kapalı olmalıdır.
- Exposed schema'lardaki tablolar için RLS zorunludur.
- Yeni Postgres 17.11 / 15.19 breaking change'i `ltree`, legacy pgcrypto cipher, `btree_gist` float/NaN ve custom operator yeniden oluşturma alanlarını etkiler. Hedef clean schema bunların hiçbirine bağımlı olmayacaktır.
- OrioleDB 4 Ekim 2026 itibarıyla Public Beta, SLA'sız ve bazı restore kabiliyetleri eksiktir; hedef production project için seçilmez.

Kaynaklar:

- https://supabase.com/changelog
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/secure-data
- https://supabase.com/docs/guides/database/connecting-to-postgres

## Canlı kaynak envanteri

Salt-okunur live inspection sonucu:

| Kaynak | Satır | Boyut | Karar |
|---|---:|---:|---|
| `workspaces` | 1 | 32 KB | Exact identity carry |
| `workspace_settings` | 1 | 32 KB | Exact business setting carry |
| `shopify_installations` | 1 | 80 KB | Exact identity + sealed token carry |
| `workspace_provider_connections` | 3 | 152 KB | Exact grant/account/binding + sealed token carry |
| `workspace_provider_email_spend_history` | 4 | 48 KB | Exact immutable-history carry |
| `performance_dataset_rows_v2` | 5 | 128 KB | Canonical copy yok; quarantine evidence + provider re-fetch |
| `fx_rates_daily` | 10,478 | 7.73 MB | Bulk copy yok; required-pair rebuild/reconciliation |

Dataset satırları:

- Klaviyo: 4 satır; 2 `real`, 2 `partial`
- Meta: 1 satır; `partial`
- Google Ads: 0 satır
- workspace null: 0
- `user_id` non-null: 0
- synthetic: 0
- raw evidence bulunan satır: 5

Token posture:

- Shopify: 1 access + 1 refresh envelope; access süresi geçmiş, refresh süresi geçmemiş
- Google Ads: 1 access + 1 refresh; access süresi geçmiş
- Klaviyo: 1 access + 1 refresh; access süresi geçmiş
- Meta: 1 access; süre geçmemiş
- Envelope version ve key-id şekilleri tutarlı; secret/ciphertext okunmadı.

## Neden mevcut şema aynen taşınmıyor?

### Dataset V2

Canlı tablo workspace-first write kullanıyor; ancak DDL hâlâ:

- nullable legacy `user_id` ve `users(id)` foreign key;
- GA4 alanı ve organic kaynak kuralı;
- TikTok platform/hierarchy izinleri;
- legacy `source_job_id`;
- maturity/finality/reconciliation için durable authority eksikliği

taşıyor. Bu tabloyu aynen kopyalamak EO-F3 denylist'ini yeni DB'ye gömmek olur.

### Runtime grants

Canonical tabloların çoğu RLS-enabled/forced olsa da policy yoktur ve `service_role` CRUD yetkisiyle kullanılır. Dataset V2 ve FX tablolarında forced RLS yoktur. Bu mevcut backend posture'ının kaydıdır; hedef authorization modeli değildir.

### Stored functions

Canlı Klaviyo maliyet function'larının üçü `SECURITY DEFINER`, yalnız `postgres` ve `service_role` execute ACL taşır. Shopify install function'ı invoker'dır fakat public schema'dadır. Hedefte bu function'lar kopyalanmaz; clean transaction/service sınırıyla yeniden yazılır ve ihtiyaç yoksa function yerine server transaction kullanılır.

## Seçenek karşılaştırması

Puan 1 zayıf, 5 güçlüdür.

| Kriter | Aynı project + özel rol/private schema | Ayrı Supabase project |
|---|---:|---:|
| Legacy privilege izolasyonu | 3 | 5 |
| Temiz migration history | 2 | 5 |
| Yanlış tablo/function import riskini önleme | 3 | 5 |
| Token ve installation continuity kolaylığı | 5 | 3 |
| Veri taşıma kolaylığı | 5 | 4 |
| Bağımsız rollback | 3 | 5 |
| Backup/failure-domain ayrımı | 2 | 5 |
| Başlangıç operasyon maliyeti | 4 | 3 |
| **Toplam** | **27/40** | **35/40** |

Canlı canonical veri yalnız 14 business row ve 10,478 yeniden üretilebilir FX satırıdır. Bu nedenle ayrı project'in isolation kazanımı taşıma maliyetinden büyüktür.

## Hedef data-plane

### Project tipi

- Standard Supabase Postgres; OrioleDB yok
- Ayrı project, ayrı database password ve ayrı backup/restore sınırı
- Yeni Vercel project yalnız bu data-plane credential'ını alır
- Eski project credential'ı yeni runtime'a verilmez

### Schema sınırı

Hedef tablolar Data API'nin exposed schema'sında bulunmaz. Schema grupları:

| Schema | Authority |
|---|---|
| `app` | workspace ve merchant-selected settings |
| `shopify` | installation, install generation, billing/entitlement bağı |
| `integrations` | provider connection, OAuth transaction ve encrypted token metadata |
| `analytics` | canonical performance rows, Klaviyo cost history, FX |
| `operations` | refresh run, lease, checkpoint, reconciliation/finality |
| `privacy` | webhook claim, deletion run, manifest ve evidence |
| `billing` | Shopify subscription, 14 günlük trial ve workspace entitlement |

Bunlar EO-01/EO-02 migration'larında oluşturulur. `public` runtime business table içermez.

### Runtime bağlantısı

- Vercel server runtime → Supavisor transaction mode, SSL
- Prepared statements kapalı
- Dedicated `adstable_runtime` login role
- Schema-level `USAGE` ve table/function bazında allowlist
- `NOINHERIT`, `NOBYPASSRLS`, superuser/createdb/createrole/replication yok
- DDL, truncate, owner değişimi ve legacy schema access yok
- Migration için runtime'dan ayrı owner credential
- Browser'a DB credential/client verilmez
- `service_role`, publishable/anon key ve Data API runtime yolunda kullanılmaz
- RLS private schema'da defense-in-depth olarak açık ve forced olur

Runtime rolü tek başına tenant belirleyemez. Her transaction server-verified Shopify session'dan türetilmiş `workspace_id` ile çalışır; repository katmanı caller-supplied workspace kabul etmez.

## Exact carry map

### A — Exact identity/state carry

Aşağıdaki logical kayıtlar primary key ve tarihçeleri korunarak taşınır:

1. `workspaces` → `app.workspaces`
2. `workspace_settings` → `app.workspace_settings`
3. `shopify_installations` → `shopify.installations`
4. `workspace_provider_connections` → `integrations.provider_connections`
5. `workspace_provider_email_spend_history` → `analytics.email_spend_history`

Taşıma sırasında kolon adları hedef contract'a göre değişebilir; business identity ve accepted values değişemez. Her kaynak satırı canonical JSON hash manifestiyle sayılır. Secret alanları hash manifestine veya loglara girmez.

### B — Sealed token carry

Token plaintext export edilmez.

1. Workspace UUID, shop ID, provider ve token type AAD context'leri korunur.
2. Envelope'lar encrypted JSON olarak restricted migration channel üzerinden taşınır.
3. Yeni preview runtime'ın server-only keyring'i geçici olarak eski decrypt key + yeni active key içerir.
4. Decrypt canary yalnız success/failure ve envelope identity hash'i üretir; token değeri loglanmaz.
5. Başarılı envelope yeni active key ile yeniden şifrelenir.
6. Yeni DB'de eski key-id kullanan envelope sayısı sıfır doğrulanır.
7. Eski key yeni runtime'dan kaldırılır; eski production rollback keyring'i kendi ortamında korunur.
8. Provider/Shopify doğrulaması başarısızsa satır `reauthorization_required` olur; sahte connected durumu üretilmez.

Mevcut access sürelerinin bazıları geçmiş olduğundan continuity kabulü yalnız decrypt değildir: refresh veya resmi token renewal + read-only identity probe da PASS olmalıdır.

### C — Canonical copy yapılmayan Dataset

Beş Dataset V2 satırı yeni `analytics.performance_rows` tablosuna kopyalanmaz.

- Salt-okunur source manifestinde row count, business date, provider, entity key hash, metric-support hash, raw hash ve adapter/contract version tutulur.
- Ham satırlar restricted migration quarantine/evidence olarak korunur; production query authority değildir.
- Yeni adapterlar, onaylı bootstrap politikası olan **yesterday + today** aralığını providerlardan yeniden çeker.
- Sonraki rolling reconciliation/finality penceresi EO-05'te çalışır.
- Re-fetch sonucu source manifest ve provider ham kanıtıyla karşılaştırılır.
- Uyuşmazlık gizlenmez; provider/date/entity bazında reconciliation kaydı açılır.
- Google Ads için sıfır kaynak satır “başarılı taşıma” sayılmaz; canlı adapter read acceptance gerekir.

### D — FX rebuild

`fx_rates_daily` bulk-copy edilmez.

- Hedef yalnız gerçekten gereken currency pair/date'leri tutar.
- Rate'ler onaylı providerdan yeniden alınır.
- Eski rate ile yeni rate aynı provider/version/date için farklıysa cutover durur.
- Providerdan yeniden alınamayan, canonical satırın hesaplanması için zorunlu tarihsel rate ancak source hash/provenance ile exact carry edilebilir.
- `raw` payload zorunlu runtime kolon değildir; restricted evidence store veya content hash tercih edilir.

### E — Satırı taşınmayacak tablolar

- `oauth_transactions`: 12/12 expired; sıfır satır, temiz TTL store
- `users`, `user_settings`, `subscriptions`
- `platform_connections`, `platform_connection_tokens`
- `shopify_workspace_provider_connections`
- `legacy_user_workspace_bindings`
- `dashboard_snapshots`, `performance_dataset_rows`
- `snapshot_jobs`, `snapshot_schedules`
- diğer inactive provider/account inventory ve test tabloları

## Hedef minimum schema sözleşmesi

EO-F4 logical minimumu aşağıdadır; exact DDL EO-01/EO-02 migration'ında machine-tested olacaktır.

### Mevcut authority'nin temiz karşılığı

- `app.workspaces`
- `app.workspace_settings`
- `shopify.installations`
- `integrations.provider_connections`
- `analytics.performance_rows`
- `analytics.email_spend_history`
- `analytics.fx_rates`

### Eksik fakat GO öncesi zorunlu foundations

- `billing.workspace_subscriptions`
- `billing.workspace_entitlements`
- `billing.trial_ledger`
- `operations.refresh_runs`
- `operations.refresh_leases`
- `operations.provider_checkpoints`
- `operations.reconciliation_ledger`
- `privacy.webhook_claims`
- `privacy.deletion_runs`
- `privacy.deletion_manifests`
- `integrations.oauth_transactions`

Her tabloda gerekli olduğunda `workspace_id`, immutable created timestamp, monotonic version ve idempotency key bulunur. Cross-workspace foreign key veya caller-supplied tenant fallback yasaktır.

## Taşıma protokolü

### Hazırlık

1. Target migration'ları boş project'e uygulanır.
2. Grants/advisors/schema diff ve negative object scan PASS olur.
3. Target project preview-only kalır.
4. Kaynak DB salt-okunur manifest snapshot'ı alınır.

### Dry run

1. Secret olmayan exact rows staging transaction'a yüklenir.
2. FK, count, canonical hash ve constraint kontrolleri yapılır.
3. Sealed token canary ve rotation yapılır.
4. Dataset re-fetch + reconciliation çalışır.
5. Privacy, billing, scheduler foundations acceptance testleri geçer.
6. Transaction rollback veya disposable branch/project ile kanıt üretilir.

### Cutover rehearsal

- source watermark alınır
- delta replay idempotent çalışır
- target read-only preview Shopify session ile doğrulanır
- side-by-side output parity raporu üretilir
- source project yazma authority'si kapanmaz
- rollback target credential revoke + legacy route restore ile prova edilir

### Production cutover

EO-F7 tek başına production cutover değildir. EO-01–EO-08'in ilgili kabul kapıları, provider parity, deletion, billing/trial, scheduler/finality ve insan onayı olmadan domain/Shopify app/runtime switch yapılmaz.

## Reconciliation kabul kriterleri

Exact carry için:

- source count = export count = import count
- secret olmayan canonical row hash'leri birebir eşit
- orphan FK = 0
- duplicate canonical key = 0
- unknown workspace = 0
- plaintext token = 0
- decrypt/rotate failure = 0 veya açık `reauthorization_required`
- legacy table/function/import count = 0
- runtime role forbidden privilege = 0

Re-fetch için:

- her aktif provider için identity/account probe PASS
- requested date coverage eksiksiz
- raw response evidence mevcut
- support state `supported|unsupported|unknown`; missing değer sıfıra çevrilmez
- reconciliation mismatch açık ve sayılabilir
- finality state ve source watermark yazılmış

## Rollback ve retention

- Eski project cutover sırasında source-of-truth/rollback olarak korunur.
- Yeni project'e geçiş eski projectte delete/update yapmaz.
- Rollback, yeni runtime credential'ının revoke edilmesi ve eski deployment/domain hattının yeniden aktive edilmesidir.
- Legacy project consumer-zero, retention, privacy ve legal kararları tamamlanmadan pause/delete edilmez.
- Yeni projectte üretilen cutover sonrası yazılar geri dönüşte delta manifestiyle korunur; sessiz veri kaybı kabul edilmez.

## Changelog etkisi

Postgres 17.11 breaking-change kontrolü sonucunda:

- hedef şema `ltree` kullanmaz;
- DB-level legacy pgcrypto envelope kullanmaz; app AES-256-GCM envelope modeli korunur;
- `btree_gist` float/NaN index yoktur;
- custom operator yoktur;
- OrioleDB kullanılmaz.

Mevcut project için upgrade veya reindex bu paket kapsamında değildir; production mutation yapılmamıştır.

## EO paketlerine aktarım

- **EO-F5:** Shopify product/route map ve DB consumer map
- **EO-F6:** ayrı Supabase kurulum, migration ve rehearsal eforu
- **EO-F7:** project oluşturma GO/NO-GO
- **EO-01:** clean migrations, roles, CI, advisors, schema negative tests
- **EO-02:** workspace/install/billing/privacy foundations
- **EO-03:** provider connection/token renewal ve adapter acceptance
- **EO-04:** clean Dataset/formula/query schema
- **EO-05:** refresh lease/checkpoint/finality/deletion
- **EO-07/08:** parity, migration rehearsal, canary, cutover ve rollback

## Kabul sonucu

EO-F4 **PASS**:

- data-plane: ayrı Standard Supabase Postgres project
- new runtime `service_role`: yasak
- exact business row carry: 10 satır (1 workspace + 1 setting + 1 installation + 3 connection + 4 spend history)
- Dataset canonical direct copy: 0
- FX bulk direct copy: 0
- expired OAuth transaction carry: 0
- plaintext token exposure: 0
- yeni project/schema/data mutation: 0
- sıradaki kapı: **EO-F5 — Product and route map**

