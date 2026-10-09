# EO-02-D-C1 — Durable deletion worker corrective gate

**Kontrol tarihi:** 9 Ekim 2026  
**Durum:** Live acceptance PASS; ürün sahibi kapanış kabulü bekliyor

## Analist sonucu

EO-02-D webhook ingress'i doğrulanmış silme işini `privacy.deletion_runs` kuyruğuna yazıyor, fakat production'da bu kuyruğu tüketen kalıcı bir işçi yoktu. Bu boşluk, kabul edilmiş bir `shop/redact` talebinin süresiz `pending` kalabilmesi anlamına geliyordu. Bu corrective gate yalnız o yürütme boşluğunu kapatır; EO-02-D'nin parent/child yapısını değiştirmez.

## Seçilen mimari

İşçi Supabase Cron / `pg_cron` içinde çalışır. Her beş dakikada `privacy.process_deletion_queue(25)` çağrılır.

Bu seçim:

- Vercel environment veya `CRON_SECRET` gerektirmez.
- HTTP/network katmanı eklemez.
- Shopify webhook endpoint'ini ağır fiziksel silme işinden ayrı tutar.
- Kuyruk, manifest ve yürütücüyü aynı PostgreSQL transaction sınırında bırakır.

## Güvenlik sınırı

- Uygulama rolü `adstable_runtime`, fiziksel executor veya scheduler fonksiyonunu çalıştıramaz.
- Scheduler yalnız `postgres` rolüne açılan dar `privacy.process_deletion_queue(integer)` kapısını çağırır.
- Fonksiyon `SECURITY DEFINER` ve boş `search_path` ile tanımlıdır.
- Browser, anon, authenticated, service_role ve runtime doğrudan privacy table DML alamaz.
- Hata metni saklanmaz; yalnız güvenli `SQLSTATE` sınıflandırması tutulur.

## Dayanıklılık

- Aynı isimli pg_cron işi provider seviyesinde seri çalışır.
- Transaction advisory lock, manuel veya duplicate eşzamanlı çağrıyı ikinci kez işletmez.
- `FOR UPDATE SKIP LOCKED` seçilen run'ları korur.
- Başarılı iş mevcut generation-locked ve idempotent executor üzerinden tamamlanır.
- Başarısız iş `failed` kalır; 5 dakikadan başlayan üstel gecikmeyle, en fazla 320 dakikalık aralık ve 20 deneme sınırıyla yeniden denenir.
- 20 denemeyi tüketen iş sessizce tamamlanmaz; operasyon müdahalesi için açık `failed` kaydı olarak kalır.
- Cron geçmişi günlük temizlenir ve son 30 gün korunur.

## Resmî kaynak kontrolü

9 Ekim 2026 tarihinde:

- Supabase Cron bir database fonksiyonunu beş dakikada bir çağırabilir.
- Aynı isimle yeniden schedule edilen job mevcut tanımı günceller.
- `cron.job_run_details` kendiliğinden temizlenmez.
- Supabase, database function güvenliğinde dar yetki ve güvenli `search_path` kullanımını gerektirir.
- pg_cron aynı job'ın eşzamanlı iki örneğini çalıştırmaz; sonraki koşuyu kuyruğa alır.

Kaynaklar:

- https://supabase.com/docs/guides/cron/install
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/database/functions
- https://github.com/citusdata/pg_cron/blob/main/README.md

## Canlı uygulama kapısı

Repository merge'i canlı mutation yetkisi değildir. Ayrı açık onaydan önce:

- `pg_cron` etkinleştirilmez.
- Corrective migration canlı Supabase'e uygulanmaz.
- Cron job oluşturulmaz.
- Sentetik veya gerçek silme yürütülmez.

Canlı kabul; named job ve cadence doğrulaması, yalnız Cron üzerinden sentetik completion, duplicate/overlap idempotency, forced-failure retry görünürlüğü, Advisors PASS ve sentetik temizliği birlikte kanıtlamadan tamamlanmış sayılmaz.


## İlk canlı Cron koşusu ve fail-safe düzeltme

9 Ekim 2026 saat 07:50 UTC'deki ilk job, hiçbir run yürütmeden önce PostgreSQL parser hatasıyla durdu. `GREATEST` ve `LEAST`, fonksiyona benzeseler de ordinary function değildir; bu nedenle `pg_catalog.greatest` / `pg_catalog.least` biçiminde schema-qualified kullanılamaz.

Kanıtlanan güvenlik davranışı:

- Gerçek mağaza veya production business verisi silinmedi.
- Sentetik kabul run'ı `pending`, `attempt_count=0` kaldı.
- Cron hata ayrıntısını `cron.job_run_details` içinde görünür tuttu.
- Canlıda yetki genişletme veya ad-hoc function patch yapılmadı.

Düzeltici migration yalnız iki conditional expression'ı PostgreSQL 17'nin resmî sözdizimine getirir; worker'ın advisory lock, row lock, batch, retry ve least-privilege sınırlarını değiştirmez.

Kaynak: https://www.postgresql.org/docs/17/functions-conditional.html


## Canlı kabul sonucu — 9 Ekim 2026

Düzeltici migration sonrasında 08:00 UTC doğal Cron koşusu sentetik `customer_data_request` run'ını doğrudan executor çağrısı olmadan tamamladı.

- Cron status: `succeeded`
- Run status: `completed`
- Attempt count: `1`
- Manifest: `no_customer_data`
- Customer scoped rows: `0`
- Replay: seçilen iş `0`; duplicate sonuç yok
- Runtime worker execute: `false`
- Runtime physical delete execute: `false`
- Security Advisor: sıfır bulgu
- Performance Advisor: preflight'a göre yeni bulgu yok
- Sentetik workspace/run/manifest: sıfır kalan kayıt
- Açık pending/failed/running deletion run: `0`

Kalıcı kanıt: `docs/evidence/EO_02D_DURABLE_WORKER_LIVE_2026-10-09.json`.

Tek kalan kapı ürün sahibinin EO-02-D kapanışını açıkça kabul etmesidir.
