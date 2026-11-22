# EO-05A günlük refresh sözleşmesi

Karar ve kanıt tarihi **21 Kasım 2026**. Bu belge, AdsTable’ın Google Ads, Klaviyo ve Meta günlük refresh akışının işletim kurallarını ve kabul ölçütlerini tanımlar. Makine kaydı [global refresh sözleşmesinde](../contracts/eo-05a-global-refresh-design-v1.json#daily_refresh_operating_contract_2026_11_21), uygulama sırası [Execution Plan’da](EXECUTION_PLAN.md), ham kanıt ve ürün eşleme sınırları [ham kayıt anayasasında](RAW_SOURCE_CONSTITUTION.md) yer alır. Erişim ve bağlantı kararları için [OAuth anayasası](OAUTH_FLOW_CONSTITUTION.md) geçerlidir.

## 0. Günlük kapsam ve zaman

- **Normal okuma günde bir kez, kapanmış gün içindir.** Mağazanın seçili raporlama hesabı ve doğrulanmış IANA saat dilimi üzerinden son kapanmış iş günü belirlenir. Başlangıç yerel gece yarısı, bitiş bir sonraki yerel gece yarısıdır. Saat değişimi olan günlerde takvim sınırları esas alınır. Provanın ortak gününde üç hesap UTC kullandı.
- **Kuyruk kontrolü ile veri okuma ayrı takvimlerdir.** Mevcut kuyruk kontrolü, vadesi gelen işi keşfetmek için dakikalık kontrol modelini tanımlar. Günlük iş yükü günde bir kapanmış günü hedefler. Eski tasarımın `workspace_refresh_interval_seconds: 3600` ve `hourly_hot_window` kayıtları tarihsel kapsamdır. Geçerli normal ürün kararı günlük refresh’tir. Canlı ve düşük ticaret hacimli çalışma saatinin seçimi açık karardır.
- **Tarih kaynağı** yetkili raporlama hesabı, sağlayıcının iş günü, bağlantının ve seçim döneminin başlangıcı, mevcut veri boşlukları ve çalıştırma zamanıdır. Gelecek gün, açılmış gün, bağlantı ya da seçim başlangıcını kesen gün, bilinçli disconnect boşluğu ve geçersiz saat dilimi normal yayın hattına alınmaz. Sağlayıcıya özgü ilk gün ham gözlemi varsa, yalnız ilgili ham kanıt kuralıyla saklanır. Rapor uygunluğu ayrıca kanıtlanır.
- **Normal yayın ile geçmiş düzeltme ayrı işlerdir.** Geç dönüşüm veya sağlayıcı revizyonu için herkese uygulanan sabit bir atıf penceresi varsayılmaz. Okuma tarihi, rapor iş günü, native atıf zaman temeli ve gözlem zamanı ayrı tutulur. Geçmiş yeniden okuma için sağlayıcı bazında pencere, sıklık, gerekçe, maliyet ve olgunluk kararı gerekir. Normal günlük akış bu işleri otomatik açmaz.
- **Günün kapanışı sağlayıcı hesabı başınadır.** Google Ads, Klaviyo ve Meta ayrı yetkiye, iş emrine, ham zarflara, yayın makbuzuna ve ilerleme kaydına sahiptir. Mağaza düzeyinde bütün bağlı ve beklenen işler doğrulanınca ortak koşu tamamlandı denir. Tek sağlayıcı kapanması diğer sağlayıcının durumunu ilerletmez.

## 1. Kuyruğa alma

1. İş tetikleyicisi kendi yetkisi, nesli ve veritabanı saatiyle kontrol edilir. Aynı zaman dilimindeki tekrar tetikleme, güncel olmayan nesil ve geçersiz saat ayrı sonuçlardır.
2. Veritabanı, sınırlı ve tam envanterden aktif mağaza, kurulum nesli, sağlayıcı bağlantısı, raporlama hesabı, seçim sürümü, hazır olma durumu, gün ve uygunluk sınırını okur.
3. Vade ve sıra bilgisi mağaza, sağlayıcı ve raporlama hesabına bağlanır. Bekleyen iş yaşını korur. Tekrarlanan tarama aynı işi çoğaltmaz. Kaçırılmış dönemler görünür boşluk olarak tutulur ve uygun işler birleştirilir.
4. Kuyruk revizyonu ve başarılı tarama makbuzu aynı PostgreSQL işlemiyle kaydedilir. Envanter eksikse, boyut veya süre sınırı geçilmişse ya da revizyon uyuşmazsa tarama geçerli kabul edilmez.
5. **Çıkış kanıtı** güncel kuyruk revizyonu, başarılı tarama zamanı, bekleyen işlerin kimliği ve uygunluk verisidir. Kuyruk makbuzu bir rapor veya tazelik makbuzu yerine geçmez. [Kuyruk kontrolü](../contracts/eo-05a-refresh-queue-check-v1.json) · [Zamanlanmış tarama](../contracts/eo-05a-refresh-scheduled-queue-check-v1.json)

## 2. Kuyruk kontrolü ve işin çalışmaya alınması

### 2.1. Ön kontrol ve bütçe

1. Başarılı taramadan sonra kesintiye uğramış işler gerçek veritabanı saati ve saklanan son aşamayla incelenir. İnceleme doğrulanamazsa yeni dağıtım başlamaz.
2. Güncel aday revizyonu, sıra yaşı, mağazalar arası adalet, mevcut claim sayısı, ayrılmış bütçe, kullanıcıya ayrılan kapasite ve durdurulmuş hesaplar okunur.
3. İş planı açıkça gün, iş bölümü kimliği (`partitionId`), iş sınıfı, azami istek, satır, bayt, bağlantı, veritabanı yazımı, istek zaman aşımı, son tarih ve kapanış rezervi verir. Global, sağlayıcı, mağaza ve raporlama hesabı kotaları birlikte değerlendirilir. Kapasitesi veya sınırı doğrulanamayan iş bekler.
4. Claim, bütçe rezervasyonu, kuyruk revizyonu, hesap bağlantısı, iş günü, son tarih ve eski iş sahibini geçersiz kılan `fence` tek kısa PostgreSQL işlemiyle bağlanır. Aynı mağaza, kurulum nesli, sağlayıcı ve hesap için tek aktif iş kabul edilir.

### 2.2. İşin çalışma yetkisi

1. İş `checking_authority` aşamasına geçer. Güncel mağaza, kurulum, hesap, bağlantı sürümü, kapsamlar, seçim ve izinli gün yeniden doğrulanır.
2. Sağlayıcı işi başlamadan mevcut Shopify abonelik doğrulaması yapılır. Dış çağrı niyeti önce `request_intent` olarak kaydedilir. Shopify Partner kota yolu, veritabanındaki sınıra göre ayrılır. Yanıt mağazaya ve güncel claim’e bağlanır. Aktif ücretli dönem veya geçerli deneme ve saklanmış doğrulama makbuzu gerekir.
3. Hazırlık sırasında kalan süre, sağlayıcı istek sınırı ile kapatma rezervinin toplamını karşılamıyorsa yeni dış çağrı açılmaz. Kapanış rezervi sabit beş saniye varsayımıyla belirlenmez. İş türü, sağlayıcı ve kanıtlanmış süre ölçüleriyle ayrı kabul edilir.
4. Sağlayıcıya gitmeden önce bağlantı sürümü, claim/fence ve güncel abonelik makbuzu tekrar okunur. Bu kontrol sonradan dönen eski bir işin yazma yetkisi kazanmasını engeller. HTTP çağrısı boyunca veritabanı yazım işlemi açık tutulmaz. [Ön kontrol](../contracts/eo-05a-refresh-preflight-bridge-v1.json) · [Abonelik](../contracts/eo-05a-refresh-entitlement-check-v1.json)

## 3. Sağlayıcıdan veri çekme ve işleme

### 3.1. Her dış istek için ortak sıra

1. İşin güncel claim’i, bağlantı ve kapsamı, izin süresi, iş bölümü ve zaman bütçesi kontrol edilir. İstek türü ve gerçek hesap bilgisi veritabanındaki doğrulanmış kota yoluna çözülür.
2. İstek için kota ayrılır. Kota kararı, güncel yetki ve zaman yeniden doğrulanır. Kota beklemesi daha gönderimden önce kanıtlandıysa iş `quota_waiting` olabilir. Doğrulanmamış kota kapsamı ve belirsiz gönderim ayrı durumlardır.
3. Yalnız sabit sorgu ailesi, izinli alan listesi ve kapatılmış gün kullanılır. Zaman aşımı, istek ve sayfa sayısı, satır ve bayt sınırları izlenir. Aynı cursor yeniden görülürse, sıra bozulursa veya sayfa eksikse toplama durur.
4. HTTP sonucu ve izinli üstveri sınıflandırılır. Kesin yanıt alınan kotanın kaydı kapatılır. Başarısız ya da belirsiz yanıt için mevcut durdurma kuralı uygulanır. İlk provider hatası otomatik tekrar, farklı kimlik veya farklı yol için onay oluşturmaz.
5. Sayfa hesap ve gün bakımından eşleştirilir. Sayıların hassasiyeti, para birimi, kaynak saat dilimi, native kimlik, hiyerarşi ve gözlem durumu korunur. İstek kimliği ve güvenli hata kodu dışında token, header içeriği, rastgele sağlayıcı gövdesi ve kişisel veri iş kaydına taşınmaz.

### 3.2. Sağlayıcıya özgü toplama

| Sağlayıcı | Alt akış ve başarı kanıtı | Açık sınır |
|---|---|---|
| Google Ads | Yetkili reklam hesabı ve doğrulanmış kaynak sürümü. Mevcut dokuz hesap/kampanya ve sekiz ürün/performans sorgu ailesi. Bağlama göre Merchant ürün bağlantısı. Hesap gözlemleri, Shopping ve Performance Max kaynak ayrımı, kaynak sayfaları ve paket kapsaması. Satış rolleri için ayrı reklamı yapılan ürün ve satılan ürün native alanları. | Merchant bağlantısının eksikliği ürün adedini sıfırlamaz. Dönüşüm günü ve etkileşim günü birbirinin yerine kullanılmaz. Geçmiş Performance Max hiyerarşisi ve canlı eşleme, kendi kanıt şartlarına bağlıdır. |
| Klaviyo | Hesap ve yapılandırma, `Placed Order`, `Added to Cart`, `Checkout Started` ve Shopify entegrasyonlu `Ordered Product` metric keşfi. Campaign ve Flow raporları ile `Ordered Product` olay sayfaları. Hesap, metric, olay, mesaj ve gerektiğinde ilişkili kampanya/akış kanıtı kendi native hiyerarşisinde tutulur. | Shopify metric’i eksikse sonuç kullanılamaz sayılır. Campaign veya Flow toplamı ürün satışı olarak çoğaltılmaz. Olay ve Shopify siparişinin eşleşmesi ayrı kanıt ister. |
| Meta | İzin doğrulaması, hesap/reklam Insights ve ayrı `product_id` kırılımı. İki ham veri seti ayrı alınır. Opaque cursor doğrulanır ve sorgu yeniden güvenli biçimde kurulur. Reklam, reklam seti, kampanya, gösterim, tıklama ve harcama kaynak alanlarında kalır. | Native rapor `product_id` alanının Shopify kataloğu ile gerçek bağı ve dönüşüm alanlarının satış rolleri **gerçek veri bekleniyor** durumundadır. Sentetik eşleme yalnız teknik bağı kanıtlar. |

Mevcut native sorgu ve izinli alan listelerinin otoritesi, [ham kayıt anayasası](RAW_SOURCE_CONSTITUTION.md) ve [sorgu standardıdır](../contracts/pd-cpd-query-standard-v1.json). İzole provada API yanıtları sentetik, bağlantı ve kota kontrollerinin PostgreSQL işlemleri gerçektir.

## 4. Ham kaydı depoya yazma ve doğrulama

1. Toplanan veri, sağlayıcı, hesap, mağaza, kurulum, bağlantı ve seçime bağlı ayrı ham zarflara ayrılır. İş emri, fence, gün, deneme kimliği, paket ve sayfa sırası, sorgu ailesi, şema, kaynak ve alan kapsamı ilişkilendirilir.
2. İzinli izdüşüm ve kaynak referansları hazırlanır. İçerik özeti, anahtar sürümü, nonce ve doğrulama etiketi üretilir. Şifreli sayfalar mağaza ve sahiplik bağlamıyla doğrulanabilir tutulur. Sayıların özgün hassasiyeti korunur.
3. SQL yazmadan hemen önce yetki, izin süresi, iş zamanı, bağlantı ve kota bağlamını kontrol eder. Dar yetkili işlem ham zarfı, sayfaları ve referansları birlikte kaydeder. Aynı deneme ve sıra ile farklı içerik gelirse kayıt çakışması olur.
4. Bilinen yazma yanıtında ham makbuz tekrar okunur. Makbuz eşitliği, sıra, kapsam, sayfa adedi, fazladan sayfanın olmaması, şifre çözümü, içerik özeti ve saklama durumu kontrol edilir.
5. Ham yazma gönderilmiş ve sonuç bilinmiyorsa otomatik yazma veya otomatik okuma tekrarı yapılmaz. Kısmen saklanan veri setinin makbuzu korunur. Tam gün başarısı ancak bütün gerekli kaynaklar doğrulanınca mümkündür.

## 5. Ham kayıttan rapor işine geçiş

1. Bilinen dış sonuç `response_received` olarak kaydedilir. Sayfa ve veri seti kapsamı, gerekli aileler, satır ve bayt sınırları kontrol edilir.
2. Geçişten önce güncel mağaza, hesap, bağlantı sürümü, abonelik, fence ve kapanış rezervi yeniden doğrulanır. Kontrol başarısızsa rapor yazımı yetkilendirilmez.
3. PostgreSQL iş aşaması `ready_for_dataset` olur. Uygulama `awaiting_dataset` sonucu ve doğrulanacak ham makbuz kimliklerini taşır. Bu aşamada iş bütçesi ayrılmış kalır ve rapor checkpoint’i ilerlemez.
4. Dataset yazıcısına yalnız aynı claim, fence ve pencereye bağlı güvenilir iç plan gider. Tarih, iş ya da sahiplik uyuşmazlığı yazımı durdurur. [İş çalıştırıcı sözleşmesi](../contracts/eo-05a-refresh-chunk-worker-v1.json)

## 6. PostgreSQL’den ham kayıt ve kaynak kanıtını okuma

1. Dar yetkili Dataset okuyucusu güncel sahipliği ve kaynak bağlamını sorgular. Ham makbuzları deneme kimliği ve sırasıyla okur. Doğru sağlayıcıya, işe, fence’e, seçime ve güne ait olduklarını doğrular.
2. Gerekli veri setlerini, paket sırasını, sayfa hash’lerini, şifre çözümünü, kapsamı, kaynak zamanlarını ve bağlantı uygunluğunu yeniden doğrular. Eksik, kısmi, silinmiş, süresi bitmiş veya başka işten gelen kanıt yazıcının girdisi olamaz.
3. **Çıkış kanıtı** içerik ve kapsamı doğrulanmış veri demeti, kaynak batch ve sayfa referansları, kaynak bağlam özeti, saat dilimi, iş günü ve ilgili saatlerdir. Ham yazma sırasındaki ilk geri okumadan ayrı ölçülür.

## 7. Rapor hazırlığı ve uygulama işlemleri

1. **İzdüşüm.** Sabit sağlayıcı dönüştürücüsü doğrulanmış sayfalardan Dataset’e uygun reklam/kanal performansı, ürün performansı ve kanıtlanabilir ürün satış satırlarını üretir. Kampanya, reklam seti/grubu, reklam, ürün ve native yanıt hiyerarşisi korunur. Veri setinde ürün düzeyi korunur. Varyant kanıtı varsa ürün eşlemesini doğrulamada kullanılır.
2. **Kimlik.** Native satır anahtarı, kaynak zamanı, iş günü, para birimi, grain sürümü ve içerik özeti hesaplanır. Bir olayın native kimliği ve zaman hassasiyeti korunur. Yinelenen native anahtar, kapsam uyuşmazlığı veya kayıtlar arası çakışma bildirilir.
3. **Shopify Product ID.** Eşleme aynı mağaza, kurulum nesli, sağlayıcı, raporlama hesabı, bağlantı ve seçim altında doğrulanır. Exact native kimlik, namespace ve kapsam kanıtı aranır. Aktif eşleme revizyonu, geçerli kaynak kuralı, okunan kanıt ve doğrulanmış Shopify Product ID beraber gerekir. Varyant kanıtı varsa varyantın o ürüne ait olması gerekir. Eşleme bulunamazsa native ürün bilgisi korunur. SKU, ad veya çıplak sayı benzerliğinden eşleme yapılmaz. Google satılan ve reklamı yapılan ürününü ayrı doğrular. Meta canlı eşleme kararı gerçek veri bekler.
4. **Veri durumları.** Eksik, bilinmeyen, desteklenmeyen, kısmi, eski, kullanılamaz ve gerçek sıfır ayrı korunur. Doğrulanmış boş sonuç sıfır için kanıt olabilir. Başarısız istek, eksik metric veya yarım sayfalama sıfır üretmez. Yerel para birimi ve native değerler korunur. Uygulanabilir kur bağlama şartı varsa kanıtı ayrı doğrulanır.
5. **Paketleme.** Aynı iş emri, gün, başlatma zamanı, kaynak bağlamı, atomik yayın ve saklama politikasıyla paketler hazırlanır. Sıra, satır ve bayt sınırları doğrulanır. Paketin satır sınırı 200’dür. Ortak provada sağlayıcı başına 1.000 satır tam beş paket oluşturdu. Günlük gerçek iş yükünün paket sayısı ve sınırı kabul edilmiş yazıcı profiline tabidir.

## 8. PostgreSQL rapor yazımı

### 8.1. Ortak kilit, iş emri ve yetki

- Ortak veritabanı kontrol kilidi altında geçerli claim, fence, hesap, mağaza, gün, iş aşaması, son tarih ve beklenen rapor revizyonu tekrar kontrol edilir. Süresi dolmuş ya da eski iş sahibi yayına devam edemez.
- Yazıcı kısa ve sınırlı işlemler içinde çalışır. Sağlayıcı HTTP isteği ile veritabanı yazım kilidi ayrı yürür. Paketlerin rapora görünürlüğü, bütün günün doğrulamasıyla birlikte atomik olarak açılır.

### 8.2. Paketi doğrulama

- Bir günün bütün paketlerinin işlem kimliği, sayısı, sıra numarası, şeması, boyutu ve içerik özeti karşılaştırılır. Paket başına kanonik bayt sınırı uygulanır. Gün özeti, doğrulanan sıralı paket özetlerine bağlanır.
- Pakette satır adedi, izinli tablo ve alanlar, native anahtar tekrarı, scope, gün ve bağlam eşitliği, sayısal alan biçimi ve hazırlanan satır özetleri kontrol edilir. Beş paket bekleniyorsa dört paket veya kısa beşinci paket gün yayınına yetmez.

### 8.3. Kaynak kanıtı ve saklama

- Bütün gerekli Dataset zarfları, sayfa ve referans sayıları, orijinal ham makbuzlar, iş emri ve fence bağları, gün ve şema sürümü tekrar bağlanır. Kaynak ve rapor gününün uyuşması gerekir.
- Ortak gün kanıtı kilit altında doğrulanmışsa tekrar kullanılabilir. Her satırın aynı gün ve bağlama, doğrulanan referans kümesine ve rapor saklama tarihine bağlılığı korunur. Eşleme ve fiziksel yazım kontrolleri işlevsel olarak sürer.
- Rapor ve gerekli ham kaynak, makbuz, sayfa, referans, ürün eşleme ve kur kanıtının üç yıllık senkron saklama bağı doğrulanır. Geçerli gizlilik silmesi önce gelir. Silinmiş, bozuk veya artık yetkisiz kaynak yeniden rapora açılamaz. [Saklama kararı](EO_05B_REPORT_RETENTION.md)

### 8.4. Satırları yazma ve fiziksel doğrulama

1. **Satır kontrolleri.** Tablo ve sütun şeması, tipler, sayısal hassasiyet, native anahtar, kaynak kanıtı, hiyerarşi, ürün eşlemesi, revizyon ve saklama bağı doğrulanır.
2. **JSON ve özet hesapları.** Kanonik JSON, native anahtar özeti ve içerik özeti elde edilir. Aynı anahtarın farklı içerikle tekrar gelmesi sadece yetkili revizyon yolundan ilerleyebilir.
3. **Mevcut kayıt araması ve kilit işlemleri.** Aynı mağaza, sağlayıcı, hesap, tarih ve grain için mevcut kayıt ve revizyon okunur. İlk yayın, önceden yazılmış günü sessizce değiştirmez. Onaylı düzeltmede aynı günün eski sürümü ve bağları ayrı doğrulanır.
4. **Tetikleyiciler.** Tablonun sahiplik, kaynak sayfası, metric durumu, kapsam, eşleme, revizyon ve saklama denetimleri çalışır. Yeni satırın geçerliliği fiziksel kayıtta da korunur.
5. **Ekleme veya yetkili güncelleme.** Paket sırasıyla kabul edilen satırlar yazılır. Salt ekleme süresine doğrulama, tetikleyici veya mevcut kayıt sorgusu süreleri karışıyorsa bu kalem bağımsız ölçülmüş sayılmaz.
6. **Fiziksel sonuç.** Yazılan kayıtlar yeniden okunur. Satır sayısı, native anahtar, fiziksel içerikten yeniden hesaplanan özet, saklama ve kaynak bağı karşılaştırılır. Uyuşmazlıkta yayın, tüketim ve checkpoint ilerlemez.

### 8.5. Tek gün makbuzu

- Bütün paketler ve fiziksel kayıt doğrulandıktan sonra **sağlayıcı hesabı başına gün için tek makbuz** üretilir. İşlem kimliği, gün, revizyon, paket sırası ve özetleri, kaynak kanıtı, satır sayısı, içerik özeti ve checkpoint bu kanıta bağlanır.
- Doğrulanmış yayınla birlikte ilgili kaynaklar tüketildi olarak işaretlenir. Rapor, makbuz ve checkpoint aynı yayın işleminin sonucudur. Eksik paket, bozuk kanıt, fiziksel uyuşmazlık veya geçersiz claim günün tamamını bekletir. Bilinen son geçerli rapor korunur. [Dataset uzlaştırma sözleşmesi](../contracts/eo-05d-reconciliation-v1.json)

### 8.6. Ayrı ölçülmeyen çağrı süresi

- Aynı koşuda dış yazım süresi ve birbirini kapsamayan iç süreler ölçülmüşse, dış süre ile iç sürelerin toplamı arasındaki fark bu kaleme yazılır. Bağlantı alma, sorgu taşıma veya işlem kapanışı gibi kısımlar yalnız doğrudan ölçülmüşse adlarıyla gösterilir. İç sayaçlar eksikse aradaki süre bir veritabanı işlemi olarak yorumlanmaz.

## 9. Rapor makbuzunu geri okuyup doğrulama

1. Aynı sahiplik ve işlem kimliğiyle rapor makbuzu PostgreSQL’den okunur. Makbuz özeti, iş, gün, revizyon, paket ve kaynak bağı ile tüketim ve checkpoint sonucu doğrulanır.
2. Makbuz, fiziksel raporun satır sayısını ve gereken içerik kanıtını doğrular. Geçerliliğini kaybetmiş, başka bir revizyonla aşılmış veya gizlilik nedeniyle değişmiş rapor başarıya çevrilmez.
3. Ortak provanın Google Ads ve Klaviyo yollarında doğrulama kapanışın içindedir. Meta yolunda ayrı ölçülmüştür. Birleşik doğrulama hücresi sıfır süre anlamına gelmez ve toplama ikinci kez eklenmez.

## 10. İş emrini `completed` olarak kapatma

1. PostgreSQL aynı kontrol kilidi altında iş emri, account, fence, zaman ve makbuz bağını son kez doğrular. Doğrulanmış muhatap iş yalnız kendi makbuzuyla kapanabilir.
2. İş `completed` durumuna geçer ve kendi rezervasyonu kapanır. Sağlayıcı kotası, istek sonuçları üzerinden kendi akışında kapatılmış olmalıdır. Başka bekleyen iş için yeni preflight yapılır.
3. Uygulama tam kapanışı yalnız kesin veritabanı yanıtı geldikten sonra gösterir. Kaybolan kapanış yanıtı belirsiz kalır. Bilinmeyen sonuçtan otomatik ikinci yazım, yeni iş veya rezervasyon bırakma kararı çıkmaz.
4. Ortak mağaza provasının bitişi son beklenen iş emrinin kapanış onayıdır. Sağlayıcıların durumları ve son doğrulanmış günleri ayrı izlenebilir kalır.

## 11. Bekleme, hata ve kabul sınırları

| Olay | Durum ve yapılacak işlem | Başarı kanıtı |
|---|---|---|
| Vade gelmedi, bütçe yetersiz veya gönderim öncesi kota beklemesi | İş bekler. Bilinen kota kapsamı ve aşaması kaydedilir. Yeni çağrı, adayın tekrar uygun bulunmasına bağlıdır. | Bekleme kaydı vardır ve tazelik ilerlemez. |
| Abonelik, kurulum, hesap veya izin uyuşmadı | İş başlamadan ya da yakalandığı aşamada durur. Eski claim geçersiz kalır. | Sınıflandırılmış durma gerekçesi ve ilgili iş aşaması. |
| Sağlayıcı kesin hata verdi | Doğrulanmış kapsamda iş durur. Provider ilk hata kuralı uygulanır. Bekleme süresinin dolması tek başına yeniden çağrı yetkisi oluşturmaz. | Kesin cevap durumu, iş kaydı ve bilinen kota sonucu. |
| Zaman aşımı veya kayıp yanıt | Dış çağrı sonucu `unknown` kalabilir. Son kesin aşama ve iş korunur. Geç dönen iş yazamaz. | Yetkili uzlaştırma için iş, fence, son aşama ve bilinen makbuzlar. |
| Worker kesildi veya süre doldu | `checking_authority` öncesinde dış çağrı `not_sent`, `request_intent` aşamasında `unknown`, `response_received` ve `ready_for_dataset` aşamalarında dış çağrı `settled` olabilir. İcranın sona erdiği ayrıca kanıtlanana kadar rezervasyon korunur. | Kesinti inceleme kaydı. Dataset veya checkpoint başarısı sayılmaz. |
| Paket, kaynak, eşleme veya fiziksel rapor kanıtı başarısız | Geçerli son rapor korunur. Yazım sonucu belirsizse açıkça kaydedilir. Kaynak eşleme yokluğu kendi durumuyla görünür. | Bilinen durdurma veya belirsiz sonuç kaydı. |
| Makbuz kaybı, makbuz uyuşmazlığı veya kapanış hatası | Tamamlandı bildirimi verilmez. Mevcut yetkili uzlaştırma, iş ve makbuz kimliğiyle ilerler. | Yeni kesin kanıt gelene kadar tamamlanma ve yeni tazelik ilan edilmez. |
| Gizlilik silmesi, kaldırma, disconnect veya hesap değişimi | Veri ve iş yetkisi yeniden değerlendirilir. Gizlilik işlemi önceliklidir. Bilinçli bağlantı boşluğu normal refresh ile doldurulmaz. | Etkilenen scope ve kayıtların güvenli kaydı. |

Kuyruk taramasının tazeliği, sağlayıcının son doğrulanmış günü, bekleyen iş yaşı, rezervasyon, kota, zaman aşımı, ham makbuz, yayın, rapor makbuzu ve iş kapanışı ayrı gözlemlenir. Ham cevap veya anahtar taşımayan güvenli teşhis kodları kullanılır. Kaybedilen çalışma için durumun kendisi sonlandırma kanıtı sayılmaz. [Kesinti sözleşmesi](../contracts/eo-05a-refresh-interrupted-work-v1.json) · [Alarm matrisi](../contracts/eo-05-refresh-alarm-matrix-v1.json)

## 12. Ölçüm standardı ve doğrulanmış ortak prova

**Tek sentetik Shopify mağazası ve 20 Kasım 2026 UTC kapanmış günü.** PostgreSQL 17 izole prova. Bir gerçek kuyruk taraması, sonrasında Google Ads, Klaviyo ve Meta sırayla çalıştı. Üç iş emri, üç doğrulanmış makbuz ve sağlayıcı başına 1.000 Dataset satırı aynı işlemde birlikte doğrulandı. Sağlayıcı başına beş adet 200 satırlık paket yazıldı. Google Ads’e 18, Klaviyo’ya 15 ve Meta’ya 12 sağlayıcı isteği için gerçek SQL kota kayıtları ayrıldı ve kapatıldı. Shopify Partner yetkisi için üç kota kaydı kapatıldı. Üç sağlayıcıda Shopify eşlemesi doğrulandı. Meta’nın eksik ve 199 satırlık beşinci paket kontrollerinde yeni gün yayınlanmadı.

| Standart ölçüm kalemi | Google Ads | Klaviyo | Meta |
|---|---:|---:|---:|
| Kuyruğa alma | Ortak | Ortak | Ortak |
| Kuyruk kontrolü ve işin çalışmaya alınması | 0,511 sn | 0,477 sn | 0,493 sn |
| Sağlayıcıdan veri çekme ve işleme | 4,521 sn | 3,989 sn | 4,738 sn |
| Ham kaydı depoya yazma ve doğrulama | 1,929 sn | 0,681 sn | 0,442 sn |
| Ham kayıttan rapor işine geçiş | 0,152 sn | 0,138 sn | 0,145 sn |
| PostgreSQL’den ham kayıt ve kaynak kanıtını okuma | 0,153 sn | 0,017 sn | 0,075 sn |
| Rapor hazırlığı ve uygulama tarafındaki diğer işlemler | 0,360 sn | 0,309 sn | 0,306 sn |
| **PostgreSQL rapor yazımı** | **6,273 sn** | **4,848 sn** | **6,371 sn** |
| Rapor makbuzunu geri okuyup doğrulama | Kapanışa dahil | Kapanışa dahil | 0,852 sn |
| İş emrini `completed` olarak kapatma | 0,864 sn | 0,947 sn | 0,927 sn |
| **Sağlayıcı işlem süresi** | **14,764 sn** | **11,408 sn** | **14,350 sn** |

**Ortak kuyruk taraması 0,027 sn. Mağaza toplamı 40,621 sn.** Mağaza kronometresi ilk kuyruk taramasından son işin kapanışına kadar çalıştı. Sağlayıcı sütunları ilgili iş başlayınca ölçüldü. Ortak kuyruk, devretme ve geçiş süreleri mağaza toplamına dahil. Hazırlık, sonradan yapılan saklama ve satır kanıtı denetimleri ile negatif kontroller kronometrenin dışında. Kayıt ve doğrulama alt kalemleri tanımlıdır. Bu koşuda her iç alt kalem için ayrı süre üretilmedi. Ölçüm alınmayan alt kalemler sonraki karşılaştırmalarda **ayrı ölçülmedi** olarak gösterilir. [Ortak ölçüm kaydı ve doğrulama](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/44914944926/job/136878434619)

### Karşılaştırma ve kabul kuralları

- Aynı iş günü, aynı satır sayısı, aynı veri ailesi ve kapsam, aynı paket sınırı, yetki/kota modu, aynı yazıcı sürümü ve ortam kaydı tutulur. Bir koşunun şekli değişirse fark tabloda açıklanır.
- PostgreSQL rapor yazımı kendi başına ölçülen bir dış aşamadır. Uygulama işlemi, veritabanı çağrısının dış süresi, sorgu içi kontrol ve salt ekleme ayrı ölçüm sınırlarıdır. Zamanlar birbirini içeriyorsa bir kez toplama girer. Detay sayaçları ayrı teşhis koşusunda kullanılır.
- Başarı için taze claim ve kota, eksiksiz şifreli kaynak, geçerli rapor kapsamı, tam paket sayısı, doğru fiziksel satırlar, tek makbuz, checkpoint, doğrulanmış kapanış ve kurallara uygun saklama birlikte görülür. Boş, kısmi, çakışmalı, süresi dolmuş, yanıtı kayıp ve eksik paket örnekleri ilgili sınırda kanıtlanır.
- Önceki genel kontrol 30 dakikalık süre sınırına ulaştı. İşin toplam sınırı 45 dakikaya alınınca aynı kontrol paketi tamamlandı. Üç sağlayıcılı ortak sentetik prova, iki temiz PostgreSQL kurulumu ve şema karşılaştırması ile son ayrı OAuth provası geçti. Önceki 40,621 sn ölçümü kendi koşusunun referansı olarak kalır. Canlı kabul koşulları Bölüm 13’te izlenir. [Son veritabanı kontrolü](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/44929858330/job/136923882139)

## 13. Uygulama ve kapasite kararları

22 Kasım 2026 günlük Google Ads sorgu planı, `cart_data_product_sales_daily` genel satış raporunu günlük toplamdan çıkarır. Shopping, Search ve Performance Max satış sorguları günlük Dataset satırlarını üretmeye devam eder. Bu plan provadaki 18 Google Ads isteğini, ek sayfalama veya Merchant Center okuması olmayan aynı senaryoda 17’ye indirir. Eski tam ham kayıt planı ve mevcut kayıtların okunması desteklenir. Günlük planın canlı etkinleştirilmesi ve veritabanı migration uygulaması ayrı kabul gerektirir.

Günlük Google planı, yayın işlemi içinde kayıtlı ürün eşlemesini arar. Bağ, aynı mağaza ve reklam hesabının rapor günü, ürün rolü, Google ürün kodu, Merchant hesabı, feed etiketi ve gözlenen dil için tekil olmalıdır. Shopify Product ID kanıtı ve güncel eşleme sürümü doğrulanır. Aynı eşlemenin kanıtı iş başına bir kez okunur. Reklamı yapılan ve satılan ürün ayrı doğrulanır. Eksik, çakışmalı veya süresi dolmuş bağda satır Google ürün koduyla kalır. Bu adım veritabanındaki kayıtlardan yürür.

İlk kayıt veya değişiklikte sunucu, doğrulanmış ham Google rapor sayfasını güncel Merchant–Shopify eşlemesiyle birlikte incelemeye sunar. İnceleme kararı tam kanıt özetine ve ürün rolüne bağlıdır. Kayıt rapor sayfasını, onay kimliğini ve geçerlilik süresini tutar. Değişiklikte önceki eşleme açıkça belirtilir. Günlük yazıcı sadece geçerli ve kanıta bağlı kaydı okur. İlk kayıt işlemi izole provada sentetik inceleme kararıyla sınanır. Gerçek mağaza kanıtı, inceleme servisi yetkisi ve canlı etkinleştirme ayrı kabul bekler.

| Başlık | Durum ve karar için gereken kanıt |
|---|---|
| Canlı günlük zamanlama | Düşük ticaret hacimli saat, her mağazanın doğrulanmış saat dilimi, başlangıç vadesi, kaçırılmış gün ve uygun kapatma rezervi için karar bekliyor. |
| Geçmiş düzeltme ve atıf | Sağlayıcı bazında tarih temeli, minimum gerekli geriye okuma, sıklık ve yayın revizyonu ayrı karar bekliyor. |
| Gerçek Meta verisi | Aynı gerçek mağazanın rapor `product_id`, katalog kimliği, Shopify Product ID ve satış rolü kanıtları bekleniyor. |
| Canlı kabul | Gerçek mağaza ve hesap erişimi, gerçek sağlayıcı ağ ve yanıt davranışı ile eksiksiz canlı iş kanıtı ayrı doğrulanacak. |
| Birden fazla refresh hattı | Bir mağazaya tek hat, isteğe çıkmadan önce sahiplik kontrolü ve güvenli devir kuralları tasarıma işlendi. Uygulama ve kabul ölçümü açık. [Çoklu hat tasarımı](EO_05A_MULTI_LANE_REFRESH_DESIGN.md) |
| Kapasite | Bu tek mağaza sentetik referansına rapor ve arayüz yükünü ekleyen asıl değerlendirme EO-07 sonunda, gerekirse EO-08 sonunda yapılacak. Çok mağaza, ortak kota, veritabanı ve dayanıklılık kanıtı birlikte değerlendirilecek. |

Resmî kaynaklar 21 Kasım 2026’da kontrol edildi. [PostgreSQL işlemleri](https://www.postgresql.org/docs/17/tutorial-transactions.html) · [PostgreSQL kilitleri](https://www.postgresql.org/docs/17/explicit-locking.html) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Google Ads raporlama](https://developers.google.com/google-ads/api/docs/reporting/overview) · [Klaviyo olayları](https://developers.klaviyo.com/en/reference/get_events) · [Meta Insights kırılımları](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns) · [Shopify ürün kimlikleri](https://shopify.dev/docs/api/usage/gids)
