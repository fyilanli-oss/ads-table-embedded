# AdsTable ham kayıt akışı anayasası

Bu anayasa, platformdan okunan verinin doğru mağaza ve hesaba bağlı olarak alınmasını,
şifreli kaynak deposuna yerleştirilmesini, bütünlüğünün doğrulanmasını ve silme
kurallarının korunmasını bağlayıcı hale getirir. Codex dahil bütün geliştiriciler,
ajanlar ve otomasyonlar aynı kurallara tabidir. Mevcut depoyu yeniden tasarlamaz.

Makine sözleşmesi: [raw-source-constitution-v1.json](../contracts/raw-source/raw-source-constitution-v1.json).
Execution Plan ve açık ürün sahibi kararları üst otoritedir. OAuth anayasası ayrıca
geçerlidir; ham kayıt sözleşmesi OAuth akışını değiştirme izni vermez.

## Değişiklikten önce zorunlu kapı

Ham kayıt akışına doğrudan veya dolaylı dokunacak kişi önce bu iki belgeyi ve
etkilenen mevcut sağlayıcı sözleşmesini okur. Somut değişiklik, etkilenen adımlar ve
testler açıklanır; ürün sahibinin açık onayı alınır. Genel devam onayı veya başka
işin merge onayı yeni kapsamı onaylamaz. Çelişki varsa sessiz yorum veya refactor
yapılmaz. Yeni kapsam gerekiyorsa önce açıklanır ve ayrı onay alınır.

Değişiklik güncel main üzerinden PR ile yapılır. Makine sözleşmesine eski kayıtları
değiştirmeden yeni revizyon eklenir: açık onayın kaynağı, gerekçe, değişen korunan
dosyaların tam listesi ve ilgili test kanıtı yazılır. Hash yenilemek onay değildir.
Çalışan kod, canlı veritabanı, sağlayıcı işlemi, merge ve yayın ayrı yetkilerdir.
Guard, test veya workflow kaldırılarak ya da atlatılarak iş tamamlanamaz.

## Okumadan doğrulanmış kayda kadar sıra

| Adım | Zorunlu davranış |
|---|---|
| Plan ve yetki | Mevcut sabit sorgu ailesi, tarih aralığı, güncel mağaza/kurulum/nesil/bağlantı/hesap ve çalışma yetkisi doğrulanır. OAuth Connected tek başına çalışma yetkisi değildir. |
| Okuma | Mevcut özel sunucu girişinden, ilgili sağlayıcının mevcut credential protokolüyle okunur. Yetki ve iş kilidi/fence işlem boyunca yeniden kontrol edilir. |
| Alan seçimi | Yalnız onaylı sorgu alanları tutulur. Şema, sorgu ailesi, kaynak, sayfa sırası, alan kapsamı ve sayıların doğruluğu korunur. |
| Hazırlama | Kaynak paketi ve sayfaları aynı güncel sahipliğe bağlanır. İçerik hash'i ve şifreleme metaverisi hazırlanır; süre ve boyut sınırları aşılmaz. |
| Kayıt | Mevcut dar yetkili, sınırlı veritabanı işlemiyle şifreli zarf ve ilişkili kayıtlar atomik yazılır. Aynı işlem kimliğinde farklı içerik çakışmadır; üzerine yazılmaz. |
| Bilinen kayıt sonucu | Kesin makbuz geldikten sonra makbuz eşitliği, sayfa sırası/tamlığı, şifre çözme ve içerik hash'i mevcut readback protokolüyle doğrulanır. |
| Sonuç | Ancak ilgili doğrulamalar geçtiğinde kayıt doğrulandı denir. Bir zarfın doğrulanması bütün veri setlerinin, eşlemelerin veya raporun tamamlandığı anlamına gelmez. |

Bu sıra veri seti düzeyinde koruma modelidir; yeni bir runtime durum makinesi değildir.
Sağlayıcı durumlarının mevcut adları ve alt akışları kaynak dosyalarında korunur.
Google ve Meta veri setleri ayrı zarflardır; önceki zarf başarıyla yazılmışken sonraki
okuma durabilir. Klaviyo yapılandırması kaydedilebilirken performans verisi hâlâ
kısmi veya kullanılamaz olabilir. Bunlar toplu başarıya çevrilemez.

