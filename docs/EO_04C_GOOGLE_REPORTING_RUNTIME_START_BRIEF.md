# EO-04-C — Google Ads raporlama çalışma zamanı başlangıç açıklaması

## Durum ve yetki

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
