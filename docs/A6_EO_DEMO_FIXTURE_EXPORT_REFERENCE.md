# A6-EO — Demo veri örneği, dışa aktarma referansı ve Shopify dev store sınırı

**Durum:** Karar donduruldu; veri çıkarımı ve uygulama bekliyor

**Karar tarihi:** 7 Ekim 2026

**Yürütülebilir sözleşme:** `contracts/a6-eo-demo-fixture-export-reference-v1.json`

**Okuma notu:** Bu belge kabul edilmiş referans kararını kaydeder. Demo veri çıkarılmış, dışa aktarma uygulanmış, kapasite kanıtlanmış veya dev store oluşturulmuş sayılmaz. Güncel sıra `docs/EXECUTION_PLAN.md` içindedir; tarihsel kaynak/inceleme kaydı bu dil çalışmasında yeniden yürütülmez.

## Karar

Eski pano demosu değerli ham malzemedir; uygulama modülü veya sağlayıcı kanıtı değildir. AdsTable HTML/JavaScript'i yeni gömülü çalışma zamanına kopyalamak yerine temiz, sürümlü bir test veri örneği (fixture) çıkaracaktır.

Veri örneğinin dört onaylı amacı:

1. Funnel ve Ad Analysis UI kabulü.
2. Gelecekteki CSV/XLSX dışa aktarma sözleşmesine referans.
3. Yalıtılmış Shopify dev store demo çalışma alanı.
4. 2,000/4,000 çalışma alanlı kapasite üreticisi için tekrarlanabilir başlangıç verisi.

Meta, Google Ads veya Klaviyo API davranışını, sağlayıcının kendi attribution'ını, kesinleşmeyi, gerçek sıfırı, ürün attribution'ını veya cross-sell'i kanıtlayamaz.

## Veri kökeni

- Repository: `fyilanli-oss/ads-table-dev`
- Referans: `main`
- Dosya: `codex-input/adstable_one_funnel_compare_all_v2_75_safe_clean_pass8_markup_cleanup-1.html`
- Git blob: `87413af1318cbdb3efbe1104e283d7294bc0c219`
- SHA-256: `fece0e65ac8c2d20c440d0f98cd510449bd170cf5beccf33e4a6c2cab4db9c35`
- Boyut: 751,960 bayt
- Taşıma kuralı: yalnız referans/test verisi ham malzemesi; kaynak aynen taşınmaz ve çalışma zamanı bağımlılığı olmaz.

## İncelenen envanter

Kaynak içindeki `SOURCE_ROWS` veri kümesi şunları içerir:

- 1,000 satır, yaklaşık 458,500 bayt JSON.
- 1 Haziran–20 Temmuz 2026 arasında 50 takvim günü.
- Yalnız USD kaynak satırları.
- Meta 250, Google 250, Klaviyo 150, TikTok 250, Direct 50 ve Others 50 satır.
- 700 ücretli ve sağlayıcı adıyla etiketlenmiş 300 organik satır.
- Tarih/platform/trafik/Campaign/grup/Ad boyutları.
- Gösterim, reklam tıklaması, harcama, sepete ekleme, ödeme adımı, satın alma ve değer girdileri.
- Eski abandoned, profit, CTR, CPC, CPS ve ROAS beklenen sonuçları.

Eski sayfada Funnel, Funnel Table, Intent Analysis ve Top Selling Ads için CSV/XLSX davranışı da bulunur. Bu adlar kaynak referansıdır; yeni ürün yüzeyi açmaz.

## Zorunlu uyarlama sınırı

Kaynak biçimi Dataset V2 değildir:

- TikTok, Direct ve Others aktif üç sağlayıcılı ürün sınırının dışındadır.
- Sağlayıcı adıyla etiketlenmiş organik trafik, sessizce gerçek ücretli sağlayıcı raporu diye sunulmaz.
- Klaviyo genel Campaign/AdGroup/Ad yapısına zorlanamaz.
- Google Standard ve Performance Max ayrı doğal hiyerarşi ister.
- Meta, Campaign/Ad Set/Ad ister.
- Çalışma alanı, kurulu Shopify mağazası, sağlayıcı hesabı, zaman dilimi, destek, güncellik, kesinleşme, FX ve veri kökeni alanları eklenmelidir.
- Eski hesaplanmış metrikler gerçek diye kopyalanmaz; EO-06 bunları ham girdilerden yeniden hesaplar.
- Yapay sıfır yasaktır. Değer yalnız veri örneği açıkça desteklenen sıfır diyorsa sıfırdır; aksi halde bilinmeyen veya desteklenmeyendir.
- Bütün kimlikler veri örneği/çalışma alanı/sağlayıcıya özel ad alanlarında ayrılır.

Her normalleştirilmiş demo satırı görünür ve yapısal olarak şöyle işaretlenir:

```text
data_origin = synthetic_demo
provider_truth = false
workspace_kind = demo
```

## İki veri örneği modu

### Değişmez referans veri — golden fixture

Özgün sabit tarih aralığı; sözleşme testleri, formülün beklenen sonuç testleri, dışa aktarma görüntüleri ve UI geriye dönük uyumluluk testleri için korunur. Tarihleri asla kaydırılmaz.

