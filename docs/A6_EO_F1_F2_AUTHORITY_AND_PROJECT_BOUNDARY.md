# A6-EO-F1/F2 — Authority, Canlı Veri ve Fiziksel Proje Sınırı

**Tarih:** 4 Ekim 2026  
**Durum:** EO-F1 tamam; EO-F2 karar donduruldu; EO-F3–F7 bekliyor  
**Yöntem:** Salt-okunur GitHub, Supabase ve Vercel incelemesi  
**Gizlilik:** Token, secret, PII, account ID, shop domain veya satır payload'ı okunmadı ve kaydedilmedi.

## İş çıktısı

Embedded-only yeniden kuruluş için hangi canlı otoritelerin korunacağı, hangilerinin legacy olduğu ve temiz uygulamanın fiziksel olarak nerede kurulacağı belirlendi.

**İş değeri:** Yeni uygulamanın eski monoliti, emekli provider secret'larını veya standalone tenant modelini yanlışlıkla yeniden etkinleştirmesi fiziksel build/deploy sınırıyla engellenir. Canlı workspace, provider grant ve Dataset V2 verileri ise silinmeden sonraki veri taşıma kapısına devredilir.

## Yönetici özeti

1. **EO-F1 tamamlandı:** Canlı tenant, installation, provider grant/token, Dataset, OAuth transaction, billing ve job authority kaynakları sınıflandırıldı.
2. **EO-F2 kararı:** Hedef runtime ayrı GitHub repository ve ayrı Vercel project olarak kurulacaktır.
3. **Production continuity:** Mevcut `ads-table-dev` Vercel project ve `dev.adstable.app` domain cutover'a kadar değişmeden containment/rollback hattı kalır.
4. **Data-plane kararı açık:** Aynı Supabase projesinde özel least-privilege rol/private schema ile devam etmek ile ayrı Supabase projesine canonical carry yapmak EO-F4'te karşılaştırılacaktır.
5. **Yasak:** Yeni runtime'a mevcut karışık Supabase şemasını aşan `SUPABASE_SERVICE_ROLE_KEY` verilemez. Supabase'in resmî modelinde service role RLS'yi bypass eder.
6. **Uygulama başlamadı:** Yeni repository, Vercel project, Supabase project, domain veya secret oluşturulmadı/değiştirilmedi.

## İncelenen canlı sınırlar

### Supabase

- Project: `adstable-dev`
- Project ref: `xnstrzhavqkztvmlwsrx`
- Durum: `ACTIVE_HEALTHY`
- Region: `ap-northeast-1`
- PostgreSQL: `17.6.1.121`
- Public tablo sayısı: 24
- Bütün public tabloların RLS bayrağı açık.
- Supabase changelog kontrolünde yeni public tabloların Data API'ye otomatik açılmaması ve explicit grant gereksinimi doğrulandı.
- `cron.job` relation mevcut değildir; canonical DB cron authority kanıtlanmadı.

### Vercel

- Team: `FIRAT's projects`
- Project: `ads-table-dev`
- Framework: Express
- Node: 24.x
- Production deployment: READY
- Production domain: `dev.adstable.app`
- Secret değerleri açılmadan görülen environment key sayısı: 40
- Mevcut proje kök monolit, legacy HTML, embedded route ve cron'u aynı deploy sınırında birleştiriyor.

### GitHub

4 Ekim 2026 `main` ölçümü:

- 819 repository dosyası
- 305,537 byte kök `server.js`
- 1,530,539 byte `public/`
- 120 dosya / 561,776 byte `src/`
- 203 test dosyası / 1,018,092 byte `tests/`

## EO-F1 authority envanteri

