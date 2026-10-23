# EO-04-E — Üç sağlayıcı için Channel ve ürün ekonomisi başlangıç brief'i

## Belge durumu

- Paket: `A6-EO-04-E`
- Durum: `accepted_product_owner_meta_and_klaviyo_repository_runtime_authorized_live_calls_closed`
- Kontrol tarihi: 16 Ekim 2026
- Ürün sahibi sözleşme kabulü: 16 Ekim 2026
- Yürütülebilir sözleşme: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`
- CI kontrolü: `tests/eo-04e-three-provider-channel-product-economics.test.js`
- 17 Ekim 2026 itibarıyla Meta ve Klaviyo repository çalışma zamanı paketleri ayrıca yetkilendirilmiştir. Canlı sağlayıcı çağrısı, Dataset V2, migration, secret, environment veya dağıtım değişikliği hâlâ ayrı açık onay gerektirir.

Bu belge 16/17 Ekim 2026 kararlarının tarihsel kapsamını korur. Sonraki kabul,
güncel yetki ve iş sırası `docs/EXECUTION_PLAN.md`, nihai anlatım
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. Eski hazırlık kapıları yeni iş
yetkisi değildir; tarihsel kota/erişim kaydı bugün verilmiş taahhüt sayılmaz.

## İş çıktısı ve paket sınırı

EO-04, sağlayıcıların gerçekten verdiği ham kimlikleri, metrikleri ve kesin ilişkileri toplar. EO-04:

- Meta, Google Ads ve Klaviyo için gerçek `Channel` raporlama yaprağını belirler;
- reklamda gösterilen ürün kanıtını, satılan ürün kanıtını ve Channel çözümünü birbirinden ayırır;
- yalnız sağlayıcının açıkça kanıtladığı `Sales Role` ve `Zero Value` durumunu üretir;
- sağlayıcı maliyetini tahminî dağıtmaz;
- ham kanıtı EO-05 Dataset V2'nin kullanabileceği şekilde kanıta sadık ve kaynağı izlenebilir bırakır.

EO-05 Dataset V2; kanonik satırları, hesaplamaları, maliyet dağıtımını, veri uzlaştırmayı ve kalıcı veri modelini kurar. EO-07 kullanıcı arayüzünü kurar. Bu brief bu iki paketin işini öne çekmez.

## Ortak sözlük

### Channel

Channel, sağlayıcının doğruladığı iş raporlama varlığıdır; her sağlayıcı altındaki en derin teknik boyut otomatik olarak Channel sayılmaz:

- Meta: `Ad`
- Google Standard Shopping: `Ad Group`
- Google Performance Max Retail: `Asset Group`
- Google Search: `Ad Group`
- Klaviyo Campaign: `Campaign Message`
- Klaviyo Flow: `Flow Message`

Klaviyo `send_channel` zorunlu ayrı `Medium` eksenidir (`Email`, `SMS`, `WhatsApp`, `Push`). Variation, Message Channel'ın alt kırılımıdır; Channel'ın yerine geçmez.

Campaign, Ad Set, Flow, trigger, split ve delay tek başına Channel değildir.

### Sales Role

- `Advertised`: Satılan ürün, kesin reklamda gösterilen ürün kanıt kümesindedir.
- `Cross-sell`: Kesin reklamda gösterilen ürün kümesi bilinmektedir ve satılan ürün bu kümenin dışındadır.
- `Assisted`: Sağlayıcı satışı Channel bağlamına bağlamıştır fakat içerik tek bir reklam ürününü kanıtlamaz; genel mağaza, kategori, dinamik/geniş küme veya Search gibi senaryolar buna dahildir.
- `Triggered`: Klaviyo Flow Message veya Flow Message Variation attribution'ı ile gelen satılan üründür.
- `Unclassified`: Kanıt gerçekten çelişkili veya belirsizdir. Kesin ürün kanıtı bulunmamasının varsayılan adı değildir.

### Ayrı eksenler

- `Zero Value`, Sales Role değildir. Satılan adet pozitif ve sağlayıcı ürün satış değeri açıkça sıfırsa role `Zero Value` değer niteleyicisi eklenir.
- `Unclassified Channel`, Sales Role değildir. Satış kanıtı vardır fakat kesin Channel çözülememiştir.
- Eksik, null, desteklenmeyen, izin reddi ve açık sıfır birbirine dönüştürülemez.

## Meta sözleşmesi

| Kampanya/reklam içeriği yapısı | Channel | Reklamda gösterilen ürün kanıtı | Satılan ürün sonucu | Sales Role |
| --- | --- | --- | --- | --- |
| Tekil kesin ürün reklam içeriği | Ad | Kesin `product_id` / `product_item_id` | Aynı ürün | Advertised |
| Kesin çoklu ürün reklam içeriği | Ad | Kesin `retailer_item_ids` veya eşdeğer açık liste | Liste içindeki ürün | Advertised |
| Kesin çoklu ürün reklam içeriği | Ad | Kesin açık liste | Liste dışındaki ürün | Cross-sell |
| Ürün kümesi, kategori, dinamik veya genel reklam içeriği | Ad | Tekil ürün kesin değil | Sağlayıcının ilişkilendirdiği satılan ürün | Assisted |
| Çelişkili kimlik/kanıt | Ad veya çözülebildiği bağlam | Çelişkili | Satılan ürün korunur | Unclassified |

Bağlayıcı sınırlar:

1. Campaign ve Ad Set yalnız hiyerarşi bağlamıdır; Channel `Ad`dır.
2. Mevcut izin kapsamı `ads_read` olarak kalır. `catalog_management` veya başka katalog/business izni istenmez.
3. Ad seviyesindeki gösterim, tıklama ve harcama kesin Channel toplamıdır.
4. `product_id` kırılımında sağlayıcının gerçekten döndürdüğü ürün metrikleri ayrı ham kanıt olarak korunur.
5. Ürün kırılımı içindeki gösterim/tıklama/harcama semantiği gerçek katalog reklamı cevabıyla doğrulanmadan `Ad Cost` veya gerçek ürün maliyeti sayılmaz.
6. Ad harcaması ürünlere oranlanmaz veya paylaştırılmaz.
7. Desteklenen kimlik yolu resmî Shopify `Facebook & Instagram` satış kanalıdır. Sağlayıcı ürün kimliğinden elde edilen Shopify ürün kimliği + varyant kimliği adayları Shopify Admin API ile doğrulanır; varyantın ürüne ait olduğu kanıtlanmadan SKU, ürün adı veya varyant adı yayımlanmaz.
8. Meta ürün kimliği biçimi veya eşlemesi doğrulanamazsa sağlayıcı ID kaybedilmez fakat Shopify ürünü uydurulmaz. Özel pixel, manuel katalog ve üçüncü taraf katalog bu sürümün kapsamı dışındadır.

## Google Ads sözleşmesi

| Kampanya ailesi | Channel | Listing yapısı | Satılan ürün sonucu | Sales Role |
| --- | --- | --- | --- | --- |
| Standard Shopping | Ad Group | Tekil veya çoklu Merchant Center ürünleri | Kesin Ad Group bağlamındaki satılan ürün | Advertised / Cross-sell / Assisted kanıta göre |
| Performance Max Retail | Asset Group | Ürün yalnız bir Asset Group ürün listeleme ağacına kesin uyuyor | Kesin Asset Group altında satılan ürün | Advertised / Cross-sell kanıta göre |
| Performance Max Retail | Asset Group | Ürün birden fazla Asset Group'a uyuyor veya kesin üyelik kanıtlanamıyor | Satılan ürün `Unclassified Channel` altında kalır | Sağlayıcı ilişki kanıtı korunur; tahmin yapılmaz |
| Search | Ad Group | Kesin reklamda gösterilen ürün yok | Sağlayıcının ilişkilendirdiği satılan ürün | Assisted |

Bağlayıcı sınırlar:

1. `segments.product_item_id` reklamda gösterilen/tıklanan ürün; `segments.product_sold_item_id` satılan ürün kanıtıdır.
2. Standard Shopping için Channel `Ad Group`, PMax Retail için `Asset Group`, Search için `Ad Group`tır.
3. `cart_data_sales_view` Campaign ve Ad Group ile segmentlenebilir; Asset Group ile segmentlenemez. Google'ın vermediği PMax Asset Group ilişkisi aşağıya dağıtılmaz.
4. PMax ürün listeleme ağacı üyeliği yalnız tek Asset Group'u kesin belirliyorsa Channel kesin olur; aksi halde `Unclassified Channel` kullanılır.
5. Search satışı bastırılmaz. Kesin reklamda gösterilen ürün kanıtı olmadığı için sağlayıcının ilişkilendirdiği satılan ürün `Assisted` olur.
6. Sağlayıcı ürün maliyeti, Channel harcaması ve ilerideki gerçek/birleşik ürün maliyeti ayrı değerlerdir. Google'ın `cost_micros` değeri yalnız sağlayıcı atfı kanıtıdır.
7. Desteklenen ürün kimliği yolu Shopify'ın resmî `Google & YouTube` otomatik ürün senkronudur. Google item ID'deki Shopify ürün/varyant adayları Shopify Admin API ile doğrulanmadan SKU veya ürün adı yayımlanmaz.
8. Manuel Merchant Center feed'i ve üçüncü taraf feed bu sürümün kapsamı dışındadır.

PMax üyeliği satışın tüm sağlayıcı iş günü penceresini kapsayan tarihsel kanıtla
okunur; bugünkü ağaç geçmiş güne uygulanmaz. Kabul edilmiş ayrıntılı zaman sınırı
`docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md` ve nihai analiz kitabındadır.
Bu kısa başlangıç tablosu tarihsel kayıt toplamanın tamamlandığını göstermez.

## Klaviyo sözleşmesi

### Campaign

| Campaign yapısı | Channel | Medium / Variation | Satılan ürün attribution | Sonuç |
| --- | --- | --- | --- | --- |
| Tek variation | Campaign Message | `send_channel` zorunlu; Variation ayrı kesin kırılım olabilir | Olay Campaign Message'a bağlı | Satış kesin Message Channel altında korunur |
| A/B veya çoklu variation | Campaign Message | Medium zorunlu; kesin Variation yoksa yalnız Variation çözümlenmemiş | Olay Campaign Message'a bağlı | Satış kesin Message Channel altında korunur; `Unclassified Channel` oluşmaz |

Klaviyo `2026-10-15` GA sözleşmesinde Campaign Message raporlamanın zorunlu kimliğidir; `send_channel` Medium'dur ve Variation isteğe bağlı alt boyuttur. Olay attribution Campaign Message'ı içerir fakat Campaign Variation'ı içermez. Bu asimetri Message Channel'ı bozmaz; yalnız Variation çözünürlüğünü sınırlar.

### Flow

1. Flow, trigger, split ve delay Channel değildir.
2. Channel her zaman `Flow Message`tır.
3. Attribution `Flow Message Variation` döndürürse Variation'ın üst Flow Message'ı Channel olarak çözülür; Variation ayrıca kesin tutulur.
4. Variation attribution yok fakat `Flow Message` attribution varsa Channel kesin Flow Message, Variation çözümlenmemiş olur.
5. Bu attribution ile gelen satılan ürün `Triggered` olur.
6. Attribution çelişkiliyse ürün `Unclassified`; Message çözülemiyorsa `Unclassified Channel` altında korunur.

### Campaign Sales Role

- 23 Ekim 2026 düzeltmesi: kesin tek ürün içeriği veya ürün listesi,
  etkileşime konu ürünü tek başına kanıtlamaz. Yalnız bu bilgi varsa `Assisted`.
- İçerik kümesi üyeliğinden `Advertised` / `Cross-sell` üretilmez;
  aynı satışa bağlı doğrulanmış ürün etkileşimi yolu bu düzeltmede eklenmez.
- Genel mağaza, kategori, dinamik/geniş içerik veya tekil ürün kanıtı olmayan sağlayıcının ilişkilendirdiği satış: `Assisted`.
- Gerçek kanıt çelişkisi: `Unclassified`.
- Pozitif adet ve açık sıfır değer: mevcut Sales Role + `Zero Value`.

### Klaviyo günlük kayıt düzeyi ve kota

1. Campaign Reporting API toplam değerler verir; var olmayan bir Campaign zaman serisi cevabı üretilmez.
2. Günlük iş tarihi gerekiyorsa her gün için ayrı tek-gün zaman aralığı sorgusu yapılır.
3. İlk veri alımı ortak EO-04-A sırasına göre yalnız dün, sonra bugündür.
4. Campaign Values düşük kota sınıfı (`1/s`, `2/min`, `225/day`) korunur; sayfalama ve tekrar bu kotayı aşamaz.
5. Saatlik yenileme, veri uzlaştırma penceresi ve workspace ölçek kota hesabı EO-05 sorumluluğudur.
6. Flow Series'in bulunması Campaign için zaman serisi varmış gibi davranma yetkisi vermez.

### Klaviyo kimlik ve maliyet sınırı

- Desteklenen yol Klaviyo'nun resmî Shopify entegrasyonudur.
- Ordered Product olayında gerçekten dönen ProductID, SKU, ProductName, Quantity ve değer ham kanıt olarak alınır; hesaba özel alan adları gözlemle doğrulanır.
- Estimated 30-Day Email Spend defteri EO-04-D'de korunur fakat Campaign/Flow/Message/Variation veya ürüne dağıtılmaz. Dağıtım EO-05 kararıdır.

## Ad Cost yaşam döngüsü

Kullanıcıya dönük nihai terim `Ad Cost` olacaktır. Fakat aşağıdaki üç teknik değer birbirinin yerine kullanılamaz:

1. **Channel Ad Cost:** Sağlayıcının gerçek Channel kayıt düzeyinde döndürdüğü harcama/maliyet.
2. **Sağlayıcı Ürün Ad Cost:** Sağlayıcının kendi attribution mantığıyla bir ürün satırına yazdığı maliyet.
3. **Dağıtılmış Ad Cost:** EO-05'in kabul edilmiş formülle Channel veya ürünlere dağıtacağı maliyet. Sağlayıcı gerçeği değildir ve kaynak bilgisi ayrı kalır.

| Sağlayıcı | EO-04'te alınacak maliyet kanıtı | Ürün satırında `Ad Cost` koşulu | EO-05'e bırakılan işlem |
| --- | --- | --- | --- |
| Meta | Ad seviyesinde kesin harcama; ürün kırılımındaki harcama yalnız gerçek katalog cevabıyla doğrulanırsa ayrı sağlayıcı-ürün kanıtı | Yalnız ürün düzeyindeki anlamı canlı kabul edilmiş ve Shopify ürün/varyant kimliği doğrulanmışsa; Sales Role kesin değeri değiştirmez | Sağlayıcı ürün maliyeti bulunmayan satırlara Ad toplamının tahminî dağıtımı, birleşik ve gerçek ürün maliyeti |
| Google Ads | Ad Group/Asset Group Channel maliyeti ve `shopping_performance_view.metrics.cost_micros` sağlayıcı-ürün kanıtı | Google item kimliği resmî Shopify senkronizasyon yoluyla ürün/varyanta doğrulanmışsa sağlayıcı ürün maliyeti `Ad Cost` girdisi olur | Sağlayıcı ürün maliyeti bulunmayan satırlara tahminî dağıtım, birleşik ve gerçek ürün maliyeti |
| Klaviyo | Başlangıç tarihli Estimated 30-Day Email Spend defteri | EO-04'te Campaign/Flow/Variation/ürün Ad Cost yoktur | Tahmini harcamanın zaman, Campaign, Flow, Channel veya ürüne dağıtımı |

Bağlayıcı Ad Cost kuralları:

1. EO-04 maliyet üretmez; sağlayıcının açıkça döndürdüğü değer veya Klaviyo'nun kullanıcı tarafından girilmiş başlangıç tarihli tahmini harcama kanıtını alır.
2. Sağlayıcının açık sıfırı `0` olarak korunur. Eksik, null, desteklenmeyen, izin reddi veya doğrulama bekleyen değer sıfıra çevrilmez.
3. Maliyet her zaman sağlayıcı hesabı, iş tarihi/zaman penceresi, kaynak para birimi, kaynak saat dilimi, API sürümü, sorgu ve attribution kaynak bilgisiyle taşınır.
4. Shopify ürün/varyant kimliği doğrulanamasa bile sağlayıcı ürün kimliği ve maliyet kanıtı kaybedilmez; yalnız Shopify SKU/ad/varyant etiketi yayımlanmaz.
5. Channel maliyeti, ürün maliyeti satırlarının toplamından yeniden üretilmez. Ürün satırları gösterim veya sağlayıcı atfı nedeniyle üst toplamı aşabilir.
6. Ürün maliyeti yoksa Channel maliyeti ürünlere eşit, gelir, tıklama, adet veya başka oranla dağıtılmaz.
7. Sağlayıcı ürün bazında kesin Ad Cost veriyorsa bu kanıt; ürünün Sales Role'ü `Cross-sell` veya `Assisted`, değer niteleyicisi `Zero Value` ya da Channel sonucu `Unclassified Channel` olsa bile aynı ürün satırında korunur. Sales Role, değer niteleyicisi veya çözülemeyen Channel kesin sağlayıcı maliyeti silemez.
8. Sağlayıcı ürün bazında maliyet vermiyorsa Channel toplam maliyeti ürünlere eşit, satış, gelir, tıklama, adet, Sales Role veya başka bir oranla tahminî dağıtılmaz.
9. `Unclassified Channel` ürününün kesin sağlayıcı ürün maliyeti korunur; fakat ürün ve maliyet bilinen bir Asset Group, Ad Group, Ad veya Variation'a tahminle taşınmaz.
10. Klaviyo `Triggered` ürünlerinde sağlayıcının kendi verisi olan ürün maliyeti bulunmaz. Estimated Spend'den maliyet dağıtımı yalnız EO-05'in kabul edilmiş formülüyle üretilebilir.
11. Klaviyo Update spend ve Change value geçmişi başlangıç tarihli defterde korunur; EO-05 maliyet dağıtımı geçmiş girdiyi sessizce yeniden yazamaz.
12. Yenileme ve veri uzlaştırma maliyet kanıtını performans kanıtıyla aynı kanıta sadık anlık görüntü ilkelerine göre yeniden okuyabilir; çalışma sıklığı ve kota bütçesi EO-05'tedir.
13. Vergi, kargo, platform ücreti, attribution örtüşme ve birleşik/gerçek maliyet formülleri EO-05 analist sözleşmesi olmadan `Ad Cost` içine eklenmez.
14. EO-07 UI, kabul edilmiş maliyet alanını kullanıcıya `Ad Cost` etiketiyle gösterir; kaynak/köken bilgisi ayrımı detay yüzeyinde kaybolmaz.

Örnek: Google, Kolye B için kesin sağlayıcı ürün Ad Cost olarak `₺18` döndürürse bu değer Kolye B satırında korunur. Ürün `Cross-sell` ise `Cross-sell + ₺18`, kesin Channel çözülemiyorsa `Unclassified Channel + ₺18`, ürünün satış değeri sıfırsa `Zero Value + ₺18` gösterilir. Buna karşılık sağlayıcı yalnız Ad/Ad Group/Asset Group toplamı olarak `₺500` döndürüyorsa bu tutar ürünlere keyfî olarak bölünmez.

## Ortak ham kanıt zarfı

Her sağlayıcı satırı aşağıdaki sınıfları taşıyabilir; sağlayıcının kendi verisi olan alan adı ve ham referans kaybedilmez:

1. Kurulu Shopify mağazası ve çalışma alanı yetkisi
2. Sağlayıcı, kaynak sistem, doğrulanmış hesap ve Reporting Account bağlamı
3. İş tarihi, kaynak saat dilimi, para birimi ve istek penceresi
4. Campaign ve sağlayıcı hiyerarşi kimlikleri/adları
5. Channel türü, kimliği, adı ve çözüm durumu (`exact` / `unknown`)
6. Reklamda gösterilen ürün kanıtı, kanıtın kesin/eksik/elde edilemiyor durumu ve kaynak alanı
7. Satılan ürün kimliği, başlığı/adı, SKU, adet ve değer; yalnız sağlayıcının döndürdüğü kadarıyla
8. Sales Role ve Zero Value değer niteleyicisi; yalnız kanıtla
9. Channel metrikleri ve varsa sağlayıcı ürün metrikleri; birbirine karıştırılmadan
10. Destek/gözlem durumu, API sürümü, adaptör sürümü, istek/sorgu kaynak bilgisi ve güvenli hale getirilmiş ham referans

## EO-04-E kabul matrisi

Sağlayıcıya özel ve birleşik belirlenimci kabul aşağıdakileri kanıtlamalıdır:

1. Meta Channel daima Ad olarak kalır.
2. Google Standard Shopping, PMax Retail ve Search farklı gerçek Channel raporlama yapraklarını korur.
3. PMax belirsiz ürün listeleme ağacı üyeliği `Unclassified Channel` üretir ve satış dağıtılmaz.
4. Klaviyo Campaign Message Channel olarak kalır; çoklu Variation yalnız Variation'ı çözümlenmemiş bırakır ve Message biliniyorsa `Unclassified Channel` üretmez.
5. Klaviyo Flow Message Channel olarak kalır; Flow Message Variation üst Message'a çözülür ve ayrı Variation kanıtı olarak korunur.
6. `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve gerçek belirsizlik için `Unclassified` ayrımı çalışır.
7. `Zero Value` Sales Role değildir; değer niteleyicisidir.
8. Sağlayıcı ürün maliyeti ile Channel harcaması ve gelecekteki birleşik/gerçek maliyet birbirine dönüştürülmez.
9. Kimliği doğrulanmamış ürün SKU/name olarak yayımlanmaz; ham sağlayıcı ID ve sağlayıcı maliyet kanıtı kaybedilmez.
10. Channel Ad Cost, Sağlayıcı Ürün Ad Cost ve Dağıtılmış Ad Cost birbirine dönüşmeden ayrı kalır.
11. Kesin sağlayıcı ürün maliyeti; `Cross-sell`, `Assisted`, `Zero Value` veya `Unclassified Channel` altında da aynı ürün satırında korunur.
12. Ürün maliyeti yokken Channel maliyeti ürünlere dağıtılmaz; açık sıfır dışındaki durumlar sıfır olmaz.
13. Sentetik test verisi yalnız sözleşme davranışını kanıtlar; canlı sağlayıcı gerçeği olarak sunulmaz.

