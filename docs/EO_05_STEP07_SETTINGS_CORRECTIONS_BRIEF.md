# EO-05 / mevcut 07 — onaylı Settings düzeltmesi

## Güncel ürün sahibi düzeltmesi — 31 Ekim 2026

Önceki tek hesapta adım atlama kararı reddedildi. Kullanıcı aşağıdaki somut
işleri açıkladıktan sonra "Tamam başlayalım Codex" diyerek kodlamayı onayladı.
Bu bölüm aşağıdaki eski tek hesap/spend yönlendirmesinin üzerindedir.

- Klaviyo: OAuth → ayrı `Select Klaviyo account` modalı → ayrı
  `Add estimated email spend` modalı. Tek hesap da açık seçim ve Continue ister.
- Hesap seçimi modalında maliyet alanı olmaz. Spend modalında hesap seçicisi
  olmaz; yalnız onaylanan hesap bilgisi ve maliyet alanı bulunur.
- Continue yalnız sunucudan gelen listede bulunan tam bir hesap seçilmişse
  kabul edilir. Seçim modalının native `afterhide` olayı gelmeden spend açılmaz.
  Escape/Cancel/çarpı ile kapatma sonraki modalı açmaz veya kayıt yapmaz.
- Spend iptali aynı geçerli seçimi korur; Resume spend'e dönebilir. Liste
  değişmişse geçersiz seçimle devam edilmez; hesap modalına dönülür.
- Boş/geçersiz tutar alan hatasıdır; `0` geçerlidir. Mevcut maliyet geçmişi,
  sunucu doğrulaması, belirsiz sonuçta Check status ve tek istek korunur.
- Google/Meta açıklama → OAuth → mevcut 1–3 reklam hesabı → gerektiğinde tek
  Reporting Account sırası korunur. Katalog seçimi veya otomatik seçimi yoktur.
- Google/Meta başlangıcı ve callback'i aynı sunucu yayın koşulunu kullanır.
  Shopify Products ve ayrı/isteğe bağlı Orders aynı doğrulanmış yayın koşullarını
  kullanır. UI tek başına izin veya yayın yetkisi vermez.
- Sabit dört `false` yerine sunucu yayın ayarları okunabilir hale getirilir;
  bu ayarların canlıda değiştirilmesi ayrı onay ister. Kapalı durumda uygulamanın
  kendi yayın engeli sağlayıcının izin reddi gibi gösterilmez.

Birebir seçim hatası: `Select one Klaviyo account to continue.`; Continue,
Cancel ve Save and connect korunur. Seçim hatası `s-choice-list.error`, maliyet
hatası `s-number-field.error`; ayrı `s-modal` ve native afterhide kullanılır.
Kaynaklar (31 Ekim 2026):
https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal ve
https://shopify.dev/docs/api/app-home/latest/web-components/forms/choice-list .
Yalnız native bileşenler; özel CSS/ham HTML kontrolü yok. Desktop ve en az320px
gerçek mobilde her iki modal, Cancel, Escape, seçim, hata ve başarı ayrıca ürün
sahibi tarafından kabul edilir; önceki ekran görüntüleri PASS değildir.

Yayın koşulları için eksik geliştirici/app onayı, kapsam yayını ve canlı izin
kanıtı ayrı kayıt edilir. Yerel kod, provider onayı veya canlı izin kanıtı
değildir. Bu onay config/provider mutation, Shopify görsel otomasyonu, deploy
ve merge içermez. 15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

### İncelenebilir yayın koşulları ve kalan gerçek ortam işleri

Sunucu ayarları yalnız birebir `true` değerini kabul eder; eksik/başka değer
kapalıdır. Tarayıcı formu bu ayarları değiştiremez. Bunlar izin/onay kanıtı
değil, ayrı açık yayın kararı sonrasında kullanılacak çalıştırma anahtarlarıdır.

| Platform | Kodda bağlanan ayar | Canlıya geçişte doğrulanacak |
|---|---|---|
| Google | `ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED` | Mevcut OAuth uygulamasının Ads+Merchant iki scope talebine hazır olması; geliştirici/test erişimi ve native kullanıcı onayı |
| Meta | `ADSTABLE_META_IDENTITY_OAUTH_ENABLED` | Mevcut uygulamanın sabit beş scope için dev/test veya dağıtım koşulları; native kullanıcı onayı |
| Shopify | `ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED` + `ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED` | Mevcut app sürümünde read_products/read_orders optional scope yayını; native okuma ve ayrı Products/Orders onayı |

