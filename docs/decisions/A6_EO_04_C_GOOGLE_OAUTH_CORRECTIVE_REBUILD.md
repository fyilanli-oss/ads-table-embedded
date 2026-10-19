# A6-EO-04-C — Google Ads OAuth düzeltici yeniden kuruluşu

**O tarihteki durum:** Uygulama sözleşmesi

**Kontrol tarihi:** 2026-10-11

Bu belge 11 Ekim 2026 tarihsel kararını ve kabul kapılarını anlatır. Bugünkü proje durumu Execution Plan'dadır. Prosedürdeki eylemler yeni canlı işlem izni değildir.

## Tarihsel resmî kaynaklar

- OAuth genel bakış: https://developers.google.com/google-ads/api/docs/oauth/overview
- OAuth 2.0 web sunucusu akışı: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Ads erişim modeli: https://developers.google.com/google-ads/api/docs/oauth/access-model
- API çağrı yapısı: https://developers.google.com/google-ads/api/docs/concepts/call-structure
- Shopify kimlik doğrulama/yetkilendirme: https://shopify.dev/docs/apps/build/authentication-authorization
- Shopify App Home: https://shopify.dev/docs/api/app-home/latest
- Shopify Polaris 2 geçişi: https://shopify.dev/docs/apps/build/app-home/polaris2

## Düzeltme kararı

Tarayıcı adresi ve Settings arayüzü Google kurulum başvurusuna veya yetkilendirme devir kimliğine bağlı OLAMAZ. Bağlı hesap kümesi ile tek Reporting Account ayrı yetkilerdir.

Aktif Shopify kurulum nesli için tek yetkili Google Ads bağlantısı vardır. OAuth state, sonucu yalnız bu kuruluma döndürmek için kullanılan kısa ömürlü sunucu işlemidir. Dönüşten sonra sürdürülebilir durum yetkili sağlayıcı bağlantısından okunur.

Önceden çalışan ürün akışı yalnız davranış referansıdır:

1. Kullanıcı **Connect Google Ads** seçer.
2. Google OAuth Shopify'ın desteklediği gezinmeyle açılır.
3. Dönüş şifreli erişim bilgisini yetkili bağlantıda `pending_account_selection` durumuyla saklar.
4. Settings bu durumu okuyup reklamveren seçicisini açar.
5. Kullanıcı 1–3 uygun reklamveren hesabı seçer. Bunlar bağlı kümedir; tam olarak biri Reporting Account olmalıdır.
6. Tek hesapta **Save and connect**, onu otomatik Reporting Account yapar; bağlantı `connected` olur.
7. İki/üç hesapta **Save and connect** doğrulanmış kümeyi saklar; bağlantı bekler. Reporting Account penceresi otomatik açılır, yalnız seçili kümeyi gösterir ve tam olarak bir açık seçim ister. **Save and finish** ilk bağı oluşturur, bağlantı `connected` olur.
8. Dönüşte eksik hesap adımı otomatik açılır. İki pencereden birini kapatmak bekleyen erişim bilgisini ve hazırlanmış seçimi korur. **Resume setup**, küme hazırlanmadıysa hesap penceresini; çoklu küme hazırsa Reporting Account penceresini açar. OAuth'u yeniden başlatamaz.
9. Bağlı kullanıcı tek Reporting Account'u bağlı kümeden OAuth olmadan değiştirebilir. Sağlayıcı erişimi yeniden doğrulanır; başarısızlıkta önceki bağ korunur.
10. **Disconnect** önce şifreli yenileme token'ıyla Google OAuth iznini iptal eder. Yalnız `revoked` veya `already_invalid`, raporlama yetkisi, hesap bağları ve erişim bilgisini kaldırmaya izin verir. Sağlayıcı/ağ hatasında bağlı durum korunur; güvenle durulur.
11. Yeniden bağlanma `disconnected` durumundan yeni OAuth işlemi başlatır.

Yönetici hesapları yalnız dolaşım/giriş bağlamıdır; Reporting Account veya reklamveren seçeneği olamaz.

Yalnız `connected` raporlama yetkisi verir; diğer durumlar güvenle reddedilir. İngilizce eylem adları kabul edilmiş ekran metinleridir; bu belgede ürün çevirisi yapılmaz.

## Durum ve eylem matrisi

