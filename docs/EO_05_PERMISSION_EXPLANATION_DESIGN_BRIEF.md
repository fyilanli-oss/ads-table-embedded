## 30 Ekim 2026 — #264 güncel main ile eşitlendi

Kullanıcının somut onayı yalnız #264’ü güncel main ile eşitlemek, belge farklarını uzlaştırmak ve CI’ı doğrulamak içindir. Main 565abe86ac551a686ad151b60c8b01b8628f9a80 içindeki açık OAuth izin kuralı ile #264’te tamamlanmış 6. adım temizliği birlikte korunur. Temizlik öncesi durdurma/not-started kaydı tarihsel olarak saklanır; güncel durum katalog seçiminin kaldırılmış, gerçek görsel kabulü ve PR merge’ünün bekliyor olmasıdır.

Bu eşitleme uygulama/test kodu, paket/lock, migration, yayın, veritabanı, izin veya bağlantı değiştirmez. #264’ü main’e birleştirme onayı değildir. JSON ve kural eşliği kontrol edilir; exact eşitleme commit’i için CI yeniden doğrulanır.

## OAuth — işlem öncesi zorunlu açık kullanıcı onayı (29 Ekim 2026)

**OAuth’a doğrudan veya dolaylı değen hiçbir çalışma, yapılacak somut işlem ve kapsam açıklanıp kullanıcıdan önceden açık izin alınmadan başlatılamaz.** Tüm sağlayıcılar ve Shopify dahildir.

- İnceleme/araştırma, akış ve ekran tasarımı, izin/kapsam, hesap/Reporting Account/Merchant/işletme/katalog seçimi veya bağlantıları bu kapıya tabidir.
- Kod, test, sözleşme, migration, config, callback/token/oturum, canlı çağrı, temizlik/kaldırma/geri alma/refactor, deploy ve merge de dahildir. Düzeltme veya geri alma amacı kendiliğinden izin oluşturmaz.
- Genel “devam edelim”, genel onay, önceki başka iş/merge onayı veya önceki plan kararı OAuth yetkisi değildir. Onay yalnız açıkça belirtilen somut iş ve kapsam için geçerlidir. Kapsam değişecekse durulur ve yeni açık izin alınır.
- Bu kapı, OAuth için önceki bağımsız kodlama veya izole test ilerleme izinlerinin önündedir; teknik olanak, başarılı test, geri alınabilirlik veya ajan takdiri yerine geçmez.
- #264 içindeki izinsiz katalog seçim adımı kullanıcı tarafından reddedildi. Kullanıcının “Tamam başla temizlemeye.” izniyle yalnız 6. adım ve bağımlılıkları kaldırılır; bu izin başka OAuth işi veya merge yetkisi değildir. Her yeni veya genişletilmiş kapsam yeniden açık izin gerektirir.
- Bu kuralın AGENTS ve bağlayıcı belgelere kaydı kullanıcı tarafından açıkça istendi. Bu izin yalnız kural kaydına aittir; OAuth inceleme/kodlama/test/temizlik veya provider işlemi yetkisi vermez.

## 29 Ekim 2026 — Kullanıcı onaylı 6. adım temizliği

Doğrulama: 3.064/3.064 tüm test, 224 ilgili test, tip kontrolü ve derleme geçti. Native görsel kabulü yoktur; exact commit CI ayrıca kontrol edilir.

Somut izin: “Tamam başla temizlemeye.” Yalnız OAuth kurulumuna izinsiz eklenen Merchant/işletme/katalog seçimi ve bağımlılıkları kaldırılır. Çalışan 1–5: açıklama, birleşik izinler, callback/token/izin doğrulaması, 1–3 reklam hesabı ve tek Reporting Account seçimi korunur. Hesap seçimi sonrasında mevcut Connected raporlama görünümüne dönülür. Bu görünüm katalog/ürün kimliği/rol/kalıcı aktivasyon veya Dataset yetkisi değildir.

