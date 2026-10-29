## 29 Ekim 2026 — Birleşik kurulum: hesap seçimi ve sürdürme sunucu dilimi

#258 main’e birleşti (e936b033a2f0e794f94d8c03def4f58d5cedc77a); iki zorunlu CI başarılı. 07 / ikinci kod tesliminin hesap seçimi dilimi hazırlandı. Google ve Meta runtime.combinedSetup girişleri mevcut hesap keşfi/izin doğrulayıcısı ve CAS seçim kayıtlarını kullanır. Varsayılan sunucu kapısı kapalı; mevcut Settings/callback yolları ve reporting_v1 davranışı değişmedi.

Tek hesap seçilince verify_assets; çoklu hesap seçilince select_reporting_account, ardından verify_assets döner. Hepsinde Resume Setup ve setupComplete=false kalır. Reklam hesabı seçmek Merchant/katalog erişimi veya uygulama onayı kanıtı değildir. Veritabanındaki pending_account_selection korunur; raporlama hesabı seçme aşaması ayrı selectionState ile anlatılır. Yeni lifecycle durumu veya tablo üretilmedi.

Yalnız sahipli current lifecycle ve tam identity_v1 credential ile girilir. Başlangıçtaki connection/version/credential, native keşiften önce seçilecek kayda bağlanır. Yazım sonrası exact seçim yanıtı ve güncel lifecycle tekrar doğrulanır. Kayıp/yanlış yanıt veya değişmiş bağ hata kalır; otomatik retry/fallback/revoke yoktur. Sonuçta credential/token veya ham provider yanıtı taşınmaz.

Bu ikinci kod işinin tamamı değildir: Merchant/katalog doğrulamasını nihai hazır durumuna bağlamak, ayrı modal teslimiyle ekran akışını bağlamak ve native geliştirici onayı/izin/varlık kanıtı açık kalır. Canlı izin/token/config/deploy/DB/Dataset değişikliği yapılmadı. 15 başlamadı; 22 duraklatılmış, 23 Dataset/FX yazımıdır. Makine kaydı: contracts/eo-05-start-brief-v1.json#Combined_provider_setup_account_selection_2026_10_29.

46 yeni entegrasyon testi, 175 ilgili test ve 2.909/2.909 tüm test geçti; tip kontrolü ve derleme başarılı. Exact commit CI ve kullanıcı merge onayı bekler. Google OAuth/Merchant ve Supabase function dokümanları 2026-10-29 kontrol edildi; Meta reklam hesabı okuma yolu resmî SDK User.getAdAccounts üzerinden kontrol edildi; mevcut doğrulayıcı kullanıldı, yeni API davranışı/katalog erişimi/uygulama onayı varsayılmadı.

## 29 Ekim 2026 — Birleşik Google/Meta kurulumunun sunucu başlangıç/dönüş dilimi

İlk Products/Orders teslimi #257 ile main’e birleşti (8ebb4caeb6f766ebd624888a8b3efacc4d0239f4). 07 içindeki ikinci kod işinin sunucu başlangıç/dönüş parçası hazırlandı; bütün ikinci iş veya OAuth kurulumu tamamlandı denmez. Mevcut sunucu kapısı varsayılan kapalıdır; Settings ve callback route’ları bu yeni başlangıca bağlanmadı. Modalın açık anlatımı/kullanıcı kabulü ve uygun canlı kapılar olmadan birleşik izin akışı açılmaz.

beginCombinedSetup yalnız sunucuda identity_v1 seçer; mevcut lifecycle, bağlı state ve Google PKCE üzerinden Ads+Merchant / mevcut Meta Ads+Catalog profilini kullanır. Caller provider/profile veya enable alanı ile küçük profile kaçamaz, kapıyı açamaz. Yeni scope, Meta bağımlılığı veya provider alanı eklenmedi. Google resmî OAuth/Merchant kaynakları 29 Ekim’de okundu; Meta’nın resmî izin sayfası okunamadı. Mevcut validator/profil kullanıldı; güncel Meta app onayı veya genişletilmiş kapsam doğrulandı denmez.

Bilinen eksik native kapsam, yalnız credential atomic yazımı başlamadan önce yakalanır. Aynı OAuth işleminin failed sonucu exact transaction ID ve status ile onaylanırsa pending_permissions + Resume Setup/request_permissions döner. Hesap keşfi ve kısmi token saklama yapılmaz. Ret/iptal mevcut denied sonucunu korur; identity akışına yalnız kurulum tamamlanmadı bilgisi eklenir. Sağlayıcı hatası, bozuk kapsam veya belirsiz/yanlış kapanış yanıtı izin reddi gibi gösterilmez; retry/fallback/revoke/eskisini silme yoktur. Atomic yazım başladıktan sonraki hata Resume Setup’a çevrilmez.

Tam kapsam yalnız gerekli koşuldur. Mevcut atomic staging/CAS korunur; hesap seçimi veya Merchant/katalog varlık doğrulaması bekleniyorsa setupComplete=false döner. Eski güvenli bağlantının connectionState değeri ile yeni kurulumun sonucu ayrılır; eski kayıt connected olsa bile birleşik sonuç pending_asset_verification kalır. Sonraki adım açıkça request_permissions / select_account / verify_assets olarak ayrılır; geçerli hesap seçiminde Resume yeniden OAuth başlatmaz.

