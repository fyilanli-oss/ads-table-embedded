# 15. madde — Google'ın üç ham veri setini birlikte kaydetmek

4 Kasım 2026. Başlangıç main: `5f3232cf1dacb0ed9ae6aab2961de6bf50f405e5`.
Owner mevcut Google sorgularının üç veri seti olarak aynı kod çalışmasında mevcut
ham depoya bağlanmasını ve içerik doğrulamasını onayladı. Kod, hazırlanmış SQL,
izole test ve tek PR kapsamıdır. Canlı SQL/rol/ayar, provider çağrısı, yayın veya
merge yapılmaz. Önceki Merchant sorgusu yalnız ilişki gözlemidir; ürün sıfırı veya
bu kaydın canlı kabulü değildir. Yeni paket, depo, tablo, OAuth adımı veya ekran yok.

## Tek iş, üç ayrı zarf

| Veri seti | Sabit sorgular ve içerik |
|---|---|
| `account_performance` | Hesap kimliği, kampanya bağlamı; Shopping reklam grubu, Search reklamı, retail PMax asset grubu günlük performansı; bunların üç ayrı dönüşüm sorgusu ve kampanya dönüşüm eylemleri. Toplam 9 mevcut sorgu. |
| `product_performance` | Shopping/PMax ürün performansı; genel, Shopping, Search ve PMax ürün satışları; mevcut PMax listing ağacı ve ürün grubu toplamları. Toplam 8 mevcut sorgu. |
| `merchant_identity` | Mevcut Ads–Merchant ilişki sorgusu. Yalnız açık, güncel ve gerçekten bağlı hedef varsa Merchant ürün kimlik alanları; okuma sonrasında aynı ilişki tekrar doğrulanır. |

Native sorgular `buildGoogleReportingQueries` tarafından aynen üretilir. Çağıran
sorgu, aile, hesap veya URL veremez. Katalog bölümünün ürün kimlik alanları name,
offerId, feedLabel, contentLanguage, dataSource ve varsa legacyLocal'dır. Bunlar
tam katalog/fiyat/stok gövdesi olduğu iddiasıyla etiketlenmez.

Her veri setinin ayrı attempt/receipt/batch kaydı aynı operationId, iş/fence,
mağaza/kurulum nesli, Reporting Account, credential/sürüm ve gün penceresine bağlıdır.
Mevcut `evidence.source_batches`, `source_pages` ve `source_references` kullanılır.
Kaynak kuralı, doğrulanmış eşleme veya rapor fact'i yazılmaz.

## Sonuçların anlamı

- `stored`: ilgili setin bütün sorguları/sayfaları alınmış, şifreli kayıt ve açılmış
  içerik doğrulanmıştır. Gerçek boş yanıt ancak bu durumda 0/empty=true olabilir.
- `unavailable`: ilişki gözlemi vardır, katalog yoktur veya açık hedef/kota bağlamı
  eksiktir. Bu gözlemin zarfı partial olarak saklanır; ürün sayısı ve empty null'dır.
  Tek Merchant otomatik seçilmez. Geçmiş Ads ürün raporu bundan türetilmez veya atlanmaz.
- `failed`, `unconfirmed`, `not_attempted`: sırasıyla başarısız, sonucu belirsiz ve
  hiç başlanmamış bölümlerdir. Önceden doğrulanmış zarflar korunur. İlk provider,
  yetki, sayfalama veya kayıt hatasından sonra sonraki native istek yapılmaz.

Üç set de stored olmadan genel complete=true üretilemez. İlk iki set saklanmış ve
katalog unavailable ise HTTP207/partial döner; başarı veya ürün0 diye sunulmaz.
İş yalnız paused kapanır; saatlik refresh ve Dataset aktivasyonu yoktur.

## Kanıt ve bütünlük

Ads yanıtı sınırlı ve duplicate/prototype anahtarları reddeden JSON parser'ından
geçer. Sorgunun seçtiği alanlar alınır; native sayı token'ları jsonNumber metniyle
korunur. Özel müşteri/oturum alanları, header'lar, token'lar ve cursor değerleri
saklanmaz. Seçilmeyen alanın native yanıtta bulunmadığı iddia edilmez.
Sayfa schema/sanitizer sürümü, sorgusu, alan kapsamı, güvenli request ID ve sayfa
sırası korunur. Katman `native_response_projection`, sayısal doğruluk
`lossless_token` olarak açıkça belirtilir; özgün HTTP gövdesinin tam kopyası değildir.

Bilinen commit sonrasında exact receipt yeniden okunur. Sayfalar ayrı SQL okumasıyla
alınır; AAD/anahtar/sürüm/nonce/tag/hash, sıra ve sayı doğrulanır, içerik çözülerek
beklenen projeksiyonla karşılaştırılır. Eksik, fazladan, değiştirilmiş, expired veya
purged sayfa kabul edilmez. Belirsiz yazma yeniden denenmez veya otomatik okunmaz.