Otomatik ve elle katalog seçimi, bunlara özel listeleme modülü/metot/route eylemleri ve Verify access kaldırılır; yerine otomatik katalog seçimi, hata yutma veya sahte doğrulama konmaz. Ürün kimliği için önceden bulunan bağımsız native okuyucular korunur. Cancel/hide I/O yapmaz, seçim Save sonrasında native afterhide ile bir kez gider; hata unknown ve no-retry kalır. Tek/çok hesap, normal görünüme dönüş, kaldırılmış eylemlerin reddi ve artık katalog çağrısı yapılmaması test edilir.

Meta açıklamasındaki “selected business” bağımlılığı kaldırılır: Allow AdsTable to read advertising and catalog data for reporting and product matching. Bu değişiklik yeni izin veya seçim eklemez. Birebir hesap/Reporting Account metinleri ve native s-modal/s-choice-list/s-choice/s-button eşliği korunur; yeni ekran yok. Resmî Choice list/Modal kaynakları 2026-10-29 okundu. Gerçek desktop/min320px mobil owner kabulü ayrıca bekler; ajan Shopify’da görsel işlem yapmaz. #265 açık OAuth izin kapısını kaydeder; bu temizliğin onayı başka OAuth işi veya merge yetkisi değildir. Önceki katalog seçim/listeleme tasarımları reddedilmiş tarihsel kayıtlardır. Canlı izin/config/deploy/token/DB/Dataset işlemi yoktur.

## 29 Ekim — Otomatik liste keşfi: uygulama öncesi ekran sözleşmesi

Mevcut 07 / dördüncü teslim. Google Merchant hesap listesi, Meta işletme ve seçilen işletmenin owned/client katalog listeleri mevcut read izinleriyle okunur. Liste bağlantı/sürüm/Reporting Account bağlamına ve süreye bağlı adaylardır; erişim/Ads bağı veya ürün eşlemesi değildir. Google accounts.list kullanıcıya göre kota kullanır; bütün advanced subaccount evreni vaat edilmez. Meta güncel web belgesi erişilemedi/429 döndürdü; resmî SDK 26.0.0 GET businesses/owned_product_catalogs/client_product_catalogs ve id/name alanları doğrulandı. Bu, gerçek uygulama/mağaza izni kanıtı değildir.

Exact başlıklar: Select Merchant Center account / Select Meta business / Select Meta catalog. Alanlar: Merchant Center accounts / Businesses / Catalogs. Metin: Choose an item visible to this connection. Access will be verified before setup can continue. Boş liste: No available accounts or catalogs were returned. Check status before continuing. İşletme eylemi Continue, son seçim Verify access, iptal Cancel; yükleniyor Loading available accounts and catalogs…

Aynı native s-modal base/base ve block/base stack içinde tek s-choice-list/s-choice kullanılır; manual kimlik text-field kaldırılır. İşletme Continue ancak modal afterhide sonrası katalogları okur. Son Verify native erişim doğrulayıcısına gider. Açılış/mount izin istemez; hata/sınır/tekrarlanan cursor/çelişki/kısmi liste başarı sayılmaz. İlk hatada durulur; otomatik tekrar/başka rota/manual kimlik fallback yoktur. İşletme değişince eski katalog seçimi korunmaz. Tam liste gözlemi de Connected/aktivasyon değildir.

Kaynaklar: Google Merchant accounts.list ve Account v1; Meta resmî facebook-python-business-sdk/26.0.0 user.py/business.py. Kontrol 2026-10-29. Gerçek desktop/min320px mobil, tam metin/alan/eylem, klavye/dokunma/odak, boş/hata/iptal/süre ve açık owner görsel kabulü bekler; ajan Shopify’da görsel işlem yapmaz. Canlı izin/yayın bayrakları kapalı; canlı çağrı/config/deploy/DB/Dataset yok. Kalıcı saklama/son aktivasyon 15’te. Makine karşılığı: contracts/eo-05-permission-explanation-design-v1.json#asset_discovery_spec.

## 29 Ekim — Birleşik hesap seçimi ve katalog adayı doğrulaması: uygulama özeti

Mevcut 07 / dördüncü teslim, aynı Settings yüzeyinde. Google/Meta için sunucunun verdiği advertiser listesinde 1–3 hesap, gerekiyorsa tek Reporting Account seçilir. Liste yalnız mevcut combinedSetup.inspect sonucundan gelir. Bir sonraki evre, Google Merchant Center account ID veya Meta Business ID + Catalog ID adayı girilerek mevcut native doğrulayıcının açık Verify access eylemiyle çağrılmasıdır. Bu alanlar otomatik keşif listesi veya kanıt değildir. Tam liste keşfi bu teslimde uydurulmaz.

