# AdsTable Embedded — Execution Plan (Yürütme Planı)

## Güncel durum — 19 Ekim 2026

EO-01–04 ve A6-TECH-01 kabul edilmiştir; F01–F09 ve son güvenlik konusu kapalı,
F10 açık, engelleyici olmayan P3 ertelemesidir. A6-DOCS-01'in 62 insan-okuyucu
belgesinin tamamı, son üç belgenin okunabilirliği ve paket kapanışı ürün sahibi
tarafından 19 Ekim 2026'da kabul edildi; PR #137 merge onayı verildi.
Önceki kabul bekleyen teslim notları tarihsel hazırlık durumudur.
EO-05 otomatik başlamaz; sonraki iş için ayrı ürün sahibi yönlendirmesi gerekir.

## Zey&Rose ve iki aşamalı geliştirme/review planı — 19 Ekim 2026

Ürün sahibi bu plan güncellemesini onayladı. Bağlayıcı ayrıntı
`contracts/a6-quality-and-assurance-gates-v1.json` içindeki `staged_rollout`
kaydıdır. Bu karar EO-05 uygulamasını, mağaza taşımasını veya canlı işlem başlatmaz.

1. **Paralel hazırlık:** Zey&Rose Shopify'a taşınacak; Facebook & Instagram,
   Google & YouTube ve Klaviyo uygulamaları bağlanacak. Çok ürünlü Bileklik
   Meta Advantage+, Google PMax, Klaviyo Campaign ve Flow senaryoları hazırlanacak.
   Erişim hedefleri Meta App Role, Google Explorer ve Klaviyo'dur; erişimler bu
   kayıtla alınmış veya doğrulanmış sayılmaz. Gerçek mağazada AdsTable kullanımı
   öncesi A6-OPS-SHOPIFY-01 izolasyon kapısı korunur.
2. **EO-05–08 geliştirmesi:** Onaylı sözleşmeler, sentetik testler ve her paket
   sonundaki bütünlük denetimiyle sıralı ilerlenir. Gerçek hesap henüz hazır
   değilse bağımsız mühendislik işleri sürebilir. EO-07-C'nin gerçek kanıtına
   bağlı Ad Analysis/ürün grafiği ve Attribution Differences kapıları kalkmaz;
   bağlı işler açık/bloke kalır. EO-08 mühendislik sonuna ulaşmak bütün alt işleri
   kabul edilmiş veya review'a hazır ilan etmek değildir.
3. **EO-08 sonu gerçek doğrulama:** Taşıma ve erişimler hazır olduğunda Zey&Rose
   hesaplarında üç sağlayıcının ürün kimliği, satış, Sales Role, Ad Cost ve
   uçtan uca veri eşliği ayrı ayrı sınanır. Bağımsız araştırma veya sentetik test
   gerçek sağlayıcı kanıtı değildir. Gerçek kanıt yokluğu “bekliyor”dur; PASS,
   unsupported veya sayısal sıfır değildir. Tarihsel PMax tam iş günü kapısı,
   S2-A/S2-B senaryoları ve Channel/Sales Role sözleşmeleri korunur.
4. **Kapsam kararı:** Sales Role veya Ad Cost sağlanamıyorsa geçerli satışlar ve
   desteklenen alanlar korunarak devam seçeneği vardır. Rol/maliyet uydurulmaz;
   Channel, sağlayıcı ürün maliyeti ve dağıtılmış maliyet birbirinin yerine geçmez.
   Daralan kapsam sağlayıcı bazında belgelenir, ürün sahibi kabul eder ve ilgili
   sözleşme/UI kapıları etkinleştirme öncesi eşlenir. Güvenlik veya veri doğruluğu
   açığı bu seçenekle geçiştirilemez.
5. **İkinci aşama:** Gerçek sonuçlar ve kapsam kararı → EO-08 kabulü →
   A6-ASSURE-01 → ürün sahibi GO → ilgili başvuru/onaylar ve gerçek mağaza pilotu →
   ayrı EO-09 canlı geçiş kararı → EO-10. Şirket kuruluşu; Meta/Google business,
   Klaviyo beş kullanıcı hedefi ve business, Shopify başvuruları iş planındadır.
   Bunlar yeniden doğrulanmış platform şartları veya kabul garantisi değildir.
   “Önce tüm paketler, sonra review” sırası uygulanmaz.