### Kayan demo verisi — rolling demo fixture

Tekrarlanabilir bir gösterim, referans veriyi demo saatine taşırken göreli aralıkları ve karşılaştırma ilişkilerini korur. Yalnız Shopify demo mağazası içindir; değişmez referans veriyi değiştirmez. UI bunu görünür biçimde sentetik demo verisi olarak etiketlemelidir.

## Dışa aktarma referansı

Dışa aktarma ilk Shopify review uygulama kapsamının dışındadır. Referansı bugün kaydetmek uygulamayı başlatmaz.

Gelecekteki sözleşme için korunan aday davranışlar:

- CSV: açık dönem, hiyerarşi/varlık, metrik, önceki, mevcut ve fark içeren makinece okunabilir uzun satırlar.
- XLSX: insanın okuyacağı mevcut görünüm veya geniş analiz matrisi.
- Funnel Table CSV/XLSX: ekranda görünen aynı matris.

Nihai şema burada bilinçli olarak dondurulmaz. Gelecekte uygulama; açık onay, formül/UI eşliği, sayısal türde XLSX hücreleri, CSV enjeksiyon koruması, yetkilendirme, sınırlı asenkron üretim, denetim/sona erme ve gizli sağlayıcı içeriği taşımama şartlarına bağlıdır.

## Shopify dev store kabulü

7 Ekim tarihsel resmî kaynak kontrolünde; gerçekçi uygulama testi, isteğe bağlı üretilmiş demo ticaret verisi ve kuruluşa ait uygulama kurulumu için geliştirme mağazası desteği kaydedilmiştir. AdsTable ayrı bir dev mağazası ve ayrı demo çalışma alanı kullanacaktır. Bu belge bunların bugün oluşturulduğu anlamına gelmez.

Demo çalışma alanı:

- gerçek mağaza sahibinin çalışma alanını yeniden kullanmaz;
- gerçek sağlayıcı token'ı gerektirmez;
- sağlayıcıyı sahte biçimde bağlı göstermez;
- analitik verinin tamamını sentetik diye etiketler;
- Settings'te gerçek bağlantıyla demo verisini ayırır;
- tekrarlandığında çoğalmayan yükleme/sıfırlama destekler;
- korunan gerçek müşteri verisi içermez;
- gömülü UI ve yaşam döngüsünü gösterir; canlı sağlayıcı doğruluğunu kanıtlamaz.

Shopify'ın ürettiği mağaza verisi ve AdsTable analitik veri örneği ayrı kümelerdir. Ürün kimliği veya görseli ancak daha sonra açık bir veri örneği sözleşmesiyle eşlenebilir.

## Ürün ve cross-sell sınırı

Kaynakta ürün kimliği, görsel, sipariş satırı adedi veya reklamda gösterilen/diğer ürün kanıtı yoktur. Küpe/cross-sell senaryosunu karşılayamaz. Kanıta bağlı ayrı ürün veri örneği EO-07-C'ye aittir. Sentetik ürün verisi UI sunumunu test edebilir; sağlayıcının gerçek kabiliyetinin kabulü yine hassas alanları çıkarılmış canlı ham kanıt gerektirir.

## Kapasite kullanımı

1,000 satır bir üretici başlangıcıdır; kapasite testi değildir. Tekrarlanabilir üretici, çalışma alanı/mağaza/hesap/hiyerarşi kimliklerini ayrı ad alanlarına koyar; yenileme başına satır, tarih yoğunluğu, hiyerarşi genişliği, seyrek alanlar ve değer dağılımlarını korur.

Mevcut kapasite sözleşmesiyle 2,000 çalışma alanı belgelendirme ve 4,000 çalışma alanı stres yükü üretilir. Müşteriler arası kimlik çakışması kesin test hatasıdır. Bu hedefler burada test edilmiş kapasite iddiası değildir.

## Paketlere aktarım

- EO-05-B: değişmez/kayan Dataset V2 demo verisini çıkarma, doğrulama ve normalleştirme.
- EO-06-A/B: formül, tarih, filtre ve karşılaştırma doğrulamaları.
- EO-07-B: Funnel UI kabulü.
- EO-07-C: ayrı ürün/cross-sell veri örneği.
- EO-07-D: Ad Analysis UI kabulü.
- EO-08-C: kapasite üreticisi ve geri yükleme/yük provası.
- EO-08-D: Shopify dev store gömülü uçtan uca kabulü.
- Dışa aktarma: gelecekte açık onaylı review sonrası paket.

Bu karar üst paket açmaz veya mevcut paket durumunu değiştirmez. Kendi başına veri çıkarma, UI/dışa aktarma uygulaması, dev store oluşturma/kurma veya canlı değişiklik yetkisi vermez.

## 7 Ekim 2026 tarihinde kontrol edilen resmî kaynaklar

- [Shopify geliştirme mağazaları](https://shopify.dev/docs/apps/build/stores/development-stores)
- [Shopify üretilmiş test verisi](https://shopify.dev/docs/storefronts/themes/tools/development-stores/generated-data)
- [Review için uygulama kurma ve test](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
- [Dağıtılan uygulamayı dev store'da test](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service)
