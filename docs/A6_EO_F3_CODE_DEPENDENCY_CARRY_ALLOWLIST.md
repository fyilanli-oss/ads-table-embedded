# A6 EO-F3 — Kod ve bağımlılık taşıma izin listesi

**Tarih:** 4 Ekim 2026  
**Tarihsel durum:** EO-F3 tamamlandı; EO-F4 bekleniyor

**Etkisi:** Salt okunur mimari karar. Production, sağlayıcı, veritabanı, dağıtım veya Shopify yapılandırması değişikliği yapmaz.

**Okuma notu:** Bu belge eski `fyilanli-oss/ads-table-dev` yapısının 4 Ekim 2026 incelemesidir. “Mevcut” ve “henüz oluşturulmadı” ifadeleri o güne aittir; temiz projenin bugünkü durumunu anlatmaz. Güncel iş sırası `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` içindedir. Bu dil düzenlemesi taşıma sınıflarını veya uygulama yetkisini değiştirmez.

## Analist sonucu

Yalnız Shopify içine gömülü çalışan yeni ürün, mevcut uygulamanın “temizlenmiş kopyası” olmayacaktır. Eski repository'deki hiçbir uygulama modülü aynen taşınmaya uygun bulunmamıştır. Çalıştığı kanıtlanan iş davranışları referans olarak kullanılacak; müşteri/çalışma alanı yetkisi, güvenlik, veri doğruluğu ve Shopify UI sınırları temiz hedef modüllerde yeniden kurulacaktır.

Amaç aynı davranışı tekrar keşfetmek değil, eski yapının bağımlılıklarını taşımadan kanıtlanmış bilgiyi korumaktır.

## İnceleme zemini

4 Ekim 2026 `main` ağacı ve dolaylı import ilişkileri incelendi:

- 819 repository dosyası
- 305 KB kök `server.js`
- 1.53 MB `public/`
- 120 dosya / 562 KB `src/`
- 203 test dosyası / 1.02 MB `tests/`
- mevcut doğrudan bağımlılıklar: `express`, `googleapis`, `@supabase/supabase-js`

Önemli bulgular:

- `src/shopify/runtime.js`, ürün çalışma zamanı ile tarihsel envanter ve kontrollü kabul modüllerini aynı kurulum noktasında birleştiriyor.
- `src/shopify/embedded-app-home.js`, gerçek ürün yüzeyiyle kabul/hata ayıklama/tarihsel davranışları ve emekli sağlayıcı izlerini birlikte taşıyor.
- Çalışma alanı Dataset/sorgu katmanında hâlâ `user_id` uyumluluk izleri var.
- Mevcut token deposu eski `platform_connection_tokens` tablosuna bağlı.
- O gün gizlilik yaşam döngüsü gerçek silme motoru değil, planlayıcı seviyesinde.
- Mevcut paket tanımı yeni ürünün bağımlılık tanımı olarak kullanılamaz.

## Dört sınıflı bağlayıcı karar

### 1. Carry-as-is — Aynen taşı

Uygulama/çalışma zamanı kodu için sonuç: **sıfır modül**.

İçerikleri ayrıca özet değerleri ve köken kayıtlarıyla doğrulanırsa başlangıca aynen alınabilecek tek çıktılar:

- EO kararları ve yürütülebilir sözleşmeler
- Shopify Embedded UI Anayasası
- kabul edilmiş şema/metrik/formül sözleşmeleri
- sağlayıcı ham kanıtları ve uzlaştırma kanıtı
- bağımsız test veri örnekleri; yalnız kişisel veri veya gizli değer içermiyorsa

Bunlar çalışma zamanı bağımlılığı değildir.

### 2. Extract-and-rewrite — Davranışı çıkarıp yeniden yaz

Aşağıdaki kaynaklar davranış referansı olabilir. Dosya kopyalanamaz; temiz hedef arayüz ve yalnız çalışma alanına dayalı yetki kaynağıyla yeniden yazılır:

