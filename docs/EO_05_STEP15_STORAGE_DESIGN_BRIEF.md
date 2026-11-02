## 2 Kasım — mevcut15: Klaviyo kaynak/kanıt bağlantısı

299 main’e alındı. Owner Klaviyo incelemesi sonrası mevcut okuyucuların güvenli
kayıt katmanına bağlanmasını; tutar/adet/büyük kimliklerin korunmasını; mağaza,
hesap, bağlantı ve iş kontrolleriyle migration/sözleşme/test/PR paketini onayladı.
Kayıt: contracts/a6-eo-implementation-master-v1.json#Step15_Klaviyo_source_capture_2026_11_02.

Mevcut native/message/candidate/interaction modları korunur. Açık sourceStorage
seçeneğinde kaynak Response’un sınırlı kopyasındaki seçilmiş sayılar Number’a
çevrilmeden özgün token metni ve türüyle saklanır. Örneğin12.5000 ile string
"12.5000" ayrı kalır; büyük sayısal kimlik yuvarlanmaz. Duplicate/prototype key,
bozuk UTF8 ve byte/row/depth sınırı accepted paketi durdurur. Mevcut okuyucunun
decoded çıktısı ve API sorguları değişmez. Native response projection / lossless
numeric token kaydı bütün HTTP gövdesi veya atılan alanın yokluğu kanıtı değildir.

Hesap önce/sonra, metric, Ordered Product olayları ve attributions, mevcut campaign/
flow raporları ile zaten okunan interaction detayları şifreli allowlist sayfalardır.
Profile/contact/token ve bilinmeyen property’ler yazılmaz. Müşteri bazlı disclosure/
redact ilişkilendirmesi canlı ön koşulu olarak açık kalır. Tutarlar kaynak olarak
korunur; rapor toplamı ürün satışına çevrilmez. Native olaylar unlinked claim içerik
sürümleridir; OrderId görülmesi Shopify Order/LineItem bağı oluşturmaz. Eşlemeler
unresolved/conflicting kalır; verified kural veya kabul edilmiş Product/Variant yoktur.
Gerçek hesap/metric/kaynak/mağaza/claim kanıtının eksikliği saklamayla kapanmaz.

Owner-only SQL; kurulum/privacy, credential/connection/tek hesap, gerçek iş/fence/gün,
billing, tam kota bağlamı ve okuma/izin süresini kayıt anında yeniden doğrular.
Claim içerik değişimi predecessor ile korunur; aynı içerik yeni sayfa kanıtlarıyla
yeniden kullanılabilir. Kayıp cevap otomatik tekrar veya job stop/finish değildir.
Kaynak makbuzu kapasiteyi/handoff’u veya Dataset/checkpoint’i tamamlamaz.
İzole SQL matrisi ayrı transaction ve gerçek Klaviyo admission kullanır.

OAuth/UI/scope/selector/config, spend ledger, worker grant/aktivasyon, canlı DB/key/
provider/deploy değişmez.15 açık;22 paused; genel Dataset/FX23 ve Overlap ertelemeleri
korunur. Merge ayrı açık onay ister. Resmî Klaviyo2026-10-15 Accounts/Events/detail/
Campaign/Flow ve Supabase changelog/functions belgeleri2 Kasım kontrol edildi;
exact adresler makine kaydındadır. Bu kontrol gerçek hesap veri kabulü değildir.

## 2 Kasım — mevcut15: Meta kaynak/kanıt bağlantısı

298 main’e alındı. Owner Meta incelemesinin ardından mevcut okuyucunun kaynak
sayfaları, reklam–katalog kanıtı, ürün raporu ve aday kontrollerinin güvenli kayıt
katmanına bağlanmasını; migration/sözleşme/test ve PR hazırlığını açıkça onayladı.
Kayıt: contracts/a6-eo-implementation-master-v1.json#Step15_Meta_source_capture_2026_11_02.

