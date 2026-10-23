# EO-04-C — Google Ads raporlama çalışma zamanı başlangıç açıklaması

## Durum ve yetki

### 09 — Shopping Ad Group kaynak referansı, 23 Ekim 2026

Yeni `shopping_cart_data_product_sales_daily`, genel cart data alanlarının tamamını korur ve yalnız `campaign.advertising_channel_type = 'SHOPPING'` için `ad_group.id/name` ekler. Genel `cart_data_product_sales_daily` gövdesi değişmez; PMax/Search için Ad Group alanı zorlanmaz. Eski canlı kanıt tetikleyicisinin sorgu ailesi listesi büyütülmez.

Ayrı `readShoppingSourceEvidenceSnapshot` mevcut kurulum/bağlı hesap/token yetkisini kullanır; bir yürütme nesnesi farklı workspace veya install generation için önbelleğini kullandıramaz. Tarih provider/OAuth erişiminden önce doğrulanır. Sabit üç aile sırasıyla tam okunur: `ad_group_channel_daily`, `shopping_product_daily`, `shopping_cart_data_product_sales_daily`. Genel cart raporu buna eklenmez. Aile başına 20 sayfa/20.000 satır, opak imleç döngü/biçim kontrolü ve ilk hatada durma vardır. Bozuk JSON/başarılı gövde, bozuk satır veya string olmayan imleç boş rapor olmaz; HTTP 200 içindeki hata reddedilir. Hata kalan aileleri çalıştırmaz ve snapshot dönmez.

Tam ailelerde indeksler bütün diziye aittir. Aynı `customer.id + campaign.id + ad_group.id + segments.date`, Shopping türü ve istek aralığı için tek PD satırı referans alınır. Eksik/gözlenmeyen anahtar `unresolved`, yinelenen PD anahtarı `ambiguous` olur; isimle eşleme yapılmaz. Ürün performansı ve satış linkleri ayrı dizilerdir. Reklamı yapılan/satılan native item, Merchant/feed kimliği ve ham satır korunur; ürünün Shopify kimliği çözülmüş sayılmaz. PD yokken native Ad Group/Product ID silinmez. Mevcut ürün sorgusundan PMax satırı gelirse tutulur fakat Asset Group seçilmez. Kaynak projeksiyonunda metrik kopyası/toplam/rol/maliyet aktarımı yoktur; `publishable=false`. 09 canlı kabulü, 16 ve 17–23 sonraki kapılardır.

#### 10 ve 12 için dar resmî sonuç

23 Ekim 2026'da [cart data v25](https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view) ve [shopping performance v25](https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view) sayfalarının doğrudan metadata bölümleri okundu. Web aracının içerik sınırı nedeniyle aynı herkese açık sayfanın HTML'i salt okunur HTTP ile incelendi; Google Ads hesabı/API'sine çağrı yapılmadı. İki kaynağın segmenting resources listesi `ad_group`, `campaign`; attributed resource `customer`dır. `product_sold_item_id` selectable_with listesi Ad Group'u içerir, `ad_group_ad` içermez. `product_item_id` listesinde `asset_group` yoktur. Bu yüzden bu iki v25 raporuna Ad/Asset Group eklemek doğrulanmış doğrudan çözüm değildir.

12: Search PD Ad kalır; satılan Product ID→Ad bağı açık kalır. PD'nin Ad dönüşümü, satılan ürün kimliği değildir. Ad Group'u gizlice Channel yapmak veya tutar eşitliğinden Ad seçmek yoktur. 10: PMax ürün performansı→Asset Group bağı açık; grup toplamı tekil ürün satırına aritmetikle çevrilmez. Tarihsel listing tree/çözümleyici entegrasyonu olan 11 duraklatılmıştır; bu dilimde açılmaz. Bu sonuç başka API veya sürüm için genel desteklenmiyor iddiası değildir.