| Hedef yetenek | Kaynak ailesi | Yeniden yazma şartı |
|---|---|---|
| Shopify müşteri/kurulum/oturum | `src/shopify/tenant-model.js`, gömülü kimlik doğrulama ve yönetilen kurulum ailesi | Yalnız `workspace_id`; temiz yeniden kurulum nesli, faturalandırma ve yaşam döngüsü kapıları |
| Kanonik sağlayıcı bağlantısı | `src/providers/workspace-provider-connection-store.js` | Eski uyumluluk katmanı ve `user_id` çıkarılır; EO-F4 en az yetkili veri katmanı |
| Token şifreleme | `security/provider-token-vault.js` | Çalışma alanı/kurulum nesli ek doğrulama verisi (AAD); başlangıç hatasında kapalı kalma; eski token deposu yok |
| Meta adaptörü | `src/providers/meta/**` içindeki istemci/kabiliyet/normalleştirme/eşleme davranışları | Tarihsel, kontrollü kabul ve operatör modülleri ayrılır |
| Google Ads adaptörü | `src/providers/google-ads/**` içindeki arama istemcisi/dönüşüm/eşleme davranışları | Google Sheets ve `googleapis` dolaylı bağı yok; ham yanıt/veri kökeni korunur |
| Klaviyo adaptörü | `src/providers/klaviyo/**` içindeki sağlayıcı istemcisi/metrik bağlama/eşleme davranışları | Tarihsel envanter ve kabul araçları Production derlemesi dışında |
| Dataset V2 | `funnel-core/workspace-*` ve eşleyici davranışları | `user_id` yedek yolu yok; EO-F4 şeması; kesinleşme/uzlaştırma zorunlu |
| Zaman, döviz kuru (FX), hiyerarşi | `funnel-core` saf davranışları | Nihai sözleşmeye karşı davranış doğrulaması; yanlış/belirsiz anlam taşınmaz |
| Formül/sorgu | mevcut formül/sorgu davranışları | A4 bulguları düzeltilir; kanonik adlar, null/bilinmeyen ve maliyet dağıtımı doğruluğu |
| OAuth işlemi | mevcut yaşam süresi (TTL)/state davranışı | Satır taşınmaz; çalışma alanı/kurulum nesline bağlı temiz depo |
| Zamanlayıcı/kesinleşme | mevcut saatlik cron ve sağlayıcı davranışları | Tek yetki kaynağı, kiralama/ilerleme noktası, aynı işlem tekrarlandığında çoğalmayan kayan pencere uzlaştırması |

“Extract” kaynak davranışını anlamak içindir; kopyala-yapıştır izni değildir.

### 3. Contract-only — Yalnız sözleşmeyi al

Aşağıdakilerde mevcut kod değil, yalnız kabul edilmiş davranış taşınır:

- Shopify App Home, Settings, sağlayıcı bağlantısı ve veri kaynağı arayüzleri
- App Bridge ve güncel Polaris web bileşeni eşlemesi
- Formül/karşılaştırma/niyet API anlamı
- Dataset satır sözleşmesi, veri kökeni, olgunluk ve kesinleşme
- gizlilik webhook işleme sahipliği, Workspace Data Deletion ve Clean Reinstall davranışları
- Shopify faturalandırması, 14 günlük deneme ve kullanım hakkı
- zamanlayıcı/kiralama/ilerleme noktası davranışı
- OAuth state/TTL/tekrar kullanım güvenliği
- yan yana eşlik, kademeli geçiş (canary), geri dönüş ve eski tüketicilerin sıfırlanması kapıları
- kontrollü kabul testlerinin doğruladığı beklentiler

UI, kod yazılmadan önce analist brief'i ve birebir Shopify bileşen eşlemesiyle yeniden tasarlanır. Resmî bileşen/özellik doğrulanmadan uygulama başlamaz.

### 4. Retire — Emekliye ayır / hedef derlemeye giremez

- kök `server.js` monoliti
- `public/` bağımsız giriş/kayıt/pano ve eski statik ürün
- eski `users`, `user_settings`, `subscriptions` yetki kaynağı davranışları
- `platform_connections`, `platform_connection_tokens` ve eski OAuth/yenileme yolları
- V1 anlık görüntüler, V1 veri kümesi, eski işler/zamanlamalar ve kullanıcıya bağlı geçmiş veri tamamlama çalışma zamanı
- GA4, Google Sheets, TikTok, Pinterest ve Organic çalışma zamanı/sağlayıcı yüzeyleri
- `shopify_workspace_provider_connections` geçiş dönemi yetki kaynağı
- çift yazım, canlı gölge çalışma ve eski birincil/kanonik kaynağa geri dönme yolları
- hata ayıklama, test, operatör, tanılama, kontrollü kabul ve tarihsel envanter rotaları
- mevcut `package.json`, lockfile, Vercel rota/derleme dosya kalıpları ve toplu ortam değişkeni kopyası
- mevcut gömülü UI dosyalarının toplu kopyası veya CSS/HTML ile Shopify taklidi

Eski repository yetkili EO geçişine kadar riski sınırlama/geri dönüş hattıdır. “Retire” bugün silme yetkisi vermez.

## Temiz bağımlılık politikası

Yeni repository, sıfırdan üretilmiş paket tanımı ve lockfile ile başlar.

### İzinli bağımlılık kategorileri

