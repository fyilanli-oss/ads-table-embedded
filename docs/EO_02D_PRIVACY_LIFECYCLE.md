# EO-02-D — Gizlilik, uygulamayı kaldırma, veri silme ve temiz yeniden kurulum

**Kontrol tarihi:** 9 Ekim 2026

**O tarihteki ara durum:** Doğrulama; gelen istek sınırı ve Shopify uygulama yapılandırması geçti, kalıcı işçinin canlı kabulü bekleniyordu.

Bu belge 8–9 Ekim 2026'daki hazırlık ve düzeltme aşamalarını anlatır. İşçi için aşağıda yazan eksiklik bugünkü açık iş iddiası değildir. Sonraki kabul `docs/EO_02D_DURABLE_DELETION_WORKER.md` içindedir; güncel proje durumu Execution Plan'dan okunur.

## Analist sonucu

EO-02-D doğrulanmış Shopify webhook teslimatını kalıcı iş sahipliği kaydına (claim) dönüştürür. Uygulamayı kaldırma ile verinin fiziksel silinmesini ayırır. Her silme işi tek çalışma alanına ve tek kurulum nesline kilitlenir.

`app/uninstalled` erişimi durdurur, çalışma zamanı oturumlarını siler ve çalışma alanını askıya alır; fiziksel veri silmez. Tarihsel resmî sözleşmeye göre `shop/redact`, kaldırmadan en erken 48 saat sonra gelir; arada yeniden kurulum varsa gönderilmez. Bu nedenle 48 saat içindeki doğrulanmış yeniden kurulum aynı nesli aktifleştirir. Silme bildiriminin sahiplik kaydı geldikten sonra kurulum `deletion_pending` olur; silme bitene kadar yeni başlangıç işlemi (bootstrap) güvenle reddedilir.

Silme tamamlandıktan sonraki kurulum yeni çalışma alanı ve önceki silme sonuç kaydındaki neslin bir fazlasını üretir. Eski iş yalnız eski çalışma alanı/nesil üzerinde çalışabildiği için yeni kurulumu silemez.

## Tarihsel resmî kaynak kontrolü

8 Ekim 2026 tarihinde:

- Herkese açık App Store uygulamaları `customers/data_request`, `customers/redact` ve `shop/redact` uyumluluk konularını uygulamalıdır.
- HTTPS teslimatında HMAC, uygulama istemci sırrı ve ham istek gövdesiyle doğrulanır.
- Geçersiz uyumluluk HMAC isteği 401 Unauthorized alır.
- X-Shopify-Webhook-Id, aynı bildirimin tekrarında işlemi çoğaltmama anahtarıdır.
- Webhook sıralaması garanti edilmez.
- HTTPS teslimatına beş saniyede yanıt verilmelidir; ağır iş kalıcı sahiplik kaydından sonra ayrı çalışır.
- Uyumluluk eylemi talebin alınmasından itibaren 30 gün içinde tamamlanır.
- `shop/redact` kaldırmadan en erken 48 saat sonra gönderilir; yeniden kurulum varsa gönderilmez.
- Uygulamayı kaldırma token'ları geçersiz kılar. Kaldırma/uyumluluk giriş sınırı mağaza erişim token'ına bağımlı değildir.
- Supabase özel şema, zorunlu RLS ve yalnız fonksiyon çağıran çalışma zamanı sınırı korunur.

Kaynaklar:

- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- https://shopify.dev/docs/apps/build/webhooks/troubleshoot
- https://shopify.dev/docs/api/webhooks/2026-07
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/docs/guides/database/postgres/row-level-security

## HMAC doğrulamalı istek girişi

Uç nokta: POST /webhooks/shopify

1. Metot, JSON içerik türü ve gerekli Shopify başlıkları doğrulanır.
2. Ham gövde, SHOPIFY_API_SECRET ile HMAC-SHA256 doğrulamasından geçer.
3. HMAC geçmeden JSON ayrıştırılmaz ve veritabanı çağrısı yapılmaz.
4. Yalnız dört izinli konu kabul edilir.
5. Ham gövde ve müşteri e-posta/telefon bilgisi saklanmaz; yalnız SHA-256 içerik kanıtı tutulur.
6. Aynı X-Shopify-Webhook-Id tekrar geldiğinde yeni yaşam döngüsü sonucu üretilmez.
7. Sahiplik kaydı kalıcı olduktan sonra 202 döner. Silme yürütücüsü aynı istekte çalıştırılmaz.

## Veri modeli

- `privacy.webhook_claims`: Doğrulanmış teslimat kimliği, olay kimliği, konu, çalışma alanı/nesil, takma kimlikli mağaza parmak izi, içerik özeti, API sürümü ve zaman kanıtı. Ham içerik, mağaza alan adı, e-posta veya telefon taşımaz.
- `privacy.deletion_runs`: Her iş tek çalışma alanı, nesil ve parmak izine bağlıdır. Durumlar `pending`, `running`, `completed`, `failed` ve `superseded` olarak kalır.
- `privacy.deletion_manifests`: Silinen/korunan veri aileleriyle satır sayılarını taşır; silinen kişisel veriyi yeniden saklamaz.

Bütün tablolar özel privacy şemasındadır; RLS açıktır ve zorunludur. Tarayıcı, anon, authenticated, service_role ve çalışma zamanı doğrudan tablo değiştirme (DML) yetkisi alamaz.

## Yaşam döngüsü durum matrisi

Teknik durum adları çevrilmez; yanlarında iş sonucu açıklanır.

