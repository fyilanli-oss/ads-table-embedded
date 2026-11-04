> 4 Kasım 2026 — onaylı canlı bağlantı işleri: PR320 main9fdb49f ile birleşti;3968 test ve üç izole ortamda39 ham kayıt senaryosu geçti. Owner iki dar rolün giriş/bağlantısını, ayrı kaynak şifreleme ve sunucu çağrı anahtarlarını, hazır token yenileme SQL'inin canlı uygulamasını açıkça onayladı. Hazır20261103221715 SQL'i Supabase tarafından20261104082306 sürümüyle uygulandı; içerik SHA256 birebir aynı, önceki83 ledger kaydı değişmedi, toplam84. Yenileme fonksiyonu adstable_owner; yalnız runtime EXECUTE, public/coordinator EXECUTE yok. İki yeni Secret ve aktif sürüm Production'da doğrulandı; değerler kayda alınmadı. İki dar rol hâlâ NOLOGIN; Connector gerçek transaction-pooler Host alanını sunmadığından kullanıcıdan yalnız gizli olmayan Host istendi. Yeni rol parolası/URL oluşturulmadı, adres indeksi tahmin edilmedi. Mevcut izinler/anahtarlar korunur. Yayın, Google isteği, saklama/kota politikası, saatlik aktivasyon ve rapor yazımı yapılmadı;2. paket tamamlanmadı. Önceki83/prepared ifadeleri tarihsel kayıttır; güncel kanıt docs/evidence/EO05_GOOGLE_LIVE_CONNECTIONS_2026-11-04.json.

> 4 Kasım 2026 — 1. iş / tarayıcısız tek ham kaynak kaydı: owner yalnız kod, izole test ve tek PR kapsamını onayladı. Mevcut Vercel sunucusunda yalnız ayrı Secret ile çağrılan POST /internal/google/raw-capture ve aynı çekirdeğe bağlı komut mevcut runtime kurulum kaydından Google-only private yetki üretir; tarayıcı/Console/Shopify oturumu veya sahte ID-token/Admin doğrulaması istemez. Mevcut admission, fresh entitlement, kota, token yenileme, native Google okuyucu ve şifreli kaynak deposu kullanılır. Bilinen kayıt sonrası exact receipt tekrar okunur; unknown yazma tekrarlanmaz. Yalnız ham kaynak rafında durulur: kurallar boş, kimlikler unresolved; ürün eşleme, saatlik aktivasyon, rapor/Dataset yok. İki default-closed plan ayarı ve ayrı ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET yalnız şemadır; değerler/saklama süreleri/anahtarlar/canlı erişim hazırlanmadı. Yeni tablo/SQL migration/grant/rol yok; kurulu83 geçmişi korunur. F01 içinde13 gerçek SQL senaryosu ve şifre çözerek sayfa doğrulama; native HTTP sentetik. Canlı çağrı/ayar/SQL, merge ve yayın ayrı onaylı; 2. paket açık. HTTP gövdesi yalnız operationId; production/origin/path/auth ve 1024-byte gövde sınırı işten önce doğrulanır. Kaynak route maxDuration120 kod ayarıdır; dağıtım/canlı ayar yetkisi değildir. Yeni ekran veya ek hosting kurulmaz.

> 3 Kasım 2026 — Google refresh içinde otomatik token yenileme: owner kod, migration dosyası, izole test ve tek PR kapsamını açıkça onayladı. Geçerli token yeniden kullanılır; süresi dolmuşsa mevcut mekanizma bir kez yeniler ve aynı iş ham veri okuma/şifreli kayıt yoluna devam eder. Aynı hesap/izin korunurken credential, yenileme kanıtı ve exact iş/kota bağları tek transaction içinde taşınır; kota sınırları/epoch ve kuyruk yaşı sıfırlanmaz. Belirsiz sonuçta tekrar veya veri çağrısı yok. Yeni tablo, Settings kontrolü, Console, OAuth ekran değişikliği yok. Yeni migration yalnız prepared kayıt; eski82 ve43+39 geçmişi değiştirilmez. Canlı SQL/çağrı, merge ve yayın ayrı onaylı kalır; 2. paket açık. Kullanıcının son hedefi saatlik ham veri alma/saklama zinciridir; tek başına0 sonucu tamamlanma ölçütü olarak sunulmaz. Resmî kontrol2026-11-03: Google OAuth refresh ve PostgreSQL17 row locking/CREATE FUNCTION.

