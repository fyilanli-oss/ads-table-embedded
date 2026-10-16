# EO-04-E Google Channel çalışma taslağı

## Belge durumu

- Durum: **Araştırma kaydı; 16 Ekim 2026 ortak brief'i tarafından supersede edildi**
- Kontrol tarihi: **16 Ekim 2026**
- Sahiplik bağlamı: A6-EO-04-E
- Bu belge bir executable contract, kabul kapısı veya implementasyon yetkisi değildir.
- EO-04-E, Dataset V2, Channel UI veya başka bir paketin başlamasını ya da kapanmasını engellemez.
- Provider çağrısı, runtime kodu, migration, secret, environment veya deployment değişikliği yetkilendirmez.
- Bağlayıcı karar: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`.

## Amaç

Google Ads tarafında Channel kimliğini, provider ürün performansını, satılan ürünü ve ileride hesaplanacak gerçek ürün maliyetini birbirine karıştırmadan tanımlamak; daha sonra Meta ve Klaviyo ile ortak sözleşme kurulurken doğrulanmış Google sınırını korumak.

## Çalışma taslağı Channel matrisi

| Google kampanya ailesi | Channel adayı | Listing yapısı | Ürün-Channel sonucu | Satış ilişkisi |
| --- | --- | --- | --- | --- |
| Standard Shopping | Ad Group | Tekil veya çoklu Merchant Center ürünleri | Product performance ve Cart Data Ad Group bağlamında korunur. | Kanıtlanan lead/advertised ürün Advertised; farklı sold product Cross-sell. |
| Performance Max Retail | Asset Group | Listing-tree leaf tekil item ID ve üyelik yalnız bir Asset Group'u exact belirliyor | Product satırı exact Asset Group'a bağlanabilir. | Advertised veya Cross-sell provider kanıtına göre korunur. |
| Performance Max Retail | Asset Group | All products, kategori, marka, product type, custom label veya birden fazla Asset Group'a uyan ürün | Campaign-product kanıtı vardır; exact Asset Group kanıtı yoktur. | Ürün Unknown Channel altında kalır; ilişki kanıtı varsa korunur, tahmin yapılmaz. |
| Search | Ad Group | Exact advertised product kanıtı yok | Provider-attributed sold product Ad Group bağlamında korunur. | Assisted |

## Temel çalışma kuralları

1. Channel kimliği, provider ürün performansı ve satılan ürün kimliği ayrı gerçeklerdir.
2. Reklamda gösterilen veya tıklanan ürün tarafı `segments.product_item_id` ile temsil edilir.
3. Gerçekten satılan ürün tarafı `segments.product_sold_item_id` ile temsil edilir.
4. Aynı Cart Data satırında gösterilen/tıklanan ürün ile satılan ürün farklıysa, satılan farklı ürün Cross-sell kanıtıdır.
5. PMax'te `cart_data_sales_view` Asset Group ile segmentlenmez. Google'ın vermediği Asset Group ilişkisi oranlanmaz, paylaştırılmaz veya üretilmez.
6. PMax'te tıklanan ürünün listing-tree üyeliği yalnız tek bir Asset Group'u exact belirliyorsa o Asset Group Channel adayıdır.
7. Ürün birden fazla Asset Group listing ağacına uyuyorsa veya exact üyelik kanıtlanamıyorsa Channel `Unknown Channel` olur.
8. `Unknown Channel`, satış ilişkisinin değil Channel çözümlemesinin durumudur.
9. Search Ad Group için exact advertised product kanıtı bulunmadığından provider-attributed sold product bastırılmaz; `Assisted` olur.
10. Promotion terimi kullanılmaz. Satılan adet pozitif ve ürün satış değeri gerçekten sıfırsa değer durumu `Zero Value` olur.
11. Google ürün seviyesinde ham olarak `units_sold` ve `revenue_micros` sağlar. `units_sold`, ortak Dataset sözleşmesi kararı olmadan kullanıcıya Purchase diye yeniden adlandırılmaz.
12. Desteklenen kimlik yolu Shopify'ın resmî Google & YouTube otomatik ürün senkronudur. Google item ID içindeki Shopify product/variant adayları Shopify Admin API ile doğrulanmadan SKU veya ürün adı yayımlanmaz. Manuel/üçüncü taraf feed kapsam dışıdır.

## Performans ve maliyet katmanları

Aşağıdaki üç değer birbirinin yerine kullanılamaz:

1. **Channel Spend:** Provider'ın gerçek Channel toplamı.
2. **Provider Product Cost:** Google'ın ürün raporlama attribution mantığıyla ürüne yazdığı `metrics.cost_micros`.
3. **Allocated True Product Cost:** Vergi, kargo, Cross-sell, Zero Value, Shopify satış gerçeği ve diğer providerlar birlikte değerlendirildikten sonra ayrı analist sözleşmesiyle üretilecek gelecekteki değer.

`shopping_performance_view`, ürün kimliği bazında `metrics.impressions`, `metrics.clicks` ve `metrics.cost_micros` sağlar. Google'ın resmî attribution açıklamasına göre:

- Doğrudan ürün etkileşiminde cost ve conversion kredisi ilgili ürüne verilir.
- Reklamın genel alanındaki dolaylı etkileşimde cost ve conversion kredisi reklamda sunulan ürünlere dağıtılabilir.
- Product impression, reklamda bulunan her ürün için artabilir; ürün impression toplamı Campaign toplamını aşabilir.
- Product click yalnız ilgili ürüne yapılan tıklamayı ifade eder.

Bu nedenle ürün satırları Channel toplamını yeniden üretmek veya finansal maliyet gerçeği sayılmak için toplanmaz. Provider Product Cost, ilerideki açıklanabilir maliyet dağıtım motorunun yalnız bir kanıt girdisidir.

## PMax örneği

~~~text
PMax Campaign: Takı
Asset Group: Küpeler
Advertised/clicked product: Küpe A
Sold product: Kolye B
~~~

Küpe A yalnız Küpeler Asset Group listing ağacına uyuyorsa çalışma sonucu:

- Channel: Küpeler
- Satılan ürün: Kolye B
- Ürün-Channel ilişkisi: Cross-sell
- Değer durumu: Positive Value veya Zero Value
- Product impression/click/cost: yalnız Google'ın ürün raporunda verdiği değerler

Küpe A birden fazla Asset Group'a uyuyorsa:

- Channel: Unknown Channel
- Satılan ürün: Kolye B
- Satış ilişkisi: Google'ın sağladığı ham lead/cross-sell kanıtı korunur
- Asset Group uydurulmaz

## İstenen Google ham veri aileleri

### Ortak hesap, tarih ve kampanya bağlamı

- Customer/account identity
- Account currency
- Account timezone
- `segments.date`
- `campaign.id`
- `campaign.name`
- `campaign.status`
- `campaign.advertising_channel_type`
- `campaign.advertising_channel_sub_type`
- Kaynak resource/view
- Google Ads API version
- Request/query provenance

### Channel kimliği ve performansı

Standard Shopping ve Search için:

- `ad_group.id`
- `ad_group.name`
- `ad_group.status`
- `metrics.impressions`
- `metrics.clicks`
- `metrics.cost_micros`
- `metrics.conversions`
- `metrics.conversions_value`

Performance Max için:

- `asset_group.id`
- `asset_group.name`
- `asset_group.status`
- Asset Group performansında desteklenen impression, click, cost, conversion ve conversion-value alanları
- Asset Group listing-tree node kimliği ve parent ilişkisi
- Listing node include/exclude ve subdivision/unit yapısı
- Listing boyutları: all-products, item ID, brand, category, product type ve custom attribute/label

### Provider ürün performansı

`shopping_performance_view` üzerinden:

- `segments.product_item_id`
- `segments.product_title`
- `segments.product_brand`
- Product category seviyeleri
- Product type seviyeleri
- Product custom attribute seviyeleri
- `metrics.impressions`
- `metrics.clicks`
- `metrics.cost_micros`
- `metrics.conversions`
- `metrics.conversions_value`

Bu alanlar provider-attributed product performance'tır; Channel toplamı veya gerçek ürün maliyeti değildir.

### Satılan ürün ve Cart Data kanıtı

- `segments.product_sold_item_id`
- `segments.product_sold_title`
- Sold-product brand, category, type ve custom attribute seviyeleri
- `metrics.units_sold`
- `metrics.revenue_micros`
- `metrics.lead_units_sold`
- `metrics.lead_revenue_micros`
- `metrics.cross_sell_units_sold`
- `metrics.cross_sell_revenue_micros`
- Gerektiğinde eşdeğer `all_*` metrikleri ayrı ham kanıt olarak

## Çalışma sınıfları

İki ayrı eksen korunur:

### Ürün-Channel ilişkisi

- Advertised
- Cross-sell
- Assisted
- Unclassified

### Satış değeri durumu

- Positive Value
- Zero Value

Channel çözümleme durumu ayrıca tutulur:

- exact Ad Group
- exact Asset Group
- Unknown Channel

## Açık konular

- Meta ve Klaviyo araştırmaları 16 Ekim ortak brief'inde birleştirildi.
- Provider Product Cost ile gelecekteki Allocated True Product Cost birbirine dönüştürülmeyecek.
- Vergi, kargo, blended spend ve ürün maliyeti formülleri kullanıcının sağlayacağı analist çalışma sayfaları görülmeden dondurulmayacak.
- Resmî Google & YouTube sync dışındaki kimlik yolları bu sürümde desteklenmeyecek.
- Runtime ancak ortak Channel sözleşmesinin ürün sahibi kabulünden sonra başlayabilir.

## Resmî kaynaklar

14 Ekim 2026 tarihinde kontrol edildi:

- [Google Ads API — Product reporting for Shopping ads](https://developers.google.com/google-ads/api/docs/shopping-ads/reporting)
- [Google Ads API v25 — Cart Data Sales View](https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view)
- [Google Ads API — Performance Max retail reporting](https://developers.google.com/google-ads/api/performance-max/retail-reporting)
- [Google Ads API v25 — Asset Group Listing Group Filter](https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter)
- [Google Ads API — Performance Max listing groups](https://developers.google.com/google-ads/api/performance-max/listing-groups)
- [Google Ads API v25 — Shopping Performance View](https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view)
- [Google Ads API v25 — Product Group View](https://developers.google.com/google-ads/api/fields/v25/product_group_view)
- [Google Ads API — Performance Max asset group reporting](https://developers.google.com/google-ads/api/performance-max/asset-group-reporting)
