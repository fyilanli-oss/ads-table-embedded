# A6 EO — Tek Hat Yürütme Kuralı ve Bütünleşik İş Paketleri Ana Tablosu

> **Kaynak ve çeviri — 19 Ekim 2026:** Onarılmış özgün gövde `docs/evidence/A6_DOCS_01_MASTER_RESTORED_SOURCE_2026-10-19.txt` içinde, önceki `3f767043b5a529fffb80859824316d197fec782fc31e6896202046810f4d89f9` SHA-256 değeriyle korunur. Sağlam kaynak `6e95ba9c7134d56e6cf11eba03be149c502e9672` commit'i, `e601d036afe990cfcd71242674d9c5fe390d2d06` blob'udur. `9b17ca992355d46fb05281430addf938c95f07d9` kaynağında başlayan bozuk içerik PR #75 ile `main`e taşınmıştı; tahminle yeniden kurulmadı. Bu belge sağlam kaydın Türkçe anlatımıdır; onarım kanıtını değiştirmez.
>
> **Güncel yetki:** Aşağıdaki durum tabloları, kaynakta “güncel aktif iş”, `Unknown Channel` ve kabul-bekliyor ifadeleri tarihsel kayıttır; bugünkü durum veya kural değildir. Güncel durum `docs/EXECUTION_PLAN.md`, bağlayıcı sözleşme `contracts/a6-eo-implementation-master-v1.json`, nihai senaryolar `docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. EO-01–04 ve A6-TECH-01 kabulleri korunur; aktif kapı A6-DOCS-01'dir, EO-05 başlamaz. Bu dil teslimi yeni kod veya canlı işlem yetkisi vermez.

**Tarih:** 4 Ekim 2026
**Durum:** EO ana yürütme başlangıç kaydı — tarihsel
**Otorite:** Execution Plan ve EO yürütülebilir sözleşmesi
**Amaç:** Dallanıp budaklanan paralel paket ağını engellemek ve bütün yeni uygulama işlerini tek EO hattında yürütmek.

## Analist sonucu

Bundan sonra AdsTable geliştirmesinde tek aktif ürün hattı **A6-EO** olacaktır.

E, R ve A6-RM paketleri yeniden çalıştırılacak paralel iş listesi değildir. Bunlar tarihsel karar, gereksinim, risk ve kanıt referans havuzudur. Yeni uygulama maddeleri eski paketlerin kopyası olarak değil, temiz gömülü ürünün kendi mimarisine ve müşteri yolculuğuna göre EO paketlerinde tanımlanır.

Bu ana tablo kabul edilmeden EO-01 kurulumuna başlanmaması ilk kuruluş kapısıydı; EO-01 sonradan kabul edilmiştir.

## Değiştirilemez yürütme kuralları

1. Aynı anda yalnız bir EO ana paketi `In progress` olabilir.
2. Ana paket sırası `EO-01 → EO-10`dur; sonraki paket öncekinin kabulü olmadan başlayamaz.
3. E, R veya A6-RM altında yeni uygulama paketi açılmaz.
4. Eski paketler yalnız ilgili EO satırının `references` alanında kullanılır.
5. Bir EO paketi eski bir yükümlülüğü ancak birebir kabul kanıtı ve açık kapanış kaydıyla kapatabilir; “kapsama aldık” Done değildir.
6. Production'ı korumak için zorunlu acil koruma gerekirse EO dışı geliştirme sayılmaz; ayrı, minimum, geri alınabilir ve açık insan kararıyla yapılır.
7. Ana paket altındaki sabit alt paket kimlikleri en fazla tek seviyedir: `EO-04-A`, `EO-04-B` gibi. Varsayılan olarak `EO-04-B-1-C` türü ikinci/üçüncü seviye paket açılmaz.
8. Alt paket içindeki teknik adımlar kontrol listesi/test olarak tutulur; yeni paket kodu verilmez.
9. Yeni bulgu önce mevcut aktif EO ana paket risk kaydına yazılır. Doğası başka ana pakete aitse o ana paketin `pending_findings` alanına aktarılır; yeni paralel harf dizisi açılmaz.
10. Her ana paket başlamadan önce analist özeti verilir: iş çıktısı, iş değeri, kapsam, kapsam dışı, bağımlılık, canlı etki, kabul ve geri alma.
11. Her ana paket bittiğinde dört sonuç birlikte yazılır:
    - üretilen gerçek çıktı;
    - geçen kabul/kanıt;
    - referans paketlerden kapanan/açık kalan yükümlülükler;
    - sıradaki tek ana paket.
12. Kod yazılması, PR merge'i veya deployment tek başına Done değildir.
13. Merge her zaman açık kullanıcı onayı ister.
14. Production, sağlayıcı, veri taşıma, otorite geçişi ve yıkıcı devreden çıkarma kendi birebir insan onay kapılarını korur.

## Durum sözlüğü

- **Ready:** Önceki paket ve teslim kuralları tamam; başlanabilir.
- **Not started:** Sırası gelmedi.
- **In progress:** Tek aktif ana paket.
- **Verification:** Uygulama hazır; kanıt/insan kabulü bekleniyor.
- **Done:** Sözleşme, CI, canlı/mağaza kanıtı ve gerekli insan kabulü tamam.
- **Blocked:** Belgelenmiş dış bağımlılık olmadan ilerlenemiyor.
- **Post-review:** Review tesliminden sonra yürütülür; erken başlatılmaz.

## Ana iş paketleri tablosu

| Ana paket | Doğal amacı | Faz | Başlangıç bağımlılığı | Sabit alt paket sayısı | Durum |
|---|---|---|---|---:|---|
| EO-01 | Temiz çalışma zamanı/repository/CI sınırı | Review için kritik | EO-F7 + bu ana tablo | 3 | Done |
| EO-02 | Çalışma alanı/kurulum/abonelik/gizlilik temeli | Review için kritik | EO-01 | 4 | In progress |
| EO-03 | OAuth/bağlantı/token otoritesi | Review için kritik | EO-02 | 4 | Not started |
| EO-04 | Üç sağlayıcı adaptörü | Review için kritik | EO-03 | 5 | Not started |
| EO-05 | Zamanlayıcı/Dataset/kesinleşme | Review için kritik | EO-04 | 5 | Not started |
| EO-06 | Formül/sorgu/BFF API | Review için kritik | EO-05 | 5 | Not started |
| EO-07 | Üç yüzeyli Shopify UI | Review için kritik | EO-06 | 6 | Not started |
| EO-08 | Taşıma/eşlik/kontrollü pilot/geri alma | Review için kritik | EO-07 | 4 | Not started |
| EO-09 | Geçiş/kararlılık/eski tüketici sıfır | Review sonrası/geçiş | EO-08 + ayrı geçiş GO | 3 | Not started |
| EO-10 | Arşiv/saklama/devreden çıkarma | Eski tüketici sıfırlandıktan sonra | EO-09 + yıkıcı işlem onayı | 4 | Not started |

Toplam: **10 ana paket, 43 sabit alt paket**. Bu sayı hedef plan başlangıcıdır; teknik kontrol listeleri paket sayısını artırmaz.

## EO-01 — Temiz çalışma zamanı kabuğu, CI ve bağımlılık sınırı

- **EO-01-A — Repository ve fiziksel sınır:** Ayrı ve boş temiz GitHub repository sınırı kurulacak; eski repository fork edilmeyecek veya topluca kopyalanmayacak.
- **EO-01-B — Resmî teknoloji yığını, paket tanımı ve CI:** Güncel resmî Shopify teknoloji yığını seçilecek, temiz bağımlılık tanımı kilitlenecek ve yasak import/yol/tablo/ortam CI kapıları kurulacak.
- **EO-01-C — Üç yollu, veri iddiası taşımayan Preview kabuğu:** Yeni Vercel Preview projesinde `/`, `/ad-analysis` ve `/settings` yol kabukları veri iddiası ve canlı ortam bağlantısı olmadan oluşturulacak.

Çıktı: temiz repository ve Preview kabuğu.
Referans: A6-RM-01, E3 mimari dersleri, Shopify gömülü arayüz anayasası.

## EO-02 — Çalışma alanı, kurulum, abonelik/deneme ve gizlilik temeli

- **EO-02-A — Özel şemalar, roller ve migration zinciri:** Yeni Standard Supabase projesinde özel şema, en az yetkili roller ve temiz migration zinciri kurulacak.
- **EO-02-B — Çalışma alanı, kurulum ve nesil otoritesi:** Shopify kurulum/oturum/ilk yükleme akışı çalışma alanı ve kurulum nesli otoritesine bağlanacak.
- **EO-02-C — On dört günlük deneme, abonelik ve kullanım hakkı:** On dört günlük deneme ve abonelik Shopify abonelik otoritesiyle, doğrulanmış kurulu Shopify mağazasına bire bir bağlı yönetilecek.
- **EO-02-D — Gizlilik, kaldırma, silme ve temiz yeniden kurulum:** Gizlilik uyum webhook'u, Delete my data, uygulama kaldırma ve yeni nesil temiz kurulum yaşam döngüsü kurulacak.

Çıktı: temiz veri temeli ve tam mağaza yaşam döngüsü.
Referans: A6-RM-03/04/05, E10-T4/T7, R2.

## EO-03 — Kanonik OAuth, bağlantı ve token kasası

- **EO-03-A — OAuth işlem sınırı:** OAuth state, PKCE, nonce, TTL, dönüş ve çalışma alanı bağları tek kullanımlık güvenli tek işlem sınırına alınacak.
- **EO-03-B — Şifreli token kaydı ve başlangıç koruması:** Sağlayıcı token'ları yalnız sunucuda şifreli, sürümlü ve eksik yapılandırmada güvenle duracak biçimde saklanacak.
- **EO-03-C — Bağlantı ve raporlama hesabı otoritesi:** Doğrulanmış sağlayıcı hesapları ve seçili Reporting Account, değiştirilemez kurulu Shopify mağazası otoritesinin altında kanonik olarak yönetilecek.
- **EO-03-D — Yeniden bağlanma, bağlantı kesme ve yenileme yaşam döngüsü:** Yeniden bağlanma, bağlantı kesme, token yenileme ve yeniden yetkilendirme veri veya yetki uydurmadan güvenle tekrarlanabilir çalışacak.

Çıktı: tek sağlayıcı otoritesi ve güvenli token yaşam döngüsü.
Referans: A6-RM-01, R0/R5/R6, E7.

## EO-04 — Meta, Google Ads ve Klaviyo adaptörleri

- **EO-04-A — Ortak adaptör sözleşmesi:** Üç sağlayıcı için ortak istek, ham kanıt, destek durumu, mağaza adayı keşfi/filtreleme, kota ve hata yanıtı sözleşmesi kurulacak.
- **EO-04-B — Meta adaptörü — OAuth kabulü / raporlama sözleşmesi incelemesi:** Meta OAuth, 1–3 gerçek reklamveren hesabı ve tek Reporting Account akışı kabul edildi. Tam Windows akışı ve iOS temiz-oturum OAuth başlangıcı PASS'tir; role sahip olmayan Windows hesabı Android ile aynı beklenen Meta review-öncesi kısıtını üretmiştir. Android tekrarı opsiyonel regresyon kontrolüdür. Channel = Ad ve ürün ekonomisi kuralları ortak EO-04-E analist özetinde ürün sahibi kabulünü bekler; raporlama çalışma zamanı başlamamıştır. PR #68 merge commit'i: `23911ffd565f385c02693ed7a1f3a07f017c30f5`.
- **EO-04-C — Google Ads adaptörü — OAuth kabulü / raporlama sözleşmesi incelemesi:** Çalışan Connect, hesap seçimi, tek Reporting Account, Resume setup ve önce yetki iptal eden Disconnect akışı kabul edilmiştir. Standard Shopping Channel = Ad Group, PMax Retail Channel = Asset Group ve Search Channel = Ad Group kararları ortak EO-04-E analist özetinde ürün sahibi kabulünü bekler; raporlama çalışma zamanı başlamamıştır. PR #67 merge commit'i: `a518be0`.
- **EO-04-D — Klaviyo adaptörü — OAuth/harcama kabulü / raporlama sözleşmesi incelemesi:** OAuth, tek Connected Account, ilk Estimated 30-Day Email Spend, aynı gün Update spend, Change value, yeniden bağlanma ve önce yetki iptal eden Disconnect ürün akışı kabul edilmiştir. `2026-10-15` Campaign Variation GA ve Event attribution sınırı 16 Ekim'de yeniden doğrulandı. Raporlama çalışma zamanı ve tahmini harcama dağıtımı başlamamıştır. PR #70 merge commit'i: `1ac9c8d`.
- **EO-04-E — Üç sağlayıcının birlikte kabulü — sözleşme incelemesi:** Meta, Google Ads ve Klaviyo ortak Channel, Sales Role, Zero Value, Unknown Channel, ürün kimliği ve sağlayıcı maliyeti sınırı `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md` ile ürün sahibi kabulüne hazırdır. Runtime ve canlı sağlayıcı kabulü başlamamıştır.

Çıktı: ham kanıt ve standartlaştırılmış, gerçeği koruyan sağlayıcı verileri.
Referans: R6/R7/R7-B5 ve en alt analiz seviyesi keşif girdileri.

## EO-05 — Zamanlayıcı, Dataset V2, kur dönüşümü, olgunluk ve uzlaştırma

- **EO-05-A — Saatlik zamanlayıcı, iş bölümü, süreli sahiplik ve ilerleme kaydı:** AdsTable yönetimli saatlik zamanlayıcı; belirlenimci iş bölümü, tek çalıştırma sahipliği, ilerleme kaydı ve kurulu mağaza kapsam uyumsuzluğu kontrolüyle kurulacak.
- **EO-05-B — Dataset V2, kur dönüşümü ve kaynak geçmişi:** Kanonik gerçekler, kurulu Shopify mağazası kapsamı, Klaviyo dağıtılmış harcaması, kaynak para birimi, kur dönüşümü ve kaynak geçmişi çalışma alanı sınırında saklanacak.
- **EO-05-C — Olgunluk, attribution süreleri ve kesinleşme:** Sağlayıcıların geçmiş günleri sonradan değiştirebildiği attribution pencereleri için kayan düzeltme ve doğru güncellik/kesinleşme kuralları kurulacak.
- **EO-05-D — İlk yükleme, güvenli tekrar yazma ve uzlaştırma:** Dün+bugün ilk yüklemesi, güvenli yeniden işleme, tekrarlanabilir ekle/güncelle ve sağlayıcı–Dataset uyuşmazlık uzlaştırması uygulanacak.
- **EO-05-E — Operasyonel gözlemlenebilirlik:** İş durumu, gecikme, hata ve alarm kanıtları secret veya PII sızdırmadan gözlemlenebilir olacak.

Çıktı: AdsTable yönetimli, saatlik ve düzeltilebilir kanonik veri katmanı.
Referans: A6-RM-06/07, E9-T8, R3/R4/R7.

## EO-06 — Formül, sorgu ve aynı-origin BFF/API

- **EO-06-A — Formül motoru:** Önce toplulaştırılan KPI, Klaviyo maliyet dağıtımı, CPC/ROAS/CPS/revenue/revenue margin ve para birimi güvenli hesaplamalar uygulanacak.
- **EO-06-B — Sorgu, filtre ve karşılaştırma anlamları:** Tarih, varlık, veri seviyesi, filtre ve dönem karşılaştırma kuralları tek sorgu sözleşmesinde kurulacak.
- **EO-06-C — BFF yolları ve DTO yanıt yapısı:** Çalışma alanını oturumdan türeten aynı-origin BFF yolları ve üç yüzey için kararlı DTO yanıt yapıları hazırlanacak.
- **EO-06-D — Destek, null ve güncellik anlamları:** Unknown, unsupported, stale, partial ve gerçek zero durumları API boyunca birbirinden ayrı tutulacak.
- **EO-06-E — Sözleşme ve güvenlik kabulü:** Müşteri kapsamı bozma, formül, sorgu ve API sözleşme/güvenlik testleriyle bu katmanın kabulü kanıtlanacak.

Çıktı: eksik/bilinmeyeni sıfır yapmayan API.
Referans: A6-RM-08/09, E11 ve Dataset V2 sözleşmeleri.

## EO-07 — Shopify'a özgü üç yüzeyli arayüz

- **EO-07-A — Settings yüzeyi:** Eski çalışan Settings kullanıcı akışı referans alınarak Reporting Currency, sağlayıcı bağlantıları/hesap seçimleri, salt okunur kurulu Shopify mağazası bağlamı, Klaviyo Email Monthly Plan Cost, Shopify aboneliği ve iki aşamalı Delete my data Shopify'a özgü Settings içinde kurulacak; mağaza seçicisi ve grafik olmayacak, eski UI kodu aynen taşınmayacak.
- **EO-07-B — Funnel App Home:** Bağımsız Funnel/Table ve Summary/Daily boyutları, sağlayıcıya özgü hiyerarşi ve kontrollü karşılaştırma uygulanacak; bağlamsal dashboard yalnız ürün sahibinin beklenen ilişkilendirilmiş grafik paketi kabul edildikten sonra tasarlanacak.
- **EO-07-C — Sağlayıcılar arasında en alt analiz seviyesi keşfi:** Meta, Google Ads ve Klaviyo için gerçek en alt analiz seviyeleri ile tıklanan ürünün satın alınmadığı/alındığı iki birebir küpe/Cross-sell test verisi sonucu Ad Analysis tasarlanmadan önce dondurulacak.
- **EO-07-D — Ad Analysis yüzeyi:** Ad Analysis sıralama tablosu, tek ayrıntı modalı ve kanıtlı ürün görünümü yalnız EO-07-C keşif sonucu üzerinde uygulanacak; grafik katmanı EO-07-C kapanana kadar blokludur ve bütün sağlayıcının en alt varlıkları yapay olarak Ad diye etiketlenemez.
- **EO-07-E — Ad Analysis içindeki Attribution Differences görünümü:** Attribution Differences, keşif ve Ad Analysis kabulünden sonra ayrı yüzey açmadan Ad Analysis içine yerleştirilecek.
- **EO-07-F — Masaüstü, gerçek mobil ve erişilebilirlik kabulü:** Üç yüzey resmî bileşen eşlemesi, gerçek masaüstü/mobil Shopify Admin ve erişilebilirlik kabulünden geçirilecek.

Çıktı: Funnel, Ad Analysis ve Settings. Funnel grafikleri ilişkilendirilmiş grafik girdisini bekler; Ad Analysis grafikleri EO-07-C kanıtını bekler; Settings'te grafik yoktur. Platforms Settings içinde.
Referans: A6-RM-09, E10-T5, E12 ve UI anayasası.

Bağlayıcı ürün davranışı ve bekleme kapıları `docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md` ile `contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json` içinde dondurulmuştur. Bu ön tasarım dondurması EO-07 uygulamasını veya kabulünü erkene çekmez.

## EO-08 — Taşıma provası, eşlik, kontrollü pilot ve geri alma

- **EO-08-A — Sınırlı veri ve kapalı token taşıma provası:** Yalnız izin listesindeki veri ve kapalı token'lar geçici/Preview sınırında gerçek Production'a dokunmadan taşıma provasından geçirilecek.
- **EO-08-B — Sağlayıcı, Dataset, API ve arayüz eşliği:** Sağlayıcı ham gerçeği, Dataset V2, API ve UI sonuçları sahte sıfır üretmeden uçtan uca karşılaştırılacak.
- **EO-08-C — Kasıtlı hata ve geri alma provası:** Kimlik doğrulama, sağlayıcı, veritabanı, iş ve UI arızalarında güvenli durma ve geri alma davranışı kanıtlanacak.
- **EO-08-D — Review kanıtı ve hazır olma kararı:** Shopify yaşam döngüsü ve ürün kanıtları toplanacak; review'a hazır olma kararı ayrıca açık insan onayıyla verilecek.

Çıktı: Shopify review'a sunulabilir olduğumuzu kanıtlayan paket.
Referans: A6-RM-10, R8/R9, E13.

## EO-09 — Otorite geçişi, kararlılık ve eski tüketici kalmadığının kanıtı

- **EO-09-A — Canlı otorite geçiş planı ve sabitleme:** Alan adı, Shopify uygulama yapılandırması, veri ilerleme sınırı, sabitleme ve geri alma penceresi birebir otorite geçişi planında dondurulacak.
- **EO-09-B — Kontrollü pilot otorite geçişi:** Production otoritesi ayrı GO sonrasında küçük ve kontrollü pilot geçişle yeni yapıya alınacak.
- **EO-09-C — Kararlılık ve eski tüketici kalmadığı gözlemi:** Yeni otoritenin stabil olduğu ve eski çalışma zamanını kullanan hiçbir tüketici kalmadığı gözlemle kanıtlanacak.

Çıktı: ayrı GO ile kontrollü canlı otorite geçişi.
Referans: A6-RM-10/11, R9, E13.

## EO-10 — Eski yapının arşivi, saklama süresi ve kontrollü devreden çıkarma

- **EO-10-A — Arşiv ve saklama envanteri:** Kod, veri ve kanıtlar için geri alınabilir arşiv ile hukuki/gizlilik saklama envanteri hazırlanacak.
- **EO-10-B — Eski yol, deployment ve ortamın devreden çıkarılması:** Yalnız eski tüketici kalmadığına ilişkin kanıt bulunan eski yollar, dağıtımlar ve ortamlar kontrollü biçimde devreden çıkarılacak.
- **EO-10-C — Eski veritabanının devreden çıkarılması:** Eski tablo, fonksiyon ve kimlik bilgileri geri yükleme noktası ve birebir envanter sonrasında ayrı yıkıcı işlem onayıyla emekli edilecek.
- **EO-10-D — Nihai geri yükleme ve kapanış kanıtı:** Geri yükleme sınırı kanıtlanacak ve bütün taşınmış yükümlülükler açık kapanış kanıtı ile nihai olarak kapatılacak.

Çıktı: geri alınabilir arşiv ve kanıtlı eski yapı devreden çıkarması.
Referans: A6-RM-11, E14, R10.

## Referans yükümlülüklerinin kullanımı

Eski paketler için üç durum vardır:

- **Referans alındı (Referenced):** EO tasarımının girdisidir; henüz kapanmamıştır.
- **EO kanıtıyla karşılandı (Satisfied by EO evidence):** Birebir EO kabulü eski yükümlülüğü karşılamıştır.
- **Uygulama yolu değişti, geçmişi korundu (Superseded for implementation, retained historically):** Eski uygulama yolu kullanılmaz; karar/kanıt geçmişi korunur.

“EO başladı, eski paketler otomatik kapandı” ifadesi yasaktır.

## Yeni bulgu yönlendirme kuralı

| Yeni bulgu doğası | Gideceği EO ana paket |
|---|---|
| Repository, bağımlılık, derleme, Shopify teknoloji yığını | EO-01 |
| Çalışma alanı, kurulum, abonelik, gizlilik, silme | EO-02 |
| OAuth, token, hesap sahipliği | EO-03 |
| Sağlayıcı isteği/standartlaştırma/hiyerarşi | EO-04 |
| Zamanlayıcı, Dataset, kur dönüşümü, kesinleşme | EO-05 |
| Formül, sorgu, API anlamları | EO-06 |
| Kullanıcı deneyimi, bileşen, mobil, üç yüzey davranışı | EO-07 |
| Migration, eşlik, kontrollü pilot, geri alma | EO-08 |
| Otorite geçişi ve eski tüketici kalmadığının kanıtı | EO-09 |
| Arşiv/devreden çıkarma | EO-10 |

Bulgu ilgili ana paketin sırası gelene kadar bekleyen iş satırı olarak kalır; yeni paralel paket ailesi oluşturmaz.

## Review sınırı

EO-01–EO-08 review için kritik hattır. EO-08-D sonunda ayrıca açık insan review'a hazır olma kararı gerekir.

EO-09 ve EO-10 review sonrasında yürütülür. Bununla birlikte review sonrasında yapılmaları, erken eski yapı silme yetkisi vermez; eski tüketici kalmadığının kanıtı ve yıkıcı işlem onayı korunur.

## Kaynak kaydındaki aktif iş — tarihsel

Tek aktif ana paket **EO-03**'tür.

- **EO-03-A — Accepted:** OAuth işlem sınırı repository ve canlı veritabanı kanıtlarıyla kabul edildi.
- **EO-03-B — Accepted:** Yalnız şifreli token kasası, Production Sensitive anahtar halkası, canlı Supabase fonksiyon sınırı, Production başlangıç koruması ve sentetik saklama/okuma/silme kabulü PASS; gerçek sağlayıcı tokenı veya OAuth kullanılmadı.
- **EO-03-C — Accepted:** Sağlayıcı doğrulamalı bağlı hesaplar ve tek Meta/Google Reporting Account, değiştirilemez kurulu Shopify mağazası altında kanonik ve yalnız fonksiyon çalıştırma otoritesi olarak kuruldu. İki canlı migration, geri alınan sentetik çalışma zamanı kabulü, sıfır kalıcı sentetik satır, sıfır Security Advisor bulgusu ve sıfır EO-03-C kaynaklı eksik-FK-index bulgusu PASS oldu. Sağlayıcı OAuth/API çağrısı yapılmadı. Teknik kanıt `docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json` içindedir; ürün sahibi 9 Ekim 2026'da açık kapanış kabulünü verdi.
- **EO-03-D — Ready:** EO-03-C kabul edildi; yeniden bağlanma, bağlantı kesme ve yenileme yaşam döngüsü uygulama ve kabul kapısına sıradaki tek aktif alt paket olarak hazırdır.
- EO-04 ve sonraki ana paketler paralel başlatılmaz.

## 9 Ekim 2026 — Kurulu Shopify mağazası otoritesi

EO-02-B/EO-02-C düzeltmesiyle çalışma alanı, abonelik, organik ticaret verisi ve Dataset V2 kapsamı uygulamanın kurulu olduğu doğrulanmış Shopify mağazasına kilitlendi. Reporting Account seçimi buna tabidir; kurulu mağazayı değiştiremez. Belirsiz veya başka mağazaya ait sağlayıcı varlıkları Dataset V2 yazamaz ve SnapshotJob alamaz. İkinci Shopify mağazası ayrı kurulum, çalışma alanı ve abonelik gerektirir. Bağlayıcı sözleşme: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.