> 3 Kasım 2026 — 2. paket / yalnız token yenileme: owner açık kod/test/PR onayıyla mevcut Merchant sunucu girişine ayrı, varsayılan kapalı renew_credential amacı eklenir. Mevcut identity_v1 refresh + atomik şifreli credential/receipt kaydı kullanılır; hesap keşfi veya Reporting Account kaydı çalışmaz. Tek çağrıda en fazla bir native refresh; SQL CAS eski/tekrar kaydı engeller, dağıtık native exactly-once iddiası yoktur ve bağımsız eşzamanlı çağrı gönderilmez. Belirsiz sonuç tekrar edilmez. UI, SQL migration ve canlı config değişikliği yok; canlı yenileme/merge/yayın ayrı izinli. 2. paket açık; 3. paket başlamadı. Resmî kaynak kontrolü 2026-11-03: https://developers.google.com/identity/protocols/oauth2/web-server#offline

## 3 Kasım — Google ikinci paket: bağımsız Merchant bağlantısı okuma girişi

Owner yalnız bu eksik sunucu girişi, kod/test ve PR hazırlığını açıkça onayladı.
Mevcut authenticated POST /settings/google-live-evidence içinde ayrı
x-adstable-google-merchant-discovery:v1 header ve google_merchant_links_v1 modu
kullanılır. İstemci yalnız mode + operationId gönderir; hesap/Merchant/kimlik
gönderemez. UI, OAuth, izin, scope, hesap seçimi ve callback değişmez.

ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN yoksa giriş kapalıdır. Bu ek geçici
sunucu ayarı mevcut altı çalışma ayarına ilavedir; secret içermez, exact
workspace/generation/shop/connection/version/credential/selection/Reporting
Account ve en çok15dk expiresAt taşır; Merchant ön bilgisi istemez.
Mevcut salt okunur Shopify resolver (tek Admin denemesi), mevcut authority RPC
ve sunucu token kasası kullanılır. Kimlik/token drift sonrası sonuç yayımlanmaz.
Secret/token veya ham provider cevabı response/loga taşınmaz.

Yalnız mevcut Google Ads v25 product_link sorgusu, tek HTTP ve tek sayfa;
20s toplam, DB/vault/body5s, decoded1MiB,1000 ilişki üst sınırı. Redirect/retry/
otomatik token refresh yok. Tam boş ilişki cevabı Merchant bağı gözlenmedi demektir;
ürün0 kabulü değildir. Birden çok Merchant ID dönebilir; otomatik seçim veya
Merchant kota hesabı eşitliği çıkarımı yapılmaz. Kısmi/hata/stale/abort yanıtında
ID listesi null kalır. Tarih penceresi/00:00 bu keşif için gerekmez.

Bu salt okunur giriş job/kota/source/Dataset yazmaz. Ayrı istekler/processler
arasında durable exactly-once garantisi iddia edilmez; otomatik çağıran/retry yok.
Canlı kullanım tek açık onaylı invocation olarak yürütülüp kısa plan kaldırılır.
Gerçek hesap sorgusu/config/merge/deploy yapılmadı ve ayrıca onay bekler.
İkinci paket kapanmadı; üçüncü başlamadı; yeni paket veya saklama kararı yok.
47 yeni izole HTTP-handler güvenlik testi hazırlanmıştır; zorunlu CI sonucu PRdadır.
Resmî kontrol2026-11-03: Google v25 product_link, REST search ve Shopify
authenticate.admin dokümanları. Tam kayıt:
contracts/a6-eo-implementation-master-v1.json#Step15_Google_package2_Merchant_discovery_entry_2026_11_03.

## 3 Kasım — Google paket2/3: salt okunur canlı ön kontrol

Owner Supabase rol/bağlantı/kota metadata'sı ve ortam ayarlarının yalnız varlığı
için açık izin verdi. Kaynak main11e075a95ff692897df1099002ad68e18b5c8f1f; PR315 kodu
birleşti,3.833 test ve üç ortamda10'ar yeni SQL senaryosu başarılı.

