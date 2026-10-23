# EO-04-C — Google canlı kanıt tetikleyicisi analist açıklaması

## Durum ve yetki

**23 Ekim repository sorgu kapsam düzeltmesi:** Aşağıdaki mevcut altı ailenin listesi büyütülmez. `shopping_product_daily` artık yalnız SHOPPING filtrelidir; ayrı `pmax_product_daily` eski tetikleyicide çalıştırılmaz. Bu nedenle tetikleyicinin `complete` durumu yalnız listelenen ailelerin tam okunduğunu belirtir, PMax ürün performansı veya ürün–Asset Group bağlantısının tamamlandığını değil. Yeni canlı yürütme, dağıtım veya arayüz değişikliği onaylanmamıştır.

Aşağıdaki kayıtlar 16 Ekim 2026 tarihsel yürütme/kabul sırasıdır. Bugünkü durum Execution Plan'dadır; yeni canlı istek veya dağıtım izni verilmez.

- Paket: `A6-EO-04-C`
- Analist açıklaması kabulü: **16 Ekim 2026**
- Repository uygulama onayı: **16 Ekim 2026**
- Dağıtım ve gerçek Shopify Admin görsel kabulü: **16 Ekim'de tamamlandı**
- İlk canlı Google Ads isteği: **onaylandı, 16 Ekim'de ilk hatada durdu**
- Güvenli hata logu düzeltmesi: **16 Ekim'de onaylandı**
- Tek ön kontrol erişim token'ı yenilemesi: **16 Ekim'de onaylandı**
- Tam ve başarılı boş canlı yürütme: **16 Ekim'de kaydedildi**
- Hesap/kampanya bağlam düzeltmesi: **16 Ekim'de onaylandı**
- Bağlam düzeltmesinin Production dağıtımı: **16 Ekim'de tamamlandı**
- Test hesabı review anlamı: **16 Ekim'de kabul edildi; repository uygulaması onaylandı**
- Test hesabı düzenlemesi: **16 Ekim'de 289/289 test, tür kontrolü ve Production derlemesi geçti**
- Test hesabı düzenlemesinin Production dağıtımı: **16 Ekim'de tamamlandı**
- Masaüstü/mobil görsel kabulü: **16 Ekim'de ürün sahibinden alındı**
- Tetikleyici/review anlamı merge'ü: **PR #85, 16 Ekim'de `54c427733cd51ba8600016941ce7afdd24ac2e64` olarak merge edildi**
- Test hesabı review demosu: **16 Ekim'de altı sorgu ailesi sağlayıcı/çalışma zamanı hatası olmadan tamamlandı**
- Bağlayıcı çalışma zamanı sözleşmesi: `contracts/eo-04c-google-reporting-runtime-v1.json`
- Tetikleyici sözleşmesi: `contracts/eo-04c-google-live-evidence-trigger-v1.json`

## Kullanıcı amacı ve sonuç

Bağlı kullanıcı Settings'teki Google Ads bölümünden tek, sınırlı, salt okunur kanıt yürütmesi başlatabilir. Seçili Production Reporting Account'un ürün performansı, Cart Data satış/Sales Role, güncel PMax listing tree ve Asset Group performansı döndürüp döndürmediğini inceler.

Sonuç yalnız kanıttır; Dataset V2 gerçeği yayımlamaz. Boş yanıtı sıfır veya genel desteklenmiyor saymaz.

## Tam yürütme

Sorgulardan önce saklı yenileme token'ı **tam bir kez** kullanılarak geçici erişim token'ı alınır. Yenileme başarısızsa Google Ads sorgu çağrısı sıfırdır. Başarılı token aynı yürütmenin bütün aile/sayfalarında bellekte kullanılır; saklanmaz. 401 sonrasında token yenileyip tekrar etme yolu yoktur.

Sıra, ilk hatada durmak üzere:

