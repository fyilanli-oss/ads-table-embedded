# A6-EO-07 — Üç yüzeyli UI ürün kararları

**Durum:** Ürün kararı donduruldu; uygulama ve kabul bekliyor

**Karar tarihi:** 7 Ekim 2026

**Kapsam:** Funnel App Home, Ad Analysis ve Settings

**Yetki kaynağı:** Execution Plan, Shopify Embedded UI Anayasası ve açık ürün sahibi kararları

**Okuma notu:** Bu belge EO-07 için kabul edilmiş ürün niyetidir; ekranların uygulanmış veya görsel olarak kabul edilmiş olduğunu göstermez. Güncel paket durumu `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` içindedir. 7 Ekim kaynak kontrolü tarihsel kayıttır. Sonraki sağlayıcı raporlama kuralları `docs/EO_04_ANALYSIS_DESIGN_BOOK.md` üzerinden okunur; bu dil çalışması Channel, Medium veya Variation kimliğini değiştirmez.

## 1. Amaç ve yetki sınırı

Bu belge, sonraki A6-EO-07 uygulamasının izleyeceği kullanıcı davranışını dondurur. UI uygulamaz, canlı rota değiştirmez, sağlayıcı verisine müdahale etmez, dağıtım yapmaz veya ekran kabulü vermez.

Yalnız üç ürün yüzeyi vardır:

1. `/` — Funnel App Home
2. `/ad-analysis` — Ad Analysis
3. `/settings` — Settings

Dashboard, Funnel veya Ad Analysis içindeki bağlamsal görselleştirmedir. Platforms, Settings bölümüdür. Attribution Differences, A6-EO-07-C ve A6-EO-07-D geçtikten sonra Ad Analysis içinde açılacak görünümdür.

## 2. Resmî Shopify sınırı

7 Ekim 2026 tarihinde kontrol edilen kaynaklar:

- App Home: https://shopify.dev/docs/api/app-home/latest
- Web bileşenleri: https://shopify.dev/docs/api/app-home/latest/web-components
- Tablo: https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table
- Modal: https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
- Modal API: https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/modal-api
- Tarih seçici: https://shopify.dev/docs/api/app-home/latest/web-components/forms/date-picker
- Seçim alanı: https://shopify.dev/docs/api/app-home/latest/web-components/forms/select
- Buton: https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- Settings örüntüsü: https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Gizlilik uyumu: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

Uygulama başladığı gün onaylı Polaris sürümü ve her bileşen/özellik yeniden doğrulanır. Ayrı kararlı sürüm geçiş kararı geçene kadar repository'nin onaylı geliştirme sürümü `polaris-2.0-rc.js` olarak kalır.

Kontrol, tablo, bölüm, durum, form ve modallar yalnız resmî Shopify App Bridge ve Polaris web bileşenleriyle kurulur. Referans taslakları ürün niyetini gösterir; özel görünümü kopyalama izni değildir.

## 3. Üç yüzeyin ortak kuralları

- Aktif sağlayıcılar yalnız Meta, Google Ads ve Klaviyo'dur.
- UI yalnız aynı kökendeki BFF yanıtlarını (DTO) tüketir. Tarayıcı sağlayıcı, veritabanı, çalışma alanı, faturalandırma veya silme yetki kaynağı olmaz.
- `zero`, `unknown`, `unsupported`, `partial`, `stale` ve `provisional` ayrı durumlardır.
- Sağlayıcının kendi hiyerarşisi ve en alt öğe kimliği doğru korunur. Ortak görsel tablo, ortak sağlayıcı kabiliyeti uydurmaz.
- Parasal toplama, uyumlu raporlama para birimi ve FX kökeni gerektirir.
- Oranlar önce toplamlar alınarak yeniden hesaplanır; satır yüzdelerinin ortalaması alınmaz.
- Olumlu/olumsuz renk yalnız metrik sözleşmesi hangi yönün iyi olduğunu tanımlıyorsa kullanılır. Sayısal artış otomatik olarak iyi değildir.
- Saatlik yenileme sistemindir. Elle veya sayfa açılmasıyla yenileme kontrolü yoktur.
- Masaüstü ve gerçek Shopify Admin mobil 320 px aynı bilgi mimarisini taşır.
- Yükleniyor, boş, hata, kısmi, desteklenmeyen, eski, geçici ve başarılı durumlar açık metin ve kabul kanıtı gerektirir.

