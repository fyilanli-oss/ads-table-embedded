## 1 Kasım — onaylı Google/Meta uygulama hazırlığı

PR282'deki standardın ardından ürün sahibi Google/Meta Settings kodunu, izole
testleri ve kod PR'ını açıkça onayladı. Çalışma güncel main
`cc1b5623203d8e7becba33d53ad00c42e9448560` üzerinden
`codex/oauth-settings-flow` branch'inde hazırlanır.

Kart eylemleri ortak host'ta birleşir. Hesap kaydından sonra kalıcı yeni sürüm
okunur; çoklu hesapta Reporting Account modalı önceki modalın native afterhide
olayından sonra açılır. Başarılı kayıt yalnız ilgili kartı günceller. Belirsiz
sonuç yalnız lifecycle/hesap kayıtlarını okur; token okuma/yenileme, native çağrı,
kayıt tekrarı veya yeni izin isteği yapmaz. İlk reklam hesabının seçenek listesi
DB'de saklanmadığından belirsiz sonuçta önceki liste yalnız aynı connection/version
ile kullanılabilir; bu kanıt yoksa durum unknown kalır, otomatik fallback yoktur.

Klaviyo'nun açık hesap seçimi ve ayrı maliyet modalı, Shopify Products/optional
Orders korunur. Evidence/product test düğmeleri OAuth adımı yapılmaz ve kaldırılmaz.
Katalog/işletme/Merchant seçimi eklenmez. Canlı provider/token/config/DB işlemi,
migration, merge veya deploy yapılmaz. Gerçek masaüstü/en az320px mobil görsel
kabul beklenir;07 açık,15 başlamadı,22 paused,23 Dataset yazımıdır.

Aşağıdaki dokümantasyonla sınırlı onay metinleri PR282'nin tarihsel kapsamıdır;
bu uygulama izni onları kod/test hazırlığı yönünden izler.

# EO-05 / mevcut 07 — onaylı Settings düzeltmesi

## 1 Kasım — Google/Meta geçiş standardı

**Durum:** Ürün sahibi akış taslağını kabul etti ve ardından yalnız ilgili sözleşme,
analist brief'i ve dokümantasyon PR'ını hazırlamayı açıkça onayladı. Uygulama
başlamadı. Kod/test değişikliği, provider çağrısı, token okuma, canlı ayar/DB,
migration, merge ve yayın bu onaya dahil değildir.

Bağlayıcı akış kaydı:
`contracts/eo-05-permission-explanation-design-v1.json#Google_Meta_flow_standard_2026_11_01`.
Bu bölüm eski Google/Meta geçiş/eylem kurallarının çelişen kısmının üzerindedir.
Özellikle29Ekim combined_selection_spec içindeki başarılı kayıttan sonra yeniden
Resume bekleme kuralı tarihsel kalır. Önceki metinler iz bırakmak için korunur;
izin kapsamı, güvenlik, native provider onayı ve açık işlem onayı kapıları korunur.

### Amaç, mevcut bulgu ve başarı sınırı

Mağaza sahibi kurulumda bir sonraki düğmeyi aramamalı. Aynı kartı tek güncel durum
ve tek devam eylemi yönetmeli. İnceleme kaynağı main
`2e9df14116d40feee98e8937241136ea2ddbfe90` ve ayrı açık PR279'daki ürün sahibi
notlarıdır. PR279 merge edilmiş sayılmaz; bu kayıt oradaki talepleri somut akışa bağlar.

Mevcut Settings route'u combined Resume/Reconnect üretirken ortak permission host'u
ayrıca Resume/Check status üretebiliyor. Hesap kaydı cevabı yalnız sonraki aşamayı
döndürüyor; afterSelectionHide yalnız reporting_selected sonucunda kartı yeniliyor.
Çoklu hesap sonrası seçim listesi için yeni Resume/status isteği bekleniyor.
Combined callback görünümü de eski pending/pending_reporting modal açma yolunu
kullanmıyor. Bu yüzden yalnız birkaç düğmeyi gizlemek geçiş sorununu tamamlamaz.

Google ve Meta Connected/Reporting Account çalışması ürün sahibi tarafından
doğrulandı. Bu teknik başarı, ortak geçiş standardının uygulandığı veya Settings'in
görsel olarak kabul edildiği anlamına gelmez.07 açık;15 başlamadı;22 paused;
23 Dataset yazımıdır.

### Kabul edilen sıra ve birebir eylemler

Connect → mevcut izin açıklaması → açık Connect → sağlayıcının native izin ekranı
→ sunucu doğrulaması → açık reklam hesabı seçimi → gerekiyorsa Reporting Account
seçimi → kalıcı sonuç doğrulaması → Connected.

| Durum | Kart/modal eylemi | Geçiş ve koruma |
|---|---|---|
| Bağlı değil | Connect Google Ads / Connect Meta | Mevcut açıklamayı açar; yalnız açıklamadaki Connect native isteği başlatır. |
| Başlatma/dönüş doğrulama/kayıt | Yeni devam düğmesi yok | Starting connection… / Verifying access… / Saving selection…; ikinci işlem engellenir. |
| Doğrulanmış OAuth dönüşü | Mevcut hesap seçim modalı | Güncel kullanıcı işlemine bağlı sunucu sonucu okunur; bir kez açılır, ek Resume aranmaz. URL ipucu yetki değildir. |
| Açıkça bir hesap seçildi | Save selection / Cancel | Bir kez kaydet; kalıcı tek hesap ve Reporting Account bağını doğrula; Connected. Tek seçenek dahi uygulama tarafından kendiliğinden seçilmez. |
| Açıkça iki/üç hesap seçildi | Save selection / Cancel | Başarılı kayıt sonrası güncel bağlı seçim listesi okunur; önceki modalın afterhide'ı tamamlanınca Reporting Account modalı açılır. Arada Resume aranmaz. |
| Reporting Account seçimi | Save selection / Cancel | Bir kez kaydet; kalıcı sonucu doğrula; modal kapanır ve aynı kart güncellenir. |
| Kullanıcı yarıda bıraktı | Tek Resume setup | Güncel kayıtlı durumu okuyup yalnız eksik seçim adımını açar; OAuth tekrarlanmaz. |
| İzin eksik/yeniden izin gerekli | Tek Resume setup | Aynı açıklamayı açar; yeni native izin yalnız kullanıcının açık Connect'iyle istenir. |
| Sonuç belirsiz | Tek Resume setup | Önce mevcut sonuç salt okunur uzlaştırılır; exchange/refresh/credential yazma/seçim tekrarı/disconnect yapılmaz. Belirsizlik sürerse durur. |
| Bağlı | Reporting Account ve onay isteyen Disconnect | Hesap özeti ve kalıcı Reporting Account gösterilir. Disconnect iptali bağlantıyı korur. |
| Geliştirici/yayın kapısı kapalı | Close | Eksik geliştirici koşulu kullanıcıya yeniden izin aldırarak çözülmez. |

Normal Google/Meta kartında Reconnect Google Ads, Reconnect Meta, Check status ve
yinelenen Resume setup bulunmaz. Tamamlanmamış kurulumda rozet ve tek devam düğmesi
aynı durumu anlatır; farklı host'lardan ikinci kontrol grubu eklenmez. Belirsiz
sonuçtaki Resume bir durum okumasıdır; mevcut status yolu token yenileme/yazma
yapabiliyorsa salt okunurmuş gibi kullanılamaz. Bu sınır sonraki uygulamada ayrıca
kanıtlanmalıdır. Bilinen Connected sonucunda kart güncellenir; kalan adım yalnız
sunucu kanıtıyla açılır; gerçek izin eksiğinde açıklama açılır fakat consent başlamaz.

Yeni ortak sonuç metinleri:

- `We could not confirm the result. Resume setup to check the current connection status.`
- `No selectable advertiser accounts were returned. Resume setup to check the current connection status.`

Beş mevcut izin açıklamasının İngilizce paragrafları, hesap/Reporting Account
başlıkları,1–3 reklam hesabı sınırı, Google manager yasağı ve mevcut tek hesap
Reporting Account davranışı korunur. Native provider'ın işletme/Sayfa seçimleri,
AdsTable içinde yeni Merchant/işletme/katalog seçici eklemek için yetki değildir.
Evidence/ürün-test araçları OAuth aşaması veya bağlantı tamamlanma koşulu değildir;
taşınması/kaldırılması ayrıca somut uygulama kapsamı gerektirir.