Exact başlıklar: Select Google Ads accounts / Select Meta accounts / Select Reporting Account / Verify Merchant Center account / Verify Meta catalog access. Metin: Choose one to three advertiser accounts. Hesap alanı: Advertiser accounts; tek hesap alanı: Reporting Account. Aday alanları: Merchant Center account ID / Business ID / Catalog ID. Aday açıklaması: Enter the account or catalog identifiers to verify access. These are candidates, not verified connections. Eylemler: Save selection / Verify access / Cancel. Boş liste: No selectable accounts were returned. Check status before continuing. Geçersiz girdi: Check the selected accounts or identifiers before continuing.

Tek native s-modal size=base/padding=base, s-stack block/gap=base, s-paragraph; s-choice-list ve s-choice ile native hesaplar; s-text-field required/maxLength=30 ile aday kimlikler; primary-action/secondary-actions slotlarında s-button primary/secondary. Özel CSS/HTML kontrolü yok. Resmî Choice list/Text field/Modal belgeleri 2026-10-29 okundu. Makine karşılığı: contracts/eo-05-permission-explanation-design-v1.json#combined_selection_spec.

Resume açık kullanıcı eylemidir. Cancel/kapatma istek veya seçim yazmaz. Save/Verify niyeti ve görünen bağlantı/sürüm/kimlikler kapanmadan önce sabitlenir; dispatch yalnız afterhide sonrası bir kez olur. Eski sürüm core içinde reddedilir; belirsiz sonuç otomatik tekrar edilmez. Yazım makbuzu hesap listesi sayılmaz; sonraki Resume güncel listeyi okur. Asset erişim kanıtı kendi sona erme zamanıyla geçerlidir; Connected/aktivasyon/kalıcı kayıt değildir. Google/Meta yayın kapıları kapalı kalır.

Masaüstü ve en az 320 px gerçek mobilde aynı tam metin/alan/eylem, klavye/dokunma/odak ve native açma/kapatma sınanmalıdır. Gerçek kanıt ve kullanıcı görsel kabulü yok; ajan Shopify’da görsel işlem yapmaz. Kapsam dışı: otomatik Merchant/business/catalog liste keşfi, 15 kalıcı saklama, son aktivasyon, canlı izin/config/deploy/DB/Dataset.

## 29 Ekim 2026 — İzin açıklamaları Settings ve sabit sunucu eylemlerine bağlandı

Aynı taslak #264 üzerinde ortak açıklama artık mevcut Settings içinde kullanılıyor. Üç eski Connect modalı kaldırıldı; Connect/Reconnect ve hata sonrası kontrol aynı host’a bağlandı. Settings içindeki Shopify bölümünde Products, ayrı isteğe bağlı Orders ve Check status var. İzin eyleminden önce mağaza/kurulum sunucuda doğrulanır. Formun provider/permissionProfile veya enabled alanı yetki kaynağı değildir. Sabit feature + ilişkilendirme kimliği kontrol edilir; response yalnız aynı özelliğe/isteğe ve o sağlayıcının native hedef ekranına bağlanabilir.

Google/Meta birleşik beginCombinedSetup yoluna, Shopify sabit requestProducts/requestOrders metoduna, Klaviyo mevcut beş okuma izinli girişe bağlandı. Google/Meta ve Shopify yayın/izin isteme bayrakları kapalı kaldı; kapalı durumda provider runtime oluşturulmaz ve izin/varlık okuması yapılmaz. Açıklama kapısının değişmesi developer onayı, optional_scopes yayını, token veya canlı test değildir. Kullanıcı Check status demeden mount/return effect’i yeni izin başlatmaz; permission eylemi mevcut provider loader’larını kendiliğinden tekrar çalıştırmaz. Native SDK Response aynen korunur.