### 3.1. Görselleştirme kararının durumu

- Funnel grafikleri `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md` içindeki kabul edilmiş ilişki odaklı referansı kullanır. Performance; Sales, Revenue ve Spend'i, Intent; Add to Cart, Checkout, Abandoned ve Purchase'ı ilişkilendirir. Bu kabul ürün niyetini ve çizim sınırını dondurur; uygulama yetkisi vermez veya A6-EO-07-B'yi ilerletmez.
- Ad Analysis grafik tasarımı ve uygulaması; A6-EO-07-C her sağlayıcının doğrulanmış en alt analiz öğesini ve iki kesin küpe/cross-sell örneğini Meta, Google Ads ve Klaviyo için ayrı ayrı doğrulayana kadar kapalıdır. Ürün seviyesinde kabiliyeti doğrulanmamış sağlayıcıya tahminî ürün grafiği verilmez.
- Settings'te pano veya analitik grafik yüzeyi yoktur.
- Bu bekleme durumları, dondurulmuş grafik dışı tablo, kontrol ve akış kararlarını engellemez; A6-EO-07 durumunu da ilerletmez.

## 4. Funnel App Home analist brief'i

### 4.1. Kullanıcı sonucu

Mağaza sahibi seçilen raporlama kapsamını Funnel veya metrik tablosu olarak görür; özet/günlük sunum arasında geçer, sağlayıcının doğal hiyerarşisinde filtreler ve geçerli dönemleri sahte eşlik veya sahte sıfır olmadan karşılaştırır.

İlk brief, ilişki grafiklerini ayrıca analist girdisi bekleyen katman olarak ayırmıştı. Bu girdinin kabul edilmiş referansı 3.1 ve 10. bölümlerdedir; referansın kabulü uygulama veya görsel kabul değildir.

### 4.2. Kontroller

Başlık alanındaki ekran etiketleri teknik arayüz kimliği olarak korunur:

- Time range — tarih aralığı
- Compare time range — karşılaştırma aralığı
- Filters — filtreler
- Presentation: Summary veya Daily — özet/günlük sunum
- View: Funnel veya Table — görünüm

`Funnel/Table` ve `Summary/Daily` bağımsız boyutlardır. İlki metriklerin gösterim biçimini, ikincisi zaman sunumunu değiştirir.

### 4.3. Hiyerarşi

- Meta: Campaign → Ad Set → Ad
- Google Search: Campaign → Ad Group → Ad
- Google Performance Max: Campaign → Asset Group → yalnız A6-EO-07-C ile doğrulanmış daha alt öğe
- Klaviyo Campaign: Campaign → Campaign Message → yalnız doğrulanmış Variation
- Klaviyo Flow: Flow → Flow Message → yalnız doğrulanmış Variation

Filtreler aynı kanonik hiyerarşiyi kullanır. Reporting Account yalnız Settings'te değişir; kurulu Shopify mağazası seçilemez. Bu liste analitik görünüm hiyerarşisidir; sağlayıcı API'sindeki bütün dolaşım katmanlarını saymaz ve Variation'ın Channel'ın yerini aldığı anlamına gelmez.

### 4.4. Karşılaştırma

- Özel karşılaştırma aralığı seçilebilir.
- İki aralık eşit takvim günü sayısına sahip olmalı, örtüşmemeli ve aynı çalışma alanı zaman dilimi/raporlama para birimi kurallarını kullanmalıdır.
- Funnel; mevcut, karşılaştırma ve fark değerlerini bilinmeyeni sıfır saymadan gösterir.
- Table yalnız açıkça seçilen metrikleri genişletir. Varsayılan bir metriktir; masaüstünde daha fazlası, mobilde yalnız biri açılabilir.
- Sıfır tabanlı veya hesaplanamayan yüzdesel farklar, uydurma sonsuzluk ya da %100 yerine açık yüzdesiz durumla gösterilir.

