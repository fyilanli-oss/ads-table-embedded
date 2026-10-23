# EO-04-B — Meta raporlama çalışma zamanı: ilk ve ikinci dilim

## Durum

### 04 — Yerel Ad–ürün kaynak referansı, 23 Ekim 2026

`readDailyEvidenceSnapshot`, iki ailenin bütün sınırlı sayfaları başarıyla alındıktan sonra ayrı `source_links` zarfı üretir. Kapsam istemciden değil doğrulanmış kurulumun workspace/install generation ve bağlı Reporting Account otoritesinden gelir. Ürün satırındaki `account_id` hesap kimliğinin sayısal bölümüyle aynı olmalı; `ad_id`, tek günlük `date_start=date_stop` ve istek aralığı doğrulanmalıdır. Campaign/Ad Set kimlikleri iki tarafta da dolu ve aynı olmadan PD satırı seçilmez. Adlar anahtar değildir.

Tek PD Ad–gün kaydı varsa `product_row_index` → `pd_row_index` referansı kurulur. Aynı Ad–gün için birden fazla PD kaydı `ambiguous`, üst kimlik çelişkisi `conflicting`, eksik/gözlenmeyen kimlik `unresolved` olur. Ürün satırı silinmez veya başka hesaba/güne/üst kayda taşınmaz. Farklı ürünlerin aynı PD satırına bağlanması metrik kopyası değildir; referansta yalnız kimlikler ve indeksler vardır. İndeksler snapshot içi kaynak izidir, kalıcı Dataset anahtarı değildir.

Bu dilim 04'ü tamamen kapatmaz: katalog/creative kanıtı, Shopify Product/Variant doğrulaması, Sales Role ve ürün maliyet anlamı uygulanmaz. Native `product_id` örüntüsü parçalanmaz veya Shopify kimliği sayılmaz. `shopify_identity_state=unresolved_mapping_pending`, `publishable=false`; ham metrik ve ürün yanıtları aynen kalır. Ürün kırılımındaki satır limitinden tam katalog kapsamı çıkarılmaz. Sayfa çifti giriş noktası değişmez; eksik sayfadan referans kurulmaz. Sorgu/alan/izin listesi genişletilmez, canlı çağrı eklenmez.

Resmî [Meta Business SDK Insights alan listesi](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/adsinsights.py), 23 Ekim 2026 kontrolünde hesap, Ad, Ad Set, Campaign ve tarih alanlarını; dört converted/promoted quantity/value alanını listeler. Bu SDK snapshot'ı sorgu kombinasyonu, dönen katalog verisi veya ürün/satış semantiği kabulü değildir. Önceki doküman gözlem kayıtları kendi tarihleriyle korunur.

### Güncel düzeltme — 23 Ekim 2026, envanter 02 + 03

Ürün sahibi repository uygulamasını onayladı. Standart Ad × `product_id` sorgusu artık `converted_product_quantity`, `converted_product_value`, `converted_promoted_product_quantity` ve `converted_promoted_product_value` alanlarının dördünü birlikte ister. Eski test bayrağı uyumluluk için kabul edilir; false verilmesi alanları çıkarmaz. Ham ürün satırları değiştirilmez; destek, ürün maliyeti, satış rolü veya gerçek katalog kabulü kanıtlanmış sayılmaz.

PD Ad sorgusunun tüm mevcut alanları korunur; `action_breakdowns=action_type` açık yazılır. `outbound_clicks` dizisindeki `outbound_click.value` Click olur; `clicks` veya `inline_link_clicks` yedeği yoktur. Shopify web kapsamı için `offsite_conversion.fb_pixel_add_to_cart`, `offsite_conversion.fb_pixel_initiate_checkout` ve `offsite_conversion.fb_pixel_purchase` seçilir. Adet `actions`, değer aynı türün `action_values` kaydından alınır. Grouped `omni_*`, on-Meta veya mobil-app olayları bu web metriğine eklenmez/yedek olmaz. Varsayılan attribution `value` okunur; pencere alanları birbirine eklenmez ve istek attribution ayarları değiştirilmez.

Ham Ad satırları `rows` içinde aynen kalır; dokuz PD metriğinin projeksiyonu `pd_metric_rows` içinde `source_row_index` ile o satıra bağlanır. Çok sayfalı snapshot bu indeksleri tüm ham satır dizisine göre taşır. Bu, tam kanonik Dataset gerçeği veya yayın değildir; kurulum/para birimi/FX/kimlik ve Dataset kapıları tamamlanmış sayılmaz. Ürün satırlarına PD metrikleri kopyalanmaz.