OpenAI Ads API yalnız araştırma adayıdır; aktif Meta/Google Ads/Klaviyo listesi
değişmedi. Ürün raporlaması belgesinde ürün kimliği, tıklama ve spend bulunması,
satılan ürün attribution'ı, Sales Role veya Zey&Rose erişimini kanıtlamaz.
Erişim/uygunluk, satış ürünü, maliyet grain'i ve attribution ayrı araştırılıp açık
kapsam onayı alınmadan entegrasyon veya business başvurusu yapılmaz.
Kaynak kontrolü: 19 Ekim 2026,
[OpenAI Ads Reporting](https://developers.openai.com/ads/reporting).

Bu belge tarih sırasıyla birikmiş karar ve kanıt kayıtlarını korur. Aşağıdaki
“başlamadı”, “bekliyor”, “güncel” ve ara sayımlar kayıt tarihine aittir; bugünkü
yetki veya yeni iş talimatı değildir. Önce bu özet, sonra ilgili nihai kabul
kaydı okunur. Makine sözleşmeleri ve değişmez kanıtlar çevrilmez.

Teknik terimler: Runtime çalışan uygulama, migration sıralı veritabanı değişikliği,
CI otomatik teslim kontrolü, build derleme, typecheck tip kontrolü, BFF arayüzün
sunucu katmanıdır. API alanları, ekran metinleri ve durum kimlikleri aynen korunur.
## EO-05 başlangıç brief'i — 19 Ekim 2026

**20 Ekim güncel iş sırası kararı:** Fırat listing tree çalışmasını açıkça
durdurdu; sıradaki iş tüm workspace'leri kapsayan refresh bütçesi ve yürütme
tasarımıdır. Aşağıdaki önceki tarihsel PMax tasarım maddeleri ertelenmiş kayıttır,
bağımsız refresh çalışmasının ön koşulu değildir. Erteleme tamamlanma/PASS veya
Google'ın satış, Channel, Sales Role ve Ad Cost sözleşmesinde değişiklik değildir.
Kanıtsız tarihsel kesin Channel etkinleştirilmez; listing tree çalışmasına dönüş
ayrı açık onay gerektirir. Bu iş sırası kararı runtime, migration, canlı çağrı,
deploy veya merge yetkisi vermez.

**Durum:** Brief hazır; ürün sahibi kabulü ve dar uygulama kapsamı onayı bekliyor.
Çalışma sözleşmesi: `contracts/eo-05-start-brief-v1.json`.
EO-01–04, TECH-01 ve DOCS-01 kabulleri ile PR #138 iki aşamalı planı korunur.
Bu brief çalışma zamanı kodu, migration, canlı sorgu, dağıtım veya kapasite koşusu
başlatmaz. EO-05 henüz uygulamaya açılmadı.

**Amaç:** Sağlayıcı verisini doğru mağaza/hesap ve tarihe bağlı, tekrar çalışınca
çoğalmayan, eksikleri görünür, güncellenebilir Dataset V2 kaydına dönüştürmek.

**20 Ekim kapsam netleştirmesi:** EO-05 yalnız bir PMax işi değildir. Önce tüm
alt paketler ve sistem geneli refresh tasarımı netleştirilir; eski yapı yalnız
yararlı iş takibi fikirleri için referanstır, kodu veya mimarisi taşınmaz.
Zamanlayıcı uygulamasına geçmeden iş yükü bütçesi hazırlanır; tarihsel PMax
kanıtının kayıt/okuma tasarımı 20 Ekim iş sırası kararıyla durdurulmuştur.
Mevcut indeks/sorgu planı başlangıç ölçümü ayrıca
doğrulanır; henüz tamamlanmış veya üretim kapasitesi sertifikası değildir.
Ağaç sürümü/hash'i, gözlem zamanı, kanıtlanmış geçerlilik aralığı, hesap saat
dilimi, eksiksiz sayfalama, boşluk/çatışma ve saklama/silme sınırları belirlenir.
Üyelikte kullanılan ürün boyutlarının tarihsel doğruluğu da gerekir; bugünkü
ürün/feed özellikleri geçmişe uygulanmaz.

**Kritik açık tasarım sorusu:** Kesintisiz geçerliliği hangi doğrulanmış kaynak
kanıtlayacak? İki aynı snapshot arada değişim olmadığını kanıtlamaz; gözlem
zamanı geçerlilik aralığı değildir. Bu kaynak doğrulanana kadar kayıt alınabilir
ama geçmiş için exact sonucu üretilemez. Eksik/değişen/örtüşen tam iş günü
kanıtında satış ve Sales Role korunur, Channel `Unclassified Channel` kalır.
Satılan ürün Channel seçemez; bugünkü ağaç eksik geçmişi dolduramaz. İlk kapı
yalnız tablo/snapshot oluşturmakla kapanmaz: saklama, boşluk tespiti, uzlaştırma
ve tarih eşli resolver teslimi birlikte doğrulanmalıdır.

**Mevcut alt paket sırası:**

1. EO-05-A: Tüm workspace'lerin toplam DB yükünü yöneten, saat içine yayılmış
   zamanlayıcı; adil sıra, shard, lease, checkpoint, tek iş ve sistem geneli
   sınırlı eşzamanlılık. Yetki/abonelik geçersizken iş çalışmaz; hesap veya kurulum
   nesli değişince eski iş yeni veriye yazamaz.
2. EO-05-B: Dataset V2, kaynak para birimi, doğrulanmış FX kaynak izi ve sürümlü
   sentetik test verisi. FX kaynağı/oranı varsayılmaz; test verisi gerçek kanıt değildir.
   Ürün sahibinin anlattığı sabit ilk-kurulum para birimi, Frankfurter ve mevcut
   Dataset V2 yapısı EO-05-B'de kaynakla incelenecektir. Product level kayıt/
   fiziksel tablo tasarımı şimdi kararlaştırılmadı; EO-05-B'de yeniden tartışılacak.
3. EO-05-C: Sağlayıcının doğrulanmış attribution ayarından olgunluk/kesinleşme.
   Başarısız, kısmi veya kota sınırlı koşu kesinleşmeyi ilerletemez.
4. EO-05-D: Önce dün, sonra bugün ilk yükleme; tekrar güvenliği ve uzlaştırma.
   Bilinçli Disconnect aralığı ücretli abonelik sürse bile sonradan alınmaz;
   bir ay sonra dönüş, o ayı doldurma izni değildir. Dün/bugün ilk yüklemesi de
   bu sınırı delemez. İstemsiz token/yetki kaybı ayrı sınıflanır; geçmiş tamamlama
   politikası EO-05-D ve UI kapsamında ayrıca kararlaştırılmadan otomatik uygulanmaz.
   İzin verilen kurtarmada kalan eksik günler görünür olur. Sağlayıcı geçmişi yetmezse eksik
   veri açık kalır, sıfıra çevrilmez. Saatlik tam geçmiş taraması yapılmaz;
   derin uzlaştırma 24 saatte bir, etkin attribution ufkuna göre planlanır.
5. EO-05-E: Gecikme, tazelik, kaynak tüketimi ve iş başına maliyetin secretsız
   görünürlüğü. 2,000 çalışma alanı, 4,000 stres ve 24 saatlik dayanıklılık
   kabulleri ilgili kapılarında ölçülür; bugün koşu başlatılmaz.

Maliyet dağıtım formülünün sahibi EO-06-A'dır; EO-05 kaynak/dağıtılmış maliyet
ayrımını ve gerekli girdiyi korur. Gerçek Zey&Rose doğrulaması EO-08 mühendislik
sonundadır; bu zamana kadar kanıta bağlı özellikler doğrulanmış ilan edilmez.
Her dar teslim test/typecheck/build/CI, açık kabul, uzak içerik eşliği ve yerel
envanter kapısından geçer. İlk açık sağlayıcı hatasında durulur ve kullanıcıya
dönülür; bu brief otomatik yeniden deneme veya alternatif rota izni değildir.

Resmî kaynak kontrolü 19 Ekim 2026: Google Listing Groups for Retail (ağaç yapısı),
Supabase Row Level Security (erişim sınırı), GitHub Pull Requests (teslim).
Bağlantılar çalışma sözleşmesindedir. Bu okumalar tarihsel süreklilik servisi,
şema güvenliği veya canlı kapasite kanıtı üretmez; uygulama öncesi ilgili resmî
API/kalıcılık kaynakları dar kapsamda yeniden doğrulanır.

## EO-05-A — Tüm workspace'ler için refresh tasarım önerisi — 20 Ekim 2026

### EO-05-A — Tek veri parçasını çalıştırma ve evre kaydı — 20 Ekim 2026

Fırat, 16 alarm senaryosundaki korumaların mevcut EO-05 alt işleri içinde
uygulanmasına başlanmasını onayladı. İlk teslim yalnız önceden sıra almış bir
veri parçasının çalışan çekirdeği ve kalıcı evre kaydıdır. Çalışma sözleşmesi:
`contracts/eo-05a-refresh-chunk-worker-v1.json`. Alarm tasarımı PR #145 açık kalır;
bu uygulama yönlendirmesi o PR için ayrı merge onayı değildir.

Akış: **yetki kontrol ediliyor → çağrı niyeti kaydedildi → yanıt alındı →
Dataset'e verilmeye hazır**. Her adım doğru mağaza/kurulum/hesap/iş/sahiplik
numarası ve tarih aralığına bağlıdır; adım atlanamaz. Aynı işi ikinci kez açan
çalışan tekrar provider okuması başlatamaz. Çağrıdan önce ve sonuç devredilmeden
önce güncel sunucu yetkisi tekrar yüklenir; hesap/bağlantı sürümü değişirse durulur.

Çağrı niyeti kalıcı kaydolmadan dış okuma yoktur. Bu kayıt “kesin çağrı yapıldı”
kanıtı değildir; kayıt ile gerçek gönderim arasında çökme olabilir. Zaman aşımı,
bağlantı hatası veya iptal sinyali provider'ın durduğunu kanıtlamaz: iş belirsiz
kalır, kapasite korunur, geç gelen cevap yeni adım veya başarı üretemez.
Bilinen provider reddi ve doğrulama hatası durdurulur; kendiliğinden tekrar yoktur.
DB/evre kaydı sorunu da başarı veya kapasiteyi serbest bırakma nedeni değildir.

En fazla satır/byte, çağrı süresi ve kapanış payı açık girdidir; ölçülmemiş canlı
sayı seçilmedi. Kaynak yanıt akışını boyutla sınırlayan gerçek provider adaptörü
henüz bağlı değildir; çekirdeğin byte kontrolü doğrulanmış satırların boyutudur.
DB çağrıları/yetki yükleme için bağlantı ve sorgu süre sınırı ile gerçek çalışma
ortamının zaman sınırı canlı etkinleştirmeden önce ayrıca doğrulanacaktır.

**Önemli sınır:** Sonuç **Dataset bekliyor** durumudur. Ürün verisi henüz kalıcı
Dataset'e yazılmaz; yalnız doğrulanmış satırlar bellekte devredilir. Bu noktada
iş tamamlandı, checkpoint ilerledi veya veri güncel denmez. Kalıcı evre takibi
olan iş, genel tamamla işleviyle başarılı kapatılamaz. Bellekteki veri kaybolursa
bu otomatik yeniden alma izni değildir. Product-level saklama ve atomik Dataset
yazma/ilerleme kapısı EO-05-B'de seninle netleştirilecek, sahte writer bağlanmayacak.

Native provider yetki/okuma adaptörleri, takvim tetikleyicisi, bağımsız gözetim ve
alarm teslimi bağlı değildir. Testteki sunucu yetkisi/provider yanıtı sentetiktir;
gerçek provider izni veya ürün doğruluğu kanıtı değildir. Yeni migration yalnız
hazırlanır ve iki mevcut boş CI veritabanında sınanır; canlı uygulanmaz. UI,
secret, yeni servis veya dağıtım değişikliği yoktur. Listing tree durdurma ve
bilinçli Disconnect aralığını almama kararları korunur.

Supabase/PostgreSQL rehberleri kısa işlem, zorunlu RLS ve dar işlev erişimini
yönlendirdi. Resmî PostgreSQL 17 kilitleme, Node.js 24 zamanlayıcı ve Supabase RLS
kaynakları 20 Ekim 2026'da kontrol edildi. Yerel Windows build hatası için işlem/
makine ayarı veya tekrar denenmez; bu teslimin build'i normal GitHub CI ile doğrulanır.

**Durum:** Tasarımdan ayrılmış repository karar çekirdeğinin uygulanması 20 Ekim'de
ürün sahibi tarafından onaylandı. Teslim kabulü bekler; çalışan scheduler veya
kapasite kabulü değildir. EO-05'in canlı uygulama ve başlangıç kapıları kapanmadı.
Tasarım kaydı: `contracts/eo-05a-global-refresh-design-v1.json`.

**Sonraki onaylı teslim — ortak iş takibi:** Önceki karar çekirdeği PR #141 ile
kabul edildi. Ürün sahibi şimdi iş takibi kodu, veritabanı değişiklik dosyası ve
testlerin hazırlanmasını onayladı; canlı uygulama onayı vermedi.

**Onaylı kısa ölçüm:** Ortak iş takibi PR #142 ile kabul edildi. Şimdi yalnız
boş test veritabanlarında 100 örnek mağaza, 1/2/4 çalışan ve 0/10.000 geçmiş iş
kaydıyla altı kısa deneme yapılır. 90 mağazanın birer, 10 büyük mağazanın beşer
küçük işi vardır: toplam 140 iş. “Büyük” burada daha çok iş parçası demektir;
gerçek ürün verisi çekilmez veya Dataset'e yazılmaz.

İşin sıra alması, kaydedilmesi ve tamamlanması ne kadar sürüyor; bütün mağazalara
ilk sıra geliyor mu; geçmiş kayıtlar artınca takip yavaşlıyor mu ölçülür. Ölçüm
süresi uygulama/veritabanı arasındaki beklemeyi de içerir; veritabanının kendi
harcadığı süre ayrıca örnek sorguyla görülür. Tekrarlanan sahiplenme çatışmaları
hata/otomatik provider retry değil, sınırlı test sürücüsünün yeni sıra denemeleridir.

Her deneme en fazla 60 saniye ve 10.000 sıra denemesiyle sınırlıdır. Ölçüm için
tablo sahibinin test bağlantıları kullanılır; canlı Supabase planı, bağlantı havuzu,
UI raporları veya provider yanıt süreleri ölçülmüş sayılmaz. Çıkan hız sayıları
üretim ayarı, gerçek mağaza kapasitesi veya 2.000/4.000 mağaza/24 saat kabulü değildir.
Ürün verisi yazma yükü Dataset V2 kurulduğunda ayrıca sınanır. Yeni şema, servis,
provider çağrısı, canlı ayar veya deploy bu test kapsamında yoktur.

`app/lib/database/refresh-work-repository.server.js` ve
`supabase/migrations/20261020092429_eo05a_refresh_work_tracking.sql` bütün
çalışanların aynı iş kaydını görmesini sağlar. İşin kimde olduğu ve sistemde
ayrılan yer birlikte kaydolur. İş bittiğinde tamamlandı, yarıda kaldığında durdu
olarak saklanır; eski çalışan yeni sahibin işini kapatamaz. Tamamlanmış iş aynı
kimlikle yeniden başlatılamaz. Durmuş işi yeniden başlatmak ayrı bir işlemdir;
otomatik tekrar veya süre dolunca kendiliğinden devir yoktur.

Sistemin sınırları da aynı ortak kayıttan okunur; bir çalışanın gönderdiği daha
yüksek sayılar bunların yerine geçemez. Başlangıçta bu sınırlar tanımlı değildir,
bu nedenle iş başlatılamaz. Testteki küçük örnek sayılar gerçek kapasite değildir.

Yeni kayıtlara kullanıcı ekranları ve mevcut web uygulaması doğrudan erişemez.
Yalnız bu iş için ayrılan, henüz hiçbir giriş hesabına bağlanmamış iç yetki vardır.
İş kaydı tutulurken veritabanı kısa süre meşgul edilir; sağlayıcı yanıtı beklenirken
açık tutulmaz. Veritabanı rehberleri bu güvenlik ve kısa işlem sınırını belirledi.

İki ayrı boş PostgreSQL test veritabanında aynı işe iki çalışanın uzanması,
dolmuş kapasite, arada kalan kayıtların geri alınması, yarım iş, eski çalışan ve
erişim sınırları sınanır. Bunlar sentetik testlerdir; canlı Supabase değişikliği
veya gerçek mağaza/kapasite kanıtı değildir. Çalışanların çağrı ve kayıt öncesi
yetki kontrolü, güvenli otomatik devir, saklama/silme bağlantısı ve gerçek sınır
ölçümleri tamamlanmadan canlı kullanım açılmaz. EO-05-A kapanmış değildir.

**Bu teslimin çalışan kodu:** `app/lib/refresh/admission-policy.server.js` yalnız
hangi sınırlı iş parçasına sıra verileceğini hesaplar. Mağaza/sağlayıcı/hesap
kimliğinden aynı saat içi konumu üretir; önceki hizmet sırasını girdiden alıp büyük
workspace'in küçük workspace'i sürekli geriye itmesini önler. Global, sağlayıcı,
workspace ve hesap bütçelerinden biri doluysa iş gerekçesiyle bekler. Rapor okuma
payı global bütçeden önce ayrılır. Maliyet/bütçe bilinmiyorsa sıfır varsayılmaz.

İş sahipliği ve bütçe tek global sürüm kontrolüyle birlikte kaydedilmeden iş
başlatma hakkı doğmaz. Kod gerçek atomik depo sunmaz; iki çalışanın yarışması
yalnız sentetik depo ile sınanır. Farklı iş amacı aynı hesap kilidini aşamaz;
eski sahip yeni sahipliğin rezervasyonunu bırakamaz. Bırakma sonucu da atomik
kayda uygulanması gereken öneridir. Süre dolunca kilit kendiliğinden kalkmaz.

Test limitleri hayalî örneklerdir, üretim ayarı değildir. Yetki/bağlantı penceresi
girdileri gelecekte doğrulanmış sunucu otoritesinden gelmelidir; bu çekirdek
Shopify veya sağlayıcı yetkisi doğrulamaz. İş yükü/sorgu ölçümü, gerçek depo,
lease kurtarma, iş sınıfı bütçeleri, worker/checkpoint ve kapasite koşuları hâlâ
açıktır. Bu modül route'a bağlanmadı; DB, provider, secret, timer veya deploy
değişikliği yoktur. Google satış/Channel/maliyet kuralları ve listing tree
durdurma kararı değişmez.

Akış: uygunluk → saat içindeki sıra → workspace'ler arasında adil seçim →
ortak bütçe ve işi atomik sahiplenme → sınırlı veri parçası → güvenli kayıt/
checkpoint → bütçeyi bırakıp kalan iş için sıraya dönme.

- **Sistem bütünü:** Bütün çalışanların toplam sağlayıcı istekleri, DB yazma
  işleri, bağlantı ve satır/byte yükü birlikte sınırlandırılır. Her worker'ın
  kendi sayacı yetmez. Kullanıcının rapor okuması için kapasite ayrılır; bütçe
  dolunca iş kaybolmaz, bekler. Sayısal limitler ölçülmeden uydurulmaz.
- **Adil sıra:** Aynı saatte toplu yükleme yoktur. Büyük workspace'in tüm
  geçmişi tek seferde kuyruğu tutamaz; sınırlı sayfa/tarih parçasından sonra
  diğer workspace'lere sıra verilir. İlk yükleme, saatlik veri, derin uzlaştırma
  ve izinli kurtarma işleri birbirini süresiz aç bırakmamalıdır.
- **Çakışma:** Aynı workspace/kurulum nesli/sağlayıcı/hesapta tek aktif iş olur.
  Başka iş amacı bu sınırı aşamaz. Sahiplik süresi dolan eski çalışan, yeni
  sahibin verisine yazamaz. Sağlayıcı yanıtı beklenirken DB işlemi açık tutulmaz.
- **Yarıda kalma:** Checkpoint yalnız veri kalıcı kaydedildikten sonra ilerler.
  Kayıttan hemen sonra çökme olursa tekrar çalıştırma veriyi çoğaltmaz. Kısmi
  sayfa/tarih başarı sayılmaz; kaçırılan saatler sınırsız yeni iş üretmez.
- **Yetki ve hata:** İş öncesi ve kayıt öncesi hesap/kurulum/abonelik/bağlantı
  yetkisi kontrol edilir. Disconnect dönemi alınmaz. İlk açık provider hatasında
  ilgili işlem durur; otomatik tekrar, süre dolunca kendiliğinden yeniden deneme
  veya alternatif rota izni yoktur. Geçerli eski veri korunur.

Eski referans `fyilanli-oss/ads-table-dev` commit
`6d79fbb8d975be550d5611d682ae1ad2a97594d7` içindeki iş durumu, source job ve
güvenli hata görünürlüğü fikirleridir. Eski otomatik retry kuralları ve uygulama
bekleyen scheduler sözleşmesi taşınmaz; hazır altyapı kabul edilmez.

Uygulama öncesinde yürütme/tetikleme mekanizması, atomik sahiplenmenin güvenli
kalıcılık sınırı ve ölçülmüş limitler ayrıca doğrulanacaktır. Bu taslak herhangi
bir Vercel/Supabase servisi seçmez, satın alma veya canlı işlem gerektirmez.
Yarış, çöken çalışan, eski sahip, büyük/küçük workspace adaleti ve Disconnect
aralığı senaryoları kalıcı depo/worker üzerinde ayrıca sınanacak; sentetik karar
çekirdeği ve sözleşme testleri bunların üretimde çalıştığını kanıtlamaz.
PMax kanıt çalışması durdurulmuştur;
bağımsız refresh işini engellemez, tarihsel kesin Channel kabulü yerine geçmez.

Resmî tasarım kaynakları 20 Ekim 2026'da kontrol edildi: PostgreSQL SELECT/kilit
kuralları ve GitHub PR güncelleme belgesi. Bağlantılar tasarım kaydındadır;
PostgreSQL belgesi tek başına güvenli bir kuyruk veya uygulanmış DB şeması değildir.

## EO-05-A — Başlayamayan ve yarıda kalan işlerin takibi — 20 Ekim 2026

Ürün sahibi bu dar repository uygulamasını onayladı; teslim kabulü ve merge
ayrıca beklenir. Canlı veritabanı değişikliği, provider çağrısı ve çalışan
etkinleştirme izni yoktur. Kaynak: `repository_work_stops_slice` tasarım kaydı.

- **Sıra bekliyor:** Kapasite veya saat uygun değil. Çağrı yapılmadı; hata,
  tamamlanma veya veri yokluğu değildir. Aynı bekleme bildirimi yeni kayıt yığını üretmez.
- **Başlamadan engellendi:** Yapılandırma/yetki/bağlantı/abonelik kontrolü geçmedi.
  Bilinen neden ve gerekli aksiyon kaydolur; bilinmeyen neden tahmin edilmez.
  Provider çağrısı veya kapasite ayırma yapılmış sayılmaz.
- **Provider reddetti:** Bir deneme yapıldı; tüm dış işlemlerin sona erdiği
  doğrulanmışsa iş durur, kapasitesi bırakılır ve ilgili hesap engelli kalır.
  Ham hata, token veya kişisel veri iş takibine yazılmaz.
- **Başladı, durdu:** Hiç çağrı yapılmadan durma ile çağrılar bitince durma
  ayrıdır. İş tamamlandı sayılmaz; mevcut geçerli veri korunur. Yeni kayıtlar
  Dataset'e bağlı değildir; veri güncelliği/checkpoint ilerletmez.
- **Sonuç belirsiz:** Çalışandan haber kesildi veya çağrının sonucu bilinmiyor.
  Eski sahip için güncel sahiplik kontrolü ve işi kapatma reddedilir; aynı hesapta
  yeni iş açılmaz. Çağrı hâlâ sürüyor olabileceğinden ayrılmış kapasite korunur.
  Diğer hesaplar yalnız kalan bütçe içinde ilerleyebilir; sınırsız kapasite sözü yoktur.

Bilinen engeli kaldırmak yalnız iç koordinatörün açık ve kayıt sürümüyle eşleşen
onayıyla olur. Bu işlem çağrı başlatmaz, eski sahibin hakkını geri vermez, güncel
yetkiyi kanıtlamaz veya geçmiş tamamlama izni vermez. Bilinçli Disconnect dönemi
alınmaz. Belirsiz dış işlemi bu API kaldıramaz; süre dolması/iptal sinyali tek
başına güvenli devir kanıtı değildir.

**Açık sınır:** Çalışanın kaybolduğunu saptayan mekanizma, dış çağrının gerçekten
sonlandığına ilişkin kanıt, belirsiz işin güvenli kurtarılması ve Dataset yazma
kapısına aynı işlem içinde sahiplik kontrolü henüz bağlı değildir. Ayrı okunan
“sahiplik geçerli” cevabı daha sonra yapılan yazıyı güvenli kılmaz. Bu teslim
çalışan scheduler veya tüm kurtarma kapılarının kapanışı değildir. Kayıt son iş
gözlemidir; eksiksiz deneme geçmişi/saklama politikası ayrıca açık kalır.

Resmî kaynaklar 20 Ekim 2026'da kontrol edildi: PostgreSQL 17 kilitleme kuralları,
Supabase RLS ve değişiklik kaydı. Canlı provider davranışı doğrulanmış sayılmaz.

## Otorite

Bu repository onaylı A6-EO yalnız gömülü temiz yeniden kuruluş programını uygular.

- Aktif karar kaynağı: bu repository ve `docs/EXECUTION_PLAN.md`
- İlk kuruluş kaynak geçmişi/kanıt kaynağı: `fyilanli-oss/ads-table-dev` commit `3416ee736fc3c53910e5e6571a7b8f445c4ce3cd`
- Eski repository aktif karar otoritesi değildir; yalnız referans, kanıt, koruma ve geri dönüş kaynağıdır.
- Eski repository'den aynen taşınan uygulama/çalışma zamanı modülü: **0**
- Eski repository EO-09 canlı otorite geçişi tamamlanana kadar koruma ve geri dönüş hattıdır.

## Ürün sınırı

- Shopify Admin iframe'i içinde gömülü uygulama.
- Aktif sağlayıcılar: Meta, Google Ads, Klaviyo.
- Kanonik yüzeyler: Funnel App Home (`/`), Ad Analysis (`/ad-analysis`), Settings (`/settings`).
- İlk kuruluş planında EO-08 review kapısı ve ayrıca açık canlı geçiş kararı gelene kadar Preview sınırı kondu. Sonraki dar Production onayları yalnız kayıtlı kapsamlarını açtı; EO-09 otorite geçişi yetkisi olmadı.
- EO-01 sırasında canlı alan adı, Shopify yapılandırması, sağlayıcı, gerçek veri/token veya eski yapıyı devreden çıkarma değişikliği yoktu.

## Sıralı program

1. **EO-01 — Temiz çalışma zamanı kabuğu, CI ve bağımlılık sınırı**
2. **EO-02 — Çalışma alanı, kurulum, abonelik/deneme ve gizlilik temeli**
3. **EO-03 — Kanonik OAuth, bağlantı ve token kasası**
4. **EO-04 — Meta, Google Ads ve Klaviyo adaptörleri**
5. **EO-05 — Zamanlayıcı, Dataset V2, kur dönüşümü, olgunluk ve uzlaştırma**
6. **EO-06 — Formül, sorgu ve aynı-origin BFF/API**
7. **EO-07 — Shopify'a özgü üç yüzeyli arayüz**
8. **EO-08 — Taşıma provası, eşlik, kontrollü pilot ve geri alma**
9. **EO-09 — Otorite geçişi, kararlılık ve eski tüketici kalmadığının kanıtı**
10. **EO-10 — Eski yapının arşivi, saklama süresi ve kontrollü devreden çıkarma**

Aynı anda yalnız bir ana paket aktiftir. Yürütülebilir paket tablosu `contracts/a6-eo-implementation-master-v1.json` dosyasındadır.

## Mühendislik bütünlüğü ve review güvence sırası — 18 Ekim 2026

Bağlayıcı belge: `docs/A6_QUALITY_AND_ASSURANCE_GATES.md`

Yürütülebilir sözleşme: `contracts/a6-quality-and-assurance-gates-v1.json`

CI kontrolü: `tests/a6-quality-and-assurance-gates.test.js`

- EO-04 kapanışından hemen sonra ve EO-05 başlamadan önce `A6-TECH-01` bütün
  kodu, Shopify yapısını, sağlayıcı çalışma zamanlarını, Supabase'i, Vercel'i,
  GitHub/CI/kaynak zincirini ve uçtan uca veri güvenliğini denetler.
- Testlerin geçmesi tek başına yeterli değildir; yanlış davranışın yanlış testle
  korunması, paketler arası eski varsayımlar ve canlı yapı-repository drift'i de
  aranır. P0/P1 ile güvenlik, veri doğruluğu veya review'u etkileyen P2 açıkken
  EO-05 başlamaz.
- `A6-DOCS-01`, A6-TECH-01 düzeltmelerinden sonra ve EO-05'ten önce aktif insan
  okuyucu belgelerini Türkçe standardına getirir; makine sözleşmesi ve değişmez
  kanıt toplu çevrilmez.
- EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 referans sürümüne karşı delta
  bütünlük denetimi zorunludur.
- `A6-ASSURE-01` EO-08 sonrasında çalışan pre-review doğrulamasıdır; ilk kod
  sağlamlık denetimi değildir. Hiçbir nihai review başvurusu A6-ASSURE-01 PASS
  ve ürün sahibi GO kararı olmadan yapılamaz.
- `A6-TECH-01` ilk denetimi 18 Ekim 2026'da
  `c3faddff97628f372f5cc843f3326fb38de95dfc` başlangıç referans sürümünde
  tamamlanmış ve bulgular
  `docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md` içinde kaydedilmiştir.
  İlk kayıtta P0 yoktu; üç P1 ve beş engelleyici P2 açıktı. Bu tarihsel başlangıç
  kaydıdır. Güncel genel kapanış kararı aşağıdadır.

**A6-TECH-01 genel kapanışı — 18 Ekim 2026:** Ürün sahibi açık kabul verdi.
Denetlenmiş ve canlı kabul edilmiş PASS referans sürüm:
`bd243fff7200ae6bdb3900ebb7417b3beba53010`.
F01–F09 ve sonradan bulunan bağımlılık güvenlik bulgusu kapalı; açık P0/P1/P2
sıfırdır. F10 kabul edilmiş açık P3 ertelemesidir; düzeltilmiş sayılmaz.
PR #118 kaynak CI'ı 457 test/typecheck/build PASS; aynı kaynak ağacı canlıya
alındı. Gerçek Shopify Admin masaüstü ve mobil normal çalışma kabulü ürün
sahibi tarafından verildi. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_CLOSURE_2026-10-18.json`.

A6-TECH-01 kapanışında sıradaki kapı `A6-DOCS-01` idi; uygulaması o gün başlamamıştı.
DOCS başlangıcı 19 Ekim'de ayrıca onaylandı. EO-05 dokümantasyon kabulünü bekler.
Gerçek sağlayıcı/review sınırları ve F01 dar kurtarma sınırı korunur; yeni yedek,
yükseltme veya canlı çağrı işi açılmaz. Aşağıdaki ara durumlar tarihseldir;
güncel kabul bu genel kapanış ve belgenin başındaki durumdur.

F01 düzeltmesinin repository hazırlığı:
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` ve
`contracts/a6-tech-01-f01-migration-lineage-v1.json`. Bu kayıt migration geçmişi
onarımı, canlı uygulama, F01 kapanışı veya EO-05 başlangıcını yetkilendirmez.
Denetim düzeltmeleri F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10
sırasıyla ilerler; F01 kapanmadan F02 başlamaz.

F01 canlı devreden çıkarma 18 Ekim 2026'da ayrı ürün sahibi onayıyla uygulandı;
işlem sonrası kontrol kanıtı `docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
İlk 38 migration değişmedi. Supabase'in verdiği yeni sürüm `20261018152910`
ile repository eşlenmiştir. Ürün sahibi F01 kapanışını ve PR #102 merge'ünü
18 Ekim 2026'da onayladı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
Sıradaki bulgu F02'dir; uygulaması başlamadı. Bu kayıt yeni canlı değişiklik
veya EO-05 başlangıç yetkisi değildir.

F02'deki tek sahipsiz Google kimlik bilgisi, ayrı açık onayla 18 Ekim 2026'da
temizlendi. Üç bağlı kimlik bilgisi, üç bağlantı ve sekiz tarihsel kayıt korundu.
Ürün sahibi F02 kapanışını ve PR #104 merge'ünü kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F02_CLOSURE_2026-10-18.json`.
Sıradaki F03 başlamadı; yeni canlı işlem veya EO-05 başlangıcı yetkisi yoktur.

F03 envanter düzeltmesi 18 Ekim 2026'da ürün sahibi kabulünü aldı: 22 Vercel
adı, 1 GitHub iş akışı secret adı, toplam 23 envanter girdisi; örnek dosya,
sözleşme ve testler eşlendi. Secret değeri okuma veya canlı ayar/dağıtım işlemi
yok. Kapanış kanıtı `docs/evidence/A6_TECH_01_F03_CLOSURE_2026-10-18.json`.
F01–F03 kapalıdır. Sıradaki F04 başlamadı; EO-05 kapısı hâlâ kapalıdır.

F04 Polaris ön yükleme/script eşliği düzeltildi; ayrı onaylı birebir kaynaklı dağıtım
sonrası ürün sahibi gerçek Shopify Admin masaüstü ve mobil görünümünü kabul
etti, PR #106 merge'ünü onayladı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F04_CLOSURE_2026-10-18.json`.
Güncel durum F01–F04 kapalı, sıradaki F05 başlamadı ve yetkili değil.
F07 sürüm kaynak geçmişi ve genel EO-05 kapısı açık bulgulara bağlı kalır.

F05 action SHA sabitlemesi ürün sahibi onayıyla repository'de hazırlandı.
Kanıt `docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json`.
Kontrollü güncelleme: resmî sürüm/commit doğrulaması → PR → CI → açık merge
onayı; otomatik merge yoktur. CI ve kabul beklenir, F05 açık ve F06 yetkisizdir.
Canlı iş akışını elle çalıştırma, secret veya deployment değişikliği yapılmadı.

F05 repository düzeltmesinin 425 test/typecheck/build CI sonucu geçti; ürün
sahibi PR #107 merge'ünü ve kapanışı kabul etti. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F05_CLOSURE_2026-10-18.json`.
Güncel F01–F05 kapalıdır; sıradaki F06 başlamadı ve uygulama yetkisi yoktur.
Genel A6-TECH-01 PASS değildir; EO-05 engeli korunur.

F06 sunucu hata kayıt aracı repository'de hazırlandı. Kanıt:
`docs/evidence/A6_TECH_01_F06_SAFE_ERROR_LOG_2026-10-18.json`.
Ham hata nesnesi loglanmaz; sabit kod/aşama ve izinli yol/metot kaydedilir.
CI/merge ve ayrı açık onaylı canlı deploy/doğrulama beklenir; F06 açık kalır.
Bu hazırlık canlı düzeltme kanıtı veya F07 başlangıç yetkisi değildir.

F06 düzeltmesi PR #108 ile birleştirilip ayrı açık onayla mevcut Production
adresine alındı. Birebir kaynak/alias READY doğrulandı; ürün sahibi gerçek Shopify
Admin masaüstü ve mobil normal çalışmayı kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json`.
Kapanış kaydının birleştirme onayı beklenir; F07 başlamadı, EO-05 engeli korunur.

F07 mevcut Production'ın F06'da onaylı birebir `main` commit'inden deploy edildiğini
yeniden doğruladı. Güncel main'e göre yalnız altı F06 kapanış dosyası farklı;
diğer 371 kaynak girdisi eşleşir. Kanıt:
`docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json`.
Yeni deploy/secret/yapılandırma/veritabanı işlemi yok. CI ve ürün sahibi kabulü beklenir;
F07 henüz kapanmadı, F08 başlamadı ve EO-05 engeli korunur.

F07 kaynak geçmişi doğrulaması 434 test/typecheck/build CI kapısından geçti;
ürün sahibi kapanışı ve PR #110 merge'ünü kabul etti. Yeni deploy gerekmedi
ve yapılmadı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F07_CLOSURE_2026-10-18.json`.
Güncel F01–F07 kapalıdır; F08 başlamadı/yetkili değil, EO-05 engeli korunur.

F08 iki özel gizlilik tablosunda `workspace_id` FK indeks hazırlığıdır.
Kanıt `docs/evidence/A6_TECH_01_F08_PRIVACY_INDEXES_2026-10-18.json`.
Yeni migration pending; canlı DDL/DML yapılmadı. Mevcut izole DB workflow'u ile
replay ve sentetik öncesi/sonrası plan kontrolü beklenir. Canlı uygulama ayrı
açık onay, güncel ön kontrol ve işlem sonrası kontrol/Advisor kapısından geçer. F08 açık,
F09 başlamadı; veri/silme kuralı/çalışma zamanı/deploy değişikliği yetkilendirilmedi.

F08 iki indeksi ayrı açık onayla canlıya ekledi; Supabase sürüm
`20261018181906` repository'ye SQL içeriği değişmeden eşlendi. 40 applied / 0
pending; önceki migration hash'leri, veri ve güvenlik sınırları korundu.
Security Advisor 0, eksik FK indeks uyarısı 0. Canlı kanıt:
`docs/evidence/A6_TECH_01_F08_LIVE_ACCEPTANCE_2026-10-18.json`.
Son CI ve açık kapanış/merge kabulü beklenir; F09 başlamadı.

F08 canlı kabul/eşleme sonrası genel CI (437 test/typecheck/build) ve iki izole
40-migration yeniden kurulum geçti. Ürün sahibi kapanışı ve PR #111 merge'ünü kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F08_CLOSURE_2026-10-18.json`.
Güncel F01–F08 kapalı; F09 başlamadı/yetkili değil, genel denetim ve EO-05 kapısı
ayrı kapanış/retest kararı olmadan PASS/başlangıç sayılmaz.

F09 birincil çalışma kopyası temizliği doğrulandı; kullanıcı işi veya ayrışmış commit
yoktu. Birebir uzak `main`e fast-forward yapıldı, commit/tree ve temiz 0/0 durumu
doğrulandı. Kanıt `docs/evidence/A6_TECH_01_F09_CHECKOUT_SYNC_2026-10-18.json`.
CI/kabul ve PR merge sonrası son birincil kopya eşitlemesi beklenir. F10 başlamadı; canlı
uygulama/veritabanı/deploy değişmedi, genel denetim/EO-05 kapısı korunur.

F09 kapanış ve PR #112 birleştirme onayı alındı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F09_CLOSURE_2026-10-18.json`.
Önceki hazırlık kayıtları tarihseldir; güncel F01–F09 kapalıdır. Son CI,
merge ve birincil çalışma kopyası'un yeni main ile temiz commit/tree eşliği teslim
kapısıdır; son eşlik PR #112 açıklamasında kalıcılaştırılır. F10 başlamaz,
genel denetim PASS veya EO-05 başlangıç yetkisi verilmez.

F10 için ürün sahibi 18 Ekim 2026'da ayrı uyumluluk çalışması bekleyen açık
teknik borç kararını onayladı. Kanıt:
`docs/evidence/A6_TECH_01_F10_DEFERRED_2026-10-18.json`.
F01–F09 kapalı, F10 açık ve tek başına EO-05 engeli değildir. Bu kayıt F10
düzeltmesi/kapanışı, sürüm veya flag değişikliği, genel denetim PASS ya da EO-05
başlangıç yetkisi değildir. Genel yeniden test ve kapanış kararı ayrı kalır.

Son yeniden test `cddda0fad4803c9212412211495365c69ed2e884` üzerinde 441 test,
typecheck/build ve production bağımlılık taramasını geçirdi. Tam bağımlılık
taraması geliştirme/build zincirinde 4 yüksek, 3 orta, 1 düşük güvenlik bildirimi bildirdi.
Kanıt `docs/evidence/A6_TECH_01_FINAL_RETEST_2026-10-18.json`.
`TECH01-RETEST-SEC01` ayrı, ön P2/güvenlik değerlendirme kaydıdır; F01–F10
tarihsel sırası ve kapanışları değiştirilmez. İlk kayıtta etki analizi/düzeltme
yetkili değildi; sonraki dar onaylar aşağıdadır. Genel denetim PASS, A6-DOCS-01 ve EO-05 başlangıcı verilmez;
bu kayıt yeni altyapı, yedek, sürüm, sağlayıcı veya canlı ortam işi açmaz.

Kullanıcı yalnız Vite `7.3.1 → 7.3.5` güvenlik düzeltmesine açık onay verdi.
Paket kayıt dosyası ve lockfile eşlendi; diğer paket sürümleri aynı kaldı. Vite'nin beş
uyarısı yeni taramada kalktı; kalan 1 yüksek/1 orta/1 düşük güvenlik bildirimi açıktır.
Kanıt `docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json`.
Bu ilk düzeltme PR #115 ile birleştirildi. Tarihsel kanıt değiştirilmez.

Ürün sahibi ardından kalan üç uyarı için kontrollü repository denemesini onayladı:
Vite `7.3.6`, yalnız Vite altında esbuild `0.28.1`, yalnız Vercel config
zincirinde Ajv `8.18.0` ve ts-morph `24.0.0`. Sonuncusu sağlayıcının sürüm sabitlemesi dışında
major geçiştir; gerçek config okuma, doğrulama ve kod paketi kimliği test edilir.
Yeni production ve tam bağımlılık taramaları sıfır güvenlik bildirimi döndürdü; braces
zincirden kaldırıldı, uyarılar gizlenmedi. Kanıt:
`docs/evidence/A6_TECH_01_REMAINING_SECURITY_REMEDIATION_2026-10-18.json`.
CI ve açık birleştirme/kapanış kabulü beklenir. Canlı deploy/sağlayıcı/veritabanı/secret
değişikliği, F10 kapanışı, genel PASS veya EO-05 başlangıcı yetkisi yoktur.

Ürün sahibi PR #116 merge onayını ve ardından güvenlik kapanış kaydının
işlenmesini kabul etti. Düzeltme `aa32e03b57f84b7b5a950a9c9be67826135c2536`
ile main'e alındı; merge tree test edilen kaynak ağacı ile birebir aynı.
GitHub CI'da 449 test, frozen-lockfile kurulumu, typecheck ve build PASS.
`TECH01-RETEST-SEC01` yalnız repository güvenlik kapsamıyla kapalıdır; önceki
hazırlık kanıtları tarihseldir ve değiştirilmez. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_SECURITY_CLOSURE_2026-10-18.json`.
Genel audit için GitHub aktif koruma kuralı kanıtı, eksik Meta doküman teyidi ve
ayrı onaylı güncel release/canlı kabulü kalır. Bilinen Free Plan recovery sınırı
yeni yedek işi açmaz. F10 açık ertelemedir; genel PASS, A6-DOCS-01 ve EO-05
başlangıcı verilmez. Bu kayıt canlı işlem yetkisi değildir.

### A6-TECH-01 ek kanıt — 18 Ekim 2026

Ürün sahibinin oluşturduğu `main-protection` ruleset'i Connector ile okundu:
aktif, yalnız `main`, bypass boş; PR, GitHub Actions `governance`, silme ve
force-push koruması mevcut. Meta rate-limit ve error-handling metinleri ürün
sahibi tarafından resmî sayfalardan paylaşıldı ve incelendi; agent'ın HTTP 429
erişimi giderilmiş veya gerçek hesap testi yapılmış sayılmaz.

Karşılaştırmada iki dar eksik görüldü ve ürün sahibi repository düzeltmesini
onayladı: izin reddi token geçersizliği değildir; `80000/80004` BUC kota sınıfıdır.
Kod/test hazırlığı tek kanıt PR'ında teslim edilir. Kaynak ve kapsam:
`docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json`.
CI, kabul ve birleştirme beklenir. Sonrasında yalnız ayrı onaylı birebir release/canlı
kabulü ve genel kapanış kararı kalır. F10 ertelemesi korunur; yeni yedek işi,
genel PASS, A6-DOCS-01 veya EO-05 başlangıç yetkisi yoktur.

### A6-DOCS-01 başlangıcı — 19 Ekim 2026

Ürün sahibi Türkçe dokümantasyon standardizasyonuna başlanmasını onayladı.
63 Markdown dosyası envantere alındı: 62 insan-okuyucu belge ve değiştirilmeden
korunan `AGENTS.md`. Çalışma sözleşmesi:
`contracts/a6-docs-01-turkish-standardization-v1.json`.
İlk geçiş README ile EO-01/02/03 analiz kitaplarının dilidir; kabul edilmiş
semantik, tarihler, kimlikler ve makine bölüm eşlemeleri korunur. Diğer belgeler
bekleyen durumdadır; paket henüz tamamlanmadı ve EO-05 başlamaz.

19 Ekim 2026'da ilk dört belgenin okunabilirlik ve merge kabulü verildi;
ürün sahibi PR #120'yi merge etti. Merge commit'i
`57d18a1a125de30ca8d86a65034f60fce403dc74`, test edilen kaynakla aynı
`7bdc1e9a28f5be5cbb6f02071555bb9378dd26a0` ağacını taşır.
İkinci dil geçişi EO-01-A/B/C ile EO-02-A/B ve kurulu mağaza yetkisi düzeltmesinin
altı belgesidir. Bunlar okunabilirlik kabulü bekler; diğer 52 belge dil incelemesi
bekler. Uygulama kodu, tarihsel kanıtlar ve canlı ortam değişmez; paket kapanmaz.

Aynı gün ikinci teslimin altı belgesi de ürün sahibi tarafından kabul edildi;
PR #121 onaylı kaynakla aynı ağaç korunarak birleştirildi. Merge commit'i
`039087456127cd0d936049e75603ed52a2bbb7c4`.
Üçüncü dil geçişi EO-02-C faturalandırma ve oturum köprüsü, EO-02-D gizlilik ve
kalıcı işçi belgeleri ile EO-02-C canlı kabul kılavuzudur. Güncel toplam:
10 kabul edilmiş, 5 okunabilirlik kabulü bekleyen, 47 dil incelemesi bekleyen belge.
Önceki ara sayımlar tarihseldir. Bu geçiş eski kabul akışını yeniden yürütmez;
yeni token, gizli bilgi, sorgu, silme, migration veya dağıtım yetkisi üretmez.
EO-05 kapalıdır ve A6-DOCS-01 henüz tamamlanmamıştır.

Üçüncü teslimin beş belgesi de aynı gün açık ürün sahibi kabulüyle PR #122'de
birleştirildi. Merge commit'i `0e8f03ddd1526cc53b8e5e2922211301d512ffef`;
test edilen kaynak ağacı korunmuştur. Dördüncü dil geçişi EO-03-A/B/C/D'nin
OAuth işlemi, token kasası, hesap yetkisi ve bağlantı yaşam döngüsü belgeleridir.
Güncel toplam: 15 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 43 dil incelemesi
bekleyen belge. Önceki sayımlar ara kayıttır. Tarihsel kabul/denemeler yeniden
yürütülmez; kod, canlı ortam ve EO-05 yetki sınırı değişmez.

Dördüncü teslim PR #123, açık ürün sahibi okunabilirlik/merge kabulüyle
`a9d03046d3b0fb8561c366fb398e8a1ef4d950d3` commit'inde birleştirildi;
test edilen ağaç korundu. Beşinci dil geçişi ortak adaptör sözleşmesi ile Meta
OAuth/hesap seçimi, App Role hazırlığı ve raporlama çalışma zamanının dört belgesidir.
Güncel toplam: 19 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 39 dil incelemesi
bekleyen belge. Meta'nın 13 Ekim tarihsel 403 notu 18 Ekim'de onaylanan dar
düzeltmeye yönlendirilir; eski kanıt değiştirilmez, yeni hata kuralı oluşturulmaz.
Paket kapanmaz; uygulama kodu, canlı ortam ve EO-05 yetkisi değişmez.

Beşinci teslim PR #124 açık ürün sahibi kabulüyle
`1581f749e1fcfbf0ad69cf3bc9f3592d5a719db6` commit'inde birleştirildi;
test edilen ağaç korundu. Altıncı dil geçişi Google raporlama çalışma zamanı,
canlı kanıt tetikleyicisi, OAuth düzeltici kuruluşu ve 2026 erişim/review kararıdır.
Güncel toplam: 23 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 35 dil incelemesi
bekleyen belge. Tam gün tarihsel PMax kanıtı, test/Production ayrımı ve review
sonrası aynı çalışma zamanı kararı korunur. Önceki sayımlar tarihseldir;
yeni sağlayıcı çağrısı, erişim başvurusu veya kod/canlı ortam değişikliği yoktur.

Altıncı teslim PR #125 açık ürün sahibi okunabilirlik/merge kabulüyle
`77ac39cfb9cf373c6595b6b7dfe6df5927140457` commit'inde birleştirildi;
test edilen ağaç korundu. Yedinci dil geçişi Klaviyo bağlantı/tahmini harcama,
OAuth güçlendirme, raporlama yetkisi ve satış kaynağı çözümlemesinin dört belgesidir.
Güncel toplam: 27 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 31 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. Aynı-gün ayrı harcama olayları,
istekten önce kalıcı token yenileme ve Message biliniyorsa Channel'ı koruma
kuralları değişmez. Kod, tarihsel kanıtlar ve canlı ortam değiştirilmez;
A6-DOCS-01 kapanmaz, EO-05 başlamaz.

Yedinci teslim PR #126 açık ürün sahibi okunabilirlik/merge kabulüyle
`bfc0de411fa89b5d029952d8399c5fd1be8ca5a9` commit'inde birleştirildi;
test edilen ağaç korundu. Sekizinci dil geçişi Klaviyo raporlama çalışma zamanı,
yeniden yetkilendirme, geçici canlı kanıt ve resmî kabiliyet kaydının dört belgesidir.
Güncel toplam: 31 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 27 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. Audience sağlayıcı ara katmanıdır;
AdsTable Channel/satış bölme boyutu değildir. Eski merge/Advisor durumları
bugünün açık işleri sayılmaz. Gerçek Shopify entegrasyonu kanıtı ve EO-05 eksik
günleri tamamlama işi açık kalır; yeni kod, canlı çağrı veya örnek veri üretimi yoktur.
A6-DOCS-01 kapanmaz; EO-05 başlamaz.

Sekizinci teslim PR #127 açık ürün sahibi okunabilirlik/merge kabulüyle
`f9780f87eaf29f20ed5520ae47e9b6426f77fa89` commit'inde birleştirildi;
test edilen ağaç korundu. Dokuzuncu dil geçişi EO-04 analiz kitabı, ortak
Channel/ürün ekonomisi ve geçici sağlayıcı canlı kabul brief'inin üç belgesidir.
Güncel toplam: 35 kabul edilmiş, 3 okunabilirlik kabulü bekleyen, 24 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. On sekiz senaryo aynı ürün, tarih,
Channel ve Sales Role sonucunu korur; kart alanları Türkçeleştirilir. Meta'nın
16 Ekim tek-sayfa anlatımı sonraki tam sayfalama kabulünü geri almaz. Yanıt ile
dar sunucu logu ayrı kalır. Yeni kod/canlı işlem yok; paket kapanmaz, EO-05 başlamaz.

Dokuzuncu teslim PR #128 açık ürün sahibi okunabilirlik/merge kabulüyle
`eaca2c5376dc0cf0b25322f9a0eac7c6aa8719e9` commit'inde birleştirildi;
test edilen ağaç korundu. Onuncu dil geçişi Meta ve Google tarihsel Channel
araştırma taslaklarının iki belgesidir. Güncel toplam: 38 kabul edilmiş,
2 okunabilirlik kabulü bekleyen, 22 dil incelemesi bekleyen belge.
Eski Google geniş-ağaç varsayımı tarihsel tutulup tek uygun All products ve
tam iş günü kanıtı hakkındaki kabul edilmiş sözleşmeye yönlendirilir; eski
varsayım bugünkü kural diye sunulmaz. Meta katalog yanıtı ve kanonik tıklama
eşlemesi tamamlanmış sayılmaz. Yeni kod/canlı işlem yok; paket kapanmaz, EO-05 başlamaz.

Onuncu teslim PR #129 açık ürün sahibi okunabilirlik/merge kabulüyle
`ec641ea9ea19e330716a503865beaccb924ff2d8` commit'inde birleştirildi;
test edilen ağaç korundu. On birinci dil geçişi F1/F2 yetki kaynağı/canlı veri/
fiziksel proje sınırı ve F3 kod/bağımlılık taşıma kararının iki belgesidir.
Güncel toplam: 40 kabul edilmiş, 2 okunabilirlik kabulü bekleyen,
20 dil incelemesi bekleyen belge. 4 Ekim eski proje envanteri bugünkü durum
değildir; taşıma adayları kesin onay sayılmaz. F3'ün ilk taslak paket eşlemesi
tarihsel olarak korunup güncel Execution Plan sırasına yönlendirilir.
Yeni kod, canlı işlem veya kaynak oluşturma yetkisi yoktur; EO-05 başlamaz.

On birinci teslim PR #130 açık ürün sahibi okunabilirlik/merge kabulüyle
`f0fa17301ad22dc0725a9ff1f313cbdf6d2d3c01` commit'inde birleştirildi;
test edilen ağaç korundu. On ikinci dil geçişi F4 veri taşıma, F5 ürün/rota,
F6 efor/risk ve F7 GO kararının dört belgesidir. Güncel toplam: 42 kabul edilmiş,
4 okunabilirlik kabulü bekleyen, 16 dil incelemesi bekleyen belge.
F4'ün eski “14” özeti tarihsel sayım farkı olarak ayrılıp kabul edilmiş 10 satırlık
listeye yönlendirilir; rota/şema taslakları bugünkü uygulama envanteri değildir.
Süre tahminleri 4 Ekim başlangıç planıdır; GO bugün yeni canlı yetki oluşturmaz.
Kod, canlı ortam ve kabul edilmiş kararlar değişmez; EO-05 başlamaz.

On ikinci teslim PR #131 açık ürün sahibi okunabilirlik/merge kabulüyle
`52335cc6fbcecde15f664beae591264e234c1909` commit'inde birleştirildi;
test edilen ağaç korundu. 46 belge kabul edilmiş, 16 belge dil incelemesi bekler.
Sonraki envanter kontrolünde ana tablo belgesinde bozuk UTF-8 bulundu; ürün
sahibi 19 Ekim 2026'da dar metin onarımını onayladı. Son sağlam tarihsel gövde
`6e95ba9c7134d56e6cf11eba03be149c502e9672` kaynağından doğrulanarak geri getirildi;
yalnız satır sonu boşlukları temizlendi ve güncel yetki notu eklendi.
Bozuk kayıttaki sonraki metin tahminle yeniden oluşturulmadı. Onarım kaydı
`contracts/a6-docs-01-turkish-standardization-v1.json` içindedir. Bu iş Türkçe
çevirinin tamamlandığı sayılmaz; sayım değişmez, EO-05 açılmaz. Yeni metin
bütünlüğü kontrolü 62 insan-okuyucu Markdown dosyasında geçersiz UTF-8,
yerine-geçme karakteri ve ikili kontrol karakterini reddeder. CI ve ürün sahibi
onarım/merge kabulü beklenir; uygulama kodu ve canlı ortam değişmedi.

Ana tablo metin bütünlüğü onarımı PR #132, açık ürün sahibi onayıyla
`526c07a5415b70a21a6ddf20970e6207a33f0200` commit'inde birleştirildi;
test edilen ağaç korundu. Onarım çeviri sayısını artırmadı. On üçüncü dil
geçişi üç yüzeyli ürün tasarımı, Funnel görselleştirme referansı ve demo/dışa
aktarma/dev store sınırının üç belgesidir. Güncel toplam: 46 kabul edilmiş,
3 okunabilirlik kabulü bekleyen, 13 dil incelemesi bekleyen belge.
Ürün niyeti ile uygulama/görsel kabul ayrılır; ekran metinleri ve teknik kimlikler
korunur. Sentetik demo sağlayıcı kanıtı değildir; veri çıkarma, grafik, dışa
aktarma veya dev store kurulumu başlatılmaz. Ana tablo gövdesi değişmez.
Bu teslim kod/canlı ortam değişikliği veya EO-05 başlangıcı değildir.

On üçüncü dil teslimi PR #133 açık ürün sahibi onayıyla
`164175d47420dc37f551860658c8ec44b8916092` commit'inde birleştirildi;
test edilen ağaç korundu. On dördüncü teslim güvenlik/kapasite, secret
envanteri/kurtarma ve iki bağımsız operasyon planının dört belgesidir.
Güncel toplam: 49 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 9 dil
incelemesi bekleyen belge. Önceki sayımlar tarihseldir. Kapasite ve kurtarma
değerleri hedef olarak korunur; F03 envanter eşliği kurtarma hazırlığı sayılmaz.
İlk sağlayıcı hatasında durma, ayrı onaylı temizlik ve izole ortam kurulum
kapıları değişmez. Secret değeri okunmaz; yedek, kasa, rotasyon, temizlik,
kurulum veya canlı işlem başlatılmaz. Ana tablo gövdesi değişmez; EO-05 kapalıdır.

On dördüncü dil teslimi PR #134 açık ürün sahibi onayıyla
`93756a705ac84c5bb0a16e0fb08b18fb45b4158e` commit'inde birleştirildi;
test edilen ağaç korundu. On beşinci teslim TECH-01 denetimi ve F01-A/B/C
geçmişinin dört belgesidir. Güncel toplam: 53 kabul edilmiş, 4 okunabilirlik
kabulü bekleyen, 5 dil incelemesi bekleyen belge. Önceki sayımlar tarihseldir.
İlk bulgular ve başarısız provalar son kapanıştan ayrılır. F01'in dar kurtarma
kabulü tam veri yedeği/PITR sayılmaz; F10 açık ertelemedir. SQL, migration,
araç, workflow ve değişmez kanıtlar değiştirilmez; yeni denetim/prova/yedek veya
canlı işlem başlatılmaz. Ana tablo gövdesi korunur; DOCS bitmez, EO-05 açılmaz.

On beşinci dil teslimi PR #135 açık ürün sahibi kabulüyle
`38c3da3c2272320b58247497de7c099c0c9f36bf` commit'inde birleştirildi;
test edilen ağaç korundu. On altıncı teslim Shopify UI anayasası ve görev
şablonudur. Güncel toplam: 57 kabul edilmiş, 2 okunabilirlik kabulü bekleyen,
3 dil incelemesi bekleyen belge. Önceki sayımlar tarihseldir. Eski R7-B6 kaydı
bugünkü Settings kusuru veya yeni kabul sayılmaz. RC/type eşleşmesi, gerçek
masaüstü/mobil kabulü ve dar grafik çizim istisnası korunur. UI kodu ve
yürütülebilir anayasa sözleşmesi değişmez. Ana tablo metin onarımı kanıtı
korunur; DOCS kapanışı, EO-05 veya yeni görsel uygulama yetkisi verilmez.

PR #136 açık ürün sahibi onayıyla `ed47adf7bc19a9206b1baebda995838021ad3585`
commit'inde birleştirildi; test edilen ağaç korundu. Son dil teslimi Execution
Plan, ana paket tablosu ve kalite kapılarıdır. 59 belge kabul edilmiş, bu son
3 belge okunabilirlik ve paket kapanış kabulünü bekler; çevrilmemiş belge sıfırdır.
Önceki ara sayımlar tarihseldir. Ana tablonun onarılmış özgün gövdesi
`docs/evidence/A6_DOCS_01_MASTER_RESTORED_SOURCE_2026-10-19.txt` içinde önceki
hash'iyle korunur. Çeviri onarım kanıtını veya iş kararlarını değiştirmez.
Son kabul/merge, tüm repository kontrolleri ve uzak içerik doğrulaması kapanış
kapısıdır. EO-05, review, yedekleme veya canlı işlem otomatik başlamaz.

## EO-05 ilk zorunlu kapısı — tarihsel PMax listing-tree kanıtı

**20 Ekim kararıyla durduruldu; PASS değildir.** Bu bölüm önceki gereksinimi
korur, bağımsız zamanlayıcı veya Dataset V2 çalışmasını durdurmaz. Yeniden çalışma
için ürün sahibinin açık onayı gerekir. Kanıta bağlı tarihsel kesin PMax Channel
özelliği bu erteleme ile kabul edilmiş veya etkinleştirilebilir sayılmaz:

1. Her kayıt doğrulanmış Reporting Account saat dilimi, Campaign/Asset Group kimliği, tam listing-tree satırları, kaynak sürümü/hash'i, `valid_from`, `valid_to`, gözlem zamanı ve sorgu kaynak geçmişini taşır.
2. Kesin tarihsel Asset Group yalnız kayıt satışın tüm sağlayıcı iş günü penceresini kapsıyor ve reklamı yapılan/tıklanan ürün için tam bir uygun Asset Group kanıtlıysa üretilebilir.
3. Eksik/kısmi pencere, gün içi ağaç değişimi, çelişkili sürüm/hash veya birden çok uygun grup satış ve Sales Role'u korur; yalnız Channel `Unclassified Channel` kalır. Satılan ürün Channel seçemez.
4. Bugünkü ağaç geçmiş tarih kaydı veya kesin Channel üretemez. Toplama öncesi günler sağlayıcıdan o güne ait kesin tarihsel kanıt gelmedikçe tahminle doldurulamaz.
5. Zamanlayıcı kaydı, değişmez/sürümlü saklama, saklama süresi, boşluk tespiti, uzlaştırma ve çözümleyiciye tarih eşleşmeli kanıt teslimi birlikte kabul edilmeden kapı PASS değildir.

## Ana paket analiz–tasarım kitabı kapanış kapısı — 9 Ekim 2026

Bağlayıcı sözleşme: `contracts/a6-parent-package-analysis-design-closure-v1.json`
CI kontrolü: `tests/a6-parent-analysis-design-books.test.js`

- `Done` veya `Accepted` durumundaki her ana paket, teknik olmayan bir okuyucunun iş akışını anlayabileceği kabul edilmiş bir analiz–tasarım kitabı taşır.
- EO-01: `docs/EO_01_ANALYSIS_DESIGN_BOOK.md`
- EO-02: `docs/EO_02_ANALYSIS_DESIGN_BOOK.md`
- EO-03: `docs/EO_03_ANALYSIS_DESIGN_BOOK.md`
- EO-04 ve sonraki ana paketler kendi kitapları oluşmadan kapatılamaz; eksik dosya veya defter kaydı CI'ı düşürür.
- Kitaplar yürütülebilir sözleşme ve testlerin yerine geçmez; onları analist diliyle açıklayan operasyonel kütüphane katmanıdır.

## Secret envanteri, saklama ve kurtarma kapısı — 10 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_SECRET_INVENTORY_AND_RECOVERY.md`
Yürütülebilir sözleşme: `contracts/a6-eo-secret-inventory-recovery-v1.json`
CI kontrolü: `tests/a6-eo-secret-inventory-recovery.test.js`

- 10 Ekim başlangıç kaydı 11 Vercel Production girdisi ve 1 GitHub Actions secret içeriyordu; repository yalnız ad ve prosedür saklar, değer saklamaz. Sonraki F03 kontrolünde toplam 23 ad doğrulandı; güncel ad envanteri ilgili sözleşme ve kanıttadır.
- Vercel/GitHub maskesi beklenen, yalnız yazılabilen saklama davranışıdır; değerin silindiği anlamına gelmez.
- Secret değişikliği için kesin anahtarın ürün sahibi onayı, etki haritası, geri alma, onaylı şifreli kurtarma kasasına kayıt, dağıtım/iş akışı doğrulaması ve değer içermeyen kanıt gerekir.
- Bağımsız kurtarma kopyası var sayılmaz. Kayıp şifreleme anahtarı eski şifreli veriyi çözmek için yeniden üretilemez.
- İlk gerçek sağlayıcı yetkilendirmesinden önce token anahtarı kurtarma kapısı ve sağlayıcıya özel envanter genişletmesi geçmelidir.
- Production kimlik bilgileri Preview veya Development'a kopyalanmaz; bu ortamların kimlik bilgileri ayrıdır.
- Bu karar secret, sağlayıcı, veritabanı, ortam veya dağıtım değişikliğine izin vermez.

## Paketler arası güvenlik, kapasite ve taşınabilirlik kararı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_CROSS_CUTTING_SAFETY_CAPACITY_FREEZE.md`
Yürütülebilir sözleşme: `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

- Saatlik yenileme zamana yayılır ve bugün+dün ile sınırlıdır. Sağlayıcıya özel kapsamlı uzlaştırma 24 saatte bir çalışır; verinin doğru kesinleşmesini yönetir.
- Summary/Table özel aralığı 90, Daily 31 günle sınırlıdır. Karşılaştırma eşit uzunlukta, çakışmayan dönemleri kurulu Shopify mağazasının saat diliminde kullanır.
- Canlı kabul hedefleri: Kritik DB RPO ≤15 dakika, Dataset V2 RPO ≤60 dakika, kısıtlı hizmet RTO ≤60 dakika, tam hizmet RTO ≤240 dakika. Bunlar tamamlanmış kurtarma kanıtı değildir.
- Supabase kapasitesi çalışma alanı sayısından tahmin edilmez, ölçülür. Hedef 2,000 doğrulanmış aktif çalışma alanı; kanıtı 4,000 çalışma alanlı stres testi ve en az %30 boş kapasitedir.
- Zorunlu test sırası: EO-05 öncesi iş yükü bütçesi ve indeks/sorgu planı başlangıç ölçümü; EO-05 içinde 2,000 çalışma alanlı saatlik zamanlayıcı, 4,000 çalışma alanlı sıkıştırılmış stres ve 24 saatlik 2,000 çalışma alanlı dayanıklılık; EO-06 içinde Summary/Daily/Compare/Table sorgu ölçümü, dışa aktarma çıkmadan yük testi; EO-08 içinde canlıya benzer geri yükleme/yük provası.
- Öncelik ölçülmüş PostgreSQL/Supabase ölçeklemesidir; platform taşıması arıza sırasında doğaçlama çözüm değildir.
- Dışa aktarma ilk review kapsamı dışındadır; eklendiğinde asenkron ve etkileşimli sorgu havuzundan ayrı olacaktır.
- Bu karar paket durumunu değiştirmez veya canlı altyapı değişikliği başlatmaz.

## Demo test verisi, dışa aktarma referansı ve Shopify geliştirme mağazası sınırı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_DEMO_FIXTURE_EXPORT_REFERENCE.md`
Yürütülebilir sözleşme: `contracts/a6-eo-demo-fixture-export-reference-v1.json`

- Eski dashboard HTML'i yalnız referans ve sentetik test verisi ham maddesidir; HTML/JavaScript yeni çalışma zamanına kopyalanmaz.
- 1,000 satır ve 50 günlük sentetik veri; temiz Dataset V2 test verisi, UI kabul girdisi, Shopify geliştirme mağazası demosu ve belirlenimci kapasite üreticisi tohumu olarak EO-05/06/07/08'e yönlendirilir.
- Supabase kapasite koşuları ham HTML'i çalıştırmaz; yalnız standartlaştırılmış belirlenimci üretici tohumunu kullanır.
- Her satır sentetik ve sağlayıcı gerçeği değil olarak işaretlenir. Sağlayıcı kabiliyeti, doğal attribution, kesinleşme, gerçek sıfır, ürün ilişkilendirmesi veya Cross-sell kanıtlayamaz.
- Dışa aktarma davranışı yalnız review sonrası referanstır; uygulaması ilk review kapsamı dışındadır.
- Ayrı Shopify geliştirme mağazası/çalışma alanı ileride sahte sağlayıcı bağlantısı göstermeden gömülü arayüzü sergileyebilir.
- Kaynak test verisi ürün/Cross-sell kabulüne yeterli değildir; EO-07-C'nin ayrı canlı kanıt kapısı korunur.
- Bu karar paket durumunu değiştirmez; mağaza, sağlayıcı, canlı ortam veya veritabanı değişikliğine izin vermez.

## A6-EO-07 üç yüzeyli arayüz ürün kararı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md`
Yürütülebilir sözleşme: `contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json`

- Funnel App Home, Ad Analysis ve Settings tablo/kontrol/iş akışı davranışları donduruldu; EO-07 ilerlemedi, UI uygulaması yetkilendirilmedi.
- İlk kayıtta Funnel bağlamsal dashboard'u ürün sahibinin ilişki grafiği referansını bekliyordu; ilgisiz klasik grafik varsayımı yasaktı. Sonraki kabul aşağıdaki grafik referansı kaydındadır.
- Ad Analysis grafikleri; EO-07-C en alt analiz seviyesini ve iki ayrı küpe/Cross-sell senaryosunu Meta, Google Ads ve Klaviyo için doğrulayana kadar kapalıdır.
- Settings'te grafik yüzeyi yoktur.
- Çalışan eski Settings akışı yalnız etkileşim kanıtıdır; eski kaynak kod, stil ve emekli sağlayıcı arayüzü kopyalanmaz.

## Kabul edilmiş temel: EO-02

- **EO-01-A — Accepted:** Fork veya toplu kopyalama olmadan ayrı temiz repository ve fiziksel sınır kuruldu. Kabul commit'i: `cb02ef7c2e9236ab50da792f21d667fae91cbccd`.
- **EO-01-B — Accepted:** Güncel resmî Shopify teknoloji yığını, temiz bağımlılık tanımı/lockfile ve negatif CI kapıları birleştirildi. Kabul commit'i: `111e7dec66c84c48be43930f3496ea5b0f918949`.
- **EO-01-C — Accepted:** Polaris 2.0 RC üç yollu veri iddiası taşımayan Preview kabuğu ürün sahibi tarafından görsel olarak kabul edildi ve birleştirildi. Kabul commit'i: `76ea38a474c701d69871f73ba713376e3a7d623e`.
- **EO-02-A — Accepted:** Ayrı Frankfurt Supabase projesinde özel şema, sahip/migration yöneticisi/çalışma zamanı rol sınırı ve temiz migration zinciri canlı olarak doğrulandı; PR #4 merge commit'i: `2ac00f969eb35ac632ead57017753ed495e7b66f`.
- **EO-02-B — Accepted:** Çalışma alanı, kurulum ve nesil otoritesi migration zinciri canlı Supabase'de PASS oldu; kendini temizleyen ilk yükleme/güvenli tekrar/eski kayıt/alan adı değişimi kontrolü sonrası iş satırı sıfır, Security ve Performance Advisor temizdir. PR #6 merge commit'i: `edc9e21588f5a32bea139b754ea0108c9809cf27`.
- **EO-02-C — Accepted:** Shopify App Pricing + Partner API otorite modeli, zorunlu RLS korumalı abonelik izdüşümü ve Supabase kontrolü hazırdı. 8 Ekim 2026'da App Store kaydı, Production Vercel Partner secret/dağıtım ve `activeSubscription` null/trial/active sağlayıcı kabulü PASS oldu. Deneme, herkese açık `AdsTable Monthly` planında etkin fiyat `USD 0.0` ve `price.active=false`; aktif durum, hedef mağazaya açılan özel `shopify-test` planında `trialEndsAt=null`, geçerli faturalandırma dönemi, etkin fiyat `USD 0.0` ve `price.active=true` döndürdü. Fiyat-sürümü üst veri düzeltmesi PR #18 ile birleştirilip Production'a alındı. Tarayıcı/yanıt/uygulama/platform log sızıntı kontrolleri PASS oldu. PR #23 ile Supabase Root CA doğrulamalı transaction-pooler TLS Production'a alındı; Shopify Admin masaüstü ilk yükleme ve tam sayfa yeniden yükleme PASS oldu. Canlı veritabanı bir çalışma alanı, nesil-1 aktif kurulum, yalnız şifreli çalışma zamanı oturumu, aktif abonelik izdüşümü ve aktif kullanım hakkı taşır. 9 Ekim 2026'da kullanım hakkının seçilebilir mağaza üst verisi taşımasının yanlış olduğu saptandı; aktif model kurulu Shopify mağazasına kilitlendi. Ayrı açık ürün sahibi onayıyla düzeltici migration canlı Supabase'e uygulandı; eski üç üst veri kolonu kaldırıldı, mevcut kullanım hakkı satırı korundu, yalnız fonksiyon çalıştırma çalışma zamanı sınırı ve sıfır Security Advisor bulgusu doğrulandı. Gerçek mobil Shopify uygulamasında Funnel, Ad Analysis, Settings ve tam uygulama kapatıp yeniden açma kabulü PASS oldu; canlı izdüşüm sayıları tutarlı ve kontrol edilen Vercel çalışma zamanı penceresi hatasız kaldı. Teknik canlı kabul kapılarının tamamı PASS oldu. Eski kayıt reddi önceki canlı veritabanı kabul kanıtından bağlandı; ürün sahibi 8 Ekim 2026'da açık kapanış kabulünü verdi. Teknik açık kalem sıfırdır.
- **EO-02-D — Accepted:** Gizlilik/kaldırma/silme/temiz kurulum girişi, özel zorunlu-RLS kuyruk/envanter modeli, birebir Shopify yapılandırması ve dağıtılmış geçersiz-HMAC 401 kabulü PASS oldu. 9 Ekim 2026'da Supabase Cron işçisi ve PostgreSQL koşullu ifade düzeltmesi canlıya uygulandı. 08:00 UTC doğal Cron koşusu sentetik `customer_data_request` çalışmasını tek denemede `completed/no_customer_data` manifestiyle tamamladı; yeniden işleme sıfır iş seçti, uygulama çalışma zamanı işçiyi ve fiziksel silme yürütücüsünü çalıştıramıyor, Security Advisor sıfır ve sentetik temizliği sıfır kalan kayıtla PASS oldu. Kalıcı kanıt `docs/evidence/EO_02D_DURABLE_WORKER_LIVE_2026-10-09.json` dosyasındadır. Ürün sahibi 9 Ekim 2026'da açık kapanış kabulünü verdi; teknik açık kalem sıfırdır.

EO-02-A iş tablosu veya veri kurmaz, çalışma zamanı kimlik bilgisini etkinleştirmez, canlı token/veri taşımaz, Vercel ortamını değiştirmez ve eski Supabase projesine dokunmaz.

## EO-04-A ortak adaptör başlangıç özeti — 10 Ekim 2026 (tarihsel)

Bağlayıcı analist özeti: `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md`
Yürütülebilir başlangıç sözleşmesi: `contracts/eo-04a-common-adapter-start-brief-v1.json`
CI kontrolü: `tests/eo-04a-common-adapter-start-brief.test.js`

- O aşamada EO-04 yalnız EO-04-A başlangıç özeti kapısında aktifti; ortak adaptör uygulaması başlamamıştı.
- Kurulu Shopify mağazası değiştirilemez ticaret otoritesidir. Sağlayıcı hesabı, alan adı, pixel, URL, UTM, click ID veya Campaign adı çalışma alanı/mağaza kapsamı oluşturamaz veya değiştiremez.
- Yalnız sağlayıcının açık sayısal sıfırı sıfır olur. Boş, eksik, desteklenmeyen, izni reddedilmiş, belirsiz, geçici, kısmi ve başarısız ayrı kalır.
- Kanonik Funnel talebi on ham gerçektir: Gösterim, reklam tıklaması, oturum, harcama, ATC adet/değer, checkout adet/değer ve purchase adet/değer. Sağlayıcının alan adı sözleşmeyi değiştiremez.
- Meta/Google Ads bir ila üç doğrulanmış reklamveren hesabına izin verir. Google Manager/MCC yalnız erişim yoludur; Reporting Account veya Funnel varlığı seçilemez. Klaviyo tam bir doğrulanmış hesaba bağlanır; Ad Account diye adlandırılmaz.
- Başlangıç özeti OAuth'tan ilk veriye birebir 17 adımı kaydeder. İlk yükleme önce dün, sonra bugündür; saatlik yenileme/uzlaştırma EO-05'e aittir.
- Sayfalama opak, sınırlı, güvenle tekrarlanabilir ve yayından önce tamdır; eksik sayfa tam sonuç olamaz.
- İlk taslağın tekrar denemesi yalnız belgelenmiş geçici sınıflarla sınırlıydı; kota kurtarma bilgisi tahminî gecikmeden önceliklidir. Bu tasarım ilk sağlayıcı hatasında durma ve yeni onay kapısını aşmaz.
- Ham kanıt özel, sınırlı, temizlenmiş ve içerik hash'li tutulur; token, kimlik bilgisi ve profil düzeyi kişisel veri yasaktır.
- EO-04-A sağlayıcı secret'ı veya canlı sağlayıcı/API, veritabanı, Vercel, dağıtım değişikliği oluşturmadı.
- Meta Graph/Login/sürüm/hesap kaynakları 13 Ekim 2026'da yeniden kontrol edildi. Production yapılandırması, dağıtımı ve masaüstü OAuth kabulü ayrı açık yetkiyle geçti. Mobil temiz oturum kabulü o kayıtta denenen kimliğin App Role yetkisi olmaması nedeniyle açıktı; AdsTable kod hatası sayılmadı. Sonraki kabul kayıtları bu ara durumu tamamlar.

## EO-03/EO-04 kapanışı ve o andaki sonraki kapı TECH-01 — tarihsel

- **EO-03-A — Accepted:** Çalışma alanı/kurulum nesline bağlı OAuth durum makinesi, birebir dönüş izin listesi, tek kullanımlık state sahiplenme ve canlı özel veritabanı sınırı repository, veritabanı ve ürün sahibi kapılarından geçti.
- **EO-03-B — Accepted:** Sürümlü AES-256-GCM şifreli token kaydı, yalnız şifreli veri kasası, canlı özel veritabanı sınırı, Production başlangıç koruması ve secret içermeyen sentetik kabul geçti.
- **EO-03-C — Accepted:** Güncel sağlayıcı doğrulamalı hesaplar ve tek kanonik Meta/Google Reporting Account, değişmez kurulu Shopify mağazasına bağlıdır. Klaviyo tek Connected Account'tur, Reporting Account kontrolü yoktur. Kullanıcı mağaza kapsamı seçemez.
- Ayrı onayla EO-03-C temel/düzeltici Supabase migration'ları 9 Ekim 2026'da uygulandı. Geri alınan sentetik kabul geçti; kalıntı, Security Advisor ve bu işten kaynaklı eksik FK indeksi sıfırdır. Sağlayıcı API/OAuth, Vercel değişikliği veya Production dağıtımı yapılmadı. Ürün sahibi kapanışı 9 Ekim'de kabul etti; kanıt `docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json`.
- **EO-03-D — Accepted:** Yeniden yetkilendirme, atomik kimlik bilgisi yenileme, iki aşamalı bağlantı kesme ve aynı kanonik kimlikle yeniden bağlanma; tamamen geri alınan canlı yaşam döngüsü senaryosundan geçti. Sentetik kalıntı ve Advisor sıfır; sağlayıcı API/OAuth/Vercel/dağıtım değişikliği yok. Kanıt: `evidence/eo-03d-live-database-evidence-2026-10-09.json`.
- **EO-03 — Accepted:** Dört alt paket açık ürün sahibi kabulüyle kapandı.
- **EO-04 — Accepted (18 Ekim 2026):** Ortak adaptör, üç sağlayıcı çalışma zamanı sınırı, kanonik Channel/Sales Role sözleşmesi ve okunabilir senaryo matrisi kabul edildi. Meta canlı yanıt biçimi, Google test hesabı review kanıtı ve Klaviyo `environment_not_ready` kanıtı sınırlarıyla korunur.
- Bu kapanış Meta App Role gerçek katalog, Google Explorer-or-higher canlı hesap ve Klaviyo Shopify entegrasyonu sonrası gerçek raporlama kanıtını tamamlamaz. Tarihsel PMax listing-tree saklama EO-05'in ilk zorunlu kapısıdır.
- Geçici Settings Meta kanıt butonu kaldırıldı. Google butonu canlı hesap kanıtına, Klaviyo butonu Shopify entegrasyonu kanıtına veya EO-05 zamanlayıcısının bu taşımanın yerini almasına kadar korunur.
- O kapanışta sıradaki zorunlu çalışma `A6-TECH-01` idi; kritik düzeltmeler ve `A6-DOCS-01` tamamlanmadan EO-05 açılamaz. TECH-01'in sonraki genel kabulü üstteki güncel özettedir.

## EO-03-C resmî sağlayıcı dayanağı — 9 Ekim 2026

Shopify kimlik doğrulama/erişim token'ı otoritesi, Meta resmî Marketing API koleksiyonu,
Google Ads erişim modeli ve `ListAccessibleCustomers`, Klaviyo OAuth/Get Account,
Supabase değişiklik/fonksiyon/RLS belgeleri kontrol edildi. Sağlayıcıya özel HTTP keşfi
EO-04'e aittir; EO-03-C yalnız kısa ömürlü doğrulanmış kanıt kabul eder.
Eski, farklı sağlayıcıya ait veya kullanıcı tarafından girilmiş hesap kimliğiyle güvenli biçimde durur.

## 6 Ekim 2026 resmî teknoloji dayanağı — tarihsel

6 Ekim 2026 tarihinde Shopify'ın resmî App Home ve başlangıç şablonu belgeleri kontrol edildi:

- Public App Store sunucu uygulaması geliştiricinin barındırdığı iframe App Home modelini kullanır.
- Temiz başlangıç için resmî React Router şablonu temel alınır.
- App Bridge ve Shopify Polaris web components ürün kabuğunun zorunlu arayüz katmanıdır.
- Ürün sahibinin 6 Ekim 2026 tarihli açık kararıyla aktif referans sürüm `polaris-2.0-rc.js` ve birebir `@shopify/polaris-types@2.0.0-rc.2`'dir; RC riski kabul edilmiştir ve stable 1.x'e otomatik dönüş yapılamaz.

EO-01-B bağımlılık sürümlerini sabitlemeden ve EO-07 UI uygulamasından önce resmî sürümler tekrar doğrulanır.

## 6 Ekim 2026 Supabase başlangıç durumu — tarihsel

6 Ekim 2026 tarihinde Supabase'in resmî API güvenliği, Postgres rolleri, RLS, bağlantı ve kırıcı değişiklik belgeleri kontrol edildi.

- Yeni proje: `podpwkrpmjiksskxhwsu`, Frankfurt, PostgreSQL 17.11 GA.
- Özel şemalar: `app`, `shopify`, `integrations`, `analytics`, `operations`, `privacy`, `billing`.
- Data API rolleri özel şemalara erişemez.
- Çalışma zamanı şema kullanabilir fakat şema oluşturamaz ve henüz hiçbir tablo yetkisi yoktur.
- Çalışma zamanı/migration yöneticisi parolaları NULL'dır; Vercel bağlantısı bu paketin kapsamı değildir.
- Security ve performance advisor bulgusu sıfırdır.

## 8 Ekim 2026 Shopify abonelik dayanağı

8 Ekim 2026 tarihinde Shopify'ın resmî Shopify App Pricing ve Partner API belgeleri yeniden kontrol edildi:

- Yeni public app için desteklenen fiyat modelinde varsayılan otorite Shopify App Pricing'dir; Manual Billing API eski modeldir.
- Plan, fiyat ve 14 günlük trial Shopify tarafında yaşar; AdsTable `appSubscriptionCreate` veya yerel deneme hakkı üretmez.
- Kanonik abonelik okuma modeli Partner API `2026-07` `activeSubscription(appId, shopId)` sorgusudur.
- `price.active` yalnız fiyat sürümünün güncel katalog fiyatı olup olmadığını gösterir; abonelik veya kullanım hakkı aktiflik bayrağı değildir.
- Trial kullanımı Shopify tarafından 180 günlük dönem boyunca izlenir; yeniden kurulum denemeyi sıfırlamaz.
- Shopify App Pricing billing webhook'u göndermez; dönüş, uygulama açılışı ve kullanım hakkı-korumalı işlerde kontrollü Partner API uzlaştırma gerekir.
- Her Shopify uygulama kurulumu yalnız kendi doğrulanmış mağazası için çalışma alanı ve abonelik üretir; ikinci mağaza ayrı installation ve subscription gerektirir.

## A6-EO-07-B Funnel grafik referansı — 7 Ekim 2026

- Ürün sahibinin grafik referansı kabul edildi; `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md` ve `contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json` ile bağlayıcıdır.
- Performance; Sales, Revenue ve Spend'i ilişkilendirir. Intent; Add to Cart, Checkout, Abandoned ve Purchase'ı ilişkilendirir.
- Kullanıcı terimi `Sales`tir; iç `sales_value` uygulama anahtarı kalabilir.
- Mevcut dönem düz, karşılaştırma kesik çizgiyle gösterilir. Olumlu/olumsuz değişimin anlamı metrik sözleşmesinden gelir.
- Grafik, seçili nokta, KPI ve tablo tek BFF/sorgu/formül otoritesi kullanır.
- SVG/Canvas yalnız grafik veri düzlemindedir; çevre arayüz resmî Polaris/App Bridge kalır.
- Ad Analysis grafikleri A6-EO-07-C kanıtı ve ayrı kabul edilmiş grafik özeti bekler.
- Yeni paket açılmadı; A6-EO-07 ilerlemedi, uygulama/canlı değişiklik yetkisi verilmedi.

## A6-OPS-LOCAL-01 — Tek seferlik güvenli yerel temizlik

**Durum:** Hazır; uygulama başlamadı
**Tür:** Bağımsız operasyon paketi; A6-EO bağımlılık zinciri dışında

- **A6-OPS-LOCAL-01-A — Salt okunur envanter:** AdsTable kökleri, durum, dallar, stash, worktree, ortak Git üst verisi ve yalnız yerelde kalan adaylar değişikliksiz listelenir.
- **A6-OPS-LOCAL-01-B — Sınıflandırma ve uzak eşdeğer kanıtı:** Anlamlı iş, secret/yedek, atılabilir çıktı, aktif/arşivlenebilir worktree ve geçersiz üst veri ayrılır; temizlikten önce GitHub eşliği kanıtlanır.
- **A6-OPS-LOCAL-01-C — Geri alınabilir temizlik:** Yalnız güncel envanter ve ayrı açık onaydan sonra uygun worktree arşivlenir; kesin doğrulanmış kökte atılabilir olduğu kanıtlanan içerik kaldırılır.
- **A6-OPS-LOCAL-01-D — Kapanış kanıtı:** Yalnız yerelde kalan anlamlı işin sıfır olduğu, ana kopya/ortak üst verinin sağlamlığı, uzak eşdeğerlerin okunabilirliği ve istisnaların kaydı kanıtlanır.

Paketin açılması silme yetkisi vermez. 10 EO ana paketi, 43 sabit alt paket veya iş sırası değişmez.
İlk kayıttaki A6-EO-02-C aktif kapı ifadesi tarihseldir; bugün aktif kapı DOCS'tur.
Tekrarını, zorunlu paket sonu yalnız-yerelde-anlamlı-iş-sıfır kontrolü önler.

## A6-OPS-SHOPIFY-01 — İzole Shopify gömülü ön üretim ortamı

**Durum:** Planlandı; tetikleyiciye ulaşılmadı; uygulama başlamadı
**Tür:** Devreye alma sınırına kadar EO bağımlılık zinciri dışında bağımsız ön koşul paketi

Bağlayıcı analist özeti: `docs/A6_OPS_SHOPIFY_01_ISOLATED_PREPRODUCTION.md`
Yürütülebilir sözleşme: `contracts/a6-ops-shopify-01-isolated-preproduction-v1.json`

- Gerçek mağazanın AdsTable kullanımı için Shopify'a taşınması veya ilk dış/ekip dışı kullanıcının daveti; hangisi önceyse ondan önce zorunlu ön koşuldur.
- Ayrı Shopify geliştirme uygulaması/mağazası, adlandırılmış canlı olmayan yapılandırma, sabit gömülü Preview/Staging URL ve birebir dönüş adresleri, Preview'a özel kimlik bilgileri ve Production'dan izole kalıcı veri gerekir.
- Canlı mağaza geliştirme mağazası yerine geçmez. Production kimlik bilgileri Preview/Development'a kopyalanamaz; Preview Production iş verisine yazamaz.
- Gerçek sağlayıcı hesabı kabulü ayrı onaylı, salt okunur ve kesin hesaba bağlıdır. İlk açık veya açıklamasız hatada durulur; tekrar veya alternatif rota yeni açıklama/onay ister.
- Kanıt A6-EO-08-D'ye girdi olabilir; paket review'a hazır ilan etmez, aktif EO ana paketini ilerletmez.
- Ürün sahibi 17 Ekim 2026'da planlamayı kabul edip uygulamayı açıkça erteledi. Bu kayıt Shopify/Vercel/veritabanı/secret/sağlayıcı/dağıtım/taşıma/davet/review/merge işlemi yetkilendirmez.

### EO-02-C düzeltici kapı — Shopify çalışma zamanı kimlik doğrulama köprüsü

EO-02-C internal caller kodu tek başına canlı tetikleyici değildir. `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md` ve `contracts/eo-02c-shopify-runtime-auth-bridge-v1.json` PASS olmadan veritabanı Secret etkinleştirilemez, EO-02-C kapatılamaz ve EO-02-D başlatılamaz. Ürün URL'leri ve mevcut preview görünümü korunur.

## 9 Ekim 2026 — Kurulu mağaza otoritesi düzeltici kapısı

- Kullanıcının seçebildiği mağaza kapsamı kaldırıldı; Shopify gömülü çalışma alanının ticaret otoritesi doğrulanmış ID token + Admin GraphQL `shop` ile belirlenen kurulu Shopify mağazasıdır.
- Sağlayıcı Reporting Account seçimi bu otoriteye tabidir ve kurulu mağazayı değiştiremez.
- Sağlayıcı varlıkları kurulu mağazaya deterministik bağlanamıyorsa hesap bağlı kalabilir fakat raporlama otoritesi olamaz; Dataset V2 ve SnapshotJob güvenli biçimde durur.
- İkinci Shopify mağazası ayrı app installation, çalışma alanı ve abonelik gerektirir. WooCommerce, BigCommerce ve Magento Shopify embedded workspace'e ticaret kaynağı olarak giremez.
- EO-02-B/EO-02-C repository düzeltmesi, CI ve ayrı açık onaylı canlı Supabase migration 9 Ekim 2026'da tamamlandı. Canlı kanıt `docs/evidence/EO_02BC_INSTALLED_SHOP_AUTHORITY_LIVE_2026-10-09.json` dosyasındadır; EO-02-D kapanış hattı bu düzeltmeden sonra devam eder.
- Otorite: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.

## 9 Ekim 2026 — EO-02-D-C1 kalıcı silme işçisi düzeltici kapısı

- Production incelemesi, doğrulanmış gizlilik talebi sahiplenmesi ve silme işi üretildiğini fakat kuyruğu tüketen kalıcı işçi bulunmadığını kanıtladı.
- Seçilen mimari Supabase Cron / pg_cron'dur; Vercel Cron, HTTP hop veya yeni ortam secret'ı eklenmez.
- Her 5 dakikada 25 run; güvenlik bildirimi lock, row lock, idempotent generation boundary ve bounded retry uygulanır.
- Uygulama çalışma zamanı fiziksel silme yürütücüsünü doğrudan çağıramaz.
- 20 denemeyi tüketen iş sessiz başarı sayılmaz; görünür başarısız durumda operasyon müdahalesi bekler.
- Otorite: `docs/EO_02D_DURABLE_DELETION_WORKER.md` ve `contracts/eo-02d-durable-deletion-worker-v1.json`.
- Repository değişikliği canlı değişiklik yetkisi değildir; canlı Supabase migration ve sentetik kabul ayrı açık kullanıcı onayı gerektirir.

## 9 Ekim 2026 — EO-03-D sağlayıcı bağlantısı yaşam döngüsü kabulü

- EO-03-D **Accepted** durumundadır; geri alınan canlı senaryonun tüm aşamaları PASS, sentetik kalıntı sıfır ve EO-03 ana paket kapanışı ürün sahibi onayıyla tamamlanmıştır.
- Yalnız `connected` lifecycle durumu raporlama otoritesi'dir. `reauthorization_required`, `disconnect_pending` ve `disconnected` yeni veri işini fail-closed durdurur.
- Yenileme yeni şifreli kimlik bilgisi zarfı hazır olduktan sonra expected-sürüm + unique-event-id ile atomik swap yapar; eski zarf değiştirme sonrasında aynı transaction içinde silinir.
- Disconnect iki aşamalıdır. Geçici veya belirsiz sağlayıcı yetki iptal sonucu başarı sayılmaz; bağlantı `disconnect_pending` kalır. Son bağlantı kesme geçmiş analitiği silmez.
- Yeniden bağlanma aynı kanonik bağlantı kimliğini kullanır; yeni kimlik bilgisi ve güncel sağlayıcı hesap kanıtı zorunludur.
- Meta için uydurma refresh-grant davranışı yoktur. Google Ads ve Klaviyo `invalid_grant` sonucu yeniden yetkilendirme gerektirir; Klaviyo token/revoke host'u `a.klaviyo.com` olarak sabittir.
- Otorite: `docs/EO_03D_PROVIDER_CONNECTION_LIFECYCLE.md` ve `contracts/eo-03d-provider-connection-lifecycle-v1.json`.
- Temel migration ile dört ileri-yönlü düzeltme canlı Supabase'de uygulanmış ve doğrulanmıştır. Bu kabul sağlayıcı API çağrısı, canlı sağlayıcı OAuth, sağlayıcı-console değişiklik, Vercel değişiklik veya production deploy içermez.
- EO-04 **Accepted** durumundadır. Sağlayıcı production doğrulamaları kapanışta açıkça devredilmiş, `A6-TECH-01` ise EO-05 öncesindeki aktif zorunlu kapı olarak atanmıştır.

## 10 Ekim 2026 — EO-04-A ortak adaptör uygulama kapısı (tarihsel)

- Ürün sahibi EO-04-A analist özetini uygulamadan önce kabul etti.
- Ortak çalışma zamanı ve sıkı tipler `app/lib/providers/common-adapter.server.js` ile `app/lib/providers/common-adapter.server.d.ts` içindedir.
- Meta, Google Ads ve Klaviyo aynı on kanonik ham metrik sorusunu yanıtlar; doğal istek biçimleri sağlayıcı alt paketlerine aittir.
- Destek kabiliyeti ile gözlem sonucu ayrıdır. Yalnız açık sağlayıcı sayısal sıfırı sıfır olur.
- Sayfalama yayından önce tamdır. Cursor döngüsü, çelişkili tekrar, eksik sayfa, şema hatası veya bitmiş bütçe satır yayımlamaz.
- İlk ortak tasarımın tekrar denemesi yalnız belgelenmiş normalize geçici sınıflarla sınırlıdır; kimlik/yetki/doğrulama ve kesin kapsam hataları tekrarlanmaz. Güncel ilk hata sonrası durma kapısı korunur.
- Sağlayıcı kanıtı sınırlı, temizlenmiş ve içerik hash'lidir; secret/kişisel veri kalıpları gizlenir.
- Belirlenimci sentetik davranış `tests/eo-04a-common-adapter.test.js` ile sınanır.
- EO-04-A'da canlı sağlayıcı çağrısı, secret okuma/yazma, DB/Vercel değişikliği veya dağıtım yoktur.
- GitHub Actions `38049487145` koşusu 163/163 test, tip kontrolü ve Preview derlemesini geçti. Ürün sahibi 10 Ekim 2026'da EO-04-A'yı kabul edip PR #65 merge'ünü onayladı. EO-04-B OAuth resmî kaynak/analist kapısı 13 Ekim'de geçti; ayrı Production yapılandırma/dağıtım, tam Windows akışı ve iOS temiz oturum başlangıcı kabul edildi. Rolü olmayan Windows hesabı Android'le aynı review öncesi Meta kısıtını verdi; ürün sahibi doğrudan PASS verdi. Meta raporlama sözleşmesi/uygulaması o ara kayıtta henüz başlamamıştı.

## 10 Ekim 2026 — EO-04-A ürün sahibi kapanışı

- EO-04-A ortak adaptör sözleşmesi **Accepted**, yani kabul edilmiş durumdadır.
- Kapanış sağlayıcıdan bağımsız çalışma zamanı, sıkı tipler, belirlenimci sahte sağlayıcı testi ve secret içermeyen kanıt politikasını kapsar.
- Ürün sahibi kabulü ve PR #65 merge yetkisi açıktır.
- O anda EO-04-B aktifti; 13 Ekim resmî Meta kaynakları ve OAuth/hesap seçimi özeti kabul edilmiş, repository uygulaması/CI bekleniyordu.
- Bu kapanış sağlayıcı secret'ı, canlı API, DB/Vercel değişikliği veya dağıtım yetkilendirmez.

## 13 Ekim 2026 — EO-04-B Meta OAuth/hesap seçimi uygulama kapısı

Bağlayıcı analist özeti: `docs/EO_04B_META_OAUTH_ACCOUNT_SELECTION.md`
Yürütülebilir sözleşme: `contracts/eo-04b-meta-oauth-account-selection-v1.json`
CI kontrolü: `tests/eo-04b-meta-oauth-account-selection.test.js`

- Meta Graph/Login `v26.0` sürümüne sabittir; OAuth yalnız `ads_read` ister ve birebir gömülü dönüş adresini kullanır.
- Çalışan Google davranışı ayrıdır. Meta aynı kabul edilmiş akışı kullanır: OAuth, otomatik reklamveren seçimi, bir-üç hesap ve tam bir Reporting Account.
- Tek hesap otomatik bağlanır; iki/üç hesapta ayrı açık Reporting Account seçimi gerekir. Cancel bekleyen durumu korur; Resume setup OAuth'u yeniden başlatmaz.
- Token kabulü kısa ömürlüden uzun ömürlüye değişim, `/debug_token` ile uygulama/izin/bitiş doğrulaması ve EO-03-B kasasında yalnız şifreli saklama gerektirir.
- `/me/adaccounts` opak cursor ile sayfalanır; sayfa/hesap üst sınırı vardır. Geçersiz yetkilendirme yeniden yetki ister; boş liste sahte başarı olmaz.
- Disconnect önce sağlayıcı yetkisini iptal eder; sağlayıcı başarısızlığında yerel raporlama otoritesi korunur.
- OAuth/hesap seçimi raporlama verisi, zamanlama veya geçmiş veri tamamlama başlatmaz. O kabul diliminde sağlayıcı raporlama davranışı henüz yetkili/uygulanmış değildi.
- Dört Meta ortam adı yalnız ad envanterindedir; değer commit edilmez veya geri okunmaz.
- `f3f0516b5b938b683d10cd14b75947cd805120e0` commit'inin `dpl_GxV2DQiXYaer24W1247iPAn9N6gR` Production dağıtımı READY oldu. Masaüstü OAuth, hesap seçimi, Reporting Account, Cancel/Resume, Disconnect ve yeniden bağlantı PASS.
- Geliştirici rolündeki hesapla tam Windows akışı geçti. Yeni iPhone Connect işlemi Meta parola ekranını doğru açtı. Rolü olmayan farklı Facebook hesabının kontrollü Windows denemesi Android'in aynı **App not active** yanıtını üretti; bu cihaz/AdsTable kod kusuru değil, Meta geliştirme/review öncesi kullanıcı kısıtıydı. Android tekrarı isteğe bağlıdır; kopyalanmış OAuth URL/state yeniden kullanılamaz.
- Kanıt: `docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json`. Canlı OAuth ve ürün sahibi kabulü PASS. Açık merge onayıyla PR #68 `23911ffd565f385c02693ed7a1f3a07f017c30f5` olarak birleştirildi. O kayıtta sıradaki Klaviyo EO-04-D idi.

### EO-04-D Klaviyo başlangıç kapısı (tarihsel)

Kabul edilmiş başlangıç özeti
`docs/EO_04D_KLAVIYO_OAUTH_ESTIMATED_SPEND_START_BRIEF.md` ve
`contracts/eo-04d-klaviyo-oauth-estimated-spend-v1.json` içindedir.
Yeni EO-03 otoritesinde OAuth → tek doğrulanmış Connected Account → ilk tahmini
harcama → Update spend / Change value → önce iptal eden Disconnect akışı korunur.
Tahmini harcama, geçerlilik tarihli özel defterinde tutulur; raporlama, Channel
kararı ve maliyet dağıtımı başlangıç dilimi dışındadır. Ürün sahibi başlangıcı
13 Ekim 2026'da kabul etti. Repository OAuth/tek hesap temeli, harcama defteri
migration'ı, atomik Save and connect, Update spend, Change value ve Disconnect
yollarını içeriyordu. Ayrı onaylı canlı DB kapısında `eo04d_klaviyo_spend_ledger`
uygulandı; geri alınan sentetik kabul, sıfır kalıntı, sıfır Advisor ve yeni eksik
FK indeksi bulunmadığı kaydedildi:
`docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json`.
Canlı OAuth, sağlayıcı paneli, Vercel/dağıtım ayrı kapıydı; masaüstü/gerçek mobil
kabul o hazırlık aşamasında henüz açıktı.

### EO-04-D Klaviyo OAuth güçlendirme kapısı — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_OAUTH_HARDENING_BRIEF.md`
Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-oauth-hardening-v1.json`
CI kontrolü: `tests/eo-04d-klaviyo-oauth-hardening-contract.test.js`

- Ürün sahibi onayı yalnız repository OAuth/token güçlendirmesini kapsar; canlı çağrı, secret, DB, ortam, dağıtım, UI veya sağlayıcı paneli değişikliği değildir.
- Klaviyo token bitişi şifreli token kümesinde tutulur. Süresi dolmuş, dolmak üzere veya bitiş kanıtı olmayan eski token, hedef sağlayıcı isteğinden önce yenilenir.
- Başarısız sağlayıcı isteği sonlandırıcıdır; ardından token yenileme veya otomatik tekrar olmaz. Accounts `401`, Accounts `403`, yenileme `invalid_grant` ve authorization-code `invalid_grant` ayrıdır.
- Bağlı Settings incelemesi yereldir; yalnız sayfa açıldı diye Klaviyo çağrılmaz.
- Klaviyo'dan başlayan kurulum taşıması geçerli gelecek review ihtiyacıdır; izole Shopify ön üretimi ve açık görsel kabule kadar ertelenir. PR #91 bu sunucu paketi için merge yetkisi değildir.

## EO-04-D Klaviyo raporlama kabiliyeti — 16 Ekim 2026 yeniden kontrolü

Resmî kabiliyet kaydı: `docs/decisions/A6_EO_04_D_KLAVIYO_REPORTING_CAPABILITY_BASELINE.md`

- `2026-10-15` revision Campaign Message, `send_channel` ve isteğe bağlı Variation reporting boyutlarını GA olarak belgeler.
- 17 Ekim 2026 ürün sahibi düzeltmesi bağlayıcıdır: Campaign Message ve Flow Message AdsTable Channel'dır; `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Events attribution Campaign Message'ı fakat Campaign Variation'ı içermez. Message biliniyorsa Channel birebir kalır; çoklu veya çözülemeyen Variation yalnız Variation çözünürlüğünü etkiler ve `Unclassified Channel` üretmez.
- Flow attribution `Flow Message Variation` veya `Flow Message` ilişkisini açıkça döndürebilir; Variation ana paket Message'a çözülür ve Channel yine Flow Message kalır.
- Campaign için Values endpoint'i vardır fakat Series endpoint'i yoktur. Günlük grain tek-gün timeframe sorgularıyla korunur; ilk ilk yükleme yalnız dün ve bugündür. Saatlik refresh/uzlaştırma kota bütçesi EO-05'e aittir.
- Estimated Email Spend dağıtım ve Dataset mapping EO-05'e aittir.
- Bu kayıt tek başına API çağrısı, çalışma zamanı, Dataset, migration, secret, environment veya deployment değişiklik yetkisi vermez.

## EO-04-E ortak Channel ve ürün ekonomisi sözleşme kapısı — 16 Ekim 2026

Kabul edilmiş bağlayıcı özet: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`

CI kontrolü: `tests/eo-04e-three-provider-channel-product-economics.test.js`

- Meta Channel = Ad; Google Standard Shopping/Search Channel = Ad Group; Google PMax Retail Channel = Asset Group; Klaviyo Campaign Channel = Campaign Message; Klaviyo Flow Channel = Flow Message. Klaviyo `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Sales Role sözlüğü `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve yalnız gerçek ambiguity için `Unclassified` olarak kabul edilmiştir.
- `Zero Value` bir rol değil modifier'dır. `Unclassified Channel`, satış kanıtı bulunduğu halde birebir Channel çözülemediğini ifade eder.
- PMax geniş/örtüşen ürün ağacı üyeliği aşağıya paylaştırılmaz. Search sağlayıcı-atıflı ürün satışı bastırılmaz; `Assisted` olur.
- Meta Ad spend ürünlere dağıtılmaz. Google sağlayıcı ürün maliyeti gerçek/birleşik maliyet sayılmaz. Klaviyo Estimated Spend dağıtımı EO-05'e bırakılır.
- `Channel Ad Cost`, `Provider Product Ad Cost` ve EO-05'e ait `Allocated Ad Cost` ayrı kalır. Açık sıfır dışındaki eksik/destek durumları sıfır olmaz; ürün maliyeti satırları Channel toplamını yeniden üretmez.
- Birebir sağlayıcı ürün Ad Cost'u `Cross-sell`, `Assisted`, `Zero Value` veya `Unclassified Channel` nedeniyle silinmez ve ilgili ürün satırında korunur. Birebir product cost yoksa Channel toplamı ürünlere tahminî dağıtılmaz; Klaviyo `Triggered` dağıtım'ı EO-05'e aittir.
- Desteklenen ürün kimliği yolları resmî Shopify yönetimli Facebook & Instagram, Google & YouTube ve Klaviyo entegrasyonlarıdır. Meta ve Google product/variant adayları Shopify Admin API ile doğrulanmadan SKU, ürün adı veya varyant adı yayımlanmaz; elle/üçüncü taraf besleme/katalog bu sürümde kapsam dışıdır.
- Bu sözleşme kapısı ürün sahibi tarafından 16 Ekim 2026'da bütün olarak kabul edilmiştir. Kabul tek başına sağlayıcı reporting çalışma zamanı, canlı sağlayıcı çağrısı, Dataset V2, migration veya environment/deployment değişiklik başlatmaz; bunlar ayrı onay kapısındadır.

## EO-04-D Klaviyo raporlama çalışma zamanı temeli — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REPORTING_RUNTIME_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reporting-runtime-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-reporting-runtime-contract.test.js` and `tests/eo-04d-klaviyo-reporting-runtime.test.js`

- Campaign/Flow hiyerarşi örnekleri kabul edildikten sonra ürün sahibi yalnız repository çalışma zamanı temelini onayladı.
- Campaign/Flow Message Channel'dır; Message adı Channel adıdır. `send_channel` zorunlu Medium'dur; Variation Channel yerine geçmez.
- Kesin Message, çözülmeyen veya çoklu Variation varken kesin Channel kalır. `Unclassified Channel` yalnız eksik, çözülemeyen veya çelişkili Message kanıtındadır.
- Shopify `Placed Order` Reporting API dönüşüm metriği; `Ordered Product` ürün satış olayı kanıtıdır. Aynı satış iki kez sayılmaz.
- Ürün kimlikleri sağlayıcının doğal gözlemidir; Product ID standardizasyonu, saklama, zamanlayıcı, uzlaştırma ve tahmini harcama dağıtımı sonraki kapılardadır.
- Bu paket canlı Klaviyo, sağlayıcı değişikliği, DB/migration, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D Klaviyo raporlama otoritesi — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REPORTING_AUTHORITY_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reporting-authority-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-reporting-authority-contract.test.js` and `tests/eo-04d-klaviyo-reporting-authority.test.js`

- Ürün sahibi yalnız repository raporlama otoritesi/koordinatör uygulamasını onayladı.
- Raporlamadan önce aktif Shopify kurulumu, tam bir kanonik Klaviyo Connected Account, şifreli kimlik bilgisi otoritesi, gerekli okuma izinleri ve bağlı hesap saat dilimi zorunludur.
- Metrics, Campaign Values, Flow Values, Ordered Product Events sırasıyla çalışır. İlk sağlayıcı hatası kalan bütün aileleri durdurur; önceki başarılı satırlar kısmi çıktı olarak yayımlanamaz.
- Metrics/Events resmî `links.next` sayfalarını tamamlar. Values yalnız açık aynı-origin/aynı-endpoint devamını kabul eder; 2026-10-15 yanıt şemasının vermediği cursor uydurulmaz.
- Başarılı boş Campaign/Flow/Event sonucu `not_observed_in_this_execution` kalır; sayısal sıfır olmaz.
- Ordered Product standartlaştırması, profil istemeden sağlayıcı ürün alanları ve Campaign/Flow attribution ID'lerini korur. Product ID standardizasyonu ve Dataset V2 yayını sonraki kapılardadır.
- Bu paket canlı Klaviyo, sağlayıcı değişikliği, DB/migration/Dataset V2, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D geçici Klaviyo canlı kanıt tetikleyicisi — 18 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_LIVE_EVIDENCE_TRIGGER_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-live-evidence-trigger-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-live-evidence-trigger.test.js`

- Ürün sahibi geçici `Run Klaviyo evidence` taşımasını ve 18 Ekim 2026'da
  Production deploy adımını onayladı. Canlı sağlayıcı çağrısı ve Sample Data
  üretimi kapalıdır.
- Tarih merchant'tan alınmaz; bağlı Klaviyo hesabının timezone'una göre güncel
  iş tarihi server tarafında hesaplanır.
- Kalıcı reporting çalışma zamanı metrics, Campaign Values, Flow Values, Ordered
  Product Events ve resolution ailelerini tek denemede çalıştırır. İlk hata
  kalan aileleri durdurur; retry, fallback ve partial publication yoktur.
- UI ve safe log yalnız satır/durum/sınıflandırma sayılarını taşır. Raw satır,
  isim, ID, profil/PII, ticari değer, request ID, cursor/hash, token veya
  kimlik bilgisi taşımaz.
- Klaviyo custom ecommerce sample data, kanonik `integration.name = Shopify`
  metric kanıtı değildir ve Shopify-native ürün satışı kabulünün yerine geçmez.
- Birebir commit `b675885469effe9f3d9cb58135fa27d0219dcbb7`, Production
  deployment `dpl_FBfQ8t9mV4vw4PZkKmtgbjDbDqdy` olarak `READY` oldu ve gerçek
  Shopify Admin Settings görünümü ürün sahibi tarafından kabul edildi. Ayrı
  onaylı tek Klaviyo çağrısı ilk `metrics` ailesinde
  `KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID` ile retry yapmadan durdu;
  sonraki sorgu aileleri başlamadı ve hiçbir veritabanı/Dataset write oluşmadı.
  Ürün sahibinin Klaviyo Metrics incelemesinde Shopify integration bulunmadı;
  yalnız Klaviyo ve API integration adları görüldü. Sonuç kod/sağlayıcı hatası
  değil `environment_not_ready — shopify_integration_absent` olarak kaydedildi.
  Geçici buton gerçek Shopify entegrasyonu sonrası doğrulama için korunur; ek
  canlı çağrı kapalıdır. Kalıcı kanıt:
  `docs/evidence/EO_04D_KLAVIYO_ENVIRONMENT_NOT_READY_2026-10-18.json`.

## EO-04-D Klaviyo satış kaynağı çözümlemesi — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_ATTRIBUTION_RESOLUTION_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-attribution-resolution-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-attribution-resolution-contract.test.js`
and `tests/eo-04d-klaviyo-attribution-resolution.test.js`

- Ürün sahibi yalnız repository satış kaynağı çözümleme sözleşmesini kabul etti. Tek Ordered Product olayı tek satış gerçeğidir; Placed Order dönüşümü ikinci ürün satışı yaratmaz.
- Tek Channel otoritesi sağlayıcının Message attribution kanıtıdır. Message biliniyorsa katalog adı, Medium veya Variation çözülmese de kesin kalır.
- Campaign Message satışı, kesin içerik-ürün kanıtı Advertised/Cross-sell ispatlayana kadar Assisted olur. Flow Message satışı Triggered olur.
- Eksik/çelişkili Message kanıtı satışı bir kez Unclassified Channel altında, Sales Role Unclassified ile korur. Zaman yakınlığı veya rapor toplamı belirsizliği çözemez.
- Çözümleme tüm sağlayıcı ailelerinden sonra atomik çalışır. Bu paket canlı Klaviyo, DB/migration/Dataset V2, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D Klaviyo yeniden yetkilendirme durum doğruluğu — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REAUTHORIZATION_TRUTH_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reauthorization-truth-v1.json`

- Kanonik `reauthorization_required` Settings'te `Reauthorization required` görünür; `Not connected` gösterilemez.
- Settings incelemesi yereldir; kimlik bilgisi yenilemez, Klaviyo çağırmaz, başarısız isteği tekrarlamaz.
- Yalnız `connected` raporlama otoritesidir; tarihsel harcama dönemleri korunur.
- OAuth yeniden yetkilendirme önceki hesap/harcama geçmişini koruyarak güncel hesap doğrulamasını başlatabilir. Kurulum başarıyla tamamlanmadan raporlama açılmaz.
- EO-05 yetkisiz kalınan iş tarihi aralığını belirlemeli, sınırlı geçmiş tamamlama/uzlaştırma çalıştırmalı; eksik, kısmi, eski, kurtarılmış, geçici ve kesin durumları ayırmalıdır. Eksik tarih sessiz sıfır yapılamaz.
- Repository ve ayrı onaylı eklemeli canlı migration tamamlandı. Kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_LIVE_DATABASE_ACCEPTANCE_2026-10-17.json`;
  Security Advisor sıfır. Ayrı onaylı `9bc3108d366a58ce9ff92a293681245a0c380462`
  commit'i Production'a `dpl_8QgriVfjig4RjxC7hwpwtBJ77n8F` olarak dağıtıldı;
  Vercel `READY`, `embedded.adstable.app` hatasız eşlendi; ilgili error/fatal
  log gözlenmedi. Ürün sahibi gerçek masaüstü/mobil Settings'i kabul etti.
  Sağlayıcı çağrısı ve merge o aşamada ayrı kapıydı. Görsel kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_VISUAL_ACCEPTANCE_2026-10-17.json`.

## EO-04 Meta korunmuş canlı yanıt biçimi kanıtı — 16 Ekim 2026

- `8a7b0ca9645f46080f8fe0e69f18efe5e5638613` commit'inde güvenli canlı kanıt tamamlandı; çalışma zamanı hatası, tekrar, sonraki sağlayıcı başlangıcı veya DB yazması gözlenmedi.
- Tek Ad satırı yalnız sağlayıcıda varlığı kanıtlar; sayısal Dataset V2 yayını değildir. `impressions` ve `spend` doğrudan sağlayıcı kanıtıdır.
- `clicks`, `inline_link_clicks` ve dizi biçimli `outbound_clicks` ayrı Ad Click adaylarıdır. `landing_page_view` Session değildir. Purchase/checkout/add-to-cart kanıtlanmadı.
- Başarılı `product_id` isteği boş sayfa döndürdü. Kanonik durum `not_observed_in_this_execution`; boşluk ürün sıfırı veya genel desteklenmiyor kararı değildir.
- Kullanıcının Amazon hedef bağlamı sağlayıcı kanıtından ayrı kaydedildi. Sonraki ürün kapısı katalog bağlantılı Meta ürün reklamı ve ayrı yetki ister; aynı akışı tekrar etmek gerekmez.
- Temizlenmiş kalıcı kanıt: `docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.

## EO-04-B Meta App Role hazırlık kapısı — 17 Ekim 2026

- Bağlayıcı özet: `docs/EO_04B_META_APP_ROLE_READINESS_BRIEF.md`; sözleşme: `contracts/eo-04b-meta-app-role-readiness-v1.json`.
- Birinci aşama, hedef reklam hesabına ayrıca meşru erişimi olan davetli App Tester ile sınırlı gerçek hesap kabulüdür. `ads_read` genişlemez; herkese açık müşteri veya sonraki Business Verification/Advanced Access/App Review yerine geçmez.
- Sunucu Graph istekleri `appsecret_proof` gerektirir. Süresi dolan/reddedilen yetki, tekrar çağrı olmadan kanonik bağlantıyı `reauthorization_required` yapar.
- Gerçek hesap kabulü Ad/Channel ve `product_id` ailelerinin ikisinde de sınırlı opak sayfalamayı bitirmeden sonuç döndürmez. Cursor döngüsü, sayfa/satır sınırı ve ilk sağlayıcı hatasında güvenle durulur.
- Geçici Meta kanıt butonu Settings'ten kaldırıldı. Reporting Account ve Disconnect kalır; kimliği doğrulanmış görsel olmayan kabul yolu ayrı onaylı çağrı için korunur.
- Shopify taşıması, resmî Facebook & Instagram katalog eşitlemesi, ürün/varyant kimliği sürekliliği, App Tester/reklam hesabı yetkisi ve gerçekten yayımlanmış katalog reklamı tarihi o sağlayıcı günü için ön koşuldur. Yokluk sessiz boş/desteklenmiyor kanıtı sayılamaz.
- Ürün sahibi 17 Ekim'de masaüstü/mobil Settings kabulü için yalnız Preview dağıtımını onayladı. O kayıt Production, Meta rol/hesap, canlı çağrı, secret/ortam veya DB şema değişikliği yetkilendirmedi.

## EO-04-C Google raporlama çalışma zamanı başlangıç kapısı — 16 Ekim 2026

Kabul edilmiş bağlayıcı özet: `docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04c-google-reporting-runtime-v1.json`

CI kontrolü: `tests/eo-04c-google-reporting-runtime-contract.test.js`

- Standard Shopping ve Search Channel'ı Ad Group; Performance Max Retail Channel'ı Asset Group'tur.
- PMax satışı/Sales Role geniş listing tree'de korunur. Kesin Asset Group yalnız reklamı yapılan ürüne tam bir uygun ağaç eşleşirse çözülür.
- Tek uygun `All products` Asset Group kesindir. Birden çok örtüşen All products, kategori veya geniş ağaç `Unclassified Channel` bırakır; satış atılmaz/dağıtılmaz.
- Güncel ağaç tek başına eski satışı çözmez. Kesin tarihsel Channel, satışın tam iş günü boyunca geçerli sürümlü ağaç kanıtı ister. Gün içi değişiklik/eksik zaman kanıtında satış `Unclassified Channel` altında korunur.
- `cart_data_sales_view` reklamı yapılan/satılan ürün, adet, gelir ve lead/Cross-sell kanıtı; toplu `asset_group_product_group_view` kanıtından ayrıdır.
- Sağlayıcı Product Ad Cost reklamı yapılan üründe kalır; Cross-sell satılan ürüne taşınmaz. Dağıtım EO-05 işidir.
- Eksik Cart Data ayarı, başarılı boş yanıt, eksik alan, desteklenmeyen alan ve açık sayısal sıfır ayrıdır.
- Ürün sahibi 16 Ekim 2026'da özeti kabul edip sınırlı repository uygulamasını ayrıca onayladı. Dokuz salt okunur GAQL ailesi, ham sayfa/kanıt koruması, Sales Role ve zamansal güvenli PMax çözümleme sentetik testlerle kuruldu.
- Google test hesabı reklam yayımlamaz; gerekli performans/Cart Data satış gerçeklerini üretmediğinden gerçek raporlama kanıtı değildir. Repository test verisi yalnız AdsTable mantığını kanıtlar.
- Uygulama 16 Ekim'de `752cc1988323c238297d00516e7b7009432032c2` olarak kabul edilip birleştirildi.
- Aynı gün geçici canlı kanıt tetikleyicisinin sınırlı repository uygulaması ayrıca kabul edildi. Özet `docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md`, sözleşme `contracts/eo-04c-google-live-evidence-trigger-v1.json`.
- Tetikleyici hesap bağlamı, Cart Data satışları, ürün performansı, güncel PMax ağacı ve Asset Group performansını son 30 tamamlanmış hesap iş günü için sırayla çalıştırır. İlk hatada kalan aileler durur; tekrar veya alternatif yoktur.
- Birebir commit Production'a dağıtılıp 16 Ekim'de 1280 px masaüstü ve 320 px gerçek mobil Admin'de kabul edildi. Ayrı onaylı ilk çağrı tekrarsız durdu; gözlemlenebilirlik açığı bulundu: Arayüze yalnız `GOOGLE_LIVE_EVIDENCE_FAILED` ulaştı, sınırlı hata kanıtı loga ulaşmadı.
- Ürün sahibi dar düzeltmeyi onayladı: Yalnız güvenli aşama, sorgu ailesi, kaynak/sağlayıcı kodu, HTTP durumu ve yanıt gözlendi bilgisi loglanır. Ham mesaj, kimlik, istek ID, satır, token ve kimlik bilgisi yasaktır. İkinci çağrı/merge ayrı kapı kaldı.
- 16 Ekim'de sorgulardan önce istek kapsamlı tek token yenileme ayrıca onaylandı. `960ad41a7db9446e4be147f18d33d946c8324ae5`, `dpl_EsUUG8fEiQnPrxSWj7EBT8joPoTX` olarak dağıtıldı; ayrı onaylı tek koşu beş aileyi hatasız/tekrarsız tamamladı.
- `Europe/Istanbul` için 16 Eylül–15 Ekim aralığında Campaign, Cart Data, Shopping ürün, güncel PMax ağacı ve Asset Group satırı gözlenmedi. Bu sayısal sıfır, genel desteklenmiyor veya Dataset V2 otoritesi değildir. Kanıt: `docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.
- Bu koşu `campaign` kaynaklı birleşik hesap bağlamı kullandığından boş Campaign sonucu `customer.test_account` bilgisini de gizledi; hesap türü kanıtlanamadı. Yeni çağrıdan önce kimlik `FROM customer`, Campaign envanteri `FROM campaign` olarak ayrılmalıydı. İlk kanıt kendi başına düzeltme/yeni çağrı yetkisi vermedi.
- Dar düzeltme 16 Ekim'de ayrıca onaylandı. `1.1.0` önce `customer` üzerinden `account_identity`, sonra `campaign` üzerinden ayrı `campaign_context` çalıştırır; boş Campaign tür kanıtını gizleyemez. Bu uygulama onayı deployment veya ek canlı çağrı değildi.
- Production dağıtımı ayrıca onaylandı. `53730bee401c79600570f199bd9967cf2d560c8a`, `dpl_GFNme3aUQUJ25723fwU3e7HU235p` olarak `READY` oldu; `embedded.adstable.app` hatasız eşlendi, ilk error/fatal penceresi temizdi. Bu onay yeni Google isteği değildi.
- Ayrı onaylı takip isteği `customer.test_account=true` döndürdü. Google hata vermedi; `1.1.0` bu sınıfı iç `GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE` hatasına çevirip kalan ailelerden önce durdu.
- 16 Ekim erişim, OAuth kısıtlı izin doğrulaması ve demo politikaları yeniden kontrol edildi. Ürün sahibi review öncesi/sonrası tek çalışma zamanını kabul etti: Bağımsız kimlik korunur, `test_observed` kritik hata olmadan sınıflanır, sınırlı salt okunur aileler tamamlanır, yalnız güvenli sayılar gösterilir ve çıktı test demosu olarak etiketlenir. Gerçek performans kanıtı değildir. Review'a özel dal, sahte satır, Dataset yayını, dağıtım/yeni çağrı yetkisi verilmedi.
- `1.2.0` bu kararı uygular; 289/289 yerel test, tip kontrolü, Production derlemesi ve fark kontrolleri geçti.
- Ayrı onaylı `16a54df48e853c282d9c3481fb9e3b7c2b2ca16d`, `dpl_AQWkrVxdQvVzxPQkeNbhwXXwcXXQ` olarak dağıtıldı. `READY`, hatasız `embedded.adstable.app` ve temiz ilk error/fatal kontrolü doğrulandı. Ürün sahibi masaüstü/mobil Settings'i kabul etti. O anda yeni çağrı ve merge ayrı kapıydı.
- Açık merge onayıyla PR #85, 16 Ekim'de `54c427733cd51ba8600016941ce7afdd24ac2e64` olarak `main`e alındı. İkinci otomatik Production dağıtımı oluşmadı. Test demosu kabul/birleşmiş, canlı performans kanıtı Explorer-or-higher erişimi bekler; her yeni çağrı ayrı onay ister.
- Aynı gün tek test hesabı review-demo koşusu ayrıca onaylandı. Gerçek Admin sonucu `test_observed` doğruladı; altı salt okunur aile hatasız/tekrarsız tamamlandı. Campaign, Cart Data, Shopping performansı, güncel PMax ağacı ve Asset Group performansı sıfır satır döndürdü. Bunlar yalnız `not_observed_in_this_execution`; sayısal sıfır, genel desteklenmiyor, Product ID/Sales Role desteği veya Production performansı değildir. Kanıt: `docs/evidence/EO_04C_GOOGLE_TEST_ACCOUNT_REVIEW_EVIDENCE_2026-10-16.json`. Resmî erişim/test hesabı belgelerine göre Explorer-or-higher, test erişimini kaldırmadan canlı hesap erişimi ekler; ortak sorgu yapısı korunur. Canlı performans ve her yeni çağrı ayrı kapıda kalır.

## EO-04-C Google 2026 erişim/review düzeltmesi — 17 Ekim 2026

- Google'ın 9 Eylül 2026 geçiş dokümanı, erişim seviyesi sayfası, OAuth canlıya hazırlık kuralları, Ads API güvenlik gereksinimleri ve policy/demo süreci resmî kaynaklardan yeniden kontrol edildi. Bağlayıcı karar `docs/decisions/A6_EO_04_C_GOOGLE_2026_ACCESS_REVIEW_CORRECTIVE.md`; yürütülebilir sözleşme `contracts/eo-04c-google-2026-access-review-corrective-v1.json` içindedir.
- İlk gerçek-hesap geliştirme hedefi Explorer access'tir. Google Ads API access seviyesi OAuth istemcisinin bağlı olduğu Google Cloud Project'e aittir; OAuth public verification ayrı bir dış-kullanıcı kapısıdır.
- Google Ads API v25 için `GOOGLE_ADS_DEVELOPER_TOKEN` yalnız geçiş uyumluluğudur: varsa header gönderilir, yoksa çalışma zamanı fail etmez. Mevcut Production secret bu paketle değiştirilmez veya silinmez.
- HTTP 401, Cloud Project erişim eksikliği, 2-Step Verification eksikliği, diğer yetki/izin kapsamı 403'leri ve `AUTHORIZATION_ERROR` ayrı güvenli durma sınıflarıdır. Hiçbiri otomatik tekrar, proje değişimi veya alternatif kimlik doğrulama rotası başlatmaz.
- Tarihsel PMax doğruluğu korunur: bugünkü listing tree geçmiş satışı birebir çözemez. Tam iş günü kayıtlı görünüm yoksa satış ve Sales Role korunur, Channel `Unclassified Channel` kalır. Sürümlü kayıtların kalıcı saklanması A6-EO-05 sorumluluğudur.
- Ürün sahibi 17 Ekim 2026'da bu repository düzeltme paketini onaylamıştır. Onay Google başvurusu, canlı sağlayıcı çağrısı, Cloud Project/OAuth/secret/environment değişikliği, deployment, veritabanı, Dataset V2 veya UI değişiklik'ı yetkilendirmez.
- Ürün sahibi gerekli CI sonrasında merge'i açıkça onaylamıştır. PR #89, 17 Ekim 2026'da `main` üzerine `ff54d518b7c93ba576c9943a7c8d66a7ea511de6` olarak squash-merge edilmiştir. Explorer başvurusu, ilk Production çağrısı ve her sağlayıcı değişiklik'ı ayrı kapıda kalır.
