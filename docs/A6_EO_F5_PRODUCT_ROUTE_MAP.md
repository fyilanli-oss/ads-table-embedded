# A6 EO-F5 — Yalnız Shopify içine gömülü ürünün yüzey ve rota haritası

**Tarih:** 4 Ekim 2026

**Tarihsel durum:** EO-F5 tamamlandı; EO-F6 bekleniyor

**Etkisi:** Salt okunur ürün, rota ve tüketici sözleşmesi. Kod, repository/proje, Shopify yapılandırması, sağlayıcı, veritabanı veya dağıtım değiştirmez.

**Okuma notu:** Bu belge 4 Ekim 2026 ürün haritası ve mantıksal rota taslağıdır. Aşağıdaki API yolları bugünkü uygulanmış endpoint envanteri değildir; sonraki EO sözleşmeleri bunları somutlaştırır. Güncel durum `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` içindedir. UI için kabul edilmiş Shopify Embedded UI Anayasası ve sonraki açık ürün kararları bağlayıcıdır; bu çeviri yeni bileşen/sürüm seçmez veya rota açmaz.

## Analist sonucu

Hedef gömülü ürün yalnız **üç ana yüzeyden** oluşacaktır:

1. **Funnel** — Shopify App Home
2. **Ad Analysis**
3. **Settings**

Platforms ayrı yüzey değil, Settings içindeki sağlayıcı bağlantıları bölümüdür. Dashboard ayrı ürün sayfası değil, Funnel ve Ad Analysis bağlamında açılan grafik panelleridir. Attribution Differences ayrı gezinme yüzeyi değildir; **E10-T5-C2-C Cross-platform deepest-grain discovery** ile tanımlanan sağlayıcılar arası en alt kırılım keşfinden sonra Ad Analysis içinde açılan analiz görünümüdür. Güncel EO karşılığı A6-EO-07-C'dir.

Bu karar yüzey sayısını altıdan üçe indirir. Mağaza sahibi genel performansı Funnel'da, en alt kırılımı ve karşılaştırmayı Ad Analysis'te, kurulum/yönetim işlerini Settings'te bulur.

## Resmî Shopify kontrolü

Aşağıdakiler 4 Ekim 2026 tarihindeki resmî kaynak kontrolünün kaydıdır; güncel sürüm seçimi değildir:

- iframe tabanlı herkese açık App Home, App Bridge ve Polaris web bileşenlerini kullanır;
- App Nav'da uygulama adı zaten ana rotaya gider; yinelenen ana sayfa bağlantısı eklenmez;
- App Nav masaüstünde yan menü, mobilde açılır liste olarak Shopify tarafından sunulur;
- zorunlu gizlilik konuları `customers/data_request`, `customers/redact` ve `shop/redact`tir; HMAC doğrulanamayan istek 401 ile reddedilir;
- uygulamaya özel webhook abonelikleri uygulama yapılandırmasından yönetilmelidir;
- Polaris 2 o gün release candidate niteliğindedir; UI Anayasası'nın yeniden doğrulama kapısı korunur.

Kaynaklar:

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components/app-nav
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/build/webhooks/subscribe
- https://shopify.dev/docs/api/webhooks/2025-10

## Üç yüzeyli ürün kabuğu

| Kanonik rota | Ana yüzey | İçindeki işlevler | Review durumu |
|---|---|---|---|
| `/` | Funnel / App Home | Funnel, Table görünümü ve bağlamsal Dashboard grafikleri | Review için kritik |
| `/ad-analysis` | Ad Analysis | En alt kırılım analizi, bağlamsal grafikler ve keşif sonrasında Attribution Differences | Review için kritik |
| `/settings` | Settings | Para birimi, Platforms/sağlayıcı bağlantıları, Klaviyo maliyeti, deneme/faturalandırma, gizlilik ve Delete My Data | Review için kritik |

### Gezinme

Mantıksal ürün sırası:

1. Funnel
2. Ad Analysis
3. Settings