Klaviyo hesap/maliyet sürdürme mevcut adıma döner, geçerli seçilmiş hesap korunur; eksik maliyet yeniden OAuth istemez. Products hazır değilse Orders sürdürme Products açıklamasına döner. Yalnız aynı özelliğin doğrulanmış durum cevabı belirsiz/bekleyen istemi serbest bırakır. Hata ham yanıt göstermeden unknown olur; Check status sunulur, tekrar/alternatif rota yoktur. Bir erişim cevabı genel Connected veya Dataset yetkisi üretmez.

Açık kalan kod: Google/Meta birleşik hesap/Reporting Account/merchant-business-catalog seçicilerinin kendi doğrulanmış sunucu yoluna bağlanması. Bu evreler eski reporting seçicisine veya yeniden OAuth’a düşürülmez; henüz bağlı olmayan evreye boş işlevli Resume düğmesi sunulmaz. Developer/yayın kapıları ve gerçek Shopify Admin masaüstü/en az 320 px mobil, native dönüş/ret/kısmi izin ve açık kullanıcı görsel kabulü ayrıca bekliyor. Ajan Shopify üzerinde görsel işlem yapmaz. UI işi Done/PASS ve merge-ready değildir; 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımı.

Resmî Shopify Modal ve Scopes ile React Router useFetcher belgeleri 2026-10-29 yeniden okundu. Güncel belge v4/latest ile kurulu SDK 3.0.1 aynı sürüm diye varsayılmadı; mevcut runtime ve native SDK method sözleşmesi korundu. React best-practices becerisinin sunucu kimlik doğrulama, olay cleanup ve paket ayrımı kontrolü uygulandı; bu native görsel kanıt değildir. Kayıt: contracts/eo-05-start-brief-v1.json#Permission_settings_wiring_2026_10_29.

## 29 Ekim 2026 — İzin açıklamaları: ortak bileşen ve kullanıcı niyeti kontrolü

#263 main’e birleşti (5887748a8e8d62eea9f61444d3833ac53b4ea6cb); kararlı Polaris 2.0 referansı kullanılıyor. Mevcut 07 / dördüncü teknik teslim içinde beş onaylı açıklamanın ortak s-modal/s-stack/s-paragraph/s-button/s-banner bileşeni ve tek Settings host’una ait akış denetleyicisi kodlandı. Yeni route veya canlı ekran girişi açılmadı.

Açma/Cancel/Escape izin istemez. Connect niyeti native hide olayından önce sabitlenir, istek yalnız afterhide sonrasında ve güncel uygunluk tekrar kontrol edilerek tek kez gönderilebilir. Eski oturum/çift tıklama/çift kapanma ve ikinci provider açılması engellenir. Kapı varsayılan kapalıdır; browser uygunluğu sunucu yetkisi değildir. Başarılı adapter dönüşü awaiting_status olur, Connected olmaz. Hata ham yanıt saklamadan unknown kalır; otomatik tekrar yoktur. React 18 için native hide/afterhide dinleyicileri ve cleanup kullanılır; Connect açıklamasının kapanması yanlış Cancel sayılmaz.

Açık kalan: bileşenin Settings/Home içinde barındırılması, sabit authenticated sunucu eylemleri ve dönüş/sürdürme/status bağlantısı. Google/Meta mevcut reporting-only begin’e yeni Ads+Merchant/Catalog metni bağlanmadı; böyle bir bağlantı izin kapsamını yanlış anlatırdı. Shopify Products/Orders istemi ve release kapıları açılmadı. Bu teslim tam UI işi, canlı izin veya görsel kabul değildir. Gerçek Shopify Admin masaüstü ve en az 320 px gerçek mobil kanıtı ile açık kullanıcı görsel kabulü zorunlu; Shopify üzerinde ajan görsel işlem yapmaz. 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımıdır.

16 izolasyon testi; beş özellikte açma/iptal/tek istek, native kapanma sırası, kapı değişimi, hata, eski oturum, Resume ayrımı ve gerçek React SSR metni/kontrolleri doğrular. Bu sentetik testler native görsel kanıt değildir. Resmî Modal/Button/Stack/Paragraph/Banner ve React useEffect kaynakları 2026-10-29 kontrol edildi. Kayıt: contracts/eo-05-start-brief-v1.json#Permission_explanation_component_2026_10_29.

