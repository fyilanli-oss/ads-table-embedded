# F01-B — Gerçek veritabanı üzerinde sıfırdan kurulum provası

**Tarih:** 18 Ekim 2026

**Güncel sonuç:** F01-B izole veritabanı provası PASS. Bu provanın kendisi canlı ortamı değiştirmedi. F01'in sonraki dar kurtarma kabulü, canlı uygulaması ve kapanışı ayrı onaylarla tamamlandı.

> Güncel sıra `docs/EXECUTION_PLAN.md` içindedir. F01 kapanışı `docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json` ile kayıtlıdır. Aşağıdaki başarısız koşular ve bekleyen onaylar tarihsel kayıttır; yeniden işlem talebi değildir. Bu dil düzenlemesi F01'i açmaz, yeni prova veya canlı işlem yetkisi vermez.

## Başarılı gerçek koşu — tarihsel sonuç

Kaynak `fc7e43056444ad002d6c9489c8b7f3ebb276b84c`,
[koşu 39135603458](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39135603458).
PostgreSQL 17.11 üzerinde şu kontroller geçti:

- İlk 38 tarihsel migration ve kaydedilmiş canlı üst veriyle birebir
  karşılaştırma. Bu sonuç yeni bir canlı şema okuması değildir.
- Üç rol sınırı, beş sentetik yetkilendirme devri durumu, önceki yaşam döngüsü/gizlilik davranışı.
- Boş ve sekiz sonlanmış satırlı tabloda devreden çıkarma; tarihsel satırların korunması.
- Bekleyen seçim ve kimlik bilgisi referansı koruma kontrolleri; başarısızlıkta şema/satır
  durumunun korunması; bağımlılık `RESTRICT` hatasında geri alma ve 5 saniyelik kilit zaman aşımı.
- Altı eski fonksiyonun yokluğu, runtime rolündeki dönüş fonksiyonu, tablo erişim yasağı,
  bağlanma/bağlantı kesme ve aynı isteğin güvenle tekrarı, ilişkisiz sahipsiz kaydın korunması,
  gizlilik silme zinciri ve sentetik test verilerinin işlem geri alınarak temizlenmesi.
- Geçici runtime üyeliğinin 11 transaction sonunda önceki katalog durumuna
  birebir dönmesi. Kalıcı üyelik, uygulama yetkisi veya tarihsel SQL değişmedi.
- 39 migration'ın ikinci boş veritabanına uygulanması ve ilk nihai şemayla eşleşmesi.
  İki şema SHA-256 değeri de
  `1a26e26bc6d905f6369599d209b5d76ea5c725444f42d3bc0389b3a829ab62b4`.
- Forced RLS, yalnız fonksiyon çalıştırma yetkisi ve security-definer search_path katalog kontrolleri.
  İki geçici ortamın kapatılması/temizlenmesi de başarılıdır.

412 yerel test, typecheck, build ve kaynak commit'in Repository Governance koşusu
PASS'tir. Bilinen React Router v8 gelecek sürüm uyarısı borcu F10'da kalır. Cloud Advisor çalıştırılmış
sayılmaz. Production bağlantısı veya değişikliği, gerçek kimlik bilgisi ya da iş verisi
taşıma yoktur. Kanıt:
`docs/evidence/A6_TECH_01_F01B_DATABASE_REPLAY_PASS_2026-10-18.json`.

Bu kanıtı kaydeden son commit de normal zorunlu CI'dan geçer; yeni kanıtı kaydetmek
için tekrar tekrar sonuç commit'i üretilmez. Son commit'in koşu bağlantısı PR'da
tutulur. Önceki üç duruş kanıtı aynen korunur.

Bu provanın tamamlandığı andaki sıradaki ayrı kapı F01-C'ydi: Canlı ön kontroller,
geri dönüş kapsamının kabulü, birebir canlı uygulama onayı ve işlem sonrası doğrulamalar.
O aşamada birleştirme/canlı uygulama onayı yoktu; F01 açık, F02 kapalıydı.
Sonraki kabul tam yedek değil, yalnız F01'e özel dar şema kurtarmasıdır; baştaki
kapanış kaydı esas alınır.

## Onaylanan toplu hazırlık — 18 Ekim 2026 tarihsel kapsam

Kullanıcı bu beş maddeyi tek uygulama sınırı olarak onayladı:

1. Yalnız geçici GitHub test makinesinin veritabanında test transaction'ı içinde
   `adstable_runtime` → `postgres` üyeliği `SET TRUE, INHERIT FALSE, ADMIN FALSE`
   ile verilir. Mevcut üyelik satırları değiştirilmez; beklenmeyen mevcut yetki
   üzerine yazılmaz. Başarıda ve hatada transaction geri alınır; bütün
   runtime üyelikleri önceki yalnız ad içeren katalog envanteriyle birebir karşılaştırılır.
   Uygulama rolü, tablo/fonksiyon yetkisi veya tarihsel SQL değiştirilmez.
2. Senaryolardan önce tüm kullanılan şema/fonksiyon izinleri, üç rol sınırı,
   beş sentetik yetkilendirme devri durumu ve tarihsel yaşam döngüsü/gizlilik davranışı gerçek
   veritabanı üzerinde kontrol edilir. Eksik uygulama izni test için verilen ek yetkiyle
   maskelenmez. SQL gövdelerine veya iş kuralına müdahale edilmez.
3. Veritabanı iş akışı yalnız PR ile çalışır; aynı commit'in push koşusu ve
   bunu iptal edip yeniden başlayan ikinci veritabanı koşusu kaldırılmıştır.
4. İki geçici ortamın temizliği birbirinden bağımsızdır. İlk ortam başarıyla
   durdurulduysa ikinci kez durdurulmaz; hata durumunda diğer temizlik adımı
   yine çalışır. Production dağıtımı veya veritabanı bağlantısı yoktur.
5. Devreden çıkarma koruması/geri alma, dönüş, güvenli bağlantı kesme tekrarı, gizlilik silme zinciri
   ve ikinci sıfırdan kurulum tamamlanarak kaynak commit'e bağlı sonuç kaydedilir.

Bu onay canlı uygulama, birleştirme, tarihsel migration değişikliği veya F02 başlangıcı
değildir. Gerçek uygulama hatası veya açıklanamayan dış-sağlayıcı hatasında
durma kapısı korunur. Test aracındaki rutin düzeltmeler bu dar kapsam içindedir.

Resmî PostgreSQL `GRANT` ve GitHub iş akışı tetikleme belgeleri 18 Ekim 2026'da
kontrol edildi. Supabase/Postgres en az yetki rehberi gereği geçici rol
üyeliği bütün senaryoyla geri alınır; haklar kalıcı genişletilmez.

## Üçüncü gerçek koşu — tarihsel duruş

Kaynak `71ae55aa154ad6492c42ec6ec893cbd4e65361ce`,
[koşu 39134192984](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39134192984).
38 tarihsel migration geçti ve açık `F01B_LIVE_PARITY_PASS` kaydı oluştu.
`postgres` ve `adstable_owner` rol sınırı senaryoları geçti. Ardından
`pg_has_role(session_user,'adstable_runtime','SET') = false` bulundu ve ön kontrol
durdu. Henüz runtime uygulama çağrısı veya devreden çıkarma senaryosu çalışmadı.

Bu sonuç geçici test makinesinin runtime rolünü kullanma yetkisinin olmadığını
kanıtlar; Production rol üyeliğine ilişkin bir ölçüm değildir. Tarihsel
migration veya canlı yetki değiştirilmedi, yeni yetki üretilmedi. İzole ortamın
temizliği başarılıdır. İkinci temiz kurulum başlamadı; tam veritabanı kapısı FAIL.
Kaynak commit için 408 yerel test ve Repository Governance PASS'tir.

Kanıt: `docs/evidence/A6_TECH_01_F01B_THIRD_REPLAY_STOP_2026-10-18.json`.
Son belge commit'i `[skip ci]` kullanır; başarısız işlem kayıt nedeniyle tekrar
başlatılmaz ve bu yeni HEAD için CI PASS iddiası yapılmaz.

O duruş sonrasındaki öneri ayrı onay gerektiriyordu: yalnız geçici GitHub test veritabanında koordinatör
`postgres` için `adstable_runtime` rolüne geçici `SET` üyeliği sağlamak; INHERIT
ve rol niteliklerini genişletmemek. Üyelik önce/sonra kanıtlanmalı ve test
sonrasında eski durumu geri gelmeli; Production, tarihsel SQL ve uygulama
yetkileri değişmemelidir. Bu adım o aşamada henüz uygulanmamıştı; sonraki toplu hazırlık ve başarılı koşu yukarıda kayıtlıdır.

