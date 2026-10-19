# EO-01 — Analiz ve tasarım kitabı

**Ana paket:** A6-EO-01 — Temiz çalışma zamanı kabuğu, CI ve bağımlılık sınırı

**Durum:** Kabul edildi — 2026-10-09

**Amaç:** Teknik olmayan bir okuyucunun EO-01'in neden yapıldığını, nasıl çalıştığını ve nerede bittiğini alt paket geçmişini yeniden kurmadan anlayabilmesi.

Bu kitap EO-01'in kabul edildiği günkü kapsamını anlatır. Daha sonra eklenen özellikler ve projenin bugünkü durumu için Execution Plan geçerlidir.

## 1. İş amacı ve gerçek çıktı

EO-01, Shopify Admin içinde çalışan ürünün güvenilir biçimde büyüyebileceği boş ve denetlenebilir temeli kurdu. Eski uygulama bu temele topluca kopyalanmadı.

Paket sonunda:

- fyilanli-oss/ads-table-embedded ayrı ürün repository'si olarak kuruldu.
- Eski çalışma zamanı kodu, sağlayıcı uygulamaları ve bağımlılık zinciri taşınmadı.
- Resmî Shopify React Router teknoloji yığını ve Polaris 2.0 RC tabanı sabitlendi.
- Funnel App Home, Ad Analysis ve Settings için gerçeğe uygun bir önizleme kabuğu oluşturuldu; olmayan veri veya bağlantı varmış gibi sunulmadı.
- Repository ve bağımlılık sınırları; test, tür kontrolü (typecheck) ve derleme (build) kapılarıyla CI içinde denetlenir hale geldi.

EO-01 ürün verisi çekmez, OAuth bağlantısı kurmaz, veritabanı oluşturmaz ve canlı kullanıcı trafiği taşımaz.

## 2. Aktörler ve otoriteler

- **Ürün sahibi:** Görsel ürün yönünü ve paket kabulünü verir.
- **GitHub main:** Kabul edilmiş kaynak kod ve kararların kalıcı otoritesidir.
- **CI:** Repository sınırı, bağımlılıklar, testler, tür kontrolü ve derleme için teknik kabul kapısıdır.
- **Shopify resmî teknoloji sözleşmesi:** Embedded çalışma zamanı ve arayüz teknolojisi için dış otoritedir.
- **Eski repository:** Kaynağın izlenebilirliği, kanıt, eski yapıyı kontrollü tutma ve geri dönüş referansıdır; yeni ürünün karar kaynağı değildir.
- **Vercel önizlemesi:** Üç yüzeyin çalışmasını gösteren geçici kabul ortamıdır; Production otoritesi değildir.

## 3. Uçtan uca normal akış

1. Güncel GitHub main'den görev dalı açılır.
2. Repository sınır testi, eski uygulama ve çalışma zamanı dosyalarının taşınmadığını doğrular.
3. Resmî Shopify teknoloji yığını ve bağımlılık sürümlerini sabitleyen lockfile kurulur.
4. Olumsuz senaryo kontrolleri, emekli edilmiş framework ve sağlayıcı bağımlılıklarını reddeder.
5. Üç yetkili uygulama adresi gerçeğe uygun önizleme olarak çalışır: Funnel App Home, Ad Analysis ve Settings.
6. Testler, tür kontrolü ve derleme geçer.
7. Masaüstü ve mobil görünüm ürün sahibi tarafından açıkça kabul edilir.
8. PR merge edilir ve main yeni başlangıç otoritesi olur.

## 4. Negatif ve hata yolları