Eksik/null değer `null + unknown + absent`, boş dizi `null + unknown + empty`, açık sayısal sıfır `0 + supported + zero` kalır. Seçilen türün yinelenmesi, bozuk dizi veya geçersiz sayı şema hatasıdır; tekrar veya kısmi yayın yoktur. Aynı aksiyon türündeki adet ile değer bağımsızdır: adet bulunması eksik değeri sıfır yapmaz.

Resmî belgeler 23 Ekim'de kullanıcı onaylı tarayıcı okumasıyla kontrol edildi: [Insights](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights), [alan referansı](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/insights), [AdsActionStats](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats), [Breakdowns](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns). Alan referansı v25 seçiliydi; AdsActionStats v26 idi. Bu sürüm ayrımı ve referansta promoted alanlarının bulunmaması v26 ürün kombinasyonunun doğrulandığı iddiasına çevrilmez. Dört alan ürün sahibi kararıyla korunur; gerçek ürün yanıtı ve Sales Role testi hâlâ açıktır. Yeni canlı çağrı/deploy/DB/UI yetkisi yoktur. Aşağıdaki ilk/ikinci dilim kayıtları tarihsel kapsamı korur.

- Ürün sahibi başlangıç onayı: **16 Ekim 2026'da kayıtlı**
- İlk dilim: **Ad Channel günlük ham Insights sayfası**
- İkinci dilim onayı: **16 Ekim 2026'da kayıtlı**
- İkinci dilim: **Ad + `product_id` günlük ham Insights sayfası**
- Canlı Meta isteği: **bu dilimle yetkilendirilmedi**
- Dataset V2, veritabanı, zamanlayıcı, arayüz, OAuth izni, gizli bilgi, ortam ve dağıtım değişikliği: **yasak**

Bu belge 16 Ekim 2026 başlangıç kapsamını ve 18 Ekim'de onaylanan dar hata düzeltmesini birlikte saklar. İlk/ikinci dilim ifadeleri tarihsel aşamadır; yeni çalışma veya canlı çağrı izni değildir. Güncel durum Execution Plan'dadır.

## Neden dar kapsam?

Meta'nın gerçek Channel'ı Ad'dir. İlk dilim yalnız sağlayıcının günlük Ad düzeyi isteğini ve imleç sınırını kanıtlar. Ürün satırı, Sales Role veya ürün Ad Cost tahmin etmez.

Kabul edilen ürün sözleşmesi, ürün kırılımındaki gösterim/tıklama/harcamayı kesin sağlayıcı ürün kanıtı saymadan gerçek katalog yanıtı ister. Ürün kırılımı, Creative reklamı yapılan ürün kanıtı ve Shopify ürün/varyant doğrulaması ayrı kapılardır.

## Tam istek

- Uç nokta: `/{graph-version}/{ad-account-id}/insights`
- Graph sürümü: `v26.0`
- OAuth izni: yalnız `ads_read`
- `level=ad`
- `time_increment=1`
- Başlangıç/bitiş dahil, sınırlı `time_range`
- Yalnız içi yorumlanmayan `after` imleci
- Alanlar: hesap, Campaign, Ad Set ve Ad kimliği/adı; iş tarihleri; gösterimler, tıklamalar, satır içi bağlantı tıklamaları, dışa giden tıklamalar, harcama, eylemler ve eylem değerleri
- Bu ilk dilimde `product_id` kırılımı yok

## Çıktı sınırı

Sağlayıcıya özgü sayfa zarfı:

- `fact_family=ad_channel_daily_insights`
- `channel_type=ad`
- Sonraki sözleşme denetimli normalleştirme için değiştirilmemiş sağlayıcı satırları
- Sonraki imleç
- Sağlayıcı istek kimliği
- Token/gizli bilgi içermeyen sorgu kanıtı

Bu Dataset V2 değildir; kalıcı saklanmaz.

## Hata kuralları

- Meta `190`, `reauthorization_required` olur; tekrar edilmez.
- Belgelenmiş kota sınıfları yeniden denenebilir sınıflandırılır.
- Geçici sağlayıcı/sunucu hataları yeniden denenebilir sınıflandırılır.
- Başarılı HTTP yanıtında bozuk JSON veya eksik `data`, `provider_schema_changed` ile güvenli ret olur.
- Geçerli imleç olmadan sonraki sayfa güvenle reddedilir.
- Boş `data` dizisi geçerli boş sayfadır; sıfır uydurulmaz.

