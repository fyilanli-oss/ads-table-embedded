# EO-02 — Analiz ve tasarım kitabı: Shopify temel yaşam döngüsü

**Kayıt tarihi:** 9 Ekim 2026

**Durum:** Kabul edildi — ürün sahibi, 9 Ekim 2026

**Ana paket:** A6-EO-02 — Shopify'a uygun veri, çalışma alanı, faturalandırma ve gizlilik temeli

Bu kitap EO-02'nin kabul edildiği günkü kapsamını anlatır. Daha sonra eklenen özellikler ve projenin bugünkü durumu için Execution Plan geçerlidir.

## 1. EO-02 ürüne ne kazandırır?

EO-02; sağlayıcı bağlantılarının güvenle çalışabilmesi için kimlik, faturalandırma ve veri silme temelini kurar.

Bağlayıcı iş kuralı:

> **Doğrulanmış bir Shopify uygulama kurulumu = kurulu bir Shopify mağazası = bir AdsTable çalışma alanı = bir Shopify aboneliği.**

Kullanıcı bir “Reporting Store” seçmez veya değiştirmez. Kurulu Shopify mağazası sunucuda doğrulanır ve çalışma alanının değiştirilemez ticaret kaynağı olur. Meta, Google Ads ve Klaviyo hesapları daha sonra bu yetkinin altında bağlanabilir; mağazanın yerine geçemez.

## 2. Otoriteler ve sorumluluklar

| Konu | Yetkili kaynak |
|---|---|
| Shopify içindeki uygulama kimliği | Backend tarafından doğrulanan kısa ömürlü Shopify ID token |
| Kurulu ticaret mağazası | Shopify Shop GID + standartlaştırılmış (canonical) myshopify alan adı + kurulum nesli |
| AdsTable kiracısı | Doğrulanmış kurulumdan oluşturulan Workspace ID |
| Faturalandırma/deneme | Shopify App Pricing ve Partner API aktif abonelik sonucu |
| Sağlayıcı raporlama hesabı | Kurulu mağazanın altında sınırlandırılan, sonraki EO-03 bağlantısı |
| Gizlilik yaşam döngüsü | Doğrulanmış Shopify uyumluluk webhook'ları ve kullanıcının yetkilendirdiği Delete My Data |
| Verinin fiziksel olarak silinmesi | Kalıcı, sınırlandırılmış veritabanı işçisi; tarayıcı veya doğrudan çalışma zamanı silme işlemi değil |

## 3. Kurulum ve çalışma alanı akışı

1. Shopify, AdsTable'ı uygulamanın kurulu olduğu mağazada açar.
2. Backend, Shopify ID token'ını doğrular ve desteklenen sunucu tarafı kimlik doğrulama yolu üzerinden mağaza kimliğini alır.
3. Backend, Shopify'ın yetkili Shop GID ve standartlaştırılmış alan adı bilgisini okur.
4. ID token'daki mağaza ile Admin API'deki mağaza uyuşmazsa istek reddedilir; veritabanı değişmez.
5. Veritabanı, doğrulanmış Shop GID için kilit alır.
6. İlk kurulum, tek işlemde bir çalışma alanı ve 1 numaralı kurulum nesli oluşturur.
7. Aynı aktif kurulum yeniden açıldığında aynı çalışma alanı ve kurulum nesli döner.
8. Aynı Shop GID için doğrulanmış alan adı değişikliği, yetkili alan adını günceller ve geçmişe kaydeder; başka çalışma alanı oluşturmaz.
9. İkinci Shopify mağazası kendi kurulumuna, çalışma alanına ve aboneliğine ihtiyaç duyar.
10. WooCommerce, BigCommerce ve Magento bu Shopify embedded çalışma alanının ticaret kaynağı olamaz.

## 4. Faturalandırma ve deneme akışı

