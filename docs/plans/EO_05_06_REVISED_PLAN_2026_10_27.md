## 30 Ekim — 15 öncesi PMax sırası ve Overlap erteleme mutabakatı

Ürün sahibi sıralamayı kabul etti: önce mevcut 21 içindeki PMax bağlantısının dar hazırlığı, sonra ayrıca somut OAuth/UI onayıyla 07'nin kalan işi, ardından 14 değerlendirmesi ve açık 15 kararı. Mevcut 01–26 numaraları değişmez.15 başlamadı.

PMax'te kaynak Campaign içindeki reklam ürününün dönemle uyumlu, tam ve doğrulanmış üyelik kanıtı tek Asset Group gösteriyorsa o Channel'a bağlanır. Çoklu, eksik, eski veya çelişkili kanıtta Unclassified Channel kalır; bağımsız doğrulanmış Advertised/Cross-sell korunur. Cross-sell satılan ürünün üyeliği kaynak Channel'ı belirlemez. Başka Campaign'deki aynı ürün mevcut Campaign kaydını belirsizleştirmez. Meta'nın açık Ad kimliği varsa korunur. Campaign toplamı ürünlere/gruplara dağıtılmaz.

Listing-filter sorgusu, DB'siz resolver ve testler kodda var; bunlar tamamlanmış envanter/tarihçe/runtime hattı değildir. Güncel liste geçmiş satışa kanıt sayılmaz; yalnız bugün açık kampanyalarla tarihsel tek aday ispatlanmaz. Tarihsel üyelik saklama/yükleme mevcut 22 kapsamındadır ve duraklatılmıştır; ayrı yeniden başlatma onayı gerekir. Dar PMax işi yeni tablo, migration, kalıcı writer veya canlı aktivasyon yetkisi değildir.

Klaviyo araştırması kapatıldı: Campaign Assisted, Flow Triggered; yeni Advertised/Cross-sell veya webhook geliştirmesi yok. Overlap kaynak erişimi araştırması ve uygulama kararı 22 sonrasına ertelendi, mevcut 24 başvurusuyla izlenir. Google/Meta için sipariş bazlı okunabilir atıf yolu doğrulanmadı; order_id gönderimi sahiplenme kanıtı değildir. Shopify kaynağı/journey provider iddiası yerine geçmez; eksik kanıt sıfır Overlap değildir. Mevcut Shopify/LineItem ve sağlayıcı kaynak hazırlıkları korunur.

Bu teslim yalnız karar/sıra kaydıdır; çalışma zamanı kodu, OAuth/UI, token, canlı API/config/deploy/DB veya Dataset yazımı değişmedi. Makine kaydı: contracts/eo-05-start-brief-v1.json#Pre15_PMax_and_overlap_owner_decision_2026_10_30. Resmî Google/Klaviyo belgeleri ve Meta SDK kaynakları 30 Ekim'de kontrol edildi; Meta Insights dokümanı 429 verdiği için genel destek yokluğu iddiası kurulmadı.

## 30 Ekim — Klaviyo PD Message bağlama teslimi

Yedinci teknik teslim / mevcut05: mevcut Campaign/Flow × Placed Order/ATC/Checkout raporları ortak okuyucuda tek koleksiyonla Message birleştiricisine bağlandı. Medium/Variation, native parent, metrik seçimi ve kaynak satır/sayfa referansları korunur. Funnel kaynakları birbirine eklenmez; Ordered Product/ürün satış kayıtları bu hesaba girmez. Spend ve Sales Role bu teslimin dışında kalır.

Her flow'a ve exact okuma bağlamına bağlı güvenilir sunucu metadata'sı eksikse ham kaynak korunur, kompozisyon blocked kalır. Eksik metrik/detay/değer sıfır değildir. Sonraki teknik teslim8 metadata/canonical kaynak köprüsünü;9 etkileşim okumasını;10 birlikte yazım öncesi sınamayı ele alır. Bunlar bu teslimle kapatılmadı.29 yeni izole test ve önceki ilgili79 test geçti; exact CI/F01 ayrı izlenir.15 başlamadı,22 duraklatılmış,23 Dataset/FX yazımı.

## 30 Ekim — Google PD bağlama teslimi

Altıncı teknik teslim / mevcut04: Search Ad, Shopping Ad Group ve PMax Asset Group'un mevcut performans/normal dönüşüm aileleri tam sayfalama ile ortak kaynak girişine ve composeGooglePdLeaf'e bağlandı. Her yaprak, native hiyerarşi ve ayrı kaynak/sayfa/satır izleri korunarak işlenir. Eksik değer ve boş rapor sıfır sayılmaz; all_* veya performans dönüşüm toplamı kategori metriklerine eklenmez. Hata/iptal/kota beklemesi/authority değişimi eksik sonucu tamamlanmış göstermez.