## 29 Ekim 2026 — Onaylı kararlı Polaris 2.0 hizalaması

#262 main’e birleşti (284c789715342786e972f912e5a57d253b1c7001). Ürün sahibi açıklama tasarımını ve sabit polaris-2.0.js + exact @shopify/polaris-types@2.0.0 geçişini açıkça onayladı. Sunucu ShopifyApp ve AppProvider aynı merkezi runtime değerini kullanır; paket ve lock birlikte değiştirilir. Resmî Shopify sürümleme kaynağı 2026-10-29 kontrol edildi: https://shopify.dev/docs/api/app-home/latest/web-components/versioning.

Bu kayıt yalnız kod referansını hizalar. Gerçek Shopify Admin masaüstü ve en az 320 px gerçek mobil görsel kabulü bekliyor; yeni modal/route veya izin aktivasyonu tamamlandı sayılmaz. Shopify üzerinde ajan görsel işlem yapmaz. Canlı config/deploy/izin/token/DB değişikliği yok. Eski RC kararları tarihsel kayıttır; güncel sürüm seçimi kararlı 2.0’dır. 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımıdır.

# İzin öncesi açıklamalar — inceleme tasarımı

29 Ekim 2026 · EO-05 / mevcut 07 · dördüncü teknik teslim

Bu belge kullanıcının göreceği beş açıklamayı aynı kurala bağlar. Henüz ekran kodu, canlı izin istemi veya görsel kabul değildir. Ürün ekranlarının mevcut İngilizce dili korunur; aşağıdaki İngilizce bloklar birebir ekran metnidir. Makine karşılığı: `contracts/eo-05-permission-explanation-design-v1.json`.

## Her açıklamada aynı davranış

Başlık → neden gerekli olduğu → hangi erişimin gerektiği → **Cancel / Connect**.

Açıklamayı açmak izin istemez. **Cancel**, kapatma veya Escape, Connect öncesinde yalnız açıklamayı kapatır. Connect bir kez basılınca açıklama kapanır, bağlantı başlatılır ve ikinci istem engellenir. Bundan sonra sağlayıcının kendi izin ekranı devreye girer; başlamış işlem iptal edildi diye varsayılmaz.

Dönüşte gerçek izin ve gerekli hesap/katalog erişimi sunucuda okunur. Eksik adımda **Resume setup** yalnız o adıma götürür: izin, hesap seçimi, katalog seçimi veya Klaviyo maliyet girişi. Her eksik adım yeniden OAuth başlatmaz.

## Connect Shopify products

Ürün ve varyant okuma temel ürün kurulumu için gerekli; sipariş erişimi bu isteme eklenmez.

> Allow AdsTable to read your products and variants to match product reporting to your Shopify catalog.
>
> Product access is required to finish product setup. Order access is optional and will be requested separately when you choose an order-based feature.

**Cancel** · **Connect**

## Connect Shopify orders

Son siparişler ve satın alınan ürünlerle atıf karşılaştırması; isteğe bağlı, Products izni korunur, kesin çift sayım vaat edilmez.

> Allow AdsTable to read recent orders and purchased products to compare Shopify sales with marketing attribution.
>
> Order access is optional. Cancelling does not change your existing product connection.
>
> Order access helps investigate attribution overlap; it does not, by itself, confirm duplicate attribution for individual orders.

**Cancel** · **Connect**

## Connect Google Ads and Merchant Center

Ads ve Merchant birlikte gerekli. Merchant olmadan kurulum eksik kalır. Google izninin genişliği ile AdsTable’ın okuma amacı ayrı anlatılır.

> Allow AdsTable to read your advertising data and catalog to match product reporting.
>
> Both Google Ads and Merchant Center access are needed to finish this connection. You need an accessible Merchant Center account, including for Search-only setups.
>
> Google permissions may also allow changes. AdsTable uses this connection to read data and does not edit your campaigns or catalog.

**Cancel** · **Connect**

## Connect Meta ads and catalog

Reklam hesabı ve katalog birlikte gerekli; işletme/Sayfa izinleri de görünür. Yönetim izinlerinin genişliği gizlenmez, ürün/satış ayrımı vaat edilmez.