Kalan ikinci iş: hesap/varlık doğrulamasını son kurulum hazır durumuna bağlamak ve ayrı modal teslimiyle Settings/dönüş/Resume Setup bağlantısını yapmak. Bunlar bu kodun canlıya açıldığı veya tamamlandığı anlamına gelmez. Runtime yalnız bu iki OAuth sunucu modülünde değişti; yeni UI/route, token/env/provider/config/deploy/DB veya Dataset değişikliği yok. 129 ilgili test, 28 yeni test dahil 2.863/2.863 tüm test, tip ve derleme geçti; exact commit CI ve kullanıcı merge onayı bekler. F01 tetikleme yolları değişmedi. Makine kaydı: contracts/eo-05-start-brief-v1.json#Combined_provider_setup_backend_2026_10_29. 15 başlamadı; 22 duraklatılmış, 23 Dataset/FX yazımıdır.

## 29 Ekim 2026 — İlk kod teslimi: Products / Orders izin kontrolü ayrıldı

07 içindeki ilk teknik teslim hazırlanmıştır; PR/CI ve kullanıcı merge kabulü bekler. Shopify identityPermissionRequirements ve assessIdentityPermissionScopes varsayılanı artık yalnız read_products ister. includeOrders:true seçilince read_orders ve sipariş/protected-data ek kontrolleri istenir. includeOrderHistory:true açık Orders seçimi olmadan reddedilir; eski sipariş erişimi read_all_orders ile birlikte değerlendirilir. Google/Meta/Klaviyo kapsamları değişmez; Shopify’a özgü Orders seçimi diğer provider’larda reddedilir.

inspectShopifyIdentityPermissionScopes aynı güvenilir kurulumun öncesi/sonrası kontrolünü ve tek native grant okumasını koruyarak yeni seçimi taşır. Sipariş okuyucusu varsayılanı kullanmaz: ilk ve son native grant kontrolünde includeOrders:true sabittir. Yalnız Products varsa sipariş HTTP okumasına geçmez; son kontrolde Orders geri alınıp Products kalsa bile toplanan sonuç reddedilir. Eksik/eskimiş/yanlış mağaza gözlemi unknown kalır, false başarı veya gerçek zero olmaz. read_products mevcut write_products ile karşılanabilir; yeni write izni istenmez.

Bu yalnız sunucu izin değerlendirme ayrımıdır. Kullanıcıya Connected/Resume Setup akışı, izin isteme/modal, TOML optional_scopes yayını veya gerçek izin kabulü tamamlandı denmez; sonraki kod teslimlerindedir. Yeni route/UI/token/provider/config/deploy/DB veya Dataset yazımı yoktur. Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_product_order_permission_split_2026_10_29. Ayrıntılı planın ilk teslim durumu güncellendi; 26 ana sıra değişmedi. 15 başlamadı; 22 duraklatılmış, 23 Dataset/FX yazımıdır.

224 ilgili test ve 2.835/2.835 tüm test geçti; tip kontrolü ve derleme başarılı. Exact commit CI ve kullanıcı merge onayı beklenir. Bu değişiklik F01 tetikleme yollarına girmez; yeni migration/refresh/kota SQL yoktur. Resmî kontrol 2026-10-29: https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes ve https://shopify.dev/docs/api/usage/access-scopes.

## 29 Ekim 2026 — 01–13 şimdi tamamlanacak teknik işlerin kodlama sırası

Aşağıdaki numaralar yalnız kod teslim sırasıdır; mevcut 26 maddelik plan yeniden numaralanmadı. Tek ayrıntılı kayıt: contracts/eo-05-immediate-technical-work-plan-v1.json. 07 izin politikası ve araştırmada bulunan Klaviyo eksiği bu sıraya dahildir. Bu plan kod teslimi veya gerçek ortam kabulü değildir.

