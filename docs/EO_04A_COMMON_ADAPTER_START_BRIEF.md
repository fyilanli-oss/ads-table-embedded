# EO-04-A — Ortak adaptör sözleşmesi başlangıç açıklaması

**Kontrol tarihi:** 10 Ekim 2026

**Durum:** Kabul edildi — 10 Ekim 2026

**Ana paket:** A6-EO-04 — Meta, Google Ads ve Klaviyo adaptörleri

**İşlem yetkisi:** Yalnız EO-04-A başlangıcı; sağlayıcı gizli bilgisi, OAuth, canlı API, veritabanı, Vercel veya dağıtım değişikliği yok.

Bu belge 10 Ekim 2026'daki tasarım ve kabul kaydıdır. Sonraki sağlayıcı hiyerarşisi, hata eşlemesi ve canlı kanıt kararlarının yerine geçmez; güncel durum Execution Plan'dadır. Tarihsel yeniden deneme tasarımı bugün canlı çağrı izni değildir.

## Analist sonucu

### İlk hata politikası düzeltmesi — 27 Ekim 2026

Güncel ortak runner her sayfada tek istek yapar; 429, geçici sunucu hatası, timeout, yetki veya şema hatasında otomatik ikinci çağrı yoktur. Sayfalama normal tamamlanana kadar sürer, ilk başarısız sayfada durur ve önceki sayfalardan toplanan kayıtlar yayımlanmaz. `maximum_attempts_per_page > 1` çağrıdan önce reddedilir. `retryable: true` döndüren sınıflandırıcı bu kuralı aşamaz. `Retry-After` kanıt/metadata olarak korunur; sleep/backoff çalıştırmaz. Uyumluluk için kalan `sleep`/`random` ve gecikme seçenekleri otomatik tekrar başlatmaz. Bozuk/atan sınıflandırıcı ham hata ayrıntısını açmadan `internal_adapter_failure` üretir.

Meta permission sınıfı ortak sözlüğün `permission_or_scope_missing` değerine getirildi; gözlem durumu olan `permission_denied` değiştirilmedi. Hız sınırı ve geçici hata sınıfları kendi anlamlarını korur, `retryable` tüm Meta sınıflarında false'tur. Yeni Meta provider kodu veya davranışı türetilmedi. Ortak request/fact sürümü `3.0.0` kalır; aşağıdaki eski retry tasarımı tarihsel kabul kaydıdır ve güncel çalışma izni değildir.