Güvenilir compositionContext bağları/fingerprintleri/kaynak referansları eksikse ham okuma korunur, birleştirme blocked kalır. Bunların kalıcı/native kaynağı ile canonical köprü teslim8'de; Klaviyo teslim7'de kalır. Yeni sorgu, izin, UI, canlı aktivasyon veya writer eklenmedi.30 yeni izole test geçti; exact CI/F01 ayrıca doğrulanır.15 başlamadı,22 duraklatılmış,23 Dataset/FX yazımı. Kayıt: contracts/eo-05-start-brief-v1.json#Google_PD_read_composition_2026_10_30.

## 30 Ekim — Ortak kaynak okuma girişi

Mevcut 6/11/12 kapsamındaki beşinci teknik teslimin ilk dilimi: createRefreshPdSourceReader mevcut kota kontrollü Google/Meta/Klaviyo okuyucularına tek-kullanımlık, mağaza/hesap/nesil/sürüm bağlı giriş sağlar. Kaynak günü, saat dilimi, para birimi ve ham hiyerarşi/sorgu kanıtı birlikte taşınır. Eksik metadata, değişen hesap/kurulum/credential/seçim nesli, yarım okuma, iptal veya ilk hata başarıya çevrilmez. Sıradaki 6/7/8 teslimleri metrik birleştiricileri ve kayıt köprüsünü bağlayacak; bu dilim canonical kapsam veya kalıcı aktivasyon vermez. Google devam sayfası bu ilk dilimde toplanmaz, partial reddedilir. Atıf/birim fingerprintleri eksikken null kalır.

Klaviyo görsel bulguları ve Meta/Google native modal kabulü #264'te ayrı açık tutulur; toplu düzeltme kararı korunur. Yeni UI, canlı izin/config/yayın/DB değişikliği yoktur. F01 yalnız izole CI'da çalışır;15 başlamadı,22 duraklatılmış,23 Dataset/FX yazımıdır. Yetki, kaynak ve test kaydı: contracts/eo-05-start-brief-v1.json#Shared_source_read_context_2026_10_30.

## OAuth — işlem öncesi zorunlu açık kullanıcı onayı (29 Ekim 2026)

**OAuth’a doğrudan veya dolaylı değen hiçbir çalışma, yapılacak somut işlem ve kapsam açıklanıp kullanıcıdan önceden açık izin alınmadan başlatılamaz.** Tüm sağlayıcılar ve Shopify dahildir.

- İnceleme/araştırma, akış ve ekran tasarımı, izin/kapsam, hesap/Reporting Account/Merchant/işletme/katalog seçimi veya bağlantıları bu kapıya tabidir.
- Kod, test, sözleşme, migration, config, callback/token/oturum, canlı çağrı, temizlik/kaldırma/geri alma/refactor, deploy ve merge de dahildir. Düzeltme veya geri alma amacı kendiliğinden izin oluşturmaz.
- Genel “devam edelim”, genel onay, önceki başka iş/merge onayı veya önceki plan kararı OAuth yetkisi değildir. Onay yalnız açıkça belirtilen somut iş ve kapsam için geçerlidir. Kapsam değişecekse durulur ve yeni açık izin alınır.
- Bu kapı, OAuth için önceki bağımsız kodlama veya izole test ilerleme izinlerinin önündedir; teknik olanak, başarılı test, geri alınabilirlik veya ajan takdiri yerine geçmez.
- #264 kullanıcı tarafından reddedilen katalog seçim adımı nedeniyle durdurulmuştur; merge yetkisi yoktur. Katalog seçimi kodu temizlenmedi veya değiştirilmedi. Temizlik de ayrı açık izin bekler.
- Bu kuralın AGENTS ve bağlayıcı belgelere kaydı kullanıcı tarafından açıkça istendi. Bu izin yalnız kural kaydına aittir; OAuth inceleme/kodlama/test/temizlik veya provider işlemi yetkisi vermez.

## 29 Ekim 2026 — Onaylı kararlı Polaris 2.0 hizalaması

#262 main’e birleşti (284c789715342786e972f912e5a57d253b1c7001). Ürün sahibi açıklama tasarımını ve sabit polaris-2.0.js + exact @shopify/polaris-types@2.0.0 geçişini açıkça onayladı. Sunucu ShopifyApp ve AppProvider aynı merkezi runtime değerini kullanır; paket ve lock birlikte değiştirilir. Resmî Shopify sürümleme kaynağı 2026-10-29 kontrol edildi: https://shopify.dev/docs/api/app-home/latest/web-components/versioning.

