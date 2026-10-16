# EO-04-E Meta Channel çalışma taslağı

## Belge durumu

- Durum: **Araştırma kaydı; 16 Ekim 2026 ortak brief'i tarafından supersede edildi**
- Kontrol tarihi: **16 Ekim 2026**
- Sahiplik bağlamı: A6-EO-04-E
- Bu belge bir executable contract, kabul kapısı veya implementasyon yetkisi değildir.
- Dataset V2, Channel UI, adapter veya maliyet dağıtım motoru oluşturmaz.
- Provider çağrısı, runtime kodu, migration, OAuth scope, secret, environment veya deployment değişikliği yetkilendirmez.
- Bağlayıcı karar: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`.

## Amaç

Meta tarafında gerçek Channel'ı Ad olarak korumak; Ad toplam performansını, Creative'in advertised-product kanıtını, provider ürün performansını ve satılan ürün kanıtını ayrı katmanlarda tutmak; ilerideki açıklanabilir blended ürün maliyeti hesabı için ham kanıt kaybetmemek.

## Çalışma taslağı Channel matrisi

| Meta kampanya/creative ailesi | Channel | Creative ürün yapısı | Ürün-Channel sonucu | Satış ilişkisi |
| --- | --- | --- | --- | --- |
| Catalog / Advantage+ Catalog | Ad | Tekil exact `product_id` veya `product_item_id` | Satılan `product_id` reklam ürünüyle eşleşirse exact Ad ilişkisi vardır. | Advertised |
| Catalog / Advantage+ Catalog | Ad | Tekil exact ürün kimliği | Satılan `product_id` reklam ürününden farklıysa exact Ad altında farklı ürün satılmıştır. | Cross-sell |
| Catalog / Carousel / çoklu ürün Creative | Ad | Exact `retailer_item_ids` veya eşdeğer açık ürün listesi | Satılan ürün exact listede bulunur. | Advertised |
| Catalog / Carousel / çoklu ürün Creative | Ad | Exact açık ürün listesi | Satılan ürün exact listede bulunmaz. | Cross-sell |
| Catalog / Advantage+ Catalog | Ad | Yalnız `product_set_id` | Provider-attributed sold product Ad bağlamında korunur; exact advertised-product tahmini yapılmaz. | Assisted |
| Standard Sales / Advantage+ Sales | Ad | Creative üzerinde exact ürün kimliği bulunur | Satılan ürün exact kimlikle karşılaştırılır. | Eşleşirse Advertised, eşleşmezse Cross-sell |
| Standard / generic Creative | Ad | Yalnız URL, metin, görsel veya video; exact ürün kimliği yok | Provider-attributed sold product Ad bağlamında korunur. | Assisted |

Kampanya etiketi tek başına sınıflandırma üretmez. Belirleyici olan Creative üzerinde exact advertised-product kanıtı ve Insights içindeki sold-product kimliğidir.

## Temel çalışma kuralları

1. Meta Channel her zaman gerçek `Ad`dır.
2. Campaign ve Ad Set hiyerarşi bağlamıdır; Channel yerine geçirilmez.
3. Channel toplam performansı Ad seviyesindeki ayrı sorgudan gelir.
4. Advertised-product kanıtı yalnız Meta'nın döndürdüğü exact Creative/Promoted Object ürün kimliğinden oluşur.
5. Ad adı, URL metni, görsel içeriği, başlık veya kullanıcı tahmini ürün kimliği sayılmaz.
6. Sold-product kanıtı `level=ad` ve `breakdowns=product_id` araştırma hattından gelir.
7. Exact advertised-product kümesi ile sold-product kimliği eşleşirse Advertised olur.
8. Exact advertised-product kümesi tam olarak biliniyor ve sold product bu kümenin dışındaysa Cross-sell olur.
9. Advertised-product kümesi exact değilse Cross-sell tahmin edilmez; provider-attributed sold product `Assisted` olur. `Unclassified` yalnız çelişkili veya gerçekten belirsiz kanıta ayrılır.
10. Promotion terimi kullanılmaz. Satılan adet pozitif ve satış değeri gerçekten sıfırsa değer durumu `Zero Value` olur.
11. Resmî Shopify Facebook & Instagram satış kanalı kanıtından türetilen product ID + variant ID adayları Shopify Admin API ile doğrulanmadan SKU, ürün adı veya varyant adı yayımlanmaz.
12. Provider verisi ile ileride hesaplanacak gerçek ürün maliyeti birbirine karıştırılmaz.

## Yetki sınırı

Mevcut Meta OAuth scope'u `ads_read` olarak korunur.

`ads_read` çalışma kapsamında:

- Ad, Ad Set ve Campaign kimlik/hiyerarşi alanları
- Ad Creative okuması
- Ad Insights
- Creative veya promoted object üzerinde doğrudan bulunan exact ürün kimlikleri

için kullanılır.

Yalnız `product_set_id` gelirse Product Set üyelerini Catalog API üzerinden açmak farklı bir yetki alanıdır. Meta'nın katalog izin modeli `catalog_management` ve ilişkili business erişimi gerektirir. Bu taslak:

- OAuth scope genişletmez,
- App Review talebi oluşturmaz,
- Product Set içeriğini tahmin etmez,
- ek izin olmadan set üyesi ürünleri varmış gibi üretmez.

## Performans ve maliyet katmanları

Aşağıdaki değerler ayrı tutulur:

1. **Channel Spend:** Ad seviyesindeki Meta spend toplamı.
2. **Provider Product Performance:** Meta'nın `product_id` breakdown içinde gerçekten döndürdüğü ürün-atıflı impression, click ve spend.
3. **Allocated True Product Cost:** Meta, Google, Klaviyo, vergi, kargo, Cross-sell, Zero Value ve Shopify satış gerçeği birlikte değerlendirildikten sonra ayrı analist sözleşmesiyle üretilecek gelecekteki değer.

Meta'nın resmî Marketing API Postman koleksiyonunda `level=ad&breakdowns=product_id` ile `impressions`, `clicks` ve `spend` aynı sorguda istenir. Fakat yayımlanmış örnek, bu metriklerin ürün satırındaki attribution/aggregation semantiğini açıklamaz.

Bu nedenle:

- Ad seviyesindeki impression, click ve spend kesin Channel toplamıdır.
- Product breakdown içindeki impression, click ve spend aday ham alanlardır.
- Bu üç alanın ürün-grain semantiği gerçek katalog reklamı cevabıyla kontrollü kabul edilmeden ortak executable contract'a taşınmaz.
- Product satırları hiçbir durumda toplanarak Ad toplamı veya gerçek ürün maliyeti üretilmez.

## İstenen Meta ham veri aileleri

### Hesap, tarih ve provenance

- Ad account identity
- Account currency
- Account timezone
- `date_start`
- `date_stop`
- Graph API version
- Adapter/query version
- Attribution setting/window
- Request/query provenance
- Kaynak endpoint/resource

### Hiyerarşi ve Channel kimliği

- `campaign_id`
- `campaign_name`
- Campaign objective/type/status için resmî desteklenen alanlar
- `adset_id`
- `adset_name`
- Ad Set status
- `ad_id`
- `ad_name`
- Ad status/effective status
- Creative ID

### Channel toplam performansı

Ad seviyesinde:

- `impressions`
- `clicks`
- `inline_link_clicks`
- `outbound_clicks`
- `spend`
- `actions`
- `action_values`
- Desteklenen purchase ve conversion alanları
- Bu alanlardan türetilmeyen ham attribution bağlamı

### Advertised-product kanıtı

Creative ve promoted object üzerinde doğrudan bulunabildiği ölçüde:

- `product_id`
- `product_data[].product_id`
- `retailer_item_ids`
- `product_item_id`
- `product_set_id`
- `product_catalog_id`
- Kanıtın geldiği exact source field
- Advertised-product kümesinin `exact / incomplete / unavailable` durumu

`product_set_id` exact ürün listesi değildir; tek başına Advertised/Cross-sell kararı üretmez.

### Sold-product ve provider ürün performansı

Ad seviyesinde product breakdown araştırma hattında:

- Breakdown `product_id`
- `converted_product_quantity`
- `converted_product_value`
- Resmî SDK'da bulunan ilgili website/omni purchase varyantları, ancak semantiği doğrulandığı ölçüde
- Product breakdown içindeki `impressions`
- Product breakdown içindeki `clicks`
- Product breakdown içindeki `spend`
- Her alan için `returned / null / unsupported / validation_pending` destek durumu

SKU ve product name bu Meta Insights çekirdeğinin doğrulanmış exact alanları değildir. Desteklenen resmî Shopify Facebook & Instagram kanalında provider kimliği product ID + variant ID adayına dönüştürülür; Shopify Admin API variant'ın product'a ait olduğunu doğrulamadan SKU, ürün adı veya varyant adı yayımlanmaz. Eşleme başarısız olsa da provider product ID ve cost kanıtı kaybedilmez.

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

Örnekler:

- Reklamdaki ürün satılmış ve satış değeri pozitif: Advertised + Positive Value
- Reklamdaki ürün satılmış ve satış değeri sıfır: Advertised + Zero Value
- Exact reklam listesi dışındaki ürün satılmış ve satış değeri pozitif: Cross-sell + Positive Value
- Exact reklam listesi dışındaki ürün satılmış ve satış değeri sıfır: Cross-sell + Zero Value
- Reklam ürünü exact belirlenememiş fakat sale Ad'a attributed: Assisted + ilgili value durumu
- Kanıt çelişkili veya gerçekten belirsiz: Unclassified + ilgili value durumu

## Açık kabul kapıları

- Meta product breakdown içindeki impression, click ve spend gerçek katalog reklamı cevabıyla küçük kontrollü sorguda doğrulanacak.
- `converted_product_quantity` ve `converted_product_value` alanlarının product breakdown cevap biçimi kaydedilecek.
- Creative exact ürün kimliklerinin gerçek kampanya/creative ailelerine göre bulunabilirliği gözlenecek.
- Ek katalog/business izni istenmeden mevcut `ads_read` sınırı korunacak.
- Klaviyo final araştırması ve üç-provider ortak kesişimi 16 Ekim ortak brief'inde tamamlandı.
- Vergi, kargo, blended spend ve gerçek ürün maliyeti formülleri kullanıcının sağlayacağı analist çalışma sayfaları görülmeden dondurulmayacak.
- Runtime ancak ortak Channel sözleşmesinin ürün sahibi kabulünden sonra başlayabilir.

## Resmî kaynaklar

14 Ekim 2026 tarihinde kontrol edildi:

- [Meta official Facebook Marketing API Postman workspace](https://www.postman.com/meta/facebook-marketing-api/overview)
- [Meta official Marketing API collection — permissions and access](https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi)
- [Meta official product_id breakdown query](https://www.postman.com/meta/facebook-marketing-api/request/5wdl62t/attributionsetting)
- [Meta official Ad Insights SDK fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)
- [Meta official Ad Creative SDK object](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py)
- [Meta official Ad Creative Link Data SDK object](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreativelinkdata.py)
- [Meta official Ad Promoted Object SDK object](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adpromotedobject.py)
- [Meta official Product Set SDK object and generated examples](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/test/docs.py)
- [Meta official catalog/product-set request](https://www.postman.com/meta/facebook-marketing-api/request/0w6p8rh/get-catalog-and-product-set)
