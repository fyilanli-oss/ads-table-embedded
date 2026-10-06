# A6 EO-F3 — Kod ve dependency carry allowlist

**Tarih:** 4 Ekim 2026  
**Durum:** EO-F3 tamamlandı; EO-F4 bekleniyor  
**Etkisi:** Salt-okunur mimari karar. Production, provider, veritabanı, deployment veya Shopify configuration değişikliği yapmaz.

## Analist sonucu

Yeni embedded-only ürün, mevcut uygulamanın “temizlenmiş kopyası” olmayacaktır. Mevcut repository'deki hiçbir application module aynen taşınmaya uygun bulunmamıştır. Çalıştığı kanıtlanan iş davranışları kaynak olarak kullanılacak; tenant, güvenlik, veri doğruluğu ve Shopify UI sınırları temiz hedef modüllerde yeniden kurulacaktır.

Bu karar, yeniden keşif yapmayı değil, bataklığın bağımlılıklarını taşımadan kanıtlanmış bilgiyi korumayı amaçlar.

## İnceleme zemini

4 Ekim 2026 `main` ağacı ve transitive import ilişkileri incelendi:

- 819 repository dosyası
- 305 KB kök `server.js`
- 1.53 MB `public/`
- 120 dosya / 562 KB `src/`
- 203 test dosyası / 1.02 MB `tests/`
- mevcut doğrudan dependency'ler: `express`, `googleapis`, `@supabase/supabase-js`

Önemli bulgular:

- `src/shopify/runtime.js`, ürün runtime'ı ile historical inventory ve controlled acceptance modüllerini aynı composition root'ta birleştiriyor.
- `src/shopify/embedded-app-home.js`, gerçek ürün yüzeyi ile kabul/debug/historical davranışlarını ve emekli provider izlerini birlikte taşıyor.
- Workspace Dataset/query katmanında hâlâ `user_id` uyumluluk izleri var.
- Mevcut token store legacy `platform_connection_tokens` tablosuna bağlı.
- Privacy lifecycle bugün operasyonel silme motoru değil, planlayıcı seviyesinde.
- Mevcut package manifest yeni ürünün dependency manifesti olarak kullanılamaz.

## Dört sınıflı bağlayıcı karar

### 1. Carry-as-is

Application/runtime kodu için sonuç: **sıfır modül**.

Aynen seed edilebilecek tek artefaktlar, içerikleri ayrıca hash/provenance ile doğrulanmak şartıyla:

- EO karar ve executable contract'ları
- Shopify Embedded UI Constitution
- kabul edilmiş schema/metric/formula sözleşmeleri
- provider ham kanıtları ve reconciliation evidence
- bağımsız test fixture'ları; yalnız kişisel veri/secret içermiyorsa

Bunlar da runtime dependency değildir.

### 2. Extract-and-rewrite

Aşağıdaki kaynaklar davranış referansı olarak kullanılabilir; dosya kopyalanamaz, temiz hedef arayüz ve workspace-only authority ile yeniden yazılır:

| Hedef yetenek | Kaynak ailesi | Yeniden yazma şartı |
|---|---|---|
| Shopify tenant/install/session | `src/shopify/tenant-model.js`, embedded auth ve managed installation ailesi | Yalnız `workspace_id`; clean-reinstall generation, billing ve lifecycle kapıları |
| Canonical provider bağlantısı | `src/providers/workspace-provider-connection-store.js` | Legacy shim ve `user_id` çıkarılır; EO-F4 least-privilege data plane |
| Token crypto | `security/provider-token-vault.js` | Workspace/install generation AAD; startup fail-closed; legacy token store yok |
| Meta adapter | `src/providers/meta/**` içindeki client/capability/normalization/mapping davranışları | Historical, controlled acceptance ve operator modülleri ayrılır |
| Google Ads adapter | `src/providers/google-ads/**` içindeki search client/conversion/mapping davranışları | Google Sheets ve `googleapis` transitive bağı yok; ham yanıt/provenance korunur |
| Klaviyo adapter | `src/providers/klaviyo/**` içindeki provider client/metric binding/mapping davranışları | Historical inventory ve acceptance araçları production build dışında |
| Dataset V2 | `funnel-core/workspace-*` ve mapper davranışları | `user_id` fallback yok; EO-F4 schema; finality/reconciliation zorunlu |
| Zaman, FX, hierarchy | `funnel-core` saf davranışları | Final contract'a karşı characterization; yanlış/ambiguous semantik taşınmaz |
| Formula/query | mevcut formula/query davranışları | A4 bulguları düzeltilir; canonical adlar, null/unknown ve cost allocation doğruluğu |
| OAuth transaction | mevcut TTL/state davranışı | Satır taşınmaz; workspace/install generation bağlı temiz store |
| Scheduler/finality | mevcut hourly cron ve provider davranışları | Tek authority, lease/checkpoint, idempotent rolling reconciliation |

“Extract” kaynak davranışı anlamak içindir; kopyala-yapıştır izni değildir.

### 3. Contract-only

Aşağıdakilerde mevcut kod değil yalnız kabul edilmiş davranış taşınır:

