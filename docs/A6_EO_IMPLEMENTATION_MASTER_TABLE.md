# A6 EO — Tek Hat Yürütme Kuralı ve Bütünleşik İş Paketleri Ana Tablosu

**Tarih:** 4 Ekim 2026  
**Durum:** EO ana yürütme baseline'ı  
**Otorite:** Execution Plan + EO executable contract  
**Amaç:** Dallanıp budaklanan paralel paket ağını engellemek ve bütün yeni uygulama işlerini tek EO hattında yürütmek.

## Analist sonucu

Bundan sonra AdsTable geliştirmesinde tek aktif ürün hattı **A6-EO** olacaktır.

E, R ve A6-RM paketleri yeniden çalıştırılacak paralel backlog değildir. Bunlar tarihsel karar, gereksinim, risk ve evidence referans havuzudur. Yeni uygulama maddeleri eski paketlerin kopyası olarak değil, temiz embedded ürünün kendi mimarisine ve müşteri yolculuğuna göre EO paketlerinde tanımlanır.

Bu ana tablo merge edilmeden EO-01 teknik kurulumu başlamaz.

## Değiştirilemez yürütme kuralları

1. Aynı anda yalnız bir EO parent paket `In progress` olabilir.
2. Parent sıra `EO-01 → EO-10`dur; downstream paket upstream kabulü olmadan başlayamaz.
3. E, R veya A6-RM altında yeni implementation paketi açılmaz.
4. Eski paketler yalnız ilgili EO satırının `references` alanında kullanılır.
5. Bir EO paketi eski bir yükümlülüğü ancak exact acceptance evidence ve açık closure kaydıyla kapatabilir; “kapsama aldık” Done değildir.
6. Production'ı korumak için zorunlu acil containment gerekirse EO dışı geliştirme sayılmaz; ayrı, minimum, geri alınabilir ve açık insan kararıyla yapılır.
7. Parent altındaki stable child ID'ler en fazla tek seviyedir: `EO-04-A`, `EO-04-B` gibi. Varsayılan olarak `EO-04-B-1-C` türü ikinci/üçüncü seviye paket açılmaz.
8. Child içindeki teknik adımlar checklist/test olarak tutulur; yeni package kodu verilmez.
9. Yeni bulgu önce mevcut aktif EO parent risk kaydına yazılır. Doğası başka parent'a aitse o parent'ın `pending_findings` alanına aktarılır; yeni paralel harf dizisi açılmaz.
10. Her parent başlamadan önce analist brief verilir: iş çıktısı, iş değeri, kapsam, kapsam dışı, bağımlılık, canlı etki, kabul ve rollback.
11. Her parent bittiğinde dört sonuç birlikte yazılır:
    - üretilen gerçek çıktı;
    - geçen acceptance/evidence;
    - reference paketlerden kapanan/açık kalan yükümlülükler;
    - sıradaki tek parent.
12. Kod yazılması, PR merge'i veya deployment tek başına Done değildir.
13. Merge her zaman açık kullanıcı onayı ister.
14. Production, provider, data carry, cutover ve destructive retirement kendi exact insan kapılarını korur.

## Durum sözlüğü

- **Ready:** Upstream ve governance kapıları tamam; başlanabilir.
- **Not started:** Sırası gelmedi.
- **In progress:** Tek aktif parent.
- **Verification:** Implementation hazır; evidence/insan kabulü bekleniyor.
- **Done:** Contract, CI, canlı/merchant evidence ve gerekli insan kabulü tamam.
- **Blocked:** Belgelenmiş dış bağımlılık olmadan ilerlenemiyor.
- **Post-review:** Review tesliminden sonra yürütülür; erken başlatılmaz.

## Ana iş paketleri tablosu

