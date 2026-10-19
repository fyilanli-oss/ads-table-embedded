# A6 EO-F4 — Şema, veri taşıma ve Supabase veri katmanı kararı

**Tarih:** 4 Ekim 2026

**Tarihsel durum:** EO-F4 tamamlandı; EO-F5 bekleniyor

**Etkisi:** Salt okunur karar ve taşıma sözleşmesi. Yeni Supabase projesi oluşturmaz; canlı şema, veri veya kimlik bilgisi değiştirmez.

**Okuma notu:** Bu belge eski yapının 4 Ekim 2026 incelemesini ve o günkü hedef tasarımını kaydeder. Envanter, süreler ve taslak nesne/paket eşlemeleri bugünkü temiz projenin canlı durumu veya uygulanmış DDL'si değildir. Güncel karar ve uygulama yetkisi `docs/EXECUTION_PLAN.md`, `contracts/a6-eo-implementation-master-v1.json` ve ilgili kabul edilmiş EO sözleşmelerindedir. Bu dil düzenlemesi taşıma, token işlemi, kaynak oluşturma veya yedek işi başlatmaz.

## Analist sonucu

Yalnız Shopify içine gömülü çalışan hedef ürün için **ayrı Supabase projesi** seçilmiştir.

Neden veri büyüklüğü değil, yetkili kayıt kaynaklarını yalıtmaktır. Eski proje 55 migration boyunca bağımsız uygulama kullanıcılarını, V1 analitiğini, eski sağlayıcı/token yapılarını, geçici yük testlerini ve gömülü ürünün kanonik kayıtlarını aynı fiziksel sınırda biriktirmiştir. Aynı projede özel rol teknik olarak mümkün olsa da yanlış yetki, eski fonksiyon veya yeni bir import üzerinden eski yetki kaynağına dönme riski kalır.

Yeni proje temiz migration geçmişi, özel şemalar, dar yetkili çalışma zamanı rolü ve sıfır eski nesneyle başlayacaktır. Eski proje, yetkili geçiş sonrasındaki tüketici-sıfır ve geri dönüş kapıları tamamlanana kadar silinmez veya daraltılmaz.

## Resmî Supabase kontrolü

Aşağıdakiler 4 Ekim 2026 tarihli resmî kaynak kontrolünün tarihsel kaydıdır; yeni sürüm doğrulaması değildir:

- `service_role` Data API üzerinden RLS'yi atlar; yeni çalışma zamanına verilemez.
- Güvenilir sunucu doğrudan Postgres bağlantısı kullanabilir.
- Vercel gibi sunucusuz çalışma zamanları için Supavisor işlem modu uygundur; önceden hazırlanmış sorgular (prepared statements) kapalı olmalıdır.
- API'ye açık şemalardaki tablolarda RLS zorunludur.
- O gün incelenen Postgres 17.11 / 15.19 uyumluluk değişikliği `ltree`, eski pgcrypto şifrelemesi, `btree_gist` float/NaN ve özel operatörlerin yeniden oluşturulmasını etkiler. Hedef temiz şema bunlara bağımlı olmayacaktır.
- OrioleDB o gün Public Beta durumundadır; SLA'sı yoktur ve bazı geri yükleme kabiliyetleri eksiktir. Hedef Production projesi için seçilmez.

Kaynaklar:

- https://supabase.com/changelog
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/secure-data
- https://supabase.com/docs/guides/database/connecting-to-postgres

## Canlı kaynak envanteri

4 Ekim'deki salt okunur canlı inceleme sonucu:

| Kaynak | Satır | Boyut | Karar |
|---|---:|---:|---|
| `workspaces` | 1 | 32 KB | Kimlik birebir taşınacak |
| `workspace_settings` | 1 | 32 KB | İş ayarı birebir taşınacak |
| `shopify_installations` | 1 | 80 KB | Kimlik ve şifreli token taşınacak |
| `workspace_provider_connections` | 3 | 152 KB | Yetkilendirme/hesap/bağ birebir, token şifreli taşınacak |
| `workspace_provider_email_spend_history` | 4 | 48 KB | Değişmez geçmiş birebir taşınacak |
| `performance_dataset_rows_v2` | 5 | 128 KB | Kanonik kopyalama yok; karantina kanıtı + sağlayıcıdan yeniden çekme |
| `fx_rates_daily` | 10,478 | 7.73 MB | Toplu kopyalama yok; gerekli kur çiftlerini yeniden kurma/uzlaştırma |

Dataset satırları:

- Klaviyo: 4 satır; 2 `real`, 2 `partial`
- Meta: 1 satır; `partial`
- Google Ads: 0 satır
- çalışma alanı boş: 0
- `user_id` boş olmayan: 0
- sentetik: 0
- ham kanıtı bulunan satır: 5

Token durumu:

- Shopify: 1 erişim + 1 yenileme zarfı; erişim süresi geçmiş, yenileme süresi geçmemiş
- Google Ads: 1 erişim + 1 yenileme; erişim süresi geçmiş
- Klaviyo: 1 erişim + 1 yenileme; erişim süresi geçmiş
- Meta: 1 erişim; süresi geçmemiş
- Zarf sürümü ve anahtar kimliği biçimleri tutarlı; gizli değer/şifreli içerik okunmadı.

## Neden mevcut şema aynen taşınmıyor?

### Dataset V2

Canlı tablo çalışma alanını esas alarak yazıyor; ancak veri tanımı (DDL) hâlâ şunları taşıyor:

- boş kalabilen eski `user_id` ve `users(id)` yabancı anahtarı;
- GA4 alanı ve Organic kaynak kuralı;
- TikTok platform/hiyerarşi izinleri;
- eski `source_job_id`;
- olgunluk/kesinleşme/uzlaştırma için kalıcı yetkili kayıt kaynağı eksikliği.

Aynen kopyalamak, EO-F3'te yasaklanan yapıları yeni veritabanına gömmek olur.

### Çalışma zamanı yetkileri

Kanonik tabloların çoğunda RLS etkin/zorunlu olsa da politika yoktur; erişim `service_role` CRUD yetkisiyle yapılır. Dataset V2 ve FX tablolarında zorunlu RLS yoktur. Bu eski sunucu erişim düzeninin kaydıdır; hedef yetkilendirme modeli değildir.

### Veritabanı fonksiyonları

Canlı Klaviyo maliyet fonksiyonlarının üçü `SECURITY DEFINER` kullanır; çalıştırma erişim listesinde yalnız `postgres` ve `service_role` vardır. Shopify kurulum fonksiyonu çağıranın yetkileriyle çalışır, fakat public şemadadır. Bunlar hedefe kopyalanmaz; temiz işlem/servis sınırında yeniden yazılır. Fonksiyon gerekli değilse sunucu işlemi kullanılır.

## Seçenek karşılaştırması

Puan 1 zayıf, 5 güçlüdür.

| Kriter | Aynı proje + özel rol/özel şema | Ayrı Supabase projesi |
|---|---:|---:|
| Eski yetkileri yalıtma | 3 | 5 |
| Temiz migration geçmişi | 2 | 5 |
| Yanlış tablo/fonksiyon import riskini önleme | 3 | 5 |
| Token ve kurulum devamlılığının kolaylığı | 5 | 3 |
| Veri taşıma kolaylığı | 5 | 4 |
| Bağımsız geri dönüş | 3 | 5 |
| Yedek ve arıza etki alanını ayırma | 2 | 5 |
| Başlangıç operasyon maliyeti | 4 | 3 |
| **Toplam** | **27/40** | **35/40** |

Tarihsel özet metni kanonik veriyi “14 iş satırı ve 10,478 yeniden üretilebilir FX satırı” diye tanımlıyordu. **Sayım notu:** Bu “14” ifadesi aynı belgenin nihai kabulündeki 10 satırlık açık listeyle uyuşmaz; taşıma yetkisi olarak kullanılamaz. Bağlayıcı nihai liste aşağıdaki kabul sonucu ve EO-F7'deki **10 satırdır**. Eski özetin gerekçesi korunur: ayrı projenin yalıtım kazanımı taşıma maliyetinden büyüktür.

## Hedef veri katmanı

Aşağıdaki şema adları tarihsel mantıksal tasarımdır; bugünkü nesne envanteri sayılmaz.

### Proje tipi

- Standard Supabase Postgres; OrioleDB yok
- Ayrı proje, ayrı veritabanı parolası ve ayrı yedek/geri yükleme sınırı
- Yeni Vercel projesi yalnız bu veri katmanının kimlik bilgisini alır
- Eski projenin kimlik bilgisi yeni çalışma zamanına verilmez

### Şema sınırı

Hedef tablolar Data API'nin API'ye açık şemasında bulunmaz. Şema grupları:

| Şema | Yetkili kayıt alanı |
|---|---|
| `app` | çalışma alanı ve mağaza sahibinin seçtiği ayarlar |
| `shopify` | kurulum, kurulum nesli, faturalandırma/kullanım hakkı bağı |
| `integrations` | sağlayıcı bağlantısı, OAuth işlemi ve şifreli token üstverisi |
| `analytics` | kanonik performans satırları, Klaviyo maliyet geçmişi, FX |
| `operations` | yenileme çalıştırması, kiralama, ilerleme noktası, uzlaştırma/kesinleşme |
| `privacy` | webhook işleme sahipliği, silme çalıştırması, manifest ve kanıt |
| `billing` | Shopify aboneliği, 14 günlük deneme ve çalışma alanı kullanım hakkı |

İlk taslak bunları EO-01/EO-02 migration'larına bağlar; güncel uygulama ilgili kabul edilmiş EO sözleşmesine tabidir. `public` çalışma zamanı iş tablosu içermez.

### Çalışma zamanı bağlantısı

- Vercel sunucusu → Supavisor işlem modu, SSL
- Önceden hazırlanmış sorgular kapalı
- Özel `adstable_runtime` giriş rolü
- Şema düzeyinde `USAGE`, tablo/fonksiyon bazında izin listesi
- `NOINHERIT`, `NOBYPASSRLS`; superuser/createdb/createrole/replication yok
- DDL, truncate, sahiplik değişimi ve eski şema erişimi yok
- Migration için çalışma zamanından ayrı sahip kimlik bilgisi
- Tarayıcıya veritabanı kimlik bilgisi/istemcisi verilmez
- `service_role`, publishable/anon anahtar ve Data API çalışma zamanı yolunda kullanılmaz
- Özel şemalarda ek savunma katmanı olarak RLS etkin ve zorunlu olur

Çalışma zamanı rolü tek başına müşteri belirleyemez. Her işlem sunucuda doğrulanmış Shopify oturumundan türetilen `workspace_id` ile çalışır; repository katmanı çağıranın verdiği çalışma alanını kabul etmez.

## Birebir taşıma haritası

### A — Kimlik ve durumu birebir taşıma

Aşağıdaki mantıksal kayıtlar birincil anahtar ve geçmişleri korunarak taşınır:

1. `workspaces` → `app.workspaces`
2. `workspace_settings` → `app.workspace_settings`
3. `shopify_installations` → `shopify.installations`
4. `workspace_provider_connections` → `integrations.provider_connections`
5. `workspace_provider_email_spend_history` → `analytics.email_spend_history`

Kolon adları hedef sözleşmeye göre değişebilir; iş kimliği ve kabul edilmiş değerler değişemez. Her kaynak satırı kanonik JSON özet değeri manifestiyle sayılır. Gizli alanlar bu manifeste veya loglara girmez.

### B — Şifreli token taşıma

Token açık metin olarak dışa aktarılmaz.

1. Workspace UUID, mağaza kimliği, sağlayıcı ve token türüne ait ek doğrulama verisi (AAD) bağlamları korunur.
2. Zarflar şifreli JSON olarak kısıtlı taşıma kanalıyla aktarılır.
3. Yeni Preview çalışma zamanının yalnız sunucudaki anahtar kümesi geçici olarak eski çözme anahtarını ve yeni etkin anahtarı içerir.
4. Kontrollü şifre çözme denemesi yalnız başarı/başarısızlık ve zarf kimliği özetini üretir; token değeri loglanmaz.
5. Başarılı zarf yeni etkin anahtarla yeniden şifrelenir.
6. Yeni veritabanında eski anahtar kimliğini kullanan zarf sayısının sıfır olduğu doğrulanır.
7. Eski anahtar yeni çalışma zamanından kaldırılır; eski Production geri dönüş anahtar kümesi kendi ortamında korunur.
8. Sağlayıcı/Shopify doğrulaması başarısızsa satır `reauthorization_required` olur; sahte bağlı durum üretilmez.

Bazı erişim süreleri geçmiş olduğundan devamlılık kabulü yalnız şifre çözmek değildir: yenileme veya resmî token yenilemesi ve salt okunur kimlik kontrolü de PASS olmalıdır. Bu protokol burada yürütülmez; canlı işlem için ayrı yetki gerekir.

### C — Kanonik kopyası yapılmayan Dataset

Beş Dataset V2 satırı yeni `analytics.performance_rows` tablosuna kopyalanmaz.

