# F01 — Migration geçmişi ve canlı şema uzlaştırması

**Tarih:** 18 Ekim 2026

**Güncel sonuç:** F01 canlı uygulama ve son kontroller PASS; ürün sahibi 18 Ekim 2026'da kapanışı ve PR #102'nin birleştirilmesini onayladı.

> Güncel iş sırası `docs/EXECUTION_PLAN.md` içindedir. Migration, veritabanı değişikliğini sıralı dosyayla kaydetme yöntemidir. Bu belge F01'in kabul edilmiş sonucu ile o sonuca giderken kullanılan hazırlığı ayırır. Aşağıdaki bekleyen işler hazırlık tarihine aittir; F01'i yeniden açmaz, yeni prova veya canlı işlem yetkisi vermez.

## 18 Ekim 2026 — Canlı uygulama sonucu

Ürün sahibi PR #101'in birleştirilmesini, ardından yalnız bu işlem için test edilmiş
dar şema geri dönüşünün kabulünü ve birebir devreden çıkarma migration'ının
uygulanmasını ayrı ayrı onayladı. Bu kabul tam veritabanı yedeği/PITR bulunduğu
anlamına gelmez.

- Migration bir kez uygulandı ve başarılı oldu. Supabase'in verdiği gerçek
  sürüm `20261018152910`; hazırlık sürümü `20261018131548` idi. Yalnız yeni
  dosya adı gerçek sürüme eşlendi; SQL gövdesi ve ilk 38 kayıt değiştirilmedi.
- Altı eski fonksiyon kaldırıldı. Aktif dönüş fonksiyonu aynen korundu; finalize
  gövdesi izole ortamda test edilen hash ile eşleşti. Runtime EXECUTE yetkileri korundu.
- Üç bağlantı, dört kimlik bilgisi ve sekiz tarihsel satırın öncesi/sonrası
  parmak izleri aynı. F02'deki sahipsiz kimlik bilgisine dokunulmadı.
- Dokuz şema kategorisi beklenen nihai yapıyla karşılaştırıldı: Yalnız planlanan
  fonksiyon/policy farkları var. Forced RLS ve yalnız fonksiyon çalıştırma sınırı korundu.
- Security Advisor: 0 bulgu. Daha önce F08'e kaydedilen iki yabancı anahtar (FK)
  indeks eksiği ve 12 kullanılmayan indeks INFO bildirimi o aşamada sürdü;
  bu işlemde değiştirilmedi.
- Gerçek bağlantılarda bağlantı kesme veya gizlilik amaçlı silme testi yapılmadı.
  Bu davranışların izole prova kanıtı ile canlı fonksiyon tanımı/yetki eşliği
  birlikte kullanıldı. Gerçek sağlayıcı çağrısı yapılmadı.

Kanıt: `docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
İşlem sonrası 39 kayıt: `docs/evidence/A6_TECH_01_F01_POST_MIGRATION_LEDGER_2026-10-18.json`.
Yalnız adları okuyan ilk kontrol sorgusunda ajan yanlış kolon kullandığı için
`42703` alındı; değişiklik yapılmadan duruldu. Düzeltme yalnız yeni kullanıcı
onayından sonra çalıştırıldı. Bu ilk hata kanıtta korunur.

F01 ürün sahibi kabulüyle kapandı. Kabul kaydı PR #102 içinde tutulur;
birleştirme öncesi son commit'in CI'ının geçmesi de zorunluydu. Kanıt:
`docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
O andaki sıradaki bulgu F02'ydi; bu kapanış F02 uygulamasını veya yeni canlı
işlemi yetkilendirmedi. Aşağıdaki anlatım tarihsel hazırlık kaydıdır.

## Kullanıcı açısından F01-A hazırlığının sonucu

Veritabanının geçmişi repository'de izlenebilir hale getirildi: Canlı migration
defterindeki 38 kayıt için karşılık gelen dosya, canlı sürüm numarası, önceki
repository yolu, kaynak commit ve SQL hash'i vardır. Yeni kontrol; dosyanın
kaybolmasını, aynı isimle farklı sürüm eklenmesini veya geçmiş SQL'in sessizce
değiştirilmesini reddeder.

