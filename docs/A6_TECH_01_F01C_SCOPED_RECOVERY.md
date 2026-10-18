# F01-C — Dar kapsamlı şema kurtarma hazırlığı

**Tarih:** 18 Ekim 2026

**Durum:** Repository/izole prova hazırlığı. Canlı uygulama veya merge onayı yoktur.

## Analist özeti

Supabase ekranı bu projenin Free Plan'da olduğunu ve platform yedeği sunulmadığını
doğruladı. Kullanıcı tam veri dışa aktarma/saklama çalışmasını şu aşamada açmak
istemedi; yalnız retirement işleminin değiştirdiği fonksiyon/yetki yapısı için
dar geri dönüş hazırlanmasını istedi. Bu çalışma satış/credential verisini
dışarı almaz; tam database backup veya PITR sağlamaz.

Mevcut sözleşmedeki `backup_restore_evidence` kapısı bu nedenle otomatik PASS
olmaz. Bu dar korumanın F01 retirement işlemi için kabul edilmesi ayrı ve açık
ürün sahibi kararı gerektirir. Karar, rollback sonrasında neyin korunmadığını
gizlememelidir. Tam veri kurtarma, platform arızası ve işlem dışı veri kaybı
koruması bu hazırlığın kapsamı dışındadır.

## Korunan kaynak ve davranış

- Kaynak main: `1ae095052d623673be7377a17d4c62ba220bbd2c`.
- `contracts/a6-tech-01-f01c-scoped-recovery-v1.json` canlıdan salt-okunur
  alınmış yedi fonksiyonun SQL tanımlarını, owner ve SHA-256 değerlerini taşır.
  Business satır veya credential değeri içermez. Tanımlar önceki immutable
  canlı şema metadata hash'leriyle birebir eşleşmek zorundadır.
- `tools/f01-scoped-recovery.mjs` yalnız bu yedi tanımdan transaction'lı SQL
  üretir. Dosya bir otomatik migration veya canlı çalıştırıcı değildir.
- Recovery yalnız retirement sonrası beklenen durumda çalışır: eski altı
  fonksiyon yok, tarihsel tablo owner-read policy'sinde, terminal/credential-free
  durumda ve aktif finalize fonksiyonunun hash'i beklenen değerdedir.
- Eski altı fonksiyon owner-only geri kurulur; runtime, anon, authenticated,
  service_role ve PUBLIC erişimi açılmaz. Aktif canonical finalize fonksiyonunun
  önceki gövdesi ve runtime EXECUTE erişimi korunur. Callback değiştirilmez.
- Finalize gövdesinin eski tablo yazımlarını doğru çalıştırabilmesi için önceki
  owner-only ALL policy geri kurulur. Runtime tablo DML erişimi verilmez.

Bu, eski yetkilerin tamamını geri açan birebir rollback değildir: altı eski
fonksiyonun runtime yetkisi özellikle kapalı kalır. Normal bağlantı kesmenin
kendi credential'ını silmesi kabul edilen uygulama davranışıdır; kurtarma SQL'i
tek başına hiçbir business satırı INSERT/UPDATE/DELETE etmez.

## Gerçek izole prova kapısı

F01-B'nin mevcut tek PR workflow'u ve aynı PostgreSQL 17 ortamı kullanılır:

1. Sekiz terminal sentetik kayıtta retirement uygulanır; recovery'nin sonuna
   kasıtlı SQL hatası eklenir. Bütün DDL/grant değişikliklerinin rollback olduğu
   ve satırların korunduğu doğrulanır.
2. Recovery başarılı uygulanır. Yedi fonksiyon tanımı/owner/security/search_path
   ve diğer bütün metadata, altı legacy runtime EXECUTE farkı dışında başlangıç
   şemasıyla karşılaştırılır. Tarihsel satır hash'i ve connection/credential
   sayıları değişmemelidir. Callback/lifecycle/privacy davranışı sınanır.
3. Boş izole ortamda retirement gerçekten COMMIT edilir; recovery ayrı tam
   transaction olarak COMMIT edilir ve testte retirement tekrar uygulanır.
   Nihai şema F01-B'nin sonucu ile birebir eşleşmelidir.
4. İkinci sıfırdan 39 migration kurulumu ve bağımsız cleanup kontrolleri korunur.

Testte SQL'in tekrar uygulanması canlı migration defterini tekrar oynatma izni
değildir. Canlıda kurtarma gerekirse ayrı onaylı, yeni version'lı forward
migration hazırlanır; eski ledger kayıtları silinmez/değiştirilmez.

## Hâlâ gerekli olan kararlar

Dar prova PASS olsa bile sırasıyla: bu dar korumanın kapsam/risk kabulü,
hazırlık PR'ının merge onayı, exact retirement migration'ı için canlı uygulama
onayı ve işlem sonrası kontroller gerekir. F01 kapanmadan F02 başlamaz.

18 Ekim 2026 resmî kontrol kaynakları:

- [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)
- [Supabase backup kapsamı](https://supabase.com/docs/guides/platform/backups)

Supabase/Postgres en-az-yetki rehberi nedeniyle legacy runtime erişimi otomatik
geri açılmamıştır. Yeni cloud proje, ücretli plan, canlı DDL veya data carry yoktur.