Katalog id, retailer_id ve rapor product_id ayrı anlamlarıyla korunur. Gerçek kaynak
biçimi ve rapor namespace kanıtı olmadan verified kural/eşleme veya rapor–ürün bağı
üretilmez. Ürün sayfaları, izin kontrolünün yalnız güvenli metadata’sı, önce/sonra
reklam–parent–creative–katalog kanıtları, mevcut raporun dört converted alanı ve aday
kontrolleri şifreli allowlist projection olarak saklanır; orijinal HTTP byte kanıtı
olduğu söylenmez. Eksik/null/boş alanlar ayrıdır; sayfalama tamamlığı kapsamın veya
katalog snapshot’ının atomik olduğu anlamına gelmez.

Owner-only SQL; kurulum/privacy, credential/connection/seçim, iş/fence/pencere,
billing, Meta kota bağlamı, okuma süresi ve izin son tarihini kayıt anında doğrular.
Eşlemeler unresolved/conflicting kalır; sürüm SQL’de belirlenir. Kayıp cevapta tek
yazım ve açık salt okunur makbuz kontrolü vardır; otomatik replay/stop/finish yoktur.
Runtime grant/aktivasyon, OAuth/UI/sorgu/scope/selector, canlı DB/key/config/provider
ve deploy değişmez. Kaynak makbuzu Dataset/checkpoint/handoff tamamlanması değildir.
15 açık;22 paused; genel Dataset/FX23, ek Shopify sorguları ve Overlap ertelemeleri
korunur. Merge ayrı açık onay ister.

Resmî kontrol2 Kasım2026: Meta Insights breakdowns sayfası browser’da429 verdi;
salt okunur doğrudan HTTPS200 yanıtındaki gömülü belge ve resmî SDK ProductItem/
AdsInsights şemaları okundu. Bunlar gerçek hesap namespace kanıtı değildir.
Supabase changelog ve RLS kontrol edildi. Kaynak adresleri makine kaydındadır.

## 2 Kasım — Google ürün kaynakları için ikinci okuyucu bağlantısı

Shopify bağlantısı297 ile main'dedir. Owner, Google mevcut okuyucusu ve ürün eşleme
kodunun incelemesini; ardından bağlantı/ürün sayfalarını, tam kaynak bağlamını,
bekleyen eşleşmeleri, güncel yetki kontrolünü ve hata testlerini içeren somut kod
paketini açıkça onayladı. Başlangıç main a025ae1736af95ce41f9eedaa000900904391349.

Google okuyucusuna açık sourceStorage seçeneği eklenir. Mevcut Ads–Merchant bağlantısı
önce/sonra, Merchant ürün sayfaları ve varsa Shopify aday kontrolleri allowlist
projection olarak şifrelenir. collector_projection/decoded_only işaretleri orijinal
HTTP baytı veya atılan alanın yokluğu iddiasını önler. Ürün tutar/başlık/kişisel ek
alanlar bu kimlik kaydına taşınmaz. Sayısal kimlikler kaynak string'i olarak kalır.

Ürün kimliği hesap+Merchant+feed+dil+dataSource+local bağlamıyla saklanır. Üretim kaynak
kuralı uydurulmaz. Bu paket reviewed kural veya verified eşleme yazamaz: aday kontrolü
başarılı olsa bile kalıcı eşleme unresolved; gerçek aday çatışması conflicting kalır.
Product/Variant GID ve verifiedAt kabul edilmiş eşleme alanlarında null'dır. Mevcut
generic NATIVE_RECEIPT_REQUIRED kapısı korunur. Adayın gözlenen kanıtı ayrıca saklanır.

Owner-only SQL fonksiyonu installation/connection/credential/Reporting Account epoch,
iş/fence/pencere, billing makbuzu ve tam Merchant kota bağlamını yeniden doğrular.
Aynı kimliğin aynı gözlemi yeniden kullanılır; değişen yetki veya durum için sürümü
veritabanı belirler, önceki sürüm supersedes ile korunur. Caller revision1 önceki
kaydı ezemez. Aynı işlem başka içerikle tekrarlanamaz. Yanıt kaybı otomatik replay,
finish/stop, checkpoint veya Dataset tamamlandı işareti üretmez; açık readback gerekir.