## Açık kabul ve uygulama kapıları

1. **PASS — 16 Ekim 2026:** Ürün sahibi bu brief ve yürütülebilir sözleşmeyi açıkça kabul etti.
2. Meta, Google ve Klaviyo sağlayıcı veri çalışma zamanları ayrı alt paket sahipliğinde uygulanır; bir sağlayıcı düzeltmesi diğerini değiştirmez.
3. İlk sağlayıcı hatasında durulur; sonraki sağlayıcıya ilerlenmez.
4. Gerçek sağlayıcı yanıtı gerektiren kabiliyet alanları `validation_pending` kalır; sentetik test ile `supported` yapılamaz.
5. Her sağlayıcının küçük kontrollü canlı kanıtı ayrıca ürün sahibi onayıyla yapılır.
6. EO-04-E nihai PASS; repository, sağlayıcıya özel canlı kanıt ve birleşik uydurulmamış veriyle kabul birlikte görülmeden verilemez.

## Resmî kaynaklar — 16 Ekim 2026

- Klaviyo değişiklik günlüğü: <https://developers.klaviyo.com/en/docs/changelog_>
- Klaviyo çoklu iletişim ortamlı Campaign API: <https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview>
- Klaviyo Reporting API: <https://developers.klaviyo.com/en/reference/reporting_api_overview>
- Klaviyo Events API: <https://developers.klaviyo.com/en/reference/get_events>
- Klaviyo Campaign Variation: <https://developers.klaviyo.com/en/reference/get_campaign_variation>
- Google Shopping raporlaması: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- Google Performance Max Asset Group raporlaması: <https://developers.google.com/google-ads/api/performance-max/asset-group-reporting>
- Shopify Google ürün senkronizasyonu: <https://help.shopify.com/en/manual/online-sales-channels/marketplaces/google/getting-setup/syncing-products>
- Meta resmî Business SDK Ads Insights alanları: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta resmî Business SDK Ad Creative alanları: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py>

