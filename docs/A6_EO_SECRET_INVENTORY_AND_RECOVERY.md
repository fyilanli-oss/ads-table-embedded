# A6-EO — Secret envanteri, saklama ve kurtarma

**Kontrol tarihi:** 18 Ekim 2026
**Durum:** Ürün sahibi kabulüne hazır olarak kaydedilen secret saklama/kurtarma planı
**Kapsam:** Mevcut Vercel Production ortamı ve GitHub Actions secret envanteri
**Bağlayıcı sözleşme:** `contracts/a6-eo-secret-inventory-recovery-v1.json`
**CI kontrolü:** `tests/a6-eo-secret-inventory-recovery.test.js`

> Bu belge envanter ile gelecekte uygulanacak kurtarma adımlarını ayırır. Güncel durum `docs/EXECUTION_PLAN.md` üzerinden okunur. F03 envanter düzeltmesinin kapanmış olması, aşağıdaki saklama/kurtarma koşullarının tamamlandığını göstermez. Bu dil düzenlemesi secret okuma, kasa kurma, rotasyon veya deployment başlatmaz.

## Analist sonucu

18 Ekim F03 kontrolünde 22 Vercel Production adı doğrulandı. Repository iş akışı
ve mevcut sözleşme bir GitHub Actions secret adı daha taşır: toplam envanter 23.
GitHub secret deposu bu işte yeniden sorgulanmadı. Vercel üst verisinde 17 girdi
Secret, 5 girdi Config türündedir. Mantıksal olarak yapılandırma olan bazı girdiler de
Secret saklanır; canlı türleri değiştirilmedi. Sözleşmedeki `storage_type`
tanımlı saklama politikasını, `observed_storage_type` gerçek gözlemi ayrı gösterir.
Değer çözümleme istenmedi; secret değeri okunmadı veya kaydedilmedi. Kanıt:
`docs/evidence/A6_TECH_01_F03_ENV_INVENTORY_2026-10-18.json`.

Bu düzeltme yalnız envanter eşliğidir; aşağıdaki saklama/kurtarma açıklarını
kapatmaz ve secret rotasyonu, canlı yeniden sınıflandırma ya da deployment yetkisi
vermez. Aşağıdaki eski Config/Secret etiketleri mantıksal politikayı açıklar;
güncel fiilî saklama türü için sözleşmenin gözlem alanı kullanılır.

Vercel veya GitHub'da maskelenen değer silinmiş değildir. İki sistem de açık metin olarak geri okumayı bilerek engeller. Çalışma zamanının esas kopyası sağlayıcının secret deposunda kalır. İkinci kopyaya yalnız ürün sahibinin kontrolündeki tek bir şifreli kurtarma kasasında izin verilir. Tarayıcı indirmesi, not, ekran görüntüsü, repository dosyası, sohbet mesajı, masaüstü metin dosyası veya makine yedeği onaylı kurtarma kasası değildir.

Bu sözleşme adları ve kurtarma prosedürlerini listeler. Rotasyon, silme, yeniden adlandırma, sağlayıcı/veritabanı/ortam değişikliği veya deployment yetkisi vermez.

## Mevcut envanter

