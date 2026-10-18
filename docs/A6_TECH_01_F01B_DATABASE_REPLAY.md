# F01-B — Gerçek database üzerinde sıfırdan kurulum provası

**Tarih:** 18 Ekim 2026

**Durum:** Toplu test hazırlığı onaylandı ve uygulandı; yeni izole prova bekleniyor. Önceki 38 migration/şema PASS kanıtı korunur. F01 açık, PR draft.

## Onaylanan toplu hazırlık — 18 Ekim 2026

Kullanıcı bu beş maddeyi tek uygulama sınırı olarak onayladı:

1. Yalnız geçici GitHub runner database'inde test transaction'ı içinde
   `adstable_runtime` → `postgres` üyeliği `SET TRUE, INHERIT FALSE, ADMIN FALSE`
   ile verilir. Mevcut üyelik satırları değiştirilmez; beklenmeyen mevcut grant
   üzerine yazılmaz. Başarıda ve hatada transaction rollback edilir; bütün
   runtime üyelikleri önceki name-only katalog envanteriyle birebir karşılaştırılır.
   Uygulama rolü, tablo/fonksiyon grant'ı veya tarihsel SQL değiştirilmez.
2. Senaryolardan önce tüm kullanılan schema/function izinleri, üç rol sınırı,
   beş sentetik handoff durumu ve tarihsel lifecycle/privacy davranışı gerçek
   database üzerinde kontrol edilir. Eksik application izni test grant'ıyla
   maskelenmez. SQL gövdelerine veya iş kuralına müdahale edilmez.
3. Database workflow'u yalnız PR ile çalışır; aynı commit'in push koşusu ve
   bunu iptal edip yeniden başlayan ikinci database koşusu kaldırılmıştır.
4. İki geçici ortamın temizliği birbirinden bağımsızdır. İlk ortam başarıyla
   durdurulduysa ikinci kez durdurulmaz; hata durumunda diğer cleanup adımı
   yine çalışır. Production deploy veya database bağlantısı yoktur.
5. Retirement koruma/rollback, callback, disconnect/idempotence, privacy cascade
   ve ikinci sıfırdan kurulum tamamlanarak kaynak commit'e bağlı sonuç kaydedilir.

Bu onay canlı uygulama, merge, tarihsel migration değişikliği veya F02 başlangıcı
değildir. Gerçek application hatası veya açıklanamayan dış-provider hatasında
durma kapısı korunur. Test-aracındaki rutin düzeltmeler bu dar kapsam içindedir.

Resmî PostgreSQL `GRANT` ve GitHub workflow tetikleme belgeleri 18 Ekim 2026'da
kontrol edildi. Supabase/Postgres least-privilege rehberi gereği geçici rol
üyeliği bütün senaryoyla rollback edilir; haklar kalıcı genişletilmez.

## Üçüncü gerçek koşunun sonucu

Kaynak `71ae55aa154ad6492c42ec6ec893cbd4e65361ce`,
[koşu 39134192984](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39134192984).
38 tarihsel migration geçti ve açık `F01B_LIVE_PARITY_PASS` kaydı oluştu.
`postgres` ve `adstable_owner` rol sınırı senaryoları geçti. Ardından
`pg_has_role(session_user,'adstable_runtime','SET') = false` bulundu ve ön kontrol
durdu. Henüz runtime uygulama çağrısı veya retirement senaryosu çalışmadı.

Bu sonuç geçici test makinesinin runtime rolünü kullanma yetkisinin olmadığını
kanıtlar; Production rol üyeliğine ilişkin bir ölçüm değildir. Tarihsel
migration veya canlı yetki değiştirilmedi, yeni grant üretilmedi. İzole ortamın
temizliği başarılıdır. İkinci temiz kurulum başlamadı; tam database kapısı FAIL.
Kaynak commit için 408 yerel test ve Repository Governance PASS'tir.