## Onaylanan test rol sınırları — tarihsel yöntem

Bu ara yöntem geçici rol üyeliği adımından önce yazıldı. Sonraki açık onayla
verilen ve geri alınan üyelik, yukarıdaki toplu hazırlık ve başarılı koşuda
ayrıca kayıtlıdır; aşağıdaki “yeni üyelik üretilmez” ifadesi o ara kapsamdır.

| İşlem | Mevcut rol |
| --- | --- |
| Kurulum başlangıcı, dönüş, hesap seçimi, bağlantı kesme, silme talebi | `adstable_runtime` |
| Sentetik satır hazırlama, doğrudan satır kontrolü, bağımlılık görünümü ve kilit test verisi | `adstable_owner` |
| Migration koordinasyonu, katalog envanteri ve gizlilik kuyruğu işçisi | `postgres` |

Her rol kapsamı aktif transaction içinde ayrı savepoint kullanır. Başarıda
önceki role geri döner ve değişiklikleri korur; hatada kapsam geri alınır,
rol geri gelir ve hata tekrar denenmeden yukarı taşınır. İç içe runtime çağrısı
sahip rolüne döner; doğrudan oturum rolüne sıçramaz. Yeni yetki veya rol üyeliği
üretilmez. Mevcut `SET` yetkileri, gerçek rol geçişleri ve runtime'ın doğrudan
sentetik test verisi INSERT yasağı yeni koşuda senaryolardan önce sınanır.

Bağımlılık test görünümü public yerine özel `integrations` şemasında sahip rolüyle
oluşturulur; uygulama tablosu veya kalıcı migration değildir ve
senaryoyla birlikte geri alınır. Canlı üst veri farkı varsa senaryolara
başlamadan durulur; fark yoksa ayrı `F01B_LIVE_PARITY_PASS` kaydı yazılır.

## İkinci gerçek koşu — tarihsel duruş

Kaynak `0b885052e4bba559323006d000a667256e89d5fe`,
[koşu 39133172317](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39133172317).
Sahip rolü bağlamı gereken dört dosya dahil 38 tarihsel migration geçti. Canlı üst veri
karşılaştırmasına ulaşıldı ve fark kaydı oluşmadı; tam sonuç kanıtı henüz yoktur.
İlk sentetik test verisi, `shopify.bootstrap_installation` çağrısını `postgres`
olarak yaptığı için `42501: permission denied for function bootstrap_installation`
ile durdu. Bu fonksiyonun mevcut çalıştırma izni `adstable_runtime` rolündedir.

Bu duruş test aracındaki eksik rol ayrımıdır; canlı uygulama hatası veya yeni
yetki ihtiyacı kanıtı değildir. Devreden çıkarma henüz denenmedi, ikinci boş kurulum
başlamadı. Geçici ortam temizliği başarılıdır; Production değişmedi.
Kanıt: `docs/evidence/A6_TECH_01_F01B_SECOND_REPLAY_STOP_2026-10-18.json`.

O duruştan sonraki öneri, yalnız test aracındaki tüm rol sınırlarını birlikte doğrulamaktır:
kurulum başlangıcı ve kullanıcı akışları runtime, doğrudan sentetik veri/DDL hazırlığı
sahip rolü, gizlilik işçisi mevcut postgres izniyle çalışmalı. Rol geçişleri açıkça
geri alınmalı; her adımın yetkisi yeni koşudan önce gözden geçirilmelidir.
Bu ilave test aracı düzeltmesi ve yeni izole koşu kullanıcı tarafından onaylandı.
İkinci koşunun kanıtı değiştirilmez; yeni koşunun sonucu ayrıca kaydedilecektir.

404 yerel test ve kaynak commit'in GitHub repository kontrolleri PASS'tir;
gerçek veritabanı kapısı FAIL'dir. Bu sonucu kaydeden belge commit'i `[skip ci]`
kullanır; yeni HEAD için CI PASS iddiası veya birleştirme isteği yoktur.

## İlk gerçek koşu — tarihsel duruş