Güncel canlı Google bağlantısı disconnected(version83), credential yok, aktif
Reporting Account bağı yok; saklanan3 hesap inactive. Bu durum boş hesabın
başarılı0 cevabı değildir. Google/koordinatör rolleri NOLOGIN; geniş yetkiler
false. İş/kaynak/kota/policy/route sayıları0; admission budget/bounds ve queue
kontrolleri null. Altı yeni source/acceptance ortam anahtarı yok. Mevcut
runtime/Google/Partner anahtar adları Production'da var; değerleri açılmadı.

Ayrıntılı rol/RPC/definition profil sorgusu tek denemede araç hatası döndürdü;
hata kodu/gerekçesi teyit edilmedi, sorgu tekrarlanmadı ve alternatif rota yok.
Yerel inceleme, sorgu oluşturucunun ikinci $1 yer tutucusunu değiştirmediğini
doğruladı. Düzeltilmiş salt okunur sorgu kanıtta hash ve0 unbound parameter ile
hazırdır; çalıştırılmadı. Bu alan doğrulanmış sayılmaz; eksik grant/rol arızası yoktur
diye de var diye de çıkarım yapılmaz.

Kanıt:docs/evidence/EO05_GOOGLE_PACKAGE2_LIVE_PRECHECK_2026-11-03.json. Kayıt yalnız rol özellikleri,
varlık/sayı/durum ve env adlarıdır; müşteri/hesap/credential kimlikleri, domain,
ciphertext veya secret içermez. Canlı SQL/config/role/login/deploy/native işlem
yapılmadı. Sonraki gerçek adım owner'ın mevcut Settings Google bağlantısını
kurup Reporting Account seçmesidir; Codex OAuth çalıştırmadı. Bu eylem ve
sonraki kontrol/config kendi somut onay kapılarında kalır.2 tamamlanmadı;3
başlamadı; üç ana paket/alt paket yok ve gerçek0 sonrası saklama sırası korunur.

3 Kasım ek doğrulama: shared runtime/vault salt okunur beklemeleri de5s ile sınırlı;
geç veya abort edilmiş yanıt akışı ilerletemez. Paused finish sonrası hesap/yetki
son kez okunur; sonradan drift başarılı0 sayılmaz. HTTP auth hataları sanitize
edilir; yeni deneme veya coordinator açılışı yapılmaz.

## 3 Kasım — onaylı kod bağlantısı güncellemesi

Hazırlık PR314 merge3d80b93 ile teslim edildi; owner aynı2. paketin
başlatma/koordinatör/kapanış kod ve izole testlerini ayrıca açıkça onayladı.
Aşağıdaki ilk inceleme tarihsel durumdur; bu bölüm yeni kod durumunu kaydeder.
Canlı ayar, SQL, secret veya gerçek provider çağrısı yapılmadı;2 tamamlanmadı.

Uygulama: app/lib/refresh/google-acceptance-server.server.js ve request.server.js;
mevcut POST /settings/google-live-evidence içinde yalnız
x-adstable-google-acceptance:v1 header'ı yeni moda yönlenir.
Content-Type application/json; gövde yalnız mode=step15_google_zero_acceptance ve
operationId'dir. Client plan/ID/claim/receipt/caller gönderemez. Kapalı veya
geçersiz giriş yeni auth/SQL/native işlemi başlatmaz. Açık mod mevcut authenticated
Shopify resolver'ını kullanır; Admin identity sorgusu tries:1 alır. JSX/copy/modal/
buton veya eski report mode değişmedi; yeni görsel kabul iddiası yoktur.

ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED tam true olmalı.
ADSTABLE_GOOGLE_ACCEPTANCE_PLAN strict JSON: operationId,workspaceId,installGeneration,
shopId,shopDomain,accountId,connectionId,connectionVersion,credentialId,selectionId,
merchantId,merchantQuotaAccountId,merchantBindingEpoch,window ve expiresAt.
En çok15 dakika geçerli olabilir; tek gün ve exact sunucu bağları zorunludur.
Bu isimler yalnız şema tanımıdır, canlı değer veya uygulama yetkisi değildir.

Yeni coordinator URL/timeout adları:
ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL ve
ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS. Exact mevcut
adstable_refresh_coordinator.project-ref kullanıcı/proje/TLS/pooler kuralları;
tek bağlantı,1–5000ms. Sadece17 mevcut RPC kabul edilir; ek SQL/grant/rol kurulmaz.
Mevcut rolün broader server-side SQL yetkisi runtime veya Google rolüne taşınmaz.

