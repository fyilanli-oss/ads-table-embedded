# AdsTable mühendislik bütünlüğü ve review güvence kapıları

**Karar tarihi:** 18 Ekim 2026
**Durum:** Ürün sahibi tarafından kabul edilen bağlayıcı iş sırası

## Güncel durum — 19 Ekim 2026

TECH-01 kabul edilmiş referans sürümdür; F01–F09 ve güvenlik konusu kapalı,
F10 açık ertelemedir. DOCS-01'de 59 belge kabul edildi, son üç belgenin dil
düzenlemesi ve paket kapanışı ürün sahibi kabulünü bekler. EO-05–08 ve her paket
sonu fark denetimi, ardından A6-ASSURE-01 sırası değişmez. Bu kayıt yeni teknik
uygulama, canlı işlem, review başvurusu veya EO-05 başlangıç onayı değildir.

Aşağıdaki ilk bulgu sayıları, “başlamadı” ve ara teslim sayımları tarihsel
kayıttır; bugünkü durum yukarıdaki özettir. CI otomatik teslim kontrolü,
typecheck tip kontrolü, build derleme; diğer teknik kimlikler aynen korunur.

## 1. A6-TECH-01 — Uçtan uca proje bütünlüğü denetimi

Bu çalışma review hazırlığı değildir. EO-04 kapandıktan hemen sonra ve EO-05
başlamadan önce, EO-01–04 arasında oluşan bütün teknik yapının sağlamlığını
kanıtlar. Kapsamı:

- tüm uygulama/çalışma zamanı kodu, bağımlılık ve test mimarisi;
- Shopify gömülü yapı, oturum, kurulum, kimlik doğrulama ve UI anayasası;
- sağlayıcı adaptörü, attribution, Channel, Medium, Sales Role ve hata sınırları;
- Supabase migration/canlı şema uyumsuzluğu, RLS, yetkiler, fonksiyonlar, indeksler,
  Advisor, yedek/geri yükleme ve ortam izolasyonu;
- Vercel Production/Preview/Development ayrımı, ortam, dönüş,
  dağıtımın kaynak geçmişi, çalışma zamanı, log, geri alma ve uçtan uca akış;
- GitHub dalı, PR, CI, commit kaynak zinciri, yalnız yerelde kalan iş ve teslim bütünlüğü;
- yarım, kullanılmayan, çelişkili veya eski varsayım taşıyan kod;
- güvenlik, veri kaybı, güvenli tekrar, sayfalama ve ilk hata sonrası durma davranışı.

Denetim yalnız testlerin geçmesine bakmaz; yanlış davranışın yanlış testlerle
korunup korunmadığını da inceler. Bulgular P0–P3 olarak yazılır. P0/P1 ve veri
doğruluğu, güvenlik veya review sonucunu etkileyen P2 kapanmadan EO-05 başlamaz.

Çıktılar: denetim planı, kontrol matrisi, kanıt bağlantıları, bulgu kaydı,
düzeltme/yeniden test sonucu ve denetlenmiş referans commit.

18 Ekim 2026 ilk denetim sonucu
`docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md` ve
`contracts/a6-tech-01-engineering-integrity-audit-v1.json` içinde
kaydedilmiştir. P0 bulunmamış; üç P1 ve EO-05'i engelleyen beş P2 tespit
edilmiştir. Bu ilk kayıt PASS değildi; o andaki kapı kritik düzeltme/yeniden testti. Son kabul aşağıdadır.

## 2. Paket sonu delta bütünlük kapısı

18 Ekim 2026 genel kapanış kabulüyle A6-TECH-01 **PASS** oldu. İlk denetimin
yukarıdaki açık bulgu sayıları tarihseldir. Kabul edilmiş referans sürüm
`bd243fff7200ae6bdb3900ebb7417b3beba53010`; kapanış ve sınırlar
`docs/evidence/A6_TECH_01_CLOSURE_2026-10-18.json` içindedir.
O kapanışta sonraki kapı A6-DOCS-01'di; uygulaması 19 Ekim'de ayrıca onaylandı. Güncel durum belgenin başındadır. F10 açık
ertelemedir; EO-05–08 ve son güvence/review sırası değişmez.

EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 referans sürümüne karşı kısa fark
denetimi çalışır. Yeni paket önceki güvenlik, veri doğruluğu veya mimari
kararları bozmuşsa bir sonraki paket başlamaz.

## 3. A6-DOCS-01 — Türkçe dokümantasyon standardizasyonu