### Kırmızı çizgiler

- Settings'te aynı anda tek etkin kurulum/seçim/yazma; çift tıklama veya diğer
  sağlayıcının düğmesi ikinci çakışan işlem başlatamaz.
- Bir modal tamamen kapanmadan diğeri açılmaz. Niyet, özellik, mağaza/kurulum,
  istek ve bağlantı/sürüm bağı kapanmadan önce sabitlenir; dispatch bir kez olur.
- Cancel/çarpı/Escape onay yerine geçmez, sonraki aşamayı açmaz; daha önce başarıyla
  kaydedilmiş adımları silmez. Başlamış isteğin geri alındığı iddia edilmez.
- Kapatılan modal kendiliğinden yeniden açılmaz. Sonraki sayfa yenilemede güncel
  durum gösterilir; yarım kurulum tek Resume ile sürer, yeni OAuth başlamaz.
- Gönderim öncesi alan hatası modalı ve girdiyi korur. Sonucu belirsiz gönderilmiş
  yazı, henüz gönderilmemiş alan hatasıyla aynı davranışa indirgenmez.
- Başarılı kayıttan sonra yalnız ilgili kart/sonraki adım güncellenir. Diğer bütün
  sağlayıcılar sırf ekranı güncellemek için yeniden çalıştırılmaz.
- Eski sekme/yanıt, değişen mağaza/kurulum nesli veya bağlantı sürümü güncel kartı
  değiştiremez. Belirsizlikte retry, izin genişletme veya alternatif provider yolu yok.
- Kayıtlı önceki bağlantı korunurken yeni işlemin belirsizliği ayrı anlatılır;
  aynı bağlantı için çelişen genel başarı/başarısızlık iddiaları gösterilmez.
- Missing/unknown/stale/denied/unavailable, gerçek boş sonuç ve0ayrı durumlardır.
  Connected yalnız raporlama bağlantısıdır; katalog eşleme/aktivasyon/Dataset değildir.
- Ajan kendi yorumuyla adım, seçici, izin veya istisna ekleyemez; yeni kapsam açık
  kullanıcı onayına tabidir. Ürün sahibi kabulü olmadan07 Done/PASS olamaz.

### Klaviyo ve Shopify karşılığı

Klaviyo: tek hesap dahil açık hesap seçimi ayrı modal; Continue ve native afterhide
sonrasında ayrı estimated spend modalı. Sıfır geçerli; maliyet eksiği yeniden OAuth
istemez. Hesap ve maliyet aynı modalda birleştirilemez.

Shopify: Products ve isteğe bağlı Orders ayrı durum/izin/kaldırma olarak kalır.
Mevcut yerinde App Bridge izin penceresi ve bağlı sunucu readback'i korunur.
Orders iptali/kaldırılması Products'ı bozmaz. Google/Meta redirect akışı Shopify'a
kopyalanmaz. İki sağlayıcı da ortak yükleniyor/iptal/hata/çakışma kabulüne karşı
kontrol edilir; bu kayıt ayrı bir yeniden uygulama veya tam görsel kabul değildir.

### Bileşen, masaüstü/mobil ve kabul

Mevcut stable Polaris2.0 ve App Bridge korunur: s-modal heading/size=base/padding=base
ve afterhide; s-button primary-action/secondary-actions, primary/secondary ve loading;
onaylı critical Disconnect; s-choice-list/s-choice ile reklam hesaplarında multiple,
Reporting Account'ta tek seçim; s-stack/s-paragraph/s-banner/s-badge ile tek durum
sunumu. Ham HTML action control, özel CSS, inline style veya literal renk yoktur.

Resmî kaynaklar1Kasım2026 kontrol edildi:
https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal ;
https://shopify.dev/docs/api/app-home/latest/web-components/actions/button ;
https://shopify.dev/docs/api/app-home/latest/web-components/forms/choice-list .

Sonraki uygulamanın kabulü tek/çok hesap, callback, kısmi izin/ret/iptal, modal
Cancel/Escape/çarpı, yarım bırakıp Resume, alan hatası, yazılmış/yazılmamış belirsiz
sonuç, eski sekme/yanıt/sürüm, çift tıklama/diğer sağlayıcı çakışması, Reporting
Account değişimi ve Disconnect onay/iptalini kapsar. Klaviyo ve Shopify koruma
senaryoları da çalıştırılır. Gerçek Shopify Admin masaüstü ve en az320px gerçek
mobilde odak/klavye/dokunma, tek modal, taşmayan içerik ve ulaşılabilir eylemler
ürün sahibi tarafından doğrulanmadan görsel kabul verilmez; Shopify görsel
otomasyon yapılmaz. Mevcut CI/code başarısı bu yeni standardın uygulanma kanıtı değildir.

Sıra: bu dokümantasyon PR'ının ayrıca onaylı merge'ü → ayrı somut kod/test onayı
→ uygulama/CI → ayrıca izinli yayın ve gerçek masaüstü/mobil kabul. Mevcut07 açık;
15 başlamadı;22 paused;23 Dataset yazımıdır.

## 1 Kasım — tek Meta hesabı kaydından sonra yanlış unconfirmed

Owner token içermeyen bağlantı kayıtlarının salt okunur doğrulanmasını, dar kod
düzeltmesini ve gerçek SQL testleriyle PR hazırlığını onayladı. Canlı mutation,
OAuth tekrarı, migration, config, merge ve yayın kapsam dışıdır.

`1000070310`–`1000070311` gözleminde tek Meta reklam hesabı seçimi sonrası genel
unconfirmed görüldü. 10:55:08.044UTC uygulama kaydı feature=meta,
intent=permission_select_accounts, code=PERMISSION_OPERATION_UNCONFIRMED.
Salt okunur, token içermeyen metadata sorgusu Meta bağlantısında connected/version26,
updated_at=10:55:07.702UTC, bir aktif hesap ve bir current Reporting Account bağı
gösterdi. Kayıt yapılmıştı; sonuç doğrulamasında kod/SQL dönüşü uyumsuzdu.

`complete_pending_provider_account_selection` yalnız connection_id, lifecycle_status,
connection_version ve connected_account_count döndürür. Repository eksik Reporting
Account alanını null yaparken ortak seçim katmanı tek hesabın ID'sini bekliyordu.
Mevcut sentetik test gerçek SQL'in döndürmediği alanı eklediği için kusuru gizliyordu.

Dar düzeltme gerçek receipt şeklini doğrular; Connected sonucunda mevcut hesap
otoritesi repository'sinden kayıtlı Reporting Account ve hesap kümesini salt okunur
okur. Exact connection/credential/hesap ve son lifecycle sürümü eşleşmelidir.
Eksik/yanlış/başarısız readback ve eşzamanlı değişiklik unconfirmed kalır; yazma veya
provider isteği tekrarlanmaz. Seçim ID'sinden varsayımsal başarı üretilmez. Ortak
Google/Meta katmanının iki runtime bağlantısı aynı kontrolü kullanır; OAuth sırası,
scope, tek/çok hesap davranışı ve UI değişmez. Yeni migration yoktur.

Test fixture gerçek SQL dönüş sütunlarına daraltılır. Negatif testler eksik/yanlış
otorite, bağlantı/credential/Reporting Account/inventory farkı, readback hatası ve
okuma sırasında sürüm değişimini kapsar. F01 dar rollout iki rol dalında gerçek
runtime/vault/crypto/SQL ile tek Google ve tek Meta hesabı kaydını sınar. Gerçek
SQL receipt'inde Reporting Account alanının olmadığı ve yalnız bir seçim yazısı
ardından kalıcı bağın doğrulandığı kanıtlanır; native HTTP sentetiktir, ek native
istek/retry yoktur. CI sonucu ayrıca doğrulanır; bu hazırlık canlı düzeltme değildir.

Sadeleştirme notları ayrı PR279'da korunur.07 açık;15 başlamadı;22 paused;
23 Dataset yazımıdır. Resmî kaynak kontrolü1Kasım2026:
https://supabase.com/docs/guides/database/functions ve https://vercel.com/docs/logs/runtime .

## 1 Kasım — Google Reporting Account değişiminde eksik yenileme migration'ı

Ürün sahibi, yalnız ilgili canlı fonksiyonların salt okunur doğrulanmasını ve
düzeltmenin izole testlerle PR olarak hazırlanmasını açıkça onayladı. Canlı DB
uygulaması, OAuth tekrarı, provider/config değişikliği, merge ve yayın kapsam dışıdır.