| Kodlama sırası | Mevcut madde | Şimdi tamamlanacak iş |
|---|---|---|
| 1 | 07 | Temel ürün kurulumu ile Orders/Overlap izin kontrolünü ayır. Orders yokken temel kurulumun tamamlanabilmesini, sipariş okuyucusunun ise kapalı kalmasını sağla. |
| 2 | 07 | Google Ads–Merchant ve Meta Ads–Catalog tam izin profilini kurulum akışına bağla; kısmi/iptal durumda Resume Setup, gerçek grant/hesap/varlık kontrolü. |
| 3 | 07 / 12 | Shopify ilk Products ve sonraki Orders isteme/dönüş altyapısını, native scope okumasını ve gerekli SDK/kota bağlarını hazırla. Canlı config/izin yayını ayrı kapıdır. |
| 4 | 07 | İzin öncesi modalları bağımsız UI işi olarak hazırla; amaç, ret sonucu, Cancel/Connect ve kurulum sürdürme. Metin/component ve desktop/mobile kullanıcı kabulü ayrı. |
| 5 | 06 / 11 / 12 | Mevcut okuyucuları ortak güvenilir çalışma bağlamına bağla: doğru mağaza/hesap/nesil/üst hiyerarşi/gün/saat dilimi/para birimi/atıf ve kota/iptal/ilk-hata kontrolleri. |
| 6 | 04 | Google performans ve normal kapsam dönüşüm sorgularını mevcut PD birleştiricisine çalışan okuma akışından bağla. |
| 7 | 05 | Klaviyo Placed Order/ATC/Checkout raporlarını mevcut Message PD birleştiricisine çalışan okuma akışından bağla. Spend formülü 25’te kalır. |
| 8 | 06 | Üç sağlayıcının kaynak çıktısını mevcut ortak kayıt köprüsüne bağla. Meta tek sorgu projeksiyonu kullanır; gereksiz ikinci birleştirici yok. Metadata/FX eksikliği açık gösterilir, kur uydurulmaz; Dataset yazılmaz. |
| 9 | 12 | Klaviyo satış–atfedilen etkileşim referanslarını koru ve kontrollü olay okuyucusuna bağla. Click/open ayrımı korunur; Advertised/Cross-sell üretilmez. |
| 10 | 13 | Yeni izin, PD ve etkileşim bağlantılarını mevcut ortak aday/referans/Order/LineItem yazım öncesi kontrolleriyle birlikte sına. |