## Onaylı dar hata düzeltmesi — 18 Ekim 2026

Ürün sahibinin resmî Meta sayfalarından paylaştığı iki metin incelendi. Bağımsız HTTP erişimi başarılı ilan edilmez. Kaynaklar rate-limiting ve error-handling sayfalarıdır; kaynak izi ve GitHub koruma kanıtı `docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json` içindedir.

- İzin hataları (`10`, `200–299`, tek başına HTTP `403`) token geçersizliği sayılmaz; `permission_denied` sonlandırıcı sınıftır. Hesap keşfinde `403` mevcut Graph hatası olarak kalır; yeniden yetkilendirme gerekçesi üretilmez.
- Açık `190` token hatası ve mevcut `401` davranışı korunur.
- `80000` ve `80004`, HTTP `403` ile gelse de kota sınıfıdır.
- Yeniden denenebilir sınıflandırma otomatik tekrar yetkisi değildir. İlk hata isteği bitirir. İzin/kotada bağlantı yaşam döngüsü değişmez; kalan sayfa/veri aileleri çağrılmaz; kısmi sonuç yayımlanmaz.
- Sayısal kota, zamanlayıcı, BUC bekleme süresi ayrıştırıcısı veya canlı çağrı eklenmez.

## İkinci dilim — Ham ürün kırılımı

Yalnız repository'deki ikinci dilim ayrı Meta isteği ekler:

- `level=ad`;
- `breakdowns=product_id`;
- `time_increment=1`;
- Sabit operasyonel `product_id_limit=100`;
- Ad hiyerarşisi ve iş tarihi kimliği;
- Ham `impressions`, `clicks`, `spend`, `converted_product_quantity`, `converted_product_value`.

Her ürün kırılımı satırında boş olmayan sağlayıcı `product_id` bulunmalıdır. Diğer metrikler değiştirilmez; eksik veya null olabilir. Çalışma zamanı sıfır uydurmaz, alanları normalleştirmez/sınıflandırmaz.

Bu dilim, ürün gösterim/tıklama/harcamasının kesin ürün `Ad Cost` olduğunu **kanıtlamaz**. Kanıt durumu `validation_pending_real_catalog_response` kalır. Creative sınıflandırması, Sales Role, Shopify kimlik doğrulaması, kalıcı saklama, Dataset V2, zamanlayıcı veya arayüz davranışı eklemez.

## Sonraki kapı

Canlı istekten önce repository yetki dilimi iki sayfayı şunlara bağlar:

1. Doğrulanmış aktif Shopify kurulumu;
2. Onun bağlı, tek yetkili Meta bağlantısı;
3. Tam olarak bir seçili Meta Reporting Account;
4. Yalnız sunucudaki şifreli sağlayıcı-token kasası.

Kullanıcı hesap kimliği veremez/değiştiremez; token veya erişim bilgisi kimliği sonuç/kanıtta görünmez. Ad/Channel ve ürün sayfaları ancak iki istek de başarılıysa birlikte döner. Ürün isteği başarısızsa ikisi de yayımlanmaz. Yetki dilimi kendi başına sağlayıcı çağrısı veya veritabanı yazımı yapmaz.

Testler ve ürün sahibi incelemesinden sonra ayrı onaylı canlı katalog yanıtı metrik anlamını kanıtlayabilir veya reddedebilir. Ancak bundan sonra ayrı Meta dilimi şunları ekleyebilir:

1. Creative/promoted-object kesin reklamı yapılan ürün kanıtı;
2. Sales Role sınıflandırması;
3. Resmî Shopify Facebook & Instagram kimlik adayı doğrulaması;
4. Yalnız canlı kanıt desteklerse kesin ürün `Ad Cost` yayımı.

Bu tarihsel sırada Meta sağlayıcı dilimi kabul edilmeden Google veya Klaviyo çalışma zamanı başlamaz.

## Tarihsel resmî kaynaklar

Kontrol: 16 Ekim 2026.

- Resmî SDK Ads Insights alanları: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Resmî SDK Ad Insights istek parametreleri: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py>
- Shopify Admin GraphQL 2026-10 ProductVariant: <https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant>
- Shopify Admin GraphQL `productVariant` sorgusu: <https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant>
