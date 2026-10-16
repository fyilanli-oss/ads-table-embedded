# EO-04-E three-provider Channel and product-economics start brief

## Belge durumu

- Paket: `A6-EO-04-E`
- Durum: `ready_for_product_owner_acceptance`
- Kontrol tarihi: 16 Ekim 2026
- Executable contract: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`
- CI enforcement: `tests/eo-04e-three-provider-channel-product-economics.test.js`
- Bu brief kabul edilmeden provider reporting runtime'ı, canlı provider çağrısı, Dataset V2, migration, secret, environment veya deployment değişikliği yapılamaz.

## İş çıktısı ve paket sınırı

EO-04, providerların gerçekten verdiği ham kimlikleri, metrikleri ve exact ilişkileri toplar. EO-04:

- Meta, Google Ads ve Klaviyo için gerçek `Channel` leaf'ini belirler;
- advertised-product kanıtını, sold-product kanıtını ve Channel çözümünü birbirinden ayırır;
- yalnız providerın açıkça kanıtladığı `Sales Role` ve `Zero Value` durumunu üretir;
- provider maliyetini tahminî dağıtmaz;
- ham kanıtı EO-05 Dataset V2'nin kullanabileceği şekilde truthful ve provenance'lı bırakır.

EO-05 Dataset V2; canonical satırları, hesaplamaları, maliyet dağıtımını, reconciliation ve kalıcı veri modelini kurar. EO-07 kullanıcı arayüzünü kurar. Bu brief bu iki paketin işini öne çekmez.

## Ortak sözlük

### Channel

Channel, providerın doğrulayabildiği en alt gerçek raporlama leaf'idir:

- Meta: `Ad`
- Google Standard Shopping: `Ad Group`
- Google Performance Max Retail: `Asset Group`
- Google Search: `Ad Group`
- Klaviyo Campaign: `Campaign Variation`
- Klaviyo Flow: attribution varsa `Flow Message Variation`, yoksa `Flow Message`

Campaign, Ad Set, Flow, trigger, split ve delay tek başına Channel değildir.

### Sales Role

- `Advertised`: Satılan ürün, exact advertised-product kanıt kümesindedir.
- `Cross-sell`: Exact advertised-product kümesi bilinmektedir ve satılan ürün bu kümenin dışındadır.
- `Assisted`: Provider satışı Channel bağlamına bağlamıştır fakat içerik tek bir advertised ürünü kanıtlamaz; genel mağaza, kategori, dinamik/geniş küme veya Search gibi senaryolar buna dahildir.
- `Triggered`: Klaviyo Flow Message veya Flow Message Variation attribution'ı ile gelen satılan üründür.
- `Unclassified`: Kanıt gerçekten çelişkili veya belirsizdir. Exact ürün kanıtı bulunmamasının varsayılan adı değildir.

### Ayrı eksenler

- `Zero Value`, Sales Role değildir. Satılan adet pozitif ve provider ürün satış değeri açıkça sıfırsa role `Zero Value` modifier'ı eklenir.
- `Unknown Channel`, Sales Role değildir. Satış kanıtı vardır fakat exact Channel çözülememiştir.
- Eksik, null, unsupported, permission-denied ve explicit zero birbirine dönüştürülemez.

## Meta sözleşmesi

| Kampanya/creative yapısı | Channel | Advertised-product kanıtı | Sold-product sonucu | Sales Role |
| --- | --- | --- | --- | --- |
| Tekil exact ürün creative'i | Ad | Exact `product_id` / `product_item_id` | Aynı ürün | Advertised |
| Exact çoklu ürün creative'i | Ad | Exact `retailer_item_ids` veya eşdeğer açık liste | Liste içindeki ürün | Advertised |
| Exact çoklu ürün creative'i | Ad | Exact açık liste | Liste dışındaki ürün | Cross-sell |
| Product set, kategori, dinamik veya generic creative | Ad | Tekil ürün exact değil | Provider-attributed sold product | Assisted |
| Çelişkili kimlik/kanıt | Ad veya çözülebildiği bağlam | Çelişkili | Sold product korunur | Unclassified |

Bağlayıcı sınırlar:

1. Campaign ve Ad Set yalnız hiyerarşi bağlamıdır; Channel `Ad`dır.
2. Mevcut scope `ads_read` olarak kalır. `catalog_management` veya başka katalog/business izni istenmez.
3. Ad seviyesindeki impression, click ve spend exact Channel toplamıdır.
4. `product_id` breakdown içinde providerın gerçekten döndürdüğü product metrics ayrı ham kanıt olarak korunur.
5. Product breakdown içindeki impression/click/spend semantiği gerçek katalog reklamı cevabıyla doğrulanmadan `Ad Cost` veya gerçek ürün maliyeti sayılmaz.
6. Ad spend ürünlere oranlanmaz veya paylaştırılmaz.
7. Desteklenen kimlik yolu resmî Shopify `Facebook & Instagram` satış kanalıdır. Özel pixel, manuel katalog ve üçüncü taraf katalog bu sürümün kapsamı dışındadır.

## Google Ads sözleşmesi

| Kampanya ailesi | Channel | Listing yapısı | Sold-product sonucu | Sales Role |
| --- | --- | --- | --- | --- |
| Standard Shopping | Ad Group | Tekil veya çoklu Merchant Center ürünleri | Exact Ad Group bağlamındaki sold product | Advertised / Cross-sell / Assisted kanıta göre |
| Performance Max Retail | Asset Group | Ürün yalnız bir Asset Group listing ağacına exact uyuyor | Exact Asset Group altında sold product | Advertised / Cross-sell kanıta göre |
| Performance Max Retail | Asset Group | Ürün birden fazla Asset Group'a uyuyor veya exact üyelik kanıtlanamıyor | Sold product `Unknown Channel` altında kalır | Provider ilişki kanıtı korunur; tahmin yapılmaz |
| Search | Ad Group | Exact advertised product yok | Provider-attributed sold product | Assisted |

Bağlayıcı sınırlar:

1. `segments.product_item_id` advertised/clicked ürün; `segments.product_sold_item_id` sold-product kanıtıdır.
2. Standard Shopping için Channel `Ad Group`, PMax Retail için `Asset Group`, Search için `Ad Group`tır.
3. `cart_data_sales_view` Campaign ve Ad Group ile segmentlenebilir; Asset Group ile segmentlenemez. Google'ın vermediği PMax Asset Group ilişkisi aşağıya dağıtılmaz.
4. PMax listing-tree üyeliği yalnız tek Asset Group'u exact belirliyorsa Channel exact olur; aksi halde `Unknown Channel` kullanılır.
5. Search satışı bastırılmaz. Exact advertised product kanıtı olmadığı için provider-attributed sold product `Assisted` olur.
6. Provider product cost, Channel spend ve ilerideki gerçek/blended ürün maliyeti ayrı değerlerdir. Google'ın `cost_micros` değeri yalnız provider attribution kanıtıdır.
7. Desteklenen ürün kimliği yolu Shopify'ın resmî `Google & YouTube` otomatik ürün senkronudur. Google item ID'deki Shopify product/variant adayları Shopify Admin API ile doğrulanmadan SKU veya ürün adı yayımlanmaz.
8. Manuel Merchant Center feed'i ve üçüncü taraf feed bu sürümün kapsamı dışındadır.

## Klaviyo sözleşmesi

### Campaign

| Campaign yapısı | Channel | Performance | Sold-product attribution | Sonuç |
| --- | --- | --- | --- | --- |
| Tek variation | Tek Campaign Variation | Variation performance exact | Event Campaign Message'a bağlı | Tek variation'a exact bağlanabilir |
| A/B veya çoklu variation | Her Campaign Variation ayrı Channel | Variation performance exact | Event yalnız Campaign Message'a bağlı | Ürün herhangi bir variation'a dağıtılmaz; `Unknown Channel` altında Message bağlamıyla korunur |

Klaviyo `2026-10-15` GA sözleşmesinde Campaign Variation gerçek resource ve reporting dimension'dır. Ancak Event attribution ilişkisi Campaign Message'ı içerir, Campaign Variation'ı içermez. Bu asimetri tahminle kapatılamaz.

### Flow

1. Flow, trigger, split ve delay Channel değildir.
2. Attribution `Flow Message Variation` döndürürse Channel odur.
3. Variation attribution yok fakat `Flow Message` attribution varsa Channel Flow Message'dır.
4. Bu attribution ile gelen sold product `Triggered` olur.
5. Attribution çelişkiliyse ürün `Unclassified`; exact Channel çözülemiyorsa `Unknown Channel` altında korunur.

### Campaign Sales Role

- Exact tek ürün içeriği veya exact ürün listesi varsa: `Advertised` / `Cross-sell`.
- Genel mağaza, kategori, dinamik/geniş içerik veya tekil ürün kanıtı olmayan provider-attributed sale: `Assisted`.
- Gerçek kanıt çelişkisi: `Unclassified`.
- Pozitif quantity ve explicit zero value: mevcut role + `Zero Value`.

### Klaviyo günlük grain ve kota

1. Campaign Reporting API aggregate values verir; var olmayan bir Campaign series cevabı üretilmez.
2. Günlük business-date gerekiyorsa her gün için ayrı tek-gün timeframe sorgusu yapılır.
3. İlk bootstrap ortak EO-04-A sırasına göre yalnız dün, sonra bugündür.
4. Campaign Values düşük kota sınıfı (`1/s`, `2/min`, `225/day`) korunur; sayfalama ve retry bu kotayı aşamaz.
5. Saatlik refresh, reconciliation penceresi ve workspace ölçek kota hesabı EO-05 sorumluluğudur.
6. Flow Series'in bulunması Campaign için series varmış gibi davranma yetkisi vermez.

### Klaviyo kimlik ve maliyet sınırı

- Desteklenen yol Klaviyo'nun resmî Shopify entegrasyonudur.
- Ordered Product event'inde gerçekten dönen ProductID, SKU, ProductName, Quantity ve value ham kanıt olarak alınır; hesap özel property adları gözlemle doğrulanır.
- Estimated 30-Day Email Spend defteri EO-04-D'de korunur fakat Campaign/Flow/Message/Variation veya ürüne dağıtılmaz. Dağıtım EO-05 kararıdır.

## Ortak ham kanıt zarfı

Her provider satırı aşağıdaki sınıfları taşıyabilir; provider-native alan adı ve raw reference kaybedilmez:

1. Installed Shopify Store ve workspace authority
2. Provider, source system, verified account ve Reporting Account bağlamı
3. Business date, source timezone, currency ve request window
4. Campaign ve provider hiyerarşi kimlikleri/adları
5. Channel type, ID, name ve çözüm durumu (`exact` / `unknown`)
6. Advertised-product kanıtı, kanıtın exact/incomplete/unavailable durumu ve kaynak alanı
7. Sold-product ID, title/name, SKU, quantity ve value; yalnız providerın döndürdüğü kadarıyla
8. Sales Role ve Zero Value modifier; yalnız kanıtla
9. Channel metrics ve varsa provider product metrics; birbirine karıştırılmadan
10. Support/observation state, API revision, adapter version, request/query provenance ve sanitized raw reference

## EO-04-E kabul matrisi

Provider-isolated ve combined deterministic acceptance aşağıdakileri kanıtlamalıdır:

1. Meta Channel daima Ad olarak kalır.
2. Google Standard Shopping, PMax Retail ve Search farklı gerçek Channel leaf'lerini korur.
3. PMax ambiguous listing membership `Unknown Channel` üretir ve satış dağıtılmaz.
4. Klaviyo single-variation Campaign exact; multi-variation Campaign ürün attribution'ı `Unknown Channel` davranışı üretir.
5. Klaviyo Flow Message Variation/Message attribution sırası korunur.
6. `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve gerçek ambiguity için `Unclassified` ayrımı çalışır.
7. `Zero Value` role değildir; modifier'dır.
8. Provider product cost ile Channel spend ve gelecekteki blended/true cost birbirine dönüştürülmez.
9. Kimliği doğrulanmamış ürün SKU/name olarak yayımlanmaz; ham provider ID kaybedilmez.
10. Synthetic fixture yalnız contract davranışını kanıtlar; canlı provider gerçeği olarak sunulmaz.