Yazma gönderilip cevabı kaybolduysa sonuç belirsizdir. Otomatik ikinci yazma, yeni
deneme kimliğiyle tekrar veya otomatik makbuz/sayfa sorgusuyla devam yoktur. Mevcut
açık, salt okunur uzlaştırma protokolü dışında başarı ilan edilmez. Sağlayıcı hatası,
yetki değişimi, iptal, zaman veya veri sınırı sonraki isteklerden önce durdurur.
Mevcut belgeli pacing ve quota davranışı korunur; yeni retry/fallback icat edilmez.

## Sağlayıcılar ve kaynak kapsamı

Google Ads: mevcut dokuz hesap/kampanya ve sekiz ürün/performans sorgu ailesi ile
Merchant ilişkisi/gerektiğinde ürün kimliği, mevcut sabit plan üzerinden çalışır.
Merchant bağlantısının bulunmaması ürün sayısı sıfır demek değildir. Credential
yenilemesi mevcut sunucu protokolündedir; yeni Settings/OAuth adımı eklenemez.

Meta: mevcut hesap performansı ve ürün kırılımı iki ayrı veri setidir. Mevcut
permission kontrolü, alan seçimi ve cursor doğrulaması korunur. Native paging.next
adresine körlemesine gidilmez; credential içerebilir. Dört dönüşüm alanının ham
gelmesi, henüz kanıtlanmamış satış rolü yorumunu tamamlamaz.

Klaviyo: mevcut hesap/yapılandırma ve tam metric keşfi, Campaign/Flow sorguları ve
Ordered Product olayları ilgili mevcut planla toplanır. Shopify metric'i yoksa
performans kullanılamazdır; sıfır veya tamamlanmış veri üretilemez. Mevcut credential
protokolü değiştirilmez; yeni token yenileme mekanizması bu sözleşmenin işi değildir.

Shopify Orders: mevcut izin, kapsam, mağaza/kurulum/nesil ve sipariş/ürün bağıyla
desteklenen kaynak yazımı korunur. Bu anayasa yeni müşteri profili, iade, ziyaret,
UTM veya pazarlama olayları sorgusu eklemez; Overlap kararı yerinde kalır.

Sorguların tam alan listeleri ve onaylı sürümleri makine sözleşmesinin gösterdiği
mevcut sorgu, depolama ve sağlayıcı sözleşmelerindedir; ikinci bir farklı liste
üretilmez. Yeni alan/sorgu/sürüm de akış değişikliğidir ve aynı kapıdan geçer.

## Sahiplik ve bütünlük kuralları

Mağaza, workspace, installation, nesil, provider, connection/version, credential,
hesap ve seçim sürümü ilgili mevcut protokole göre birlikte doğrulanır. İstemcinin
gönderdiği kimlik tek başına yetki değildir. Eski kurulum, değiştirilmiş hesap veya
geçersiz fence güncel kayda yazamaz. Farklı mağaza/hesap verileri birleştirilemez.

Ham kayıt bütün HTTP cevabının kontrolsüz kopyası değildir: izinli alanların şeması
belirli kaynak izdüşümüdür. Token, cookie, secret, imzalı sonraki-sayfa URL'si,
gereksiz profil bilgisi ve rastgele sağlayıcı hata gövdesi zarfa, loga, tarayıcıya
veya kanıt dosyasına taşınamaz. Kaynak sayıları gereksiz Number dönüşümüyle bozulamaz.

Owner'a bağlı AEAD/AAD, anahtar sürümü, nonce/auth tag, içerik hash'i, sıra ve makbuz
bağı korunur. Şifreyi çözebilmek tek başına geçerli kaynak kanıtı değildir; süre,
silinme, kaynak durumu ve sahiplik de doğrulanır. Veritabanında private şema, dar rol,
RLS ve mevcut RPC sınırları korunur; public/anon erişim yolu eklenemez.

Eksik, bilinmeyen, desteklenmeyen, kısmi, eski, kullanılamaz ve gerçek sıfır ayrı
durumlardır. Sıfır ancak başarılı ilgili sorgunun gerçekten boş dönmesiyle söylenir.
Ürün eşlemesi SKU/ad benzerliğinden uydurulamaz; mevcut namespace/source-rule ve
native doğrulama gerekir. PMax gözlem tarihi geçmiş günün kesintisiz ağaç kanıtı
yerine kullanılamaz. Kaynak toplama satış rolü veya Channel için yeni yetki vermez.

## Saklama ve zorunlu silme

Kabul edilen normal politika kaynak/kimlik/sipariş/claim için 90 gün, metaveri için
365 gündür. Kayıt başına sabit başlangıç korunur; okuma veya yeniden kullanım ömrü
uzatmaz. Süre dolması körlemesine silme yetkisi değildir: mevcut bağımlılık, consumer
makbuzu, kısmi/belirsiz kayıt ve sınırlı temizlik kontrolleri korunur.

