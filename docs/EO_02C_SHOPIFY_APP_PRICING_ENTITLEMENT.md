# EO-02-C — Shopify App Pricing: deneme, abonelik ve kullanım hakkı

**Kontrol tarihi:** 8 Ekim 2026

**O tarihteki ara durum:** Veritabanı ve null/trial/active sağlayıcı kabulü geçti. Tarayıcı/yanıt/log sızıntı kontrolü geçti. Çalışma zamanı adaptörü ve doğrulanmış iç çağırıcı hazırdı; Production veritabanı gizli bilgisinin etkinleştirilmesi ve canlı kalıcı kayıt kanıtı açıktı.

Bu belge EO-02-C'nin 6–9 Ekim 2026 arasındaki hazırlık ve düzeltme kayıtlarını anlatır. Aşağıdaki açık kalemler ilgili ara aşamaya aittir; bugünkü açık iş listesi değildir. Nihai EO-02-C kabulü `docs/runbooks/EO_02C_LIVE_ACCEPTANCE_RUNBOOK.md` içindedir. Güncel proje durumu için Execution Plan geçerlidir.

## Analist sonucu

AdsTable'ın Shopify kaynaklı kullanıcı ücretlendirmesini Shopify App Pricing yönetir. AdsTable abonelik veya deneme süresi üretmez; Shopify Partner API'nin doğrulanmış `activeSubscription(appId, shopId)` sonucunu çalışma alanının kullanım hakkı (entitlement) kaydına yansıtır.

On dört günlük deneme Shopify planında tanımlanır. Shopify son 180 gündeki kullanılmış deneme günlerini izler; uygulamayı kaldırıp yeniden kurmak süreyi sıfırlamaz. Yerel `trial_ledger`, yalnız Shopify'ın bildirdiği deneme durumunun denetim izidir; erişim verme yetkisi yoktur.

## Tarihsel resmî kaynak kararı

6 Ekim 2026 tarihinde şu Shopify kuralları kontrol edildi:

- Yeni, herkese açık uygulamalarda desteklenen fiyat modelleri için varsayılan yöntem Shopify App Pricing'dir.
- Plan, fiyat ve deneme süresi Partner Dashboard/App Store listelemesinde tanımlanır.
- Uygulama, `appSubscriptionCreate` veya framework'ün `billing.request` işlemiyle yeni ücret oluşturmaz.
- Kullanıcı planını Shopify'ın barındırdığı plan seçim sayfasından seçer.
- Canlı abonelik gerçeği Partner API `2026-07` sürümünün `activeSubscription` sorgusundan okunur.
- Sorgu `null` döndürürse aktif abonelik sözleşmesi yoktur.
- Deneme sırasında `trialEndsAt` dolu, `currentBillingCycle` null'dır; deneme bittiğinde bunun tersi geçerlidir.
- Shopify App Pricing faturalandırma yaşam döngüsü webhook'u göndermez. Yönlendirmeden sonra ve yönlendirme dışı iptal/dondurma değişiklikleri için Partner API yeniden sorgulanır.
- Partner API istemcisi organizasyon kapsamlı gizli bilgi ve `Manage apps` yetkisi ister. Sınır istemci başına saniyede dört istektir.

Kaynaklar:

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials
- https://shopify.dev/docs/api/partner/latest
- https://shopify.dev/docs/api/partner/latest/active-subscription

## 7 Ekim 2026 — Partner API canlı yetki kanıtı

- Shopify Partner API istemcisi: `AdsTable Entitlement Runtime`
- İstemci kimliği: `38724`
- Yetki: yalnız `Manage apps`
- Kapalı yetkiler: `View financials`, `Manage app subscriptions`, `Manage themes`
- API sürümü: `2026-07`
- Salt okunur GraphiQL sorgusu: `app(id: "gid://partners/App/432251994113") { id name }`
- Doğrulanan sonuç: `gid://partners/App/432251994113` / `AdsTable`
- Erişim token'ı repository'ye, kanıt dosyasına, sohbete veya loga yazılmadı.
- Bu kanıt yalnız organizasyon kapsamlı istemci kimlik doğrulamasını ve `Manage apps` erişimini doğrular. Plan oluşturulup mağazada seçilmeden `activeSubscription` deneme/aktif/null kabulü tamamlanmış sayılmaz.
- Tam ortam değişkeni adları ve başlangıç koruması sabitlenmeden Vercel gizli bilgisi etkinleştirilmez.