31 Ekim salt okunur Vercel metadata listesinde bu dört anahtar için eşleşme
dönmedi; hiçbir değer çözülmedi veya değişmedi. Bu gözlem Google/Meta panel
onayı veya Shopify'daki yayımlanmış sürümün izinleri hakkında kanıt değildir.
Yerel `shopify.app.toml` optional_scopes içermiyor; native sürümün durumu ayrı
kontrol bekler. Shopify controller, yayın anahtarı açık olsa da native optional
handle'ı bulmadan izin isteyemez; Orders, Products tamamlanmadan istenemez.

Yeni runtime ayarları, Shopify app sürümü/izin yayını, geliştirici paneli değişikliği
ve yeni deploy bu kod onayıyla yapılmadı. Mevcut canlı sürüm hâlâ önceki1e84b00
adayıdır; düzeltilmiş kaynak ayrıca yayınlanmadan ekran testi istenmez.

31 Ekim 2026. Ürün sahibi salt okunur inceleme sonrasında somut kodlama kapsamını
onayladı. #264'ün onaylı, katalog seçimi kaldırılmış arayüz değişiklikleri güncel
main üzerine uyumlandırılır. Yeni paket veya madde numarası oluşturulmaz.

## Amaç ve değişmeyenler

Klaviyo maliyet hatasını ilgili alanda göstermek, sağlayıcıların yüklenme
göstergelerini ayırmak ve Resume setup'ı eksik adıma götürmek. İzin setleri,
sunucu kapıları, token/callback, maliyet formülü ve geçmiş harcama kayıtları
değişmez. Merchant/işletme/katalog seçimi, otomatik katalog seçimi veya bunun
yerine başka bir kullanıcı adımı eklenmez. Provider çağrısı, config, migration,
deploy ve Shopify görsel otomasyonu kapsam dışıdır. Merge ayrıca onay bekler.

## Durum ve birebir metin

| Durum | Metin | Davranış |
|---|---|---|
| Bağlı değil | Not connected | Mevcut açıklama, yalnız açık Connect ile istek |
| Hesap gerçekten seçilmemiş | Account selection required | Resume setup hesap adımını açar |
| Doğrulanmış tek hesap veya geçerli seçim, maliyet eksik | Estimated spend required | Resume setup maliyet adımını açar; OAuth başlatmaz |
| Maliyet eksik | Add the estimated 30-day email spend to finish setup. Enter 0 if there is no cost. | Mevcut hesap ve maliyet adımı korunur |
| Maliyet boş/geçersiz | Enter an amount from 0 to 99,999,999.99 with up to two decimal places. | Alan hatası; modal açık ve girilen değer korunur; sıfır geçerli |
| Kaydetme sürüyor | Save and connect | Yerleşik loading göstergesi; aynı kaydetme ikinci kez başlamaz; diğer sağlayıcılar Working olmaz |
| Başarı | Mevcut Connected / güncel tutar görünümü | Sunucu başarısından sonra modal kapanır |
| Sunucu sonucu doğrulanamadı | The save could not be confirmed. Check the connection status before continuing. | Modalda açıklama; otomatik tekrar yok |
| Cancel / kapatma | Cancel | Yeni kayıt veya izin isteği yok |

Mevcut Google/Meta/Shopify açıklamalarının birebir metinleri
`EO_05_PERMISSION_EXPLANATION_DESIGN_BRIEF.md` içindedir. Katalog seçimiyle ilgili
eski tasarım notları son kullanıcı kararıyla geçersizdir; bağımsız katalog
okuyucuları ve ileriki doğrulama işleri korunur.

## Bileşenler ve resmî kaynaklar

Kontrol tarihi: 2026-10-31.

| Öğe | Bileşen / özellik | Resmî kaynak |
|---|---|---|
| Maliyet alanı | s-number-field: error, required, min=0, max=99999999.99, step=0.01 | https://shopify.dev/docs/api/app-home/latest/web-components/forms/number-field |
| Modal | s-modal: heading, primary-action ve secondary-actions slotları; showOverlay/hideOverlay | https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal |
| Kaydet / Cancel | s-button: loading, disabled, variant=primary; commandFor ve --hide | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button |
| Durum | s-badge / s-paragraph; mevcut Shopify görünümü | https://shopify.dev/docs/api/app-home/latest/web-components |

Form sonucu bağımsız `useFetcher` üzerinden işlenir; güncel React Router v7
belgesi: https://api.reactrouter.com/v7/functions/react-router.useFetcher.html . Dependency sürümü değişmez.
Özel CSS, ham HTML kontrolü ve özel modal yoktur.

## Kabul

