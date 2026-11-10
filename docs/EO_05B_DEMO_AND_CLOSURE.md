# EO-05-B — sürümlü demo ve kapanış kontrolü

10 Kasım 2026. Bu, daha önce belirlenen dördüncü ve son işin kod/test/PR
kapsamıdır; yeni paket değildir. Ürün sahibi “Onaylıyorum Codex devam edelim”
diyerek bu somut işi onayladı. Merge ayrıca onaylanır.

## Demo dosyasında ne var?

Önceden dondurulan eski örneğin yalnız `SOURCE_ROWS` JSON verisi çıkarıldı.
HTML veya JavaScript çalıştırılmadı, yeni uygulamaya taşınmadı. Kaynak dosyanın
Git blob, SHA-256 ve byte uzunluğu; çıkarılan JSON'un da SHA-256 ve uzunluğu
doğrulandı. [Dondurulmuş karar](../contracts/a6-eo-demo-fixture-export-reference-v1.json)
tarihsel kayıt olarak değişmeden kalır; bu uygulamanın güncel kaydı
[sözleşmededir](../contracts/eo-05b-demo-closure-v1.json).

`contracts/demo/eo05b-v1/source-rows.json` içindeki 1.000 satır ve eski hesaplama
beklentileri özgün byte dizisiyle korunur. 1 Haziran–20 Temmuz 2026 arasındaki
50 gün vardır. Yeni `golden.json` yalnız Google'ın 200, Meta'nın 200, Klaviyo'nun
100 ücretli trafik satırını içerir. TikTok, Direct, Others ve organik trafik
bu aktif projeksiyona girmez; arşivde kalır.

Her normalize satır sentetik demo etiketi ve `provider_truth: false` taşır.
Mağaza/hesap/hiyerarşi kimlikleri demo sürümü, çalışma alanı ve sağlayıcı ile
adlandırılır; gerçek sahiplik kaydı yerine kullanılamaz. Bunlar doğrudan SQL'e
yazılacak yetkili Dataset DTO'ları değildir. Runtime seed, bağlantı durumu,
token, özel sunucu çağrısı veya canlı veritabanı bağlantısı eklenmez.

Hiyerarşi açık bir **sentetik eşleme kararıdır**: Google örneği campaign →
ad_group → ad; Meta campaign → ad_set → ad; Klaviyo flow → flow_message.
Eski genel `adgroup` alanı tüm platformlara aynı anlamla taşınmaz. Kaynakta
PMax veya Klaviyo Campaign türünü kanıtlayan veri yoktur; bunlar uydurulmaz.
Ürün gibi görünen reklam adları ürün kimliği veya Cross Sell kanıtı değildir.
Bu sınır EO-07-C'de kalır.

Dokuz ortak ham metrik alanı, destek ve gözlem durumu ile ayrılır. Eksik değer
null/unknown, desteklenmeyen değer null/unsupported olur; açık desteklenen sıfır
yalnız sıfır olarak kalır. Eski Klaviyo spend değeri native maliyet desteği
kanıtı değildir; aktif satırda unsupported, özgün arşivde aynen korunur.
Klaviyo impression/ad_click mevcut sözleşmedeki delivery/click alanlarına ait
sentetik örnek olarak korunur; reklam gösterimi kanıtı sayılmaz.
Bu örneğin desteklenen aktif metriklerinde sıfır yoktur; sıfır kontrolü
ayrı izole birim girdisiyle yapılır, kaynak örnek değiştirilmez.

Eski JSON sayılarının JS Number anlamı korunur; bu dosya native ondalık
hassasiyet kabulü değildir. Native Dataset yazıcısının kayıpsız ondalık metin
ve PostgreSQL numeric kuralları değişmez. Eski calculated_metrics yalnız
beklenen referans değerleridir; EO-06-A hesaplama motorunun yerine geçmez.
Örnek yalnız USD/USD içerir; açık aynı-para kimliği vardır, kur sağlayıcısı
veya çapraz para dönüşümü uydurulmaz. Demo saat dilimi açıkça UTC'dir.

## Sabit ve hareketli örnek nasıl ayrılıyor?