- Shopify App Home, settings, provider connect ve data-source UI'ları
- App Bridge ve güncel Polaris web component eşlemesi
- Formula/compare/intent API semantiği
- Dataset satır sözleşmesi, provenance, maturity ve finality
- privacy webhook claim, Workspace Data Deletion ve Clean Reinstall
- Shopify billing, 14 günlük trial ve entitlement
- scheduler/lease/checkpoint davranışı
- OAuth state/TTL/replay güvenliği
- side-by-side parity, canary, rollback ve consumer-zero kapıları
- controlled acceptance testlerinin doğruladığı beklentiler

UI, kod yazılmadan önce analyst brief + exact Shopify component mapping ile yeniden tasarlanır. Resmî component/property doğrulanmadan implementation başlamaz.

### 4. Retire / hedef build'e giremez

- kök `server.js` monoliti
- `public/` standalone login/signup/dashboard ve legacy statik ürün
- legacy `users`, `user_settings`, `subscriptions` authority davranışları
- `platform_connections`, `platform_connection_tokens` ve legacy OAuth/refresh yolları
- V1 snapshots, V1 dataset, legacy jobs/schedules ve user-scoped backfill runtime'ı
- GA4, Google Sheets, TikTok, Pinterest ve Organic runtime/provider yüzeyleri
- `shopify_workspace_provider_connections` transitional authority
- dual-write, live-shadow ve legacy primary/canonical fallback
- debug, test, operator, diagnostic, controlled-acceptance ve historical-inventory route'ları
- mevcut `package.json`, lockfile, Vercel route/build glob'ları ve bulk environment kopyası
- mevcut embedded UI dosyalarının toplu kopyası veya CSS/HTML Shopify taklidi

Legacy repository EO cutover'a kadar containment/rollback olarak korunur; “retire” bugün silme yetkisi vermez.

## Temiz dependency politikası

Yeni repository, sıfırdan üretilmiş package manifest ve lockfile ile başlar.

### İzinli dependency kategorileri

- EO-01'de resmî güncel Shopify dokümanına göre seçilecek official app stack
- Shopify App Bridge ve Polaris web components için resmî paket/dağıtım biçimi
- EO-F4'te seçilecek data plane'e uygun tek database client/driver
- aktif providerlar için mümkünse platform-native `fetch`/Web Crypto/Node crypto
- test, lint, typecheck ve build için yalnız kullanılan araçlar

### Otomatik taşınması yasak mevcut dependency'ler

- `express`: otomatik carry yok; hedef framework EO-01'de belirlenir
- `googleapis`: carry yok; Google Ads hedef adapterına transitive bağ olamaz
- `@supabase/supabase-js`: otomatik carry yok; EO-F4 data-plane kararından sonra gerekçelendirilir
- mevcut lockfile ve transitive dependency ağacı: carry yok

### Her yeni dependency için kapı

Her doğrudan dependency kaydı şu alanları taşır:

1. sahibi olduğu tek hedef yetenek;
2. neden platform-native çözümün yetmediği;
3. runtime mı dev-only mi olduğu;
4. browser/server sınırı;
5. secret ve tenant etkisi;
6. lisans ve bakım durumu;
7. version pin/upgrade politikası;
8. kaldırma ve rollback yolu.

Kullanılmayan dependency CI'da kabul edilmez. Provider SDK'sı eklemek varsayılan değil, kanıt gerektiren istisnadır.

## Hedef build sınırı

Yeni production artefact şu negative kontrollere sahip olacaktır:

- yasak provider veya legacy klasör adlarından import: 0
- `user_id` tenant authority kullanımı: 0
- legacy tablo adı kullanımı: 0
- debug/operator/acceptance route kaydı: 0
- root monolith veya legacy public asset inclusion: 0
- browser bundle'da server secret/client: 0
- tanımsız environment key okuması: 0
- kullanılmayan direct dependency: 0

CI; allowlist import graph, forbidden string/table/route taraması, dependency inventory, secret scan ve production bundle inspection çalıştırmadan merge'e izin vermez.

## EO paketlerine etkisi

Bu karar implementation başlatmaz. Şu işleri net biçimde sonraki kapılara taşır:

- **EO-F4:** exact schema/data carry, data-plane ve credential sınırı
- **EO-F5:** product/route map; production ile operator/test yüzeyinin ayrılması
- **EO-F6:** rewrite birimlerinin gerçek süre/risk hesabı
- **EO-F7:** insan GO/NO-GO
- **EO-01:** clean repository/build/CI ve resmî Shopify stack seçimi
- **EO-02:** workspace/install/billing/lifecycle foundations
- **EO-03:** provider adapter rewrite
- **EO-04:** Dataset/formula/query rewrite
- **EO-05:** scheduler/finality/deletion
- **EO-06+:** UI, parity, canary, cutover ve legacy consumer-zero

## Kabul sonucu

EO-F3 **PASS**:

- application code carry-as-is sayısı: **0**
- dört sınıflı allowlist machine-readable olarak donduruldu
- mevcut package manifest toplu carry dışında
- yasak provider/legacy dependency için hedef build inclusion hedefi: **0**
- yeni repository/project hâlâ oluşturulmadı
- production, DB, provider ve deployment mutation: **0**
- sıradaki kapı: **EO-F4 — Schema and data carry map**