Gerçek preflight SQL CAS kullanılır; sabit operation job ID aynı işi paused
sonrasında bile yeniden üretmez. Fresh entitlement + native reader sonucu ardından
role drain, tekrar yetki kontrolü ve response_received doğrulanır; yalnız paused
finish vardır. Unknown commit/finish sonucu tekrarlanmaz. Hold/expiry/permission/
partial veya stale durum başarılı0 sayılamaz. Kaynak gözlemi rapor sayfasına
çevrilmez, Dataset aşaması ilerletilmez.

Önceki öneri sınırları kodda sabitlendi. İlave tüm iş rezervi: requests5,dbWrites64,
connections3,rows1000,bytes1048576. Üç Google HTTP'ye ilave Partner ve Shopify kimlik
trafiği vardır; UI/report/native query sayısı uydurulmaz. Canlı job bütçeleri ve
quota policy'leri halen eksik/güncel doğrulanmamış durumdadır.

61 odaklı kontrol geçti;26 yeni kabul testi vardır. F01'e gerçek token kasası ve
iki gerçek rolü kullanan10 senaryo eklendi:0/tekrar,dolu,403,kısmi,yanlış rol,eksik
context,süresi dolmuş token,admission cevabı kaybı,finish cevabı kaybı,sonradan hold.
Fiziksel HTTP/credentials sentetik kalır. Zorunlu CI sonucu PR'da doğrulanır.

# Google 2. paket — kontrollü canlı sınama hazırlığı

Tarih: 3 Kasım 2026. Kaynak main: `8325670b6518b3cb7c639dc0f99ceb7b4e6c5b20`.
Bu kayıt yalnız onaylı inceleme ve hazırlıktır. Canlı SQL, secret okuma/üretme,
ortam değişikliği, provider isteği, runtime kodu veya yayın yapılmadı.

## Amaç ve mevcut durum