`1000070294` ekranındaki GOOGLE_IDENTITY_RENEWAL_WRITE_UNCONFIRMED için 1 Kasım
08:49:42.109 UTC Postgres kaydı SQLSTATE42883 döndü: runtime'ın exact imzasıyla
`integrations.commit_google_identity_renewal(...)` bulunamadı. Salt okunur pg_proc
ve information_schema denetimi commit/read yenileme fonksiyonlarının ve iki
identity_credential_before_id/identity_credential_after_id sütununun bulunmadığını,
adstable_refresh_coordinator rolünün de olmadığını doğruladı. Token veya kullanıcı
verisi okunmadı; bu hata Google hesabı veya OAuth izin reddi olarak yorumlanamaz.

Eksik yapı repository'deki pending
`20261028175738_eo05a_google_identity_renewal_receipt.sql` dosyasındadır. Dosyanın
koordinatör rolüne koşulsuz REVOKE'u, mevcut rol-yok başlangıcıyla uyumsuzdur.
Hazırlanan dar düzeltme rol varsa REVOKE yapar; yeni rol veya refresh altyapısı
kurmaz. Diğer REVOKE'lar, runtime-only EXECUTE, atomik yenileme/CAS/receipt ve
belirsiz sonuçta retry yapmama kuralları korunur. Dosya hâlâ pending ve canlıya
uygulama yetkisi false; hash yalnız hazırlanan içeriğe göre güncellenir.

F01 izole runner, tarihsel40 + önceden yayımlanan iki OAuth dosyası üzerinde
eksik RPC42883 durumunu önce yeniden üretir. Sonra yalnız renewal dosyasını gerçek
commit sınırıyla uygular; rol yokken ve ayrı rollback dalında rol/default EXECUTE
varken gerçek SQL/crypto/CAS/receipt testlerini çalıştırır. Ayrıca gerçek Google
runtime'ı, vault ve SQL üzerinden sentetik HTTP ile expired token → tek refresh →
yenileme → ikinci Reporting Account kaydı sınanır. Gerçek provider HTTP çağrısı,
canlı anahtar veya mağaza fixture'ı kullanılmaz. CI sonucu ayrıca doğrulanır.

Resmî kontrol 1 Kasım2026: https://supabase.com/docs/guides/database/functions .
Canlıda eksik fonksiyon hâlâ eksiktir; hazırlık canlı hatanın giderildiği iddiası
değildir.07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır. Önceki ürün
sahibi sadeleştirme notları ayrı PR279'da korunur; bu paket UI değiştirmez.

## 31 Ekim — mevcut07: test ve gerçek hesapların birlikte keşfi

27 Ekim PR192/8074086 ile yeni kimlik yoluna stopOnFirstError ayarını ben ekledim.
16 Ekim16a54df kaydında test hesabıyla başarı var; eski keşif kök hesap hatasında
diğer hesaplara devam ediyordu. Son güvenli kayıt search HTTP403/PERMISSION_DENIED/
CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION; hangi hesapta olduğu kanıtlanmadı.

Owner yalnız dar kod ve sentetik test hazırlığını onayladı. Mevcut gerçek REST
kanıtına dayalı hesap elemesi iki kesin koda genişler: CUSTOMER_NOT_ENABLED ve
CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION. Yalnız search HTTP403/PERMISSION_DENIED
ve tamamı aynı izinli authorizationError olan dolu hata kayıtları kabul edilir.
Karışık/eksik/bilinmeyen hatalar veya diğer durumlar strict duruşu korur.
Reddedilen kök tekrar denenmez, adaylardan çıkarılır ve yeniden eklenmez.
Okunabilen diğer hesaplar korunur; hepsi reddedilirse başarı veya credential
kaydı yoktur. Hata kodundan hesabın test_account değeri üretilmez.

OAuth ekran/sıra/kapsam, açık1–3 reklam hesabı seçimi, manager yasağı ve Reporting
Account değişmez. Kod/test yetkisi canlı çağrı, native tekrar, config/env, DB,
merge veya yayın yetkisi değildir.07 açık;15 başlamadı;22 paused;23 Dataset yazımı.
31 Ekim2026 resmî kontrol: https://developers.google.com/google-ads/api/reference/rpc/v25/AuthorizationErrorEnum.AuthorizationError
Bağlayıcı güncel kayıt: contracts/eo-05-permission-explanation-design-v1.json#Google_mixed_account_access_isolation_2026_10_31

## 31 Ekim — mevcut07: etkin olmayan Google hesabını dar kapsamda eleme

Owner yalnız kod ve sentetik test hazırlığını onayladı. Gerçek search kaydında
HTTP403 / PERMISSION_DENIED / CUSTOMER_NOT_ENABLED doğrulandı. Yalnız gerçek REST
yanıtındaki bütün hata kayıtları bu authorizationError değerini taşıyorsa ilgili
kök hesap seçimden çıkarılır; aynı hesap yeniden sorgulanmaz veya başka yönetici
altından listeye geri eklenmez. Diğer kök hesaplar değerlendirilir. Karışık, eksik,
farklı HTTP/status/enum veya listAccessibleCustomers hatası strict modda hemen
durdurur. Bütün hesaplar elenirse başarı veya Connected üretilmez. Geçerli sonuç
yalnız pending_account_selection aşamasına gider. Ekran, OAuth sırası, scope,
1–3 reklam hesabı seçimi, manager yasağı ve Reporting Account değişmez.

31 Ekim2026 resmî kontrol: https://developers.google.com/google-ads/api/reference/rpc/v25/AuthorizationErrorEnum.AuthorizationError
Kod/test hazırlığı canlı istek, native tekrar, config/env, migration/DB, yayın veya
merge yetkisi değildir.07 açık;15 başlamadı;22 paused;23 Dataset yazımıdır.
Yeni kayıt önceki genel strict ilk-hata kuralına yalnız bu dar istisnayı ekler.


## 31 Ekim — Google hesap okuma hatasında güvenli teknik neden

Owner yalnız dar kod/test hazırlığını onayladı; canlı istek/config/yayın/native
tekrar/merge yoktur. Son tam-izin denemesi Google REST_REQUEST_FAILED ile account
discovery'de durdu; mevcut log allowlist bu kodu içermediği için nedeni genel
unconfirmed'a düşürdü. Kaydın exact HTTP/Google nedeni geriye dönük bulunamadı.

REST katmanının gerçekten oluşturduğu hata nesnesine özel WeakMap kanıtı bağlanır:
yalnız sabit list_accessible_customers veya search işlem adı, 200–599 HTTP integer,
canonical Google status ve belgelenmiş izinli hata enum'u; bilinmeyen değer null.
HTTP200 içindeki mevcut error envelope reddi de aynı kanıtı taşır. Error.details
sonradan değiştirilse veya sahtesi üretilse log yetkisi olmaz; raw error/message,
body/header/token/account/query/scope/mağaza/stack ve provider request-id loglanmaz.
Mevcut tek log sink yalnız Google permission_callback + REST_REQUEST_FAILED için
bu dar kanıtı alır. Diğer log şekilleri aynı kalır. Çağrı sayısı, timeout,
stopOnFirstError, izin/hesap seçimi, hata davranışı ve UI değişmez.

Sentetik test: ilk listeleme ve sonraki search401/403/429/503, HTTP200 error
envelope; ilk hata sonrası sıfır retry/sonraki root sorgusu; metadata immutable,
sahte/getter/unknown/oversized enum ve ham payload sızmaması; gerçek callback
loader'dan safe loga taşınma. Token/migration/DB kaydı yapılmaz. Bu hazırlık kök
Google nedenini çözmüş veya canlı OAuth'u tamamlamış sayılmaz.
Kaynaklar31Ekim2026: https://developers.google.com/google-ads/api/docs/concepts/call-structure ;
https://developers.google.com/google-ads/api/reference/rpc/v25/AuthorizationErrorEnum.AuthorizationError ;
https://developers.google.com/google-ads/api/reference/rpc/v25/AuthenticationErrorEnum.AuthenticationError ;
https://developers.google.com/google-ads/api/reference/rpc/v25/QuotaErrorEnum.QuotaError ;
https://developers.google.com/google-ads/api/reference/rpc/v25/RequestErrorEnum.RequestError ;
https://developers.google.com/google-ads/api/reference/rpc/v25/InternalErrorEnum.InternalError .