Kanıt: `docs/evidence/A6_TECH_01_F01B_THIRD_REPLAY_STOP_2026-10-18.json`.
Son belge commit'i `[skip ci]` kullanır; başarısız işlem kayıt nedeniyle tekrar
başlatılmaz ve bu yeni HEAD için CI PASS iddiası yapılmaz.

Sonraki öneri ayrı onay ister: yalnız geçici GitHub test database'inde koordinatör
`postgres` için `adstable_runtime` rolüne geçici `SET` üyeliği sağlamak; INHERIT
ve rol niteliklerini genişletmemek. Üyelik önce/sonra kanıtlanmalı ve test
sonrasında eski durumu geri gelmeli; Production, tarihsel SQL ve application
grant'ları değişmemelidir. Bu test altyapısı adımı henüz uygulanmadı.

## Onaylanan test rol sınırları

| İşlem | Mevcut rol |
| --- | --- |
| Bootstrap, callback, account selection, disconnect, deletion request | `adstable_runtime` |
| Sentetik satır hazırlama, doğrudan satır kontrolü, bağımlılık view'ı ve lock fixture'ı | `adstable_owner` |
| Migration koordinasyonu, katalog envanteri ve privacy queue worker | `postgres` |

Her rol kapsamı aktif transaction içinde ayrı savepoint kullanır. Başarıda
önceki role geri döner ve değişiklikleri korur; hatada kapsam rollback edilir,
rol geri gelir ve hata tekrar denenmeden yukarı taşınır. İç içe runtime çağrısı
owner'a döner; doğrudan session rolüne sıçramaz. Yeni grant veya rol üyeliği
üretilmez. Mevcut `SET` yetkileri, gerçek rol geçişleri ve runtime'ın doğrudan
fixture INSERT yasağı yeni koşuda senaryolardan önce sınanır.

Bağımlılık testi view'ı public yerine private `integrations` schema'sında owner
tarafından oluşturulur; uygulama tablosu veya kalıcı migration değildir ve
senaryoyla birlikte rollback olur. Canlı metadata farkı varsa senaryolara
başlamadan durulur; fark yoksa ayrı `F01B_LIVE_PARITY_PASS` kaydı yazılır.

## İkinci gerçek koşunun sonucu

Kaynak `0b885052e4bba559323006d000a667256e89d5fe`,
[koşu 39133172317](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39133172317).
Dört owner-context dosyası dahil 38 tarihsel migration geçti. Canlı metadata
karşılaştırmasına ulaşıldı ve fark kaydı oluşmadı; tam sonuç kanıtı henüz yoktur.
İlk sentetik fixture, `shopify.bootstrap_installation` çağrısını `postgres`
olarak yaptığı için `42501: permission denied for function bootstrap_installation`
ile durdu. Bu fonksiyonun mevcut execute izni `adstable_runtime` rolündedir.

Bu duruş test aracındaki eksik rol ayrımıdır; canlı uygulama hatası veya yeni
grant ihtiyacı kanıtı değildir. Retirement henüz denenmedi, ikinci boş kurulum
başlamadı. Geçici ortam temizliği başarılıdır; Production değişmedi.
Kanıt: `docs/evidence/A6_TECH_01_F01B_SECOND_REPLAY_STOP_2026-10-18.json`.

Sonraki öneri, yalnız test aracındaki tüm rol sınırlarını birlikte doğrulamaktır:
bootstrap ve kullanıcı akışları runtime, doğrudan sentetik veri/DDL hazırlığı
owner, privacy worker mevcut postgres izniyle çalışmalı. Rol geçişleri açıkça
geri alınmalı; her adımın yetkisi yeni koşudan önce gözden geçirilmelidir.
Bu ilave test-aracı düzeltmesi ve yeni izole koşu kullanıcı tarafından onaylandı.
İkinci koşunun kanıtı değiştirilmez; yeni koşunun sonucu ayrıca kaydedilecektir.

404 yerel test ve kaynak commit'in GitHub repository kontrolleri PASS'tir;
gerçek database kapısı FAIL'dir. Bu sonucu kaydeden belge commit'i `[skip ci]`
kullanır; yeni HEAD için CI PASS iddiası veya merge isteği yoktur.

