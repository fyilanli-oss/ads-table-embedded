# EO-02-C — Shopify App Pricing canlı kabul kılavuzu

**Kontrol tarihi:** 8 Ekim 2026

**Canlı uygulama tarihi:** 8 Ekim 2026

**Durum:** Kabul edildi — sağlayıcı, sızıntı, doğrulanmış TLS, canlı masaüstü/mobil kalıcı kayıt ve ürün sahibi kapanış kabulü geçti.

Bu kılavuz 8 Ekim 2026'daki yürütme sırasını, ara bulguları ve nihai kabulü birlikte saklar. Ara bölümlerdeki “bekliyor/yok” ifadeleri bugünkü açık iş listesi değildir. 9 Ekim düzeltmesi ayrıca kayıtlıdır. Güncel proje durumu Execution Plan'dadır; bu belge yeni canlı sorgu, plan seçimi, gizli bilgi veya dağıtım işlemi yetkilendirmez.

## Amaç

Shopify App Pricing planını, Partner API Production gizli bilgi sınırını ve AdsTable kullanım hakkı yansımasını tek kontrollü akışta `null → trial → active` durumlarıyla doğrulamak. Kılavuz EO-02-C'yi otomatik kapatmaz; her adımın kanıtı ve açık ürün sahibi kabulü gerekir.

## Tarihsel resmî kaynaklar

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page
- https://shopify.dev/docs/api/partner/latest/active-subscription
- https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- https://shopify.dev/docs/apps/launch/distribution/revenue-share
- https://help.shopify.com/en/manual/checkout-settings/troubleshooting-checkout-payments
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/environment-variables/sensitive-environment-variables
- https://supabase.com/docs/guides/database/secure-data
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- https://node-postgres.com/features/pooling

Shopify, aynı Partner organizasyonundaki geliştirme mağazasına kullanılabilir bütün planları; farklı organizasyondakine ücretsiz veya **Free for partners and developers** işaretli ücretli planları gerçek ücret olmadan test ettirir. Testte uygulanan fiyat sıfır olabilir. Vercel Secret değerleri kaydedildikten sonra okunamaz; ortam değişikliği yalnız yeni dağıtıma uygulanır.

## İnsan onayı kapıları

Aşağıdakiler kullanıcıya görünür onay olmadan yapılmaz:

1. App Store kaydı için kart doğrulaması ve tek seferlik USD 19 ücret.
2. Herkese açık planın kaydedilmesi veya yayımlanması.
3. Partner API erişim token'ının Vercel Production Secret olarak girilmesi.
4. Production dağıtımı.
5. Geliştirme mağazasında plan seçimi veya değişimi.

## Sabitlenmiş plan

Aşağıdaki ad/fiyatlar 8 Ekim kabulündeki değerlerdir; yeni fiyat kararı değildir.

| Alan | Değer |
|---|---|
| Herkese açık plan adı | AdsTable Monthly |
| Faturalandırma | Aylık (Monthly) |
| Fiyat | USD 24.99 |
| Deneme | 14 gün |
| Karşılama bağlantısı | `/` |
| Geliştirme mağazası testi | Farklı Dev Dashboard organizasyonu; `Free for partners and developers` açık, gerçek ücret yok |
| Özel kabul planı | Shopify'ın `$0 private test plan`ı; deneme yok |
| Aynı anda aktif abonelik | Bir |

Özel test planı yalnız `active` durum şeklinin canlı kabulü içindir; kullanıcıya sunulan fiyat teklifi değildir.

## Aşama 0 — Salt okunur ön kontrol

- GitHub `main`, Production dağıtım SHA'sı ve Vercel ortam değişkeni anahtar adları kaydedilir.
- Vercel değerleri okunmaz veya dışarı aktarılmaz.
- Partner API istemcisinin yalnız `Manage apps` yetkisi doğrulanır.
- Mağaza/uygulama organizasyon ilişkisi doğrulanır. Farklı organizasyonda yalnız `Free for partners and developers` açık plan kullanılır.
- Kanıta token, oturum, cookie, authorization başlığı, kişisel veri (PII) veya tam yanıt başlıkları yazılamaz.

