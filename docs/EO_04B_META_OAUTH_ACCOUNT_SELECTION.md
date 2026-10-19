# A6-EO-04-B — Meta OAuth ve hesap seçimi

**Durum:** Kabul edildi; merge edildi

**Kontrol tarihi:** 13 Ekim 2026

Bu belge 13 Ekim 2026 kabulünü anlatır. O tarihteki hata eşlemesi, sonraki kabul edilmiş düzeltmenin yerine geçmez. Özellikle HTTP 403 davranışının 18 Ekim düzeltmesi aşağıda yönlendirilmiştir. Güncel proje durumu Execution Plan'dadır; bu dil düzenlemesi yeni canlı işlem yetkisi değildir.

## Tarihsel resmî kaynaklar

- Meta Graph API değişiklik günlüğü: https://developers.facebook.com/docs/graph-api/changelog
- Meta Graph API sürümleri: https://developers.facebook.com/docs/graph-api/changelog/versions/
- Meta uygulama sürümleme: https://developers.facebook.com/docs/apps/versions
- Meta Facebook Login: https://developers.facebook.com/docs/facebook-login
- Meta Marketing API resmî koleksiyon: https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi
- Meta Ad Account başvurusu: https://developers.facebook.com/docs/marketing-api/reference/ad-account
- Shopify App Home web bileşenleri: https://shopify.dev/docs/api/app-home/latest/web-components

Kabul edilmiş Shopify arayüz temeli `polaris-2.0-rc.js` ve `@shopify/polaris-types@2.0.0-rc.2` olarak kalır. Resmî sayfanın kararlı 1.1 yüzeyini göstermesi bu ürün kararını otomatik geri çevirmez.

## İş sonucu

Kullanıcı kurulu Shopify çalışma alanından Meta'ya bağlanır, salt okunur reklam erişimi verir, 1–3 gerçek reklamveren hesabı seçer ve tam olarak bir Reporting Account belirler. Kurulu Shopify mağazası değiştirilemez ticaret kaynağıdır. Meta hesabı, pixel, alan adı veya tarayıcı kimliği mağaza seçemez/değiştiremez.

## Kabul edilmiş akış

Aşağıdaki İngilizce eylem adları özgün ekran metinleridir; uygulama çevirisi yapılmaz.

1. **Connect Meta**, Shopify onay penceresini açar.
2. **Continue to Meta**, kısa ömürlü sunucuya ait OAuth işlemini başlatıp üst düzey pencerede yönlendirir.
3. Giriş ve gerekli doğrulamayı Meta yürütür. Mobilde önceden Facebook uygulaması veya tarayıcı oturumu bulunması gerekmez.
4. Dönüşten sonra AdsTable kısa ömürlü token'ı uzun ömürlüye çevirir, Meta ile doğrular, şifreler ve `/me/adaccounts` hesaplarını keşfeder.
5. Settings reklamveren seçicisini otomatik açar. Kullanıcı sağlayıcının döndürdüğü 1–3 reklam hesabını seçer.
6. Seçim tek hesapsa kendiliğinden Reporting Account olur.
7. İki/üç hesapsa Reporting Account penceresi otomatik açılır; bu kümeden tam olarak bir açık seçim ister.
8. Seçiciyi kapatmak bekleyen durumu korur. **Resume setup** doğru seçiciyi yeniden yükleyip açar; OAuth'u tekrar başlatmaz.
9. Bağlı kullanıcı seçili kümeden Reporting Account değiştirebilir; OAuth gerekmez, Meta erişimi önce yeniden doğrulanır.
10. **Disconnect** önce Meta izinlerini iptal eder. Yalnız `revoked` veya `already_invalid`, yerel yetki ve şifreli erişim bilgisinin kaldırılmasına izin verir. Sağlayıcı/ağ hatasında bağlantı korunur; işlem güvenle durur.

Yalnız `connected` raporlama yetkisi verir. OAuth ve hesap seçimi Dataset V2 yazmaz, geriye dönük doldurma veya veri işi başlatmaz.

