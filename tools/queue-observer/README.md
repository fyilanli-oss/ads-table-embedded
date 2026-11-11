# EO-05 kuyruk izleme denemesi

Hazırlık paketi. Canlı kaynak kurulumu, rol girişi, Gmail çağrısı ve zamanlayıcı
açılışı ayrı onaydan sonra yapılır. Müşteri kuyruğu veya gerçek hesap verileri bu
denemeye bağlanmaz.

1. Denemede `ADSTABLE_QUEUE_OBSERVER_MODE=synthetic` kullan. Bu modda Supabase
   bağlantısı ve CA alanlarını boş bırak. `ADSTABLE_QUEUE_OBSERVER_SYNTHETIC_GENERATION`
   için yeni test UUID'sini, `ADSTABLE_QUEUE_OBSERVER_SYNTHETIC_START_AT` için UTC
   başlangıç zamanını ayarla. Firestore başlangıç kaydına aynı nesil ve zamanı
   yaz. Zamanlayıcıyı başlangıçtan önce hazırla. Makbuz beşinci dakikada gelir
   ve sonra dakikada bir yenilenir. Bitiş zamanını başlangıçtan en az yedi
   dakika sonraya ayarla.

   Ayrı Supabase doğrulamasında varsayılan `supabase` modunu kullan. İzole
   test veritabanında mevcut EO-05E kuyruk makbuzu fonksiyonu
   bulunmalı. `tools/sql/eo05-queue-observer-role.sql` yalnız o fonksiyona izin
   veren, girişi kapalı rolü hazırlar. Bağlantı öncesi rolün yalnız makbuz
   okuyabildiğini ve operasyon tablolarına erişemediğini doğrula. Sonra yalnız
   test veritabanında role giriş ve ayrı kimlik bilgisi ver. TLS için o
   veritabanının CA sertifikasını kullan.
2. Google Cloud'da yalnız bu denemeye ait adlandırılmış Firestore veritabanı
   kullan. Cloud Run çalışma kimliğine bu depoda belge okuma, oluşturma ve
   güncelleme yetkisi ver. İki koleksiyonda `expiresAt` için TTL tanımla.
   Bir test kuyruğu nesline ait etkinleştirme kaydını
   `queueObserverWitnesses/<scopeRef>` belgesine açıkça yaz. Belge alanları
   `revision` (integer, başlangıçta 0), `payload` (string, aşağıdaki nesnenin
   JSON gösterimi) ve `expiresAt` (timestamp, canary bitiş zamanı).
   `queueObserverIncidents` belgelerini izleyici üretir.
3. Depo kökünü build context vererek `tools/queue-observer/Dockerfile` imajını
   oluştur. Cloud Run girişinde kimlik doğrulaması zorunlu, istek zaman aşımı
   45 saniye. Zamanlayıcının ayrı çağırma kimliğine yalnız bu serviste
   `roles/run.invoker` ver. Hizmet ayarları:
   - `GOOGLE_CLOUD_PROJECT`, `ADSTABLE_FIRESTORE_DATABASE`
   - `ADSTABLE_QUEUE_OBSERVER_SCOPE` (test UUID),
     `ADSTABLE_QUEUE_OBSERVER_STOP_AT` (en fazla 12 saat ileride, UTC ISO zaman)
   - `ADSTABLE_QUEUE_OBSERVER_TEST_DATABASE_URL` (rolün test bağlantısı,
     URL parametresi olmadan), `ADSTABLE_QUEUE_OBSERVER_DATABASE_CA`
   - `ADSTABLE_GMAIL_CANARY_CLIENT_ID`, `ADSTABLE_GMAIL_CANARY_CLIENT_SECRET`,
     `ADSTABLE_GMAIL_CANARY_REFRESH_TOKEN`

   Bağlantı ve Gmail değerlerini Secret Manager üzerinden bağla. Yerel testte
   kullanılan mevcut Gmail izni ve sabit dev@adstable.app adresi geçerlidir.

Başlangıç payload şeması:

```text
{"environment":"test","generation":"<test queue UUID>","activatedAtMs":<verified activation epoch ms>,"sequence":0,"checkedAtMs":null,"queueRevision":0,"lastObserverAtMs":<same activation epoch ms>}
```

Test kuyruğunun başlangıç kaydı doğrulandıktan sonra çalıştırılacak zamanlayıcı
tanımı:

```bash
gcloud scheduler jobs create http adstable-queue-observer-canary \
  --project="$PROJECT" --location="$REGION" \
  --schedule='* * * * *' --time-zone=Etc/UTC --http-method=POST \
  --uri="$SERVICE_URL/tick" --oidc-token-audience="$SERVICE_URL" \
  --oidc-service-account-email="$SCHEDULER_IDENTITY" \
  --attempt-deadline=45s --max-retry-attempts=0
```

Kabulde test kuyruğunun 120 saniyeden uzun süre makbuzsuz kaldığını gör. Gmail
kabulü ile gelen kutusu teslimini ayrı doğrula. Sonraki dakikada ikinci e-posta
gelmediğini kontrol et. Beşinci dakika ve sonrasındaki çağrıda toparlanmanın
görüldüğünü doğrula. Sentetik deneme logunda `receiptSource: "synthetic"`
bulunur ve bu sonuç Supabase bağlantı kabulü olarak kaydedilmez. Cloud Run hizmetinin uygulama logunda
yalnız durum alanları kullanılabilir. Test biter bitmez zamanlayıcıyı duraklat.
Bitiş zamanı geçen servis bir daha e-posta gönderemez. Firestore TTL silmesi
arka planda gerçekleşir. Gerçek kuyruk için Gmail gönderim yetkisi bu denemenin
dışındadır.

Resmî belge kontrolü 11 Kasım 2026.
[Cloud Run ve Scheduler](https://docs.cloud.google.com/run/docs/triggering/using-scheduler),
[Firestore koşullu yazım](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch),
[Firestore TTL](https://docs.cloud.google.com/firestore/native/docs/ttl),
[Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets),
[Cloud Run ortam ayarları](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables),
[Supabase roller](https://supabase.com/docs/guides/database/postgres/roles).