Başarısızlıkta hiçbir dış sistem değişikliği yapılmaz.

## Aşama 1 — Shopify App Store kaydı

1. Partner hesabının tek seferlik USD 19 App Store kaydı tamamlanır.
2. Shopify kesin 24 saatlik yeniden deneme süresi yayımlamadığından `Too many attempts` sürerken farklı kart veya tarayıcıyla ardışık deneme yapılmaz.
3. Yeni deneme öncesinde bankada uluslararası internet alışverişi ve 3D Secure açık; kart sahibi/adres bilgileri banka kaydıyla uyumlu olmalıdır.
4. Tek kontrollü deneme başarısızsa tekrar zinciri başlatılmaz. Önce bankaya ulaşıp ulaşmadığı doğrulanır; hiç ulaşmadıysa Shopify Support'a gidilir.

Kayıt tamamlanmadan plan oluşturma veya abonelik durumu kabulüne geçilmez.

## Aşama 2 — Vercel Production etkinleştirmesi

| Anahtar | Vercel türü | Kapsam |
|---|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | Config | Production |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Secret | Production |
| `SHOPIFY_APP_GID` | Config | Production |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Secret | Production |

Kurallar:

- Tam Config değerleri sözleşmeden alınır.
- Token'ı kullanıcı doğrudan Vercel Secret alanına girer; sohbet, terminal argümanı, yerel env dosyası veya pano kanıtına yazılmaz.
- Veritabanı URL'ini kullanıcı doğrudan Vercel Secret alanına girer. Yalnız Supabase işlem havuzlayıcısı, `adstable_runtime` rolü, proje kimliği `podpwkrpmjiksskxhwsu`, port `6543`, veritabanı `postgres` ve `sslmode=require` kabul edilir.
- Preview ve Development Production token'ını almaz.
- Ortam değişikliği sonrası yeni Production dağıtımı zorunludur.
- Kaynak SHA, anahtar üst verileri ve sağlık sonucu kaydedilir; değerler kaydedilmez.

## Aşama 3 — Abonelik yokluğu (null) kabulü

Plan seçilmeden önce `activeSubscription` sorgulanır.

Beklenen:

- HTTP ve GraphQL başarılıdır.
- `data.activeSubscription === null`.
- AdsTable yansıması `subscription_required` olur.
- Erişim güvenli biçimde kapalı kalır.
- Son doğrulanmış aktif kaydın üzerine hata yanıtı yazılmaz.

API/GraphQL hatası `null` sayılmaz; aşama geçemez.

## Aşama 4 — Hedef herkese açık plan ve deneme kabulü

1. Plan `USD 24.99 / month`, `14-day trial`, karşılama bağlantısı `/` olarak kaydedilir.
2. Geliştirme mağazası Shopify'ın barındırdığı plan seçim sayfasından planı seçer.
3. Yönlendirme bitince Partner API hemen yeniden sorgulanır.

Beklenen:

- `activeSubscription` null değildir.
- `trialEndsAt` gelecektedir.
- `currentBillingCycle === null`.
- Abonelik kaleminin adı kaydedilir; fiyat yalnız hassas bilgilerden arındırılmış iş kanıtına yazılır.
- `price.active` abonelik aktiflik bayrağı değildir. Yalnız fiyat sürümünün güncel katalog fiyatı olup olmadığını gösterir; kullanım hakkı kapısı olamaz.
- AdsTable yansıması `trial` olur; doğrulanmış kurulum nesline bağlı kalır.
- Sağlayıcı bağlantısı veya hesap değişikliği abonelik kapsamını değiştirmez.

Bu geliştirme mağazasında denemenin tekrarlanabileceğine güvenilmez; Shopify 180 günlük kullanımı izler.

## 8 Ekim 2026 — Canlı deneme bulgusu

