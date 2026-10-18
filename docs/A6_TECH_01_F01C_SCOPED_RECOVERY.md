# F01-C — Dar kapsamlı şema kurtarma hazırlığı

**Tarih:** 18 Ekim 2026

**Güncel durum:** Dar prova PASS; yalnız F01 için kapsam kabul edildi, PR #101 merge edildi ve canlı retirement başarıyla uygulandı. Kapanış kabulü bekleniyor.

Güncel sonuç ve açık sınırlar `docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md`
başındaki canlı uygulama kaydındadır. Aşağıdaki hazırlık anındaki bekleyen
onay ifadeleri tarihsel durumu açıklar; yeni bir canlı işlem yetkisi vermez.

## Gerçek prova sonucu

[39137629146 numaralı koşu](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/39137629146),
`977ab611fda862a3d71c6e1b8c7d982a8c230ec7` kaynak commit'ini PostgreSQL 17.11
üzerinde çalıştırdı. Sekiz terminal sentetik kayıtta recovery, geç aşama hata
rollback'i, metadata/satır koruması ve recovery sonrasında lifecycle/privacy geçti.
Retirement COMMIT → ayrı recovery COMMIT → retirement COMMIT zinciri de geçti.
Son şema, ikinci 39 migration kurulumu ve önceki F01-B sonucu ile birebir aynı:
`1a26e26bc6d905f6369599d209b5d76ea5c725444f42d3bc0389b3a829ab62b4`.

Yedi fonksiyon geri kuruldu; eski altı runtime EXECUTE yetkisi kapalı kaldı.
Test edilen recovery SQL SHA-256:
`954dc40d045601e2cc2600b76b65ecf05b2e284972e4d63ac183f5288706acec`.
Generator bu SQL'i database bağlantısı olmadan yeniden üretebilir; beklenen
retired finalize hash'i artık artifact'te sabittir ve farklı kaynak durumu reddedilir.
İki geçici ortam temizlendi. 415 yerel test, typecheck ve build PASS.

Kanıt: `docs/evidence/A6_TECH_01_F01C_SCOPED_RECOVERY_PASS_2026-10-18.json`.
Bu sonucu kaydeden son commit'in CI durumu ayrıca PR'da doğrulanır; sonuç kaydı
için sürekli yeni commit üretilmez. İlk duruş kanıtı aynen korunur.
Tam veri backup/PITR kanıtı **yoktur**; sözleşmenin backup kapısı PASS değildir.

İlk gerçek koşu `39137350657`, mevcut F01-B senaryoları geçtikten sonra yeni
recovery generator'ının statement ayıracı eksikliğiyle durdu (`42601`).
`pg_get_functiondef` kaynakları son SQL noktalı virgülünü içermez; generator
tanımları REVOKE ifadelerinden önce ayırmalıdır. Düzeltme yalnız generator'dadır;
kaydedilmiş gövdeler ve tarihsel migration'lar değiştirilmez. Kanıt
`docs/evidence/A6_TECH_01_F01C_FIRST_RECOVERY_STOP_2026-10-18.json` içindedir.

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
