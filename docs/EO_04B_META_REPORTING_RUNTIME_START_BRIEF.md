# EO-04-B — Meta raporlama çalışma zamanı: ilk ve ikinci dilim

## Durum

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
