# EO-04-E — Google Channel tarihsel çalışma taslağı

## Belge durumu

- Durum: **Araştırma kaydı; yerini 16 Ekim 2026 ortak brief'i aldı.**
- Kaynak belgenin kontrol tarihi: **16 Ekim 2026**.
- Sahiplik bağlamı: A6-EO-04-E.
- Yürütülebilir sözleşme, kabul kapısı veya uygulama yetkisi değildir.
- EO-04-E, Dataset V2, Channel UI veya başka paketin başlaması/kapanması için ayrı engel oluşturmaz.
- Sağlayıcı çağrısı, çalışma zamanı kodu, migration, secret, ortam veya dağıtım değişikliği yetkilendirmez.
- Bağlayıcı karar: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`.

Bu belge araştırmanın tarihsel düşünce akışını korur; eski öneriler bugünkü iş
kuralları değildir. Güncel sıra `docs/EXECUTION_PLAN.md`, nihai senaryolar
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir.

## Amaç

Google Ads Channel kimliğini, sağlayıcının ürün performansını, satılan ürünü
ve ileride hesaplanacak gerçek ürün maliyetini birbirine karıştırmadan
tanımlamak; Meta ve Klaviyo ile ortak sözleşme kurulurken doğrulanmış Google
sınırını korumaktı.

## Tarihsel Channel matrisi — bugünkü uygulama kuralı değil

Aşağıdaki tablo eski araştırma varsayımlarını gösterir. Özellikle geniş ağaç
satırı, sonradan kabul edilmiş tek uygun Asset Group kuralının yerine kullanılamaz.

| Google kampanya ailesi | Channel adayı | Ürün listeleme yapısı | Ürün-Channel sonucu | Satış ilişkisi |
| --- | --- | --- | --- | --- |
| Standard Shopping | Ad Group | Tekil veya çoklu Merchant Center ürünleri | Ürün performansı ve Cart Data, Ad Group bağlamında korunur. | Kanıtlanan öncü/reklam ürünü Advertised; farklı satılan ürün Cross-sell. |
| Performance Max Retail | Asset Group | Listeleme ağacının yaprağı tekil item ID; üyelik yalnız bir Asset Group'u kesin belirliyor | Ürün satırı kesin Asset Group'a bağlanabilir. | Advertised veya Cross-sell, sağlayıcı kanıtına göre korunur. |
| Performance Max Retail | Asset Group | All products, kategori, marka, ürün türü, özel etiket veya birden fazla Asset Group'a uyan ürün | Eski varsayım: Campaign-ürün kanıtı var; kesin Asset Group kanıtı yok. | Eski varsayım: ürün Unclassified Channel altında kalır; ilişki kanıtı varsa korunur, tahmin yapılmaz. |
| Search | Ad Group | Kesin reklam ürünü kanıtı yok | Sağlayıcının ilişkilendirdiği satılan ürün Ad Group bağlamında korunur. | Assisted |

**Sonraki kabul edilmiş karar:** Tek uygun `All products` Asset Group kesin
Channel olabilir. Kategori/marka/geniş ağaç tek başına belirsizlik nedeni değildir;
tıklanan/reklam ürünü tam olarak bir uygun Asset Group'u ve satışın tüm iş günü
penceresini kapsayan tarihsel kanıtı gerektirir. Örtüşen ağaçlar veya eksik zaman
kanıtı `Unclassified Channel` bırakır; satış ve Sales Role korunur. Satılan ürün,
Channel seçmek için kullanılamaz.

Bu yeni bir karar değildir. Kaynaklar:
`contracts/eo-04c-google-reporting-runtime-v1.json` ve
`docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md`.
Eski tablo araştırma geçmişi olarak tutulur; tarihsel ağaç saklama işi burada
tamamlanmış sayılmaz ve EO-05'e ait kalır.

## Araştırmada belirlenen temel kurallar

1. Channel kimliği, sağlayıcı ürün performansı ve satılan ürün kimliği ayrı gerçeklerdir.
2. Reklamda gösterilen veya tıklanan ürün `segments.product_item_id` ile temsil edilir.
3. Gerçekten satılan ürün `segments.product_sold_item_id` ile temsil edilir.
4. Aynı Cart Data satırında gösterilen/tıklanan ürün ile satılan ürün farklıysa, farklı satılan ürün Cross-sell kanıtıdır.
5. PMax'te `cart_data_sales_view` Asset Group ile segmentlenmez. Google'ın vermediği Asset Group ilişkisi oranlanmaz, paylaştırılmaz veya üretilmez.
6. Tıklanan ürünün listeleme ağacı üyeliği yalnız tek Asset Group'u kesin belirliyorsa o grup Channel adayıdır.
7. Ürün birden fazla Asset Group ağacına uyuyorsa veya kesin üyelik kanıtlanamıyorsa Channel `Unclassified Channel` olur.
8. `Unclassified Channel`, satış ilişkisinin değil Channel çözümlemesinin durumudur.
9. Search Ad Group için kesin reklam ürünü kanıtı olmadığında sağlayıcının ilişkilendirdiği satış bastırılmaz; `Assisted` olur.
10. Promotion terimi kullanılmaz. Satılan adet pozitif ve ürün satış değeri gerçekten sıfırsa değer durumu `Zero Value` olur.
11. Google ürün düzeyinde ham `units_sold` ve `revenue_micros` sağlar. Ortak Dataset sözleşmesi kararı olmadan `units_sold` kullanıcıya Purchase diye yeniden adlandırılmaz.
12. Desteklenen kimlik yolu Shopify'ın resmî Google & YouTube otomatik ürün senkronudur. Google item ID içindeki Shopify ürün/varyant adayları Admin API ile doğrulanmadan SKU veya ürün adı yayımlanmaz. Manuel/üçüncü taraf feed kapsam dışıdır.

## Performans ve maliyet katmanları

Üç ayrı değer birbirinin yerine kullanılamaz:

1. **Channel harcaması:** Sağlayıcının gerçek Channel toplamı.
2. **Sağlayıcı ürün maliyeti:** Google'ın ürün raporlama atfıyla ürüne yazdığı `metrics.cost_micros`.
3. **Dağıtılmış gerçek ürün maliyeti:** Vergi, kargo, Cross-sell, Zero Value,
   Shopify satış gerçeği ve diğer sağlayıcılar birlikte değerlendirilip ayrı
   analist sözleşmesiyle üretilecek gelecekteki değer.

`shopping_performance_view`, ürün kimliğine göre `metrics.impressions`,
`metrics.clicks` ve `metrics.cost_micros` sağlar. Kaynak belgedeki resmî
attribution (performansı ürüne atfetme) açıklaması:

- Doğrudan ürün etkileşiminde maliyet ve dönüşüm payı ilgili ürüne verilir.
- Reklamın genel alanındaki dolaylı etkileşimde maliyet ve dönüşüm payı reklamda sunulan ürünlere dağıtılabilir.
- Ürün gösterimi reklamda bulunan her ürün için artabilir; toplamı Campaign gösterimini aşabilir.
- Ürün tıklaması yalnız ilgili ürüne yapılan tıklamayı ifade eder.

Ürün satırları, Channel toplamını yeniden üretmek veya finansal maliyet gerçeği
sayılmak için toplanmaz. Sağlayıcının ürün maliyeti, ilerideki açıklanabilir
maliyet dağıtım motoruna yalnız kanıt girdisidir.

Kesin sağlayıcı ürün maliyeti dönüyorsa `Cross-sell`, `Assisted`, `Zero Value`
veya `Unclassified Channel` bu değeri silmez; aynı ürün satırında korunur.
Sağlayıcı ürün maliyeti vermiyorsa Channel toplamı ürünlere tahminî dağıtılmaz.

## Tarihsel PMax örneği

~~~text
PMax Campaign: Takı
Asset Group: Küpeler
Reklamda gösterilen/tıklanan ürün: Küpe A
Satılan ürün: Kolye B
~~~

Küpe A yalnız Küpeler Asset Group ağacına uyuyorsa eski örneğin sonucu:

- Channel: Küpeler
- Satılan ürün: Kolye B
- Ürün-Channel ilişkisi: Cross-sell
- Değer durumu: Positive Value veya Zero Value
- Ürün gösterim/tıklama/maliyet: yalnız Google ürün raporunda dönen değerler

Bu kısa örnek, sonradan kabul edilmiş tam iş günü tarihsel kanıt koşuluyla
birlikte okunur. Küpe A birden fazla Asset Group'a uyuyorsa:

- Channel: Unclassified Channel
- Satılan ürün: Kolye B
- Satış ilişkisi: Google'ın verdiği ham öncü ürün/çapraz satış kanıtı korunur
- Asset Group uydurulmaz

## Araştırmada istenen ham veri aileleri

### Ortak hesap, tarih ve kampanya bağlamı

- Müşteri/hesap kimliği
- Hesap para birimi
- Hesap saat dilimi
- `segments.date`
- `campaign.id`
- `campaign.name`
- `campaign.status`
- `campaign.advertising_channel_type`
- `campaign.advertising_channel_sub_type`
- Kaynak varlık/görünüm
- Google Ads API sürümü
- İstek/sorgu kaynak bilgisi

### Channel kimliği ve performansı

Standard Shopping ve Search:

- `ad_group.id`
- `ad_group.name`
- `ad_group.status`
- `metrics.impressions`
- `metrics.clicks`
- `metrics.cost_micros`
- `metrics.conversions`
- `metrics.conversions_value`

Performance Max:

- `asset_group.id`
- `asset_group.name`
- `asset_group.status`
- Asset Group performansında desteklenen gösterim, tıklama, maliyet, dönüşüm ve dönüşüm değeri alanları
- Listeleme ağacı düğüm kimliği ve üst düğüm ilişkisi
- Dahil/hariç tutma ve alt bölüme ayırma/son düğüm yapısı
- Tüm ürünler, item ID, marka, kategori, ürün türü, özel alan/etiket boyutları

### Sağlayıcı ürün performansı

`shopping_performance_view` üzerinden:

- `segments.product_item_id`
- `segments.product_title`
- `segments.product_brand`
- Ürün kategori seviyeleri
- Ürün türü seviyeleri
- Ürün özel alan seviyeleri
- `metrics.impressions`
- `metrics.clicks`
- `metrics.cost_micros`
- `metrics.conversions`
- `metrics.conversions_value`

Bunlar sağlayıcının ürüne atfettiği performanstır; Channel toplamı veya gerçek
ürün maliyeti değildir.

### Satılan ürün ve Cart Data kanıtı

- `segments.product_sold_item_id`
- `segments.product_sold_title`
- Satılan ürünün marka, kategori, tür ve özel alan seviyeleri
- `metrics.units_sold`
- `metrics.revenue_micros`
- `metrics.lead_units_sold`
- `metrics.lead_revenue_micros`
- `metrics.cross_sell_units_sold`
- `metrics.cross_sell_revenue_micros`
- Gerektiğinde eşdeğer `all_*` metrikleri ayrı ham kanıt olarak

## Ayrı sınıflandırma eksenleri

Ürün-Channel ilişkisi:

- Advertised
- Cross-sell
- Assisted
- Unclassified

Satış değeri durumu:

- Positive Value
- Zero Value

Channel çözüm durumu:

- Kesin Ad Group
- Kesin Asset Group
- Unclassified Channel

## Tarihsel açık konular ve sonraki karar

- Meta ve Klaviyo araştırmaları 16 Ekim ortak brief'inde birleştirildi.
- Sağlayıcı ürün maliyeti ile gelecekteki dağıtılmış gerçek ürün maliyeti birbirine dönüştürülmez.
- Vergi, kargo, birleşik harcama ve ürün maliyeti formülleri, ürün sahibinin analist çalışma sayfaları görülmeden dondurulmaz.
- Resmî Google & YouTube senkronizasyonu dışındaki kimlik yolları bu sürümde desteklenmez.
- Çalışma zamanı ancak ortak Channel sözleşmesinin ürün sahibi kabulünden sonra başlayabilirdi.

Son madde eski hazırlık kapısıdır; sonraki kabul edilmiş uygulamayı geri almaz.
Bu taslak yeni kod, canlı sorgu veya maliyet dağıtımı yetkisi vermez.

## Tarihsel resmî kaynaklar

Kaynak belgenin araştırma kontrol tarihi: 14 Ekim 2026.
Üstteki 16 Ekim kayıt tarihi ve bu kaynak tarihi ayrı korunur.

- [Shopping ürün raporlaması](https://developers.google.com/google-ads/api/docs/shopping-ads/reporting)
- [Google Ads API v25 — Cart Data Sales View](https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view)
- [Performance Max perakende raporlaması](https://developers.google.com/google-ads/api/performance-max/retail-reporting)
- [Google Ads API v25 — Asset Group Listing Group Filter](https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter)
- [Performance Max ürün listeleme grupları](https://developers.google.com/google-ads/api/performance-max/listing-groups)
- [Google Ads API v25 — Shopping Performance View](https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view)
- [Google Ads API v25 — Product Group View](https://developers.google.com/google-ads/api/fields/v25/product_group_view)
- [Performance Max Asset Group raporlaması](https://developers.google.com/google-ads/api/performance-max/asset-group-reporting)