- Yeni uygulama Shopify Admin'de `adstable-1` adı ve `embedded.adstable.app` uygulama adresiyle kuruldu.
- Herkese açık `AdsTable Monthly` planı `USD 24.99 / 30 gün`, 14 günlük deneme ve `/` karşılama bağlantısıyla seçildi.
- Farklı Dev Dashboard organizasyonundaki mağazada `Free for partners and developers` açık olduğundan Shopify uygulanan fiyatı `USD 0.0` yaptı.
- Partner API `activeSubscription` deneme şeklini doğruladı: `trialEndsAt=2026-10-22T08:02:49Z`, `currentBillingCycle=null`, `pendingUpdate=null`.
- Sıfır fiyat nesnesi `price.active=false` döndürdü. Shopify'ın resmî 2026-07 sözleşmesinde bu alan fiyat sürümünün güncelliğidir; aktif abonelik veya kullanım hakkı bayrağı değildir.
- Çalışma zamanının `price.active === true` şartı kaldırılmadan denemenin kalıcı kaydı geçmiş sayılamazdı.

## Aşama 5 — Aktif abonelik kabulü

Deneme kanıtından sonra aynı mağaza, denemesiz Shopify `$0 private test plan`ına geçirilir. Bu gerçek kullanıcı teklifi değildir; ücret oluşturmaz.

Beklenen:

- `trialEndsAt === null`.
- `currentBillingCycle.startTime` ve `endTime` doludur.
- Abonelik kaleminin adı doğrulanır; `price.active` kullanım hakkı kararı vermez.
- AdsTable yansıması `active` olur.
- Test sözleşmesinde uygulanan dönemsel fiyat sıfır olabilir; ürünün herkese açık fiyatı USD 24.99 kalır.

Shopify farklı yanıt şekli döndürürse yorum yapılmaz. Hassas bilgilerden arındırılmış ham yanıt kaydedilir; sözleşme güncellemesi için durulur.

## 8 Ekim 2026 — Canlı aktif abonelik bulgusu

- `adstable-development.myshopify.com`, `shopify-test` özel planına yetkilendirildi.
- Shopify onay ekranı ücretsiz planı ve faturalandırma yapılmayacağını gösterdi.
- Başarılı dönüş `plan_handle=shopify-test` taşıdı.
- Partner API ham sonucu `trialEndsAt=null`, `currentBillingCycle.startTime=2026-10-08T08:45:05Z`, `currentBillingCycle.endTime=2026-11-07T08:45:05Z`, `handle=shopify-test`, uygulanan `USD 0.0`, `price.active=true` ve `pendingUpdate=null` döndürdü.
- Sağlayıcının aktif durum kabulü geçti; bu ara aşamada kalıcı kayıt ve sızıntı kontrolleri bekliyordu.

## 8 Ekim 2026 — Aşama 6 ön kontrol bulgusu

- Production HTML ve istemci dosyası taraması geçti.
- Son 24 saat uygulama/platform log taraması geçti.
- Canlı Supabase iş verisi sayımı 0/0/0/0/0 kaldı.
- Vercel Production'da çalışma zamanı veritabanı erişim bilgisi yoktu.
- Repository'de canlı veritabanı adaptörü ve Production uzlaştırma çağırıcısı yoktu.
- Kalıcı kayıt geçmiş sayılamazdı. Önce yalnız sunucuda çalışan, en az yetkili bağlantı ve herkese açık olmayan doğrulanmış tetikleme kurulmalı; ardından nesil/eski kayıt/kurulu mağaza kimliği kontrolleri canlı çalıştırılmalıydı.
- Geçici herkese açık test uç noktası, tarayıcı veritabanı istemcisi veya `service_role` alternatif yolu yasaktır.

## 8 Ekim 2026 — Aşama 6 uygulama sonucu

- Yalnız sunucuda çalışan işlem havuzlayıcısı başlangıç koruması ve `pg@8.23.0` adaptörü eklendi.
- Çalışma zamanı adaptörü doğrudan tablo değiştirme yetkisi taşımaz; yalnız izinli başlangıç ve anlık kayıt uygulama fonksiyonlarını çağırır.
- İç çağırıcı, doğrulanmış Shopify ID token oturumu ve Admin mağaza kimliği olmadan sağlayıcı/veritabanı çağrısı yapmaz.
- Herkese açık test uç noktası eklenmedi.
- Bu kayıt canlı uygulama öncesindedir. Production veritabanı gizli bilgisi daha sonra etkinleştirildi; aşağıdaki masaüstü kabulü alındı.