Kaynak paketi sınır aşarsa kırpılmaz. Boş ürün listesi gerçek sıfırdır; eksik/başarısız
native okuma tamamlanmış kaynak paketi yayımlamaz. Mapping ilişkileri ürün, bağlantı
ve aday kanıtlarının bağımlı saklama süresini korur. Genel structured retention ve
müşteri disclosure/redact işleri canlı ön koşulu olarak açık kalır.

Mevcut Google sorguları, token/OAuth akışı, scope, selector veya ürün UI değişmez.
Runtime/coordinator EXECUTE, canlı DB/key/config/deploy veya scheduler açılmaz.
15 açık;22 paused; Dataset/FX23. Merge ayrı açık onay ister. Resmî Google Ads v25
ProductLink, Merchant products/v1 list, Supabase changelog/functions ve PostgreSQL17
locking belgeleri2 Kasım2026 kontrol edildi; exact linkler makine sözleşmesindedir.

## 2 Kasım — ilk okuyucu bağlantısı: Shopify sipariş kaynakları

Tasarım295 ve temel296 main'e alındı. Owner, mevcut Shopify sipariş okuyucusunun
kaynak/kanıt katmanına bağlanacağı somut kod ve izole test kapsamını açıkça onayladı.
Bu teslim güncel main c7005ad7fc88d5998be1fe92336a09a040a88514 üzerindedir.

Okuyucuda açık sourceStorage seçilirse mevcut sipariş, ürün satırı ve ziyaret
sayfalarının parser allowlist çıktıları, tutarlılık tekrar okumalarıyla korunur.
Bu collector_projection / decoded_only kaydıdır; orijinal HTTP baytları, atılan
native alanın yokluğu veya ham sayısal token doğruluğu iddia edilmez. Tutar stringleri
ve kaynak timestamp metinleri korunur. Hassas ek alanlar ve hata gövdeleri alınmaz.

Tek kullanımlık gerçek collection nesnesi yazma hazırlığına girer; kopya JSON veya
istemcinin persistable/native flag'i yetki oluşturmaz. Sipariş ve satır verisi gerçek
sayfa referans hash'iyle eşleşir. Ziyaret özeti ve momentleri ile kontrol okumaları
da ilişkilidir. Paket byte/row sınırını aşarsa kırpılmaz, güvenli biçimde durur.
Boş tam aralık sıfırdır; hazır olmayan ziyaret kısmi kaynak kaydıdır.

Yeni owner-only SQL fonksiyonu mağaza/kurulum, silme durumu, okuma reservation/fence,
aralık, kuyruk/billing makbuzu, istatistik ve süreyi kilit altında kontrol eder.
Yazma atomiktir; yanıt kaybolduğunda ikinci write veya otomatik stop yapılmaz.
Yalnız açık salt okunur makbuz kontrolü yapılabilir. not_observed rollback kanıtı değildir.
Reservation, source handoff pending ve Dataset/checkpoint bu kayıtla tamamlanmaz.

Runtime/coordinator'a schema/EXECUTE izni, canlı anahtar/politika veya worker verilmez.
Mevcut sorgular/izinler değişmez. Ek ziyaret/iade alanları Overlap'ta; genel Dataset/FX
23'te kalır.15 tamamlanmadı. Müşteri bazlı gizlilik eşlemesi, structured retention ve
gerçek kapasite/canlı kabul hâlâ ön koşuldur. Merge ayrı açık onay ister.

Resmî kontrol2 Kasım2026: Shopify2026-10 Orders/Order/sayfalama, Supabase changelog ve
database functions, PostgreSQL17 locking. Exact kaynaklar makine sözleşmesindedir.

## 2 Kasım — kabul edilen yerleşimin ilk repository uygulaması

Ürün sahibi tasarımı okudu; bu yapının operasyonel raporlama DB'sine güvenli veri
sağlayan kaynak/kanıt katmanı olduğunu ve saklama süresinin veri sınıfı/bağımlılığa
göre değişmesini istedi. Teknik kararları devretti ve somut uygulamayı başlattı.
10 tablo yerleşimi kabul edildi. Bu kayıt önceki öneri/onay bekliyor alanlarını
kendi tarihleri için korur; güncel uygulama durumu makine sözleşmesindedir.