> Allow AdsTable to read advertising data and the catalog available to your selected business.
>
> Both ad account and catalog access are needed to finish setup. You may also see business and Page permissions.
>
> Some business and catalog permissions also allow changes. AdsTable uses this connection for reporting and product matching; it does not edit those assets.

**Cancel** · **Connect**

## Connect Klaviyo

Mevcut beş okuma izni; aylık tahmin ayrı adım, sıfır geçerli. Maliyet eksikliği yeniden OAuth istemez.

> Allow AdsTable to read account details and campaign, flow, metric and event data for reporting.
>
> After connecting, add your estimated monthly Klaviyo cost to finish setup. Enter 0 if you have no monthly cost.
>
> The cost is entered separately in AdsTable. If you leave it incomplete, use Resume setup to finish it later.

**Cancel** · **Connect**

## Sonuçların aynı dili konuşması

| Durum | Ekranda görünen | Davranış |
|---|---|---|
| Başlangıç okuması | Checking connection status… | Bağlı diye varsaymaz; izin istemez. |
| Kullanıcı Connect dedi | Starting connection… | Tek istek; açıklama kasıtlı kapanır, hide olayı iptal sayılmaz. |
| Sağlayıcıdan dönüş | Verifying access… | Gerçek izin ve hesap/varlık kontrolü. |
| İzin eksik | Resume setup | Önce açıklama yeniden açılır; yalnız yeni Connect ile izin istenir. |
| Hesap/raporlama hesabı/katalog seçimi eksik | Resume setup | Seçim adımı; yeniden OAuth yok. |
| Klaviyo tahmini maliyet eksik | Resume setup | Mevcut maliyet adımı; 0 geçerli, eksik ayrı. |
| İsteğe bağlı Orders yok | Order access is not connected. Your product connection is unchanged. | Products durumu korunur; Orders açıklaması ancak kullanıcı isterse. |
| Yalnız erişim doğrulandı | Access verified. Setup is awaiting activation. | Genel Connected veya veri işi yetkisi üretmez. |
| Sonuç belirsiz | We could not confirm the result. Check the connection status before starting again. | Check status yalnız okur; otomatik tekrar/silme/alternatif rota yok. |
| Geliştirici onayı/yayın kapısı eksik | Connection setup is not available yet. | Close; kullanıcıdan yeniden izin isteyerek geliştirici eksikliği kapatılmaz. |

İlk bağlantı tamamlanmamışken Connected gösterilmez. Önceden çalışan raporlama bağlantısı varsa yeni eksik ürün kurulumu onu kendiliğinden silmez. Orders izni, eski sipariş/korumalı veri erişimi ve tekil sipariş Overlap kanıtı ayrı şeylerdir. Bu açıklamalar reklam/ürün kimliği/Sales Role kurallarını değiştirmez.

## Resmî Shopify bileşenleri

| Görünür öğe | Bileşen ve seçilen özellik | Kaynak (29 Ekim) |
|---|---|---|
| Overlay and title | `s-modal` — heading=modal.heading; size=base; padding=base | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal) |
| Paragraph grouping | `s-stack` — direction=block; gap=base | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/stack) |
| Explanation and cancellation note | `s-paragraph` — children=exact paragraph text; no lineClamp, custom style or color | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/typography-and-content/paragraph) |
| Primary confirmation | `s-button` — slot=primary-action; variant=primary; children=Connect; loading=true only while dispatching; disabled=pending or server gate closed | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Cancel | `s-button` — slot=secondary-actions; variant=secondary; commandFor=matching modal id; command=--hide; children=Cancel | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Open explanation | `s-button` — commandFor=matching modal id; command=--show; children=Existing Connect/Resume setup trigger label | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Status/error feedback | `s-banner` — tone=info for pending; warning for missing; critical for error; no success from partial evidence; heading=exact state copy | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner) |

Özel CSS, ham HTML kontrolü, özel kart/modal/rozet veya literal renk yok. Metin kesilmez. Modalın doğal kaydırması ve resmî action slotları kullanılır; en az 320 px gerçek mobilde bütün metin ve eylemler erişilebilir olmalıdır. Klavye, dokunma, odak giriş/geri dönüş ve tek açık modal ayrıca doğrulanır.