| Yetkili durum | Kullanıcının gördüğü | İzinli eylem | Yasak davranış |
|---|---|---|---|
| Bağlantı yok / `disconnected` | Google Ads, Not connected | Connect Google Ads | OAuth olmadan hesap yükleme |
| OAuth sürüyor | Google'a yönleniyor | Google'da iptal / geri dön | Raporlama yetkisi oluşturma |
| `pending_account_selection`, küme hazır değil | Hesap seçici otomatik; kapatınca Resume setup | Save and connect, kapat, Resume setup | OAuth'u yeniden başlatma veya Cancel/Resume ile bekleyen erişim bilgisini silme |
| `pending_account_selection`, 2–3 hesap hazır | Reporting Account seçici otomatik; kapatınca Resume setup | Tam olarak bir seçim, Save and finish, kapat, Resume setup | İlk hesabı kendiliğinden seçme veya açık seçimden önce raporlama yetkisi |
| `connected` | Bağlı reklamverenler ve tek Reporting Account | Change Reporting Account, Disconnect | Bütün bağlı hesapları raporlama veya tercih değişiminde OAuth başlatma |
| `reauthorization_required` | Reauthorization required | Reconnect | Geçersiz erişim bilgisini kullanma |
| Kesme onayı | Shopify penceresi | Confirm disconnect, Cancel | Adrese bağlı kurulum doğrulaması |
| Onay sonrası `disconnected` | Not connected | Connect Google Ads | Erişim bilgisi veya aktif bağ tutma |
| Sağlayıcı/çalışma zamanı hatası | Sabit hata banner'ı ve kodu | Başarısız sınırlı adımın tekrar eylemi | Sessiz döngü veya sahte başarı |

Son satırdaki tarihsel kullanıcı eylemi, otomatik sağlayıcı tekrarı izni değildir; güncel ilk hata durma ve açık onay kapısı geçerlidir.

## Shopify arayüz eşlemesi

Settings, Polaris 2.0 RC üzerinde kalır: `polaris-2.0-rc.js`, tipler `2.0.0-rc.2`.

| İhtiyaç | Tam Shopify bileşeni |
|---|---|
| Sayfa/bölüm | `s-page`, `s-section`, `s-stack` |
| Durum | `s-badge` |
| Hata ve gerekli eylem | `s-banner` |
| Bağlan/kaydet/kes/tekrar | `s-button` |
| Hesap seçimi | Özellik doğrulamasından sonra `s-modal`, `s-choice-list` / `s-choice` |
| Sağlayıcıya gezinme | Shopify App Bridge Navigation API |

Ham HTML form kontrolü, özel buton/kart/modal taklidi, satır içi CSS, doğrudan renk, gölge, kenarlık veya köşe biçimi yasaktır.

## Kabul kapıları

- `google_setup`, devir kimliği veya eşdeğer tarayıcı sorgu parametresi yoktur.
- Dönüş, tarayıcının verdiği çalışma alanına bağlanamaz; sunucu işlemini tüketir.
- Geçerli bekleyen erişim bilgisi Settings yenilemesinde korunur; hesap seçimi otomatik açılır.
- Modal Cancel yalnız seçiciyi kapatır; erişim bilgisini silmez/OAuth başlatmaz.
- Resume setup mevcut bekleyen listeyi yeniden doğrular; OAuth olmadan açar.
- Yönetici hesap seçilemez.
- 1–3 benzersiz uygun reklamveren seçilir; görüntüleme yetkisi tam olarak bir Reporting Account'tadır.
- Tek bağlı hesap otomatik Reporting Account olur.
- İki/üç hesap, seçili kümeden açık tek Reporting Account ve Save and finish kullanılana kadar bekler.
- Cancel eksik adımı korur; Resume doğru seçiciyi açar.
- Bağlı Reporting Account ancak sağlayıcı erişimi doğrulandıktan sonra OAuth olmadan değişir; hatada önceki bağ korunur.
- Save and connect/Save and finish tekrarı aynı sonucu veya sabit çakışmayı döndürür; döngüye girmez.
- Disconnect, yerel yaşam döngüsü değişiminden önce yenileme token'ını resmî Google iptal uç noktasına gönderir.
- `revoked` veya `already_invalid` yerel temizliğe izin verir. Diğer iptal hataları erişim bilgisi/hesap/bağı korur; sabit hata döner.
- Başarılı kesme erişim bilgisi/hesap/bağı kaldırır; temiz Settings'e döner.
- Kesme sonrası yenileme kesilmiş durumda kalır; kurulum başvurusu hatası üretmez.
- Yeniden bağlanma yeni OAuth ister.
- Merge öncesi masaüstü ve gerçek mobil Shopify Admin kabulü zorunludur.
- Bu uygulama commit'i Production dağıtımı veya migration içermez.