İlk hazırlık10 özel tablo, kapsamlı FK/RLS/indeksler, atomik owner-only yazma/makbuz,
şifreli sayfa tekrar okuma, aynı Order/LineItem sürümünün tekilleştirilmesi ve mevcut
silme worker'ına bağlantıdır. Native durum/tutarlar sınırlı native_data JSONB içinde
korunur; rapor fact veya muhasebe formülüne çevrilmez. Generic paket native kanıt
veya source-rule kabulü üretmez. Uygulama/coordinator rollerine schema/EXECUTE/DML
izni verilmez; hiçbir route/worker/provider adaptörü etkinleştirilmez.

Süre sonu adaylık koşuludur. Aktarım bekleyen veya eksik paket ile daha uzun yaşayan
ilişkili kural/eşleme/sipariş/iddia, kanıtı korur. Handoff consumed işaretçisi için
bu teslimde uygulama fonksiyonu yoktur; gelecekteki gerçek durable downstream makbuz
bağlantısı olmadan aktarım tamamlandı denmez. Metadata/structured geçmiş temizliğinin
nihai politikası ve native producer capture bağlantıları, canlı aktivasyon öncesi
Step15'in açık işleridir; yalnız ham ciphertext temizliği bu dilimde kontrollüdür.

Gizlilikte tüm-kurulum silmesi10 tabloyu mevcut manifestte sayar. Müşteri bazlı
request/redact geldiğinde source kayıtları varsa artık no_customer_data diye yanlış
makbuz üretilemez; SOURCE_CUSTOMER_PRIVACY_REVIEW_REQUIRED ile işlem açık kalır.
Müşteri ilişkilendirme/disclosure çözümü canlı ön koşuldur; ilgisiz müşterilerin
verisini keyfî toplu silme kararı alınmadı.

Tasarım PR295 henüz main'de değil; kod ayrı branch/PR ile ona bağlı incelenir. CI'ın
stacked PR'ı sınaması için yalnız bu tasarım branch'i ek base olarak tanımlandı;
OAuth guard hâlâ gerçek PR base SHA'sıyla çalışır, push main karşılaştırması korunur.
Merge, canlı DB, key/config/provider veya deploy yapılmadı. Supabase changelog HTTPS
okuması ve ilgili breaking-change belgeleri2 Kasım tamamlandı; önceki biçim hatası
tarihsel kayıttır. Native veri/kapasite/retention anahtar politikası kabulü değildir.

# 15. madde — veritabanının ilk temeli

Tarih: 2 Kasım 2026. Durum: ürün sahibine sunulan tablo ve ilişki önerisi.
Tablolar oluşturulmadı; SQL migration, writer veya canlı veri kaydı yapılmadı.
Makine karşılığı: `contracts/eo-05-step15-storage-design-v1.json`.

## Ne yapıyoruz?

Platformlardan okuduğumuz bilgileri işlem bitince kaybolmayacak şekilde saklayacak
temeli tasarlıyoruz. Bir kaydı tekrar bulabilmeli, nereden geldiğini gösterebilmeli
ve aynı veri tekrar geldiğinde ikinci satış üretmemeliyiz.

Örnek: Google ürün kimliği `G1`, doğrulanmış Shopify ürünü `P1` ile eşleşti.
Shopify siparişi `O1` içindeki `L1` satırı da `P1` ürününü içeriyor. Eşlemenin hangi
kurala ve hangi kaynak yanıtlarına dayandığını saklarız. Bu ilişki tek başına
Google'ın `O1` satışını kendisine yazdığının kanıtı değildir; okunabilen bir platform
iddiası varsa ayrıca saklanır. Kesin Overlap hesabı burada yapılmaz.

Mevcut kimlik, ilk hata, tekrar önleme, belirsiz sonuç, silme ve yeniden bağlantı
kararları kullanılır. Bu kurallar yeniden ürün kararına açılmaz.