1. Plan, fiyat ve 14 günlük deneme Shopify App Pricing tarafından yönetilir.
2. AdsTable yerel bir abonelik uydurmaz veya deneme süresini sıfırlamaz.
3. Plan seçiminden sonra ve uzlaştırma noktalarında backend, Shopify Partner API'den aktif aboneliği sorar.
4. Sağlayıcının yanıtı çalışma alanının kullanım hakkı (entitlement) kaydına yansıtılır.
5. Eksik abonelik, deneme, aktif, dondurulmuş ve iptal edilmiş sonuçlar birbirinden ayrı tutulur; yerel kayıt Shopify kararını geçersiz kılamaz.
6. Çalışma zamanı erişimi yalnız doğrulanmış Shopify sonucuna göre verilir.
7. Uygulamayı kaldırıp yeniden kurmak yeni deneme süresi garantisi vermez; kullanılmış deneme günlerinde yetkili kaynak Shopify'dır.

## 5. Normal istek yolu

1. Shopify Admin'den bir istek gelir.
2. Backend güncel Shopify kimliğini doğrular.
3. Doğrulanmış mağaza, tam olarak bir aktif çalışma alanı ve kurulum nesline bağlanır.
4. Çalışma zamanı dar yetkili veritabanı fonksiyonlarını kullanır; tablolara doğrudan veri değiştirme (DML) yetkisi yoktur.
5. Kurulu mağaza kapsamı sonraki bütün sağlayıcı ve veri kümesi işlemlerine taşınır.
6. Çağıranın gönderdiği çalışma alanı, mağaza veya ileride kullanılacak raporlama hesabı değerleri doğrulanmış yetkinin yerine geçemez.

## 6. Kaldırma, gizlilik ve silme akışı

Shopify bu yaşam döngüsü olaylarını bildirmek için düzenli sorgulamaya ihtiyaç duymaz; tanımlı webhook'ları AdsTable'a gönderir.

1. AdsTable şu olaylardan birini alır:
   - `app/uninstalled`
   - `customers/data_request`
   - `customers/redact`
   - `shop/redact`
2. Giriş noktası, isteğin değiştirilmemiş ham gövdesi üzerinden HMAC doğrulaması yapar.
3. Geçersiz HMAC taşıyan istekler kalıcı değişiklik yapılmadan reddedilir.
4. Geçerli webhook kimliği yalnız bir kez işleme alınır; aynı bildirimin tekrar gelmesi aynı işi yeniden oluşturmaz.
5. Ham webhook içerikleri ve açık metin müşteri verileri gizlilik kuyruğunda saklanmaz.
6. Kaldırma işlemi çalışma alanını askıya alır, çalışma zamanı oturumlarını kaldırır ve gerekli gizlilik yaşam döngüsünü bekler.
7. Veri talebi mevcut gerçeğe uygun sonucu üretir. EO-02 müşteri verisi tutmadığı için sonuç “müşteri verisi yok”tur.
8. Silme talebi, kurulum nesline kilitlenmiş bir silme işi planlar.
9. Supabase Cron, sınırlandırılmış silme işçisini her beş dakikada bir çağırır.
10. İşçi, giderilebilir hataları üst sınırı olan artan beklemeyle yeniden dener; denemeleri tükenen hatalar kaybolmaz, görünür kalır.
11. Tamamlandığında kişisel veri içermeyen bir silme sonuç kaydı oluşturulur.

## 7. Yeniden kurulum ve eşzamanlı işlem güvenliği

- Silme talebinden önce yeniden kurulum, aynı çalışma alanını ve kurulum neslini yeniden aktifleştirir.
- Eski bir silme olayı, yeniden kurulmuş aktif nesli silemez.
- Silme sürerken başlangıç işlemi (bootstrap) güvenli biçimde reddedilir.
- Tamamlanmış silmeden sonra yeniden kurulum, yeni çalışma alanı ve daha yüksek kurulum nesli oluşturur.
- Silme işçisi hem çalışma alanı hem kurulum nesliyle eşleşmelidir; eski iş yeni kurulumu silemez.