## Güncel ürün sahibi düzeltmesi — 31 Ekim 2026

Önceki tek hesapta adım atlama kararı reddedildi. Kullanıcı aşağıdaki somut
işleri açıkladıktan sonra "Tamam başlayalım Codex" diyerek kodlamayı onayladı.
Bu bölüm aşağıdaki eski tek hesap/spend yönlendirmesinin üzerindedir.

- Klaviyo: OAuth → ayrı `Select Klaviyo account` modalı → ayrı
  `Add estimated email spend` modalı. Tek hesap da açık seçim ve Continue ister.
- Hesap seçimi modalında maliyet alanı olmaz. Spend modalında hesap seçicisi
  olmaz; yalnız onaylanan hesap bilgisi ve maliyet alanı bulunur.
- Continue yalnız sunucudan gelen listede bulunan tam bir hesap seçilmişse
  kabul edilir. Seçim modalının native `afterhide` olayı gelmeden spend açılmaz.
  Escape/Cancel/çarpı ile kapatma sonraki modalı açmaz veya kayıt yapmaz.
- Spend iptali aynı geçerli seçimi korur; Resume spend'e dönebilir. Liste
  değişmişse geçersiz seçimle devam edilmez; hesap modalına dönülür.
- Boş/geçersiz tutar alan hatasıdır; `0` geçerlidir. Mevcut maliyet geçmişi,
  sunucu doğrulaması, belirsiz sonuçta Check status ve tek istek korunur.
- Google/Meta açıklama → OAuth → mevcut 1–3 reklam hesabı → gerektiğinde tek
  Reporting Account sırası korunur. Katalog seçimi veya otomatik seçimi yoktur.
- Google/Meta başlangıcı ve callback'i aynı sunucu yayın koşulunu kullanır.
  Shopify Products ve ayrı/isteğe bağlı Orders aynı doğrulanmış yayın koşullarını
  kullanır. UI tek başına izin veya yayın yetkisi vermez.
- Sabit dört `false` yerine sunucu yayın ayarları okunabilir hale getirilir;
  bu ayarların canlıda değiştirilmesi ayrı onay ister. Kapalı durumda uygulamanın
  kendi yayın engeli sağlayıcının izin reddi gibi gösterilmez.

Birebir seçim hatası: `Select one Klaviyo account to continue.`; Continue,
Cancel ve Save and connect korunur. Seçim hatası `s-choice-list.error`, maliyet
hatası `s-number-field.error`; ayrı `s-modal` ve native afterhide kullanılır.
Kaynaklar (31 Ekim 2026):
https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal ve
https://shopify.dev/docs/api/app-home/latest/web-components/forms/choice-list .
Yalnız native bileşenler; özel CSS/ham HTML kontrolü yok. Desktop ve en az320px
gerçek mobilde her iki modal, Cancel, Escape, seçim, hata ve başarı ayrıca ürün
sahibi tarafından kabul edilir; önceki ekran görüntüleri PASS değildir.

Yayın koşulları için eksik geliştirici/app onayı, kapsam yayını ve canlı izin
kanıtı ayrı kayıt edilir. Yerel kod, provider onayı veya canlı izin kanıtı
değildir. Bu onay config/provider mutation, Shopify görsel otomasyonu, deploy
ve merge içermez. 15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

### İncelenebilir yayın koşulları ve kalan gerçek ortam işleri

Sunucu ayarları yalnız birebir `true` değerini kabul eder; eksik/başka değer
kapalıdır. Tarayıcı formu bu ayarları değiştiremez. Bunlar izin/onay kanıtı
değil, ayrı açık yayın kararı sonrasında kullanılacak çalıştırma anahtarlarıdır.

| Platform | Kodda bağlanan ayar | Canlıya geçişte doğrulanacak |
|---|---|---|
| Google | `ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED` | Mevcut OAuth uygulamasının Ads+Merchant iki scope talebine hazır olması; geliştirici/test erişimi ve native kullanıcı onayı |
| Meta | `ADSTABLE_META_IDENTITY_OAUTH_ENABLED` | Mevcut uygulamanın sabit beş scope için dev/test veya dağıtım koşulları; native kullanıcı onayı |
| Shopify | `ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED` + `ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED` | Mevcut app sürümünde read_products/read_orders optional scope yayını; native okuma ve ayrı Products/Orders onayı |

31 Ekim salt okunur Vercel metadata listesinde bu dört anahtar için eşleşme
dönmedi; hiçbir değer çözülmedi veya değişmedi. Bu gözlem Google/Meta panel
onayı veya Shopify'daki yayımlanmış sürümün izinleri hakkında kanıt değildir.
Yerel `shopify.app.toml` optional_scopes içermiyor; native sürümün durumu ayrı
kontrol bekler. Shopify controller, yayın anahtarı açık olsa da native optional
handle'ı bulmadan izin isteyemez; Orders, Products tamamlanmadan istenemez.

Yeni runtime ayarları, Shopify app sürümü/izin yayını, geliştirici paneli değişikliği
ve yeni deploy bu kod onayıyla yapılmadı. Mevcut canlı sürüm hâlâ önceki1e84b00
adayıdır; düzeltilmiş kaynak ayrıca yayınlanmadan ekran testi istenmez.

31 Ekim 2026. Ürün sahibi salt okunur inceleme sonrasında somut kodlama kapsamını
onayladı. #264'ün onaylı, katalog seçimi kaldırılmış arayüz değişiklikleri güncel
main üzerine uyumlandırılır. Yeni paket veya madde numarası oluşturulmaz.

## Amaç ve değişmeyenler

Klaviyo maliyet hatasını ilgili alanda göstermek, sağlayıcıların yüklenme
göstergelerini ayırmak ve Resume setup'ı eksik adıma götürmek. İzin setleri,
sunucu kapıları, token/callback, maliyet formülü ve geçmiş harcama kayıtları
değişmez. Merchant/işletme/katalog seçimi, otomatik katalog seçimi veya bunun
yerine başka bir kullanıcı adımı eklenmez. Provider çağrısı, config, migration,
deploy ve Shopify görsel otomasyonu kapsam dışıdır. Merge ayrıca onay bekler.

## Durum ve birebir metin

| Durum | Metin | Davranış |
|---|---|---|
| Bağlı değil | Not connected | Mevcut açıklama, yalnız açık Connect ile istek |
| Hesap gerçekten seçilmemiş | Account selection required | Resume setup hesap adımını açar |
| Doğrulanmış tek hesap veya geçerli seçim, maliyet eksik | Estimated spend required | Resume setup maliyet adımını açar; OAuth başlatmaz |
| Maliyet eksik | Add the estimated 30-day email spend to finish setup. Enter 0 if there is no cost. | Mevcut hesap ve maliyet adımı korunur |
| Maliyet boş/geçersiz | Enter an amount from 0 to 99,999,999.99 with up to two decimal places. | Alan hatası; modal açık ve girilen değer korunur; sıfır geçerli |
| Kaydetme sürüyor | Save and connect | Yerleşik loading göstergesi; aynı kaydetme ikinci kez başlamaz; diğer sağlayıcılar Working olmaz |
| Başarı | Mevcut Connected / güncel tutar görünümü | Sunucu başarısından sonra modal kapanır |
| Sunucu sonucu doğrulanamadı | The save could not be confirmed. Check the connection status before continuing. | Modalda açıklama; otomatik tekrar yok |
| Cancel / kapatma | Cancel | Yeni kayıt veya izin isteği yok |

Mevcut Google/Meta/Shopify açıklamalarının birebir metinleri
`EO_05_PERMISSION_EXPLANATION_DESIGN_BRIEF.md` içindedir. Katalog seçimiyle ilgili
eski tasarım notları son kullanıcı kararıyla geçersizdir; bağımsız katalog
okuyucuları ve ileriki doğrulama işleri korunur.

## Bileşenler ve resmî kaynaklar

Kontrol tarihi: 2026-10-31.

| Öğe | Bileşen / özellik | Resmî kaynak |
|---|---|---|
| Maliyet alanı | s-number-field: error, required, min=0, max=99999999.99, step=0.01 | https://shopify.dev/docs/api/app-home/latest/web-components/forms/number-field |
| Modal | s-modal: heading, primary-action ve secondary-actions slotları; showOverlay/hideOverlay | https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal |
| Kaydet / Cancel | s-button: loading, disabled, variant=primary; commandFor ve --hide | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button |
| Durum | s-badge / s-paragraph; mevcut Shopify görünümü | https://shopify.dev/docs/api/app-home/latest/web-components |

