# PD ve CPD sorgu çalışma tablosu

## Ortak kayıt aileleri ve kaynak eşlemesi — 23 Ekim 2026

Ürün sahibi beş sütunlu ortak düzeni kabul etti ve sohbet tablosunun Excel çıktısını aldı. Bu bölüm o çıktının aynı 15 satırlık analiz kaydıdır; önceki 13 sütunlu sorgu matrisi değiştirilmez. Kaynak, mevcut repository sorgu ve normalizasyon kodudur; yeni provider desteği veya canlı veri kabulü değildir. Fiziksel tablo, unique constraint, Dataset writer ve FX uygulaması bu kayıtla başlamaz. 16 + 20 + 22 tasarımına girdidir; 17–19 kapanışı değildir.

**Ortak bağlam:** Workspace + kurulum/nesil + provider bağlantısı + doğrulanmış hesap. Aşağıdaki bütün kayıtlarda bu bağlam korunur.

| Kayıt ailesi | Kayıt kapsamı | Hiyerarşi bağlantısı | Ürün bağlantısı | İçerik |
| --- | --- | --- | --- | --- |
| Meta — PD | Gün + Ad | Campaign → Ad Set → Ad | Gerekmez | PD metrikleri |
| Meta — CPD ürün performansı | Gün + Ad + kaynak ürün kırılımı | Channel: Ad; üst kimlikler korunur | Kaynak product_id; Shopify eşlemesi açık | Ürün Impression / Click / Spend |
| Meta — CPD ürün satışı | Aynı ürün kırılımlı kaynak kayda referans | Channel: Ad; üst kimlikler korunur | Kaynak product_id korunur; satılan ürün anlamı ve eşlemesi açık | Dört quantity/value alanı sorguda; anlam ve Sales Role kabulü açık |
| Google Search — PD | Gün + Ad; dönüşüm kaynağında ayrıca action/category | Campaign → Ad Group → Ad | Gerekmez | PD metrikleri |
| Google Search — CPD ürün performansı | Bu aile için ürün performansı kaynağı kurulmuş değil | Hedef Channel: Ad Group | — | Ad performansı ürünlere kopyalanmaz |
| Google Search — CPD ürün satışı | Gün + Ad Group + Merchant/feed + satılan ürün kırılımı | Channel: Ad Group → Campaign | Satılan item ID; Shopify eşlemesi açık | Normal satış adedi/değeri; reklam ürünü kimliği bu sorguda yok |
| Google Shopping — PD | Gün + Ad Group; dönüşüm kaynağında ayrıca action/category | Campaign → Ad Group | Gerekmez | PD metrikleri |
| Google Shopping — CPD ürün performansı | Gün + Ad Group + Merchant/feed + ürün ve diğer kaynak kırılımları | Channel: Ad Group → Campaign | Item ID; Shopify eşlemesi açık | Ürün Impression / Click / Spend |
| Google Shopping — CPD ürün satışı | Gün + Ad Group + Merchant/feed + reklam ürünü/satılan ürün kırılımı | Channel: Ad Group → Campaign | Reklam ve satılan item ID’leri ayrı korunur; Shopify eşlemesi açık | Normal adet/değer + lead/cross-sell ayrıntıları |
| Google PMax — PD | Gün + Asset Group; dönüşüm kaynağında ayrıca action/category | Campaign → Asset Group | Gerekmez | PD metrikleri |
| Google PMax — CPD ürün performansı | Gün + Campaign + Merchant/feed + ürün ve diğer kaynak kırılımları | Asset Group bağlantısı açık; Campaign korunur | Item ID; Shopify eşlemesi açık | Ürün Impression / Click / Spend |
| Google PMax — CPD ürün satışı | Gün + Campaign + Merchant/feed + reklam ürünü/satılan ürün kırılımı | Asset Group bağlantısı açık; Campaign korunur | Reklam ve satılan item ID’leri ayrı korunur; Shopify eşlemesi açık | Normal adet/değer + lead/cross-sell ayrıntıları |
| Klaviyo — PD | Rapor günü + Message + Medium + Variation ayrıntısı; seçili dönüşüm metriği | Campaign → Message veya Flow → Message | Gerekmez | PD metrikleri; Spend açık |
| Klaviyo — CPD ürün performansı | Ürün satışına referans; ayrıca ürün teslim/tıklama kaydı kurulmaz | Channel: Message; üst kimlikler korunur | Ordered Product içindeki ProductID; varsa VariantID | Impression/Click N/A; Spend açık |
| Klaviyo — CPD ürün satışı | Ordered Product Event ID | Doğrulanmış atıfla Message → Campaign/Flow | ProductID; varsa VariantID; standart Shopify eşlemesi açık | Quantity / $value; mevcut Assisted / Triggered kuralları |

### Bu tablonun sınırları

- Kayıt kapsamı fiziksel unique key beyanı değildir. Kaynak raporunun bütün kırılımları tekilleştirmeden önce korunur; Product ID tek başına yeterli değildir. Klaviyo olayı ile Meta/Google toplulaştırılmış rapor satırı aynı tür kayıt sayılmaz. Kaynak satır indeksi kalıcı anahtar olmaz.
- Kaydı tekilleştiren anahtar ile Channel ve ürün bağlantıları ayrıdır. Channel kimliği Shopify eşlemesini veya Sales Role'ü kanıtlamaz. Çözülemeyen ürün/Channel bağlantısı native kaydı sildirmez.
- Aynı native satış iki ailede görünse bile bir kez sayılır. Meta total/promoted ve Google total/lead/cross-sell değerleri bağımsız satışlar diye eklenmez. Klaviyo ürün performansı satırı ikinci Ordered Product satış kaydı üretmez.
- Eksik, açık ve kapsam dışı alanlar sıfır veya PD metrikleriyle doldurulmaz. Gün/zaman kapsamı, kaynak para birimi, atıf ve tamlık uyumu önceki 17–19 tasarımına tabidir. FX dönüşümü yeni kaynak satış kimliği üretmez; kaynak tutar korunur. FX sağlayıcısı/kur seçimi bu tabloda kararlaştırılmaz.
- Meta 05, Google PMax 10/11 ve Klaviyo 15 açık kalır. Ürün sahibi Klaviyo için yeni etkileşim yolu geliştirmeden devam edilmesini istedi; mevcut Assisted/Triggered ve çelişkili kanıtta Unclassified sınırı değişmez.

Kaynak kod kontrolü, 23 Ekim 2026: `app/lib/providers/meta-reporting.server.js`, `app/lib/providers/google-reporting.server.js`, `app/lib/providers/klaviyo-reporting.server.js`, `app/lib/providers/klaviyo-attribution-resolution.server.js` ve `app/lib/providers/common-adapter.server.js`. Bu bölüm yeni dış API davranışı doğrulaması değildir. Excel çıktısı `AdsTable_PD_CPD_Kayit_Esleme_2026-10-23.xlsx` aynı beş sütun ve 15 satırı taşır; dışa aktarımdır, yürütülebilir sözleşmenin yerine geçmez. Sonraki değişikliklerde analiz kaydı ve Excel çıktısı eşlenmeden aynı sürüm denmez.

## Beş tablo kolon sözlüğü — 26 Ekim 2026 inceleme taslağı

Durum: **ürün sahibi incelemesine sunulan kolon taslağı; uygulanmış şema değildir**. Ürün sahibi Dataset'in üç veri ve iki destek tablosuyla tasarlanmasını istedi. Aşağıdaki kolon adları AdsTable tasarım önerisidir; provider'ın aynı isimli alanları verdiği iddiası değildir. Bu sözlük eski beş sütunlu/15 satırlık kaynak eşleme tablosunu ve 13 sütunlu sorgu matrisini değiştirmez. Önceden teslim edilen Excel yalnız kaynak eşleme tablosudur; yeni kolon sözlüğünü içerdiği iddia edilmez.

Beş mantıksal tablo: `pd_facts`, `cpd_product_performance_facts`, `cpd_product_sales_facts`, `product_identity_mappings`, `fx_rates`. Başlangıçta üst PD ve CPD Channel toplamları için altıncı bir kalıcı toplam tablosu önerilmez; uyumlu girdilerden hesaplanır. Önceki 17–19 tamlık ve tek sayım kuralları geçerlidir. Fiziksel schema adı, indeksler, UNIQUE/FK SQL'i, writer, migration ve toplam okuyucusu henüz yoktur. 16 + 20 + 22 tasarımıdır; EO-05-B uygulamasını veya 21/23 işlerini başlatmaz.

