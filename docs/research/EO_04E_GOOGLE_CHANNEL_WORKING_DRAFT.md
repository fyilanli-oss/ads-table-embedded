# EO-04-E Google Channel çalışma taslağı

## Belge durumu

- Durum: **Bağlayıcı olmayan araştırma taslağı**
- Kontrol tarihi: **14 Ekim 2026**
- Sahiplik bağlamı: A6-EO-04-E
- Bu belge bir executable contract, kabul kapısı veya implementasyon yetkisi değildir.
- EO-04-E, Dataset V2, Channel UI veya başka bir paketin başlamasını ya da kapanmasını engellemez.
- Provider çağrısı, runtime kodu, migration, secret, environment veya deployment değişikliği yetkilendirmez.
- Meta araştırması ve Klaviyo 15 Ekim final API doğrulaması tamamlanmadan ortak Channel sözleşmesi dondurulamaz.

## Amaç

Google Ads tarafında Channel adayını, satılan ürünü ve ürünün satış ilişkisini birbirine karıştırmadan tanımlamak; daha sonra Meta ve Klaviyo ile ortak sözleşme kurulurken doğrulanmış Google sınırını korumak.

## Çalışma taslağı Channel matrisi

| Google kampanya ailesi | Channel adayı | Ürün/satış kaynağı | Mevcut sınır |
| --- | --- | --- | --- |
| Standard Shopping | Ad Group | shopping_performance_view, product_group_view, cart_data_sales_view | Cart Data, Campaign ve Ad Group ile segmentlenebilir. |
| Performance Max Retail | Asset Group | asset_group, asset_group_listing_group_filter, asset_group_product_group_view; satış için Campaign seviyesinde cart_data_sales_view | Cart Data satırında Asset Group segmenti yoktur; aşağıya tahmini dağıtım yasaktır. |
| Search | Ad Group | Channel performansı için Ad Group; ürün satışı mevcutsa cart_data_sales_view | Tıklanan katalog ürünü kanıtı olmadığı için ürün ilişkisi Advertised/Cross-sell diye tahmin edilmez. |

## Temel çalışma kuralları

1. Channel kimliği ile satılan ürün kimliği ayrı gerçeklerdir.
2. Reklamda gösterilen veya tıklanan ürün tarafı segments.product_item_id ile temsil edilir.
3. Gerçekten satılan ürün tarafı segments.product_sold_item_id ile temsil edilir.
4. Aynı Cart Data satırında gösterilen/tıklanan ürün ile satılan ürün farklıysa, Channel gösterilen/tıklanan ürünün kaynağından gelir; satılan farklı ürün aynı Channel altında Cross-sell adayıdır.
5. PMax'te cart_data_sales_view Asset Group ile segmentlenmez. Tıklanan ürünün listing-tree üyeliği yalnız tek bir Asset Group'u exact belirliyorsa o Asset Group Channel adayıdır.
6. Tıklanan ürün birden fazla Asset Group listing ağacına uyuyorsa veya exact üyelik kanıtlanamıyorsa Channel Unknown Channel olur.
7. Unknown Channel, satış tipinin değil Channel çözümlemesinin durumudur.
8. Google'ın vermediği Asset Group ilişkisi oranlanmaz, paylaştırılmaz veya üretilmez.
9. Search Ad Group altında satılan ürün görülebilse bile tıklanan katalog ürünü kanıtı yoksa satış ilişkisi Unclassified kalır.
10. Promotion terimi kullanılmaz. Satılan adet pozitif ve Google'ın ürün satış değeri gerçekten sıfırsa çalışma etiketi Zero-value olur.
11. Google ürün seviyesinde ham olarak units_sold ve revenue_micros sağlar. units_sold, ortak Dataset sözleşmesi kararı olmadan kullanıcıya Purchase diye yeniden adlandırılmaz.
12. Shopify SKU/variant eşleşmesi bu taslağın kabul şartı değildir. Uygun gerçek ortam doğal olarak oluşursa ayrıca gözlenebilecek bağlayıcı olmayan not, master planda kayıtlıdır.

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
- Satış ilişkisi: Cross-sell