## 8 Ekim 2026 — Canlı deneme sonucu

- Shopify App Store kaydı tamamlandı. Herkese açık `AdsTable Monthly` planı `USD 24.99 / 30 gün`, 14 günlük deneme ve `/` karşılama bağlantısıyla oluşturuldu.
- Yeni uygulama `adstable-1` Shopify Admin adıyla `adstable-development.myshopify.com` geliştirme mağazasına kuruldu. iframe hedefi `embedded.adstable.app`, istemci kimliği `58c91f39f69ca282a94ba06e9648be9e` olarak doğrulandı.
- Mağaza ve uygulama farklı Dev Dashboard organizasyonlarında olduğundan plan `Free for partners and developers` seçeneğiyle ücretsiz test edildi.
- Partner API deneme yanıtı `trialEndsAt=2026-10-22T08:02:49Z`, `currentBillingCycle=null`, `pendingUpdate=null` ve `adstable-monthly` plan adını döndürdü.
- Geliştirme mağazasına uygulanan fiyat `USD 0.0`, `price.active=false` geldi. Resmî sözleşmede `price.active` fiyat sürümünün güncelliğidir; abonelik veya kullanım hakkının aktiflik bayrağı değildir.
- Eski çalışma zamanının `price.active === true` şartı bu yanıtı yanlış reddediyordu. Kod, sözleşme ve test düzeltilmeden deneme sonucunun kalıcı kaydı geçmiş sayılamaz.
- Gizli bilgi içermeyen kısmi kanıt: `docs/evidence/EO_02C_LIVE_ACCEPTANCE_2026-10-08.json`.

## 8 Ekim 2026 — Canlı aktif abonelik sonucu

- `adstable-development.myshopify.com`, Shopify'ın oluşturduğu `shopify-test` özel planına hedef mağaza olarak eklendi.
- Shopify onay ekranı ücretsiz planı ve ücret alınmayacağını gösterdi; dönüş adresi `plan_handle=shopify-test` taşıdı.
- Partner API `activeSubscription` sonucu `trialEndsAt=null`, `billingPeriod=EVERY_30_DAYS`, `cancelAtEndOfCycle=false` ve `pendingUpdate=null` döndürdü.
- Faturalandırma dönemi `2026-10-08T08:45:05Z → 2026-11-07T08:45:05Z` oldu.
- Abonelik kaleminin adı `shopify-test`; uygulanan fiyat `USD 0.0`; `price.active=true` gözlendi.
- Sağlayıcının aktif durum kabulü geçti. Ancak veritabanına yansıtma/kalıcı kayıt ve gizli bilgi/log/tarayıcı sızıntı kontrolleri tamamlanmadan EO-02-C kapanmaz.

## 8 Ekim 2026 — Kalıcı kayıt ön kontrolü

- Production dağıtımı `dpl_CtweiU8YdzpoAxXKFibrDtwBgxyN`, kaynak commit `2afe0083efe269574dc5f1759fe7762fe18a87a2` ve Vercel Production ortam değişkeni üst verileri salt okunur incelendi.
- Production'da yalnız üç Shopify Partner anahtarı vardı; Supabase sunucu bağlantısı tanımlı değildi.
- Repository'de Partner API normalleştiricisi/akış yöneticisi ve veritabanı fonksiyonları hazırdı. Canlı veritabanı adaptörü ve onu çağıran Production uzlaştırma akışı yoktu.
- Canlı Supabase sayımları: çalışma alanı 0, kurulum 0, abonelik 0, kullanım hakkı 0, deneme kayıt defteri 0.
- Bu bir sağlayıcı veya Supabase arızası değildi. Eksik uygulama nedeniyle sağlayıcı kabulü veritabanına kendiliğinden yazılamazdı.
- Production HTML'i, altı istemci dosyası ve son 24 saatlik Vercel çalışma zamanı logları tarandı. Sunucuya özel değişken adı, Partner uç noktası kimliği, App GID, erişim token'ı başlığı/değeri, authorization başlığı, cookie veya oturum sızıntısı bulunmadı. Dört sızıntı kapısı geçti.
- Kapanıştan önce yalnız sunucuda çalışan, en az yetkili veritabanı bağlantısı; gerçek adaptör ve herkese açık olmayan doğrulanmış uzlaştırma tetikleyicisi görev dalı/CI/canlı kanıtla tamamlanmalıydı. Geçici herkese açık test uç noktası açılamaz.

