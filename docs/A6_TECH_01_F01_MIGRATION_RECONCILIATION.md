# F01 — Migration geçmişi ve canlı şema uzlaştırması

**Tarih:** 18 Ekim 2026

**Güncel durum:** F01 canlı uygulama ve son kontroller PASS; kapanış kabulü bekleniyor.

## 18 Ekim 2026 — Canlı uygulama sonucu

Ürün sahibi PR #101 merge'ünü, ardından yalnız bu işlem için test edilmiş dar
şema geri dönüşünün kabulünü ve exact retirement migration'ının uygulanmasını
ayrı ayrı onayladı. Bu kabul tam database backup/PITR bulunduğu anlamına gelmez.

- Migration bir kez uygulandı ve başarılı oldu. Supabase'in verdiği gerçek
  version `20261018152910`; hazırlık version'ı `20261018131548` idi. Yalnız yeni
  dosya adı gerçek version'a eşlendi; SQL gövdesi ve ilk 38 kayıt değiştirilmedi.
- Altı eski fonksiyon kaldırıldı. Aktif callback aynen korundu; finalize gövdesi
  izole ortamda test edilen hash ile eşleşti. Runtime EXECUTE yetkileri korundu.
- Üç connection, dört credential ve sekiz tarihsel satırın öncesi/sonrası
  parmak izleri aynı. F02'deki sahipsiz credential'a dokunulmadı.
- Dokuz şema kategorisi beklenen nihai yapıyla karşılaştırıldı: yalnız planlanan
  function/policy farkları var. Forced RLS ve function-only sınırı korundu.
- Security Advisor: 0 bulgu. Önceden F08'e kaydedilen iki FK index eksiği ve
  12 unused-index INFO bildirimi sürüyor; bunlar bu işlemde değiştirilmedi.
- Gerçek bağlantılar üzerinde disconnect veya privacy silme testi yapılmadı;
  bu davranışların izole prova kanıtı ile canlı definition/grant eşliği birlikte
  kullanıldı. Gerçek provider çağrısı yapılmadı.

