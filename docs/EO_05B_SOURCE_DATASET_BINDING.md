# EO-05-B — depodaki ham zarftan Dataset kaydına bağlantı

8 Kasım 2026. Ürün sahibi, PR #346 kayıt katmanından sonra açıklanan
ham zarf → tablo yazıcısı bağlantısının kod, izole test ve PR kapsamını
“Tamam devam edelim onaylıyorum Codex” diyerek onayladı. Aynı EO-05-B ve
Ayrıntılı kontrol listesi 23 içindedir; yeni paket değildir.

Özel giriş `bindStoredDatasetSources` yalnız mevcut depodan okur. Yeni provider
isteği, token yenileme veya kullanıcı arayüzü yoktur. Güncel sahiplik, kaynak
makbuzu, tam sayfa dizisi, süre/sürüm ve gerçek AEAD çözümü doğrulanmadan
projection çalışmaz. Çağıran kişi hazır satır veya projection fonksiyonu veremez.
Sahiplik okunmadan önce ve sonra, yazımda da mevcut SQL içinde denetlenir.

Para birimi, saat dilimi ve bağlantı başlangıcı bugünkü hesap ekranından değil,
asıl okumanın saklanmış admission kaydından alınır. Aynı iş/fence/gün için
kaynak kaydı bulunamıyorsa durulur. Snapshot ve özeti fact provenance'ında
saklanır; SQL aynı kaydı ve her kaynak paketin native okuma kapsamını tekrar
karşılaştırır. Bağlantıdan önceki saatleri kapsayan gün rapora hazır sayılmaz.

Google'da account ve product zarflarının mevcut sorgu aileleri doğrulanır.
PD leaf satırları, ürün performansı ve özel cart-data satış aileleri ayrılır.
Kampanya toplamı leaf toplamına, genel cart-data ailesi özel satış ailesine
yeniden eklenmez. Conversion Action toplaması exact ondalık metinle yapılır.
Mevcut Shopping/PMax/Search rol kararı ortak saf fonksiyondan kullanılır.
Bugünkü PMax listing tree geçmiş Channel kanıtı yapılmaz.

Meta'da native reklam ve ürün kırılımı ayrı yazılır. Mevcut metrik kaynakları
korunur; dört ürün dönüşüm alanı, açık 18. madde kanıtı olmadan satış rolüne
veya ürün satış fact'ine dönüştürülmez. Ham alanlar şifreli zarfta kalır.

Klaviyo'da native metric kimlikleri, raporlar ve Ordered Product olayları
kullanılır. Mevcut Campaign Assisted / Flow Triggered çözücüsü korunur.
Maliyetin mesaja dağıtımı ve CPD ürün performansı uydurulmaz. Eksik Shopify
metric'i sıfır değildir; kısmi kaynak ve bekleme nedeni korunur. Olayın kendi
atıf ilişkisi kullanılmadan başka included kayıt ona bağlanamaz.

Büyük sayılar ve native sayı token'ları Number'a çevrilmez. Eksik, desteklenmeyen,
kısmi ve gözlenmiş sıfır ayrıdır. Aynı native anahtar ve aynı içerik yeniden
toplanmaz; çelişki durdurur. Tek giriş en fazla 200 fact yazar; daha büyük
projection sessiz kırpılmaz. Okuma limitleri çağıranın açık, sonlu girdisidir.

Bilinen başarılı yazım özel SQL makbuzuyla tekrar okunur. Yanıtı belirsiz yazım
otomatik denenmez veya incelenmez. Yazıcının makbuzu tüketim makbuzu değildir:
kaynak pending kalır, checkpoint ilerlemez, activation/publishable false kalır.
Boş ve doğrulanmış kaynak için sahte sıfır fact veya tüketim makbuzu üretilmez.