İzole testlerde boş/negatif/geçersiz/sıfır/geçerli tutar; sunucu hatası;
çift kaydetmenin engellenmesi; diğer sağlayıcıların Working olmaması;
tek/çok/değişmiş hesapta Resume; kapalı kapılar ve katalog seçiminin yokluğu
doğrulanır. Masaüstü ve en az 320 px gerçek mobilde hata metni, dokunma,
klavye, odak geri dönüşü, iptal ve başarı ürün sahibi tarafından sınanır.
Otomatik testler native görsel kabul yerine geçmez. Bu kabul ve açık merge
onayı gelmeden UI Done/PASS değildir. 15 başlamadı; 22 duraklatılmış; 23 Dataset yazımıdır.

## 31 Ekim — mevcut 07 Shopify optional izin adayı (henüz yayımlanmadı)

Ürün sahibinin kodda hazırlama isteğiyle shopify.app.toml dosyasına yalnız
optional_scopes = ["read_products", "read_orders"] eklendi; required scopes boş
kaldı. Products ürün kurulumu için gereklidir; Orders ayrı ve isteğe bağlıdır.
Önceki “yerel TOML optional içermiyor” tespiti bu aday öncesine aittir.
Bu kayıt Shopify'da yayımlanmış izin veya mağaza onayı kanıtı değildir.

Mevcut uygulama kimliği, adresleri, webhooks ve runtime yayın anahtarları
korundu. Shopify panelinde işlem/giriş denemesi, CLI app dev/deploy veya
workflow dispatch yapılmadı. Paneldeki işlemi ürün sahibi yapacak; native
sürüm yayını ve izin doğrulaması bekleniyor. Yeni uygulama oluşturulmaz.

31 Ekim resmî kontrol: https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration#access_scopes
ve https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes .
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_optional_scope_candidate_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı. Merge ayrı onay bekler.

## 31 Ekim — mevcut 07: Shopify 401 yanıtının derleme uyumluluğu

Ürün sahibi 1000070104 ekranındaki 401 için önce salt okunur incelemeyi,
ardından yalnız kod düzeltmesi ve derlenmiş sürüm testini onayladı.
Shopify SDK 3.0.1 boundary.error sınıf adına bakıyor; Vite üretim derlemesi
Router hata sınıfını kısaltıyor. Gerçek Router nesnesi ve SDK işleyicisiyle
minify edilmiş test düzeltme öncesi başarısız, sonrası başarılı oldu.

Düzeltme yalnız vite.config.ts içinde esbuild.keepNames=true ayarıdır.
SDK işleyicisi değiştirilmez; 401, yönlendirme başlığı ve diğer hataların
aynı biçimde iletilmesi korunur. Minification açık kalır; sınıf/fonksiyon
adları korunacağı için paket boyutunda artış olabilir. Yeni arayüz veya
metin yok; scope/token/izin/hesap seçimi ve runtime yayın anahtarları değişmez.

İlgili 48 test geçti. Tam test/tip/derleme ve exact-commit CI ayrı doğrulanır.
Canlı denemenin yanıt başlıkları loglarda yok; tekrar üretilen bu kusur,
canlı 401'in tüm nedenlerinin kesinleştiği anlamına gelmez.

Güncel native durumun önceki aday kaydından farkı: ürün sahibi optional
read_products/read_orders sürümünü kendisi yayımladı (1000070103). İki
Shopify runtime anahtarının ayrıca onaylı açılması ve mevcut e086df0 kaynağının
dpl_9oDokZ3QuHkxVaeh133MH77GXKrX yayını PR277'de kayıtlıdır. Mağaza onayı
hâlâ doğrulanmadı. Bu yeni düzeltme için deploy, native tekrar veya merge
onayı verilmedi; Shopify'da görsel işlem yapılmaz.

Resmî kontrol 2026-10-31:
https://v7.vite.dev/config/shared-options#esbuild
https://esbuild.github.io/api/#keep-names
https://api.reactrouter.com/v7/functions/react-router.isRouteErrorResponse.html
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_boundary_build_correction_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — mevcut 07: Settings .data yönlendirme başlığı

1000070105 ekranı sonrası salt okunur inceleme ve ardından yalnız kod/test
onayı alındı. Gerçek Settings action'ı gerçek Router production request handler
ile POST /settings.data üzerinden çalıştırıldığında 401'in SDK yönlendirme
başlığı kayboluyordu: Single Fetch hata başlıklarını leaf Settings rotasında
birleştiriyor; bu rotada headers export yoktu. Parent layout export'u yetmiyor.