Bu hazırlık tek başına sıfırdan kurulum veya canlı şema düzeltmesi kanıtı değildi.
F01 o kapılar tamamlanana kadar açık kaldı. Çalışma sırası F01 → F02 → F03 →
F04 → F05 → F06 → F07 → F08 → F09 → F10 olarak korundu.

## Neden oluştu?

Repository SQL dosyalarının planlanan zaman damgaları ile Supabase'e uygulama
anında migration defterine yazılan zaman damgaları farklıydı. Ayrıca Google'ın
eski yetkilendirme devir akışına ait altı migration canlıya uygulanmış, fakat
güncel `main` SQL dizininde kalmamıştı. Kaynak testleri SQL metinlerini inceliyor;
migration defteri eşliği veya temiz PostgreSQL kurulumu çalıştırmıyordu.

## F01-A kapsamında değişenler

1. Mevcut 32 dosya canlıdaki gerçek sürüm numaralarına taşındı. SQL gövdeleri
   değiştirilmedi. Aktif sözleşme, belge ve test referansları yeni yolları kullanır.
2. Git geçmişindeki altı dosya, canlı migration defterindeki uygulanmış SQL ile
   hash karşılaştırılarak geri getirildi. Eski akışı etkinleştirmek için yeniden
   canlıya uygulanmaz; geçmiş zinciri tamamlar.
3. `contracts/a6-tech-01-f01-migration-lineage-v1.json` 38 kaydın eşlemesini ve
   o hazırlık anında henüz uygulanmamış tek devreden çıkarma migration'ını taşır.
4. `tools/check-migration-lineage.mjs` repository dosyalarını ve yalnız adları
   içeren defter kaydını karşılaştırır. CI testleri eksik dosya, değişen SQL,
   mükerrer sürüm/isim ve beklenmeyen canlı migration durumlarını reddeder.
5. Devreden çıkarma SQL'i resmî `supabase@2.121.0 migration new` komutuyla oluşturuldu.
   CLI geçici paket önbelleğinde çalıştırıldı; global kurulum, bağımlılık veya
   lockfile değişikliği yapılmadı.

Değişmez eski canlı kabul kanıtlarındaki dosya yolları değiştirilmedi. Bu yollar,
eşleme kaydındaki `previous_repository_file` ile yeni dosyaya bağlanır.

## Hash eşliği neyi kanıtlıyor?

Hash yöntemi UTF-8 SHA-256'dır. Yalnız CRLF → LF ve dış boşluk temizliği yapılır;
SQL içindeki ifadeler veya boşluklar standartlaştırılmaz.

38 kaydın 32'sinde repository SQL'i uygulanan SQL ile bu yöntemle aynıdır.
Kalan altı fark açıkça kaydedilmiştir:

| Kayıt | Fark | Değerlendirme |
| --- | --- | --- |
| `eo02c_shopify_app_pricing_entitlement` | Canlı ilk sürüm kolon listeli `ON CONFLICT`, repository adlandırılmış constraint kullanır | Takip eden `eo02c_disambiguate_upserts` düzeltmesi zincirde korunur |
| Dört EO-03-D düzeltme migration'ı | Canlı metin ek oturum-rol sarmalayıcısı taşır | Repository'nin yalnız transaction içinde geçerli rol sınırı korunur; gövde farkı yok |
| `eo04c_reporting_account_completion` | Repository `begin/commit` sarmalayıcısı taşır | Canlı uygulama motorunun transaction davranışıyla dosya metni aynı şey sayılmaz |

Eşleme hem repository hem uygulanan SQL hash'ini tutar. Bu kayıtlar bütün canlı
şemanın hash eşliğini veya geçmişin bayt bayt aynı olduğunu iddia etmez.
Migration defterine `repair`, yeniden adlandırma, silme veya doğrudan yazma yapılmadı.

## Devreden çıkarılacak yüzey — tarihsel tasarım