### 4.5. Bileşen eşlemesi

| Görünür öğe | Shopify bileşeni/API | Bağlayıcı kullanım |
|---|---|---|
| Sayfa | `s-page` | App Home kökü; yinelenen Funnel menüsü yok |
| Tarih/karşılaştırma açma | `s-button` | Odaklı aralık modalını açar |
| Tarih aralığı | `s-date-picker` | `type="range"`; aralık sunucuda doğrulanır |
| Karşılaştırma ayarı | `s-modal`, `s-date-picker` | Aynı anda tek modal |
| Filtreler | `s-button`, `s-modal`, resmî seçim/form bileşenleri | Yalnız kanonik hiyerarşi |
| Görünüm/sunum kontrolleri | `s-button-group`, `s-button` | İki bağımsız boyut |
| Tablo | `s-table` | Doğal duyarlı tablo/liste davranışı |
| Durum/güncellik | `s-badge`, `s-banner`, `s-text` | Durum yalnız renkle anlatılmaz |

## 5. Ad Analysis analist brief'i

### 5.1. Kullanıcı sonucu

Mağaza sahibi dönem için doğrulanmış en alt analiz öğelerini sıralar; ana tabloyu okunamaz matrise çevirmeden odaklı Intent, Performance ve ürün kanıtını açar.

Ad Analysis, seçilen aralık için tek toplulaştırılmış tablodur. Funnel/Table veya Summary/Daily anahtarı yoktur. Grafik katmanı A6-EO-07-C sağlayıcı öğesini ve ürün/cross-sell kabiliyetini doğrulayana kadar kapalıdır.

### 5.2. Gerçeği yansıtan analiz öğesi

UI etiketi `Analysis item` olur; her sağlayıcı için `Ad name` kullanılmaz.

- Meta yalnız Ad kırılımında doğrulanırsa Ad kullanır.
- Google Search yalnız Ad kırılımında doğrulanırsa Ad kullanır.
- Google Performance Max, Asset Group veya daha alt öğeyi ancak A6-EO-07-C kanıtlarsa kullanır.
- Klaviyo, Campaign Message, Flow Message veya Variation'ı ancak o öğe doğrulanırsa kullanır.

Her satır sağlayıcı, varlık türü, kanonik kimlik ve üst öğe yolunu taşır. Aynı adlar kimlikleri birleştirmez.

### 5.3. Sıralama

Birincil sıralama seçenekleri:

- Purchase
- Sales
- Revenue
- Revenue Margin

Kullanıcıya gösterilen kanonik etiket `Sales` olur; iç anahtar `sales_value` kalabilir. Sales, Revenue, Revenue Margin Value ve Revenue Margin % ayrımı/formülleri A6-EO-06'ya aittir. UI etiketi formül sözleşmesine aykırı olamaz.

Kullanıcı artan/azalan sıralamayı seçebilir. Doğrulanmış sayısal değerler önce sıralanır; `partial`, `unknown` ve `unsupported` sıfıra çevrilmez, ayrı durum gruplarında yer alır. Toplam satırı sıralamaya girmez. Eşitliklerde kararlı kanonik kimlik sırası kullanılır.

### 5.4. Intent ve Performance ayrıntısı

Ana satırda erişilebilir iki resmî eylem vardır: `View intent metrics` ve `View performance metrics`. İkisi de seçilen bölüme odaklanan tek `Analysis details` modalını açar. İki modal aynı anda görünmez.

Intent adayları Add to Cart Rate, Checkout Rate, Abandoned Rate ve Purchase Rate'tir. Performance adayları CTR, CPC, ROAS ve CPS'tir. Pay, payda, destek durumu ve olumlu yön A6-EO-06'dan gelir.