1. `account_identity` (`FROM customer`);
2. `campaign_context` (`FROM campaign`);
3. `cart_data_product_sales_daily`;
4. `shopping_product_daily`;
5. `pmax_listing_tree_current`;
6. `pmax_asset_group_channel_daily`.

Tarihli aileler Reporting Account saat diliminde son 30 tamamlanmış iş tarihini kullanır. Tamamlanmadan bütün sayfalar okunur. Sayfalama sınırlıdır; güvenlik sınırına gelmek kısmi yayım değil başarısız yürütmedir. Tekrar, uç nokta, API sürümü veya kimlik doğrulama alternatifi yoktur.

## Durum matrisi ve özgün ekran metni

İngilizce metinler kabul edilmiş arayüz sözleşmesidir; bu paket ürün çevirisi yapmaz.

| Durum | Görünen özgün metin | Eylem | Beklenen |
|---|---|---|---|
| Bağlı değil / kurulum eksik | Yalnız mevcut bağlantı/kurulum kontrolleri | Yok | Kanıt eylemi kullanılamaz |
| Bağlı / bekliyor | `Run Google evidence` | Bir kez bas | Tek salt okunur yürütme |
| Yükleniyor | `Reading Google evidence…` | İkinci eylem yok | Doğal yüklenme durumu çift gönderimi engeller |
| Başarılı test demosu | `Google test account verified. Read-only reporting queries completed: campaign context {count}; Cart Data {count}; product performance {count}; current listing tree {count}; PMax Asset Group performance {count}. Test accounts do not serve ads, so these results are not production performance evidence. Production validation remains pending Google Ads API Explorer access.` | Yok | `Google test account checked`; buton kapalı kalır |
| Production kanıtı başarılı | `Google evidence received.` ve sınırlı satır/Sales Role sayıları | Yok | `Google evidence received`; buton kapalı |
| Başarılı boş kanıt | `Google returned no product or PMax evidence in this execution. This is not zero or unsupported.` | Yok | `Google evidence received`; buton kapalı |
| Sağlayıcı/çalışma zamanı hatası | `Google evidence stopped. No retry was performed. Error code: {code}` | Yok | `Google evidence stopped`; buton kapalı |
| Yeniden yetkilendirme | Aynı durma metni, dönen kod/sınıfla | Mevcut yeniden bağlanma ayrı | Otomatik OAuth başlatılmaz |
| İptal | Uygulanamaz; modal/form/ara onay yok | Yok | İptal kontrolü uydurulmaz |

## Shopify bileşen eşlemesi

| Öğe | Bileşen | Özellik / tür / ton | Resmî kaynak | Kontrol |
|---|---|---|---|---|
| Mevcut Google bölümü/yığını | `s-section`, `s-stack` | Mevcut doğal yerleşim | App Home web bileşenleri | 2026-10-16 |
| Kanıt eylemi | `s-button` | `loading`; tamamlanma/hata sonrası `disabled` | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> | 2026-10-16 |
| Başarılı test sonucu | `s-banner` | `tone="info"` | <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner> | 2026-10-16 |
| Başarılı Production sonucu | `s-banner` | `tone="success"` | Aynı Banner kaynağı | 2026-10-16 |
| Boş sonuç | `s-banner` | `tone="warning"` | Aynı Banner kaynağı | 2026-10-16 |
| Hata | `s-banner` | `tone="critical"` | Aynı Banner kaynağı | 2026-10-16 |

Ham HTML eylemi, özel CSS, satır içi stil, doğrudan renk, modal, tarih girişi, yeni bölüm veya `s-clickable` eklenmez. Masaüstü/mobil aynı doğal blok yığını ve Shopify uyarlanabilirliğini kullanır.

## Güvenli sonuç sınırı

Tarayıcı ve sunucu logu yalnız sınırlı özet alır:

- Raporlama penceresi/saat dilimi;
- Aile bazlı satır sayısı/gözlem durumu;
- Kabul edilmiş ürün/satış alanlarının varlık sayıları;
- `Advertised`, `Cross-sell`, `Assisted`, `Unclassified` sayıları;
- Güncel ağacın, sürümlü tam gün kanıtı olmadan tarihsel Channel çözemeyeceği açıklaması.

Ham satır, ad, ürün/kampanya/hesap kimliği, token, erişim bilgisi, imleç ve sağlayıcı istek kimliği açığa çıkmaz/loglanmaz.

İlk onaylı canlı istekte gözlemlenebilirlik açığı bulundu: adres `GOOGLE_LIVE_EVIDENCE_FAILED` döndürdü, logda sınırlı hata kanıtı yoktu. Düzeltme loga yalnız yürütme aşaması, sorgu ailesi, güvenli kaynak/sağlayıcı kodu, HTTP durumu ve yanıt gözlenip gözlenmediğini ekler. Ham hata mesajı/kimlik yasaktır. Tanı kaydı tekrar veya sonraki aileyi başlatmaz.

İlk başarılı boş yürütme `docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json` içindedir. O ilk yapıda beş aile tamamlandı, satır gözlenmedi. Bu sıfır, genel desteklenmiyor, Product ID veya Sales Role desteğini kanıtlamaz.

Birleşik hesap/kampanya sorgusu `FROM campaign` kullanıyordu. Kampanya satırı yoksa `customer.test_account` da görülemiyor, hesap Test/Production diye sınıflandırılamıyordu. Sonraki çağrıdan önce kimlik bağımsız `FROM customer`, kampanya ayrı `FROM campaign` olarak okunmalıydı.

Ürün sahibi 16 Ekim'de dar düzeltmeyi onayladı. Kimlik önce, kampanya sonra okunur; boş kampanya artık `customer.test_account` kanıtını saklayamaz. Tam `53730bee401c79600570f199bd9967cf2d560c8a` commit'i `dpl_GFNme3aUQUJ25723fwU3e7HU235p` olarak Production'a çıktı. READY, `embedded.adstable.app` eşlemesi ve ilk error/fatal taraması temizdi. Bu dağıtım yeni canlı istek izni değildi.

Ayrı onaylı sonraki istek `customer.test_account=true` döndürdü. Google hata vermedi; çalışma zamanı başarılı sınıflandırmayı iç `GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE` hatasına çevirdi. Ürün sahibi review uyumlu düzeltmeyi 16 Ekim'de kabul etti: ayrı kimlik sorgusu kalır; hesap `test_observed` olur; aynı sınırlı sorgu aileleri tamamlanır; gerçek satır sayıları başarılı test demosu gösterilir. Sonuç Production reklam yayını, Product ID/Sales Role desteği veya Dataset V2 yetkisi değildir.

**Review sonrasında aynı çalışma zamanı kalır.** Explorer erişimiyle Production hesabı bağlamak uygulama yolunu değil, gözlenen hesap/veriyi değiştirir.

Ayrı onaylı Production dağıtımında `16a54df48e853c282d9c3481fb9e3b7c2b2ca16d`, `dpl_AQWkrVxdQvVzxPQkeNbhwXXwcXXQ` olarak READY oldu; `embedded.adstable.app` hatasız eşlendi, ilk dağıtıma özel error/fatal taraması temizdi. Ürün sahibi gerçek Settings masaüstü/mobil sonucunu kabul etti. Dağıtım/görsel kabul tek başına yeni sorgu veya merge izni değildi.

Sonra açık merge onayı verildi. PR #85, 16 Ekim'de `main`e `54c427733cd51ba8600016941ce7afdd24ac2e64` olarak girdi. Merge ikinci otomatik Production dağıtımı oluşturmadı. Production performans kanıtı Explorer veya üstünü; yeni sorgu ayrı onayı bekler.