A6-TECH-01 bulguları kapandıktan sonra ve EO-05 başlamadan önce aktif insan
okuyucu `.md` belgeleri Türkçeleştirilir. API alanları, kod sembolleri,
sağlayıcı varlık adları, resmî hata kodları, JSON makine sözleşmeleri ve
değişmez kanıt içerikleri çevrilmez. Kabul edilmiş semantik değiştirilmez.

### A6-DOCS-01 çalışma standardı — 19 Ekim 2026

Ürün sahibi pakete başlanmasını onayladı. Çalışma sözleşmesi ve tam envanter:
`contracts/a6-docs-01-turkish-standardization-v1.json`.

**İş sonucu:** İnsan okuyucu, kabul edilmiş kararları alt paket geçmişini yeniden
kurmadan Türkçe anlayabilmeli. Bu paket yeni ürün kararı veya kod düzeltmesi değildir.

- README ile `docs` altındaki insan-okuyucu Markdown belgeleri kapsamda.
  `AGENTS.md` makine/ajan çalışma talimatıdır; bu dil geçişinde değiştirilmez.
- Önce iş sonucu, sonra normal akış, hata yolları, yetki/veri sınırı ve kabul
  anlatılır. Teknik terim ilk kullanımda Türkçe açıklanır; gereksiz İngilizce
  cümle ve başlık bırakılmaz.
- `Channel`, `Sales Role`, `Medium`, sağlayıcı varlık adları, API alanları,
  durum kodları, paket kimlikleri, komutlar ve dosya yolları teknik kimliktir.
  Anlamları açıklanır; kod içindeki karşılıkları yeniden adlandırılmaz.
- Kapanmış paketin kitap bölümü o paketin kabul edildiği tarihteki kapsamıdır.
  Tarihsel durum bugünkü proje durumu gibi sunulmaz; güncel sıra Execution Plan'dadır.
- JSON sözleşmeler, değişmez kabul kanıtları, migration'lar ve kod çevrilmez.
  Yalnız bu paketin çalışma durumu ve kapsam kaydı için gereken metadata eklenir.
- Dil düzenlemesinde tasarım çelişkisi görülürse kayda alınır; otomatik olarak
  iş kuralı değiştirilmez, yeni sağlayıcı davranışı veya izin varsayılmaz.
- İlk geçiş README ile EO-01/02/03 analiz kitaplarıdır. Diğer belgeler envanterde
  bekler; bu geçişin tamamlanması A6-DOCS-01'in tamamlandığı anlamına gelmez.
- Her teslimde dil ve teknik kimlik kontrolleri, mevcut repository testleri ve
  zorunlu GitHub CI geçer. Merge ayrı açık onay ister. EO-05 açılmaz.

### Dil geçişinin ilerleme kaydı — 19 Ekim 2026 tarihsel ara sayımları

İlk dört belge ürün sahibi tarafından okunabilir bulundu ve PR #120 kullanıcı
tarafından birleştirildi. Bu kabul yalnız o dört belgeye aittir; bütün paketin
kabulü değildir. İkinci teslim EO-01'in üç alt belgesi ile EO-02'nin veri temeli,
kurulum yetkisi ve kurulu mağaza düzeltmesinin üç belgesidir. Altı belge kabul,
diğer 52 belge dil incelemesi bekler.

Tarihsel ekran metinleri birebir teknik arayüz sözleşmesidir; İngilizce özgün
değerleri korunur, açıklama dili Türkçedir. Bu çalışma arayüz çevirisi yapmaz.
Supabase rehberi doğrultusunda nesne erişimi ile RLS'nin satır erişimi ayrımı
korundu; yeni veritabanı sorgusu, şema değişikliği veya canlı test yapılmadı.

Ürün sahibinin sonraki açık kabulüyle PR #121 de birleştirildi. Güncel dil envanteri
10 kabul edilmiş belgedir. EO-02'nin faturalandırma, oturum köprüsü, gizlilik,
kalıcı silme işçisi ve canlı kabul kılavuzunun 5 belgesi üçüncü teslimde kabul
bekler; diğer 47 belge dil incelemesi bekler. Önceki ara sayımlar tarihseldir.
Hazırlık durumları bugünkü açık işler gibi gösterilmez; nihai kabul kaydına yönlendirilir.
Supabase rehberi yalnız güvenlik terimlerinin anlamını korumak için kullanılmıştır;
canlı veritabanı veya sağlayıcı işlemi yapılmamıştır. Bu teslim paket kapanışı değildir.