01–03 için yeni bilinen kod işi yok; mevcut korumalar regresyonda korunur. 08–10 kimlik okuyucu/aday kodu yeniden yazılmaz; gerçek Merchant/katalog/Shopify biçimi, Meta rapor namespace’i ve Klaviyo kaynak/varyant/OrderId kanıtı bekler. 11–12’de hazırlanmış source-rule/owner/kota bağlantıları yeni teslimlerde korunur. Sipariş çalıştırıcısı/arka plan oturumu (#251) ve belirsiz rezervasyon uzlaştırması (#252) main’de hazırlanmıştır; eski remaining alanlarından bunlar tekrar kod işi çıkarılmaz.

Ayrı kanıt işleri: geliştirici uygulama izin/onay durumu, native mağaza grant’i ve seçili varlık erişimi, gerçek ürün/sipariş kimliği biçimleri, izinli geçmiş sipariş/protected-data erişimi, gerçek limit/profil ve body/bellek/bağlantı/kapasite ölçümü. Bunlar kod yazılarak tamamlandı sayılmaz; unknown, denied ve granted ayrılır. Meta’nın güncel resmî izin kapsamı/bağımlılıkları doğrulanmadan Meta’ya özgü kapsam değişikliği yapılmaz. Bu engel diğer bağımsız teknik dilimleri tamamlandı göstermeyi veya durdurmayı gerektirmez.

İleriki işler: 15 kalıcı kimlik/kaynak/ham kanıt/Order saklama ve writer/tekrar okuma/durable devam tasarımı; 16–21 rol/kanıt kararları kendi sıralarında; 22 listing tree duraklatılmış; 23 genel Dataset/FX yazımı; 24–26 uzlaştırma, Spend ve bütünleşik kabul. Klaviyo Campaign Assisted / Flow Triggered ve PMax Campaign + gerektiğinde Unclassified Channel kararları korunur.

Her küçük kod teslimi ayrı PR/ilgili test/CI ve açık kullanıcı merge onayıyla ilerler. Resmî doküman, UI anayasası ve canlı mutation onay kapıları korunur. Bu teslimler sonunda mevcut 14’te birlikte durum değerlendirmesinde durulur; 15 kendiliğinden başlamaz. Tarihli Excel tarihsel görüntü olarak kaldı; kullanıcı bu turda mesaj içi plan istedi.

## 29 Ekim 2026 — 07 OAuth: izin öncesi açıklama ve kurulum sürdürme politikası

Kullanıcı önerisi mevcut 07 içinde bağımsız ve izlenen alt iş olarak kaydedildi; 26 ana sıra değişmedi. Contract: contracts/eo-05-oauth-setup-permission-policy-v1.json. Bu ürün politikası/teknik iş kaydıdır; modal, OAuth/config veya canlı izin uygulaması değildir.

| Bağlantı | Hedef kurulum davranışı |
|---|---|
| Google | Ads + Merchant izinleri aynı açıklanmış kurulum akışında istenir. İkisi ve gerekli hesap erişimi doğrulanmadan Connected olmaz. Kısmi izin Resume Setup olur; otomatik disconnect/revoke yapılmaz. Merchant hesabı olmayan Search-only mağazanın da bu politikada kurulumu eksik kalacağı ayrıca görünürdür. |
| Meta | Ads + Catalog ve doğrulanmış gerekli bağımlı izinler birlikte istenir. Kısmi izin Resume Setup; Ads/Business/katalog erişimi ve uygulama onayı ayrı kontrol edilir. Bugünkü resmî Meta izin sayfası okuması 429 verdi; güncel kapsam/bağımlılık/uygulama onayı tekrar doğrulanmış sayılmaz. |
| Klaviyo | Mevcut hesap/campaign/flow/event/metric OAuth okuma kapsamları ve ayrı Estimated Monthly Cost adımı korunur. Bu değer API izni değildir; eksikse Resume Setup. Geçerli izin/hesap varken sırf maliyet eksik diye OAuth baştan açılmaz. |
| Shopify | Repository başlangıç TOML scopes listesi boş; mevcut production config yeniden gözlenmedi. Product-enabled temel kurulum için read_products gerekir. Orders ilk kurulumun zorunlusu yapılmaz. Orders reddedilirse temel kurulum kendi izinleri tam olduğunda tamamlanır; sipariş/overlap yetkisi açılmaz. |

Shopify Orders sonradan read_orders isteğe bağlı izniyle istenir. Resmî dinamik isteme yolu için optional_scopes tanımı önceden yayımlanmalıdır. Overlap girişinde açıklama + Cancel/Connect hedefi ayrı UI işidir; Cancel temel bağlantıyı bozmaz. Dönüşte gerçekten verilen izinler native olarak tekrar okunur. Eski sipariş gerekiyorsa read_all_orders ayrıca, uygulama onayı ve mağaza izniyle değerlendirilir; read_marketing_events yalnız kullanılan özellik gerektiriyorsa ayrıca açıklanır. Kişi/adres/e-posta izinleri topluca eklenmez. Orders izni tek başına kesin provider sipariş çakışması kanıtı değildir.

İlk Shopify kurulum ekranı Shopify’a aittir; uygulamaya girilmeden bizim embedded modalımız açılamaz. Modalın izin öncesinde gösterilebilmesi için hedef akış mevcut asgari native kurulum → uygulamaya ilk girişte Products açıklaması → optional_scopes olarak tanımlanmış read_products isteğidir. Products native açıdan sonradan istenebilir olsa da ürün kurulumu açısından zorunludur; Orders temel kurulumun zorunlusu değildir. Gerekli config yayını ayrı onay kapısındadır. Native zorunlu kurulum izni reddedilirse kurulum tamamlanmaz; kurulu uygulamanın eksik iş adımı Resume Setup olabilir. Mevcut identityPermissionRequirements helper’ı read_products + read_orders birlikte istiyor; temel ürün kurulumu ile sipariş özelliği kontrollerinin ayrılması 07 teknik işi olarak açık kaydedildi. Sipariş okuyucusunun kendi izin kapısı gevşetilmez.

Bağımsız modal işi: amaç/veri kullanımı, birlikte istenen izinler, reddedilirse etkilenen adım, sonraya bırakılabilen Orders, Cancel/Connect davranışı, kısmi dönüş, tekrar bağlanma ve izin geri alma durumları. Google/Meta native scope kapsamı daha genişse sadece-okuma izni diye yanlış açıklanmaz; uygulamanın yalnız okuma davranışı ile verilen iznin kapsamı ayrılır. Bileşen/metin/masaüstü/mobil ve kullanıcı kabulü mevcut Shopify UI anayasasına göre ayrı hazırlanır; bu karar UI PASS değildir.

Geliştirici yetkisi ile mağaza izni ayrıdır. 07’de her sağlayıcı için kapsamın uygulamada tanımı, gerekiyorsa review/verification başvurusu, native onay/pending durumu, mağaza grant’i, seçilen varlık erişimi ve canlı kabul ayrı izlenecek. Elimizdeki tarihli test/OAuth kanıtı bütün Merchant/Catalog/Orders erişimlerinin veya genel mağaza dağıtımının onaylandığını göstermez. Güncel provider yönetim panelleri bu turda incelenmedi; tüm izinler var veya hiç yok hükmü verilmez. Kullanıcıdan tekrar izin almak geliştirici app onay eksikliğini çözmez.

Resmî kontrol tarihi 2026-10-29: Shopify manage-access-scopes/access-scopes/protected-customer-data; Google Merchant third-party authorization ve Google Ads access-levels; Klaviyo submit-your-app-for-review. Kaynaklar contract içinde tam bağlantılarıyla kayıtlı. 04–06 teknik kararları hâlâ birlikte değerlendirilecek; 15/23 başlamadı, 22 listing-tree duraklaması korunur.

## 29 Ekim 2026 — Klaviyo araştırma kapanışı ve teknik eksiğin mevcut sıralara bağlanması

Kullanıcı kararı: Klaviyo Campaign için şimdilik Assisted doğrudur; mevcut Flow Triggered ve çözümlenemeyen Unclassified korunur. Araştırma, Advertised/Cross-sell kanıtı veya runtime uygulaması değildir.

Araştırmanın başında bulunan kod eksiği somuttur: klaviyo-identity-collection.server.js içindeki attributionProjection yalnız campaign/message/flow referanslarını korur; event ve attributed-event bağlantılarını düşürür. klaviyo-reporting-authority.server.js içindeki normalizeAttributionResource da bu iki olay referansını normalize etmez. Mevcut akış atfedilen etkileşim olayını takip etmez. Bu eksik, ürün kimliği araştırmasından ayrı bir teknik alt iştir; kodlandı denmez.

| Mevcut sıra | Bağlanan iş | Durum |
|---|---|---|
| 12 | Dönüşüm olayı ve atfedilen etkileşim olayı kimliklerini korumak; mevcut hesap/izin/kota/iptal/ilk-hata sınırında sınırlı okuyucuya bağlamak. | Şimdi tamamlanacak teknik işler listesine eklendi; kodlanmadı. |
| 13 | Referans bütünlüğü, yanlış kaynak/hesap, çelişki/eksik olay/metric, tekrar/kısmi yanıt ve click/open ayrımı kontrolleri. | Şimdi tamamlanacak teknik işler listesine eklendi; kodlanmadı. |
| 15 | Bu referansların özel kaynak/kanıt saklama ve tekrar okuma tasarımına bağlanması. | İleriki saklama işi; 15 başlamadı. |
| 19 | Campaign Assisted / Flow Triggered kapsamını korumak. | Yeni Advertised/Cross-sell geliştirmesi açılmadı. |

Yeni sıra/paket, yeni OAuth izni veya veri tabanı tablosu açılmadı. Önce 07 OAuth için kullanıcı yaklaşımı dinlenecek; sonra 04–06 ve diğer şimdi tamamlanacak teknik işler birlikte kesinleştirilecek. Bu kayıt tek başına kodlama başlangıcı değildir. Klaviyo ürün seçimi, Google Search ve PMax Asset Group–Campaign ayrımı kullanıcı değerlendirmesinde kalır; önceki PMax Campaign + Unclassified Channel kararı korunur. Listing tree mevcut 22. sırada duraklatılmıştır. Genel Dataset yazımı 23. sıradadır.

Makine kararı: contracts/eo-05-start-brief-v1.json#Klaviyo_research_closure_and_existing_step_assignment_2026_10_29. Master ve 26-adım JSON planı aynı kayda bağlıdır. 27 Ekim Exceli tarihsel görüntüdür; bu turda Excel istenmedi ve yeniden üretilmedi. Kaynak kontrolü 2026-10-29: https://developers.klaviyo.com/en/reference/get_events ve https://developers.klaviyo.com/en/reference/get_event.

# EO-05 / EO-06 — revize 26 adım ve paket özeti

27 Ekim 2026. Önceki 26 sıra aynen korunur; Shopify satış/atıf işleri açık alt işlerdir.

- 1–6 yalnız repository kod teslimi; canlı runtime bağlantısı/kabulü değil.
- 14. sıra, kimlik alt listesinin 12. adımından önce zorunlu değerlendirmedir; iki numara sistemi karıştırılmaz.
- 22 tarihsel PMax ayrı açık yeniden başlatma onayı olmadan açılmaz.
- Kesin overlap, aynı doğrulanmış Shopify Order ID’ye bağlanan okunabilir provider iddiası gerektirir. Bu erişim tüm provider’lar için kanıtlanmış değildir.
- Shopify ek kapsamı nedeniyle eski 24–36 saat tahmini yeniden doğrulanmış süre taahhüdü değildir.

## 29 Ekim 2026 — 02 uzlaştırması

PR #179, sonraki onaylı main teslimleriyle karşılaştırılarak birleştirilmeden kapatıldı; branch ve commitleri korunuyor. 24 dosyanın tamamı için güncel karşılık veya bilinçli değiştirme kararı [dosya bazlı kanıtta](../evidence/EO_05_STEP02_PR179_RECONCILIATION_2026-10-29.json) kayıtlıdır. 01–03: **Kod/testler hazır; gerçek ortam doğrulaması bekliyor.** 04–06’daki çalışan PD hat bağlantıları teknik olarak açık; 07–10’daki gerçek izin/kaynak kimliği kanıtları açık. 14 birlikte değerlendirmedir; 15 başlamadı. 22 duraklaması ve 23 Dataset yazımı sırası korunur. Tarihli eski checkpointler geçmiş kaydıdır; bu karar güncel 02 durumudur. Bu değişiklikte tarihli Excel yeniden üretilmedi; güncel durum bu Markdown ve eş JSON kaydındadır.

## Sıralı plan

| Sıra | İş / sınır | Shopify ek işi | Durum | Paket |
|---|---|---|---|---|
| 1 | Ortak çalıştırıcı ve sağlayıcı hata sınıflarını ilk hatada durma kuralına uyarlamak. Kod ve test düzeltmesi. Otomatik ikinci çağrı olmayacak. | — | Kod/testler hazır; gerçek ortam doğrulaması bekliyor. | EO-05 hazırlık |
| 2 | Eski durum kayıtlarını, sözleşme çelişkilerini ve test beklentilerini güncel kararlarla uzlaştırmak. EO-04 geçmişi korunacak; tamamlanmayan EO-05 işi tamamlandı gösterilmeyecek. | — | Kod/testler hazır; gerçek ortam doğrulaması bekliyor. | EO-05 hazırlık |
| 3 | Ortak kapsam kontrolünü kodlamak: mağaza, kurulum/nesil, bağlantı, hesap, hiyerarşi, gün, saat dilimi, para birimi ve atıf. Sonraki birleşimlerin ön koşulu. | — | Kod/testler hazır; gerçek ortam doğrulaması bekliyor. | EO-05-B |
| 4 | Google’ın performans ve dönüşüm sorgularını tek PD yaprak kaydında birleştirmek. Search Ad, Shopping Ad Group, PMax Asset Group; normal kapsam ve çift sayım kontrolü. | — | Birleştirici main’de — PR #185. Native çağrı akışına bağlantı sonraki adımlarda. | EO-05-B |
| 5 | Klaviyo Placed Order, ATC ve Checkout raporlarını Message seviyesinde birleştirmek. Medium/Variation korunacak; Spend açık kalacak. | — | Birleştirici main’de — PR #186. Native çağrı bağlantısı bekliyor; Spend açık/null. | EO-05-B |
| 6 | Sağlayıcı çıktısından ortak kayıt sözleşmesine geçişi hazırlamak. FX öncesi kaynak kayıt ile FX uygulanmış kayıt ayrılacak. Sahte kur veya eksik alan doldurulmayacak. | — | Canonical köprü main’de — PR #187. publishable=false; canlı metadata/FX ve writer bağlantısı bekliyor. | EO-05-B |
| 7 | Google Merchant hazırlığı ve ek OAuth izni; Meta katalog izinleri; Shopify read_products kontrolü ve gerekli kullanıcı testleri. Kod + kullanıcı onayı/uygulama erişimi doğrulaması. Klaviyo’da mevcut izinler kontrol edilecek. | Shopify ek işi: read_orders; 60 günden eski sipariş gerekiyorsa read_all_orders; MarketingEvent için read_marketing_events ve görünürlük kontrolü; protected customer data / uygulama erişim incelemesi. Mağaza onayı ile uygulama onayı ayrı. read_products ve Google/Meta/Klaviyo izinleri birlikte izlenecek. | Repository izin/OAuth hazırlığı main’de; native kapsam, mağaza/uygulama onayı ve kullanıcı erişim kanıtları açık. | EO-05-B ön koşulu |
| 8 | Google kimlik bağlantısını tamamlamak: hesap → Merchant → feed/dil/veri kaynağı → native ürün → Shopify Product/Variant. Kaynak kimlik biçiminin doğrulanması kanıt bekliyor. | — | Google Merchant/link/kaynak-kuralı/Shopify aday kodu main’de; gerçek kaynak biçimi, Merchant SQL ve native kabul açık. | EO-05-B |
| 9 | Meta kimlik bağlantısını tamamlamak: hesap → katalog → katalog iç ID/retailer_id ayrımı → Shopify Product/Variant. Rapor kimliğinin anlamı ve kaynak biçimi kanıt bekliyor. | — | Meta katalog/Ad referansı/Shopify aday/ham rapor bağları main’de; katalog biçimi ve Insights namespace/native kabul açık. | EO-05-B |
| 10 | Klaviyo kimlik bağlantısını tamamlamak: doğrulanmış Shopify Ordered Product olayı → ürün/varyant. Kesin varyant alanı doğrulanacak; sentetik kayıt kaynak kanıtı sayılmayacak. | — | Klaviyo Shopify ürün/varyant aday ve OrderId/Message kontrol kodu main’de; native varyant/OrderId/kaynak ve atıf kanıtı açık. | EO-05-B |
| 11 | Kaynak kuralı yükleyicilerini ve ortak Shopify Product/Variant-parent doğrulamasını çalışan akışa bağlamak. Kalıcı saklamadan önce kod ve DB’siz sınama. | — | Kaynak kuralı ve Shopify parent doğrulaması aday akışlarına main’de bağlı; canonical PK/selection/OAuth CAS ve kalıcılık ayrı açık. | EO-05-B |
| 12 | Yeni okuyucuları güvenilir aile seçimi, çağrı/kota kontrolü, sayfalama ve iptal/timeout yönetimine bağlamak. Canlı aktivasyon kendi kapısında. Eksik kota altyapısı atlanmayacak. | Shopify ek işi: erişime izin verilen tüm sipariş ve LineItem kayıtlarını ve müşteri yolculuğu/ziyaret atıflarını okuyan akışı hazırlamak. Sayfalama, kota, ilk hata, eksik/ready ve iptal/timeout durumları; paid/organic/direct/unknown kanıt ayrımı. Canlı erişim ayrı onay kapısında. | Fenced SDK/kota/iptal/sayfalama ve Shopify sipariş/LineItem/journey kod hazırlığı main’de; actual Admin/Merchant SQL, profil/hook/kapasite ve native kabul açık. | EO-05-A/B |
| 13 | Dataset yazımı öncesi ortak kontrolleri çalıştırmak: yanlış hesap/nesil, eksik kimlik, çelişki, tekrar, kısmi sonuç, gerçek sıfır ve ilk hata. Kod testleri ile gerçek erişim testlerinin sonuçları ayrı gösterilecek. | Shopify ek işi: workspace + shop + Order ID; satırda LineItem ID anahtarlarını DB’siz sınamak. Replay, değişiklik, iade/iptal, eksik yolculuk ve eşleşmeyen sağlayıcı iddiası senaryoları. Kod testi ile gerçek OAuth/erişim kanıtı ayrı. | DB’siz Order/LineItem replay, ortak aday/rapor/Message ve koşullu Klaviyo Order bağı main’de (#232–236); okunabilir Google/Meta sipariş iddiası ve native claim kabulü açık. Tamamlandı değil. | EO-05-B |
| 14 | Birlikte değerlendirme ve durma noktası. Kimlik listesinin 12. adımına, yeni tablo/migration ve kalıcı yazıma başlamadan duracağız. Açık kanıtlar da burada görülecek. | Shopify ek işlerinin izin, okuyucu, tekilleştirme ve atıf sınırları da birlikte incelenecek. Yeni tablo, migration ve kalıcı yazım bu değerlendirme/onaydan önce başlamayacak. | 14 değerlendirmesinde dar Admin kota SQL/adapter repository migration ve izole test kapsamı kullanıcı tarafından onaylandı; tam storage incelemesi, canlı apply ve 15 writer/tablo onayı verilmedi. | EO-05 değerlendirme |
| 15 | Onaydan sonra kalıcı kimlik eşlemesi, kaynak kuralları ve özel ham kanıt saklama bağlantısını kurmak. Tablo, writer, tekrar okuma, geçmiş/sürüm, silinme/yeniden bağlantı ve gerçek referanslar. Kimlik akışı uçtan uca sınanacak. | Shopify ek işi: sipariş/satır kayıtları ve Shopify atfı ile sağlayıcı iddiaları için ayrı kalıcı kaynak kayıtları; writer/tekrar okuma ve sürüm geçmişi. Fiziksel tablo sayısı burada tasarlanıp onaylanacak; mevcut beş tabloya sessiz ek yapılmayacak. | 14 sonrası açık onayla kodlanacak. Kimlik ve Shopify kalıcılığı henüz kurulmadı. | EO-05-B |
| 16 | Google Shopping/PMax rol sınıflandırıcısını esas ürün satış raporuna bağlamak. Mevcut kod tamamlanacak; normal lead/cross-sell kapsamı korunacak. Gerçek veri doğrulaması ayrıca yapılacak. | — | Eksik bağlantı kodlanacak; gerçek veri kabulü ayrıca yapılacak. | EO-05-B |
| 17 | Google Search’ün rol kapsamını doğrulamak ve desteklenen yolu bağlamak. Kanıt bekliyor. Mevcut özel sorgu ayrımı üretmiyor; Assisted yolu korunacak. | — | Kanıt bekliyor — özel sorgu mevcut haliyle ayrım üretmiyor; Assisted korunur. | EO-05-B |
| 18 | Meta’nın ham yanıtından doğrulanmış satış ilişkisi çıkarma ve sınıflandırıcı bağlantısı. Kanıt bekliyor. Dört alan sorguda kalacak; gerçek istek/yanıt incelendikten sonra mümkün olan çözüm kodlanacak. | — | Kanıt bekliyor — dört alan sorguda; decoder/ilişki bağlantısı tamamlanmadı. | EO-05-B |
| 19 | Klaviyo’nun mevcut rollerini korumak. Araştırma kapalı: Campaign Assisted, Flow Triggered. Yeni Advertised/Cross-sell geliştirmesi yok. | — | Kapsam kararı kapalı — Campaign Assisted / Flow Triggered / Unclassified. Yeni Advertised/Cross-sell işi yok. | EO-05-B kapsam kararı |
| 20 | Roller için yazım öncesi son kontroller: doğru kaynak satış/kimlik referansı, A/B/C/D, aynı küme, çelişki, tekrar ve sıfır değer. Rol ek satış veya ek maliyet üretmeyecek. | Shopify ek işi: Shopify’ın kaynak/son temas bilgisi provider Sales Role yerine geçirilmeyecek. Sipariş adedi ile ürün adedi karıştırılmayacak; Shopify ziyareti tek başına provider’ın dönüşüm iddiası kabul edilmeyecek. | Kodlanacak — rol ve sipariş/ürün kapsamı yazım öncesi kontrolü. | EO-05-B |
| 21 | PMax ürün performansını Asset Group’a bağlamak. Kaynak kanıtı bekliyor. Campaign otomatik Channel yapılmayacak; ürün metrikleri gruplara dağıtılmayacak. | — | Kaynak kanıtı bekliyor — ürün → Asset Group bağı kurulmadan dağıtım yok. | EO-05-B |
| 22 | PMax tarihsel satış Channel’ının kanıt saklama/yükleme ve resolver bağlantısı. Duraklatılmış. Ayrı açık yeniden başlatma onayı olmadan kodlama/aktivasyon yapılmayacak. | — | DURAKLATILDI — ayrı açık yeniden başlatma onayı gerekiyor. | EO-05 tarihsel PMax kapısı |
| 23 | Genel Dataset yazımı, doğrulanmış FX, tekrar güvenliği, checkpoint, düzeltme ve uzlaştırma bağlantıları. Mevcut EO-05-B/C/D sırasıyla. Bellekteki sonuç, kalıcı yazım sayılmayacak. | Shopify ek işi: sipariş/LineItem upsert, replay tekilleştirme, iade/iptal/düzenleme düzeltmeleri; vergi/kargo/indirim/iade satış kapsamı. Shopify atfı ve provider iddiaları ayrı model/pencere/tarih/ready/olgunluk bilgileriyle korunacak. | Kodlanacak — EO-05 kalıcılık/FX/olgunluk/uzlaştırma işleri ve Shopify ekleri. | EO-05-B/C/D |
| 24 | Bağımsız PD üst toplamları ve ürün esaslı CPD Channel toplamlarını bağlamak. Kaynak bağlantıları EO-05; aggregate-first hesaplar EO-06-A. | Shopify ek işi: Shopify satışı bir kez sayılan bağımsız satış temeli. Provider toplamları toplanarak mağaza toplamı üretilmeyecek. Tarih, para birimi/FX, adet, vergi/kargo/indirim/iade ve atıf kapsamları uyumlu karşılaştırılacak. Kesin overlap yalnız aynı doğrulanmış Order ID’ye okunabilir provider iddiası bağlanırsa; toplam farkı tek başına kanıt değil. | Bağlantı ve hesaplar kodlanacak — Shopify satış temeli ek kapsam. | EO-05-B / EO-06-A |
| 25 | Klaviyo Spend hesabını bağlamak. Formül kararı bekliyor. Ledger mevcut; hesap kabul edilene kadar Spend açık/null kalacak. | — | Formül kararı bekliyor — kabul edilene kadar Spend açık/null. | EO-06-A |
| 26 | Bütünleşik son kontrol: kaynaktan okumadan raporlama ve kalıcı tekrar okumaya kadar akışı sınamak. Kod, entegrasyon ve gerçek veri kabulü ayrı raporlanacak; açık kalan sağlayıcı kanıtları gizlenmeyecek. | Shopify ek işi: izin → sipariş/satır okuma → tekilleştirme → atıfların ayrı saklanması → düzeltme → rapor/tekrar okuma. Kesin sipariş eşleşmesi ile yalnız toplam karşılaştırması ayrılacak; eksik provider kanıtı görünür kalacak. | Kodlanacak/sınanacak — bütünleşik kabul; kanıt eksikleri ayrı raporlanacak. | EO-05 kabulü / EO-06-E |

## Paket özeti

| Paket | Kısa açıklama |
|---|---|
| A6-EO-05-A | Saatlik işleri mağazalara dengeli dağıtır; aynı işin çakışmasını, eşzamanlılık/kota yükünü ve kaldığı yerden devam etmeyi yönetir. |
| A6-EO-05-B | Doğrulanmış kayıtları mağaza kapsamında saklar; kaynak para birimi ve kur kanıtını korur. Kimlik eşlemesi ile Shopify sipariş/satır ve ayrı atıf saklama ekleri burada. |
| A6-EO-05-C | Geç gelen/düzeltilen dönüşümleri işler; geçici/kesin ve güncellik durumlarını yönetir. Shopify ve provider model/pencere/ready ayrımı da burada. |
| A6-EO-05-D | Dün+bugün başlangıcını, aynı kaydın tekrarında çift yazmamayı, yeniden işlemeyi ve ham/ortak kayıt farklarının takibini kurar. |
| A6-EO-05-E | İş gecikmesi, uzlaştırma yaşı, CPU/bellek/bağlantı, disk/veritabanı büyümesi ve aktif çalışma alanı maliyetini hassas veri sızdırmadan izler. |
| A6-EO-06-A | Önce toplar, sonra KPI hesaplar; maliyet dağıtımı ve para birimi kurallarını uygular. PD/CPD toplamları, Shopify satış temeli ve kabul edilecek Klaviyo Spend hesabı burada. |
| A6-EO-06-B | Mağaza saat dilimi, tarih/varlık filtreleri ve desteklenen seviyeleri uygular; Summary/Table 90 gün, Daily 31 gün ve eşit dönem karşılaştırması. |
| A6-EO-06-C | Oturumdan çalışma alanını belirler; üç ürün yüzeyi için tutarlı istek/yanıt sözleşmeleri sağlar. |
| A6-EO-06-D | Bilinmeyen, desteklenmeyen, eski, kısmi ve gerçek sıfırı ayrı gösterir. |
| A6-EO-06-E | Mağazalar arası yetki ihlali, formüller, sorgular ve API davranışlarını bütünleşik kanıtlarla sınar. |

Kaynaklar: önceki plan konuşma turu 01a17c5f-d148-7533-95d0-3c32770859ea; master sözleşme; EO-05 başlangıç brief’i; PD/CPD sözleşmesindeki shopify_order_attribution_decision_2026_10_27.

Paket eşlemesi işlerin yerini gösterir; EO-05-A/E gibi paketlerin bütün kapsamı 26 satırın tek tek kapanmasıyla otomatik tamamlanmış sayılmaz.

28 Ekim 2026 yürütme durumu: `docs/evidence/EO_05_STEP13_PREWRITE_CHECKPOINT_2026-10-28.json`. 27 Ekim Exceli tarihsel plan görüntüsüdür; bu checkpoint için yeniden üretilmedi. 26 sıra ve iş kapsamları değişmedi.