## İlk gerçek koşunun sonucu

[`39132400862` numaralı GitHub koşusu](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39132400862),
`c2070282db244988c41dd564e6e5fa4347b704f4` kaynak commit'ini
`supabase/postgres:17.11.0.004` üzerinde çalıştırdı. İlk 20 migration geçti.
`20261009145154_eo03d_qualify_lifecycle_event_columns.sql` dosyasında
`42501: permission denied for schema integrations` oluştu. Sonraki migration,
parity, retirement ve ikinci ortam adımları başlamadı. Geçici database temizliği
başarılıdır. Production'a hiçbir işlem yapılmadı.

F01-A manifest'inde `live_session_role_wrapper_only` olarak kaydedilen dört
dosyanın çalıştırma bağlamı gerçekten gereklidir. `adstable_owner` rolüne geçiş
olmadan private schema'ya DDL uygulanamaması beklenen least-privilege davranışıdır.
Bu sonuç yetki genişletme gerekçesi değildir; repository kurulum prosedürünün
eksik çalıştırma bağlamını gösterir.

Onaylanan dar düzeltme: bu dört manifest kaydına transaction içindeki mevcut
`adstable_owner` çalıştırma bağlamını açıkça eklemek ve replay aracının yalnız bu
dört dosyayı o bağlamda yürütmesini sağlamak. Tarihsel SQL gövdeleri/hash'leri,
NOINHERIT rol modeli ve canlı grant'lar korunur. Manifest ve replay aracı bu
bağlamı artık açıkça taşır; yalnız dört bilinen version/name çifti kabul edilir.
Rol transaction-local'dir; SQL veya commit hatasında rollback yapılır, tekrar
denenmez. Bilinmeyen rol, session kapsamı veya başka migration'a bağlam eklenmesi
SQL çalıştırılmadan reddedilir. Yeni izole koşunun sonucu henüz bilinmiyor.
İlk duruşun değiştirilmemiş bounded kanıtı
`docs/evidence/A6_TECH_01_F01B_FIRST_REPLAY_STOP_2026-10-18.json` içindedir.

Normal repository CI'ı ve 399 yerel test başarılıdır; gerçek database kapısı
başarısızdır. Sonucu kaydeden belge commit'i `[skip ci]` ile gönderilir; aynı
başarısız database işlemi belge kaydı nedeniyle otomatik tekrar çalıştırılmaz.
Bu commit için yeni CI PASS iddiası veya merge isteği yoktur.

F01-A migration geçmişini repository'ye bağladı. F01-B aynı dosyaların gerçek
PostgreSQL 17 üzerinde çalıştığını ve retirement işleminin veri/yetki sınırlarını
koruduğunu kanıtlar. F01-B başarılı olsa da canlı retirement ve F01 kapanışı ayrı
kapılardır. F02 başlamaz.

## Test ortamı

GitHub'ın geçici Ubuntu test makinesinde `supabase@2.121.0 init` ve `db start`
kullanılır. Local Docker bu bilgisayara kurulmaz; yeni cloud Supabase projesi,
Production credential, secret, OAuth veya bağlantı kurulmaz. Workflow'un tek
GitHub yetkisi `contents: read`dır. Action referansları doğrulanmış commit SHA'sına
sabitlenmiştir. Mevcut F05 bulgusunun diğer workflow'lardaki düzeltmesi bu işe
alınmamıştır.

Test aracı yalnız GitHub runner'da çalışır ve database hedefi kodda
`127.0.0.1:54322` olarak sabittir. Connection URL veya Production environment
değişkeni kabul etmez. Test kullanıcı/parolası CLI'ın geçici local database
varsayılanıdır; Production secret değildir.

## Kanıt kaynağı ve akış