[`39132400862` numaralı GitHub koşusu](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39132400862),
`c2070282db244988c41dd564e6e5fa4347b704f4` kaynak commit'ini
`supabase/postgres:17.11.0.004` üzerinde çalıştırdı. İlk 20 migration geçti.
`20261009145154_eo03d_qualify_lifecycle_event_columns.sql` dosyasında
`42501: permission denied for schema integrations` oluştu. Sonraki migration,
eşlik, devreden çıkarma ve ikinci ortam adımları başlamadı. Geçici veritabanı temizliği
başarılıdır. Production'a hiçbir işlem yapılmadı.

F01-A eşleme kaydında `live_session_role_wrapper_only` olarak kaydedilen dört
dosyanın çalıştırma bağlamı gerçekten gereklidir. `adstable_owner` rolüne geçiş
olmadan özel şemaya DDL uygulanamaması beklenen en az yetki davranışıdır.
Bu sonuç yetki genişletme gerekçesi değildir; repository kurulum prosedürünün
eksik çalıştırma bağlamını gösterir.

Onaylanan dar düzeltme: bu dört eşleme kaydına transaction içindeki mevcut
`adstable_owner` çalıştırma bağlamını açıkça eklemek ve yeniden kurulum aracının yalnız bu
dört dosyayı o bağlamda yürütmesini sağlamak. Tarihsel SQL gövdeleri/hash'leri,
NOINHERIT rol modeli ve canlı yetkiler korunur. Eşleme ve yeniden kurulum aracı bu
bağlamı artık açıkça taşır; yalnız dört bilinen sürüm/ad çifti kabul edilir.
Rol yalnız transaction içinde geçerlidir; SQL veya commit hatasında geri alma yapılır, tekrar
denenmez. Bilinmeyen rol, oturum kapsamı veya başka migration'a bağlam eklenmesi
SQL çalıştırılmadan reddedilir. Yeni koşunun sonucu o aşamada bilinmiyordu; başarılı koşu bu belgenin başındadır.
İlk duruşun değiştirilmemiş sınırlı kanıtı
`docs/evidence/A6_TECH_01_F01B_FIRST_REPLAY_STOP_2026-10-18.json` içindedir.

Normal repository CI'ı ve 399 yerel test başarılıdır; gerçek veritabanı kapısı
başarısızdır. Sonucu kaydeden belge commit'i `[skip ci]` ile gönderilir; aynı
başarısız veritabanı işlemi belge kaydı nedeniyle otomatik tekrar çalıştırılmaz.
Bu commit için yeni CI PASS iddiası veya birleştirme isteği yoktur.

F01-A migration geçmişini repository'ye bağladı. F01-B aynı dosyaların gerçek
PostgreSQL 17 üzerinde çalıştığını ve devreden çıkarma işleminin veri/yetki sınırlarını
koruduğunu kanıtlar. F01-B başarılı olsa da canlı devreden çıkarma ve F01 kapanışı ayrı
kapılardı. O ara sonuç F02'yi başlatmadı.

## Kullanılan test ortamı

GitHub'ın geçici Ubuntu test makinesinde `supabase@2.121.0 init` ve `db start`
kullanılır. Yerel Docker bu bilgisayara kurulmaz; yeni bulut Supabase projesi,
Production kimlik bilgisi, secret, OAuth veya bağlantı kurulmaz. İş akışının tek
GitHub yetkisi `contents: read`dır. Action referansları doğrulanmış commit SHA'sına
sabitlenmiştir. Mevcut F05 bulgusunun diğer iş akışlarındaki düzeltmesi bu işe
alınmamıştır.

Test aracı yalnız GitHub test makinesinde çalışır ve veritabanı hedefi kodda
`127.0.0.1:54322` olarak sabittir. Bağlantı URL'si veya Production ortam
değişkeni kabul etmez. Test kullanıcı/parolası CLI'ın geçici yerel veritabanı
varsayılanıdır; Production secret değildir.

## Kanıt kaynağı ve akış — tarihsel yöntem

`docs/evidence/A6_TECH_01_F01_LIVE_SCHEMA_2026-10-18.json`, 18 Ekim tarihinde
canlıdan salt okunur alınmış üst veridir. Yedi uygulama şemasının tablo,
kolon, constraint, indeks, policy, fonksiyon tanımı hash'i, yetki ve rol
özelliklerini içerir. İş verisi satırı, token, şifreli veri, kişisel kimlik veya
kimlik bilgisi değeri içermez. Aynı envanter SQL'i izole ortamda da çalışır.