Golden dosyasının tarihleri değişmez. `projectRolling` yalnız açıkça verilen
`YYYY-MM-DD` demo saatini son örnek günü kabul eder; tüm günleri aynı farkla
kaydırır. Kimlik, metrik, özgün tarih ve karşılaştırma aralıkları korunur.
`rolling-2026-11-10.json` bu fonksiyonun sabit, tekrar üretilebilir örneğidir.
Gizli güncel-saat varsayılanı yoktur. Etiket: “Synthetic demo data — not live
provider data”. Görsel kullanım ve gerçek demo mağazası ayrı EO UI kabulünde
bu etiketi göstermek zorundadır; bu PR görsel kabul yapmaz.

Kontrol: `node tools/eo05b-demo-fixture.mjs check`.
Kaynağı yeniden çıkarma: `node tools/eo05b-demo-fixture.mjs extract <yerel-kaynak-dosyası>`.
Komut ağdan indirme yapmaz; yalnız exact pinned kaynak kabul eder. JSON Schema
ve yalnız kullandığı keyword'leri destekleyen fail-closed doğrulayıcı birlikte
çalışır; sonrasında kaynak satırı/kimlik/tarih/hiyerarşi/metrik eşitliği ve
tekillik denetlenir. Golden, schema veya generator değişikliği yeni açık kapsam
ve anayasa revizyonu gerektirir; hash yenilemek tek başına onay değildir.

## Dört işin güncel durumu

| İş | Kanıt ve durum |
| --- | --- |
| Ortak özel sunucu kodunu yayımlamak | PR #351'in `6f0aa1053875ba8e94ec818d0f28078a664385b4` kodu Production'da doğrulandı. |
| Hazır RPC ve dar rol uzantılarını kurmak | İki migration, exact fonksiyon gövdeleri ve grant sınırları canlıda doğrulandı. |
| Üç sağlayıcıda kaynak → Dataset yolunu sınamak | Google/Meta gerçek boş kaynak ve kalıcı boş makbuz; Klaviyo doğrulanmış kaynak ve doğru bekleme sonucu. Aşağıdaki sınırlar geçerlidir. |
| Sürümlü demo ve EO-05-B kapanış kontrolü | Bu PR: veri dosyaları, üretici, doğrulayıcı, regresyon ve güncel kayıt. Zorunlu CI, uzak içerik doğrulaması ve ayrı merge onayı beklenir. |

[Canlı kabul kaydı](evidence/EO05B_LIVE_ACCEPTANCE_2026-11-10.json) önceki onaylı
çalışmanın özetidir; bu PR yeni canlı çağrı yapmaz. Google ve Meta'nın yanıtı
gerçek boş sonuçtur; sahte sıfır fact yazılmadı. Klaviyo hesabı okunmuştur,
metrik keşfi 0 kayıt döndürmüştür. Bu nedenle zorunlu metric kimliklerine bağlı
campaign/flow/event sorguları gönderilmedi. Üç şifreli zarf doğrulandı; Dataset
`held`, `empty: null` döndürdü. Bu, başarılı boş rapor veya tüm Klaviyo
sorgularının çalıştığı anlamına gelmez. Veri/metrik geldiğinde ayrıca gerçek
anlam kabulü yapılır; burada veri veya yeni iş paketi uydurulmaz.

Canlıda nonempty fact yazımı ve gerçek çapraz-para FX dönüşümü bu boş hesaplarla
kanıtlanmış değildir; bunların kod/SQL davranışı izole PostgreSQL testlerindedir.
Rapor para birimi kullanıcı adına seçilmedi. Üç yıllık senkron saklama ve
zorunlu silme önceliği uygulaması korunur. Klaviyo held kaynakları için rapor
saklama makbuzu veya üç yıllık uzatma yaratılmadı. Son durumda Dataset modu
kapalı, fact sayısı 0; kaynaklar 13 zarf / 43 sayfadır.

Bu kayıt EO-05'in tamamını, rapor yayınını veya saatlik refresh'i bitmiş
göstermez. EO-05-C olgunluk/finality ve EO-05-D tüketim/checkpoint/düzeltme
sınırları; 18/22 native kanıt beklemeleri ve önceki EO ertelemeleri korunur.
Mevcut beş tablo ailesi yeniden tasarlanmaz. İhracat/export, kapasite üreticisi,
Shopify demo mağazası, ürün/Cross Sell fixture'ı bu işe eklenmez.

Resmî mekanizma kontrolü 10 Kasım 2026:
[Node.js crypto](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options),
[Node.js test](https://nodejs.org/api/test.html),
[JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation),
[GitHub Git blob](https://docs.github.com/en/rest/git/blobs#get-a-blob).