Doğrulanmış zorunlu gizlilik silmesi normal saklamadan önce gelir; 90/365 gün beklenmez.
HMAC, gerçek mağaza ve talep kapsamı doğrulanır. Silinmiş siparişin aynı nesilde
yeniden yazılmasını engelleyen kayıt korunur. Normal OAuth Disconnect ile zorunlu
veri silme aynı işlem sayılmaz; mevcut protokoller ayrı kalır.

Shopify talebinin 30 günlük tamamlama süresi ile kaldırmadan 48 saat sonra gönderilen
shop/redact bildirimi farklıdır. Ertelenen teslim işi gerçek talebin süresini uzatmaz.
Veri varsa güvenli mağaza sahibi teslimi ve gerçek teslim kanıtı olmadan talep
tamamlandı sayılamaz. Verinin bulunmaması da kanıt gerektirir.

## Açık işler ve sonraki aşamayla sınır

Kaynak makbuzu Dataset'e aktarma makbuzu değildir. Gerçek tüketici kabulü olmadan
paket consumed yapılamaz. Dataset, FX ve kalıcı tüketim/checkpoint işlemi 23. adımdadır;
saatlik çalışma ve kapasite kabulü mevcut refresh aşamalarındadır.

Yedekleme ve geri dönüşte silmeleri yeniden uygulama EO-08-C'dedir. Silme kaydının
ömrü ilgili son geri dönülebilir yedeğin ömrü +30 gün kuralına bağlıdır; yedek
envanteri olmadan süre uydurulamaz veya kayıt silinemez. Geri dönülen veri, silmeler
doğrulanmadan servise açılamaz. Bu anayasa yedekleme kurulumunu başlatmaz.

Veri bulunan müşteri taleplerinin güvenli mağaza sahibine teslimi EO-07-A ve kabulü
EO-08-D'de kalır. Meta satış rolleri için gerçek veri kanıtı, PMax geçmiş Channel
kanıtı ve native ürün eşlemeleri açık kapılardır. Ortak rapor politikası/natif
başvuru kanıtları mevcut EO-06 ve EO-07/EO-08-D kapılarında korunur. Sağlayıcılarla
yazışmak bu işin parçası değildir. Bunların hiçbiri anayasa yazıldı diye PASS olmaz.

## Otomatik koruma ve teslim

[Guard](../tools/check-raw-source-constitution.mjs), mevcut Repository Governance
işinde testlerden önce çalışır. Runtime, SQL, ilgili ortak bağımlılıklar, bütün
contract/test/tool dizinleri, workflow, bağımlılık kilidi, bu belge ve guard hash
envanterindedir. Yeni dosya, silme, yeniden adlandırma ve içerik farkı kayıtsızsa
CI başarısız olur. Makine sözleşmesi kendi hash'ini içermez; modeli ve revizyon
geçmişi ayrıca doğrulanır. Satır sonu dışında farklar gizlenmez.

Negatif testler izinsiz değişikliği, geçmiş revizyonu değiştirmeyi, eksik kapsamı,
zayıflatılmış silme/bütünlük sınırlarını ve guard/test/workflow değişikliğini reddeder.
Mevcut gerçek davranış testleri normal pnpm test içinde çalışmaya devam eder.

CI konuşmadaki onayı ispatlayamaz ve bütün gelecekteki davranışları anlayamaz. Gerçek
owner incelemesi zorunludur. GitHub admin/bypass yetkisini repo kodu mutlak biçimde
engelleyemez; branch koruması ayrı platform ayarıdır ve bu işte değiştirilmez.
Bu teknik sınır Codex'e veya başka birine tek taraflı değişiklik yetkisi vermez.

Teslim: testler ve CI → uzak içerik doğrulaması → ayrı merge onayı. Çalışan toplama,
SQL ve OAuth kodu bu anayasanın ilk kuruluşunda değişmez; Production yayını yoktur.

Resmî kontrol tarihi 6 Kasım 2026:
[GitHub branch koruması](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
Mevcut teknik kararlar: [15. adım kapanışı](EO_05_STEP15_CLOSURE_2026_11_05.md),
[kaynak depo tasarımı](../contracts/eo-05-step15-storage-design-v1.json),
[sorgu standardı](../contracts/pd-cpd-query-standard-v1.json).