Funnel, uygulama adı ve `/` üzerinden ana sayfadır. Shopify'ın resmî ana sayfa davranışı nedeniyle App Nav'a ikinci bir Funnel satırı eklenmez. Gösterilen App Nav öğeleri yalnız **Ad Analysis** ve **Settings** olur.

### Ayrı yüzey olmaktan çıkarılanlar

- **Dashboard:** Ayrı rota/menü değildir; Funnel ve Ad Analysis içinde ekranın bağlamına göre açılan grafik panelleridir.
- **Platforms:** Ayrı rota/menü değildir; Settings içindeki sağlayıcı bağlantısı/kurulum bölümüdür.
- **Attribution Differences:** Ayrı rota/menü değildir; E10-T5-C2-C tamamlandıktan sonra Ad Analysis içinde açılır. Karşılaştırılabilir kırılım bulunamazsa sahte ekran açılmaz; `capability_unavailable` gösterilir.
- **Funnel/Table:** Aynı App Home içindeki görünüm seçimidir; ayrı genel rota değildir.

`/dashboard`, `/platforms`, `/attribution-differences`, `/analysis`, `/shopify/app/*` ve `/funnel` hedef kanonik rota değildir. Eski çalışma zamanı yetkili geçişe kadar eski rotalarının sahibi kalır; yeni çalışma zamanında ikinci ürün ağacı kurulmaz.

## Giriş ve ilk kurulum çözümleyicisi

Her UI isteği, sunucuda doğrulanmış Shopify oturumundan mağazayı, kurulum neslini ve `workspace_id` değerini türetir. Query/body içindeki çalışma alanı veya mağaza yetki kaynağı değildir.

Çözümleme sırası:

1. Shopify oturumu yok/geçersiz → güvenli biçimde kapalı kalan gömülü kimlik doğrulama yanıtı; bağımsız giriş ekranı yok.
2. İlk kurulum eksik/geçersiz → yönetilen kurulum/ilk hazırlık.
3. Faturalandırma kullanım hakkı yok/süresi dolmuş → `/settings` plan/deneme bölümü.
4. Raporlama para birimi yok → `/settings` para birimi bölümü.
5. Etkin ve doğrulanmış sağlayıcı hesabı yok → `/settings` Platforms bölümü.
6. Klaviyo seçili ve Email Monthly Plan Cost eksik → `/settings` Platforms/Klaviyo maliyet bölümü.
7. Hazır → `/` Funnel.

Doğrudan Ad Analysis bağlantısında da aynı koruma çalışır. Tamamlanınca dönüş hedefi güvenli izin listesiyle korunur; dış URL, gizli değer, kişisel veri veya çağıranın verdiği müşteri bilgisi taşınmaz.

## Kimliği doğrulanmış BFF sınırı

BFF, arayüzün kullandığı sunucu katmanıdır. UI yalnız aynı kökendeki sunucu BFF rotalarını tüketir; tarayıcı veritabanı istemcisi veya sağlayıcı token'ı görmez. Aşağıdaki yollar ayrı ürün yüzeyleri değil, üç yüzey için tarihsel sunucu veri taslağıdır.