Bu kayıt yalnız kod referansını hizalar. Gerçek Shopify Admin masaüstü ve en az 320 px gerçek mobil görsel kabulü bekliyor; yeni modal/route veya izin aktivasyonu tamamlandı sayılmaz. Shopify üzerinde ajan görsel işlem yapmaz. Canlı config/deploy/izin/token/DB değişikliği yok. Eski RC kararları tarihsel kayıttır; güncel sürüm seçimi kararlı 2.0’dır. 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımıdır.

Doğrulama: kararlı tiplerle tip kontrolü ve derleme geçti. İlk tüm test koşusunda 3.009 testten 3.007 geçti; eski sürüm/lock beklentileri güncellendikten sonra ilgili 34 testin tamamı geçti. Tarihsel 18 Ekim güvenlik kanıtı korunur; yeni lock parmak izi bu geçiş kaydındadır. Exact commit için zorunlu CI tüm testleri yeniden çalıştırır; CI sonucu ayrıca doğrulanır.

## 29 Ekim 2026 — İzin açıklamaları: tek standartta somut metin ve akış tasarımı

#261 main’e birleşti (297d0d620e0878e90ae2284903037784d472b541); 3.009 test/tip/derleme ve iki CI başarılı. 07 içindeki dördüncü teslimin kod öncesi tasarımı hazırlandı. Tek okunabilir analist belgesi docs/EO_05_PERMISSION_EXPLANATION_DESIGN_BRIEF.md; makine sözleşmesi contracts/eo-05-permission-explanation-design-v1.json. Shopify Products, isteğe bağlı Orders, Google Ads+Merchant, Meta Ads+Catalog ve Klaviyo için birebir İngilizce ekran metinleri; Türkçe inceleme özeti; Cancel/Connect, yükleniyor/dönüş/eksik/belirsiz sonuç durumları ve aşamaya göre Resume yolu birlikte yazıldı.

Yalnız izin eksiği yeniden açıklama/Connect ister. Hesap/katalog seçimi ve Klaviyo maliyeti eksikliği OAuth’ı otomatik başlatmaz; maliyette 0 ile eksik ayrıdır. Orders reddi Products durumunu bozmaz. Google/Meta geniş native izinleri okuma-only diye sunulmaz; uygulamanın okuma amacı ayrıca anlatılır. Yalnız access/scope gözlemi Connected veya iş aktivasyonu sayılmaz.

Resmî Modal/Button/Paragraph/Stack/Banner özellik ve slot eşlemesi 2026-10-29 kaynakları ve kurulu manifest ile karşılaştırıldı. Desktop ve en az 320 px gerçek mobil, odak/klavye/dokunma, tam metin ve tek modal kabulü tanımlandı. Bu tur TSX/route veya görsel UI kodu yazılmadı; sentetik tasarım gerçek Shopify Admin kabulü değildir. Kullanıcının Shopify’da görsel otomasyon yapılmaması talimatı korunur.

Kod öncesi sürüm kararı: mevcut açık onaylı RC 2.0 + rc.2 tipleri yerinde. Resmî stable 2.0 dosyası HTTP 200, resmî npm latest tipleri 2.0.0; Shopify sürümleme belgesi stable/RC ayrımını ve eşlenik geçişi doğruluyor. Somut öneri sabit polaris-2.0.js + exact 2.0.0; anayasadaki açık ürün sahibi karar kapısı için kullanıcıya soruldu. Bu tasarım runtime/type/lock geçişi, config/deploy veya kabul yapmaz; yanıt alınmadan UI sürümü sessiz değiştirilmez.

JSON/başvuru/metin tutarlılığı yerelde kontrol edilir; yalnız belge/sözleşme değişikliği için çalışma zamanı testleri tekrar edilmez, zorunlu exact CI PR’da izlenir. Yeni canlı izin/token/provider/config/DB/Dataset veya kullanıcı görsel kabulü yoktur. 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımıdır. Makine kaydı: contracts/eo-05-start-brief-v1.json#Permission_explanation_design_2026_10_29.

## 29 Ekim 2026 — Shopify Products / sonradan Orders izin isteme ve dönüş altyapısı