Sözlük gösterimi: aynı tip ve kurala sahip kolonlar aynı satırda listelenir; uygulamada ayrı kolon adaylarıdır. **Zorunlu**, bu ailede kabul edilmiş bir kayıt için gereklidir; eksik kimlikli ham yanıtın atılması anlamına gelmez. Eksik kimlikli kanıt mevcut ham kanıt sınırında korunur, tahmini anahtarla kabul edilmiş fact üretilmez. Koşullu veya eksik alanlar için ayrı durum/kanıt taşınır; NULL ile gözlenen 0 aynı değildir.

### Üç fact tablosunda ortak kolonlar

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `id` | bigint identity | Zorunlu | AdsTable satır kimliği; tekrar önleme anahtarı değildir. |
| `workspace_id` | uuid | Zorunlu | Mevcut `app.workspaces.id`; Shopify Shop ID ile karıştırılmaz. |
| `installation_id` | bigint | Zorunlu | Mevcut `shopify.installations.id`; adaptör UUID kontrolüyle uyarlama aşağıda açık. |
| `installation_generation` | bigint | Zorunlu | Mevcut DB `install_generation` alanından açık eşleme; yeni kurulum eski çalışmaya yazdırmaz. |
| `provider_connection_id` | uuid | Zorunlu | Mevcut bağlantı kimliği; workspace/kurulum/nesil/provider birlikte doğrulanır. |
| `platform` | text | Zorunlu | Mevcut `meta`, `google_ads`, `klaviyo` kümesi; SQL enum seçilmedi. |
| `platform_account_id` | text | Zorunlu | Kaynak hesap kimliği; isimden çıkarılmaz. |
| `canonical_reporting_account_id` | text | Koşullu | Mevcut adaptörde Meta/Google için zorunlu, Klaviyo için NULL. DB binding satır ID'siyle eşit olduğu varsayılmaz. |
| `business_date` | date | Koşullu | PD için zorunlu. CPD olayında kaynak gün/saat dilimi çözülemezse NULL ve durum; günlük toplama girmez. UTC tarihi iş günü diye atanmaz. |
| `source_timezone` | text | Koşullu | Doğrulanmış kaynak saat dilimi; eksikse uyumlu günlük toplam/FX tarihi tahmin edilmez. |
| `reporting_scope` | jsonb | Zorunlu | Akış, raporlama zamanı temeli, etkin attribution/conversion kapsamı ve ilgili Medium/Variation gibi boyutların kanıtlı açıklaması. Bilinmeyen değer varsayılanla tamamlanmaz. |
| `source_identity` | jsonb | Zorunlu | Kaynak kaydın veya birleşik PD kapsamının metrik dışı kimlik bileşenleri; ilgili native kırılımların tamamı. Kanıtsız hash/UNIQUE algoritması seçilmedi. |
| `metric_support`, `observation_state` | jsonb | Zorunlu | Metrik bazında mevcut destek/gözlem anlamlarını korur. Yeni SQL durum kümesi henüz dondurulmadı. Eksik, bilinmeyen, kapsam dışı, partial/stale ve gerçek sıfır ayrılır. |
| `provenance` | jsonb | Zorunlu | Kaynak aile/sorgu/satır referansları, sürüm, execution ve tamlık kanıtı; birleşik PD'de metrik bazlı iz. Secret veya gereksiz müşteri bilgisi taşınmaz. Yeni ham kanıt saklama sistemi bu taslakta kurulmaz. |
| `source_currency` | text | Koşullu | Doğrulanmış kaynak para birimi; bilinmiyorsa parasal değer saklanabilir ama currency-safe toplama/dönüşüm yapılamaz. |
| `target_currency` | text | Koşullu | Doğrulanmış raporlama para birimi; workspace para birimi kilidi/yeniden kurulum politikası henüz seçilmedi. |
| `fx_rate_id` | bigint | Boş olabilir | Seçilmiş `fx_rates.id` referansı; kur yoksa NULL. Aynı para birimi kimlik dönüşümü politikası ayrıca açık; sahte kur satırı yok. |
| `fx_engine_version` | text | Koşullu | Dönüşüm kullanıldığında hesaplama sürümü; kur sağlayıcısının sürümüyle aynı şey değildir. |
| `created_at`, `updated_at` | timestamptz | Zorunlu | AdsTable kayıt zamanları; provider olay/iş tarihi veya tarihsel geçerlilik kanıtı değildir. |

`numeric`, kaynak hassasiyetini erken yuvarlamayan ilk tip önerisidir; precision/scale ve üst sınırlar kaynak kabulüyle seçilecektir. ID'ler metrik olmadığı için sayısal kimlik görünümü taşıyan provider/Shopify ID'leri text olarak korunur. Mevcut adaptörün JS number kullanması kayıpsız ondalık taşımanın tamamlandığını kanıtlamaz; bu da uygulama öncesi kontroldür.

### 1. PD — `pd_facts`

Ortak kolonlara ek:

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `entity_type`, `entity_id` | text | Zorunlu | Meta Ad; Google Search Ad, Shopping Ad Group, PMax Asset Group; Klaviyo Campaign/Flow Message. |
| `entity_name` | text | Boş olabilir | Ad değil ID bağlantı anahtarıdır. Mevcut adaptörün ad zorunluluğu ayrıca uyarlanmalı; burada kod değiştirilmedi. |
| `root_entity_type`, `root_entity_id`, `root_entity_name` | text | Koşullu | Mevcut Campaign/Flow üst hiyerarşisi; tür/ID birlikte geçerli olmalı. Eksik üst kimlikte ilgili üst toplam yapılamaz. |
| `parent_entity_type`, `parent_entity_id`, `parent_entity_name`, `campaign_type` | text | Koşullu | Mevcut adaptör hiyerarşi ayrıntısı; uygulanmayan seviye uydurulmaz. |
| `impression`, `ad_click`, `spend_value`, `add_to_cart`, `add_to_cart_value`, `checkout`, `checkout_value`, `purchase`, `purchase_value` | numeric | Boş olabilir | Dokuz mevcut standart metrik. Değer yoksa NULL + alan durumu; conversion adetleri integer'a zorlanmaz. Tutarlar kaynak para birimindedir. |

PD yalnız 17'nin uyum kontrollerinden geçmiş metrik birleşimini temsil eder. Conversion action/category, Klaviyo seçili conversion metric ve Variation ayrıntıları provenance/kapsamda kaybolmaz; farklı conversion raporları veya aynı mesajın toplam/detail satırları körlemesine toplanmaz. Üst toplamlar, ana fact'lere parent ve child birlikte eklenerek oluşturulmaz.

### 2. CPD ürün performansı — `cpd_product_performance_facts`

Ortak kolonlara ek:

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `channel_type`, `channel_id` | text | Boş olabilir | Kaynak kanıtı varsa birlikte dolar; PD fact ID'sine zorunlu FK değildir. |
| `channel_resolution` | text | Zorunlu | Bağlantının doğrulanmış, eksik veya çelişkili oluşu; kesin SQL durum kümesi açık. |
| `root_entity_type`, `root_entity_id`, `root_entity_name`, `parent_entity_type`, `parent_entity_id`, `parent_entity_name` | text | Koşullu | Kaynak üst hiyerarşi; PMax Campaign kaydı Asset Group yerine geçirilmez. |
| `native_product_id` | text | Boş olabilir | Kaynak ürün gözlenmişse korunur. Eksikse başka native kimliklerle tekillik kanıtı gerekir; yoksa fact kabul edilmez. |
| `product_context` | jsonb | Zorunlu | Kaynağın verdiği katalog/Merchant/feed ve diğer ürün kırılımları; bilinmeyen/kapsam dışı ayrılır. Shopify eşlemesi için eksik bağlam tahmin edilmez. |
| `product_mapping_id` | bigint | Boş olabilir | Doğrulanmış ürün eşlemesine referans; ürün/Channel kanıtından bağımsızdır. |
| `impression`, `click`, `spend_value` | numeric | Boş olabilir | Yalnız ürün performansı kaynağı. Search'te PD Ad maliyeti kopyalanmaz; Klaviyo ürün Impression/Click N/A, Spend açık. |