## Çalışma zamanı sözleşmesi

- Graph ve Login sürümü: tam `v26.0`.
- İzin: tam `ads_read`.
- Dönüş: `https://embedded.adstable.app/auth/meta/callback`.
- Hesap keşfi: imleçli `/me/adaccounts`, en fazla 20 sayfa ve 1.000 farklı hesap; döngü ve bozuk yanıt reddedilir.
- Token doğrulama: `is_valid`, tam uygulama kimliği, `ads_read` ve sınırlandırılmış süre dolumu.
- Saklama: yalnız EO-03-B şifreli sağlayıcı-token kasası.
- 13 Ekim tarihsel eşlemesinde sağlayıcı hatası `190`, HTTP 401 veya hesap keşfinde HTTP 403 yeniden yetkilendirme sayılıyordu; boş hesap listesine çevrilmiyordu.

**Sonraki kabul edilmiş düzeltme:** 18 Ekim'de tek başına HTTP 403'ün token geçersizliği olmadığı kabul edildi. İzin hatası yeniden yetkilendirme gerekçesi üretmez; açık 190 ve mevcut 401 davranışı korunur. Ayrıntı: `docs/EO_04B_META_REPORTING_RUNTIME_START_BRIEF.md` içindeki “Onaylı dar hata düzeltmesi — 18 Ekim 2026”. Bu not eski kaydı silmez veya yeni hata kuralı oluşturmaz.

## Shopify bileşen eşlemesi

| İhtiyaç | Tam bileşen |
|---|---|
| Sayfa ve sağlayıcı bölümü | `s-page`, `s-section`, `s-stack` |
| Durum ve hatalar | `s-badge`, `s-banner` |
| Eylemler | `s-button` |
| Hesap ve Reporting Account seçimi | `s-modal`, `s-choice-list`, `s-choice` |
| Sağlayıcı yetkilendirmesine gezinme | Üst düzey Shopify embedded gezinmesi |

Ham form kontrolü, özel bileşen taklidi, satır içi CSS veya doğrudan görsel değer eklenmez.

## Kabul ve dış sistem değişikliği kapıları

Repository kabulü tekrarlanabilir testler, TypeScript, derleme ve CI ister. Ürün sahibinin yönettiği Meta ayarı, Production dağıtımı ve masaüstü Shopify Admin akışı geçti. Masaüstü kanıtı dönüşü, otomatik hesap seçimini, tek hesap Reporting Account atamasını, OAuth'u yeniden başlatmadan Cancel/Resume'u, önce iptal eden Disconnect'i ve temiz yeniden bağlanmayı kapsar.

Tam Windows akışı Meta geliştirici rolü hesabıyla geçti. Ürün sahibinin iPhone'undaki yeni Connect işleminde kullanılabilir Facebook oturumu yoktu; Meta parola ekranı doğru açıldı. Kontrollü Windows karşılaştırmasında rolü olmayan başka Facebook hesabı, Android'de görülen **App not active** yanıtının aynısını üretti. Bu tarihsel karşılaştırma yanıtın cihaz türü/AdsTable kodundan değil, Meta'nın review öncesi geliştirme modu kullanıcı kısıtından geldiğini gösterdi.

Android sonucu kabulü engellemedi. Başka Android'de tekrar, kabul sonrası isteğe bağlı gerileme kontrolüdür; yeni onay gerektiren canlı işlem izni sayılmaz. Kopyalanmış OAuth adresi veya `state` kullanılamaz. Gözlenmemiş iOS dönüşü/hesap seçimi iddia edilmez.

Kalıcı kanıt: `docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json`. Canlı OAuth ve EO-04-B ürün sahibi kabulü geçti. Açık merge onayıyla PR #68, `23911ffd565f385c02693ed7a1f3a07f017c30f5` olarak squash merge edildi.

Ürün sahibi başlangıç açıklamasını ve EO-04-B'nin doğrudan nihai kabulünü 13 Ekim 2026'da sohbette verdi.