#260 main’e birleşti (d9dc4585c4859b07df3e9ebb8464a390fc0080c3); iki CI ve 2.966 test/tip/derleme başarılı. 07/12 içindeki üçüncü teknik teslimin runtime.permissionSetup sunucu girişi hazırlandı. Products temel izin durumu ve isteğe bağlı Orders ayrı okunur. Orders yok/ret/geri alma Products hazır durumunu bozmaz; Products yoksa Orders istemi başlatılmaz. Tarayıcı granted-all bilgisi veya caller scope listesi kanıt değildir. afterReturn, aynı güvenilir kurulumdan currentAppInstallation izinlerini yeniden okur.

requestProducts/requestOrders yalnız açık Connect, iki kapalı-varsayılan sunucu kapısı ve native olarak yayımlanmış exact optional handle ile çalışabilir. Sabit hedef read_products veya read_orders; write/history/marketing/customer izinleri eklenmez. Cancel hiç I/O yapmaz; mevcut grant yeniden istenmez. Doğrudan Admin okumaları tries:1 ve iptal sinyaliyle yapılır. Native kurulum/mağaza/nesil yeniden doğrulanır; Admin ve SDK metotları ilk await öncesi sabitlenir. SDK yalnız bir kez çağrılır, ilk hata sonrası retry/fallback/yenileme/revoke/delete veya token yazımı yoktur.

Kurulu SDK 3.0.1 native scopes.request metodu kullanılır; elle yönlendirme kurulmaz. Yalnız o mağaza/uygulama/sabit izinler için SDK’nın boş 401 App Bridge yanıtı aynen aktarılır; farklı yanıt veya hata izin verilmiş sayılmaz. SDK void dönüşünden sonra gerçek izin tekrar okunur. Toplam süre/ip­tal kapısı geç sonucu reddeder; SDK scope metodunun kendi iç okuması signal almadığından başlamış iç okumayı durdurma garantisi verilmez.

Mevcut shopify.app.toml değişmedi. read_products/read_orders optional_scopes hedefi ayrı yayın adayında: contracts/shopify/shopify-progressive-permissions-release-candidate-v1.json. Aday yayın/grant değildir; config yayını ayrı açık onay ve exact sürüm doğrulaması ister. Açıklama modalı ve Settings/dönüş bağlantısı dördüncü teslimde; canlı kurulum/izin/korumalı veri/SDK-kota kabulü ayrıca bekler. Arka plan Orders okuyucusunun izin/oturum/kota sınırları değiştirilmedi. permission_ready yalnız scope gözlemidir, sipariş okuma/Overlap veya genel aktivasyon yetkisi değildir.

43 yeni test, 151 ilgili test ve 3.009/3.009 tüm test geçti; tip kontrolü ve derleme başarılı. Exact commit CI ve kullanıcı merge onayı beklenir. Shopify resmî izin yönetimi/SDK kaynakları 2026-10-29 kontrol edildi; paket yükseltilmedi. Yeni UI/route, canlı izin/token/config/deploy/DB veya Dataset yazımı yoktur. 15 başlamadı; 22 duraklatılmış, 23 Dataset/FX yazımıdır. Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_progressive_permission_setup_2026_10_29.

## 29 Ekim 2026 — Birleşik kurulum: Merchant/katalog erişim kontrolü

#259 main’e birleşti (2151de8df9ba155e541b9e4558b3f059a842f41d); iki zorunlu CI başarılı. 07 / ikinci kod tesliminin runtime.combinedSetup.verifyAssets sunucu girişi hazırlandı. Kapı varsayılan kapalı; mevcut Settings/callback ve reporting_v1 yolları değişmedi.

Google seçilen Ads hesabının doğrudan Merchant bağını tam okur; Merchant hesap resource name/accountId eşliğini ve tek ürün sayfasının okunabildiğini kontrol eder. Merchant erişimi ve Ads bağı tekrar kontrol edilir. Meta önce token kullanıcısının güncel reklam hesabı erişimini, sonra seçilen işletmenin kendi veya kendisine paylaşılan reklam hesabı/katalog üyeliğini, katalog kimliğini ve tek ürün sayfası erişimini native okur; kullanıcı erişimi, üyelikler ve token app/izin/süre kontrolü sonda yenilenir. İşletmede görünmek kullanıcının o hesaba erişimi yerine geçmez. Aktif kampanya/reklam zorunlusu eklenmedi. Meta için bu kanıt işletme varlık erişimidir; reklamda o katalog kullanıldı, ürün gösterildi veya Insights kimliği çözüldü anlamına gelmez.