## Açık kabul ve uygulama kapıları

1. Ürün sahibi bu brief ve executable contract'ı açıkça kabul eder.
2. Meta, Google ve Klaviyo provider-data runtime'ları ayrı child paket sahipliğinde uygulanır; bir provider düzeltmesi diğerini değiştirmez.
3. İlk provider hatasında durulur; sonraki provider'a ilerlenmez.
4. Gerçek provider response gerektiren capability alanları `validation_pending` kalır; synthetic test ile `supported` yapılamaz.
5. Her providerın küçük kontrollü canlı kanıtı ayrıca ürün sahibi onayıyla yapılır.
6. EO-04-E final PASS; repository, provider-isolated canlı kanıt ve combined non-fabricated acceptance birlikte görülmeden verilemez.

## Resmî kaynaklar — 16 Ekim 2026

- Klaviyo changelog: <https://developers.klaviyo.com/en/docs/changelog_>
- Klaviyo Omnichannel Campaign API: <https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview>
- Klaviyo Reporting API: <https://developers.klaviyo.com/en/reference/reporting_api_overview>
- Klaviyo Events API: <https://developers.klaviyo.com/en/reference/get_events>
- Klaviyo Campaign Variation: <https://developers.klaviyo.com/en/reference/get_campaign_variation>
- Google Shopping reporting: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- Google Performance Max Asset Group reporting: <https://developers.google.com/google-ads/api/performance-max/asset-group-reporting>
- Shopify Google product sync: <https://help.shopify.com/en/manual/online-sales-channels/marketplaces/google/getting-setup/syncing-products>
- Meta official Business SDK Ads Insights fields: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta official Business SDK Ad Creative fields: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py>