Klaviyo için yalnız şemayı doldurmak amacıyla boş performans fact'i veya ikinci satış satırı üretilmez. Mevcut kaynak eşleme tablosundaki Ordered Product referansı aynı native satışa işaret eder; ürün satış adedi/değeri bu performans tablosunda tekrar saklanıp toplanmaz. Satışsız gözlenmiş performans/maliyet korunur, satan ürünlere dağıtılmaz.

### 3. CPD ürün satışı — `cpd_product_sales_facts`

Ortak kolonlara ve ürün performansındaki aynı `channel_*`, `root_entity_*`, `parent_entity_*` bağlantı kolonlarına ek:

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `provider_event_id` | text | Koşullu | Klaviyo Ordered Product olayında zorunlu; Meta/Google toplulaştırılmış satırına uydurulmaz. |
| `occurred_at` | timestamptz | Koşullu | Kaynağın gerçek olay zamanı varsa; günlük rapor için sahte gece yarısı zamanı atanmaz. |
| `native_sold_product_id`, `native_advertised_product_id` | text | Boş olabilir | Satılan ve reklam ürünü kimlikleri ayrı; birinden diğeri türetilmez. Meta product_id anlamı açıkken satılan ürün diye etiketlenmez, source_identity/provenance içinde korunur. |
| `product_context` | jsonb | Zorunlu | Native ürün bağlamı; kaynak VariantID dahil varsa ayrıntılar korunur. |
| `sold_product_mapping_id`, `advertised_product_mapping_id` | bigint | Boş olabilir | İki rolün doğrulanmış Shopify eşlemesi ayrı; fiyat/SKU/isim/pattern kanıt değildir. |
| `sales_quantity`, `sales_value` | numeric | Boş olabilir | Anlamı kabul edilmiş normal satış toplamı; kaynak para birimi. Meta'nın dört alanı kabul edilmeden bu kolonlara zorla eşlenmez. |
| `sales_role` | text | Zorunlu | Mevcut rol kümesi; kanıt yoksa Unclassified. Meta 05/Klaviyo 15 kapanmış sayılmaz; Flow Triggered mevcut kanıt şartına tabidir. |
| `sales_role_evidence`, `native_sales_metrics` | jsonb | Zorunlu | Rol kanıtı ve native alanlar ayrı korunur. Meta dört quantity/value, Google normal/lead/cross-sell ve mevcut all_* ham ayrıntıları kapsam etiketleriyle saklanır; ikinci satış diye eklenmez. |

Tek kaydın rolü/Shopify eşlemesi/Channel'ı sonradan çözülürse yeni satış kimliği üretilmez. Bir kaynak satırda birden çok satış rolü bileşeni varsa tek etiketle tahmini bölme yoktur; native bileşenler korunur, rol toplamının kabulü açık tutulur. Provider atıflı ürün satışları Shopify mağaza sipariş defteri veya sağlayıcılar arası tekilleştirilmiş satış gerçeği değildir.

### 4. Ürün eşlemesi — `product_identity_mappings`

Bu destek tablosu fact ortak bloğunu otomatik miras almaz; aşağıdaki kolonlar açıkça önerilir:

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `id` | bigint identity | Zorunlu | Eşleme sürümü satır kimliği. |
| `workspace_id`, `provider_connection_id` | uuid | Zorunlu | Doğrulanmış workspace/bağlantı kapsamı; geçerlilik ve yeniden bağlantı taşıma politikası açık. |
| `installation_id`, `installation_generation` | bigint | Zorunlu | Mevcut kurulum otoritesiyle tutarlı olmalı; yeni kurulumda eski eşleme otomatik aktif olmaz. |
| `platform`, `platform_account_id`, `native_product_id` | text | Zorunlu | Kaynak kimliği; Shopify kimliğinden ayrı. |
| `product_context` | jsonb | Zorunlu | Provider'a uygulanabilir katalog/feed/ürün-varyant bağlamı. Bilinmeyen bağlamın boş nesnesi doğrulanmış kapsam sayılmaz. |
| `shopify_product_id`, `shopify_variant_id` | text | Boş olabilir | Product ID omurga; varsa Variant ID'nin bu ürüne ait olduğu doğrulanır. |
| `mapping_state` | text | Zorunlu | Doğrulanmış/çözülememiş/çelişkili durum; SQL kümesi açık. Çözülememiş kimlik fact'i silmez. |
| `mapping_evidence` | jsonb | Zorunlu | Resmî entegrasyon kaynağı ve doğrulama kanıtı; son görülen tarih geçerlilik başlangıcı değildir. |
| `verified_at` | timestamptz | Koşullu | Doğrulama yapılmışsa; provider geçerlilik tarihi uydurulmaz. |
| `created_at` | timestamptz | Zorunlu | AdsTable kayıt zamanı. |

Çelişkili eşleme geçmişi üzerine yazılarak kaybedilmez. Bir kaynağın hangi eşleme sürümünü/hangi tarihte kullanabileceği, aktif sürüm tekilliği ve geçerlilik aralıkları henüz kararlaştırılmadı; bunun UNIQUE/FK SQL'i bu taslaktan çıkarılamaz. Kaynak varyant ayrıntısı tutulur ama raporlama omurgası Variant ID olmaz.

### 5. FX — `fx_rates`

Bu destek tablosu provider hesap/kurulum kimliklerini otomatik taşımaz. Ortak kur kaynağı ile workspace raporlama para birimi politikası farklı kavramlardır; workspace'e özel kur gereksinimi çıkarsa kapsam yeniden onaya sunulur.

| Kolon | Önerilen tip | Zorunluluk | Kaynak / kural |
| --- | --- | --- | --- |
| `id` | bigint identity | Zorunlu | Kullanılan belirli kur sürümüne referans; kaynak satış ID'si değildir. |
| `source_currency`, `target_currency` | text | Zorunlu | Dönüşüm yönü açık para çifti. |
| `fx_rate_date` | date | Zorunlu | Sağlayıcının kur tarihi; fetch tarihiyle aynı varsayılmaz. |
| `fx_rate` | numeric | Zorunlu | Sonlu ve pozitif kur; hassasiyet sınırı açık. Sıfır/NULL sahte kur satırı olmaz. |
| `fx_provider` | text | Zorunlu | Gerçek kur kaynağı; Frankfurter veya başka sağlayıcı bu taslakla seçilmez. |
| `rate_version` | text | Zorunlu | AdsTable'ın belirli kanıtlı kur sürümünü ayırması; provider'ın bu isimde alan verdiği iddia edilmez. Üretim algoritması açık. |
| `source_reference` | jsonb | Zorunlu | Tam kur kaynağı/yanıt izi; secret olmadan. |
| `fetched_at` | timestamptz | Zorunlu | Kurun alınma zamanı; kur tarihi yerine kullanılmaz. |

Kaynak tutarlar fact kolonlarında değişmeden kalır. İlk taslakta dönüştürülmüş tutarlar ikinci otoriter fact kolonları yerine seçilmiş kur referansı ve FX engine sürümüyle hesaplanan görünüm hedefidir; uygulama yoktur. Farklı currency/time-basis girdiler FX öncesi toplanmaz. Kur düzeltmesinde eski referansın korunması, yeni kurun hangi kayda ne zaman uygulanacağı, aynı para birimi dönüşümü, tatil/eksik gün ve workspace para birimi kilidi ayrı karar bekler. Bunlar sessizce son bulunan kura düşmez.

### Tekillik ve uygulama öncesi açık kontroller