## 8 Ekim 2026 — Kalıcı kayıt uygulamasının hazırlanması

- Supabase'in sunucusuz bağlantı sözleşmesine göre işlem havuzlayıcısı (transaction pooler, `6543`) seçildi. Oturum havuzlayıcısı ve tarayıcı Data API kullanılmadı.
- Sunucuya özel `ADSTABLE_RUNTIME_DATABASE_URL`; yalnız `adstable_runtime.podpwkrpmjiksskxhwsu` kullanıcısını, Frankfurt havuzlayıcı sunucusunu, `postgres` veritabanını ve `sslmode=require` değerini kabul eden başlangıç korumasına bağlandı.
- `pg@8.23.0` ile fonksiyon örneği başına en fazla bir bağlantılık havuz kuruldu. İşlem modu nedeniyle önceden hazırlanmış sorgu (prepared statement) kullanılmadı.
- Veritabanı adaptörü doğrudan tablo değiştirme (DML) yapmaz; yalnız `shopify.bootstrap_installation` ve `billing.apply_shopify_app_pricing_snapshot` fonksiyonlarını parametreli sorgularla çağırır.
- İç uzlaştırma çağırıcısı önce Shopify ID token oturumunu ve Admin mağaza kimliğini doğrulayan kurulum başlangıcını çalıştırır. Çağıranın gönderdiği çalışma alanını veya herkese açık test uç noktasını kabul etmez.
- Kod, test ve derleme canlı etkinleştirmenin yerine geçmez. Bu ara aşamada Production veritabanı gizli bilgisi girilmemiş, gerçek sağlayıcı sonucunun Supabase'e yazıldığı kanıtlanmamıştı; EO-02-C `Verification` durumundaydı.

## Çalışma zamanı ortam değişkeni sözleşmesi

8 Ekim 2026'da Shopify plan yönlendirmesi, Vercel Config/Secret ve Supabase güvenli veri/sunucusuz işlem havuzlayıcısı belgeleri yeniden kontrol edildi.

| Anahtar | Tür | Vercel kapsamı | Kural |
|---|---|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | Config | Production | Tam değer `5235756` |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Secret | Production | Değer repository, kanıt, tarayıcı ve loglarda bulunmaz |
| `SHOPIFY_APP_GID` | Config | Production | Tam değer `gid://shopify/App/432251994113` |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Secret | Production | Yalnız işlem havuzlayıcısı, `adstable_runtime` rolü, proje kimliği `podpwkrpmjiksskxhwsu`, port `6543`, veritabanı `postgres` ve `sslmode=require`; değer hiçbir kanıta yazılmaz |

Preview ve Development, Production Partner API token'ını veya Production veritabanı gizli bilgisini alamaz; canlı Partner API/veritabanı çağrısı yapamaz. Eksik veya bozuk yapılandırma erişim vermez. Partner API adresi yalnız organizasyon kimliği ve sabit `2026-07` sürümünden sunucuda üretilir. Ortam değişikliği mevcut dağıtımı değiştirmez; yeni dağıtım gerekir.

Sözleşmenin sabitlenmesi, veritabanı gizli bilgisinin Vercel'e girildiği anlamına gelmez. Bu ara kayıtta etkinleştirme, yeni dağıtım ve gerçek `trial | active | null` kalıcı kayıt kabulü açık insan onayı kapısı olarak bekliyordu.

## Yetki ve durum akışı