Bu teslim canlı bağlama değildir. Canlı DB/provider/config, runtime grant,
merge ve yayın yetkisi yoktur. Dataset saklama/olağan temizlik, kur kaynağı ve
rapor para birimi kabulü mevcut EO-05-B kapılarındadır. Kaynak 90/365 kararı,
18/22 native kanıtları, EO-05-C/D tüketim/düzeltme ve önceki EO ertelemeleri
değişmez. Önceki kayıt katmanı belgesinin sonraki projection ihtiyacı burada
kodlanır; önceki teslimin tarihsel sınırı yeniden yazılmaz.

Kanıt: `tests/dataset-source-binding.test.js`, mevcut Google rol/kayıt testleri,
tam test paketi, typecheck/build, anayasa guard'ları ve mevcut F01 içindeki
`tools/eo05b-source-dataset-binding-probe.mjs`. PostgreSQL kontrolü geçici CI
veritabanında sentetik native yanıt/admission, gerçek şifreleme/çözme ve gerçek
SQL yazım/readback ile çalışır; tümü rollback olur. Bu test gerçek provider
yanıtı veya canlı semantic kabul kanıtı diye sunulamaz.

8 Kasım 2026 resmî kaynak kontrolü:
[Google raporlama](https://developers.google.com/google-ads/api/docs/reporting/overview),
[Klaviyo campaign values](https://developers.klaviyo.com/en/reference/query_campaign_values),
[Klaviyo events](https://developers.klaviyo.com/en/reference/get_events),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
Meta developer sayfası erişilemedi; mevcut alanlar
[resmî Meta SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)
ve [Meta Postman koleksiyonu](https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1)
ile karşılaştırıldı. Yeni sorgu veya alan eklenmedi.

## 8 Kasım 2026 — ortak özel sunucu bağlantısı

Mevcut üç özel raw-capture girişinde yalnız açık DATASET_WRITE modu seçilirse ortak tablo aktarımı çalışır. Yeni URL, UI veya OAuth adımı yoktur. Sunucudaki sabit planın providerı adresle eşleşir; istek yalnız operationId taşır. Mevcut bearer, origin ve gövde sınırları korunur. Bu modda native reklam okuyucusu çağrılmaz.

Mevcut provider TLS rolleri kullanılır; yalnız sabit özel RPC listesi kabul edilir. Önceden doğrudan okunan admission bağlamı, güncel owner kontrolü yapan özel RPCye taşındı; tablo SELECT yetkisi açılmaz. Rol uzantısı ve iki yeni özel RPC yalnız hazırlanır, canlıya uygulanmaz. Google kurulum artifactinin türetilmiş profil kontrolü yeni bilinen opsiyonel yüzeyi tanır; eski native istemci sorgu listesi genişlemez.

Tek sunucu planı, ilk kaynak zarfının mevcut manifestinde en fazla32 kayıtlı işlem alanında bir kez başlatılır. Marker ömrü yenilemez, yeni tablo değildir. Kayıp yanıt veya sonradan hata markerı sıfırlamaz; başka process aynı operationId ile tekrar başlayamaz. Aynı operationId özel yazım makbuzuna da bağlanır. Başarılı yazım ve bilinen makbuz yeniden okunur; belirsiz yazımdan sonra otomatik inspection veya retry yoktur.

Varsayılan native-only değerler korunur; useFx açıkken mevcut sabit kur bağlantısı kullanılır. Merchant para birimi seçilmemişse tahmin yapılmaz. Özel yanıt yalnız durum/sayı/doğrulama sınırını döndürür; owner, token, zarf ve ham metrik içermez. source consumed, checkpoint, publishable ve saatlik refresh bu teslimle başlamaz.

Kod/izole test/PR kapsamı: contracts/eo-05b-dataset-server-v1.json. Gerçek PostgreSQL denemesi mevcut F01 içinde sentetik source/credential ile gerçek dar rol, AEAD, yazım/readback ve işlem tekrar reddini sınar; sonunda rollback olur. Canlı kurulum/rol/config/provider/yayın/merge ayrı onaylıdır. Aynı EO-05-B ve kontrol listesi23; yeni paket yoktur.