## Kaç tablo öneriyoruz?

15 için **10 fiziksel tablo önerisi** var. `product_identity_mappings` önceki beş
mantıksal Dataset tablosundan biridir; ikinci bir eşleme tablosu değildir. Diğer
9 tablo kaynak, kanıt ve ilişki desteğidir. Önceki `pd_facts`,
`cpd_product_performance_facts`, `cpd_product_sales_facts`, `fx_rates` bu teslimde
kurulmaz; genel rapor/FX yazımı mevcut23'te kalır. Birlikte sayıldığında bu model
14 tablo öngörür; mevcut kurulum, hesap, kuyruk, kota, token ve silme tabloları bu
sayıya dahil değildir. Ek tablo sayısı açıkça incelemeye sunulur, onaylanmış sayılmaz.

| Tablo | Ne saklar? | Neye bağlanır? |
|---|---|---|
| `evidence.source_batches` | Hangi mağaza/hesap için hangi okumanın yapıldığı; tamlık ve kalıcı kayıt makbuzu | Mevcut kurulum/iş otoritesi |
| `evidence.source_pages` | İlgili sorgunun sınırlandırılmış ve arındırılmış şifreli kaynak yanıtı | Okuma paketi |
| `evidence.source_references` | Yanıtın içindeki hangi satırın/kaydın kanıt olduğu | Kaynak sayfası |
| `identity.source_rule_versions` | Kaynak ürün kimliğini yorumlayan doğrulanmış kural ve sürümü | Kabul edildiği paket ve kanıtları |
| `identity.product_identity_mappings` | Platform ürünü → Shopify ürünü/varyantı; doğrulanmış/çözülememiş/çelişkili durumu | Kural sürümü ve kanıtları |
| `source.shopify_order_versions` | Shopify siparişinin kaynak kimliği, sürümü ve gözlenen tutar/durumları | Okuma paketi ve kaynak kaydı |
| `source.shopify_line_versions` | Siparişin ürün satırı, adetleri, ürün/varyant kimliği ve kaynak tutarları | Tam olarak ilgili sipariş sürümü |
| `source.shopify_journey_versions` | Mevcut ilk/son ziyaret ve sayfalanmış kaynak gözlemleri; hazır/eksik durumu | Sipariş sürümü ve okuma paketi |
| `source.provider_claim_versions` | Gerçekte okunabilen platform satış/sipariş atıf iddiası | Kanıt; doğrulanırsa aynı Shopify siparişi |
| `evidence.source_reference_links` | Bir eşlemenin veya kaydın birden fazla kanıta dayanması | Somut kural/eşleme/sipariş/satır/ziyaret/iddia kayıtları |

Son bağlantı tablosu, serbest metinle “şu ID'ye bağlı” demez. Altı olası hedef
kolonundan yalnız biri dolar ve gerçek, mağaza kapsamlı foreign key ile korunur.
Kaynak sayfaları ileride rapor oluşturmak için bütün olarak taranıp çözülmez;
raporun ihtiyaç duyduğu doğrulanmış bilgiler kendi tablosundan okunur.

```mermaid
flowchart LR
  B[Okuma paketi ve makbuz] --> P[Şifreli kaynak sayfaları]
  P --> R[Kanıt kayıt adresleri]
  R --> L[Kanıt bağlantıları]
  L --> K[Kaynak kuralı sürümü]
  L --> M[Ürün eşlemesi]
  K --> M
  L --> O[Shopify sipariş sürümü]
  O --> I[Sipariş ürün satırları]
  O --> J[Shopify ziyaret gözlemleri]
  L --> C[Okunabilen platform iddiası]
  C -. yalnız doğrulanmış aynı sipariş .-> O
```

## Hangi ham bilgi nereye gidecek?