| Parent | Doğal amacı | Faz | Başlangıç bağımlılığı | Stable child sayısı | Durum |
|---|---|---|---|---:|---|
| EO-01 | Temiz runtime/repository/CI sınırı | Review-critical | EO-F7 + bu master | 3 | Done |
| EO-02 | Workspace/install/billing/privacy foundation | Review-critical | EO-01 | 4 | In progress |
| EO-03 | OAuth/connection/token authority | Review-critical | EO-02 | 4 | Not started |
| EO-04 | Üç provider adapterı | Review-critical | EO-03 | 5 | Not started |
| EO-05 | Scheduler/Dataset/finality | Review-critical | EO-04 | 5 | Not started |
| EO-06 | Formula/Query/BFF API | Review-critical | EO-05 | 5 | Not started |
| EO-07 | Üç yüzeyli Shopify UI | Review-critical | EO-06 | 6 | Not started |
| EO-08 | Carry/parity/canary/rollback | Review-critical | EO-07 | 4 | Not started |
| EO-09 | Cutover/stabilization/consumer-zero | Post-review/cutover | EO-08 + ayrı cutover GO | 3 | Not started |
| EO-10 | Archive/retention/retirement | Post-consumer-zero | EO-09 + destructive approval | 4 | Not started |

Toplam: **10 parent, 43 stable child**. Bu sayı hedef plan baseline'ıdır; teknik checklist'ler paket sayısını artırmaz.

## EO-01 — Clean runtime shell, CI and dependency boundary

- **EO-01-A — Repository and physical boundary:** Ayrı ve boş clean GitHub repository sınırı kurulacak; eski repository fork edilmeyecek veya topluca kopyalanmayacak.
- **EO-01-B — Official stack, manifest and CI:** Güncel resmî Shopify stack seçilecek, temiz dependency manifesti kilitlenecek ve forbidden import/route/table/environment CI kapıları kurulacak.
- **EO-01-C — Three-route truthful preview shell:** Yeni Vercel Preview projesinde `/`, `/ad-analysis` ve `/settings` route kabukları veri iddiası ve production bağlantısı olmadan oluşturulacak.

Çıktı: clean repository + preview shell.  
Referans: A6-RM-01, E3 mimari dersleri, Shopify Embedded UI Constitution.

## EO-02 — Workspace, installation, billing/trial and privacy foundations

- **EO-02-A — Private schemas, roles and migrations:** Yeni Standard Supabase projesinde private schema, en az yetkili roller ve temiz migration zinciri kurulacak.
- **EO-02-B — Workspace, installation and generation authority:** Shopify installation/session/bootstrap akışı workspace ve installation generation otoritesine bağlanacak.
- **EO-02-C — Fourteen-day trial, subscription and entitlement:** On dört günlük trial ve abonelik Shopify billing otoritesiyle, doğrulanmış kurulu Shopify mağazasına bire bir bağlı yönetilecek.
- **EO-02-D — Privacy, uninstall, deletion and clean reinstall:** Compliance webhook, Delete my data, uninstall ve yeni-generation clean reinstall yaşam döngüsü kurulacak.

Çıktı: clean data foundation ve tam merchant lifecycle.  
Referans: A6-RM-03/04/05, E10-T4/T7, R2.

## EO-03 — Canonical OAuth, connection and token vault

- **EO-03-A — OAuth transaction boundary:** OAuth state, PKCE, nonce, TTL, callback ve workspace bağları tek kullanımlık güvenli transaction sınırına alınacak.
- **EO-03-B — Token envelope and startup guard:** Provider tokenları yalnız server tarafında şifreli, versionlı ve eksik yapılandırmada fail-closed saklanacak.
- **EO-03-C — Connection and reporting-account authority:** Doğrulanmış provider hesapları ve seçili Reporting Account, değiştirilemez kurulu Shopify mağazası otoritesinin altında canonical olarak yönetilecek.
- **EO-03-D — Reconnect, disconnect and renewal lifecycle:** Reconnect, disconnect, token yenileme ve yeniden yetkilendirme veri veya yetki uydurmadan idempotent çalışacak.

Çıktı: tek provider authority ve güvenli token lifecycle.  
Referans: A6-RM-01, R0/R5/R6, E7.

## EO-04 — Meta, Google Ads and Klaviyo adapters