Karşılaştırmada ana tablo yalnız seçilen sıralama/karşılaştırma metriklerini genişletir. Ayrıntı modalı, seçilen satırın desteklenen tüm metriklerinde önceki/mevcut değeri, mutlak farkı ve geçerli yüzdesel farkı gösterebilir.

### 5.5. Reklam içeriği ve ürün kanıtı

Reklam içeriği önizlemesi ile attribution alan/satılan ürün farklı kavramlardır.

- Ana satırın küçük görseli yalnız doğrulanmış sağlayıcı reklam içeriği/asset medyasından alınabilir; yoksa açık yedek gösterim kullanılır.
- Ürün, ancak A6-EO-07-C sağlayıcının döndürdüğü ürün/katalog kimliğini kanıtlar ve kurulu Shopify mağazasının ürün/varyantına kesin eşlerse görünür.
- Shopify görseli bu kimlik eşlemesinden sonra sağlayabilir; görsel attribution oluşturmaz.
- Ürün adı, hedef URL, UTM, `fbclid`, `fbc` veya keyfî Shopify sipariş birleştirmesi ilişkiyi kanıtlayamaz.
- Reklamda olmayan cross-sell ürün ancak sağlayıcı bunu o analiz öğesi için kendi verisinde döndürürse görünür.
- Desteklenmeyen ürün kanıtı desteklenmiyor diye etiketlenir; sıfır gibi gizlenmez.

Ürünler tek ayrıntı modalında görsel, ürün/varyant kimliği, adet, değer, kaynak ve destek durumu içeren kısa listede gösterilir. Her tablo satırı içinde ayrı ayrı genişlemez.

### 5.6. Bileşen eşlemesi

| Görünür öğe | Shopify bileşeni/API | Bağlayıcı kullanım |
|---|---|---|
| Sayfa | `s-page` | `/ad-analysis` |
| Aralık/karşılaştırma/filtre açma | `s-button` | Funnel ile aynı anlam |
| Sıralama metriği | `s-select` | Sözleşmeye dayalı dört seçenek |
| Sıralama yönü | `s-button` | Erişilebilir artan/azalan etiketi |
| Ana sonuçlar | `s-table` | Küçük ekranda duyarlı liste |
| Intent/Performance eylemi | `s-button` | İkon etiketi destekleyebilir; yerini alamaz |
| Ayrıntılar | tek `s-modal` | Odaklı bölüm; eşzamanlı modal yok |
| Durum | `s-badge`, `s-banner`, `s-text` | Destek/güncellik/geçicilik metni |

## 6. Settings analist brief'i

### 6.1. Referans davranış

Çalışan eski `ads-table-dev` Settings kullanıcı akışı etkileşim referansıdır. Kaynak kodu, özel görünüm, eski menü, test/kabul panelleri ve emekli sağlayıcılar aynen taşınacak varlıklar değildir.

Şu davranışlar bozulmamalıdır:

- Connect ve sağlayıcı açıklaması
- OAuth'tan Settings'e dönüş
- Resume setup
- doğrulanmış hesap seçimi
- Connected, yeniden bağlanma ve bağlantıyı kesme durumları
- Reporting Account seçimi
- Klaviyo Email Monthly Plan Cost geçmişi ve düzeltme davranışı

Kanıtlanmış bir adım ayrı ürün kararı ve davranış doğrulama kanıtı olmadan yeniden tasarlanamaz, adlandırılamaz veya kaldırılamaz. Settings'in grafik gereksinimi yoktur.

### 6.2. Bölüm sırası

Ekran başlıkları korunur:

1. Reporting Currency
2. Provider Connections and Reporting Accounts
3. Subscription
4. Data & Privacy

Kurulu Shopify mağazası yalnız salt okunur bağlam olarak gösterilebilir; ayrı bölüm, seçici veya değiştirme kontrolü değildir.

### 6.3. Kurulu mağaza yetkisi altında Reporting Account etkinleştirme

Reporting Account değişikliği önce hazırlanır; anında etkinleşmez.

