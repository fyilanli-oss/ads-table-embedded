# EO-04-E — Meta Channel tarihsel çalışma taslağı

## Belge durumu

- Durum: **Araştırma kaydı; yerini 16 Ekim 2026 ortak brief'i aldı.**
- Kaynak belgenin kontrol tarihi: **16 Ekim 2026**.
- Sahiplik bağlamı: A6-EO-04-E.
- Yürütülebilir sözleşme, kabul kapısı veya uygulama yetkisi değildir.
- Dataset V2, Channel UI, adaptör veya maliyet dağıtım motoru oluşturmaz.
- Sağlayıcı çağrısı, çalışma zamanı kodu, migration, OAuth izni, secret, ortam veya dağıtım değişikliği yetkilendirmez.
- Bağlayıcı karar: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`.

Bu belge araştırmanın tarihsel kapsamını korur. Sonraki kabul ve iş sırası
`docs/EXECUTION_PLAN.md`, nihai senaryolar `docs/EO_04_ANALYSIS_DESIGN_BOOK.md`
içindedir. Eski araştırma önerileri yeni iş talimatı değildir.

## Amaç

Meta'nın gerçek Channel'ını Ad olarak korumak; Ad toplam performansını,
Creative'in reklam ürünü kanıtını, sağlayıcı ürün performansını ve satılan ürün
kanıtını ayrı tutmak; ilerideki açıklanabilir birleşik ürün maliyeti hesabı için
ham kanıt kaybetmemekti.

## Tarihsel Channel matrisi

Kampanya ailesi ve sağlayıcı varlık adları özgün teknik adlarıyla korunur.

| Meta kampanya/reklam içeriği ailesi | Channel | Creative ürün yapısı | Ürün-Channel sonucu | Satış ilişkisi |
| --- | --- | --- | --- | --- |
| Catalog / Advantage+ Catalog | Ad | Tekil kesin `product_id` veya `product_item_id` | Satılan `product_id` reklam ürünüyle eşleşirse kesin Ad ilişkisi vardır. | Advertised |
| Catalog / Advantage+ Catalog | Ad | Tekil kesin ürün kimliği | Satılan `product_id` farklıysa kesin Ad altında farklı ürün satılmıştır. | Cross-sell |
| Catalog / Carousel / çoklu ürün Creative | Ad | Kesin `retailer_item_ids` veya eşdeğer açık ürün listesi | Satılan ürün kesin listede bulunur. | Advertised |
| Catalog / Carousel / çoklu ürün Creative | Ad | Kesin açık ürün listesi | Satılan ürün kesin listede bulunmaz. | Cross-sell |
| Catalog / Advantage+ Catalog | Ad | Yalnız `product_set_id` | Sağlayıcının ilişkilendirdiği satış Ad bağlamında korunur; reklam ürünü tahmin edilmez. | Assisted |
| Standard Sales / Advantage+ Sales | Ad | Creative üzerinde kesin ürün kimliği vardır | Satılan ürün kesin kimlikle karşılaştırılır. | Eşleşirse Advertised, eşleşmezse Cross-sell |
| Standard / genel Creative | Ad | Yalnız URL, metin, görsel veya video; kesin ürün kimliği yok | Sağlayıcının ilişkilendirdiği satış Ad bağlamında korunur. | Assisted |

Kampanya etiketi tek başına sınıflandırma üretmez. Belirleyici olan Creative
üzerindeki kesin reklam ürünü kanıtı ve Insights içindeki satılan ürün kimliğidir.

## Araştırmada belirlenen temel kurallar

1. Meta Channel her zaman gerçek `Ad`dır.
2. Campaign ve Ad Set hiyerarşi bağlamıdır; Channel yerine geçirilmez.
3. Channel toplam performansı Ad düzeyindeki ayrı sorgudan gelir.
4. Reklam ürünü kanıtı yalnız Meta'nın döndürdüğü kesin Creative/Promoted Object ürün kimliğidir.
5. Ad adı, URL metni, görsel, başlık veya kullanıcı tahmini ürün kimliği sayılmaz.
6. Satılan ürün kanıtı `level=ad` ve `breakdowns=product_id` araştırma hattından gelir.
7. Kesin reklam ürünü kümesiyle satılan ürün kimliği eşleşirse Advertised olur.
8. Kesin reklam ürünü kümesi tam biliniyor ve satılan ürün kümenin dışındaysa Cross-sell olur.
9. Reklam ürünü kümesi kesin değilse Cross-sell tahmin edilmez; sağlayıcının ilişkilendirdiği satış `Assisted` olur. `Unclassified` yalnız çelişkili veya gerçekten belirsiz kanıta ayrılır.
10. Promotion terimi kullanılmaz. Satılan adet pozitif ve satış değeri gerçekten sıfırsa değer durumu `Zero Value` olur.
11. Resmî Shopify Facebook & Instagram satış kanalı kanıtından türetilen ürün/varyant kimliği adayları Shopify Admin API ile doğrulanmadan SKU, ürün adı veya varyant adı yayımlanmaz.
12. Sağlayıcı verisiyle ileride hesaplanacak gerçek ürün maliyeti karıştırılmaz.

## Yetki sınırı

Mevcut Meta OAuth izni `ads_read` olarak korunur. Araştırma kapsamında bu izin:

- Ad, Ad Set ve Campaign kimlik/hiyerarşi alanları;
- Ad Creative okuması;
- Ad Insights;
- Creative veya Promoted Object üzerinde doğrudan bulunan kesin ürün kimlikleri

için ele alınmıştır.

Yalnız `product_set_id` gelirse Product Set üyelerini Catalog API üzerinden
açmak ayrı yetki alanıdır. Kaynak araştırma, Meta katalog izin modelini
`catalog_management` ve ilişkili business erişimi kapsamında kaydetmiştir.
Bu taslak:

- OAuth izin kapsamını genişletmez;
- App Review talebi oluşturmaz;
- Product Set içeriğini tahmin etmez;
- ek izin olmadan küme üyesi ürünleri varmış gibi üretmez.

Bu bölüm tarihsel izin sınırını korur; bugün yeni izin istenmesi veya yeni
başvuru yapılması kararı değildir.

## Performans ve maliyet katmanları

Üç ayrı değer korunur:

1. **Channel harcaması:** Ad düzeyindeki Meta harcama toplamı.
2. **Sağlayıcı ürün performansı:** Meta'nın `product_id` kırılımında gerçekten
   döndürdüğü ürüne atfedilen gösterim, tıklama ve harcama.
3. **Dağıtılmış gerçek ürün maliyeti:** Meta, Google, Klaviyo, vergi, kargo,
   Cross-sell, Zero Value ve Shopify satış gerçeği birlikte değerlendirilerek
   ayrı analist sözleşmesiyle üretilecek gelecekteki değer.

Meta'nın resmî Marketing API Postman koleksiyonunda
`level=ad&breakdowns=product_id` ile `impressions`, `clicks` ve `spend` aynı
sorguda istenir. Ancak yayımlanmış örnek, bu metriklerin ürün satırındaki
atıf/toplama anlamını açıklamaz.

Bu nedenle:

- Ad düzeyindeki gösterim, tıklama ve harcama kesin Channel toplamıdır.
- Ürün kırılımındaki gösterim, tıklama ve harcama aday ham alanlardır.
- Ürün düzeyindeki anlamları gerçek katalog reklamı cevabıyla kontrollü kabul
  edilmeden ortak yürütülebilir sözleşmeye taşınmaz.
- Ürün satırları toplanarak Ad toplamı veya gerçek ürün maliyeti üretilmez.

Buradaki tıklama alanı, tek başına kanonik Ad Click eşlemesi değildir. Sonraki
kabul edilmiş canlı yanıtta tıklama adayları ayrı tutulmuştur; bu tarihsel
taslak o eşlemeyi yapılmış saymaz.

## Araştırmada istenen ham veri aileleri

### Hesap, tarih ve kaynak bilgisi

- Reklam hesabı kimliği
- Hesap para birimi
- Hesap saat dilimi
- `date_start`
- `date_stop`
- Graph API sürümü
- Adaptör/sorgu sürümü
- Attribution ayarı/penceresi: sağlayıcının satış veya etkileşimi kaynağa atfetme kapsamı
- İstek/sorgu kaynak bilgisi
- Kaynak endpoint/varlık

### Hiyerarşi ve Channel kimliği

- `campaign_id`
- `campaign_name`
- Campaign amacı/türü/durumu için resmî desteklenen alanlar
- `adset_id`
- `adset_name`
- Ad Set durumu
- `ad_id`
- `ad_name`
- Ad durumu/etkin durumu
- Creative kimliği

### Channel toplam performansı

Ad düzeyinde:

- `impressions`
- `clicks`
- `inline_link_clicks`
- `outbound_clicks`
- `spend`
- `actions`
- `action_values`
- Desteklenen satın alma ve dönüşüm alanları
- Bu alanlardan türetilmeyen ham attribution bağlamı

### Reklamda gösterilen ürün kanıtı

Creative ve Promoted Object üzerinde doğrudan bulunabildiği ölçüde:

- `product_id`
- `product_data[].product_id`
- `retailer_item_ids`
- `product_item_id`
- `product_set_id`
- `product_catalog_id`
- Kanıtın geldiği kesin kaynak alan
- Reklam ürünü kümesinin `exact / incomplete / unavailable` durumu

`product_set_id` kesin ürün listesi değildir; tek başına Advertised/Cross-sell
kararı üretmez.

### Satılan ürün ve sağlayıcı ürün performansı

Ad düzeyindeki ürün kırılımı araştırma hattında:

- Kırılım `product_id`
- `converted_product_quantity`
- `converted_product_value`
- Resmî SDK'daki website/omni purchase varyantları; yalnız anlamları doğrulandığı ölçüde
- Ürün kırılımındaki `impressions`
- Ürün kırılımındaki `clicks`
- Ürün kırılımındaki `spend`
- Her alan için `returned / null / unsupported / validation_pending` destek durumu

SKU ve ürün adı, bu Meta Insights çekirdeğinin doğrulanmış kesin alanları
değildir. Desteklenen resmî Shopify Facebook & Instagram kanalında sağlayıcı
kimliği ürün/varyant kimliği adayına dönüştürülür. Shopify Admin API varyantın
ürüne ait olduğunu doğrulamadan SKU, ürün adı veya varyant adı yayımlanmaz.
Eşleme başarısız olsa da sağlayıcı ürün kimliği ve maliyet kanıtı kaybedilmez.

Gerçek katalog cevabıyla ürün düzeyinde olduğu doğrulanan kesin sağlayıcı
maliyeti; `Cross-sell`, `Assisted`, `Zero Value` veya çözülemeyen Channel
nedeniyle silinmez. Böyle bir kesin ürün maliyeti yoksa Ad toplam harcaması
ürünlere tahminî dağıtılmaz.

## Ayrı sınıflandırma eksenleri

Ürün-Channel ilişkisi:

- Advertised
- Cross-sell
- Assisted
- Unclassified

Satış değeri durumu:

- Positive Value
- Zero Value

Örnekler:

- Reklam ürünü satılmış, satış değeri pozitif: Advertised + Positive Value
- Reklam ürünü satılmış, satış değeri sıfır: Advertised + Zero Value
- Kesin reklam listesi dışındaki ürün satılmış, değer pozitif: Cross-sell + Positive Value
- Kesin reklam listesi dışındaki ürün satılmış, değer sıfır: Cross-sell + Zero Value
- Reklam ürünü kesin belirlenememiş, satış Ad'a atfedilmiş: Assisted + ilgili değer durumu
- Kanıt çelişkili veya gerçekten belirsiz: Unclassified + ilgili değer durumu

## Tarihsel açık kabul kapıları ve sonraki karar

- Ürün kırılımındaki gösterim, tıklama ve harcama gerçek katalog reklamı cevabıyla küçük kontrollü sorguda doğrulanacak.
- `converted_product_quantity` ve `converted_product_value` alanlarının ürün kırılımı cevap yapısı kaydedilecek.
- Creative üzerindeki kesin ürün kimliklerinin kampanya/Creative ailelerine göre bulunabilirliği gözlenecek.
- Ek katalog/business izni istenmeden `ads_read` sınırı korunacak.
- Klaviyo nihai araştırması ve üç sağlayıcının ortak kesişimi 16 Ekim brief'inde tamamlandı.
- Vergi, kargo, birleşik harcama ve gerçek ürün maliyeti formülleri, ürün sahibinin analist çalışma sayfaları görülmeden dondurulmayacak.
- Çalışma zamanı ancak ortak Channel sözleşmesinin ürün sahibi kabulünden sonra başlayabilirdi.

Son madde eski hazırlık kapısıdır; sonraki uygulamayı geri almaz. Gerçek katalog
yanıtı gerektiren açık doğrulamalar ise bu dil çalışmasıyla kapanmaz. Yeni çağrı,
izin veya kod yetkisi yoktur.

## Tarihsel resmî kaynaklar

Kaynak belgenin araştırma kontrol tarihi: 14 Ekim 2026.
Üstteki 16 Ekim kayıt tarihi ve bu kaynak tarihi ayrı korunur.

- [Meta resmî Facebook Marketing API Postman çalışma alanı](https://www.postman.com/meta/facebook-marketing-api/overview)
- [Meta resmî Marketing API koleksiyonu — izinler ve erişim](https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi)
- [Meta resmî product_id kırılım sorgusu](https://www.postman.com/meta/facebook-marketing-api/request/5wdl62t/attributionsetting)
- [Meta resmî Ad Insights SDK alanları](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)
- [Meta resmî Ad Creative SDK nesnesi](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py)
- [Meta resmî Ad Creative Link Data SDK nesnesi](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreativelinkdata.py)
- [Meta resmî Ad Promoted Object SDK nesnesi](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adpromotedobject.py)
- [Meta resmî Product Set SDK nesnesi ve üretilmiş örnekler](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/test/docs.py)
- [Meta resmî katalog/ürün kümesi isteği](https://www.postman.com/meta/facebook-marketing-api/request/0w6p8rh/get-catalog-and-product-set)
