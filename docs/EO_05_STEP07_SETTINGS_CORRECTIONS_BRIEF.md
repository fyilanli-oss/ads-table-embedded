# EO-05 / mevcut 07 — onaylı Settings düzeltmesi

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
