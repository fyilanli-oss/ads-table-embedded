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