Form sonucu bağımsız `useFetcher` üzerinden işlenir; güncel React Router v7
belgesi: https://api.reactrouter.com/v7/functions/react-router.useFetcher.html . Dependency sürümü değişmez.
Özel CSS, ham HTML kontrolü ve özel modal yoktur.

## Kabul

İzole testlerde boş/negatif/geçersiz/sıfır/geçerli tutar; sunucu hatası;
çift kaydetmenin engellenmesi; diğer sağlayıcıların Working olmaması;
tek/çok/değişmiş hesapta Resume; kapalı kapılar ve katalog seçiminin yokluğu
doğrulanır. Masaüstü ve en az 320 px gerçek mobilde hata metni, dokunma,
klavye, odak geri dönüşü, iptal ve başarı ürün sahibi tarafından sınanır.
Otomatik testler native görsel kabul yerine geçmez. Bu kabul ve açık merge
onayı gelmeden UI Done/PASS değildir. 15 başlamadı; 22 duraklatılmış; 23 Dataset yazımıdır.

## 31 Ekim — mevcut 07 Shopify optional izin adayı (henüz yayımlanmadı)

Ürün sahibinin kodda hazırlama isteğiyle shopify.app.toml dosyasına yalnız
optional_scopes = ["read_products", "read_orders"] eklendi; required scopes boş
kaldı. Products ürün kurulumu için gereklidir; Orders ayrı ve isteğe bağlıdır.
Önceki “yerel TOML optional içermiyor” tespiti bu aday öncesine aittir.
Bu kayıt Shopify'da yayımlanmış izin veya mağaza onayı kanıtı değildir.

Mevcut uygulama kimliği, adresleri, webhooks ve runtime yayın anahtarları
korundu. Shopify panelinde işlem/giriş denemesi, CLI app dev/deploy veya
workflow dispatch yapılmadı. Paneldeki işlemi ürün sahibi yapacak; native
sürüm yayını ve izin doğrulaması bekleniyor. Yeni uygulama oluşturulmaz.

31 Ekim resmî kontrol: https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration#access_scopes
ve https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes .
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_optional_scope_candidate_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı. Merge ayrı onay bekler.

## 31 Ekim — mevcut 07: Shopify 401 yanıtının derleme uyumluluğu

Ürün sahibi 1000070104 ekranındaki 401 için önce salt okunur incelemeyi,
ardından yalnız kod düzeltmesi ve derlenmiş sürüm testini onayladı.
Shopify SDK 3.0.1 boundary.error sınıf adına bakıyor; Vite üretim derlemesi
Router hata sınıfını kısaltıyor. Gerçek Router nesnesi ve SDK işleyicisiyle
minify edilmiş test düzeltme öncesi başarısız, sonrası başarılı oldu.

Düzeltme yalnız vite.config.ts içinde esbuild.keepNames=true ayarıdır.
SDK işleyicisi değiştirilmez; 401, yönlendirme başlığı ve diğer hataların
aynı biçimde iletilmesi korunur. Minification açık kalır; sınıf/fonksiyon
adları korunacağı için paket boyutunda artış olabilir. Yeni arayüz veya
metin yok; scope/token/izin/hesap seçimi ve runtime yayın anahtarları değişmez.

İlgili 48 test geçti. Tam test/tip/derleme ve exact-commit CI ayrı doğrulanır.
Canlı denemenin yanıt başlıkları loglarda yok; tekrar üretilen bu kusur,
canlı 401'in tüm nedenlerinin kesinleştiği anlamına gelmez.

Güncel native durumun önceki aday kaydından farkı: ürün sahibi optional
read_products/read_orders sürümünü kendisi yayımladı (1000070103). İki
Shopify runtime anahtarının ayrıca onaylı açılması ve mevcut e086df0 kaynağının
dpl_9oDokZ3QuHkxVaeh133MH77GXKrX yayını PR277'de kayıtlıdır. Mağaza onayı
hâlâ doğrulanmadı. Bu yeni düzeltme için deploy, native tekrar veya merge
onayı verilmedi; Shopify'da görsel işlem yapılmaz.

Resmî kontrol 2026-10-31:
https://v7.vite.dev/config/shared-options#esbuild
https://esbuild.github.io/api/#keep-names
https://api.reactrouter.com/v7/functions/react-router.isRouteErrorResponse.html
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_boundary_build_correction_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — mevcut 07: Settings .data yönlendirme başlığı

1000070105 ekranı sonrası salt okunur inceleme ve ardından yalnız kod/test
onayı alındı. Gerçek Settings action'ı gerçek Router production request handler
ile POST /settings.data üzerinden çalıştırıldığında 401'in SDK yönlendirme
başlığı kayboluyordu: Single Fetch hata başlıklarını leaf Settings rotasında
birleştiriyor; bu rotada headers export yoktu. Parent layout export'u yetmiyor.

Settings artık yalnız mevcut Shopify boundary.headers işlevini dışarı verir.
Gerçek HTTP yanıtında Products ve Orders yönlendirme başlığı korunur.
Normal 401/403'e yönlendirme eklenmez, başarı verisi tekrar isteğe çevrilmez.
İzin talebi ve authentication sentetik bağımlılıktır; ağ veya native izin
çağrısı yapılmaz. Önceki helper/derleme testi bu leaf aktarımı kapsamıyordu.

Yeni UI, akış, scope, token, hesap seçimi veya runtime flag değişikliği yok.
Bu düzeltme yayın, native tekrar veya merge onayı içermez; gerçek izin kabulü
bekler. Önceki derleme düzeltmesi ayrı onayla yayımlanmış tarihsel kayıttır.
Resmî kontrol31Ekim2026:
https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin#headers
https://reactrouter.com/how-to/headers
Kurulu React Router7.18.2 Single Fetch kodu ayrıca okundu.
Bağlayıcı kayıt: contracts/eo-05-permission-explanation-design-v1.json#Shopify_settings_data_headers_2026_10_31.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — mevcut 07: Products kullanıcı akışının tamamlanması (kod/test onaylı)

Amaç: Connect Products → mevcut Shopify izin ekranı → Settings'e otomatik dönüş
→ sunucunun güncel izin okuması → kartta açık sonuç. Yayın/native deneme/merge
bu onayın dışındadır. Products rolü raporlama veya Dataset aktivasyonu değildir.

Dönüş: yalnız Products Connect sırasında, native istekten önce, aynı sekmenin
sessionStorage alanına sürümlü/mağazaya bağlı, 10 dakika geçerli dönüş niyeti
kaydedilir. Kimlik/token/izin kanıtı değildir; yalnız /settings gezinmesi içindir.
Authenticated layout ana sayfaya dönüşte aynı mağazanın niyetini bir kez tüketir.
Saklama başarısızsa izin isteği başlamaz. Yeni callback veya scope parametresi yok.

Settings loader aynı doğrulanmış mağazada mevcut afterReturn üzerinden bir kez
salt okunur izin okur; otomatik izin isteği, retry, timer veya poll yoktur.
Güncel izin okuması her Settings girişinde kartı üretir; local niyet başarı sayılmaz.
Aynı sayfada zaten granted sonucu veya açık Check status da kartı günceller.

| Durum | Birebir metin | Davranış |
|---|---|---|
| Doğrulandı | Ürün erişimi onaylandı | s-badge tone=success; Connect Products yok |
| Eksik/izin verilmemiş | Ürün erişimi henüz onaylanmadı. | s-paragraph; mevcut Connect açıklaması |
| Doğrulanamadı | Ürün erişimi doğrulanamadı. Durumu tekrar kontrol edin. | s-banner tone=critical; açık Durumu kontrol et; Connect yok |
| Okuma/başlatma sürüyor | Ürün erişimi doğrulanıyor… | s-banner tone=info; mükerrer eylem engeli |
| Dönüş yönlendirmesi | Settings'e dönülüyor… | s-page heading=Settings ve s-banner tone=info |
| Dönüş hatası | Settings'e otomatik dönülemedi. | s-banner tone=critical; s-link Settings'i aç; otomatik tekrar yok |
| Yayın kapalı | Ürün bağlantısı şu anda kullanılamıyor. | s-paragraph; mevcut açıklama/kapalı yayın koşulu |
| Açıklama iptali | mevcut Cancel/çarpı/Escape | dönüş niyeti veya istek oluşturmaz |
| Native iptal | güncel sunucu okumasına göre eksik veya doğrulanamadı | Cancel'ın grant verdiği varsayılmaz; otomatik tekrar yok |