1. Shopify ID token ve Admin mağaza doğrulamasından geçen aktif kurulum nesli alınır.
2. Sunucuda yapılandırılmış App GID ve doğrulanmış Shop GID ile Partner API çağrılır.
3. Yanıttaki Shop GID ve standartlaştırılmış alan adı kurulumla aynı değilse yazım yapılmaz.
4. Aktif deneme sonucu `trial`, aktif faturalandırma dönemi `active` kullanım hakkı üretir.
5. `activeSubscription: null` sonucu `subscription_required` üretir.
6. HTTP/GraphQL hatası, bozuk yanıt veya kimlik uyuşmazlığı eski kaydı aktif saymaz ve yeni kayıt yazmaz.
7. Eski tarihli anlık kayıt (snapshot) reddedilir.
8. Kullanım hakkını tüketen bileşen kendi güncellik eşiğini verir; eşikten eski kayıt veritabanı çözümleyicisinden dönmez.
9. Plan seçimi dönüşünde, güncelliğini yitirmiş uygulama girişinde ve kullanım hakkıyla korunan arka plan işi öncesinde yetkili durum yeniden doğrulanır.

## Veri modeli

- `billing.workspace_subscriptions`: Shopify App Pricing aktif/null sonucunun kurulum nesline bağlı yansıması.
- `billing.workspace_entitlements`: `trial | active | subscription_required` erişim kararının kurulum nesline bağlı yansıması.
- `billing.trial_ledger`: Shopify'ın deneme anlık kayıtlarının değişmez ve yinelenen işlemde çoğalmayan gözlem izi.

Üç tablo özel şemadadır; RLS açıktır ve zorunludur. Tarayıcı/Data API rolleri ve `service_role` erişemez. `adstable_runtime` doğrudan tablo değiştirme yetkisi taşımaz; yalnız anlık kaydı uygulama ve güncel kullanım hakkını çözümleme fonksiyonlarını çağırır.

## Kurulu Shopify mağazasına bağlı abonelik

Abonelik, doğrulanmış uygulama kurulumu mağazasına aittir.

- Kurulum nesli yalnız kendi Shopify mağazası için kullanım hakkı üretir.
- Sağlayıcı hesabı, pixel veya alan adı abonelik kapsamını başka mağazaya taşıyamaz.
- İkinci Shopify mağazası ayrı kurulum, çalışma alanı ve abonelik gerektirir.
- Kullanıcının ticaret mağazası seçebileceği kontrol yoktur.

## Güvenli ret matrisi

| Shopify/Partner sonucu | AdsTable durumu | Erişim |
|---|---|---|
| Gelecekte biten `trialEndsAt`, dönem yok | `trial` | Açık |
| Güncel faturalandırma dönemi var | `active` | Açık |
| `activeSubscription: null` | `subscription_required` | Kapalı |
| API/GraphQL hatası | `unknown` | Kapalı; son kaydın üzerine yazılmaz |
| Mağaza kimliği uyuşmazlığı | `unknown` | Kapalı; yazım yok |
| Eski tarihli anlık kayıt | Değişmez | Ret |
| Güncellik eşiğinden eski yansıma | Güncelliğini yitirmiş | Çözümleyici sonuç döndürmez |

## Bu pakette bilinçli olarak yapılmayanlar

Aşağıdaki liste ilk hazırlık aşamasının kapsam dışı kaydıdır; daha sonraki onaylı işlemlerin yapılmadığı anlamına gelmez:

- Partner Dashboard'da fiyat/plan oluşturma veya yayımlama
- Production fiyat kararı
- Partner API erişim token'ının Vercel Production Secret olarak etkinleştirilmesi
- Settings faturalandırma arayüzü
- Uygulamayı kaldırma, gizlilik silmesi ve temiz yeniden kurulum
- Sağlayıcı OAuth bağlantısı veya Reporting Account seçimi

Bu ilk kapsam listesi işlemleri yapılmış saymaz. Plan/gizli bilgi etkinleştirmesi ve canlı Partner API kabulü ayrıca açık insan onayı kapısıdır.

## Canlı kabul yürütme planı