27 Ekim kaynakları: [Google Error types](https://developers.google.com/google-ads/api/docs/best-practices/error-types), [Meta resmî SDK exceptions](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/exceptions.py). Kaynaklar hata kategorisi/metadata yapısını destekler; otomatik tekrar yapmamak ürün ve repository politikasıdır. Meta Graph belge sayfası 429 verdi; okunmuş gibi kabul edilmedi. Canlı API, OAuth, DB, UI veya deploy değişikliği yoktur; merge ayrıca açık kullanıcı onayına bağlıdır.

### Kurulum kimliği düzeltmesi — 26 Ekim 2026

Aktif runtime ve TypeScript sözleşmesi `3.0.0` kullanır. `authority.installation_id` ve fact `identity.installation_id`, mevcut DB `shopify.installations.id` bigint kimliğinin `1`–`9223372036854775807` aralığında, başında sıfır/işaret/boşluk olmayan ondalık metin karşılığıdır. UUID, JS Number/BigInt girdi ve eski `1.0.0`/`2.0.0` istekleri sessizce çevrilmez. Bu kırıcı temsil düzeltmesi yalnız ortak adaptörde uygulanır; aşağıdaki `2.0.0` paragrafı 23 Ekim durumunu kaydeder. Dokuz metrik değişmedi. Workspace/connection UUID kuralları, hesap seçimi ve Klaviyo NULL reporting-account kuralı korunur. Bu kontrol kimliğin gerçekten server tarafından çözüldüğünü tek başına kanıtlamaz; DB resolver/writer, FX/ad zorunluluğu, Dataset ve canlı entegrasyon bu dilimde yoktur.

### Güncel metrik uyumu — 23 Ekim 2026, envanter 01

Güncel ortak talep **9 PD metriğidir**; Session ürün sahibi kararıyla çıkarılmıştır. Aşağıdaki 10 metrikli blok 10 Ekim tarihsel kabul kaydıdır, güncel talep değildir. Runtime ve TypeScript sözleşmesi `2.0.0` kullanır; eski `1.0.0` istekleri ve ek `session` metrik alanı sessizce kabul edilmez. Kimlik doğrulama oturumları bu değişikliğin konusu değildir.

Kabul edilmiş PD/CPD hedefleri `contracts/pd-cpd-query-standard-v1.json` içinde tekleştirilmiştir: sağlayıcı/akış/level ve Channel kimliği, Product ID omurgası, 08 normal kapsam kararı, ürün esaslı CPD Channel ve Klaviyo rol sınırı. Kaynak 13 sütunlu tablo `docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md` dosyasıdır. Sağlayıcı runtime sözleşmelerindeki mevcut sorgular hedefler uygulanmış gibi değiştirilmez; yeni sözleşmede eksikler mevcut envanter numaralarına bağlıdır. Bu uyum provider sorgusu, fiziksel Dataset, FX veya Formula Engine uygulaması değildir.

AdsTable ile Meta, Google Ads ve Klaviyo arasında tek, sıkı dönüşüm sınırı kurulur. Sağlayıcılar farklı konuşsa da eksik metriğin anlamını değiştiremez, tamamlanmamış sayfaları sessizce yayımlayamaz, başka Shopify mağazası seçemez veya hatayı sıfıra dönüştüremez.

Bu alt paket sağlayıcı uç noktalarını uygulamaz. EO-04-B/C/D kabul edilmeden önce her adaptörün uyması gereken ortak davranışı sabitler.

## Neden gerekli?

Ortak sözleşme olmadan üç risk doğar:

1. Gelmeyen sağlayıcı alanı sıfıra çevrilir.
2. Sayfalanmış veya kota engeline takılmış yanıt tam veri kümesi gibi yayımlanır.
3. Birden fazla ticaret mağazasının faaliyeti olan reklam hesabındaki her satır kurulu Shopify mağazasına ait sayılır.

Bunlar AdsTable'ı sağlayıcının Ads Manager sonucuyla çeliştirir; uzlaştırma denetiminde görülen review ve güven riskini yeniden üretir.

## Yetki sınırı

Değiştirilemez ticaret kaynağı doğrulanmış Shopify kurulumudur:

```text
Kurulu Shopify mağazası
└── Çalışma alanı
    └── Sağlayıcı bağlantısı
        ├── Meta yetkili Reporting Account
        ├── Google Ads yetkili Reporting Account
        └── Klaviyo yetkili Connected Account
```

Kurallar:

- Sağlayıcı hesabı, pixel, alan adı, kampanya URL'i veya katalog Shopify çalışma alanı oluşturamaz/değiştiremez.
- Kullanıcının seçebileceği Reporting Store yoktur.
- Başka Shopify mağazası ayrı AdsTable kurulumu ve abonelik ister.
- Sağlayıcının alan adı/mağaza kanıtı, yalnız resmî API kesin ve tekrarlanabilir ilişki gösteriyorsa satırı sınırlar veya reddeder.
- URL, UTM, tıklama kimliği, kampanya adı veya operatör tahmini satırı kurulu mağazaya bağlamak için yeterli değildir.
- Belirsiz çoklu mağaza kapsamı açık destek durumudur; organik veya ücretli sonuca sessizce karıştırılmaz.

## Seçilebilecek hesap sayıları

Üç sağlayıcıya tek genelleme uygulanmaz:

- **Meta:** Kullanıcı sağlayıcının doğruladığı 1–3 Ad Account seçer. Sıfır veya üçten fazlası Connected olamaz.
- **Google Ads:** `customer.manager=false` olan doğrulanmış 1–3 reklamveren/reklam sunan hesap seçilir. Manager/MCC seçilemez; Reporting Account veya Funnel varlığı olamaz. Resmî erişim gerektiriyorsa yönetici kimliği yalnız seçilen reklamverene erişim yolu olan özel `login_customer_id` olarak tutulabilir.
- **Klaviyo:** Klaviyo hesabı Ad Account değildir. Sunucunun doğruladığı tam olarak bir Klaviyo hesabı bağlanır; Meta/Google'ın 1–3 kuralı uygulanmaz.

Tarayıcıdan gelen hesap kimliği/adı yetki değildir. Seçilen her hesap kalıcı kayıttan önce sağlayıcıdan yeniden okunur.

## Ortak Funnel ham veri talebi

Uç noktalar ve alan adları farklı olsa da her adaptör aynı yetkili ham veri talebini yanıtlar. Sağlayıcı alanı yok diye ortak soru atlanamaz.

Çıktı; kurulu çalışma alanı yetkisini, sağlayıcıyı, gerçeğe uygun hiyerarşiyi, günlük uç varlık kimliğini, ham veriyi, kalıcı yetenek desteğini ve her denemenin gözlem durumunu taşır.

Ham metrikler tam olarak şunlardır; teknik adları çevrilmez:

```text
impression
ad_click
session
spend_value
add_to_cart
add_to_cart_value
checkout
checkout_value
purchase
purchase_value
```

Kalıcı `metric_support` yalnız `supported | unsupported | unknown` olabilir. Deneme bazlı `observation_state` ise `present | zero | empty | absent | not_requested | permission_denied | account_configuration_missing | ambiguous_store_scope | provisional | partial | failed` taşır. Desteklenen metrik bir yanıtta gelmeyince desteklenmiyor sayılmaz. Desteklenmeyen metrik `null` kalır; sayısal sıfır olmaz.

Eski `user_id` kimliği yasaktır. Yeni yetki `workspace_id`, `installation_id`, `installation_generation`, `provider_connection_id`, `platform_account_id` ve uygulanıyorsa doğrulanmış Reporting Account kimliğini kullanır. Yalnız Meta, Google Ads ve Klaviyo aktiftir; TikTok/GA4 sessizce açılmaz. Shopify organik veri alımı ayrı kaynak sınırıdır; ücretli sağlayıcı adaptörleri bunu üretmez.

Sağlayıcının hesaplanmış alanı döndürmesi onu Dataset gerçeği yapmaz. CTR, CPC, ROAS, CPS, revenue, revenue margin, terk edilmiş adet/değerler ve oranlar Formula Engine çıktısıdır. Doğrulanmış dönüşüm değeri `purchase_value` alanına eşlenir; formül sözleşmesini aşamaz.

Alternatif, sentetik, kısmi veya eksik sonuç ortak veri diye yayımlanamaz. Ham kanıt yalnız sınırlandırılmış, hassas bilgilerden arındırılmış başvuru, içerik özeti ve istek üst verisiyle temsil edilir.

## OAuth'tan ilk veriye akış

1. OAuth dönüşünü doğrula.
2. Token'ı şifreleyip sakla; açık metin saklama.
3. Kurulu Shopify mağazası ve aktif kurulum neslini yeniden doğrula.
4. Hesapları canlı sağlayıcı API'sinden keşfet.
5. Kullanıcıya 1–3 doğrulanmış Meta/Google reklamveren hesabı seçtir.
6. Tek doğrulanmış Klaviyo hesabını bağla; Ad Account adını verme.
7. Seçilen her hesabı sağlayıcıdan yeniden okuyup çalışma alanı/kurulum nesline bağla.
8. Kurulu mağaza kapsamı belirsiz veya bağlantı yetkisiyle çelişkiliyse güvenle dur.
9. Hesap saat dilimi, para birimi, API sürümü ve metrik yeteneklerini çöz.
10. Campaign/Flow hiyerarşisini doğrulanmış sağlayıcı uç varlığına kadar al.
11. Ortak Funnel ham veri talebinin tamamını sağlayıcı alanlarıyla iste.
12. Sonucu yayımlanabilir yapmadan bütün gerekli sayfa/bölümleri bitir.
13. Yanıtı yetkili kimlik/varlık/ham metrik zarfına çevir.
14. Destek/gözlem ayrımını, sıfır/null anlamını, iş tarihini, tek FX dönüşümünü ve kaynak izini doğrula.
15. Yalnız tam doğrulanmış sonucu ilerideki Dataset V2 yazıcısında tekrarlandığında çoğalmadan sakla.
16. İlk başlangıç yalnız dünü, sonra bugünü ister; 14 günlük geriye dönük doldurma değildir.
17. Sonraki saatlik yenileme ve geriye dönük uzlaştırma EO-05'e devredilir.

OAuth başarısı tek başına Connected değildir. İlk veri alınabilir olmadan hesap bağlama ve ilgili bütün yetki kapıları geçmelidir.

## Ortak adaptör işlemleri

EO-04-A sağlayıcıdan bağımsız işlemleri tanımlar; her sağlayıcı alt paketi bunları resmî uç noktalara eşler.

### 1. Bağlantıyı incele

Token kullanılabilirliğini, sağlayıcı kimliğini, verilmiş yetenekleri ve EO-03 bağlantı/raporlama hesabı yetkisini doğrular. Mağaza, çalışma alanı veya hesap seçemez/değiştiremez.

### 2. Kapsam kanıtını keşfet

Yalnız sağlayıcının desteklediği hesap, alan adı, katalog, pixel, dönüşüm eylemi veya eşdeğer kapsam kanıtını döndürür. Kanıt açıklayıcıdır; satış ilişkilendirmesi uydurmaz.

### 3. Yapıyı al

Sonraki Dataset V2 normalleştirmesinin gerektirdiği hiyerarşi ve sabit kimlikleri döndürür. Bu tarihsel ortak tasarımda:

- Meta: hesap → kampanya → ad set → ad.
- Google Ads: customer → kampanya → ad group → ad; Performance Max resmî asset group/asset hiyerarşisiyle ele alınır.
- Klaviyo: hesap → campaign/flow → message/variation; API'nin desteklediği yerde.

Kesin en alt varlık, sağlayıcıya özel resmî belge ve canlı kanıt kapılarına bağlıdır. Sonraki kabul edilmiş hiyerarşi sözleşmesi bu başlangıç çizimini ayrıntılandırır.

### 4. Ham veriyi al

Açık hesap, zaman penceresi, saat dilimi ve alan kümesi için raporlama verisini döndürür. İstenen ile gerçekte geleni ayırır. AdsTable formüllerini hesaplamaz; Dataset V2'yi doğrudan yayımlamaz.

### 5. Yeteneği açıkla

Alan, kırılım, seviye veya işlemin resmen desteklenip desteklenmediğini ve bu hesap/istekte kullanılabilirliğini bildirir. Yetenek sürümlü kanıttır; sabit iyimser vaat değildir.

## Destek durumu sözleşmesi

İstenen metrik/boyut şu durumlardan biriyle açıklanır:

- `present`: Sağlayıcı null olmayan değer döndürdü.
- `zero`: Sağlayıcı açıkça sayısal sıfır döndürdü.
- `empty`: Açık boş koleksiyon/değer döndü.
- `absent`: İstek başarılı, fakat alan/tür yok.
- `unsupported`: Resmî sözleşme desteklemiyor.
- `not_requested`: AdsTable istemedi.
- `permission_denied`: Mevcut erişim bilgisi okuyamıyor.
- `account_configuration_missing`: Özellik var; hesapta gereken kurulum yok.
- `ambiguous_store_scope`: Kurulu mağazanın kesin ayrımı kanıtlanamıyor.
- `provisional`: Sağlayıcı pencereyi hâlâ değiştirebilir.
- `partial`: Gerekli bütün sayfa/bölümler bitmedi.
- `failed`: Yayımlanabilir kanıt olmadan bitti.

Yalnız sağlayıcının açık sıfırı sıfır olur. `absent`, `empty`, `unsupported`, `permission_denied`, `partial` ve `failed` birbirinin yerine geçmez.

## İstek zarfı

Her istek şunlara bağlıdır:

- Çalışma alanı ve aktif Shopify kurulum nesli;
- Sağlayıcı bağlantısı;
- Modelde varsa yetkili Reporting Account;
- İşlem ve sözleşme sürümü;
- Sağlayıcı API/sürümü;
- Kurulu mağazanın saat dilimi;
- Dahil edilen veri tarihleri ve açık UTC istek sınırları;
- Tam alanlar, seviyeler ve kırılımlar;
- Sabit sorgu parmak izi ve deneme kimliği;
- İşten çağrılmışsa zamanlayıcı/koşu kimliği.

Çağıranın gönderdiği çalışma alanı, mağaza, token, rastgele sağlayıcı URL'i veya değiştirilebilir hesap kimliği reddedilir.

## Yanıt ve kanıt zarfı

Her tamamlanan deneme gizli bilgi içermeden kaydeder:

- Sağlayıcı, işlem, sözleşme/API sürümü ve sorgu parmak izi;
- Döndüyse sağlayıcı istek/izleme kimliği;
- Başlama, bitme ve veri alma zamanları;
- İstenen/dönen tarih kapsamı;
- İstenen alanlar ve alan bazlı destek durumu;
- Sayfa/bölüm/satır sayısı ve bütünlük;
- Resmen döndüyse kota başlıkları veya üst verisi;
- Başarısızsa normalleştirilmiş hata sınıfı;
- Özel, sınırlandırılmış ham yanıt kanıtı başvurusu ve içerik özeti.

Token, yetkilendirme kodu, PKCE doğrulayıcı, istemci sırrı, veritabanı URL'i, müşteri e-postası ve profil düzeyinde kişisel veri log/kanıtta yasaktır.

Ham kanıt uygulama logu veya sınırsız veri gölü değildir. Canlı çağrıdan önce sağlayıcı alt paketi arındırma, özel saklama, saklama süresi ve silmeyi tanımlar. Sonradan ayrı onaylı sözleşme gerekmedikçe Klaviyo kişi/profil uç noktaları dışarıdadır.

## Sayfalama ve tamlık

- Sağlayıcı imleci/sayfa token'ı içi yorumlanmayan değerdir; uydurulmaz.
- Sorgu parmak izi sayfalar boyunca sabit kalır.
- Yinelenen imleç, sayfa/satır üst sınırı ve toplam süre sınırı sonsuz dolaşmayı durdurur.
- Sayfa token'ı dolarsa veya sayfa eksikse sağlayıcı sözleşmesine göre deneme yeniden başlar ya da başarısız olur; kısmi anlık kayıt tam diye yayımlanmaz.
- Satırlar tek deneme altında bekletilir; bütün gerekli sayfa/bölümler geçmeden yayımlanamaz.
- Aynı sayfanın tekrarı sonucu çoğaltmaz.
- Google Ads Search sabit sayfa davranışını, Klaviyo üst düzey imleç bağlantılarını kullanır. Meta dolaşımı EO-04-B resmî belge kapısından sonra sabitlenir.

## Yeniden deneme ve kota

Hem deneme sayısı hem toplam süre sınırlıdır. Yalnız belgelenmiş geçici durumlar için:

1. Varsa `Retry-After` veya sağlayıcı erişimi geri kazanma üst verisine uyulur.
2. Yoksa rastgele sapmalı üstel bekleme kullanılır.
3. Sağlayıcı ve yetkili hesap başına kota/eşzamanlılık kontrolü uygulanır.
4. Sonraki deneme süre bütçesinde güvenle bitmeyecekse durulur.
5. Sınırın tükenmesi sıfır değil başarısız/kısmi sonuçtur.

Kimlik doğrulama, iptal edilmiş token, izin, doğrulama, desteklenmeyen alan, bozuk sorgu ve kesin hesap kapsamı hatası körlemesine tekrarlanmaz. Bu ortak yetenek, ürün sahibinin ilk sağlayıcı hatasında durma kapısını kaldırmaz.

## Normalleştirilmiş hata sınıfları

Sağlayıcı ayrıntısı özel kalır; ortak katman şunları gösterir:

- `reauthorization_required`
- `permission_or_scope_missing`
- `reporting_account_inaccessible`
- `request_contract_invalid`
- `provider_schema_changed`
- `rate_limited`
- `quota_exhausted`
- `transient_provider_failure`
- `provider_timeout`
- `data_not_ready`
- `ambiguous_store_scope`
- `partial_result`
- `internal_adapter_failure`

Arındırılmış sağlayıcı kodu, mesaj sınıfı ve istek kimliği eşlik edebilir; token ve ham authorization başlığı edemez.

## Ortak katman için doğrulanan tarihsel bilgiler

### Google Ads

Resmî belgeler kimlik doğrulama, yeniden denenebilir, doğrulama ve eşitleme hatalarını ayırır. Yalnız geçici sunucu sınıfları sınırlı, rastgele sapmalı beklemeye adaydır. v19+ Search sabit 10.000 satırlık sayfa kullanır; kısa ömürlü sayfa token'ıyla aynı sorgu korunmalıdır.

### Klaviyo

İmleçli sayfalama ve uç noktaya özel sayfa boyutu vardır. Hesap bazlı ani/sürekli kullanım pencereleri uygulanır; OAuth uygulamasının her kurulumu ayrı kota alır. HTTP 429 `Retry-After` döndürür. API sürümü zorunlu açık istek başlığı ve kanıtın parçasıdır.

### Meta

10 Ekim 2026 kontrolde resmî kota ve Graph hata sayfaları HTTP 429 döndürdü. Erişilebilen Mayıs 2026 duyurusu Marketing API Access Tier'ın yüksek kota erişimini yönettiğini doğruladı. EO-04-A sayısal kota, yeniden deneme kodu, başlık garantisi veya sayfalama kuralını hafızadan sabitlemez. EO-04-B için okunabilir, kayıtlı resmî kaynak gerekir. Bu tarihsel erişim sınırı bugün giderilmiş gibi sunulmaz.

## Gizli bilgi ve ortam kapısı

EO-04-A gizli bilgi oluşturmaz. Sağlayıcı alt paketinde erişim bilgisinden önce:

- Gizli bilgi envanter sözleşmesi kabul edilir.
- İlk gerçek OAuth öncesi sağlayıcı-token şifreleme anahtarı kurtarma kapısı geçer.
- Tam ad, veren otorite, kapsam, süre dolumu, yenileme ve geri alma envantere eklenir.
- Production, Preview ve Development ayrı erişim bilgileri kullanır.
- Değer GitHub, test, örnek veri, log veya kabul kanıtına girmez.

## Kabul sonrası uygulama sırası

1. TypeScript istek/sonuç/destek/hata sözleşmelerini tanımla.
2. Dışarıdan verilen saat, bekleme ve rastgelelik kaynaklarıyla ortak sayfalama/yeniden deneme/kota yürütücüsünü kur.
3. Arındırılmış kanıt üretimini ve gizli bilgi temizleme korumalarını kur.
4. Başarı, sıfır, boş, eksik, desteklenmiyor, sayfalama, kota, geçici hata, kimlik hatası, kısmi sonuç ve belirsiz mağaza için tekrarlanabilir sahte sağlayıcı örnekleri kur.
5. Tekrarın sonucu çoğaltmaması, döngü/süre sınırı, sıfır uydurmama ve sızıntı testlerini ekle.
6. EO-04-B sağlayıcı uygulamasından önce repository kabulü için dur.

## Kabul kapıları

- Ürün sahibi başlangıç açıklamasını kabul eder.
- Uygulama makine sözleşmesiyle eşleşir.
- Bütün sentetik davranışlar geçer.
- Gerçek sağlayıcı gizli bilgisi/token'ı kullanılmaz.
- Ayrı açık kapı olmadan canlı sağlayıcı, veritabanı, Vercel veya dağıtım değişmez.
- Zorunlu CI geçer.
- Ürün sahibi EO-04-A'yı açıkça kabul eder.

## Açık kapsam dışı

OAuth/token değişimi; sağlayıcı uygulama/erişim bilgisi oluşturma veya değiştirme; canlı çağrı; son uç nokta/alan listeleri; Dataset V2 saklama/uzlaştırma zamanlaması; formüller, BFF/sorgu API'si ve arayüz; ürün/cross-sell kanıtı; review başvuruları.

## 10 Ekim 2026'da kontrol edilen resmî kaynaklar

- Meta Access Tier duyurusu: https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/
- Meta kota sayfası (kontrolde HTTP 429): https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Meta hata sayfası (kontrolde HTTP 429): https://developers.facebook.com/docs/graph-api/guides/error-handling/
- Google Ads hata türleri: https://developers.google.com/google-ads/api/docs/best-practices/error-types
- Google Ads hata modeli: https://developers.google.com/google-ads/api/docs/best-practices/understand-api-errors
- Google Ads sayfalama: https://developers.google.com/google-ads/api/docs/reporting/paging
- Klaviyo kota/hata: https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling
- Klaviyo API/sayfalama: https://developers.klaviyo.com/en/v2026-01-15/reference/api_overview
- Vercel Functions sınırları: https://vercel.com/docs/functions/limitations
- Supabase değişiklik günlüğü: https://supabase.com/changelog

## Repository uygulaması — 10 Ekim 2026

Ürün sahibi başlangıç açıklamasını uygulamadan önce kabul etti. Ortak sınır, sağlayıcı gizli bilgisi okumadan/oluşturmadan ve canlı API/veritabanı/Vercel/dağıtım değişikliği olmadan uygulandı.

Çıktılar:

- `app/lib/providers/common-adapter.server.js`: Çalışma zamanı sözleşmesi, ortak ham veri doğrulaması, yayımdan önce tam sayfalama, sınırlı yeniden deneme ve arındırılmış kanıt.
- `app/lib/providers/common-adapter.server.d.ts`: Sıkı istek/sonuç/ham veri tipleri.
- `tests/eo-04a-common-adapter.test.js`: Tekrarlanabilir sahte sağlayıcı kabul testleri.

Davranış:

- Üç sağlayıcıdan aynı tam on ham metrik istenir.
- Kalıcı yetenek desteği ile deneme gözlemi bağımsızdır.
- Yalnız açık sayısal sıfır sıfırdır; eksik/desteklenmeyen/başarısız sonuç null veya yayımlanamaz kalır.
- İmleç yorumlanmaz; yinelenen imleç, çelişkili aynı veri, satır/sayfa/süre sınırı ve eksik dolaşım güvenle durur.
- Aynı sayfa tekrarı sonucu çoğaltmaz.
- Yalnız `rate_limited`, `transient_provider_failure`, `provider_timeout` ve ancak sağlayıcı alt paketi resmî sözleşmeden yeniden denenebilir sınıflandırdıysa tekrar adayıdır.
- Kimlik, yetki, doğrulama ve kesin kapsam hatası çağıranın bayrağıyla tekrar edilebilir yapılamaz.
- `Retry-After`, sınırlı rastgele sapmalı üstel beklemeden önceliklidir.
- Önceki sayfalar bekletilmiş olsa da başarısız deneme yayımlanabilir satır döndürmez.
- Kanıt sınırlıdır, içerik özeti taşır; erişim bilgisi, yetkilendirme malzemesi ve e-posta biçimli kişisel veriyi iç içe yapılarda da temizler.
- Klaviyo Ad Account seçicisi olmayan tek platform hesabıdır. Meta/Google EO-03 raporlama hesabı yetkisini kullanır.

Bu hâlâ sağlayıcıdan bağımsız sözleşmedir. Canlı çağrı öncesi EO-04-B/C/D resmî uç nokta, alan, sayfalama, kota, hesap ve hata eşlemelerini sabitlemelidir.

### Kapanış kapısının sonucu

GitHub Actions `38049487145` koşusu 163/163 test, TypeScript ve önizleme derlemesini geçti. Ürün sahibi 10 Ekim 2026'da EO-04-A'yı kabul edip PR #65 merge'ünü onayladı. Bu kapanış EO-04-B uygulamasına izin değildir; resmî belge ve analist kapısı önce geçmelidir.

## Ürün sahibi kapanışı — 10 Ekim 2026

Kabul edilen sonuç ortak sözleşme ve sentetik çalışma zamanıdır. EO-04-B Meta resmî belge/analist kapısına ilerlenebilir; canlı Meta çağrısı, erişim bilgisi/veritabanı/Vercel değişikliği veya dağıtım yetkilendirilmez.