Boş ürün listesi erişim hatası değildir; toplam ürün adedi, gerçek zero veya kimlik eşlemesi çıkarılmaz. Yalnız güncel güvenilir Shopify kurulum bağlamı ve mevcut seçili raporlama hesabı kullanılır. Mağaza/nesil/connection/version/credential/raporlama seçimi her native okuma çevresinde korunur. Hata, bozuk veya döngüsel sayfalama, erişim/izin/bağ değişimi, iptal veya toplam süre aşımı sonucu geçersiz kılar. Otomatik retry/fallback/yenileme/revoke yoktur. Çıktıda token/credential/ham ürün listesi taşınmaz.

Başarı accessState=verified üretir; setupComplete=false ve setup_activation_pending/review_setup kalır. Geliştirici uygulama onayı değerlendirilmiş sayılmaz; UI/modal kabulü ve nihai setup aktivasyonu açık kalır. Kanıt geçici ve sürelidir; kalıcı kaynak/kanıt bağları mevcut 15. maddede, Dataset/FX yazımı 23’te kalır. Bu parça ikinci kod tesliminin tamamı veya canlı kabulü değildir. Native izin/token/config/deploy/DB/Dataset değişikliği yapılmadı. 15 başlamadı; 22 duraklatılmış.

57 yeni test ve 289 ilgili test geçti. Son kullanıcı-hesap kontrolünden önceki yerel 2.964 test/tip/derleme geçti; nihai değişikliğin tüm test/tip/derleme kabulü exact commit CI ile doğrulanacaktır. Google Merchant Account/Get/Products List ve Meta resmî Business/ProductCatalog SDK kaynakları 2026-10-29 okundu. Mevcut izin seti genişletilmedi; gerçek app review/merchant erişim kabulü sentetik testlerden çıkarılmadı. Makine kaydı: contracts/eo-05-start-brief-v1.json#Combined_provider_setup_asset_access_2026_10_29.

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


## Üç sağlayıcı ortak kayıt köprüsü — 30 Ekim 2026

- Açık ürün sahibi onayıyla teknik teslim8: mevcut Google/Klaviyo PD birleşik kayıtları ve Meta tek Ad sorgusunun metrik projeksiyonu ortak canonical kontrolüne bağlanır. 26 maddelik sıra değişmez.
- Giriş: createRefreshPdSourceReader için açık sunucu recordBridge.metadata seçeneği. Gerçek çalışma/hesap/gün/para birimi, bağlantı sürümü/seçim nesli/fence, varlık/üst kimlikler ve ham satır indeksleri karşılaştırılır. Meta ürün toplamı PD yerine geçirilmez.
- Her varlığın açık atıf/birim fingerprinti ve kaynak referansı, entity/time/reporting currency/FX kanıtı gerekir. Eksik/çelişkili metadata veya FX bekleme nedeni döndürür; kur veya otomatik1 üretilmez. Bir hatalı varlık tüm ortak kayıt grubunu bekletir; kaynak ve ayrı sonuçlar korunur.
- Kodun referans biçimini doğrulaması gerçek provider atıf kanıtı değildir. Güvenilir etkin metadata edinimi ve native kabul açık; bu kayıtla tamamlandı sayılmaz. Kalıcı metadata/kanıt deposu15, worker/prewrite bütünleşmesi teslim10, Dataset/FX writer23.
- UI/izin/akış, canlı sorgu, yeni provider alanı, migration, deploy, Spend hesabı veya Sales Role değişmedi. canonical_scope_ready/persistable/authorizes_activation/publishable=false.15 başlamadı;22 duraklatılmış.
- Bağlayıcı ayrıntı: contracts/eo-05-start-brief-v1.json#PD_common_record_bridge_2026_10_30. Resmî kontrol30Ekim: Google dönüşüm raporlama, Klaviyo Reporting API, Meta resmî SDK. Meta Insights sayfası429; SDK alanlarından davranış kanıtı çıkarılmadı.


## Klaviyo satış–atfedilen etkileşim okuması — 30 Ekim 2026