- **EO-04-A — Common adapter contract:** Üç provider için ortak request, ham kanıt, support-state, store-candidate discovery/filter, kota ve hata envelope sözleşmesi kurulacak.
- **EO-04-B — Meta adapter:** Meta account/campaign/ad hiyerarşisi, actions/action_values ve missing/unsupported davranışı ham yanıtla doğrulanacak.
- **EO-04-C — Google Ads adapter:** Standard Ad ve Performance Max Asset Group hiyerarşisi en alt doğrulanabilir grain ve ham structure kanıtıyla kurulacak.
- **EO-04-D — Klaviyo adapter:** Campaign/Message, Flow/Message, metrik ve maliyet girdileri kurulacak; 15 Ekim sözleşmesi resmî kaynakla yeniden doğrulanacak.
- **EO-04-E — Integrated three-provider acceptance:** Meta, Google Ads ve Klaviyo hem ayrı hem birlikte sentetik veri üretmeden kabul testinden geçirilecek.

Çıktı: raw evidence + normalize edilmiş truthful provider facts.  
Referans: R6/R7/R7-B5 ve deepest-grain discovery girdileri.

## EO-05 — Scheduler, Dataset V2, FX, maturity and reconciliation

- **EO-05-A — Hourly scheduler, shard, lease and checkpoint:** AdsTable-owned saatlik scheduler deterministik shard, single-flight lease, checkpoint ve kurulu-mağaza scope-drift kontrolüyle kurulacak.
- **EO-05-B — Dataset V2, FX and provenance:** Canonical facts, kurulu Shopify mağazası scope'u, Klaviyo allocated spend, kaynak para birimi, FX ve provenance workspace sınırında saklanacak.
- **EO-05-C — Maturity, attribution windows and finality:** Providerların geçmiş günleri sonradan değiştirebildiği attribution pencereleri için rolling correction ve truthful freshness/finality kuralları kurulacak.
- **EO-05-D — Bootstrap, idempotent upsert and reconciliation:** İlk yesterday+today bootstrap, güvenli replay, idempotent upsert ve provider–Dataset uyuşmazlık uzlaştırması uygulanacak.
- **EO-05-E — Operational observability:** Job durumu, gecikme, hata ve alarm kanıtları secret veya PII sızdırmadan gözlemlenebilir olacak.

Çıktı: AdsTable-owned saatlik ve düzeltilebilir canonical data plane.  
Referans: A6-RM-06/07, E9-T8, R3/R4/R7.

## EO-06 — Formula, Query and same-origin BFF/API

- **EO-06-A — Formula engine:** Aggregate-first KPI, Klaviyo maliyet dağıtımı, CPC/ROAS/CPS/revenue/revenue margin ve currency-safe hesaplamalar uygulanacak.
- **EO-06-B — Query, filters and comparison semantics:** Tarih, entity, grain, filtre ve dönem karşılaştırma kuralları tek query sözleşmesinde kurulacak.
- **EO-06-C — BFF routes and DTO envelope:** Workspace'i session'dan türeten same-origin BFF route'ları ve üç yüzey için kararlı DTO envelope'ları hazırlanacak.
- **EO-06-D — Support/null/freshness semantics:** Unknown, unsupported, stale, partial ve gerçek zero durumları API boyunca birbirinden ayrı tutulacak.
- **EO-06-E — Contract and security acceptance:** Tenant tamper, formül, query ve API contract/security testleriyle bu katmanın kabulü kanıtlanacak.

Çıktı: missing/unknown'u sıfır yapmayan truthful API.  
Referans: A6-RM-08/09, E11 ve Dataset V2 sözleşmeleri.

## EO-07 — Shopify-native three-surface UI