| Okunan bilgi | Kaynak/kanıt olarak | Kullanılabilir kayıt olarak |
|---|---|---|
| Google, Meta, Klaviyo performans/dönüşüm/ürün raporu | Sayfa, kayıt adresi, sorgu/sürüm ve tamlık bilgisi | Genel PD/CPD rapor yazımı23'te; bu aşamada rapor fact'i üretilmez |
| Merchant/feed/dil, katalog/retailer ve doğrulanmış Shopify ürün/varyant gözlemi | İlgili kaynak kayıtları | Kaynak kuralı ve eşleme; kanıt yoksa çözülememiş |
| Shopify sipariş başlığı | Siparişin alındığı kaynak kaydı | Sipariş sürümü; kaynak para birimleri ve tutarlar korunur |
| Shopify ürün satırı | Satırın kaynak kaydı | Sipariş sürümüne bağlı satır; Product ID satırın tekilleştirme anahtarı değildir |
| Mevcut Shopify ziyaret yanıtı | İlk/son ziyaret ve mevcut sayfalar | Ayrı ziyaret gözlemi; satış veya platform iddiası yerine geçmez |
| Gerçekte okunabilen Order/Message/atıf bağlantısı | İddianın özgün kaynak referansı | Ayrı platform iddiası; doğrulanmamış sipariş bağı boş ve durumu açık kalır |

Ham kanıt, bütün HTTP trafiğinin sınırsız kopyası değildir. İlgili sorgunun gerekli
kaynak alanları, iş anlamına çevrilmeden önce, sürümlü izinli-alan listesiyle alınır.
Token, cookie, yetki başlığı, gereksiz kişi/profil alanı, imzalı sayfalama URL'si ve
keyfî hata gövdesi saklanmaz. Arındırma sürümü ve kalan içeriğin özeti saklanır;
bu özetin atılmış özgün HTTP gövdesinin özeti olduğu iddia edilmez.

Kaydın doğrudan yanıt alanlarından mı, daha dar okuyucu çıktısından mı alındığı da
belirtilir. Okuyucunun taşımadığı bir alan native yanıtta yok sayılmaz. Native ondalık
metin korunur; JSON sayıları için exact kanıt gerekiyorsa kayıpsız token yakalama
gerekir. Önceden Number olarak çözülmüş değer özgün hassasiyetiyle yeniden
üretilmiş gibi gösterilmez. Bu ayrım uygulamanın kabul testinde kontrol edilir.

Shopify UTM/giriş sayfası/referrer/MarketingEvent ekleri ve iade satırı ayrıntıları
bu tasarımla istenmez. Ürün sahibinin 2 Kasım kararıyla bunların gerekliliği ve ek
ham veri olarak alınıp alınmayacağı, mevcut22 sonrası Overlap görüşmesindedir.
Plan kaydı PR294 ayrı ve henüz birleşmemiştir; bu branch güncel main'den açılmıştır.
Mevcut toplam iade alanı korunur; yeni iade özelliği veya hesaplama formülü kurulmaz.

## İlişki ve tekrar güvenliği

- Her kayıt workspace, gerçek kurulum PK'sı, kurulum nesli ve Shopify mağazasıyla
  bağlıdır. Reklam bağlantısı gereken yerde hesap, connection/version ve seçim
  sürümü ayrıca doğrulanır. Bağımsız Shopify siparişine sahte reklam hesabı eklenmez.
- İç PK `bigint identity`; uygulamaya kayıpsız ondalık metin olarak taşınır. Native
  kimlikler text kalır. Hesap adı, SKU, fiyat veya yakın tarih kimlik anahtarı değildir.
- Siparişin mantıksal kimliği mağaza + Order ID, satırınki buna ek LineItem ID'dir.
  Aynı native sürüm ve içerik yeniden gözlenirse aynı yapılandırılmış kayıt kullanılır;
  yeni okumanın kanıtı ayrıca bağlanır. Bu iki okuma iki satış sayılmaz.
- Aynı native sürümde farklı içerik gelirse üstüne yazmak yerine çelişki kaydedilir.
  Bir sonraki gerçek sürüm ayrı tutulur. Görülme zamanı, native geçerlilik başlangıcı
  gibi kullanılamaz; sistem geçmişteki bütün ara sürümleri gördüğünü iddia etmez.