Settings artık yalnız mevcut Shopify boundary.headers işlevini dışarı verir.
Gerçek HTTP yanıtında Products ve Orders yönlendirme başlığı korunur.
Normal 401/403'e yönlendirme eklenmez, başarı verisi tekrar isteğe çevrilmez.
İzin talebi ve authentication sentetik bağımlılıktır; ağ veya native izin
çağrısı yapılmaz. Önceki helper/derleme testi bu leaf aktarımı kapsamıyordu.

Yeni UI, akış, scope, token, hesap seçimi veya runtime flag değişikliği yok.
Bu düzeltme yayın, native tekrar veya merge onayı içermez; gerçek izin kabulü
bekler. Önceki derleme düzeltmesi ayrı onayla yayımlanmış tarihsel kayıttır.
Resmî kontrol31Ekim2026:
https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin#headers
https://reactrouter.com/how-to/headers
Kurulu React Router7.18.2 Single Fetch kodu ayrıca okundu.
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_settings_data_headers_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — mevcut 07: Products kullanıcı akışının tamamlanması (kod/test onaylı)

Amaç: Connect Products → mevcut Shopify izin ekranı → Settings'e otomatik dönüş
→ sunucunun güncel izin okuması → kartta açık sonuç. Yayın/native deneme/merge
bu onayın dışındadır. Products rolü raporlama veya Dataset aktivasyonu değildir.

Dönüş: yalnız Products Connect sırasında, native istekten önce, aynı sekmenin
sessionStorage alanına sürümlü/mağazaya bağlı, 10 dakika geçerli dönüş niyeti
kaydedilir. Kimlik/token/izin kanıtı değildir; yalnız /settings gezinmesi içindir.
Authenticated layout ana sayfaya dönüşte aynı mağazanın niyetini bir kez tüketir.
Saklama başarısızsa izin isteği başlamaz. Yeni callback veya scope parametresi yok.

Settings loader aynı doğrulanmış mağazada mevcut afterReturn üzerinden bir kez
salt okunur izin okur; otomatik izin isteği, retry, timer veya poll yoktur.
Güncel izin okuması her Settings girişinde kartı üretir; local niyet başarı sayılmaz.
Aynı sayfada zaten granted sonucu veya açık Check status da kartı günceller.

| Durum | Birebir metin | Davranış |
|---|---|---|
| Doğrulandı | Ürün erişimi onaylandı | s-badge tone=success; Connect Products yok |
| Eksik/izin verilmemiş | Ürün erişimi henüz onaylanmadı. | s-paragraph; mevcut Connect açıklaması |
| Doğrulanamadı | Ürün erişimi doğrulanamadı. Durumu tekrar kontrol edin. | s-banner tone=critical; açık Durumu kontrol et; Connect yok |
| Okuma/başlatma sürüyor | Ürün erişimi doğrulanıyor… | s-banner tone=info; mükerrer eylem engeli |
| Dönüş yönlendirmesi | Settings'e dönülüyor… | s-page heading=Settings ve s-banner tone=info |
| Dönüş hatası | Settings'e otomatik dönülemedi. | s-banner tone=critical; s-link Settings'i aç; otomatik tekrar yok |
| Yayın kapalı | Ürün bağlantısı şu anda kullanılamıyor. | s-paragraph; mevcut açıklama/kapalı yayın koşulu |
| Açıklama iptali | mevcut Cancel/çarpı/Escape | dönüş niyeti veya istek oluşturmaz |
| Native iptal | güncel sunucu okumasına göre eksik veya doğrulanamadı | Cancel'ın grant verdiği varsayılmaz; otomatik tekrar yok |

Products için generic awaiting activation banner ve ikinci Check status gösterimi
kaldırılır; sonuç kendi Shopify kartındadır. Orders, Google, Meta, Klaviyo native
akışları, hesap seçimi, scope, token, SDK yöntemi ve server grant guard'ları korunur.
Gerçek masaüstü ve en az320px mobilde grant/iptal/dönüş/yenileme/readonly hata
kabulü ayrıca ürün sahibinde bekler; otomatik test native kabul değildir.

Native s-page/s-section/s-stack/s-badge/s-banner/s-button kullanılır; özel stil yok.
Resmî kontrol31Ekim2026: mevcut scope/Polaris kaynakları ve
https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge
https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner
https://api.reactrouter.com/v7/functions/react-router.useNavigate.html
https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.

## 31 Ekim — mevcut 07: Products erişimini kaldırma (kod/test onaylı)