1. İlk boş yerel Supabase veritabanına 38 tarihsel migration sırayla uygulanır.
2. Tarihsel zincirin nihai üst verisi canlı kayıtlı görünüm ile karşılaştırılır. Farklar
   kategori ve nesne bazında yazılır; izin verilmiş fark listesi yoktur.
3. Her devreden çıkarma senaryosu ayrı transaction içinde çalıştırılıp geri alınır:
   boş yetkilendirme devri tablosu, sekiz sonlanmış tarihsel satır, bekleyen seçim,
   kimlik bilgisi referansı, fonksiyon bağımlılığı nedeniyle `RESTRICT` hatası ve
   ikinci bağlantı nedeniyle lock timeout.
4. Başarılı devreden çıkarma, altı fonksiyonun yokluğunu, dönüş fonksiyonunun runtime rolünde
   çalışmasını ve doğrudan tablo erişiminin reddini doğrular. Sentetik Google
   bağlantısında hazırlama/bağlama/bağlantı kesme ve güvenli tekrar sınanır. İlişkisiz
   sentetik sahipsiz kimlik bilgisi bağlantı kesilirken korunur. Ardından gizlilik
   işçisiyle kurulum silme zinciri ve tarihsel tablo temizliği sınanır.
5. Test verileri işlem geri alınarak sıfıra döner. Devreden çıkarma tam transaction olarak
   uygulanır ve nihai şema hash'i kaydedilir. Forced RLS, runtime'ın yalnız fonksiyon çalıştırması ve doğrudan tablo
   yetkisinin bulunmaması, security-definer `search_path` ve public API rol erişimleri katalog
   sorgularıyla test edilir.
6. İlk yerel veritabanı durdurulur ve ona ait geçici disk alanı silinir. İkinci boş
   yerel veritabanında 39 dosyanın tamamı çalıştırılır. Nihai şema ilk koşunun
   sonucuyla karşılaştırılır. Testler bitince bu geçici ortam da kapatılır.

Geri alınan senaryolarda devreden çıkarma dosyasının yalnız dış `begin/commit`
sarmalayıcısı kaldırılır; bütün koruma, DDL, rol ve zaman aşımı gövdesi aynen çalışır.
Bağımlılık hatası geç aşamadaki DDL'nin de geri alındığını kontrol eder.
Son iki tam uygulamada dosyanın dış transaction'ı dahil orijinal içeriği kullanılır.

## Sonucun anlamı

GitHub loglarındaki `F01B_SCENARIO_PASS` kayıtları çalışan SQL senaryolarıdır.
`F01B_EVIDENCE` sürüm, migration sayısı, şema hash'i ve eşlik sonucunu verir.
`F01B_STOP` başarısız adımda çalışmayı durdurur. Migration dosyası adı uygulamadan
önce yazıldığı için hatanın hangi migration'da oluştuğu belirlenebilir.

Yerel Node testlerinin geçmesi veritabanı provasının PASS olduğu anlamına gelmez.
Katalog güvenlik testleri Supabase Cloud Advisor servisini çalıştırmış sayılmaz.
İlk plandaki Cloud Advisor ve yedek/PITR doğrulaması ayrı F01-C canlı kapısına
bırakılmıştı. Sonraki kabul, tam yedek/PITR değil dar şema kurtarmasıdır.
F08'de kayıtlı indeks bulguları F01-B kapsamında düzeltilmedi.

## Resmî dayanak

18 Ekim 2026: [PostgreSQL SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html)
belgesi de kontrol edildi. `SET LOCAL ROLE` mevcut rol üyeliğini transaction
içinde kullanır; yeni yetki veya rol niteliği değişikliği değildir.

18 Ekim 2026 tarihinde Supabase Docs Connector üzerinden kontrol edildi:

- [GitHub Actions ve yerel veritabanı yönetimi](https://supabase.com/docs/guides/deployment/managing-environments)
- [Veritabanı test yöntemleri](https://supabase.com/docs/guides/local-development/testing/overview)
- [CLI test ve lint araçları](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)

`init`, `db start`, `db reset` ve `stop` komutları CLI'ın `--help` çıktısıyla
doğrulandı. İş akışında uzak `link`, `push`, `repair`, `apply_migration` veya
Production dağıtım adımı yoktur.