- Açık ürün sahibi onayıyla teknik teslim9: event/attributed-event referansları reporting ve sparse kimlik kaydında korunur. Ayrı collectKlaviyoInteractionEvidence / createRefreshKlaviyoInteractionReader girişi mevcut Message/rol çözümünü koruyarak yalnız referansın gösterdiği olayı okur. Eski girişler ek olaya kendiliğinden gitmez.
- Sale → attribution → aynı sale ve exact interaction ID kontrolü; metric kimliği/türü/adı ve zaman kontrolü. Eksik bağlantı ile açık boş ilişki, çelişkili referans ve satıştan sonraki olay ayrı sonuçtur. Aynı olay bir kez okunur; her satış zamanı ayrı kontrol edilir. Önceki günün olayı otomatik reddedilmez; atıf penceresi uydurulmaz.
- GET event detail yalnız id/datetime/timestamp ve metric id/name/integration ister; müşteri/profile/event_properties taşımaz. Klaviyo Clicked Email/Opened Email kanıtı tıklanan ürün/son tıklama kanıtı değildir. Campaign Assisted / Flow Triggered değişmez.
- Tek olay kotası liste kotasından ayrıdır: event_detail + include metric. Resmî10/s ve150/m bilgisi kaydedildi; gerçek runtime kota profili otomatik kurulmadı. Profil yoksa HTTP öncesi not_configured; liste/fallback yok. Owner/account/scope kontrolleri, her HTTP için kota, ilk-hata duruşu ve tüm okuma deadline/abort korunur.
- Tam bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#Klaviyo_attributed_interaction_read_2026_10_30. Resmî kontrol30Ekim2026: Klaviyo Get Event ve resmî OpenAPI revision2026-10-15. İzole testler native kabul sayılmaz; native izin/profil/kaynak kabulü ve teslim10 worker/prewrite açık.
- Canlı sorgu, OAuth/izin/UI, migration, deploy veya Dataset yazımı yapılmadı.15 başlamadı,22 duraklatılmış,23 writer.


## PD native metadata okuması — 30 Ekim 2026

- Açık ürün sahibi onayıyla teknik teslim8 metadata bağlantısı: createRefreshPdSourceReader için nativeMetadata:true ayrı sunucu seçeneği. Varsayılan sorgular/akış korunur; elle verilmiş composition fingerprinti ile karıştırılamaz.
- Google aynı reporting customer üzerinden hesap para birimi/saat dilimi ve conversion_action model/pencere/counting/owner/category bilgilerini rapor öncesi/sonrası sayfalayarak okur. Değişiklik veya rapordaki action/category eksikliği composition'ı bekletir. Başka müşteri/manager hesabına kendiliğinden gidilmez. Search'te yalnız bu seçenekte ad.name de istenir; eksik ad uydurulmaz.
- Meta eski Ad alanlarına native account_currency/attribution_setting ekler; action_report_time=impression ve use_unified_attribution_setting=true açık istenir. Product sorgusunda aynı parametreler ve eski dört converted/promoted alanı korunur. Her Ad'ın raporladığı atıf etiketinden ayrı kapsam/ref üretilir; eksik etiket default ile doldurulmaz.
- Klaviyo Accounts id/preferred_currency/timezone rapor öncesi/sonrası salt okunur. İncelenen Reporting/Accounts resmî sözleşmesinde hesap atıf ayarlarını okuyan doğrulanmış alan/endpoint bulunamadı. Bu API desteklenmiyor hükmü değildir; attribution_settings_read_not_documented beklemesi görünür, altı ham rapor ve birim bilgisi korunur. Klaviyo metadata tamamlandı sayılmaz.
- Actual settings + sürümlü birim sözleşmesi hash/ref/attempt/snapshot üretir ve mevcut birleştirici/köprüye bağlanır. Kaynak entity/time bilgisi native satırlardan gelir; raporlama para birimi/kur ayrı açık server girdisidir. Sahte kur/otomatik1 yok; eksik hedef reporting_currency_reference_required kalır.
- Önce/sonra eşitliği transaction snapshot veya geçmiş tüm iş günü ayar kanıtı değildir. Kota, owner/version/selection/fence, abort/toplam süre, ilk-hata ve tam sayfalama sınırları korunur. Boyut sınırları decode/serialized kontroldür; tepe bellek kabulü değildir.
- Bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#PD_native_metadata_read_2026_10_30. Google v25 field referansı, Meta resmî SDK ve Klaviyo2026-10-15 Reporting/Accounts sözleşmeleri30Ekim2026'da kontrol edildi. Native müşteri kabulü ayrı açık.
- OAuth/izin/UI, canlı sorgu, migration/deploy, Sales Role veya Dataset yazımı yok. Kalıcılık15, FX/Dataset23, ortak prewrite teslim10;22 duraklatılmış.


## Klaviyo atıf varsayılanı kararı — 30 Ekim 2026

Ürün sahibi, hesap atıf ayarı için API beklemesi yerine resmî e-posta varsayılanını kabul etti: Last Touch, tıklama5gün, açılma5gün. Kullanıcıdan ek ayar istenmez. Kaynak official_documented_default; account_settings_verified=false. Yukarıdaki attribution_settings_read_not_documented beklemesi bu kararla kaldırılır; hesabın gerçek ayarı okunmuş sayılmaz.