Kullanıcı, onaylı Products kartında erişimi kendisi kaldırabilmelidir. Açık onay
bu somut kaldırma akışının kod/test/PR işidir; canlı revoke/yayın/merge değildir.
Başarılı kartta “Ürün erişimini kaldır” bulunur. s-button tone=critical,
commandFor=shopify-products-revoke-modal ile s-modal size=base padding=base açar.
Başlık: “Ürün erişimi kaldırılsın mı?”
Metin: “AdsTable'ın Shopify ürün ve varyantlarını okuma izni kaldırılacak. Ürün kimliği eşleştirmesi için yeniden izin vermeniz gerekecek. Mevcut kayıtlar silinmez.”
Birincil: “Erişimi kaldır” (s-button variant=primary tone=critical).
İkincil: “Vazgeç” (variant=secondary). Çarpı/Escape/Vazgeç: sıfır istek.
Onay niyeti kaydedilip modal afterhide tamamlanınca yalnız bir sunucu POST'u.
Yükleniyor: “Ürün erişimi kaldırılıyor…” (s-banner info); çifte işlem engellenir.
Sunucu sabit read_products için authenticated SDK scopes.revoke kullanır;
mağaza/kurulum/optional/required kapsam ve güncel izin kontrolü önce yapılır.
write_products veya required kapsamdan gelen erişim varsa kaldırılmış sayılmaz.
Başarılı native yanıt sonrası izin yeniden okunur; read_products erişiminin
kalktığı ve aynı kurulum doğrulanmadan başarı gösterilmez. SDK/okuma hatasında
otomatik tekrar veya alternatif yöntem yok; kart unknown olur ve yalnız açık
“Durumu kontrol et” okunur. Bu kontrol kaldırmayı tekrarlamaz. Hata metni:
“Ürün erişiminin kaldırıldığı doğrulanamadı. Durumu kontrol edin.”
Başarı: “Ürün erişimi kaldırıldı.” (s-banner success), ardından mevcut Connect
Shopify products görünür. Yeni izin sadece kullanıcı açıklamayı onaylarsa istenir.
Yenilemede sunucudan güncel permission state okunur; yerel başarı korunmaz.
Orders izni, provider bağlantıları, token, uygulama kurulumu ve tarihsel veri
silinmez/değiştirilmez. Mevcut ürün okuma guard'ları güncel kapsamı esas alır;
Orders'ın Products'a mevcut bağımlılığı korunur. Yeni Dataset/yazıcı yok.
Mobil/masaüstü aynı native bileşenlerdir; özel CSS/raw kontrol yok.
Boş/eksik izinde kaldırma eylemi yok; ağ hatası/malformed sonuç/yanlış mağaza,
stale callback/iptal/çift afterhide ve required/write alias negatif testleri gerekir.
Gerçek Shopify Admin masaüstü/en az320px mobil kabulü ve yayın ayrı onay bekler.
31Ekim2026 resmî kaynakları:
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
Kurulu SDK3.0.1 scopes.revoke ve GraphQL client kodu okundu: varsayılan retry0.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.

## 31 Ekim — Products İngilizce metin ve sessiz Settings dönüşü düzeltmesi