Products için generic awaiting activation banner ve ikinci Check status gösterimi
kaldırılır; sonuç kendi Shopify kartındadır. Orders, Google, Meta, Klaviyo native
akışları, hesap seçimi, scope, token, SDK yöntemi ve server grant guard'ları korunur.
Gerçek masaüstü ve en az320px mobilde grant/iptal/dönüş/yenileme/readonly hata
kabulü ayrıca ürün sahibinde bekler; otomatik test native kabul değildir.

Native s-page/s-section/s-stack/s-badge/s-banner/s-button kullanılır; özel stil yok.
Resmî kontrol31Ekim2026: mevcut scope/Polaris kaynakları ve
https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge
https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner
https://api.reactrouter.com/v7/functions/react-router.useNavigate.html
https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.

## 31 Ekim — mevcut 07: Products erişimini kaldırma (kod/test onaylı)

Kullanıcı, onaylı Products kartında erişimi kendisi kaldırabilmelidir. Açık onay
bu somut kaldırma akışının kod/test/PR işidir; canlı revoke/yayın/merge değildir.
Başarılı kartta “Ürün erişimini kaldır” bulunur. s-button tone=critical,
commandFor=shopify-products-revoke-modal ile s-modal size=base padding=base açar.
Başlık: “Ürün erişimi kaldırılsın mı?”
Metin: “AdsTable'ın Shopify ürün ve varyantlarını okuma izni kaldırılacak. Ürün kimliği eşleştirmesi için yeniden izin vermeniz gerekecek. Mevcut kayıtlar silinmez.”
Birincil: “Erişimi kaldır” (s-button variant=primary tone=critical).
İkincil: “Vazgeç” (variant=secondary). Çarpı/Escape/Vazgeç: sıfır istek.
Onay niyeti kaydedilip modal afterhide tamamlanınca yalnız bir sunucu POST'u.
Yükleniyor: “Ürün erişimi kaldırılıyor…” (s-banner info); çifte işlem engellenir.
Sunucu sabit read_products için authenticated SDK scopes.revoke kullanır;
mağaza/kurulum/optional/required kapsam ve güncel izin kontrolü önce yapılır.
write_products veya required kapsamdan gelen erişim varsa kaldırılmış sayılmaz.
Başarılı native yanıt sonrası izin yeniden okunur; read_products erişiminin
kalktığı ve aynı kurulum doğrulanmadan başarı gösterilmez. SDK/okuma hatasında
otomatik tekrar veya alternatif yöntem yok; kart unknown olur ve yalnız açık
“Durumu kontrol et” okunur. Bu kontrol kaldırmayı tekrarlamaz. Hata metni:
“Ürün erişiminin kaldırıldığı doğrulanamadı. Durumu kontrol edin.”
Başarı: “Ürün erişimi kaldırıldı.” (s-banner success), ardından mevcut Connect
Shopify products görünür. Yeni izin sadece kullanıcı açıklamayı onaylarsa istenir.
Yenilemede sunucudan güncel permission state okunur; yerel başarı korunmaz.
Orders izni, provider bağlantıları, token, uygulama kurulumu ve tarihsel veri
silinmez/değiştirilmez. Mevcut ürün okuma guard'ları güncel kapsamı esas alır;
Orders'ın Products'a mevcut bağımlılığı korunur. Yeni Dataset/yazıcı yok.
Mobil/masaüstü aynı native bileşenlerdir; özel CSS/raw kontrol yok.
Boş/eksik izinde kaldırma eylemi yok; ağ hatası/malformed sonuç/yanlış mağaza,
stale callback/iptal/çift afterhide ve required/write alias negatif testleri gerekir.
Gerçek Shopify Admin masaüstü/en az320px mobil kabulü ve yayın ayrı onay bekler.
31Ekim2026 resmî kaynakları:
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
Kurulu SDK3.0.1 scopes.revoke ve GraphQL client kodu okundu: varsayılan retry0.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.

## 31 Ekim — Products İngilizce metin ve sessiz Settings dönüşü düzeltmesi