Mevcut Klaviyo satışları ve sipariş–mesaj atıfları aynen korunur. Beş günlük filtre, yeni atıf hesabı veya rol değişikliği yapılmaz. Varsayılan karşılaştırma dayanağıdır; diğer kanallar ve hariç tutma ayarları doğrulanmış sayılmaz. nativeMetadata:true, native hesap/para birimi/saat dilimi kontrollerinden sonra Campaign/Flow send_date bağlamlarını bu açık kaynak bilgisiyle üretir. Eksik entity/FX ve sonraki yazım kapıları korunur.

Bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#Klaviyo_documented_default_attribution_2026_10_30. Resmî kaynak30Ekim: https://help.klaviyo.com/hc/en-us/articles/11118357030555. Kod/izole test değişikliği; canlı sorgu, OAuth, UI, deploy veya Dataset yazımı yok.15 başlamadı;22 duraklatılmış;23 yazım. Merge ayrı açık onay bekler.


## Ortak yazım öncesi kontrol: PD–çalıştırıcı ilk bağlantısı — 30 Ekim 2026

PR271, açık kullanıcı onayı ve exact head562fb426 zorunlu Governance/F01 SUCCESS sonrasında03b6e3b558e022ac52a7564854f903712c2e50f9 olarak birleşti. Mevcut birincil checkout kullanıcı attachment dosyalarıyla korundu; güncel main üzerinden codex/pd-worker-prewrite açıldı.

Onaylı teknik teslim10 / mevcut13 içinde yalnız ilk dilim: runRefreshPdPrewriteChunk mevcut PD kaynak okuyucusunu runRefreshChunk doğrulamasına bağlar. Kaynak okumasının private in-process kanıtı, exact mağaza/hesap/gün/claim/fence ve eksiksiz canonical kontrolleri gerekir. Eksik metadata/kur ve yarım sonuç ilerlemez; açık sayısal sıfır korunur. JSON kopyası kaynak kanıtı değildir.

Teslim öncesi mevcut SQL fonksiyonundan kurulum/mağaza/hesap, bağlantı sürümü, credential referansı, seçim nesli, grant listesi ve birim/saat dilimi tekrar karşılaştırılır. SQL beklemesi süreyle sınırlıdır; geç sonuç teslim başlatmaz. Kota bekleme kanıtı korunur, provider hatası tekrar edilmez. Bu kontroller native izin veya geçmiş tam gün ayarı kanıtı değildir.

Çalıştırıcının ready_for_dataset/awaiting_dataset aşaması yalnız bellekte teslimdir; rezervasyon korunur. Dataset yazımı, kalıcı checkpoint, başarıyla tamamlanmış refresh, Scheduler/route aktivasyonu veya Sales Role değişikliği yoktur.

Teslim10 TAMAMLANMADI: candidate/reference, Order/LineItem/provider claim, Klaviyo etkileşim ve kabul edilmiş setup/native izin kanıtı ile bütünleşik kontroller sıradadır. OAuth/UI değiştirilmez. Kalıcı eşleme15 başlamadı;22 duraklatılmış;23 Dataset/FX writer. Bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#PD_worker_prewrite_first_slice_2026_10_30.

Resmî kontrol30Ekim2026: Google Reporting Overview, Klaviyo Reporting API Overview ve Meta resmî SDK okundu. Yeni provider sorgusu/alanı veya kanıtlanmamış davranış eklenmedi. Kaynak/işçi sınırının49 testi geçti; genel/CI ve F01 ayrı doğrulanır. Canlı çağrı, config, migration veya deploy yapılmadı; merge ayrı açık onay bekler.


## Ortak yazım öncesi kontrol: kaynak ailelerinin birlikte sınanması — 30 Ekim 2026

PR272, açık kullanıcı onayı ve exact e295a86 Governance/F01 SUCCESS sonrasında aeddc1888158d24fa75e70153e783ce0c166435b olarak birleşti. Approved head ile merge commit tüm tree hash eşliği doğrulandı. Güncel main üzerinden codex/integrated-prewrite-review açıldı; birincil checkout ve kullanıcı attachment dosyaları korundu.

Teknik teslim10 / mevcut13: reviewRefreshIntegratedPrewrite mevcut PD, candidate/reference ve isteğe bağlı Shopify Order/LineItem/provider claim ile Klaviyo etkileşim kontrollerini bir araya getirir. runRefreshPdPrewriteChunk açık prewrite girdisiyle bu kontrolü bellekte teslim öncesi çalıştırır. Eski PD-only giriş otomatik yeni okuma yapmaz.