## 8. Güvenlik sınırı

- Ürün tabloları private PostgreSQL şemalarında bulunur.
- Tarayıcı rolleri ve Supabase Data API rolleri bu tablolara erişemez.
- Kiracı tablolarında RLS açıktır ve zorunlu uygulanır.
- Çalışma zamanına yalnız fonksiyon yetkisi verilir; doğrudan DELETE yetkisi verilmez.
- Shopify oturum/token bilgisi yalnız şifreli metin olarak kalıcılaştırılır.
- Gizli bilgiler, açık metin token'lar ve ham webhook içerikleri repository kanıtlarına ve loglara girmez.
- Kabul edilmiş tarihsel migration ve kanıtlar değişmez; düzeltmeler yalnız ileri yönde yapılır.

## 9. Hata davranışı

| Hata | Sonuç |
|---|---|
| Eksik veya geçersiz Shopify kimliği | Reddet; yazma yok |
| Doğrulanmış mağaza uyuşmazlığı | Reddet; yazma yok |
| Çağıranın başka çalışma alanını/mağazayı kullanma girişimi | Reddet; kurulu mağaza yetkisi geçerli |
| Tekrarlanan webhook | Mevcut işlem sahipliği döner; tekrar yürütme yok |
| Geçici silme hatası | Kalıcı kuyrukta sınırlandırılmış artan beklemeyle yeniden deneme |
| Silme işçisi denemelerinin tükenmesi | Görünür başarısız durum; sahte başarı yok |
| Yeniden kurulumun eski silme işiyle çakışması | Kurulum nesli kilidi yeni kurulumu korur |
| Faturalandırma yanıtının alınamaması | Uydurma kullanım hakkı yok; uzlaştırma açık kalır veya erişim güvenli biçimde reddedilir |

## 10. Operasyon ve kanıt

EO-02 kabulü; repository CI'ı, canlı Supabase migration'ları, sıfır Security Advisor bulgusu, Shopify plan/deneme kanıtı, çalışma zamanı kimlik doğrulama kanıtı, tam webhook abonelik kanıtı ve kalıcı silme işçisinin prova/temizlik kanıtıyla desteklenir.

Ana paket kayıtları:

- `docs/EO_02A_SUPABASE_FOUNDATION.md`
- `docs/EO_02B_WORKSPACE_INSTALLATION_AUTHORITY.md`
- `docs/EO_02BC_INSTALLED_SHOP_AUTHORITY_CORRECTION.md`
- `docs/EO_02C_SHOPIFY_APP_PRICING_ENTITLEMENT.md`
- `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md`
- `docs/EO_02D_PRIVACY_LIFECYCLE.md`
- `docs/EO_02D_DURABLE_DELETION_WORKER.md`

## 11. EO-02 kapanış beyanı

EO-02, repository kontrolleri geçtikten sonra 9 Ekim 2026'da ürün sahibinin açık kabulüyle kapandı. Tek sonraki ana paket **A6-EO-03 — Tek yetkili OAuth, bağlantı ve token kasası**dır.

EO-02; sağlayıcı OAuth bağlantısının, token saklamanın, raporlama hesabı seçiminin, sağlayıcı adaptörlerinin veya Dataset V2'nin hazır olduğunu iddia etmez. Bunlar sonraki paketlerdir ve varsayılan olarak kapalı kalır.

## Makine sözleşmesinin bölüm eşlemesi

Aşağıdaki kimlikler testler tarafından kullanıldığı için çevrilmez:

- business_purpose_and_actual_output
- actors_and_authorities
- end_to_end_happy_path
- negative_and_failure_paths
- persistent_state_and_data_ownership
- secret_and_security_boundaries
- operations_retries_and_observability
- rollback_recovery_or_safe_failure
- accepted_evidence_and_known_limits
- single_next_parent