Üçüncü teslim PR #122 ile açık ürün sahibi onayıyla birleştirildi. Güncel kabul
sayısı 15'tir. Dördüncü teslimdeki EO-03-A/B/C/D belgeleri okunabilirlik kabulü,
diğer 43 belge dil incelemesi bekler. Önceki sayımlar tarihseldir. OAuth işlemi
ile canlı yetkilendirme, hesap bağlantısı ile raporlama yetkisi ve Disconnect
ile gizlilik silmesi arasındaki ayrımlar korunur. Anahtar örneği yer tutucudur;
gerçek değer eklenmez. Bu teslim yeni sağlayıcı, veritabanı veya dağıtım işlemi
ve paket kapanışı yetkilendirmez.

PR #123 ürün sahibinin açık kabulüyle birleştirildi; kabul edilmiş belge sayısı
19 oldu. Beşinci teslimde ortak adaptör ve Meta'nın dört belgesi okunabilirlik
kabulü, diğer 39 belge dil incelemesi bekler. Eksik veri/sıfır ayrımı, tam sayfalama,
Meta Channel = Ad ve gerçek katalog yanıtı olmadan kesin ürün maliyeti
yayımlamama kuralları korunur. 13 Ekim'in eski 403 açıklaması, 18 Ekim'in mevcut
kabul edilmiş düzeltmesine yönlendirilir. Özgün buton metinleri ve teknik adlar
değişmez; bu çalışma yeni sağlayıcı davranışı veya canlı işlem üretmez.

PR #124 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
23'tür. Altıncı teslimde Google'ın dört belgesi okunabilirlik kabulü, diğer
35 belge dil incelemesi bekler. Satılan üründen Channel seçmeme, bugünkü ağacı
geçmişe uygulamama ve test hesabı boş yanıtını Production kanıtı saymama
kuralları korunur. Özgün ekran metinleri değişmez; 17 Ekim erişim/review bilgisi
tarihsel karar olarak kalır, yeni araştırma veya başvuru sayılmaz. EO-05 açılmaz.

PR #125 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
27'dir. Yedinci teslimde Klaviyo bağlantı/tahmini harcama, OAuth güçlendirme,
raporlama yetkisi ve satış kaynağı çözümlemesinin dört belgesi okunabilirlik
kabulü, diğer 31 belge dil incelemesi bekler. Önceki sayımlar tarihseldir.
Harcama defteri/ekran metinleri, ilk hata kapısı, tek satış sayımı ve
Message kimliği ile Medium/Variation ayrımı korunur. Supabase rehberi yalnız
güvenlik terimlerini korumak için kullanılır; yeni şema, sorgu veya canlı test
yapılmaz. Bu teslim kapanış veya EO-05 başlangıcı değildir.

PR #126 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
31'dir. Sekizinci teslimde Klaviyo raporlama çalışma zamanı, yeniden
yetkilendirme, geçici canlı kanıt ve kabiliyet kaydının dört belgesi okunabilirlik
kabulü, diğer 27 belge dil incelemesi bekler. Önceki sayımlar tarihseldir.
Audience'ın yalnız sağlayıcı gezinti katmanı olması, Message Channel kimliği,
örnek veri/Shopify verisi ayrımı ve ilk hatada durma sınırı korunur. Eski INFO
ve birleştirme-bekliyor kayıtları nihai kabule yönlendirilir. Yeniden bağlantı sonrası
eksik günleri tamamlama EO-05 açık işidir; yapılmış sayılmaz. Bu çalışma
arayüz, veritabanı veya sağlayıcı davranışı değiştirmez; paket kapanmaz.

PR #127 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
35'tir. Dokuzuncu teslimde EO-04 analiz kitabı, ortak Channel/ürün ekonomisi
ve geçici sağlayıcı canlı kabul kaydının üç belgesi okunabilirlik kabulü,
diğer 24 belge dil incelemesi bekler. Önceki sayımlar tarihseldir.
On sekiz senaryonun kimliği ve beklenen sonucu değişmez; alan adları Türkçedir.
Özgün teknik değerler, maliyet/Channel/Sales Role ayrımı ve gerçek veri
doğrulama sınırları korunur. Eski sayfalama, log, merge ve hazırlık durumları
nihai kabulle birlikte okunur. Bu teslim kod, canlı ortam veya EO-05 yetkisi değiştirmez.

