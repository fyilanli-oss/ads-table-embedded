# EO-05A çoklu refresh hattı tasarımı

**Bir Shopify mağazasının Google Ads, Klaviyo ve Meta refresh işleri aynı anda yalnızca tek hatta aittir.** Hat değişimi, önceki hattın açık işlerinin, isteklerinin ve yazımlarının güvenli biçimde sonuçlandığı doğrulanınca yapılır. Kural, sağlayıcıya istek gönderilmeden önce uygulanır. Bu belge tasarım kaydıdır. [Günlük refresh sözleşmesi](EO_05A_REFRESH_CONTRACT.md) · [Makine sözleşmesi](../contracts/eo-05a-global-refresh-design-v1.json#multi_lane_refresh_design_2026_11_21)

## 1. Mağaza sahipliği ve iş dağıtımı

- Ortak iş dağıtımı, aktif Shopify kurulumunun kanonik mağaza kimliğini kullanır. Sahiplik anahtarı mağaza düzeyindedir. Sağlayıcı, reklam hesabı, iş günü ve veri seti aynı mağazaya ek hat sahipliği vermez. Kurulum nesli, mağaza kaydında doğrulanır. Eski neslin çağrıları veya yazımları belirsizken yeni nesil ayrı bir sahiplik alanı açmaz.
- Kontrol kaydı en az mağaza kimliğini, geçerli kurulum neslini, sahip hattı, artan sahiplik sürümünü (`fence`), sahiplik durumunu ve açık iş/istek ilişkilerini taşır. Atama ve değişiklik tek atomik karar olarak yapılır. Hatların kendi belleğindeki, önbelleğindeki ve veri veritabanlarındaki kopyalar yalnız gözlem içindir.
- Dağıtım aynı mağaza için iki hatta paralel sahiplik veremez. Hat planı farklı mağazaları paralel işleyebilir. Mağazanın üç sağlayıcı işi aynı hatta kalır. Sağlayıcı ve raporlama hesabı başına tek aktif iş kuralı bunun içinde ayrıca geçerlidir. Bir hatta mağaza içi sağlayıcı paralelliği ayrı kapasite kararıdır.
- Hat ataması uzun ömürlüdür. Her kuyruk kontrolünde yeniden dağıtım yapılmaz. Boşa çıkan işler, yeni mağazalar ve güvenli devri tamamlanan mağazalar kapasiteye göre atanabilir. İş günü içinde devir gerçekleşirse mevcut kapanmış işler ve makbuzlar yeni hatta taşınan iş planında korunur.
- İlk kapasite değerlendirmesi birden fazla hat ve ortak kontrol kaydıyla yapılabilir. Veri veritabanı sayısı, hat sayısı ve mağaza dağıtım algoritması ölçümle seçilecek uygulama kararlarıdır.

```mermaid
flowchart TD
    Q[Ortak kuyruk] --> A[Mağazanın güncel hat sahipliğini al]
    A -->|Sahip hat ve fence güncel| B[İş ve sağlayıcı kotasını doğrula]
    A -->|Sahiplik belirsiz veya devirde| H[Mağazayı beklet]
    B --> C[İstek niyetini ortak kayda bağla]
    C --> D[Sağlayıcı isteği]
    D -->|Kesin sonuç| E[Sonucu ve kota kaydını kapat]
    D -->|Belirsiz sonuç| U[İsteği açık tut ve uzlaştır]
    E --> F[Ham kanıt ve Dataset makbuzunu doğrula]
    F --> G[İş emrini kapat]
    U --> H
```

## 2. Her dış istekte gönderim kontrolü

1. Worker işe alırken mağaza, geçerli kurulum nesli, hat, sahiplik fence’i, iş fence’i, sağlayıcı hesabı, gün ve iş son tarihini ortak kontrolden doğrular.
2. **Her fiziksel istek öncesinde** aynı mağaza sahibi ve güncel fence yeniden doğrulanır. Bu kontrol rapor, sayfalama ve gerekli abonelik/izin doğrulama isteklerini kapsar. Aynı işlem için iş kimliği, istek türü ve sayfa ya da deneme kimliği korunur.
3. Ortak kontrol, mağazanın yeni istek kabul ettiğini doğrular. Kota rezervasyonunu ve gönderim niyetini güncel sahiplik altında bağlar. Aynı istek için yeniden teslim edilmiş bir kuyruk mesajı ikinci gönderim hakkı oluşturmaz. Güncel karar doğrulanamazsa dış çağrı çıkmaz.
4. Gönderim niyeti kalıcı olduktan sonra HTTP çağrısının sonucuna kadar istek devir açısından açıktır. Kontrol işlemi HTTP boyunca kilit tutmaz. Worker, kontrol ile fiilî gönderim arasında durmuş olsa bile açık niyet yeni hattın aynı işi göndermesini engeller.
5. Kesin sonuçta istek ve kota kaydı birlikte doğrulanır. Sonucun belirsiz kaldığı çağrı otomatik yeniden gönderilmez. Gönderim izninin kesin olarak iptal edildiği veya eski yürütmenin sona erdiği ve çağrının durumunun uzlaştırıldığı kanıtlanana kadar sahiplik devredilmez.
6. Ham kayıt, rapor yayını ve kapanışta güncel hat ve iş fence’leri de doğrulanır. Gecikmiş bir worker, mağazanın artık kullanmadığı yetkiyle rapor yazamaz veya bir günün kapanışını ilerletemez. [Kesinti sözleşmesi](../contracts/eo-05a-refresh-interrupted-work-v1.json)

## 3. Hat devri ve hata halinde izolasyon

| Durum | Ortak kontrolün kararı | Sonraki hat |
|---|---|---|
| Hat sağlıklı | Mevcut sahiplik devam eder. Aynı mağazanın işleri sahibine yönlendirilir. | Bekler. |
| Planlı devir | Mağaza yeni gönderime kapatılır. Açık istekler, sonuçlar, ham yazımlar ve rapor makbuzları uzlaştırılır. | Sıfır açık ya da belirsiz işlem ve doğrulanmış devir koşullarıyla yeni fence alır. |
| Hat öldü veya bağlantısı koptu | Yeni gönderim durdurulur. Son kesin iş aşaması ve açık istekler korunur. Süre dolması yürütmenin veya HTTP çağrısının durduğuna kanıt sayılmaz. | Eski işin durumu kesinleşene kadar mağazayı çalıştırmaz. Diğer mağazalar kalan bütçeyle ilerleyebilir. |
| Devir sırasında kontrol veya hedef veri veritabanı erişilemedi | Son kesin sahibi ve tüm kanıtları koru. Yeni gönderim izni kapalı kalır. | Eksik kanıt giderilip devir tamamlandığında işe başlanır. |
| Eski mesaj veya worker geri döndü | Eski nesil ve fence reddedilir. Mesajın durumu mevcut iş ve istek kaydı üzerinden okunur. | Yeni sahipliği etkilenmez. |

Planlı devirde önce mağazanın gönderimi kapatılır, sonra açık işlemler uzlaştırılır. Kapanmış günlerin makbuzları ve bekleyen işlerin listesi doğrulandıktan sonra yeni sahip ve daha yüksek fence tek kararda kaydedilir. Yeni hattın ilk isteği bu kararın doğrulanmasından sonra çıkabilir.

## 4. Ortak kotalar ve birden fazla veri veritabanı

- **Tek ortak kontrol.** Kuyruk sahipliği, gönderim niyeti ve kota rezervasyonu aynı otorite üzerinden yürür. Kontrol kaydına ulaşılamadığında hatlar yeni istek gönderemez. Bir veri veritabanından diğerine geçmek bu kuralları değiştirmez.
- **Paylaşılan kota.** Google Ads’te proje ve müşteri hesabı, Klaviyo’da hesap ve endpoint/app kurulumu, Meta’da uygulama ve reklam hesabı kullanım sinyalleri ile Shopify Partner istemcisi ortak sayaç kapsamlarında izlenir. Aynı sağlayıcı hesabı birden fazla mağaza kaydında kullanılıyorsa o hesabın sağlayıcı kotası ortak kalır. Canlı tasarım, yayımlanan en yüksek erişim seviyelerini ve ilgili endpoint sınırlarını esas alır. Sabit hat sayısı gerçek istek hızı, kaynak bütçesi ve kapanış süresiyle belirlenecek. [Google Ads](https://developers.google.com/google-ads/api/docs/productionize/rate-limits) · [Klaviyo](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling) · [Meta](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/#ads-insights) · [Shopify Partner](https://shopify.dev/docs/api/partner/latest#rate-limits)
- **Tek etkin yazım hedefi.** Veri birden fazla veritabanına dağıtılırsa bir mağazanın ham kayıtları, Dataset satırları ve makbuzları için tek etkin hedef vardır. Hedef kimliği, geçerli sahiplik sürümüne bağlıdır. Planlı hedef değişiminde önce eski hedefte yeni yazımlar kapatılır ve bekleyen yazımlar kesinleşir. Kanıtlar doğrulanıp yeni hedefin fence’i hazırlandıktan sonra ortak yönlendirme güncellenir.
- **Yarım geçiş.** Hedef değişimi yarıda kalırsa mağaza bekler. Eski ve yeni hedef aynı anda yazım almaz. Yeniden dağıtım, son kesin durum ve doğrulanmış makbuzlarla ilerler. Her hedefteki bağımsız sayaçlar veya kilitler mağaza sahipliğini ve ortak kotayı belirlemez.

### Sağlayıcı kotaları bilgi notu

**Resmî belgeler 22 Kasım 2026’da kontrol edildi.** Aşağıdaki hesaplarda her mağaza kapanmış bir gün için bir kez çalışıyor. Google için mağaza başına 17, Meta için 12 fiziksel istek, ayrı reklam hesapları, ek sayfalama yok ve isteklerin 24 saate eşit yayıldığı varsayılıyor. Daha kısa gönderim aralığı aynı günlük toplamı daha yüksek anlık yüke çevirir. [Prova kaydı](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/45017013065/job/137191379744)

**Shopify ürün doğrulaması — Admin GraphQL.** AdsTable’ın her mağazada ayrı puan bütçesi var. Standart Shopify planında bütçeye saniyede **100 puan** geri eklenir. Mevcut tek ürün sorgusu, Shopify’ın varsayılan alan maliyetleriyle **2 puan**. 1.000 ürün birer kez sorgulanırsa **2.000 puan** harcanır. Başka sorgu aynı bütçeyi kullanmıyorsa bu, **20 saniyelik kota yenilenmesine** denk gelir. Kota deposu en fazla mağazanın izin verilen bakiyesi kadar dolar. İsteklerin yanıt süresi ve sorguları gönderme biçimi toplam işlem süresini ayrıca belirler. Aynı mağaza ve ürün için güncel doğrulama sonucunu paylaşabilirsek dört tekrar yerine bir sorgunun puanı harcanır. Shopify’ın gerçekten düşürdüğü puan yanıttaki `actualQueryCost` alanından okunur. [Admin GraphQL kota ve maliyet kuralları](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)

**Shopify abonelik kontrolü — Partner API.** Bir Partner API istemcisi saniyede **4 istek** gönderebilir. Aynı istemciyi kullanan mağazalar ve hatlar bu sınırı paylaşır. Örneğin her mağaza için üç abonelik kontrolü yapılırsa 3.000 mağaza **9.000 Partner isteği** oluşturur. Bu hesabın ürün doğrulama puanlarıyla bağlantısı yoktur. [Shopify Partner API kotası](https://shopify.dev/docs/api/partner/latest#rate-limits)

**Google Ads.** En üst **Standard** erişimde günlük işlem sınırı yoktur. **Basic** erişimde proje için son 24 saatte **15.000 işlem** sınırı vardır. Bir rapor sorgusu bir işlem sayılır. Geçerli sayfa belirteciyle alınan ek sayfa günlük işlem kotasına eklenmez ve fiziksel istek hızına dahil olur. **3.000 × 17 = 51.000 istek**, 24 saate yayılırsa dakikada ortalama **35,4 istek** eder. Prova biçimindeki tek sayfalı sorgularla bu hacim Basic sınırını aşar. Standard erişimde günlük kota bu hacmi sınırlamaz. Google ayrıca reklam hesabı ve AdsTable’ın Cloud projesi için ayrı hız kontrolü yapar. Bu anlık sınır yayımlanmış sabit bir sayı değildir. [Google erişim seviyeleri](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) · [İşlem ve sayfalama kotaları](https://developers.google.com/google-ads/api/docs/best-practices/quotas) · [Google hız sınırları](https://developers.google.com/google-ads/api/docs/productionize/rate-limits)

**Google iş süresi örneği.** Prova süresi yuvarlanarak mağaza başına **18 saniye** kabul edilirse 3.000 mağazanın Google işi tek hatta sırayla yaklaşık **15 saat** sürer. Bu tahmin, kuyruktan Google iş emri kapanışına kadar olan prova süresini kullanır. [Prova kaydı](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/45017013065/job/137191379744)

**Meta Ads.** **3.000 × 12 = 36.000 istek**, 24 saate yayılırsa dakikada ortalama **25 istek** eder. Meta, aynı iş türü için reklam hesabının son **60 dakikadaki** kullanımına bakar. Insights raporlarında hesap kullanımının yanında AdsTable uygulamasının ortak kullanımını, sorgu işleme süresini ve yükünü de izler. Dolayısıyla mağazalar ayrı reklam hesapları kullansa bile uygulama kotası ortak kalır. Meta yanıttaki `app_id_util_pct` ile uygulamanın, `acc_id_util_pct` ile reklam hesabının tükettiği yüzdeyi bildirir. **25 istek/dakika** planlanan ortalamadır. Ağır ürün kırılımları ve ek sayfalar Meta’nın ölçtüğü yükü artırabilir. [Meta kota kuralları](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/#ads-insights) · [Meta Insights kullanım göstergeleri](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/best-practices)

**3.000 mağaza için Meta kararı.** Mağazaların reklam hesapları ayrıysa her hesap günde yaklaşık **12 istek** alır ve hesap kotasına takılması beklenmez. Meta, AdsTable’ın ortak Insights kotasına ilişkin hesabı bitirecek sabit bir istek sınırı yayımlamadığı için **36.000 istek sayısından ortak kotanın dolup dolmayacağı çıkarılamaz**. 24 saate yayılmış iş yükü planlama açısından makul. Açık kalan kapasite ölçüsü, ağır ürün raporları çalışırken `app_id_util_pct` değerinin ne kadar yükseldiğidir. [Meta Insights kullanım göstergeleri](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/best-practices)

**Meta ürün raporunda 100 sınırı (22 Kasım 2026).** AdsTable, `product_id` kırılımı için `product_id_limit=100` değerini kullanmaya devam eder. Meta `limit` ve `product_id_limit` parametrelerini ayrı listeler. Sayfalama mevcut sorgunun sonuçlarında ilerler. 100’e ulaşan tek bir reklam için sonraki sayfaların kalan ürünleri getirip getirmediği belirsizdir. Bir reklamın ürün raporu 100 benzersiz ürün kimliğine ulaştığında aynı reklam ve tarih aralığında gerçek Meta yanıtıyla doğrulama konusu yeniden açılır. [Meta Insights API referansı](https://developers.facebook.com/docs/graph-api/reference/adaccount/insights/) · [Meta sayfalama dokümanı](https://developers.facebook.com/docs/graph-api/guides/field-expansion)

## 5. Uygulama öncesi kabul senaryoları

| Senaryo | Aranacak kanıt |
|---|---|
| İki hat aynı mağazayı aynı anda ister | Tek atama ve tek güncel fence. Kaybeden hattan sıfır sağlayıcı çağrısı. |
| Üç sağlayıcının işleri farklı hatlara teslim edilir | İşler aynı mağaza sahibi hatta yönlenir. Diğer hatlardan sıfır çağrı. |
| Aynı kuyruk mesajı yeniden gelir | Aynı iş ve istek kimliği ikinci bir gönderim izni üretmez. |
| Worker çağrıdan hemen önce durdurulur veya ağda gecikir | Açık gönderim niyeti yeni hattı engeller. Eski çalışmanın geçerli olmadığı ve açık işlemin uzlaştırıldığı doğrulanmadan ikinci çağrı çıkmaz. |
| Sağlayıcı yanıtı veya ham/rapor makbuzu kaybolur | Belirsizlik kaydı açık kalır. Aynı istek tekrar gönderilmez ve iş bitmiş sayılmaz. |
| Planlı devirde eski worker geç döner | Yeni fence’in önceki işlemi reddettiği görülür. Doğrulanmış rapor ve iş makbuzları korunur. |
| Farklı mağazalar ortak sağlayıcı kotasına yüklenir | Hatlar paralel ilerleyebilir. Tüm hatların toplamı ortak kota sınırında tutulur. |
| İki veri hedefi arasında geçiş yarıda kalır | Aynı anda tek yazım hedefi vardır veya mağaza durmuştur. Aynı gün için iki makbuz veya çift yazım oluşmaz. |
| Ortak kontrol erişilemez | Hat, önbellekte eski sahiplik görse bile yeni sağlayıcı çağrısı çıkarmaz. |

Ortak prova **tek mağaza, tek hat ve 40,621 saniyelik** sentetik referanstır. Çoklu hat yarışları, başa çıkılabilir kota hızı, hedef değişimi, bağlantı kaybı ve canlı kapasite için kabul senaryoları yukarıda tanımlıdır. Ölçüm ve kapasite kararı rapor yüküyle EO-07 sonunda, gerekirse EO-08 sonunda ele alınacak. [Tek hat prova kaydı](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/44914944926/job/136878434619)

PostgreSQL işlem ve kilit belgeleri ile sağlayıcı kota belgeleri 21 Kasım 2026’da kontrol edildi. [PostgreSQL işlemleri](https://www.postgresql.org/docs/17/tutorial-transactions.html) · [PostgreSQL kilitleri](https://www.postgresql.org/docs/17/explicit-locking.html) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