- Satır ID'si, kaynak tekilliği ve Channel/ürün/FX referansları farklıdır. Tekrar önleme kimliğine metrik tutarı, Sales Role, sonradan çözülen bağlantı, ad, FX sonucu veya execution/run ID girmez. Kaynak kimliği belirsizse ham kanıt korunur ama tahmini kabul edilmiş fact üretilmez.
- Mevcut `canonicalFactKey` yalnız başlangıçtır; raporlama zamanı/atıf kapsamı gibi farklılıkları tek başına kapsamaz. Kaynak ailelerinin örtüşmesi giderilmeden query family adını anahtara koyup aynı satışı iki kez kabul etmek de doğru değildir. Kalıcı anahtarın serialize/hash/null/eksik ayrımı ve çakışma politikası uygulanmadı.
- **Mevcut tip uyarlama açığı:** DB `shopify.installations.id` bigint iken `validateCanonicalFunnelFact` içindeki `identity.installation_id` UUID ister. Adaptörde ayrıca entity adı ve FX alanları zorunludur. Bunlar native veri saklama ile yayın hazır olma sınırı ayrılmadan writer'a bağlanamaz. Bu dilim mevcut doğrulayıcıyı gevşetmez veya düzeltmez; 16/20/22 uygulama öncesi kontrolüdür.
- `canonical_reporting_account_id` mevcut adaptörün metin kimliğidir; `integrations.reporting_account_bindings.id` bigint ile doğrudan FK eşdeğeri olduğu kanıtlanmış değildir. Yeni ad uydurularak çözülmüş sayılmaz; otorite eşlemesi kontrol edilecektir. Klaviyo'da mevcut NULL zorunluluğu korunur.
- Workspace/kurulum/nesil/provider/hesap sınırı birlikte doğrulanacak. Cross-workspace mapping veya fact ilişkisi salt bigint ID eşleşmesiyle kabul edilmeyecek. RLS, roller, lifecycle silme/retention, indeksler ve bounded query planı uygulama kapısında tasarlanıp test edilecek; public/anon erişimi eklenmedi.
- Supabase changelog.md okuması 26 Ekim'de aracın desteklemediği content-type nedeniyle alınamadı; alternatif rota denenmedi. Bu taslak tam güncel platform uygulama kapısının geçtiği iddiası değildir. Resmî tip/anahtar dayanağı 26 Ekim 2026'da okundu: [PostgreSQL 17 numeric](https://www.postgresql.org/docs/17/datatype-numeric.html), [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html), [Supabase tables](https://supabase.com/docs/guides/database/tables). Kaynaklar bu kolon tasarımını veya provider desteğini onaylamaz; veri tipi/ilişki mekanizmalarını açıklar.

**Teslim sınırı:** yalnız analiz sözlüğü ve sınır koruma testleri. 05, 10/11, 15 açık; 17–19 tamamlanmadı. Physical schema seçildi veya Dataset yayını hazır denmez. Merge, canlı DB, migration, provider çağrısı, izin/deploy ve paket başlangıcı ayrı kapılardır.

## Önceki sorgu matrisi ve karar kayıtları

Tarih: 22 Ekim 2026. Durum: çalışma referansı sabitlendi; nihai ortak tasarım kabulü değildir.

Ürün sahibi mevcut üç sağlayıcılı tablo düzeninin korunmasını ve Meta bölümündeki son düzeltmelerin kaydedilmesini istedi. Google bölümü ürün sahibinin sonraki kararlarıyla güncellenmiştir. Klaviyo bölümü de ürün sahibinin kabul ettiği seçimlerle sabitlenmiştir; teknik uygulama ve açık Spend hesabı tamamlanmış sayılmaz.

## Kabul edilen hedef ve açık uygulama

CPD Channel, üç sağlayıcıda da PD genel değerlerinin kopyası değil, bağlı ürün metriklerinin toplamıdır. 23 Ekim 2026 envanter 01 uyumunda Meta Channel hücreleri de bu hedefe hizalanmıştır. Bu toplam ve bağlantılar henüz uygulanmış kabul edilmez; envanter 17–19 kontrolü ve ilgili sağlayıcı bağlantı işleri açıktır. Kabul edilen hedeflerin ortak sözleşmesi `contracts/pd-cpd-query-standard-v1.json`; sağlayıcı runtime sözleşmeleri mevcut sorgu durumunu korur.

## Hücrelerin anlamı

- **Var:** Sorguda isteniyor. Yanıtta dolu geldiği veya koda/DB'ye işlendiği anlamına gelmez.
- **Yok:** Mevcut sorguda istenmiyor. Sağlayıcı sunmuyor demek değildir.
- **KD:** İlgili satırın metrik kapsamı dışında.
- **Ad kayıtlarından hiyerarşik toplam:** Üst seviye metriklerin oluşma biçimi; sorgu eksiği değildir. Çalışan toplama kodu kabulü anlamına gelmez.
- Session sütunu ürün sahibi kararıyla çıkarılmıştır.
- Kodda işleme eksikleri hücrede “Yok” olarak gösterilmez; numaralı notlara yazılır.

## Sorgu tablosu

| Provider | Tüketici | Akış | Level | Impression | Click | Spend | ATC | ATC Value | Checkout | Checkout Value | Satış adedi / türü | Satış değeri / türü |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meta | PD | Reklam | Campaign | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Reklam | Ad Set | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Reklam | Ad | Var: `impressions` | Var | Var: `spend` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` |
| Meta | CPD | Channel performansı | Ad | Ürün kayıtlarından toplam — hedef | Ürün kayıtlarından toplam — hedef | Ürün kayıtlarından toplam — hedef | KD | KD | KD | KD | Ürün satış adetleri toplamı — hedef | Ürün satış değerleri toplamı — hedef |
| Meta | CPD | Ürün performansı | Ad × ürün | Var: `impressions` | Var: `clicks` | Var: `spend` | KD | KD | KD | KD | Var: `converted_product_quantity` | Var: `converted_product_value` |
| Meta | CPD | Ürün satış ilişkisi | Ad × ürün | KD | KD | KD | KD | KD | KD | KD | Var¹: `converted_promoted_product_quantity` | Var²: `converted_promoted_product_value` |
| Google Ads | PD | Search | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Search | Ad Group | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Search | Ad | Var⁴: `impressions` | Var⁴: `clicks` | Var⁴: `cost_micros` | Var⁴: normal `conversions` — ADD_TO_CART | Var⁴: normal `conversions_value` — ADD_TO_CART | Var⁴: normal `conversions` — BEGIN_CHECKOUT | Var⁴: normal `conversions_value` — BEGIN_CHECKOUT | Var⁵: normal `conversions` — PURCHASE | Var⁵: normal `conversions_value` — PURCHASE |
| Google Ads | PD | Shopping | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Shopping | Ad Group | Var | Var | Var: `cost_micros` | Var⁴: normal `conversions` — ADD_TO_CART | Var⁴: normal `conversions_value` — ADD_TO_CART | Var⁴: normal `conversions` — BEGIN_CHECKOUT | Var⁴: normal `conversions_value` — BEGIN_CHECKOUT | Var⁵: normal `conversions` — PURCHASE | Var⁵: normal `conversions_value` — PURCHASE |
| Google Ads | PD | Retail PMax | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Retail PMax | Asset Group | Var | Var | Var: `cost_micros` | Var⁴: normal `conversions` — ADD_TO_CART | Var⁴: normal `conversions_value` — ADD_TO_CART | Var⁴: normal `conversions` — BEGIN_CHECKOUT | Var⁴: normal `conversions_value` — BEGIN_CHECKOUT | Var⁵: normal `conversions` — PURCHASE | Var⁵: normal `conversions_value` — PURCHASE |
| Google Ads | CPD | Search — Channel performansı | Ad Group | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Shopping — Channel performansı | Ad Group | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Retail PMax — Channel performansı | Asset Group | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Ürün performansı | Ürün kırılımı | Var | Var | Var | KD | KD | KD | KD | Var⁵: `conversions` — dönüşüm sayısı | Var⁵: `conversions_value` — dönüşüm değeri |
| Google Ads | CPD | Ürün satış ilişkisi | Cart data | KD | KD | KD | KD | KD | KD | KD | Var: `units_sold`, lead / cross-sell — normal esas; `all_*` ham kaynak | Var: `revenue_micros`, lead / cross-sell — normal esas; `all_*` ham kaynak |
| Klaviyo | PD | Campaign | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Açık⁷ | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Klaviyo | PD | Campaign | Campaign Message | Var: `delivered` | Var: `clicks` | Açık⁷ | Var⁸: `conversions` — Added to Cart | Var⁸: `conversion_value` — Added to Cart | Var⁸: `conversions` — Checkout Started | Var⁸: `conversion_value` — Checkout Started | Var: `conversions` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | PD | Flow | Flow | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Açık⁷ | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Klaviyo | PD | Flow | Flow Message | Var: `delivered` | Var: `clicks` | Açık⁷ | Var⁸: `conversions` — Added to Cart | Var⁸: `conversion_value` — Added to Cart | Var⁸: `conversions` — Checkout Started | Var⁸: `conversion_value` — Checkout Started | Var: `conversions` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | CPD | Campaign — Channel performansı | Campaign Message | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁹ | Ürün satış değerleri toplamı⁹ |
| Klaviyo | CPD | Flow — Channel performansı | Flow Message | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁹ | Ürün satış değerleri toplamı⁹ |
| Klaviyo | CPD | Ürün performansı | Message × ürün | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Var⁹: `Quantity` | Var⁹: `$value` |
| Klaviyo | CPD | Ürün satış ilişkisi | Ordered Product → Message | KD | KD | KD | KD | KD | KD | KD | Var⁹: `Quantity` | Var⁹: `$value` |

## Meta test notları

¹ `converted_promoted_product_quantity`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

² `converted_promoted_product_value`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

22 Ekim testinde seçilen iş tarihi 1 Ekim 2026 idi. Ad sorgusu 1, ürün kırılımı 0 satır döndürdü. Tam ham yanıt saklanmadı; bu kayıt ham yanıtın yerine geçmez. Boş ürün sonucu desteklenmiyor veya gerçek sıfır demek değildir. Dört `converted_product_*` / `converted_promoted_product_*` quantity/value alanı talep listesinde korunur.

## Koda eklenecek

³ 23 Ekim 02 + 03 repository düzeltmesi: `actions` / `action_values` içinden web Pixel ATC, Checkout ve Purchase adet/değer projeksiyonu uygulanmıştır. PD Click `outbound_clicks[outbound_click].value` olur. Eksik değerler sıfıra çevrilmez, `omni_*` toplamı/yedeği yoktur. Bu bir sorgu eksiği değildi; gerçek hesap kabulü ve Dataset yayını tamamlanmış değildir.

¹ ve ² ile işaretli alanlar 23 Ekim 02 repository düzeltmesinde standart ürün sorgusuna kalıcı eklenmiştir; eski test bayrağı alanları çıkarmaz. Yukarıdaki boş yanıt ve reel test bekleniyor notu korunur; kalıcı talep gerçek ürün desteği/rol kanıtı değildir.

## Google tasarım kararları

- 23 Ekim son ürün sahibi kararı: Search PD hiyerarşisi Campaign → Ad Group → Ad; **CPD Channel Ad Group**, bağlantı kimliği Ad Group ID. Search PD Ad düzeyi korunur; ürün satışı alt Ad'lere dağıtılmaz.
- Shopping PD hiyerarşisi Campaign → Ad Group; Channel bağlantı kimliği Ad Group ID. Shopping Ad satırı çıkarılmıştır; bu seviyeye sorgu eklenmeyecek.
- Retail PMax PD hiyerarşisi Campaign → Asset Group; önceki Channel hedefi Asset Group ID olarak korunur. PMax çalışmasına sıra geldiğinde ürün sahibiyle yeniden teyitleşmeden ilerlenmez; bu değişiklik PMax'i uygulamaz veya 11'i açmaz.
- Search Ad Group/Campaign, Shopping Campaign ve Retail PMax Campaign için dokuz metrik de alt kayıtlardan hiyerarşik toplamdır. Campaign'e ait yardımcı conversion-action sorgusu hiyerarşi seviyesi değildir; onun mevcudiyeti yeni hedef toplam kuralını değiştirmez.
- PD Purchase, sağlayıcının satın alma dönüşümü sayısıdır. CPD satılan adet, ürün satış miktarıdır; aynı ölçüm değildir.
- CPD Channel ürün esaslıdır: bağlı ürünlerin metrik toplamlarını gösterir; PD Ad/Ad Group/Asset Group genel değerleri CPD ürün toplamlarının yerine konulmaz.
- Ürün satış değeri ile sağlayıcının genel dönüşüm değerinin vergi/kargo kapsamı eşit varsayılmaz. Kullanıcı örneği: 3.000 ürün + 600 vergi + 300 kargo = 3.900; 300 spend ile genel değer ROAS 13, ürün geliri ROAS 10. Bu açıklama örneği sağlayıcının her yanıtta aynı kapsamı döndürdüğü iddiası değildir.

## Google normal kapsam kararı

08. madde, 22 Ekim 2026 ürün sahibi onayıyla netleşti; 23 Ekim 2026 tarihinde çalışma tablosuna aktarıldı. Karar netleşti; runtime eşlemeleri ve kabul testleri açık.

- PD satış adedi/değeri: normal `conversions` / `conversions_value` içinden Purchase ayrımı. Genel dönüşüm toplamı doğrudan satış sayılmaz.
- CPD satılan ürün adedi/geliri: normal `units_sold` / `revenue_micros`. Sales Role aynı normal kapsamdaki lead/cross-sell adet ve gelir alanlarına dayanır.
- `all_*` alanları standart PD/CPD sonuçlarına eklenmez; normal alan eksikse bunlarla otomatik tamamlama yapılmaz. Ham kaynakta korunmaları bu seçimi değiştirmez.
- PD Purchase sayısı ile CPD ürün adedi eşit sayılmaz. CPD Channel bağlı ürünlerden oluşur; PD genel Ad/Ad Group/Asset Group değeri ürün toplamı yerine geçirilmez.
- Search Ad, Shopping Ad Group ve Retail PMax Asset Group seviyeleri korunur; Campaign değerleri aşağı kopyalanmaz.
- Kabul testleri yalnız normal, yalnız `all_*`, iki ailenin farklı değerleri, eksik normal alan, gerçek sıfır ve çelişkili rol kanıtını ayırır. Çift sayım ve kanıtsız rol üretimi olmaz.

Resmî metrik tanımları, kontrol 23 Ekim 2026: [Google Ads API v25 Metrics](https://developers.google.com/google-ads/api/reference/rpc/v25/Metrics). Kaynak metrik tanımlarını destekler; normal kapsamı seçmek AdsTable ürün kararıdır.

## Google teknik işler ve ertelenen değerlendirme

**23 Ekim Shopping/PMax ürün sorgusu ayrımı:** Ortak ürün sorgusu yerine `shopping_product_daily` yalnız SHOPPING + Ad Group kimliği, yeni `pmax_product_daily` yalnız PERFORMANCE_MAX + mevcut native ürün alanları/metriklerini ister. PMax'te Ad Group veya Asset Group alanı eklenmez. Campaign kaynak bağlamı CPD Channel kararı değildir; Asset Group hedefi değişmedi. Ürün metrikleri/satış ilişkisi veya iki ayrı akış birbirine toplanmaz. Yeni aile eski canlı tetikleyiciye/snapshot'a eklenmedi; eski tetikleyicinin ürün kapsamı Shopping'dir. 10/11 bağlantısı açık, resmî destek teknik yanıtı bekleniyor, 11 tarihsel işi duraklatılmıştır. Sorgu şekli testleri canlı kabul değildir. Resmî [PMax raporlama](https://developers.google.com/google-ads/api/performance-max/reporting) ve [ürün raporlama](https://developers.google.com/google-ads/api/docs/shopping-ads/reporting), 23 Ekim kontrolü.

⁴ **23 Ekim repository sorgu eklemesi:** Search Ad performansı ve üç uçta ayrı dönüşüm eylemi/kategorisi sorguları eklendi. ATC/Checkout/Purchase adet-değerleri normal kapsamda istenir. Performans ve dönüşüm ailesi ayrı olduğundan maliyet kategori satırlarında tekrarlanmaz. Var talebi ifade eder; canlı sorgu/yanıt kabulü, birleşik Dataset satırı ve üst toplamlar değildir.

⁵ **23 Ekim kapsam ayrımı:** PD uç dönüşüm sorgularında PURCHASE normal adet/değer projeksiyonu uygulanmıştır; genel performans `conversions` değeri Purchase yapılmaz. CPD ürün performansındaki ham conversions alanları hâlâ satılan ürün adedi değildir; normal satılan adet/değer için satış ilişkisi kayıtları kullanılır. all alanları ham kaynakta korunur, standart veya eksik normal yedeği olmaz. Gerçek hesap ve birleşik yayın kabulü açık kalır.

⁶ **Hedef toplam ve bağlantı:** CPD Channel ürün toplamları tasarım kararıdır; çalışan toplam veya tam Dataset yayını değildir. Spend/click tekrar sayımı ve ürün kapsamı kontrolü sonraki kapılardadır. 09/12 native bağlantı dilimleri Search ve Shopping satışlarını Ad Group'a bağlar. Search'te bu sorgu yalnız satılan ürün adet/değerini sağlar; ürün Impression/Click/Spend kaynağı burada tamamlanmış değildir. PD Ad metrikleri bu boşluğu doldurmaz ve sıfır üretilmez. Hücredeki toplam hedefi bu alanların kaynakta bulunduğu iddiası değildir.

Açık bağlantıların 22 Ekim kaynak incelemesi: Search→Ad ürün satış bağlantısı tamam değildi; Shopping ürün performansında Ad Group kimliği vardı ancak cart data satışında istenmiyordu; PMax ürün performansı Asset Group'a bağlanmamıştı; PMax satış çözümleyicisi yazılmış ancak reporting akışında çağrılmıyordu. Bu tarihsel kod gözlemidir. 23 Ekim 09 dilimi yalnız Shopping için Ad Group kimlikli satış sorgusu ve native referansı ekler; diğer bağlantılar aşağıdaki durumla açık kalır.

**23 Ekim 09 repository eklemesi:** `readShoppingSourceEvidenceSnapshot`, Shopping PD Ad Group + mevcut ürün performansı + yalnız Shopping filtreli cart data satış ailesini tam/sınırlı sayfalarla okur. Yeni satış sorgusu `ad_group.id/name` ister; genel cart data gövdesi ve eski canlı tetikleyici değişmez. İki cart satış raporu birlikte sayılmaz. Aynı hesap/Campaign/Ad Group/gün için tek PD kaydına kaynak referansı kurulur; ürün performansı ve satış kayıtları ayrı kalır. Metrik kopyası, Channel toplamı, Shopify kimliği/rol veya Dataset yayını değildir. `publishable=false`; 09 canlı kabulü açık.

**10/12 resmî kontrolü ve son karar:** v25 cart data ve shopping performance kaynaklarının segmenting resource listesi Ad Group/Campaign'dir. Satılan `product_sold_item_id` uyum listesinde `ad_group_ad`, ürün `product_item_id` uyum listesinde `asset_group` yoktur. İlk 09 dilimindeki Search→Ad ürün bağlantısı hedefi, ürün sahibinin sonraki açık kararıyla değişti: Search **PD Ad**, **CPD Channel Ad Group**. 12 için Search filtreli cart data sorgusu ve Ad Group referansı repository'de eklendi; Ad seviyesinde ürün attribution iddiası yok. PMax'e güncel ağaçtan tahmin verilmez, 11 duraklaması ve sonraki PMax işinden önce yeniden teyit kapısı korunur. Resmî sayfaların ilgili HTML metadata bölümleri 23 Ekim'de salt okunur incelendi: [cart data v25](https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view), [ürün performansı v25](https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view). Canlı Ads sorgusu değildir.

**12 Search uygulama sınırı:** `readSearchSourceEvidenceSnapshot`, mevcut PD Ad performansı ve ayrı `search_cart_data_product_sales_daily` sorgusunu tam/sınırlı sayfalarla okur. Satış native hesap/Campaign/Ad Group/gün anahtarı ve satılan item ID ile kendi Channel'ını korur; PD bulunması ön koşul değildir. Aynı gruptaki bir veya çok Ad yalnız üst bağlam referansıdır, satışın bu Ad'lere atfedildiği anlamına gelmez. Yinelenen Ad satırı PD bağlamını belirsiz yapar, kesin native satış grubunu silmez. Veri/gelir/maliyet kopyası veya Ad'lere dağıtım yoktur. [Google Search cart data açıklaması](https://support.google.com/google-ads/answer/16564103?hl=en), 23 Ekim kontrolü: satılan ürünler cart data ve Ads hesabına bağlı Merchant Center feed'iyle tanınır. Bu kaynak/kurulum koşulu karşılanmadan gerçek veri kabulü verilmez; hesapta gözlenmiş sayılmaz.

**İş sırası:** Klaviyo sorgu seçimleri sabitlendi. Sıradaki iş, üç sağlayıcının eksiklerini birlikte değerlendirerek doğal olarak sonraya bırakılmış işler, atlanmış/yanlış kurulmuş işler ve yeni tasarım nedeniyle değişecek işleri ayırmaktır. Bu kayıt eksik kodları uygulama yetkisi vermez.

## Klaviyo kabul edilen sorgu seçimleri

- PD Impression karşılığı `delivered`: teslim edilen mesaj sayısıdır, fiziksel görüntülenme kanıtı değildir. `recipients`, `opens` ve `opens_unique` artık bu standart sütun için alternatif değildir; kaynakta korunmaları bu seçimi değiştirmez.
- PD Click `clicks`: toplam tıklama. `clicks_unique` standart Click yerine kullanılmayacak.
- PD Purchase `conversions`, seçili Shopify `Placed Order` metriğinin olay sayısıdır. Değer `conversion_value` alanından gelir; `conversion_uniques` standart Purchase yerine kullanılmayacak.
- CPD satılan ürün adedi `event_properties.Quantity`, satış değeri `event_properties.$value` kaynağından alınır. Sipariş dönüşümü sayısı ve satılan ürün miktarı ayrı tutulur.
- Campaign → Campaign Message ve Flow → Flow Message hiyerarşileri korunur. Channel bağlantı kimlikleri Campaign Message ID ve Flow Message ID'dir. Mevcut `variation` ayrıntısı Message kimliğinin yerine geçirilmez.
- Campaign ve Flow üst metrikleri mesaj kayıtlarından hiyerarşik toplam hedefidir. Spend bu toplam kararına otomatik maliyet hesabı eklemez; ayrıca açık kalır.

## Klaviyo açık işler ve kapsam kararları

23 Ekim rol düzeltmesi (PR #166): Campaign mesaj içeriğinde bulunma, tıklanan ürün kanıtı değildir; içerikteki ve dışındaki ürünler yalnız mesaj atfıyla Assisted kalır. Advertised/Cross-sell için satışa bağlı doğrulanmış ürün etkileşimi gerekir; bu kanıt yolu henüz uygulanmadı. Flow Triggered ve çelişkili kanıtta Unclassified sınırı korunur.

⁷ **Spend açık:** Ürün sahibi şu aşamada hesaplama yapılmamasını, maliyet hesabının sonraki ortak değerlendirmeye bırakılmasını istedi. Önceki estimated-spend/ledger çalışmaları tamamlanmış raporlama hesabı yerine konulmaz. Bu belge yeni formül veya ürün maliyeti dağıtımı belirlemez.

⁸ **23 Ekim repository eklemesi:** Campaign Message ve Flow Message için ayrı Added to Cart / Checkout Started metric ID talepleri ve PD adet/değer eşlemeleri `readPdEvidenceSnapshot` yolunda uygulandı. Placed Order tek başına bu dört alanı karşılamaz; teslim/tıklama yalnız Placed Order raporundan alınır. Var sorgu talebidir; hesapta metric bulunması veya dolu yanıt kabulü değildir. Eksik metric ID için istek gönderilmez, account_configuration_missing korunur. Birleşik Dataset, üst toplam ve gerçek hesap kabulü sonraki kapılardadır; eski canlı tetikleyici genişletilmedi.

⁹ **Ortak ürün satış kaynağı:** Ordered Product olayındaki Quantity ve $value hem ürün performansı hem ürün satış ilişkisini besleyebilir; iki ayrı satış sayılarak toplanmaz. Channel ürün satış toplamları aynı kayıtları bir kez sayar. Bu, kimlik eşlemesi, tarih/attribution kapsamı veya Dataset bağlantılarının tamamlandığı iddiası değildir; bu işler sonraki ortak değerlendirmede ele alınacak.

¹⁰ **N/A kapsam kararı:** Klaviyo CPD ürün Impression ve Click bu aşamada kapsam dışında bırakıldı; ürün link tıklamasını Product ID'ye eşleme veya ürün gösterimi çıkarma geliştirmesi yapılmayacak. N/A sıfır veya sağlayıcının kesinlikle desteklemediği demek değildir. Ürün esaslı CPD Channel bu alanlar için mesaj delivered/click değerini kopyalamaz; bu yüzden ilgili Channel hücreleri de N/A'dır. PD mesaj delivered/click ölçümleri korunur.

## Klaviyo resmî kaynaklar

Kontrol tarihi: 22 Ekim 2026.

- [Reporting API tanımları](https://developers.klaviyo.com/en/reference/reporting_api_overview#available-statistics): delivered, clicks, conversions ve conversion_value anlamları.
- [Link ve ürün satış raporları](https://help.klaviyo.com/hc/en-us/articles/115005258568): link bazlı tıklama ve ürün satışı için Ordered Product ayrımı.
- [Events API](https://developers.klaviyo.com/en/reference/get_events): olay özellikleri kaynağı. Kaynak varlığı N/A kapsam kararını değiştirmez.

## Birlikte ele alınacak maddeler

### 18–19 — İki bağımsız toplama yolu: inceleme taslağı

17'nin PR #174 taslağı main'e alındı; runtime birleşim tamamlanmış değildir. 18–19 ayrıntıları ortak sözleşmenin `hierarchy_channel_review` bölümündedir. Mevcut 13 sütunlu sorgu satırları ve provider hedefleri değişmez.

- 18, birleşmiş PD yapraklarını kendi üst kimliklerine toplar. Parent ve child aynı toplamda tekrar sayılmaz; Campaign yardımcı raporu ilave satış kaynağı olmaz. Klaviyo Variation detayı Message'ta bir kez ele alınır. Oranlar alt oranların toplamı/ortalaması değildir; hesaplama EO-06-A'dadır.
- 19, doğrulanmış ürün performansından Impression/Click/Spend; ürün satışından adet/değer alır. Önce her aile kendi native kayıt kapsamıyla ayrı tekilleştirilip toplanır, sonra Channel seviyesinde ilişkilendirilir. Ham performans ve satış satırları birbirleriyle çarpılmaz. Aynı Product ID'nin farklı native kaynak kayıtları tek ürün diye silinmez; snapshot satır indeksi kalıcı tekilleştirme anahtarı olmaz.
- Yalnız performansı/maliyeti olan ürün ve yalnız satışı görülen ürün korunur. Satış satırı yokluğu tek başına sıfır veya No Conversion kararı değildir. Satılmayan ürünün maliyeti satanlara dağıtılmaz; bir ürünün maliyeti her satışa veya Sales Role'e yeniden yazılmaz. PD toplamıyla CPD toplamının eşit olması şart koşulmaz, aradaki fark ürünlere paylaştırılmaz.
- Google units_sold/revenue_micros toplamı lead/cross-sell detaylarıyla tekrar toplanmaz; genel ve scoped cart raporları birbirine eklenmez. Meta total/promoted alanlarında semantik kabul olmadan toplama/çıkarma yoktur. Klaviyo Ordered Product olayı iki görünümde iki satış olmaz; Placed Order sayısı ürün adedine eklenmez.
- Her metriğin tamlık durumu ayrı korunur: bilinen ara toplam tam toplam değildir; eksik/N/A/boş sıfır yapılmaz. Kaynak para birimi/birim, saat dilimi/raporlama zamanı ve atıf kapsamı uyumlu olmalıdır; FX öncesi farklı para değerleri toplanmaz. Provider atıflı satış toplamı Shopify mağaza satışlarının tekilleştirilmiş gerçeği değildir.
- Shopify kimliği çözülmemiş native kayıt ve bilinen Channel korunur; varyant fiyatından tutar yeniden üretilmez. Meta 05, Klaviyo 15 yeniden tartışması, PMax 10/11 bağlantı ve tarihsel duraklama, 16 kimlik/20–23 uygulama kapıları açıktır. Bu tasarım toplam kodu, DB/FX/formül veya 17–19 kapanışı değildir; ürün sahibi incelemesi beklenir.

### 17 — PD tek kayıt birleşimi: inceleme taslağı

23 Ekim 2026 kod kontrolü: sorgu aileleri ve metrik projeksiyonları var; ortak PD composer henüz uygulanmış değil. Aşağıdaki tasarım mevcut sorguları değiştirmez, yeni kolon/fiziksel tablo seçmez ve 17'yi kapatmaz. Ayrıntı: `contracts/pd-cpd-query-standard-v1.json#pd_composition_review`.

- Meta: Mevcut Ad projeksiyonundaki dokuz PD metriği kullanılır. Ürün kırılımındaki metrikler PD yedeği olmaz.
- Google: Uç performans raporundan Impression/Click/Spend; aynı ucun dönüşüm eylemi raporundan ATC/Checkout/Purchase adet-değer alınır. Eylem/kategori ayrıntısı korunur; ayrık ve tam kaynaklar kanıtlanmadan toplanmaz. Genel conversions Purchase veya all alanı normal yedeği yapılmaz.
- Klaviyo: Placed Order raporundan delivered/clicks/Purchase; Added to Cart ve Checkout Started raporlarından ilgili adet-değerler alınır. Aynı Message/Medium/Variation ayrıntısı karşılaştırılır; Message toplamı her varyanta kopyalanmaz. Spend açık/null kalır.

Tek kayda aday olmak için mevcut canonical kimlik anahtarına ek olarak üst kimlikler, kaynak gün/saat dilimi/raporlama zamanı, para birimi/birim ve atıf kapsamı uyuşmalıdır. Bunlar fiziksel yeni anahtar/kolon ilanı değil, birleşim ön koşullarıdır. Farklı yenilemelerin satırları veya tamamlanmamış aileler tam rapor diye birleştirilmez. Eksik/null/boş/sıfır ayrılır; eksik adet değerden türetilmez, gözlenen diğer metrikleri silmez. Kaynak aile/sorgu/satır izi metrikle korunur; yalnız nihai sayı bırakılmaz.

CPD ürün performansı ve ürün satışı ayrı kalır; PD'yi tamamlamak için kullanılmaz. PMax PD Asset Group raporlarının varlığı, ürün→Asset Group bağlantısını çözmez. Meta 05 gerçek veri kabulü açık; Klaviyo 15 Advertised/Cross-sell kararı yeniden tartışılmadan değiştirilmez. 18 üst hiyerarşi ve 19 ürün esaslı Channel toplamı bu taslakla tamamlanmış değildir. Dataset/FX/formül uygulaması ileriki mevcut paket sırasındadır.

23 Ekim 2026 son kullanıcı incelemesine sunulan çalışma gruplarıdır. Mevcut 24 numara korunur; yeni EO paketi veya toplu uygulama yetkisi oluşmaz. 01–16 kaynak/kimlik/rol tasarımı ve düzeltmeleri; 17–19 bütünleşik tasarım kontrolü; ardından mevcut EO-05/06 paket sırası korunur. Gruplar tek dev PR zorunluluğu değildir; sağlayıcı ve kanıt sınırlarında küçük teslimlere bölünebilir.

| Maddeler | Birlikte yapılacak iş | Sıra ve sınır |
| --- | --- | --- |
| 01 | Sözleşme uyumu | Önce ortak karar ve alan sözleşmesi. Her grupta güncel tutulur; EO-04 düzeltmeleri ile EO-05/06 sahiplikleri karıştırılmaz. |
| 02, 03 | Meta sorgu ve metrik eşlemeleri | 02 + 03 birlikte: promoted alanları ve PD Click/funnel eşlemeleri. EO-04-B düzeltmesi; 24 ile sorgu ve yanıt kanıtı. Kalıcı Dataset yazımı bu grupta yok. |
| 06, 07, 08 | Google sorgu ve normal kapsam | 06 + 07 + 08 birlikte: Search Ad, Shopping/PMax funnel ve normal kapsam Purchase/ürün satış eşlemeleri. EO-04-C düzeltmesi; alan birleşimi doğrulaması ve 24 kabulü. |
| 13, 14 | Klaviyo sorgu ve metrik eşlemeleri | 13 + 14 birlikte: kabul edilen PD alanları ve Message ATC/Checkout talepleri. EO-04-D düzeltmesi; ürün Impression/Click N/A ve Spend açık kalır. |
| 04, 09, 10, 11, 12, 16 | Kaynak ve kimlik bağlantıları | 04 + 09 + 10 + 11 + 12 + 16 birlikte tasarlanır. Provider bağlantı düzeltmeleri EO-04; 16 kalıcı kimlik modeli EO-05-B. 11 tarihsel PMax çalışması ayrı açık onay olmadan başlamaz; kanıtsız Channel atanmaz. |
| 05, 15 | Satış ilişkisi ve Sales Role | 05 + 15 birlikte: Meta ve Klaviyo kanıt/rol kuralları. Google rolü 08 normal kapsam kararıyla uyumlu kalır. Kaynak/kimlik kanıtlarına bağlı EO-04-B/D düzeltmeleri; tek ortak rol tanımı. |
| 17, 18, 19 | Bütünleşik tasarım kontrolü | 17 + 18 + 19 birlikte tasarım kontrolü; provider gruplarından sonra. Bağımsız PD/CPD, üst hiyerarşi ve ürün esaslı Channel onayı. Kayıt/yayın EO-05-B; aggregate-first hesaplama EO-06-A. Paketler erkene alınmaz. |
| 20, 22 | Dataset ve FX | 20 + 22 birlikte EO-05-B: Dataset aileleri, anahtarlar, kaynak para birimi ve FX izi; 16 kimlik tasarımını kullanır. 20'nin idempotent upsert/düzeltme kısmı EO-05-D'de, 21 ile birlikte ele alınır. |
| 21 | Tarih ve uzlaştırma | 21: EO-05-C'de attribution/olgunluk; EO-05-D'de 20'nin tekrar yazma ve düzeltme kısmıyla birlikte. 20'nin veri modeliyle karıştırılmaz; Klaviyo tarih ve gün sınırı testleri korunur. |
| 23 | Formula Engine | 23 ayrı EO-06-A sırasında uygulanır. 20 + 22 ile veri/FX sözleşmesi birlikte tasarlanır; formül kodu erkene alınmaz. 18/19 aggregate-first kuralları kullanılır. Klaviyo Spend için yeni formül onaylanmış değildir. |
| 24 | Her aşamada kanıt ve kabul | 24 tüm gruplara eşlik eder; sona bırakılmaz. Her grubun sorgu/ham yanıt, tamlık, tekrar ve hata testleri; EO-08 sonundaki gerçek hesap kontrolü ayrı kapıdır. Canlı çağrı ayrıca açık yetki gerektirir. |

20'nin veri modeli EO-05-B, idempotent upsert ve uzlaştırması EO-05-D sahibindedir. 16, 20, 21, 22 ve 23'ün mevcut paket kapıları korunur. EO-05-A kapanışı veya EO-05-B başlangıcı verilmez. 11'in durdurulmuş tarihsel kanıt işi kendiliğinden açılmaz; kanıtsız Channel için geçerli satış korunur.

## Yetki ve sonraki adım

### Kaynak ve kimlik grubu — 23 Ekim 2026 ilk dilim

04 + 09 + 10 + 11 + 12 + 16 birlikte tasarlanır; aynı anda tamamlanmış sayılmaz. Ortak sözleşme `source_link_design` bölümüdür. Bağlantı anahtarı metrik değildir: PD performansı, CPD ürün performansı ve ürün satışı kendi kaynak ailelerinde kalır; birinden diğerine değer kopyalanmaz.

| Madde | Mevcut kanıt / hedef bağlantı | Bu dilim ve açık sınır |
| --- | --- | --- |
| 04 | Meta ürün sorgusu hesap/Campaign/Ad Set/Ad/gün kimliklerini zaten ister; hedef Ad referansı | Tam snapshot'ta yerel native Ad referansı uygulandı. Tek eşleşme ve aynı üst kimlikler gerekir. Eksik/yinelenen/çelişkili kayıt seçilmez. Katalog/creative, Shopify kimliği, satış rolü, ürün maliyet anlamı ve canlı kabul açık; 04 kapanmadı. |
| 09 | Shopping ürün performansında Ad Group var; 23 Ekim eklenen Shopping cart data sorgusu da Ad Group ister | Tam snapshot native Ad Group referansı repository'de uygulandı. Genel cart raporu korunur, iki rapor toplanmaz. Canlı kabul, Shopify kimliği ve Dataset yayını açık. |
| 10 | PMax ürün performansı `shopping_product_daily` içinde; v25 doğrudan Asset Group kırılımı yok | Ürün→Asset Group kanıt yolu açık. Ürün grubu toplamı tekil ürün performansı sayılmaz. Tarihsel 11 rotası duraklatılmıştır; bu dilimde çözümleyici eklenmedi. |
| 11 | Satış çözümleyicisi mevcut; reporting akışında çağrılmıyor; tarihsel tam gün kanıtı gerekiyor | Tarihsel listing tree işi duraklatılmıştır. Kayıt toplama/saklama ve çözümleyici entegrasyonu başlamadı. Güncel ağaç geçmiş güne yedek olmaz. |
| 12 | Ürün sahibi Search PD Ad / CPD Channel Ad Group ayrımını onayladı; Search cart data sorgusu Ad Group ister | Native satış→Ad Group referansı repository'de eklendi. Ad'ler yalnız aynı üst bağlamı paylaşır; ürün satışı Ad'lere dağıtılmaz. Canlı kabul/Shopify kimliği/Dataset açık. |
| 16 | Shopify Product ID raporlama omurgası; varsa Variant ID kaynak ayrıntısı | Mantıksal kimlik kapsamı aşağıda; okuyucu, kalıcı model ve doğrulama EO-05-B kapısında. Native kayıt kaybolmaz; örüntü/SKU/ad/fiyatla eşleme yapılmaz. |

Bağlantı kapsamı workspace + aktif kurulum + provider + doğrulanmış hesaptır. Aynı kaynak yaprak kimliği ve iş günü için üst hiyerarşi tutarlı olmalıdır. Satır indeksi yalnız tam snapshot içindeki kaynak kaydı gösterir; kalıcı anahtar veya tabloların fiziksel birleşimi değildir. Ürün satırının native Channel referansı kurulsa bile Shopify Product ID çözülmüş sayılmaz; çözülemeyen ürün kimliği native kaynak bağlantısını tek başına iptal etmez. Metrik toplamı/FX/tarih uzlaştırması 17–23 sırasındadır.

16 için mantıksal eşleme kapsamı workspace, provider, doğrulanmış hesap, katalog/feed bağlamı ve ham ürün kimliğidir. Doğrulanmış resmî entegrasyon kaynağı ve Shopify ürün/varyant ilişkisi olmadan Shopify ürün etiketi yayımlanmaz. Katalog/feed bağlamı eksikse farklı kataloglara bakılarak tahmin yapılmaz. Varyant ayrı raporlama omurgası yapılmaz; varsa doğrulanmış ayrıntı olarak korunur. Kaynak fiyat farkları kimlik kanıtı veya satış değerinin yerine geçirilmez. Çelişkili eşlemede tek bir Shopify Product ID seçilmez; native ürün, satış ve maliyet kanıtı korunur. Gerekli izin/hesap erişimi her kimlik okuyucusunun resmî kontrolünde belirlenecek; bu tasarım mevcut Ads iznini katalog erişimi saymaz veya yeni izin eklemez. Fiziksel kolonlar/indeksler ve okuyucular uygulanmış değildir.

Klaviyo'nun mevcut Message/Variation attribution yolu bu dilimde değişmez. Message bağlantısı ürün etkileşimini kanıtlamaz; ürün Impression/Click N/A ve Spend açık kalır.

Resmî kontrol, 23 Ekim 2026: [Meta SDK Insights alanları](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/adsinsights.py), [Klaviyo Reporting Overview](https://developers.klaviyo.com/en/reference/reporting_api_overview). Google v25 `cart_data_sales_view` ve `shopping_performance_view` alan sayfaları içerik boyutu sınırı nedeniyle okuma aracında alınamadı; başka rota denenmedi. Google satırları mevcut kod/tasarım durumunu bildirir, yeni alan kombinasyonunun resmî doğrulaması değildir. SDK'da alan bulunması gerçek katalog yanıtı veya satış semantiği kabulü değildir.

Önce üç sağlayıcının teorik sorgu standardı netleştirilecek; kod ve DB bundan sonra ele alınacak. Bu kayıt runtime, DB, provider çağrısı, OAuth, deploy veya merge yetkisi vermez. Shopify üzerinde görsel işlem yapılmayacak.

Bağlayıcı üst belgeler `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` olarak kalır. Bu çalışma referansı yürütülebilir sözleşmeleri değiştirmez.