Canlı sıra ve gizli bilgi içermeyen kanıt şeması:

- `docs/runbooks/EO_02C_LIVE_ACCEPTANCE_RUNBOOK.md`
- `docs/evidence/EO_02C_LIVE_ACCEPTANCE_TEMPLATE.json`

Özgün teknik kabul sırası `null → intended USD 24.99 / 14-day trial → Shopify $0 private no-trial test plan ile active` olarak sabitlendi: önce abonelik yokluğu, sonra hedef planın deneme durumu, son olarak ücretsiz ve denemesiz özel test planının aktif durumu doğrulanır. Shopify'ın 180 günlük deneme kullanım takibi nedeniyle bu sıra rastgele tekrarlanamaz. Plan kaydı tek başına planın oluşturulduğunu, token'ın Vercel'e girildiğini veya canlı kabulün geçtiğini göstermez.

## Kabul

- Sözleşme, sunucu çözümleyicisi ve migration aynı yetki/durum matrisini uygular.
- Manuel Billing API yeni abonelik yolu olarak kullanılamaz.
- Partner API hatası kullanım hakkına dönüşmez.
- Deneme süresi yerelde yeniden başlatılamaz.
- Kullanım hakkı doğrulanmış kurulu Shopify mağazasına ve kurulum nesline bağlıdır.
- Sağlayıcı bağlantısı veya hesap değişikliği faturalandırma kapsamını değiştiremez.
- Repository testleri, derleme ve CI geçmelidir.
- Supabase migration'ı ve kendi test verisini temizleyen davranış sınaması canlıda geçti. Üç faturalandırma tablosunda RLS/zorunlu RLS 3/3, çalışma zamanının doğrudan tablo değiştirme yetkisi 0, fonksiyon erişimi 2/2, Security/Performance Advisor 0/0 ve kalan sınama satırı 0'dır.
- Kanıt: `docs/evidence/EO_02C_DATABASE_ACCEPTANCE_2026-10-06.json`.
- Partner Dashboard plan/deneme ayarı, tam Vercel gizli bilgi etkinleştirmesi ve gerçek null/trial/active sağlayıcı kabulü geçti. Tarayıcı/yanıt/uygulama/platform log sızıntı kontrolleri geçti. Bu ara kayıtta veritabanına yansıtma/kalıcı kayıt, eksik sunucu bağlantısı ve adaptör tamamlanana kadar açık kalıyordu. Partner API istemcisi oluşturma ve `Manage apps` kimlik doğrulama kapısı 7 Ekim 2026'da geçmişti.

## 8 Ekim 2026 — Kimliği doğrulanmış çalışma zamanı düzeltme bulgusu

- O sırada main'deki ürün adresleri yalnız önizlemeydi. Resmî Shopify sunucu adaptörü, `authenticate.admin` Admin yerleşimi ve kalıcı oturum deposu yoktu.
- İç uzlaştırma çağırıcısı herkese açılmamıştı; bu doğruydu. Ancak çağrılabileceği güvenli Production sınırı da henüz yoktu.
- Yalnız veritabanı gizli bilgisi ve yeni dağıtım canlı kalıcı kayıt üretemezdi. Gizli bilgi etkinleştirmesi güvenli biçimde durduruldu.
- Düzeltme: `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md` ve `contracts/eo-02c-shopify-runtime-auth-bridge-v1.json`.
- Kimliği doğrulanmış çalışma zamanı köprüsü, yalnız şifreli oturum saklama ve gerçek canlı yansıma kanıtı geçmeden EO-02-C kapanmaz.

## 9 Ekim 2026 düzeltmesi

Önceki seçilebilir mağaza kullanım hakkı varsayımı aktif modelden kaldırıldı. Çalışma zamanı DTO'su ve faturalandırma yansıması yalnız Shopify App Pricing erişim durumunu taşır. İleri yönlü düzeltici migration eski üç metadata kolonunu kaldırır; uygulanmış migration ve tarihsel kabul kanıtları değiştirilmez. Canlı migration ayrı açık onay ister. Bağlayıcı sözleşme: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.