PR #128 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
38'dir. Onuncu teslimde Google ve Meta tarihsel araştırma taslaklarının iki
belgesi okunabilirlik kabulü, diğer 22 belge dil incelemesi bekler.
Önceki sayımlar tarihseldir. Taslaklar bağlayıcı uygulama sözleşmesi değildir;
14 Ekim kaynak kontrolü ve 16 Ekim kayıt tarihi ayrı korunur. Google'ın eski
geniş-ağaç varsayımı kabul edilmiş tek uygun Asset Group/tam gün kanıtı kararına
yönlendirilir. Meta katalog izni genişletilmez ve ürün maliyeti doğrulanmış
gösterilmez. Bu teslim canlı çağrı, yeni karar veya EO-05 başlangıcı değildir.

PR #129 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
40'tır. On birinci teslimde F1/F2 ve F3 fizibilite kararlarının iki belgesi
okunabilirlik kabulü, diğer 20 belge dil incelemesi bekler. Önceki sayımlar
tarihseldir. Eski proje envanterleri ve ilk paket taslağı bugünkü iş sırası
gibi sunulmaz; bağlayıcı Execution Plan'a yönlendirilir. Uygulama kodunu aynen
taşıma sayısı sıfır, aday/kesin taşıma ayrımı ve silme yasağı korunur.
Supabase rehberi yalnız yetki terimlerini korumak için kullanılmıştır;
veritabanı sorgusu, kaynak oluşturma, sağlayıcı veya dağıtım işlemi yapılmaz.
Bu teslim paket kapanışı veya EO-05 başlangıcı değildir.

PR #130 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
42'dir. On ikinci teslim F4–F7'nin veri taşıma, ürün/rota, efor/risk ve GO
belgeleridir: 4 belge okunabilirlik kabulü, diğer 16 belge dil incelemesi bekler.
Önceki sayımlar tarihseldir. Birebir 10 satır taşıma kararı, kanonik Dataset
kopyalamama, üç yüzey/iki menü bağlantısı ve ayrı canlı işlem onayı korunur.
Tarihsel özet sayımı, rota/şema taslağı ve süre tahmini bugünkü yetki veya durum
gibi sunulmaz. Supabase rehberi yalnız terim kontrolüdür; yeni yedek, sorgu,
kaynak oluşturma, sürüm seçimi veya deploy işi açılmaz. Paket kapanmaz.

PR #131 açık ürün sahibi kabulüyle birleştirildi; kabul edilmiş belge sayısı
46, dil incelemesi bekleyen belge sayısı 16'dır. Ana tablo belgesinde bulunan
bozuk UTF-8 için ürün sahibi dar onarımı onayladı. Son sağlam GitHub kaynak
gövdesi geri getirildi; yalnız satır sonu boşlukları ve güncel yetki notu dışında
değiştirilmedi. Onarım özgün makine sözleşmelerini veya sonraki kabulleri geri
almaz; bozuk metinden yeni karar türetilmez. 62 insan-okuyucu Markdown dosyası
için UTF-8/bozuk karakter kontrolü eklenir. Bu teknik onarım çeviri kabulü
sayılmaz; 16 belge bekler. Onarımın CI ve ürün sahibi kabulü ayrı kapıdır.

PR #132 metin onarımı açık ürün sahibi kabulüyle birleştirildi. On üçüncü
teslim üç yüzeyli UI ürün tasarımı, Funnel grafik referansı ve demo/dışa aktarma/
dev store belgeleridir. 46 belge kabul edilmiş, 3 belge okunabilirlik kabulü,
13 belge dil incelemesi bekler; önceki sayımlar tarihseldir. Grafik referansı
uygulama kabulü sayılmaz; en alt kırılım/ürün/cross-sell kanıtı, tek veri
otoritesi, yalnız çizim düzleminde SVG/Canvas ve gerçek mobil kabulü korunur.
Demo kaynağı gerçek sağlayıcı davranışını kanıtlamaz; dışa aktarma ilk review
kapsamı dışındadır. Ana tablo onarımı ve UTF-8 koruması korunur. Bu teslim yeni
ürün kararı, UI/sentetik test verisi kodu, mağaza kurulumu veya canlı işlem yetkisi değildir.

PR #133 ürün/grafik/demo dil teslimi açık ürün sahibi kabulüyle birleştirildi.
On dördüncü teslim güvenlik/kapasite, secret envanteri/kurtarma, yerel temizlik
ve izole Shopify ön üretim planlarının dört belgesidir. 49 belge kabul edilmiş,
4 belge okunabilirlik kabulü, 9 belge dil incelemesi bekler; önceki sayımlar
tarihseldir. Kapasite/kurtarma hedefi tamamlanmış test değildir. Envanter
eşliği secret kurtarma kanıtı değildir. İlk hata sonrası durma ve ayrı işlem
onayları korunur; secret değeri, canlı ortam, yedekleme, temizlik ve kurulum
işlemi yoktur. Bu yalnız dil teslimidir; DOCS kapanışı veya EO-05 yetkisi vermez.