| Metot ve rota | Tüketen yüzey | İşlev |
|---|---|---|
| `GET /api/app/context` | Tümü | Oturum, ilk kurulum, kullanım hakkı, para birimi ve sağlayıcı hazırlığı |
| `GET /api/workspace/settings` | Settings | Raporlama para birimi ve gösterilebilir ayarlar |
| `PATCH /api/workspace/settings/reporting-currency` | Settings | Mağaza sahibinin para birimi seçimi |
| `GET /api/providers` | Settings | Meta/Google Ads/Klaviyo bağlantı özeti |
| `GET /api/providers/:provider/accounts` | Settings | Doğrulanmış hesap keşfi |
| `PUT /api/providers/:provider/active-account` | Settings | Kanonik raporlama hesabı seçimi |
| `POST /api/providers/:provider/disconnect` | Settings | Bağlantı yaşam döngüsü |
| `GET /api/providers/klaviyo/email-spend-history` | Settings | Sürümlü maliyet geçmişi |
| `POST /api/providers/klaviyo/email-spend-history` | Settings | Geçerlilik tarihli maliyet kaydı |
| `GET /api/reports/funnel` | Funnel | Funnel/Table okuma modeli |
| `GET /api/reports/dashboard` | Funnel + Ad Analysis | Bağlamsal grafik verisi; ayrı sayfa üretmez |
| `GET /api/reports/ad-analysis` | Ad Analysis | Kanıtlı en alt kırılım okuma modeli |
| `GET /api/reports/attribution-differences` | Ad Analysis | Keşif sonrası salt okunur karşılaştırma |
| `GET /api/refresh/status` | Funnel + Ad Analysis | Veri güncelliği/kesinleşme; yenileme başlatmaz |
| `GET /api/billing/entitlement` | Settings | Gerçek deneme/abonelik durumu |
| `POST /api/billing/subscribe` | Settings | Shopify faturalandırma onay akışı |
| `POST /api/privacy/deletion-requests` | Settings | Delete My Data talebi |
| `GET /api/privacy/deletion-requests/:requestId` | Settings | Aynı çalışma alanındaki talebin durumu |

Kesin istek/yanıt şemaları EO-02–EO-07 paketlerinde sürümlenir. Ayrı API yolu, ayrı gezinme yüzeyi anlamına gelmez.

## OAuth ve geri dönüş

- `POST /api/providers/:provider/oauth/start`
- `GET /api/providers/:provider/oauth/callback`

Sağlayıcı izin listesi yalnız `meta|google-ads|klaviyo`dur. Başlatma, doğrulanmış Shopify oturumu ve çalışma alanına ait işlem gerektirir. Geri dönüşte state, PKCE/nonce ve TTL doğrulanmadan token değişimi veya bağlantı yazımı yapılmaz. Başarı/iptal/hata dönüş hedefi yalnız `/settings` içindeki Platforms bölümüdür.

TikTok ve Pinterest hedef sağlayıcı izin listesine girmez; EO kararı E10-T5C4'teki eski aktif sağlayıcı gösterimini geçersiz kılar.

## Shopify webhook'ları

Tek kanonik giriş: `POST /webhooks/shopify`.

Ham gövde korunur; HMAC ve konu izin listesi JSON işlemeden ve veritabanı yazımından önce doğrulanır. Desteklenen konu sınıfları:

- `customers/data_request`
- `customers/redact`
- `shop/redact`
- `app/uninstalled`
- faturalandırma kullanım hakkı değişimini taşıyan resmî konu — kesin API adı EO-02'de güncel resmî dokümanla dondurulur

Her teslim, aynı işlem tekrarlandığında çoğalmayan webhook işleme sahipliği kaydı üretir. Bilinmeyen konu kapalı kalır. Gizlilik konuları UI oturumu veya etkin kurulum gerektirmez; HMAC + mağaza/kurulum nesli bağı kullanır.

## İç çalışma zamanı girişleri

| Rota | Çağıran | Kural |
|---|---|---|
| `POST /internal/jobs/hourly-refresh` | Yalnız Vercel Cron/iç imzalı çağıran | Mağaza sahibi/UI çağıramaz; bölümleme + kiralama + tekrarlandığında çoğalmayan ekleme/güncelleme |
| `GET /healthz` | Platform sağlık kontrolü | Gizli değer, sağlayıcı/müşteri ayrıntısı veya veritabanı satırı döndürmez |

Saatlik yenileme yalnız AdsTable'ın kendi zamanlayıcısından başlatılır. Sayfa veya grafik paneli açılması, tarayıcının yeniden yüklenmesi veya birden fazla Shopify kullanıcısı yenileme üretmez. İlk yükleme yalnız dün + bugündür; kayan uzlaştırma/kesinleşme EO-05'e tabidir.

## Production yüzeyinden yasaklanan rota sınıfları

