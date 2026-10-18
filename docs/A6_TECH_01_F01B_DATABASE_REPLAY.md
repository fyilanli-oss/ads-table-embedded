# F01-B — Gerçek database üzerinde sıfırdan kurulum provası

**Tarih:** 18 Ekim 2026

**Durum:** Prova düzeneği hazır; gerçek GitHub koşusu sonucu bekleniyor.

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
Bu belge gerçek koşunun commit/run kimliği ve sonucu alınınca güncellenecektir.
Katalog güvenlik testleri Supabase Cloud Advisor servisini çalıştırmış sayılmaz.
Cloud Advisor ve backup/PITR kanıtı F01-C canlı kapısında ayrıca alınır. F08'de
kayıtlı index bulguları bu pakette düzeltilmez.

## Resmî dayanak

18 Ekim 2026 tarihinde Supabase Docs Connector üzerinden kontrol edildi:

- [GitHub Actions ve local database yönetimi](https://supabase.com/docs/guides/deployment/managing-environments)
- [Database test yöntemleri](https://supabase.com/docs/guides/local-development/testing/overview)
- [CLI test ve lint araçları](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)

`init`, `db start`, `db reset` ve `stop` komutları CLI'ın `--help` çıktısıyla
doğrulandı. Workflow'da remote `link`, `push`, `repair`, `apply_migration` veya
Production deploy adımı yoktur.