Ürün sahibi gerçek cihazda Vazgeç, kaldırma ve yeniden bağlanma sonucunu bildirdi:
Settings'e dönüldü, ürün erişimi ve kaldırma eylemi yeniden göründü. Bu somut
akış kanıtıdır; bütün masaüstü/mobil kabul matrisi tamamlandı anlamına gelmez.
Sahip geçiş mesajını tekrar görmek istemiyor ve eklenen Türkçe ürün metinlerini
reddetti. Kapsam yalnız yeni Products metinleri ve gereksiz çift durum gösterimidir.
Settings dönüşündeki bilgi banner'ı kaldırılır; mevcut native Settings kabuğu
geçiş boyunca kalır. Yeni yükleme/caption/toast metni eklenmez. Hata durumunda
“Could not return to Settings.” ve “Open Settings” korunur.
Birebir İngilizce Products metinleri:
- Product access approved / Remove product access
- Remove product access? / Remove access / Cancel
- AdsTable's permission to read Shopify products and variants will be removed. You will need to grant access again for product identity matching. Existing records will not be deleted.
- Removing product access… / Checking product access…
- Product access removed. (yalnız bir başarı banner'ı; üstte ikinci not-connected metni yok)
- Product access is not connected. (son kaldırma başarı banner'ı yoksa)
- Could not verify product access. Check status to continue.
- Could not verify that product access was removed. Check status to continue.
- Product connection is currently unavailable. / Check status
Mevcut Connect Shopify products etiketi korunur. Var olan s-page/s-banner/
s-badge/s-button/s-modal/s-link bileşenleri kullanılır; yeni stil veya property yok.
31Ekim kontrol edilmiş aynı resmî badge/banner/modal/button kaynakları geçerlidir.
OAuth/grant/revoke/return intent, sahiplik, callback, izin, scope, provider ve DB
kodları değişmez. Kod/test/PR hazırlanır; yayın/merge ayrıca açık onay ister.
Gerçek ekranda sessiz dönüş ve İngilizce metin kabulü henüz bekler.

## 31 Ekim — mevcut07: Orders dönüş/durum/kaldırma kullanıcı akışı

Ürün sahibi1000070135/136 görüntülerinde Orders onayından sonra Funnel'a dönüş
ve statik Connect Shopify orders düğmesini bildirdi; kod/test/PR düzeltmesini
somut olarak onayladı. Yayın, native tekrar ve merge bu onayın dışındadır.
Aynı sabit /settings dönüşü, aynı mağaza/sekme/10dk/tek kullanım güvenliği
Orders için bağımsız anahtarla genişletilir. Geçiş mesajı/banner/toast yoktur.
Settings bir native kapsam okumasıyla Products ve Orders durumlarını ayrı üretir.
Orders raw izin durumu uygulamanın Products önkoşulundan ayrıdır: Orders grant'ı
raporlama/Overlap/Orders veri erişimi aktivasyonu değildir. Mevcut okuyucu guard'ları
ve Products önkoşulu değişmez. İlk bağlama Products onaylı değilse başlatılamaz;
mevcut Orders izni Products kaldırılmış olsa da görünür/kaldırılabilir kalır.

Birebir durum/eylem metinleri (tamamı İngilizce):
- Order access approved / Remove order access
- Order access is not connected. / Connect Shopify orders
- Product access is required to connect orders.
- Checking order access… / Removing order access…
- Could not verify order access. Check status to continue. / Check status
- Could not verify that order access was removed. Check status to continue.
- Order connection is currently unavailable.
- Order access removed. (tek sonuç; aynı anda not-connected metni yok)
Modal: Remove order access?; body: AdsTable's permission to read Shopify orders and purchased products will be removed. Order-based features will need access again. Product access and existing records will be kept.
Primary: Remove access; secondary: Cancel. Native s-modal base/base, s-paragraph,
s-button primary/critical ve secondary, s-banner info/success/critical, s-badge
success; mevcut native s-stack içinde Products'tan ayrı Order bölümü/akışı.
Cancel/Escape/çarpı sıfır istek. Confirm niyeti aynı mağaza için afterhide sonrası
bir kez tüketilir. İki modal aynı anda açılmaz; bekleyen grant/revoke sırasında
yeni eylem başlatılmaz. Belirsiz sonuçta otomatik retry yok; Check status yalnız okur.
Başarı için authenticated sabit read_orders optional/not-required/no-write alias
önkoşulları, bir native revoke, fresh aynı mağaza/AppInstallation/kurulum okuması
ve diğer tüm grant'ların aynen korunması gerekir. Products/native providerlar,
credentials, config ve geçmiş veri silinmez. Yeni DB/Dataset/Overlap yazımı yok.
Bağlı durum Connect'i kaldırır; kaldırılmış durumda yeniden Connect gösterilir.
Yerel dönüş kaydı/grant bildirimi native izin kanıtı değildir. Stale/yanlış mağaza
sonuçları, malformed/transport hataları ve native iptal başarıya çevrilemez.

31Ekim2026 kaynakları: Shopify scopes query/request/revoke ve kuruluSDK3.0.1,
https://shopify.dev/docs/api/shopify-app-react-router/latest/apis/scopes
https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/appRevokeAccessScopes
Önceden31Ekim doğrulanmış native modal/button/badge/banner kaynakları aynıdır.
Kabul: sentetik SDK ile gerçek Settings loader/action/hook/modal olayları test;
Products regresyonları; typecheck/build/CI. Sonrasında ayrı yayın onayı ve gerçek
Shopify Admin masaüstü/en az320px mobil owner grant/cancel/revoke/reconnect kabulü.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.

## 31 Ekim — Products/Orders dönüşünde ana sayfa parlaması

Owner her iki yeniden bağlanmada da önce ana ekrana gitmeye çalışıp Settings'e
döndüğünü bildirdi. Mevcut effect yönlendirmeyi doğruluyor ancak SSR/ilk client
çiziminde Outlet/Funnel henüz engellenmiyordu. Bu, onaylı sessiz Settings dönüşünün
eksik kalan görüntü düzeltmesidir; native OAuth hedefi/değişken/scope/SDK değişmez.
Ana uygulama yolu için owner/location-key bağlı dönüş kararı verilmeden Outlet
çizilmez; root SSR ve ilk hydration aynı boş içerikle başlar. Niyet varsa /settings
replace sürerken de Outlet/Funnel çizilmez. Niyet yoksa normal ana sayfa açılır.
/settings ve /ad-analysis doğrudan içerik gösterir. Yeni mesaj/toast/başlık/stil yok.
Dönüş hata metni ve Open Settings mevcut native bileşenleriyle korunur. Effect
tekrarında yönlendirme bir kez yapılır; eski navigation hatası yeni rotayı etkilemez.
Bedel: normal ana sayfanın ilk içeriği client dönüş kontrolünden sonra gösterilir;
SSR'de ana sayfa içeriği geçici olarak tutulur. Storage yok/yanlış/eski niyette
normal ana sayfa açılır; izin verilmiş varsayılmaz. Products/Orders niyet ve native
izin okuma/kaldırma davranışı korunur. İzin veya yeni provider mutation yapılmaz.
Kod/test/PR kapsamında hazırlanır; yayın ayrıca açık onay bekler.
31Ekim resmî kaynak: https://react.dev/reference/react/useEffect (effect sonrası
paint ve effect'in SSR'de çalışmaması); kurulu React18.3.1 ve Router7.18.2 korunur.
Gerçek SSR testinde root Outlet/Funnel yokluğu, ilk effect öncesi client çizimi,
normal ana sayfa ve iki izin dönüşü, mesaj yokluğu ve hata/no-retry doğrulanır.
Native masaüstü/en az320px mobil parlamasız geçiş kabulü bekler;07 kapanışı yok.

## 31 Ekim — mevcut07: Shopify App Bridge izin penceresi; dönüş yamalarının kaldırılması

Ürün sahibi kök neden araştırmasındaki doğru öneriyi kabul edip uygulamayı açıkça
onayladı. Kapsam Products/Orders izin isteme yöntemini resmî client App Bridge'e
almak, sunucu kontrolünü korumak ve sonradan eklenmiş root/Settings dönüş ve
gizleme kodlarını kaldırmaktır. Yayın/native izin denemesi/merge onayı değildir.
31Ekim resmî belge iki yöntemi ayırır: React Router scopes.request tam sayfa
Shopify Admin'e yönlendirir; shopify.scopes.request çalışan uygulamanın üzerinde
izin penceresi açar, sayfayı yönlendirmez. KuruluSDK3.0.1 de incelendi: sunucu
request helper client_id/scope/optional_scopes ile install sayfasına gider;
Settings hedefi taşımaz. Çalışan üç provider callback'i Settings'i açıkça hedefler.

Akış: mevcut açıklama modalında Connect → native afterhide → authenticated sabit
Products/Orders ön kontrolü (release, mağaza/aktif kurulum, taze mevcut grant,
Products önkoşulu ve deploy edilmiş optional handle) → zaten granted ise kart;
eksikse scope_request hazırlığı → yalnız aynı mağza/istek için App Bridge
shopify.scopes.request([read_products veya read_orders]) bir kez → granted-all veya
declined-all sonucunda aynı mağza/kurulum/AppInstallation için bir sunucu readback →
kart. App Bridge sonucu hiçbir zaman tek başına grant veya veri yetkisi değildir.
Ön kontrol kimliği korunur; browser farklı scope, provider veya arbitrary hedef
seçemez. App Bridge yok/reject/bozuk sonuç/owner değişimi: unknown, otomatik
tekrar veya sunucu redirect fallback yok. Açık Check status yalnız güncel izni okur.
Cancel açıklaması sıfır istek; Shopify decline mevcut sayfada eksik durumu gösterir.
Mükerrer afterhide/click bir native pencere açar. İstek sürerken view kapanır veya
owner değişirse eski sonuç kartı değiştiremez ve yeni native istek başlatamaz.

UI birebir mevcut İngilizce copy/component/critical removal davranışıdır. Yeni
banner/toast/dönüş ekranı yok. Standart authenticated AppProvider/Outlet her rota
ve SSR'de geri gelir. SessionStorage dönüş modülü ve ilgili deklarasyonu, owner/key
root gating, /settings replace ve gizleme kodları kaldırılır; başka amaç için
sessionStorage veya yeni cookie/return parametresi eklenmez. Server requestProducts/
requestOrders redirect yöntemleri kaldırılıp prepareProducts/prepareOrders olur.
Mevcut permission query/revoke ve public Products/Orders kartları korunur. Meta,
Google/Klaviyo, native config/scopes, credentials, DB/Dataset değişmez.

Test: gerçek Settings action JSON hazırlığı/401'e redirect icat etmeme; ön kontrol
negatifleri ve tek scope; App Bridge granted/declined/reject/unavailable/bozuk/owner/
unmount/duplicate sonrası native+readback sayıları; server readback eski kurulum/
AppInstallation ve foreign binding reddi; Products/Orders revoke regresyonları;
root SSR'nin tekrar gerçek Outlet üretmesi; normal sayfalara dönüş yaması olmaması.
Masaüstü ve en az320px native owner modal/iptal/başarı/kaldırma/reconnect kabulü
ayrı yayın onayından sonra bekler. Kod testleri bu kabul yerine geçmez.
Kaynaklar31Ekim2026:
https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes#request-new-access-scopes-dynamically
https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api
Mevcut native modal/button/badge/banner kaynakları ve pinli Polaris2.0 değişmez.
07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımıdır.
## 31 Ekim — mevcut07: Google eksik izin dönüşünün Settings'te korunması

Ürün sahibi yalnız bu düzeltme ve testlerini onayladı; yayın/native tekrar/merge
yoktur. Google'ın kullanıcıya Ads+Merchant seçimini açtığı owner ekranında görüldü;
yalnız Ads seçildiği bildirildi. Canlı işlem failed/PROVIDER_EXCHANGE_FAILED,
bağlantı disconnected/version42 ve credential yok; bu genel kayıt exact dönen
scope'un kanıtı değildir. Kodda doğrulanmış pending_permissions sonucu callback'te
pending'e indirgeniyor; Settings durable hesap seçimi olmayınca Not connected'a
iniyor. Eksik mesajın bu kesin kaynak kusuru düzeltilir.

Akış/durum: Runtime yalnız onaylı finalization sonrasında permissions_incomplete
üretir. Callback bunu Google'a özgü google_status=permissions_incomplete olarak
sabit dönüş hedefine taşır. Bu parametre grant/credential/hesap yetkisi değildir;
Settings önce mevcut sunucu durumunu okur. Bağlı veya pending gerçek hesap varsa
bu kanıt önceliklidir; yalnız eksik/disconnected durumda incomplete görünümü olur.
Yenilemede aynı nonsecret callback durumu görünür kalır. Hata/cancel/tam izin
sonuçları korunur; ilk çizim/mount otomatik Connect/Check status başlatmaz.

Birebir Google kartı: s-banner tone=warning heading="Google setup is incomplete";
s-paragraph="Both Google Ads and Merchant Center access are required. Resume setup and allow both permissions to finish connecting.";
s-button="Resume setup" (disabled busy veya yayın kapalıysa). Buton yalnız mevcut
Google açıklama modalını açar; Connect ve native afterhide sırası aynıdır. Ayrı
katalog seçimi, ek modal/adım, otomatik native istek, yeni stil/HTML control yoktur.
Masaüstü/mobil aynı Google section/stack; Shopify/Meta/Klaviyo kartları değişmez.
İlk normal Not connected, tam izin hesap seçimi, bağlı, iptal ve genel hata eski
yolunda kalır. Genel callback hatası eksik izin diye etiketlenmez.

Safe logger mevcut tek sink kullanır; Google callback için sabit intent ve sınırlı
allowlist kodu, eksik izin sonucu için sabit OAUTH_IDENTITY_SCOPE_NOT_GRANTED;
ham error/token/state/scope/hesap/mağaza yok. Callback log teslim hatası dönüşü
bozmaz. İşlem kaydı veya token politikası/migration/API scope değişmez.
Test: gerçek callback loader→gerçek Settings loader→component dalı; tek Ads ve
yalnız Merchant runtime regresyonları; pending_permissions/cancel/tam izin/error,
eski incomplete parametresinin bağlı/pending yetkiyi ezmemesi, yanlış parametrenin
Connected yaratmaması, kullanıcı tıklayana kadar sıfır request, İngilizce copy ve
Google-only yerleşim, hostile error log gizliliği. Native desktop/min320px kabulü
ayrı yayın onayından sonra owner'dadır; kod testi görsel PASS değildir.
31Ekim2026 kaynaklar: https://developers.google.com/identity/protocols/oauth2/web-server ;
https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner ;
https://shopify.dev/docs/api/app-home/latest/web-components/actions/button .

## 31 Ekim — mevcut07: canlı başlangıçtan seçili OAuth migration provası

Ürün sahibi eksik rolün salt okunur denetiminden sonra yalnız düzeltme ve izole
testleri açıkça onayladı. Canlı migration/yayın/merge/native retry onayı yoktur.
Önceki onaylı canlı deneme ilk dosyada 42704 ile durdu; geri alma kontrolünde
atomik yazar yok, receipt kolonları0, rol yok bulundu; ikinci dosya/yayın denenmedi.
Rol 20261020092429 refresh altyapısına aittir. OAuth onu yalnız REVOKE listesinde
anıyordu; bu dosya rol oluşturmaz veya ona yetki vermez. Henüz uygulanmamış
20261028164208 içindeki diğer REVOKE hedefleri korunur; koordinatör için iki
fonksiyondaki REVOKE yalnız rol varsa çalışır. Runtime-only grant aynı kalır.

F01'in önceki staged/full yolları bütün pending dosyaları da kuruyordu; bu nedenle
canlı40 + yalnız iki dosya yolunun geçmesi önceki PASS'ten çıkarılamaz. Yeni üçüncü
boş GitHub runner veritabanı 38historical + 2uygulanmış forward dosyasını, sonra
yalnız atomic_stage ve reconnect'i gerçek BEGIN/COMMIT sınırlarıyla kurar. Refresh
rolü/tabloları oluşmamalıdır. Gerçek envelope/SQL CAS, seçimin korunması/yeniden
istenmesi, eski sürüm/tekrar/eksik izin reddi, geç hata geri alma ve yetkiler aynı
probe ile sınanır. Ayrı rollback dalında koordinatör önceden vardır; default
EXECUTE verilmiş olsa da iki fonksiyondan kaldırıldığı doğrulanır. Fixture,
geçici üyelik ve test rolü geri alınır. Native HTTP ve canlı bağlantı yoktur.
Migration fingerprint yalnız pending dosyada yenilenir; applied/historical SQL
değişmez. Bu testlerin sonucu canlı uygulama veya 07 kapanışı değildir.
31Ekim2026 resmî kaynaklar: https://www.postgresql.org/docs/17/sql-revoke.html ;
https://www.postgresql.org/docs/17/sql-do.html ;
https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html .

## 31 Ekim — mevcut07: açık Connect ile yeniden bağlanma ve sağlayıcıya ait sonuç

Ürün sahibi salt okunur teşhisten sonra kod, migration dosyası ve izole test hazırlığını açıkça onayladı. Canlı migration, yayın, provider-native deneme ve merge bu onaya dahil değildir. Canlıdaki tek kayıt kontrolünde aktif adstable-development mağazasının Google kaydı disconnected/version42 bulundu. Başlangıç kapısı ve atomik dönüş fonksiyonu disconnected durumunu reddediyordu. Asıl hata route catch içinde kayıtsız unknown'a çevriliyor; ortak feedback host'u Shopify bölümünün hemen altında bulunuyordu.

Kullanıcı sonucu: mevcut açıklama Connect → afterhide → aynı bağlantı/sürümle yeni OAuth → tam native izin/hesap kanıtı → mevcut ayrı hesap ve Reporting Account adımı. Yeniden bağlanma eski reklam hesabını, kataloğu veya credential'ı kendiliğinden seçmez. Disconnected kayıtta credential yok ve kaldırılma zamanı mevcut olmalıdır; disconnect_pending/unknown kapalıdır. Yeni onaydan önce yeni grant veya Connected yoktur. Callback ve atomik commit aynı connection/version'u doğrular; stale/yarış/replay ve kısmi izin engelleri korunur. Mevcut stage_provider_account_selection disconnected kaydı yeni hesap seçimine alabilir; SQL adayındaki engel bu güvenli yola hizalanır. Bağlı kayıt için scope/hesap downgrade koruması aynıdır; kaldırılmış grant listesi yeni onay için yetki değildir.

UI: mevcut s-banner (critical/info/warning heading) ve s-button kullanılır. Her sağlayıcının sonucu ve Check status kendi s-section/s-stack içinde gösterilir. Shopify Products/Orders kartlarının bağımsız onayları ve kaldırma davranışı değişmez. Kopya korunur: "We could not confirm the result. Check the connection status before starting again." ve "Check status". Otomatik retry/reconnect yok; belirsiz işlemden sonra yalnız açık durum okuması kalır. Modal host'ları tek kalır; afterhide sırası ve 1–3 reklam hesabı/tek Reporting Account korunur. Ham action control, CSS/renk, yeni rota veya katalog seçimi yoktur.

Güvenli log: yalnız sabit olay/feature/intent, allowlist hata kodu ve doğrulanmış requestId. Raw error/message, SQL detail, scope URL/state, token/credential, hesap/mağaza veya payload loglanmaz. Client'a aynı unknown cevabı döner. Native Response kimlik doğrulama sınırında aynen korunur.

Test: disconnected başlangıç+callback+CAS; boş/bozuk cleanup kanıtı/pending/foreign owner/version reddi; atomik SQL başarı/stale/replay/eksik kapsam/rollback; gerçek Settings provider kartında feedback ve tekrar başlatmama; native Response ve güvenli hata logu. Native desktop/min320px kabulü ileride owner'dadır; izole testler native kabul değildir. SQL yalnız dosyada hazırlanır, canlıya uygulanmaz.

Migration önkoşulu: 20261028164208 atomik yazar ve dört receipt alanı mevcut olmalı; yoksa yeni migration fonksiyonu değiştirmeden durur. Lineage bu önceki dosyayı hâlâ pending gösterdiğinden canlı önkoşul mevcut sayılmaz. İleride ayrı onayla doğrulanıp gerekirse yalnız gerekli önkoşul dosyası değerlendirilir; bütün pending migration'lar topluca uygulanmaz.

31Ekim resmî kaynaklar: https://www.postgresql.org/docs/17/sql-createfunction.html ; https://supabase.com/docs/guides/database/functions ; https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner ; https://api.reactrouter.com/v7/functions/react-router.useFetcher.html . Pinli Polaris2.0 bileşenleri/type değişmez.07 açık;15 başlamadı;22 duraklatılmış;23 Dataset yazımı.