- Salt okunur kaynak manifestinde satır sayısı, iş tarihi, sağlayıcı, varlık anahtarı özeti, metrik destek özeti, ham veri özeti ve adaptör/sözleşme sürümü tutulur.
- Ham satırlar kısıtlı taşıma karantinası/kanıtı olarak korunur; Production sorgularının yetkili kaynağı değildir.
- Yeni adaptörler onaylı ilk yükleme aralığı olan **dün + bugün** verisini sağlayıcılardan yeniden çeker.
- Sonraki kayan uzlaştırma/kesinleşme penceresi EO-05'te çalışır.
- Yeniden çekilen veri kaynak manifesti ve sağlayıcı ham kanıtıyla karşılaştırılır.
- Uyuşmazlık gizlenmez; sağlayıcı/tarih/varlık bazında uzlaştırma kaydı açılır.
- Google Ads'teki sıfır kaynak satır “başarılı taşıma” sayılmaz; canlı adaptör okuma kabulü gerekir.

### D — FX'i yeniden kurma

`fx_rates_daily` topluca kopyalanmaz.

- Yalnız gerçekten gereken para birimi çifti/tarih tutulur.
- Kurlar onaylı sağlayıcıdan yeniden alınır.
- Eski ve yeni kur aynı sağlayıcı/sürüm/tarih için farklıysa yetkili geçiş durur.
- Yeniden alınamayan, kanonik satırın hesaplanması için zorunlu tarihsel kur ancak kaynak özeti/veri kökeniyle birebir taşınabilir.
- `raw` içerik zorunlu çalışma zamanı kolonu değildir; kısıtlı kanıt deposu veya içerik özeti tercih edilir.

### E — Satırı taşınmayacak tablolar

- `oauth_transactions`: 12/12 süresi dolmuş; sıfır satır, temiz TTL deposu
- `users`, `user_settings`, `subscriptions`
- `platform_connections`, `platform_connection_tokens`
- `shopify_workspace_provider_connections`
- `legacy_user_workspace_bindings`
- `dashboard_snapshots`, `performance_dataset_rows`
- `snapshot_jobs`, `snapshot_schedules`
- diğer pasif sağlayıcı/hesap envanteri ve test tabloları

## Hedef asgari şema sözleşmesi

EO-F4'ün mantıksal asgarisi aşağıdadır. İlk taslaktaki EO-01/EO-02 DDL eşlemesi tarihsel planlamadır; gerçek DDL ilgili sonraki sözleşme ve migration testleriyle belirlenir.

### Mevcut yetkili kayıtların temiz karşılığı

- `app.workspaces`
- `app.workspace_settings`
- `shopify.installations`
- `integrations.provider_connections`
- `analytics.performance_rows`
- `analytics.email_spend_history`
- `analytics.fx_rates`

### O gün eksik olan, GO öncesi zorunlu temel kapsam

Aşağıdakiler fizibilitede zorunlu kapsama alınan yapılardır; bu liste bunların o gün uygulandığını göstermez.

- `billing.workspace_subscriptions`
- `billing.workspace_entitlements`
- `billing.trial_ledger`
- `operations.refresh_runs`
- `operations.refresh_leases`
- `operations.provider_checkpoints`
- `operations.reconciliation_ledger`
- `privacy.webhook_claims`
- `privacy.deletion_runs`
- `privacy.deletion_manifests`
- `integrations.oauth_transactions`

Gerektiğinde her tabloda `workspace_id`, değişmez oluşturma zamanı, tek yönde artan sürüm ve işlemi tekilleştiren anahtar bulunur. Çalışma alanları arası yabancı anahtar veya çağıranın verdiği müşteriye geri dönüş yasaktır.

## Taşıma protokolü

### Hazırlık

1. Hedef migration'lar boş projeye uygulanır.
2. Yetki/Advisor/şema farkı ve yasak nesne taraması PASS olur.
3. Hedef proje yalnız Preview olarak kalır.
4. Kaynak veritabanının salt okunur manifest görüntüsü alınır.

### Prova

1. Gizli olmayan birebir satırlar geçici yükleme işlemine alınır.
2. Yabancı anahtar, sayım, kanonik özet değeri ve kısıt kontrolleri yapılır.
3. Şifreli token için kontrollü deneme ve anahtar yenileme yapılır.
4. Dataset yeniden çekilir ve uzlaştırılır.
5. Gizlilik, faturalandırma ve zamanlayıcı temel kabul testleri geçer.
6. İşlem geri alınarak veya geçici dal/proje kullanılarak kanıt üretilir.

### Yetkili geçiş provası

- kaynak ilerleme işareti alınır
- farklar tekrarlandığında çoğalmadan işlenir
- hedef salt okunur Preview, Shopify oturumuyla doğrulanır
- yan yana çıktı eşlik raporu üretilir
- kaynak projenin yazma yetkisi kapanmaz
- hedef kimlik bilgisini iptal etme ve eski rotayı geri açmayla geri dönüş prova edilir

### Production'a yetkili geçiş

