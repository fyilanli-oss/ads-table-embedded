# EO-04-B — Meta App Role hazırlığı

## Durum

- Ürün sahibi uygulama onayı: **17 Ekim 2026**
- Repository hazırlığı: **hazır; 300 test, tür kontrolü ve Production derlemesi geçti**
- Production dağıtımı: **`ed1b12f` üzerinde READY; 17 Ekim'de ayrı onaylandı**
- Gerçek Shopify Admin masaüstü/mobil görsel kabulü: **17 Ekim 2026'da PASS**
- Meta rol, hesap, token, gizli bilgi veya canlı çağrı değişikliği: **bu paketle yetkilendirilmedi**
- Gerçek hesap kabulü: **kabul edilmiş App Tester rolü ve ayrı onaylı canlı çağrı bekliyor**
- Merge: **17 Ekim'de açık onay verildi; bu tarihsel kayıt anında zorunlu CI ve GitHub merge bekliyordu**

Bu belge 17 Ekim 2026'daki hazırlık ve kabul sınırlarını anlatır. Bugünkü durum Execution Plan'dadır. Tarihsel hazırlık gerçek katalog verisi doğrulanmış anlamına gelmez.

## Analist sonucu

Mevcut Meta bağlantısı ve salt okunur raporlama çalışma zamanı, yetkili gerçek kişinin Meta uygulamasına Tester olarak ekleneceği güne hazırlanır. App Role sağlayıcı tarafı erişim kapısıdır; yeni OAuth izni veya kurulum/hesap/token yetkisini aşma gerekçesi değildir.

Settings'in bağlı durumundan geçici iç **`Run Meta evidence`** eylemi kaldırılır. Seçili Reporting Account ve bağlantıyı kesme eylemleri kalır. Kimliği doğrulanmış sunucu kanıt adresi kontrollü kabul taşıyıcısı olarak durur. Butonun kaldırılması OAuth, token saklama, raporlama sorgusu veya veri anlamını değiştirmez.

## App Role çalışma modeli

Birinci aşama sınırlı geliştirme kabulüdür:

1. Davet edilen kişi Meta App Tester rolünü kabul eder.
2. Aynı kişinin seçilen gerçek reklam hesabına zaten meşru erişimi vardır.
3. OAuth yalnız `ads_read` ister.
4. Seçilen kabul tarihinde hesapta gerçekten yayınlanmış katalog reklamı vardır.
5. Herkese açık kullanıcı veya ilgisiz müşteri hesabı bağlanmaz.
6. Her canlı sağlayıcı çağrısı yine açık ürün sahibi onayı ister.
7. Sınırlı kabul işi bitince Tester rolü kaldırılır.

İkinci aşama Production erişimidir ve ayrıdır: şirket/business doğrulaması, gerekiyorsa teknoloji sağlayıcı doğrulaması, Advanced Access/App Review ve herkese açık müşteri kullanımı sonraki kapılardır.

## Gerçek hesap kabulü ön koşulları

- Shopify taşıması ve resmî Facebook & Instagram katalog eşitlemesi tamamlanmıştır.
- Shopify ürün/varyant kimliği ile Meta katalog `product_id` sürekliliği kayıtlıdır.
- Tam iş tarihinde gerçek katalog reklamı yayını vardır.
- App Tester daveti ve gerekiyorsa dar tester sözleşmesi kabul edilmiştir.
- Test eden kişinin hedef reklam hesabı erişimi Meta'da doğrulanmıştır.
- Uygulama `ads_read` ile yeniden yetkilendirilir; AdsTable'da tam olarak bir Reporting Account seçilir.
- Ürün sahibi tam canlı kabul çağrısını onaylar.

Açık veya açıklamasız ilk sağlayıcı hatasında çağrı durur. Yeni açıklama/onay olmadan tekrar veya başka hesap, tarayıcı, token, kimlik doğrulama yöntemi ya da uç nokta kullanılmaz.

## Repository hazırlık şartları

- Sunucudaki her Graph isteği `appsecret_proof` taşır. Token/kanıt değeri arayüze, sonuç kanıtına veya loga girmez.
- Yerelde süresi dolmuş token veya Meta yetkilendirme reddi yetkili bağlantıyı `reauthorization_required` yapar.
- Kanıt koşusu içi yorumlanmayan imleçlerle sınırlı tam sonuca ulaşır; döngüyü yakalar. İki veri ailesi de bitmeden hiçbirini yayımlamaz.
- HTTP `Retry-After` ve sınırlı, kimliksiz Meta kullanım sinyalleri erişimi geri kazanma kanıtı olarak tutulur.
- Kullanıcının raporlama isteğinde verdiği hesap kimliği kabul edilmez.
- Eksik, desteklenmiyor, kısmi, eski, gerçek sıfır ve geçerli boş sayfa ayrı kalır.

## Arayüz görev sözleşmesi

- Yüzey: `/settings`
- Değişen durum: Meta `connected`
- Kaldırılan özgün metin/eylem: `Run Meta evidence`, `Meta evidence received`, `Meta evidence failed`
- Kalan özgün eylemler: Reporting Account için `Change` ve `Disconnect`
- Bileşenler: Mevcut kararlı Polaris web bileşenleri; ham HTML kontrolü, özel CSS, satır içi stil veya doğrudan renk eklenmez.
- Görsel kabul: **Gerçek Shopify Admin Production masaüstü/mobil, 17 Ekim 2026 açık ürün sahibi kabulüyle PASS**
- Kanıt: `docs/evidence/EO_04B_META_APP_ROLE_VISUAL_ACCEPTANCE_2026-10-17.json`

Bu tarihsel görev açıklaması yeni bileşen/sürüm kararı değildir; özgün ekran metinleri çeviri kapsamında değiştirilmez.

## Kabul kanıtı

Başarılı gerçek hesap kabulü ham token veya iş kimlikleri olmadan şunları kaydeder:

- Rol ve reklam hesabı erişim ön koşulu teyitleri;
- Seçilen bağlantı/hesap yetkisi parmak izleri;
- İstenen iş tarihi ve Graph sürümü;
- Biten Channel/ürün sayfa ve satır sayıları;
- Sağlayıcı istek kimlikleri veya güvenli özetleri;
- Sağlayıcının özgün değerleri olarak ürün kimlikleri;
- Geçerli boş/dolu durum;
- Sınırlı kota/erişim geri kazanma kanıtı;
- Varsa ilk hata ve tekrar yapılmadığı.

Ürün düzeyi gösterim, tıklama, harcama ve dönüşüm alanlarının standartlaşabilirliğine gerçek yanıt karar verir. Creative içeriğindeki reklamı yapılan ürün kanıtı, Sales Role ve kesin Shopify kimliği ayrı kapılardır; repository hazırlığı bunları kanıtlanmış gösteremez.

## Tarihsel resmî kaynaklar

Kontrol: 17 Ekim 2026.

- Meta App Roles: <https://developers.facebook.com/documentation/development/build-and-test/app-roles>
- Meta Graph API erişim seviyeleri: <https://developers.facebook.com/docs/graph-api/overview/access-levels/>
- Meta `ads_read`: <https://developers.facebook.com/docs/permissions/reference/ads_read>
- Resmî Business SDK yapılandırması (`v26.0`): <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py>
- Resmî SDK güvenliği ve `appsecret_proof`: <https://github.com/facebook/facebook-python-business-sdk/blob/main/README.md>
- Resmî SDK oturum kanıtı uygulaması: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/session.py>
- Shopify Button bileşeni: <https://shopify.dev/docs/api/app-home/using-polaris-components/components/actions/button>