- Eşleme anahtarı provider/hesap ve gerekli katalog/feed/dil/native bağlamını korur.
  Sürüm, canonical değer ve hash birlikte denetlenir; hash çakışması birleşme değil
  hata üretir. Yeni eşleme eski raporun kimliğini kendiliğinden değiştirmez.
- Birden fazla kanıt aynı kayda bağlanabilir. Farklı okumalardan kanıt kullanımı
  yalnız exact mağaza, bağlam, sürüm ve içerik doğrulamasıyla mümkündür. Yerel satır
  numarası kendi sayfa/paket/hash kapsamı dışında kalıcı kimlik değildir.
- İlişki kolonlarının indeksi, owner+native-key/sürüm indeksi ve süreli temizliğin
  indeksi tasarımda yer alır. Büyük JSON veya şifre çözülmüş bütün sayfaların taranması
  normal okuma yolu değildir. Boyut ve sorgu planları uygulamada ölçülür.

## Ham kanıtı nasıl koruyacağız?

İlk öneri, sınırlandırılmış kanıt sayfalarını PostgreSQL'de şifreli `bytea` olarak
saklamaktır. Bu, dosya deposu ile veritabanı arasında ikinci bir kayıt/silme
protokolü kurmayı önler. Gerçek boyut ölçümü bunu karşılamazsa ayrı nesne deposu
alternatifi yeniden değerlendirilir; bu tasarımla bucket oluşturulmaz.

AES-256-GCM zarfı; mağaza/kurulum/paket/sayfa/sürüm/içerik bağını doğrular. Token ve
session anahtarları kullanılmaz. Mevcut token şifreleyicisinin kabul etmediği yeni
amaç ona zorla eklenmez; ayrı amaç ve anahtar alanı gerekir. Bu teslim anahtar
üretmez veya env/config değiştirmez. Normal ekran/rapor cevabı ham gövde veya decrypt
yetkisi taşımaz. Mevcut owner/coordinator/runtime rol ayrımı korunur; public, anon,
authenticated ve service_role için yeni tablo erişimi önerilmez.

Tablolar özel schema'da, ENABLE/FORCE RLS ve kapsamlı iç SQL fonksiyonlarıyla
korunacaktır. İstemcinin workspace/rol bilgisi veya değiştirilebilir session ayarı
yetki sayılmaz. Tüm FK'lar owner kapsamını da doğrular; yalnız bigint eşitliği yetmez.

Her veri sınıfının politika sürümü ve son kullanma zamanı bulunur. “Sonsuza kadar”
varsayılanı yoktur. Sayısal süreler ve byte/satır bütçeleri bu tablo önerisiyle keyfî
seçilmez; mevcut ölçüm/kapasite ve saklama politikası kapısında canlı saklamadan önce
kesinleşir. Süresi dolan kanıt kullanılamıyor diye gösterilir; varmış gibi kabul
edilmez. Süresi dolan kanıta bağlı eşleme/kural yeni kullanımda taze doğrulama
olmadan geçerli kabul edilmez. Hâlâ gereken kanıtın silinmesi kontrollü politika kararı olmadan FK cascade
ile tetiklenmez. Gerçek silme talepleri bu korumadan üstündür.

## Yazma, tekrar okuma ve yarıda kalma

1. Mevcut doğrulanmış kaynak gözlemi ve güncel mağaza/hesap/iş yetkisi kontrol edilir.
2. Kaynak sayfaları sınırlandırılmış bir paket içinde hazırlanır. Hazırlanmış veya
   kalıcı saklanmış olması, kaynağın tam veya doğrulanmış olduğu anlamına gelmez.
3. Tek sınırlı transaction içinde güncel yetki yeniden denetlenir; sayfa/referans,
   kural/eşleme ve sipariş/atıf kayıtları ile bağlantıları yazılır veya aynı olduğu
   doğrulanır. Paket manifesti ve kayıt makbuzu aynı işlemde tamamlanır.
4. Tekrar okumada exact işlem kimliği, içerik özeti, mağaza ve kayıt sayıları
   karşılaştırılır. Aynı işlem/farklı içerik üzerine yazılamaz.