Küpe A birden fazla Asset Group'a uyuyorsa:

- Channel: Unknown Channel
- Satılan ürün: Kolye B
- Satış ilişkisi: Google'ın sağladığı ham lead/cross-sell kanıtı korunur; Channel uydurulmaz.

## İstenen Google ham veri aileleri

### Ortak hesap, tarih ve kampanya bağlamı

- Customer/account identity
- Account currency
- Account timezone
- segments.date
- campaign.id
- campaign.name
- campaign.status
- campaign.advertising_channel_type
- campaign.advertising_channel_sub_type
- Kaynak resource/view
- Google Ads API version
- Request/query provenance

### Channel kimliği ve performansı

Standard Shopping ve Search için:

- ad_group.id
- ad_group.name
- ad_group.status
- metrics.impressions
- metrics.clicks
- metrics.cost_micros
- metrics.conversions
- metrics.conversions_value

Performance Max için:

- asset_group.id
- asset_group.name
- asset_group.status
- Asset Group performansında desteklenen impression, click, cost, conversion ve conversion-value alanları
- Asset Group listing-tree node kimliği ve parent ilişkisi
- Listing node include/exclude ve subdivision/unit yapısı
- Listing boyutları: all-products, item ID, brand, category, product type ve custom attribute/label

### Ürün ve Cart Data kanıtı

- segments.product_item_id
- segments.product_title
- segments.product_brand
- Product category seviyeleri
- Product type seviyeleri
- Product custom attribute seviyeleri
- segments.product_sold_item_id
- segments.product_sold_title
- Sold-product brand, category, type ve custom attribute seviyeleri
- metrics.units_sold
- metrics.revenue_micros
- metrics.lead_units_sold
- metrics.lead_revenue_micros
- metrics.cross_sell_units_sold
- metrics.cross_sell_revenue_micros
- Gerektiğinde eşdeğer all_* metrikleri ayrı ham kanıt olarak

## Çalışma sınıfları

Bunlar ortak sözleşme dondurulana kadar taslak sınıflardır:

- Advertised
- Cross-sell
- Zero-value
- Unclassified

Channel çözümleme durumu ayrıca tutulur:

- exact Ad Group
- exact Asset Group
- Unknown Channel

## Açık konular

- Meta'nın gerçek Channel ve ürün/satış ilişki sınırı incelenecek.
- Klaviyo, 15 Ekim final API sürümüyle yeniden doğrulanacak.
- Üç providerın ortak alan kesişimi çıkarılacak.
- units_sold ile ürün düzeyi kullanıcı terimi Purchase arasındaki anlam kararı ortak sözleşmede verilecek.
- Shopify SKU/variant eşleşmesi uygun gerçek ortam doğal olarak oluşursa gözlenecek; hiçbir paketi engellemeyecek.
- Bu taslak, ortak Channel sözleşmesi kabul edilmeden implementasyona çevrilmeyecek.

## Resmî kaynaklar

14 Ekim 2026 tarihinde kontrol edildi:

- [Google Ads API v25 — Cart Data Sales View](https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view)
- [Google Ads API — Performance Max retail reporting](https://developers.google.com/google-ads/api/performance-max/retail-reporting)
- [Google Ads API v25 — Asset Group Listing Group Filter](https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter)
- [Google Ads API — Performance Max listing groups](https://developers.google.com/google-ads/api/performance-max/listing-groups)
- [Google Ads API v25 — Shopping Performance View](https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view)
- [Google Ads API v25 — Product Group View](https://developers.google.com/google-ads/api/fields/v25/product_group_view)
- [Google Ads API — Performance Max asset group reporting](https://developers.google.com/google-ads/api/performance-max/asset-group-reporting)