1. Hesap sahipliği doğrulanır, hesaptaki sağlayıcı varlıkları keşfedilir.
2. Hesap raporlama yetkisi almadan önce kurulu Shopify mağazasına kesin kapsamı kanıtlanır.
3. Kapsam yoksa, belirsizse veya başka mağazaya aitse mevcut raporlama yetkisi korunur. Önerilen hesap bağlı kalabilir; fakat Dataset V2 yazamaz veya SnapshotJob alamaz.
4. Geçmiş veri korunur, yeniden etiketlenmez.

Kurulu mağaza yalnız doğrulanmış uygulama kurulumundan gelir. Sağlayıcı hesabı, piksel, alan adı veya kullanıcı girdisi bunu değiştiremez. İkinci Shopify mağazası ayrı uygulama kurulumu, çalışma alanı ve abonelik ister.

### 6.4. Abonelik

Settings; Shopify'ın yetkili planını, `$24.99/month` herkese açık plan fiyatını, 14 günlük deneme durumunu/bitişini, mevcut fatura dönemini ve kullanım hakkını gösterir. Abonelik kurulu mağazaya aittir; ikinci mağaza ayrı kurulum ve abonelik ister. Bu, kabul edilmiş ürün planı kaydıdır; yeni fiyat araştırması değildir.

AdsTable Shopify ödeme ekranını taklit etmez veya özel fiyatlandırma işlemi barındırmaz. `Manage subscription`, Shopify'ın barındırdığı plan yüzeyine gider. Abonelik mevcut Shopify App Pricing yetkili kaynağından doğrulanır; yönlendirme parametreleri tek başına kullanım hakkı değildir.

### 6.5. Data & Privacy

`Delete my data`, uygulama kuruluyken kullanılabilir; Disconnect ve Uninstall'dan ayrıdır.

- İlk onay kapsamı, erişimin durmasını, kimlik bilgilerinin kaldırılmasını, Dataset silmesini, hukuki saklama istisnalarını ve yürütme başladıktan sonraki geri döndürülemezliği açıklar.
- Sunucuda doğrulanmış ikinci açık onay gerekir.
- Onaylar sıralıdır; iki modal birlikte açılmaz.
- Talep kabul edilince yeni sağlayıcı işlemleri ve SnapshotJob'lar asenkron manifest yürütmesinden önce durur.
- İlerleme ve nihai tamamlanma kullanıcıya görünür.
- Çalışma alanı kimliği yalnız doğrulanmış Shopify oturumundan gelir.

Uninstall erişimi durdurur. Verinin karartılmasını Shopify uyum webhook'ları ve onaylı saklama/silme manifesti yönetir; kaldırma, Delete my data anında tamamlandı diye sunulmaz.

### 6.6. Bileşen eşlemesi

| Görünür öğe | Shopify bileşeni/API | Bağlayıcı kullanım |
|---|---|---|
| Sayfa/bölümler | `s-page`, `s-section`, `s-stack`, `s-grid` | Resmî Settings örüntüsü |
| Sağlayıcı/mağaza/abonelik durumu | `s-badge`, `s-banner`, `s-text` | Metin ve ton birlikte; yalnız renk değil |
| Sağlayıcı/hesap/mağaza eylemleri | `s-button`, `s-select` ve resmî seçim kontrolleri | Sunucu izin listesi ve sahiplik yeniden doğrulaması; mağaza seçici yok |
| Klaviyo maliyeti | resmî sayı/seçim/form bileşenleri | Geçerlilik tarihli sunucu sözleşmesi |
| Abonelik yönetimi | `s-button` gezinme | Shopify'ın barındırdığı plan yüzeyi |
| Delete my data | `s-button tone="critical"`, sıralı `s-modal` | İki açık onay |

## 7. Durum matrisi

Durum adları teknik kimlik olarak korunur; açıklamaları Türkçedir.