EO-F7 tek başına Production geçişi değildir. EO-01–EO-08'in ilgili kabul kapıları, sağlayıcı eşliği, silme, faturalandırma/deneme, zamanlayıcı/kesinleşme ve insan onayı olmadan alan adı/Shopify uygulaması/çalışma zamanı değiştirilmez.

## Uzlaştırma kabul kriterleri

Birebir taşıma için:

- kaynak sayısı = dışa aktarılan sayı = içe aktarılan sayı
- gizli olmayan kanonik satır özet değerleri birebir eşit
- sahipsiz yabancı anahtar = 0
- yinelenen kanonik anahtar = 0
- bilinmeyen çalışma alanı = 0
- açık metin token = 0
- şifre çözme/anahtar yenileme hatası = 0 veya açık `reauthorization_required`
- eski tablo/fonksiyon/import sayısı = 0
- çalışma zamanı rolünde yasak yetki = 0

Yeniden çekme için:

- her aktif sağlayıcıda kimlik/hesap kontrolü PASS
- istenen tarih aralığı eksiksiz
- ham yanıt kanıtı mevcut
- destek durumu `supported|unsupported|unknown`; eksik değer sıfıra çevrilmez
- uzlaştırma uyuşmazlığı açık ve sayılabilir
- kesinleşme durumu ve kaynak ilerleme işareti yazılmış

## Geri dönüş ve saklama

- Eski proje geçişte yetkili kaynak/geri dönüş hattı olarak korunur.
- Yeni projeye geçiş eski projede silme/güncelleme yapmaz.
- Geri dönüş, yeni çalışma zamanı kimlik bilgisinin iptali ve eski dağıtım/alan adı hattının yeniden etkinleştirilmesidir.
- Eski proje tüketici-sıfır, saklama, gizlilik ve hukuki kararlar tamamlanmadan duraklatılmaz/silinmez.
- Yeni projede geçişten sonra oluşan yazılar geri dönüşte fark manifestiyle korunur; sessiz veri kaybı kabul edilmez.

## Tarihsel değişiklik günlüğünün etkisi

O günkü Postgres 17.11 uyumluluk kontrolüne göre:

- hedef şema `ltree` kullanmaz;
- veritabanı düzeyinde eski pgcrypto zarfı kullanılmaz; uygulama AES-256-GCM zarf modeli korunur;
- `btree_gist` float/NaN indeksi yoktur;
- özel operatör yoktur;
- OrioleDB kullanılmaz.

Eski projede sürüm yükseltme veya indeksleri yeniden oluşturma bu kapsamda değildir; Production değişikliği yapılmamıştır.

## EO paketlerine tarihsel aktarım

Bu ilk taslak eşlemesidir; güncel Execution Plan numaralandırmasının yerine geçmez:

- **EO-F5:** Shopify ürün/rota ve veritabanı tüketici haritası
- **EO-F6:** ayrı Supabase kurulum, migration ve prova eforu
- **EO-F7:** proje oluşturma GO/NO-GO kararı
- **EO-01:** temiz migration, rol, CI, Advisor ve yasak şema testleri
- **EO-02:** çalışma alanı/kurulum/faturalandırma/gizlilik temelleri
- **EO-03:** sağlayıcı bağlantısı/token yenileme ve adaptör kabulü
- **EO-04:** temiz Dataset/formül/sorgu şeması
- **EO-05:** yenileme kiralaması/ilerleme noktası/kesinleşme/silme
- **EO-07/08:** eşlik, taşıma provası, kademeli geçiş, yetkili geçiş ve geri dönüş

Güncel planda EO-03 bağlantı/token, EO-04 adaptörler, EO-05 zamanlayıcı/Dataset/FX/kesinleşme, EO-06 formül/sorgu/API, EO-07 UI ve EO-08 prova/eşlik/geri dönüş kapsamıdır. Bu belge bugünkü eksiksiz şema veya yeni canlı uygulama yetkisi değildir.

## Tarihsel kabul sonucu

EO-F4 **PASS**:

- veri katmanı: ayrı Standard Supabase Postgres projesi
- yeni çalışma zamanında `service_role`: yasak
- birebir iş satırı taşıması: **10 satır** (1 çalışma alanı + 1 ayar + 1 kurulum + 3 bağlantı + 4 harcama geçmişi)
- Dataset kanonik doğrudan kopyası: 0
- FX toplu doğrudan kopyası: 0
- süresi dolmuş OAuth işlemi taşıması: 0
- açık metin token ifşası: 0
- yeni proje/şema/veri değişikliği: 0
- o günkü sonraki kapı: **EO-F5 — Ürün ve rota haritası**