## 8 Ekim 2026 — Canlı masaüstü kalıcı kayıt sonucu

- PR #23 squash merge commit'i `3b33d4f05a2604c23ec6181c584752a63390d106`, Repository Governance, TypeScript ve Production derleme kapılarından geçti.
- Tam commit, Vercel Production dağıtımı `dpl_C8be2uodW3onwMQGYyA9gSwCqCWG` olarak READY oldu ve `embedded.adstable.app` adresine bağlandı.
- Supabase işlem havuzlayıcısı bağlantısı resmî Supabase Root CA 2021 ve `rejectUnauthorized=true` kullanır. URL'deki `sslmode=require` doğrulandıktan sonra node-postgres'e açık CA yapılandırması verilir.
- Shopify Admin masaüstünde ilk yüklemede ve tam sayfa yenilemesinden sonra Funnel önizlemesi açıldı; önceki önizleme yükleme hatası tekrarlanmadı.
- Canlı veritabanı: çalışma alanı 1, kurulum 1, şifreli çalışma zamanı oturumu 1, çalışma alanı aboneliği 1, kullanım hakkı 1, deneme kayıt defteri 0.
- Kurulum nesli 1 ve aktifti. Abonelik yansıması ve kullanım hakkı aktifti; doğrulanmış kurulu Shopify mağazasıyla aynı nesle bağlıydı.
- Oturum satırında şifreli metin, 12 bayt nonce, 16 bayt kimlik doğrulama etiketi ve anahtar sürümü 1 doğrulandı; açık metin token alanı yoktu.
- Son kontrol penceresinde Vercel Production çalışma zamanı uyarı/hata kaydı yoktu.
- Bu ara aşamada gerçek mobil kabul yapılmadığından EO-02-C nihai PASS değildi; EO-02-D başlamıyordu.

## 8 Ekim 2026 — Gerçek mobil Shopify Admin sonucu

- Ürün sahibi gerçek mobil Shopify uygulamasında AdsTable'ı açtı; ilk yükleme geçti.
- Funnel, Ad Analysis ve Settings adreslerinin üçü de mobil uygulamada açıldı.
- Shopify mobil uygulaması tamamen kapatılıp açıldı; AdsTable ve Funnel yeniden yüklendi.
- Mobil sonrası canlı sayılar değişmeden tutarlı kaldı: çalışma alanı 1, nesil-1 aktif kurulum 1, şifreli oturum 1, aktif abonelik yansıması 1, aktif kullanım hakkı yansıması 1, deneme kayıt defteri 0.
- Aynı Production dağıtımının kontrol edilen Vercel log penceresinde uyarı/hata kaydı yoktu.
- Teknik canlı kabul kapıları geçti. EO-02-C, açık ürün sahibi kapanış onayı kaydedilmeden kapanmaz.

## Aşama 6 — Sızıntı ve kalıcı kayıt kabulü

- Tarayıcı paketi ve yanıtlarda sunucuya özel üç değerin bulunmadığı doğrulanır.
- Uygulama/platform loglarında token veya authorization başlığı bulunmadığı doğrulanır.
- Veritabanı yansıması Shop GID, standartlaştırılmış alan adı ve kurulum nesliyle eşleşir.
- Eski tarihli anlık kayıt reddedilir.
- Çalışma zamanı doğrudan tablo değiştirme yetkisi taşımaz; yalnız izinli fonksiyonları kullanır.
- `null`, `trial` ve `active`, gerçek sıfır/bilinmeyen durumuyla karıştırılmaz.
- Production veritabanı gizli bilgisi yalnız açık insan onayıyla etkinleştirilir. Yeni dağıtımdan sonra gerçek sağlayıcı yanıtı yalnız fonksiyon çağıran çalışma zamanı üzerinden yazılır; kalan satır/kanıt kontrol edilir.

## Geri alma