## Güvenli sunucu ve hazırlanmış veritabanı değişikliği

Mevcut `/internal/google/raw-capture`, Production/Bearer/exact-origin/operationId
kapısı ve mevcut env isimleri korunur. Eski plan değişmez; yeni yol explicit version2
planı ister. Hesap ve Merchant bağlamı ayrı alanlardır; merchant=null Ads'i engellemez.
Plan en çok15 dakika, okuyucu40–60s, toplam yanıt en çok1MiB/1000satır/80HTTP,
her sorgu1–10 sayfa; gerçek değerler sunucu planında açık verilir. Bu sınırlar saatlik
scheduler veya gerçek provider kota politikası kurulumu değildir. Her HTTP mevcut
iş/yetki/kota kontrollerinden geçer. Token gerektiğinde mevcut atomik mekanizmayla yenilenir.

`20261104110401_eo05_google_raw_datasets.sql` yalnız prepared/isolated-rollback
kaydıdır. Yeni özel commit RPC'si owner/iş/fence/gün/yetki/kota/deadline ve sabit
veri ailesini yeniden doğrular. `tools/sql/eo05-google-dataset-source-role-extension.sql`
ayrı hazırlanmış operasyon dosyasıdır: mevcut dar role yalnız bu RPC ve mevcut
sayfa okuma RPC'sinin EXECUTE iznini ekler. LOGIN/parola/tablo yetkisi değiştirmez.
Bu dosya veya migration uygulama başlangıcında/canlıda kendiliğinden çalışmaz.

Resmî kontrol 4 Kasım2026: [Google Ads sayfalama](https://developers.google.com/google-ads/api/docs/reporting/paging),
[Merchant ürün listesi](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list),
[ProductLink](https://developers.google.com/google-ads/api/fields/v25/product_link),
[PostgreSQL17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).
İzole SQL/HTTP testlerindeki native yanıtlar sentetiktir; gerçek kaynak kabulü değildir.

## 4 Kasım — canlı süre hatasının dar kod düzeltmesi

Owner, başarısız tek canlı okuma ardından süre yolunun düzeltilmesini ve süre aşımının
açık raporlanmasını onayladı. Başlangıç main `b97360d`; kod/test/tek PR kapsamı.
Yeni canlı istek, eski işin kilidini kaldırma, SQL/credential/config mutation,
merge veya yayın yetkisi yoktur. Bu bölüm yeni bir iş paketi değildir.

Canlı çağrı 12:28:54–12:30:08 UTC arasında HTTP409 döndü. Altı rapor çağrısının
kota kaydı settled, yedinci rezervasyon unsettled; depoda sıfır zarf var. Bu son
rezervasyon isteğin gönderildiğini veya Google yanıtı alındığını kanıtlamaz. İş
uncertain/request_outcome_unknown kilidinde bırakıldı. Zaman çizelgesi 60 saniyelik
okuma sınırına uyuyor; eski catch kesin nedeni capture_unconfirmed içine sakladığı
için geçmiş çağrının kesin hatası sonradan kanıtlanmış sayılmaz. Ayrıntılı canlı
kanıt PR324 gövdesindedir; bu hazırlık canlı kabulü başarılıya çevirmez.

Başarısız yayının Vercel deployment metadata'sında `regions:["iad1"]` vardır.
Yalnız `internal.google.raw-capture` route config'i `regions:["fra1"]` olur;
Transaction pooler ve veritabanı eu-central-1 konumundadır. Mevcut Vercel React
Router preset'i bu config'i ayrı server bundle'a taşır. Settings, callback,
Merchant keşfi ve diğer route'ların bölge ayarı değişmez. Bölge seçimi uzak SQL
gidiş dönüşlerini azaltmayı hedefler; yeni canlı ölçüm olmadan 60 saniyeye kesin
sığdığı iddia edilmez. Per-RPC rol/profil/transaction, güncel yetki/kota kontrolleri,
sorgu sırası, 60 saniyelik okuma/90 saniyelik iş/120 saniyelik route sınırı korunur.

Deadline hatası `read_deadline_exceeded`, üst işten iptal `read_aborted` olarak
özel HTTP409 cevabına taşınır. Null sayı/empty, tamamlanmayan set ve belirsiz yazma
anlamları korunur. İlk provider hata nedeni varsa bu neden önceliklidir. Otomatik
tekrar veya kilit açma yoktur. Installed preset testi bölgenin yalnız bu bundle'a
gittiğini; sanal zaman testi süre dolarken native HTTP sinyalinin iptal edildiğini,
sonraki setlere/yazmaya geçilmediğini ve tekrar run'ın reddedildiğini doğrular.
Ürün yüzeyi veya görünür UI değişmediği için yeni görsel kabul iddiası yoktur.

Resmî kontrol 4 Kasım 2026:
[Vercel region](https://vercel.com/docs/functions/configuring-functions/region),
[React Router preset](https://vercel.com/docs/frameworks/frontend/react-router),
[node-postgres queries](https://node-postgres.com/features/queries).