- Eski uygulama/çalışma zamanı dosyası repository'ye girerse sınır testi başarısız olur.
- Yasaklı veya beklenmeyen bağımlılık manifest/lockfile'a girerse olumsuz senaryo kontrolü başarısız olur.
- Uygulama adreslerinden biri hata verirse önizleme kabuğu kabul edilmez.
- Arayüz çalışsa bile ürün sahibi görsel kabul vermediyse paket PASS sayılmaz.
- GitHub branch, PR veya CI kanıtı yoksa yerel çıktı teslim sayılmaz.
- Resmî Shopify bileşeni veya teknoloji kararı doğrulanamıyorsa tahminle ilerlenmez.

## 5. Kalıcı durum ve veri sahipliği

EO-01 iş verisi tablosu, müşteri verisi, sağlayıcı verisi veya token üretmez.

Kalıcı çıktılar:

- GitHub üzerindeki kaynak ve test dosyaları,
- bağımlılık bildirimi (package manifest) ve lockfile,
- repository sınır ve arayüz karar belgeleri,
- kabul commit'leri ve CI kayıtlarıdır.

Önizleme ortamı yeniden üretilebilir bir gösterimdir; tek kalıcı kaynak değildir.

## 6. Gizli bilgiler ve güvenlik sınırları

- EO-01 sağlayıcıya ait gizli bilgi, Shopify Admin token'ı, veritabanı erişim bilgisi veya canlı erişim token'ı kullanmaz.
- Gizli bilgi dosyaları, kişisel veri ve canlı sağlayıcı yanıtlarının ham içeriği repository'ye girmez.
- Önizleme ekranları canlı bağlantı varmış gibi davranamaz.
- Güvenlik, temiz bağımlılık zinciri ve repository'nin yasakları reddettiğini gösteren kontrollerle başlar.

## 7. Operasyon, tekrar deneme ve gözlemlenebilirlik

Her değişiklikte test, tür kontrolü ve derleme yeniden çalıştırılabilir. CI sonucu commit ve PR'a bağlanır. Önizleme adreslerinin HTTP yanıtı ve görsel durumu ayrıca gözlenebilir.

Bir kontrol başarısızsa yalnız başarısız katman düzeltilip aynı commit hattında yeniden sınanır; canlı sistemde veya sağlayıcıda değişiklik yapılmaz.

## 8. Geri alma, kurtarma ve güvenli başarısızlık

EO-01 eski sistemden yeni sisteme nihai canlı geçişi (production cutover) yapmadığı için geri alma Git seviyesindedir:

- PR merge edilmeden dal terk edilebilir.
- Merge edilmiş hatalı değişiklik yeni bir düzeltme commit'i veya açık revert ile giderilebilir.
- Eski repository silinmez; kontrollü geri dönüş ve kaynağın izlenebilirliği için korunur.
- Yerel disk tek kurtarma kaynağı sayılmaz.

## 9. Kabul kanıtı ve bilinen sınırlar

Kabul kanıtları:

- EO-01-A repository sınırı: docs/EO_01A_REPOSITORY_BOUNDARY.md
- EO-01-B teknoloji yığını/bağımlılık bildirimi/CI: docs/EO_01B_OFFICIAL_STACK_MANIFEST_CI.md
- EO-01-C önizleme kabuğu: docs/EO_01C_THREE_ROUTE_PREVIEW_SHELL.md
- Kabul commit'leri ana sözleşme ve Execution Plan içinde kayıtlıdır.
- Repository testleri, tür kontrolü, derleme ve ürün sahibinin görsel kabulü geçmiştir.

Bilinen sınırlar:

- OAuth ve token vault EO-03 kapsamıdır.
- Sağlayıcı adaptörleri EO-04 kapsamıdır.
- Dataset V2 ve scheduler EO-05 kapsamıdır.
- Gerçek Funnel, Ad Analysis ve Settings uygulaması EO-07 kapsamıdır.
- Production cutover bu paket tarafından yetkilendirilmez.

## 10. Tek sonraki ana paket

EO-01'in tek sonraki ana paketi **A6-EO-02 — Çalışma alanı, kurulum, faturalandırma/deneme ve gizlilik temelleri** paketidir.

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