18 Ekim salt okunur kontrolünde eski tabloda 2 `consumed`, 6 `failed` satır,
0 bekleyen seçim ve 0 kimlik bilgisi referansı görüldü. Altı eski devir fonksiyonu
runtime tarafından çalıştırılabiliyordu. Uygulama bu altı fonksiyonu çağırmıyordu.

Önceki tasarımdaki **yedi fonksiyon kaldırılacak** ifadesi düzeltilmiştir:
`shopify.resolve_active_installation_callback_return` Meta, Google ve Klaviyo
repository'leri tarafından kullanılır ve korunur. Kaldırılacak fonksiyon sayısı
altıdır. Aktif `integrations.finalize_provider_disconnect` de korunur; gövdesi
kabul edilmiş kanonik sürüme getirilerek eski devir tablosuna yazması kaldırılır.
Normal bağlantı kesmenin kendi kimlik bilgisini kaldırması sürer.

Tasarlanan devreden çıkarma migration'ı:

- 5 saniye kilit, 30 saniye SQL ifade sınırıyla tek transaction kullanır.
- Eski tabloyu özel kilitleyip bütün satırların sonlanmış durumda ve kimlik
  bilgisi referanslarının boş olduğunu doğrular. Şart bozulursa transaction durur.
- Aktif dönüş fonksiyonunu ve runtime EXECUTE yetkisini doğrular.
- Altı fonksiyonu birebir imzasıyla ve `RESTRICT` ile kaldırır; `CASCADE` kullanmaz.
- Tabloyu, sekiz tarihsel satırı, yabancı anahtarları ve gizlilik silme zincirlerini
  korur. Sahibin policy'sini SELECT ile sınırlar; runtime'a doğrudan tablo yetkisi vermez.
- F02'de incelenecek sahipsiz kimlik bilgisi üzerinde işlem çalıştırmaz.

## F01-A yerel doğrulaması — tarihsel kanıt

F01-A teslim kontrolü: **397/397 test**, typecheck ve canlı ortam derlemesi başarılı.
Önceden kayıtlı beş React Router gelecek sürüm uyarısı sürer; bunlar F10 kapsamındadır.
Git diff boşluk kontrolü başarılıdır.

`pnpm test` içindeki yeni testler yalnız defter/dosya doğrulayıcısını, olumsuz
uyumsuzluk örneklerini ve devreden çıkarma SQL sınırlarını kontrol eder.
Bunlar PostgreSQL çalıştırma testi değildir.

Manuel yerel kontrol:

```text
node tools/check-migration-lineage.mjs
node tools/check-migration-lineage.mjs <yeni-name-only-ledger-snapshot.json>
```

Kayıt yalnız `migrations` dizisinde `version`, `name`, `applied_sql_sha256`
alanlarını gerektirir. Varsayılan kontrol 18 Ekim kaydını kullanır ve yeni canlı
okuma yapmaz. Geçmesi, güncel canlı şema eşliği PASS anlamına gelmez.

## F01-B — İzole veritabanı provası: tarihsel yöntem

Tekrarlanabilir GitHub test makinesi düzeneği ve sonuç kaydı
`docs/A6_TECH_01_F01B_DATABASE_REPLAY.md` dosyasındadır. Yerel kaynak testi ile
gerçek veritabanı koşusunun durumları ayrı tutulur.

Hazırlık tarihinde bu makinede Docker yoktu. F01-A'da Docker kurulmadı veya yeni
Supabase projesi açılmadı. Sonraki kapı onaylı izole PostgreSQL 17/Supabase
ortamı gerektiriyordu. Production kimlik bilgisi veya iş verisi bu ortama taşınmaz.

Prova sırası:

1. Boş ve izole Supabase/PostgreSQL 17 ortamında mevcut 38 tarihsel migration'ı
   sürüm sırasıyla uygula. Yönetilen roller, pgcrypto ve pg_cron gereksinimleri
   nedeniyle düz SQLite/bellek içi taklit kabul edilmez.
2. Tarihsel zincirin sonunda tablo, constraint, fonksiyon, sahip, policy ve yetki
   envanterini canlı üst veri kaydıyla karşılaştır. Metin hash'ini şema eşliği sayma.