PR #134 güvenlik/kapasite/operasyon dil teslimi açık ürün sahibi kabulüyle
birleştirildi. On beşinci teslim TECH-01 denetimi ile F01-A/B/C belgeleridir.
53 belge kabul edilmiş, 4 belge okunabilirlik kabulü, 5 belge dil incelemesi
bekler; önceki sayımlar tarihseldir. İlk denetimin FAIL sonuçları ve başarısız
koşuları tarihsel kalır; kabul edilmiş genel PASS ve F01 kapanışı değiştirilmez.
Dar şema kurtarması tam yedek/PITR değildir; F10 açık borçtur. Yeni denetim,
veritabanı provası, yedek, canlı işlem veya EO-05 başlangıcı yoktur.

PR #135 TECH-01/F01 dil teslimi açık ürün sahibi kabulüyle birleştirildi.
On altıncı teslim Shopify UI anayasası ve görev şablonudur. 57 belge kabul
edilmiş, 2 belge okunabilirlik kabulü, 3 belge dil incelemesi bekler; önceki
sayımlar tarihseldir. Eski Settings kusuru tarihsel ayrılır; mevcut RC seçimi,
resmî bileşen zorunluluğu, gerçek mobil/masaüstü kabulü ve dar grafik sınırı
korunur. Teknik sözleşme, UI kodu, ana tablo onarım gövdesi ve canlı ortam
değişmez. Bu teslim yeni UI uygulaması, DOCS kapanışı veya EO-05 izni değildir.

PR #136 açık ürün sahibi onayıyla `ed47adf7bc19a9206b1baebda995838021ad3585`
commit'inde birleştirildi; test edilen ağaç korundu. Son dil teslimi Execution
Plan, ana paket tablosu ve kalite kapılarıdır. 59 belge kabul edilmiş, bu son
3 belge okunabilirlik ve paket kapanış kabulünü bekler; çevrilmemiş belge sıfırdır.
Önceki ara sayımlar tarihseldir. Ana tablonun onarılmış özgün gövdesi
`docs/evidence/A6_DOCS_01_MASTER_RESTORED_SOURCE_2026-10-19.txt` içinde önceki
hash'iyle korunur. Çeviri onarım kanıtını veya iş kararlarını değiştirmez.
Son kabul/merge, tüm repository kontrolleri ve uzak içerik doğrulaması kapanış
kapısıdır. EO-05, review, yedekleme veya canlı işlem otomatik başlamaz.

## 4. A6-ASSURE-01 — Pre-Review Assurance Programı (review öncesi güvence)

EO-08 sonrasında çalışır. İlk kez kod sağlamlığı arayan denetim değildir;
A6-TECH-01 ve paket sonu delta kapılarıyla denetlenmiş ürünün Shopify ve sağlayıcı
review başvurularına hazır olduğunu doğrular.

Kapılar: Shopify uyumu, kod kaynak zinciri, GitHub teslim durumu, Supabase,
Vercel, üç provider, veri bütünlüğü, analist/kullanıcı deneyimi ve güncel
tarayıcı→API→veri→yanıt akışı. Review sonucunu etkileyen açık P0/P1/P2 varken
PASS verilemez ve sessiz istisna üretilemez.

**Bağlayıcı sınır:** EO-04 kapanışı A6-ASSURE-01'in tamamlandığı anlamına gelmez.
EO-04 yalnız bu programa temiz ve denetlenebilir girdi sağlar. Hiçbir nihai
review başvurusu A6-ASSURE-01 PASS ve ürün sahibi GO kararı olmadan yapılamaz.

## 5. Bağlayıcı sıra

1. EO-04 kapanışı
2. A6-TECH-01 denetimi
3. Kritik bulguların düzeltme ve yeniden testi
4. A6-DOCS-01
5. EO-05–08 ve her paket sonunda delta bütünlük kapısı
6. A6-ASSURE-01
7. Ürün sahibi GO/NO-GO
8. Shopify/sağlayıcı review başvuruları
9. Shopify onayı ve gerçek mağaza pilotu
10. EO-09 otorite geçişi

Bu karar repository kodu dışında Supabase, Vercel, GitHub, Shopify veya sağlayıcı
değişikliği yetkilendirmez. Her dış sistem denetimi başlarken güncel resmî
dokümantasyon ve kesin erişim ayrı doğrulanır.