| Olay | Mevcut durum | Sonuç |
|---|---|---|
| İlk doğrulanmış kurulum | Kayıt yok | Yeni çalışma alanı, nesil 1 |
| Aktif uygulama tekrar açıldı | `active` | Aynı çalışma alanı/nesil |
| `app/uninstalled` | `active` | `uninstall_pending_redaction`; çalışma alanı askıda, oturumlar silinir |
| Yeniden kurulum | `uninstall_pending_redaction` | Aynı nesil yeniden aktif |
| `shop/redact` | `uninstall_pending_redaction` | Nesle kilitli silme işi kuyruğa alınır |
| `shop/redact` | `active` | `ignored_reinstalled`; silme yok |
| Başlangıç işlemi | `deletion_pending` | Güvenli ret |
| Yürütücü tamamlandı | `deletion_pending` | Kurulum/faturalandırma/oturum/alan adı geçmişi silinir; çalışma alanı arşivlenir |
| Yeniden kurulum | Silme tamamlanmış | Yeni çalışma alanı, nesil N+1 |
| Eski yürütücü | Yerine geçen nesil var | `superseded`; yeni veriye dokunamaz |

## “Delete my data” — Verilerimi sil

Kullanıcı talebi yalnız sunucunun doğruladığı Admin mağaza kimliği ve tam kurulum nesliyle açılır. Talep kurulumu `deletion_pending` yapar, oturumları kaldırır ve aynı silme yürütücüsüne girer. Abonelik yetkisi Shopify'da kalır; bu işlem abonelik iptali değildir. Görünür Settings eylemi ve açık kullanıcı metni EO-07-A'da bağlanacaktır.

## Müşteri gizlilik talebinin sınırı

Bu tarihsel temel aşaması müşteri düzeyinde veri saklamaz. Bu nedenle `customers/data_request` ve `customers/redact` işi `no_customer_data` sonuç kaydıyla kapanır. EO-03/04/05'te eklenecek her veri ailesi kullanılmadan önce silme kayıt defterine ve EO-02-D gerileme kabulüne eklenmelidir. Eksik kayıt sessiz başarı sayılamaz.

## Canlı uygulama kapısı

8 Ekim 2026'da ayrı açık kullanıcı onayıyla canlı Supabase migration'ı uygulandı. `docs/evidence/EO_02D_DATABASE_ACCEPTANCE_2026-10-08.json` şunları kanıtlar:

1. Repository testleri, tür kontrolü, derleme ve Governance CI geçti.
2. Migration SQL incelemesi ve canlı uygulama geçti.
3. Üç privacy tablosunda RLS açık/zorunlu, doğrudan rol erişimleri kapalı ve Security Advisor bulgusu sıfırdı.
4. Önceki/sonraki çalışma alanı ve kurulum sayıları aynıydı; Production verisi silinmedi, sentetik satır bırakılmadı.
5. Supabase yönetim bağlantısının `adstable_runtime` rolünü taklit edememesi beklenen en az yetki sınırıdır. Aynı yol yeniden zorlanmayacaktır.

O ara aşamada kalan kapılar:

1. PR #27 için ayrı açık merge onayı.
2. Merge sonrası Production uygulama dağıtımı.
3. Dağıtılmış çalışma zamanından geçersiz HMAC için 401 ve geçerli sahiplik kaydı için 202 kabulü.
4. Tam Shopify uygulama yapılandırması bağlama/okuma, uygulamaya özel webhook abonelik dağıtımı ve test teslimatı.
5. Sentetik yaşam döngüsü kabulü: kaldırma, yinelenen teslimat, yeniden kurulum, silme talebi, yürütücünün tekrar çalışması, N+1 yeniden kurulum ve eski yürütücünün sınırlandırılması.
6. Gerçek kullanıcı verisini silmeden ürün sahibi kapanış kabulü.

## Geri alma

Migration eklemelidir; ilk devreye almada eski üç parametreli başlangıç fonksiyonu çeşidini korur. Canlı sıra önce veritabanı, sonra uygulamadır. Uç nokta aboneliği açılmadan çalışma zamanı ve migration birlikte doğrulanır. İlk kabul yalnız sentetik kayıtlarla yapılır.

Bu tarihsel plan yeni dağıtım, silme veya migration uygulama yetkisi değildir.

## 9 Ekim 2026 — Kalıcı silme işçisi düzeltme kapısı

O tarihteki repository ve Production incelemesi, doğrulanmış sahiplik kaydının `privacy.deletion_runs` kuyruğuna yazıldığını; fakat kuyruğu Production'da sürekli tüketen işçi/Cron bulunmadığını gösterdi. EO-02-D bu ara aşamada henüz kabul edilmemişti.

Bağlayıcı düzeltme:

- `docs/EO_02D_DURABLE_DELETION_WORKER.md`
- `contracts/eo-02d-durable-deletion-worker-v1.json`
- `supabase/migrations/20261009074901_eo02d_durable_deletion_worker.sql`

Seçilen yapı, Supabase Cron'da beş dakikada bir en fazla 25 iş alan ve danışma kilidiyle korunan veritabanı işçisidir. Uygulamanın doğrudan fiziksel silme yürütme yetkisi kaldırılır. Başarısız iş kontrollü artan beklemeyle en fazla 20 kez denenir; denemesi tükenen iş görünür `failed` durumunda kalır.

Repository değişikliği canlı Supabase işlem yetkisi değildir. `pg_cron` kurulumu, düzeltici migration, sentetik işçi kabulü ve Advisor kontrolleri ayrı açık kullanıcı onayı olmadan uygulanamaz.
