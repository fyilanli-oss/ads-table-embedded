# EO-02-D-C1 — Kalıcı silme işçisi düzeltme kapısı

**Kontrol tarihi:** 9 Ekim 2026

**Durum:** Kabul edildi — canlı kabul ve ürün sahibi kapanış kabulü geçti.

Bu belge 9 Ekim 2026'da kapatılan yürütme eksikliğini anlatır. Aşağıdaki ilk hata ve sonraki başarılı koşu tarihsel kanıttır; bugün yeniden çalıştırılmış sayılmaz. Güncel proje durumu Execution Plan'dadır.

## Analist sonucu

EO-02-D'nin webhook girişi doğrulanmış silme işini `privacy.deletion_runs` kuyruğuna yazıyordu; fakat Production'da bu kuyruğu tüketen kalıcı işçi yoktu. Kabul edilmiş `shop/redact` talebi süresiz `pending` kalabilirdi. Bu düzeltme yalnız yürütme boşluğunu kapatır; EO-02-D'nin ana/alt paket yapısını değiştirmez.

## Seçilen mimari

İşçi Supabase Cron / `pg_cron` içinde çalışır. Her beş dakikada `privacy.process_deletion_queue(25)` çağrılır.

Bu seçim:

- Vercel ortam değişkeni veya `CRON_SECRET` gerektirmez.
- HTTP/ağ katmanı eklemez.
- Shopify webhook girişini ağır fiziksel silmeden ayırır.
- Kuyruk, silme sonuç kaydı ve yürütücüyü aynı PostgreSQL işlem sınırında tutar.

## Güvenlik sınırı

- Uygulama rolü `adstable_runtime`, fiziksel silme yürütücüsünü veya zamanlayıcı fonksiyonunu çalıştıramaz.
- Zamanlayıcı yalnız `postgres` rolüne açılan dar `privacy.process_deletion_queue(integer)` kapısını çağırır.
- Fonksiyon `SECURITY DEFINER` ve boş `search_path` ile tanımlıdır.
- Tarayıcı, anon, authenticated, service_role ve çalışma zamanı privacy tablolarında doğrudan veri değiştirme yetkisi alamaz.
- Hata metni saklanmaz; yalnız güvenli `SQLSTATE` sınıflandırması tutulur.

## Dayanıklılık

- Aynı adlı pg_cron işi sağlayıcı düzeyinde sıralı çalışır.
- İşlem kapsamlı danışma kilidi, manuel veya yinelenen eşzamanlı çağrıyı ikinci kez işletmez.
- `FOR UPDATE SKIP LOCKED` seçilen işleri korur.
- Başarılı iş, mevcut nesle kilitli ve yinelenince aynı sonucu koruyan yürütücüyle tamamlanır.
- Başarısız iş `failed` kalır; 5 dakikadan başlayan üstel gecikmeyle, en fazla 320 dakikalık aralık ve 20 deneme sınırıyla yeniden denenir.
- 20 denemeyi tüketen iş sessizce tamamlanmaz; operasyon müdahalesi için açık `failed` kaydı kalır.
- Cron geçmişi günlük temizlenir; son 30 gün korunur.

## Tarihsel resmî kaynak kontrolü

9 Ekim 2026 tarihinde:

- Supabase Cron veritabanı fonksiyonunu beş dakikada bir çağırabilir.
- Aynı adla yeniden zamanlanan iş mevcut tanımı günceller.
- `cron.job_run_details` kendiliğinden temizlenmez.
- Supabase fonksiyon güvenliğinde dar yetki ve güvenli `search_path` kullanımı gerekir.
- pg_cron aynı işin iki örneğini eşzamanlı çalıştırmaz; sonraki koşuyu kuyruğa alır.

Kaynaklar:

- https://supabase.com/docs/guides/cron/install
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/database/functions
- https://github.com/citusdata/pg_cron/blob/main/README.md

## Canlı uygulama kapısı

Repository merge'ü canlı işlem yetkisi değildir. Ayrı açık onaydan önce:

- `pg_cron` etkinleştirilmez.
- Düzeltici migration canlı Supabase'e uygulanmaz.
- Cron işi oluşturulmaz.
- Sentetik veya gerçek silme yürütülmez.

Canlı kabul; adlı iş ve çalışma aralığı, yalnız Cron üzerinden sentetik tamamlanma, yinelenen/çakışan işlerin sonucu çoğaltmaması, zorlanmış hatada yeniden denemenin görünürlüğü, Advisor kontrolleri ve sentetik temizlik birlikte kanıtlanmadan tamamlanmaz.

## İlk canlı Cron koşusu ve güvenli başarısızlık düzeltmesi

9 Ekim 2026 saat 07:50 UTC'deki ilk iş, hiçbir silme işi yürütmeden PostgreSQL ayrıştırıcı hatasıyla durdu. `GREATEST` ve `LEAST` fonksiyona benzese de sıradan fonksiyon değildir; `pg_catalog.greatest` / `pg_catalog.least` şeklinde şema adıyla nitelenemez.

Kanıtlanan güvenlik davranışı:

- Gerçek mağaza veya Production iş verisi silinmedi.
- Sentetik kabul işi `pending`, `attempt_count=0` kaldı.
- Cron hata ayrıntısını `cron.job_run_details` içinde görünür tuttu.
- Canlıda yetki genişletme veya geçici fonksiyon yaması yapılmadı.

Düzeltici migration yalnız iki koşullu ifadeyi PostgreSQL 17'nin resmî sözdizimine getirir. İşçinin danışma kilidi, satır kilidi, toplu iş, yeniden deneme ve en az yetki sınırları değişmez.

Kaynak: https://www.postgresql.org/docs/17/functions-conditional.html

## Canlı kabul sonucu — 9 Ekim 2026

Düzeltici migration sonrası 08:00 UTC doğal Cron koşusu sentetik `customer_data_request` işini doğrudan yürütücü çağrısı olmadan tamamladı.

- Cron durumu: `succeeded`
- İş durumu: `completed`
- Deneme sayısı: `1`
- Silme sonuç kaydı: `no_customer_data`
- Müşteri kapsamlı satır: `0`
- Tekrar çalıştırmada seçilen iş: `0`; yinelenen sonuç yok
- Çalışma zamanının işçi çalıştırma yetkisi: `false`
- Çalışma zamanının fiziksel silme yetkisi: `false`
- Security Advisor: sıfır bulgu
- Performance Advisor: ön kontrole göre yeni bulgu yok
- Sentetik çalışma alanı/iş/sonuç kaydı: sıfır kalan kayıt
- Açık pending/failed/running silme işi: `0`

Kalıcı kanıt: `docs/evidence/EO_02D_DURABLE_WORKER_LIVE_2026-10-09.json`.

Ürün sahibi 9 Ekim 2026'da EO-02-D kapanışını açıkça kabul etti. O kabul anında teknik açık kalem sıfırdı.
