## 29 Ekim 2026 — 02 tamamlandı: eski PR #179 uzlaştırması

01–03 grubunun güncel durumu: **Kod/testler hazır; gerçek ortam doğrulaması bekliyor.** 02’nin önceki PR #183 teslimine ek olarak açık kalan PR #179, main d55c8c59eef3681ce963eca49c21f2f26506eb21 ile dosya bazında karşılaştırıldı ve 29 Ekim 2026’da birleştirilmeden kapatıldı. Eski branch ve ffc51bdf6ebd46f9e79b07bb186fb2da82884044 head commit’i korunur. Değişen 24 dosyanın tümü ve güncel 32 karşılık dosyasının uzak blobları birebir doğrulandı. Ayrıntı: docs/evidence/EO_05_STEP02_PR179_RECONCILIATION_2026-10-29.json.

Google/Meta okuyucuları, Shopify parent/adayı ve Klaviyo native aday akışları sonraki onaylı main teslimlerinde yeniden uygulanmıştır. Eski provider_link_verified=true kabulü ve optional Klaviyo reporting loader yolu güncel sözleşmeye taşınmaz; ayrı sınırlı aday akışı ve false provider-link/persistence sınırı korunur. Kaynak biçimi veya aday doğrulaması canlı provider rapor bağının kanıtı sayılmaz.

04–06’nın çalışan PD/canonical bağlantıları teknik olarak açıktır; 07–10’un gerçek izin ve kaynak kimliği kanıtları açıktır. 15 kalıcı saklama başlamadı; roller 16–20, PMax kanıtı 21, duraklatılan tarihsel PMax 22 ve genel Dataset/FX yazımı 23 yerinde kalır. 14 birlikte değerlendirmedir. Bu teslim yalnız plan, sözleşme ve karşılaştırma kanıtıdır; runtime/provider/DB değişikliği yoktur. Tarihsel open/önceki checkpoint kayıtları geçmişi korur; güncel otorite contracts/eo-05-start-brief-v1.json#step02_PR179_reconciliation_2026_10_29 kaydıdır.

Resmî GitHub PR state kontrolü 2026-10-29: https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request.

## 29 Ekim 2026 — 12. maddeden kalan açık sipariş rezervasyonu uzlaştırması

PR #252 main'dedir (63282f8cf77af30d3e4dac8429a81e8f085ee379). Bu ikinci kod işi, önceki 12. maddeden kalan açık uzlaştırmadır; 14 yeni kodlama maddesi değildir. Bu teslimin kod/izole test kabulünden sonra yeni kodlamaya devam edilmez. Gerçek ortam kanıtlarının durumu ve 01–13'te yapılan/eksik/bekleyen işler birlikte 14'te değerlendirilir. 15 ayrı kararla başlar; genel Dataset yazımı 23'tedir. 16–22 arasında her geçişte durulur.

Mevcut özel work reservation tablosuna kalıcı Partner gönderim sayacı ve son uzlaştırma audit alanları eklenir; yeni kaynak/fact/evidence tablosu yoktur. Sayacın anlamı fiziksel HTTP gönderildi kanıtı değil, HTTP öncesi SQL gönderim işaretidir. Phase stopped olsa da sayaç kalır. Migration eski pre_request/intent kayıtlarında 0, dispatched/observed/receipt kayıtlarında 1 yazar. Eski stopped kayıtta önceki gönderim kanıtı kayıpsa null korunur; reason metni, saat/süre veya kaydın görünmemesi sıfır gönderim/rollback kanıtı sayılmaz.

Yeni createShopifyOrderReconciliation yalnız özel coordinator DB'siyle çalışır. Açık attempt ID incelemesi salt okunur gerçek SQL sahibi, scope, fence, phase, sayaç/receipt varlığı ve audit görüntüsünü alır. Yalnız aynı factory'nin genuine tek kullanımlık inspection nesnesi reconcile çağrısına verilebilir. Caller owner/fence/hash/force/terminated/counter veya HTTP callback'i veremez. Snapshot hash SQL'de üretilir. Mutation ortak global kilit ve gerçek rezervasyon row lock sonrasında kilitli güncel satırın hash'ini yeniden hesaplar; eski gözlem hiçbir değişiklik yapamaz.

SQL'nin sabit kararı: hiç outbound gönderim işareti olmayan veya Partner receipt'i SQL'de tamamlanmışken Admin işareti sıfır olan iş, eski callback'ler kesilerek kontrollü bırakılabilir. Legacy belirsiz, receipt'i olmayan Partner gönderimi, Admin prefix'i, gözlenmiş fakat kalıcı saklanmamış collection veya çelişkili metadata tam kapasite ve kurulum single-flight'ını tutar. Reconciled terminal phase mevcut begin/dispatch/apply/observe ve eski release yollarının tamamında geçersizdir. Bu, işletim sistemi sürecinin öldürüldüğü veya bilinmeyen fiziksel isteğin bittiği iddiası değildir. Unknown prefix'e süre doldu diye release/retry/resume yetkisi verilmez. Ham prefix’in elde kaldığı veya geri kazanıldığı iddia edilmez. Kalıcı kaynak saklama veya prefix atma kararı 15 öncesindeki birlikte değerlendirmededir.

Audit mevcut operasyonel satırda önceki phase, sınıflandırma, action ID, tarih, version ve preimage hash'tir; tam geçmiş/ham kaynak deposu olduğu iddia edilmez. Audit, terminal phase, kontrollü kapasite bırakma ve ortak revision tek transaction'dır. Kayıp yanıtta ikinci yazma/otomatik read yapılmaz. Tek kullanımlık nesne tüketilir; ayrı açık inspect kaydedilmiş sonucu gösterebilir. Aynı sonucu yeniden gözlemek mevcut action ID'yi korur ve revision artırmaz. İki yeni RPC yalnız coordinator'a açıktır; private helper ve mevcut table grants genişlemez.

Birim testleri capability/clone/yanlış scope/force girişleri, stale/read/write kaybı, null/zero ve eşzamanlı aynı inspection kullanımını sınar. Mevcut rollback-only F01 14 senaryoda gerçek PostgreSQL/SQL kilitleri, roller, gönderim/receipt, kapasite tutma, geç callback reddi, kayıp ack ve son revision hatasında atomik rollback'i sınar. Partner HTTP yalnız sentetiktir. Canlı migration/role/token/provider/config/cron veya Dataset değişikliği yoktur. Gerçek izin/tarihçe/protected data, kaynak biçimi ve okunabilir iddia, wire body/bellek/bağlantı/query plan ve 2000/4000/24 saat kabulü bu testlerden çıkmaz; 14'te ayrı açık gösterilir.

Resmî kontrol 2026-10-29: [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html), [Shopify response codes](https://shopify.dev/docs/api/usage/response-codes). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_explicit_reconciliation_2026_10_29.

## 29 Ekim 2026 — 12. maddeden kalan dengeli sipariş çalıştırıcısı ve arka plan oturumu

PR #251 main'dedir (e87cd80c4816b55ba8d7727bb6eb26819786c46b). Kullanıcıyla netleştirilen sıra: 14 kodlama maddesi değildir. Önce 01–13'ten kalan iki kod işi tamamlanır; gerçek ortam kanıtları ayrı gösterilir; sonra 14'te birlikte değerlendirilir. 15 ayrı kararla başlar. Genel Dataset yazımı 23'tedir. 16–22 arasında her geçişte değerlendirme yapılır.

Bu teslim 12'nin bağımsız Shopify Order çalıştırıcısını bağlar. Özel coordinator SQL'i en fazla açık maxCandidates kadar aday workspace inceler; workspace başına en eski uygun aralığı seçer. Önceki rezervasyonların ve aday incelemelerinin kalıcı ortak fence sırası hizmet yaşını belirler; released kayıtlar da yaşı korur. Reddedilen adayın inceleme yaşı mevcut pending tablosunda tutulur; tek aday sınırında bozuk/eski profil sağlıklı mağazayı sürekli sıradan düşüremez. SQL seçim sorgusunun gerçek yük/plan kabulü ayrıca ölçülecektir. Aynı ortak global kilit altında mevcut kapasite ve kurulum single-flight kontrolleri tekrar çalışır. Bir batch aynı workspace'i ikinci kez seçmez. Yeni operasyonel/fact tablo veya etkin politika eklenmedi.

Açık başlatılan dedicated SDK host, gerçek SQL rezervasyonunu taze Partner entitlement ve mevcut Admin okuyucusuna bağlar. Mevcut şifreli offline SessionStorage yalnız okur; sessionDatabase runtime rolü, iş database'i coordinator rolü olarak ayrı açık bağımlılıklardır. Kimlik SQL kuyruk sahibinden gelir. Exact offline kimliği, mağaza, expiry ve özel fingerprint; sorgu ve fiziksel HTTP öncesi/sonrasında tekrar kontrol edilir. Public shopifyApi Graphql istemcisi retries=0 ile mevcut genuine kota köprüsünden gider. Otomatik token refresh/exchange, ikinci istek veya başka mağaza fallback'i yoktur. Geç/iptal edilmiş entitlement snapshot uygulanamaz. İlk provider/belirsiz hata bütün batch'i durdurur. Native token/session içeriği veya fingerprint çıktıya/loga verilmez.

Ortak ayar doğrulaması side-effect-free modüle taşındı; web runtime'ının mevcut exports ve ayar kuralları korunur. Arka plan import'u web adapter/bootstrap veya global hook kurmaz. Explicit initialize, mevcut node adapter ve mevcut singleton köprü kapısına bağlıdır. runBatch yalnız açık limitlerle sınırlı tek çalışmadır; route, timer, cron, canlı deploy/config/role değişikliği yoktur. SQL migration repository pending kalır.

Actual SDK + şifreli session + sentetik HTTP testleri izin/owner/session/expiry/rotation, abort, deadline, tek batch ve ilk hata sınırlarını kontrol eder. Mevcut rollback-only F01 iki gerçek PostgreSQL tekrarında iki workspace için hizmet yaşı, eski aralık, shared capacity, single-flight ve ACL kontrolünü ekler. Gerçek mağaza/token/kapasite kabulü değildir. Başarılı okuma hâlâ yalnız in-process collection; rezervasyon kalıcı kanıt/checkpoint yazılmış gibi bırakılmaz. Order/LineItem/ham kanıt/kimlik eşleme writer'ı veya Dataset yazımı eklenmedi.

Sıradaki mevcut kod işi yarım/belirsiz rezervasyon uzlaştırmasıdır. Ardından gerçek izin/tarihçe/protected-data, ölçülen wire body/bellek/bağlantı/kapasite ve kaynak kanıtlarının durumu çıkarılıp 01–13'ün birlikte değerlendirmesinde durulur. 15 başlamadı; PMax duraklaması ve 26 sıra korunur. Resmî kontrol 2026-10-29: [Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens), [Graphql SDK](https://raw.githubusercontent.com/Shopify/shopify-app-js/main/packages/apps/shopify-api/docs/reference/clients/Graphql.md), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html), [Supabase functions](https://supabase.com/docs/guides/database/functions). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_background_dispatch_2026_10_29.

## 28 Ekim 2026 — Bağımsız sipariş rezervasyonuna bağlı Admin okuyucusu

PR250 (bb08b735948243541dce2dd6cb3de4b3f74f231c) main’dedir. 14 değerlendirmesindeki createIndependentShopifyOrderReader, aynı genuine entitlement checker’ın taze verification nesnesini bir kez tüketir. Eski reklam provider/account/job veya iş günü kimliği kullanılmaz. Kaynak gerçek kurulum/mağaza/aralık/attempt/fence’tir. Caller range/history/receipt/fence/checkCurrent/database/resolver/cursor giremez. İki hazırlanmış okuyucu aynı verification’ı iki kez tüketemez.

Mevcut SDK wrapOrders köprüsü, ortak puan kotası, scope sorgusu, Order/LineItem/journey protokolü, sayfalama ve tutarlılık gözlemi aynen kullanılır. Her boundary’de source epoch/fence/owner/billing source hash ve pinlenmiş Admin bağlamı SQL’den tekrar okunur. Kota öncesi/sonrası bağ kontrolü, fiziksel fetch öncesi atomik SQL gönderim işareti vardır. Başka mağazanın native hedefi veya değiştirilmiş kurulum PK’sı yeni istek açamaz. Yeni coordinator owner RPC’si yalnız scoped observation verir; mevcut runtime-only owner fonksiyonunun EXECUTE yetkisi genişletilmez.

CLI migration 20261028220207_eo05a_shopify_order_admin_read.sql yalnız mevcut operasyonel rezervasyona order_intent/order_reading/order_observed fazları, explicit caps/deadline, gönderim sayacı ve nonsecret istatistik/stop metadata’sı ekler. Yeni Order/LineItem/Dataset tablosu veya veri yazarı yoktur. Beş collection cap açık girdidir; pageSize gerçek plandaki değerle eşleşir, rows/bytes SQL rezervasyonunu aşamaz. Aktif request slotu ile toplam sıralı istek sayısı ayrı kalır. maxRequests sayacı SQL’de de sınırlıdır. Deadline hem taze entitlement sınırı hem explicit elapsed cap ile daraltılır; SDK ve collection süreleri buna göre kısılır.

Başarılı okumada gerçek in-process collection korunur; SQL yalnız sayı/byte/request istatistiğini ve gözlem fazını kaydeder. Stat sayaçları gönderim marker’larıyla eşleşir; native yanıtlar, Order/LineItem/journey verisi saklanmaz. Son kayıt/fence/deadline belirsizse collection yayımlanmaz. İlk Admin isteği öncesi genuine quota wait ve SQL sıfır gönderim sayacı kontrollü release sağlar; kısmi okuma, gönderim teyidi kaybı veya bilinmeyen native/handoff sonucu kapasite ve single-flight’ı tutar. Otomatik retry/resume/ilk sayfa replay yoktur. completed job/durable checkpoint/fact write ilan edilmez.

Native currentAppInstallation izinleri okuma öncesi/sonrası gözlenir; read_all_orders ve tarihçe gate’i korunur. Scope listesi gözlenmesi canlı erişim/protected-data onayı değildir. NativePermissionVerified/historicalCoverage/providerClaim/overlap ve write/activation/resume flag’leri önceki sınırlarında kalır. SDK başlangıcı/global hook veya yeni session/token loader runtime’a eklenmez; trusted mevcut server Admin istemcisi ve genuine kurulmuş köprü gerekir.

Birim testleri actual SDK fixture ile veri/izin/sayfa/tutarlılık, limit/clock/timeout/geç yanıt, quota prefix, owner değişimi, kopya receipt ve kayıp SQL cevaplarını sınar. Mevcut gerçek F01 fixture’ında gerçek SQL+kota+SDK ve sentetik HTTP birlikte çalışır; başarı, ilk/prefix wait, sonraki billing denial, native unknown, dispatch/handoff yanıt kaybı ve geç metadata hatası kontrol edilir. Fixture hook/profil/limit değişiklikleri geri alınır; native canlı kabul değildir.

workerAdmitted/dispatch/activation/checkpoint/persistable/Dataset-write ve resume/reloadFirstPage false’tur. Sıradaki mevcut işler bounded adil dispatcher ve dedicated background SDK/session composition; unknown/partial için açık reconciliation; native izin/tarihçe/protected data ve ölçülmüş wire body/connection/kapasite kabulü; 15 sonrasındaki durable kanıt+atomik checkpoint’tir. 26 sıra/PMax duraklaması korunur; 12/14 tamamlanmadı. Resmî kontrol 2026-10-28: [Orders](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders), [Order access](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_independent_Admin_reader_2026_10_28.

## 28 Ekim 2026 — Bağımsız Shopify sipariş rezervasyonuna bağlı taze abonelik ve istek niyeti

PR249 (40da3e394be9e4341dc6ce021e6ef974925fcbf5) main’dedir. 14 değerlendirmesinde, yeni createShopifyOrderEntitlementCheck gerçek aynı-factory Order rezervasyonunu bir kez tüketir. Eski reklam provider/account/job kimliği kullanılmaz. Caller receipt/fence/database/guard/resolver/Partner client seçemez; mevcut sunucu Partner yapılandırması ve 2026-07 activeSubscription sorgusu sabittir.

CLI migration 20261028212220_eo05a_shopify_order_entitlement_intent.sql mevcut rezervasyon tablosuna phase/intent/receipt/stop metadata’sı ekler; yeni Order/LineItem/Dataset/billing tablosu yoktur. SQL, gerçek kurulum/workspace/nesil/Shop GID/domain/aralık/attempt/fence, queue version/epoch, worker policy ve beş reviewed route’u tekrar denetler. Niyet kaydı ile fiziksel gönderim öncesi kayıt ayrıdır. Kota kontrolü öncesi entitlement_intent, fiziksel fetch öncesi entitlement_dispatched yazılır. HTTP boyunca SQL transaction tutulmaz.

Eski release fonksiyonu yalnız pre_request aşamasında çalışır; eski implementation private kalır. Gönderim işaretinden sonra not_dispatched gerekçesi kapasite bırakamaz. Yalnız henüz gönderim işareti yokken doğrulanmış kota/deadline durması veya başarıyla yazılmış abonelik reddi kontrollü stop ile bırakılır. Gönderilmiş/belirsiz sonuç veya belirsiz yazım kapasite ve single-flight’ı tutar. Otomatik retry/read/release/ilk sayfa replay yoktur.

Partner bağlamı SQL’den kota rezervasyonundan önce ve sonra yeniden okunur, ilk bağlama pinlenir. Mevcut ortak kota deposu ve native Partner istemcisi kullanılır; çift debit yoktur. Her rezervasyon yalnız bir activeSubscription sorgusu yapar; eski aktif cache fallback değildir. Mevcut pricing normalizer aynı mağaza için yanıtı doğrular. Existing billing projection ve exact work receipt tek SQL transaction’dadır. Receipt SQL intent timestamp/source hash’e ve aynı attempt/fence’e bağlıdır; sonradan gelen ret veya projection değişimi geçersiz kılar. Genel billing apply ya da generic ad admission yetkisi coordinator’a açılmaz.

Deadline/request timeout/finish reserve açık girdidir. Timeout’ta abort advisory’dir; geç gelen payload snapshot yazamaz. Final SQL kontrolü sırasında deadline geçerse verified sonuç verilmez. Başarılı abonelik sonucu genuine in-process verification olarak kalır; clone/JSON isCurrent veya eski release yetkisi değildir. workerAdmitted/dispatch/activation/checkpoint/persistable/Dataset-write false kalır; Admin Order okuması ve aktif scheduler açılmaz.

Birim testleri ve mevcut rollback-only F01 fixture’ı gerçek SQL/kota/billing ile sentetik HTTP yanıtlarını kullanır. Başarılı sorgu, trial/ret, kota bekleme, owner değişimi, intent/apply yanıt kaybı, gönderim sonrası yanlış not_sent, son receipt hatasında billing rollback ve private RPC sınırları sınanır. Native hesap/izin/kapasite kabulü değildir. Mevcut 15 saklama kapısı, 26 sıra, PMax duraklaması korunur; 12/14 tamamlanmadı. Sonraki mevcut işler Admin Order okuyucusunun gerçek taze receipt/fence’e bağlanması, bounded adil dispatcher, bilinmeyen stop için açık reconciliation ve 15 sonrası durable kanıt/checkpoint’tir.

Resmî kontrol 2026-10-28: [Shopify activeSubscription](https://shopify.dev/docs/api/partner/2026-07/queries/activeSubscription), [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_entitlement_intent_2026_10_28.

## 28 Ekim 2026 — Bağımsız Shopify sipariş işi için ortak kapasite rezervasyonu

PR248 (d32a4c8b7209ad3378eaea8e9e72cafc962bbd87) main’dedir. Mevcut 14 değerlendirmesinde, kurulum/aralık sahipli kuyruk ortak worker kapasitesine bağlanır. Yeni createShopifyOrderWorkReservations yalnız gerçek in-process aralık planıyla özel SQL’e gider; provider/account/cost/fence/attempt/deadline/entitlement caller girdisi kabul etmez. Reklam sağlayıcı kümesi Meta/Google Ads/Klaviyo olarak kalır.

CLI migration 20261028204502_eo05a_shopify_order_worker_reservation.sql, mevcut queue control’e ayrı worker_enabled=false, worker_cost=null ve worker_epoch=1 ekler. Yeni özel operasyonel rezervasyon tablosu yalnız sahip/aralık/attempt/fence/cost/epoch metadata’sı tutar. Order/LineItem/kanıt/checkpoint veya Dataset tablosu değildir. Native limit/policy etkinleştirilmez; beş kaynak miktarı açık SQL politikasıyla ölçülüp onaylanmadan rezervasyon yapılmaz.

Sipariş ve reklam işleri aynı refresh_control satır kilidini, revision ve next_fence sayacını kullanır. Global/workspace requests/dbWrites/connections/rows/bytes ile birleşik maxClaims kapasitesine iki yönde bakılır; interaktif pay korunur. SQL’de ad kabul wrapper’ı gerçek sipariş rezervasyonlarını tekrar sayar; caller externalClaims’i silerek boşluk yaratamaz. JS planlayıcı state.externalClaims içinde yalnız kaynak shopify_orders olan kurulum rezervasyonlarını sayar; provider/account uydurmaz. Sipariş başlatmada aktif gerçek owner, queued aralık/version/queue epoch, mevcut Admin/Partner context ve beş reviewed profil yeniden okunur. Kurulum başına tek rezervasyon; insert ve ortak sayaç artışı tek transaction’dır.

Kapasite doluysa budget_full; eksik/bozuk kapasite budget_unknown olur. Belirsiz reserve/release sonucu needs_attention olarak kalır; otomatik retry/read/release ya da zaman aşımıyla kapasite boşaltma yoktur. Ayrı scoped read yalnız gözlemdir; not_observed rollback kanıtı, okunan/clone edilmiş nesne release yetkisi değildir. releaseBeforeRequest yalnız aynı factory’nin gerçek tek kullanımlık handle’ı ve SQL attempt/fence ile çalışır. Eski veya aynı anda yinelenen handle yeni rezervasyonu bırakamaz.

Bu teslim HTTP öncesi slot rezervasyonudur. workerAdmitted/dispatch/activation/entitlementVerified/quotaReserved/checkpoint/persistable/Dataset-write false kalır. HTTP/intent/entitlement callback’i, native worker veya scheduler girişi yoktur. Sonraki request-intent uygulaması intent sonrası bu pre-HTTP release yolunu kapatmak zorundadır. Fresh native Partner entitlement, bağımsız intent/fence/stop kontrolü, Admin SDK Order bağlantısı ve bounded adil dispatcher açıktır. Durable kanıt/checkpoint mevcut 15 saklama incelemesinden sonradır. 12/14 tam kapanmadı; 26 sıra/PMax duraklaması korunur.

Birim ve gerçek F01 SQL senaryoları iki yönlü global/workspace kapasitesini, interaktif payı, source/context değişimini, single-flight, ortak fence/revision, eski fence reddi, belirsiz yanıt sonrası açık gözlemi ve son sayaç hatasında reserve/release rollback’ini sınar. Yeni tablo forced RLS; üç RPC yalnız coordinator; eski SQL wrapper bypass’ları/helper’lar kapalıdır. Canlı apply/provider/token/config/cron/Dataset değişikliği yoktur. Resmî kontrol 2026-10-28: [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html), [JSON](https://www.postgresql.org/docs/17/functions-json.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_work_reservation_2026_10_28.

## 28 Ekim 2026 — Bağımsız Shopify sipariş kuyruğunda bekleyen aralık kaydı

PR247 (fab49fca164a2a63dfc36f92762f0abd6c6f4143) main’dedir. 14 değerlendirmesi altında, 12’den kalan bağımsız Order scheduling işinin kuyruk metadata parçası hazırlanır. Gerçek in-process aralık planı, özel SQL’de aktif kurulum PK/workspace/nesil/Shop GID/domain ve aktif workspace ile tekrar doğrulanır. Reklam sağlayıcısı/hesabı/bağlantısı sahip olarak kullanılmaz. Caller aralık/cursor/fence/entitlement/revision giremez.

CLI migration 20261028201729_eo05a_shopify_order_pending_queue.sql iki özel operasyonel tablo kurar: kontrol singleton’ı ve bekleyen zaman aralıkları. Bunlar Order/LineItem, satış kanıtı veya beşli Dataset tablosu değildir; 15’in durable saklama kapısını açmaz. Kontrol varsayılan kapalı, limitler boştur; yeni native profil/limit/kaynak politikası etkinleştirilmez.

Mevcut özel Admin/Partner bağlamları ve beş gözden geçirilmiş route gerekir: partner_graphql, permission_scopes, order_headers, order_lines, order_journey. SQL, aralık ve route hash’lerini yeniden hesaplar; gerçek owner/configuration epoch/context/profil fingerprint/revision ve global+kurulum başına pending limitleri tek kontrol satırı kilidi altında doğrulanır. Insert ve revision artışı atomiktir. Aynı key/gövde zaten kayıtlı metadata döner, değiştirilmiş gövde veya bekleyen aralıkla çakışma reddedilir. API kota rezervasyonu/debit’i veya ortak worker kapasitesi tüketilmez. Kuyruğa kaydolmak çalışma, dispatch ya da fresh entitlement kanıtı değildir.

Yanıt kaybında needs_attention/queue_write_unconfirmed döner; otomatik retry/delete/read yoktur. Ayrı scoped read yalnız bekleyen metadata’yı gözler. not_observed rollback kanıtı değildir; cancelled kaydı otomatik canlandırmaz. Üç RPC yalnız coordinator’a açıktır; tablo/helper yetkileri runtime/browser/service rolüne açılmaz, iki tabloda forced RLS vardır. Test rol üyeliği yalnız mevcut izole F01 savepoint içinde açılıp tam geri alınır.

Birim testleri ve mevcut gerçek PostgreSQL F01 fixture’ı owner/route/key/CAS/idempotency/çakışma/limit, yanıt kaybı sonrası açık okuma, son aşama hatasında atomik rollback ve özel yetkileri doğrular. Native HTTP veya canlı apply/provider/config/token/Dataset mutasyonu yoktur. WorkerAdmitted/quotaReserved/dispatch/activation/checkpoint/persistable/Dataset-write false kalır. Bağımsız worker fence+ortak global worker kapasitesi+fresh entitlement+native Admin/Partner yürütümü, aktif scheduler ve 15 sonrasındaki durable kanıt/checkpoint işleri açıktır. Tam 12/14 kapanışı değildir; 26 sıra ve PMax duraklaması korunur.

Resmî kontrol 2026-10-28: [Supabase functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [SHA256](https://www.postgresql.org/docs/17/functions-binarystring.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_pending_queue_2026_10_28.

## 28 Ekim 2026 — Bağımsız Shopify sipariş aralığı planı ve kesinti sınırı

PR246 (0bf1869a58c96f583e7a6f684519c063e3ff69c0) main’dedir. 12’den kalan bağımsız Order scheduling/continuation işinin ilk parçası hazırlanıyor. createShopifyOrderRangePlanner yalnız exact kurulum sahibi + mevcut özel SQL okumasıyla aralık önerisi üretir. Provider/Ads hesabı/iş günü veya provider job fence girdi değildir. Tüm zamanlama politikası açık girdidir: anchor, cadence, slice, settle delay, maxRanges, pageSize, includeOrderHistory; mağaza için sıklık, tarih veya lookback varsayımı kurulmaz. fromInclusive açık sunucu girdisidir, doğrulanmış durable checkpoint değildir.

Saat politikasına göre kapanmış üst sınır altında yarı açık UTC updated_at aralıkları, mevcut Shopify Orders sorgu protokolüyle üretilir. Aralıklar bitişik/çakışmasız, plan başına en fazla 1000’dir; sığmayan kalan aralık saklanır fakat ilerleme sayılmaz. Deterministik iş anahtarı gerçek kurulum/mağaza/API/erişim modu/aralığa bağlıdır. Reklam sağlayıcısının kopması anahtarı değiştirmez. Başlangıç/bitiş SQL sahibi tekrar okunur; kimlik değişirse/iptal/SQL hatasında sonuç atılır. not_due sıfır satış veya başarılı sync değildir. updated_at filtresi, createdAt bazlı erişim kapsamı ya da geçmiş erişim onayı değildir.

reviewShopifyOrderRangeInterruption yalnız gerçek in-process plan + collection veya quota control kimliklerini tanır. İlk fiziksel veri denemesinden önceki quota wait yeni admission ister; önceki HTTP prefix’i veya belirsiz sonuç durable inceleme ister. Tam collection dahi kalıcı saklandı sayılmaz. Caller cursor/checkpoint/persisted:true veya JSON clone ile devam yetkisi üretilemez. resumeAuthorized, reloadFirstPageAuthorized, checkpointAdvanced, queueAdmitted, dispatch, persistable ve Dataset-write false’tur.

Bu teslim aktif bağımsız scheduler veya durable continuation DEĞİLDİR. Sonraki mevcut alt işler: kurulum sahipli bağımsız work admission/scheduler ve ayrı Admin/Partner kota bağları; mevcut 15 saklama incelemesi sonrasında kalıcı staged kanıt + atomik checkpoint anlaşması; native sipariş/geçmiş/protected-data ve kapasite kabulü. Yeni tablo/migration/cron/route/SQL write veya provider/config/token/Dataset mutasyonu yok. 14 değerlendirmesi içindeyiz; 26 sıra, 13/15 değerlendirmeleri ve PMax duraklaması korunur. Resmî kontrol 2026-10-28: [Orders updated_at](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders), [Shopify pagination](https://shopify.dev/docs/api/usage/pagination-graphql), [PostgreSQL STABLE](https://www.postgresql.org/docs/17/xfunc-volatility.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Shopify_order_independent_range_plan_2026_10_28.

## 28 Ekim 2026 — Gerçek kurulum / hesap seçimi kimliklerinin prewrite ve Shopify Order sahibine bağlanması

PR245 (a14459b2bcfb9825cd78e7ab149dc7f8775c2e91) main’dedir. Provider prewrite beklenen kapsamı artık installationId ve reportingSelectionEpoch dahil exact 10 alandır; üç sağlayıcıda SQL’den gelen kayıpsız kurulum PK’sı ve Ads seçim bağ kaydı PK’sı, tamamlanmış in-process observation provenance ile birlikte karşılaştırılır. Klaviyo seçim epoch’u null kalır. Caller clone/spread/trust flag ile observation üretilemez. Referans, Order/Message ve provider-claim yapısal kontrolleri aynı kapsama taşındı; mevcut source-rule kayıt formatı ayrı kalır.

Shopify Order sahibi provider hesabından bağımsızdır. CLI migration 20261028185046_eo05a_shopify_installation_owner_read.sql yalnız yeni özel STABLE SQL SELECT fonksiyonudur; tablo/satır yok. Workspace/nesil/Shop GID/domain/active birebir eşleşir, gerçek installation PK text döner. EXECUTE yalnız runtime; diğer uygulama rolleri ve direkt tablo yetkileri açılmaz. Sipariş collection factory database bağımlılığını zorunlu tutar; ilk HTTP öncesinde ve mevcut boundary kontrollerinde SQL sahibi tekrar okunur, PK execution boyunca sabitlenir. Elle PK override/fallback yoktur.

Shopify prewrite exact 5 alanlı installationId sahibi ister; current/previous observation aynı kurulum PK’sına ait olmalıdır. Mevcut mantıksal Order/LineItem anahtarları korunur; job/provider/window bunlara eklenmez. Sonradan eklenen async Current kontrolleri provider candidate/reference veya Shopify order incelemesinden sonra tek yeni SQL metadata okuması yapar. PK, credential sürümü, account veya aynı-hesap-away/back seçim epoch’u değiştiyse reddedilir. İptal ve SQL hatası retry/native HTTP/vault okuması yapmaz, güvenli hata döndürür.

Bunlar kimlik metadata kontrolleridir: canonicalScopeReady, persistable, nativePermissionVerified, provider claim/overlap ve activation false kalır. Son metadata okuması gelecekteki writer ile atomik değildir; güncel fenced work/entitlement ve atomik writer kontrolü ayrıca zorunludur. Bağımsız Order scheduling/continuation, native kaynak/namespace/izin/claim/profil ve mevcut 14 incelemesi / 15 storage kapıları açık kalır. Canlı apply/OAuth/provider/token/config/Dataset mutasyonu yoktur. 26 sıra, 13/15 değerlendirmeleri ve PMax duraklaması korunur. Resmî kontrol 2026-10-28: [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL STABLE](https://www.postgresql.org/docs/17/xfunc-volatility.html), [Shopify Shop kimliği](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Shop). Makine kaydı: contracts/eo-05-start-brief-v1.json#Canonical_prewrite_owner_binding_2026_10_28.

## 28 Ekim 2026 — Google identity token yenilemesi: atomik yazım ve sonuç okuma

PR244 (2074158e01b3017a8a40d486f5c97b759a62230a) main’dedir. Callback CAS sonrasında açık kalan Google refresh-renew yazımı hazırlanıyor. CLI migration 20261028175738_eo05a_google_identity_renewal_receipt.sql mevcut yaşam döngüsü event tablosuna iki nonsecret eski/yeni credential UUID alanı ekler. Yeni tablo veya veri yoktur. UUID alanlarında envelope FK yoktur; sonraki credential retirement geçmiş kanıtı engellemez.

Aktif gerçek kurulum ve bağlı Google bağlantısı kilitlenir. Beklenen connection ID, sürüm ve eski credential eşleşmesi ile mevcut scope kapsamını koruma zorunludur. Şifreli yeni envelope insert, mevcut renew fonksiyonunun CAS/credential_renewed event/eskisini silme işlemi ve sonuç alanları aynı SQL transaction’dadır. Yeni işlem kimliği tekrar kullanılarak mutation tekrarlanamaz. Eski raporlama OAuth, Meta, Klaviyo ve varsayılan kapalı identity server switch değişmez.

Yazım yanıtı kaybolur veya sonuç bozuksa GOOGLE_IDENTITY_RENEWAL_WRITE_UNCONFIRMED ve nonsecret renewalId döner; Ads okuması/seçim yazımı, silme, retry veya otomatik receipt sorgusu yoktur. readGoogleIdentityRenewal açık salt-okuma kontrolüdür. Yalnız geçmiş commit kanıtı döndürür; güncel token veya activation yetkisi değildir. Receipt yokluğu rollback kanıtı/yeniden deneme izni değildir. Token endpoint’in kendi belirsiz/başarısız yanıtı da ilk hatada durur; bu çalışma provider mutation’ını uzlaştırdığını iddia etmez.

Mevcut F01 geçici rol üyeliği ve rollback fixture içinde gerçek SQL + AES-GCM testi: korunmuş seçim, eski envelope emekliliği, daha sonraki yenilemede geçmişin okunması, yanlış owner/nesil, version/credential drift, disconnect, scope downgrade, tekrar event ve son receipt update hatasında tam rollback; commit sonrası yanıt kaybında yalnız açık read kontrolü. Native HTTP/live key yoktur. Yeni fonksiyonlar yalnız mevcut runtime rolüne; direkt tablo/public/refresh coordinator erişimi yoktur.

Canlı apply/provider/token/config/Dataset mutasyonu yok. Tam 12/14 veya native kabul değildir. Sonraki mevcut işler: canonical kurulum/seçim metadata→prewrite ve Shopify Order owner bağı, bağımsız Order scheduling/continuation, native kaynak/claim/profil/izin kanıtları ve sonraki storage/activation kapıları. 26 sıra ve 13/15 değerlendirmeleri ile PMax duraklaması korunur. Resmî kontrol 2026-10-28: [Google refresh](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Supabase functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Google_identity_renewal_receipt_2026_10_28.

## 28 Ekim 2026 — OAuth callback atomik credential / CAS yazımı

PR243 (2927877cde4b56113fb3d83e3a558666824739ec) main’dedir. Mevcut PK/seçim/OAuth grubunun callback yazımı hazırlanıyor. CLI migration 20261028164208_eo05a_identity_oauth_atomic_stage.sql mevcut OAuth transaction tablosuna dört nonsecret sonuç alanı ekler; yeni kimlik/Dataset tablosu açmaz. Gerçek aktif kurulum ve claimed transaction kilidi altında beklenen bağlantı ID/sürümü veya doğrulanmış yokluk kontrol edilir. Şifreli credential insert, bağlantı CAS, receipt ve exchanged durumu tek SQL transaction’dadır. Hata tümünü geri alır.

Bağlı Google/Meta hesabı için native discovery’nin önceden bağlanmış hesapların tamamını doğrulaması ve granted scope listesinin gerilememesi gerekir; mevcut reporting seçimi ve cached hesaplar korunur. Disconnect canlandırılmaz. İlk/pending/reauthorization kurulumu mevcut seçim akışına kalır. Mevcut identity server switch varsayılan false; raporlama OAuth ve Klaviyo kapsamı değişmez.

Yanıt belirsiz kaldığında yeni credential silinmez, failed finalize veya ikinci mutation yapılmaz. readIdentityOAuthCommit ayrı açık salt-okuma kontrolüdür: receipt yalnız geçmiş commit kanıtıdır; güncel token yetkisi/aktivasyon değildir. Receipt yokluğu rollback kanıtı veya yeniden deneme izni değildir. Mevcut Google refresh-renew belirsiz yazım uzlaştırması bu callback tesliminden ayrıdır ve sonraki parçada açık kalır.

Gerçek SQL/şifreleme probe’u mevcut F01 rollback fixture içinde; native HTTP yok. Yeni migration canlıya uygulanmaz. Canonical metadata→prewrite/Shopify Order bağı, native kaynak/izin/profil kanıtları, bağımsız Order scheduling/continuation, storage ve activation sonraki kapılardır. Mevcut 26 sıra, 13/15 değerlendirmeleri ve PMax duraklaması değişmez. Tam 12/14 veya canlı kabul değildir. Resmî kontrol 2026-10-28: [Supabase functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [isolation](https://www.postgresql.org/docs/17/transaction-iso.html). Makine kaydı: contracts/eo-05-start-brief-v1.json#Identity_oauth_atomic_stage_2026_10_28.

# AdsTable Embedded — Execution Plan (Yürütme Planı)

## Mevcut 14 değerlendirmesi — Gerçek kurulum PK ve seçim sürümünün atomik SQL okuması, 28 Ekim 2026

#242 `310829272b4d45d7cd7b07ca004d9c87e248d3b7` main’dedir. Kurulum kimliği, seçim sürümü ve OAuth CAS üçlüsünün okuma parçası hazırlandı; OAuth callback/write CAS sonraki parçadır. CLI migration `20261028161123_eo05a_identity_authority_snapshot.sql` yeni tablo/satır oluşturmadan tek STABLE SQL SELECT ile aktif shop/workspace/kurulum nesli, aynı bağlı provider bağlantısı/credential sürümü, cached hesaplar ve aktif reporting binding kaydını bir arada okur. Dönen installation_id gerçek shopify.installations PK’sı; reporting_selection_epoch gerçek aktif reporting_account_bindings PK’sıdır. İkisi de kayıpsız pozitif int64 decimal string’dir. Klaviyo’da seçim bağ kaydı olmadığı için epoch null kalır; sayaç uydurulmaz.

Yeni function-only repository ve mevcut identity loader üç ayrı SQL okuması yerine credential vault öncesi ve sonrası birer tutarlı snapshot okur. Verified shop GID/domain/workspace/nesil/provider şarttır; caller PK/epoch veremez. Snapshot değişirse sonuç atılır ve loader kalıcı kapanır. Aynı hesaptan çıkıp geri dönüldüğünde binding PK’sı değiştiği için artık yakalanır. Credential sürümü, izin listesi, kurulum PK veya hesap değişimi de aynı karşılaştırmadadır. Bir SQL okumasının atomic olması vault/native HTTP boyunca transaction veya bütün sürümsüz ara değişimleri görme garantisi değildir; mevcut quota/fence dispatch ve son kontrol sınırları korunur.

Google, Meta ve Klaviyo gözlemleri gerçek SQL kurulum kimliği ve seçim sürümünü metadata olarak taşır. canonical_scope_ready, persistable, aktivasyon ve mapping-write false kalır; source kuralı/native format, Product ID eşleme, rol veya sipariş claim kanıtı üretilmez. Candidate/prewrite ve Shopify Order canonical-owner bağlantısının yazım öncesi tamamlanması ayrı kalır. Mevcut connected OAuth identity upgrade kapısı hâlâ kapalıdır; bu teslim token değiştirmez veya callback CAS tamamlandı demez.

14 yeni senaryo; aynı hesapta epoch/PK değişimi, vault sırasında değişim, bigint hassasiyeti ve geçersiz anahtarları sınar. Dört mevcut somut provider fixture’ı tek SQL snapshot’a uyarlandı; eski negative guard’lar korunur. Gerçek SQL probe mevcut F01 rollback-only matriste üç provider’ın gerçek loader’ını sentetik vault ile çalıştırır; asıl SQL PK/epoch, away-back, credential sürümü/lifecycle drift ve erişim yetkilerini doğrular. Native HTTP yoktur ve fixture değişiklikleri rollback edilir. Yeni read fonksiyonu yalnız mevcut runtime/coordinator rollerine açıktır; table/vault/public erişimi genişletilmez ve hesap adları döndürülmez.

Mevcut 26 sıra, 13 sonrası kısa / 15 sonrası ana değerlendirme ve PMax duraklaması korunur. Canlı migration, OAuth/provider/token/config/Dataset mutasyonu yoktur. Tam 11/12/14 veya native kabul değildir. Sonraki kod parçası OAuth atomik upgrade/CAS/staging reconciliation; bağımsız Order scheduling/continuation, native kaynak/claim/profil ve sonraki yazım kapıları açıktır.

14 yeni + 1.844 mevcut ilgili test (1.858 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Gerçek SQL kanıtı exact-head PR/F01 üzerinde ayrıca doğrulanacaktır.

Resmî kontrol 28 Ekim 2026: [Supabase fonksiyonlar](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL STABLE snapshot](https://www.postgresql.org/docs/17/xfunc-volatility.html), [kilitleme](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Identity_authority_snapshot_2026_10_28`.


## Mevcut 14 değerlendirmesi — Merchant kota kapsamının SQL bağlantısı, 28 Ekim 2026

#241 `da5378f633fc5262e578cab98ed6792f00c21c87` main’dedir. Mevcut 12 düzeltmelerinde, owner-reviewed Merchant envanterinin SQL okuması hazırlandı. CLI migration `20261028152713_eo05a_merchant_quota_context.sql` mevcut private refresh_quota_contexts tablosuna hedef hesap, kotayı tüketen hesap, products/v1 sürümü, Merchant bağ nesli, credential UUID ve varsayılan false Merchant enabled alanını ekler. Yeni tablo, etkin kayıt, native limit, OAuth veya Dataset writer yoktur. Gerçek hedef ve kota hesabı, kimlik doğrulayan hesaba göre ayrı kanıt gerektirir; biri diğerinden türetilmez.

Mevcut load_refresh_quota_context orijinal Ads job/account/window/fence, aktif kurulum, bağlantı ve taze entitlement kontrolünü korur. Ek Merchant nesnesi yalnız aynı workspace/kurulum/Google bağlantısı, güncel bağlantı sürümü, connected durum, exact credential UUID ve mevcut content scope varsa döner. Credential UUID nonsecret referanstır; güncel bağlantının zaten FK ile bağlı credential kimliğiyle karşılaştırılır. Yeni credential FK’si veya vault erişimi eklenmez; eski envelope temizliği engellenmez. Eksik, kapalı veya stale Merchant envanterinde Ads’ın eski yedi alanı korunur. Mevcut Merchant transport ek nesneyi şart koştuğundan Ads profiline fallback yapamaz.

Tam Merchant binding’de yapılan UPDATE; hedef/kota hesabı, credential, bağlantı, enabled, installation/account veya route kapsamı değişince bağ neslinin kesin ilerlemesini ister. Nesil null’a alınamaz veya azaltılamaz. Aynı hedefe geri dönülse de ilerleyen epoch eski route/profile’ın yeniden kullanılmasını engeller. Bu, mevcut kayıt UPDATE korumasıdır; native envanter doğrulaması veya otomatik writer değildir. Hiçbir native method-group limiti, izin kanıtı veya quota-account ilişkisi sentetik fixture’dan üretilmez.

Gerçek SQL sınaması mevcut F01 authority matrisi içinde native readPage zamanlayıcısının dışında çalışır. Gerçek repository/resolver/guard/SQL ve sentetik products HTTP ile kapalı varsayılan, content izni, stale credential/connection, eksik fatura/fence/window, ayrı target/quota/version, değişmeyen Ads route’u, geçersiz field/epoch, away-back, actual SQL rezervasyonu sırasında nesil değişimi ve HTTP öncesi settlement sınanır. Sentetik native link/limit veya Shopify Product ID eşleşmesi doğrulanmış sayılmaz; tüm satırlar rollback edilir ve native HTTP=0 kalır. Forced RLS/ACL korunur; coordinator dışı erişim ve predecessor çağrısı kapalıdır.

Mevcut 26 sıra, 13 sonrası kısa / 15 sonrası ana değerlendirme ve PMax duraklaması korunur. Bu teslim Merchant SQL read bağlantısıdır; native hesap/kota kaynağı ve profil aktivasyonu, canonical kurulum PK/seçim epoch/OAuth CAS, bağımsız Order range/scheduling/continuation, native kaynak/claim ve sonraki yazım kapıları açık kalır. Tam 12/14 veya canlı kabul değildir.

4 yeni + 1.840 mevcut ilgili test (1.844 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Gerçek SQL kanıtı exact-head PR/F01 üzerinde ayrıca doğrulanacaktır.

Resmî kontrol 28 Ekim 2026: [Merchant ürün listesi](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list), [Merchant kota ve hesap hiyerarşisi](https://developers.google.com/merchant/api/guides/quotas-limits/quotas), [Supabase fonksiyonlar](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL trigger](https://www.postgresql.org/docs/17/sql-createtrigger.html). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_Merchant_quota_SQL_2026_10_28`.


## Mevcut 14 değerlendirmesi — Arka plan Shopify SDK açık başlangıcı, 28 Ekim 2026

#240 `baef6e545eae15d4f0dc74cb6499ba9e4db90746` main’dedir. Mevcut 12 düzeltmelerinde arka plan SDK başlangıcı için initializeShopifyAdminRefreshSdk hazırlandı. Modül import’u hook kurmaz; açık çağrı, önceden yüklenen @shopify/shopify-api/adapters/node sonrasında tek gerçek bridge kurar. Aynı hook ile tekrar aynı nesne döner; getter kurulum yapmaz. Eksik adaptör veya yabancı custom hook üzerine yazılmaz. globalThis.fetch değişmez; native fetch fallback, otomatik onarım veya reset yoktur.

Kurulu API15.0.0 ve React Router3.0.1 kaynakları ile resmî kod kontrol edildi. React Router Node adaptörü yalnız runtime string’i ayarlar; fetch bağlantısını API Node adaptörü yapar. İlk yerel testte React Router adaptörünün fetch kurduğu varsayımı başarısız oldu. Test başlangıcı exact API adaptörünü açıkça yükleyecek biçimde düzeltildi ve yalnız React Router adaptörünün yetersiz olduğunu doğrulayan negatif senaryo eklendi. Sürüm veya bağımlılık değiştirilmedi.

Bridge için ortak AbortController eklendi; tek client kapatması diğerlerini kapatmaz. Açık SDK close veya gözlenen hook değişimi bridge’i terminal kapatır; bekleyen bütün client’lar abort alır. Eski fetch geri yüklenmez, tekrar initialize ile açılmaz. SDK hook dışarıdan eski değere alınsa bile kapatılmış bridge canlanmaz. Başka bir bileşenin SDK setter’ını gözlenmeden önce engellediğimiz iddia edilmez; mevcut bound client native çağrıdan önce exact hook kontrolünü sürdürür.

Sınamalar her SDK ömrünü ayrı Node sürecinde açar; pozitif yol test setter’ı yerine uygulamanın gerçek initializer’ını kullanır. Gerçek pinned React Router/API SDK, mevcut fenced ürün/sipariş/izin constructor’larıyla sentetik HTTP/SQL/profil üzerinden çalışır. İki mağaza aynı hook’ta eşzamanlı ayrıdır. Profil eksikliği, yetki nesli değişimi, unbound çağrı, 401, kalıcı close, yabancı hook, import-only ve kotada beklerken shutdown kontrol edilir. Gerçek native HTTP yoktur; test süreçleri görünür pencere açmaz.

Bu teslim explicit bootstrap kodudur; üretimde çağrı noktası kurulmadı. Web/OAuth başlangıcı, queue entry, provider aktivasyonu, canlı token/profil/limit veya Dataset writer değiştirilmez. SDK genel ayarı nedeniyle üretim kullanımı ayrılmış arka plan host’u ve tüm foreground/auth yollarının kendi kapısında değerlendirilmesini gerektirir; baseline eşitliği kimlik/izin veya process izolasyonu kanıtı değildir. Mevcut 26 sıra, 13 sonrası kısa / 15 sonrası ana değerlendirme ve PMax duraklaması korunur. Merchant/canonical/OAuth/scheduling/native kaynak ve kapasite işleri açık kalır.

15 yeni + 1.825 mevcut ilgili test (1.840 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Exact-head CI ve mevcut F01 tekrarları ayrıca PR üzerinde doğrulanacaktır.

Resmî kontrol 28 Ekim 2026: [SDK fetch runtime](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/runtime/http/index.ts), [API Node adaptörü](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/adapters/node/index.ts), [React Router Node adaptörü](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/src/server/adapters/node/index.ts), [shopifyApp](https://shopify.dev/docs/api/shopify-app-react-router/latest/entrypoints/shopifyapp). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_SDK_bootstrap_2026_10_28`.


## Mevcut 14 değerlendirmesi — Admin maliyet geri bildirimi ve kurallı ortak durdurma, 28 Ekim 2026

#239 `342691056231fcf300830ee28baa7cf4c195a2da` main’dedir. Mevcut 12 düzeltmelerinde devam onayıyla maliyet geri bildirimi ve ortak durdurma bağlantısı hazırlandı. CLI migration `20261028143322_eo05a_admin_cost_feedback.sql` yalnız mevcut private operations kota envanteri ve fonksiyonlarını tamamlar; yeni tablo, etkin profil, native limit, Dataset veya kimlik writer yoktur. 26 sıra ve 13 sonrası kısa / 15 sonrası ana değerlendirme kararı korunur; tam 14 veya canlı kabul verilmez.

Admin geri bildirimi repository ve SQL tarafından exact yedi alanda doğrulanır. observed/partial/missing/invalid ayrı; gerçek zero ve kesirli native restoreRate korunur. Kayıt yalnız mevcut Admin operation ve tüketilmiş attempt’e bağlıdır; zaman sunucudandır. Aynı attempt’in birebir tekrarı idempotent, çelişkili tekrarı false’tur. Eski attempt yeni gözlemi ezemez. Ham yanıt, veri, header veya hata mesajı saklanmaz. Bu gözlem limit kurmaz, puan iade etmez, plan tahmin etmez, kapasite açmaz veya stop temizlemez.

Native sınır yalnız Admin HTTP200/429, nonempty errors ve bütün extensions.code değerleri exact THROTTLED olduğunda shopify_admin_throttled üretir. Karışık hata, tek başına 429, Partner 429 kodu veya maliyet bütçesi aşımı ortak throttle kanıtı sayılmaz. SQL aynı attempt’in gerçekten tükettiği Admin puan policy’leri ile mevcut owner stop kurallarının kesişimini durdurur. İlgili policy’yi kullanan kardeş işlem de durur; kural olmayan veya tüketilmemiş policy etkilenmez. Kural yoksa yalnız operation durur. 401/403 mevcut connection-domain stop davranışını korur; unknown attempt unsettled kalır. Hatalı native yanıtta feedback kaydı başarısız olsa da stop denenir. Otomatik retry, refund veya yeniden açma yoktur.

Gerçek SQL sınaması mevcut F01 authority matrisi içinde native readPage zamanlayıcısının dışında, gerçek transport/guard/repository/SQL ve sentetik HTTP ile çalışır. İki policy, shared sibling, kural yokluğu, ilgisiz policy, malformed veri, attempt bağlamı, geç gelen gözlem, idempotence, feedback yazım hatası, unknown ve cost overrun sınanır. Bütün fixture satırları rollback edilir; native HTTP=0. RLS/ACL korunur, yeni SQL fonksiyonu yalnız coordinator’a açıktır ve eski internal fonksiyonun doğrudan çağrısı kapatılır. Global SDK hook, native profil/maliyet/aktivasyon, Merchant/canonical/OAuth/scheduling ve sonraki yazım kapıları açık kalır.

23 yeni + 1.802 mevcut ilgili test (1.825 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Gerçek SQL kanıtı PR/F01 üzerinde ayrıca doğrulanacaktır.

Resmî kontrol 28 Ekim 2026: [Shopify maliyet](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), [Admin hata kodları](https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes), [Supabase fonksiyonlar](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_cost_feedback_SQL_2026_10_28`.


## Mevcut 14 değerlendirmesi — Admin maliyet rezervasyonunun SQL bağlantısı, 28 Ekim 2026

#238 `78829f8283152daab9058a824d851677ea77a7ec` main’dedir. Kullanıcının devam onayıyla, mevcut 12 düzeltmelerinde Admin maliyet rezervasyonuna geçildi. Bu teslim yalnız mevcut private kota envanterini tamamlar; yeni tablo, Dataset writer, canlı profil veya limit tanımlamaz. 13 sonrası kısa değerlendirme yapıldı; kalan 12 kod eksikleri ardından 15 sonrasında ana değerlendirme yapılması kararlaştırıldı. Bu sıra mutabakatı canlı uygulama veya sonraki provider kapıları için onay değildir.

CLI ile oluşturulan `20261028141201_eo05a_admin_cost_budget.sql`, Admin operation için pozitif güvenli tam sayı reserved_requested_cost ve zorunlu route profili; policy için shopify_admin_query_points birimi getirir. Aynı rezervasyonda bütün ilgili policy kayıtları aynı puanı tüketmeden costBudget makbuzu üretilemez. Eksik, kapalı, eski fingerprint veya tutarsız puan kaydı not_configured kalır. Maliyet değişmesi fingerprint’i geçersiz kılar; diğer sağlayıcıların fingerprint biçimi korunur. Caller maliyet seçmez. Mevcut atomik çoklu kapsam, interactive rezervi, stop zinciri ve rate tüketimini iade etmeyen settlement davranışı korunur. Profil varsayılanları kapalıdır; migration satır eklemez.

Gerçek PostgreSQL sınaması mevcut F01 rollback-only authority matrisi içinde, native readPage zamanlayıcısının dışında çalışır. Sentetik profillerle iki policy’ye aynı puan yazımı, typed makbuzdan gerçek guard’a geçiş, eski profil ve eksik/tutarsız kapsamların kısmi debit bırakmaması, tekrar attempt, background headroom, iadesiz settlement, kapalı/stopped kayıtlar ve private erişim kontrol edilir. Sentetik satırlar geri alınır; native HTTP yoktur. Admin cost feedback/shared throttle sinyalleri ve global SDK hook bu teslimde kapanmaz; native ölçüm/limit ve Merchant/canonical/OAuth/scheduling işleri açık kalır. Paket veya 14 bütünü Done değildir.

1 yeni + 1.801 mevcut ilgili test (1.802 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Gerçek SQL sonucu PR/F01 üzerinde ayrıca doğrulanacaktır.

Kaynak kontrolü 28 Ekim 2026: [Shopify GraphQL Admin rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Supabase changelog](https://supabase.com/changelog), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_cost_budget_SQL_2026_10_28`.


## Mevcut 14 değerlendirmesi — Onaylı dar kapsam: Admin kota SQL bağlantısı, 28 Ekim 2026

#237 `aff98cef032d1e43e87f3c4d00bc0825b1587384` main’dedir. Kullanıcı mevcut kota kapsamı tablosuna Admin desteği, SQL yetki kontrolü, adapter ve izole testler için repository migration’ını açıkça onayladı. Bu onay 14’ün tamamını, canlı uygulamayı veya 15’in Dataset/kimlik/sipariş tabloları ve writer’larını kapsamaz. Tarihsel checkpoint kendi base commit’inin kaydı olarak korunur; aşağıdaki dar ilerleme onu tamamlandıya çevirmez.

CLI ile oluşturulan `20261028132721_eo05a_admin_quota_context.sql`, yalnız mevcut private operations.refresh_quota_contexts tablosunun constraint’lerini ve mevcut load_refresh_quota_context fonksiyonunu genişletir. Admin, provider bağlantısı yerine installation FK + workspace/kurulum nesli ve güncel shop domain’e bağlıdır; provider connection alanları null’dur. Quarterly API sürümü ve canonical domain zorunludur. Yeni tablo, etkin kapsam satırı, native limit veya kota profili eklenmez; enabled varsayılan false kalır. RLS/ACL korunur; fonksiyon yalnız mevcut coordinator rolüne açıktır.

Admin hedefi, orijinal Meta/Google/Klaviyo job/account/window/fence ve güncel provider bağlantı/seçim kanıtıyla yüklenir. request_intent ve taze entitlement zorunludur. Yanlış kurulum/domain, kapalı kayıt, eski nesil/fence, değişmiş bağlantı veya away/back hesap seçimi scope döndürmez. Adapter artık Admin isteğini bu SQL fonksiyonuna geçirir; null/hatalı SQL native HTTP’den önce durur. Shopify Admin ayrı reklam sağlayıcısı veya caller tarafından seçilen hesap değildir.

Yeni gerçek SQL probe’u mevcut F01 fenced worker başarıyla handoff yaptıktan sonra, aynı gerçek claim/window ve billing receipt ile rollback-only request_intent stage fixture’ında iki geçici veritabanı replay’inde çalışır. SQL senaryo matrisi süreli native readPage dışında tutulur; mevcut bir saniyelik timeout ve ready_for_dataset sonucu korunur. Sentetik Admin kayıtları savepoint’lerle geri alınır; native HTTP yoktur. Yerelde Docker bulunmadığı için PostgreSQL sonucu F01 CI’da doğrulanır. 4 yeni unit + 1.797 mevcut ilgili test (1.801 toplam), 7 repository kontrolü, typecheck ve diff kontrolü kullanılır; exact CI sonucu PR kaydında tutulur. Resmî kontrol 28 Ekim 2026: [Supabase functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_quota_SQL_context_2026_10_28`.

Admin point costBudget issuance, native profiller/feedback/shared-stop, explicit SDK hook ve kapasite; Merchant SQL, canonical PK/selection epoch/OAuth CAS; native kaynak/izin ve sipariş iddiaları; bağımsız sipariş zamanlaması/kısmi devam hâlâ açıktır. Canlıya apply, Dataset yazımı, Sales Role, 26 sıra veya PMax duraklaması değişmez.

## Sıralı plan 13 — Kod/kanıt checkpoint’i ve 14 incelemesine hazırlık, 28 Ekim 2026

#236 `d7625bd0c94637e09b0ce9c25d8543bc92860212` main’dedir. [Tek checkpoint kaydı](evidence/EO_05_STEP13_PREWRITE_CHECKPOINT_2026-10-28.json), 10 kritik kod dosyasını exact base-commit/blob ve giriş fonksiyonuyla; üç sağlayıcının sipariş iddiası durumunu; açık kod/native/SQL kapılarını mevcut plan sıralarıyla bir araya getirir. Bu teslim runtime eklemez. Son kod tesliminin 1.768 ilgili testi, 7 kontrolü, typecheck ve üç CI sonucu referanstır; bu checkpoint canlı kabul değildir.

| Sağlayıcı | Kodda bulunan | Açık kalan |
|---|---|---|
| Google | Merchant/link/kaynak-kuralı/Shopify ürün aday yolu ve mevcut performans/dönüşüm sorguları | Bireysel Shopify Order ID + sağlayıcının saydığı satış iddiası için okunabilir kaynak doğrulanmadı. order_id yükleme/düzeltme alanı, böyle bir geri-okuma kanıtı değil. |
| Meta | Katalog/Ad referansı, Shopify adayları, ham dört conversion alanı ve namespace kontrollü rapor bağı | Okunabilir sipariş iddiası kaynağı doğrulanmadı. CAPI order_id/event_id gönderimi geri-okuma kanıtı değil. Ürün satış ilişkisi decoder/kanıtı mevcut 18. maddede açık. |
| Klaviyo | OrderId korunuyor; exact kaynak kuralı + gözlenen Shopify Order + exact Message ile yapısal aday bağı var | Gerçek hesap/metric/integration/shop kimliği, OrderId biçimi ve atıf iddiası kanıtı açık; canlı kural yok. Assisted/Triggered/Unclassified değişmedi. |

Google’ın dönüşüm raporlama ve yükleme/düzeltme belgeleriyle Meta’nın resmî AdsInsights/CAPI SDK’sı 28 Ekim 2026’da kontrol edildi. Gönderme alanı okuma yeteneği yerine konmadı; sağlayıcı genelinde desteklenmiyor sonucu çıkarılmadı. İki büyük Google alan sayfası okuyucunun içerik sınırına takıldı; bu sınırlama kaynak kısıtı olarak kaydedildi, API kısıtı sayılmadı. Bkz. [Google reporting](https://developers.google.com/google-ads/api/docs/conversions/reporting), [Google adjustment](https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments), [Meta AdsInsights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py), [Meta CAPI EventRequest](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/serverside/event_request.py).

Mevcut 12’den gelen açık işler aynı checkpoint’te ayrıdır: actual Admin SQL context/cost receipt/profil/feedback/shared stop; Merchant SQL ve canonical installation PK/selection epoch/OAuth CAS; explicit SDK global hook ve upstream response kapasitesi; bağımsız Shopify sipariş zaman aralığı/scheduler/geçmiş erişim ve kalıcı kısmi devam. Native kaynak/namespace/izin/app onayları ve okunabilir provider iddiaları da açık. Bunlar yeni iş numarası değildir; mevcut 7–15 ve ilgili sonraki sıralara bağlıdır.

26 adımlı JSON ve okunabilir planın 7–14 durumları, artık main’de bulunan kod hazırlığını gösterecek şekilde düzeltildi; sıra, iş, sınır ve Shopify ekleri değiştirilmedi. 27 Ekim Exceli tarihsel görüntü olarak kaldı ve yeniden üretilmedi. 13 tamamlandı işaretlenmedi. 14 incelemesi/kalıcı yazım onayı verilmedi; yeni tablo/migration/writer/aktivasyon başlamadı. 15’e geçiş, mevcut 14 değerlendirmesindeki açık karar ve onayı gerektirir. Kanıt bekleyen davranış için yeni bir okuyucu varsayılmadı; tarihsel PMax duraklaması ve PD/CPD ayrımı korunur.

## Sıralı plan 13 — Klaviyo OrderId’nin korunması ve koşullu Order–Message aday bağı, 28 Ekim 2026

#235 `bde44288e093398e8ab00de174ef282ba7ed3922` main’dedir. Mevcut Events sorgusu event_properties istiyor; OrderId normalizer/projection’da kayboluyordu. Artık provider_order_properties.OrderId altında ham türü/değeri, present/absent, null ve gerçek sıfır korunur. Ürün alanlarına karıştırılmaz; müşteri/profil alanı eklenmez. Yeni native sorgu ailesi, çağrı veya izin yoktur. Resmî Events örneğindeki OrderId genel bir UUID’dir; bunun Shopify sipariş kimliği olduğu varsayılmaz. Başka case/alias, event UUID, ürün, sipariş adı, gün veya tutardan fallback yapılmaz.

Yeni server kural registry’si varsayılan boş ve nominaldir. Kural exact workspace/kurulum nesli/shop/domain/provider bağlantı ID+sürümü/hesap, metric ID ve Shopify integration ID’ye bağlıdır. property yalnız OrderId; biçim açıkça Shopify Order GID veya legacy ID’dir. Kaynak kanıt referansı ve verified state gerekir. Constructor kuralları await öncesi kopyalar; loader yalnız başarılı aday sonucuyla private WeakMap’e kaydedilir. Native/Message-only giriş kural yeteneğine geçemez. Per-review kural veya registrar yoktur; canlı kaynak kuralı eklenmedi.

reviewKlaviyoOrderClaimPrewrite mevcut gerçek aday/Message ve Shopify replay kontrollerini kullanır. Yalnız orijinal loader’ın exact kuralı eşleşirse kimlik parse edilir. Pozitif güvenli sayı veya tam uint64 decimal string yalnız açık legacy kuralıyla; GID yalnız doğru tam namespace ile kabul edilir. UUID, Order adı, zero, fraction, unsafe number ve biçim farkı aday üretemez. Aynı shop’taki tamamlanmış Shopify gözleminde Order ve exact native Message varsa structural_Order_Message_reference oluşur. Eksik kural/integration ID, gözlemlenmeyen Order ve çelişkili/eksik Message ayrı nedenlerle unresolved kalır. Boş kaynak aday uydurmaz.

Ortak Shopify/provider hazırlık kontrolü Klaviyo için orderReferenceReview’ı çağırır. Bu, doğrulanmış canlı satış iddiası değildir: canonicalClaimId null; readableOrderClaimVerified, providerClaimVerified ve exactOverlapVerified false. Aynı Order’a bağlı iki event korunur; Order satışı toplanmaz, LineItem tahmini yapılmaz. Ham tutar/adetler, Shopify vergisi/kargosu/iadesi, FX ve Assisted/Triggered/Unclassified rolleri değişmez. Google/Meta kaynak yeteneği hakkında yeni sonuç çıkarılmaz. Yeni HTTP/SQL/tablo/migration/provider/OAuth/token/config/route/Dataset mutasyonu yoktur. 12’nin native/SQL/profil/kapasite kapıları ve 14 incelemesi, 26 sıra ve PMax duraklaması korunur.

31 yeni + 1.737 mevcut ilgili test (1.768 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Önceki 1.559 kapsamına 178 mevcut Klaviyo testi de eklendi. Gerçek SDK/fenced koleksiyonlar sentetik kaynak kuralı/native HTTP/SQL/vault ile sınandı; gerçek kaynak biçimi veya dönüşüm iddiası kanıtı değildir. Resmî kontrol 28 Ekim 2026: [Klaviyo Events API overview](https://developers.klaviyo.com/en/reference/events_api_overview), [Shopify data reference](https://help.klaviyo.com/hc/en-us/articles/115005080447). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_order_reference_prewrite_2026_10_28`.

## Sıralı plan 13 — Shopify ile sağlayıcı gözlemlerinin ortak iddia hazırlık kontrolü, 28 Ekim 2026

#234 `433c6ab9b9877a1764ab5ce0c6749dcca1820aab` main’dedir. Yeni reviewShopifyProviderClaimReadiness, Shopify Order/LineItem replay kontrolü ile sağlayıcı aday/rapor/Message kontrolünü aynı owner altında birlikte çalıştırır. Beklenen workspace, kurulum nesli, shop ID/domain ve seçilmiş provider/bağlantı sürümü/hesap kapsamı sunucudan gelir. Yanlış owner, tekrarlanan seçim, kopya gözlem ve caller tarafından verilen claim veya eşleme kuralı reddedilir. Aynı mağazaya ait gözlemler yan yana korunur; ürün, gün, tutar veya ziyaret kaynağından Order ID üretilmez.

Mevcut identity okuyucuları okunabilir provider Order ID iddiası toplamıyor. Birleşik kontrol bunu not_collected_in_identity_observation olarak korur. Hiç sunulmamış gözlem observation_not_supplied’dır; tamamlanmış boş kaynak bunlardan ayrıdır. comparisonState=not_assessed_readable_provider_order_claim_required; claimMatches boş, unmatchedClaims ve ordersWithoutProviderClaim null kalır. Karşılaştırılmamış sipariş eşleşmeyen sayılmaz. Bu teslim gerçek iddia okuyucusu veya sipariş matcher’ı değildir; sağlayıcının başka API’sinde destek yok sonucu çıkarılmaz.

Shopify siparişi/LineItem’ı tek bağımsız satış temeli olarak kalır; replay yeni satış sayılmaz. Eksik yolculuk tam satışları silmez; hazır yolculuk da provider dönüşüm iddiası değildir. Shopify extraction range ile provider business day ayrı saklanır ve eşit varsayılmaz. Sayısal toplam, para birimi/FX veya atıf kapsamı karşılaştırması yapılmaz. Sales Role, kesin overlap, native erişim, canonical scope, persistable, aktivasyon ve Dataset-write false kalır. HTTP/SQL/tablo/migration/provider/OAuth/token/config/route mutasyonu yoktur. Mevcut 12 native/SQL/profil/kapasite kapıları ve 14 değerlendirmesi açıktır; 26 sıra ve tarihsel PMax duraklaması korunur.

26 yeni + 1.533 mevcut ilgili test (1.559 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Üç sağlayıcı gerçek SDK/fenced koleksiyonu, paylaşılan mevcut Shopify sipariş fixture’ıyla sentetik HTTP/SQL/vault üzerinden sınandı. Canlı erişim, okunabilir claim veya kalıcı idempotence kanıtı değildir. Resmî kontrol 28 Ekim 2026: [Shopify CustomerJourneySummary](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary), [Klaviyo Events](https://developers.klaviyo.com/en/reference/get_events). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_provider_claim_readiness_2026_10_28`.

## Sıralı plan 13 — Meta rapor ve Klaviyo Message bağlarının DB’siz kontrolü, 28 Ekim 2026

#233 `ca16b2d4aa4b89d4f6ddc741ddd615588fcad49b` main’dedir. Yeni reviewRefreshReferencePrewrite önce mevcut ortak aday kontrolünü çalıştırır; aynı tamamlanmış, değiştirilemez gözlemden rapor/Message referanslarını inceler. Beklenen provider/workspace/kurulum nesli/shop/bağlantı sürümü/hesap kapsamı zorunludur. Caller hedef, kural, rapor veya rol kanıtı veremez. Önceki aday kontrolünün reportLinksReviewed=false sonucu değiştirilmez; yeni referenceReview ayrı kontrol kapsamıdır.

Meta’da orijinal constructor’ın kopyaladığı namespace kural loader’ı ve Ad/AdSet/Campaign/katalog hedefi private WeakMap’te yalnız başarılı rapor sonucuyla saklanır. Dönen linkten kural türetilmez. Aynı ham rapor ve katalog/Shopify adayından bağ yeniden kurulup mevcut sonuçla karşılaştırılır. retailer_id ve catalog_product_id birbirine fallback değildir. Boş kural, kaynak kuralı eksikliği, seçilen Ad dışı kayıt ve aynı retailer’ın birden çok feed’de bulunması unresolved/ambiguous kalır. Dört conversion alanı ham korunur; yorumlama, çıkarma veya Sales Role ataması yoktur.

Klaviyo’da native events + attributions → kontrol edilmiş aday → mevcut Message resolver yolu yeniden hesaplanır. Olay/metric, Message, Campaign/Flow parent, medium ve variation korunur. Campaign Assisted, Flow Triggered; eksik/çoklu/çelişkili atıf Unclassified kalır. Advertised/Cross Sell kapsamı açılmaz. Placed Order rapor toplamları Ordered Product satışlarına katılmaz; aynı adaya bağlı iki olay ayrı kalır, gerçek sıfır korunur. Google Merchant ve Meta aday-only okuyucusunda rapor toplanmadıysa not_collected_in_this_reader_mode denir; provider desteklemiyor veya sıfır satış denmez.

Bu identity gözlemlerinde okunabilir provider Order ID satış iddiası toplanmıyor. Event ID, UUID, ürün kimliği veya aggregate değer sipariş kimliği yerine konmaz. Bu sınır sağlayıcının başka kaynağında iddia bulunmadığı anlamına gelmez. Shopify siparişleriyle claim mutabakatı ayrı kalan iştir; providerClaimsReviewed, providerClaimVerified ve exactOverlapVerified false’tur. Canonical kimlik, native izin, persistable, aktivasyon ve yazım yetkisi verilmez. Yeni HTTP/SQL/tablo/migration/provider/OAuth/token/config/route/Dataset mutasyonu yoktur. 12’nin native/SQL/profil/kapasite kapıları ve 14 incelemesi açık; 26 sıra ve tarihsel PMax duraklaması korunur.

26 yeni + 1.507 mevcut ilgili test (1.533 toplam), 7 repository kontrolü, typecheck ve diff kontrolü geçti. Gerçek SDK/fenced okuyucular sentetik HTTP/SQL/vault ile sınandı; canlı kanıt değildir. Resmî kontrol 28 Ekim 2026: [Meta AdsInsights SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py), [Klaviyo Events](https://developers.klaviyo.com/en/reference/get_events). Alan/relationship varlığı ürün satış ilişkisi veya Order ID iddiası kanıtı değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#provider_reference_prewrite_review_2026_10_28`.

## Sıralı plan 13 — Üç sağlayıcının DB’siz ürün adayı kontrolü, 28 Ekim 2026

#232 `27ceaf7bdf577e08194a52c69480d645f5e69da2` main’dedir. Yeni reviewRefreshCandidatePrewrite, tamamlanmış Google/Meta/Klaviyo aday okuyucusu çıktısını aynı yapıda inceler. Fenced factory içindeki private WeakMap yalnız başarılı aday (Meta’da aday+rapor dahil) sonucuna köken kaydı ekler; registrar export edilmez. Native-only/Message-only çıktı, JSON kopyası, spread veya güven flag’i bunu taklit edemez. Bu kayıt güncel native izin/fence veya yazım yetkisi değildir.

Beklenen sunucu kapsamı: provider, workspace, kurulum nesli, shop ID/domain, bağlantı ID/sürümü ve hesap. Bu kapsam hem factory’nin yakaladığı metadata hem SQL/vault okuyucusu çıktısıyla eşleşir. Kaynak kapsaması ve tekrarlar; her aday indeksinin aralığı/durumu, native kayıt bağı ve aynı Shopify mağazasında product/variant-parent kanıtı denetlenir. Referanssız aday ve uyuşmayan Klaviyo event-ID referans kümesi kabul edilmez. İndeksler yerel referanstır; DB ID değildir.

Google’da Merchant/feed/dil/veri kaynağı; Meta’da katalog iç ID, retailer ve varsa feed; Klaviyo’da olay ID/metric ve normalize edilmiş native olgu korunur. Aynı Product ID altında farklı varyantlar, diller, feed’ler veya olaylar birleştirilmez. Kaynak kuralı ya da kimlik eksikse unresolved/conflicting satır nedeni ve null standardizedProductId ile kalır. Gerçek boş kaynak observedEmpty’dir; metrik sıfırı veya aday uydurulmaz. Tutar/adetler değişmez. Yerel sourceRows/candidates/unresolved/conflicting sayıları yalnız yapısal kontrol sayılarıdır, reklam metriği değildir.

Ortak çıktı sourceReference, state, reason, yerel candidateIndex, aday Shopify Product/Variant ve orijinal observed satırını içerir. Product ID aday omurgasıdır; varsa Variant ID kaynak ayrıntısıdır. Standardize edilmiş kimlik veya kanonik mapping atanmaz. reportLinksReviewed=false ve providerClaimsReviewed=false: Meta rapor/Message bağları ve sipariş satış iddiaları bu teslimde incelenmiş sayılmaz. Role, paid atıf, kesin overlap, native izin, canonical scope, persistable, aktivasyon ve yazım false kalır.

Yeni HTTP/SQL, tablo/migration, provider/OAuth/config/token/route/Dataset mutasyonu yoktur. 12’nin native kaynak/namespace/erişim, SQL/profil/kapasite kapıları; 13’ün rapor/Message/claim mutabakatı ve 14 incelemesi açıktır. 26 sıra, Klaviyo rol kararı ve tarihsel PMax duraklaması korunur.

71 yeni + 1.436 mevcut ilgili test (1.507 toplam), 7 repository kontrolü ve typecheck geçti. Ortak test senaryoları üç sağlayıcının gerçek kurulu SDK/fenced collector nesneleriyle, sentetik native HTTP/SQL/vault üzerinden çalıştı. Native erişim, namespace veya kalıcı mapping/idempotence kanıtı değildir.

Resmî kontrol 28 Ekim 2026: [Merchant Product](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products), [Meta ProductItem](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py), [Klaviyo Events](https://developers.klaviyo.com/en/reference/get_events), [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant). Makine kaydı: `contracts/eo-05-start-brief-v1.json#provider_candidate_prewrite_review_2026_10_28`.

## Sıralı plan 13 — Shopify sipariş/satır için DB’siz yazım öncesi kontrol, 28 Ekim 2026

#231 `470207d24a7de65a536487992cb2844b7a77806e` main’dedir. Üç sağlayıcının aday SDK/kota bağlantıları hazırlanmıştır; 12’nin native kanıt/SQL/kabul kapıları kapanmış sayılmaz. 13’ün ilk kod parçası reviewShopifyOrderPrewrite, yalnız aynı süreçte tamamlanmış gerçek collection çıktısını ve varsa önceki böyle bir çıktıyı inceler. Collector’ın private WeakSet kaydı son kontroller geçince eklenir; JSON kopyası, wrapper veya güven iddia eden flag kabul edilmez. Bu işaret kaynak nesnenin yerel kökenidir; native izin veya yazım yetkisi değildir. Önceki gözlem DB satırı değildir; kalıcı replay okuyucusu/yazıcısı eklenmedi.

Beklenen workspace/kurulum nesli/shop ID/domain sunucu orkestrasyonundan gelir ve iki gözlem de bu owner ile eşleşir. Okumalar arası AppInstallation değişimi reddedilir. Order anahtarı workspace + shop + Order ID; satır anahtarı workspace + shop + Order ID + LineItem ID’dir. Product/Variant, provider/hesap/job veya gün bu fiziksel Shopify kayıt anahtarına eklenmez. Kurulum nesli owner kontrolüdür, kaynak job ve extraction range provenance’da korunur. Aynı ürüne ait farklı satırlar birleşmez. Aynı LineItem başka siparişe bağlanamaz.

Eski current.updatedAt reddedilir. Aynı timestamp altında header, satır değerleri veya satır kümesi farklıysa sessiz sürüm seçilmez; conflict ile durur. Aynı satış gözlemi replay’dir, tutarlar toplanmaz; line pagination sırası farkı conflict değildir. Daha yeni sürüm native current/original adet ve tutarları, iade/iptal, gerçek sıfır ve null ürün/varyantı korur. Vergi/kargo/indirim/iade/FX hesabı yapılmaz; writer’a kazanan kayıt seçilmez. Bir sonraki okumada görünmeyen order/line yalnız gözlemlenmeyen anahtar olarak raporlanır; silinme, tombstone, sıfır satış veya yeni satır üretilmez.

Journey hazır değilse tam satış satırları korunur. Journey farkı, sales replay/sürüm kontrolünden ayrı gözlemdir; paid/provider claim/overlap veya Sales Role sonucu değildir. Sonuç deep-frozen structurally_reviewed_open_gates’tir; native izin, canonical scope, snapshot, persistable, aktivasyon, provider claim, kesin overlap ve Dataset-write false kalır. HTTP, SQL, yeni tablo/migration, provider/OAuth/config/token/route veya Dataset mutasyonu yoktur.

13’ün üç sağlayıcı ortak aday/claim kontrolleri hâlâ sıradadır. Gerçek kaynak/namespace/erişim ve 12’den gelen Admin SQL/profil/kapasite kapıları, canonical PK/selection epoch ve kalıcı replay/writer için 14 incelemesi açıktır. 14 değerlendirmesi geçilmedi; 26 sıra, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

33 yeni + 1.403 mevcut ilgili test (1.436 toplam), 7 repository kontrolü ve typecheck geçti. Yeni kontroller, sentetik HTTP/store ile gerçek SDK/guard üzerinden üretilmiş completed collection nesneleriyle sınandı; native erişim veya kalıcı idempotence kanıtı değildir.

Resmî kontrol 28 Ekim 2026: [Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [LineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_order_prewrite_review_2026_10_28`.

## Sıralı plan 12 — Meta aday ve raporunun ortak SDK/kota bağlantısı, 28 Ekim 2026

#230 `c528fc20c59b69ce4e13af0b03a7c11de4d3d82d` main’dedir. Yeni inactive createRefreshMetaCandidateReader ve createRefreshMetaReportCandidateReader ayrı server entry’leridir. Native-only entry aynı kalır; aday entry rapor yeteneğine sessiz geçmez. Caller mode, context, guard, readExecution veya tarih penceresi veremez. Kaynak retailer kuralı ve Insights namespace kuralı ayrı listeler olarak constructor’da kopyalanır/doğrulanır. İki varsayılan registry de boştur; benzer kimlik string’i kanıt yerine geçmez.

Asıl Meta hesabı, Ad/AdSet/Campaign/katalog hedefi, app config, authenticated SDK fonksiyonu, workspace/kurulum nesli, job/fence, entitlement ve tek iş günü korunur. Native token kontrolü, reklam/katalog kaynakları, Shopify parent kontrolü, isteğe bağlı ürün raporu ve final katalog referansı ayrı existing profillerle aynı private context binding ve tek fiziksel HTTP sayacında çalışır. İlk wait prior=0; altı Meta çağrısından sonra Admin wait prior=6; Admin sonrası report wait prior=7; report sonrası final reference wait prior=8’dir. Kısmi koleksiyon hiç gönderilmemiş sayılıp baştan oynatılamaz.

Rapor penceresi yalnız yakalanan iş gününden türetilir. Tam mevcut ürün sorgusu ve dört conversion alanı ham biçimleriyle korunur; metrics_interpreted=false, sales_role_assigned=false ve exhaustive_product_coverage_proven=false kalır. İki doğrulanmış kural olsa bile bağ yerel katalog-aday referansıdır; canonical Product ID veya Advertised/Cross Sell çözümü değildir. Mevcut 18. maddenin conversion ilişki decoder’ı ve gerçek kanıtı açık kalır. provider_link_verified=true yalnız Ad parent/creative/katalog referansına aittir; Shopify adayının ve rapor bağının provider-link kanıtı false’tur.

Admin genuine hook, exact identity query, typed point receipt ve native cost feedback üzerinden çalışır. Total deadline/child signal iki tarafı kapsar; tüm sonuçlarda private SDK client kapanır, geç sonuç yeni Admin isteği açamaz. İlk hatada retry/auth recovery/fallback yoktur. Actual SQL Admin’i hâlâ kendi SQL/HTTP’sinden önce reddeder. Yeni tablo/migration, SQL profil/env/config/OAuth/token/provider mutasyonu, global hook kurulumu, route veya Dataset yazımı yoktur. Gerçek kaynak/namespace/erişim, Admin SQL/profil/puan/hook/upstream kapasite, canonical scope ve partial continuation kapıları açıktır. 13 prewrite, 14 kullanıcı incelemesi, 26 sıra, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

49 yeni + 1.354 mevcut ilgili test (1.403 toplam), 7 repository kontrolü ve typecheck geçti. Sentetik SQL/vault/HTTP/receipt ile kurulu gerçek SDK ve gerçek guard/resolver sınandı; native kaynak biçimi, namespace, izin veya maliyet profili kanıtlanmış sayılmaz.

Resmî kontrol 28 Ekim 2026: [Meta ProductItem](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py), [Meta AdsInsights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py), [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant). Breakdowns sayfası 429 verdi; yeniden denenmedi, yeni davranış çıkarılmadı. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_candidate_report_quota_composition_2026_10_28`.

## Sıralı plan 12 — Google adaylarının ortak SDK/kota bağlantısı, 28 Ekim 2026

#229 `5781451fcd9a0d55377855e3d38d4d0c76d85a98` main’dedir. Yeni inactive createRefreshGoogleCandidateReader, mevcut Ads → Merchant kaynak → aynı Shopify mağazasında ürün/varyant-parent doğrulaması → son Ads link kontrolünü aynı fenced işe bağlar. Önceki native entry aday/rule/SDK moduna açılmaz. Sunucu kaynak kuralları constructor’da async işten önce kopyalanır/doğrulanır; varsayılan registry boş kalır. Shopify’a benzeyen offerId, kural yokken ayrıştırılmaz.

Asıl Ads hesabı, Merchant hedefi ve güvenilir Merchant kota hesabı/bindingEpoch, workspace/kurulum nesli, job/fence, iş günü, entitlement receipt ve authenticated SDK fonksiyonu korunur. Ads, Merchant ve Admin ayrı existing kota profilleriyle tek private context binding ve fiziksel çağrı sayacı kullanır. İlk Ads wait prior=0; Merchant wait prior=1; iki native çağrıdan sonraki Admin wait prior=2; Admin’den sonraki final Ads wait prior=3’tür. Kısmi koleksiyon hiç gönderilmemiş sayılıp yeniden oynatılamaz.

Admin okuması genuine SDK hook, exact identity sorgusu, typed point receipt ve native cost feedback üzerinden yapılır. Mevcut total deadline/child signal SQL, HTTP ve Admin’i kapsar; bütün sonuçlarda private SDK client kapanır. İlk hatada retry/auth recovery/fallback yoktur. Native kayıt, dil/feed/veri kaynağı ve varyant ayrıntısı korunur; provider_link_verified=true yalnız gözlemlenen doğrudan Ads–Merchant bağıdır. Shopify adayı provider linki veya kanonik mapping değildir; adayın provider_link_verified, canonical_scope_ready, persistable, activation ve mapping-write false kalır. Rol/metrik/satış hesabı değişmez.

Actual SQL Admin’i hâlâ kendi SQL/HTTP’sinden önce reddeder. Merchant inventory SQL kabulü de açık kalır. Yeni tablo/migration, SQL profil/env/config/OAuth/token/provider mutasyonu, global hook kurulumu, route veya Dataset yazımı yoktur. Meta aday/rapor factory bağlantıları, gerçek kaynak/namespace/erişim kanıtları, Admin SQL/profil/puan/hook/upstream kapasite/canonical scope ve kalıcı partial continuation kapıları açıktır. 13 prewrite, 14 kullanıcı incelemesi, 26 sıra, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

42 yeni + 1.312 mevcut ilgili test (1.354 toplam), 7 repository kontrolü ve typecheck geçti. Sentetik SQL/vault/HTTP/receipt ile kurulu gerçek SDK ve gerçek quota guard/resolver sınandı; native kaynak biçimi, erişim veya maliyet profili kanıtlanmış sayılmaz.

Resmî kontrol 28 Ekim 2026: [Merchant listeleme](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list), [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_candidate_quota_composition_2026_10_28`.

## Sıralı plan 12 — Klaviyo adaylarının ortak SDK/kota bağlantısı, 28 Ekim 2026

#228 `30129063efc4e1880c53868b7d4a167de7c7482c` main’dedir. Yeni inactive createRefreshKlaviyoCandidateReader, mevcut native Ordered Product → Shopify ürün/varyant-parent doğrulaması → Message bağını aynı fenced iş altında hazırlar. Önceki native ve Message entry’leri aday moduna açılmaz; ayrı entry mode/guard/context/scopes/readExecution/Admin override kabul etmez. Kimlikler, native SDK fonksiyonu, workspace/kurulum nesli, asıl Klaviyo job/fence, iş günü ve entitlement receipt async işten önce yakalanır.

Klaviyo ve Shopify Admin ayrı profillerle, aynı private context binding ve tek fiziksel HTTP attempt sayacıyla çalışır. İlk provider wait sıfırdır; üç provider çağrısından sonraki Admin wait prior=3, Admin’den sonraki rapor wait prior=4’tür. Kısmi okuma hiç gönderilmemiş sayılıp baştan oynatılamaz. Admin sorgusu yalnız genuine SDK hook, existing exact identity query, typed point receipt ve native cost feedback üzerinden gönderilir; ilk hatada retry/auth recovery yoktur. Mevcut tek koleksiyon süre/iptal sinyali her iki tarafa gider. SDK client bütün sonuçlarda kapatılır; geç dönen dependency yeni Admin sayfası açamaz. Gönderilmiş çağrı geri alınmış sayılmaz.

Çıktı mevcut yerel aday kanıtıdır; doğrulanmış provider linki/kanonik mapping değildir. Product ID omurgası, varsa Variant ID ayrıntısı korunur. Message rapor istatistiği ürün satışına çevrilmez; Campaign Assisted / Flow Triggered / Unclassified kararı değişmez. Canonical scope, persistable, mapping write ve aktivasyon false kalır. Actual SQL Admin’i hâlâ SQL/HTTP öncesinde reddeder. Yeni tablo/migration, SQL profil/env/config/OAuth/token/provider mutasyonu, route veya Dataset yazımı yoktur.

Google/Meta aday-rapor factory bağlantıları, gerçek kaynak/namespace/erişim kanıtları, Admin SQL/profil/puan/global hook/upstream kapasite ve canonical scope kapıları açıktır. 13 prewrite ve 14 kullanıcı incelemesi, mevcut 26 sıra ve tarihsel PMax duraklaması korunur.

33 yeni + 1.279 mevcut ilgili test (1.312 toplam), 7 repository kontrolü ve typecheck geçti. Sentetik DB/vault/HTTP/receipt ile kurulu gerçek SDK ve gerçek quota guard/resolver sınandı; native erişim veya maliyet profili kanıtlanmış sayılmaz.

Resmî kontrol 28 Ekim 2026: [Klaviyo Events](https://developers.klaviyo.com/en/reference/get_events), [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant), [Node async context](https://nodejs.org/api/async_context.html). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_candidate_quota_composition_2026_10_28`.

## Sıralı plan 12 — Shopify native izin listesi, 28 Ekim 2026

#227 `a3e8db49a82aeaf77fba93a95006e93e56d7e82d` main’dedir. Hazırlanan tek kullanımlık sipariş çalıştırıcısı, ilk sipariş sorgusundan önce ve tüm veri kontrollerinden sonra `currentAppInstallation.id/accessScopes` listesini aynı genuine SDK/kota yolundan okur. Ayrı `permission_scopes` ailesi yalnız API 2026-10’da, kendi operation key ve typed point receipt’iyle çalışır; mevcut ürün/sipariş profili yerine kullanılamaz. Global SDK hook kurulmadı; identity-only istemci bu sorguya açılmadı.

Mevcut izin politikası korunur: read_products + read_orders; açık boolean includeOrderHistory=true ise ayrıca read_all_orders. Native write grant’lerin read eşdeğerliği mevcut politikadan gelir; yeni izin istenmez. Caller scopes/evidence enjekte edemez. Native mağaza, kurulum GID’si ve eksiksiz/tekil izin listesi doğrulanır. Başlangıçta eksik izin sipariş HTTP’sini durdurur; sonda kurulum veya izin kümesi değişirse bütün sonuç teslim edilmez. Aynı kümenin sırası değişebilir.

İki scope HTTP okuması aynı total süre/çağrı/SDK Response byte sınırına ve fiziksel attempt sayacına dahildir. İlk wait sıfır olabilir; scope okumasından sonraki wait önceki çağrıları silmez veya koleksiyonu hiç gönderilmemiş saymaz. Scope handle listesi yerel 100 kayıt sınırındadır; sipariş veri satırı sayacıyla karıştırılmaz. Quota metadata’ya izin, kurulum GID’si veya sorgu gövdesi taşınmaz.

nativeScopeListObserved=true yalnız gözlemlenen listeyi ifade eder. nativePermissionVerified, historicalCoverageVerified, persistable, authorizesActivation ve DatasetWritePerformed=false kalır. Korunan müşteri verisi onayı, tarihsel kapsam, gerçek erişim ve SQL/profil/hook/upstream kapasite kabulü bu listeyle kanıtlanmaz. Actual SQL Admin’i hâlâ SQL/HTTP öncesinde reddeder. Yeni SQL/migration, OAuth/config/token/provider mutation veya Dataset yazımı yoktur. 13 prewrite, 14 kullanıcı incelemesi, mevcut 26 sıra, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

57 yeni + 1.222 mevcut ilgili test (1.279 toplam), 7 repository kontrolü ve typecheck geçti. Bunlar sentetik native yanıt/store ile kurulu gerçek SDK ve guard testleridir; canlı izin/erişim kanıtı değildir.

Resmî kontrol 28 Ekim 2026: [currentAppInstallation](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation), [access scopes](https://shopify.dev/docs/api/usage/access-scopes), [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_order_scope_readback_2026_10_28`.

## Sıralı plan 12 — Shopify native sipariş koleksiyonu ve total sınırlar, 28 Ekim 2026

#226 `e2b48e20c285c260a25b5c1aad833449d7e78d99` main’dedir. Yeni inactive createRefreshShopifyOrderReader, mevcut genuine order SDK client ve fenced private builder üzerinden tek kullanımlık readEvidence çalıştırıcısını kurar. Shop/owner/asıl provider job/window, açık UTC updated_at extraction range, yerel total limitler ve native fonksiyon async işten önce yakalanır. Caller recheck/guard/scopes/client override veremez. İşin business date’i extraction UTC aralığına çevrilmez veya eşit varsayılmaz; bağımsız Shopify scheduling/zaman kapsamı kabulü açık kalır.

İlk header window tam sayfalanır; her Order için LineItem ve journey connection ayrı ilerler. Aynı ürünlü farklı LineItem’lar korunur; null Product/Variant, currentQuantity=0, iptal/iade ve native tutarlar silinmez veya hesaplanmaz. Eksik/pending/moments eksik yolculuk, tamamlanmış satış satırları yanında journey_incomplete olarak tutulur; attribution claim veya pending cursor retry yoktur. Hazır boş yolculuk paid/provider dönüşüm kanıtı değildir.

Zorunlu limits: maxElapsedMs, maxRequests, maxRows, maxBytes, pageSize. Bunlar local kapasite sınırlarıdır; native quota/puan profili değildir. Tek toplam timer + monotonic elapsed check SQL lookup, SDK/HTTP, decode, recheck ve sonuç freeze dahil tüm akışı kapsar; her sayfada sıfırlanmaz. SDK client kendi genuine brand ve kapatılabilir lifetime signal’ını taşır. Bütün sonuçlarda kapanır; geç dönen ve iptali yok sayan dependency yeni sayfa başlatamaz. Gönderilmiş HTTP geri alınmış, SQL öldürülmüş veya rate usage iade edilmiş sayılmaz.

**Byte sınırının exact anlamı:** stats.SDKResponseBytes ve maxBytes, React Router’ın SDK sonucu üzerinden yeniden oluşturduğu Response’un UTF-8 stream byte’larını sayar. SDK ve quota feedback clone’u native yanıtı daha önce parse eder. Bu teslim native ağ byte/memory sınırı sağladığını iddia etmez; upstream response/clone kapasite kabulü 14 incelemesinde açıktır. Decoder byte-limit/abort’ta reader’ı beklemeden iptal eder; kısmi JSON, biçim, cursor, limit veya native hata completed sonuç vermez. Fixed decoder hataları nominal ShopifyOrderProtocolError ile ayrılır, provider mesaj prefix’i trusted hata sayılmaz.

Başarılı okuma sonrası açık gözlem kontrolleri yapılır: her sipariş için mevcut journey sorgusu first=1 yeniden okunur; Order.updatedAt, readiness, first/last ve ilk moment karşılaştırılır. Header window bir kez daha tam sayfalanır; ID kümesi ve native header alanları karşılaştırılır, eşit timestamp’li sıralama değişikliği yanlış hata üretmez. Publish öncesi güncel fenced scope/profile tekrar kontrol edilir. Bunlar hata retry’si değildir; gerçek SDK çağrıları ve budget sayaçlarına dahildir. Atomik snapshot veya yolculuğun orta ziyaretlerinin değişmediği kanıtlanmış sayılmaz.

Genuine kota kontrol hata nesnesi ve önceki fiziksel attempt sayısı SDK/collector boyunca korunur. İlk gerçek wait sıfırsa mevcut tek kullanımlık work-wait yolu korunur; önceki çağrılardan sonraki wait işi hiç gönderilmemiş saymaz. Runtime/native izin, tarihsel erişim, canonical kurulum primary key, kesin overlap, aktivasyon, persistable ve Dataset-write bayrakları false kalır; scope.installation_id=null’dır. Actual repository/SQL Admin’i hâlâ SQL/HTTP öncesinde reddeder.

40 yeni + 747 mevcut ilgili test (787 toplam), 7 repository kontrolü ve typecheck. Sentetik store/receipt/HTTP ile gerçek kurulu SDK, gerçek guard/resolver, çok sayfa/çok sipariş, final change, pending, bütçeler, timeout/iptal/late return, native hata, current SQL reddi ve tek kullanım sınandı. Canlı veri/izin/maliyet kanıtı değildir. Resmî kontrol 28 Ekim 2026: [orders](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [order](https://shopify.dev/docs/api/admin-graphql/latest/queries/order), [journey](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary), [pagination](https://shopify.dev/docs/api/usage/pagination-graphql), [SDK Response oluşturma](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/src/server/clients/admin/graphql.ts). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_order_native_collection_2026_10_28`.

12 açık: native izin/protected-data/history ve gerçek kaynak kanıtları; 14’te Admin SQL/context/costBudget/profile/feedback/stop/global hook/upstream capacity ve canonical scope kabulü; bağımsız scheduling, kalıcı partial continuation ve provider candidate/report kapıları. 13 prewrite/tekilleştirme/iade-iptal mutabakatı ve 14 kullanıcı durağı korunur. Yeni SQL/migration/canlı DB/provider/OAuth/token/config/route/Dataset/rol mutasyonu yoktur. 26 sıra, Klaviyo rol kapsamı ve tarihsel PMax duraklaması değişmedi.

## Sıralı plan 12 — Shopify sipariş SDK/kota ve fenced istemci bağlantısı, 28 Ekim 2026

#225 `4ec0c5fe7839a621420f09267ecfc75bf2261b05` main’dedir. Hazırlanan order_headers/order_lines/order_journey sabit sorguları inactive HTTP allowlist, scope resolver ve kurulu SDK köprüsüne bağlandı. Kimlik API sürümleri aynı kalır; sipariş ailesi yalnız 2026-10’da kabul edilir. Exact query text + canonical query/variables JSON; first/after ve sabit updated_at aralığı veya Order GID biçimi doğrulanır. Ek alan, operationName, alias, ikinci sorgu, bozuk aralık/kimlik ve duplicate JSON key reddedilir. Bu sınıflandırma permission veya owner kanıtı değildir.

Üç ailenin operationKey’i birbirinden ve ürün kimliğinden ayrıdır. Her gerçek HTTP ayrı resolver/rezervasyon ve Admin point receipt ister; eksik profil başka aileden ödünç alınmaz. Resolver’a mevcut altı descriptor alanı dışında Order ID, tarih aralığı, cursor veya query gitmez. Native requested/actual maliyet gözlemi, bütçesiz sıfır HTTP ve requested aşımında stop aynı guard üzerinden korunur. Native limit veya puan tavanı seçilmedi; testteki 10/8/5 sentetiktir. Gerçek sorgu alanları ve first dahil worst-case puan profili mevcut kapıda incelenmelidir.

Aynı genuine SDK köprüsüne ayrı wrapOrders girişi eklendi; tek hook üzerinden identity/order istemcileri ayrı query allowlist kullanır. Eski wrap identity-only kalır; caller private classifier/mode seçemez, double-wrap korunur. Global setter/kurulum yapılmadı. SDK’nın gerçek hook’u yüklü değilse native callback ve lookup öncesinde durur. Native HTTP 401/403/429/500 tek stop ve güvenli hatayla kapanır; auth recovery veya tekrar yoktur.

createRefreshShopifyAdminOrderClient, ortak private builder ile doğrulanmış owner/workspace/kurulum nesli/shop/session/native fonksiyonu ve asıl provider job/window/receipt’i yakalar. Güncel Admin context/pin her lookup ve rezervasyon sonrasında doğrulanır; order API version 2026-10 zorunludur. Job provider hâlâ Meta/Google/Klaviyo’dur; dördüncü provider veya Shopify scheduler eklenmedi. Her sipariş istemcisi kendi opaque shared read execution’ını oluşturur; caller handle/guard/scopes/context/budget veremez. İlk wait sıfır kalır, sonraki wait önceki fiziksel denemeleri SDK sarmalamasında kaybetmez.

**Canlı erişim kabulü değildir.** Gerçek repository adapter/SQL Admin’i hâlâ SQL ve HTTP öncesinde reddeder. read_orders/read_all_orders, protected-data/historical kapsamı, güncel native izin preflight’ı ve gerçek erişim ayrı açık kapılardır; fenced quota context bunları ispat etmez. Yeni SQL/migration/provider/OAuth/token/config/route/Dataset/rol mutasyonu yoktur. 14’teki SQL/context/costBudget/profile/feedback/stop/global-hook değerlendirmesi korunur.

56 yeni + 691 mevcut ilgili test (747 toplam), 7 repository kontrolü ve typecheck. Gerçek kurulu SDK, üç ayrı aile, aynı hook’ta ayrım, variable capture, quota wait, asıl job capture, context/API/profile drift, gerçek adapter reddi, missing budget/aşım ve native hata testleri sentetiktir; native maliyet/izin/katalog kanıtı değildir. Resmî kaynak kontrolü 28 Ekim 2026: [SDK HTTP katmanı](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/runtime/http/index.ts), [API limitleri](https://shopify.dev/docs/api/usage/limits), [orders](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_order_SDK_quota_binding_2026_10_28`.

12 açık: native sipariş/satır/yolculuk koleksiyonu, tek total deadline/iptal/page-row-byte sınırları, parser hatasında bütün koleksiyonu kapatma ve final consistency; izin/gerçek erişim, kalıcı partial continuation, 13 prewrite/iade mutabakatı ve 14 kullanıcı durağı devam eder. Mevcut parser ayrı kalır ve authority/snapshot/yazım kanıtı üretmez. Klaviyo rol kapsamı ve tarihsel PMax duraklaması değişmez.

## Sıralı plan 12 — Shopify sipariş/satır/yolculuk sorgu ve sayfa protokolü, 28 Ekim 2026

#224 `1e1d45f719e91d64cc335ebe3da44ae389fbe93c` main’dedir. 12’nin mevcut Shopify sipariş alt işi için API 2026-10’a göre üç sabit sorgu ve yanıt protokolü hazırlandı: order_headers, order_lines, order_journey. **Bu parça HTTP okuyucusu değildir:** istek tanımı üretir, verilmiş JSON sayfasını doğrular ve sonraki sayfa tanımını hazırlar. Token, OAuth, kota, canlı SDK, yeni sorgu ailesi veya Dataset yolu açmaz. Mevcut Admin HTTP kapısı bu üç sorguyu resolver/rezervasyon/HTTP öncesinde reddetmeye devam eder.

Siparişler açık UTC anlarıyla yarı açık updated_at aralığında ve aynı sort key ile istenir; paid/platform/test/status filtresi yoktur. Bu, satış iş günü veya tüm tarihsel erişim iddiası değildir. Order ID ve LineItem ID string korunur; ürün/varyant ayrı kalır, aynı ürünlü iki satır birleştirilmez. Native Product/Variant null olduğunda satış satırı silinmez, kimlik uydurulmaz; variant-parent çelişkisi reddedilir. Child sorgusu beklenen Order ID ve gözlenen updatedAt değerine bağlanır; değişen sipariş stale_order, order=null order_unavailable olur. Aynı timestamp atomik snapshot veya yolculuğun değişmezliği kanıtı değildir.

Tutarlar native alan adları, shop/presentment para birimi ve Decimal string’leriyle korunur. originalTotalPriceSet / totalPriceSet / currentTotalPriceSet; vergi, kargo, indirim ve iade ayrı kalır. LineItem quantity/currentQuantity ayrıdır; discountedTotalSet(withCodeDiscounts: true) ve priceAfterAllDiscountsBeforeTaxesSet kendi native anlamlarında saklanır. Float, ROAS, FX, satış toplamı, iade dağıtımı veya rol hesabı yoktur. CurrencyCode ISO dışı native USDC gibi değerleri de içerebilir; token korunması FX desteği değildir. Null ve gerçek zero ayrıdır.

Üç connection kendi cursor’uyla ilerler; boolean/pageInfo/endCursor biçimi, boş+hasNext, tekrar ID/cursor döngüsü, sıralama ve aralık denetlenir. Aynı frozen request/page nesnelerine bağlı continuation yalnız tanımdır; otomatik çağrı/tekrar veya kalıcı checkpoint değildir. Yerel first 1–100, cursor 4096, text 8192 ve decimal 128 karakter sınırları native kota iddiası değildir. GraphQL kısmi hatası veya native search uyarısı boş sonuç sayılamaz. İlk/son ziyaret ve moments korunur; eksik, pending, ready ama moments eksik ve hazır boş ayrı durumlardır. Bilinmeyen moment tipi sessizce atılmaz. Kaynak/taktik tek başına paid, provider claim, reklam/mesaj ID, Advertised/Cross Sell veya kesin overlap üretmez.

Customer adı/e-posta/telefon/adres, landing/referrer veya MarketingEvent alanı istenmedi; ham hata ve beklenmeyen müşteri alanları çıktıya kopyalanmaz. Runtime authority, snapshot, aktivasyon ve yazım bayrakları false’tur. Okuma izni, 60 gün ötesi onay ve protected-data kapsamı ileride mevcut preflight üzerinden doğrulanmalıdır; boş sayfa izin kanıtı değildir.

66 yeni sentetik test ve 210 mevcut Shopify/kimlik/kota testi, 7 repository kontrolü ve typecheck ile doğrulanır. Resmî kontrol: 28 Ekim 2026 — [orders](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [LineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem), [journey](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary), [visit](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerVisit), [arama](https://shopify.dev/docs/api/usage/search-syntax), [CurrencyCode](https://shopify.dev/docs/api/admin-graphql/latest/enums/CurrencyCode), [Decimal](https://shopify.dev/docs/api/admin-graphql/latest/scalars/Decimal). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_order_read_protocol_2026_10_28`.

**12 açık:** sorguların incelenmiş puan profili/API sürümü ve SDK/guard/fenced authority bağlantısı; total deadline/iptal, page-row-byte bounds ve shared attempt’li native koleksiyon; erişim/gerçek yanıt kanıtı; partial continuation; 13’te prewrite/iade/iptal mutabakatı ve 14’teki SQL/costBudget/feedback/stop/global hook incelemesi devam eder. Bu PR yeni SQL/migration/canlı DB/provider/OAuth/token/config/route/Dataset/rol değişikliği yapmaz. 26 sıra korunur, Klaviyo rol kapsamı ve tarihsel PMax duraklaması değişmez.

## Sıralı plan 12 — Ortak veri okumasında HTTP deneme sayısı ve bekleme kanıtı, 27 Ekim 2026

#223 `ad90bb36e6bcffde44af6169c1a6af7dee18c421` main’dedir. Aynı veri okumasındaki provider ve Shopify Admin transport’ları artık açıkça verilen tek, süreç içi ve kopyalanamaz okuma handle’ında fiziksel HTTP denemelerini sayabilir. Provider çağrısı gönderildikten sonra ayrı Admin istemcisi ilk rezervasyonunda beklese bile önceki çağrı sayısı korunur; bütün iş için “hiç gönderilmedi” veya otomatik ilk sayfa tekrarı kanıtı üretilmez. İlk gerçek bekleme sıfır çağrıyla mevcut tek kullanımlık receipt’i korur.

Sayaç gerçek fetch’ten hemen önce artar; resolver/SQL lookup/rezervasyon sayısı değildir. Native hata/unknown/malformed/abort/normal wait aynı handle’ın bütün transport’larını kapatır. Rezervasyon veya pre-dispatch kontrolünde bekleyen kardeş HTTP gönderemez; gerçek rezervasyon mevcut settlement yoluyla kapanır, rate usage iade edilmez. Native hata saptanınca async stop bitmeden kapatma yapılır. Önceden gönderilmiş çağrılar geri alınmış sayılmaz; ortak kapanmadan sonra gelen başarı caller’a yayımlanmaz. Gerçek SDK özgün kota hata nesnesini ve toplam denemeyi korur.

Bu handle kota, owner veya izin otoritesi değildir; her transport kendi guard/resolver/point receipt kontrollerini sürdürür. Partner entitlement ayrı sınırdır ve bu handle’ı kabul etmez. Caller güçlü fenced factory’ye handle veremez. Bu PR yalnız ortak primitive’i ve sentetik composite testlerini hazırlar: ilk data HTTP’sinden önce tek handle oluşturan güvenilir candidate/report factory bağlantısı mevcut Admin SQL/hook/profil kapılarından sonra yapılacaktır. Handle’sız eski transport davranışı korunur.

27 yeni ve 662 mevcut ilgili test (toplam 689), 7 repository kontrolü ve typecheck geçti. Gerçek guard/resolver ile üç provider’dan Admin beklemesi, eşzamanlı lookup/reserve/pre-dispatch, devam eden HTTP, hata/feedback/settlement, aşım ve kurulu SDK sınanır. Canlı provider davranışı veya gerçek eşleme kanıtı sayılmaz. Resmî SDK kaynağı 27 Ekim 2026’da kontrol edildi: [Shopify HTTP katmanı](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/runtime/http/index.ts). Makine kaydı: `contracts/eo-05-start-brief-v1.json#shared_quota_read_execution_2026_10_27`.

12 kapanmadı: güvenilir composite bağlantı, kalıcı partial continuation, Admin SQL/atomik costBudget/profil/feedback/stop kabulü ve global hook, gerçek kaynak/namespace/izin/Merchant inventory, sipariş okuyucusu ve prewrite kontrolleri açıktır. Yeni SQL/migration/canlı DB/provider/token/config/route/Dataset/rol değişikliği yoktur. Mevcut 13/14 kapıları, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

## Sıralı plan 12 — Shopify Admin sorgu puanı rezervasyon kanıtı ve aşım kontrolü, 27 Ekim 2026

#222 `93bb2ec1ab653c068057d14d547c5caa576c878b` main’dedir. Admin HTTP transport’u artık guard’dan açık `shopify_admin_query_points` birimini ister. Aynı atomik rezervasyon yanıtında `costBudget: {unit, reservedRequestedCost}` bulunmalıdır; bu **sunucu içi SQL yanıt sözleşmesidir, Shopify alanı değildir**. Pozitif safe-integer puan tavanı doğrulanır ve pre-dispatch await’ten önce primitive olarak kopyalanır. OperationKey/attemptId/permit süre kontrolü korunur; sonradan yanıt nesnesi değiştirilerek kabul edilmiş bütçe büyütülemez.

Eksik/bozuk/yanlış birim/sıfır/negatif/string/kesir/taşan/ek alanlı bütçe; HTTP yapmadan not_sent ve settlement ile durur. Rate usage iadesi yapılmaz. Constructor, header veya request’ten cost units/limit alınmaz; store.reserve hâlâ yalnız operationKey/attemptId/lane alır. Diğer provider’lar yeni yanıt alanı istemez ve eski sıfır argümanlı run callback davranışını korur. Native query/family/scope anahtarı değişmedi.

Native yanıtta requestedQueryCost rezervasyondaki tavandan büyükse, actualQueryCost daha düşük olsa bile başarı yayımlanmaz. Actual=null olan kısmi maliyet gözlemi de geçerli requested aşımını saptayabilir; gerçek sıfır native requested/actual doğru ayrılır. Aşım yerel transport’u kapatır, mevcut owner-configured stop ile native tipli feedback kaydı denenir; ayrı quota_cost_budget_exceeded nedeni ve QUOTA_NATIVE_COST_BUDGET_EXCEEDED hatası kullanılır. Partner/Google throttle sinyali üretilmez. Feedback hatasında da stop denenir, başarı settlement’ı ve retry yoktur. Bu kontrol yanıt geldikten sonradır: ilk native maliyet değişimini önceden bilme, çağrıyı rollback etme veya önceden gönderilmiş diğer çağrıları iptal etme iddiası yoktur.

**SQL üretimi ve gerçek bütçe kabulü açık.** Mevcut SQL Admin’i/context/feedback’i kabul etmez ve costBudget üretmez; migration, limit veya native puan değeri seçilmedi. 14’teki aynı kapıda şu koşullar zorunludur: yanıt aynı atomik rezervasyonun gerçek debit’lerinden üretilir; reservedRequestedCost bütün uygulanabilir app×shop puan kapsamlarında gerçekten ayrılan miktarların hiçbirinden büyük olamaz; request sayısı veya caller değeri puan diye etiketlenmez. Kesin sorguların incelenmiş requested üst sınırı, native manual cost değişimi, tipli feedback ve ortak app×shop stop kapsamı birlikte kabul edilir. Fixed-window core native leaky bucket ile eşit sayılmaz; düşük actual cost otomatik refund/kapasite artışı sağlamaz.

28 yeni ve 571 mevcut Shopify/provider/kota/deadline testi (toplam 599), 7 repository kontrolü ve typecheck geçti. Sentetik store/receipt ile gerçek guard/resolver ve kurulu SDK üzerinde bütçesiz sıfır HTTP, receipt capture, yabancı attempt/op reddi, actual budget içine sığarken requested aşımı, kısmi/zero yanıt, feedback hatası ve tekrar çağrı yasağı sınandı. Testteki 10 puan sentetik fixture’dır, seçilmiş native limit değildir. Resmî kontrol 27 Ekim 2026: [Admin maliyet/hata yanıtı](https://shopify.dev/docs/api/admin-graphql/latest#rate-limits), [API limitleri](https://shopify.dev/docs/api/usage/limits). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_cost_budget_receipt_2026_10_27`.

12 tamamlanmadı. Admin SQL/atomik receipt/native profil/feedback/stop kabulü, canlı SDK kurulumu/diğer auth yolları, gerçek kaynak/namespace/izin ve Merchant SQL kanıtları, provider aday/Meta rapor bağlantısı, kalıcı work-wait/partial continuation ve sipariş okuyucusu açıktır. Yeni SQL/migration/canlı DB/provider/token/config/route/Dataset/rol mutasyonu yoktur; 13/14 kapıları, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

## Sıralı plan 12 — Shopify Admin kimlik istemcisinde fenced iş kaydı bağlantısı, 27 Ekim 2026

#221 `b1d991455fa0d2990c676bc81e626bf5069ec960` main’dedir. Yeni inactive `createRefreshShopifyAdminIdentityClient`, doğrulanmış aktif Shopify owner/workspace/kurulum nesli ve aynı mağazayı gösteren shop GID/domain/id-token session bilgisini mevcut fenced provider işiyle eşleştirir. Tek geçerli iş günü ve observed receipt zorunludur. Owner/shop/session, iş kaydı/gün/receipt ve native graphql fonksiyonu async işten önce yakalanır. Receipt timestamp’ı tek başına entitlement kanıtı sayılmaz; güncel yetki SQL bağlamından gelmelidir.

Asıl Meta/Google/Klaviyo job provider/account/fence alanları korunur; `shopify_admin` yalnız istenen kota hedefidir, yeni iş provider’ı değildir. Ortak helper’a yalnız bu constructor’ın kullanabildiği private Admin seçeneği eklendi; diğer public provider factory’leri bu seçeneği açamaz. Kullanıcı guard/resolver/context-loader/authorizeRead veremez. Aynı quotaStore hem gerçek guard hem resolver içindir. Her lookup ve rezervasyon sonrası workStore.loadQuotaContext asıl claim/window/receipt ve Admin hedefiyle tekrar çağrılır; Admin context provider/domain doğrulanır, app/connection epoch/API pin değişirse HTTP gönderilmez. Partner veya reklam hesabına fallback yoktur.

SDK köprüsü için yerel brand zorunludur; sahte wrap nesnesi kabul edilmez. Köprü artık native graphql fonksiyonunu çağırmadan hemen önce kurulu SDK abstractFetch’in tam bu hook olduğunu kontrol eder. Eksik/farklı kurulumda **önce native çağrı yapıp sonra tespit etmek yerine**, SDK fonksiyonu, SQL lookup ve HTTP başlamadan durur. Bu yalnız kontrol ekler; uygulamaya global setter/fetch patch veya canlı adaptör kurulumu yapılmadı. Mevcut üç sorgu, child signal/deadline, hata/wait sonrası kapanma, eşzamanlı çağrı yasağı ve her ardışık sorgunun ayrı kota rezervasyonu korunur.

**Repository/SQL kapısı açıktır.** Mevcut createRefreshWorkRepository hâlâ Admin target’ını JS adaptöründe reddeder; bu gerçek adaptörle test edildi ve SQL/native HTTP çağrısı sıfır kaldı. JS/SQL provider/context/inventory/typed-feedback/cost-budget/overrun değişikliği burada yapılmadı; 14’teki aynı inceleme kapısındadır. Canonical kurulum PK’si veya gerçek app×shop/kota/izin bağı üretilmez. Mevcut kaynak gözlemi tarihsel ürün gösterimi veya Shopify mapping/Advertised-Cross Sell kanıtı olmaz.

33 yeni ve 538 mevcut Shopify/provider/kota/deadline testi (toplam 571), 7 repository kontrolü ve typecheck geçti. Yeni giriş kurulu React Router 3.0.1/Shopify API 15.0.0, gerçek candidate verifier/guard/resolver ve sentetik work-context/store/HTTP ile sınandı: orijinal job/receipt taşınması, capture, yanlış mağaza/API/provider, kaybolan yetki, app/epoch drift, ilk wait, native 401’de auth recovery olmaması, geç context dönüşünde timeout ve yanlış/eksik SDK hook öncesi sıfır çağrı. Resmî kontrol 27 Ekim 2026: [SDK factory](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/src/server/clients/admin/graphql.ts), [Admin maliyet/hata yanıtı](https://shopify.dev/docs/api/admin-graphql/latest#rate-limits). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_fenced_identity_client_2026_10_27`.

12 tamamlanmadı. Admin JS/SQL/cost bütçesi ve canlı SDK kurulumu/diğer auth yolları, gerçek profiller/kaynak/namespace kanıtı, Merchant SQL envanteri, provider aday/Meta rapor bağlantısı, kalıcı work-wait/partial continuation ve sipariş okuyucusu açıktır. Yeni SQL/migration/canlı DB/provider/token/config/route/Dataset/rol mutasyonu veya aktivasyon yoktur; 13/14 kapıları, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

## Sıralı plan 12 — Shopify Admin gerçek SDK–HTTP kota köprüsü, 27 Ekim 2026

#220 `8446a98faf8acf358feee909a7349f8ed6d1c3bc` main’dedir. Yeni inactive `createShopifyAdminIdentitySdkBridge`, açıkça kurulabilecek fetch hook’u ve mevcut Admin client için wrapper döndürür. Uygulama bootstrap’ına global setter/fetch patch eklenmedi; canlı SDK adaptörü veya route/config değişmedi. Hook yalnız AsyncLocalStorage ile o sorguya bağlanan Admin managed transport’a gider; bağlamsız/kapalı çağrı için fallback yoktur.

Kurulu React Router 3.0.1 ve Shopify API 15.0.0’ın gerçek Graphql client/factory/error-handler zinciriyle sentetik HTTP üzerinde doğrulandı. Mevcut ürün/varyant verifier’ın sorgusu alttaki fiziksel HTTP’ye ulaştı, aynı gerçek shared guard/resolver bir rezervasyon/settlement yaptı. Yalnız üst graphql callback’i sahteleyip geçildiği iddia edilmedi. Test worker’ında SDK setter’ı kurulur ve test sonunda geri alınır; uygulama kodunda kurulum yoktur.

Transport brand’i WeakMap’te provider’a bağlandı; bu yalnız yerel transport inşasının kanıtıdır, yetki/limit değildir. Wrapper plain/fake/Partner transport’u ve iki kez sarılmış client’ı reddeder. Sorgu/variables ve native fonksiyon async işten önce yakalanır; yalnız üç mevcut kimlik sorgusu, tries=1 ve AbortSignal kabul edilir. Header/API-version/body/retry override yoktur. Aynı wrapper’da eşzamanlı sorgu engellenir; farklı execution’lar kendi app×shop transport’larını korur.

Bir graphql çağrısı tam bir guarded HTTP girişine sahip olmalıdır. SDK ikinci/gizli HTTP denemesi yaparsa yeni quota lookup/rezervasyon/gönderim olmadan durur; SDK hatayı yutsa bile latch başarıyı engeller. Hook’tan geçmeyen yanıt başarılı kimlik kanıtı sayılamaz. Native non-2xx yanıtta quota stop sonrasında SDK’ya native 401/403 verilmeden güvenli hata üretilir; gerçek React Router handler’da auth onError ve ikinci çağrı çalışmadı. Bu, canlı auth/session iş akışlarının tamamının incelendiği anlamına gelmez.

Genuine quota wait/not-configured/not-sent bilgisi SDK sarılmadan önce tutulur ve özgün obje/priorBoundaryAttempts ile geri çıkarılır. İlk hata/wait/deadline wrapper’ı kapatır, sessiz replay yoktur. Önceki sorgusu gönderilmiş bekleme tüm işi gönderilmemiş sayamaz; bilinmeyen dış hata quota wait olmaz. Constructor ve çağrı iptalleri birleştirilir, child signal fiziksel fetch’e verilir. Her SDK çağrısı mevcut deadline yardımcısıyla sınırlanır; **koleksiyonun mevcut toplam deadline’ı ayrıca korunmalı**, burada yenilenmiş toplam koleksiyon bütçesi iddiası yoktur. Geç context/native dönüşü wrapper’ı yeniden açamaz; dış çağrı rollback/SQL sonlandırma iddiası yoktur.

35 yeni gerçek-SDK/sentetik-HTTP testi ve 495 mevcut Shopify/provider/kota/deadline testi (toplam 530), 7 repository kontrolü ve typecheck geçti. Resmî kontrol 27 Ekim 2026: Shopify SDK [Graphql client](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/clients/admin/graphql/client.ts), [runtime HTTP](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/runtime/http/index.ts), [React Router factory](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/src/server/clients/admin/graphql.ts), [paket belgeleri](https://shopify.dev/docs/api/shopify-app-react-router/latest), Node [AsyncLocalStorage](https://nodejs.org/api/async_context.html) ve [AbortSignal.any](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_SDK_quota_bridge_2026_10_27`.

12 tamamlanmadı: açık global SDK hook kurulumu/diğer auth-foreground yolları, fenced Admin constructor ve gerçek app×shop/kurulum/entitlement SQL bağı, 14’teki Admin provider/context/cost feedback/reserved-cost/overrun ve Merchant SQL envanteri, gerçek profiller/kaynak/namespace kanıtı, aday/Meta rapor bağları, kalıcı work-wait/partial continuation ve sipariş okuyucusu açıktır. Yeni SQL/migration/canlı DB/provider/token/config/route/Dataset/rol değişikliği yok; 13/14 kapıları, Klaviyo rol kapsamı ve tarihsel PMax duraklaması korunur.

## Sıralı plan 12 — Shopify Admin kimlik HTTP sınırı ve native maliyet gözlemi, 27 Ekim 2026

#219 `6ea52572bfa56d9c9f4f27fd94c4f80385164860` main’dedir. Shopify Admin GraphQL, Partner request kotasından ayrı `shopify_admin` transport/scope ailesi olarak yalnız mevcut tekil Product, Variant ve Product+Variant kimlik doğrulama sorgularını tanır. Mevcut sorgular aynı içerikle frozen ortak sabite taşındı; alan, ürün listesi, sipariş sorgusu veya mutation eklenmedi. POST, kesin myshopify host/admin quarterly API path ve canonical JSON/query/variables/GID biçimleri zorunludur; duplicate JSON/ek alan/başka operation/selector/modifier açılmaz. 65536 karakter gövde sınırı yerel korumadır, Shopify limiti iddiası değildir.

Yedi alanlı güvenilir context’in ayrı Admin app-client/kurulum connection-epoch/mağaza domaini/API sürümü/family bağı route hash’e girer. Domain path’te gözlenir ama gerçek app/shop/kurulum/entitlement yetkisi değildir; güvenilir SQL kaynağı zorunludur. Resolver/store’a query, Product/Variant GID, token veya response satırı gitmez. Her fiziksel HTTP gerçek shared guard üzerinden ayrı rezervasyon/settlement ister; app×shop maliyet politikaları native kapsamı doğrulanarak aileler/consumer’lar arasında paylaşılmalıdır. Partner havuzuna fallback yoktur.

Native extensions.cost yalnız yedi tipli alana projekte edilir: kind/httpStatus/requestedQueryCost/actualQueryCost/maximumAvailable/currentlyAvailable/restoreRate. observed, missing, invalid ve partial ayrı kalır; actual=null gerçek sıfır olmaz, kesirli restoreRate korunur. Eksik/geçersiz/kısmi cost başarılı sonuç yayımlayamaz. Bunlar gözlemdir: kapasite artırma, bütçe verme, native refund taklidi, otomatik bekleme/tekrar veya stop temizliği yapılmaz. HTTP 200 GraphQL hata/bozuk errors ve non-2xx ilk yanıtta durur; Admin THROTTLED/429 Partner shared throttle sinyaline çevrilmez. Feedback kaydı başarısızsa başarı yayımlanmaz; bilinmeyen dış çağrı gönderilmemiş sayılmaz.

**SQL/SDK bağlantısı henüz tamamlanmadı.** Mevcut SQL provider constraint/context loader ve feedback storage Admin’i kabul etmez; yeni migration/SQL/config eklenmedi. 14’teki aynı inceleme kapısına açıkça eklendi: owner app×shop inventory, fenced context, tipli cost receipt storage, her kesin sorgu için doğrulanmış requested-cost rezervasyon üst sınırı/overrun davranışı ve ortak cost politikaları. Sayısal native limit veya cost units seçilmedi. Mevcut fixed-window core native leaky bucket ile aynı ilan edilmez; doğru native cost bütçesi kabul edilmeden aktivasyon yoktur.

Kurulu React Router 3.0.1 client factory’sinde tries:1 → retries:0 görüldü; fakat hata handler’ı/gerçek fiziksel HTTP hook’u ayrıca doğrulanmalıdır. Yalnız admin.graphql fonksiyonu etrafına wrapper koymak tamamlanmış HTTP kota bağlantısı sayılmadı. Provider constructor’ları Admin aday/Meta rapor modlarına açılmadı, aktif runtime sessizce değiştirilmedi. Fenced Admin constructor ve gerçek SDK hook sonraki aynı 12 kapsamındadır.

54 yeni ve 487 mevcut Shopify/provider/kota testi (toplam 541), 7 repository kontrolü ve typecheck geçti. Somut mevcut aday verifier’ın üç sorgusu gerçek guard/resolver + sentetik store/HTTP Response üzerinden sınandı; bu canlı SDK/DB veya kaynak eşleme kanıtı değildir. Resmî kontrol 27 Ekim 2026: [API limitleri](https://shopify.dev/docs/api/usage/limits), [Admin maliyet ve hata yanıtı](https://shopify.dev/docs/api/admin-graphql/latest#rate-limits), [Product](https://shopify.dev/docs/api/admin-graphql/latest/queries/product), [ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant), [Admin client](https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_Admin_identity_quota_boundary_2026_10_27`.

12 tamamlanmadı. Admin SQL/SDK/cost budget ve aday/rapor bağları, Merchant SQL envanteri, gerçek owner/kaynak/namespace kanıtları, kalıcı work-wait/partial continuation ve Shopify sipariş okuyucusu açık; 13 yazım öncesi/14 scoped SQL/kalıcı tablo kapıları korunur. Canlı DB/provider/token/config/route/Dataset/rol değişikliği veya aktivasyon yoktur. Klaviyo rol kapsamı ve tarihsel PMax duraklaması değişmez.

## Sıralı plan 12 — Google native kimlik okuyucusunda iş kaydına bağlı kota constructor’ı, 27 Ekim 2026

#218 `b58a8ecf4d0fbaf20bee065510c829a5c5ff94be` main’dedir. Yeni inactive `createRefreshGoogleIdentityReader`, mevcut somut Google SQL/vault → native Ads link → Merchant products → native Ads link zincirini tek günlük fenced Google işi, doğrulanmış aktif Shopify owner/workspace/kurulum nesli ve SQL’den her sınırda yenilenen claim/window/entitlement kota context’iyle bağlar. Receipt zamanı tek başına entitlement kanıtı değildir.

Ads müşteri kimliği, varsa login manager, hedef Merchant ve gerçek kota hesabı ayrı kalır. Merchant hedef/kota hesabı/products-v1/epoch bilgisi yalnız güvenilir workStore context’inden gelir; caller merchant/quotaAccountId veya key tahmini kabul edilmez. Hedef constructor’daki merchantId ile bütün çağrılarda eşleşir. Eksik/uyumsuz/bozuk Merchant envanteri ilk Ads HTTP’sini bile engeller. Mevcut SQL load_refresh_quota_context bu envanteri henüz döndürmez; scoped inventory/epoch okuması 14 inceleme kapısındadır, burada SQL/migration eklenmedi. Nesne biçiminin geçmesi gerçek native bağ kanıtı değildir.

Meta/Klaviyo ile private transport helper paylaşılır; aynı quotaStore guard ve resolver içindir. Ads link ile Merchant listelemesi ayrı operation key alır; her Ads/Merchant sayfası ayrı rezervasyon/settlement ister. Hedef, developer token, owner/shop/session/Admin fonksiyonu ve iş kaydı/gün/receipt constructor’da yakalanır. Parametresiz readEvidence bir kez çalışır; override/eşzamanlı replay/hata veya wait sonrası tekrar yoktur. Mevcut native scopes/token ve account/manager/link-before/link-after kontrolleri korunur.

Bu giriş yalnız native moddur; Shopify Admin aday modu ve sourceRules ayrı Admin kota bağlantısını bekler. İlk genuine wait mevcut work-wait kanıtına çevrilebilir; Merchant wait önceki Ads çağrısını korur, işi gönderilmemiş diye yeniden başlatamaz. İlk native hata veya rezervasyonda owner/account/epoch/target/quota-pool değişimi yeni gönderimi durdurur; retry/refresh/fallback/kısmi başarı/kalıcı queue-resume eklenmedi. Merchant 429, Ads ortak kota sinyaline çevrilmez.

39 yeni sentetik test; job/entitlement, gerçek ortak guard/resolver, ayrı Ads/Merchant route, capture/replay, eksik envanter/profil, paging, pool/epoch drift, native ilişki reddi/hata ve geç context dönüşünde iptal sınırlarını kapsar. 39 yeni ve 380 mevcut Google/Meta/Klaviyo/kota/deadline testi (toplam 419), 7 repository kontrolü ve typecheck geçti. Resmî kontrol 27 Ekim 2026: [products.list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list), [kota ve hesap hiyerarşisi](https://developers.google.com/merchant/api/guides/quotas-limits/quotas), [Ads ProductLink](https://developers.google.com/google-ads/api/reference/rpc/v25/ProductLink). Native sorgu/alan/izin değişmedi; gerçek limit/profile yapılandırılmadı. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_identity_quota_constructor_2026_10_27`.

12 tamamlanmadı: Merchant güvenilir envanter/scoped SQL, gerçek owner profilleri ve erişim/kaynak kanıtı, ayrı Shopify Admin kota ve aday/rapor modları, kalıcı work-wait/partial continuation ve Shopify sipariş okuyucusu açık. Native link Shopify eşlemesi veya satış rolü kanıtı olmaz; persistable=false ve eksik canonical kurulum PK’si korunur. 11’in kanıtları, 13 yazım öncesi ve 14 scoped SQL/kalıcı tablo kapıları korunur; canlı DB/provider/token/config/route/Dataset/rol mutasyonu yoktur. Klaviyo rol kapsamı ve tarihsel PMax duraklaması değişmez.

## Sıralı plan 12 — Meta native kimlik okuyucusunda iş kaydına bağlı kota constructor’ı, 27 Ekim 2026

#217 `93afdaa64c9f675a845a861e54bc1952164b30da` main’dedir. Yeni inactive `createRefreshMetaIdentityReader`, mevcut native Meta kimlik koleksiyonunu doğrulanmış aktif Shopify owner/workspace/kurulum nesli, tek günlük fenced Meta işi ve SQL’den her sınırda yenilenen claim/window/entitlement kota context’iyle bağlar. Receipt zamanının varlığı güncel entitlement kanıtı değildir; kontrol mevcut SQL’dedir. Provider/hesap iş kaydıyla eşleşir; rezervasyon sonrası context yeniden doğrulanır ve pin değişirse HTTP gönderilmez.

Klaviyo ile yalnız private transport helper paylaşılır; aynı quotaStore resolver ve guard içindir. Token inspection, Ad/AdSet/creative/product-set/katalog okumaları ve her katalog devam sayfası ayrı rezervasyon/settlement alır. Owner/shop/session/Admin fonksiyonu, claim/window/receipt ve Meta hedef/config bilgisi constructor’da yakalanır. Parametresiz readEvidence bir kez çalışır; hata/wait sonrası gizli tekrar veya eşzamanlı replay yoktur. Çağıran guard/resolver/context loader veya authorizeRead veremez.

Bu giriş yalnız native koleksiyonu açar. Shopify Admin aday ve Insights rapor modları ayrı Admin kota bağlantısını bekler; source/report rule ve mode override kabul edilmez. Mevcut somut SQL/vault ve native app/grant/expiry, hesap/üst hiyerarşi/katalog kontrolleri korunur. Katalog bağı Insights ürün namespace’i, tarihsel ürün gösterimi veya Advertised/Cross Sell kanıtı değildir; canonical kurulum PK’si üretilmez, persistable=false kalır.

31 yeni sentetik test ve mevcut Meta/Klaviyo/kota/deadline regresyonları; ilk/orta wait, authority/account/epoch drift, capture, replay, eksik profil, native hata/grant, sayfalama ve geç context dönüşünde iptal sınırlarını kapsar. İlk wait mevcut work-wait kanıtı olabilir; ortadaki wait önceki denemeleri korur, bütün işi gönderilmemiş sayamaz. Kalıcı queue/resume eklenmedi.

Resmî kontrol 27 Ekim 2026: Meta SDK [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py) ve [ProductCatalog](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productcatalog.py). Native sorgu/alan/izin/limit değişmedi; gerçek owner profili veya politika yapılandırılmadı. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_identity_quota_constructor_2026_10_27`.

12 tamamlanmadı: Google constructor/Merchant SQL envanteri, ayrı Shopify Admin kota ve aday/rapor modları, gerçek profiller/erişim kabulü, kalıcı work-wait/partial continuation ve Shopify sipariş okuyucusu açık. 11’in kaynak/namespace kanıtları, 13 yazım öncesi ve 14 scoped SQL/kalıcı tablo inceleme kapıları korunur. Yeni SQL/canlı DB/provider/token/config/route/Dataset/rol mutasyonu veya aktivasyon yok; Klaviyo rol araştırması ve tarihsel PMax duraklaması korunur.

## Sıralı plan 12 — Klaviyo kimlik okuyucusunda iş kaydına bağlı kota constructor'ı, 27 Ekim 2026

#216 `c11044c050ffca836b2502c66a1e2817d8dbf3d8` main'dedir. Yeni, production'da aktif olmayan `createRefreshKlaviyoIdentityReader`; somut SQL/vault kimlik okuyucularının native ve Message modlarını mevcut background claim/window/entitlement kota yetkisine bağlar. Tek gün ve açık mod seçimi gerekir; verified aktif Shopify workspace/kurulum nesli iş kaydıyla eşleşir. Native hesap, metric, event ve Campaign/Flow raporu çağrıları mevcut revision/include bilgisiyle her HTTP/sayfa için ayrı ortak guard rezervasyonundan geçer.

Mevcut background quota context/pin kodu ortak private helper olarak paylaşılır; eski ordinary client davranışı korunur. Context her lookup ve rezervasyon sonrası mevcut SQL `loadQuotaContext` üzerinden claim/fence/window/entitlement ile yeniden okunur; provider/hesap claim ile eşleşmelidir. Aynı quotaStore hem resolver hem guard içindir. Native collector'ın mevcut kurulum/lifecycle/account/vault denetimleri devam eder. Çağıran `loadContext`, sabit resolver/guard veya çift debit üreten `authorizeRead` veremez. Receipt timestamp'ının bulunması tek başına güncel entitlement kanıtı değildir; gerçek kontrol SQL'dedir.

Owner/shop/session/Admin fonksiyonu ve claim/window/receipt constructor'da yakalanır. `readEvidence()` parametre almaz ve aynı instance bir kez çalışır; hata veya kota wait sonrasında sessiz replay yoktur. Native mod raporları açamaz. Bu constructor **Shopify Admin modunu açmaz**; üçüncü düşük seviyeli aday okuyucusu ayrı Admin kota kapısını bekler. Mevcut Assisted/Triggered/Unclassified ve rapor istatistiğinin ürün satışı sayılmaması korunur; Advertised/Cross Sell araştırması yeniden açılmadı.

İlk HTTP öncesi genuine quota wait, mevcut work-wait kanıtına çevrilebilir. Ortadaki wait önceki çağrı sayısını korur ve bütün koleksiyonu “gönderilmedi” diye baştan oynatamaz; kalıcı queue/resume bağlantısı eklenmedi. Ortak transport'a ilk async scope lookup dönüşünden sonra da iptal kontrolü eklendi: deadline/abort olmuş geç context dönüşü yeni rezervasyon veya HTTP başlatamaz. İlk hata, authority kaybı veya eksik profil; refresh/retry/fallback/kısmi başarı olmadan durur.

30 yeni ve 143 mevcut Klaviyo/kota regresyon testi; 7 repository kontrolü ve typecheck geçti. DB'siz sentetik profile/store/HTTP Response ile gerçek shared guard/resolver, somut native SQL/vault ve background iş-context bağı sınandı. Resmî kontrol 27 Ekim 2026: Klaviyo [Accounts](https://developers.klaviyo.com/en/reference/get_accounts), [Events](https://developers.klaviyo.com/en/reference/get_events), [Campaign](https://developers.klaviyo.com/en/reference/query_campaign_values), [Flow](https://developers.klaviyo.com/en/reference/query_flow_values), [kota ve OAuth app ayrımı](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling). Native limit/policy/app-account profili yapılandırılmadı; mevcut sorgu/alan/izinler değiştirilmedi. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_identity_quota_constructor_2026_10_27`.

12 tamamlanmadı: gerçek owner scope/profiller ve erişim/metric/variant/report completion kabulü, Shopify Admin kota ve üçüncü mod, Meta/Google constructor bağları/Merchant SQL envanteri, güvenli partial continuation/kalıcı work-wait ve Shopify sipariş okuyucusu açık. 11'in kaynak kanıtları, 13 yazım öncesi ve 14 scoped SQL/kalıcı tablo inceleme kapıları korunur. Yeni SQL/canlı DB/provider/token/config/route/Dataset/rol değişikliği veya aktivasyon yoktur; tarihsel PMax duraklaması devam eder.

## Sıralı plan 12 — Google Merchant hedefi ve gerçek kota hesabını ayrı bağlama, 27 Ekim 2026

#215 `f4979b0e88aa792bfabd8d7fad4263592f98eba3` main'dedir. Kota transport'u mevcut Merchant ürün okuyucusunun kesin `GET /products/v1/accounts/{id}/products?pageSize=1000` çağrısını `merchant_products` ailesi olarak tanır. Yalnız opsiyonel `pageToken` kabul edilir; başka host/sub-API/sürüm/edge/method/gövde/selector/duplicate query açılamaz. Sayfalama ve ham ürün kaydı değişmedi. Her HTTP sayfası ayrı rezervasyon ister.

Merchant descriptor'ında `accountId` gerçek hedef Merchant ID, `version` `products/v1` olur. Bunlar Ads müşteri kimliği veya Ads API sürümü değildir. Mevcut yedi alanlı scope context korunur; yalnız Google'a ait opsiyonel `merchant` nesnesi dört kesin alan ister: `targetAccountId`, `quotaAccountId`, `apiVersion`, `bindingEpoch`. Native hedef, güvenilir context hedefiyle birebir uyuşmalıdır. Eksik bağlam/quota hesabı/epoch veya yanlış sürüm fail-closed; sayısal kimlikler aynı görünse bile Ads hesabından Merchant bağı üretilmez.

Resmî Merchant kotası, kullanılan kimlik doğrulamasına göre hedef alt hesaptan farklı bir üst hesabın havuzuna yazılabilir. Bu nedenle `quotaAccountId` hedef kopyası değildir; gerçek kimlik doğrulama/kota hesabına ait incelenmiş envanterden gelmelidir. Mevcut SQL `load_refresh_quota_context` bu yeni envanteri döndürmez. Scoped okuma/owner inventory/epoch tasarımı 14'teki mevcut inceleme kapısına bağlı kalır; migration veya canlı kayıt eklenmedi. Bir string/context nesnesi veya sentetik test native bağın kanıtı değildir.

Merchant route hash; mevcut Ads/client/connection kimliği yanında hedef Merchant, gerçek kota hesabı, Merchant sürümü ve binding epoch'u taşır. Ads reporting/OAuth route anahtarları byte-for-byte korunur; Merchant için onaylı ayrı tam owner profili yoksa Ads bütçesine fallback yapılamaz. Background execution pin'i opsiyonel Merchant bağını da kanonik alan sırasıyla kilitler; bu bağ rezervasyonda değişirse OAuth/Ads çağrısı da gönderilmez. SQL lookup hâlâ yalnız route hash/connection handle/provider alır; token/query/cursor/GAQL/ürün satırı gönderilmez.

35 yeni ve 243 mevcut Google/Meta/kota sentetik testi geçti. Somut SQL/vault/native Ads link → Merchant → Ads link zinciri gerçek ortak guard/resolver ve sentetik profile/store/HTTP Response ile sınandı; eksik bağ veya profil Merchant HTTP'sini engeller, ilk Ads okuması gerçekleşmişse gizlenmez. Kota wait önceki Ads denemesini korur; pool/epoch değişimi rezervasyonu settlement ile gönderimsiz bitirir. Merchant 429, Ads ACCOUNT/DEVELOPER ortak kota sinyaline çevrilmez; ilk hatadan sonra retry/refresh/fallback/Ads link tekrar çağrısı yoktur. 7 repository kontrolü ve typecheck geçti.

Resmî kontrol 27 Ekim 2026: [Merchant products.list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list) ve [kota tahsisi/metot grupları](https://developers.google.com/merchant/api/guides/quotas-limits/quotas). Gerçek günlük/dakikalık limit, quota group veya native policy değeri seçilmedi; credential/account/pool kanıtı ve owner profil kabulü açıktır. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_Merchant_identity_quota_2026_10_27`.

12 tamamlanmadı: güvenilir native envanter ve identity constructor/dispatch/normal work-wait, Klaviyo constructor ve Partner'dan ayrı Shopify Admin kota bağlantısı, Shopify sipariş/LineItem/journey okuyucusu açık. 11'in gerçek kimlik kanıtları, 13 yazım öncesi ve 14 scoped SQL/kalıcı tablo inceleme kapıları korunur. Yeni SQL/canlı DB/provider/token/config/route/Dataset/rol değişikliği veya aktivasyon yoktur; tarihsel PMax duraklaması devam eder.

## Sıralı plan 12 — Meta kimlik çağrılarının kota aileleri, 27 Ekim 2026

#214 `47b898144daf29c3dcae2fafbb84d544b94e2d55` main'dedir. Mevcut native kota transport/scope resolver, Meta'nın Ad, AdSet, creative, product-set ve katalog ürün okumalarını beş ayrı çağrı ailesi olarak tanır. Bunlar yalnız mevcut okuyucuların kesin GET/numerik node veya catalog products yolu/alan kombinasyonlarıdır; genel Graph erişimi açılmaz. Bilinmeyen/expanded/duplicate alan, ek query modifier, GET gövdesi veya yanlış method/edge resolver'dan önce reddedilir. Katalogda mevcut beş alan ve `limit=100` korunur; `after` ile sonraki sayfa da ayrı HTTP rezervasyonu ister.

Object/katalog kimliği Ads hesabı kabul edilmez; descriptor'da account null kalır. Hesap/client/connection epoch/Graph sürümü güvenilir sunucu context'inden gelir. Her aile ayrı route key alır, mevcut owner tarafından onaylanmış tam kota profili yine zorunludur. Query/alan/cursor/token/body/header veya katalog/ürün kimliği resolver'a gönderilmez; SQL lookup yalnız hash/connection handle/provider alır. Çağrı şeklinin tanınması native yetki veya eksiksiz native kota kapsamı kanıtı değildir; gerçek limit, units, business/catalog paylaşımlı kota/feedback değeri uydurulmadı, owner profili eklenmedi.

Ortak kota transport'unda rezervasyon veya async dispatch-context kontrolü beklerken iptal gelmesi de kapatıldı: child signal/closed durumu kontrol öncesi ve sonrası denetlenir, HTTP çıkmadan rezervasyon settlement olur ve `not_sent` korunur. Bu kontrol bütün mevcut managed transport'larda geçerlidir; yeni retry/refresh/fallback yoktur. Gerçek provider hatası veya önceden gönderilmiş istek bilinmiyor ise bu iptal kuralıyla yeniden sınıflandırılmaz.

30 yeni ve 149 mevcut Meta/kota sentetik testi geçti. Gerçek ortak guard/scope resolver ile somut SQL/vault kullanan Meta koleksiyonları, sentetik kota store ve HTTP Response üzerinden sınandı: her çağrı/sayfa ayrı debit/settlement, eksik profil sıfır HTTP, rezervasyon sonrası hesap/epoch drift sıfır gönderim, katalogda quota wait önceki beş çağrıyı gizlemez, ilk provider hatası tek stop üretir. Bu DB'siz sınama gerçek native limit/profil veya production bağlama kabulü değildir. 7 repository kontrolü ve typecheck de geçti. Resmî kontrol 27 Ekim 2026: Meta SDK [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py), [AdSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [AdCreative](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py), [ProductSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productset.py), [ProductCatalog](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productcatalog.py). Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_identity_quota_families_2026_10_27`.

12 tamamlanmadı: güvenilir identity constructor/scope-context/owner profil bağlantıları, Google Merchant hedef kota scope ve aileleri, Klaviyo constructor bağlama, Shopify Admin'in Partner'dan ayrı kota bağlantısı, kalıcı normal work-wait ve Shopify sipariş/LineItem/journey okuyucusu açıktır. 11'in gerçek kimlik kanıtları, 13 yazım öncesi ve 14 scoped SQL/kalıcı tablo inceleme kapıları korunur. Yeni SQL/canlı DB/provider/token/config/route/Dataset/rol değişikliği veya aktivasyon yoktur; tarihsel PMax duraklaması devam eder.

## Sıralı plan 12 — Kimlik koleksiyonlarında toplam süre ve iptal sınırı, 27 Ekim 2026

#213 `b094c3e4c73916059032af8b952a41a999032a36` main'dedir. 11'in kaynak/namespace/erişim kanıtı ve scoped SQL inceleme kapıları açık kalırken, sıralı 26 maddelik planın 12. adımındaki DB'siz timeout bağlantısı hazırlanır. Bu, **identity alt listesinin 12. adımına geçiş değildir**; 14'teki inceleme ve kalıcı tablo/yazım kapısı geçilmedi.

Yeni `runIdentityReadDeadline`, Google'ın iki, Meta ve Klaviyo'nun üçer mevcut kimlik toplama modunu ortak toplam timer ve child AbortSignal ile sınırlar. Mevcut `maxElapsedMs` varsayılan 120000, üst sınır 600000 korunur; bütçe her sayfa/istekte yenilenmez. Mevcut sağlayıcı saatiyle gözlemsel süre/expiry denetimleri devam eder. Callback senkron başlatıldığı için config/kural/Admin'in ilk await öncesi kopyalama/bağlama davranışı korunur. Sonuç veya hata sonrası timer ve dış iptal listener'ı temizlenir.

Hiç dönmeyen veya signal'ı dikkate almayan async dependency beklemesinde bile çağıran kod deadline/abort hatası alır. Child signal native fetch ve Shopify Admin'e yayılır; geç JSON/yanıt sonraki işi başlatamaz. Ortak authority yükleyicisinde mevcut kurulum/lifecycle/account SQL dönüşlerinin her birinin hemen sonrasına abort denetimi eklendi; vault sonrası mevcut kontrol korunur. Sorgu metni/DB arayüzü değiştirilmedi. Late promise rejection işlenir; başarı/kısmi sonuç, otomatik retry/refresh veya alternatif rota yoktur. Deadline öncesi gerçek ilk hata ve authentic quota kontrol nesnesinin kimliği korunur.

Bu mekanizma dış sunucuya gönderilmiş isteği geri almaz, çalışan SQL statement'ını zorla sonlandırmaz, senkron bloklayan JavaScript'i kesmez ve timeout'u “istek gönderilmedi” kanıtı saymaz. Gerçek kota ailelerinin/owner registry/dispatch/work-wait bağlantısının tamamlandığı iddia edilmez; mevcut desteklenmeyen native aileler kota kapısından otomatik geçirilmez. Route/aktivasyon/yeni SQL/canlı DB/provider/token/config/Dataset/rol değişikliği yoktur.

22 yeni sentetik test ve 256 mevcut collection/authority regresyonu geçti. Testler; dönmeyen fetch/JSON/Admin/SQL/vault, toplam süre, dış iptal, geç yanıt/rejection, timer/listener temizliği ve ayrı eşzamanlı koleksiyonları kapsar. Resmî kontrol 27 Ekim 2026: Node.js [AbortController](https://nodejs.org/api/globals.html#class-abortcontroller) ve [timer temizleme](https://nodejs.org/api/timers.html#cancelling-timers); runtime/dependency sürümü değişmedi. Makine kaydı: `contracts/eo-05-start-brief-v1.json#identity_execution_deadline_2026_10_27`.

11 ve 12 tamamlanmadı. 12'nin endpoint aileleri/kota scope/dispatch ve Shopify Order/LineItem/journey okuyucusu; 13 yazım öncesi; 14 scoped SQL kurulum PK/seçim epoch ve kalıcı tablo öncesi inceleme işleri açıktır. Tarihsel PMax duraklaması korunur.

## 11. adım — Meta native ürün raporu ve katalog aday referansı, 27 Ekim 2026

#212 `6389fbd43fc3642d19dabf7fadc7db72a9c01bb9` main'dedir. Yeni `collectMetaReportProductCandidateEvidence` mevcut somut SQL/vault/token/Ad-katalog/Shopify aday zincirine native ürün Insights sayfalarını ve kanıtlı namespace üzerinden katalog adayı referansını bağlar. İki eski giriş rapor okumasını kapalı, yeni giriş Shopify ve rapor okumasını açık tutar; çağırıcı bayrakları modu değiştiremez. Eski full-PK resolver zayıflatılmadı. Route veya mevcut reporting runtime yeni girişi çağırmaz.

`createMetaReportIdentityRuleLoader` varsayılan registry'si **boştur**. Native alanların veya aynı metnin varlığı namespace kanıtı sayılmaz. Sunucuya ait incelenmiş kural ilk await'ten önce kopyalanır/dondurulur; owner/nesil/connection/Meta hesabı/Ad/AdSet/Campaign/katalog/rapor ailesi/Graph sürümü ve kanıt referansı kesin eşleşir. Namespace yalnız açık `catalog_product_id` veya `retailer_id` olabilir; otomatik/numerik fallback yoktur. Rapor namespace kuralı ile retailer→Shopify biçim kuralı bağımsızdır; ikincisi ve Shopify aday kontrolü olmadan `candidate_index` atanmaz.

Mevcut `fetchMetaProductBreakdownInsightsPage` sorgusu bütün alanlarıyla aynen kullanılır: Ad seviyesi, günlük `product_id` kırılımı, dört converted alanı, impression/click/spend ve `product_id_limit=100` korunur; ürün veya Ad filtresi eklenmez. Bütün hesap raporu ham satırları ve sayfa bazlı request ID/mevcut sorgu-kota kanıtı tutulur. Yalnız gözlenen Ad hedefinin kesin native hiyerarşisi katalog bağına bağlanır; diğer Ad satırları ham raporda kalır, açıkça hedef dışı işaretlenir. Sayfa tamamlanması tüm ürünlerin eksiksiz kapsandığı iddiası değildir: mevcut 100 limiti ve `exhaustive_product_coverage_proven:false` görünür kalır.

Native hesap, geçerli günlük tarih/pencere, hiyerarşi, tekrar, sayfa/satır sınırı ve cursor döngüsü denetlenir; boş ara sayfadan devam edilir. Birden fazla katalog/feed kaydı aynı retailer kimliğine eşleşirse ambiguous kalır; ilk kayıt veya feed tahmini yapılmaz. Tam eşleşme yalnız mevcut yerel aday listesine referanstır; ham metrikler yorumlanmaz, çoğaltılmaz ve Sales Role atanmaz. Son native reklam/katalog referansı veya SQL/vault authority değişimi bütün sonucu reddeder; her istek öncesi/JSON sonrası/son dönüş kontrolleri ve gerçek local quota kontrolü korunur. İlk hata/expiry/abort sonrasında retry/refresh/kısmi sonuç yoktur.

31 yeni ve 296 mevcut Meta/Shopify/authority/reporting sentetik test, 7 repository kontrolü ve typecheck geçti. Resmî kontrol 27 Ekim 2026: [Meta resmî AdsInsights SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py) alanları ve `product_id` breakdown'ı okundu. [Breakdowns sayfası](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) 429 döndürdü; tekrar denenmedi, bundan namespace/unsupported çıkarımı yapılmadı. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_report_candidate_bridge_2026_10_27`.

**11 tamamlanmadı.** Gerçek namespace ve retailer biçimi kanıtlarının iki ayrı registry'ye kaydı, gerçek erişim/kapsam kabulü açıktır. Kodun hazırlanan referansı tarihsel ürün teslimi, sipariş/rol kanıtı veya kanonik eşleme değildir. SQL kurulum PK/seçim epoch incelemesi 14'ün mevcut kapısında; 12 quota/dispatch/inflight timeout/sipariş okuyucusu ve 13 yazım öncesi kontroller açıktır. Standart ürün/kurulum ID null, kalıcı yazım ve aktivasyon false; yeni SQL/canlı DB/provider/token/config/Dataset/rol değişikliği yoktur. Tarihsel PMax duraklaması korunur.

## 11. adım — Meta katalog kaynak kuralı ve Shopify aday kompozisyonu, 27 Ekim 2026

#211 `0c5d8e8404ee614c268a411063333053ba6882c6` main'dedir. Yeni `collectMetaVerifiedProductCandidateEvidence` aynı somut SQL/vault/native token/Ad-katalog koleksiyonunda katalog ürünleri → kanıtlı kaynak kuralı → aynı Shopify mağazasında ürün/varyant–ana ürün kontrolü → aynı native reklam/katalog referansının son kontrolünü bağlar. Native-only giriş Shopify kontrolünü zorunlu kapalı, aday girişi açık tutar; çağırıcı bayrakları bu iki modu değiştiremez. Route veya mevcut reporting runtime yeni girişi çağırmaz.

`createMetaCandidateSourceRuleLoader` varsayılan registry'si **boştur**; üretim kaynak biçimi kanıtı veya kuralı eklenmedi. Sunucuya ait incelenmiş kurallar ilk await'ten önce kopyalanır/dondurulur; yalnız factory'nin gerçek loader'ı kabul edilir. Kural; workspace, kurulum nesli, connection, Meta hesabı, katalog, varsa feed ve Shopify mağazasıyla tam eşleşir. Feed yokluğu başka feed'e fallback değildir. Aynı bağlama iki kural veya bozuk kural/kanıt baştan reddedilir. Bu owner+generation kapsamı kurulum PK'si içermez; kanonik kapsam yerine kullanılamaz. Master current_slice bu fiilî 11. adımla hizalandı; eski adım-10 etiketi kaldırıldı.

Yalnız `retailer_id` mevcut `checkedCatalogSourceRule`/`extractShopifyCandidate` koşullu biçimleriyle aday üretir. Meta iç ürün/grup kimliği, custom alan, SKU/ad veya varyant 0 varsayımı yoktur. Kural yokken `verified_source_rule_required` ve Shopify çağrısı olmadan unresolved döner. Koleksiyonun bütün kaynak kayıtlarının key/native ID/retailer/catalog/feed/ham kayıt tutarlılığı ilk Admin sorgusundan önce denetlenir. Aynı Product/Variant çifti koleksiyon içinde bir defa sorgulanır; her katalog kaydının feed'i/kuralı/kanıtı ayrı korunur.

Authenticated Admin fonksiyonu ilk await'ten önce bağlanır; SQL/vault her sorgu öncesi, JSON sonrası ve son dönüşte tekrar kontrol edilir. Shared Shopify verifier, `tries:1`, signal, gerçek quota kontrolü ve ilk hatada durma korunur. Ürün yokluğu unresolved, yanlış varyant ana ürünü conflicting kalır. Son native reklam/katalog bağı veya authority değişimi başarılı adayları da reddeder; kısmi sonuç/retry/refresh/fallback yoktur.

**Katalog eşleme adayı, Insights `product_id` eşlemesi değildir.** Yeni modül namespace seçmez, satış ürünü veya Sales Role üretmez. Eski tam-PK `resolveMetaProductIdentity` değişmedi; rapor namespace kuralı ve kaynak biçimi kuralını ayrı ayrı istemeye devam eder. `candidate_index` ve GID yalnız yerel kanıt; `standardized_product_id=null`, `installation_id=null`, `canonical_scope_ready:false`, kalıcı yazım/aktivasyon false kalır.

30 yeni ve 239 mevcut Meta/Shopify/authority sentetik test, boundary/negative kontrolleri ve typecheck geçti. Resmî kontrol 27 Ekim 2026: Meta [ProductItem](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py), Shopify [ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant). Alanların varlığı tenant'a ait retailer biçimini kanıtlamaz. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_source_rule_candidate_composition_2026_10_27`.

11 tamamlanmadı: gerçek retailer biçimi/kural kaydı, Insights namespace/rapor bağlantısı ve canlı kabul açıktır. 12 quota/dispatch/inflight timeout/sipariş okuyucusu, 13 yazım öncesi, 14 kurulum PK/Ads seçim epoch SQL incelemesi ve mevcut inceleme sonrası kalıcı mapping kapıları korunur. Yeni SQL/canlı DB/provider/token/config/Dataset/rol değişikliği yoktur; tarihsel PMax duraklaması değişmez.

## 11. adım — Meta native kimlik kaynak kompozisyonu, 27 Ekim 2026

#210 `d6645052745cfefb503390962d9dba76adfb3927` main'dedir. Yeni `collectMetaNativeIdentityEvidence` mevcut somut SQL/vault authority yükleyicisini gerçek token denetimi → Ad/AdSet/creative katalog referansı → katalog ürün sayfaları → aynı referansın tekrar kontrolü zincirine bağlar. Seçili Meta hesabı, kurulum nesli, connection sürümü, lifecycle, credential ve grant her native istek öncesi, JSON okumasından sonra ve son dönüşte yeniden denetlenir. Kaydedilmiş izinler gerçek `debug_token` yanıtındaki eksik izni tamamlayamaz. İlk hata, değişen bağ, süre veya iptal tamamlanmış sonucu durdurur; retry/refresh/fallback yoktur. Gerçek yerel quota waiting/blocked kontrolü alt reader hata temizliğinde kaybolmaz.

Eski tam kurulum PK'si isteyen girişler aynı kapıyı ve çıktı sözleşmesini korur; native algoritmalar ortak kaynak çekirdeğini kullanır. Yeni source-only çıktı `scope` taşımaz ve eski kanonik matcher'dan geçmez. Katalog ürünleri ham kimlikleriyle korunur; Shopify kimliği biçimi varsayılmaz, parsing veya Admin çağrısı yapılmaz. Native Ad–katalog referansı; ürünün teslim edildiğini, Insights `product_id` namespace'ini veya Shopify eşlemesini kanıtlamaz.

30 yeni ve 160 mevcut Meta/authority sentetik testi geçti. Resmî kontrol 27 Ekim 2026: Meta resmî SDK [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py), [AdSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [AdCreative](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py), [ProductSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productset.py), [ProductItem](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py). Mevcut alanlar/sürümler korunur. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_native_identity_collection_2026_10_27`.

**11 tamamlanmadı.** Meta kanıtlı kaynak kuralı ve Shopify aday kompozisyonu, gerçek namespace/retailer biçimi, erişim kabulü, quota/dispatch/inflight timeout ve yazım öncesi kontroller açıktır. Mevcut SQL kurulum PK'si/hesap seçimi epoch'u döndürmez; bu değişiklikler 14. inceleme kapısındadır. Gözlemsel ön/son kontroller atomic transaction/ABA koruması değildir. Route/canlı çağrı/yeni SQL/Dataset veya rol yazımı yok; `installation_id:null`, `canonical_scope_ready:false`, `persistable:false`, aktivasyon false kalır. Tarihsel PMax duraklaması korunur.

## 11. adım — Google kanıtlı kaynak kuralı ve Shopify aday kompozisyonu, 27 Ekim 2026

#209 `1f1af56d666053005b1f1b777e2d9aed34b3c1e2` main'dedir. Yeni `collectGoogleVerifiedProductCandidateEvidence`, native Ads link → Merchant ürünler → kanıtlı kaynak kuralı → aynı Shopify mağazasında ürün/varyant–ana ürün kontrolü → aynı native Ads link/authority son kontrolü zincirini hazırlar. Eski yalnız native kaynak girişi Shopify kontrolünü kapalı tutar; çağırıcı bayrakları veya kural listesi o girişte parsing açamaz. Route veya mevcut reporting runtime yeni giriş noktasını çağırmaz.

`createGoogleCandidateSourceRuleLoader` varsayılan kayıt listesi **boştur**; gerçek source format kanıtı veya production kuralı eklenmedi. Sunucuya ait incelenmiş girdiler ilk await'ten önce kopyalanıp dondurulur. Loader yalnız bu factory'den gelen gerçek nesne olabilir; dışarıdan `load` callback'i veya marker yetki sayılmaz. Kural; workspace, kurulum nesli, connection, provider, Ads hesabı, Merchant/feed/dil/dataSource/local ve Shopify mağaza kimliğine tam eşleşmelidir. Aynı bağlama iki kural, bozuk kanıt referansı veya biçim baştan reddedilir. Kural yokken `verified_source_rule_required` döner; kimliğin Shopify'a benzemesi parsing nedeni değildir.

Bu registry'nin owner+generation kapsamı bilerek kurulum PK'si içermez; sadece aday gözlemine aittir, kanonik kapsam değildir. Eski full-PK reader/matcher/resolver zayıflatılmadı ve bu kapsamla değiştirilemez. Mevcut `checkedCatalogSourceRule`/`extractShopifyCandidate` üç koşullu biçimi paylaşılır; yeni evrensel format, custom attribute/grup/SKU/ad fallback'i veya varyant 0 varsayımı yoktur. Merchant native kaydının key/offerId/resource name/feed/dil/dataSource/local tutarlılığı bütün koleksiyon için ilk Admin sorgusundan önce doğrulanır.

Kural bulunduğunda aynı authenticated Admin fonksiyonu, ilk await'ten önce bağlanan kimliğiyle mevcut Shopify doğrulayıcısına gider. Her sorgu öncesi, JSON sonrası ve son dönüşte SQL/vault authority yeniden denetlenir; `tries:1`, signal, ilk hatada durma ve gerçek local quota kontrolü korunur. Ürün yokluğu unresolved, başka ana ürün conflicting kalır. Aynı Product/Variant adayının Shopify kontrolü koleksiyon içinde cache edilir; farklı kaynak satırlarının kuralı, kaynak anahtarı ve kanıtı ayrı tutulur. Son native Ads–Merchant bağının değişmesi başarılı Shopify adaylarını da reddeder. Kısmi çıktı/retry/refresh/alternatif hesap yoktur.

Aday GID, kaynak kuralı ve `candidate_index` yerel kanıttır; DB mapping/anahtarı, gösterilen/satılan ürün veya Sales Role kanıtı değildir. Root link doğrulaması yalnız doğrudan Ads–Merchant bağıdır; aday modülü provider link iddiası taşımaz. `standardized_product_id=null`, `installation_id=null`, `canonical_scope_ready=false`, `persistable=false`, yazım/aktivasyon false kalır. Kalıcı kural/eşleme yazımı ve scoped SQL PK/Ads seçim epoch arayüzü 14'ün mevcut değerlendirme kapısındadır; Meta kompozisyonu, 12 quota/dispatch/inflight timeout/sipariş okuyucusu, 13 yazım öncesi ve gerçek izin/kaynak/namespace/metric/report kabulü açık kalır. Tarihsel PMax duraklaması korunur. SQL/canlı DB/provider/token/config/Dataset veya Sales Role değişmedi.

31 yeni ve 204 mevcut Google/Meta/Shopify/authority regresyon testi sentetik yanıtlarla geçti. Resmî kontrol 27 Ekim 2026: [Merchant processed product list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list), [Shopify ProductVariant ve ana ürün](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant). Bu kaynaklar Shopify entegrasyonunun offerId biçimi için tenant kanıtı değildir; bu nedenle varsayılan registry boş kalır. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_source_rule_candidate_composition_2026_10_27`.

## 11. adım — Google native Ads–Merchant toplamasını ortak authority yükleyicisine bağlama, 27 Ekim 2026

#208 `0251e2ba2808e68db2645e6e82f04dd798444971` main'dedir. Yeni `collectGoogleMerchantIdentityEvidence`, ortak aktif kurulum/lifecycle/hesap/vault yükleyicisini mevcut Ads `product_link` sorgusu ve Merchant ürün kaynağına bağlar. Çağırıcı `loadCurrent` ile saklanan hesabı değiştiremez. Google identity_v1, native token scope listesi/expiry ve seçili Ads manager bağlamı korunur; refresh veya grant değişimi yoktur. Her native istek öncesi, JSON alındıktan sonra ve son dönüşte aynı authority yeniden yüklenir.

Merchant kimliği hedef parametredir, yetki değildir. Seçili gerçek Ads hesabından hedef Merchant'a tekil aktif native bağ bulunmadan ürünler okunmaz. Ürün sayfaları tamamlandıktan sonra aynı native link tekrar okunur; kaybolan/değişen/belirsiz link veya değişen kurulum/hesap/manager/bağlantı/credential koleksiyonu reddeder. Başka Merchant/hesap seçilmez. Root `provider_link_verified=true` yalnız `observed_direct_Ads_Merchant_relationship_only` kapsamındadır; kampanya/ürün gösterimi veya Shopify eşlemesi kanıtı değildir. Native source okuyucusu tek başına bu link iddiasını taşımaz.

`readMerchantProductSourceSnapshot`, mevcut ürün okuyucusunun aynı native sayfalama/ürün bağlamı mantığını paylaşır. Native offerId, kaynak adı, feed/dil/dataSource/local ve ham ürün kaydı değişmeden korunur; Shopify'a benzeyen kimlikler parçalanmaz. Source-only çıktı tam provider `scope`, kurulum PK'si veya Shopify ID içermez. Mevcut `readMerchantProductIdentitySnapshot`, ilk istekten önce tam kanonik PK ve grant kontrolünü sürdürür; aynı paylaşılan kaynak okuyucusunu kullanarak eski sözleşmesini korur. Eski matcher source-only çıktıyı kanonik snapshot diye kabul etmez. Böylece SQL PK eksikliği türetilmiş veya çağırıcıdan alınmış kimlikle aşılmaz.

Ads v25 ve Merchant products/v1 sabit hedefleri, mevcut sayfa/satır/duplicate/cursor sınırları korunur. İlk native HTTP/transport/JSON hatası, iptal veya bağlam değişiminde tüm sonuç reddedilir; retry, refresh, exchange, lifecycle mutation veya alternatif rota yoktur. Yerel gerçek quota kontrolü ortak okuyucu sanitizasyonu içinde kaybolmaz. Redirect kapalı ve signal taşınır. Varsayılan 120 saniye ara gözlem kontrolüdür, atomik snapshot veya çalışan isteği kesen timeout değildir. Gerçek quota/dispatch/inflight timeout 12'de kalır.

29 yeni ve 145 mevcut Google okuyucu/link/authority/ortak Shopify aday regresyon testi sentetik yanıtlarla geçti. Production kaynak biçimi kuralı kaydedilmedi, Shopify sorgusu yapılmadı. `installation_id=null`, `canonical_scope_ready=false`, `persistable=false`, yazım/aktivasyon false kalır. 11'in Google kaynak kuralı/Admin ve Meta kompozisyonu, 14'te scoped SQL PK/Ads seçim epoch arayüzü, gerçek izin/kaynak/namespace/metric/varyant/report completion kabulü, 12/13 kontrolleri ve tarihsel PMax duraklaması açıktır. Route/SQL/canlı DB/provider/token/config/Dataset değişmedi.

Resmî kontrol 27 Ekim 2026: [Ads v25 product_link](https://developers.google.com/google-ads/api/fields/v25/product_link), [Merchant products.list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list). Product kaynak sayfası Google erişim kontrolüne yönlendi; bundan alanların unsupported olduğu sonucu çıkarılmadı. Mevcut ürün alan yorumları değiştirilmedi; bağlantı alanları, liste endpoint'i, 1000 sayfa üst sınırı, devam token'ı ve content izni bu kaynaklarda kontrol edildi. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_native_identity_collection_2026_10_27`.

## 11. adım — Klaviyo native zincirini Shopify ürün/varyant aday kontrolüne bağlama, 27 Ekim 2026

#207 `81cd976b32a0fa10a18b185a0a86a08fe309cb8f` main'dedir. Yeni `collectKlaviyoVerifiedProductCandidateEvidence` aynı native hesap/metric/event/attribution koleksiyonunu ortak Shopify Product/Variant–ana ürün kontrolüne, ardından mevcut Message kanal çözümüne bağlar. Native event/metric ilişkileri ve kaynak çelişkileri ilk Shopify sorgusundan önce kontrol edilir. Shopify hata verirse raporlara geçilmez; kısmi aday veya Message sonucu kabul edilmez.

`verifyKlaviyoProductCandidateRows`, eski Klaviyo resolver'ın aday algoritmasını paylaşır. Bu API yalnız aktif doğrulanmış mağaza/kurulum nesli ve native Shopify Ordered Product girdileriyle aynı mağazada aday gözlemi yapar; kanonik provider kapsamı veya DB PK'si üretmez. Mevcut `resolveKlaviyoProductIdentities` tam kapsamı ilk Admin çağrısından önce istemeye devam eder; aynı paylaşılan aday kontrolünü kullanarak önceki eşleme taslağı sözleşmesini korur. Eksik kurulum PK'sini aşmak için nesilden kimlik türetilmez veya dışarıdan PK alınmaz.

Authenticated Admin fonksiyonu ilk await'ten önce bağlanır. Her ürün sorgusundan önce ve native JSON alındıktan sonra ortak SQL/vault yükleyicisi aktif kurulum/bağlantı/sürüm/hesap/credential değişimini yeniden denetler. Mevcut Shopify sorgusu mağaza kimliği/domain, ürün/varyant GID/legacy kimlik ve ana ürünü karşılaştırır; `tries:1` ve iptal sinyali korunur. Ürün yokluğu unresolved, başka ana ürün conflicting kalır; ana ürün üzerine yazılmaz. Gerçek local quota kontrolü hata sanitizasyonu içinde kaybolmaz; mesaj metninden quota kontrolü üretilmez. 12. adımın gerçek quota/dispatch/inflight timeout bağlantısı bu hazırlıkla tamamlanmış sayılmaz.

Ürün/varyant kuralları değişmez: belgelenen `ProductID`/`Variant ID`, tam güvenli kimlikler, yalnız eski `VariantID` için kaynak kanıtı, SKU/ad fallback'i yok. Aynı ürün/varyant yalnız bu koleksiyonda bir kez sorgulanır; bütün kaynak event ID'leri aday kanıtında saklanır. `candidate_index` sadece yerel kanıt dizisinin referansıdır; DB anahtarı veya eşleme değildir. Native event ID ile aday kontrol sonucu Message satış satırına eklenir; adet/değer ve Assisted/Triggered/Unclassified değiştirilmez. Mevcut iki giriş noktası Shopify sorgusunu kapalı tutar; yalnız yeni giriş noktası hem Message hem Shopify kontrolünü kilitli olarak açar. Çağırıcı bayrakları bu sınırı değiştiremez.

`candidate_verified_in_shop` gerçek provider–mağaza entegrasyon bağının veya kanonik kalıcı eşlemenin kabulü değildir. Aday GID'ler ayrı kanıtta kalır; satış `standardized_product_id=null`, `installation_id=null`, `canonical_scope_ready=false`, `provider_link_verified=false`, `persistable=false`, `authorizes_activation=false` ve yazım false korunur. Route/canlı tetikleme yoktur. Tam kanonik mapping ve kalıcı yazım mevcut 14. adım değerlendirmesinden sonraki kapılardadır; scoped kurulum PK/Ads seçim epoch SQL arayüzü, Google/Meta kaynak kompozisyonu, gerçek izin/kaynak/varyant/report completion testleri, 12/13 kontrolleri açık kalır. Klaviyo Advertised/Cross Sell kapalı, tarihsel PMax duraklatılmıştır.

18 yeni ve 200 mevcut kimlik/Message/reporting/ortak Shopify–Google regresyon testi sentetik yanıtlarla geçti. Yeni SQL/migration, canlı DB/provider/token/config veya Dataset yazımı yoktur. Resmî kontrol 27 Ekim 2026: [Product](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product), [ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant), [Klaviyo Shopify referansı](https://help.klaviyo.com/hc/en-us/articles/115005080447). Shopify nesneleri `read_products` ister; bu kod yeni grant veya taze scope introspection kabulü üretmez. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_Shopify_candidate_composition_2026_10_27`.

## 11. adım — Klaviyo kimlik kaynağı ve Message kanal kompozisyonu, 27 Ekim 2026

#206 `c548630377acd20494ef1dbd1b7b0bd12853fd13` main'dedir. Yeni `collectKlaviyoIdentityMessageEvidence`, aynı native toplama çalıştırmasında mevcut Campaign/Flow values raporları ve Message çözümleyicisini bağlar. Tek ortak aktif kurulum/lifecycle/hesap/vault yükleyicisi her native çağrıdan önce ve sonunda yeniden denetlenir. Mevcut yalnız-kimlik giriş noktası rapor sorgusu eklemez; iki public giriş noktası kendi modunu kilitler, çağırıcı `withMessages` alanıyla kapsamı değiştiremez.

Native metric koleksiyonundan Ordered Product event'ler için, Placed Order mevcut values raporları için benzersiz seçilir. Campaign/Flow raporları aynı native hesap timezone'u ve iş gününde mevcut builder'ların Message/parent/medium/variation gruplamalarıyla okunur. Placed Order rapor istatistikleri normalize edilse de dönen kanal kataloğundan çıkarılır; ürün satış adet/değerine eklenmez. Satış kaynağı yalnız Ordered Product event özellikleri kalır. Aynı korunmuş kanal projeksiyonları tekilleştirilir; çelişkili ad/medium kayıtları üzerine yazılmaz, mevcut çözümleyiciye ayrı taşınır.

Mevcut `attachAttributionEvidence` normalizasyonu davranışı değiştirilmeden paylaşılır; aynı native event/attribution koleksiyonu mevcut `resolveKlaviyoOrderedProductSales` fonksiyonuna verilir. Campaign Assisted, Flow Triggered ve eksik/çelişkili attribution Unclassified davranışları korunur. Native Message kimliği kesin olup katalog satırı gözlenmediyse bu ID korunur; ad/medium belirsiz ve `message_exact_catalog_not_observed` kalır. Bu, raporda eşleşme bulunduğu iddiası değildir. Advertised/Cross Sell açılmaz, içerik kümesinden rol üretilmez. Shopify Product ID hâlâ doğrulanmadığından standardize kimlik null kalır.

Raporlar için `page_cursor` alınır, aynı sabit POST gövdesi/Placed Order metric/iş günü korunur; ham satır sınırı replay'i de sayar. İlk hata/iptal/bağlam değişimi, continuation döngüsü veya tamamlanma kanıtı eksikliği tüm sonucu reddeder. Resmî OpenAPI report yanıtındaki links şeması self gösterir, next'i belirtmez; native tamamlanma biçimi henüz canlı kanıt değildir. Yeni hazırlık açık `links.next=null` ister; next yokluğu boş katalog veya unsupported diye sunulmaz, güvenli biçimde durur. Gerçek yanıtla bu sözleşme ayrıca doğrulanmalıdır. Mevcut eski reporting runtime'ın tamamlanma davranışı bu dilimde değiştirilmez.

19 yeni Message kompozisyon testi, 38 mevcut native toplama testi ve 94 mevcut authority/kimlik/reporting/attribution testi sentetik yanıtlarla geçti. Kanonik SQL PK ve Ads seçim epoch arayüzü 14'ün değerlendirmesinde, 11'in Shopify Admin aday doğrulaması ve Google/Meta kaynak kompozisyonu açıktır. `installation_id=null`, `canonical_scope_ready=false`, `persistable=false`, `authorizes_activation=false` korunur. 12 quota/dispatch/timeout ve Shopify sipariş okuyucusu, 13 yazım öncesi, gerçek provider erişim/metric/varyant/report completion kanıtları ve tarihsel PMax duraklaması sürer. Route/SQL/canlı DB/provider/token/config/Dataset değişmedi.

Resmî kontrol 27 Ekim 2026: [Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values), [Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values), [Campaign OpenAPI](https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/query_campaign_values.json), [Flow OpenAPI](https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/query_flow_values.json). 2026-10-15 revision, mevcut alan/izinler korunur. Raporların 1/s, 2/m, 225/d sınırları 12'de aktivasyon öncesi ele alınır; ortak quota bucket davranışı varsayılmaz. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_identity_Message_composition_2026_10_27`.

## 11. adım — Klaviyo native kimlik toplamasını ortak authority yükleyicisine bağlama, 27 Ekim 2026

#205 `7629a19b7993d758bb8542e20f7d31cfc30f9f0d` main'dedir. `collectKlaviyoNativeIdentityEvidence` artık gerçek mevcut SQL/vault repository'lerini kullanan ortak authority yükleyicisini çağırır; `loadCurrent` yerine tarayıcı DTO'su veya alternatif yükleyici verilemez. Yalnız sunucuda doğrulanmış Shopify bağlamı kullanılabilir. Her native istek öncesi ve son dönüşte kurulum/lifecycle/hesap/token yeniden kontrol edilir. Yeni fonksiyon route veya mevcut reporting runtime tarafından çağrılmaz; canlı tetikleme yoktur.

Mevcut `discoverKlaviyoAccount` hesabı önce okur; ID saklanan seçili hesapla aynı olmalıdır. Native timezone ile iş günü kurulur. Mevcut Metrics isteğinin tüm sayfalarından tek native Shopify Ordered Product metric'i seçilir. Mevcut Events isteği aynı metric ve iş günü filtresiyle tüm sayfaları okur. Her event'in **kendi** native metric ilişkisi aynı olmalıdır; eksik ilişki sorgu filtresinden doldurulmaz. Included metric dönerse keşfedilen kaynakla çelişemez. Native event zamanı da istenen iş günü içinde olmalıdır. Geçersiz takvim tarihi hiçbir SQL/provider çağrısından önce reddedilir. En sonda hesap tekrar okunur; ID/timezone/currency değişmişse sonuç atılır.

Sonuç, normalizer'ın zaten koruduğu ürün/varyant/adet/değer/ad alanları ve native metric/attribution referanslarıyla sınırlı kaynak projeksiyonudur; profile ve seçilmemiş müşteri özellikleri taşınmaz. Native Message/Campaign/Flow referansları saklanır; Channel kataloğuna join veya satış rolü üretimi henüz yapılmaz. Referans verilen attribution included içinde yoksa tahmin yapılmaz. Aynı korunmuş projeksiyonun replay'i tekilleştirilir; event/metric/attribution ID çelişkisi tüm koleksiyonu reddeder. Ham sipariş/ürün miktarı veya değer yeniden hesaplanmaz.

Provider'ın devam adresi çağrılmaz; yalnız cursor alınır, sabit endpoint ve filtreler yeniden kurulur. Tamamlanma için açık `links.next=null` gerekir. Boş ara sayfa izlenir; cursor döngüsü, ham satır/replay, included kaynak ve sayfa sınırları aşılınca kısmi çıktı dönmez. İlk HTTP/transport/JSON/native hata veya iptalde retry/refresh/exchange/lifecycle mutation yoktur. HTTP 200 içindeki native errors da reddedilir. Redirect kapalı, signal taşınır, quota kontrol sinyalleri korunur. Varsayılan 120 saniye gözlem kontrolüdür; çalışan isteği kesen timeout değildir. Accounts'ın resmî 1/s ve 15/m sınırı 12. adım quota/dispatch bağlamasında ele alınmalıdır; burada uyutma/yeniden deneme veya aktivasyon yoktur.

38 yeni ve 94 mevcut authority/kimlik/reporting/attribution testi sentetik yanıtlarla geçti. Native hesap gözlemi, taze scope listesi veya Shopify entegrasyonunun aynı mağazaya ait olduğunun kanıtı değildir. `installation_id=null`, `canonical_scope_ready=false`, `persistable=false`, `authorizes_activation=false` kalır. Mevcut 14. adım SQL PK/seçim epoch arayüz değerlendirmesi, 11'in Shopify Admin ürün/varyant doğrulaması ve Message kanal join'i açıktır. 7/8/9/10 gerçek kanıtları, 12 quota/dispatch/timeout ve Shopify sipariş okuyucusu, 13 yazım öncesi, 14 değerlendirme ve tarihsel PMax duraklaması korunur. Klaviyo Advertised/Cross Sell kapalı kalır. SQL, canlı DB/provider/token/config veya Dataset yazımı yoktur.

Resmî kontrol 27 Ekim 2026: [Accounts](https://developers.klaviyo.com/en/reference/get_accounts), [Metrics](https://developers.klaviyo.com/en/reference/get_metrics), [Events](https://developers.klaviyo.com/en/reference/get_events), [Shopify Ordered Product referansı](https://help.klaviyo.com/hc/en-us/articles/115005080447). Mevcut 2026-10-15 revision, 200 event sayfa boyutu ve izin kümesi korunur. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_native_identity_collection_2026_10_27`.

## 11. adım — Ortak aktif kurulum, lifecycle, hesap ve vault yükleyicisi, 27 Ekim 2026

#204 `02a40a5b04380ff419c8fcc5f4da585f0c2fa23f` main'dedir. `createIdentityRuntimeAuthorityLoader`, mevcut sunucu repository'lerini doğrudan kullanır: `resolve_active_installation` → `load_provider_connection_lifecycle_by_owner` → `load_provider_account_authority` → workspace/nesil/provider/credential ile vault okuma → aynı üç SQL okuması. Yalnız sunucuda doğrulanmış salt okunur Shopify authority girdisi kabul edilir; bir request nesnesindeki marker bu fonksiyona erişim yolu değildir. Route veya mevcut collector henüz bağlanmadı.

Aktif workspace/kurulum nesli, connected bağlantı/sürüm/credential, seçili ve uygun hesap ile saklanan scope listesi aynı kalmalıdır. Google manager kimliği seçili native hesap kaydından korunur. Aynı çalıştırıcıdaki sonraki yüklemeler de ilk başarılı bağlam/token ile karşılaştırılır; metadata/token cache edilmez. İlk SQL/vault hatasında güvenli hata döner ve aynı çalıştırıcı durur. Yenileme, token değişimi, lifecycle mutation, retry veya alternatif hesap yoktur. Token yalnız iç sunucu bağımlılığıdır; route yanıtı, log veya güvenli özet değildir.

Google identity_v1, native token scope listesi ve mevcut expiry kontrolü kullanılır. Meta identity_v1 ister; native app/izin/süre incelemesi mevcut katalog kompozitörünün görevi olarak kalır, burada taze izin iddiası üretilmez. Klaviyo mevcut izin/expiry kontrolünü kullanır; saklanan scope kaynağı/zamanı değiştirilmez, yeni identity profili veya Advertised/Cross Sell açılmaz. Bu yükleme Shopify ürün yetkisi veya kaynak biçimi/rapor namespace'i kanıtı değildir.

**SQL arayüz sınırı açık:** mevcut `shopify.resolve_active_installation` fonksiyonu workspace/nesil/status döndürür, bigint kurulum PK'sini döndürmez. Ayrıca mevcut account authority okuyucusu Ads Reporting Account'un güncel kimliğini verir ama seçim binding epoch'unu vermez. Aynı hesaptan ayrılıp geri dönmeyi yalnız aynı ID ile saptayamayız. `installation_id=null`, `canonical_scope_ready=false`, `native_permission_revalidated=false`, `persistable=false`, `authorizes_activation=false` kalır. Kurulum neslinden PK üretilmez, çağırıcıdaki PK taşınmaz ve doğrudan tablo erişimiyle runtime rol sınırı aşılmaz. Gerçek kurulum PK'si ve Ads seçim epoch'u için scoped SQL dönüşü mevcut 14. adımın değerlendirmesine alınır; yeni iş numarası açılmaz. Önce/sonra okuma atomik snapshot değildir.

33 yeni sentetik test ve 64 mevcut Google bağ/Klaviyo aday testi geçti. Tam 11. adım açık: kanonik kapsam, kaynak kuralları, provider hedefleri, Shopify Admin, native Klaviyo metric/Message join ve mevcut okuyucuların tek güvenilir çalıştırmaya bağlanması sürer. 7/8/9/10 canlı kanıtları, 12 quota/dispatch/timeout ve Shopify sipariş okuyucusu, 13 yazım öncesi, 14 değerlendirme ve tarihsel PMax duraklaması korunur. SQL/migration, canlı DB/provider/token/config veya Dataset yazımı yoktur.

Resmî kontrol 27 Ekim 2026: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles), [changelog](https://supabase.com/changelog.md) ve [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant). Changelog'daki HTTP TLS değişimi pooler bağlantılarını kapsamaz; Postgres extension değişiklikleri incelendi, bu dilim extension/DDL değiştirmez. Bu dokümanlar canlı DB veya provider kabul kanıtı değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#identity_runtime_authority_loader_2026_10_27`.

## 10. adım — Klaviyo Shopify Ordered Product kimlik adayları, 27 Ekim 2026

#203 `efc1b08fd1cf5ce09ec7c6b2c2695e1ca98e59bd` main'dedir. `resolveKlaviyoProductIdentities` native event'leri ve native Shopify Ordered Product metric kaydını ortak Shopify ürün/varyant–ana ürün doğrulayıcısına bağlamaya hazırlanır. #179'un `ffc51bdf6ebd46f9e79b07bb186fb2da82884044` sürümündeki ilgili resolver incelendi; güncel main'de native event girdisi, standart provider scope ve yazıma kapalı taslak olarak yeniden uygulandı. Eski PR toplu taşınmadı.

Mevcut Events isteği zaten metric filtresi ve `include=attributions,metric` kullanır. Yeni endpoint, scope veya filtre eklenmez. Normalizer event'in kendi `relationships.metric.data` alanından `provider_metric_id` saklar; ilişki yoksa `null` kalır, sorgudaki seçili metric ile doldurulmaz. Yeni çözümleyici `type=metric`, `name=Ordered Product`, `integration.name=Shopify` ve her event'in tam native metric kimliği eşleşmesini ister. Custom/Placed Order veya eksik/başka metric ilişkisi Shopify çağrısından önce reddedilir. Bu sunucu girdileri tek başına gerçek hesap/integration erişimi kanıtı değildir; güvenilir toplama/lifecycle bağlantısı 11'de kalır.

Resmî Shopify Ordered Product referansı `ProductID` ve **`Variant ID`** alanlarını listeler. Önceki normalizer yalnız `VariantID` koruyordu; artık iki yazım ayrı, ham present/absent ve null değerleriyle tutulur. Belgelenen `Variant ID` varsa aday Shopify parent kontrolünden geçer. İki alan birlikteyse exact güvenli kimlikleri eşit olmalıdır; çelişki veya bozuk alias gizlenmez. Yalnız eski `VariantID` geldiğinde onun Ordered Product içindeki anlamı varsayılmaz, sonuç kaynak kanıtı bekleyen unresolved kalır. İki varyant alanı da yoksa yalnız Product ID doğrulanır, varyant uydurulmaz. Product/Variant ID için pozitif tam decimal string veya safe JSON integer aday olarak işlenir; unsafe sayı, unsigned-int64 taşması, sıfır, null ve eksik alan ayrılır. SKU/isim veya başka alan fallback'i yoktur.

Tüm event/metric ilişkileri ve event ID çelişkileri ilk Shopify çağrısından önce denetlenir. Aynı event replay'i bir kez korunur; aynı ürün/varyant için doğrulama yalnız bu koleksiyon içinde cache edilir. Aynı ürüne bağlı farklı varyantlar ayrı kalır. Eşleme taslağının kanıtında tüm kaynak event ID'leri tutulur. `mapping_index` yalnız bu sonucun array referansıdır, kalıcı DB kimliği değildir. İlk Shopify hatasında veya iptalde kısmi kabul dönmez; null ile parent çelişkisi ayrı taşınır. Kimlikler, miktar ve satış değeri hesaplarına karıştırılmaz.

29 yeni ve 32 mevcut Klaviyo reporting/authority/attribution testi sentetik verilerle geçti. Mevcut güvenli özet yeni varyant alanının yalnız presence sayısını gösterir; ham ID veya ilave profil verisi loglanmaz. Campaign Assisted, Flow Triggered ve Unclassified davranışları değişmez; kapatılmış Advertised/Cross Sell işi açılmaz. Sonuç `candidate_verified_source_and_shop` yerel taslağıdır; `persistable=false`, `provider_link_verified=false`, `authorizes_activation=false`, `mapping_write_performed=false` kalır. Resolver mevcut native collector/metric, Shopify Admin ve Message join'ine bağlanmadı; bu 11. adımda yapılacaktır. Route/canlı çağrı, token/config, SQL veya Dataset yazımı yoktur. Gerçek metric/varyant alanı ve erişim testleri 10'un canlı kabulüdür, henüz yapılmadı; 12/13 kontrolleri, 14 değerlendirme ve tarihsel PMax duraklaması korunur.

Resmî kontrol 27 Ekim 2026: [Klaviyo Shopify data reference — Ordered Product](https://help.klaviyo.com/hc/en-us/articles/115005080447), [Events API 2026-10-15 fieldsets ve metric ilişki kapsamı](https://developers.klaviyo.com/en/reference/get_events). API referansında page-size açıklamaları farklı üst sınırlar belirtir; mevcut isteğin 200 değeri değiştirilmedi. Bu kaynaklar gerçek mağaza event'i veya canlı erişim kabulü değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_product_identity_candidates_2026_10_27`.

## 9. adım — Meta rapor kimliği ve retailer kaynak kuralını Shopify aday doğrulamasına bağlama, 27 Ekim 2026

#202 `07f6c81e8d7c297ae51ddd7ffe67e3d364df86a8` main'dedir. `resolveMetaProductIdentity` katalog kaydını #199 ortak Shopify ürün/varyant–ana ürün doğrulayıcısına bağlamaya hazırlanır. Mevcut 9. adım ve 11'in ortak bağımlılığıdır; yeni iş numarası veya production varsayımı oluşturmaz.

İki bağımsız sunucu kuralı gerekir. `loadReportIdentityRule`, mevcut `ad_product_breakdown_daily_insights` ailesi, Graph sürümü, hesap/kurulum/bağlantı, katalog ve açık `catalog_product_id`/`retailer_id` namespace'i için kanıtlı `verified_report_identity_rule` döndürmelidir. Gerçek rapor kaynak referansı ayrıca taşınır. Bu kural yoksa kaynak biçimi kuralı aranmaz ve Shopify çağrısı yapılmaz. Katalogda aynı sayısal değerin bulunması veya biçimin Shopify'a benzemesi rapor namespace'ini kanıtlamaz.

İkinci `loadSourceRule`, tam provider scope + katalog/feed + Shopify mağazası için kanıtlı kaynak biçimini verir. Bu kural yoksa kimlik parçalanmaz. Aday **yalnız seçilen kaydın `retailer_id` alanından** çıkarılır; Meta katalog iç ID'si ve retailer grup kimliği Shopify ID yerine kullanılamaz. Native rapor ürün kimliği, açık namespace ve katalog/feed bağlamı taslak anahtarında korunur. Yanlış namespace veya farklı bağlama ait kuralda alternatif kimlik araması yapılmaz. Kaynak kaydı belirsiz/gözlenmemişse kaynak biçimi/Shopify çağrısı gerekmez; bu sonuç rapor namespace'i doğrulandıktan sonra anlamlandırılır.

Google ve Meta'nın aday çıkarma ve kaynak kuralı kapsam kontrolleri `catalog-shopify-candidate.server.js` içinde paylaşılır. Önceden koşullu desteklenen Product ID, Variant ID ve market+Product+Variant biçimleri değişmez; yeni evrensel format eklenmez. Google'ın provider scope'u, hata sınıfı/kodları ve kaynak sözleşmesi korunur; Meta, Google scope'una çevrilmez. Mevcut Shopify doğrulayıcısı tek `tries: 1` sorgusuyla mağaza, GID/legacy kimlik, varyant ve ana ürünü denetler. Null ve parent çelişkisi taşınır; ilk hata, iptal veya kural yükleme hatasında retry/fallback yoktur.

Sonuç `candidate_verified_source_and_shop` durumundaki yerel taslaktır; canonical `verified` veya kalıcı eşleme değildir. `persistable=false`, `provider_link_verified=false`, `authorizes_activation=false`, `mapping_write_performed=false` korunur. #202'nin native Ad referansı kanıtı kendiliğinden devralınmaz; güncel lifecycle/vault, Ad referansı, kaynak kuralları ve Shopify/Admin yükleyicisi tek çalıştırmada mevcut 11. adımda birleştirilecektir. Bu dilimde production rapor namespace'i veya kaynak biçimi kuralı kaydedilmedi; gerçek kanıt açık kalır.

30 yeni ve 83 mevcut Google/Shopify/Meta okuyucu testi sentetik verilerle geçti. Route, canlı provider çağrısı, token/config, SQL, tablo, Dataset veya Sales Role/metrik sorgusu değişmedi. 7/8/9/11 tamamlanmaz; 10 Klaviyo kimliği, 12 quota/dispatch/timeout, 13 yazım öncesi ve 14 değerlendirme kapıları korunur. Tarihsel PMax duraklaması sürer.

Resmî kontrol 27 Ekim 2026: [Meta ProductItem alanları/tipleri](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py), [Shopify ProductVariant/ana ürün ve kimlik alanları](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant), [UnsignedInt64](https://shopify.dev/docs/api/admin-graphql/2026-07/scalars/UnsignedInt64). Bu alan tanımları rapor namespace'i veya Shopify entegrasyon biçiminin kanıtı değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_source_rule_Shopify_candidate_resolution_2026_10_27`.

## 9. adım — Meta Ad kanalının hiyerarşi ve creative katalog referansları, 27 Ekim 2026

#201 `9ce54805d4fa348ce7bdb3b24010b8b1fc46ba81` main'dedir. `readMetaAdCatalogReference` Ad'in native `id/account_id/campaign_id/adset_id/creative` alanlarını okur. Seçili hesap, Campaign ve Ad Set sunucu bağlamıyla aynı olmalıdır. #201 Ad Set okuyucusu, Campaign istenmişse onun kimliğini de native alandan karşılaştırır. Creative'in kendi ID/hesabı da Ad referansı ve seçili hesapla karşılaştırılır; başka hesaptan creative kabul edilmez.

Creative'de açık `product_set_id` varsa ProductSet'in katalog alanı okunur. Aynı küme #201 Ad Set okumasında zaten doğrulandıysa aynı kimliğin kanıtı kullanılır; iki ayrı küme aynı kataloğa bağlıysa iki referans ayrı korunur. Açık Ad Set ve creative katalogları farklıysa hangi seviyenin öncelikli olduğu tahmin edilmez, işlem durur. Ad Set'te katalog referansı yokken creative'de açık kaynak varsa bu native ilişki gözlenebilir; varsayımsal inheritance üretilmez. İkisinde de referans yoksa ürünler okunmaz.

Creative `product_set_id` alanının eksik, null veya boş oluşu ayrı kaydedilir. Bunların hiçbiri başka override olmadığını veya hangi kataloğun gerçekten gösterildiğini kanıtlamaz. Ad/creative yanıtlarının yalnız kimlik referansları sonuçta saklanır; ilgisiz yaratıcı içerik veya hassas alanlar taşınmaz. Bu denetim ürün kümesi üyeliği, geçmiş gösterim/satış, rapor ürün kimliğinin namespace'i, Shopify Product ID veya Advertised/Cross Sell üretmez.

`readAdReferencedMetaCatalogIdentitySnapshot` #201'in native token incelemesi, süre/iptal/ilk hata kontrolü ve bağlamı aralarda yeniden yükleme akışını yeniden kullanır; ürünlerden önce/sonra tüm Ad/parent/creative referansını karşılaştırır. Sunucu Ad/Campaign kimlikleri de karşılaştırmaya eklenir. Çıktı `relationship_scope=current_ad_parent_and_observed_creative_catalog_references_only` kapsamındadır; eski Ad Set giriş noktası kendi kapsamını korur. İki public giriş noktası iç seviye seçimini kilitler; çağırıcı seçenek alanıyla Ad Set kanıtını Ad kanıtı diye yeniden etiketleyemez. Hiçbir route yeni fonksiyonu çağırmaz.

28 yeni ve 104 mevcut Meta testi sentetik yanıtlarla geçti. Native çağrı hatasında retry, refresh, exchange veya alternatif hesap/katalog yoktur. Gerçek lifecycle/vault/Reporting Account yükleyicisi ve kaynak kuralı/ortak Shopify doğrulayıcısı kompozisyonu mevcut 11. adımda; Meta rapor namespace'i ve gerçek kaynak biçimi kanıtı açıktır. `shopify_mapping_state=not_resolved`, `authorizes_activation=false` korunur. Canlı çağrı, token/config, API/bağımlılık sürümü, SQL, kalıcı tablo veya Dataset değişmedi. 7/8/9 tamamlanmaz; 12/13 kontrolleri ve 14. değerlendirme kapısı ile tarihsel PMax duraklaması korunur.

Resmî kontrol 27 Ekim 2026: Meta'nın [Ad alanları/tipleri ve GET tanımı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py), [AdCreative hesap ve product_set_id alanları](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py), [AdSet Campaign alanı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [ProductSet katalog alanı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productset.py). Alan varlığı her reklam türünde native değer veya canlı yetki garantisi değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_Ad_creative_catalog_reference_composition_2026_10_27`.

## 9. adım — Meta Ad Set katalog referansını kaynak okumasına bağlama, 27 Ekim 2026

#200 `ebaeaf1a757fd76e2b7a8b190b527949e05e6ce6` main'dedir. Bu dilim hesap–katalog ilişkisi için gözlenebilir bir native referans hazırlar: `AdSet.id/account_id` → `promoted_object.product_catalog_id` ve/veya `product_set_id` → `ProductSet.product_catalog.id`. Mevcut resmî SDK'da AdAccount için doğrudan global `product_catalogs` listesi doğrulanmadı; böyle bir endpoint veya genel atama yetkisi varsayılmadı. Bu, sağlayıcının desteklemediği hükmü değildir. Hazırlanan yol yalnız belirtilen Ad Set'in güncel katalog referansını kanıtlar.

`readMetaAdSetCatalogReference` seçili Ad Set ve hesabı tam karşılaştırır. Doğrudan katalog referansı varsa kullanır; ürün kümesi referansı varsa kümenin native katalog alanını da okur. İkisi birlikte bulunup farklı katalog gösterirse öncelik tahmini yapmaz, durur. Referans yoksa `not_observed`; farklı katalog varsa `different_catalog` kalır ve hedef değiştirilmez. İstenen native alanın bozuk/eksik olması yokluk veya unsupported diye gösterilmez. Kanıt yalnız kimlik referanslarını içerir; promoted_object'un ilgisiz sinyalleri veya hassas alanları sonuçta tutulmaz.

`readReferencedMetaCatalogIdentitySnapshot` sunucu `loadCurrent` bağlamını alır ve mevcut `inspectMetaAccessToken(identity_v1)` ile uygulama, geçerlilik, native izinler ve süreyi tekrar okur. Katalog okuyucusuna bu native izinler verilir; eski/istenen listeden tamamlama yapılmaz. Native referans → #200 ürün okuması → aynı referansı yeniden okuma adımları arasında sunucu bağlamı yeniden karşılaştırılır. Workspace, kurulum kimliği/nesli, bağlantı/sürüm, credential, hesap, Ad Set, katalog veya token/listesi değişirse sonuç atılır. Varsayılan 120 saniyelik toplam gözlem sınırı ve native izin süresi her çağrı öncesi ve okuma sonrası denetlenir. Bu, çalışan HTTP isteğini kesen timeout veya atomik tarihsel snapshot değildir.

`provider_link_verified=true` yalnız `relationship_scope=current_adset_catalog_reference_only` kapsamındadır. Tekil Ad/creative katalog override'ını, ürün kümesi üyeliğini, gösterilen/satılan ürünü, Insights kimliğinin namespace'ini veya Shopify eşlemesini kanıtlamaz. Ad kanalını bu referansa bağlama ve creative farklılıklarını ele alma bu hazırlıkla tamamlandı sayılmaz. `shopify_mapping_state=not_resolved`, `authorizes_activation=false` kalır. Advertised/Cross Sell/metrik sorguları değişmez.

35 yeni ve 69 mevcut Meta testi sentetik HTTP yanıtlarıyla geçti. İlk native hatada exchange/refresh/retry veya alternatif katalog/hesap yoktur; tüm GET çağrıları yönlendirmeyi reddeder ve iptal sinyalini taşır. Fonksiyon gerçek lifecycle/vault/Reporting Account yükleyicisine veya route'a bağlanmadı; bu mevcut 11. adım kompozisyonunda kalır. Canlı çağrı, token/config, SQL, kalıcı tablo veya Dataset değişmedi. 7/8/9 ve 14. değerlendirme kapısı açık, tarihsel PMax duraklatılmıştır.

Resmî kontrol 27 Ekim 2026: Meta'nın [AdSet alanları ve GET tanımı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [AdPromotedObject katalog/ürün kümesi alanları](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adpromotedobject.py), [ProductSet katalog alanı ve GET tanımı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productset.py), [AdAccount SDK envanteri](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py). Alan varlığı canlı erişim veya her kampanya türünün bu yolu verdiği kanıtı değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_AdSet_catalog_reference_composition_2026_10_27`.

## 9. adım — Meta katalog ürün kaynağı ve kimlik alanlarının ayrılması, 27 Ekim 2026

#199 `894ad59dbd1db19783295693928c0bbbb4c2b576` main'dedir. Google'ın gerçek kaynak biçimi ve tam sunucu kompozisyonu açık tutulurken 9. adımın bağımsız katalog okuyucusu hazırlanır. 7/8 tamamlandı sayılmaz. Açık #179'un `ffc51bdf6ebd46f9e79b07bb186fb2da82884044` sürümündeki Meta okuyucu alt kümesi incelenip güncel main ve resmî SDK kaynaklarıyla yeniden uygulandı; eski PR toplu taşınmadı.

`readMetaCatalogIdentitySnapshot` sabit Graph v26.0 üzerinde yalnız seçili katalog `/products` kaynağını GET ile okur. `id`, `retailer_id`, `retailer_product_group_id`, `product_catalog`, `product_feed` istenir. Her kaydın katalog kimliği hedefle aynı olmalı; katalog iç ürün kimliği ile retailer kimliği ayrı saklanır. Ham ürün kaydı kopyalanıp değişmez tutulur. Feed/grup alanının eksikliği, açık null'u ve boş grup değeri ham kaynakta korunur; bunlardan Shopify Product/Variant veya ana ürün tahmini yapılmaz. Grup kimliği ürün kimliği yerine kullanılmaz.

`matchMetaCatalogProductIdentity` açık `catalog_product_id` veya `retailer_id` namespace'i ve katalog kimliği ister. Aynı sayısal metin iki alanda bulunsa da biri diğerine dönüştürülmez. Katalog iç ID tekrarı koleksiyonu reddeder; aynı retailer kimliğine sahip farklı kayıtlar korunur ve sonuç belirsizdir. İsteğe bağlı tam feed filtresi tek kayıt seçebilir; ilk kayıt kendiliğinden seçilmez. Insights `product_id` alanının hangi namespace'i ifade ettiği bu okuyucudan çıkarılmaz.

Bearer header ve mevcut HMAC `appsecret_proof` kullanılır; token query parametresine konmaz. Mevcut identity scope listesi kontrolü yeni izin istemez ve taze token/varlık yetkisi kanıtı değildir. Provider'ın `paging.next` adresi çağrılmaz; yalnız devam işareti ile `after` cursor'ı kullanılıp aynı sabit katalog isteği yeniden kurulur. Boş ara sayfa da izlenir. Tekrar cursor, aynı native ürün, sayfa/satır sınırı, iptal, bozuk yanıt veya ilk transport/HTTP/JSON/Graph hatasında kısmi koleksiyon dönmez; retry, refresh veya başka katalog rotası yoktur. Paging içindeki credential bilgileri sonuçta saklanmaz.

34 sentetik davranış testi geçti. `provider_link_verified=false`, `shopify_mapping_state=not_resolved`, `authorizes_activation=false` korunur. Okuyucu mevcut credential/lifecycle veya route'a bağlanmadı; canlı çağrı, token/config/bağımlılık/API sürümü, SQL veya Dataset değişmedi. Mevcut Meta metrik sorguları ve dört satış alanı değişmez. 9'da kalanlar: native Ads hesabı–katalog bağının doğrulanması, rapor ürün kimliğinin namespace kanıtı ve kaynak biçimi; 10 Klaviyo okuyucusu, 11 güvenilir kaynak kuralı ve ortak Shopify doğrulayıcısıyla kompozisyon, 12 quota/dispatch/timeout, 13 yazım öncesi ve 14 değerlendirme kapısı. Tarihsel PMax duraklaması sürer.

Resmî kontrol 27 Ekim 2026: developers.facebook.com ProductCatalog/products referansı HTTP 429 döndürdü; bu doküman erişim gözlemi API'nin desteklemediği anlamına gelmez. Meta'nın kendi [ProductCatalog GET/products tanımı](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productcatalog.py), [ProductItem alan ve tipleri](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py) ve [Cursor devam davranışı](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/cursor.js) okundu. [Resmî SDK config](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py) v26.0.2/API v26.0 gösterir ve mevcut runtime sürümüyle uyumludur. SDK kaynakları Shopify biçimi, rapor namespace'i veya gerçek izin kabulü kanıtı değildir. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_catalog_source_reader_2026_10_27`.

## 8. adım — Google kaynak kuralı ve ortak Shopify aday doğrulaması, 27 Ekim 2026

#198 `aba31161a948f66e90ba80c636a2c2fbe85e4ecf` ile main'dedir. Bu dilim 8'in Shopify Product/Variant ucunu hazırlamak için mevcut 11. adımın ortak doğrulama parçasını da kodlar; yeni iş numarası açmaz veya 11'i tamamlandı saymaz. Açık #179'un `ffc51bdf6ebd46f9e79b07bb186fb2da82884044` sürümündeki ilgili alt küme incelenip güncel main'de yeniden uygulandı; Meta kodu veya eski sözleşmeler taşınmadı.

`resolveGoogleProductIdentity` yalnız benzersiz Merchant kaynak kaydını işler. Güvenilir sunucu `loadSourceRule` bağımlılığından, tam workspace/kurulum kimliği/nesil/bağlantı/Ads hesabı ve Merchant/feed/dil/dataSource/yerel bağlamına, ayrıca Shopify mağazasına bağlı kural ister. Kuralın kanıt referansı ve biçimi doğrulanır. Kaynak kuralı yoksa kimlik parçalanmaz ve Shopify çağrısı yapılmaz. Koşullu parser biçimleri Product ID, Variant ID ve market+Product+Variant biçimidir; bunlar Google veya entegrasyonun evrensel kimlik garantisi değildir. Hiçbir production kuralı kaydedilmedi. Varyant `0` varsayımı, biçim tahmini veya fallback yoktur. Gözlenmeyen/belirsiz kaynakta kural yükleme ve Shopify çağrısı da yapılmaz.

`verifyShopifyProductCandidate` doğrulanmış sunucu Admin/mağaza/aktif kurulum bağlamından tek GraphQL sorgusu yapar. Aynı sorguda mağaza kimliği/domain, istenen ürün/varyant ve varyantın ana ürününün GID + `legacyResourceId` alanları doğrulanır. String kimlikler unsigned int64 sınırında korunur; JavaScript Number'a çevrilmez. Yalnız varyant verildiyse Product ID native ana üründen bulunur; yalnız ürün verildiyse tüm varyantlar taranmaz. Açık `null` gözlenmeyen adaydır; eksik alan, yanlış GID veya sayı/string çelişkisi hatadır. Varyant başka ürüne bağlıysa `conflicting` döner; istenen ürün kimliği değiştirilmez. `tries: 1`, iptal sinyali ve ilk hatada durma vardır; kısmi GraphQL veri+error kabul edilmez, hata mesajından token/native gövde aktarılmaz.

Sonuç yalnız `candidate_verified_source_and_shop` durumundaki **yerel eşleme taslağıdır**; canonical/DB `verified` durumu değildir. `persistable=false`, `provider_link_verified=false`, `authorizes_activation=false` ve `mapping_write_performed=false` korunur. Bu denetim #198'in doğruladığı Ads–Merchant ilişkisini kendiliğinden devralmaz; güncel lifecycle ve kaynak kuralı/credential/Admin yükleyicisi ile aynı çalıştırmada birleştirme mevcut 11. adımda kalır. Sonraki kullanım öncesi aktif kurulum yeniden denetlenmelidir. Satış rolü/metrik değişikliği veya Dataset yazımı yoktur.

49 yeni test ve 63 Google okuyucu/bağ regresyon testi geçti; hepsi sentetiktir. Gerçek kaynak biçimi ve production kuralı kanıt bekler. Route, canlı token/config, bağımlılık/API sürümü, yeni SQL veya kalıcı tablo değişmedi. 7, 8 ve 11 açık kalır; 9/10 sağlayıcı okuyucuları, 12 quota/dispatch/timeout, 13 yazım öncesi ve 14 değerlendirme kapıları korunur. Tarihsel PMax duraklaması sürer.

Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_source_rule_Shopify_candidate_verification_2026_10_27`. Resmî kontrol 27 Ekim 2026: [Product](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product), [ProductVariant ve ana ürün ilişkisi](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant), [UnsignedInt64](https://shopify.dev/docs/api/admin-graphql/2026-07/scalars/UnsignedInt64), [product sorgusu](https://shopify.dev/docs/api/admin-graphql/latest/queries/product), [productVariant sorgusu](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant). Sorgu sayfalarının 2026-07 sürümleri web okuyucuda açılamadı; mevcut sorgu tanımları ve sürümlü nesne alanları birlikte kontrol edildi. Kurulu Shopify React Router 3.0.1 `GraphQLQueryOptions` tipindeki `tries` ve `signal` desteği yerelden doğrulandı.

## 8. adım — Google Ads–Merchant aktif bağını ürün okumasına bağlama, 27 Ekim 2026

#197 `94511c5c9e6fb93f400057671cc247315b5b29ed` ile main'dedir. Yeni `readGoogleMerchantAccountLink` tam sayfalanmış `product_link` sorgusuyla seçili Ads müşteri hesabına doğrudan bağlı hedef Merchant'ı gözler. Kampanya ayarı veya bekleyen davet aktif bağ kanıtı sayılmaz. Kaynak adı müşteri/link kimliğiyle doğrulanır, başka hesaba ait veya yinelenen satır reddedilir. Hedef yoksa `not_observed`, birden fazla eşleşen bağ varsa `ambiguous` kalır; ilk satır seçilmez veya sağlayıcı desteklemiyor sonucu çıkarılmaz.

`readLinkedMerchantProductIdentitySnapshot` aynı identity credential ile mevcut Ads v25 transport'unu ve #197 Merchant okuyucusunu birleştirir: aktif bağ okuma → güncel bağlam karşılaştırma → ürün okuma → bağlam karşılaştırma → aynı aktif bağı yeniden okuma → son bağlam karşılaştırma. Her karşılaştırma sunucu `loadCurrent` bağımlılığından yeniden yükler; ilk veri kopyalanır. Workspace, kurulum/nesil, bağlantı/sürüm, credential, seçili Ads/Merchant/manager hesabı, token ve native scope/zaman bilgisi değişirse koleksiyon atılır. Mevcut identity token metadata denetimi kullanılır; yalnız reporting credential veya yenileme gerektiren token kabul edilmez, refresh yapılmaz. Eksik native scope istenen izinlerden doldurulmaz.

İlk provider hatasında tekrar veya alternatif hesap rotası yoktur. Her iki transport'ta yönlendirme kapalı ve iptal sinyali aktarılır. Sayfa/satır sınırları, tekrarlayan cursor ve eksik yanıt durdurulur. Başlangıç/bitiş aralığı varsayılan 120 saniyeyi aşarsa sonuç kullanılmaz; bu süre kontrolü çalışan HTTP isteğini tek başına kesen timeout değildir. Sonuç atomik/historik snapshot veya gelecekteki yazım yetkisi değildir. `provider_link_verified=true` yalnız bu kompozisyonun gözlediği Ads–Merchant ilişkisini ifade eder; yalın kaynak okuyucusu/eşleştiricisi aynı iddiayı taşımaz. Shopify Product/Variant eşlemesi hâlâ `not_resolved`, aktivasyon yetkisi `false` kalır.

35 yeni test ve #197'nin 28 regresyon testi geçti. Testler gerçek Ads REST ve Merchant okuyucusunu sentetik HTTP yanıtlarıyla birlikte çalıştırır; canlı erişim kanıtı üretmez. Sunucu `loadCurrent` adaptörünün gerçek aktif kurulum, lifecycle, vault ve seçili Reporting Account'a bağlanması mevcut 11. adım kompozisyonunda kalır. Bu fonksiyona tarayıcıdan nesne geçirmek güvenilir yetki oluşturmaz. Route/canlı trigger bağlanmadı; yeni SQL, kalıcı tablo, token/config değişikliği veya Dataset yazımı yapılmadı. 7 ve 8 tamamlanmış sayılmaz; kaynak biçimi/Shopify doğrulaması, 12'de quota/dispatch/timeout, 13'te yazım öncesi kontroller ve 14'te değerlendirme sınırı korunur. Tarihsel PMax duraklaması değişmez.

Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_Ads_Merchant_link_composition_2026_10_27`. Resmî kontrol 27 Ekim 2026: [aktif Merchant bağları için sorgu](https://developers.google.com/google-ads/api/docs/shopping-ads/merchant-center), [v25 product_link alanları](https://developers.google.com/google-ads/api/fields/v25/product_link), [REST Search ve sayfalama](https://developers.google.com/google-ads/api/rest/common/search).

## 8. adım — Google Merchant kaynak okuyucusu hazırlığı, 27 Ekim 2026

#196 `d5dce8eb6f021796695045affc7e97615e887580` ile main'dedir. 7. adımın canlı izin/yayın, uygulama incelemesi, gerçek okuma ve atomik yazım kapıları açık kalır. Bunları açmadan bağımsız hazırlanabilen 8. adım kaynak okuyucusu burada kodlanır; 7 veya 8 tamamlandı sayılmaz. #179'un `ffc51bdf6ebd46f9e79b07bb186fb2da82884044` sürümündeki Google okuma alt kümesi incelendi, güncel main ve resmî v1 belgeleri üzerinde yeniden uygulandı; eski PR veya sözleşmeleri toplu taşınmadı.

`readMerchantProductIdentitySnapshot` yalnız Merchant API ürün listesini okur. Workspace/kurulum nesli/bağlantı/Ads hesabı/Merchant bağlamı sunucu girdisidir; bu girdilerin varlığı hesap sahipliği veya Ads–Merchant bağı kanıtı değildir. `offerId`, feed, dil, birincil dataSource ve yerel/online ayrımı birlikte korunur; ürün kaynak adı ile aynı Merchant doğrulanır. Ham `productAttributes` ve `customAttributes` dahil kaynak kaydı kopyalanıp değişmez tutulur. Shopify biçimine benzeyen bir kimlik otomatik Product/Variant kimliği sayılmaz.

Boş veya kısa sayfada da native cursor izlenir. Tekrarlanan cursor, yinelenen ürün anahtarı, bozuk yanıt, sayfa/satır sınırı veya ilk taşıma/HTTP/JSON hatasında kısmi koleksiyon döndürülmez. Otomatik tekrar, token yenileme ve yönlendirme yoktur; çağırıcının iptal sinyali aktarılır. Tamamlanan sayfalama atomik veya tarihsel katalog anı kanıtı değildir. Eşleştirici bir kaynak kaydı, `unresolved` veya `ambiguous` döndürür; dil/yerel bağlam belirsizliğinde ilk ürünü seçmez.

28 sentetik test geçti. Yeni fonksiyon route veya canlı credential çağırıcısına bağlanmadı; canlı çağrı, izin/config değişikliği, SQL/tablo/migration veya Dataset yazımı yoktur. `provider_link_verified=false`, `shopify_mapping_state=not_resolved`, `authorizes_activation=false` korunur. Mevcut sıralamada açık kalanlar: 8'de güvenilir Ads hesabı–Merchant bağı ve kaynak biçimi kanıtı; 11'de kural yükleyici ve Shopify ürün/varyant/ebeveyn doğrulamasıyla birleşim; 12'de okuyucu ailesinin quota/dispatch/timeout kontrolü; 13'te yazım öncesi kontroller ve 14'te değerlendirme. Yeni sıra/paket üretilmedi; tarihsel PMax duraklaması sürer.

Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_Merchant_source_reader_2026_10_27`. Resmî kontrol 27 Ekim 2026: [products.list](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list), [Product alanları ve kaynak kimliği](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products). Belgeler Merchant ürün kimliğinin Shopify Product ID olduğunu garanti etmez.

## 7. adım — Klaviyo yeni izin gözlemi ile korunan izni ayırma, 27 Ekim 2026

#195 `f5fccc7fda0e34eae210e23e80239a9ef9153aad` ile main'dedir. Klaviyo'da istenen beş scope değişmez. Mevcut hesap okumasındaki `accounts:read` ve reporting öncesindeki Campaign/Event/Flow/Metric izin kontrolleri zaten vardır. Bu dilim ek izin istemez; OAuth token yanıtında yeni gözlenen scope ile refresh yanıtı scope içermediğinde önceki kayıttan korunan scope'un kaynağını ayırır.

Şifreli tokenSet içindeki `scope_source` yeni yanıtta `native_token_response`, scope'u olmayan refresh'te `retained_previous_grant` olur. `scope_observed_at` yeni native yanıtta o gözlemin zamanıdır; korunan listede önceki tarih aynen taşınır, bilinmiyorsa `null` kalır. Token yenilenmesinin `verifiedAt` zamanı izin gözleminin tarihi yerine yazılmaz. Gerçek native liste kısmi ise eksik izinler istenen/eski listeden tamamlanmaz. Açık `null`, boş/bozuk/tekrarlı scope listesi cached scope ile doldurulmaz; uygulamanın sıkı native yanıt politikası gereği reddedilir. İlk alışverişte scope eksikliği zaten kabul edilmiyordu; hata artık açıkça ayrılır. Normal refresh'in eksik scope'u eski listeden koruma davranışı sürer.

28 yeni test native/kısmi liste, retained/undated ayrımı, önceki tarih aktarımı, bozuk scope ve ilk hata durmasını sınar. Değişiklik mevcut encrypted tokenSet'tedir; yeni SQL/kolon/tablo, canlı token/config veya scope talebi yoktur. Scope metadata'sını kullanacak canonical izin çağırıcısı retained/undated listeyi yeni native kanıt diye etiketlememelidir; mağaza/hesap bağlamı ile kaynak kompozisyonu mevcut sonraki adımlardadır. Klaviyo Advertised/Cross Sell için kapatılmış çalışma açılmadı; Dataset ve tarihsel PMax değişmez.

**7. adımın kalanları:** yetkili Shopify scope beyanı/yayını ve mağaza onayı; uygulama erişim incelemeleri ile gerçek scope/varlık okuma testleri; mevcut değerlendirme kapısına bağlı atomik credential stage/connected yükseltmesi ve belirsiz yazma uzlaştırması; mevcut sonraki adımlardaki güvenilir kaynak çağırıcısı bağlantıları. Bu dilim bunları tamamlandı saymaz, yeni paket/sıra üretmez. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Klaviyo_token_scope_provenance_2026_10_27`.

Resmî kontrol 27 Ekim 2026: [Klaviyo token scope ve refresh yanıtı](https://developers.klaviyo.com/en/docs/set_up_oauth), [OAuth token yanıtı](https://www.rfc-editor.org/rfc/rfc6749#section-5.1) ve [refresh grant](https://www.rfc-editor.org/rfc/rfc6749#section-6). Klaviyo belgesi scope'u token erişim listesi olarak tanımlar; OAuth scope'un değişmediği yanıtlarda atlanabilmesine izin verir. Bu, önceden korunan listeye yeni native gözlem zamanı yazma kanıtı değildir. Testler sentetiktir; gerçek Klaviyo yanıtı/erişimi kabulü değildir.

## 7. adım — Shopify izin sonucunu aktif kuruluma bağlama, 27 Ekim 2026

#194 `f80cc9dd82141eb21c55623be464e1b4ccf6a210` ile main'dedir. Bu repository dilimi `inspectShopifyIdentityPermissionScopes` ile önceki grant okuyucusunu ve scope karşılaştırmasını tek sunucu fonksiyonunda birleştirir. Girdi mevcut Shopify kimlik çözümlemesinden gelen doğrulanmış Admin, ID-token mağaza kimliği ve aktif kurulumdur; tarayıcıdan workspace/nesil alınmaz. Mevcut `resolve_active_installation` fonksiyonu okuma öncesi ve sonrası gerçek shop kapsamında çalışır. Workspace, aktif durum veya kurulum nesli değişmişse izin sonucu döndürülmez; yeni kurulum bootstrap edilmez ve tekrar denenmez.

`currentAppInstallation.accessScopes` tek GraphQL çağrısında `tries: 1` ile okunur. Ürün/sipariş için işlevsel minimum `read_products` + `read_orders` olarak mevcut sözleşmeden alınır. 60 günden eski sipariş isteği `read_all_orders`, seçilen MarketingEvent yolu `read_marketing_events` gerektirir; bunlar ayrı özelliklerdir. Mevcut write grant ilgili read'i karşılayabilir, yeni write izni istenmez. Eksik grant listelenir; eski/yavaş gözlem `unknown` kalır. Sonuç yalnız scope gözlemidir, App Review veya ürün/sipariş erişimi/aktivasyon yetkisi değildir. Sonraki okuyucu/yazıcı kullanımdan önce aktif kurulumu yeniden doğrulamalıdır.

Yerel `shopify.app.toml` içinde `scopes = ""`, optional scope tanımı yoktur. Bu, canlı grant'in boş olduğunu kanıtlamaz. Bu dilim yapılandırmayı değiştirmez veya yayınlamaz; izin istemez. Required/optional kurulum beyanı seçilmedi. Dinamik istek kullanılacaksa izinlerin optional olarak beyan edilip yayınlanması, ardından mağaza onayı ve yeni native grant okuması gerekir. Sipariş için protected customer data başvurusu ve koşullu uygulama erişimleri ayrı kalır; ad/adres/e-posta/telefon alanı istenmedi.

24 yeni davranış testi kurulum değişimi, yanlış mağaza, ilk hata, özellik kapsamları, gerçek boş liste, mevcut write grant ve eski gözlem ayrımını kapsar. Sentetik HTTP/DB testleri canlı grant/SQL kabulü değildir. Fonksiyon hazırlanmıştır; mevcut Settings/route veya provider canlı kanıt yolları yeni çağrı yapmaz. Yeni SQL/tablo/migration, Dataset veya tarihsel PMax değişmez. **7. adım açık:** yetkili Shopify scope beyanı/yayını, uygulama incelemeleri, mağaza onayı ve gerçek ürün/sipariş/yolculuk okumaları; Google/Meta atomik yazım ve bağlı hesap izin yükseltmesi kendi mevcut değerlendirme kapısında durur.

Makine kaydı: `contracts/eo-05-start-brief-v1.json#Shopify_active_installation_scope_readback_2026_10_27`. Resmî kontrol 27 Ekim 2026: [Shopify scope yönetimi ve dinamik istek koşulları](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes), [2026-07 currentAppInstallation](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/currentAppInstallation), [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data).

## 7. adım — kimlik OAuth başlangıcını bağlantı sürümüne bağlama, 27 Ekim 2026

#193 `33783ecfa06f50010be648a651d31e3c35d78e90` ile main'dedir. Bu repository dilimi Google/Meta kimlik başlangıcını, runtime factory'sinde varsayılanı `false` olan `identityAuthorizationEnabled` koşuluna bağlar. Mevcut Settings/route bunu açmaz; yeni environment değişkeni veya UI akışı yoktur. Çağrı/form alanı factory koşulunu aşamaz. `true` yalnız izole testlerde kullanıldı; izin, App Review veya canlı aktivasyon kanıtı değildir.

Başlangıçta mevcut lifecycle okuyucusu gerçek mağaza/kurulum nesli/provider kapsamında çalışır. Bağlantı yoksa `initial`, desteklenen bekleyen kurulum/reauthorization kaydında bağlantı UUID ve sürümü state'e eklenir. 32 rastgele byte korunur; tam state özeti mevcut transaction'a yazılır. Dönüşte kanonik metinden alınan bağ, yalnız mevcut atomik tam digest claim sonrası kullanılabilir. Kimlik/sürüm ekleme veya değiştirme, başka callback alanıyla bağ seçme ve replay reddedilir. Eski bağı taşımayan identity callback provider çağrısından önce reddedilir; bu amaç daha önce canlı route'ta etkinleştirilmemişti. Reporting state'i, nonce, PKCE, TTL ve Klaviyo korunur.

Google/Meta callback mevcut bağlantıyı token alışverişinden önce ve seçim kaydından hemen önce tekrar karşılaştırır; gözlenen değişimde işlem durur. Mevcut SQL stage fonksiyonu `connected` yükseltmesini desteklemediği için bu başlangıç açıkça reddedilir. `disconnect_pending`, `disconnected` ve bilinmeyen durumlar kendiliğinden yeniden açılmaz.

**Atomik yazım sınırı açıktır:** İki okuma arasında koruma bulunması, son okuma ile stage yazımını tek atomik işlem yapmaz. Mevcut stage fonksiyonunun expected-version koşulu yoktur. Bu dilim son yarış durumunu çözmüş veya canlı aktivasyonu hazır sayılmaz. Atomik credential stage/bağlı hesap izin yükseltmesi ve belirsiz Google credential yazmasının uzlaştırılması, canlı aktivasyondan önce ve mevcut **14. sıra değerlendirmesi / kimlik alt listesi 12 öncesi** sınırına bağlıdır. Yeni migration veya kalıcı kimlik tablosu burada açılmadı. Bu, mevcut yazım kapısının somut gereksinimidir; yeni paket/sıra değildir.

34 yeni davranış testi başlangıç koşulu, gerçek owner kapsamı, bağlantı/sürüm değişikliği, state/digest/claim bağı, ilk provider çağrısından önce durma ve reporting korunmasını sınar. Sentetik testler canlı OAuth veya DB çalıştırma kabulü değildir. 7. adım açık; Shopify scope config/grant dönüşü, incelemeler ve gerçek mağaza/varlık erişimi testleri kalır. Dataset ve tarihsel PMax değişmez. Kaynak kontrolü 27 Ekim 2026: [Google OAuth state ve artımlı izin](https://developers.google.com/identity/protocols/oauth2/web-server), [Meta'nın güncel token inceleme belgesi](https://github.com/facebook/agentic-tools/blob/main/plugins/devtools/skills/debug-access-token/SKILL.md). Makine kaydı: `contracts/eo-05-start-brief-v1.json#identity_OAuth_start_connection_binding_2026_10_27`.

## 7. adım — Meta kimlik credential yeniden incelemesi, 27 Ekim 2026

#192 `807408603484578555fc8700eb50f9cfa420d07d` ile main'dedir. Sonraki repository dilimi Meta kimlik OAuth dönüşünde `identity_v1` amacını şifreli credential'a kaydeder. Bekleyen hesap seçimi, bekleyen Reporting Account seçimi ve bağlı hesap yeniden doğrulaması bu credential için önce tek native token incelemesi yapar. Token geçerliliği, aynı uygulamaya ait oluşu, gerçek güncel scope dizisindeki bütün gerekli izinler ve token/veri erişim süreleri doğrulanır. Önceki scope listesi veya eski kontrol tarihi yeni grant kanıtı sayılmaz.

Meta'da eski izinlerin varlığı akış amacını ispatlamaz: işaretsiz eski token reporting olarak kalır, fazladan katalog izniyle kimlik yetkisine yükseltilmez. Bilinmeyen amaç reddedilir. Bu dilimde canlı identity profili açılmamıştır; ileride identity aktivasyonu işaretli credential ve taze native kanıt gerektirecektir. Reporting akışının native çağrıları korunur; bekleyen Reporting Account ekranı yalnız mağaza/nesle bağlı vault okuması ekler.

İzin eksikse, token geçersizse veya ilk provider hatası oluşursa hesap okuması/seçim yazması durur. Otomatik token exchange, tekrar deneme veya yeniden yetkilendirme başlatılmaz. Native `0` süre sınırsız olarak değerlendirilir; mevcut uygulamanın sınırlı süre politikası gereği en az bir pozitif bitiş zamanı gerekir. Bozuk süre alanları reddedilir. Hesap keşfi kanıtının bitişi native token/veri erişim süresi ve incelemeden sonraki 10 dakika ile sınırlanır; keşif uzayıp kanıt eskirse seçim yazılmaz. Çıktı yalnız izin adları, kontrol zamanı ve süreyi içerir; token, kullanıcı veya granular hedef kimlikleri içermez.

35 yeni davranış testi altı akışta yeniden inceleme, kaldırılan izin, farklı uygulama, süreler, eski scope'a güvenmeme, ilk hata durması ve reporting davranışının korunmasını kapsar. Bu sentetik HTTP/DB testleri gerçek mağaza izni veya katalog varlığına erişim kabulü değildir. UI/route, canlı provider/token/config, SQL/migration, Dataset ve tarihsel PMax değişmez. **7. adım açık:** güvenilir sunucu aktivasyonu/yeniden izin politikası, Merchant/katalog varlık yetkisi, belirsiz Google credential yazmasının uzlaştırılması, Shopify config/grant dönüşü, incelemeler ve gerçek mağaza izin testleri kalır.

Resmî kontrol 27 Ekim 2026: [Meta token inceleme referansı](https://developers.facebook.com/docs/graph-api/reference/debug_token/) web okuyucuda erişilemedi; Meta'nın kendi [güncel belgesi](https://github.com/facebook/agentic-tools/blob/main/plugins/devtools/skills/debug-access-token/SKILL.md) ve [yayımladığı örnek kod](https://github.com/facebook/agentic-tools/blob/main/plugins/devtools/skills/debug-access-token/scripts/debug_token_probe.py) okundu. Örnek çalıştırılmadı, canlı token alınmadı. Makine kaydı: `contracts/eo-05-start-brief-v1.json#Meta_identity_credential_reinspection_2026_10_27`.

## 7. adım — Google kimlik credential yenilemesi, 27 Ekim 2026

#191 `438bf5f8960cc2e25d4b6202a580cc1b1bf9b426` ile main'dedir. Bu repository dilimi Google `identity_v1` token'ına şifreli zarf içinde izin amacı, gerçek grant kapsamı, veriliş ve mutlak bitiş zamanını ekler. Kayıt okunduğunda zaman yeniden başlatılmaz. Süre dolmuşsa veya 60 saniye kalmışsa bağlı hesapta Ads çağrısından önce tek yenileme yapılır. Yeni gerçek token yanıtında Ads ve Merchant izinleri birlikte bulunmalıdır; eski scope listesiyle eksik grant tamamlanmaz.

Bağlı hesapta mevcut lifecycle fonksiyonu mağaza/kurulum nesli/provider, bağlantı sürümü ve eski credential kimliğiyle yeni zarfı bağlar. Bekleyen hesap seçiminde bu fonksiyon kullanılmaz: süresi dolan credential `GOOGLE_IDENTITY_PENDING_REAUTHORIZATION_REQUIRED` hatasıyla durur, kurulum kendiliğinden connected olmaz. Yazma sonucu belirsizse yeni şifreli zarf silinmez veya kullanılmaz; yeniden uzlaştırma canlı aktivasyon öncesinde açık iştir. Kimlik yolunda Ads hatasından sonra refresh/tekrar sorgu veya başka erişilebilir köke geçiş yoktur. Normal reporting yolunun eski 401 yenileme davranışı bu dilimde değiştirilmedi.

19 yeni davranış testi native scope eksikliği, mutlak süre, pending/connected ayrımı, sürüm ve credential uyuşmazlığı, belirsiz yazma, ilk hata durması ve normal reporting yolunun korunmasını kapsar. Sentetik HTTP/DB sınır testleri canlı grant veya SQL çalıştırma kanıtı değildir. Ads discovery Merchant/katalog erişim kanıtı sayılmaz. Meta credential incelemesi, güvenilir sunucu aktivasyonu/yeniden izin politikası, varlık yetkisi, Shopify config/grant dönüşü, incelemeler ve gerçek mağaza testleriyle **7. adım açık kalır**. Route/UI, canlı token/config, SQL/migration, Dataset, 14. adım incelemesi ve tarihsel PMax duraklaması değişmez.

Makine kaydı: `contracts/eo-05-start-brief-v1.json#Google_identity_credential_lifecycle_2026_10_27`. Resmî kontrol 27 Ekim 2026: [Google OAuth offline yenileme ve native scope](https://developers.google.com/identity/protocols/oauth2/web-server), [Supabase fonksiyon sınırı](https://supabase.com/docs/guides/database/functions) ve [güncel değişiklikler](https://supabase.com/changelog). Yeni DB fonksiyonu veya şema eklenmedi.

## 7. adım — ek izin isteğini OAuth işlemine bağlama, 27 Ekim 2026

#190 `ee28856c1260dffd18725eeb85718d195a5ce3de` ile main'dedir. Bu sonraki repository dilimi Google/Meta için sunucunun açıkça seçeceği `identity_v1` izin amacını mevcut OAuth transaction'ına bağlar. Varsayılan `reporting_v1` ve mevcut Settings akışı aynı kalır. Google ek istekte Ads + Merchant content, Meta ads_read + dört katalog/bağımlılık izni ister. İzin listesi ön kontrol ve OAuth kodunda aynı kaynaktan beslenir. Klaviyo için yeni amaç/izin eklenmez.

Amaç işareti 32 rastgele byte'dan oluşan state'in sonuna sürümlü olarak eklenir; mevcut DB'ye tam state'in özeti yazılır. Yeni kolon veya eşleme tablosu yoktur. Dönüşte yalnız kanonik ASCII state kabul edilir ve mevcut provider/kurulum nesline bağlı atomik claim tam özeti doğrular. İşareti ekleme/silme/değiştirme, replay ve ASCII'ye dönüşürken aynı byte'ları üretebilen Unicode taklitleri testlerde reddedildi. Dönüşte verilen bağımsız profil alanı kullanılmaz. PKCE, nonce, callback allowlist ve TTL korunur.

Ek izin amacında Google gerçek token yanıtının scope alanında iki izni de vermelidir; eksik alan mevcut Ads-only varsayımıyla doldurulamaz. Meta mevcut uygulamaya bağlı token incelemesinde tam bağımlılık listesini vermelidir. Eksik izin credential store/account discovery öncesinde hata verir; yeniden deneme yapılmaz. Google'ın bu akışındaki gerçek izin listesi pending account selection kaydına taşınır; Ads discovery sabitiyle daraltılmaz. Bu sonuç Merchant/katalog varlığına erişimi veya Shopify ürün kimliği bağlantısını kanıtlamaz.

**7. adım hâlâ açık:** Güvenilir sunucuda yeni amacın hangi onaylı koşulda açılacağı, yeniden yetkilendirme/credential yenilenmesi ve taze varlık yetkisi, Shopify izin isteği/yapılandırması ve grant dönüşü, uygulama incelemeleri ve gerçek mağaza okuma testleri sonraki işlerdir. Yeni amaç mevcut route/Settings tarafından henüz seçilmez. Route/UI, canlı scope/token, DB/migration, Dataset ve tarihsel PMax işi değişmedi. Makine kaydı: `contracts/eo-05-start-brief-v1.json#identity_OAuth_scope_binding_2026_10_27`. Önceki #189 Excel'i plan anının görüntüsü olarak korunur.

Resmî kontrol 27 Ekim 2026: [Google OAuth state ve gerçek scope yanıtı](https://developers.google.com/identity/protocols/oauth2/web-server), [Merchant ek izin](https://developers.google.com/merchant/api/guides/authorization/access-client-accounts), [Meta izin bağımlılıkları](https://developers.facebook.com/documentation/development/permissions). Meta'nın 19 Ekim güncellemeli resmî sayfası aynı oturumda tarayıcı erişilebilirlik metninden okunmuştur. Dört katalog bağımlılığı istek hedefidir; gerçek mağaza izni/erişimi henüz kabul edilmedi.

## 7. adım — izin kapsamı ön kontrolü, 27 Ekim 2026 repository dilimi

#189 `7cd3216b8939df5cafec9bec4d983304630e7900` ile main'e birleştirildi. 26 adımlı sıra korunur. Bu dilim `assessIdentityPermissionScopes` ile gerçek kaynaktan geldiği sunucu tarafından sağlanan izin listesini hedefle karşılaştırır; `readShopifyPermissionScopes` doğrulanmış Admin istemcisiyle `shop` ve `currentAppInstallation { id accessScopes { handle } }` okumasını hazırlar. Shopify kurulum scope'u boş veya ürün okumasıyla sınırlı olabilir; TOML'daki istek listesi gerçek grant değildir. Okuyucu aynı mağaza kimliğini kontrol eder, tek çağrı yapar ve ilk hatada durur. Hata gövdesi/token taşıyabilecek SDK mesajı gösterilmez; varsa güvenli HTTP status korunur.

Hedefler: Google mevcut Ads iznine ek Merchant `content`; Meta mevcut `ads_read` yanında `catalog_management`, `business_management`, `pages_read_engagement`, `pages_show_list`; Shopify `read_products` ve `read_orders`, 60 günden eski sipariş seçilirse `read_all_orders`, MarketingEvent seçilirse `read_marketing_events`; Klaviyo mevcut beş izin değişmeden. Shopify'da önceden verilmiş ilgili write izni read'i karşılayabilir, fakat yeni write izni talep edilmez. Google content ve Meta management izinleri teknik olarak salt okunur değildir; uygulamanın kullanım hedefi yalnız okumadır.

Eksik gözlem `unknown`, güncel/tam kaynakta eksik izin `observed_missing`, karşılanan scope listesi `observed_sufficient` olur. Workspace/mağaza/kurulum nesli/provider/bağlantı/hesap uyuşmazlığı, on dakikadan eski veya gelecekteki gözlem, kısmi kaynak ve request/config kaynaklı liste yeterli sayılmaz. Bu kontrol yalnız tanıdır: tüm scope'lar eşleşse bile App Review, protected customer data, Merchant proje kaydı veya seçili katalog/Merchant varlığına erişimi doğrulamaz ve aktivasyon yetkisi üretmez. Diğer provider'ların ham scope okuyucuları bu dilimde eklenmez. Google'ın mevcut normalize token çıktısındaki varsayılan scope, ham scope kanıtı yerine kullanılamaz.

**7. adım açık kalır:** transaction'a bağlı ek scope isteği ve callback doğrulaması, güvenilir canlı çağırıcı/credential bağı, uygulama erişim incelemeleri, onaylı yapılandırma, mağaza onayı ve gerçek grant/ürün/sipariş okuma testleri tamamlanmalıdır. Önceki OAuth builder/callback'leri, Shopify config ve canlı izinler değiştirilmedi. Bu okuyucu route/scheduler'a bağlanmadı; testlerde sentetik yanıt kullanıldı. Kalıcı eşleme/Dataset yazımı ve 14. sıra öncesi durak korunur. #179 kendiliğinden merge edilmez; PMax duraklaması açılmaz. PR #189 Excel'i planlama anının görüntüsüdür; canlı ilerleme defteri bu bölüm ve EO-05 brief'idir.

Resmî kontrol 27 Ekim 2026: [Google Merchant erişimi](https://developers.google.com/merchant/api/guides/authorization/access-client-accounts), [proje kaydı](https://developers.google.com/merchant/api/guides/quickstart/registration), [Meta izinleri](https://developers.facebook.com/documentation/development/permissions), [Shopify scope'ları](https://shopify.dev/docs/api/usage/access-scopes), [kurulum grant'i](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation), [Admin istemcisi ve tries seçeneği](https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin), [MarketingEvent](https://shopify.dev/docs/api/admin-graphql/latest/objects/MarketingEvent), [korunan müşteri verisi](https://shopify.dev/docs/apps/launch/protected-customer-data), [Klaviyo Events](https://developers.klaviyo.com/en/reference/get_events) ve [Metrics](https://developers.klaviyo.com/en/reference/get_metrics). Kurulu React Router 3.0.1 istemcisinde de tries seçeneği ve tries eksi bir retry aktarımı kontrol edildi; yeni okuyucu tries: 1 geçirir. Meta web okuyucusu başarısız oldu; 19 Ekim güncellemeli resmî sayfa tarayıcının erişilebilirlik metninden salt okunur olarak okundu. Belge/scope listesi gerçek mağaza izni, kaynak kimlik kuralı veya satış rolü kanıtı değildir.

## Revize 26 adımlık kodlama sırası ve EO-05/06 paket özeti — 27 Ekim 2026

Ürün sahibinin istediği önceki 26 adımın sırası korunarak Shopify satış/atıf ek işleri açık alt işler olarak kaydedildi: [okunabilir plan ve paket özeti](plans/EO_05_06_REVISED_PLAN_2026_10_27.md), [26 adım kaynak kaydı](plans/eo-05-06-revised-26-step-plan-2026-10-27.json), [paket özeti kaynak kaydı](plans/eo-05-06-package-summary-2026-10-27.json) ve [iki sayfalı Excel](plans/AdsTable_26_Adim_ve_EO05_EO06_2026-10-27.xlsx).

Yeni sıra/paket açılmadı. Shopify ek işleri 7, 12–15, 20, 23–24 ve 26. sıralarda görünürdür. 1–6 yalnız repository kod teslimleridir; canlı akış kabulü değildir. 14. sıra kimlik alt listesinin 12. adımından önceki değerlendirme durağıdır. Tarihsel PMax 22. sırada duraklatılmıştır. Kanıt ve formül bekleyen işler açık kalır. Bu plan kendi başına canlı izin, migration veya veri yazımı yetkisi vermez; #179 güncel kararlarla uzlaştırılmadan kabul edilmez.

## Shopify sipariş satış temeli ve ayrı atıflar — 27 Ekim 2026, kabul edilen ek karar

Ürün sahibi #187 merge sonrasında, sıradaki OAuth/izin hazırlığından önce Shopify siparişlerini bağımsız satış referansı olarak alma ve Shopify atfı ile Meta/Google/Klaviyo atıflarını ayrı koruma önerisini açıkça kabul etti. Karar `contracts/pd-cpd-query-standard-v1.json#shopify_order_attribution_decision_2026_10_27` içindedir; EO-05 brief'i ve master kaydı buna bağlıdır. #187 `5657ce49c2c93b4d018c4606e08134a311754c33` ile main'dedir. #179'un açık geniş iş planı kabul edilirken bu bağlayıcı ek de uzlaştırılmalıdır; #179 otomatik merge edilmez.

Satış referansı yalnız paid-ad etiketli siparişler değildir: erişime izin verilen tüm sipariş ve ürün satırları kapsanır; paid/organic/direct/unknown ayrımı kanıta göre yapılır. Mantıksal sipariş anahtarı workspace + mağaza + Shopify Order ID; satır anahtarı bunlara ek Shopify LineItem ID'dir. Product/Variant ID sipariş tekilleştirme anahtarı değildir. Replay/güncelleme yeni satış olarak eklenemez; iptal/iade/düzenleme etkileri ve satış tutarının vergi/kargo/indirim kapsamı tasarlanmalıdır. Shopify ziyaretinin bulunması, provider'ın aynı siparişi dönüşüm olarak saydığını kanıtlamaz. Native sipariş kimliğiyle provider atıf iddiası aynı siparişe doğrulanmış bağ kurmadan kesin overlap ilan edilemez; toplamlardaki fark tek başına overlap değildir.

Shopify atfı ve provider atfı bağımsız kaynak/model kayıtları olarak korunur; biri diğerinin üzerine yazılmaz. Tarih/raporlama zamanı, para birimi/FX, sipariş adedi/ürün adedi, vergi/kargo/indirim/iade ve atıf penceresi/olgunluğu aynı temele alınmadan karşılaştırma yapılmaz. Shopify ilk/son ziyaret ve ready/eksik durumları korunur; her siparişin Facebook/Instagram veya native Ad/Message ID ayrımı taşıdığı varsayılmaz. `MarketingEvent.remoteId` doğrudan native reklam/mesaj kimliği sayılmaz. Dördüncü reklam provider'ı eklenmedi; mevcut PD/CPD matrisi ve Sales Role'ler değişmedi. Fiziksel tablo sayısı/şema seçilmedi.

**Mevcut sıraya bağlama:** Sıradaki OAuth/izin hazırlığı `read_orders`, 60 günden eski erişim gerekiyorsa koşullu `read_all_orders`, MarketingEvent okunacaksa `read_marketing_events` ve diğer uygulamaların etkinliklerine erişim sınırını, ayrıca protected customer data başvurusunu birlikte ele alacak. Mağaza sahibinin onayı, Shopify uygulama erişim onayıyla aynı şey değildir. Bu iş için müşteri adı/e-posta/telefon/adres veya `write_orders` talebi yoktur. İzinler bu kararla TOML'a eklenmez, canlı grant/reauthorization yapılmaz. EO-05-B sipariş/satır kimliği, idempotency, satış kapsamı ve ayrı atıf saklama tasarımını; EO-05-C model/pencere/ready/olgunluk ayrımını; EO-06-A çapraz provider toplamlarının satış temelini kapsar. Yeni iş paketi veya paralel aktif paket açılmaz. Kimlik 12 öncesi durak ve tarihsel PMax duraklaması korunur.

Resmî kaynaklar 27 Ekim 2026'da okundu: [Orders erişimi](https://shopify.dev/docs/api/usage/access-scopes#orders-permissions), [Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [LineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem), [CustomerJourneySummary](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary), [CustomerVisit](https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerVisit), [MarketingEvent](https://shopify.dev/docs/api/admin-graphql/latest/objects/MarketingEvent), [marketingEvents](https://shopify.dev/docs/api/admin-graphql/latest/queries/marketingEvents), [korunan müşteri verisi](https://shopify.dev/docs/apps/launch/protected-customer-data). `marketingEvents` listesi marketing app ile ilişkili tarif edilir; ek scope tüm üçüncü taraf etkinliklere erişim kanıtı sayılmaz. Bu teslim karar/plan/sözleşme kaydıdır; reader, DB veya canlı atıf kabulü değildir.

## EO-05 PD kaynak kaydı → canonical doğrulama köprüsü — 27 Ekim 2026

Sıralı planın altıncı teslimi, #186'nın `99f6474bc49ff70a084ca5916bc3631f05187ba1` ile main'e birleşmesi üzerine hazırlanır. `bridgePdSourceToCanonical`, Google/Klaviyo kaynak birleştiricilerinin çıktısını ayrı, kapsamı bağlı zenginleştirme metadata'sıyla mevcut `validateCanonicalFunnelFact` ve `canonicalFactKey` kontrollerine bağlar. Beklenen kapsam orkestrasyondan gelmelidir; kaynak ve metadata workspace/kurulum/generation/hesap/yaprak/üst kimlik/gün/saat dilimi/para birimi/atıf/run/snapshot boyutlarında aynı kapsama ait olmalıdır. Leaf/root/parent adları ve kimlikleri, zaman motoru, adapter/synthetic/provenance alanları ve entity/time/FX/raporlama para birimi kanıt referansları zorunludur. ID'den ad türetilmez; hiyerarşi tahmin edilmez.

FX girdisi kaynak/hedef para birimi, pozitif sonlu kur, geçerli kur gözlem günü, provider ve motor sürümüyle açıkça gelmelidir. Kurun hangi iş günü için sağlandığı ayrıca bağlanır; kur gözlem günü ile iş günü zorunlu olarak aynı sayılmaz. Köprü hangi eski günün kullanılacağına veya hangi provider'a gidileceğine karar vermez. Aynı para biriminde de açık metadata ve 1 kur gerekir; otomatik varsayım yoktur. Kaynak metrikleri kurla çarpılmaz, null/sıfır ve gözlem durumları aynen korunur. Gözlenen metriklerin kaynak aile/referans/native alan/satır ordinali native projeksiyonda çözülebilmeli; dangling/duplicate kaynak izi reddedilmelidir.

Metadata eksik/çelişkiliyse veya mevcut canonical validator metriği reddederse canonical satır üretilmez; orijinal kaynak kaydının değişmez kopyası çözümleme için korunur. Başarılı `canonical_validated` yalnız biçim/bağ uyumu kontrolüdür: canlı hesap yetkisi, gerçek FX kanıtı, tam metrik kapsamı veya yayımlama izni değildir. Kaynak detayları ve zenginleştirme referansları canonical provenance içinde saklanır; tüm sonuçlar `publishable: false` kalır. Bu teslim yeni FX motoru/politikası, canlı metadata/provider/OAuth çağrısı, Meta decoder, Dataset şeması/writer veya migration içermez. Bunlar sonraki ilgili kapılardadır; kimlik 12 öncesi durak, Klaviyo rol kapanışı ve tarihsel PMax duraklaması korunur. Common adapter v3.0.0 ve mevcut validator gevşetilmedi. Dış API/kütüphane davranışı eklenmedi; çalışma dahili sözleşme/test kapsamındadır. Testler sentetik Google/Klaviyo composer çıktılarıyla uçtan uca köprü ve hata durumlarını kapsar; canlı kabul değildir.

## EO-05 Klaviyo PD mesaj birleştirmesi — 27 Ekim 2026

Sıralı planın beşinci teslimi, #185'in `f01d31ee7f741e70513bfe96e8750d4f405580a5` ile main'e birleşmesi üzerine hazırlanır. `composeKlaviyoPdMessage`, mevcut Campaign/Flow PD raporlarının Placed Order, Added to Cart ve Checkout Started projeksiyonlarını ortak kapsam kapısıyla tek mesaj/gün kaynak kaydına bağlar. Placed Order teslim/tıklama/purchase, diğer iki rapor yalnız kendi funnel adet/değerlerini sağlar. Spend null/açık kalır; yeni maliyet formülü veya Ordered Product fallback'i eklenmez. Campaign Assisted / Flow Triggered / Unclassified kararları ve Advertised/Cross-sell araştırmasının kapanışı değiştirilmez.

Üç ayrı Shopify metric ID'si veya açık configuration-missing keşif durumu gerekir. İstek kanıtının revision/tür/metric ID/istatistik/group_by ve doğrulanmış hesap saat dilimindeki tam iş günü penceresi kontrol edilir. Reporting zamanı send-date'tir; event oluşum zamanı değildir. Native mesaj ve Campaign/Flow üst kimliği eşleşir. send_channel ve variation ayrıntıları tutulur; variation yeni hiyerarşi seviyesi değildir. Aynı ayrıntı iki kez toplanamaz. Aynı medium için variation'sız toplam ile variation detayının karışması reddedilir; mesaj toplamı varyantlara dağıtılmaz. Bir raporda eksik detay varsa ilgili mesaj toplamı null/partial kalır; diğer bilinen metrikler ve native detaylar korunur. Configuration missing, empty ve gerçek zero ayrıdır. Sayısal taşma/güvensiz tamsayı reddedilir.

Kaynak referansları ve native satırların değişmez kopyası saklanır; ordinal yalnız referans verilen mesaj projeksiyonu içindedir. Belgelenmiş `push-notification` değeri mevcut Push normalizasyonuna eklenir; native değer korunur, `push` alias'ı ile aynı grouping'in çift sayılması reddedilir. Üç rapor da boşsa mesaj yaratılmaz. Sekiz sahipli metrik gözlense dahi Spend açık ve `publishable: false` kalır. Bu kaynak birleştiricisidir; canlı çağrı/dispatcher, metadata hazırlama, canonical/FX bridge veya Dataset writer bağlantısı değildir. Bu bağlantılar sıralı planın sonraki maddelerindedir; kapsam/fingerprint uydurulmaz. Kimlik 12 öncesi durak, Meta kanıtı ve tarihsel PMax duraklaması korunur; 17–19 / EO-05 kapanışı verilmez.

27 Ekim 2026 resmî kontrolü: [Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values), [Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values), [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview) ve [Campaign OpenAPI](https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/query_campaign_values.json). Overview send-date esasını ve grouping'leri, OpenAPI tekil grouping satırlarını ve hesap saat dilimi esasını açıklar. Eski `using_the_reporting_api` yolu okunamadı; kanıt olarak kullanılmadı. Yeni provider sorgusu/izin veya canlı işlem eklenmedi; testler sentetik native raporlardır.

## EO-05 Google PD yaprak birleştirmesi — 27 Ekim 2026

Sıralı planın dördüncü teslimi, #184'ün `6d78fad994a61cdf0feca92654949ed6c6510bb9` ile main'e birleşmesi üzerine hazırlanır. `composeGooglePdLeaf`, mevcut Google query ailelerinin aynı yaprak/gün projeksiyonlarını ortak uyumluluk kapısından geçirir: Search Ad, Shopping Ad Group ve Retail PMax Asset Group. Performans kaydı yalnız impression/click/spend'i bir kez sağlar; normal dönüşüm eylemleri ADD_TO_CART, BEGIN_CHECKOUT ve PURCHASE adet/değerlerini ayrı ayrı sağlar. Performansın genel conversions toplamı, campaign helper, all kapsamı veya cart data PD funnel yerine kullanılamaz. Bu işlem Google'ın eylem bazında ayrılmış metriklerini toplar; Shopify siparişlerini tekilleştirdiğini iddia etmez.

Native customer/campaign/parent/leaf/gün/tür, eylemin aynı hesaba ait olması ve seçilmiş segment grain'i ayrıca kontrol edilir. Yinelenen eylem, çelişkili kimlik veya beklenmeyen ek segment reddedilir. Kaynakta eksik satır sıfır değildir. Bir eylemde value eksikse bilinen purchase adedi korunur; eksik toplam value null/partial kalır, gözlenen alt detay kaynakta saklanır. Sayısal taşma/güvensiz tamsayı reddedilir. Her metrik native alan/aile/leaf-projeksiyonu referansı/satır ordinaline bağlanır; native satırların değişmez kopyası ve eylem detayları korunur. Native negatif düzeltme de kaynak kanıtında korunur; mevcut canonical negatif sayı/FX/ad/kimlik kontrollerini geçmeden yayımlanamaz.

Bu callable kaynak birleştiricisidir; canlı scheduler/transport bağlantısı, hesap/atıf metadata hazırlama, FX veya canonical bridge değildir. Beklenen kapsam ve projeksiyon kapsamı daha sonraki orkestrasyon adımından kanıtlı olarak gelmelidir; fingerprint/metadata uydurulmaz. İki projection tamamen boşsa yaprak yaratılmaz; sonucu eksikse partial, doluysa source-composed olur; her durumda `publishable: false`. DB/migration ve live trigger değişmedi. Klaviyo birleştiricisi sıradadır; PMax ürün bağlantısı/tarihsel iş ve Meta rol kanıtı açılmadı. Kimlik 12 öncesi durak korunur; 17–19 ve EO-05 kapanışı verilmez.

Resmî kaynaklar 27 Ekim 2026'da okundu: [Conversion reporting](https://developers.google.com/google-ads/api/docs/conversions/reporting) conversion-action grain'ini ve sıfır dönüşümlü satırların çıkarılabildiğini; [Segmentation](https://developers.google.com/google-ads/api/docs/reporting/segmentation) resource/segment grain'ini açıklar. V25 genel metrics sayfası timeout verdi, o sayfa okundu sayılmadı; yeni GAQL alanı/uyumluluk iddiası eklenmedi. Doğrulama sentetik native-projection testleridir; gerçek provider kabulü değildir.

## EO-05 ortak kayıt uyumluluk kontrolü — 27 Ekim 2026

Sıralı düzeltme planının üçüncü teslimi, #183 ile güncellenmiş main `5e31bd03af6e65a507dfd7c6f1c273c4489efd1e` tabanında ortak PD kapsam kontrolüdür. `app/lib/providers/pd-composition-scope.server.js` içindeki `checkPdCompositionCompatibility`, orkestratörün verdiği beklenen kapsam ile kaynak kapsamlarını karşılaştırır. Workspace/kurulum/generation, provider/connection/hesap, akış/yaprak/üst kimlikler, iş günü/saat dilimi/raporlama zamanı, kaynak para birimi/birim özeti, etkin atıf/kapsam ve ortak run/deneme/snapshot uyuşmalıdır. Eksik, kısmi, başarısız veya sınırlandırılmamış kaynak reddedilir; aynı aile/kaynak referansı tekrar toplanmaz. Üst kimlikler adlardan bağımsız karşılaştırılır. Klaviyo reporting-account NULL kuralı korunur.

Bu yalnız dahili karşılaştırma yardımcısıdır: provider yanıtı veya fiziksel Dataset şeması değildir. Kapsamların eşit olması kaynak doğruluğu, metrik sahipliği, ayrıklık veya tamlık kanıtı sayılmaz. Birim/atıf özetleri bilinmeyen metadata için uydurulamaz; bunların gerçek kaynaklardan hazırlanması Google/Klaviyo composer bağlantısında ayrıca yapılacaktır. Kontrol herhangi bir metriği toplamaz, null/sıfır durumunu değiştirmez ve başarılı olsa da `publishable: false` döner. Mevcut canonical FX/ad/kimlik doğrulaması korunur. Sonraki sıralı teslimler Google ve Klaviyo PD birleştirmesini bu kapıya bağlayacaktır; şu anda canlı yol değişmez. Yeni dış API/kütüphane semantiği eklenmedi. Kimlik 12 öncesi durak, Meta rol kanıtı, Klaviyo rol kapanışı ve tarihsel PMax duraklaması korunur; 17–19 veya EO-05 tamamlandı sayılmaz.

## EO-05 güncel durum ve sözleşme uyumu — 27 Ekim 2026

Ürün sahibinin kodlamaya başlama ve #182 merge onayı sonrasında EO-05'in güncel durumu **In progress — repository uygulaması; canlı kapılar kapalı** olarak kaydedilir. İlk hata düzeltmesi #182, `114cc746be4cc28b0fe2c2a047e7d014212cae28` ile main'e birleşti; kod blob'u doğrulandı. Aktif ana paket EO-05'tir; yeni alt paket veya eşzamanlı aktif parent açılmaz. Alt paket/kapsam kabulü ve EO-05 kapanışı verilmez. Önceki başlangıç brief'inin bekliyor/başlamadı ifadeleri tarihsel kayıt olup bugünkü repository ilerlemesinin yerine geçmez.

Bu ikinci dar teslim yalnız durum/sözleşme ve bunları sınayan testlerin uyumudur; provider runtime davranışı #182 sonrasında değiştirilmez. Klaviyo Advertised/Cross-sell araştırması 26 Ekim ürün kararıyla kapalıdır; geçerli Campaign Assisted, Flow Triggered ve mevcut Unclassified kuralları kalır. Provider desteklemiyor sonucu çıkarılmaz. Meta'nın native ilişki çözücüsü/gerçek kanıtı ve Google rol bağlantıları açıktır; ürün kümesi üyeliği tek başına rol kanıtı değildir. EO-04 analiz kitabının eski örnekleri tarihsel senaryo hedefleridir, güncel provider desteği veya çalışan rol decoder'ı kanıtı değildir.

#179 kimlik okuyucuları ve iş planı, #180 Meta classifier ve #181 Klaviyo etkileşim okuyucusu açık/merge edilmemiş kayıtlardır; main veya canlı teslim gibi gösterilmez. Bu teslim onların kodunu taşımaz. Kimlik listesindeki 12 öncesi değerlendirme ve açık onay, tarihsel PMax duraklaması, canlı API/OAuth/DB/UI/deploy kapıları korunur. EO-05 başlangıç sözleşmesindeki runtime yetkisi yalnız kullanıcı tarafından kabul edilmiş sıralı repository işidir; tek başına canlı işlem veya tüm paketi uygulama izni değildir. Tamamlama/PASS için repository, entegrasyon ve gerçek sağlayıcı kanıtı ayrı izlenir.

## EO-05 kod eksikleri — ilk hata düzeltmesi, 27 Ekim 2026

Ürün sahibi 27 Ekim sıralı kodlama planına başlanmasını onayladı. Bu ilk dar teslim, güncel main `dc565a4` tabanından `codex/eo05-first-error-policy` branch'inde hazırlanır; #179 kimlik/iş-planı ve #180/#181 kodları taşınmaz. GitHub Connector, uzak main, görev branch'i ve yerel envanter ayrı doğrulandı. Ortak runner'ın otomatik retry döngüsü kaldırıldı; her sayfa tek çağrı, ilk hatada terminal sonuç ve sıfır yayımlanan satır verir. Caller >1 attempt seçemez; classifier retry isteği etkisizdir. `Retry-After` değişmeden metadata kalır; bozuk/atan classifier gizli ayrıntısız terminal hata olur. Normal sayfalama ve tam/çelişkisiz sonuç kabulü korunur.

Meta classifier'ın geçici/quota hata türleri korunarak `retryable: false` yapılır; permission sınıfı `permission_or_scope_missing` ile ortak sözlüğe bağlanır. Provider'ın yeni kod/alan semantiği eklenmez. Ayrıntı `contracts/eo-04a-common-adapter-start-brief-v1.json#first_error_policy_2026_10_27`, analist brief'i `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md` içindedir. Resmî Google hata tipleri ve Meta SDK exception metadata'sı 27 Ekim okundu; Meta Graph doküman isteği 429 olduğundan o sayfa doğrulandı sayılmaz. Bu repository kodudur; native provider/OAuth/DB çağrısı, canlı aktivasyon, UI/deploy veya paket kapanışı yoktur. Kimlik 12 öncesi kullanıcı durağı, Klaviyo rol kapanışı ve tarihsel PMax duraklaması değişmez. Geniş teknik iş planı #179'da açık, bu düzeltmenin merge'ü ayrı açık kullanıcı onayına bağlıdır.

## Ortak adaptör kurulum kimliği düzeltmesi — 26 Ekim 2026

- Ürün sahibi dar kimlik düzeltmesini onayladı. Başlangıç main `a0d5d1194e8cae2cde0033674e66e400f4278ee3` (#177). Mevcut DB bigint kurulum ID'si korunur; yalnız ortak adaptör istek/fact UUID kontrolü `1`–`9223372036854775807` aralığındaki canonical ondalık metin kontrolüne dönüştürülür. Number'a çevirme, yeni UUID, alias veya DB değişikliği yoktur.
- Kabul edilen temsil kırıcı değiştiği için runtime/types ve iki aktif sözleşme `3.0.0` sürümünde hizalanır; eski envelope ve UUID fixture'ları sessizce kabul edilmez. Bu teknik sözleşme sürümüdür, yeni iş paketi değildir. Dokuz metrik, workspace/connection UUID, provider hesap ve Klaviyo NULL reporting-account davranışı korunur.
- Son SQL/repository incelemesi reporting_account_id'nin dahili binding ID'si değil seçilmiş native provider_account_id olduğunu doğruladı. İnceleme notu mevcut analiz belgesine işlendi. Kurulum kimliği DB resolver/writer'a bağlanmadı; biçim doğrulaması sahiplik kanıtı değildir. FX/ad zorunluluğu, fiziksel Dataset, 05/10/11/15 ve 17–19 açık kalır.
- PostgreSQL 17 numeric ve node-postgres types resmî belgeleri 26 Ekim 2026'da okundu. Test/CI ve açık merge onayı gerekir. Migration, canlı DB/provider çağrısı, token/izin, UI, deploy veya EO-05-B writer başlangıcı yoktur.

## Beş tablo kolon sözlüğü — 26 Ekim 2026 inceleme taslağı

- Ürün sahibi beş tabloluk Dataset tasarımında kolon ve zorunluluk incelemesine devam talimatı verdi. Başlangıç main `568f6642b62688774199a550ac8b41395f2f988c` (#176). Mevcut sorgu çalışma belgesine `pd_facts`, `cpd_product_performance_facts`, `cpd_product_sales_facts`, `product_identity_mappings`, `fx_rates` için ortak/adaya özgü kolon, tip, boşluk ve kaynak kuralları eklendi. Bu adlar ve tipler inceleme önerisidir; oluşturulmuş tablolar değildir.
- Eski 13 sütunlu sorgu matrisi ve beş sütunlu/15 satırlık kaynak eşleme tablosu değişmez. Teslim edilmiş Excel bu yeni sözlüğü içermez; aynı sürüm diye sunulmaz. Üst PD/CPD Channel için altıncı kalıcı toplam tablosu önerilmedi; hesaplanan görünüm hedefi henüz uygulanmadı.
- Supabase/Postgres becerileriyle mevcut DB ve adaptör tipleri kontrol edildi. DB installation ID bigint/adaptör UUID kontrolü, canonical reporting ID/DB binding eşdeğerliği ve adaptörün ad/FX zorunluluğu uygulama öncesi açık uyarlama kontrolleri olarak kaydedildi; kod düzeltilmedi. Native saklama, doğrulanmış tekillik, çözülmüş bağlantı ve yayın hazırlığı ayrıdır.
- Sözlük 16 + 20 + 22 girdisidir. Exact UNIQUE/FK/index/RLS SQL'i, mapping geçerlilik/sürüm tekilliği, kur kaynağı/tarih/kimlik dönüşümü ve para birimi kilidi açık kalır. 05/10/11/15 ve 17–19 kapanmaz; EO-05-B uygulaması, writer, migration/DB, yeni provider çağrısı, izin, UI/deploy veya 21/23 işi başlamaz. Merge ayrıca açık onay gerektirir.

## Ortak kayıt eşleme analiz kaydı — 23 Ekim 2026

- Ürün sahibinin kabul ettiği beş sütunlu PD / CPD ürün performansı / CPD ürün satışı düzeni, mevcut `docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md` dosyasına aynı 15 satırla işlendi. Teslim edilen Excel aynı tablonun çıktısıdır; eski 13 sütunlu sorgu matrisi değiştirilmedi. Başlangıç main `77c9efe0e1d32e99a7877658e2df474940ce1d9d` (#175).
- Bu yalnız analiz kaydıdır: 16 + 20 + 22 için kaynak kapsamı ve bağlantı ayrımını görünür kılar; fiziksel model/unique key, runtime composer/toplam, FX/formül, DB, provider çağrısı, izin, deploy veya EO-05-B başlangıcı değildir. 17–19 tasarım kontrolü uygulama kapanışı sayılmaz.
- Meta 05, Google PMax 10/11 ve Klaviyo 15 açık kalır. Ürün sahibi Klaviyo ürün etkileşim yolu için yeni kod geliştirmeden devam edilmesini istedi; mevcut roller korunur. Yeni sağlayıcı araştırması veya tarihsel PMax işi açılmadı.
- Kaynak kodla tablo kontrolü yapıldı; bu yeni provider desteği/live kabulü değildir. GitHub PR resmî belgesi 23 Ekim 2026'da kontrol edildi: https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request . Dokümantasyon PR'ının merge'ü ayrıca açık onay gerektirir.

## 18–19 — Üst hiyerarşi ve CPD Channel toplamı tasarımı, 23 Ekim 2026

- PR #174 açık kullanıcı onayıyla `d0d3b0e6962b2ed8fe9af487108e0902cb9cf115` olarak birleşti. Bu dilim o main'den başlar. Yalnız 18–19 inceleme taslağı eklenir; 17'nin runtime birleşimi, toplama kodu, fiziksel model, DB/FX/formül veya canlı işlem başlamaz. Tasarım `contracts/pd-cpd-query-standard-v1.json#hierarchy_channel_review` içindedir; ürün sahibi incelemesi beklenir.
- 18: Üst PD toplamının girdisi 17 ile birleşmiş yaprak metrikleridir; bütün ham rapor satırları değildir. Mevcut provider hiyerarşileri korunur. Parent + child veya Campaign yardımcı sorgusu birlikte sayılmaz. Üst kimlikler isimden tahmin edilmez. Klaviyo Variation detayı Message'ta bir kez ele alınır, yeni Channel seviyesi olmaz. Oranlar toplanmaz/ortalaması alınmaz; aggregate-first KPI EO-06-A sahibidir.
- 19: Ürün performansı teslim/maliyet kaynağı, ürün satışı adet/değer kaynağıdır. Her aile kendi native fact kapsamıyla tekilleştirilip bağımsız toplanır; ham ürün performansı × satış JOIN'iyle satır çoğaltılmaz. Tekilleştirme yalnız Product ID veya snapshot indeksiyle yapılmaz. Satışsız performans/maliyet ve performansı görülmemiş satış ayrı ayrı korunur. PD tutarı eksik ürün toplamına yedek, bakiye veya eşitlik hedefi yapılmaz. Satılmayan ürün maliyeti satanlara dağıtılmaz; maliyet satış/rol başına kopyalanmaz.
- Google normal satış toplamı units_sold/revenue_micros'tur; total + lead + cross-sell birlikte toplanmaz, genel ve scoped cart raporları aynı satışa eklenmez. Meta toplam/promoted alanları semantik kabul olmadan toplanmaz veya çıkarılmaz. Klaviyo tek Ordered Product olayı birden çok görünümde satış diye tekrarlanmaz; Placed Order adedi buna eklenmez. Provider atıflı satışlar Shopify'ın tekilleştirilmiş mağaza satışları ilan edilmez.
- Kapsam/tamlık metrik bazındadır. Bilinen ara toplam tam toplam yapılmaz; N/A, eksik ve boş yanıt sıfır değildir. Farklı kaynak para birimleri FX öncesi toplanmaz. Gün/saat dilimi/raporlama zamanı/atıf uyuşmazlığı gizlenmez; uzlaştırma 21'de kalır. Native ürün veya Channel belirsizliği veriyi silmez, kimlik/rol tahmini üretmez. Klaviyo ürün Impression/Click N/A ve Spend açık kalır; varyant fiyatından satış tutarı üretilmez.
- Meta 05 gerçek veri kabulü, Klaviyo 15 yeniden tartışma, 16 kalıcı kimlik ve PMax 10/11 teknik yanıt/tarihsel duraklama kapıları korunur. Yeni EO paketi/kolon veya provider sorgusu yoktur. 17–19 kapatılmaz; testler tasarım sınırını korur, çalışan toplamı kanıtlamaz. Merge ayrıca açık onay gerektirir.

## 17 — PD birleşim tasarımı incelemesi, 23 Ekim 2026

- Ürün sahibi bütünleşik tasarım kontrolüne devam talimatı verdi. Bu dilim yalnız 17'nin inceleme taslağıdır; runtime composer, DB/FX, üst toplam (18), CPD Channel toplamı (19) veya yeni paket başlangıcı değildir. Başlangıç main `ac8a192182ceb7664453d1e9cabb2508831854e2` (#173). Bağlayıcı tasarım ayrıntısı ortak sorgu sözleşmesinin `pd_composition_review` bölümündedir; ürün sahibi incelemesi beklenir.
- PD'deki her metrik yalnız kendi kaynak raporundan alınır. Meta mevcut Ad projeksiyonu; Google uç performansı + ayrı normal dönüşüm eylemi raporları; Klaviyo Placed Order + Added to Cart + Checkout Started. Ürün performansı ve Ordered Product/cart satışları PD metrik yedeği olmaz. Mevcut ham yanıtlar değişmez; yeni sorgu veya provider davranışı eklenmez.
- Mevcut canonical anahtar başlangıçtır, tek başına yeterlilik kanıtı değildir. Kurulum/hesap/akış/yaprak/üst kimlikler, gün/saat dilimi/raporlama zamanı, kaynak para birimi/birim, etkin atıf/kapsam ve tam yürütme uyuşmalıdır. Bunların yokluğu tahminle doldurulmaz. Klaviyo Medium/Variation ayrıntıları korunur; mesaj toplamı her varyanta tekrar yazılmaz. Google'da farklı dönüşüm eylemleri, kaynak ayrıklığı ve tamlığı kanıtlanmadan körlemesine toplanmaz.
- Eksik metrik gerçek sıfır değildir; gözlenen diğer metrikleri silmez. Adet değerden türetilmez. Kısmi/başarısız/çelişkili rapor tam birleşim sayılamaz. Her metriğin kaynak izi korunur. Mevcut canonical doğrulayıcı için sahte FX/kimlik üretilmez. Testler yalnız bu tasarım sınırlarının korunmasını gösterir, runtime birleşim veya canlı kabul değildir.
- 05'te Meta'nın dört alanı standart sorguda kalır, anlam/rol kabulü gerçek veriyle yapılacaktır; ek araştırma bu dilimde sürdürülmez. 15'te Klaviyo Advertised/Cross-sell maddesi geldiğinde ürün sahibiyle yeniden tartışılır, mevcut roller değişmez. PMax ürün bağlantısı Google teknik cevabını bekler; 11 tarihsel iş açılmaz. 16 kalıcı kimlik işi EO-05-B'de kalır. 17/18/19 kapatılmaz; merge ayrıca açık onay gerektirir.

## Google ürün sorgusu ayrımı — 23 Ekim 2026, dar repository düzeltmesi

- Ürün sahibi Shopping/PMax ortak ürün sorgusunun ayrılmasını açıkça onayladı. Başlangıç main `6947b200ed6bd05441405751b7848b2a84151ee7` (#172). Bu dilim 09/10 kaynak sorgusu düzeltmesidir; yeni paket veya Channel seviyesi kararı değildir.
- `shopping_product_daily`, mevcut bütün ürün alanları/metrikleri ve `ad_group.id/name` ile yalnız SHOPPING ister. Yeni `pmax_product_daily`, aynı ürün alanlarını `shopping_performance_view` üzerinden yalnız PERFORMANCE_MAX için, Ad Group veya Asset Group alanı olmadan ister. Campaign kimliği kaynak bağlamıdır; PMax CPD Channel Campaign yapılmaz, mevcut Asset Group hedefi değişmez.
- Yeni PMax ailesi genel mevcut reporting okuma sınırında hazırlanır; snapshot/zamanlayıcı/canlı tetikleyici ailesi eklenmez. Eski tetikleyicideki `shopping_product_daily` artık yalnız Shopping ürünlerini kapsar; onun `complete` sonucu PMax ürün kanıtının tamamlandığı anlamına gelmez. Genel cart data, Search/Shopping native bağlantıları, ham satır güvenliği ve 11 duraklaması korunur.
- 10/11 ürün–Asset Group bağlantısı açık kalır; resmî destek başvurusunun alındığı ürün sahibi tarafından doğrulanmıştır, teknik yanıt beklenir. Destek kabulü teknik çözüm veya sağlayıcı alan kabulü sayılmaz. Tarihsel kayıt/çözümleyici, Shopify kimliği, rol/Channel toplamı, Dataset/FX/formül, canlı çağrı, DB, deploy ve UI uygulanmaz.
- Resmî PMax raporlama ve ürün raporlama rehberleri 23 Ekim'de yeniden okundu: PMax standart Ad Group kullanmaz; ürün performansının kaynağı shopping performance view'dır. Testler exact alan/filter ayrımı, kayıpsız ham satır/sorgu izi, boş–sıfır ayrımı, sayfalama ve ilk hatada tekrar yokluğunu denetler; canlı kabul değildir. PR/CI ve ayrı açık merge onayı gerekir.

## Search/Shopping Channel kararı — 23 Ekim 2026, 12 düzeltmesi

- Ürün sahibi açıkça onayladı: Search ve Shopping **CPD Channel Ad Group**. Search **PD Ad** düzeyinde kalır; iki kayıt ailesi aynı üst grup kimliğiyle ilişkili fakat bağımsızdır. Önceki Search Channel Ad hedefi bu kararla değiştirilmiştir. PMax mevcut hedefi bu işte değiştirilmez; sırası geldiğinde ürün sahibiyle yeniden teyitleşme zorunludur, 11 tarihsel çalışması duraklatılmış kalır.
- Bu düzeltme açık PR #172'nin 09 dilimine eklenir; henüz merge onayı verilmemiştir. Başlangıç main `7fe9628e46a46bd853d6d62ed064d96911af6467` olarak kalır. Ortak ve Google sözleşmeleri ile 13 sütunlu çalışma tablosu birlikte güncellenir.
- `search_cart_data_product_sales_daily`, yalnız Search için Ad Group kimliğiyle satılan item/adet/gelir kanıtı ister. `readSearchSourceEvidenceSnapshot`, PD Ad performansı ve bu ayrı cart raporunu aynı sınırlarla tam okur. Genel cart sorgusu veya eski canlı tetikleyici genişletilmez. Search'te ürün Impression/Click/Spend bu yolla üretilmez; PD Ad değerleri ürünlere kopyalanmaz.
- Native satışın Ad Group Channel'ı PD kaydı yokken de korunur. Aynı gruptaki birden çok Ad normaldir; yalnız ortak üst bağlamı gösterir. Satış hiçbir Ad'e veya tüm Ad'lere dağıtılmaz. Tek Ad bulunması bile ürün satışını o Ad'e atfetme kanıtı yapılmaz. Kaynak indeksleri snapshot içidir; kalıcı Dataset/üst toplam/FX uygulanmaz, publishable false.
- Resmî [Google Search cart data açıklaması](https://support.google.com/google-ads/answer/16564103?hl=en) 23 Ekim'de kontrol edildi: Search kaynaklı satılan ürünler cart data ve bağlı Merchant Center feed'iyle tanınabilir; reklamı yapılan belirli ürün varmış gibi davranılmaz. v25 cart data Ad Group uyumu korunur. Sentetik test canlı sorgu/ürün veya kurulum kabulü değildir.
- 12 repository uygulaması için çok Ad/tek satış, PD yokluğu, yinelenen PD, farklı hesap/grup/gün, sayfalama ve ilk hata testleri vardır. 09/12 canlı kabulü, 16 kimlik ve 17–23 işleri açıktır. Yeni canlı çağrı, izin/token, DB, deploy veya Shopify görsel işlem yapılmaz; merge ayrıca açık onay ister.

## Google Shopping kaynak bağlantısı — 23 Ekim 2026, 09 dilimi ve 10/12 resmî kontrolü

- #171 açık onayla `7fe9628e46a46bd853d6d62ed064d96911af6467` olarak birleşti; bu dilim o main'den başlar. 09 için yalnız Shopping filtreli `shopping_cart_data_product_sales_daily` sorgusu Ad Group kimliği/adını ekler. Genel cart data sorgusunun exact gövdesi ve eski canlı tetikleyici korunur; iki satış raporu birlikte toplanmaz.
- `readShoppingSourceEvidenceSnapshot` üç native aileyi (Shopping PD Ad Group, mevcut ürün performansı, Shopping cart data satışı) sınırlı/tam sayfalarla okur. Her aile en çok 20 sayfa/20.000 satırdır. Ürün ve satış satırları aynı hesap–Campaign–Ad Group–gün anahtarıyla tek PD kaydına referans verir. Kaynak para birimi/saat dilimi doğrulanmış hesaptandır. Metrik kopyası, maliyet aktarımı veya toplam yoktur. Eksik/yinelenen kimlikte PD referansı seçilmez; ham kayıt ve kimlik korunur. Mevcut ürün ailesindeki PMax satırları da silinmez, Asset Group atanmaz.
- Workspace ve kurulum nesli yürütme önbelleğine bağlanır; aynı nesne başka kurulum için kullanılırsa provider erişiminden önce reddedilir. Bozuk başarılı yanıt/satır/imleç ve HTTP 200 hata gövdesi boş/tam rapor sayılamaz. İlk hatada kalan sayfalar/aileler durur, retry veya kısmi snapshot yoktur.
- Resmî v25 metadata 23 Ekim'de okundu: cart data ve shopping performance segmenting resources `ad_group`, `campaign`; `product_sold_item_id` selectable_with içinde `ad_group` var, `ad_group_ad` yok; `product_item_id` listesinde `asset_group` yok. 10/12 mevcut doğrudan sorgu yoluyla kapatılamaz. Bu, diğer API/sürümlerde hiçbir yol olmadığı iddiası değildir. Search PD Ad hedefi değişmez, ürün satışı Ad Group'a veya Ad'e tahminle taşınmaz. 11 tarihsel PMax işi duraklatılmış kalır.
- Web aracının boyut sınırı sonrası aynı herkese açık resmî v25 sayfaların ilgili HTML metadata bölümleri salt okunur HTTP ile okundu; token/hesap API'sine erişilmedi. Google Ads Search yanıt referansı da okundu. Kaynaklar Google runtime brief/sözleşmesindedir. Bu metadata ve sentetik testler canlı sorgu/ürün kabulü değildir.
- 09 repository bağlantı dilimidir; Shopify kimlik doğrulaması (16), yeni rol, tam Dataset/ürün toplamları/FX (17–23) tamam değildir. `publishable=false`. Canlı çağrı, token/izin değişikliği, DB, deploy veya Shopify görsel işlem yoktur. 24 hata/tamlık/kapsam testleriyle eşlik eder; merge ayrı açık onay ister.

## Kaynak ve kimlik bağlantıları — 23 Ekim 2026, 04 + 09 + 10 + 11 + 12 + 16 ilk dilim

- Ürün sahibi devam talimatını verdi. #170 `92f4a9b32beb0c41c5736a0c90fa5ba3b9df7f4a` olarak açık onayla birleşti; bu dilim o main'den başlar. Grup birlikte tasarlanır, sağlayıcı/kanıt sınırlarında küçük PR'larla teslim edilir; bu kayıt altı maddeyi kapatmaz.
- Ortak bağlantı tasarımı `contracts/pd-cpd-query-standard-v1.json#source_link_design` içindedir. PD ve CPD ayrı ailelerdir; aynı kurulum ve doğrulanmış hesapta aynı kaynak yaprağı/gün/üst kimlikler ile ilişkilidir. Adlar eşleme anahtarı değildir. Satır indeksi yalnız tam snapshot ailesine aittir; kalıcı Dataset anahtarı seçilmemiştir.
- 04'ün yalnız Meta yerel kaynak referansı uygulanır. İki ailenin bütün sayfaları toplandıktan sonra `source_links` hesap–Ad–gün ve Campaign/Ad Set kimliklerini karşılaştırır. Tek eşleşme kaynak satırına referanstır; eksik, yinelenen veya çelişkili kimlikte seçim yapılmaz. Ham satırlar ve metrikler değişmez. Tamamlanmamış sayfa çiftinden bağlantı üretilmez. Shopify kimliği, katalog/creative kanıtı, rol, ürün maliyet anlamı, ürün toplamı veya Dataset yayını değildir; `publishable=false`.
- 09 Shopping cart data Ad Group, 10 PMax ürün performansı Asset Group, 12 Search ürün satışının Ad bağlantıları açık kalır. 11'in durdurulmuş tarihsel kayıt/çözümleyici entegrasyonu açılmaz. Bugünkü listing tree geçmiş güne uygulanmaz. 16 yalnız mantıksal kimlik kapsamıyla tasarlanır; kalıcı model ve okuyucular EO-05-B kapısındadır.
- Meta resmî SDK Insights alanları ve Klaviyo Reporting Overview 23 Ekim'de okundu. SDK'da dört converted/promoted alanı listelenir; bu canlı veri/kombinasyon kabulü değildir. Google v25 cart data/shopping alan sayfaları okuma aracının içerik boyutu sınırında alınamadı; alternatif rota denenmedi, bu dilimde Google sorgusu değiştirilmedi. Kaynak ve sınırlar çalışma tablosundadır.
- 24: çok sayfalı indeks, hesap/gün/kurulum kapsamı, eksik/çelişkili/yinelenen kimlik, metrik kopyası yokluğu ve ilk hatada sonuç dönmeme testleri. Yeni canlı çağrı, OAuth/secret, DB/migration, deploy, UI/Shopify görsel işlem yoktur. Merge ayrıca açık kullanıcı onayı ister.

## Klaviyo PD sorgu ve metrik uyumu — 23 Ekim 2026, envanter 13 + 14

- #169 açık onayla `4c303a0cd865f4bf839496c35b5541fd61ad702e` olarak birleşti; bu düzeltme o main'den başlar.
- Ayrı `readPdEvidenceSnapshot` giriş noktası mevcut Klaviyo hesap/izin/credential ve sınırlı sayfalama denetimlerini kullanır. Üç Shopify metric ID (Placed Order, Added to Cart, Checkout Started) Campaign/Flow Message seviyesinde ayrı raporlanır. Eksik yapılandırmada ID uydurulmaz; birden fazla adayda hata verilir. Eski canlı tetikleyici ve ürün satış akışı genişletilmez.
- PD delivered/clicks ve Placed Order conversions/conversion_value sabitlendi. ATC/Checkout için yalnız conversions/conversion_value istenir; teslim/tıklama tekrarlanmaz. Ham yanıt ve istatistikler korunur, projeksiyon kaynak satır indeksiyle bağlıdır. Eksik/null/sıfır ayrıdır; Spend açık ve null kalır. CPD ürün/Channel Impression ve Click N/A kararı değişmez.
- İlk sağlayıcı hatasında kalan aileler durur; kısmi sonuç yoktur. Tam sayfalama bitse de birleşik Dataset ve üst toplam kabulü bu pakette yoktur; publication false. İlgili 17–21 işleri, 16 kimlik, 15 ürün etkileşim kanıtı ve 22/23 FX/formül sırası korunur. 24 sentetik istek/yanıt ve hata testleriyle eşlik eder.
- Resmî Reporting API, Campaign/Flow Values, OpenAPI ve Shopify veri referansı 23 Ekim'de okundu. Raporların gönderim-tarihi kapsamı ürün olayı tarihiyle eşit varsayılmaz. Yeni canlı çağrı, quota politikası, OAuth/secret, DB, deploy veya Shopify görsel işlem yoktur. Bu PR merge'i ayrıca açık onay ister.

## Google uç sorguları ve normal kapsam — 23 Ekim 2026, envanter 06 + 07 + 08

- #168 açık onayla `b883992dbd87b97827c44ad8ddfcc8bd6cd4b393` olarak birleşti. Bu düzeltme o main'den başlar; Meta ürün canlı kabulünü tamamlamaz.
- Search Ad performansı ve üç uçta (Search Ad / Shopping Ad Group / Retail PMax Asset Group) ayrı dönüşüm kategorisi sorguları eklendi. ATC/Checkout/Purchase normal adet/değerleri istenir; maliyet dönüşüm eylemlerine göre tekrar sayılmaz. Campaign yardımcı metrikleri aşağı dağıtılmaz.
- Her ailede ham satıra indeksle bağlı PD metrik projeksiyonu vardır. Performansın genel conversions değeri Purchase yapılmaz; normal kategori dönüşümleri kullanılır. Tam birleşik PD satırı, üst toplamlar ve yayın sonraki 17–21 kapılarındadır. Dönüşüm sorgusunda satır yoksa sıfır varsayılmaz.
- Cart Data normal adet/gelir ve Sales Role aynı kapsamdadır. all alanları yalnız ham satırda kalır; normal eksikse yedek olmaz. Kaynak/kimlik bağlantıları 09–12/16, tarihsel PMax duraklaması ve EO-05/06 sırası korunur. Eski canlı tetikleyici aileleri büyütülmez; yeni canlı çağrı/deploy/DB/UI yetkisi yoktur.
- Sözleşme `contracts/eo-04c-google-reporting-runtime-v1.json`, açıklama `docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md`. 23 Ekim resmî Google v25 alan metadata, Metrics, segment ve dönüşüm raporlama kontrolü yapıldı. Hesapta sorgu uyumu ve gerçek yanıt kabulü hâlâ ayrı kapıdır. 24 sentetik sorgu/yanıt ve hata testleriyle eşlik eder; merge açık onay ister.

## Meta sorgu ve PD metrik uyumu — 23 Ekim 2026, envanter 02 + 03

- Kullanıcı repository uygulamasını onayladı. PR #167 açık merge onayıyla `5b8f1a7acb2974bdb14eaba77f7f4cfb054dbb08` olarak main'e alındı; bu düzeltme o main'den başlar.
- Standart ürün kırılımında dört converted/promoted quantity/value alanı birlikte istenir; ham satırlar korunur. Test bayrağı artık alanları kapatmaz. Gerçek katalog desteği, ürün maliyeti, Shopify kimliği ve Sales Role kabulü hâlâ sonraki kapılardadır.
- Dokuz PD metriği Ad ham yanıtından ayrı projeksiyonla eşlenir: dışa giden Click; Shopify web Pixel ATC/Checkout/Purchase adet ve aynı action_type değerleri. Grouped/website eylemler veya attribution pencereleri toplanmaz; eksik değer sıfır/yedek alanla doldurulmaz. Ham sayfalarla projeksiyonun indeks bağı çok sayfalı snapshot'ta korunur.
- Bağlayıcı ayrıntı `contracts/eo-04b-meta-reporting-runtime-v1.json` ve `docs/EO_04B_META_REPORTING_RUNTIME_START_BRIEF.md`; ortak hedef `contracts/pd-cpd-query-standard-v1.json`. Bu metrik projeksiyonu Dataset yazımı, Channel ürün toplamı, FX veya formül motoru değildir. Envanter 24 sentetik sorgu/yanıt, boş/eksik/sıfır, çift sayım ve ilk hata kontrolleriyle bu gruba eşlik eder; canlı kabul ayrıca açıktır.
- Resmî Insights, alan referansı, AdsActionStats ve Breakdowns 23 Ekim'de tarayıcıdan okundu. HTTP 429 sonrası alternatif tarayıcı okuması açık kullanıcı onayıyla yapıldı. v25 alan referansı/v26 Stats sürüm ayrımı ve promoted alanlarının referansta bulunmaması saklanmaz; sorgu uyumu ispatlanmış sayılmaz. Deploy, canlı çağrı, secret, DB ve Shopify görsel işlem yoktur; bu PR'nin merge'i ayrıca onay ister.

## Klaviyo Sales Role düzeltmesi — 23 Ekim 2026

Ürün sahibi, 15. madde kapsamında yalnız repository düzeltmesini onayladı.
Campaign Message'ın içerik ürün kümesi, etkileşime konu ürünü kanıtlamaz.
Kümenin içinde veya dışında satılan ürün bu kanıtla `Advertised` / `Cross-sell`
yapılmaz; kesin Message bağlantısı varsa `Assisted` kalır. A/B/C içerikli
mesajdan A/B/C/D satıldığında, ürün etkileşimi ayrıca doğrulanmadıkça dört satış
da `Assisted` olur. Aynı kümede bulunmak ürün etkileşiminin yerine geçmez.

İki Klaviyo sınıflandırıcısı, ilgili sözleşmeler ve senaryolar birlikte
düzeltilir. Flow `Triggered`, çelişkili kanıt `Unclassified`, kesin Channel,
ham ürün satışı ve çift sayım sınırları korunur. Yeni ürün-tıklama API alanı
veya doğrulanmamış kanıt yolu eklenmez. Meta ve Google rol kuralları değişmez.
EO-05 sırası, DB, canlı sağlayıcı, secret, UI ve deploy kapıları açılmaz;
merge ayrıca açık onay gerektirir.

Resmî kaynaklar 23 Ekim 2026'da kontrol edildi:
[Reporting API](https://developers.klaviyo.com/en/reference/reporting_api_overview),
[Message conversion tracking](https://help.klaviyo.com/hc/en-us/articles/115005248128).
Bu kaynaklar mesaj raporlama/attribution kapsamını açıklar; içerik kümesinden
ürün etkileşimi çıkarmayı doğrulamaz. Bu dar koruma AdsTable ürün kararıdır.

## Dar Meta ek alan testi — 22 Ekim 2026

Ürün sahibi, mevcut `product_id` sorgusuna yalnız test seçeneğiyle
`converted_promoted_product_quantity` / `converted_promoted_product_value`
eklenmesini, dağıtımı ve tek canlı denemeyi onayladı. Normal sorgu, Dataset,
kimlik eşlemesi ve Sales Role değişmez. İlk sağlayıcı hatasında durulur.
Sözleşme: `contracts/eo-04-provider-live-acceptance-v1.json` içindeki
`promoted_product_probe_2026_10_22`. PR #163 CI geçti ve açık onayla birleşti.
Güncel main'in EO-05 kodları dahil tamamını dağıtma onayı ayrıca alındı;
`b0a4fba` / `dpl_ELF7zyKfwKzEiV9Dz7LrT7rMwqRp` Production READY doğrulandı.
Canlı sonuç yoktur. Ürün sahibi Settings'te yalnız bu sabit test için geçici
Polaris düğmesini onayladı; analist özeti canlı kabul brief'indedir.
Bu UI diliminin uygulaması, yerel testleri, typecheck ve build tamamlandı;
PR/CI incelemesi ile gerçek masaüstü/mobil ve ürün
sahibi görsel kabulü bekleniyor. Ürün sahibi PR #164 için merge ve dağıtımı
ayrıca onayladı; yalnız geçici test düğmesinin görsel kontrolünü dağıtımdan
hemen sonraya alan dar zamanlama istisnası sözleşmeye işlendi. Bu istisna görsel
PASS veya paket kapanışı değildir; diğer UI kapıları değişmez.
Ürün sahibinin seçtiği tek iş tarihi: `2026-10-01`.
PR/CI ve ayrı açık merge onayı kapısı korunur. EO-05 başlamaz.

## Güncel durum — 19 Ekim 2026

EO-01–04 ve A6-TECH-01 kabul edilmiştir; F01–F09 ve son güvenlik konusu kapalı,
F10 açık, engelleyici olmayan P3 ertelemesidir. A6-DOCS-01'in 62 insan-okuyucu
belgesinin tamamı, son üç belgenin okunabilirliği ve paket kapanışı ürün sahibi
tarafından 19 Ekim 2026'da kabul edildi; PR #137 merge onayı verildi.
Önceki kabul bekleyen teslim notları tarihsel hazırlık durumudur.
EO-05 otomatik başlamaz; sonraki iş için ayrı ürün sahibi yönlendirmesi gerekir.

## Zey&Rose ve iki aşamalı geliştirme/review planı — 19 Ekim 2026

Ürün sahibi bu plan güncellemesini onayladı. Bağlayıcı ayrıntı
`contracts/a6-quality-and-assurance-gates-v1.json` içindeki `staged_rollout`
kaydıdır. Bu karar EO-05 uygulamasını, mağaza taşımasını veya canlı işlem başlatmaz.

1. **Paralel hazırlık:** Zey&Rose Shopify'a taşınacak; Facebook & Instagram,
   Google & YouTube ve Klaviyo uygulamaları bağlanacak. Çok ürünlü Bileklik
   Meta Advantage+, Google PMax, Klaviyo Campaign ve Flow senaryoları hazırlanacak.
   Erişim hedefleri Meta App Role, Google Explorer ve Klaviyo'dur; erişimler bu
   kayıtla alınmış veya doğrulanmış sayılmaz. Gerçek mağazada AdsTable kullanımı
   öncesi A6-OPS-SHOPIFY-01 izolasyon kapısı korunur.
2. **EO-05–08 geliştirmesi:** Onaylı sözleşmeler, sentetik testler ve her paket
   sonundaki bütünlük denetimiyle sıralı ilerlenir. Gerçek hesap henüz hazır
   değilse bağımsız mühendislik işleri sürebilir. EO-07-C'nin gerçek kanıtına
   bağlı Ad Analysis/ürün grafiği ve Attribution Differences kapıları kalkmaz;
   bağlı işler açık/bloke kalır. EO-08 mühendislik sonuna ulaşmak bütün alt işleri
   kabul edilmiş veya review'a hazır ilan etmek değildir.
3. **EO-08 sonu gerçek doğrulama:** Taşıma ve erişimler hazır olduğunda Zey&Rose
   hesaplarında üç sağlayıcının ürün kimliği, satış, Sales Role, Ad Cost ve
   uçtan uca veri eşliği ayrı ayrı sınanır. Bağımsız araştırma veya sentetik test
   gerçek sağlayıcı kanıtı değildir. Gerçek kanıt yokluğu “bekliyor”dur; PASS,
   unsupported veya sayısal sıfır değildir. Tarihsel PMax tam iş günü kapısı,
   S2-A/S2-B senaryoları ve Channel/Sales Role sözleşmeleri korunur.
4. **Kapsam kararı:** Sales Role veya Ad Cost sağlanamıyorsa geçerli satışlar ve
   desteklenen alanlar korunarak devam seçeneği vardır. Rol/maliyet uydurulmaz;
   Channel, sağlayıcı ürün maliyeti ve dağıtılmış maliyet birbirinin yerine geçmez.
   Daralan kapsam sağlayıcı bazında belgelenir, ürün sahibi kabul eder ve ilgili
   sözleşme/UI kapıları etkinleştirme öncesi eşlenir. Güvenlik veya veri doğruluğu
   açığı bu seçenekle geçiştirilemez.
5. **İkinci aşama:** Gerçek sonuçlar ve kapsam kararı → EO-08 kabulü →
   A6-ASSURE-01 → ürün sahibi GO → ilgili başvuru/onaylar ve gerçek mağaza pilotu →
   ayrı EO-09 canlı geçiş kararı → EO-10. Şirket kuruluşu; Meta/Google business,
   Klaviyo beş kullanıcı hedefi ve business, Shopify başvuruları iş planındadır.
   Bunlar yeniden doğrulanmış platform şartları veya kabul garantisi değildir.
   “Önce tüm paketler, sonra review” sırası uygulanmaz.

OpenAI Ads API yalnız araştırma adayıdır; aktif Meta/Google Ads/Klaviyo listesi
değişmedi. Ürün raporlaması belgesinde ürün kimliği, tıklama ve spend bulunması,
satılan ürün attribution'ı, Sales Role veya Zey&Rose erişimini kanıtlamaz.
Erişim/uygunluk, satış ürünü, maliyet grain'i ve attribution ayrı araştırılıp açık
kapsam onayı alınmadan entegrasyon veya business başvurusu yapılmaz.
Kaynak kontrolü: 19 Ekim 2026,
[OpenAI Ads Reporting](https://developers.openai.com/ads/reporting).

Bu belge tarih sırasıyla birikmiş karar ve kanıt kayıtlarını korur. Aşağıdaki
“başlamadı”, “bekliyor”, “güncel” ve ara sayımlar kayıt tarihine aittir; bugünkü
yetki veya yeni iş talimatı değildir. Önce bu özet, sonra ilgili nihai kabul
kaydı okunur. Makine sözleşmeleri ve değişmez kanıtlar çevrilmez.

Teknik terimler: Runtime çalışan uygulama, migration sıralı veritabanı değişikliği,
CI otomatik teslim kontrolü, build derleme, typecheck tip kontrolü, BFF arayüzün
sunucu katmanıdır. API alanları, ekran metinleri ve durum kimlikleri aynen korunur.
## EO-05 başlangıç brief'i — 19 Ekim 2026

**20 Ekim alarm kararı:** İş sırası dakikada bir kontrol edilir; her uygun mağazanın
verisi saatte bir, saat içine yayılmış sırayla alınır. Son başarılı iş sırası
kontrolünden sonra 2 dakika aşılması kritik alarm nedenidir. Gözetim ilk
tetiklemeden doğru Dataset kaydına ve alarm teslimine kadar bütün zinciri kapsar.
Ayrıntı aşağıdaki **EO-05 — İlk tetiklemeden Dataset'e kadar alarm matrisi**
bölümünde ve `contracts/eo-05-refresh-alarm-matrix-v1.json` içindedir.
Bu karar canlı zamanlayıcı/alarm kurmaz; EO-05-E tamamlandı sayılmaz.

**20 Ekim güncel iş sırası kararı:** Fırat listing tree çalışmasını açıkça
durdurdu; sıradaki iş tüm workspace'leri kapsayan refresh bütçesi ve yürütme
tasarımıdır. Aşağıdaki önceki tarihsel PMax tasarım maddeleri ertelenmiş kayıttır,
bağımsız refresh çalışmasının ön koşulu değildir. Erteleme tamamlanma/PASS veya
Google'ın satış, Channel, Sales Role ve Ad Cost sözleşmesinde değişiklik değildir.
Kanıtsız tarihsel kesin Channel etkinleştirilmez; listing tree çalışmasına dönüş
ayrı açık onay gerektirir. Bu iş sırası kararı runtime, migration, canlı çağrı,
deploy veya merge yetkisi vermez.

**Güncel durum — 27 Ekim:** EO-05 sıralı repository uygulaması başladı; ilk hata düzeltmesi #182 ile birleşti. Paket kabulü ve canlı işlem kapıları açık değildir. Aşağıdaki 19–20 Ekim başlangıç açıklamaları tarihsel tasarım sınırlarını korur.
Çalışma sözleşmesi: `contracts/eo-05-start-brief-v1.json`.
EO-01–04, TECH-01 ve DOCS-01 kabulleri ile PR #138 iki aşamalı planı korunur.
Bu brief çalışma zamanı kodu, migration, canlı sorgu, dağıtım veya kapasite koşusu
başlatmaz. Güncel dar repository yetkisi ve ilerleme yukarıdaki 27 Ekim kaydıyla izlenir; canlı yetki bu tarihsel brief'ten türetilmez.

**Amaç:** Sağlayıcı verisini doğru mağaza/hesap ve tarihe bağlı, tekrar çalışınca
çoğalmayan, eksikleri görünür, güncellenebilir Dataset V2 kaydına dönüştürmek.

**20 Ekim kapsam netleştirmesi:** EO-05 yalnız bir PMax işi değildir. Önce tüm
alt paketler ve sistem geneli refresh tasarımı netleştirilir; eski yapı yalnız
yararlı iş takibi fikirleri için referanstır, kodu veya mimarisi taşınmaz.
Zamanlayıcı uygulamasına geçmeden iş yükü bütçesi hazırlanır; tarihsel PMax
kanıtının kayıt/okuma tasarımı 20 Ekim iş sırası kararıyla durdurulmuştur.
Mevcut indeks/sorgu planı başlangıç ölçümü ayrıca
doğrulanır; henüz tamamlanmış veya üretim kapasitesi sertifikası değildir.
Ağaç sürümü/hash'i, gözlem zamanı, kanıtlanmış geçerlilik aralığı, hesap saat
dilimi, eksiksiz sayfalama, boşluk/çatışma ve saklama/silme sınırları belirlenir.
Üyelikte kullanılan ürün boyutlarının tarihsel doğruluğu da gerekir; bugünkü
ürün/feed özellikleri geçmişe uygulanmaz.

**Kritik açık tasarım sorusu:** Kesintisiz geçerliliği hangi doğrulanmış kaynak
kanıtlayacak? İki aynı snapshot arada değişim olmadığını kanıtlamaz; gözlem
zamanı geçerlilik aralığı değildir. Bu kaynak doğrulanana kadar kayıt alınabilir
ama geçmiş için exact sonucu üretilemez. Eksik/değişen/örtüşen tam iş günü
kanıtında satış ve Sales Role korunur, Channel `Unclassified Channel` kalır.
Satılan ürün Channel seçemez; bugünkü ağaç eksik geçmişi dolduramaz. İlk kapı
yalnız tablo/snapshot oluşturmakla kapanmaz: saklama, boşluk tespiti, uzlaştırma
ve tarih eşli resolver teslimi birlikte doğrulanmalıdır.

**Mevcut alt paket sırası:**

1. EO-05-A: Tüm workspace'lerin toplam DB yükünü yöneten, saat içine yayılmış
   zamanlayıcı; adil sıra, shard, lease, checkpoint, tek iş ve sistem geneli
   sınırlı eşzamanlılık. Yetki/abonelik geçersizken iş çalışmaz; hesap veya kurulum
   nesli değişince eski iş yeni veriye yazamaz.
2. EO-05-B: Dataset V2, kaynak para birimi, doğrulanmış FX kaynak izi ve sürümlü
   sentetik test verisi. FX kaynağı/oranı varsayılmaz; test verisi gerçek kanıt değildir.
   Ürün sahibinin anlattığı sabit ilk-kurulum para birimi, Frankfurter ve mevcut
   Dataset V2 yapısı EO-05-B'de kaynakla incelenecektir. Product level kayıt/
   fiziksel tablo tasarımı şimdi kararlaştırılmadı; EO-05-B'de yeniden tartışılacak.
3. EO-05-C: Sağlayıcının doğrulanmış attribution ayarından olgunluk/kesinleşme.
   Başarısız, kısmi veya kota sınırlı koşu kesinleşmeyi ilerletemez.
4. EO-05-D: Önce dün, sonra bugün ilk yükleme; tekrar güvenliği ve uzlaştırma.
   Bilinçli Disconnect aralığı ücretli abonelik sürse bile sonradan alınmaz;
   bir ay sonra dönüş, o ayı doldurma izni değildir. Dün/bugün ilk yüklemesi de
   bu sınırı delemez. İstemsiz token/yetki kaybı ayrı sınıflanır; geçmiş tamamlama
   politikası EO-05-D ve UI kapsamında ayrıca kararlaştırılmadan otomatik uygulanmaz.
   İzin verilen kurtarmada kalan eksik günler görünür olur. Sağlayıcı geçmişi yetmezse eksik
   veri açık kalır, sıfıra çevrilmez. Saatlik tam geçmiş taraması yapılmaz;
   derin uzlaştırma 24 saatte bir, etkin attribution ufkuna göre planlanır.
5. EO-05-E: Gecikme, tazelik, kaynak tüketimi ve iş başına maliyetin secretsız
   görünürlüğü. 2,000 çalışma alanı, 4,000 stres ve 24 saatlik dayanıklılık
   kabulleri ilgili kapılarında ölçülür; bugün koşu başlatılmaz.

Maliyet dağıtım formülünün sahibi EO-06-A'dır; EO-05 kaynak/dağıtılmış maliyet
ayrımını ve gerekli girdiyi korur. Gerçek Zey&Rose doğrulaması EO-08 mühendislik
sonundadır; bu zamana kadar kanıta bağlı özellikler doğrulanmış ilan edilmez.
Her dar teslim test/typecheck/build/CI, açık kabul, uzak içerik eşliği ve yerel
envanter kapısından geçer. İlk açık sağlayıcı hatasında durulur ve kullanıcıya
dönülür; bu brief otomatik yeniden deneme veya alternatif rota izni değildir.

Resmî kaynak kontrolü 19 Ekim 2026: Google Listing Groups for Retail (ağaç yapısı),
Supabase Row Level Security (erişim sınırı), GitHub Pull Requests (teslim).
Bağlantılar çalışma sözleşmesindedir. Bu okumalar tarihsel süreklilik servisi,
şema güvenliği veya canlı kapasite kanıtı üretmez; uygulama öncesi ilgili resmî
API/kalıcılık kaynakları dar kapsamda yeniden doğrulanır.

## EO-05-A — Dataset kararından bağımsız kalan üç iş — 20 Ekim 2026

Fırat, PR #150'nin birleşmesinden sonra iş sırasını netleştirdi: ortak kota
yönetimi → zamanlayıcının iş sırasına bağlanması → yarım kalan işlerin güvenli
yönetimi. Bunlar yeni alt paketler değildir; 05-A içinde sıralı işlerdir.
Saatlik alınacak verinin seçimi/parçalanması ve yazımı bekler. Bu üç işten sonra
05-B başlamadan product level ve üretim planı birlikte netleştirilecek. Saatlik
veri yazımının bu netleştirmeden sonra mı yoksa 05-B bittikten sonra mı
tamamlanacağına o zaman karar verilecek. 05-A şimdiden kapandı sayılamaz.

### Zamanlayıcının güvenli HTTP bağlantısı — yalnız hazırlık

**20 Ekim 2026, Fırat'ın dar kapsam onayı:** Mevcut karar korunur; zamanlayıcı
bağlantısı hazırlanır, sağlayıcı çağrıları kapalı kalır. Sözleşme:
`contracts/eo-05a-refresh-queue-cron-entry-v1.json`. Yeni servis seçimi yoktur.

Zil geldiğinde önce çağıranın yetkisi doğrulanır. Yetkisiz çağrı veritabanına
ulaşamaz. Yetkili çağrı yalnız mağazaların iş sırasını ve mevcut yarıda kalmış
işleri kontrol edebilir; veri alma, eksik gün tamamlama veya Dataset yazma
başlatamaz. Aynı dakikanın tekrarı yeni başarı zamanı üretmez. Yanıttaki 200,
veri güncellendi demek değildir. Belirsiz sonuç otomatik tekrar edilmez.

Bağlantının ayrı veritabanı rolü yalnız bu iki işlemi yapabilir; mağaza uygulaması
veya tam iş yöneticisi yetkisini kullanmaz. Rol henüz giriş yapamaz. Planlanan
beş ortam ayarı mevcut secret envanterinden ayrı kaydedilir; değer oluşturulmaz.
Cron kaydı, canlı migration, credential, deploy ve etkinleştirme bu işte yoktur.
Gelecekte açık onayla dakikada bir bağlanacaktır; bugün otomatik zil çalmaz.

Testler yalnız sentetik istekler ve mevcut iki geçici CI veritabanıyla yapılır.
Gerçek Vercel→Supabase bağlantısı veya üretim kapasitesi kanıtlandı sayılmaz.
Bağımsız alarm, gerçek sonlanma kanıtıyla kurtarma ve üretim yükü/süre/uçtan uca
kabul sırası değişmez. 05-A kapanmaz, 05-B başlamaz. Resmî kaynaklar 20 Ekim
2026'da kontrol edildi; bağlantılar sözleşmededir. Shopify ekranı değişmez.

### Süresi aşılmış ve yarıda kalmış işin güvenli durdurulması — repository

**20 Ekim 2026:** Mevcut üçüncü 05-A işi kapsamında,
`contracts/eo-05a-refresh-interrupted-work-v1.json` uygulanır. Yeni alt paket
veya servis açılmaz. Canlı migration, sağlayıcı çağrısı, cron/secret/deploy yoktur.

**Eksik bağlantı:** Çalışanın kendi belleğindeki süre sınırı süreç kapanınca
kayboluyordu. Açık iç iş planındaki bu sınır artık işin sahipliği ayrılırken aynı
işlemde saklanır. Üretim için bir süre uydurulmaz. Sonraki farklı dakikanın
başarılı iş sırası kontrolü, yeni işe geçmeden süresi aşılmış işleri inceler.
Sağlıklı ve süresi dolmamış işlere dokunulmaz. Sınır eksikse tahminle devam edilmez.

**Zey&Rose örneği:** İşin süre sınırı dolduğunda son kayıt korunur:

- Henüz başlamamışsa veya yalnız yerel yetki kontrolündeyse: çağrı başlamadı.
- Çağrı niyeti kaydedilmiş, yanıt kaydedilmemişse: çağrı sonucu belirsizdir.
  Bu aşama güncel Shopify abonelik çağrısını da içerir.
- Yanıt kaydedilmişse veya Dataset'e devir bekliyorsa: çağrının yanıtı alınmıştır;
  ancak bu bilgi verinin Dataset'e yazıldığını veya sürecin kapandığını göstermez.

**Üçünde de güvenlik kuralı aynıdır:** Sürenin dolması, çalışanın ve dış işlemlerin
gerçekten sona erdiğini kanıtlamaz. Eski çalışanın ilerlemesi engellenir; hesap
ve ayrılmış kapasitenin tamamı korunur. Çağrı başlamadı/yanıt alındı bilgisi
“çağrı sonucu bilinmiyor” diye değiştirilmez; belirsizlik çalışmanın sonlanmasına
aittir. Tekrar kontrol aynı engeli çoğaltmaz. Sıradan “sorunu gördüm” onayı bu
engeli kaldıramaz. Başka hesaplar yalnız kalan gerçek bütçe içinde ilerler.

Kendiliğinden kapasite bırakma, tekrar sorgu, kaldığı yerden devam, eksik gün
tamamlama, Dataset yazma veya tazelik başarısı yoktur. İşin gerçekten sona
erdiğine ilişkin doğrulanmış çalışma zamanı/dış işlem kanıtı ve açık kurtarma
kapısı **hâlâ gereklidir**; sahte bir `terminated=true` girdisi kurulmaz.

Bu mekanizma aynı zamanlayıcıya bağlıdır; zamanlayıcının tümüyle susmasını
bağımsız olarak saptayan alarm değildir. Bağımsız gözlemci, bildirim ve canlı
etkinleştirme kapıları açık kalır. Üretim saatlik veri/süre/yük planı, saat
güvenilirliği, SQL zaman aşımı ve Dataset/product level tartışması yapılmadı.
05-A genel kapanışı veya 05-B başlangıcı verilmez. Kaynaklar ve kontrol tarihi
sözleşmededir; SQL kanıtı yalnız mevcut iki geçici CI veritabanında aranır.

### Zamanlayıcıdan iş sırasına güvenli giriş — repository, canlı etkinleştirme değil

**20 Ekim 2026:** Mevcut 05-A işi içinde zamanlayıcının çağıracağı iç bağlantı
kurulur. Sözleşme: `contracts/eo-05a-refresh-scheduled-queue-check-v1.json`.
Yeni alt paket, servis, HTTP route, cron, secret veya canlı migration açılmaz.

**Örnek:** Zey&Rose için aynı dakikada iki zil gelirse gerçek mağaza/hesap
listesi bir kez kontrol edilir. İkinci zil yeni iş veya yeni başarılı kontrol
kaydı üretmez. Kontrolde hata olursa iş sırası ve başarı kaydı birlikte geri
alınır. On dakika zil gelmezse sonraki farklı dakikanın kontrolü mevcut bekleyen
ihtiyacı korur; on ayrı iş oluşturmaz ve bekleme yaşını sıfırlamaz.

Dakika ve başarı zamanı çağırandan değil veritabanından alınır. Eski etkinleştirme
kimliği veya gelecek zaman izi kabul edilmez. Geç gelen tekrar başka dakikaya
düşerse yeni kontrol sayılabilir; “zil kesin bir kez gelir” garantisi verilmez.
İş sırasının mevcut birleştirme ve aynı hesabı iki çalışana vermeme koruması sürer.
Kayıt tek güncel satırdır; sınırsız tetikleme geçmişi birikmez.

Saatlik veri planı yoksa yalnız iş sırası kontrol edilir, sağlayıcı sorgusu
başlamaz. Açıkça verilmiş iç test planı varsa mevcut güncel abonelik, iş sahipliği
ve kota kapılarından geçen en fazla bir veri parçasına devir sınanır.
`awaiting_dataset` başarılı refresh değildir: kayıt/yazım yapılmış sayılmaz,
bekleyen ihtiyaç silinmez. Başarılı iş sırası kontrolü ile veri alımının sonucu
ayrı tutulur; ikincisi hata verince ilki gizlenmez.

Kapalı varsayılan etkinleştirme, iç rol ve tablo erişim sınırı korunur. Kimlik
eşliği HTTP yetkilendirmesinin yerine geçmez; gerçek cron route'u, güvenli
etkinleştirme ve bağımsız alarm/gözlemci hâlâ ayrı canlı kapılardır. Saatlik veri,
product level ve Dataset kararı alınmadı. Yarıda kalan işlerin güvenli yönetimi
mevcut sırada kalır. Bu kayıt 05-A kapanışı veya bütün kota işinin canlı kabulü
değildir. Kontrol edilen resmî kaynaklar ve tarih sözleşmededir.

### Ortak kota kapısı — repository çekirdeği, canlı bağlantı değil


**PR #157 sonrası Google kota hata izi — 20 Ekim:** Mevcut kota işinde,
Google'ın açıkça verdiği hesap (`ACCOUNT`) veya proje (`DEVELOPER`) kapsamı ve
dört doğrulanmış kota hata kodu mevcut özel işlem kaydına eklenir. Güncel native
istemci v25 ve eski v24 test biçimi resmî şemayla doğrulanır; API sürümü/sorgu
değişmez. Tip ve sürüm eşliği, HTTP/error kodu ve bütün hataların tutarlılığı
aranır. Bilinmeyen sürüm, çelişkili kapsam, eksik ayrıntı veya genel 429'dan
“proje kotası doldu” sonucu çıkarılmaz. Ham hata, serbest kota adı veya token
kaydedilmez; Supabase rehberine göre ham tablo erişimi açılmaz.

**Örnek:** Zey&Rose Google yanıtında açıkça `ACCOUNT` görülürse bu bilgi hata
izine yazılır. `DEVELOPER` görülürse proje kapsamı bilgisi yazılır; ancak hangi
günlük/saniyelik/sorgu maliyeti sayacının dolduğu hâlâ bilinmeyebilir. İki durumda
da yalnız mevcut çağrı işlemi durur; başka mağazanın paylaştığı bütçe tahminle
durdurulmaz. Bilinen yanıt açık çağrı kapasitesini bırakır, kota payı iade edilmez.
İlk hata izi sonraki hata tarafından değiştirilmez. Otomatik tekrar yoktur.

Bu yalnız tanılama bilgisidir, yeni ortak-kota durma sinyali değildir. Kesin
ortak sayaç eşlemesi ve Meta geri bildirimi tamamlandı sayılmaz. Yeni paket,
canlı migration/config/secret/provider çağrısı, UI/deploy, saatlik veri veya
Dataset kararı yoktur. Resmî Google v24/v25, ProtoJSON ve Supabase kaynakları
20 Ekim 2026 kontrol edildi; bağlantılar mevcut kota durma sözleşmesindedir.
İki boş CI veritabanında gerçek SQL ve sentetik HTTP ile sınanır. 05-A açık,
05-B başlamaz. Supabase/Postgres rehberleri mevcut dar erişim ve aynı kilit
sırasını korumayı yönlendirdi.

**PR #156 sonrası sağlayıcı kota yanıtı — 20 Ekim:** Yeni paket açılmaz; mevcut
kota bağlantısının yanıt tarafı tamamlanır. Güncel Klaviyo belgesindeki sayısal
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` ve 429 için ayrı
`Retry-After` okunur. Eksik veya bozuk başlık gerçek sıfır sayılmaz. Başlıkların
tamamı, token, URL, ham yanıt veya ürün verisi saklanmaz. Özel tabloda çağrı yolu
başına yalnız son sayısal gözlem vardır; sınırsız olay günlüğü açılmaz.

**Örnek:** Başarılı Klaviyo Events yanıtı “kalan 0, sıfırlanmaya 30 saniye”
diyorsa aynı çağrı yolu için kullanıcı içi ve arka plan çağrıları normal kota
beklemesine girer; yeni çağrı/pay üretilmez. Bu, hesabın başka bütün endpoint veya
include kotalarının bittiğini kanıtlamaz. O ortak kapsama tahminle durma yayılmaz.
Pozitif kalan sayı yaklaşık bilgidir; yerel limiti yükseltmez veya önceden
başlamış beklemeyi kısaltmaz. Geç gelen yanıt beklemeyi muhafazakâr uzatabilir.
Önceden izin verilmiş veya başlamış istekleri iptal ettiği iddia edilmez.

429 hatasında `Retry-After` kaydolur ama sürenin dolması hata durmasını kaldırmaz;
otomatik tekrar yoktur. Mevcut izin/bağlantı/ortak kota durması normal bekleme diye
gizlenmez. Geri bildirim kaydı başarısızsa yanıt başarı diye devredilmez; sağlayıcı
reddi varsa durma kaydı yine denenir. Kaynak ve sınırlar mevcut
`contracts/eo-05a-shared-api-quota-v1.json` sözleşmesine eklenir.
Supabase rehberi özel RLS erişimini, Postgres rehberi aynı işlem kilidi sırasını
yönlendirdi. Resmî kaynak kontrolü 20 Ekim 2026. İki mevcut boş CI veritabanında
gerçek SQL ve sentetik HTTP ile sınanır; canlı migration/secret/provider çağrısı,
gerçek kota değeri veya UI/deploy yoktur. Google/Meta geri bildirimi tamamlandı
sayılmaz; bütün kota işi veya 05-A kapanmaz, 05-B başlamaz.

**PR #155 sonrası güncel iş kaydına bağlantı — 20 Ekim:** Arka plan çağrısı
artık yalnız dışarıdan verilen hesap bilgisine dayanmaz. Yeni açık kurucu,
mevcut işin sahiplik numarasını, izinli dönemini, aktif Shopify kurulumunu,
seçilmiş hesabını ve bağlantı sürümünü özel veritabanından tekrar okur. Eksik
veya kapalı kapsam ayarında çağrı çıkmaz. Mağaza/istemci kapsam kayıtları owner
tarafından ayrıca doğrulanmalıdır; migration bunları veya gerçek limitleri eklemez.
Sözleşme: `contracts/eo-05a-quota-authority-binding-v1.json`.

**Örnek:** Zey&Rose Google `111` işi kotadan pay beklerken Disconnect yapılırsa
veya hesap `222` olur, sonra tekrar `111` seçilirse eski iş dış çağrı başlatamaz.
Kota payı ayrıldıktan sonra da güncel kayıt kontrol edilir. Gönderilmemiş çağrının
açık kapasitesi bırakılır, tüketilen kota payı iade edilmez; bu olay sağlayıcı
hatası veya diğer mağazaları durduran ortak kota hatası olarak gösterilmez.
Doğrulama süresi çağrı izninin süresine dahildir. Otomatik yeniden deneme yoktur.

Shopify abonelik kontrolü önceki olumlu abonelik önbelleğine ihtiyaç duymaz;
zaten taze sonucu almak için çalışır. Reklam verisi çağrısı ise aynı iş için
taze abonelik doğrulaması olmadan çıkmaz. Çalışan, doğrulama makbuzunu veri
okuyucusuna aktarır; bu bir Dataset kaydı veya saatlik veri seçimi değildir.

Bu kontroller sağlayıcıyla ortak bir işlem değildir: son kontrolden sonra
gerçekten gönderilmiş istek geriye dönük iptal edilmiş sayılmaz. Yanıt sonrası
güncel yetki ve eski çalışanın veri devredememesi kontrolleri korunur. HTTP
beklerken veritabanı kilidi tutulmaz. Supabase rehberi özel RLS tablosunu ve
yalnız dar function erişimini yönlendirdi. Kaynak kontrolü 20 Ekim 2026.
İki mevcut boş CI veritabanında gerçek SQL ve sentetik HTTP ile doğrulanır;
kota beklemesindeki değişim testinde kota izni sentetik, yetki sorgusu gerçektir.
UI, canlı config/secret/DB/provider çağrısı/deploy yoktur. Yeni kurucular production
yollarını sessizce değiştirmez; ilk kurulum ve kullanıcı içi yollar tamamlandı
sayılmaz. 05-A açık, 05-B ve product level/üretim görüşmesi sırası korunur.

**PR #154 sonrası çağrı–kota eşleme adımı — 20 Ekim:** Açık repository kurucusu,
çağrının gerçek hedefini güvenilir sunucu bağlamıyla karşılaştırır. Sağlayıcı,
istemci/proje kapsamı, bağlantı kapsamı ve sürümü, hesap/organizasyon, API sürümü,
çağrı ailesi ve ek alanlar birlikte eşlenir. Eski bağlantı bağlamı, farklı hesap,
eksik sürüm veya tanımsız eşleme varsa çağrı çıkmaz. Token veya URL'den hangi
istemci/projeye ait olduğu tahmin edilmez. Sözleşme:
`contracts/eo-05a-quota-scope-resolver-v1.json`.

**Örnek:** Zey&Rose'un onaylı Google hesabı `111` olsun. Gerçek çağrı `222`
hesabına gidiyorsa kota kontrolünden geçmez. Token yenileme URL'sinde hesap
yazmasa da hesap ve bağlantı, doğrulanmış sunucu bağlamından alınır. Klaviyo'da
API revision ve include alanları eşlemenin parçasıdır; ek alanlı istek, düz
isteğin eşlemesine sessizce düşmez. Bunlar veri seçimi veya Dataset grain kararı
değildir. Örnek hesaplar sentetiktir, gerçek hesap kanıtı sayılmaz.

Sunucu her çağrıda güncel bağlamı yüklemek zorundadır. Bu yükleyici yeni bir yetki
kaynağı değildir: mevcut kurulum, iş sahipliği, hesap seçimi, abonelik ve izinli
dönem kontrolleri korunur. Güncel bağlamı gerçek otoriteden alan production
yükleyicisi ve istemci/proje kapsam envanteri henüz etkin değildir. İlk kurulumda
hesabı bilinmeyen OAuth akışı bu bağlı-hesap bağlamına varsayımla sokulmaz.

Eşleme, özel veritabanında ancak açık ve eksiksiz profil varsa işlem kimliği
döndürür. Profil tüm tanımlı sayaç bağlantılarının ve limitlerinin parmak izini
tutar. Eksik/fazladan sayaç, değişmiş limit veya farklı bağlantı hata grubu
eşlemeyi geçersiz yapar. Eşlemeden sonra rezervasyon sırasında tekrar kontrol
edilir; eski işlem kimliğini saklayıp eksik profili aşmak mümkün değildir.
Değişiklik fark edilirse bütün rezervasyon geri alınır, kısmi pay kalmaz.
Bu parmak izi, seçilmiş ayarın sağlayıcının bütün gerçek kotalarını kapsadığını
kanıtlamaz; o kapsam incelemesi ve gerçek limitler ayrı etkinleştirme kapısıdır.

Her eşleme yalnız kendi değişmez işlem anahtarına bağlıdır. Eşleme kapatılır
veya silinirse önceden alınmış anahtar da yeni çağrı başlatamaz.
Yeni kurucu eşleme ve rezervasyonda aynı depoyu kullanır; rastgele resolver/guard
ile değiştirilemez. Mevcut düşük seviyeli kurucu sentetik testler için korunur,
canlı bağlantıda yeni kapıyı atlama onayı değildir. Supabase/Postgres rehberleri
iki özel RLS tablosunu, yalnız dar function erişimini ve kısa kilit düzenini
yönlendirdi. Migration yalnız repository'de bekler; canlı mapping/limit, secret,
route, alarm veya zamanlayıcı etkinleştirilmez. İki mevcut boş CI veritabanında
gerçek SQL ve sentetik HTTP ile sınanır. Resmî kaynak kontrolü 20 Ekim 2026;
Meta için yeni özel kota kuralı üretilmedi. 05-A kapanmaz, 05-B başlamaz.

**PR #153 sonrası hata kapsamı düzeltmesi — 20 Ekim:** Fırat ortak kotayı
paylaşmak ile her hatada birlikte durmayı ayıran repository düzeltmesini onayladı.
Önceki çekirdeğin her hatada çağrıya bağlı bütün kota sayaçlarını durdurma davranışı
bu adımla değiştirilir; eski SQL ve tarihsel kanıtlar silinmez. Sözleşme:
`contracts/eo-05a-quota-stop-scope-v1.json`.

**Örnek:** Zey&Rose ve başka bir mağaza aynı Google proje kotasını kullanıyor
olsun, ancak bağlantıları bağımsız olsun. Zey&Rose'un izin hatası kendi bağlantı
grubunu durdurur; ortak proje kotasını dolmuş sayıp diğer mağazayı durdurmaz.
Gerçekten ortak kota sınırına ulaşıldığı doğrulanmışsa yalnız o sınıra bağlı işler
etkilenir. Aynı gerçek credential'ı kullanan işler de bağımsızmış gibi ayrılmaz;
doğrulanmış ortak bağlantı grubuna alınır. Gruplar token/URL'den tahmin edilmez.

Bağlantı hata grubu ile kota bütçesi ayrı özel kayıtlardır. Aynı bağlantıya bağlı
farklı çağrı aileleri HTTP 401/403 bağlantı/izin hatasında birlikte durabilir;
belirsiz veya diğer hata yalnız mevcut kota işlemini durdurur. Aynı bütçeyi paylaşan bağımsız bağlantı
çalışmaya devam edebilir. Eşleme yoksa yalnız mevcut işlem durur; bu dar varsayılan,
bağlantı eşlemesinin tamamlandığı veya canlıya hazır olduğu anlamına gelmez.
Hatanın bilinen ret mi belirsiz sonuç mu olduğu, sınırlı sinyali ve zamanı kalıcı
kayda girer; raw hata veya secret saklanmaz. Alarm teslimi henüz bağlı değildir.

Ortak bütçeyi durdurmak için üç kanıt birlikte gerekir: doğrulanmış sağlayıcı
sinyali, önceden yetkili olarak tanımlanmış eşleme ve o çağrıda gerçekten payı
kullanılmış aynı sağlayıcı kotası. HTTP kodu, mesaj veya Retry-After tek başına
hangi ortak kotanın etkilendiğini seçemez. Bu teslimde yalnız belgelenmiş Shopify
Partner throttle biçimi için sinyal vardır; üretim eşlemesi eklenmez. Google'da
429 yanıtı boyut sınırından da gelebilir; doğrudan tüm proje kotası durdurulmaz.
Klaviyo ve Meta için yeni ortak-kota sinyali uydurulmaz. Meta güncel belge erişimi
doğrulanamadı ve zorlanmadı. Var olan sağlayıcı hata sınıflandırmaları korunur.

Kesin hata yanıtı gelmiş çağrı, durma kaydı sonrasında açık çağrı kapasitesini
bırakabilir; tüketilen kota payı iade edilmez. Belirsiz çağrı süresi doldu diye
serbest bırakılmaz. Hiçbir durma süre geçmesiyle kalkmaz ve otomatik tekrar yoktur.
Supabase/Postgres rehberleri özel erişimi ve işlem → bağlantı grubu → sıralı kota
kilit düzenini yönlendirdi. Owner eşlemeleri aktif çağrı varken değiştirilmez;
canlı yeniden yapılandırma ayrı kapıdır. İki mevcut boş CI veritabanında gerçek
SQL ve sentetik HTTP ile sınanır. Canlı DB/config/secret/route/deploy, yeni Meta
kuralı veya saatlik veri/Dataset kararı yoktur. Kaynak kontrolü 20 Ekim 2026.
Durma sonraki rezervasyonları engeller; önceden verilmiş kısa çağrı izinlerini
ve başlamış istekleri geriye dönük iptal eden bir ana şalter değildir. Bu izinlerin
ölçülmüş gecikme sınırı ve etkinleştirme kabulü hâlâ açık kapıdır.

**PR #152 sonrası güvenli bekleme adımı — 20 Ekim:** Kota dolu olduğu için
ilk dış istek hiç gönderilemediyse iş kaybolmaz. Hangi işin, hangi sahiplik
numarasıyla beklediği özel veritabanı kaydına yazılır. Çalışan kapasitesi bırakılır;
API kotasından daha önce kullanılan pay iade edilmez. İlk sıraya giriş zamanı,
bekleyen ihtiyaç ve seçilmiş dönem korunur. Aynı çalışan bu kaydı ikinci kez
kullanamaz. Kayıt sırasında hata veya belirsizlik varsa otomatik tekrar yapılmaz.
Sözleşme: `contracts/eo-05a-quota-work-wait-v1.json`.

Sonraki iş sırası kontrolünde aynı iş tekrar değerlendirilebilir; bu, sağlayıcı
hatasını tekrar denemek değildir: önceki bekleyen istek hiç gönderilmemiştir.
Güncel mağaza/hesap seçimi, izinli dönem, bütçe ve adil sıra yeniden kontrol
edilir. Uygunsa yeni sahiplik numarası verilir ve Shopify aboneliği yeniden
doğrulanır. Eski çalışan sonradan dönse bile ilerleme, bitiş veya abonelik kaydı
yapamaz. Hesap/kurulum değişikliği veya Disconnect sınırı bu yolla aşılamaz.
Bu repository bağlantısı canlı zamanlayıcıyı etkinleştirmez.

**Somut örnek:** Bileklik mağazasının ilk isteği için kota doluysa hiçbir veri
çağrısı çıkmaz ve iş bekler. Daha sonraki kontrolde kota hâlâ doluysa yine çağrı
çıkmaz. Kota uygun olduğunda iş yeni sahiplikle başlayabilir. Fakat raporun ilk
sayfası alınmışken ikinci sayfada kota dolduysa aynı raporu baştan çağırmayız;
bu teslim yalnız ilk istek öncesi güvenli beklemeyi tamamlar. Kısmi raporun
kanıtlı devam noktası ayrı açık iştir. Token yenileme de önceki çağrı sayılır.
Belirsiz istek veya sağlayıcı hatası normal kota beklemesi gibi gösterilmez.

Shopify arka plan kontrolünün yeni açık kurucusu HTTP sınırındaki ortak kota
sayımını kullanır; eski ek rezervasyon callback'i birlikte verilirse reddeder.
Her doğrulama için yeni istemci kurulur. Bekleme alan ilk-istek bağlantısı kapanır;
geç kalan eşzamanlı giriş sonradan istek gönderemez. Normal production kurucular,
limitler, secret, canlı DB ve route'lar değiştirilmez. UI veya saatlik veri kapsamı
seçilmez; 05-B, Dataset ve product level kararı hâlâ bekler. Supabase güvenlik ve
Postgres kilitleme rehberleri dar özel erişimi ve aynı kısa kilit sırasını korumak
için kullanıldı. Kaynak kontrolü 20 Ekim 2026; canlı advisor/kapasite kanıtı yoktur.

**PR #151 sonrası bağlantı adımı:** Fırat kota kapısının mevcut çağrı yollarına
bağlanmasını onayladı. İlk repository teslimi, dışarı çıkan her HTTP isteğini
kapıdan geçiren ortak bağlantı ve mevcut Shopify/Meta/Google/Klaviyo istemcilerini
bu bağlantıyla oluşturan açık sunucu kurucusudur. Üretimde kullanılan kurucular
sessizce değiştirilmez. Bu teslim canlı etkinleştirme veya bütün kota işinin
kapanışı değildir. Sözleşme: `contracts/eo-05a-quota-native-transport-v1.json`.

**Bir rapor tek çağrı değildir:** Sentetik testte Meta Channel ve ürün için iki
istek yaparsa iki pay ayrılır. Google token yenileme ve iki rapor sayfası için
üç istek yaparsa üç pay ayrılır. Bu fiziksel istek sayımı, sağlayıcının günlük
ücretlendirilen işlem sayısıyla birebir aynı kabul edilmez. Klaviyo'nun her
HTTP sayfası da ayrı kapıdan geçer. Hangi tarih/ürün/verinin alınacağı değişmez.

Kota doluysa bu istek hiç çıkmaz. Özel yerel bekleme bilgisi, sağlayıcıdan gelen
benzer isimli JSON ile taklit edilemez. Klaviyo artık bu bilgiyi genel bağlantı
veya veri grubu hatasına dönüştürmeden üst koordinatöre taşır. Bir raporda
önceden başarılı çağrı varsa bu bilgi onları “hiç yapılmadı” saymaz; yalnız
bekleyen HTTP sınırına aittir. Kalıcı bekleme ve yeni sahiplik numarasıyla tekrar
sıraya alma henüz tamamlanmadı. Eski arka plan `authorizeRead` rezervasyonu ile
yeni HTTP sayımı birlikte kullanılamaz; bu çift sayım kapısı, worker bağlantısı
yapılmadan ayrıca kapatılacaktır.

HTTP hata yanıtında kota durması kaydolduktan sonra aynı yanıt mevcut sağlayıcı
doğrulayıcısına bırakılır; 401/403/429 davranışları yeniden uydurulmaz. HTTP 200
içinde hata veya bozuk JSON varsa sabit hata ile durulur; boş veri diye
devredilmez. Durma kaydı başarısızsa yanıt başarı diye devredilmez. Yönlendirme
takibi kapalıdır; farklı hedefe sessiz istek çıkmaz. Kota kapsamını çözümleyen
sunucuya yalnız doğrulanmış endpoint ailesi ve gerekli kimlikler gider; token,
URL sorgusu, body, GAQL, cursor veya ürün satırı gitmez. URL/header/form girdileri
bekleme öncesinde kopyalanır. Ek kota gerektiren desteklenmeyen sorgu değiştiricisi
bilinmiyormuş gibi atlanmaz; yeni yol çağrı başlatmaz.

Güvenilir hesap/istemci kapsam eşlemesi ve üretim limitleri hâlâ etkin değildir.
Gerçek çağrı kotası header'larının geri bildirimi, normal beklemenin kalıcı iş
sırasına bağlanması ve production kurucu bağlantısı açık kalır. Supabase rehberi
gereği mevcut dar DB yetkisi genişletilmedi; yeni migration veya secret yoktur.
20 Ekim resmî kaynak kontrolü sözleşmededir. Mevcut native istemciler sentetik
HTTP yanıtlarıyla, kota→Shopify bağlantısı ayrıca iki boş CI veritabanında
sınanır. Canlı provider/UI/deploy, zamanlayıcı veya Dataset/product kararı yoktur.

Mevcut arka plan abonelik kontrolünde kota kontrol noktası vardır fakat uygulama
içindeki çağrılarla ortak kalıcı sayaç henüz bağlanmamıştır. Yeni çekirdek aynı
kotayı kullanan bütün çalışanları aynı kısa veritabanı işlemine sokar. Bir istek
birden çok sınıra bağlıysa hepsinden birlikte pay ayrılır; biri doluysa hiçbirinden
pay tüketilmez. Uygulama içi ve arka plan ayrı bağımsız sayaç kullanamaz. Arka plan,
kullanıcı işlemlerine ayrılan payı tüketemez; bu payın üretim değeri seçilmemiştir.

**Örnek:** Yalnız sentetik testte ortak sınır iki çağrı, kullanıcıya ayrılan pay bir
çağrı olsun. İki arka plan çalışanı aynı anda gelirse yalnız biri geçer. Kullanıcı
işlemi kalan tek payı kullanabilir; üçüncü çağrı bekler. Bu rakamlar gerçek platform
kotası veya üretim ayarı değildir.

Kota doluluğu normal beklemedir: sağlayıcı çağrılmaz, iş hata sayılmaz, otomatik
tekrar döngüsü kurulmaz. Başlamış çağrı reddedilirse veya sonucu bilinmiyorsa
paylaşılmış sınır için kalıcı durma kaydı tutulur. Süre geçmesi veya Retry-After
bu durmayı kaldırmaz. Paylaşılmış sınırın bütün mağazaları mı tek hesabı mı
etkileyeceği, kapsam eşlemesi yapılırken ayrıca denetlenir; burada canlı kapsam
seçilmez. Zamanı dolmuş fakat sonucu belirsiz çağrı silinmez. Açık çağrı sayısı
da ayrıca sınırlandırılır. Sonucu bilinen çağrı kota tüketimini geri almaz.
Yalnız süresi geçmiş, sonucu bilinen kota metadata'sı sınırlı temizlikle silinebilir.
Temizlik zamanlayıcısı ve retention kabulü henüz etkin değildir.

Shopify Partner kotası istemci başınadır, mağaza başına değildir. Google için
Cloud Project sınırı ve ek uygulanabilir kapsamlar; Klaviyo OAuth için hesap ve
uygulama örneği ile endpoint/ek sorgu sınırları birlikte değerlendirilir. Bunlar
tek tip sağlayıcı limiti değildir. Çekirdek muhafazakâr kayan pencere kullanır;
sağlayıcının gerçek kota algoritmasının veya dinamik CPU limitlerinin birebir
kopyası olduğu iddia edilmez. Kısa çağrı başlatma izninin süresi ve saat uyumu
etkinleştirme öncesi ölçülür.

Üretim kota kaydı eklenmez; bilinmeyen ayarda yeni kapı çağrı başlatmaz. Mevcut
Production yolları değiştirilmedi. Güvenilir hesap/istemci kapsam eşlemesi,
tüm gerçek çağrı yollarının tek kez bu kapıya bağlanması, sağlayıcı header
geri bildirimi ve normal kota beklemesinin iş sırasına aktarılması henüz açıktır.
Dolayısıyla bu teslim **ortak kota yönetiminin tamamının kapanışı değildir**.

Sözleşme: `contracts/eo-05a-shared-api-quota-v1.json`. Supabase/PostgreSQL rehberleri
kısa işlem, sıralı kilit ve dar erişim sınırını yönlendirdi. Resmî kaynaklar
20 Ekim 2026'da kontrol edildi; bağlantılar sözleşmededir. Meta belge erişimindeki
önceki 429 zorlanmadı, yeni Meta kota sayısı etkinleştirilmedi. Yalnız repository,
sentetik test ve iki mevcut boş CI veritabanı. Yeni secret/hizmet, canlı migration,
provider çağrısı, UI/deploy veya Dataset/product tasarımı yoktur. Merge ayrı onaydır.

## EO-05-A — Tüm workspace'ler için refresh tasarım önerisi — 20 Ekim 2026

### EO-05-A — Gerçek kayıtlardan mağaza ve raporlama hesabı listesi — 20 Ekim 2026

PR #148 açık merge onayıyla `300f52bb6efc3d9953e0a383d8ffe8cc9707e51b`
olarak kabul edildi. Fırat şimdi mağaza/raporlama hesabı listesinin mevcut
veritabanı kaynaklarından çıkarılıp iş ihtiyacı takibine bağlanmasını onayladı.
05-A içindeyiz; 05-B başlamadı. Eski teslimlerdeki kabul bekliyor ifadeleri
kendi hazırlık tarihleridir; bu kayıt onların merge durumunu günceller.

**Kimler var?** Mevcut tüm workspace kayıtları sayılır. Kurulumu olmayan,
uygulaması kaldırılan veya provider hesabı bulunmayan mağaza kaybolmaz. Her
mağaza için Meta, Google ve Klaviyo'nun üç ayrı güncel durum kaydı tutulur.
Aktif kurulum/nesil, bağlantı ve seçili raporlama hesabı aynı veritabanı
görüntüsünden okunur; kullanıcıdan mağaza/hesap listesi alınmaz.

Meta/Google'da erişilebilen bütün hesaplar değil **seçili Reporting Account**
değerlendirilir. Manager hesap iş kuyruğuna giremez. Klaviyo'da tek aktif hesap
aranır; iki hesap varsa rastgele biri seçilmez, belirsizlik nedeni görünür kalır.
Hesap seçilmemiş, yeniden yetkilendirme gereken, bağlantısı kapalı, scope veya
para birimi/saat dilimi eksik durumlar birbirinden ayrılır.

**Hazır ne demek?** `ready_for_entitlement_check` yalnız güncel Shopify abonelik
kontrolüne aday iş ihtiyacıdır. Reklam verisini alma izni, aktif abonelik veya
ürün doğruluğu kanıtı değildir. Eski abonelik durumu yalnız tanısal bilgi olarak
korunur; önceki yeni Shopify kontrolü atlanamaz. Kaynak liste aboneliği olmayan
mağazayı gizlemez. Bu adayları yeni abonelik kontrolüne kabul edip sonucunu gerçek
provider işine bağlama henüz tamamlanmamıştır: eski/olumsuz abonelik kaydı
yüzünden kullanıcıyı uygulamayı açmaya mecbur bırakmamak gerekir. Mevcut admission
işlevine uydurma `entitled=true` verilerek bu kapı aşılmaz; sonraki bağlama işidir.

Reporting Account seçiminin kendi geçerlilik dönemi vardır; bu değişiklik her
zaman OAuth bağlantı sürümünü artırmaz. Başka hesaba geçip tekrar dönüldüğünde
eski bekleyen saatler yeni seçime taşınmaz. Yalnız bu native kaynak, değişen
seçim/bağlantı dönemine ait ihtiyaç metadata'sını yenileyebilir. Eski çalışan,
belirsiz çağrı, hesap hold'u veya ayrılmış kapasite bu işlemle çözülmez.

Tam kaynak listesi, güncel ihtiyaçlar, üç provider durumları ve başarılı kontrol
zamanı aynı kısa işlemde kaydolur. Kaynak görüntüsünden sonra gerçekleşen bağlantı
değişikliğini sistem dondurmaz; worker çağrı/yazma öncesi yetkiyi tekrar denetler.
Liste belirlenen boyuta sığmazsa kesilip başarı üretilmez: bütün kontrol reddedilir,
son geçerli kayıt ve başarı zamanı korunur. Sayfalı tarama/üretim kapasitesi
kanıtı bu küçük test değildir; canlı limit sayısı seçilmez.

İç koordinatörün dışarıdan JSON liste göndererek kontrolü tamamlaması kapatılır;
yalnız veritabanının kendi ürettiği listeyle işlev çağrısı yapabilir. Uygulama
ekranına veya tarayıcı rollerine toplu mağaza erişimi verilmez. Durum kaydında
mağaza alan adı, hesap adı, token, credential kimliği veya şifreli payload yoktur.
Güncel durum metadata'sı tam tarihsel boşluk defteri değildir. Workspace silinince
FK üzerinden temizlenir; ayrıntılı retention/mahremiyet kabul kapısı açık kalır.

Sözleşme: `contracts/eo-05a-refresh-native-inventory-v1.json`. Yalnız repository,
sentetik kurulum/hesap kayıtları ve iki mevcut boş CI veritabanı testleri.
Canlı provider/Shopify çağrısı, Dataset yazması, zamanlayıcı, yeni hizmet veya
secret yoktur; migration canlı uygulanmaz. Supabase/PostgreSQL rehberleri tek
tutarlı kaynak görüntüsü ve dar iç erişim sınırını yönlendirdi. Resmî kaynaklar
20 Ekim 2026'da kontrol edildi. UI değişmedi; merge ayrı açık onay bekler.

### EO-05-A — İş sırasından güncel abonelik ve veri alımına güvenli devir — 20 Ekim 2026

Fırat bu repository bağlantısını onayladı. Önceki yerel/uzak `main`
`e5a426d816ffd3004efc98ea42d73ad2457fb0a8` (PR #149) korunur. 05-B başlamaz.
Sözleşme: `contracts/eo-05a-refresh-preflight-bridge-v1.json`.

**Sıradaki mağaza önce güncel abonelik kontrolüne girebilir.** Eski abonelik
kaydı eksik veya olumsuz diye mağaza bu kontrolün dışında bırakılmaz; kullanıcının
uygulamayı açması beklenmez. Bu aşamada ayrılan kapasite reklam verisi alma izni
değildir. Shopify'ın yeni olumlu cevabı ve kaydın hâlâ geçerli olması zorunludur.
Yeni olumsuz cevap reklam çağrısını durdurur. İş başına tek deneme vardır.

Her devirde en fazla bir iş başlatılır. Mağaza/provider/hesap sınırları, kullanıcı
işlemleri için ayrılan kapasite, sıra adaleti ve belirsiz işlerin blokajı korunur.
İş, kapasitesi ve bağlı olduğu hesap dönemi aynı kısa veritabanı işleminde ayrılır;
bu işlem sırasında dış çağrı beklenmez. Aradaki sırada başka değişiklik olduysa
yeniden denenmez; devir yapılmaz. İç koordinatör keyfî hesap listesiyle genel iş
başlatma yolunu kullanamaz.

**İş başladığı bağlantı ve hesap seçim dönemine bağlıdır.** Bağlantı değişirse,
yeniden yetki gerekirse veya başka hesap seçilip eski hesaba dönülürse eski iş
geçersizdir. Aynı hesap kimliği veya OAuth sürümü tek başına yeterli değildir.
Saat dilimi/para birimi değişikliği de eski işi geçersiz kılar. Çağrı öncesi ve
sonuç devri öncesi yeniden kontrol yapılır; kullanıcı işlemleri küresel olarak
dondurulmuş sayılmaz. Gelecekteki Dataset yazması aynı işlem içinde son kontrolü
yapmak zorundadır.

Tarih aralığı, parçanın kimliği, büyüklüğü ve süre sınırı güvenilir iç planlayıcı
tarafından açıkça verilir. Eksikse tarih uydurulmaz. Günlük sorgu bağlantı/hesap
seçim döneminden önceye taşamaz; bilinçli Disconnect boşluğu alınamaz. Dönem
sınırını kesen günün politikası ve üretim iş parçaları henüz seçilmedi; EO-05-D
kararı bu bağlantı koduyla atlanmaz. İhtiyaç kaydı silinmez; elde edilen satırlar
yalnız `awaiting_dataset` olarak bellekte devredilir. Bu, başarılı refresh veya
Dataset'e kayıt değildir.

Supabase ve PostgreSQL rehberleri kısa işlem, dar yetki ve hesap dönemi korumasını
yönlendirdi. Kaynaklar 20 Ekim 2026'da kontrol edildi; bağlantılar sözleşmededir.
Sentetik testler ve mevcut iki boş CI veritabanı kullanılır. Canlı migration,
Shopify/provider çağrısı, UI/deploy, yeni hizmet veya secret yoktur. Ortak Shopify
çağrı kotası, üretim tarih/iş planı, zamanlayıcı, bağımsız alarm/gözetmen ve Dataset
yazıcısı açık kapılardır. Merge ayrıca onaylanır.

### EO-05-A — Saatlik veri alımından önce güncel Shopify abonelik kontrolü — 20 Ekim 2026

PR #147, Fırat'ın açık onayıyla `79bcbcd6ee663b8155a2737c3ac28c2687409a96`
olarak birleşti. Sonraki incelemede mevcut abonelik yenileme çağrısının uygulama
açılışına bağlı olduğu görüldü. Fırat, arka plandaki saatlik veri alımından önce
aboneliğin Shopify'dan sunucu tarafında doğrulanmasını onayladı. 05-B başlamaz.

**Kullanıcı uygulamayı açmasa da kontrol yapılabilecek.** Yeni abonelik sistemi
yazılmaz: mevcut Partner API `2026-07` `activeSubscription` sorgusu, yanıt
doğrulayıcısı ve mevcut abonelik tabloları kullanılır. Hedef mağaza kullanıcıdan
alınmaz; güncel iş/sahiplik numarasından aktif kurulum, Shopify mağaza kimliği ve
alan adına ulaşılır. Başka mağazanın cevabı kabul edilmez.
Shopify okuması da dış çağrıdır: işin kalıcı çağrı niyeti kaydı oluşmadan
başlayamaz. Bu aşamada çalışan koparsa iş hiç başlanmamış sayılmaz.

Eski “aktif” bilgisi yeterli değildir. Her veri parçası için yeni doğrulama
çağrısı gerekir; önceki olumsuz önbellek de yeni olumlu cevabı tek başına
engellemez. İş çekirdeğinde bu kontrol zorunludur. Provider çağrısından hemen
önce ve sonuç devredilmeden önce aboneliğin hâlâ geçerli olduğu tekrar okunur.
Yeni bir olumsuz abonelik kaydı önceki olumlu doğrulamayı geçersiz kılar.

Shopify abonelik yok diyorsa `subscription_required` kaydedilir ve reklam
verisi alınmaz. Süresi bitmiş trial veya geçmiş fatura dönemi işi açamaz.
“Dönem sonunda iptal” bugün iptal demek değildir; geçerli dönem yine aranır.
Hata, bozuk cevap, farklı mağaza veya kayıt sorunu eski aktif kayda dönüş
nedeni değildir. Otomatik tekrar/alternatif rota yoktur. Zaman aşımı ve ağ
kopmasında uzaktaki isteğin durduğu varsayılmaz; geç yanıt kayıt veya izin
üretemez. Belirsiz istek mevcut iş takibinde belirsiz tutulur, kapasite çözülmez.

Kalıcı kayıt kısa ve iş/sahiplik numarasıyla korunan SQL işlemidir; eski çalışan
yeni işe veya başka kuruluma abonelik sonucu yazamaz. HTTP beklerken transaction
açılmaz. Abonelik tabloları ve genel abonelik yazma işlevi koordinatöre açılmaz;
yalnız dar, iş kimliğine bağlı işlevler hazırlanır. Supabase/PostgreSQL rehberleri
bu erişim ve kısa işlem sınırını yönlendirdi.

**Canlı etkinleştirme değil:** Testteki Shopify cevapları sentetiktir. Partner
API'nin resmî sınırı istemci başına saniyede dört istektir; uygulama açılışındaki
kontroller ile bütün arka plan çalışanlarının aynı kotayı paylaşması gerekir.
Yeni kontrol bu ortak sıra izni gelmeden çağrı başlatamaz. Ortak kota uygulaması,
tam mağaza envanteri, gerçek zamanlayıcı/provider adaptörü ve alarm teslimi henüz
bağlı değildir. Bu teslim limit değeri seçmez, yeni servis/secret açmaz ve canlı
Shopify çağrısı veya migration uygulamaz. 05-A bütünü tamamlandı denmez.

Sözleşme: `contracts/eo-05a-refresh-entitlement-check-v1.json`. Resmî Shopify
activeSubscription/Partner API, PostgreSQL ve Supabase RLS kaynakları
20 Ekim 2026'da kontrol edildi. Yerel build tekrar denenmez; build GitHub CI'da,
SQL iki mevcut boş geçici veritabanında doğrulanır. Merge ayrı açık onay bekler.

### EO-05-A — Zamanı gelen mağazanın iş ihtiyacını kaydetme — 20 Ekim 2026

**Kapsam:** Fırat'ın onayıyla 05-A içinde devam edilir; 05-B başlamaz.
Alarm tasarımı PR #145 (`e51506b244da3a21b25073b3ccbf160d2d9f9bb3`) ve
tek veri parçası çekirdeği PR #146 (`dee7b8621c33abea997eadbcb3a6cb61cf375bdb`)
ayrı açık onayla birleşmiştir. Aşağıdaki eski “PR145 açık” ifadeleri o teslim
hazırlanırken geçerli tarihsel durumu anlatır, bugünkü merge durumunu değiştirmez.

Bu adımda güvenilir iç kaynaktan gelen **tam mağaza/hesap listesi** değerlendirilir.
Hesabı olmayan mağaza ve uygun olmayan hesap da sayılır. Eksik, yarım, yinelenmiş,
eski, ileri tarihli veya açık boyut sınırını aşan liste başarılı kontrol olamaz.
Listeyi üreten gerçek kurulum/bağlantı kaynağı henüz bağlanmamıştır: testteki
“tam liste” sentetiktir. Sayıların eşit çıkması tek başına doğru kaynak kapsamının
kanıtı değildir; bu sınır kapanmadan canlı genel sağlık sinyali yayımlanmaz.

Her hesap saat içine yayılmış mevcut sabit sırasını korur. Zamanı geldiyse
**bekleyen iş ihtiyacı** oluşur; her dakikada veya kaçan her saatte yeni iş
yığını açılmaz. Aynı hesap için ilk bekleme anı ve ilk/son kaçan saat saklanır.
Kontrol tekrar geldi diye bekleme süresi sıfırlanmaz. Böylece genel kontrol
sağlıklı olsa bile bir hesabın beklemesi iç gözlemci tarafından görülebilir.
Takılma eşiği ölçülmeden uydurulmaz; çalışan alarm/mesaj teslimi iddiası yoktur.

Bekleyen ihtiyaç henüz **çalıştırılabilir provider işi değildir**. Veri ailesi,
tarih aralığı, sayfa ve ölçülmüş iş maliyeti belirlenip önceki kabul çekirdeğine
bağlanmadan dış çağrı yapılamaz. İlk/son kaçan saatler eksik günleri otomatik
alma izni değildir. Bağlantı değişiminde eski ihtiyaç yeni bağlantıya taşınmaz;
kapalı bağlantının aynı sürümle sessizce yeniden açılması reddedilir. Abonelik
uygunluğunun geri gelmesi bağlantının yeniden açılmasıyla karıştırılmaz;
tek başına yeni OAuth veya geçmiş veri alma izni gerektirmez/vermez.
Mevcut durdurma/belirsizlik kaydı korunur; yeni kontrol eski işi çözmez,
tekrarlamaz veya kapasitesini serbest bırakmaz. Bilinçli Disconnect boşluğu alınmaz.

Tam liste değerlendirmesi, hesapların güncel ihtiyaç kaydı ve başarılı kontrol
zamanı **aynı kısa veritabanı işlemiyle** saklanır. İki kontrol aynı sürümle
yarışırsa yalnız biri kabul edilir; diğerinde otomatik tekrar yoktur. İşlem
yarıda kalırsa başarı saati de ilerlemez. Saat veritabanından gelir; HTTP 200
veya kontrolün başlaması başarı değildir. Ayrı gözlemcide kullanılacak karar
işlevi açık etkinleştirmeden veya son başarılı kontrolden itibaren **120 saniye
aşılmasını** kritik sayar; şu anda bağımsız gözlemci çalıştırılmaz.

Her hesap için yalnız güncel metadata vardır; bu eksiksiz tarihsel boşluk/deneme
defteri değildir. Tam liste eski hesap/kurulum metadata'sını geçersizleştirebilir;
provider veya Dataset verisi silmez. Gizlilik yaşam döngüsü, tarihsel kanıtın
saklanması ve iş tüketme/başarı bağlantısı kendi açık kapılarında kalır.

İlk uygulama açıkça sınırlanmış tam listeyle çalışır; ölçülen sınırlara sığmazsa
listeyi kesip başarı üretmez. Sürümlü sayfalı tarama ayrıca gerekir. Canlı limit
sayısı seçilmez, yeni zamanlayıcı/hizmet/secret açılmaz, migration canlı uygulanmaz.
UI değişmez. Sentetik test ve iki boş CI veritabanı kontrolüyle teslim edilir.
Sözleşme: `contracts/eo-05a-refresh-queue-check-v1.json`.

Resmî kaynak kontrolü 20 Ekim 2026: PostgreSQL 17 INSERT/ON CONFLICT ve kilitleme,
Supabase RLS ve changelog. Supabase rehberi özel schema, zorunlu RLS ve yalnız
mevcut NOLOGIN iç koordinatörün çağırabildiği işlev sınırını yönlendirdi.
Yerel Windows build tekrar denenmez; build normal GitHub CI'da doğrulanır.

### EO-05-A — Tek veri parçasını çalıştırma ve evre kaydı — 20 Ekim 2026

Fırat, 16 alarm senaryosundaki korumaların mevcut EO-05 alt işleri içinde
uygulanmasına başlanmasını onayladı. İlk teslim yalnız önceden sıra almış bir
veri parçasının çalışan çekirdeği ve kalıcı evre kaydıdır. Çalışma sözleşmesi:
`contracts/eo-05a-refresh-chunk-worker-v1.json`. Alarm tasarımı PR #145 açık kalır;
bu uygulama yönlendirmesi o PR için ayrı merge onayı değildir.

Akış: **yetki kontrol ediliyor → çağrı niyeti kaydedildi → yanıt alındı →
Dataset'e verilmeye hazır**. Her adım doğru mağaza/kurulum/hesap/iş/sahiplik
numarası ve tarih aralığına bağlıdır; adım atlanamaz. Aynı işi ikinci kez açan
çalışan tekrar provider okuması başlatamaz. Çağrıdan önce ve sonuç devredilmeden
önce güncel sunucu yetkisi tekrar yüklenir; hesap/bağlantı sürümü değişirse durulur.

Çağrı niyeti kalıcı kaydolmadan dış okuma yoktur. Bu kayıt “kesin çağrı yapıldı”
kanıtı değildir; kayıt ile gerçek gönderim arasında çökme olabilir. Zaman aşımı,
bağlantı hatası veya iptal sinyali provider'ın durduğunu kanıtlamaz: iş belirsiz
kalır, kapasite korunur, geç gelen cevap yeni adım veya başarı üretemez.
Bilinen provider reddi ve doğrulama hatası durdurulur; kendiliğinden tekrar yoktur.
DB/evre kaydı sorunu da başarı veya kapasiteyi serbest bırakma nedeni değildir.

En fazla satır/byte, çağrı süresi ve kapanış payı açık girdidir; ölçülmemiş canlı
sayı seçilmedi. Kaynak yanıt akışını boyutla sınırlayan gerçek provider adaptörü
henüz bağlı değildir; çekirdeğin byte kontrolü doğrulanmış satırların boyutudur.
DB çağrıları/yetki yükleme için bağlantı ve sorgu süre sınırı ile gerçek çalışma
ortamının zaman sınırı canlı etkinleştirmeden önce ayrıca doğrulanacaktır.

**Önemli sınır:** Sonuç **Dataset bekliyor** durumudur. Ürün verisi henüz kalıcı
Dataset'e yazılmaz; yalnız doğrulanmış satırlar bellekte devredilir. Bu noktada
iş tamamlandı, checkpoint ilerledi veya veri güncel denmez. Kalıcı evre takibi
olan iş, genel tamamla işleviyle başarılı kapatılamaz. Bellekteki veri kaybolursa
bu otomatik yeniden alma izni değildir. Product-level saklama ve atomik Dataset
yazma/ilerleme kapısı EO-05-B'de seninle netleştirilecek, sahte writer bağlanmayacak.

Native provider yetki/okuma adaptörleri, takvim tetikleyicisi, bağımsız gözetim ve
alarm teslimi bağlı değildir. Testteki sunucu yetkisi/provider yanıtı sentetiktir;
gerçek provider izni veya ürün doğruluğu kanıtı değildir. Yeni migration yalnız
hazırlanır ve iki mevcut boş CI veritabanında sınanır; canlı uygulanmaz. UI,
secret, yeni servis veya dağıtım değişikliği yoktur. Listing tree durdurma ve
bilinçli Disconnect aralığını almama kararları korunur.

Supabase/PostgreSQL rehberleri kısa işlem, zorunlu RLS ve dar işlev erişimini
yönlendirdi. Resmî PostgreSQL 17 kilitleme, Node.js 24 zamanlayıcı ve Supabase RLS
kaynakları 20 Ekim 2026'da kontrol edildi. Yerel Windows build hatası için işlem/
makine ayarı veya tekrar denenmez; bu teslimin build'i normal GitHub CI ile doğrulanır.

**Durum:** Tasarımdan ayrılmış repository karar çekirdeğinin uygulanması 20 Ekim'de
ürün sahibi tarafından onaylandı. Teslim kabulü bekler; çalışan scheduler veya
kapasite kabulü değildir. EO-05'in canlı uygulama ve başlangıç kapıları kapanmadı.
Tasarım kaydı: `contracts/eo-05a-global-refresh-design-v1.json`.

**Sonraki onaylı teslim — ortak iş takibi:** Önceki karar çekirdeği PR #141 ile
kabul edildi. Ürün sahibi şimdi iş takibi kodu, veritabanı değişiklik dosyası ve
testlerin hazırlanmasını onayladı; canlı uygulama onayı vermedi.

**Onaylı kısa ölçüm:** Ortak iş takibi PR #142 ile kabul edildi. Şimdi yalnız
boş test veritabanlarında 100 örnek mağaza, 1/2/4 çalışan ve 0/10.000 geçmiş iş
kaydıyla altı kısa deneme yapılır. 90 mağazanın birer, 10 büyük mağazanın beşer
küçük işi vardır: toplam 140 iş. “Büyük” burada daha çok iş parçası demektir;
gerçek ürün verisi çekilmez veya Dataset'e yazılmaz.

İşin sıra alması, kaydedilmesi ve tamamlanması ne kadar sürüyor; bütün mağazalara
ilk sıra geliyor mu; geçmiş kayıtlar artınca takip yavaşlıyor mu ölçülür. Ölçüm
süresi uygulama/veritabanı arasındaki beklemeyi de içerir; veritabanının kendi
harcadığı süre ayrıca örnek sorguyla görülür. Tekrarlanan sahiplenme çatışmaları
hata/otomatik provider retry değil, sınırlı test sürücüsünün yeni sıra denemeleridir.

Her deneme en fazla 60 saniye ve 10.000 sıra denemesiyle sınırlıdır. Ölçüm için
tablo sahibinin test bağlantıları kullanılır; canlı Supabase planı, bağlantı havuzu,
UI raporları veya provider yanıt süreleri ölçülmüş sayılmaz. Çıkan hız sayıları
üretim ayarı, gerçek mağaza kapasitesi veya 2.000/4.000 mağaza/24 saat kabulü değildir.
Ürün verisi yazma yükü Dataset V2 kurulduğunda ayrıca sınanır. Yeni şema, servis,
provider çağrısı, canlı ayar veya deploy bu test kapsamında yoktur.

`app/lib/database/refresh-work-repository.server.js` ve
`supabase/migrations/20261020092429_eo05a_refresh_work_tracking.sql` bütün
çalışanların aynı iş kaydını görmesini sağlar. İşin kimde olduğu ve sistemde
ayrılan yer birlikte kaydolur. İş bittiğinde tamamlandı, yarıda kaldığında durdu
olarak saklanır; eski çalışan yeni sahibin işini kapatamaz. Tamamlanmış iş aynı
kimlikle yeniden başlatılamaz. Durmuş işi yeniden başlatmak ayrı bir işlemdir;
otomatik tekrar veya süre dolunca kendiliğinden devir yoktur.

Sistemin sınırları da aynı ortak kayıttan okunur; bir çalışanın gönderdiği daha
yüksek sayılar bunların yerine geçemez. Başlangıçta bu sınırlar tanımlı değildir,
bu nedenle iş başlatılamaz. Testteki küçük örnek sayılar gerçek kapasite değildir.

Yeni kayıtlara kullanıcı ekranları ve mevcut web uygulaması doğrudan erişemez.
Yalnız bu iş için ayrılan, henüz hiçbir giriş hesabına bağlanmamış iç yetki vardır.
İş kaydı tutulurken veritabanı kısa süre meşgul edilir; sağlayıcı yanıtı beklenirken
açık tutulmaz. Veritabanı rehberleri bu güvenlik ve kısa işlem sınırını belirledi.

İki ayrı boş PostgreSQL test veritabanında aynı işe iki çalışanın uzanması,
dolmuş kapasite, arada kalan kayıtların geri alınması, yarım iş, eski çalışan ve
erişim sınırları sınanır. Bunlar sentetik testlerdir; canlı Supabase değişikliği
veya gerçek mağaza/kapasite kanıtı değildir. Çalışanların çağrı ve kayıt öncesi
yetki kontrolü, güvenli otomatik devir, saklama/silme bağlantısı ve gerçek sınır
ölçümleri tamamlanmadan canlı kullanım açılmaz. EO-05-A kapanmış değildir.

**Bu teslimin çalışan kodu:** `app/lib/refresh/admission-policy.server.js` yalnız
hangi sınırlı iş parçasına sıra verileceğini hesaplar. Mağaza/sağlayıcı/hesap
kimliğinden aynı saat içi konumu üretir; önceki hizmet sırasını girdiden alıp büyük
workspace'in küçük workspace'i sürekli geriye itmesini önler. Global, sağlayıcı,
workspace ve hesap bütçelerinden biri doluysa iş gerekçesiyle bekler. Rapor okuma
payı global bütçeden önce ayrılır. Maliyet/bütçe bilinmiyorsa sıfır varsayılmaz.

İş sahipliği ve bütçe tek global sürüm kontrolüyle birlikte kaydedilmeden iş
başlatma hakkı doğmaz. Kod gerçek atomik depo sunmaz; iki çalışanın yarışması
yalnız sentetik depo ile sınanır. Farklı iş amacı aynı hesap kilidini aşamaz;
eski sahip yeni sahipliğin rezervasyonunu bırakamaz. Bırakma sonucu da atomik
kayda uygulanması gereken öneridir. Süre dolunca kilit kendiliğinden kalkmaz.

Test limitleri hayalî örneklerdir, üretim ayarı değildir. Yetki/bağlantı penceresi
girdileri gelecekte doğrulanmış sunucu otoritesinden gelmelidir; bu çekirdek
Shopify veya sağlayıcı yetkisi doğrulamaz. İş yükü/sorgu ölçümü, gerçek depo,
lease kurtarma, iş sınıfı bütçeleri, worker/checkpoint ve kapasite koşuları hâlâ
açıktır. Bu modül route'a bağlanmadı; DB, provider, secret, timer veya deploy
değişikliği yoktur. Google satış/Channel/maliyet kuralları ve listing tree
durdurma kararı değişmez.

Akış: uygunluk → saat içindeki sıra → workspace'ler arasında adil seçim →
ortak bütçe ve işi atomik sahiplenme → sınırlı veri parçası → güvenli kayıt/
checkpoint → bütçeyi bırakıp kalan iş için sıraya dönme.

- **Sistem bütünü:** Bütün çalışanların toplam sağlayıcı istekleri, DB yazma
  işleri, bağlantı ve satır/byte yükü birlikte sınırlandırılır. Her worker'ın
  kendi sayacı yetmez. Kullanıcının rapor okuması için kapasite ayrılır; bütçe
  dolunca iş kaybolmaz, bekler. Sayısal limitler ölçülmeden uydurulmaz.
- **Adil sıra:** Aynı saatte toplu yükleme yoktur. Büyük workspace'in tüm
  geçmişi tek seferde kuyruğu tutamaz; sınırlı sayfa/tarih parçasından sonra
  diğer workspace'lere sıra verilir. İlk yükleme, saatlik veri, derin uzlaştırma
  ve izinli kurtarma işleri birbirini süresiz aç bırakmamalıdır.
- **Çakışma:** Aynı workspace/kurulum nesli/sağlayıcı/hesapta tek aktif iş olur.
  Başka iş amacı bu sınırı aşamaz. Sahiplik süresi dolan eski çalışan, yeni
  sahibin verisine yazamaz. Sağlayıcı yanıtı beklenirken DB işlemi açık tutulmaz.
- **Yarıda kalma:** Checkpoint yalnız veri kalıcı kaydedildikten sonra ilerler.
  Kayıttan hemen sonra çökme olursa tekrar çalıştırma veriyi çoğaltmaz. Kısmi
  sayfa/tarih başarı sayılmaz; kaçırılan saatler sınırsız yeni iş üretmez.
- **Yetki ve hata:** İş öncesi ve kayıt öncesi hesap/kurulum/abonelik/bağlantı
  yetkisi kontrol edilir. Disconnect dönemi alınmaz. İlk açık provider hatasında
  ilgili işlem durur; otomatik tekrar, süre dolunca kendiliğinden yeniden deneme
  veya alternatif rota izni yoktur. Geçerli eski veri korunur.

Eski referans `fyilanli-oss/ads-table-dev` commit
`6d79fbb8d975be550d5611d682ae1ad2a97594d7` içindeki iş durumu, source job ve
güvenli hata görünürlüğü fikirleridir. Eski otomatik retry kuralları ve uygulama
bekleyen scheduler sözleşmesi taşınmaz; hazır altyapı kabul edilmez.

Uygulama öncesinde yürütme/tetikleme mekanizması, atomik sahiplenmenin güvenli
kalıcılık sınırı ve ölçülmüş limitler ayrıca doğrulanacaktır. Bu taslak herhangi
bir Vercel/Supabase servisi seçmez, satın alma veya canlı işlem gerektirmez.
Yarış, çöken çalışan, eski sahip, büyük/küçük workspace adaleti ve Disconnect
aralığı senaryoları kalıcı depo/worker üzerinde ayrıca sınanacak; sentetik karar
çekirdeği ve sözleşme testleri bunların üretimde çalıştığını kanıtlamaz.
PMax kanıt çalışması durdurulmuştur;
bağımsız refresh işini engellemez, tarihsel kesin Channel kabulü yerine geçmez.

Resmî tasarım kaynakları 20 Ekim 2026'da kontrol edildi: PostgreSQL SELECT/kilit
kuralları ve GitHub PR güncelleme belgesi. Bağlantılar tasarım kaydındadır;
PostgreSQL belgesi tek başına güvenli bir kuyruk veya uygulanmış DB şeması değildir.

## EO-05-A — Başlayamayan ve yarıda kalan işlerin takibi — 20 Ekim 2026

Ürün sahibi bu dar repository uygulamasını onayladı; teslim kabulü ve merge
ayrıca beklenir. Canlı veritabanı değişikliği, provider çağrısı ve çalışan
etkinleştirme izni yoktur. Kaynak: `repository_work_stops_slice` tasarım kaydı.

- **Sıra bekliyor:** Kapasite veya saat uygun değil. Çağrı yapılmadı; hata,
  tamamlanma veya veri yokluğu değildir. Aynı bekleme bildirimi yeni kayıt yığını üretmez.
- **Başlamadan engellendi:** Yapılandırma/yetki/bağlantı/abonelik kontrolü geçmedi.
  Bilinen neden ve gerekli aksiyon kaydolur; bilinmeyen neden tahmin edilmez.
  Provider çağrısı veya kapasite ayırma yapılmış sayılmaz.
- **Provider reddetti:** Bir deneme yapıldı; tüm dış işlemlerin sona erdiği
  doğrulanmışsa iş durur, kapasitesi bırakılır ve ilgili hesap engelli kalır.
  Ham hata, token veya kişisel veri iş takibine yazılmaz.
- **Başladı, durdu:** Hiç çağrı yapılmadan durma ile çağrılar bitince durma
  ayrıdır. İş tamamlandı sayılmaz; mevcut geçerli veri korunur. Yeni kayıtlar
  Dataset'e bağlı değildir; veri güncelliği/checkpoint ilerletmez.
- **Sonuç belirsiz:** Çalışandan haber kesildi veya çağrının sonucu bilinmiyor.
  Eski sahip için güncel sahiplik kontrolü ve işi kapatma reddedilir; aynı hesapta
  yeni iş açılmaz. Çağrı hâlâ sürüyor olabileceğinden ayrılmış kapasite korunur.
  Diğer hesaplar yalnız kalan bütçe içinde ilerleyebilir; sınırsız kapasite sözü yoktur.

Bilinen engeli kaldırmak yalnız iç koordinatörün açık ve kayıt sürümüyle eşleşen
onayıyla olur. Bu işlem çağrı başlatmaz, eski sahibin hakkını geri vermez, güncel
yetkiyi kanıtlamaz veya geçmiş tamamlama izni vermez. Bilinçli Disconnect dönemi
alınmaz. Belirsiz dış işlemi bu API kaldıramaz; süre dolması/iptal sinyali tek
başına güvenli devir kanıtı değildir.

**Açık sınır:** Çalışanın kaybolduğunu saptayan mekanizma, dış çağrının gerçekten
sonlandığına ilişkin kanıt, belirsiz işin güvenli kurtarılması ve Dataset yazma
kapısına aynı işlem içinde sahiplik kontrolü henüz bağlı değildir. Ayrı okunan
“sahiplik geçerli” cevabı daha sonra yapılan yazıyı güvenli kılmaz. Bu teslim
çalışan scheduler veya tüm kurtarma kapılarının kapanışı değildir. Kayıt son iş
gözlemidir; eksiksiz deneme geçmişi/saklama politikası ayrıca açık kalır.

Resmî kaynaklar 20 Ekim 2026'da kontrol edildi: PostgreSQL 17 kilitleme kuralları,
Supabase RLS ve değişiklik kaydı. Canlı provider davranışı doğrulanmış sayılmaz.

## EO-05 — İlk tetiklemeden Dataset'e kadar alarm matrisi — 20 Ekim 2026

**Durum:** Fırat uçtan uca alarm tasarımının hazırlanmasını onayladı. Bu teslim
karar/matris ve sözleşme testidir; çalışan alarm motoru, mesaj gönderimi, migration,
provider çağrısı veya canlı etkinleştirme değildir. Mevcut EO-05-A işine bağlıdır;
operasyonel izleme EO-05-E ile tamamlanır, yeni alt paket açılmaz.
Makine kaydı: `contracts/eo-05-refresh-alarm-matrix-v1.json`.

### Kesin çalışma sıklığı ve iki dakikalık sınır

- **Dakikada bir:** Sırası gelmiş ve çalışmaya uygun işler kontrol edilir.
  Her dakika bütün mağazalardan veri alınmaz.
- **Saatte bir:** Her uygun mağazanın verisi kendi saat içine dağıtılmış sırasında
  alınır. Günlük derin uzlaştırma kuralı değişmez; her saat tam geçmiş taranmaz.
- **İki dakika aşıldığında:** Son doğrulanmış başarılı iş sırası kontrolünden
  itibaren 120 saniyeyi aşınca kritik alarm gerekir. HTTP isteğinin gelmesi veya
  kontrolün başlaması başarı değildir. Kontrol tamamlanıp kanıtı kalıcı kaydolmalı;
  atlanan iş bölümleri görünür kalmalıdır. Uygun iş yokken sağlıklı kontrol yine
  başarıdır; sırf boş diye provider'a çağrı yapılmaz.
- **İlk açılış da izlenir:** Gözetim açıkça etkinleştirildikten sonra ilk başarı
  için en fazla aynı 120 saniyelik pencere vardır. Eski, tekrarlanmış, başka ortam/
  dağıtıma ait veya ileri tarihli sinyal süreyi sıfırlayamaz.

Bu sınır yalnız iş sırası kontrolünündür. Provider yanıtı, kuyruk bekleme ve Dataset
yazımı için kendi ölçülmüş süreleri onaylanacak; hepsine rastgele iki dakika
verilmez. Mevcut kapasite sözleşmesindeki 45 dakikalık p95 hedefi tek bir işin
zaman aşımı değildir. Alarmın oluşması gereken an ile bildirimin insana ulaşma
gecikmesi ayrıdır: bağımsız gözetimin kontrol sıklığı ve teslim gecikmesi ölçülüp
onaylanmadan iki dakikada canlı bildirim garantisi verilemez. Ek gizli bekleme
penceresi eklenmez. Pro plan bilgisi Fırat'tan alınmıştır; yeni abonelik kararı yoktur.

### Hangi evrede neyi durduracağız, neyi sınayacağız?

| Kayıt / evre | Yakalanacak durum | Koruma ve kanıt için yapılacak test |
|---|---|---|
| AL01 — İş sırası kontrolü | Tetikleme yok, kontrol takıldı veya sahte başarı üretildi | Bağımsız iki dakika alarmı; başlangıç, tekrar ve ileri tarihli sinyal sınanır. |
| AL02 — Mağazanın sıra alması | Bir mağaza, iş bölümü veya iş sınıfı sürekli atlanıyor | Bekleyen iş korunur; bir sağlıklı mağazanın diğerlerini gizleyemediği sınanır. |
| AL03 — İşi sahiplenme | İki çalışan aynı işi alıyor, bütçe aşılıyor veya eski çalışan dönüyor | Atomik sahiplik/bütçe koruması; iki çalışan yarışı ve eski sahip sınanır. |
| AL04 — Güncel izin | Disconnect, kaldırma, hesap değişimi veya abonelik kaybından sonra işlem deneniyor | Çağrı ve yazı öncesi güncel yetki; arada yetki değişimi sınanır. Beklenen uygunsuzluk tek başına ihlal değildir. |
| AL05 — Provider'a başlama | Bizim/mağazanın eksik hazırlığı, ret, kota veya açıklanamayan hata | Hiç çağrı yapılmaması ile yapılmış deneme ayrılır; ilk hata durdurur, otomatik tekrar yoktur. |
| AL06 — Çalışanın devamı | Çalışan kayıp veya dış çağrının sonucu belirsiz | Hesap ve kapasite korunur; geç yanıt/eski çalışan kilidi kaldıramaz. |
| AL07 — Yanıtın eksiksizliği | Sayfa eksik, aynı imleç tekrarlandı, veri ailesi gelmedi veya yanıt bozuk | Kısmi sonuç tam sayılmaz; eksik sayfa ve hatalı HTTP 200 sınanır. |
| AL08 — Normal boşluk | Gerçekten boş yanıt, uygun iş yok veya bilinçli Disconnect var | Gereksiz alarm yok; gerçek sıfır, eksik veri ve normal bekleme ayrı sınanır. |
| AL09 — Verinin anlamı | Yanlış mağaza/hesap/ürün/tarih/kırılım/para birimi/FX/sürüm | Hatalı kayıt engellenir; kimlik ve döviz eşleşme hataları sınanır. Channel, rol veya maliyet uydurulmaz. |
| AL10 — Kalıcı iş kaydı | Veritabanı yok, bağlantı dolu veya işin kaydı yapılamadı | Kayıtsız yeni iş/başarı yok; uygulama ve DB kapalıyken dış gözetim sınanır. |
| AL11 — Dataset'e yazma | Eksik, tekrarlı, yanlış hedefli veya sonucu belirsiz kayıt | Tek işlemde sahiplik ve tekrar güvenliği; yazma sırasında izin kaybı ve kayıp commit cevabı sınanır. |
| AL12 — İlerleme kaydı | Veri yazılmadan ilerleme işaretlendi veya yazıdan sonra çalışan çöktü | İlerleme yalnız kalıcı yazıdan sonra; çökme veriyi çoğaltmamalı, kanıtsız tekrar başlatmamalıdır. |
| AL13 — Tamamlanma / tazelik | İşlem takıldı veya Dataset güncellenmeden güncel ilan edildi | Eski geçerli veri görünür ve eski/kısmi işaretli kalır; sağlıklı kontrolün takılan veri alımını gizlemesi sınanır. |
| AL14 — Alarmın ulaşması | Gönderim reddedildi, teslim belirsiz veya insan teyidi yok | Olay açık kalır; onaylı yedek rota ve teslimsiz HTTP 200 senaryosu sınanır. |
| AL15 — Gözetimin kendisi | Alarm sistemi de durdu veya ortak bağımlılık ikisini kör etti | Bağımsız tanık ve kontrollü örnek alarm; zamanlayıcı, uygulama, DB ve gözetim ayrı/birlikte durdurularak sınanır. |
| AL16 — İzleme güvenliği | Token/kişisel veri sızıyor, başka mağazanın kanıtı açılıyor veya silinen veri geri geliyor | Güvensiz içerik engellenir; yabancı mağaza erişimi, ham hata ve silme sonrası kurtarma sınanır. |

**Tablodaki testlerin durumu:** Bunlar yapılacak uçtan uca arıza senaryolarıdır;
bu tasarım teslimiyle yapılmış veya canlı PASS değildir. AL03, AL05 ve AL06'nın
bazı repository korumaları PR #141–144'te izole test edildi. Gerçek çalışan,
provider ve Dataset bağlantısı ile alarm teslimi ayrıca doğrulanacaktır. Ürün
seviyesi Dataset saklama kararı EO-05-B'de tartışılacak; tablo seçilmiş değildir.
Google listing tree çalışması durdurulmuş kalır, sağlayıcı sözleşmeleri değişmez.

### Alarmı kim görecek, sistem kendi hatasını nasıl saklamayacak?

Gözetim aynı refresh zamanlayıcısından çalışmayacak. Uygulama veya ana veritabanı
çöktüğünde sessizliği fark etmek için o veritabanını okumak zorunda olmayacak.
Yalnız genel “uygulama açık” cevabı yeterli değil; iş sırası kontrolü, beklenen iş
bölümleri ve mağaza bazında ilerleme ayrı kanıt ister. Gözetimin kendi kaybı da
bağımsız tanık/örnek alarm ile denetlenecek. Tüm ortak arıza noktalarının yok
edildiği veya sıfır risk sağlandığı iddia edilmez; kalan bağımlılıklar görünürdür.

Bir olayın **fark edilmesi → gönderim beklemesi → bildirim hizmetinin kabulü →
teslimin doğrulanması/belirsizliği → insanın gördüğünü teyidi → doğrulanmış
çözüm** ayrı tutulur. Bildirim hizmetinin HTTP 200 cevabı insan teyidi değildir;
insanın gördüm demesi de sorunu çözmez veya işin tekrarına izin vermez.

Kritik bütünlük/erişim ihlali ve iki dakika sessizliği operasyonel alarmdır.
Tek hesapta yetki yenileme gereksinimi görünür, sorumlusu belli bir aksiyondur;
bütün mağazalara panik bildirimi değildir. Aynı olay her dakika yeni mesaj
yığını üretmez; ilk/son görülme, tekrar sayısı ve etkilenen kapsam korunur.
Ortak olaylar birleştirilirken tekil mağazalar veya bilinmeyen nedenler gizlenmez.
Sonucu belirsiz provider işi alarm geldi diye bırakılmaz/tekrarlanmaz. Beklenen
Disconnect dönemi hiçbir alarm veya yeniden bağlantıyla sonradan alınmaz.

**Canlıya geçmeden açık seçimler:** Birincil/yedek bildirim kanalı, alıcı ve yedek
sorumlu, insan teyidi süresi, yükseltme kuralı, gözetimin bağımsız çalışacağı yer,
teslim gecikmesi, evre süreleri ve kanıtların erişim/saklama/silme sınırı seçilecek.
Hangi uygulamanın alınacağı veya yeni ücretli hizmet gerektiği kararlaştırılmadı.
Bildirim rotası kontrollü örnek alarm ve açık insan teyidiyle sınanmadan alarm
canlı kabul edilemez. Bildirim yeniden gönderme politikası provider sorgusu
yeniden deneme politikası değildir; ayrı sınır ve onay ister.

Resmî kaynak kontrolü 20 Ekim 2026: [Vercel Cron teslim sınırları](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Google SRE izleme ilkeleri](https://sre.google/sre-book/monitoring-distributed-systems/),
[Supabase ölçümleri](https://supabase.com/docs/guides/observability/metrics).
Kaynaklar tasarıma rehberdir; canlı davranış kanıtı değildir. Dakika/saat ve
iki dakika kararı Fırat'ın ürün kararıdır; provider garantisi değildir.

## Otorite

Bu repository onaylı A6-EO yalnız gömülü temiz yeniden kuruluş programını uygular.

- Aktif karar kaynağı: bu repository ve `docs/EXECUTION_PLAN.md`
- İlk kuruluş kaynak geçmişi/kanıt kaynağı: `fyilanli-oss/ads-table-dev` commit `3416ee736fc3c53910e5e6571a7b8f445c4ce3cd`
- Eski repository aktif karar otoritesi değildir; yalnız referans, kanıt, koruma ve geri dönüş kaynağıdır.
- Eski repository'den aynen taşınan uygulama/çalışma zamanı modülü: **0**
- Eski repository EO-09 canlı otorite geçişi tamamlanana kadar koruma ve geri dönüş hattıdır.

## Ürün sınırı

- Shopify Admin iframe'i içinde gömülü uygulama.
- Aktif sağlayıcılar: Meta, Google Ads, Klaviyo.
- Kanonik yüzeyler: Funnel App Home (`/`), Ad Analysis (`/ad-analysis`), Settings (`/settings`).
- İlk kuruluş planında EO-08 review kapısı ve ayrıca açık canlı geçiş kararı gelene kadar Preview sınırı kondu. Sonraki dar Production onayları yalnız kayıtlı kapsamlarını açtı; EO-09 otorite geçişi yetkisi olmadı.
- EO-01 sırasında canlı alan adı, Shopify yapılandırması, sağlayıcı, gerçek veri/token veya eski yapıyı devreden çıkarma değişikliği yoktu.

## Sıralı program

1. **EO-01 — Temiz çalışma zamanı kabuğu, CI ve bağımlılık sınırı**
2. **EO-02 — Çalışma alanı, kurulum, abonelik/deneme ve gizlilik temeli**
3. **EO-03 — Kanonik OAuth, bağlantı ve token kasası**
4. **EO-04 — Meta, Google Ads ve Klaviyo adaptörleri**
5. **EO-05 — Zamanlayıcı, Dataset V2, kur dönüşümü, olgunluk ve uzlaştırma**
6. **EO-06 — Formül, sorgu ve aynı-origin BFF/API**
7. **EO-07 — Shopify'a özgü üç yüzeyli arayüz**
8. **EO-08 — Taşıma provası, eşlik, kontrollü pilot ve geri alma**
9. **EO-09 — Otorite geçişi, kararlılık ve eski tüketici kalmadığının kanıtı**
10. **EO-10 — Eski yapının arşivi, saklama süresi ve kontrollü devreden çıkarma**

Aynı anda yalnız bir ana paket aktiftir. Yürütülebilir paket tablosu `contracts/a6-eo-implementation-master-v1.json` dosyasındadır.

## Mühendislik bütünlüğü ve review güvence sırası — 18 Ekim 2026

Bağlayıcı belge: `docs/A6_QUALITY_AND_ASSURANCE_GATES.md`

Yürütülebilir sözleşme: `contracts/a6-quality-and-assurance-gates-v1.json`

CI kontrolü: `tests/a6-quality-and-assurance-gates.test.js`

- EO-04 kapanışından hemen sonra ve EO-05 başlamadan önce `A6-TECH-01` bütün
  kodu, Shopify yapısını, sağlayıcı çalışma zamanlarını, Supabase'i, Vercel'i,
  GitHub/CI/kaynak zincirini ve uçtan uca veri güvenliğini denetler.
- Testlerin geçmesi tek başına yeterli değildir; yanlış davranışın yanlış testle
  korunması, paketler arası eski varsayımlar ve canlı yapı-repository drift'i de
  aranır. P0/P1 ile güvenlik, veri doğruluğu veya review'u etkileyen P2 açıkken
  EO-05 başlamaz.
- `A6-DOCS-01`, A6-TECH-01 düzeltmelerinden sonra ve EO-05'ten önce aktif insan
  okuyucu belgelerini Türkçe standardına getirir; makine sözleşmesi ve değişmez
  kanıt toplu çevrilmez.
- EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 referans sürümüne karşı delta
  bütünlük denetimi zorunludur.
- `A6-ASSURE-01` EO-08 sonrasında çalışan pre-review doğrulamasıdır; ilk kod
  sağlamlık denetimi değildir. Hiçbir nihai review başvurusu A6-ASSURE-01 PASS
  ve ürün sahibi GO kararı olmadan yapılamaz.
- `A6-TECH-01` ilk denetimi 18 Ekim 2026'da
  `c3faddff97628f372f5cc843f3326fb38de95dfc` başlangıç referans sürümünde
  tamamlanmış ve bulgular
  `docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md` içinde kaydedilmiştir.
  İlk kayıtta P0 yoktu; üç P1 ve beş engelleyici P2 açıktı. Bu tarihsel başlangıç
  kaydıdır. Güncel genel kapanış kararı aşağıdadır.

**A6-TECH-01 genel kapanışı — 18 Ekim 2026:** Ürün sahibi açık kabul verdi.
Denetlenmiş ve canlı kabul edilmiş PASS referans sürüm:
`bd243fff7200ae6bdb3900ebb7417b3beba53010`.
F01–F09 ve sonradan bulunan bağımlılık güvenlik bulgusu kapalı; açık P0/P1/P2
sıfırdır. F10 kabul edilmiş açık P3 ertelemesidir; düzeltilmiş sayılmaz.
PR #118 kaynak CI'ı 457 test/typecheck/build PASS; aynı kaynak ağacı canlıya
alındı. Gerçek Shopify Admin masaüstü ve mobil normal çalışma kabulü ürün
sahibi tarafından verildi. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_CLOSURE_2026-10-18.json`.

A6-TECH-01 kapanışında sıradaki kapı `A6-DOCS-01` idi; uygulaması o gün başlamamıştı.
DOCS başlangıcı 19 Ekim'de ayrıca onaylandı. EO-05 dokümantasyon kabulünü bekler.
Gerçek sağlayıcı/review sınırları ve F01 dar kurtarma sınırı korunur; yeni yedek,
yükseltme veya canlı çağrı işi açılmaz. Aşağıdaki ara durumlar tarihseldir;
güncel kabul bu genel kapanış ve belgenin başındaki durumdur.

F01 düzeltmesinin repository hazırlığı:
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` ve
`contracts/a6-tech-01-f01-migration-lineage-v1.json`. Bu kayıt migration geçmişi
onarımı, canlı uygulama, F01 kapanışı veya EO-05 başlangıcını yetkilendirmez.
Denetim düzeltmeleri F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10
sırasıyla ilerler; F01 kapanmadan F02 başlamaz.

F01 canlı devreden çıkarma 18 Ekim 2026'da ayrı ürün sahibi onayıyla uygulandı;
işlem sonrası kontrol kanıtı `docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
İlk 38 migration değişmedi. Supabase'in verdiği yeni sürüm `20261018152910`
ile repository eşlenmiştir. Ürün sahibi F01 kapanışını ve PR #102 merge'ünü
18 Ekim 2026'da onayladı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
Sıradaki bulgu F02'dir; uygulaması başlamadı. Bu kayıt yeni canlı değişiklik
veya EO-05 başlangıç yetkisi değildir.

F02'deki tek sahipsiz Google kimlik bilgisi, ayrı açık onayla 18 Ekim 2026'da
temizlendi. Üç bağlı kimlik bilgisi, üç bağlantı ve sekiz tarihsel kayıt korundu.
Ürün sahibi F02 kapanışını ve PR #104 merge'ünü kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F02_CLOSURE_2026-10-18.json`.
Sıradaki F03 başlamadı; yeni canlı işlem veya EO-05 başlangıcı yetkisi yoktur.

F03 envanter düzeltmesi 18 Ekim 2026'da ürün sahibi kabulünü aldı: 22 Vercel
adı, 1 GitHub iş akışı secret adı, toplam 23 envanter girdisi; örnek dosya,
sözleşme ve testler eşlendi. Secret değeri okuma veya canlı ayar/dağıtım işlemi
yok. Kapanış kanıtı `docs/evidence/A6_TECH_01_F03_CLOSURE_2026-10-18.json`.
F01–F03 kapalıdır. Sıradaki F04 başlamadı; EO-05 kapısı hâlâ kapalıdır.

F04 Polaris ön yükleme/script eşliği düzeltildi; ayrı onaylı birebir kaynaklı dağıtım
sonrası ürün sahibi gerçek Shopify Admin masaüstü ve mobil görünümünü kabul
etti, PR #106 merge'ünü onayladı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F04_CLOSURE_2026-10-18.json`.
Güncel durum F01–F04 kapalı, sıradaki F05 başlamadı ve yetkili değil.
F07 sürüm kaynak geçmişi ve genel EO-05 kapısı açık bulgulara bağlı kalır.

F05 action SHA sabitlemesi ürün sahibi onayıyla repository'de hazırlandı.
Kanıt `docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json`.
Kontrollü güncelleme: resmî sürüm/commit doğrulaması → PR → CI → açık merge
onayı; otomatik merge yoktur. CI ve kabul beklenir, F05 açık ve F06 yetkisizdir.
Canlı iş akışını elle çalıştırma, secret veya deployment değişikliği yapılmadı.

F05 repository düzeltmesinin 425 test/typecheck/build CI sonucu geçti; ürün
sahibi PR #107 merge'ünü ve kapanışı kabul etti. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F05_CLOSURE_2026-10-18.json`.
Güncel F01–F05 kapalıdır; sıradaki F06 başlamadı ve uygulama yetkisi yoktur.
Genel A6-TECH-01 PASS değildir; EO-05 engeli korunur.

F06 sunucu hata kayıt aracı repository'de hazırlandı. Kanıt:
`docs/evidence/A6_TECH_01_F06_SAFE_ERROR_LOG_2026-10-18.json`.
Ham hata nesnesi loglanmaz; sabit kod/aşama ve izinli yol/metot kaydedilir.
CI/merge ve ayrı açık onaylı canlı deploy/doğrulama beklenir; F06 açık kalır.
Bu hazırlık canlı düzeltme kanıtı veya F07 başlangıç yetkisi değildir.

F06 düzeltmesi PR #108 ile birleştirilip ayrı açık onayla mevcut Production
adresine alındı. Birebir kaynak/alias READY doğrulandı; ürün sahibi gerçek Shopify
Admin masaüstü ve mobil normal çalışmayı kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json`.
Kapanış kaydının birleştirme onayı beklenir; F07 başlamadı, EO-05 engeli korunur.

F07 mevcut Production'ın F06'da onaylı birebir `main` commit'inden deploy edildiğini
yeniden doğruladı. Güncel main'e göre yalnız altı F06 kapanış dosyası farklı;
diğer 371 kaynak girdisi eşleşir. Kanıt:
`docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json`.
Yeni deploy/secret/yapılandırma/veritabanı işlemi yok. CI ve ürün sahibi kabulü beklenir;
F07 henüz kapanmadı, F08 başlamadı ve EO-05 engeli korunur.

F07 kaynak geçmişi doğrulaması 434 test/typecheck/build CI kapısından geçti;
ürün sahibi kapanışı ve PR #110 merge'ünü kabul etti. Yeni deploy gerekmedi
ve yapılmadı. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F07_CLOSURE_2026-10-18.json`.
Güncel F01–F07 kapalıdır; F08 başlamadı/yetkili değil, EO-05 engeli korunur.

F08 iki özel gizlilik tablosunda `workspace_id` FK indeks hazırlığıdır.
Kanıt `docs/evidence/A6_TECH_01_F08_PRIVACY_INDEXES_2026-10-18.json`.
Yeni migration pending; canlı DDL/DML yapılmadı. Mevcut izole DB workflow'u ile
replay ve sentetik öncesi/sonrası plan kontrolü beklenir. Canlı uygulama ayrı
açık onay, güncel ön kontrol ve işlem sonrası kontrol/Advisor kapısından geçer. F08 açık,
F09 başlamadı; veri/silme kuralı/çalışma zamanı/deploy değişikliği yetkilendirilmedi.

F08 iki indeksi ayrı açık onayla canlıya ekledi; Supabase sürüm
`20261018181906` repository'ye SQL içeriği değişmeden eşlendi. 40 applied / 0
pending; önceki migration hash'leri, veri ve güvenlik sınırları korundu.
Security Advisor 0, eksik FK indeks uyarısı 0. Canlı kanıt:
`docs/evidence/A6_TECH_01_F08_LIVE_ACCEPTANCE_2026-10-18.json`.
Son CI ve açık kapanış/merge kabulü beklenir; F09 başlamadı.

F08 canlı kabul/eşleme sonrası genel CI (437 test/typecheck/build) ve iki izole
40-migration yeniden kurulum geçti. Ürün sahibi kapanışı ve PR #111 merge'ünü kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F08_CLOSURE_2026-10-18.json`.
Güncel F01–F08 kapalı; F09 başlamadı/yetkili değil, genel denetim ve EO-05 kapısı
ayrı kapanış/retest kararı olmadan PASS/başlangıç sayılmaz.

F09 birincil çalışma kopyası temizliği doğrulandı; kullanıcı işi veya ayrışmış commit
yoktu. Birebir uzak `main`e fast-forward yapıldı, commit/tree ve temiz 0/0 durumu
doğrulandı. Kanıt `docs/evidence/A6_TECH_01_F09_CHECKOUT_SYNC_2026-10-18.json`.
CI/kabul ve PR merge sonrası son birincil kopya eşitlemesi beklenir. F10 başlamadı; canlı
uygulama/veritabanı/deploy değişmedi, genel denetim/EO-05 kapısı korunur.

F09 kapanış ve PR #112 birleştirme onayı alındı. Kapanış kanıtı
`docs/evidence/A6_TECH_01_F09_CLOSURE_2026-10-18.json`.
Önceki hazırlık kayıtları tarihseldir; güncel F01–F09 kapalıdır. Son CI,
merge ve birincil çalışma kopyası'un yeni main ile temiz commit/tree eşliği teslim
kapısıdır; son eşlik PR #112 açıklamasında kalıcılaştırılır. F10 başlamaz,
genel denetim PASS veya EO-05 başlangıç yetkisi verilmez.

F10 için ürün sahibi 18 Ekim 2026'da ayrı uyumluluk çalışması bekleyen açık
teknik borç kararını onayladı. Kanıt:
`docs/evidence/A6_TECH_01_F10_DEFERRED_2026-10-18.json`.
F01–F09 kapalı, F10 açık ve tek başına EO-05 engeli değildir. Bu kayıt F10
düzeltmesi/kapanışı, sürüm veya flag değişikliği, genel denetim PASS ya da EO-05
başlangıç yetkisi değildir. Genel yeniden test ve kapanış kararı ayrı kalır.

Son yeniden test `cddda0fad4803c9212412211495365c69ed2e884` üzerinde 441 test,
typecheck/build ve production bağımlılık taramasını geçirdi. Tam bağımlılık
taraması geliştirme/build zincirinde 4 yüksek, 3 orta, 1 düşük güvenlik bildirimi bildirdi.
Kanıt `docs/evidence/A6_TECH_01_FINAL_RETEST_2026-10-18.json`.
`TECH01-RETEST-SEC01` ayrı, ön P2/güvenlik değerlendirme kaydıdır; F01–F10
tarihsel sırası ve kapanışları değiştirilmez. İlk kayıtta etki analizi/düzeltme
yetkili değildi; sonraki dar onaylar aşağıdadır. Genel denetim PASS, A6-DOCS-01 ve EO-05 başlangıcı verilmez;
bu kayıt yeni altyapı, yedek, sürüm, sağlayıcı veya canlı ortam işi açmaz.

Kullanıcı yalnız Vite `7.3.1 → 7.3.5` güvenlik düzeltmesine açık onay verdi.
Paket kayıt dosyası ve lockfile eşlendi; diğer paket sürümleri aynı kaldı. Vite'nin beş
uyarısı yeni taramada kalktı; kalan 1 yüksek/1 orta/1 düşük güvenlik bildirimi açıktır.
Kanıt `docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json`.
Bu ilk düzeltme PR #115 ile birleştirildi. Tarihsel kanıt değiştirilmez.

Ürün sahibi ardından kalan üç uyarı için kontrollü repository denemesini onayladı:
Vite `7.3.6`, yalnız Vite altında esbuild `0.28.1`, yalnız Vercel config
zincirinde Ajv `8.18.0` ve ts-morph `24.0.0`. Sonuncusu sağlayıcının sürüm sabitlemesi dışında
major geçiştir; gerçek config okuma, doğrulama ve kod paketi kimliği test edilir.
Yeni production ve tam bağımlılık taramaları sıfır güvenlik bildirimi döndürdü; braces
zincirden kaldırıldı, uyarılar gizlenmedi. Kanıt:
`docs/evidence/A6_TECH_01_REMAINING_SECURITY_REMEDIATION_2026-10-18.json`.
CI ve açık birleştirme/kapanış kabulü beklenir. Canlı deploy/sağlayıcı/veritabanı/secret
değişikliği, F10 kapanışı, genel PASS veya EO-05 başlangıcı yetkisi yoktur.

Ürün sahibi PR #116 merge onayını ve ardından güvenlik kapanış kaydının
işlenmesini kabul etti. Düzeltme `aa32e03b57f84b7b5a950a9c9be67826135c2536`
ile main'e alındı; merge tree test edilen kaynak ağacı ile birebir aynı.
GitHub CI'da 449 test, frozen-lockfile kurulumu, typecheck ve build PASS.
`TECH01-RETEST-SEC01` yalnız repository güvenlik kapsamıyla kapalıdır; önceki
hazırlık kanıtları tarihseldir ve değiştirilmez. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_SECURITY_CLOSURE_2026-10-18.json`.
Genel audit için GitHub aktif koruma kuralı kanıtı, eksik Meta doküman teyidi ve
ayrı onaylı güncel release/canlı kabulü kalır. Bilinen Free Plan recovery sınırı
yeni yedek işi açmaz. F10 açık ertelemedir; genel PASS, A6-DOCS-01 ve EO-05
başlangıcı verilmez. Bu kayıt canlı işlem yetkisi değildir.

### A6-TECH-01 ek kanıt — 18 Ekim 2026

Ürün sahibinin oluşturduğu `main-protection` ruleset'i Connector ile okundu:
aktif, yalnız `main`, bypass boş; PR, GitHub Actions `governance`, silme ve
force-push koruması mevcut. Meta rate-limit ve error-handling metinleri ürün
sahibi tarafından resmî sayfalardan paylaşıldı ve incelendi; agent'ın HTTP 429
erişimi giderilmiş veya gerçek hesap testi yapılmış sayılmaz.

Karşılaştırmada iki dar eksik görüldü ve ürün sahibi repository düzeltmesini
onayladı: izin reddi token geçersizliği değildir; `80000/80004` BUC kota sınıfıdır.
Kod/test hazırlığı tek kanıt PR'ında teslim edilir. Kaynak ve kapsam:
`docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json`.
CI, kabul ve birleştirme beklenir. Sonrasında yalnız ayrı onaylı birebir release/canlı
kabulü ve genel kapanış kararı kalır. F10 ertelemesi korunur; yeni yedek işi,
genel PASS, A6-DOCS-01 veya EO-05 başlangıç yetkisi yoktur.

### A6-DOCS-01 başlangıcı — 19 Ekim 2026

Ürün sahibi Türkçe dokümantasyon standardizasyonuna başlanmasını onayladı.
63 Markdown dosyası envantere alındı: 62 insan-okuyucu belge ve değiştirilmeden
korunan `AGENTS.md`. Çalışma sözleşmesi:
`contracts/a6-docs-01-turkish-standardization-v1.json`.
İlk geçiş README ile EO-01/02/03 analiz kitaplarının dilidir; kabul edilmiş
semantik, tarihler, kimlikler ve makine bölüm eşlemeleri korunur. Diğer belgeler
bekleyen durumdadır; paket henüz tamamlanmadı ve EO-05 başlamaz.

19 Ekim 2026'da ilk dört belgenin okunabilirlik ve merge kabulü verildi;
ürün sahibi PR #120'yi merge etti. Merge commit'i
`57d18a1a125de30ca8d86a65034f60fce403dc74`, test edilen kaynakla aynı
`7bdc1e9a28f5be5cbb6f02071555bb9378dd26a0` ağacını taşır.
İkinci dil geçişi EO-01-A/B/C ile EO-02-A/B ve kurulu mağaza yetkisi düzeltmesinin
altı belgesidir. Bunlar okunabilirlik kabulü bekler; diğer 52 belge dil incelemesi
bekler. Uygulama kodu, tarihsel kanıtlar ve canlı ortam değişmez; paket kapanmaz.

Aynı gün ikinci teslimin altı belgesi de ürün sahibi tarafından kabul edildi;
PR #121 onaylı kaynakla aynı ağaç korunarak birleştirildi. Merge commit'i
`039087456127cd0d936049e75603ed52a2bbb7c4`.
Üçüncü dil geçişi EO-02-C faturalandırma ve oturum köprüsü, EO-02-D gizlilik ve
kalıcı işçi belgeleri ile EO-02-C canlı kabul kılavuzudur. Güncel toplam:
10 kabul edilmiş, 5 okunabilirlik kabulü bekleyen, 47 dil incelemesi bekleyen belge.
Önceki ara sayımlar tarihseldir. Bu geçiş eski kabul akışını yeniden yürütmez;
yeni token, gizli bilgi, sorgu, silme, migration veya dağıtım yetkisi üretmez.
EO-05 kapalıdır ve A6-DOCS-01 henüz tamamlanmamıştır.

Üçüncü teslimin beş belgesi de aynı gün açık ürün sahibi kabulüyle PR #122'de
birleştirildi. Merge commit'i `0e8f03ddd1526cc53b8e5e2922211301d512ffef`;
test edilen kaynak ağacı korunmuştur. Dördüncü dil geçişi EO-03-A/B/C/D'nin
OAuth işlemi, token kasası, hesap yetkisi ve bağlantı yaşam döngüsü belgeleridir.
Güncel toplam: 15 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 43 dil incelemesi
bekleyen belge. Önceki sayımlar ara kayıttır. Tarihsel kabul/denemeler yeniden
yürütülmez; kod, canlı ortam ve EO-05 yetki sınırı değişmez.

Dördüncü teslim PR #123, açık ürün sahibi okunabilirlik/merge kabulüyle
`a9d03046d3b0fb8561c366fb398e8a1ef4d950d3` commit'inde birleştirildi;
test edilen ağaç korundu. Beşinci dil geçişi ortak adaptör sözleşmesi ile Meta
OAuth/hesap seçimi, App Role hazırlığı ve raporlama çalışma zamanının dört belgesidir.
Güncel toplam: 19 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 39 dil incelemesi
bekleyen belge. Meta'nın 13 Ekim tarihsel 403 notu 18 Ekim'de onaylanan dar
düzeltmeye yönlendirilir; eski kanıt değiştirilmez, yeni hata kuralı oluşturulmaz.
Paket kapanmaz; uygulama kodu, canlı ortam ve EO-05 yetkisi değişmez.

Beşinci teslim PR #124 açık ürün sahibi kabulüyle
`1581f749e1fcfbf0ad69cf3bc9f3592d5a719db6` commit'inde birleştirildi;
test edilen ağaç korundu. Altıncı dil geçişi Google raporlama çalışma zamanı,
canlı kanıt tetikleyicisi, OAuth düzeltici kuruluşu ve 2026 erişim/review kararıdır.
Güncel toplam: 23 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 35 dil incelemesi
bekleyen belge. Tam gün tarihsel PMax kanıtı, test/Production ayrımı ve review
sonrası aynı çalışma zamanı kararı korunur. Önceki sayımlar tarihseldir;
yeni sağlayıcı çağrısı, erişim başvurusu veya kod/canlı ortam değişikliği yoktur.

Altıncı teslim PR #125 açık ürün sahibi okunabilirlik/merge kabulüyle
`77ac39cfb9cf373c6595b6b7dfe6df5927140457` commit'inde birleştirildi;
test edilen ağaç korundu. Yedinci dil geçişi Klaviyo bağlantı/tahmini harcama,
OAuth güçlendirme, raporlama yetkisi ve satış kaynağı çözümlemesinin dört belgesidir.
Güncel toplam: 27 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 31 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. Aynı-gün ayrı harcama olayları,
istekten önce kalıcı token yenileme ve Message biliniyorsa Channel'ı koruma
kuralları değişmez. Kod, tarihsel kanıtlar ve canlı ortam değiştirilmez;
A6-DOCS-01 kapanmaz, EO-05 başlamaz.

Yedinci teslim PR #126 açık ürün sahibi okunabilirlik/merge kabulüyle
`bfc0de411fa89b5d029952d8399c5fd1be8ca5a9` commit'inde birleştirildi;
test edilen ağaç korundu. Sekizinci dil geçişi Klaviyo raporlama çalışma zamanı,
yeniden yetkilendirme, geçici canlı kanıt ve resmî kabiliyet kaydının dört belgesidir.
Güncel toplam: 31 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 27 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. Audience sağlayıcı ara katmanıdır;
AdsTable Channel/satış bölme boyutu değildir. Eski merge/Advisor durumları
bugünün açık işleri sayılmaz. Gerçek Shopify entegrasyonu kanıtı ve EO-05 eksik
günleri tamamlama işi açık kalır; yeni kod, canlı çağrı veya örnek veri üretimi yoktur.
A6-DOCS-01 kapanmaz; EO-05 başlamaz.

Sekizinci teslim PR #127 açık ürün sahibi okunabilirlik/merge kabulüyle
`f9780f87eaf29f20ed5520ae47e9b6426f77fa89` commit'inde birleştirildi;
test edilen ağaç korundu. Dokuzuncu dil geçişi EO-04 analiz kitabı, ortak
Channel/ürün ekonomisi ve geçici sağlayıcı canlı kabul brief'inin üç belgesidir.
Güncel toplam: 35 kabul edilmiş, 3 okunabilirlik kabulü bekleyen, 24 dil incelemesi
bekleyen belge. Önceki sayımlar tarihseldir. On sekiz senaryo aynı ürün, tarih,
Channel ve Sales Role sonucunu korur; kart alanları Türkçeleştirilir. Meta'nın
16 Ekim tek-sayfa anlatımı sonraki tam sayfalama kabulünü geri almaz. Yanıt ile
dar sunucu logu ayrı kalır. Yeni kod/canlı işlem yok; paket kapanmaz, EO-05 başlamaz.

Dokuzuncu teslim PR #128 açık ürün sahibi okunabilirlik/merge kabulüyle
`eaca2c5376dc0cf0b25322f9a0eac7c6aa8719e9` commit'inde birleştirildi;
test edilen ağaç korundu. Onuncu dil geçişi Meta ve Google tarihsel Channel
araştırma taslaklarının iki belgesidir. Güncel toplam: 38 kabul edilmiş,
2 okunabilirlik kabulü bekleyen, 22 dil incelemesi bekleyen belge.
Eski Google geniş-ağaç varsayımı tarihsel tutulup tek uygun All products ve
tam iş günü kanıtı hakkındaki kabul edilmiş sözleşmeye yönlendirilir; eski
varsayım bugünkü kural diye sunulmaz. Meta katalog yanıtı ve kanonik tıklama
eşlemesi tamamlanmış sayılmaz. Yeni kod/canlı işlem yok; paket kapanmaz, EO-05 başlamaz.

Onuncu teslim PR #129 açık ürün sahibi okunabilirlik/merge kabulüyle
`ec641ea9ea19e330716a503865beaccb924ff2d8` commit'inde birleştirildi;
test edilen ağaç korundu. On birinci dil geçişi F1/F2 yetki kaynağı/canlı veri/
fiziksel proje sınırı ve F3 kod/bağımlılık taşıma kararının iki belgesidir.
Güncel toplam: 40 kabul edilmiş, 2 okunabilirlik kabulü bekleyen,
20 dil incelemesi bekleyen belge. 4 Ekim eski proje envanteri bugünkü durum
değildir; taşıma adayları kesin onay sayılmaz. F3'ün ilk taslak paket eşlemesi
tarihsel olarak korunup güncel Execution Plan sırasına yönlendirilir.
Yeni kod, canlı işlem veya kaynak oluşturma yetkisi yoktur; EO-05 başlamaz.

On birinci teslim PR #130 açık ürün sahibi okunabilirlik/merge kabulüyle
`f0fa17301ad22dc0725a9ff1f313cbdf6d2d3c01` commit'inde birleştirildi;
test edilen ağaç korundu. On ikinci dil geçişi F4 veri taşıma, F5 ürün/rota,
F6 efor/risk ve F7 GO kararının dört belgesidir. Güncel toplam: 42 kabul edilmiş,
4 okunabilirlik kabulü bekleyen, 16 dil incelemesi bekleyen belge.
F4'ün eski “14” özeti tarihsel sayım farkı olarak ayrılıp kabul edilmiş 10 satırlık
listeye yönlendirilir; rota/şema taslakları bugünkü uygulama envanteri değildir.
Süre tahminleri 4 Ekim başlangıç planıdır; GO bugün yeni canlı yetki oluşturmaz.
Kod, canlı ortam ve kabul edilmiş kararlar değişmez; EO-05 başlamaz.

On ikinci teslim PR #131 açık ürün sahibi okunabilirlik/merge kabulüyle
`52335cc6fbcecde15f664beae591264e234c1909` commit'inde birleştirildi;
test edilen ağaç korundu. 46 belge kabul edilmiş, 16 belge dil incelemesi bekler.
Sonraki envanter kontrolünde ana tablo belgesinde bozuk UTF-8 bulundu; ürün
sahibi 19 Ekim 2026'da dar metin onarımını onayladı. Son sağlam tarihsel gövde
`6e95ba9c7134d56e6cf11eba03be149c502e9672` kaynağından doğrulanarak geri getirildi;
yalnız satır sonu boşlukları temizlendi ve güncel yetki notu eklendi.
Bozuk kayıttaki sonraki metin tahminle yeniden oluşturulmadı. Onarım kaydı
`contracts/a6-docs-01-turkish-standardization-v1.json` içindedir. Bu iş Türkçe
çevirinin tamamlandığı sayılmaz; sayım değişmez, EO-05 açılmaz. Yeni metin
bütünlüğü kontrolü 62 insan-okuyucu Markdown dosyasında geçersiz UTF-8,
yerine-geçme karakteri ve ikili kontrol karakterini reddeder. CI ve ürün sahibi
onarım/merge kabulü beklenir; uygulama kodu ve canlı ortam değişmedi.

Ana tablo metin bütünlüğü onarımı PR #132, açık ürün sahibi onayıyla
`526c07a5415b70a21a6ddf20970e6207a33f0200` commit'inde birleştirildi;
test edilen ağaç korundu. Onarım çeviri sayısını artırmadı. On üçüncü dil
geçişi üç yüzeyli ürün tasarımı, Funnel görselleştirme referansı ve demo/dışa
aktarma/dev store sınırının üç belgesidir. Güncel toplam: 46 kabul edilmiş,
3 okunabilirlik kabulü bekleyen, 13 dil incelemesi bekleyen belge.
Ürün niyeti ile uygulama/görsel kabul ayrılır; ekran metinleri ve teknik kimlikler
korunur. Sentetik demo sağlayıcı kanıtı değildir; veri çıkarma, grafik, dışa
aktarma veya dev store kurulumu başlatılmaz. Ana tablo gövdesi değişmez.
Bu teslim kod/canlı ortam değişikliği veya EO-05 başlangıcı değildir.

On üçüncü dil teslimi PR #133 açık ürün sahibi onayıyla
`164175d47420dc37f551860658c8ec44b8916092` commit'inde birleştirildi;
test edilen ağaç korundu. On dördüncü teslim güvenlik/kapasite, secret
envanteri/kurtarma ve iki bağımsız operasyon planının dört belgesidir.
Güncel toplam: 49 kabul edilmiş, 4 okunabilirlik kabulü bekleyen, 9 dil
incelemesi bekleyen belge. Önceki sayımlar tarihseldir. Kapasite ve kurtarma
değerleri hedef olarak korunur; F03 envanter eşliği kurtarma hazırlığı sayılmaz.
İlk sağlayıcı hatasında durma, ayrı onaylı temizlik ve izole ortam kurulum
kapıları değişmez. Secret değeri okunmaz; yedek, kasa, rotasyon, temizlik,
kurulum veya canlı işlem başlatılmaz. Ana tablo gövdesi değişmez; EO-05 kapalıdır.

On dördüncü dil teslimi PR #134 açık ürün sahibi onayıyla
`93756a705ac84c5bb0a16e0fb08b18fb45b4158e` commit'inde birleştirildi;
test edilen ağaç korundu. On beşinci teslim TECH-01 denetimi ve F01-A/B/C
geçmişinin dört belgesidir. Güncel toplam: 53 kabul edilmiş, 4 okunabilirlik
kabulü bekleyen, 5 dil incelemesi bekleyen belge. Önceki sayımlar tarihseldir.
İlk bulgular ve başarısız provalar son kapanıştan ayrılır. F01'in dar kurtarma
kabulü tam veri yedeği/PITR sayılmaz; F10 açık ertelemedir. SQL, migration,
araç, workflow ve değişmez kanıtlar değiştirilmez; yeni denetim/prova/yedek veya
canlı işlem başlatılmaz. Ana tablo gövdesi korunur; DOCS bitmez, EO-05 açılmaz.

On beşinci dil teslimi PR #135 açık ürün sahibi kabulüyle
`38c3da3c2272320b58247497de7c099c0c9f36bf` commit'inde birleştirildi;
test edilen ağaç korundu. On altıncı teslim Shopify UI anayasası ve görev
şablonudur. Güncel toplam: 57 kabul edilmiş, 2 okunabilirlik kabulü bekleyen,
3 dil incelemesi bekleyen belge. Önceki sayımlar tarihseldir. Eski R7-B6 kaydı
bugünkü Settings kusuru veya yeni kabul sayılmaz. RC/type eşleşmesi, gerçek
masaüstü/mobil kabulü ve dar grafik çizim istisnası korunur. UI kodu ve
yürütülebilir anayasa sözleşmesi değişmez. Ana tablo metin onarımı kanıtı
korunur; DOCS kapanışı, EO-05 veya yeni görsel uygulama yetkisi verilmez.

PR #136 açık ürün sahibi onayıyla `ed47adf7bc19a9206b1baebda995838021ad3585`
commit'inde birleştirildi; test edilen ağaç korundu. Son dil teslimi Execution
Plan, ana paket tablosu ve kalite kapılarıdır. 59 belge kabul edilmiş, bu son
3 belge okunabilirlik ve paket kapanış kabulünü bekler; çevrilmemiş belge sıfırdır.
Önceki ara sayımlar tarihseldir. Ana tablonun onarılmış özgün gövdesi
`docs/evidence/A6_DOCS_01_MASTER_RESTORED_SOURCE_2026-10-19.txt` içinde önceki
hash'iyle korunur. Çeviri onarım kanıtını veya iş kararlarını değiştirmez.
Son kabul/merge, tüm repository kontrolleri ve uzak içerik doğrulaması kapanış
kapısıdır. EO-05, review, yedekleme veya canlı işlem otomatik başlamaz.

## EO-05 ilk zorunlu kapısı — tarihsel PMax listing-tree kanıtı

**20 Ekim kararıyla durduruldu; PASS değildir.** Bu bölüm önceki gereksinimi
korur, bağımsız zamanlayıcı veya Dataset V2 çalışmasını durdurmaz. Yeniden çalışma
için ürün sahibinin açık onayı gerekir. Kanıta bağlı tarihsel kesin PMax Channel
özelliği bu erteleme ile kabul edilmiş veya etkinleştirilebilir sayılmaz:

1. Her kayıt doğrulanmış Reporting Account saat dilimi, Campaign/Asset Group kimliği, tam listing-tree satırları, kaynak sürümü/hash'i, `valid_from`, `valid_to`, gözlem zamanı ve sorgu kaynak geçmişini taşır.
2. Kesin tarihsel Asset Group yalnız kayıt satışın tüm sağlayıcı iş günü penceresini kapsıyor ve reklamı yapılan/tıklanan ürün için tam bir uygun Asset Group kanıtlıysa üretilebilir.
3. Eksik/kısmi pencere, gün içi ağaç değişimi, çelişkili sürüm/hash veya birden çok uygun grup satış ve Sales Role'u korur; yalnız Channel `Unclassified Channel` kalır. Satılan ürün Channel seçemez.
4. Bugünkü ağaç geçmiş tarih kaydı veya kesin Channel üretemez. Toplama öncesi günler sağlayıcıdan o güne ait kesin tarihsel kanıt gelmedikçe tahminle doldurulamaz.
5. Zamanlayıcı kaydı, değişmez/sürümlü saklama, saklama süresi, boşluk tespiti, uzlaştırma ve çözümleyiciye tarih eşleşmeli kanıt teslimi birlikte kabul edilmeden kapı PASS değildir.

## Ana paket analiz–tasarım kitabı kapanış kapısı — 9 Ekim 2026

Bağlayıcı sözleşme: `contracts/a6-parent-package-analysis-design-closure-v1.json`
CI kontrolü: `tests/a6-parent-analysis-design-books.test.js`

- `Done` veya `Accepted` durumundaki her ana paket, teknik olmayan bir okuyucunun iş akışını anlayabileceği kabul edilmiş bir analiz–tasarım kitabı taşır.
- EO-01: `docs/EO_01_ANALYSIS_DESIGN_BOOK.md`
- EO-02: `docs/EO_02_ANALYSIS_DESIGN_BOOK.md`
- EO-03: `docs/EO_03_ANALYSIS_DESIGN_BOOK.md`
- EO-04 ve sonraki ana paketler kendi kitapları oluşmadan kapatılamaz; eksik dosya veya defter kaydı CI'ı düşürür.
- Kitaplar yürütülebilir sözleşme ve testlerin yerine geçmez; onları analist diliyle açıklayan operasyonel kütüphane katmanıdır.

## Secret envanteri, saklama ve kurtarma kapısı — 10 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_SECRET_INVENTORY_AND_RECOVERY.md`
Yürütülebilir sözleşme: `contracts/a6-eo-secret-inventory-recovery-v1.json`
CI kontrolü: `tests/a6-eo-secret-inventory-recovery.test.js`

- 10 Ekim başlangıç kaydı 11 Vercel Production girdisi ve 1 GitHub Actions secret içeriyordu; repository yalnız ad ve prosedür saklar, değer saklamaz. Sonraki F03 kontrolünde toplam 23 ad doğrulandı; güncel ad envanteri ilgili sözleşme ve kanıttadır.
- Vercel/GitHub maskesi beklenen, yalnız yazılabilen saklama davranışıdır; değerin silindiği anlamına gelmez.
- Secret değişikliği için kesin anahtarın ürün sahibi onayı, etki haritası, geri alma, onaylı şifreli kurtarma kasasına kayıt, dağıtım/iş akışı doğrulaması ve değer içermeyen kanıt gerekir.
- Bağımsız kurtarma kopyası var sayılmaz. Kayıp şifreleme anahtarı eski şifreli veriyi çözmek için yeniden üretilemez.
- İlk gerçek sağlayıcı yetkilendirmesinden önce token anahtarı kurtarma kapısı ve sağlayıcıya özel envanter genişletmesi geçmelidir.
- Production kimlik bilgileri Preview veya Development'a kopyalanmaz; bu ortamların kimlik bilgileri ayrıdır.
- Bu karar secret, sağlayıcı, veritabanı, ortam veya dağıtım değişikliğine izin vermez.

## Paketler arası güvenlik, kapasite ve taşınabilirlik kararı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_CROSS_CUTTING_SAFETY_CAPACITY_FREEZE.md`
Yürütülebilir sözleşme: `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

- Saatlik yenileme zamana yayılır ve bugün+dün ile sınırlıdır. Sağlayıcıya özel kapsamlı uzlaştırma 24 saatte bir çalışır; verinin doğru kesinleşmesini yönetir.
- Summary/Table özel aralığı 90, Daily 31 günle sınırlıdır. Karşılaştırma eşit uzunlukta, çakışmayan dönemleri kurulu Shopify mağazasının saat diliminde kullanır.
- Canlı kabul hedefleri: Kritik DB RPO ≤15 dakika, Dataset V2 RPO ≤60 dakika, kısıtlı hizmet RTO ≤60 dakika, tam hizmet RTO ≤240 dakika. Bunlar tamamlanmış kurtarma kanıtı değildir.
- Supabase kapasitesi çalışma alanı sayısından tahmin edilmez, ölçülür. Hedef 2,000 doğrulanmış aktif çalışma alanı; kanıtı 4,000 çalışma alanlı stres testi ve en az %30 boş kapasitedir.
- Zorunlu test sırası: EO-05 öncesi iş yükü bütçesi ve indeks/sorgu planı başlangıç ölçümü; EO-05 içinde 2,000 çalışma alanlı saatlik zamanlayıcı, 4,000 çalışma alanlı sıkıştırılmış stres ve 24 saatlik 2,000 çalışma alanlı dayanıklılık; EO-06 içinde Summary/Daily/Compare/Table sorgu ölçümü, dışa aktarma çıkmadan yük testi; EO-08 içinde canlıya benzer geri yükleme/yük provası.
- Öncelik ölçülmüş PostgreSQL/Supabase ölçeklemesidir; platform taşıması arıza sırasında doğaçlama çözüm değildir.
- Dışa aktarma ilk review kapsamı dışındadır; eklendiğinde asenkron ve etkileşimli sorgu havuzundan ayrı olacaktır.
- Bu karar paket durumunu değiştirmez veya canlı altyapı değişikliği başlatmaz.

## Demo test verisi, dışa aktarma referansı ve Shopify geliştirme mağazası sınırı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_DEMO_FIXTURE_EXPORT_REFERENCE.md`
Yürütülebilir sözleşme: `contracts/a6-eo-demo-fixture-export-reference-v1.json`

- Eski dashboard HTML'i yalnız referans ve sentetik test verisi ham maddesidir; HTML/JavaScript yeni çalışma zamanına kopyalanmaz.
- 1,000 satır ve 50 günlük sentetik veri; temiz Dataset V2 test verisi, UI kabul girdisi, Shopify geliştirme mağazası demosu ve belirlenimci kapasite üreticisi tohumu olarak EO-05/06/07/08'e yönlendirilir.
- Supabase kapasite koşuları ham HTML'i çalıştırmaz; yalnız standartlaştırılmış belirlenimci üretici tohumunu kullanır.
- Her satır sentetik ve sağlayıcı gerçeği değil olarak işaretlenir. Sağlayıcı kabiliyeti, doğal attribution, kesinleşme, gerçek sıfır, ürün ilişkilendirmesi veya Cross-sell kanıtlayamaz.
- Dışa aktarma davranışı yalnız review sonrası referanstır; uygulaması ilk review kapsamı dışındadır.
- Ayrı Shopify geliştirme mağazası/çalışma alanı ileride sahte sağlayıcı bağlantısı göstermeden gömülü arayüzü sergileyebilir.
- Kaynak test verisi ürün/Cross-sell kabulüne yeterli değildir; EO-07-C'nin ayrı canlı kanıt kapısı korunur.
- Bu karar paket durumunu değiştirmez; mağaza, sağlayıcı, canlı ortam veya veritabanı değişikliğine izin vermez.

## A6-EO-07 üç yüzeyli arayüz ürün kararı — 7 Ekim 2026

Bağlayıcı analist özeti: `docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md`
Yürütülebilir sözleşme: `contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json`

- Funnel App Home, Ad Analysis ve Settings tablo/kontrol/iş akışı davranışları donduruldu; EO-07 ilerlemedi, UI uygulaması yetkilendirilmedi.
- İlk kayıtta Funnel bağlamsal dashboard'u ürün sahibinin ilişki grafiği referansını bekliyordu; ilgisiz klasik grafik varsayımı yasaktı. Sonraki kabul aşağıdaki grafik referansı kaydındadır.
- Ad Analysis grafikleri; EO-07-C en alt analiz seviyesini ve iki ayrı küpe/Cross-sell senaryosunu Meta, Google Ads ve Klaviyo için doğrulayana kadar kapalıdır.
- Settings'te grafik yüzeyi yoktur.
- Çalışan eski Settings akışı yalnız etkileşim kanıtıdır; eski kaynak kod, stil ve emekli sağlayıcı arayüzü kopyalanmaz.

## Kabul edilmiş temel: EO-02

- **EO-01-A — Accepted:** Fork veya toplu kopyalama olmadan ayrı temiz repository ve fiziksel sınır kuruldu. Kabul commit'i: `cb02ef7c2e9236ab50da792f21d667fae91cbccd`.
- **EO-01-B — Accepted:** Güncel resmî Shopify teknoloji yığını, temiz bağımlılık tanımı/lockfile ve negatif CI kapıları birleştirildi. Kabul commit'i: `111e7dec66c84c48be43930f3496ea5b0f918949`.
- **EO-01-C — Accepted:** Polaris 2.0 RC üç yollu veri iddiası taşımayan Preview kabuğu ürün sahibi tarafından görsel olarak kabul edildi ve birleştirildi. Kabul commit'i: `76ea38a474c701d69871f73ba713376e3a7d623e`.
- **EO-02-A — Accepted:** Ayrı Frankfurt Supabase projesinde özel şema, sahip/migration yöneticisi/çalışma zamanı rol sınırı ve temiz migration zinciri canlı olarak doğrulandı; PR #4 merge commit'i: `2ac00f969eb35ac632ead57017753ed495e7b66f`.
- **EO-02-B — Accepted:** Çalışma alanı, kurulum ve nesil otoritesi migration zinciri canlı Supabase'de PASS oldu; kendini temizleyen ilk yükleme/güvenli tekrar/eski kayıt/alan adı değişimi kontrolü sonrası iş satırı sıfır, Security ve Performance Advisor temizdir. PR #6 merge commit'i: `edc9e21588f5a32bea139b754ea0108c9809cf27`.
- **EO-02-C — Accepted:** Shopify App Pricing + Partner API otorite modeli, zorunlu RLS korumalı abonelik izdüşümü ve Supabase kontrolü hazırdı. 8 Ekim 2026'da App Store kaydı, Production Vercel Partner secret/dağıtım ve `activeSubscription` null/trial/active sağlayıcı kabulü PASS oldu. Deneme, herkese açık `AdsTable Monthly` planında etkin fiyat `USD 0.0` ve `price.active=false`; aktif durum, hedef mağazaya açılan özel `shopify-test` planında `trialEndsAt=null`, geçerli faturalandırma dönemi, etkin fiyat `USD 0.0` ve `price.active=true` döndürdü. Fiyat-sürümü üst veri düzeltmesi PR #18 ile birleştirilip Production'a alındı. Tarayıcı/yanıt/uygulama/platform log sızıntı kontrolleri PASS oldu. PR #23 ile Supabase Root CA doğrulamalı transaction-pooler TLS Production'a alındı; Shopify Admin masaüstü ilk yükleme ve tam sayfa yeniden yükleme PASS oldu. Canlı veritabanı bir çalışma alanı, nesil-1 aktif kurulum, yalnız şifreli çalışma zamanı oturumu, aktif abonelik izdüşümü ve aktif kullanım hakkı taşır. 9 Ekim 2026'da kullanım hakkının seçilebilir mağaza üst verisi taşımasının yanlış olduğu saptandı; aktif model kurulu Shopify mağazasına kilitlendi. Ayrı açık ürün sahibi onayıyla düzeltici migration canlı Supabase'e uygulandı; eski üç üst veri kolonu kaldırıldı, mevcut kullanım hakkı satırı korundu, yalnız fonksiyon çalıştırma çalışma zamanı sınırı ve sıfır Security Advisor bulgusu doğrulandı. Gerçek mobil Shopify uygulamasında Funnel, Ad Analysis, Settings ve tam uygulama kapatıp yeniden açma kabulü PASS oldu; canlı izdüşüm sayıları tutarlı ve kontrol edilen Vercel çalışma zamanı penceresi hatasız kaldı. Teknik canlı kabul kapılarının tamamı PASS oldu. Eski kayıt reddi önceki canlı veritabanı kabul kanıtından bağlandı; ürün sahibi 8 Ekim 2026'da açık kapanış kabulünü verdi. Teknik açık kalem sıfırdır.
- **EO-02-D — Accepted:** Gizlilik/kaldırma/silme/temiz kurulum girişi, özel zorunlu-RLS kuyruk/envanter modeli, birebir Shopify yapılandırması ve dağıtılmış geçersiz-HMAC 401 kabulü PASS oldu. 9 Ekim 2026'da Supabase Cron işçisi ve PostgreSQL koşullu ifade düzeltmesi canlıya uygulandı. 08:00 UTC doğal Cron koşusu sentetik `customer_data_request` çalışmasını tek denemede `completed/no_customer_data` manifestiyle tamamladı; yeniden işleme sıfır iş seçti, uygulama çalışma zamanı işçiyi ve fiziksel silme yürütücüsünü çalıştıramıyor, Security Advisor sıfır ve sentetik temizliği sıfır kalan kayıtla PASS oldu. Kalıcı kanıt `docs/evidence/EO_02D_DURABLE_WORKER_LIVE_2026-10-09.json` dosyasındadır. Ürün sahibi 9 Ekim 2026'da açık kapanış kabulünü verdi; teknik açık kalem sıfırdır.

EO-02-A iş tablosu veya veri kurmaz, çalışma zamanı kimlik bilgisini etkinleştirmez, canlı token/veri taşımaz, Vercel ortamını değiştirmez ve eski Supabase projesine dokunmaz.

## EO-04-A ortak adaptör başlangıç özeti — 10 Ekim 2026 (tarihsel)

Bağlayıcı analist özeti: `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md`
Yürütülebilir başlangıç sözleşmesi: `contracts/eo-04a-common-adapter-start-brief-v1.json`
CI kontrolü: `tests/eo-04a-common-adapter-start-brief.test.js`

- O aşamada EO-04 yalnız EO-04-A başlangıç özeti kapısında aktifti; ortak adaptör uygulaması başlamamıştı.
- Kurulu Shopify mağazası değiştirilemez ticaret otoritesidir. Sağlayıcı hesabı, alan adı, pixel, URL, UTM, click ID veya Campaign adı çalışma alanı/mağaza kapsamı oluşturamaz veya değiştiremez.
- Yalnız sağlayıcının açık sayısal sıfırı sıfır olur. Boş, eksik, desteklenmeyen, izni reddedilmiş, belirsiz, geçici, kısmi ve başarısız ayrı kalır.
- Kanonik Funnel talebi on ham gerçektir: Gösterim, reklam tıklaması, oturum, harcama, ATC adet/değer, checkout adet/değer ve purchase adet/değer. Sağlayıcının alan adı sözleşmeyi değiştiremez.
- Meta/Google Ads bir ila üç doğrulanmış reklamveren hesabına izin verir. Google Manager/MCC yalnız erişim yoludur; Reporting Account veya Funnel varlığı seçilemez. Klaviyo tam bir doğrulanmış hesaba bağlanır; Ad Account diye adlandırılmaz.
- Başlangıç özeti OAuth'tan ilk veriye birebir 17 adımı kaydeder. İlk yükleme önce dün, sonra bugündür; saatlik yenileme/uzlaştırma EO-05'e aittir.
- Sayfalama opak, sınırlı, güvenle tekrarlanabilir ve yayından önce tamdır; eksik sayfa tam sonuç olamaz.
- İlk taslağın tekrar denemesi yalnız belgelenmiş geçici sınıflarla sınırlıydı; kota kurtarma bilgisi tahminî gecikmeden önceliklidir. Bu tasarım ilk sağlayıcı hatasında durma ve yeni onay kapısını aşmaz.
- Ham kanıt özel, sınırlı, temizlenmiş ve içerik hash'li tutulur; token, kimlik bilgisi ve profil düzeyi kişisel veri yasaktır.
- EO-04-A sağlayıcı secret'ı veya canlı sağlayıcı/API, veritabanı, Vercel, dağıtım değişikliği oluşturmadı.
- Meta Graph/Login/sürüm/hesap kaynakları 13 Ekim 2026'da yeniden kontrol edildi. Production yapılandırması, dağıtımı ve masaüstü OAuth kabulü ayrı açık yetkiyle geçti. Mobil temiz oturum kabulü o kayıtta denenen kimliğin App Role yetkisi olmaması nedeniyle açıktı; AdsTable kod hatası sayılmadı. Sonraki kabul kayıtları bu ara durumu tamamlar.

## EO-03/EO-04 kapanışı ve o andaki sonraki kapı TECH-01 — tarihsel

- **EO-03-A — Accepted:** Çalışma alanı/kurulum nesline bağlı OAuth durum makinesi, birebir dönüş izin listesi, tek kullanımlık state sahiplenme ve canlı özel veritabanı sınırı repository, veritabanı ve ürün sahibi kapılarından geçti.
- **EO-03-B — Accepted:** Sürümlü AES-256-GCM şifreli token kaydı, yalnız şifreli veri kasası, canlı özel veritabanı sınırı, Production başlangıç koruması ve secret içermeyen sentetik kabul geçti.
- **EO-03-C — Accepted:** Güncel sağlayıcı doğrulamalı hesaplar ve tek kanonik Meta/Google Reporting Account, değişmez kurulu Shopify mağazasına bağlıdır. Klaviyo tek Connected Account'tur, Reporting Account kontrolü yoktur. Kullanıcı mağaza kapsamı seçemez.
- Ayrı onayla EO-03-C temel/düzeltici Supabase migration'ları 9 Ekim 2026'da uygulandı. Geri alınan sentetik kabul geçti; kalıntı, Security Advisor ve bu işten kaynaklı eksik FK indeksi sıfırdır. Sağlayıcı API/OAuth, Vercel değişikliği veya Production dağıtımı yapılmadı. Ürün sahibi kapanışı 9 Ekim'de kabul etti; kanıt `docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json`.
- **EO-03-D — Accepted:** Yeniden yetkilendirme, atomik kimlik bilgisi yenileme, iki aşamalı bağlantı kesme ve aynı kanonik kimlikle yeniden bağlanma; tamamen geri alınan canlı yaşam döngüsü senaryosundan geçti. Sentetik kalıntı ve Advisor sıfır; sağlayıcı API/OAuth/Vercel/dağıtım değişikliği yok. Kanıt: `evidence/eo-03d-live-database-evidence-2026-10-09.json`.
- **EO-03 — Accepted:** Dört alt paket açık ürün sahibi kabulüyle kapandı.
- **EO-04 — Accepted (18 Ekim 2026):** Ortak adaptör, üç sağlayıcı çalışma zamanı sınırı, kanonik Channel/Sales Role sözleşmesi ve okunabilir senaryo matrisi kabul edildi. Meta canlı yanıt biçimi, Google test hesabı review kanıtı ve Klaviyo `environment_not_ready` kanıtı sınırlarıyla korunur.
- Bu kapanış Meta App Role gerçek katalog, Google Explorer-or-higher canlı hesap ve Klaviyo Shopify entegrasyonu sonrası gerçek raporlama kanıtını tamamlamaz. Tarihsel PMax listing-tree saklama EO-05'in ilk zorunlu kapısıdır.
- Geçici Settings Meta kanıt butonu kaldırıldı. Google butonu canlı hesap kanıtına, Klaviyo butonu Shopify entegrasyonu kanıtına veya EO-05 zamanlayıcısının bu taşımanın yerini almasına kadar korunur.
- O kapanışta sıradaki zorunlu çalışma `A6-TECH-01` idi; kritik düzeltmeler ve `A6-DOCS-01` tamamlanmadan EO-05 açılamaz. TECH-01'in sonraki genel kabulü üstteki güncel özettedir.

## EO-03-C resmî sağlayıcı dayanağı — 9 Ekim 2026

Shopify kimlik doğrulama/erişim token'ı otoritesi, Meta resmî Marketing API koleksiyonu,
Google Ads erişim modeli ve `ListAccessibleCustomers`, Klaviyo OAuth/Get Account,
Supabase değişiklik/fonksiyon/RLS belgeleri kontrol edildi. Sağlayıcıya özel HTTP keşfi
EO-04'e aittir; EO-03-C yalnız kısa ömürlü doğrulanmış kanıt kabul eder.
Eski, farklı sağlayıcıya ait veya kullanıcı tarafından girilmiş hesap kimliğiyle güvenli biçimde durur.

## 6 Ekim 2026 resmî teknoloji dayanağı — tarihsel

6 Ekim 2026 tarihinde Shopify'ın resmî App Home ve başlangıç şablonu belgeleri kontrol edildi:

- Public App Store sunucu uygulaması geliştiricinin barındırdığı iframe App Home modelini kullanır.
- Temiz başlangıç için resmî React Router şablonu temel alınır.
- App Bridge ve Shopify Polaris web components ürün kabuğunun zorunlu arayüz katmanıdır.
- Ürün sahibinin 6 Ekim 2026 tarihli açık kararıyla aktif referans sürüm `polaris-2.0-rc.js` ve birebir `@shopify/polaris-types@2.0.0-rc.2`'dir; RC riski kabul edilmiştir ve stable 1.x'e otomatik dönüş yapılamaz.

EO-01-B bağımlılık sürümlerini sabitlemeden ve EO-07 UI uygulamasından önce resmî sürümler tekrar doğrulanır.

## 6 Ekim 2026 Supabase başlangıç durumu — tarihsel

6 Ekim 2026 tarihinde Supabase'in resmî API güvenliği, Postgres rolleri, RLS, bağlantı ve kırıcı değişiklik belgeleri kontrol edildi.

- Yeni proje: `podpwkrpmjiksskxhwsu`, Frankfurt, PostgreSQL 17.11 GA.
- Özel şemalar: `app`, `shopify`, `integrations`, `analytics`, `operations`, `privacy`, `billing`.
- Data API rolleri özel şemalara erişemez.
- Çalışma zamanı şema kullanabilir fakat şema oluşturamaz ve henüz hiçbir tablo yetkisi yoktur.
- Çalışma zamanı/migration yöneticisi parolaları NULL'dır; Vercel bağlantısı bu paketin kapsamı değildir.
- Security ve performance advisor bulgusu sıfırdır.

## 8 Ekim 2026 Shopify abonelik dayanağı

8 Ekim 2026 tarihinde Shopify'ın resmî Shopify App Pricing ve Partner API belgeleri yeniden kontrol edildi:

- Yeni public app için desteklenen fiyat modelinde varsayılan otorite Shopify App Pricing'dir; Manual Billing API eski modeldir.
- Plan, fiyat ve 14 günlük trial Shopify tarafında yaşar; AdsTable `appSubscriptionCreate` veya yerel deneme hakkı üretmez.
- Kanonik abonelik okuma modeli Partner API `2026-07` `activeSubscription(appId, shopId)` sorgusudur.
- `price.active` yalnız fiyat sürümünün güncel katalog fiyatı olup olmadığını gösterir; abonelik veya kullanım hakkı aktiflik bayrağı değildir.
- Trial kullanımı Shopify tarafından 180 günlük dönem boyunca izlenir; yeniden kurulum denemeyi sıfırlamaz.
- Shopify App Pricing billing webhook'u göndermez; dönüş, uygulama açılışı ve kullanım hakkı-korumalı işlerde kontrollü Partner API uzlaştırma gerekir.
- Her Shopify uygulama kurulumu yalnız kendi doğrulanmış mağazası için çalışma alanı ve abonelik üretir; ikinci mağaza ayrı installation ve subscription gerektirir.

## A6-EO-07-B Funnel grafik referansı — 7 Ekim 2026

- Ürün sahibinin grafik referansı kabul edildi; `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md` ve `contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json` ile bağlayıcıdır.
- Performance; Sales, Revenue ve Spend'i ilişkilendirir. Intent; Add to Cart, Checkout, Abandoned ve Purchase'ı ilişkilendirir.
- Kullanıcı terimi `Sales`tir; iç `sales_value` uygulama anahtarı kalabilir.
- Mevcut dönem düz, karşılaştırma kesik çizgiyle gösterilir. Olumlu/olumsuz değişimin anlamı metrik sözleşmesinden gelir.
- Grafik, seçili nokta, KPI ve tablo tek BFF/sorgu/formül otoritesi kullanır.
- SVG/Canvas yalnız grafik veri düzlemindedir; çevre arayüz resmî Polaris/App Bridge kalır.
- Ad Analysis grafikleri A6-EO-07-C kanıtı ve ayrı kabul edilmiş grafik özeti bekler.
- Yeni paket açılmadı; A6-EO-07 ilerlemedi, uygulama/canlı değişiklik yetkisi verilmedi.

## A6-OPS-LOCAL-01 — Tek seferlik güvenli yerel temizlik

**Durum:** Hazır; uygulama başlamadı
**Tür:** Bağımsız operasyon paketi; A6-EO bağımlılık zinciri dışında

- **A6-OPS-LOCAL-01-A — Salt okunur envanter:** AdsTable kökleri, durum, dallar, stash, worktree, ortak Git üst verisi ve yalnız yerelde kalan adaylar değişikliksiz listelenir.
- **A6-OPS-LOCAL-01-B — Sınıflandırma ve uzak eşdeğer kanıtı:** Anlamlı iş, secret/yedek, atılabilir çıktı, aktif/arşivlenebilir worktree ve geçersiz üst veri ayrılır; temizlikten önce GitHub eşliği kanıtlanır.
- **A6-OPS-LOCAL-01-C — Geri alınabilir temizlik:** Yalnız güncel envanter ve ayrı açık onaydan sonra uygun worktree arşivlenir; kesin doğrulanmış kökte atılabilir olduğu kanıtlanan içerik kaldırılır.
- **A6-OPS-LOCAL-01-D — Kapanış kanıtı:** Yalnız yerelde kalan anlamlı işin sıfır olduğu, ana kopya/ortak üst verinin sağlamlığı, uzak eşdeğerlerin okunabilirliği ve istisnaların kaydı kanıtlanır.

Paketin açılması silme yetkisi vermez. 10 EO ana paketi, 43 sabit alt paket veya iş sırası değişmez.
İlk kayıttaki A6-EO-02-C aktif kapı ifadesi tarihseldir; bugün aktif kapı DOCS'tur.
Tekrarını, zorunlu paket sonu yalnız-yerelde-anlamlı-iş-sıfır kontrolü önler.

## A6-OPS-SHOPIFY-01 — İzole Shopify gömülü ön üretim ortamı

**Durum:** Planlandı; tetikleyiciye ulaşılmadı; uygulama başlamadı
**Tür:** Devreye alma sınırına kadar EO bağımlılık zinciri dışında bağımsız ön koşul paketi

Bağlayıcı analist özeti: `docs/A6_OPS_SHOPIFY_01_ISOLATED_PREPRODUCTION.md`
Yürütülebilir sözleşme: `contracts/a6-ops-shopify-01-isolated-preproduction-v1.json`

- Gerçek mağazanın AdsTable kullanımı için Shopify'a taşınması veya ilk dış/ekip dışı kullanıcının daveti; hangisi önceyse ondan önce zorunlu ön koşuldur.
- Ayrı Shopify geliştirme uygulaması/mağazası, adlandırılmış canlı olmayan yapılandırma, sabit gömülü Preview/Staging URL ve birebir dönüş adresleri, Preview'a özel kimlik bilgileri ve Production'dan izole kalıcı veri gerekir.
- Canlı mağaza geliştirme mağazası yerine geçmez. Production kimlik bilgileri Preview/Development'a kopyalanamaz; Preview Production iş verisine yazamaz.
- Gerçek sağlayıcı hesabı kabulü ayrı onaylı, salt okunur ve kesin hesaba bağlıdır. İlk açık veya açıklamasız hatada durulur; tekrar veya alternatif rota yeni açıklama/onay ister.
- Kanıt A6-EO-08-D'ye girdi olabilir; paket review'a hazır ilan etmez, aktif EO ana paketini ilerletmez.
- Ürün sahibi 17 Ekim 2026'da planlamayı kabul edip uygulamayı açıkça erteledi. Bu kayıt Shopify/Vercel/veritabanı/secret/sağlayıcı/dağıtım/taşıma/davet/review/merge işlemi yetkilendirmez.

### EO-02-C düzeltici kapı — Shopify çalışma zamanı kimlik doğrulama köprüsü

EO-02-C internal caller kodu tek başına canlı tetikleyici değildir. `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md` ve `contracts/eo-02c-shopify-runtime-auth-bridge-v1.json` PASS olmadan veritabanı Secret etkinleştirilemez, EO-02-C kapatılamaz ve EO-02-D başlatılamaz. Ürün URL'leri ve mevcut preview görünümü korunur.

## 9 Ekim 2026 — Kurulu mağaza otoritesi düzeltici kapısı

- Kullanıcının seçebildiği mağaza kapsamı kaldırıldı; Shopify gömülü çalışma alanının ticaret otoritesi doğrulanmış ID token + Admin GraphQL `shop` ile belirlenen kurulu Shopify mağazasıdır.
- Sağlayıcı Reporting Account seçimi bu otoriteye tabidir ve kurulu mağazayı değiştiremez.
- Sağlayıcı varlıkları kurulu mağazaya deterministik bağlanamıyorsa hesap bağlı kalabilir fakat raporlama otoritesi olamaz; Dataset V2 ve SnapshotJob güvenli biçimde durur.
- İkinci Shopify mağazası ayrı app installation, çalışma alanı ve abonelik gerektirir. WooCommerce, BigCommerce ve Magento Shopify embedded workspace'e ticaret kaynağı olarak giremez.
- EO-02-B/EO-02-C repository düzeltmesi, CI ve ayrı açık onaylı canlı Supabase migration 9 Ekim 2026'da tamamlandı. Canlı kanıt `docs/evidence/EO_02BC_INSTALLED_SHOP_AUTHORITY_LIVE_2026-10-09.json` dosyasındadır; EO-02-D kapanış hattı bu düzeltmeden sonra devam eder.
- Otorite: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.

## 9 Ekim 2026 — EO-02-D-C1 kalıcı silme işçisi düzeltici kapısı

- Production incelemesi, doğrulanmış gizlilik talebi sahiplenmesi ve silme işi üretildiğini fakat kuyruğu tüketen kalıcı işçi bulunmadığını kanıtladı.
- Seçilen mimari Supabase Cron / pg_cron'dur; Vercel Cron, HTTP hop veya yeni ortam secret'ı eklenmez.
- Her 5 dakikada 25 run; güvenlik bildirimi lock, row lock, idempotent generation boundary ve bounded retry uygulanır.
- Uygulama çalışma zamanı fiziksel silme yürütücüsünü doğrudan çağıramaz.
- 20 denemeyi tüketen iş sessiz başarı sayılmaz; görünür başarısız durumda operasyon müdahalesi bekler.
- Otorite: `docs/EO_02D_DURABLE_DELETION_WORKER.md` ve `contracts/eo-02d-durable-deletion-worker-v1.json`.
- Repository değişikliği canlı değişiklik yetkisi değildir; canlı Supabase migration ve sentetik kabul ayrı açık kullanıcı onayı gerektirir.

## 9 Ekim 2026 — EO-03-D sağlayıcı bağlantısı yaşam döngüsü kabulü

- EO-03-D **Accepted** durumundadır; geri alınan canlı senaryonun tüm aşamaları PASS, sentetik kalıntı sıfır ve EO-03 ana paket kapanışı ürün sahibi onayıyla tamamlanmıştır.
- Yalnız `connected` lifecycle durumu raporlama otoritesi'dir. `reauthorization_required`, `disconnect_pending` ve `disconnected` yeni veri işini fail-closed durdurur.
- Yenileme yeni şifreli kimlik bilgisi zarfı hazır olduktan sonra expected-sürüm + unique-event-id ile atomik swap yapar; eski zarf değiştirme sonrasında aynı transaction içinde silinir.
- Disconnect iki aşamalıdır. Geçici veya belirsiz sağlayıcı yetki iptal sonucu başarı sayılmaz; bağlantı `disconnect_pending` kalır. Son bağlantı kesme geçmiş analitiği silmez.
- Yeniden bağlanma aynı kanonik bağlantı kimliğini kullanır; yeni kimlik bilgisi ve güncel sağlayıcı hesap kanıtı zorunludur.
- Meta için uydurma refresh-grant davranışı yoktur. Google Ads ve Klaviyo `invalid_grant` sonucu yeniden yetkilendirme gerektirir; Klaviyo token/revoke host'u `a.klaviyo.com` olarak sabittir.
- Otorite: `docs/EO_03D_PROVIDER_CONNECTION_LIFECYCLE.md` ve `contracts/eo-03d-provider-connection-lifecycle-v1.json`.
- Temel migration ile dört ileri-yönlü düzeltme canlı Supabase'de uygulanmış ve doğrulanmıştır. Bu kabul sağlayıcı API çağrısı, canlı sağlayıcı OAuth, sağlayıcı-console değişiklik, Vercel değişiklik veya production deploy içermez.
- EO-04 **Accepted** durumundadır. Sağlayıcı production doğrulamaları kapanışta açıkça devredilmiş, `A6-TECH-01` ise EO-05 öncesindeki aktif zorunlu kapı olarak atanmıştır.

## 10 Ekim 2026 — EO-04-A ortak adaptör uygulama kapısı (tarihsel)

- Ürün sahibi EO-04-A analist özetini uygulamadan önce kabul etti.
- Ortak çalışma zamanı ve sıkı tipler `app/lib/providers/common-adapter.server.js` ile `app/lib/providers/common-adapter.server.d.ts` içindedir.
- Meta, Google Ads ve Klaviyo aynı on kanonik ham metrik sorusunu yanıtlar; doğal istek biçimleri sağlayıcı alt paketlerine aittir.
- Destek kabiliyeti ile gözlem sonucu ayrıdır. Yalnız açık sağlayıcı sayısal sıfırı sıfır olur.
- Sayfalama yayından önce tamdır. Cursor döngüsü, çelişkili tekrar, eksik sayfa, şema hatası veya bitmiş bütçe satır yayımlamaz.
- İlk ortak tasarımın tekrar denemesi yalnız belgelenmiş normalize geçici sınıflarla sınırlıdır; kimlik/yetki/doğrulama ve kesin kapsam hataları tekrarlanmaz. Güncel ilk hata sonrası durma kapısı korunur.
- Sağlayıcı kanıtı sınırlı, temizlenmiş ve içerik hash'lidir; secret/kişisel veri kalıpları gizlenir.
- Belirlenimci sentetik davranış `tests/eo-04a-common-adapter.test.js` ile sınanır.
- EO-04-A'da canlı sağlayıcı çağrısı, secret okuma/yazma, DB/Vercel değişikliği veya dağıtım yoktur.
- GitHub Actions `38049487145` koşusu 163/163 test, tip kontrolü ve Preview derlemesini geçti. Ürün sahibi 10 Ekim 2026'da EO-04-A'yı kabul edip PR #65 merge'ünü onayladı. EO-04-B OAuth resmî kaynak/analist kapısı 13 Ekim'de geçti; ayrı Production yapılandırma/dağıtım, tam Windows akışı ve iOS temiz oturum başlangıcı kabul edildi. Rolü olmayan Windows hesabı Android'le aynı review öncesi Meta kısıtını verdi; ürün sahibi doğrudan PASS verdi. Meta raporlama sözleşmesi/uygulaması o ara kayıtta henüz başlamamıştı.

## 10 Ekim 2026 — EO-04-A ürün sahibi kapanışı

- EO-04-A ortak adaptör sözleşmesi **Accepted**, yani kabul edilmiş durumdadır.
- Kapanış sağlayıcıdan bağımsız çalışma zamanı, sıkı tipler, belirlenimci sahte sağlayıcı testi ve secret içermeyen kanıt politikasını kapsar.
- Ürün sahibi kabulü ve PR #65 merge yetkisi açıktır.
- O anda EO-04-B aktifti; 13 Ekim resmî Meta kaynakları ve OAuth/hesap seçimi özeti kabul edilmiş, repository uygulaması/CI bekleniyordu.
- Bu kapanış sağlayıcı secret'ı, canlı API, DB/Vercel değişikliği veya dağıtım yetkilendirmez.

## 13 Ekim 2026 — EO-04-B Meta OAuth/hesap seçimi uygulama kapısı

Bağlayıcı analist özeti: `docs/EO_04B_META_OAUTH_ACCOUNT_SELECTION.md`
Yürütülebilir sözleşme: `contracts/eo-04b-meta-oauth-account-selection-v1.json`
CI kontrolü: `tests/eo-04b-meta-oauth-account-selection.test.js`

- Meta Graph/Login `v26.0` sürümüne sabittir; OAuth yalnız `ads_read` ister ve birebir gömülü dönüş adresini kullanır.
- Çalışan Google davranışı ayrıdır. Meta aynı kabul edilmiş akışı kullanır: OAuth, otomatik reklamveren seçimi, bir-üç hesap ve tam bir Reporting Account.
- Tek hesap otomatik bağlanır; iki/üç hesapta ayrı açık Reporting Account seçimi gerekir. Cancel bekleyen durumu korur; Resume setup OAuth'u yeniden başlatmaz.
- Token kabulü kısa ömürlüden uzun ömürlüye değişim, `/debug_token` ile uygulama/izin/bitiş doğrulaması ve EO-03-B kasasında yalnız şifreli saklama gerektirir.
- `/me/adaccounts` opak cursor ile sayfalanır; sayfa/hesap üst sınırı vardır. Geçersiz yetkilendirme yeniden yetki ister; boş liste sahte başarı olmaz.
- Disconnect önce sağlayıcı yetkisini iptal eder; sağlayıcı başarısızlığında yerel raporlama otoritesi korunur.
- OAuth/hesap seçimi raporlama verisi, zamanlama veya geçmiş veri tamamlama başlatmaz. O kabul diliminde sağlayıcı raporlama davranışı henüz yetkili/uygulanmış değildi.
- Dört Meta ortam adı yalnız ad envanterindedir; değer commit edilmez veya geri okunmaz.
- `f3f0516b5b938b683d10cd14b75947cd805120e0` commit'inin `dpl_GxV2DQiXYaer24W1247iPAn9N6gR` Production dağıtımı READY oldu. Masaüstü OAuth, hesap seçimi, Reporting Account, Cancel/Resume, Disconnect ve yeniden bağlantı PASS.
- Geliştirici rolündeki hesapla tam Windows akışı geçti. Yeni iPhone Connect işlemi Meta parola ekranını doğru açtı. Rolü olmayan farklı Facebook hesabının kontrollü Windows denemesi Android'in aynı **App not active** yanıtını üretti; bu cihaz/AdsTable kod kusuru değil, Meta geliştirme/review öncesi kullanıcı kısıtıydı. Android tekrarı isteğe bağlıdır; kopyalanmış OAuth URL/state yeniden kullanılamaz.
- Kanıt: `docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json`. Canlı OAuth ve ürün sahibi kabulü PASS. Açık merge onayıyla PR #68 `23911ffd565f385c02693ed7a1f3a07f017c30f5` olarak birleştirildi. O kayıtta sıradaki Klaviyo EO-04-D idi.

### EO-04-D Klaviyo başlangıç kapısı (tarihsel)

Kabul edilmiş başlangıç özeti
`docs/EO_04D_KLAVIYO_OAUTH_ESTIMATED_SPEND_START_BRIEF.md` ve
`contracts/eo-04d-klaviyo-oauth-estimated-spend-v1.json` içindedir.
Yeni EO-03 otoritesinde OAuth → tek doğrulanmış Connected Account → ilk tahmini
harcama → Update spend / Change value → önce iptal eden Disconnect akışı korunur.
Tahmini harcama, geçerlilik tarihli özel defterinde tutulur; raporlama, Channel
kararı ve maliyet dağıtımı başlangıç dilimi dışındadır. Ürün sahibi başlangıcı
13 Ekim 2026'da kabul etti. Repository OAuth/tek hesap temeli, harcama defteri
migration'ı, atomik Save and connect, Update spend, Change value ve Disconnect
yollarını içeriyordu. Ayrı onaylı canlı DB kapısında `eo04d_klaviyo_spend_ledger`
uygulandı; geri alınan sentetik kabul, sıfır kalıntı, sıfır Advisor ve yeni eksik
FK indeksi bulunmadığı kaydedildi:
`docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json`.
Canlı OAuth, sağlayıcı paneli, Vercel/dağıtım ayrı kapıydı; masaüstü/gerçek mobil
kabul o hazırlık aşamasında henüz açıktı.

### EO-04-D Klaviyo OAuth güçlendirme kapısı — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_OAUTH_HARDENING_BRIEF.md`
Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-oauth-hardening-v1.json`
CI kontrolü: `tests/eo-04d-klaviyo-oauth-hardening-contract.test.js`

- Ürün sahibi onayı yalnız repository OAuth/token güçlendirmesini kapsar; canlı çağrı, secret, DB, ortam, dağıtım, UI veya sağlayıcı paneli değişikliği değildir.
- Klaviyo token bitişi şifreli token kümesinde tutulur. Süresi dolmuş, dolmak üzere veya bitiş kanıtı olmayan eski token, hedef sağlayıcı isteğinden önce yenilenir.
- Başarısız sağlayıcı isteği sonlandırıcıdır; ardından token yenileme veya otomatik tekrar olmaz. Accounts `401`, Accounts `403`, yenileme `invalid_grant` ve authorization-code `invalid_grant` ayrıdır.
- Bağlı Settings incelemesi yereldir; yalnız sayfa açıldı diye Klaviyo çağrılmaz.
- Klaviyo'dan başlayan kurulum taşıması geçerli gelecek review ihtiyacıdır; izole Shopify ön üretimi ve açık görsel kabule kadar ertelenir. PR #91 bu sunucu paketi için merge yetkisi değildir.

## EO-04-D Klaviyo raporlama kabiliyeti — 16 Ekim 2026 yeniden kontrolü

Resmî kabiliyet kaydı: `docs/decisions/A6_EO_04_D_KLAVIYO_REPORTING_CAPABILITY_BASELINE.md`

- `2026-10-15` revision Campaign Message, `send_channel` ve isteğe bağlı Variation reporting boyutlarını GA olarak belgeler.
- 17 Ekim 2026 ürün sahibi düzeltmesi bağlayıcıdır: Campaign Message ve Flow Message AdsTable Channel'dır; `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Events attribution Campaign Message'ı fakat Campaign Variation'ı içermez. Message biliniyorsa Channel birebir kalır; çoklu veya çözülemeyen Variation yalnız Variation çözünürlüğünü etkiler ve `Unclassified Channel` üretmez.
- Flow attribution `Flow Message Variation` veya `Flow Message` ilişkisini açıkça döndürebilir; Variation ana paket Message'a çözülür ve Channel yine Flow Message kalır.
- Campaign için Values endpoint'i vardır fakat Series endpoint'i yoktur. Günlük grain tek-gün timeframe sorgularıyla korunur; ilk ilk yükleme yalnız dün ve bugündür. Saatlik refresh/uzlaştırma kota bütçesi EO-05'e aittir.
- Estimated Email Spend dağıtım ve Dataset mapping EO-05'e aittir.
- Bu kayıt tek başına API çağrısı, çalışma zamanı, Dataset, migration, secret, environment veya deployment değişiklik yetkisi vermez.

## EO-04-E ortak Channel ve ürün ekonomisi sözleşme kapısı — 16 Ekim 2026

Kabul edilmiş bağlayıcı özet: `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`

CI kontrolü: `tests/eo-04e-three-provider-channel-product-economics.test.js`

- Meta Channel = Ad; Google Standard Shopping/Search Channel = Ad Group; Google PMax Retail Channel = Asset Group; Klaviyo Campaign Channel = Campaign Message; Klaviyo Flow Channel = Flow Message. Klaviyo `send_channel` zorunlu Medium, Variation ayrı alt kırılımdır.
- Sales Role sözlüğü `Advertised`, `Cross-sell`, `Assisted`, `Triggered` ve yalnız gerçek ambiguity için `Unclassified` olarak kabul edilmiştir.
- `Zero Value` bir rol değil modifier'dır. `Unclassified Channel`, satış kanıtı bulunduğu halde birebir Channel çözülemediğini ifade eder.
- PMax geniş/örtüşen ürün ağacı üyeliği aşağıya paylaştırılmaz. Search sağlayıcı-atıflı ürün satışı bastırılmaz; `Assisted` olur.
- Meta Ad spend ürünlere dağıtılmaz. Google sağlayıcı ürün maliyeti gerçek/birleşik maliyet sayılmaz. Klaviyo Estimated Spend dağıtımı EO-05'e bırakılır.
- `Channel Ad Cost`, `Provider Product Ad Cost` ve EO-05'e ait `Allocated Ad Cost` ayrı kalır. Açık sıfır dışındaki eksik/destek durumları sıfır olmaz; ürün maliyeti satırları Channel toplamını yeniden üretmez.
- Birebir sağlayıcı ürün Ad Cost'u `Cross-sell`, `Assisted`, `Zero Value` veya `Unclassified Channel` nedeniyle silinmez ve ilgili ürün satırında korunur. Birebir product cost yoksa Channel toplamı ürünlere tahminî dağıtılmaz; Klaviyo `Triggered` dağıtım'ı EO-05'e aittir.
- Desteklenen ürün kimliği yolları resmî Shopify yönetimli Facebook & Instagram, Google & YouTube ve Klaviyo entegrasyonlarıdır. Meta ve Google product/variant adayları Shopify Admin API ile doğrulanmadan SKU, ürün adı veya varyant adı yayımlanmaz; elle/üçüncü taraf besleme/katalog bu sürümde kapsam dışıdır.
- Bu sözleşme kapısı ürün sahibi tarafından 16 Ekim 2026'da bütün olarak kabul edilmiştir. Kabul tek başına sağlayıcı reporting çalışma zamanı, canlı sağlayıcı çağrısı, Dataset V2, migration veya environment/deployment değişiklik başlatmaz; bunlar ayrı onay kapısındadır.

## EO-04-D Klaviyo raporlama çalışma zamanı temeli — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REPORTING_RUNTIME_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reporting-runtime-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-reporting-runtime-contract.test.js` and `tests/eo-04d-klaviyo-reporting-runtime.test.js`

- Campaign/Flow hiyerarşi örnekleri kabul edildikten sonra ürün sahibi yalnız repository çalışma zamanı temelini onayladı.
- Campaign/Flow Message Channel'dır; Message adı Channel adıdır. `send_channel` zorunlu Medium'dur; Variation Channel yerine geçmez.
- Kesin Message, çözülmeyen veya çoklu Variation varken kesin Channel kalır. `Unclassified Channel` yalnız eksik, çözülemeyen veya çelişkili Message kanıtındadır.
- Shopify `Placed Order` Reporting API dönüşüm metriği; `Ordered Product` ürün satış olayı kanıtıdır. Aynı satış iki kez sayılmaz.
- Ürün kimlikleri sağlayıcının doğal gözlemidir; Product ID standardizasyonu, saklama, zamanlayıcı, uzlaştırma ve tahmini harcama dağıtımı sonraki kapılardadır.
- Bu paket canlı Klaviyo, sağlayıcı değişikliği, DB/migration, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D Klaviyo raporlama otoritesi — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REPORTING_AUTHORITY_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reporting-authority-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-reporting-authority-contract.test.js` and `tests/eo-04d-klaviyo-reporting-authority.test.js`

- Ürün sahibi yalnız repository raporlama otoritesi/koordinatör uygulamasını onayladı.
- Raporlamadan önce aktif Shopify kurulumu, tam bir kanonik Klaviyo Connected Account, şifreli kimlik bilgisi otoritesi, gerekli okuma izinleri ve bağlı hesap saat dilimi zorunludur.
- Metrics, Campaign Values, Flow Values, Ordered Product Events sırasıyla çalışır. İlk sağlayıcı hatası kalan bütün aileleri durdurur; önceki başarılı satırlar kısmi çıktı olarak yayımlanamaz.
- Metrics/Events resmî `links.next` sayfalarını tamamlar. Values yalnız açık aynı-origin/aynı-endpoint devamını kabul eder; 2026-10-15 yanıt şemasının vermediği cursor uydurulmaz.
- Başarılı boş Campaign/Flow/Event sonucu `not_observed_in_this_execution` kalır; sayısal sıfır olmaz.
- Ordered Product standartlaştırması, profil istemeden sağlayıcı ürün alanları ve Campaign/Flow attribution ID'lerini korur. Product ID standardizasyonu ve Dataset V2 yayını sonraki kapılardadır.
- Bu paket canlı Klaviyo, sağlayıcı değişikliği, DB/migration/Dataset V2, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D geçici Klaviyo canlı kanıt tetikleyicisi — 18 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_LIVE_EVIDENCE_TRIGGER_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-live-evidence-trigger-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-live-evidence-trigger.test.js`

- Ürün sahibi geçici `Run Klaviyo evidence` taşımasını ve 18 Ekim 2026'da
  Production deploy adımını onayladı. Canlı sağlayıcı çağrısı ve Sample Data
  üretimi kapalıdır.
- Tarih merchant'tan alınmaz; bağlı Klaviyo hesabının timezone'una göre güncel
  iş tarihi server tarafında hesaplanır.
- Kalıcı reporting çalışma zamanı metrics, Campaign Values, Flow Values, Ordered
  Product Events ve resolution ailelerini tek denemede çalıştırır. İlk hata
  kalan aileleri durdurur; retry, fallback ve partial publication yoktur.
- UI ve safe log yalnız satır/durum/sınıflandırma sayılarını taşır. Raw satır,
  isim, ID, profil/PII, ticari değer, request ID, cursor/hash, token veya
  kimlik bilgisi taşımaz.
- Klaviyo custom ecommerce sample data, kanonik `integration.name = Shopify`
  metric kanıtı değildir ve Shopify-native ürün satışı kabulünün yerine geçmez.
- Birebir commit `b675885469effe9f3d9cb58135fa27d0219dcbb7`, Production
  deployment `dpl_FBfQ8t9mV4vw4PZkKmtgbjDbDqdy` olarak `READY` oldu ve gerçek
  Shopify Admin Settings görünümü ürün sahibi tarafından kabul edildi. Ayrı
  onaylı tek Klaviyo çağrısı ilk `metrics` ailesinde
  `KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID` ile retry yapmadan durdu;
  sonraki sorgu aileleri başlamadı ve hiçbir veritabanı/Dataset write oluşmadı.
  Ürün sahibinin Klaviyo Metrics incelemesinde Shopify integration bulunmadı;
  yalnız Klaviyo ve API integration adları görüldü. Sonuç kod/sağlayıcı hatası
  değil `environment_not_ready — shopify_integration_absent` olarak kaydedildi.
  Geçici buton gerçek Shopify entegrasyonu sonrası doğrulama için korunur; ek
  canlı çağrı kapalıdır. Kalıcı kanıt:
  `docs/evidence/EO_04D_KLAVIYO_ENVIRONMENT_NOT_READY_2026-10-18.json`.

## EO-04-D Klaviyo satış kaynağı çözümlemesi — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_ATTRIBUTION_RESOLUTION_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-attribution-resolution-v1.json`

CI kontrolü: `tests/eo-04d-klaviyo-attribution-resolution-contract.test.js`
and `tests/eo-04d-klaviyo-attribution-resolution.test.js`

- Ürün sahibi yalnız repository satış kaynağı çözümleme sözleşmesini kabul etti. Tek Ordered Product olayı tek satış gerçeğidir; Placed Order dönüşümü ikinci ürün satışı yaratmaz.
- Tek Channel otoritesi sağlayıcının Message attribution kanıtıdır. Message biliniyorsa katalog adı, Medium veya Variation çözülmese de kesin kalır.
- Campaign Message satışı, kesin içerik-ürün kanıtı Advertised/Cross-sell ispatlayana kadar Assisted olur. Flow Message satışı Triggered olur.
- Eksik/çelişkili Message kanıtı satışı bir kez Unclassified Channel altında, Sales Role Unclassified ile korur. Zaman yakınlığı veya rapor toplamı belirsizliği çözemez.
- Çözümleme tüm sağlayıcı ailelerinden sonra atomik çalışır. Bu paket canlı Klaviyo, DB/migration/Dataset V2, secret/ortam, dağıtım veya UI işi yetkilendirmez.

## EO-04-D Klaviyo yeniden yetkilendirme durum doğruluğu — 17 Ekim 2026

Bağlayıcı analist özeti: `docs/EO_04D_KLAVIYO_REAUTHORIZATION_TRUTH_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04d-klaviyo-reauthorization-truth-v1.json`

- Kanonik `reauthorization_required` Settings'te `Reauthorization required` görünür; `Not connected` gösterilemez.
- Settings incelemesi yereldir; kimlik bilgisi yenilemez, Klaviyo çağırmaz, başarısız isteği tekrarlamaz.
- Yalnız `connected` raporlama otoritesidir; tarihsel harcama dönemleri korunur.
- OAuth yeniden yetkilendirme önceki hesap/harcama geçmişini koruyarak güncel hesap doğrulamasını başlatabilir. Kurulum başarıyla tamamlanmadan raporlama açılmaz.
- EO-05 yetkisiz kalınan iş tarihi aralığını belirlemeli, sınırlı geçmiş tamamlama/uzlaştırma çalıştırmalı; eksik, kısmi, eski, kurtarılmış, geçici ve kesin durumları ayırmalıdır. Eksik tarih sessiz sıfır yapılamaz.
- Repository ve ayrı onaylı eklemeli canlı migration tamamlandı. Kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_LIVE_DATABASE_ACCEPTANCE_2026-10-17.json`;
  Security Advisor sıfır. Ayrı onaylı `9bc3108d366a58ce9ff92a293681245a0c380462`
  commit'i Production'a `dpl_8QgriVfjig4RjxC7hwpwtBJ77n8F` olarak dağıtıldı;
  Vercel `READY`, `embedded.adstable.app` hatasız eşlendi; ilgili error/fatal
  log gözlenmedi. Ürün sahibi gerçek masaüstü/mobil Settings'i kabul etti.
  Sağlayıcı çağrısı ve merge o aşamada ayrı kapıydı. Görsel kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_VISUAL_ACCEPTANCE_2026-10-17.json`.

## EO-04 Meta korunmuş canlı yanıt biçimi kanıtı — 16 Ekim 2026

- `8a7b0ca9645f46080f8fe0e69f18efe5e5638613` commit'inde güvenli canlı kanıt tamamlandı; çalışma zamanı hatası, tekrar, sonraki sağlayıcı başlangıcı veya DB yazması gözlenmedi.
- Tek Ad satırı yalnız sağlayıcıda varlığı kanıtlar; sayısal Dataset V2 yayını değildir. `impressions` ve `spend` doğrudan sağlayıcı kanıtıdır.
- `clicks`, `inline_link_clicks` ve dizi biçimli `outbound_clicks` ayrı Ad Click adaylarıdır. `landing_page_view` Session değildir. Purchase/checkout/add-to-cart kanıtlanmadı.
- Başarılı `product_id` isteği boş sayfa döndürdü. Kanonik durum `not_observed_in_this_execution`; boşluk ürün sıfırı veya genel desteklenmiyor kararı değildir.
- Kullanıcının Amazon hedef bağlamı sağlayıcı kanıtından ayrı kaydedildi. Sonraki ürün kapısı katalog bağlantılı Meta ürün reklamı ve ayrı yetki ister; aynı akışı tekrar etmek gerekmez.
- Temizlenmiş kalıcı kanıt: `docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.

## EO-04-B Meta App Role hazırlık kapısı — 17 Ekim 2026

- Bağlayıcı özet: `docs/EO_04B_META_APP_ROLE_READINESS_BRIEF.md`; sözleşme: `contracts/eo-04b-meta-app-role-readiness-v1.json`.
- Birinci aşama, hedef reklam hesabına ayrıca meşru erişimi olan davetli App Tester ile sınırlı gerçek hesap kabulüdür. `ads_read` genişlemez; herkese açık müşteri veya sonraki Business Verification/Advanced Access/App Review yerine geçmez.
- Sunucu Graph istekleri `appsecret_proof` gerektirir. Süresi dolan/reddedilen yetki, tekrar çağrı olmadan kanonik bağlantıyı `reauthorization_required` yapar.
- Gerçek hesap kabulü Ad/Channel ve `product_id` ailelerinin ikisinde de sınırlı opak sayfalamayı bitirmeden sonuç döndürmez. Cursor döngüsü, sayfa/satır sınırı ve ilk sağlayıcı hatasında güvenle durulur.
- Geçici Meta kanıt butonu Settings'ten kaldırıldı. Reporting Account ve Disconnect kalır; kimliği doğrulanmış görsel olmayan kabul yolu ayrı onaylı çağrı için korunur.
- Shopify taşıması, resmî Facebook & Instagram katalog eşitlemesi, ürün/varyant kimliği sürekliliği, App Tester/reklam hesabı yetkisi ve gerçekten yayımlanmış katalog reklamı tarihi o sağlayıcı günü için ön koşuldur. Yokluk sessiz boş/desteklenmiyor kanıtı sayılamaz.
- Ürün sahibi 17 Ekim'de masaüstü/mobil Settings kabulü için yalnız Preview dağıtımını onayladı. O kayıt Production, Meta rol/hesap, canlı çağrı, secret/ortam veya DB şema değişikliği yetkilendirmedi.

## EO-04-C Google raporlama çalışma zamanı başlangıç kapısı — 16 Ekim 2026

Kabul edilmiş bağlayıcı özet: `docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md`

Yürütülebilir sözleşme: `contracts/eo-04c-google-reporting-runtime-v1.json`

CI kontrolü: `tests/eo-04c-google-reporting-runtime-contract.test.js`

- Standard Shopping ve Search Channel'ı Ad Group; Performance Max Retail Channel'ı Asset Group'tur.
- PMax satışı/Sales Role geniş listing tree'de korunur. Kesin Asset Group yalnız reklamı yapılan ürüne tam bir uygun ağaç eşleşirse çözülür.
- Tek uygun `All products` Asset Group kesindir. Birden çok örtüşen All products, kategori veya geniş ağaç `Unclassified Channel` bırakır; satış atılmaz/dağıtılmaz.
- Güncel ağaç tek başına eski satışı çözmez. Kesin tarihsel Channel, satışın tam iş günü boyunca geçerli sürümlü ağaç kanıtı ister. Gün içi değişiklik/eksik zaman kanıtında satış `Unclassified Channel` altında korunur.
- `cart_data_sales_view` reklamı yapılan/satılan ürün, adet, gelir ve lead/Cross-sell kanıtı; toplu `asset_group_product_group_view` kanıtından ayrıdır.
- Sağlayıcı Product Ad Cost reklamı yapılan üründe kalır; Cross-sell satılan ürüne taşınmaz. Dağıtım EO-05 işidir.
- Eksik Cart Data ayarı, başarılı boş yanıt, eksik alan, desteklenmeyen alan ve açık sayısal sıfır ayrıdır.
- Ürün sahibi 16 Ekim 2026'da özeti kabul edip sınırlı repository uygulamasını ayrıca onayladı. Dokuz salt okunur GAQL ailesi, ham sayfa/kanıt koruması, Sales Role ve zamansal güvenli PMax çözümleme sentetik testlerle kuruldu.
- Google test hesabı reklam yayımlamaz; gerekli performans/Cart Data satış gerçeklerini üretmediğinden gerçek raporlama kanıtı değildir. Repository test verisi yalnız AdsTable mantığını kanıtlar.
- Uygulama 16 Ekim'de `752cc1988323c238297d00516e7b7009432032c2` olarak kabul edilip birleştirildi.
- Aynı gün geçici canlı kanıt tetikleyicisinin sınırlı repository uygulaması ayrıca kabul edildi. Özet `docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md`, sözleşme `contracts/eo-04c-google-live-evidence-trigger-v1.json`.
- Tetikleyici hesap bağlamı, Cart Data satışları, ürün performansı, güncel PMax ağacı ve Asset Group performansını son 30 tamamlanmış hesap iş günü için sırayla çalıştırır. İlk hatada kalan aileler durur; tekrar veya alternatif yoktur.
- Birebir commit Production'a dağıtılıp 16 Ekim'de 1280 px masaüstü ve 320 px gerçek mobil Admin'de kabul edildi. Ayrı onaylı ilk çağrı tekrarsız durdu; gözlemlenebilirlik açığı bulundu: Arayüze yalnız `GOOGLE_LIVE_EVIDENCE_FAILED` ulaştı, sınırlı hata kanıtı loga ulaşmadı.
- Ürün sahibi dar düzeltmeyi onayladı: Yalnız güvenli aşama, sorgu ailesi, kaynak/sağlayıcı kodu, HTTP durumu ve yanıt gözlendi bilgisi loglanır. Ham mesaj, kimlik, istek ID, satır, token ve kimlik bilgisi yasaktır. İkinci çağrı/merge ayrı kapı kaldı.
- 16 Ekim'de sorgulardan önce istek kapsamlı tek token yenileme ayrıca onaylandı. `960ad41a7db9446e4be147f18d33d946c8324ae5`, `dpl_EsUUG8fEiQnPrxSWj7EBT8joPoTX` olarak dağıtıldı; ayrı onaylı tek koşu beş aileyi hatasız/tekrarsız tamamladı.
- `Europe/Istanbul` için 16 Eylül–15 Ekim aralığında Campaign, Cart Data, Shopping ürün, güncel PMax ağacı ve Asset Group satırı gözlenmedi. Bu sayısal sıfır, genel desteklenmiyor veya Dataset V2 otoritesi değildir. Kanıt: `docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.
- Bu koşu `campaign` kaynaklı birleşik hesap bağlamı kullandığından boş Campaign sonucu `customer.test_account` bilgisini de gizledi; hesap türü kanıtlanamadı. Yeni çağrıdan önce kimlik `FROM customer`, Campaign envanteri `FROM campaign` olarak ayrılmalıydı. İlk kanıt kendi başına düzeltme/yeni çağrı yetkisi vermedi.
- Dar düzeltme 16 Ekim'de ayrıca onaylandı. `1.1.0` önce `customer` üzerinden `account_identity`, sonra `campaign` üzerinden ayrı `campaign_context` çalıştırır; boş Campaign tür kanıtını gizleyemez. Bu uygulama onayı deployment veya ek canlı çağrı değildi.
- Production dağıtımı ayrıca onaylandı. `53730bee401c79600570f199bd9967cf2d560c8a`, `dpl_GFNme3aUQUJ25723fwU3e7HU235p` olarak `READY` oldu; `embedded.adstable.app` hatasız eşlendi, ilk error/fatal penceresi temizdi. Bu onay yeni Google isteği değildi.
- Ayrı onaylı takip isteği `customer.test_account=true` döndürdü. Google hata vermedi; `1.1.0` bu sınıfı iç `GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE` hatasına çevirip kalan ailelerden önce durdu.
- 16 Ekim erişim, OAuth kısıtlı izin doğrulaması ve demo politikaları yeniden kontrol edildi. Ürün sahibi review öncesi/sonrası tek çalışma zamanını kabul etti: Bağımsız kimlik korunur, `test_observed` kritik hata olmadan sınıflanır, sınırlı salt okunur aileler tamamlanır, yalnız güvenli sayılar gösterilir ve çıktı test demosu olarak etiketlenir. Gerçek performans kanıtı değildir. Review'a özel dal, sahte satır, Dataset yayını, dağıtım/yeni çağrı yetkisi verilmedi.
- `1.2.0` bu kararı uygular; 289/289 yerel test, tip kontrolü, Production derlemesi ve fark kontrolleri geçti.
- Ayrı onaylı `16a54df48e853c282d9c3481fb9e3b7c2b2ca16d`, `dpl_AQWkrVxdQvVzxPQkeNbhwXXwcXXQ` olarak dağıtıldı. `READY`, hatasız `embedded.adstable.app` ve temiz ilk error/fatal kontrolü doğrulandı. Ürün sahibi masaüstü/mobil Settings'i kabul etti. O anda yeni çağrı ve merge ayrı kapıydı.
- Açık merge onayıyla PR #85, 16 Ekim'de `54c427733cd51ba8600016941ce7afdd24ac2e64` olarak `main`e alındı. İkinci otomatik Production dağıtımı oluşmadı. Test demosu kabul/birleşmiş, canlı performans kanıtı Explorer-or-higher erişimi bekler; her yeni çağrı ayrı onay ister.
- Aynı gün tek test hesabı review-demo koşusu ayrıca onaylandı. Gerçek Admin sonucu `test_observed` doğruladı; altı salt okunur aile hatasız/tekrarsız tamamlandı. Campaign, Cart Data, Shopping performansı, güncel PMax ağacı ve Asset Group performansı sıfır satır döndürdü. Bunlar yalnız `not_observed_in_this_execution`; sayısal sıfır, genel desteklenmiyor, Product ID/Sales Role desteği veya Production performansı değildir. Kanıt: `docs/evidence/EO_04C_GOOGLE_TEST_ACCOUNT_REVIEW_EVIDENCE_2026-10-16.json`. Resmî erişim/test hesabı belgelerine göre Explorer-or-higher, test erişimini kaldırmadan canlı hesap erişimi ekler; ortak sorgu yapısı korunur. Canlı performans ve her yeni çağrı ayrı kapıda kalır.

## PD/CPD ortak sözleşme uyumu — 23 Ekim 2026, envanter 01

- Kaynak çalışma tablosu: `docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md`; kabul edilen hedef sözleşmesi: `contracts/pd-cpd-query-standard-v1.json`.
- PD'nin güncel talebi 9 metriktir. Session çıkarılmıştır; ortak runtime ve tip sözleşmesi `2.0.0` ile eski istek/ek metrik alanını reddeder. Eski tarihli 10 metrikli kabul kayıtları tarihsel kalır.
- PD ve CPD ayrı kayıt aileleridir. CPD Channel bağlı ürün toplamıdır; PD genel maliyeti her ürüne kopyalanmaz. Üst hiyerarşi aynı kapsamlı alt kayıtlardan toplanır; parent ve child birlikte yeniden sayılmaz. Fiziksel Dataset tasarımı ve toplam uygulaması bu adımda yapılmaz.
- Channel hedefleri Meta Ad; Google Search Ad, Shopping Ad Group, Retail PMax Asset Group; Klaviyo Campaign Message/Flow Message'dır. Shopify Product ID raporlama omurgası, Variant ID varsa korunan kaynak ayrıntısıdır. Mevcut sorgu/bağlantı eksikleri kendi 02–16 maddelerinde kalır.
- 08 kararı: PD Purchase ayrımı normal `conversions`/`conversions_value`; CPD ürün adedi/geliri ve rol alanları aynı normal kapsam. `all_*` yalnız ham kaynak; eksik normale yedek veya toplama girdisi değildir. Runtime kabul testleri sonraki Google grubundadır.
- Klaviyo içerik üyeliği tıklanan ürünü kanıtlamaz. PR #166 düzeltmesi üyeliği Assisted tutar; Advertised/Cross-sell için satışa bağlı doğrulanmış ürün etkileşim kanıtı yolu hâlâ açıktır. Flow Triggered sınırı korunur.
- PR #165 ve #166 ürün sahibinin açık onayıyla sırasıyla `2c2c8cc296b9bf38f213ae84dd749511843177db` ve `fed48b3fc209fe34dae44d388ad55f98148afdd2` olarak birleşmiştir. Bu 01 değişikliğinin merge'i, deploy ve canlı çağrı ayrı kapıdır. Tarihsel PMax duraklaması yeniden açılmaz.
- Resmî belge kontrolü 23 Ekim: Google Metrics v25 ve Klaviyo Reporting API Overview okundu. Meta Insights sayfası HTTP 429 verdi; alternatif rota/tekrar yapılmadı, yeni Meta davranışı kanıtlanmış sayılmadı.

## EO-04-C Google 2026 erişim/review düzeltmesi — 17 Ekim 2026

- Google'ın 9 Eylül 2026 geçiş dokümanı, erişim seviyesi sayfası, OAuth canlıya hazırlık kuralları, Ads API güvenlik gereksinimleri ve policy/demo süreci resmî kaynaklardan yeniden kontrol edildi. Bağlayıcı karar `docs/decisions/A6_EO_04_C_GOOGLE_2026_ACCESS_REVIEW_CORRECTIVE.md`; yürütülebilir sözleşme `contracts/eo-04c-google-2026-access-review-corrective-v1.json` içindedir.
- İlk gerçek-hesap geliştirme hedefi Explorer access'tir. Google Ads API access seviyesi OAuth istemcisinin bağlı olduğu Google Cloud Project'e aittir; OAuth public verification ayrı bir dış-kullanıcı kapısıdır.
- Google Ads API v25 için `GOOGLE_ADS_DEVELOPER_TOKEN` yalnız geçiş uyumluluğudur: varsa header gönderilir, yoksa çalışma zamanı fail etmez. Mevcut Production secret bu paketle değiştirilmez veya silinmez.
- HTTP 401, Cloud Project erişim eksikliği, 2-Step Verification eksikliği, diğer yetki/izin kapsamı 403'leri ve `AUTHORIZATION_ERROR` ayrı güvenli durma sınıflarıdır. Hiçbiri otomatik tekrar, proje değişimi veya alternatif kimlik doğrulama rotası başlatmaz.
- Tarihsel PMax doğruluğu korunur: bugünkü listing tree geçmiş satışı birebir çözemez. Tam iş günü kayıtlı görünüm yoksa satış ve Sales Role korunur, Channel `Unclassified Channel` kalır. Sürümlü kayıtların kalıcı saklanması A6-EO-05 sorumluluğudur.
- Ürün sahibi 17 Ekim 2026'da bu repository düzeltme paketini onaylamıştır. Onay Google başvurusu, canlı sağlayıcı çağrısı, Cloud Project/OAuth/secret/environment değişikliği, deployment, veritabanı, Dataset V2 veya UI değişiklik'ı yetkilendirmez.
- Ürün sahibi gerekli CI sonrasında merge'i açıkça onaylamıştır. PR #89, 17 Ekim 2026'da `main` üzerine `ff54d518b7c93ba576c9943a7c8d66a7ea511de6` olarak squash-merge edilmiştir. Explorer başvurusu, ilk Production çağrısı ve her sağlayıcı değişiklik'ı ayrı kapıda kalır.