Tarihsel yürütme planında herhangi bir aşama başarısızsa:

1. Kullanım hakkı güvenle kapalı kalır; hata `subscription_required` veya `active` diye yorumlanmaz.
2. Yeni dağıtım Production otoritesi yapılmaz veya önceki güvenli dağıtıma dönülür.
3. Token şüphesi varsa Shopify Partner Dashboard'da token yenilenir/iptal edilir.
4. Vercel Production Secret kaldırılır/değiştirilir; yeni dağıtım alınır. Eski dağıtımın ortam değişikliğinden etkilenmediği kabul edilir.
5. Plan veya denemede ikinci girişimden önce başarısızlığın nedeni kaydedilir.
6. EO-02-C `Verification` kalır; EO-02-D başlamaz.

Bu tarihsel geri alma planı bugün token/gizli bilgi/dağıtım değiştirme izni değildir; dış sistem işlemleri kendi açık onay ve ilk hata durma kapılarına tabidir.

## 8 Ekim 2026 — Ürün sahibi kapanış kabulü

- EO-02-C için açık teknik husus kalmadığı doğrulandı.
- Eski kayıt reddi aynı Supabase projesinin `docs/evidence/EO_02C_DATABASE_ACCEPTANCE_2026-10-06.json` kanıtında geçti ve canlı zincire bağlandı.
- Ürün sahibi “EO-02-C kapanışını kabul ediyorum” diyerek açık kapanış onayı verdi.
- EO-02-C nihai sonucu PASS, durumu kabul edildi. EO-02-D ayrı paket olarak başlayabilir.

## PASS koşulu

- Üç abonelik durumu gerçek Partner API yanıtıyla doğrulandı.
- Production gizli bilgi sınırı ve yeni dağıtım doğrulandı.
- Yansıtma/güvenli ret davranışı geçti.
- Gizli bilgi/kişisel veri sızıntısı yok.
- Kanıt JSON'u gizli bilgi içermeden tamamlandı.
- PR ve zorunlu CI geçti.
- Ürün sahibi EO-02-C kapanışını açıkça kabul etti.

## Aşama 6A — Kimliği doğrulanmış çalışma zamanı düzeltme kapısı

Bu bölüm, yukarıdaki kalıcı kayıt kabulünden önce gereken düzeltmeyi saklar. Production veritabanı gizli bilgisi girilmeden önce tamamı geçmelidir:

1. Resmî Shopify React Router sunucu adaptörü ve `authenticate.admin(request)` kullanan pathless Admin yerleşimi.
2. Mevcut `/`, `/ad-analysis`, `/settings` adresleri ve görünür metinlerinin korunması.
3. Supabase özel şemada yalnız şifreli, AES-256-GCM ile korunan ve yalnız fonksiyon çağıran Shopify oturum saklama sınırı.
4. ID token alan adıyla Admin GraphQL `shop { id myshopifyDomain }` kimliğinin eşleşmesi.
5. Doğrulanmış girişten iç kullanım hakkı uzlaştırma çağırıcısının yinelenince aynı sonucu koruyarak çalışması.
6. Sözleşme testi, tür kontrolü, derleme, Governance CI, gerçek masaüstü/mobil Shopify Admin ve gizli bilgi sızıntı kabulü.

Bu kapı geçmeden `ADSTABLE_RUNTIME_DATABASE_URL`, oturum şifreleme anahtarı veya Shopify API sırrı Production'a etkinleştirilmez. Herkese açık test uç noktası, açık metin oturum/token tablosu, tarayıcı veritabanı istemcisi ve `service_role` alternatif yolu yasaktır.

## 9 Ekim 2026 — Düzeltici canlı kapı

Repository düzeltmesi merge edildikten sonra canlı migration ayrı açık onayla uygulanır. Kabul; eski üç kullanım hakkı metadata kolonunun yokluğunu, uygulama/çözümleme fonksiyon sonuçlarının sadeleşmesini, çalışma zamanı kimlik eşliğini, zorunlu RLS ve yalnız fonksiyon yetkisi sınırını doğrular. Tarihsel kabul kanıtları değiştirilmez.