5. Cevap kaybolursa otomatik tekrar yazılmaz. Mevcut belirsiz-sonuç kuralıyla açık,
   salt okunur makbuz kontrolü yapılır. Makbuzun yokluğu rollback kanıtı değildir.
6. Kısmi okumanın eldeki kanıtı eksik durumuyla korunabilir; tamamlandı veya
   yayınlanabilir yapılmaz. Kapasite/fence kilitleri yalnız saklama makbuzu var diye
   bırakılmaz. Başarısız/belirsiz native çağrı otomatik tekrarlanmaz.

Bu paketin kaynak kayıt makbuzu ile23'teki genel Dataset checkpoint'i farklıdır.
Raporun kalıcı yazımı yapılmadan rapor işaretçisi ilerletilmez. Mevcut iş/kota
altyapısının kilit sırası ve release kuralları uygulamada korunacaktır.

## Silme ve yeniden bağlantı

Disconnect mevcut OAuth protokolüyle bağlantıyı keser; bu tasarım o protokolü
değiştirmez. İzin verilen tarihsel kayıtlar mevcut saklama politikasına göre kalır.
Yeni connection version veya kurulum nesli eski eşlemeyi otomatik etkinleştirmez.
Yeni kullanım taze doğrulama ister; geçmiş kayıtlar kendi kapsamıyla okunur.

Onaylanmış veri silme ve Shopify gizlilik akışında bu10 tablo, bağlantılar ve şifreli
içerik mevcut durable silme manifestine/worker'ına dahil edilir. Yeni silme motoru
kurulmaz. Silme isteği, append-only geçmiş kuralının önündedir. Yedekten dönüşte
mevcut silme defteri tekrar uygulanmadan hizmet açılmaz.

## Neyi sınayacağız?

Farklı mağaza/kurulum/nesil bağlantısı reddi; aynı işlemin tekrarı; aynı sürüm/farklı
içerik; değişmiş hesap/seçim yetkisi; transaction ortasında hata; kayıt cevabı kaybı;
kısmi okuma; eksik ürün/ziyaret; doğrulanmamış claim; şifre/hash/AAD bozulması;
Disconnect ve reconnect sonrası yetki; silme/yedekten dönüş; süre aşımı ve gerçek
boyut/sorgu planı. Bunlar yalnız belgeyi tekrar eden testler değil, sonraki SQL ve
writer uygulamasının davranış kabul koşullarıdır. Bu teslim test edilmiş bir DB
uygulaması veya gerçek provider veri kabulü değildir.

## Bu teslimin karar ve uygulama sınırı

Şimdi incelenecek somut sonuç:10 tabloluk yerleşim, alanlar ve ilişkiler. Makine
sözleşmesi her tablonun kolon, tekillik, FK ve indeks adaylarını içerir. Tablo
yerleşimi ürün sahibi tarafından kabul edilmeden SQL/migration/writer hazırlığına
geçilmez; bu kapı mevcut26-adımlı planın15. satırından gelir. Kabulden sonra repository
uygulaması ve izole testler hazırlanır. Merge, canlı DB apply, anahtar/config,
provider çağrısı ve yayın için mevcut ayrı açık onay kapıları devam eder.

15'in tamamı bitmedi; yalnız ilk tasarım önerisi hazırlandı.22 tarihsel PMax paused,
23 genel Dataset/FX yazımı, Overlap22 sonrasında kalır. Yeni sorgu veya OAuth adımı
eklenmez; Merchant/business/catalog seçimi geri getirilmez.

Resmî kontrol tarihi2 Kasım2026: [Supabase tablolar](https://supabase.com/docs/guides/database/tables),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgreSQL17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html),
[transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html),
[privileges](https://www.postgresql.org/docs/17/ddl-priv.html).
Supabase changelog.md araçta desteklenmeyen text/markdown biçimi nedeniyle okunamadı;
alternatif rota denenmedi. Tam changelog kontrolü uygulama öncesi açık kalır. Kaynaklar
mekanizmaları açıklar; bu AdsTable modelini veya canlı kapasiteyi onaylamaz.