- **EO-07-A — Settings surface:** Eski çalışan Settings kullanıcı akışı referans alınarak Reporting Currency, provider bağlantıları/hesap seçimleri, salt-okunur kurulu Shopify mağazası bağlamı, Klaviyo Email Monthly Plan Cost, Shopify subscription ve iki aşamalı Delete my data Shopify-native Settings içinde kurulacak; store selector ve grafik olmayacak, legacy UI kodu aynen taşınmayacak.
- **EO-07-B — Funnel App Home:** Bağımsız Funnel/Table ve Summary/Daily boyutları, provider-native hiyerarşi ve kontrollü compare uygulanacak; bağlamsal dashboard yalnız ürün sahibinin beklenen ilişkilendirilmiş grafik paketi kabul edildikten sonra tasarlanacak.
- **EO-07-C — Cross-platform deepest-grain discovery:** Meta, Google Ads ve Klaviyo için gerçek en alt analiz seviyeleri ile clicked-product satın alınmayan/alınan iki exact küpe/cross-sell fixture sonucu Ad Analysis tasarlanmadan önce dondurulacak.
- **EO-07-D — Ad Analysis surface:** Ad Analysis sıralama tablosu, tek details modalı ve kanıtlı ürün görünümü yalnız EO-07-C discovery sonucu üzerinde uygulanacak; grafik katmanı EO-07-C kapanana kadar blokludur ve bütün provider leafleri yapay olarak Ad diye etiketlenemez.
- **EO-07-E — Attribution Differences nested view:** Attribution Differences, discovery ve Ad Analysis kabulünden sonra ayrı yüzey açmadan Ad Analysis içine yerleştirilecek.
- **EO-07-F — Desktop, real-mobile and accessibility acceptance:** Üç yüzey resmî component eşlemesi, gerçek desktop/mobil Shopify Admin ve erişilebilirlik kabulünden geçirilecek.

Çıktı: Funnel, Ad Analysis ve Settings. Funnel grafikleri ilişkilendirilmiş grafik girdisini bekler; Ad Analysis grafikleri EO-07-C kanıtını bekler; Settings'te grafik yoktur. Platforms Settings içinde.  
Referans: A6-RM-09, E10-T5, E12 ve UI Constitution.

Bağlayıcı ürün davranışı ve bekleme kapıları `docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md` ile `contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json` içinde dondurulmuştur. Bu pre-freeze EO-07 implementasyonunu veya kabulünü erkene çekmez.

## EO-08 — Carry rehearsal, parity, canary and rollback

- **EO-08-A — Restricted data and sealed-token carry rehearsal:** Yalnız allowlist içindeki veri ve sealed tokenlar disposable/preview sınırında gerçek production'a dokunmadan taşıma provasından geçirilecek.
- **EO-08-B — Provider, Dataset, API and UI parity:** Provider ham gerçekliği, Dataset V2, API ve UI sonuçları false-zero üretmeden uçtan uca karşılaştırılacak.
- **EO-08-C — Failure injection and rollback rehearsal:** Auth, provider, veritabanı, job ve UI arızalarında güvenli durma ve rollback davranışı kanıtlanacak.
- **EO-08-D — Review evidence and review-ready decision:** Shopify yaşam döngüsü ve ürün kanıtları toplanacak; review-ready kararı ayrıca açık insan onayıyla verilecek.

Çıktı: Shopify review'a sunulabilir olduğumuzu kanıtlayan paket.  
Referans: A6-RM-10, R8/R9, E13.

## EO-09 — Authority cutover stabilization and consumer-zero

- **EO-09-A — Production cutover plan and freeze:** Domain, Shopify App configuration, veri watermark'ı, freeze ve rollback penceresi exact cutover planında dondurulacak.
- **EO-09-B — Canary authority switch:** Production otoritesi ayrı GO sonrasında küçük ve kontrollü canary geçişiyle yeni yapıya alınacak.
- **EO-09-C — Stabilization and consumer-zero observation:** Yeni otoritenin stabil olduğu ve eski runtime'ı kullanan hiçbir consumer kalmadığı gözlemle kanıtlanacak.

Çıktı: ayrı GO ile kontrollü production authority geçişi.  
Referans: A6-RM-10/11, R9, E13.

## EO-10 — Legacy archive, retention and controlled retirement