## Tarihsel tasarım önerisi — yukarıdaki 29 Ekim onayıyla sonuçlandı

Repository’nin 6 Ekim’de açıkça seçilmiş referansı hâlâ `polaris-2.0-rc.js` + `2.0.0-rc.2` tipleridir. Son AGENTS metni kararlı bileşen ister. 29 Ekim resmî kontrolünde **kararlı Polaris 2.0** ve **2.0.0 tipleri** mevcut: resmî sabit `polaris-2.0.js` dosyası HTTP 200, npm resmî latest tipi 2.0.0. [Shopify sürümleme belgesi](https://shopify.dev/docs/api/app-home/latest/web-components/versioning), sürüm ile tiplerin birlikte değiştirilmesini ve RC dosyasının kendiliğinden kararlıya dönüşmediğini açıklar.

Önerilen somut hedef: `https://cdn.shopify.com/shopifycloud/polaris-2.0.js` ve exact `@shopify/polaris-types@2.0.0`; otomatik ilerleyen kanal yerine sabit 2.0. Bu tasarım sürümü, paketleri, lock dosyasını veya runtime’ı değiştirmez. UI anayasası geçiş için açık ürün sahibi kararı istediğinden bu karar ekran kodundan önce netleştirilmelidir. Önerilen özelliklerin kurulu RC manifestinde de bulunması, geçiş veya görsel kabul kanıtı değildir.

## Değişmeyecekler ve kabul

Bu tasarım Google/Meta/Klaviyo/Shopify izin setini, OAuth sunucu kapılarını, mevcut hesap seçimlerini, aylık maliyet formülünü veya Dataset’i değiştirmez. Yeni yüzey yok; yalnız mevcut `/` ve `/settings` içindeki kurulum girişi planlanır. Overlap rapor butonunun kesin yeri raporlama tasarımında kalır. Merchant/işletme/katalog seçici uygulaması ve kalıcı kaynak/kanıt bağları bu metin tasarımıyla tamamlanmış sayılmaz.

Metin/akış incelemesinden sonra onaylı sürüme uygun ekran kodu hazırlanır. Gerçek Shopify Admin masaüstü, en az 320 px gerçek mobil, yükleniyor/iptal/hata/dönüş/sürdürme ve ürün sahibinin açık görsel kabulü alınmadan UI işi birleştirilmiş veya Done/PASS ilan edilmez. Kullanıcının Shopify’da görsel otomasyon yapılmaması talimatı korunur; gerçek oturum kanıtı kullanıcı tarafından sağlanır. Canlı izin/config/deploy açılışı ayrıca kendi kapısındadır. 15 başlamadı; 22 duraklatılmış; Dataset/FX yazımı 23’te.


## 31 Ekim 2026 — mevcut 07: onaylı Settings düzeltmesi

Ürün sahibi salt okunur inceleme sonrası #264’teki onaylı arayüzün güncel main üzerine uyumlandırılmasını ve üç hatanın birlikte düzeltilmesini onayladı: Klaviyo ilk maliyet girişinde alan/modal içi hata, sağlayıcıya özel Working ve gerçek eksik adıma göre Resume setup. Sıfır tutar geçerli, mevcut harcama geçmişi korunur. Merchant/işletme/katalog seçimi veya otomatik seçimi eklenmez. Önceki katalog seçimi/temizlik bekliyor notları son kararla güncellenmiştir.

Somut durum/metin/bileşen ve test özeti: `docs/EO_05_STEP07_SETTINGS_CORRECTIONS_BRIEF.md`. Makine kaydı: `contracts/eo-05-permission-explanation-design-v1.json#Settings_corrections_2026_10_31`. Güncel teknik teslim bağlantıları korunur. Kod/izole test ve CI ile gerçek desktop/mobil kullanıcı kabulü ayrı tutulur; UI Done/PASS veya 07 kapanışı verilmez. #264 taslak kalır; yeni adayın merge onayı ayrıdır. Canlı provider, izin/kapsam, token/config, DB/migration ve deploy değişikliği yoktur. 15 başlamadı;22 duraklatılmış; Overlap22 sonrası;23 Dataset yazımı.