Üç ana paket vardır; alt paket eklenmedi. 1. paket [PR #313](https://github.com/fyilanli-oss/ads-table-embedded/pull/313)
ile birleşti. 2. paket henüz tamamlanmadı. 3. paket gerçek boş Google hesabında
tam başarılı isteğin 0 kayıt döndürmesini doğrulayacak. Hesapta ürün üretilmeyecek.
Saklama süreleri bu kabulden sonra kararlaştırılacak; Meta/Klaviyo ortak temeli kullanacak.

Hazır olanlar:

- `app/lib/refresh/google-read-runner.server.js`: tek kullanımlık gerçek okuyucu
  bileşimi; dar rol, iş/kota/yetki kontrolleri, toplam yanıt/süre sınırları ve
  başarılı 0 / hata ayrımı. Gerçek ürün içeriğini sonuç veya loga taşımaz.
- `app/lib/database/google-source-postgres.server.js`: yalnız mevcut 16 RPC'ye
  karşılık gelen sorgular; her işlemde exact rol/profil doğrulaması, tek bağlantı,
  TLS sertifika doğrulaması ve transaction içi zaman aşımı.
- Var olan iş kabulü, güncel yetki kontrolü, token kasası ve kota şeması.
  Yeni depo, tablo veya kaynak saklama anahtarı gerekmiyor.
- 1. pakette 3.807 test ve üç ayrı SQL provasının her birinde 15 yeni senaryo
  geçti. Provider HTTP/credentials sentetikti; gerçek 0 kabulü değildi.

## Kanıtı olan durum ile henüz bilinmeyenler

| Gereksinim | Elde bulunan kanıt | Canlı çalışmadan önce doğrulanacak |
|---|---|---|
| Google DB rolü | 3 Kasım kurulum kanıtında exact profil, NOLOGIN ve parola yok | Yeni salt okunur profil kontrolü; sonra ayrı onaylı sınırlı giriş hazırlığı |
| Koordinatör | Aynı kanıtta `adstable_refresh_coordinator` NOLOGIN; SQL/repository hazır | İş kabulü için güvenilir operasyon bağlantısı; Google rolüne koordinatör yetkisi verilmez |
| İş/kota ayarları | Kurulum anında iş, kaynak ve kota politikası sayıları 0 | Güncel metadata ve mevcut interaktif rezervlerle çakışmayan tek hedefli ayarlar |
| Google hesap/credential | Kod, güncel Reporting Account ve credential ID'yi SQL'den yeniden okuyor | Gerçek seçili hesap, connection/version/selection epoch ve kimlik profili; fotoğraf veya fixture ID'si kullanılmaz |
| Merchant hedefi | Kod gerçek Ads/Merchant ilişkisini önce ve sonra okuyor | Yetkili metadata ile hedef ve gerçek kota hesabı; bu iki ID'nin eşit olduğu varsayılmaz |
| Google credential | Mevcut token kasası var | İlgili credential'ın açılabildiği, gerekli scope'ları taşıdığı ve süresinin yeterli olduğu; token dışarı çıkarılmaz |
| Çalıştırma girişi | Yeni runner yalnız iç sunucu fonksiyonu | Gerçek authenticated caller + gerçek admitted claim + fresh entitlement ile tek seferlik başlatma bağlantısı |

Kurulum kanıtı: `docs/evidence/EO05_GOOGLE_SOURCE_ROLE_INSTALLATION_2026-11-03.json`.
Buradaki tarihsel durum yeni bir canlı kontrol yapılmış gibi sunulamaz. Bu inceleme
canlı veritabanına veya ortam değişkenlerine bakmadı; eksik/süresi dolmuş credential
ya da eksik Merchant ilişkisi şimdiden varmış gibi ileri sürülmez.

## Bağlantı ve kimlik bilgisi gereksinimleri

Google okuyucu için mevcut env adları:

- `ADSTABLE_GOOGLE_SOURCE_DATABASE_URL`: exact kullanıcı
  `adstable_google_source_runner.podpwkrpmjiksskxhwsu`; gerçek Connect ekranından
  alınmış `aws-[INDEX]-eu-central-1.pooler.supabase.com:6543/postgres` adresi,
  yalnız `sslmode=require`. Host indeksi tahmin edilmez.
- `ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS`: öneri `5000`; mevcut doğrulayıcı 1–30000 ms
  kabul eder. Havuz üst sınırı 1 ve güvenilir CA doğrulaması mevcut kodda sabittir.
- `GOOGLE_ADS_DEVELOPER_TOKEN`: var olan sunucu secret'ı kullanılacak; koda/loga/
  dokümana taşınmayacak. Mevcudiyeti ve yetkisi bu hazırlıkta doğrulanmadı.

`tokenVault` ayrı yetkili bağımlılıktır. Google rolünün sorgu listesinde
`token_vault_runtime_guard` veya `load_provider_credential_envelope` yoktur.
Dolayısıyla bu rol üzerinden token kasası kurmak çalışmaz; bunun için role grant
eklemek de önerilmez. Mevcut authenticated runtime'ın `providerTokenVault` nesnesi
kullanılır. Mevcut `ADSTABLE_RUNTIME_DATABASE_URL`,
`ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION` ve kullanılan
`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V*` değerleri korunur; yeni anahtar/rotasyon
veya credential kopyalama yapılmaz. Yeni kaynak saklama anahtarı istenmez.

Güncel yetki doğrulayıcının mevcut bağımlılıkları da korunur:
`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`.
`activeSubscription` mevcut 2026-07 sorgusudur; cached veya uydurma entitlement
receipt kullanılmaz. Gerekli secret isimleri biliniyor; canlı değerleri incelenmedi.

## Başlatma bağlantısı: incelemede görülen gerçek kod işi

`app/routes/settings.google-live-evidence.ts` ve Settings'teki mevcut düğme,
`createGoogleLiveEvidenceRuntime` ile önceki rapor kanıtı sorgularını çalıştırır.
Bu yol `createGoogleReadRunner` çağırmaz. Düğmenin çalışması yeni kaynak okuyucusunun
kabulü sayılamaz. Runner'ı `rg` ile arayınca üretim çağıranı yoktur; yalnız tanım ve
izole test/prova çağrıları vardır.

2. paketin gerekli başlatma bağlantısı için öneri, mevcut authenticated POST
sunucusunda ayrı, varsayılan kapalı, operasyon sahibinin tek hedefe ve tek işe
bağladığı kabul modu kullanmaktır. Yeni ürün ekranı, OAuth adımı veya Merchant
seçicisi eklenmez; mevcut rapor kanıtı modu aynı kalır. Bu öneri henüz uygulanmadı.
Runtime kodu, endpoint sözleşmesi ve yayını için somut kapsam ayrıca onaylanmalıdır.

Bu bağlantının uygulama kabul koşulları:

1. Shopify doğrulanmış caller'ı mevcut sunucu doğrulamasından gelir; JSON içindeki
   `verified`, hesap, Merchant, claim, fence veya entitlement değerleri kabul edilmez.
2. Operasyon modu tek workspace/generation/connection/version/Reporting Account
   ve onaylı Merchant bağlamına sabitlenir. Native Ads/Merchant ilişki kontrolü yine
   yapılır. Eksik metadata yeni OAuth seçicisi veya varsayılan ID ile tamamlanmaz.
3. Mevcut preflight planı ve SQL CAS ile yalnız bir gerçek iş alınır. İş/queue
   kayıtları fixture SQL'iyle yazılmaz; bağlantı tarihi geri çekilmez. Dönem,
   hesabın saat diliminde bağlantı ve seçim tarihinden sonra uygun tek gün olmalıdır.
4. Mevcut gerçek yetki doğrulayıcı ile fresh receipt alınır; ardından runner bu
   claim/window/receipt ile bir kez çağrılır. 1. paketteki sentetik SQL provasının
   stage reset veya boş sayfa/handoff tekniği canlıya taşınmaz.
5. Kaynak gözlemi bir rapor sayfası sayılmaz: `ready_for_dataset`, Dataset yazımı,
   kuyruk checkpoint'i veya `completed` refresh üretilmez. Bilinen sonucun ardından
   dar Google rolü kapatılıp drain edilir. Son SQL guard'ı `request_intent` aşamasında
   finish'i reddeder: yalnız gerçekten bilinen/settled yanıt için mevcut CAS ile
   `response_received` kaydı doğrulandıktan sonra exact claim koordinatörün mevcut
   `finishClaim({outcome:"paused"})` yolu ile bir kez kapatılabilir. Hold veya
   belirsiz dış sonuç bu geçişle aşılamaz. Sonucu belirsiz yazma tekrar edilmez;
   otomatik rezerv bırakma yapılmaz. Kapanış negatif testleri zorunludur.
6. Sonuç yalnız güvenli sayım/sınır/kimlik metadata'sıdır. HTTP hatası, eksik ilişki,
   limit, stale yetki, partial ve unknown ayrı kalır. Sonraki canlı istek otomatik
   başlamaz. Aynı operasyonun tekrar POST'u yeni iş/istek üretmemelidir.
7. İzole testler gerçek token kasası okuma sınırı + dar Google rolü + gerçek
   admission/fresh entitlement/runner/kapanış zincirini kapsamalıdır. UI ve eski
   rapor kanıtı davranışı korunmalıdır. Canlıya hazırlık bu kanıt olmadan tamamlanmaz.

Koordinatör rolü SQL'de mevcut olsa da ayrıca hazırlanmış üretim bağlantı adapter'ı
bulunamadı. Bu da yukarıdaki başlatma bağlantısının parçasıdır; yeni depo veya
dördüncü paket değildir. Mevcut runtime/Google rolleri koordinatöre dönüştürülmez.

## Önerilen tek sınamanın sonlu sınırları

Bunlar işletmecinin düşük maliyetli sınama tavanlarıdır; Google hesabının gerçek
provider kota/tier değerleri veya bir performans taahhüdü değildir. Henüz canlıya
yazılmadı; bütün iş bütçeleri bu tavanları karşılayacak şekilde aynı anda doğrulanır.

| Alan | Öneri |
|---|---|
| Eşzamanlı kabul | Yalnız 1 Google işi; scheduler/otomatik tekrar kapalı |
| İşin toplam süresi | 90.000 ms; canlı başlatmada tek deadline |
| Reader toplam süresi | En çok 60.000 ms ve iş deadline'ından kalan süre kadar |
| Fresh Partner isteği | En çok 10.000 ms; kapanış için en az 10.000 ms ayrılır |
| Google DB sorgusu/bağlantı zaman aşımı | 5.000 ms |
| Merchant sayfası | 1; devam token'ı gelirse eksik sonuç, 0 kabulü yok |
| Her Ads ilişki okumasının sayfası | 1; önce ve sonra ayrı kontrol |
| Ürün satırı / ilişki sayısı | `maxRows=1000`, `maxLinks=1000`; dolu sonuç gerçekten doludur |
| Google yanıtlarının toplam decoded boyutu | `maxBytes=1048576` (1 MiB) |
| Native Google istek sayısı | En çok 3: Ads ilişki → Merchant ürünler → Ads ilişki |
| Kota pencere önerisi | 60.000 ms; Google background toplamı 3 birim, Partner background 1 birim; her policy için `max_outstanding=1` |
| Kota dispatch izni | `dispatch_delay_ms=5000`: rezervden gönderime son süre; istekler arası bekleme değildir |

Native isteğin mevcut `pageSize=1000` değeri değiştirilmez. Bu, 1000 gerçek ürün
yaratmak veya beklemek değildir; boş hesabın başarılı tek yanıtı 0 olmalıdır.
Küçük limitte eksik kalan yanıt başarıya çevrilmez.

Fresh Partner sorgusu Google'ın 3 isteğine ek 1 çağrıdır. Authenticated girişte
mevcut Shopify mağaza kimliği doğrulamasının Admin çağrısı da ayrıca hesaba katılır;
kimlik doğrulama/token yenileme trafiği 3 Google isteğinin içine saklanmaz.
Oturum/credential yenilemesi gerekirse otomatik olarak bu sınamaya eklenmez.

Canlı bütçe yazımında global/provider/workspace/account katmanları ve interaktif
rezerv birlikte kontrol edilir. Job cost, bütün üst düzey isteklere, DB yazımlarına,
bağlantılara, satır ve byte tavanına yetecek şekilde adapter testinden çıkarılır;
fixture'ın `requests:2`/küçük byte değerleri kopyalanmaz. Mevcut policy/reserve
değerleri ezilmez. Yeni route/profile anahtarları güncel SQL bağlamından hesaplanır;
failure-domain ve Merchant quota-account bağları doğrulanmadan enable edilmez.

## Canlıda gerekli olacak değişiklikler ve uygulanma sınırı

| Değişiklik | Gerekçe / sınır |
|---|---|
| Google rolüne sınırlı giriş ve ayrı güçlü parola | Mevcut NOLOGIN rolü gerçek bağlantı kuramaz. Mevcut 16 RPC/4 schema sınırı değişmez. Parola güvenli secret kanalına gider. |
| Güvenilir koordinatör erişimi | Yalnız mevcut admission/yetki/kapanış RPC yüzeyi; runtime/Google rolü genişletilmez. Bağlantı hazırlığı ve exact yetki listesi ayrıca incelenir. |
| Google bağlantı env'i ve 5 s timeout | Hedef runtime'da ayrı secret; mevcut runtime URL'si yerine kullanılmaz. Bu inceleme secret üretmedi. |
| Tek hedefli quota context + sonlu operasyon/bütçe politikaları | Güncel Reporting Account/credential/connection ve doğrulanmış Merchant quota context; canlı metadata okunmadan exact ID veya policy yazımı hazırlanamaz. |
| Varsayılan kapalı operasyon modunun tek iş için açılması | Kod/test/PR, ayrı merge ve yayın onayından sonra; yalnız yetkili hedef. Yayın kendi başına veri çağrısı başlatmaz. |

Bu tablo şu anda canlı uygulama yetkisi değildir. İlk provider/SQL/config mutation
hatasında durulur; ikinci deneme veya başka araç/rota yeni açık onaysız kullanılmaz.
Gerçek provider çağrısı yalnız 3. paketin açık kabul onayıyla yapılır. Ayar hazırlamak
başarılı Google isteği veya 0 veri kabulü değildir.

2. paket ancak güvenilir giriş bağlantısının kod/test kanıtı, gerçek bağlantı/secret,
güncel hesap/Merchant/credential metadata'sı, sonlu bütçe ve kapanış planı doğrulandığında
tamamlanır. Bu kayıt yalnız hazırlık sonucudur; açık işler gizlenmez.

## Resmî kontrol — 3 Kasım 2026

- [Supabase bağlantı ve custom-role pooler biçimi](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase roller](https://supabase.com/docs/guides/database/postgres/roles)
- [PostgreSQL 17 ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html)
- [Merchant products.list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list)
- [Google Ads kota sınırları](https://developers.google.com/google-ads/api/docs/best-practices/quotas)
- [Shopify authenticated Admin](https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin)
- [Shopify Partner 2026-07 activeSubscription](https://shopify.dev/docs/api/partner/2026-07/queries/activeSubscription)

Supabase changelog da kontrol edildi. Bu hazırlık kütüphane/API sürümü yükseltmez;
mevcut Ads v25, Merchant products/v1 ve Partner 2026-07 protokolleri korunur.