Ayrıca onaylanan tek test hesabı review demosu, gerçek Shopify Admin'de `test_observed` durumunu doğruladı. Altı salt okunur aile sağlayıcı/çalışma zamanı hatası ve tekrar olmadan tamamlandı. Kampanya, Cart Data, Shopping ürün performansı, güncel PMax ağacı ve Asset Group performansı sıfır satır döndürdü. Bu boşluk yalnız `not_observed_in_this_execution` demektir; sayısal sıfır, genel desteklenmiyor, Product ID/Sales Role desteği veya Production performans kanıtı değildir.

Kalıcı sınırlı kanıt: `docs/evidence/EO_04C_GOOGLE_TEST_ACCOUNT_REVIEW_EVIDENCE_2026-10-16.json`. Erişim/test hesabı belgeleri 16 Ekim'de yeniden kontrol edildi: Explorer ve üstü Production erişimi ekler; Test erişimini kaldırmaz. Ortak çalışma zamanı değişmez; hesap türü ve dönen veri değişir, sorgu yapısı değişmez.

## Değişmeyen davranış ve kapsam dışı

- Kampanya, hesap, bütçe, listing tree veya dönüşüm ayarı değiştirilmez.
- OAuth consent/izin, gizli bilgi, ortam veya kalıcı erişim bilgisi değiştirilmez.
- Onaylı ön kontrol token yenilemesi geçici ve istek kapsamlıdır.
- Veritabanı yazımı, Dataset V2 yayımı, zamanlayıcı veya ürün kimliği eşlemesi yoktur.
- Tarihsel PMax Channel bugünkü ağaçtan çözülmez.
- Güvenli log, hesap bağlamı veya test hesabı review düzeltmelerinin hiçbiri ek canlı istek yetkilendirmez.
- Test satırları/boş yanıt Production reklam yayını kanıtına yükseltilmez.
- Review'a özel dal, uydurulmuş sağlayıcı satırı veya review sonrası çalışma zamanı değişimi yoktur.
- Mevcut Meta kanıt adresi ve davranışı değişmez.

## Kabul planı

- Testler tam aile sırası, 30 tamamlanmış iş tarihi, sınırlı tam sayfalama, ilk hata, tekrarsızlık ve güvenli özeti kanıtlar.
- Anayasa kontrolü, bütün testler, tür kontrolü ve derleme geçer.
- Dağıtım ayrı ürün sahibi onayı ister.
- Arayüz kabulü/merge öncesi masaüstü Shopify Admin ve en az 320 px gerçek mobil kanıt gerekir.
- Güvenli hata logu düzeltmesi dağıtıldıktan sonra her ek canlı istek ayrı açık ürün sahibi onayı gerektirir.

## Tarihsel resmî kaynaklar

Kontrol: 16 Ekim 2026.

- Shopify Button: <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button>
- Shopify Banner: <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner>
- Polaris 2 geçişi: <https://shopify.dev/docs/apps/build/app-home/polaris2>
- Bileşen sürümleme: <https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning>
- Test hesapları: <https://developers.google.com/google-ads/api/docs/best-practices/test-accounts>
- v25 Cart Data: <https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view>
- PMax listing grupları: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- GAQL: <https://developers.google.com/google-ads/api/docs/query/overview>
- v25 Customer: <https://developers.google.com/google-ads/api/fields/v25/customer>
- v25 Campaign: <https://developers.google.com/google-ads/api/fields/v25/campaign>
- Erişim seviyeleri: <https://developers.google.com/google-ads/api/docs/api-policy/access-levels>
- OAuth kısıtlı izin doğrulaması: <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- API politikası/demo hesabı: <https://support.google.com/adspolicy/answer/6169371>
- Erişim bilgisi yönetimi: <https://developers.google.com/google-ads/api/docs/oauth/credential-management>
- OAuth iç yapısı: <https://developers.google.com/google-ads/api/docs/oauth/internals>