Ürün sahibi gerçek cihazda Vazgeç, kaldırma ve yeniden bağlanma sonucunu bildirdi:
Settings'e dönüldü, ürün erişimi ve kaldırma eylemi yeniden göründü. Bu somut
akış kanıtıdır; bütün masaüstü/mobil kabul matrisi tamamlandı anlamına gelmez.
Sahip geçiş mesajını tekrar görmek istemiyor ve eklenen Türkçe ürün metinlerini
reddetti. Kapsam yalnız yeni Products metinleri ve gereksiz çift durum gösterimidir.
Settings dönüşündeki bilgi banner'ı kaldırılır; mevcut native Settings kabuğu
geçiş boyunca kalır. Yeni yükleme/caption/toast metni eklenmez. Hata durumunda
“Could not return to Settings.” ve “Open Settings” korunur.
Birebir İngilizce Products metinleri:
- Product access approved / Remove product access
- Remove product access? / Remove access / Cancel
- AdsTable's permission to read Shopify products and variants will be removed. You will need to grant access again for product identity matching. Existing records will not be deleted.
- Removing product access… / Checking product access…
- Product access removed. (yalnız bir başarı banner'ı; üstte ikinci not-connected metni yok)
- Product access is not connected. (son kaldırma başarı banner'ı yoksa)
- Could not verify product access. Check status to continue.
- Could not verify that product access was removed. Check status to continue.
- Product connection is currently unavailable. / Check status
Mevcut Connect Shopify products etiketi korunur. Var olan s-page/s-banner/
s-badge/s-button/s-modal/s-link bileşenleri kullanılır; yeni stil veya property yok.
31Ekim kontrol edilmiş aynı resmî badge/banner/modal/button kaynakları geçerlidir.
OAuth/grant/revoke/return intent, sahiplik, callback, izin, scope, provider ve DB
kodları değişmez. Kod/test/PR hazırlanır; yayın/merge ayrıca açık onay ister.
Gerçek ekranda sessiz dönüş ve İngilizce metin kabulü henüz bekler.

## 31 Ekim — mevcut07: Orders dönüş/durum/kaldırma kullanıcı akışı

Ürün sahibi1000070135/136 görüntülerinde Orders onayından sonra Funnel'a dönüş
ve statik Connect Shopify orders düğmesini bildirdi; kod/test/PR düzeltmesini
somut olarak onayladı. Yayın, native tekrar ve merge bu onayın dışındadır.
Aynı sabit /settings dönüşü, aynı mağaza/sekme/10dk/tek kullanım güvenliği
Orders için bağımsız anahtarla genişletilir. Geçiş mesajı/banner/toast yoktur.
Settings bir native kapsam okumasıyla Products ve Orders durumlarını ayrı üretir.
Orders raw izin durumu uygulamanın Products önkoşulundan ayrıdır: Orders grant'ı
raporlama/Overlap/Orders veri erişimi aktivasyonu değildir. Mevcut okuyucu guard'ları
ve Products önkoşulu değişmez. İlk bağlama Products onaylı değilse başlatılamaz;
mevcut Orders izni Products kaldırılmış olsa da görünür/kaldırılabilir kalır.

Birebir durum/eylem metinleri (tamamı İngilizce):
- Order access approved / Remove order access
- Order access is not connected. / Connect Shopify orders
- Product access is required to connect orders.
- Checking order access… / Removing order access…
- Could not verify order access. Check status to continue. / Check status
- Could not verify that order access was removed. Check status to continue.
- Order connection is currently unavailable.
- Order access removed. (tek sonuç; aynı anda not-connected metni yok)
Modal: Remove order access?; body: AdsTable's permission to read Shopify orders and purchased products will be removed. Order-based features will need access again. Product access and existing records will be kept.
Primary: Remove access; secondary: Cancel. Native s-modal base/base, s-paragraph,
s-button primary/critical ve secondary, s-banner info/success/critical, s-badge
success; mevcut native s-stack içinde Products'tan ayrı Order bölümü/akışı.
Cancel/Escape/çarpı sıfır istek. Confirm niyeti aynı mağaza için afterhide sonrası
bir kez tüketilir. İki modal aynı anda açılmaz; bekleyen grant/revoke sırasında
yeni eylem başlatılmaz. Belirsiz sonuçta otomatik retry yok; Check status yalnız okur.
Başarı için authenticated sabit read_orders optional/not-required/no-write alias
önkoşulları, bir native revoke, fresh aynı mağaza/AppInstallation/kurulum okuması
ve diğer tüm grant'ların aynen korunması gerekir. Products/native providerlar,
credentials, config ve geçmiş veri silinmez. Yeni DB/Dataset/Overlap yazımı yok.
Bağlı durum Connect'i kaldırır; kaldırılmış durumda yeniden Connect gösterilir.
Yerel dönüş kaydı/grant bildirimi native izin kanıtı değildir. Stale/yanlış mağaza
sonuçları, malformed/transport hataları ve native iptal başarıya çevrilemez.

31Ekim2026 kaynakları: Shopify scopes query/request/revoke ve kuruluSDK3.0.1,
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/appRevokeAccessScopes
Önceden31Ekim doğrulanmış native modal/button/badge/banner kaynakları aynıdır.
Kabul: sentetik SDK ile gerçek Settings loader/action/hook/modal olayları test;
Products regresyonları; typecheck/build/CI. Sonrasında ayrı yayın onayı ve gerçek
Shopify Admin masaüstü/en az320px mobil owner grant/cancel/revoke/reconnect kabulü.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — Products/Orders dönüşünde ana sayfa parlaması

Owner her iki yeniden bağlanmada da önce ana ekrana gitmeye çalışıp Settings'e
döndüğünü bildirdi. Mevcut effect yönlendirmeyi doğruluyor ancak SSR/ilk client
çiziminde Outlet/Funnel henüz engellenmiyordu. Bu, onaylı sessiz Settings dönüşünün
eksik kalan görüntü düzeltmesidir; native OAuth hedefi/değişken/scope/SDK değişmez.
Ana uygulama yolu için owner/location-key bağlı dönüş kararı verilmeden Outlet
çizilmez; root SSR ve ilk hydration aynı boş içerikle başlar. Niyet varsa /settings
replace sürerken de Outlet/Funnel çizilmez. Niyet yoksa normal ana sayfa açılır.
/settings ve /ad-analysis doğrudan içerik gösterir. Yeni mesaj/toast/başlık/stil yok.
Dönüş hata metni ve Open Settings mevcut native bileşenleriyle korunur. Effect
tekrarında yönlendirme bir kez yapılır; eski navigation hatası yeni rotayı etkilemez.
Bedel: normal ana sayfanın ilk içeriği client dönüş kontrolünden sonra gösterilir;
SSR'de ana sayfa içeriği geçici olarak tutulur. Storage yok/yanlış/eski niyette
normal ana sayfa açılır; izin verilmiş varsayılmaz. Products/Orders niyet ve native
izin okuma/kaldırma davranışı korunur. İzin veya yeni provider mutation yapılmaz.
Kod/test/PR kapsamında hazırlanır; yayın ayrıca açık onay bekler.
31Ekim resmî kaynak: https://react.dev/reference/react/useEffect (effect sonrası
paint ve effect'in SSR'de çalışmaması); kurulu React18.3.1 ve Router7.18.2 korunur.
Gerçek SSR testinde root Outlet/Funnel yokluğu, ilk effect öncesi client çizimi,
normal ana sayfa ve iki izin dönüşü, mesaj yokluğu ve hata/no-retry doğrulanır.
Native masaüstü/en az320px mobil parlamasız geçiş kabulü bekler;07 kapanışı yok.

## 31 Ekim — mevcut07: Shopify App Bridge izin penceresi; dönüş yamalarının kaldırılması

Ürün sahibi kök neden araştırmasındaki doğru öneriyi kabul edip uygulamayı açıkça
onayladı. Kapsam Products/Orders izin isteme yöntemini resmî client App Bridge'e
almak, sunucu kontrolünü korumak ve sonradan eklenmiş root/Settings dönüş ve
gizleme kodlarını kaldırmaktır. Yayın/native izin denemesi/merge onayı değildir.
31Ekim resmî belge iki yöntemi ayırır: React Router scopes.request tam sayfa
Shopify Admin'e yönlendirir; shopify.scopes.request çalışan uygulamanın üzerinde
izin penceresi açar, sayfayı yönlendirmez. KuruluSDK3.0.1 de incelendi: sunucu
request helper client_id/scope/optional_scopes ile install sayfasına gider;
Settings hedefi taşımaz. Çalışan üç provider callback'i Settings'i açıkça hedefler.

Akış: mevcut açıklama modalında Connect → native afterhide → authenticated sabit
Products/Orders ön kontrolü (release, mağaza/aktif kurulum, taze mevcut grant,
Products önkoşulu ve deploy edilmiş optional handle) → zaten granted ise kart;
eksikse scope_request hazırlığı → yalnız aynı mağza/istek için App Bridge
shopify.scopes.request([read_products veya read_orders]) bir kez → granted-all veya
declined-all sonucunda aynı mağza/kurulum/AppInstallation için bir sunucu readback →
kart. App Bridge sonucu hiçbir zaman tek başına grant veya veri yetkisi değildir.
Ön kontrol kimliği korunur; browser farklı scope, provider veya arbitrary hedef
seçemez. App Bridge yok/reject/bozuk sonuç/owner değişimi: unknown, otomatik
tekrar veya sunucu redirect fallback yok. Açık Check status yalnız güncel izni okur.
Cancel açıklaması sıfır istek; Shopify decline mevcut sayfada eksik durumu gösterir.
Mükerrer afterhide/click bir native pencere açar. İstek sürerken view kapanır veya
owner değişirse eski sonuç kartı değiştiremez ve yeni native istek başlatamaz.

UI birebir mevcut İngilizce copy/component/critical removal davranışıdır. Yeni
banner/toast/dönüş ekranı yok. Standart authenticated AppProvider/Outlet her rota
ve SSR'de geri gelir. SessionStorage dönüş modülü ve ilgili deklarasyonu, owner/key
root gating, /settings replace ve gizleme kodları kaldırılır; başka amaç için
sessionStorage veya yeni cookie/return parametresi eklenmez. Server requestProducts/
requestOrders redirect yöntemleri kaldırılıp prepareProducts/prepareOrders olur.
Mevcut permission query/revoke ve public Products/Orders kartları korunur. Meta,
Google/Klaviyo, native config/scopes, credentials, DB/Dataset değişmez.

Test: gerçek Settings action JSON hazırlığı/401'e redirect icat etmeme; ön kontrol
negatifleri ve tek scope; App Bridge granted/declined/reject/unavailable/bozuk/owner/
unmount/duplicate sonrası native+readback sayıları; server readback eski kurulum/
AppInstallation ve foreign binding reddi; Products/Orders revoke regresyonları;
root SSR'nin tekrar gerçek Outlet üretmesi; normal sayfalara dönüş yaması olmaması.
Masaüstü ve en az320px native owner modal/iptal/başarı/kaldırma/reconnect kabulü
ayrı yayın onayından sonra bekler. Kod testleri bu kabul yerine geçmez.
Kaynaklar31Ekim2026:
https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes#request-new-access-scopes-dynamically
https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api
Mevcut native modal/button/badge/banner kaynakları ve pinli Polaris2.0 değişmez.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.
## 31 Ekim — mevcut07: açık Connect ile yeniden bağlanma ve sağlayıcıya ait sonuç

Ürün sahibi salt okunur teşhisten sonra kod, migration dosyası ve izole test hazırlığını açıkça onayladı. Canlı migration, yayın, provider-native deneme ve merge bu onaya dahil değildir. Canlıdaki tek kayıt kontrolünde aktif adstable-development mağazasının Google kaydı disconnected/version42 bulundu. Başlangıç kapısı ve atomik dönüş fonksiyonu disconnected durumunu reddediyordu. Asıl hata route catch içinde kayıtsız unknown'a çevriliyor; ortak feedback host'u Shopify bölümünün hemen altında bulunuyordu.

Kullanıcı sonucu: mevcut açıklama Connect → afterhide → aynı bağlantı/sürümle yeni OAuth → tam native izin/hesap kanıtı → mevcut ayrı hesap ve Reporting Account adımı. Yeniden bağlanma eski reklam hesabını, kataloğu veya credential'ı kendiliğinden seçmez. Disconnected kayıtta credential yok ve kaldırılma zamanı mevcut olmalıdır; disconnect_pending/unknown kapalıdır. Yeni onaydan önce yeni grant veya Connected yoktur. Callback ve atomik commit aynı connection/version'u doğrular; stale/yarış/replay ve kısmi izin engelleri korunur. Mevcut stage_provider_account_selection disconnected kaydı yeni hesap seçimine alabilir; SQL adayındaki engel bu güvenli yola hizalanır. Bağlı kayıt için scope/hesap downgrade koruması aynıdır; kaldırılmış grant listesi yeni onay için yetki değildir.

UI: mevcut s-banner (critical/info/warning heading) ve s-button kullanılır. Her sağlayıcının sonucu ve Check status kendi s-section/s-stack içinde gösterilir. Shopify Products/Orders kartlarının bağımsız onayları ve kaldırma davranışı değişmez. Kopya korunur: "We could not confirm the result. Check the connection status before starting again." ve "Check status". Otomatik retry/reconnect yok; belirsiz işlemden sonra yalnız açık durum okuması kalır. Modal host'ları tek kalır; afterhide sırası ve 1–3 reklam hesabı/tek Reporting Account korunur. Ham action control, CSS/renk, yeni rota veya katalog seçimi yoktur.

Güvenli log: yalnız sabit olay/feature/intent, allowlist hata kodu ve doğrulanmış requestId. Raw error/message, SQL detail, scope URL/state, token/credential, hesap/mağaza veya payload loglanmaz. Client'a aynı unknown cevabı döner. Native Response kimlik doğrulama sınırında aynen korunur.

Test: disconnected başlangıç+callback+CAS; boş/bozuk cleanup kanıtı/pending/foreign owner/version reddi; atomik SQL başarı/stale/replay/eksik kapsam/rollback; gerçek Settings provider kartında feedback ve tekrar başlatmama; native Response ve güvenli hata logu. Native desktop/min320px kabulü ileride owner'dadır; izole testler native kabul değildir. SQL yalnız dosyada hazırlanır, canlıya uygulanmaz.

Migration önkoşulu: 20261028164208 atomik yazar ve dört receipt alanı mevcut olmalı; yoksa yeni migration fonksiyonu değiştirmeden durur. Lineage bu önceki dosyayı hâlâ pending gösterdiğinden canlı önkoşul mevcut sayılmaz. İleride ayrı onayla doğrulanıp gerekirse yalnız gerekli önkoşul dosyası değerlendirilir; bütün pending migration'lar topluca uygulanmaz.

31Ekim resmî kaynaklar: https://www.postgresql.org/docs/17/sql-createfunction.html ; https://supabase.com/docs/guides/database/functions ; https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner ; https://api.reactrouter.com/v7/functions/react-router.useFetcher.html . Pinli Polaris2.0 bileşenleri/type değişmez.07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.