Mağaza, kurulum/nesil, hesap/bağlantı/seçim, iş/fence ve gün eşitliği gerekir. Orijinal private kaynak gözlemleri korunur; JSON kopyası kanıt olmaz. Orders verilmemiş ile başarıyla boş okunmuş ayrıdır. Native PD toplamı ürün/sipariş metriğine dağıtılmaz; kaynak tarih aralıkları eşit sayılmaz. Klaviyo etkileşimi yalnız aynı kaynak satış/atıf/metric/account referanslarıyla eklenir. Farklı iş/satış referansı reddedilir; gelecek tarihli veya çelişkili etkileşim görünür ve ortak worker teslimini durdurur. Ürün tıklaması veya Advertised/Cross-sell üretilmez.

732 ilgili test geçti. Genel test/tip/derleme ve exact source CI/F01 ayrıca doğrulanır. Teslim10 tamamlandı sayılmaz: kabul edilmiş setup/native izin kanıtının bağlanması ve gerçek kota profili/kapasite/kaynak doğrulaması açık. OAuth/UI değişikliği, canlı çağrı, migration, deploy, kalıcı eşleme veya Dataset yazımı yok.15 başlamadı;22 duraklatılmış;23 writer.

Bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#Integrated_source_prewrite_review_2026_10_30. Resmî kontrol30Ekim2026: https://developers.klaviyo.com/en/reference/get_event ve https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order okundu; yeni provider davranışı çıkarılmadı. Merge ayrı açık onay bekler.


## Teknik teslim10: kurulum/izin kanıtının ortak kontrole bağlanması — 30 Ekim 2026

PR273 açık kullanıcı merge onayı ve exact head6f9d646 Actions Governance/F01 SUCCESS ile15457c1446000c7c1866cc547b20d1ceebc32a43 olarak birleşti. Approved head ile main tüm tree eşliği doğrulandı. Yeni iş güncel main üzerinden codex/setup-proof-review içinde; birincil checkout/attachment dosyaları korundu.

Ürün sahibi somut sınırı gördükten sonra sunucu kodu/izole testleri onayladı. read-only incelemede eski setupComplete bilgisinin raporlama kurulumunu anlattığı görüldü; yeni ürün/katalog/app-review kanıtı sayılmadı. Eski SQL/migration veya bu alanın eski anlamı değiştirilmedi.

Yeni açık setup seçeneği, mevcut Shopify AppInstallation izin incelemesi ve Google/Meta asset probe sonuçlarının private özgünlüğünü doğrular. Üreticilere yalnız private kayıt eklendi; yeni HTTP/asset keşfi, katalog seçimi, OAuth isteği veya token işlemi eklenmedi. Klaviyo mevcut özgün candidate/account/Ordered Product metric/event okumasıyla aynı iş/fence/gün kapsamında kontrol edilir. Provider saklanan grant listesi yeni native grant gibi etiketlenmez.

Mağaza/kurulum/nesil, hesap/bağlantı/seçim, gerektiğinde manager/credential ref/grant listesi ve en fazla10dakika/nativeexpiry eşleşir. Kontrol validation, son SQL ve entitlement sınırlarında tekrarlanır. Kopya, yanlış hesap, eski/future kanıt veya eksik kapsam bekletir. Products, Orders ve history ayrıdır; Orders yokken temel ürün yolu ilerler. Order gözlemi verilmişse native AppInstallation eşleşir, history için ayrıca read_all_orders aranır.

reviewed_for_prewrite_only uygulama onayı veya gerçek kurulum tamamlanması değildir. developerAppApproval=not_observed, nativePermissionVerified=false ve writer/activation false kalır. Hiçbir başarı sonucu veya varsayılan app-review kanıtı üretilmez. Bu kayıtla kalan TEKNİK bağlantı kod/test aşamasına geldi; teslim10 kalanları iki gerçek ortam başlığıdır: izin/uygulama/kaynak kimliği ve claim kanıtı; ortak operasyon profili/kota/bellek/bağlantı/kapasite kabulü. Native kabul olmadan teslim10 bütünü kapanmaz.

404 ilgili test geçti; genel test/tip/derleme ve exact source Actions/F01 ayrıca doğrulanır. OAuth ekran/akış/kapsam/katalog seçimi, canlı sorgu, config/secret/migration/deploy, Sales Role veya Dataset yazımı değişmedi.15 başlamadı;22 duraklatılmış;23 writer.

Bağlayıcı kayıt: contracts/eo-05-start-brief-v1.json#Setup_scope_access_prewrite_binding_2026_10_30. Resmî kontrol30Ekim2026: Shopify AppInstallation, Google OAuth Scopes ve Klaviyo Authenticate API Requests okundu. Merge ayrı açık onay bekler.