`docs/evidence/A6_TECH_01_F01_LIVE_SCHEMA_2026-10-18.json`, 18 Ekim tarihinde
canlıdan salt-okunur alınmış metadata'dır. Yedi application schema'sının tablo,
kolon, constraint, index, policy, function definition hash, grant ve rol
özelliklerini içerir. Business satır, token, ciphertext, kişisel kimlik veya
credential değeri içermez. Aynı envanter SQL'i izole ortamda da çalışır.

1. İlk boş local Supabase database'ine 38 tarihsel migration sırayla uygulanır.
2. Tarihsel zincirin nihai metadata'sı canlı snapshot ile karşılaştırılır. Farklar
   category ve nesne bazında yazılır; izin verilmiş fark listesi yoktur.
3. Her retirement senaryosu ayrı transaction içinde çalıştırılıp geri alınır:
   boş handoff tablosu, sekiz terminal tarihsel satır, pending seçim,
   credential referansı, fonksiyon bağımlılığı nedeniyle `RESTRICT` hatası ve
   ikinci bağlantı nedeniyle lock timeout.
4. Başarılı retirement, altı fonksiyonun yokluğunu, callback'in runtime rolünde
   çalışmasını ve doğrudan tablo erişiminin reddini doğrular. Sentetik Google
   bağlantısı stage/connect/disconnect/idempotent replay yapar. İlişkisiz
   sentetik orphan credential disconnect sırasında korunur. Ardından privacy
   worker ile installation cascade ve tarihsel tablo temizliği sınanır.
5. Fixture'lar rollback ile sıfıra döner. Retirement tam transaction olarak
   uygulanır ve nihai şema hash'i kaydedilir. Forced RLS, function-only table
   grant'ları, security-definer `search_path` ve public API rol erişimleri katalog
   sorgularıyla test edilir.
6. İlk local database durdurulur ve ona ait geçici volume silinir. İkinci boş
   local database'de 39 dosyanın tamamı çalıştırılır. Nihai şema ilk koşunun
   sonucuyla karşılaştırılır. Testler bitince bu geçici ortam da kapatılır.

Rollback'li senaryolarda retirement dosyasının yalnız dış `begin/commit`
sarmalayıcısı kaldırılır; bütün guard, DDL, role ve timeout gövdesi aynen çalışır.
Bağımlılık hatası geç aşamadaki DDL'nin de rollback olduğunu kontrol eder.
Son iki tam uygulamada dosyanın dış transaction'ı dahil orijinal içeriği kullanılır.

## Sonucun anlamı

GitHub loglarındaki `F01B_SCENARIO_PASS` kayıtları çalışan SQL senaryolarıdır.
`F01B_EVIDENCE` version, migration sayısı, schema hash ve parity sonucunu verir.
`F01B_STOP` başarısız adımda çalışmayı durdurur. Migration dosyası adı uygulamadan
önce yazıldığı için hata hangi migration'da oluştuğu belirlenebilir.

Yerel Node testlerinin geçmesi database provasının PASS olduğu anlamına gelmez.
Katalog güvenlik testleri Supabase Cloud Advisor servisini çalıştırmış sayılmaz.
Cloud Advisor ve backup/PITR kanıtı F01-C canlı kapısında ayrıca alınır. F08'de
kayıtlı index bulguları bu pakette düzeltilmez.

## Resmî dayanak

18 Ekim 2026: [PostgreSQL SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html)
belgesi de kontrol edildi. `SET LOCAL ROLE` mevcut rol üyeliğini transaction
içinde kullanır; yeni grant veya rol niteliği değişikliği değildir.

18 Ekim 2026 tarihinde Supabase Docs Connector üzerinden kontrol edildi:

- [GitHub Actions ve local database yönetimi](https://supabase.com/docs/guides/deployment/managing-environments)
- [Database test yöntemleri](https://supabase.com/docs/guides/local-development/testing/overview)
- [CLI test ve lint araçları](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)

`init`, `db start`, `db reset` ve `stop` komutları CLI'ın `--help` çıktısıyla
doğrulandı. Workflow'da remote `link`, `push`, `repair`, `apply_migration` veya
Production deploy adımı yoktur.