| Ad | Yer / mantıksal tür | Otorite ve amaç | Ürün sahibinin saklama sorumluluğu | Erişilemiyorsa |
|---|---|---|---|---|
| `SHOPIFY_API_KEY` | Vercel Production / Config | Shopify kalıcı client ID | Açık metin yedek gerekmez; Shopify Dev Dashboard'dan yeniden bulunur | Client ID tekrar alınır; rotasyon yapılmaz |
| `SHOPIFY_API_SECRET` | Vercel Production / Secret | Shopify uygulama kimlik doğrulaması ve webhook doğrulaması | Süreklilik için şifreli kurtarma kopyası gerekir | Shopify client secret oluşturulur/döndürülür; Vercel güncellenip yeniden dağıtılır; OAuth ve webhook'lar doğrulanır, sonra eski secret iptal edilir |
| `SHOPIFY_APP_URL` | Vercel Production / Config | Kanonik gömülü uygulama URL'si | Repository/sağlayıcı kaydı yeterlidir | Onaylı canlı alan adından yeniden oluşturulur |
| `SCOPES` | Vercel Production / Config | En az yetkili Shopify izin kümesi; mevcut durumda bilinçli olarak boş | Repository sözleşmesi yeterlidir | Yalnız kabul edilmiş izin sözleşmesinden yeniden oluşturulur |
| `SHOPIFY_PARTNER_ORG_ID` | Vercel Production / Config | Shopify Partner kuruluş kimliği | Sağlayıcı kaydı yeterlidir | Shopify Partner/Dev Dashboard'dan alınır |
| `SHOPIFY_APP_GID` | Vercel Production / Config | Shopify yönetilen fiyatlandırma uygulama kimliği | Sağlayıcı kaydı yeterlidir | Shopify otoritesinden yeniden sorgulanır/alınır |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Vercel Production / Secret | Partner API abonelik otoritesi | Şifreli kurtarma kopyası gerekir | İkincil Partner API token'ı üretilir; Vercel güncellenip yeniden dağıtılır; abonelik uzlaştırması doğrulanmadan eski token iptal edilmez |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Vercel Production / Secret | En az yetkili `adstable_runtime` rolünün Supabase transaction-pooler URL'si | Şifreli kurtarma kopyası gerekir; daha geniş yetkili veritabanı kimliği saklanmaz | Onaylı veritabanı prosedürüyle yalnız ilgili runtime rolü döndürülür; kopyalanmış pooler URL'si yeniden oluşturulur; Vercel güncellenip yeniden dağıtılır; doğrudan/pooler davranışı onaylı, sınırlı deneme koşuluyla doğrulanır |
| `ADSTABLE_SESSION_ENCRYPTION_KEY_V1` | Vercel Production / Secret | AES-256-GCM Shopify oturum şifreleme anahtarı | Şifreli kurtarma kopyası gerekir; mevcut dış kopya kanıtlanmadı | Aynı anahtar yeniden üretilemez. Anahtar yoksa eski şifreli oturumlar okunamaz; onaylı oturum sıfırlama/yeniden kurulum planı gerekir. Körlemesine değiştirmek yasaktır |
| `ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION` | Vercel Production / Secret (sınıflandırma borcu) | Sağlayıcı token'larının yazma anahtarını seçer; mevcut mantıksal sürüm 1 | Açık metin secret yedeği gerekmez; otorite sözleşmedir | Kabul edilmiş sürüm numarası geri konur. Config olarak yeniden sınıflandırma ayrı onaylı temizliktir |
| `ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1` | Vercel Production / Secret | AES-256-GCM sağlayıcı token/PKCE şifreleme anahtarı | İlk gerçek sağlayıcı yetkilendirmesinden önce şifreli kurtarma kopyası gerekir | Aynı anahtar yeniden üretilemez. Yeni sürüm eklenir; referans verilen eski sürümler okunabilir tutulur; şifreli kayıtlar yeni anahtara taşınır; sıfır referans doğrulanır, sonra eski anahtar kaldırılır |
| `SHOPIFY_APP_AUTOMATION_TOKEN` | GitHub repository Actions Secret | Uygulama kapsamlı Shopify CLI doğrulama/deployment token'ı | Şifreli kurtarma kopyası ve kesin bitiş kaydı gerekir | Shopify Dev Dashboard'da yeni token üretilir; GitHub Actions Secret güncellenir; süresi dolmadan onaylı iş akışıyla doğrulanır |

Sağlayıcı ekleri; bunlar mantıksal sınıftır, fiilî Vercel türü sözleşmededir:

| Ad | Amaç / mantıksal sınıf | Kaynak ve kurtarma sınırı |
|---|---|---|
| `META_APP_ID` | Meta uygulama kimliği / Config | Meta App Dashboard'dan yeniden bulunabilir |
| `META_APP_SECRET` | Meta uygulama secret'ı / Secret | Açık onaylı sağlayıcı rotasyonu ve doğrulama gerekir |
| `META_GRAPH_VERSION` | Kabul edilmiş Graph sürümü / Config | EO-04-B sürüm sözleşmesi; kendiliğinden yükseltilmez |
| `META_OAUTH_REDIRECT_URI` | Birebir dönüş adresi / Config | Kabul edilmiş EO-04-B dönüş adresi |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` | OAuth client kimliği / Config | Google Cloud OAuth client kaydı |
| `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | OAuth client secret / Secret | Açık onaylı Google rotasyonu ve doğrulama gerekir |
| `GOOGLE_ADS_OAUTH_REDIRECT_URI` | Birebir dönüş adresi / Config | Kabul edilmiş EO-04-C dönüş adresi |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Geçiş uyumluluğu / Secret | Mevcut çalışma zamanında isteğe bağlı; kaldırma/yenileme bu işin dışında |
| `KLAVIYO_CLIENT_ID` | OAuth client kimliği / Config | Klaviyo OAuth App kaydı |
| `KLAVIYO_CLIENT_SECRET` | OAuth client secret / Secret | Açık onaylı Klaviyo rotasyonu ve doğrulama gerekir |
| `KLAVIYO_OAUTH_REDIRECT_URI` | Birebir dönüş adresi / Config | Kabul edilmiş EO-04-D dönüş adresi |