3. Devreden çıkarma için dört bağımsız, geri alınan senaryoyu çalıştır: Boş tarihsel
   tablo; sonlanmış ve kimlik bilgisi referansı olmayan satırlar; bekleyen seçim;
   kimlik bilgisi taşıyan satır. İlk ikisi başarılı, son ikisi ön koşul hatası vermeli;
   satır, fonksiyon ve yetki durumu değişmemelidir.
4. İkinci bağlantıdan tabloya eşzamanlı yazma denemesiyle kilit/zaman aşımını doğrula.
   Başarısız DDL veya bağımlılık durumunda transaction'ın geri alınmasını test et.
5. Başarıdan sonra altı fonksiyonun yokluğunu, dönüş ve kanonik bağlantı kesmenin
   çalışmasını, tarihsel satır sayısının değişmediğini, forced RLS ve rol yetki
   sınırlarını doğrula. Mevcut yaşam döngüsü/gizlilik kontrollerini çalıştır.
6. Tam 39 migration zincirini ikinci boş ortamda sıfırdan uygula; ilk nihai şemayla
   karşılaştır. Security/Performance Advisor sonucunu kaydet.

Bu, ilk hazırlık yöntemidir; sonraki F01-B sonucu yalnız katalog kontrollerini
Cloud Advisor çalışması gibi sunmaz. Bu provalar geçmeden F01-A dosyalarının
canlıya uygulanmaması gerekiyordu; sonuç ve kabul belgenin başındadır.

## F01-C — Ayrı canlı onay kapısı: tarihsel plan ve kabul sınırı

İlk plan izole provadan sonra yedek/PITR ve geri dönüş kanıtı istiyordu.
Son kabulde tam veri yedeği varmış gibi gösterilmedi: Yalnız F01 için test edilmiş
dar şema kurtarma alternatifi açıkça kabul edildi. Ayrıntı
`docs/A6_TECH_01_F01C_SCOPED_RECOVERY.md` ve F01 kapanış kanıtındadır.

Ürün sahibi birebir devreden çıkarma migration'ını canlı uygulama için ayrıca
onayladı. Canlı migration defterindeki ilk 38 kayıt değiştirilmedi ve yeniden
çalıştırılmadı; yalnız yeni 39. migration uygulandı. Deployment/veritabanı
otomasyonu hazırlık PR'ıyla açılmadı.

İlk hata sonrasında yeni onay olmadan tekrar deneme veya alternatif uygulama rotası
kullanılmaz. Commit öncesi hata transaction geri almasıyla kapanır. Commit sonrası
geri dönüş gerekirse korunmuş tarihsel SQL'den yeni, geçmişi değiştirmeden ilerleyen
migration hazırlanır ve ayrıca onaylanır; eski devir fonksiyonlarının runtime
yetkisi otomatik geri açılmaz.

İşlem sonrası yeni defter, altı fonksiyonun yokluğu, dönüş/bağlantı kesme ve gizlilik
yaşam döngüsü, bağlantı/kimlik bilgisi sayıları, tarihsel satırlar ve Advisor
kontrolleri kabul kapısıydı. Canlıda gerçekten yapılan kontrolün sınırı baştaki
sonuçta açıklanır; izole davranış testi yeni gerçek hesap testi sayılmaz.
F01 kapanış kabulü olmadan F02 başlamama kuralı korundu.

## Resmî kaynaklar

18 Ekim 2026 tarihinde kontrol edilen kaynaklar:

- [Supabase ortam/migration yönetimi](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase canlı ortam olgunluk modeli](https://supabase.com/docs/guides/deployment/maturity-model)
- [CLI migration list referansı](https://supabase.com/docs/reference/cli/supabase-migration-list)
- [Supabase kırıcı değişiklik kayıtları](https://supabase.com/changelog?types=breaking-change)

CLI komutları kullanılmadan önce `--help` ile doğrulandı. Tarihsel tasarımda
Supabase Postgres Best Practices yönergesinin en az yetki ve kısa transaction
kuralları; birebir fonksiyon listesi, `RESTRICT` ve zaman aşımı sınırlarına uygulandı.