| Alan | Canlı source-of-truth | Canlı durum | EO kararı |
|---|---|---|---|
| Canonical tenant | `workspaces` | 1 active | **Carry authority** |
| Workspace settings/currency | `workspace_settings` | 1 | **Carry authority** |
| Shopify installation | `shopify_installations` | 1 active, generation 1 | **Carry authority**; EO-F4 exact mapping |
| Canonical provider grants/tokens | `workspace_provider_connections` | Meta, Google Ads, Klaviyo: 3 connected | **Carry authority**; encrypted envelopes only |
| Embedded transitional provider store | `shopify_workspace_provider_connections` | 1 | **Do not carry as authority**; reconcile then retire |
| Dataset V2 | `performance_dataset_rows_v2` | 5 rows; 4 Klaviyo, 1 Meta; workspace null 0; synthetic 0 | **Carry candidate**; finality/provenance validation required |
| Klaviyo cost history | `workspace_provider_email_spend_history` | 4 rows | **Carry authority** |
| Legacy-to-workspace attestation | `legacy_user_workspace_bindings` | 1 active binding | **Migration evidence only**; not runtime authority |
| OAuth transactions | `oauth_transactions` | 12/12 expired; all Shopify/workspace-bound | **Do not migrate rows**; rebuild TTL/cleanup store |
| Legacy tenant | `users` | 8 | **Do not carry as tenant authority** |
| Legacy provider grants | `platform_connections` + `platform_connection_tokens` | 8 connection rows / 6 token envelopes | **Frozen legacy**; no new runtime access |
| Legacy account inventory | `platform_ad_accounts`, `platform_businesses`, `platform_account_ownerships` | 12 / 0 / 12 | **Historical evidence only** |
| Legacy settings | `user_settings` | 6 | **Do not carry** |
| Legacy billing/trial | `subscriptions` | 7 | **Not canonical**; EO-02 workspace billing must replace |
| Legacy snapshots | `dashboard_snapshots` | 2,185 | **Read-only history** pending EO-F4 |
| Legacy dataset | `performance_dataset_rows` | 4,947 | **No blind copy**; R8 validation/re-fetch only |
| Legacy job ledger | `snapshot_jobs` | 2,392 | **Do not carry as scheduler authority** |
| Legacy schedules | `snapshot_schedules` | 10; all inactive; 240 minutes | **Do not carry** |
| FX history | `fx_rates_daily` | 10,478 | **Carry candidate**; provider/provenance check in EO-F4 |
| Empty/secondary stores | `insight_logs`, `fx_rates`, `platform_businesses` | 0 | Recreate only if target contract requires |

## Provider authority bulgusu

Canonical workspace authority doğru üçlüyle sınırlıdır:

- Meta: 1 connected
- Google Ads: 1 connected
- Klaviyo: 1 connected

Legacy `platform_connections` hâlâ şunları taşır:

- Google: 1 connected
- Klaviyo: 2 connected
- Meta: 1 connected
- Pinterest: 1 connected
- TikTok: 1 connected
- Google Sheets ve Organic: disconnected

Bu satırlar yeni runtime'a verilirse duplicate/retired authority tekrar etkinleşebilir. Bu nedenle yeni runtime legacy connection/token tablolarına erişemez.

## Dataset V2 bulgusu

- Klaviyo: 4 satır, 26 Eylül–2 Ekim 2026
- Meta: 1 satır, 1 Ekim 2026
- Google Ads: 0 satır
- `workspace_id IS NULL`: 0
- `synthetic=true`: 0

Bu tablo canonical carry adayıdır; ancak beş satırın varlığı reporting completeness, maturity veya finality PASS anlamına gelmez.

## Scheduler ve lifecycle boşlukları

Canonical workspace-scoped job/lease/checkpoint tabloları yoktur.

Mevcut ledger:

- `snapshot_jobs`: user-scoped legacy, 2,392 satır
- `snapshot_schedules`: user-scoped legacy, 10 satır, tamamı pasif
- Vercel cron: saatte bir `/api/cron/auto-refresh`
- DB `cron.job`: yok

Canlı routine envanterinde yalnız şunlar bulundu:

- `complete_shopify_managed_install`
- `expire_trials`
- `r4c_reject_legacy_provider_write`

Durable uninstall/privacy webhook claim, deletion manifest/run/evidence, clean reinstall generation, workspace job lease/checkpoint ve canonical billing routine authority'si yoktur. Bunlar EO-02 ve EO-05'in zorunlu foundation çıktılarıdır.

## Billing/trial boşluğu

Canlıda yalnız user-scoped `subscriptions` tablosu vardır. Workspace-scoped Shopify Billing authority veya entitlement ledger bulunmamaktadır.

Sonuç:

- 14 günlük Shopify trial kararı korunur.
- Legacy `subscriptions` yeni runtime'a authority olarak taşınmaz.
- EO-02, Shopify installation/workspace ile bağlı versionlı billing/entitlement modelini kurmadan review-ready olunamaz.

## Environment boundary

Mevcut Vercel project 40 key taşır. Yeni project için denylist:

- 10 TikTok key'i
- 3 Pinterest key'i
- 1 GA4 key'i
- `PROVIDER_TOKEN_LEGACY_READ_ENABLED`
- `ADSTABLE_CODEX_READONLY_TOKEN`
- legacy/debug/test/operator-only bütün key'ler

Yeni project secret'ları “copy all” ile taşınamaz. Her key için owner, target environment, rotation/cutover ve rollback kaydı gerekir. `SUPABASE_SERVICE_ROLE_KEY` mevcut karışık project'e karşı yeni runtime'a verilemez.

## EO-F2 seçenek karşılaştırması

Puan: 1 zayıf, 5 güçlü. Yüksek puan daha güvenli/uygundur.

| Kriter | Aynı repo / ayrı deploy root | Ayrı repo + ayrı Vercel |
|---|---:|---:|
| Legacy import/build izolasyonu | 2 | 5 |
| Secret ve environment izolasyonu | 2 | 5 |
| CI ve deployment bağımsızlığı | 3 | 5 |
| Yanlış route/static inclusion riski | 2 | 5 |
| Bağımsız rollback/cutover | 3 | 5 |
| Mevcut history/contract keşif kolaylığı | 5 | 3 |
| Başlangıç operasyon yükü | 4 | 3 |
| **Toplam** | **21/35** | **31/35** |

History ve contract erişim kaybı, eski repository'yi salt-okunur authority/evidence kaynağı olarak tutup yalnız onaylı dosyaları provenance ile seed ederek yönetilebilir. Buna karşılık aynı repository'nin yanlış import, build glob, secret ve route sızıntısı riski fail-closed biçimde kanıtlanamaz.

## EO-F2 bağlayıcı karar

Uygulama GO verilirse:

1. Yeni ve ayrı bir GitHub repository oluşturulur.
2. Bu repository'ye bağlı yeni ve ayrı bir Vercel project oluşturulur.
3. İlk deployment yalnız preview olur; `dev.adstable.app` taşınmaz.
4. Mevcut Vercel project production/rollback hattı olarak kalır.
5. Yeni repository eski repository'nin fork'u veya toplu kopyası olmaz.
6. Başlangıç seed'i yalnız:
   - yeni Execution Plan özeti,
   - EO contract'ları,
   - Shopify UI Constitution,
   - temiz package/build/CI manifesti,
   - EO-F3 allowlist ile kabul edilen modüllerden oluşur.
7. Eski repo history'si provenance URL/SHA ile referanslanır.
8. Shopify app identity, redirect URI ve domain cutover kararı EO-F5/EO-08'de verilir.
9. Supabase data-plane seçimi EO-F4 tamamlanmadan runtime credential verilmez.

## Supabase data-plane stop kapısı

İki güvenli aday vardır:

### A — Mevcut Supabase + özel least-privilege boundary

- Yeni runtime için ayrı Postgres role/private schema veya eşdeğer dar yetki
- Yalnız allowlist tablo/function grant'leri
- `service_role` yok
- Browser Data API kullanılacaksa explicit grant + RLS
- Legacy tablolar için sıfır privilege
- Credential rotation ve revoke planı

### B — Ayrı Supabase project

- Canonical şema temiz migration history ile kurulur
- Yalnız EO-F4 onaylı satırlar reconciliation kanıtıyla taşınır
- Eski project rollback/read-only history olarak kalır
- Token envelope key/cipher migration ve Shopify installation continuity ayrıca kanıtlanır

EO-F4 bu iki seçeneği güvenlik, taşıma riski, downtime, rollback ve operasyon maliyetiyle karşılaştırıp tek karar verir.

## Resmî kaynak kontrolü

- [Supabase Changelog — breaking changes](https://supabase.com/changelog?types=breaking-change)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Postgres Roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase Securing Your Data](https://supabase.com/docs/guides/database/secure-data)

Resmî dokümana göre `service_role` RLS'yi bypass eder. Bu nedenle “aynı DB ama yeni Vercel project” tek başına veri izolasyonu değildir.

## Sonraki kapı

EO-F3 — Kod/dependency carry allowlist:

- target modüllerin transitive import grafiği;
- carry-as-is / extract-and-rewrite / contract-only / retire sınıflaması;
- yasaklı provider ve legacy dependency için sıfır build inclusion;
- clean package manifest ve CI sınırı.

EO-F3 tamamlanmadan yeni repository oluşturulmaz.