## Ürün sahibinde kalan kontrol

Ürün sahibi şunları kontrol eder:

1. Shopify Dev/Partner Dashboard, Vercel, Supabase ve GitHub yönetici erişimi.
2. Yeniden oluşturulamayan her secret için tek şifreli kurtarma kasası kaydı.
3. Her kimlik bilgisinin kaynak otoritesi, sorumlusu, oluşturma/rotasyon tarihi ve kesin sona erme üst verisi.
4. Her secret oluşturma, güncelleme, yeniden adlandırma, silme, kapsam değiştirme ve iptal için açık onay.
5. Yeniden verilemeyen şifreleme anahtarına erişilemediğinde kurtarma kararı.

Kabul edilmiş sözleşme veya sağlayıcı panelinden yeniden oluşturulabilen yapılandırma değerlerinin ikinci açık metin kopyasını saklamak gerekmez.

### Kayıt tarihindeki kurtarma kasası durumu

Sağlayıcı depoları çalışma zamanı kopyalarının varlığını kanıtlar; ancak mevcut, yalnız yazılabilen değerler için ürün sahibinde bağımsız şifreli kurtarma kopyası kanıtlanmamıştır. Bu nedenle sözleşme, açık metin kopyalarının şu anda kurtarılabilir olduğunu iddia etmez.

- İlk gerçek Meta, Google Ads veya Klaviyo yetkilendirmesinden önce sağlayıcı-token anahtarı ya onaylı şifreli kurtarma kasasına konmalı ya da token kasası tablolarında gerçek kimlik bilgisi yokken bilinçli olarak değiştirilmelidir.
- Dış müşteri kabulünden önce Shopify oturum anahtarı kaybı senaryosu kabul edilmelidir: O sırada aktif anahtar onaylı kontrollü rotasyonla güvenceye alınmalı veya kurtarma yolu olarak zorunlu oturum iptali/yeniden kurulum açıkça kabul edilmelidir.
- Sonraki Shopify yapılandırma deployment'ından önce Shopify'ın gösterdiği otomasyon token'ının kesin bitişi kaydedilmelidir. Kullanıcı 60 günlük ömür bildirmiştir; kesin takvim tarihi bağımsız olarak doğrulanmamıştır.
- Şifreli kurtarma kasası ürününün seçimi operasyonel karardır; kasa içeriği repository'de asla saklanmaz.

## Değişiklik yetkisi politikası

Hiçbir ajan, geliştirici veya operatör; değer maskeli, geri okunamıyor veya kullanımı zahmetli diye envanter girdisi oluşturamaz, açığa çıkaramaz, döndüremez, değiştiremez, yeniden adlandıramaz, silemez, kapsamını değiştiremez veya iptal edemez.

Her secret değişikliğinden önce şunlar gerekir:

1. Kesin anahtar ve ortamı adlandıran açık ürün sahibi onayı.
2. Güncel resmî sağlayıcı dokümantasyonu.
3. Etki haritası: okuyanlar, yazanlar, şifreli kayıtlar, webhook'lar, deployment'lar ve iş akışları.
4. Kurtarma/geri alma prosedürü ve doğrulama sorgusu.
5. Yeni açık metnin yalnız onaylı şifreli kurtarma kasasına alındığının doğrulanması.
6. Gerekiyorsa yeni deployment veya iş akışı çalıştırması.
7. Değerleri içermeyen değişiklik sonrası kanıt.
8. Eski kimlik bilgisinin ancak başarılı doğrulamadan sonra iptali/kaldırılması.

Production kimlik bilgileri Preview veya Development'a kopyalanamaz. Bu ortamlar bağımsız, canlı olmayan kimlik bilgileri ve veri gerektirir.

## Kurtarma prosedürleri

Aşağıdaki sıralar gelecekte ayrıca onaylanacak işlemleri tarif eder; uygulama yetkisi değildir. İlk açık veya açıklamasız sağlayıcı hatasında durulur. Aynı işlem ikinci kez denenmez; yeni açıklama ve açık onay olmadan alternatif rota kullanılmaz.

### Shopify client secret

Shopify'ın desteklediği rotasyon akışı kullanılır. Rotasyon sırasında webhook imzalama eski secret ile sürebileceğinden, yeni Vercel secret ve deployment doğrulanırken iptal edilmemiş en eski secret erişilebilir tutulur. İptalden önce gömülü kimlik doğrulama, OAuth ve webhook HMAC doğrulanır.

