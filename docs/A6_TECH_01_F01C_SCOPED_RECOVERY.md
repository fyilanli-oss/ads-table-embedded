# F01-C — Dar kapsamlı şema kurtarma hazırlığı

**Tarih:** 18 Ekim 2026

**Güncel sonuç:** Dar prova PASS; yalnız F01 için kapsam kabul edildi, PR #101 birleştirildi ve eski yüzeyi devreden çıkarma işlemi canlıda başarıyla uygulandı. Ürün sahibi F01 kapanışını ve PR #102'nin birleştirilmesini 18 Ekim 2026'da onayladı.

Güncel iş sırası `docs/EXECUTION_PLAN.md` içindedir. F01'in sonucu ve açık sınırları
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` başındaki canlı uygulama kaydındadır.
Aşağıdaki bekleyen onaylar hazırlık tarihine aittir; yeniden işlem talebi değildir.
Bu dil düzenlemesi F01'i açmaz, yeni prova veya canlı işlem yetkisi vermez.

## Gerçek prova sonucu — tarihsel kanıt

[39137629146 numaralı koşu](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39137629146),
`977ab611fda862a3d71c6e1b8c7d982a8c230ec7` kaynak commit'ini PostgreSQL 17.11
üzerinde çalıştırdı. Sekiz sonlanmış sentetik kayıtta kurtarma, geç aşama hatasında
işlemi geri alma, üst veri/satır koruması ve kurtarma sonrası yaşam döngüsü/gizlilik
kontrolleri geçti. Devreden çıkarma COMMIT → ayrı kurtarma COMMIT → devreden çıkarma
COMMIT zinciri de geçti. Son şema, ikinci 39 migration kurulumu ve önceki F01-B
sonucu ile birebir aynı:
`1a26e26bc6d905f6369599d209b5d76ea5c725444f42d3bc0389b3a829ab62b4`.

Yedi fonksiyon geri kuruldu; eski altı fonksiyonun runtime EXECUTE yetkisi kapalı kaldı.
Test edilen kurtarma SQL'inin SHA-256 değeri:
`954dc40d045601e2cc2600b76b65ecf05b2e284972e4d63ac183f5288706acec`.
Üretici araç bu SQL'i veritabanı bağlantısı olmadan yeniden üretebilir; devreden çıkarma
sonrası beklenen finalize hash'i çıktıda sabittir, farklı kaynak durumu reddedilir.
İki geçici ortam temizlendi. 415 yerel test, typecheck ve build PASS.

Kanıt: `docs/evidence/A6_TECH_01_F01C_SCOPED_RECOVERY_PASS_2026-10-18.json`.
Sonucu kaydeden son commit'in CI durumu ayrıca PR'da doğrulanır; sonuç kaydı
için sürekli yeni commit üretilmez. İlk duruş kanıtı aynen korunur.
Tam veri yedeği/PITR kanıtı **yoktur**; sözleşmenin tam yedek kapısı PASS değildir.

İlk gerçek koşu `39137350657`, mevcut F01-B senaryoları geçtikten sonra yeni
kurtarma üreticisinin SQL ifade ayıracı eksikliğiyle durdu (`42601`).
`pg_get_functiondef` kaynakları son SQL noktalı virgülünü içermez; üretici araç
tanımları REVOKE ifadelerinden önce ayırmalıdır. Düzeltme yalnız üretici araçtadır;
kaydedilmiş gövdeler ve tarihsel migration'lar değiştirilmez. Kanıt
`docs/evidence/A6_TECH_01_F01C_FIRST_RECOVERY_STOP_2026-10-18.json` içindedir.

## Hazırlık tarihindeki analist özeti

Supabase ekranı projenin Free Plan'da olduğunu ve platform yedeği sunulmadığını
doğruladı. Kullanıcı tam veri dışa aktarma/saklama çalışmasını o aşamada açmak
istemedi; yalnız devreden çıkarma işleminin değiştirdiği fonksiyon/yetki yapısı
için dar geri dönüş istedi. Bu çalışma satış veya kimlik bilgisi verisini dışarı
almaz; tam veritabanı yedeği veya PITR sağlamaz.

Sözleşmedeki `backup_restore_evidence` kapısı bu nedenle otomatik PASS olmaz.
Bu dar korumanın F01 devreden çıkarma işlemine yeterli kabul edilmesi ayrı ve açık
ürün sahibi kararı gerektiriyordu; belgenin başındaki kapanış bu sınırlı kabulü
kaydeder. Geri alma sonrasında neyin korunmadığı gizlenemez. Tam veri kurtarma,
platform arızası ve işlem dışı veri kaybı koruması bu hazırlığın kapsamı dışındadır.

## Korunan kaynak ve davranış

- Kaynak main: `1ae095052d623673be7377a17d4c62ba220bbd2c`.
- `contracts/a6-tech-01-f01c-scoped-recovery-v1.json` canlıdan salt okunur alınmış
  yedi fonksiyonun SQL tanımlarını, sahibini ve SHA-256 değerlerini taşır.
  İş verisi satırı veya kimlik bilgisi değeri içermez. Tanımlar önceki değişmez
  canlı şema üst veri hash'leriyle birebir eşleşmek zorundadır.
- `tools/f01-scoped-recovery.mjs` yalnız bu yedi tanımdan transaction içeren SQL
  üretir. Transaction, bütünüyle tamamlanan veya geri alınan işlem birimidir.
  Dosya otomatik migration veya canlı çalıştırıcı değildir.
- Kurtarma yalnız devreden çıkarma sonrası beklenen durumda çalışır: Eski altı
  fonksiyon yoktur; tarihsel tablo yalnız sahibin okumasına izin veren policy'dedir;
  satırlar sonlanmış ve kimlik bilgisi referansından arınmıştır; aktif finalize
  fonksiyonunun hash'i beklenen değerdedir.
- Eski altı fonksiyon yalnız sahibine açık geri kurulur; runtime, anon, authenticated,
  service_role ve PUBLIC erişimi açılmaz. Aktif kanonik finalize fonksiyonunun
  önceki gövdesi ve runtime EXECUTE erişimi korunur. Dönüş fonksiyonu değiştirilmez.
- Finalize gövdesinin eski tablo yazımlarını doğru çalıştırabilmesi için önceki,
  yalnız sahibine açık ALL policy geri kurulur. Runtime'a tablo DML erişimi verilmez.

Bu, eski yetkilerin tamamını geri açan birebir geri alma değildir: Altı eski
fonksiyonun runtime yetkisi özellikle kapalı kalır. Normal bağlantı kesmenin
kendi kimlik bilgisini silmesi kabul edilmiş uygulama davranışıdır; kurtarma SQL'i
tek başına hiçbir iş verisi satırına INSERT/UPDATE/DELETE uygulamaz.

## Gerçek izole provanın kabul kapısı — tarihsel yöntem

F01-B'nin mevcut tek PR iş akışı ve aynı PostgreSQL 17 ortamı kullanılır:

1. Sekiz sonlanmış sentetik kayıtta devreden çıkarma uygulanır; kurtarmanın sonuna
   kasıtlı SQL hatası eklenir. Bütün DDL/yetki değişikliklerinin geri alındığı ve
   satırların korunduğu doğrulanır.
2. Kurtarma başarıyla uygulanır. Yedi fonksiyonun tanımı, sahibi, güvenliği,
   search_path'i ve diğer bütün üst verisi; eski altı runtime EXECUTE farkı dışında
   başlangıç şemasıyla karşılaştırılır. Tarihsel satır hash'i ve bağlantı/kimlik
   bilgisi sayıları değişmemelidir. Dönüş/yaşam döngüsü/gizlilik davranışı sınanır.
3. Boş izole ortamda devreden çıkarma gerçekten COMMIT edilir; kurtarma ayrı tam
   transaction olarak COMMIT edilir, ardından testte devreden çıkarma tekrar
   uygulanır. Nihai şema F01-B'nin sonucu ile birebir eşleşmelidir.
4. İkinci sıfırdan 39 migration kurulumu ve bağımsız temizlik kontrolleri korunur.

Testte SQL'in tekrar uygulanması canlı migration defterini tekrar oynatma izni
değildir. Canlıda kurtarma gerekirse ayrı onaylı, yeni sürüm numaralı, geçmişi
değiştirmeden ilerleyen migration hazırlanır; eski defter kayıtları silinmez/değiştirilmez.

## Kapanıştan önce gereken kararlar — tarihsel sıra

Dar prova PASS olsa bile sırasıyla dar korumanın kapsam/risk kabulü, hazırlık
PR'ının birleştirme onayı, birebir devreden çıkarma migration'ının canlı uygulama
onayı ve işlem sonrası kontroller gerekiyordu. F01 kapanmadan F02 başlamama
kuralı korundu. Bu onayların tamamlandığı baştaki kabul kaydında belirtilir;
bugün yeniden istenmez ve bu belge yeni bir canlı işlem başlatmaz.

18 Ekim 2026 resmî kontrol kaynakları:

- [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)
- [Supabase yedek kapsamı](https://supabase.com/docs/guides/platform/backups)

Supabase/Postgres en az yetki rehberi nedeniyle eski runtime erişimi otomatik
geri açılmadı. Yeni bulut projesi, ücretli plan, canlı DDL veya veri taşıma yoktur.