Ayrıca [ürün raporlama rehberi](https://developers.google.com/google-ads/api/docs/shopping-ads/reporting), [Asset Group raporlama](https://developers.google.com/google-ads/api/performance-max/asset-group-reporting) ve [v25 Search yanıtı](https://developers.google.com/google-ads/api/reference/rpc/v25/SearchGoogleAdsResponse) kontrol edildi. İmleç stringdir, son sayfada dönmez. Metadata uyumu hesabın sorguyu kabul ettiği veya dolu ürün verdiği anlamına gelmez; gerçek kabul bekliyor.

### Güncel repository düzeltmesi — 23 Ekim 2026, envanter 06 + 07 + 08

Güncel uçlar Search **Ad**, Shopping **Ad Group**, Retail PMax **Asset Group**'tur. Aşağıdaki 16 Ekim kayıtlarında Search Ad Group geçmesi tarihsel durumu anlatır; güncel sorgu hedefi değildir.

Search için `ad_group_ad` günlük performans sorgusu eklendi; eski `ad_group_channel_daily` artık yalnız Shopping ister. Her üç uç için aynı kimlik/tarihte ayrı dönüşüm sorgusu `segments.conversion_action`, `segments.conversion_action_category`, normal `metrics.conversions` ve `metrics.conversions_value` ister. Kategoriler ADD_TO_CART, BEGIN_CHECKOUT, PURCHASE'tır. Dönüşüm eylemi kırılımına gösterim/tıklama/maliyet eklenmez; maliyet her dönüşüm satırında tekrar edilmez. Campaign yardımcı dönüşüm sorgusu ham kanıt olarak kalır, alt seviyeye dağıtılmaz.

Sayfadaki `pd_metric_rows`, `source_row_index` ile değişmemiş ham `rows` satırına bağlı metrik projeksiyonudur. Performans ailesi yalnız gösterim/tıklama ve cost_micros birim ölçeklemesini; dönüşüm ailesi yalnız ilgili kategorinin adet/değerini üretir. Her projeksiyon ortak dokuz alanı taşır ama başka aileye ait metrikler null/not_requested kalır. Bu parçalar henüz birleşmiş dokuz metrikli Dataset satırı değildir. Eksik/sıfır dönüşümlü satırın hiç dönmeyebilmesi sıfır doldurma yetkisi vermez; tamlık ve birleşik yayın 17–21 kapılarıdır. Yeni sorgular genel reporting API üzerinden kullanılabilir; eski canlı kanıt tetikleyicisinin aile listesi büyütülmedi.

08: Cart Data standart `raw_metrics` yalnız altı normal adet/gelir alanını taşır; `all_*` değişmemiş `raw_row` içinde korunur, toplama/yedek/Sales Role girdisi olmaz. Yalnız all verisiyle normal satış rolü üretilmez. PD Purchase dönüşüm sayısı CPD ürün miktarı değildir; ürün→Channel bağlantıları 09–12/16'da kalır. Tarihsel PMax çalışması yeniden açılmaz.

Resmî kontrol 23 Ekim 2026: [v25 alan uyumu](https://developers.google.com/google-ads/api/fields/v25/asset_group), [Search Ad alanları](https://developers.google.com/google-ads/api/fields/v25/ad_group_ad), [dönüşüm raporlama](https://developers.google.com/google-ads/api/docs/conversions/reporting), [segment uyumu](https://developers.google.com/google-ads/api/docs/reporting/segmentation), [Metrics](https://developers.google.com/google-ads/api/reference/rpc/v25/Metrics). Büyük alan sayfaları tam metin aracında boyut sınırını aştı; resmî indeksin conversion_action_category selectable_with kayıtları incelendi. Bu metadata ve sentetik testler hesabın sorguyu çalıştırdığı veya dolu veri döndürdüğü kanıtı değildir. Canlı çağrı/deploy/DB/UI/secret değişikliği yoktur; merge ayrı açık onay ister.

- Paket: `A6-EO-04-C`
- Ürün sahibi analist açıklaması kabulü: **16 Ekim 2026**
- Çalışma zamanı uygulaması: **16 Ekim 2026'da kabul edildi ve merge edildi**
- Canlı Google Ads isteği: **bu açıklamayla yetkilendirilmedi**
- Dataset V2, veritabanı, zamanlayıcı, arayüz, OAuth, gizli bilgi, ortam ve dağıtım değişikliği: **yasak**
- Üst ürün sözleşmesi: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`

Bu belge 16 Ekim 2026'daki kabul edilmiş sorgu ve kanıt sınırını anlatır. Repository uygulaması ve sentetik testler canlı istekten ayrıdır. Tarihsel kabul yeni canlı çağrı izni değildir; güncel proje durumu Execution Plan'dadır.

## İş sonucu

Google birbirine karıştırılmadan iki doğru katman döndürmelidir:

1. Gerçek Google raporlama uç varlığında günlük Ad/Channel performansı.
2. Cart Data destekliyorsa Sales Role dahil, ürün düzeyinde reklamı yapılan ve satılan ürün kanıtı.

Kabul edilmiş Channel uçları:

- Standard Shopping: `Ad Group`
- Search: `Ad Group`
- Performance Max Retail: `Asset Group`

## PMax geniş listing tree kuralı

`cart_data_sales_view` reklamı yapılan ürün, satılan ürün, adet ve geliri koruyabilir; ancak PMax satışını Asset Group'a göre kırmaz. Mevcut ağaç çözümü bağlayıcıdır:

1. Aday Asset Group'ları **reklamı yapılan** `segments.product_item_id` ve listing tree üzerinden bul.
2. Tam olarak bir uygun Asset Group eşleşiyorsa onu kesin Channel kullan.
3. Birden fazla eşleşiyorsa ürün satışını `Unclassified Channel` altında koru.
4. Channel'ı satılan üründen seçme.
5. Belirsiz satışı aday gruplara dağıtma.
6. Yalnız satışın iş tarihi raporlama penceresinde geçerli olduğu kanıtlanmış ağaç verisini kullan.

Bu; tekil ürün kimliği, kategori, marka, ürün türü, özel etiket ve `All products` ağaçlarına aynı uygulanır:

- Tek uygun `All products` Asset Group kesin eşleşmedir.
- Birden çok örtüşen `All products` veya kategori ağacı `Unclassified Channel` üretir.
- Channel sınıflandırılamasa da ürün satışı ve Sales Role korunur.

### Tarihsel listing tree güvenliği

Bugün gözlenen ağaç, önceki satış gününde etkin ağacı kanıtlamaz. Geçmiş satışa kesin Asset Group ancak sürümlü kanıt, eşleşen ağacın Reporting Account saat dilimindeki **tam iş günü raporlama penceresi** boyunca geçerli olduğunu gösterirse verilir.

- Bugünkü ağaç önceki satışa geriye dönük uygulanamaz.
- İş günü içinde ağaç değişirse kesin günlük Channel çözülemez.
- Eksik, kısmi veya çelişkili zaman kanıtı `Unclassified Channel` üretir.
- Ürün satışı, adet, gelir ve Sales Role yine korunur.
- Her kesin eşleşmede satış iş tarihi, hesap saat dilimi, ağaç sürümü/özeti ve geçerlilik penceresi saklanır.

## Sales Role

Tek terim `Sales Role` olarak kalır:

- `Advertised`: Reklamı yapılan ve satılan ürün aynı; Google'ın ana ürün (lead) kanıtıyla destekli.
- `Cross-sell`: İki ürün farklı; Google'ın çapraz satış kanıtıyla destekli.
- `Assisted`: Satılan ürün sağlayıcı tarafından ilişkilendirilmiş; kesin reklamı yapılan ürün kanıtı yok.
- `Unclassified`: Sağlayıcı kimlikleri veya lead/cross-sell kanıtı gerçekten çelişkili.

`Unclassified Channel` ve `Zero Value` Sales Role değildir.

## Sağlayıcı sorgu aileleri

Sağlayıcının aşağıdaki veri aileleri ayrı tutulur.

### Hesap ve kampanya bağlamı

- Reporting Account kimliği;
- Hesap para birimi ve saat dilimi;
- Kampanya kimliği, adı, durumu, reklam kanalı türü/alt türü;
- Merchant Center bağ kanıtı;
- Google Ads API sürümü ve tam GAQL kaynak izi.

### Günlük Channel performansı

- Standard Shopping/Search: Ad Group kimliği; günlük gösterim, tıklama, maliyet ve dönüşüm kanıtı.
- PMax Retail: Asset Group kimliği; günlük gösterim, tıklama, maliyet ve dönüşüm kanıtı.
- Satın alma/sepete ekleme/ödeme başlatma, dönüşüm eylemi/kategorisi kanıtıdır; genel dönüşüm toplamından türetilmez.

### Ürün performansı

`shopping_performance_view`, `segments.product_item_id` düzeyinde tarihsel gösterim, ürün tıklaması, sağlayıcının ilişkilendirdiği `cost_micros`, dönüşüm ve dönüşüm değerini korur.

Ürün gösterimleri Channel gösterimini yeniden oluşturmaz. Provider Product Ad Cost, Channel Ad Cost veya Allocated Ad Cost değildir.

### Ürün satışı ve Sales Role

`cart_data_sales_view`, varsa şunları ister:

- `segments.product_item_id`;
- `segments.product_sold_item_id` ve satılan ürün özellikleri;
- `metrics.units_sold`, `metrics.revenue_micros`;
- Lead adet/gelir;
- Cross-sell adet/gelir;
- Ayrı ham kanıt olarak eşdeğer `all_*` metrikleri.

Cart Data hesapta Conversions with Cart Data ve Merchant Center kurulumu gerektirir. Eksik kurulum, başarılı boş sayfa, gelmeyen alan ve açık sayısal sıfır farklı durumlardır.

### PMax listing kanıtı

- Asset Group kimliği/durumu;
- Ağaç düğümü, üst düğümü ve yolu;
- Dahil/hariç ile birim/alt bölüm durumu;
- Ürün kimliği, marka, kategori, ürün türü, özel özellik/etiket ve `All products`;
- Ağaç kanıtı sürümü/özeti, gözlem zamanı ve kanıtlanmış geçerlilik penceresi;
- Kesin ürün satışından ayrı tutulan `asset_group_product_group_view` toplu kanıtı.

Toplu Asset Group ürün grubu metriği, aritmetik, oranlama veya toplam eşleştirmeyle satılan ürün satırına bağlanamaz.

## Ürün kimliği ve maliyet sınırı

Sağlayıcı anahtarı Merchant Center kimliği, feed label ve item ID'yi korur. Kabul edilmiş resmî Google & YouTube eşitleme yolunda aday kimlik Shopify Admin API ile doğrulanmadan Shopify ürün/varyant, SKU veya başlık yayımlanmaz.

Cross-sell için:

- Ürün performans maliyeti reklamı yapılan ürüne aittir.
- Adet ve gelir satılan ürüne aittir.
- Reklamı yapılan ürün maliyeti satılan ürüne taşınmaz.
- Sonraki paylaştırılmış ürün maliyeti EO-05'e aittir.

## İlk hata ve tamlık

- İlk Google sağlayıcı hatası yürütmeyi ve kalan bütün Google sorgu ailelerini durdurur.
- İlk kanıt yürütmesinde otomatik tekrar, alternatif uç nokta, API sürümü veya kimlik doğrulama yolu yoktur.
- Kısmi çoklu sorgu tam sonuç değildir; ortak ham veri yayımlayamaz.
- Başarılı boş yanıt sıfır veya genel desteklenmiyor kanıtı değildir.
- Satırlar/destek durumları özel, sınırlı ve arındırılmıştır. Token, erişim bilgisi veya sınırsız ham içerik log/repository kanıtına girmez.

## Test hesabı ve sentetik veri sınırı

Google test hesapları reklam yayınlamaz; gereken performans, maliyet, dönüşüm ve Cart Data satış kanıtını üretmez. Test hesabı ürün düzeyinde raporlama kabul kanıtı sayılmaz.

Repository örnek verisi AdsTable'ın kontrollü örnekleridir; yalnız bizim uygulamamızı doğrular:

- Tam GAQL ailesi ve tarih penceresi;
- Ham sayfa, istek kimliği ve içi yorumlanmayan sayfalamanın korunması;
- `Advertised`, `Cross-sell`, `Assisted`, `Unclassified` kuralları;
- Tek/çok geniş ağaç davranışı;
- Channel'ı yalnız reklamı yapılan üründen çözme;
- Tarihsel geçerlilik ve güvenli `Unclassified Channel`;
- Boş, eksik, desteklenmiyor ve açık sıfır ayrımı;
- Otomatik tekrar olmadan ilk hatada durma.

Her sayfa doğrulanmış aktif Shopify kurulumu, bağlı ve Reporting Account seçilmiş Google reklamvereni, varsa korunan yönetici giriş yolu ve şifreli token kasası üzerinden çözülür. Yönetici erişim yolu olabilir; Reporting Account olamaz.

Sentetik testin geçmesi Google'ın alan döndürdüğünü, hesapta Cart Data veya gerçek satış olduğunu kanıtlamaz. Bunlar ayrı onaylı salt okunur Production kanıt yürütmesinin konusudur.

## Ayrı sonraki kapılar

Bu açıklama yalnız repository sözleşmesini yetkilendirir. Her biri ayrı ürün sahibi onayı ister:

1. Çalışma zamanı uygulamasının kabulü ve merge'ü;
2. Dağıtım/ortam değişikliği;
3. İlk canlı Google Ads raporlama yürütmesi;
4. Dataset V2 saklama/eşleme;
5. Shopify ürün kimliği yayımı.

Çalışma zamanı `752cc1988323c238297d00516e7b7009432032c2` olarak kabul edilip squash merge edildi. İlk kanıt tetikleyicisinin ayrı kabul edilmiş repository kapsamı `docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md` ile yönetilir; bu onay dağıtım veya canlı isteği içermez.

## Tarihsel resmî kaynaklar

Kontrol: 16 Ekim 2026.

- v25 Cart Data Sales View: <https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view>
- Shopping ürün raporu: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- PMax Retail raporu: <https://developers.google.com/google-ads/api/performance-max/retail-reporting>
- Asset Group raporu: <https://developers.google.com/google-ads/api/performance-max/asset-group-reporting>
- PMax listing grupları: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- v25 listing filtresi: <https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter>
- API sürümü emeklilik takvimi: <https://developers.google.com/google-ads/api/docs/sunset-dates>
- Test hesapları: <https://developers.google.com/google-ads/api/docs/best-practices/test-accounts>
- Test uygulamaları: <https://developers.google.com/google-ads/api/docs/best-practices/testing>