### Shopify Partner API token'ı

Kuruluş kapsamlı ikincil token üretilir. Yalnız Vercel Production secret güncellenir, yeniden dağıtılır; birebir `activeSubscription` uzlaştırması ve loglar doğrulanır, sonra önceki token iptal edilir.

### Shopify App Automation Token

Token uygulama kapsamlı ve süre sınırlıdır. Bitişten önce yenisi üretilir; bir kez şifreli kurtarma kasasına alınır; GitHub repository secret güncellenir; yalnız açıkça onaylı doğrulama/deployment iş akışı çalıştırılır. İş akışı dosyası yalnız secret adını içerir.

### Supabase çalışma zamanı bağlantısı

Bağlantı metni, yalnız fonksiyon çalıştırma yetkisi olan özel rolün kimlik bilgisini içerir. Bunun yerine `postgres`, `service_role` veya daha geniş bir kimlik asla kullanılmaz. Transaction-pooler adresi host adı tahmin edilmeden Supabase'den birebir kopyalanır. Parola değişikliği Supavisor önbelleğinde kısa süre kalabildiğinden, uygulanabildiği yerde yeni kimlik bilgisi doğrudan doğrulanır. Kaynak prosedürdeki sınırlı pooler tekrar denemesi, ilk hata sonrası durma kapısını geçersiz kılamaz: Yeni açıklama ve açık onay olmadan tekrar denenmez; körlemesine yinelenen denemeler yasaktır.

### Shopify oturum şifreleme anahtarı

Kayıt tarihindeki uygulama yalnız `ADSTABLE_SESSION_ENCRYPTION_KEY_V1` kullanır; çok sürümlü oturum anahtar halkası henüz yoktur. Körlemesine değiştirmek saklı oturumları okunamaz yapar. Planlı rotasyon ya sürümlü geçiş yolu ya da kontrollü temizleme ardından mağaza sahibinin yeniden kimlik doğrulaması/kurulumu ve canlı kabul kontrolü gerektirir.

### Sağlayıcı-token şifreleme anahtarı

Bu anahtar ailesi sürümlüdür. Yeni yazmalar aktif sürümü kullanır; okumalar şifreli satırların referans verdiği her sürümü korumalıdır. Güvenli sıra: V2 ekle, V1+V2 okuyabilen sürümü dağıt, aktif sürümü değiştir, şifreli kayıtları taşı, V1 referansının kalmadığını kanıtla, ancak sonra V1'i kaldır. Yeni üretilen değer, kaybolmuş değerle şifrelenen veriyi çözemez.

## EO-04 genişletme kapısı

Bu, EO-04'te sağlayıcı kimlik bilgisi eklerken konmuş kuralın kaydıdır; EO-04'ü yeniden açmaz. Meta, Google Ads veya Klaviyo client secret'ı hafızadan varsayılamaz veya kurulamaz. Sağlayıcı alt işi kimlik bilgisi oluşturmadan önce güncel resmî dokümantasyon şunları tanımlamalıdır:

- Kesin ortam değişkeni adı ve kullanan kod/iş akışı.
- Veren otorite, izinler, uygulama/proje kimliği ve ortam.
- Sona erme, iptal veya rotasyon davranışı.
- Açık metin geri okuma davranışı ve şifreli kurtarma kasası gereksinimi.
- Deployment, yeniden bağlanma ve geri alma sırası.
- Ürün sahibi onayı ve secret içermeyen kabul kanıtı.

Makinece okunabilir envanter ve testi, yeni kimlik bilgisini ekleyen değişiklikle birlikte genişletilir.

## 10 Ekim 2026'da kontrol edilen resmî kaynaklar

- Shopify uygulama kimlik bilgileri: https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials
- Shopify App Automation Tokens: https://shopify.dev/docs/apps/build/dev-dashboard/app-automation-tokens
- Shopify Partner API: https://shopify.dev/docs/api/partner/2026-01
- Vercel Config ve Secret türleri: https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types
- Vercel ortam yönetimi: https://vercel.com/docs/environment-variables/manage-across-environments
- Vercel secret rotasyonu: https://vercel.com/docs/environment-variables/rotating-secrets
- GitHub Actions secret türleri: https://docs.github.com/en/code-security/reference/secret-security/secret-types
- GitHub Actions secret referansı: https://docs.github.com/en/actions/reference/security/secrets
- Supabase bağlantı seçimi: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase havuz sınırları: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits
- Supabase parola rotasyonu önbellek davranışı: https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation
- Supabase değişiklik günlüğü: https://supabase.com/changelog
