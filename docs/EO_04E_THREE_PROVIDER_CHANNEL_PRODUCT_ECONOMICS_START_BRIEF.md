# EO-04-E three-provider Channel and product-economics start brief

## Belge durumu

- Paket: `A6-EO-04-E`
- Durum: `accepted_product_owner_meta_and_klaviyo_repository_runtime_authorized_live_calls_closed`
- Kontrol tarihi: 16 Ekim 2026
- Ürün sahibi sözleşme kabulü: 16 Ekim 2026
- Executable contract: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`
- CI enforcement: `tests/eo-04e-three-provider-channel-product-economics.test.js`
- 17 Ekim 2026 itibarıyla Meta ve Klaviyo repository runtime paketleri ayrıca yetkilendirilmiştir. Canlı provider çağrısı, Dataset V2, migration, secret, environment veya deployment değişikliği hâlâ ayrı açık onay gerektirir.

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

Channel, providerın doğruladığı iş raporlama entity'sidir; her provider altındaki en derin teknik dimension otomatik olarak Channel sayılmaz:

- Meta: `Ad`
- Google Standard Shopping: `Ad Group`
- Google Performance Max Retail: `Asset Group`
- Google Search: `Ad Group`
- Klaviyo Campaign: `Campaign Message`
- Klaviyo Flow: `Flow Message`

Klaviyo `send_channel` zorunlu ayrı `Medium` eksenidir (`Email`, `SMS`, `WhatsApp`, `Push`). Variation, Message Channel'ın alt kırılımıdır; Channel'ın yerine geçmez.

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
7. Desteklenen kimlik yolu resmî Shopify `Facebook & Instagram` satış kanalıdır. Provider ürün kimliğinden elde edilen Shopify product ID + variant ID adayları Shopify Admin API ile doğrulanır; variant'ın product'a ait olduğu kanıtlanmadan SKU, ürün adı veya varyant adı yayımlanmaz.
8. Meta product ID biçimi veya eşlemesi doğrulanamazsa provider ID kaybedilmez fakat Shopify ürünü uydurulmaz. Özel pixel, manuel katalog ve üçüncü taraf katalog bu sürümün kapsamı dışındadır.

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

| Campaign yapısı | Channel | Medium / Variation | Sold-product attribution | Sonuç |
| --- | --- | --- | --- | --- |
| Tek variation | Campaign Message | `send_channel` zorunlu; Variation ayrı exact kırılım olabilir | Event Campaign Message'a bağlı | Satış exact Message Channel altında korunur |
| A/B veya çoklu variation | Campaign Message | Medium zorunlu; exact Variation yoksa yalnız Variation unresolved | Event Campaign Message'a bağlı | Satış exact Message Channel altında korunur; `Unknown Channel` oluşmaz |

Klaviyo `2026-10-15` GA sözleşmesinde Campaign Message reporting'in zorunlu kimliğidir; `send_channel` Medium'dur ve Variation isteğe bağlı alt boyuttur. Event attribution Campaign Message'ı içerir fakat Campaign Variation'ı içermez. Bu asimetri Message Channel'ı bozmaz; yalnız Variation çözünürlüğünü sınırlar.

### Flow

1. Flow, trigger, split ve delay Channel değildir.
2. Channel her zaman `Flow Message`tır.
3. Attribution `Flow Message Variation` döndürürse Variation'ın parent Flow Message'ı Channel olarak çözülür; Variation ayrıca exact tutulur.
4. Variation attribution yok fakat `Flow Message` attribution varsa Channel exact Flow Message, Variation unresolved olur.
5. Bu attribution ile gelen sold product `Triggered` olur.
6. Attribution çelişkiliyse ürün `Unclassified`; Message çözülemiyorsa `Unknown Channel` altında korunur.

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

## Ad Cost yaşam döngüsü

Kullanıcı-facing nihai terim `Ad Cost` olacaktır. Fakat aşağıdaki üç teknik değer birbirinin yerine kullanılamaz:

1. **Channel Ad Cost:** Providerın gerçek Channel grain'inde döndürdüğü spend/cost.
2. **Provider Product Ad Cost:** Providerın kendi attribution mantığıyla bir ürün satırına yazdığı cost.
3. **Allocated Ad Cost:** EO-05'in kabul edilmiş formülle Channel veya ürünlere dağıtacağı maliyet. Provider gerçeği değildir ve provenance'ı ayrı kalır.

| Provider | EO-04'te alınacak maliyet kanıtı | Ürün satırında `Ad Cost` koşulu | EO-05'e bırakılan işlem |
| --- | --- | --- | --- |
| Meta | Ad seviyesinde exact spend; product breakdown spend yalnız gerçek katalog cevabıyla doğrulanırsa ayrı provider-product kanıtı | Yalnız product-grain semantiği canlı kabul edilmiş ve Shopify product/variant kimliği doğrulanmışsa; Sales Role exact değeri değiştirmez | Provider product cost bulunmayan satırlara Ad toplamının tahminî dağıtımı, blended ve gerçek ürün maliyeti |
| Google Ads | Ad Group/Asset Group Channel cost ve `shopping_performance_view.metrics.cost_micros` provider-product kanıtı | Google item kimliği resmî Shopify sync yoluyla product/variant'a doğrulanmışsa provider product cost `Ad Cost` girdisi olur | Provider product cost bulunmayan satırlara tahminî dağıtım, blended ve gerçek ürün maliyeti |
| Klaviyo | Effective-dated Estimated 30-Day Email Spend ledger | EO-04'te Campaign/Flow/Variation/product Ad Cost yoktur | Estimated spend'in zaman, Campaign, Flow, Channel veya ürüne dağıtımı |

Bağlayıcı Ad Cost kuralları:

1. EO-04 cost üretmez; providerın açıkça döndürdüğü değer veya Klaviyo'nun kullanıcı tarafından girilmiş effective-dated estimated-spend kanıtını alır.
2. Explicit provider zero `0` olarak korunur. Missing, null, unsupported, permission-denied veya validation-pending değer sıfıra çevrilmez.
3. Cost her zaman provider account, business date/time window, source currency, source timezone, API revision, query ve attribution provenance'ıyla taşınır.
4. Shopify product/variant kimliği doğrulanamasa bile provider ürün kimliği ve cost kanıtı kaybedilmez; yalnız Shopify SKU/ad/varyant etiketi yayımlanmaz.
5. Channel cost, product cost satırlarının toplamından yeniden üretilmez. Product satırları impression veya provider attribution nedeniyle üst toplamı aşabilir.
6. Product cost yoksa Channel cost ürünlere eşit, revenue, click, quantity veya başka oranla dağıtılmaz.
7. Provider ürün bazında exact Ad Cost veriyorsa bu kanıt; ürünün Sales Role'ü `Cross-sell` veya `Assisted`, modifier'ı `Zero Value` ya da Channel sonucu `Unknown Channel` olsa bile aynı ürün satırında korunur. Sales Role, modifier veya çözülemeyen Channel exact provider cost'u silemez.
8. Provider ürün bazında cost vermiyorsa Channel toplam cost'u ürünlere eşit, sales, revenue, click, quantity, Sales Role veya başka bir oranla tahminî dağıtılmaz.
9. `Unknown Channel` ürününün exact provider product cost'u korunur; fakat ürün ve cost bilinen bir Asset Group, Ad Group, Ad veya Variation'a tahminle taşınmaz.
10. Klaviyo `Triggered` ürünlerinde provider-native product cost bulunmaz. Estimated Spend'den allocation yalnız EO-05'in kabul edilmiş formülüyle üretilebilir.
11. Klaviyo Update spend ve Change value geçmişi effective-dated ledger'da korunur; EO-05 allocation geçmiş girdiyi sessizce yeniden yazamaz.
12. Refresh ve reconciliation maliyet kanıtını performans kanıtıyla aynı truthful snapshot ilkelerine göre yeniden okuyabilir; çalışma sıklığı ve kota bütçesi EO-05'tedir.
13. Vergi, kargo, platform ücreti, attribution overlap ve blended/true cost formülleri EO-05 analist sözleşmesi olmadan `Ad Cost` içine eklenmez.
14. EO-07 UI, kabul edilmiş maliyet alanını kullanıcıya `Ad Cost` etiketiyle gösterir; source/provenance ayrımı detay yüzeyinde kaybolmaz.

Örnek: Google, Kolye B için exact provider product Ad Cost olarak `₺18` döndürürse bu değer Kolye B satırında korunur. Ürün `Cross-sell` ise `Cross-sell + ₺18`, exact Channel çözülemiyorsa `Unknown Channel + ₺18`, ürünün sales değeri sıfırsa `Zero Value + ₺18` gösterilir. Buna karşılık provider yalnız Ad/Ad Group/Asset Group toplamı olarak `₺500` döndürüyorsa bu tutar ürünlere keyfî olarak bölünmez.

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
4. Klaviyo Campaign Message Channel olarak kalır; multi-variation yalnız Variation'ı unresolved bırakır ve Message biliniyorsa `Unknown Channel` üretmez.
5. Klaviyo Flow Message Channel olarak kalır; Flow Message Variation parent Message'a çözülür ve ayrı Variation kanıtı olarak korunur.
6. `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve gerçek ambiguity için `Unclassified` ayrımı çalışır.
7. `Zero Value` role değildir; modifier'dır.
8. Provider product cost ile Channel spend ve gelecekteki blended/true cost birbirine dönüştürülmez.
9. Kimliği doğrulanmamış ürün SKU/name olarak yayımlanmaz; ham provider ID ve provider cost kanıtı kaybedilmez.
10. Channel Ad Cost, Provider Product Ad Cost ve Allocated Ad Cost birbirine dönüşmeden ayrı kalır.
11. Exact provider product cost; `Cross-sell`, `Assisted`, `Zero Value` veya `Unknown Channel` altında da aynı ürün satırında korunur.
12. Product cost yokken Channel cost ürünlere dağıtılmaz; explicit zero dışındaki state'ler sıfır olmaz.
13. Synthetic fixture yalnız contract davranışını kanıtlar; canlı provider gerçeği olarak sunulmaz.

## Açık kabul ve uygulama kapıları

1. **PASS — 16 Ekim 2026:** Ürün sahibi bu brief ve executable contract'ı açıkça kabul etti.
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