- **EO-10-A — Archive and retention manifest:** Kod, veri ve kanıtlar için geri alınabilir archive ile hukuki/privacy retention manifesti hazırlanacak.
- **EO-10-B — Legacy route, deployment and environment retirement:** Yalnız consumer-zero kanıtı bulunan eski route, deployment ve environmentlar kontrollü biçimde devreden çıkarılacak.
- **EO-10-C — Legacy database retirement:** Eski tablo, function ve credentiallar restore point ve exact manifest sonrasında ayrı destructive onayla emekli edilecek.
- **EO-10-D — Final restore and closure evidence:** Restore sınırı kanıtlanacak ve bütün taşınmış yükümlülükler açık closure evidence ile nihai olarak kapatılacak.

Çıktı: geri alınabilir archive ve kanıtlı legacy retirement.  
Referans: A6-RM-11, E14, R10.

## Referans yükümlülüklerinin kullanımı

Eski paketler için üç durum vardır:

- **Referenced:** EO tasarımının girdisidir; henüz kapanmamıştır.
- **Satisfied by EO evidence:** Exact EO acceptance eski yükümlülüğü karşılamıştır.
- **Superseded for implementation, retained historically:** Eski implementation yolu kullanılmaz; karar/evidence geçmişi korunur.

“EO başladı, eski paketler otomatik kapandı” ifadesi yasaktır.

## Yeni bulgu yönlendirme kuralı

| Yeni bulgu doğası | Gideceği EO parent |
|---|---|
| Repository, dependency, build, Shopify stack | EO-01 |
| Workspace, install, billing, privacy, deletion | EO-02 |
| OAuth, token, account ownership | EO-03 |
| Provider request/normalization/hierarchy | EO-04 |
| Scheduler, Dataset, FX, finality | EO-05 |
| Formula, query, API semantics | EO-06 |
| UX, component, mobile, three-surface behavior | EO-07 |
| Migration, parity, canary, rollback | EO-08 |
| Cutover ve consumer-zero | EO-09 |
| Archive/retirement | EO-10 |

Bulgu ilgili parent'ın sırası gelene kadar backlog satırı olarak kalır; yeni paralel paket ailesi oluşturmaz.

## Review sınırı

EO-01–EO-08 review-critical hattır. EO-08-D sonunda ayrıca açık insan review-ready kararı gerekir.

EO-09 ve EO-10 review sonrasında yürütülür. Bununla birlikte review sonrasında yapılmaları, erken legacy deletion yetkisi vermez; consumer-zero ve destructive approval korunur.

## Güncel aktif iş

Tek aktif parent **EO-03**'tür.

- **EO-03-A — Accepted:** OAuth transaction boundary repository ve live database kanıtlarıyla kabul edildi.
- **EO-03-B — Accepted:** Ciphertext-only token vault, production Sensitive keyring, live Supabase function boundary, production startup guard ve sentetik store/load/delete kabulü PASS; gerçek provider tokenı veya OAuth kullanılmadı.
- **EO-03-C — In progress:** Provider tarafından doğrulanmış connected hesaplar ve tek Meta/Google Reporting Account, değiştirilemez kurulu Shopify mağazası altında canonical ve function-only authority olarak kuruluyor. Klaviyo tek Connected Account taşır; Reporting Store kontrolü yoktur. Analist tasarımı `docs/EO_03C_CONNECTION_ACCOUNT_AUTHORITY.md`, executable contract `contracts/eo-03c-connection-account-authority-v1.json` içindedir.
- **EO-03-D — Not started:** EO-03-C kabul edilmeden başlamaz.
- EO-04 ve sonraki parent'lar paralel başlatılmaz.

## 9 Ekim 2026 — Kurulu Shopify mağazası otoritesi

EO-02-B/EO-02-C düzeltmesiyle workspace, billing, organic commerce verisi ve Dataset V2 scope'u uygulamanın kurulu olduğu doğrulanmış Shopify mağazasına kilitlendi. Reporting Account seçimi downstream'dir; kurulu mağazayı değiştiremez. Belirsiz veya başka mağazaya ait provider entity'leri Dataset V2 yazamaz ve SnapshotJob alamaz. İkinci Shopify mağazası ayrı installation, workspace ve subscription gerektirir. Bağlayıcı contract: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.