- EO-01'de güncel resmî Shopify dokümanına göre seçilecek resmî uygulama altyapısı
- Shopify App Bridge ve Polaris web bileşenleri için resmî paket/dağıtım biçimi
- EO-F4'te seçilecek veri katmanına uygun tek veritabanı istemcisi/sürücüsü
- aktif sağlayıcılar için mümkünse platformun kendi `fetch`/Web Crypto/Node crypto araçları
- test, lint, typecheck ve build için yalnız kullanılan araçlar

### Otomatik taşınması yasak mevcut bağımlılıklar

- `express`: otomatik taşıma yok; hedef uygulama çatısı EO-01'de belirlenir
- `googleapis`: taşıma yok; Google Ads hedef adaptörüne dolaylı bağ olamaz
- `@supabase/supabase-js`: otomatik taşıma yok; EO-F4 veri katmanı kararından sonra gerekçelendirilir
- mevcut lockfile ve dolaylı bağımlılık ağacı: taşıma yok

### Her yeni bağımlılık için kapı

Her doğrudan bağımlılık kaydı şu alanları taşır:

1. sahibi olduğu tek hedef yetenek;
2. neden platformun kendi çözümünün yetmediği;
3. çalışma zamanında mı, yalnız geliştirmede mi kullanıldığı;
4. tarayıcı/sunucu sınırı;
5. gizli değer ve müşteri/çalışma alanı etkisi;
6. lisans ve bakım durumu;
7. sürüm sabitleme/güncelleme politikası;
8. kaldırma ve geri dönüş yolu.

Kullanılmayan bağımlılık CI'da kabul edilmez. Sağlayıcı SDK'sı eklemek varsayılan değil, kanıt gerektiren istisnadır.

## Hedef derleme sınırı

Yeni Production çıktısında şu yasak durum kontrolleri bulunacaktır:

- yasak sağlayıcı veya eski klasör adlarından import: 0
- `user_id` ile müşteri yetkisi belirleme: 0
- eski tablo adı kullanımı: 0
- hata ayıklama/operatör/kabul rotası kaydı: 0
- kök monolit veya eski public dosyalarının dahil edilmesi: 0
- tarayıcı paketinde sunucu gizli değeri/istemcisi: 0
- tanımsız ortam değişkeni okuması: 0
- kullanılmayan doğrudan bağımlılık: 0

CI; izinli import grafiği, yasak metin/tablo/rota taraması, bağımlılık envanteri, gizli değer taraması ve Production paket incelemesi çalıştırmadan merge'e izin vermez.

## EO paketlerine tarihsel etkisi

Bu karar uygulama başlatmaz. Aşağıdaki liste ilk fizibilite taslağının paket eşlemesidir; sonraki bağlayıcı Execution Plan'daki numaralandırmanın yerine geçmez:

- **EO-F4:** birebir şema/veri taşıması, veri katmanı ve kimlik bilgisi sınırı
- **EO-F5:** ürün/rota haritası; Production ile operatör/test yüzeyinin ayrılması
- **EO-F6:** yeniden yazma birimlerinin gerçek süre/risk hesabı
- **EO-F7:** insan GO/NO-GO kararı
- **EO-01:** temiz repository/derleme/CI ve resmî Shopify altyapısı seçimi
- **EO-02:** çalışma alanı/kurulum/faturalandırma/yaşam döngüsü temelleri
- **EO-03:** sağlayıcı adaptörlerinin yeniden yazımı
- **EO-04:** Dataset/formül/sorgu yeniden yazımı
- **EO-05:** zamanlayıcı/kesinleşme/silme
- **EO-06+:** UI, eşlik, kademeli geçiş, yetkili geçiş ve eski tüketicilerin sıfırlanması

**Güncel sıra için yönlendirme:** Execution Plan'da EO-03 OAuth/bağlantı/token kasası, EO-04 sağlayıcı adaptörleri, EO-05 zamanlayıcı/Dataset/FX/kesinleşme, EO-06 formül/sorgu/API, EO-07 UI, EO-08 eşlik/kademeli geçiş/geri dönüş, EO-09 yetki geçişi ve tüketici-sıfır, EO-10 emekliye ayırmadır. Yukarıdaki tarihsel liste yeni görev açmaz veya kabul edilmiş paketleri geri almaz.

## Tarihsel kabul sonucu

EO-F3 **PASS**:

- uygulama kodunu aynen taşıma sayısı: **0**
- dört sınıflı izin listesi makinece okunabilir biçimde donduruldu
- mevcut paket tanımı toplu taşıma dışında
- yasak sağlayıcı/eski bağımlılık için hedef derlemeye dahil edilme hedefi: **0**
- o gün yeni repository/proje hâlâ oluşturulmadı
- Production, veritabanı, sağlayıcı ve dağıtım değişikliği: **0**
- o günkü sonraki kapı: **EO-F4 — Şema ve veri taşıma haritası**

