# EO-01 Analysis–Design Book

**Parent package:** A6-EO-01 — Clean runtime shell, CI and dependency boundary  
**Status:** Accepted — 2026-10-09  
**Purpose:** Teknik olmayan bir okuyucunun EO-01'in neden yapıldığını, nasıl çalıştığını ve hangi sınırda bittiğini çocuk paket geçmişini yeniden kurmadan anlayabilmesi.

## 1. İş amacı ve gerçek çıktı

EO-01'in amacı eski AdsTable uygulamasını temiz repository'ye kopyalamak değil, Shopify embedded ürününün güvenilir biçimde büyüyebileceği boş ve denetlenebilir bir temel kurmaktı.

Paket sonunda:

- fyilanli-oss/ads-table-embedded ayrı ürün repository'si olarak kuruldu.
- Legacy runtime kodu, eski provider uygulamaları ve eski bağımlılık zinciri taşınmadı.
- Resmî Shopify React Router stack'i ve Polaris 2.0 RC tabanı kilitlendi.
- Funnel App Home, Ad Analysis ve Settings için truthful preview shell oluşturuldu.
- Repository boundary, dependency boundary, build, typecheck ve test kapıları CI içinde çalışır hale geldi.

EO-01 ürün verisi çekmez, OAuth yapmaz, veritabanı kurmaz ve canlı kullanıcı trafiği taşımaz.

## 2. Aktörler ve otoriteler

- **Ürün sahibi:** Görsel ürün yönünü ve paket kabulünü verir.
- **GitHub main:** Kabul edilmiş kaynak kod ve kararların kalıcı otoritesidir.
- **CI:** Repository sınırı, bağımlılıklar, testler, typecheck ve build için teknik kabul kapısıdır.
- **Shopify resmî stack sözleşmesi:** Embedded runtime ve UI teknolojisi için dış otoritedir.
- **Legacy repository:** Yalnız provenance, kanıt, containment ve rollback referansıdır; yeni ürünün karar kaynağı değildir.
- **Vercel preview:** Üç yüzeyin çalışmasını gösteren geçici kabul ortamıdır; production otoritesi değildir.

## 3. Uçtan uca normal akış

1. Güncel GitHub main'den görev dalı açılır.
2. Repository sınır testi legacy uygulama/runtime dosyalarının taşınmadığını doğrular.
3. Resmî Shopify stack ve lockfile kurulur.
4. Negatif dependency kontrolleri emekli framework ve provider bağımlılıklarını reddeder.
5. Üç canonical route truthful preview olarak çalışır: Funnel App Home, Ad Analysis ve Settings.
6. Test, typecheck ve build PASS olur.
7. Desktop ve mobil görünüm ürün sahibi tarafından açıkça kabul edilir.
8. PR merge edilir ve main yeni başlangıç otoritesi olur.

## 4. Negatif ve hata yolları

- Legacy application/runtime dosyası repository'ye girerse boundary testi başarısız olur.
- Yasaklı veya beklenmeyen bağımlılık manifest/lockfile'a girerse negatif kontrol başarısız olur.
- Route'lardan biri hata verirse preview shell kabul edilmez.
- UI çalışan fakat ürün sahibi tarafından görsel olarak kabul edilmemişse paket PASS sayılmaz.
- GitHub branch, PR veya CI kanıtı yoksa yerel çıktı teslim sayılmaz.
- Resmî Shopify component veya stack kararı doğrulanamıyorsa tahminle ilerlenmez.

## 5. Kalıcı durum ve veri sahipliği

EO-01 business tablo, müşteri verisi, provider verisi veya token üretmez.

Kalıcı çıktılar:

- GitHub üzerindeki kaynak ve test dosyaları,
- package manifest ve lockfile,
- repository sınır ve UI karar belgeleri,
- kabul commit'leri ve CI kayıtlarıdır.

Preview ortamı yeniden üretilebilir bir gösterimdir; tek kalıcı kaynak değildir.

## 6. Secret ve güvenlik sınırları

- EO-01 provider secret'ı, Shopify Admin token'ı, database credential'ı veya canlı access token kullanmaz.
- Secret dosyaları, kişisel veri ve canlı provider payload'ı repository'ye girmez.
- Preview ekranları canlı bağlantı varmış gibi davranamaz.
- Güvenlik, temiz dependency zinciri ve negatif repository kontrolleriyle başlar.

## 7. Operasyon, tekrar deneme ve gözlemlenebilirlik

Her değişiklikte test, typecheck ve build tekrar çalıştırılabilir. CI sonucu commit ve PR ile bağlanır. Preview route'larının HTTP ve görsel durumu ayrıca gözlenebilir.

Bir kontrol başarısızsa yalnız başarısız katman düzeltilip aynı commit hattında yeniden sınanır; canlı sistem veya provider mutation'ı yapılmaz.

## 8. Rollback, kurtarma ve güvenli başarısızlık

EO-01 production cutover yapmadığı için rollback Git seviyesindedir:

- PR merge edilmeden dal terk edilebilir.
- Merge edilmiş hatalı değişiklik yeni bir forward-fix veya açık revert ile geri alınabilir.
- Legacy repository silinmez; containment ve provenance kaynağı olarak korunur.
- Yerel disk tek kurtarma kaynağı sayılmaz.

## 9. Kabul kanıtı ve bilinen sınırlar

Kabul kanıtları:

- EO-01-A repository boundary: docs/EO_01A_REPOSITORY_BOUNDARY.md
- EO-01-B stack/manifest/CI: docs/EO_01B_OFFICIAL_STACK_MANIFEST_CI.md
- EO-01-C preview shell: docs/EO_01C_THREE_ROUTE_PREVIEW_SHELL.md
- Kabul commit'leri master contract ve Execution Plan içinde kayıtlıdır.
- Repository test, typecheck, build ve ürün sahibi görsel kabulü PASS olmuştur.

Bilinen sınırlar:

- OAuth ve token vault EO-03 kapsamıdır.
- Provider adapter'ları EO-04 kapsamıdır.
- Dataset V2 ve scheduler EO-05 kapsamıdır.
- Gerçek Funnel, Ad Analysis ve Settings uygulaması EO-07 kapsamıdır.
- Production cutover bu paket tarafından yetkilendirilmez.

## 10. Tek sonraki parent

EO-01'in tek sonraki parent'ı **A6-EO-02 — Workspace, installation, billing/trial and privacy foundations** paketidir.