Hedef derleme aşağıdakileri ürün rotası olarak içeremez:

- `/api/e10/*` kabul/ön kontrol/deneme yolları
- `*/runtime/preflight`, `*/runtime/acceptance`
- tarihsel envanter ve elle tarihsel veri çekme
- kontrollü sıfırlama, kullanıcı yolculuğu tanılaması, Flow olay envanteri
- ham sağlayıcı yanıtı/metrik keşfi/operatör seçimi rotaları
- test, hata ayıklama, sentetik veri ve gizli değer inceleme yolları
- bağımsız `/login`, `/signup`, `/auth/*`, eski pano
- tarayıcıdan tetiklenen elle yenileme
- genel amaçlı vekil veya çağıranın URL/müşteri verdiği rota

Bu liste bağımsız eski kimlik doğrulama ürününü yasaklar; sonraki kabul edilmiş Shopify gömülü kimlik doğrulama sözleşmesini veya onun gerçek rotalarını kaldırmaz. Gerekli tanılama ayrı operatör aracı/CI kanıtı olarak çalışır; Production ürün yönlendiricisine bağlanmaz.

## Kullanıcı yolculuğu, durum ve kanıt kapıları

Aşağıdaki durum adları teknik kimliktir; İngilizce değerler korunur.

| Yolculuk | Ana yüzey | Zorunlu görünür durum | Tamamlanma kanıtı |
|---|---|---|---|
| Kurulum/oturum | Uygulama kabuğu | loading, auth failure, forbidden | masaüstü/mobil oturum + kurcalama ret testi |
| Deneme/faturalandırma | Settings | trial, active, expired, billing_error | faturalandırma uzlaştırması; EO-02 |
| Para birimi | Settings | required, saved, invalid | sunucudan geri okuma + denetim |
| Bağlan/yeniden bağlan | Settings / Platforms bölümü | loading, cancel, error, reauthorization_required | sağlayıcı kimlik/okuma kontrolü |
| Hesap seçimi | Settings / Platforms bölümü | empty, partial, forbidden, error | geri okuma + sahiplik |
| Klaviyo maliyeti | Settings / Platforms bölümü | required, active, validation_error | sürümlü geçmiş + dağıtım |
| Saatlik yenileme | Sistem; durum Funnel/Ad Analysis'te | queued, running, partial, stale, final | çalıştırma/ilerleme noktası/uzlaştırma |
| Funnel + grafikler | Funnel | loading, empty, partial, stale, reauth, error | API/UI eşliği, masaüstü/mobil |
| En alt kırılım + grafikler | Ad Analysis | aynı durumlar + kullanılamayan boyutlar | sağlayıcı ham/normalleştirilmiş veri eşliği |
| Attribution Differences | Ad Analysis; keşif sonrası | capability_unavailable dahil | kapsam/kırılım kabiliyeti + değişiklik yapmama kanıtı |
| Delete My Data | Settings | confirm, queued, running, complete, failed | işlemi tekilleştirme + silme manifesti |
| Uninstall | Yaşam döngüsü | UI erişimi yok | webhook işleme sahipliği + durmuş kiralamalar |
| Clean reinstall | İlk kurulum | yeni nesil | nesil yalıtımı + 48 saatlik yarış testleri |

Eksik veri sıfıra çevrilmez. `unsupported`, `unknown`, `partial`, `stale`, `reauthorization_required` ve `capability_unavailable` ayrı gerçek ürün durumlarıdır.

## UI Anayasası eşlemesi

Bu paket UI kodu yazmaz. EO-07 öncesinde her ana ekran için analist brief'i, durum/metin matrisi ve birebir Shopify bileşen/özellik/varyant eşlemesi hazırlanacaktır.

Dondurulan kabuk yönü:

- uygulama menüsü: resmî App Bridge/Polaris `s-app-nav` / `s-link`
- sayfa kabuğu: `s-page`
- birincil/ikincil eylemler: `s-button`
- form alanları: resmî Polaris web bileşenleri
- grafik panelini açan kontrol: güncel resmî açma/eylem karşılığı doğrulanmadan seçilmez
- uyarı/bildirim/rozet/tablo/boş durum: yalnız güncel resmî karşılığı doğrulanırsa
- ham HTML eylem kontrolü, `s-clickable` ile buton taklidi, satır içi CSS, sabit renk ve özel Shopify görünümü taklidi yasak

EO-07'de Polaris kararlı/RC durumu yeniden doğrulanır. Kabul edilmiş sürüm kararı bu çeviride değiştirilmez. Masaüstü ve gerçek Shopify Admin mobil 320px kanıtı ve açık ürün sahibi kabulü olmadan ekran Done/merge olamaz.

## Veritabanı tüketici haritası

| Tüketici | Okuma | Yazma |
|---|---|---|
| Oturum/ilk kurulum koruması | `shopify.installations`, `app.*`, `billing.*`, `integrations.provider_connections` | ilk hazırlık işlemi dışında yok |
| Settings | `app.*`, `billing.*`, `privacy.*`, `integrations.*`, `analytics.email_spend_history` | para birimi, bağlantı/hesap, harcama geçmişi, faturalandırma niyeti, silme talebi |
| Funnel | `analytics.*`, `operations.reconciliation_ledger` | yok |
| Ad Analysis | `analytics.*`, `operations.reconciliation_ledger` | yok |
| Saatlik yenileme | `integrations.*`, `app.workspace_settings` | `analytics.*`, `operations.*` |
| Webhook/yaşam döngüsü | `shopify.installations` | `privacy.*`, `billing.*`, kurulum durumu |
| Taşıma/yetkili geçiş | kısıtlı kaynak manifestleri | yalnız EO-F4 izin listesindeki taşıma |

UI, tarayıcı ve App Bridge hiçbir şemaya doğrudan bağlanmaz. BFF çağıranın verdiği çalışma alanını kabul etmez.

## Önceki sözleşmelerle çatışma çözümü

- E10-T5C7'deki altı öğeli gezinme üç ürün yüzeyinde birleştirilmiştir.
- Funnel kök/uygulama adı üzerinden ana sayfadır; App Nav'da yinelenmez.
- Dashboard ayrı rota değildir; Funnel ve Ad Analysis bağlamındaki grafik panelleridir.
- Platforms ayrı rota değildir; Settings içindeki sağlayıcı bağlantıları bölümüdür.
- Attribution Differences ayrı rota değildir; E10-T5-C2-C sonrasında Ad Analysis içine girer.
- E10-T5C4'teki TikTok aktif görünümü geçersizdir; aktif sağlayıcılar Meta, Google Ads ve Klaviyo'dur.
- Faturalandırma ayrı genel menü değildir; Settings içindedir.
- Elle yenileme yoktur; kullanıcı yalnız veri güncelliği/çalıştırma durumunu görür.

## Tarihsel kabul sonucu

EO-F5 **PASS**:

- üst düzey ürün yüzeyi: 3
- kanonik gömülü UI rotası: 3
- gösterilen App Nav bağlantısı: 2 — ana sayfa olan Funnel yinelenmez
- aktif sağlayıcı: 3
- bağımsız Dashboard/Platforms/Attribution rotası: 0
- bağımsız UI/giriş rotası: 0
- Production hata ayıklama/operatör/kabul rotası: 0
- tarayıcıdan tetiklenen yenileme rotası: 0
- doğrudan tarayıcı veritabanı erişimi: 0
- uygulama/Production/sağlayıcı/veritabanı/dağıtım değişikliği: 0
- o günkü sonraki kapı: **EO-F6 — Onarım ve yeniden kuruluş efor/risk karşılaştırması**

Bu paket EO-F7 GO vermez, yeni repository/proje oluşturmaz, Shopify uygulama URL'sini değiştirmez, webhook kaydetmez veya mevcut çalışma zamanını kapatmaz.