Kanıt: `docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
Güncel 39 kayıt: `docs/evidence/A6_TECH_01_F01_POST_MIGRATION_LEDGER_2026-10-18.json`.
İlk name-only kontrol sorgusunda ajan yanlış kolon kullandığı için `42703`
alındı; mutation yapılmadan duruldu. Düzeltme yalnız yeni kullanıcı onayından
sonra çalıştırıldı. Bu ilk hata kanıtta korunur.

Kalan tek kapı kapanış kaydının CI/merge ve ürün sahibi kabulüdür. F01 hâlâ
otomatik kapatılmaz; F02 başlamaz. Aşağıdaki hazırlık anlatımı tarihsel bağlamdır.

## Kullanıcı açısından sonuç

Database'in geçmişi artık repository'de izlenebilir: canlı migration defterindeki
38 kayıt için karşılık gelen dosya, canlı version numarası, önceki repository yolu,
kaynak commit ve SQL hash'i vardır. Yeni bir kontrol, dosyanın kaybolmasını, aynı
isimle farklı version eklenmesini veya geçmiş SQL'in sessizce değiştirilmesini
reddeder.

Bu hazırlık database'in sıfırdan kurulabildiğini veya canlı şemanın düzeldiğini
kanıtlamaz. F01 bu kapılar tamamlanana kadar açık kalır. Sıra F01 → F02 → F03 →
F04 → F05 → F06 → F07 → F08 → F09 → F10 olarak korunur.

## Neden oluştu?

Repository SQL dosyalarının planlanan timestamp'leri ile Supabase'e uygulama
anında migration defterine yazılan timestamp'ler farklıydı. Ayrıca Google'ın eski
handoff akışına ait altı migration canlıya uygulanmış, fakat güncel `main` SQL
dizininde kalmamıştı. Kaynak testleri SQL metinlerini inceliyor; migration defteri
eşliği veya temiz PostgreSQL kurulumu çalıştırmıyordu.

## F01-A kapsamında değişenler

1. Mevcut 32 dosya canlıdaki gerçek version numaralarına taşındı. SQL gövdeleri
   değiştirilmedi. Aktif contract, belge ve test referansları yeni yolları kullanır.
2. Git geçmişindeki altı dosya, canlı migration defterindeki uygulanan SQL ile
   hash karşılaştırması yapılarak geri getirildi. Bunlar eski akışı etkinleştirmek
   için yeniden canlıya uygulanmaz; geçmiş zinciri tamamlar.
3. `contracts/a6-tech-01-f01-migration-lineage-v1.json` 38 kaydın eşlemesini ve
   henüz uygulanmamış tek retirement migration'ını taşır.
4. `tools/check-migration-lineage.mjs` repository dosyalarını ve verilen name-only
   ledger snapshot'ını karşılaştırır. CI testleri eksik dosya, değişen SQL,
   mükerrer version/isim ve beklenmeyen canlı migration durumlarını reddeder.
5. Retirement SQL'i resmî `supabase@2.121.0 migration new` komutuyla oluşturuldu.
   CLI geçici paket önbelleğinde çalıştırıldı; global kurulum, dependency veya
   lockfile değişikliği yapılmadı.

İmmutable eski canlı kabul kanıtlarındaki dosya yolları değiştirilmedi. Bu yollar
manifest'teki `previous_repository_file` ile yeni dosyaya bağlanır.

## Hash eşliği neyi kanıtlıyor?

Hash yöntemi UTF-8 SHA-256'dır. Yalnız CRLF → LF ve dış boşluk temizliği yapılır;
SQL içindeki ifadeler veya boşluklar normalize edilmez.

38 kaydın 32'sinde repository SQL'i uygulanan SQL ile bu yöntemle aynıdır. Kalan
altı fark açıkça kaydedilmiştir:

| Kayıt | Fark | Değerlendirme |
| --- | --- | --- |
| `eo02c_shopify_app_pricing_entitlement` | Canlı ilk sürüm column-list `ON CONFLICT`, repository named constraint kullanır | Takip eden `eo02c_disambiguate_upserts` düzeltmesi zincirde korunur |
| Dört EO-03-D corrective migration | Canlı metin ek session-role sarmalayıcısı taşır | Repository'nin transaction-local rol sınırı korunur; gövde farkı yok |
| `eo04c_reporting_account_completion` | Repository `begin/commit` sarmalayıcısı taşır | Canlı uygulama motorunun transaction davranışıyla dosya metni aynı şey sayılmaz |

Manifest hem repository hem uygulanan SQL hash'ini tutar. Bu kayıtlar canlı
şemanın tümü için hash eşliği veya geçmişin byte-byte aynı olduğu iddiası üretmez.
Migration defterine `repair`, yeniden adlandırma, silme veya doğrudan yazma yapılmadı.

## Emekli edilecek yüzey

18 Ekim salt-okunur kontrolünde eski tabloda 2 `consumed`, 6 `failed` satır,
0 bekleyen seçim ve 0 credential referansı görüldü. Altı eski handoff fonksiyonu
runtime tarafından çalıştırılabilir. Uygulama bu altı fonksiyonu çağırmaz.

Önceki tasarım anlatımındaki **yedi fonksiyon kaldırılacak** ifadesi düzeltilmiştir:
`shopify.resolve_active_installation_callback_return` Meta, Google ve Klaviyo
repository'leri tarafından kullanılır ve korunur. Kaldırılacak fonksiyon sayısı
altıdır. Aktif `integrations.finalize_provider_disconnect` de korunur; gövdesi
repository'de kabul edilmiş canonical sürüme getirilerek eski handoff yazımı
kaldırılır. Normal disconnect'in kendi credential'ını kaldırma davranışı sürer.

Yeni retirement migration'ı:

- 5 saniye lock, 30 saniye statement sınırıyla tek transaction kullanır.
- Eski tabloyu exclusive kilitleyip bütün satırların terminal durumda ve credential
  referanslarının boş olduğunu doğrular. Şart bozulursa transaction durur.
- Aktif callback dönüş fonksiyonunu ve runtime EXECUTE yetkisini doğrular.
- Altı fonksiyonu exact signature ve `RESTRICT` ile kaldırır; `CASCADE` kullanmaz.
- Tabloyu, sekiz tarihsel satırı, foreign key'leri ve privacy cascade ilişkilerini
  korur. Owner policy'sini SELECT ile sınırlar; runtime table grant'ı vermez.
- F02'de incelenecek sahipsiz credential üzerinde işlem çalıştırmaz.

## Yerel doğrulama

F01-A teslim kontrolü: **397/397 test**, typecheck ve production build başarılı.
Build'deki önceden kayıtlı beş React Router future uyarısı sürmektedir. Bunlar
F10 kapsamındadır. Git diff whitespace kontrolü başarılıdır.

`pnpm test` içindeki yeni testler yalnız ledger/dosya doğrulayıcısını, negatif
drift örneklerini ve retirement SQL sınırlarını kontrol eder. Bunlar PostgreSQL
execution testi değildir.

Manuel yerel kontrol:

```text
node tools/check-migration-lineage.mjs
node tools/check-migration-lineage.mjs <yeni-name-only-ledger-snapshot.json>
```

Snapshot yalnız `migrations` dizisinde `version`, `name`, `applied_sql_sha256`
alanlarını gerektirir. Varsayılan kontrol 18 Ekim snapshot'ını kullanır ve yeni
bir canlı okuma yapmaz. Geçmesi güncel canlı schema parity PASS anlamına gelmez.

## F01-B — İzole database provası

Tekrarlanabilir GitHub runner düzeneği ve sonuç kaydı
`docs/A6_TECH_01_F01B_DATABASE_REPLAY.md` dosyasındadır. Yerel test ile gerçek
database koşusunun durumları ayrı tutulur.

Bu makinede Docker yoktur. F01-A kapsamında Docker kurulmadı veya yeni Supabase
projesi açılmadı. Sonraki kapıda onaylı izole PostgreSQL 17/Supabase ortamı gerekir.
Production credential veya business data bu ortama taşınmaz.

Prova sırası:

1. Boş ve izole Supabase/PostgreSQL 17 ortamında mevcut 38 historical migration'ı
   version sırasıyla uygula. Managed roller, pgcrypto ve pg_cron gereksinimleri
   nedeniyle düz bir SQLite/in-memory taklidi kabul edilmez.
2. Historical zincirin sonunda table, constraint, function, owner, policy ve
   grant envanterini canlı metadata ile karşılaştır. Text hash'ini schema parity
   yerine kullanma.
3. Retirement için dört bağımsız rollback'li senaryoyu çalıştır: boş tarihsel
   tablo; terminal ve credential-free satırlar; bekleyen seçim; credential taşıyan
   satır. İlk ikisi başarılı, son ikisi precondition hatası vermeli ve satır,
   fonksiyon/grant durumu değişmemelidir.
4. İkinci bağlantıdan tabloya eşzamanlı yazma denemesiyle lock/timeout sınırını
   doğrula. Başarısız DDL veya bağımlılık durumunda transaction rollback'ini test et.
5. Başarılı retirement sonrası altı fonksiyonun yokluğunu, callback ve canonical
   disconnect'in çalışmasını, değişmeyen tarihsel satır sayısını, forced RLS ve
   role grant sınırlarını doğrula. Mevcut lifecycle/privacy probe'larını çalıştır.
6. Tam 39 migration zincirini ikinci boş ortamda sıfırdan uygula; önceki provanın
   nihai şemasıyla karşılaştır. Security/Performance Advisor sonucunu kaydet.

Bu provalar geçmeden F01-A dosyaları canlıya uygulanmaz.

## F01-C — Ayrı canlı onay kapısı

İzole provadan sonra backup/PITR ve geri dönüş kanıtı tamamlanır. Ürün sahibi
exact retirement migration'ını canlı uygulama için ayrıca onaylar. Canlı migration
defterindeki ilk 38 kayıt değiştirilmez ve yeniden çalıştırılmaz; yalnız yeni
39. migration uygulanır. Mevcut deployment/database otomasyonu bu PR ile açılmaz.

İlk hata sonrasında retry veya alternatif uygulama rotası kullanılmaz. Commit
öncesi hata transaction rollback'iyle kapanır. Commit sonrası geri dönüş gerekirse
korunan tarihsel SQL'den ayrı forward migration hazırlanır ve ayrıca onaylanır;
eski handoff runtime yetkisi otomatik geri açılmaz.

Uygulama sonrası yeni ledger, altı fonksiyonun yokluğu, callback/disconnect ve
privacy lifecycle, değişmeyen connection/credential sayıları, tarihsel tablo
satırları ve Advisor tekrar doğrulanır. F01 kapanış kabulü alınmadan F02 başlamaz.

## Resmî kaynaklar

18 Ekim 2026 tarihinde kontrol edilen kaynaklar:

- [Supabase environment/migration yönetimi](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase production olgunluk modeli](https://supabase.com/docs/guides/deployment/maturity-model)
- [CLI migration list referansı](https://supabase.com/docs/reference/cli/supabase-migration-list)
- [Supabase breaking-change kayıtları](https://supabase.com/changelog?types=breaking-change)

CLI komutları kullanılmadan önce `--help` ile doğrulandı. Supabase Postgres Best
Practices skill'inin least-privilege ve kısa transaction kuralları retirement
tasarımındaki exact fonksiyon listesi, `RESTRICT` ve timeout sınırlarına uygulandı.