| Durum | Funnel | Ad Analysis | Settings |
|---|---|---|---|
| Loading | Sahte değer olmadan yükleme iskeleti/durumu | Yüklenen tablo/liste | Doğrulanmış çalışma alanı yükleniyor |
| Empty | Seçilen kapsam/aralık için satır yok | Doğrulanmış analiz öğesi yok | Gerekli kurulum eylemi |
| Partial | Kesin sağlayıcı/metrik kapsam uyarısı | Satır/metrik destek durumu | Eksik sağlayıcı/mağaza topolojisi |
| Unsupported | Desteklenmeyen metrik/varlık etiketlenir | Sağlayıcı öğesi/ürün desteklenmiyor | Kontrol gerekçeyle kaldırılır veya kapatılır |
| Stale/provisional | Güncellik/kesinleşme gösterilir | Güncellik/kesinleşme gösterilir | Bağlantı/iş inceleme mesajı |
| Error | Güvenli yeniden deneme/referans; ham sağlayıcı hatası yok | Güvenli yeniden deneme/referans | Başarısız değişiklikte mevcut yetki korunur |
| Success | Veri ve kapsam görünür | Sıralanmış doğrulanmış öğeler görünür | Kaydedilmiş sunucu-yetkili durum görünür |

## 8. Kabul ve sıralama

- Bu karar A6-EO-07'yi Ready veya Done yapmaz; A6-EO-01–06'yı atlamaz.
- A6-EO-07-A, eski akışın davranış doğrulamasını kullanır; Settings kaynak kodunu taşımaz.
- A6-EO-07-B, BFF/sorgu/formül sözleşmeleri oluştuktan sonra Funnel'ı uygular; ilişki grafikleri ayrıca onaylı ürün sahibi grafik referansına tabidir.
- A6-EO-07-C, A6-EO-07-D öncesinde en alt kırılım ve cross-sell kabiliyetini dondurur.
- A6-EO-07-D yalnız doğrulanmış öğe/ürün kabiliyetini uygular. Grafikler, A6-EO-07-C her sağlayıcının iki kesin küpe/cross-sell örneğini kapatana kadar bekler.
- A6-EO-07-F; anayasa/sözleşme testleri, masaüstü Shopify Admin, gerçek 320 px mobil, erişilebilirlik ve açık ürün sahibi kabulü ister.
- Ekranın görünmesi veya yalnız başarılı yolun çalışması kabul değildir.

## 9. Açıkça kapsam dışı

- UI kaynak değişiklikleri
- Sunucu/BFF/sağlayıcı uygulaması
- Veritabanı migration'ı
- Faturalandırmayı etkinleştirme
- Gizlilik silmesini yürütme
- Dağıtım veya Production değişikliği
- A6-EO-07 durumunu ilerletme
- Eski yapıyı emekliye ayırma

## 10. Kabul edilmiş Funnel görselleştirme referansı

Bağlayıcı referans `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md`, yürütülebilir sözleşme `contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json` dosyasıdır.

- Performance ilişkisi: Sales, Revenue ve Spend.
- Intent ilişkisi: Add to Cart, Checkout, Abandoned ve Purchase; adet ve değer ayrı alanlardır.
- Mevcut seri düz, karşılaştırma serisi kesik çizgilidir.
- Renk/ok yönünün anlamı yalnız sayısal işaretten değil A6-EO-06 metrik sözleşmesinden gelir. Spend, sonuç bağlamı olmadan nötrdür; CPC, CPS ve Abandoned metriklerinde düşüş olumludur.
- Grafik, seçili nokta ayrıntısı, KPI özeti ve tablo aynı BFF/sorgu/formül kaynağını kullanır.
- Yalnız grafiğin veri çizim düzleminde SVG veya Canvas kullanılabilir; çevresindeki UI resmî Polaris/App Bridge olarak kalır.
- Ad Analysis grafik çalışması A6-EO-07-C ve sağlayıcıya özel ürün/cross-sell kanıtını bekler.
- Bu referans yeni paket açmaz, paket durumu değiştirmez, uygulama veya canlı değişiklik yetkisi vermez.
