## OAuth — işlem öncesi zorunlu açık kullanıcı onayı (29 Ekim 2026)

**OAuth’a doğrudan veya dolaylı değen hiçbir çalışma, yapılacak somut işlem ve kapsam açıklanıp kullanıcıdan önceden açık izin alınmadan başlatılamaz.** Tüm sağlayıcılar ve Shopify dahildir.

- İnceleme/araştırma, akış ve ekran tasarımı, izin/kapsam, hesap/Reporting Account/Merchant/işletme/katalog seçimi veya bağlantıları bu kapıya tabidir.
- Kod, test, sözleşme, migration, config, callback/token/oturum, canlı çağrı, temizlik/kaldırma/geri alma/refactor, deploy ve merge de dahildir. Düzeltme veya geri alma amacı kendiliğinden izin oluşturmaz.
- Genel “devam edelim”, genel onay, önceki başka iş/merge onayı veya önceki plan kararı OAuth yetkisi değildir. Onay yalnız açıkça belirtilen somut iş ve kapsam için geçerlidir. Kapsam değişecekse durulur ve yeni açık izin alınır.
- Bu kapı, OAuth için önceki bağımsız kodlama veya izole test ilerleme izinlerinin önündedir; teknik olanak, başarılı test, geri alınabilirlik veya ajan takdiri yerine geçmez.
- #264 kullanıcı tarafından reddedilen katalog seçim adımı nedeniyle durdurulmuştur; merge yetkisi yoktur. Katalog seçimi kodu temizlenmedi veya değiştirilmedi. Temizlik de ayrı açık izin bekler.
- Bu kuralın AGENTS ve bağlayıcı belgelere kaydı kullanıcı tarafından açıkça istendi. Bu izin yalnız kural kaydına aittir; OAuth inceleme/kodlama/test/temizlik veya provider işlemi yetkisi vermez.

# AdsTable Shopify gömülü arayüz anayasası

**Durum:** Bağlayıcı — 30 Eylül 2026
**Kapsam:** Shopify Admin içinde görünen bütün AdsTable sayfaları, gezinme, Settings, kurulum, OAuth dönüşü, modal, form, durum, buton ve ekran boyutuna uyum davranışları
**Güncel üst otorite:** `docs/EXECUTION_PLAN.md` ve açık ürün sahibi kararları
**Taşınmış kaynağın tarihsel üst otorite kaydı:** `codex-input/AdsTable_EXECUTION_PLAN_V4_2026-08-17_TR.md`

> Bu belge eski repository'den gelen ilkeleri, 6 Ekim runtime seçimini ve 7 Ekim grafik sınırını birlikte taşır. Güncel paket sırası `docs/EXECUTION_PLAN.md`, yürütülebilir ana sözleşme `contracts/a6-eo-implementation-master-v1.json` içindedir. Eski ekran kusuru bugünkü uygulama kusuru veya yeni iş yetkisi sayılmaz. Bu dil düzenlemesi UI kodunu, sürümü, kabul durumunu veya canlı ortamı değiştirmez.

**Güncel runtime seçimi — 29 Ekim 2026:** Ürün sahibi sabit `polaris-2.0.js` ve exact `@shopify/polaris-types@2.0.0` geçişini açıkça onayladı. Resmî sürümleme belgesi aynı gün doğrulandı. Runtime ve tipler birlikte hizalanır. Bu seçim canlı yayın veya görsel kabul değildir; gerçek Shopify Admin masaüstü ve en az 320 px gerçek mobil kabulü hâlâ zorunludur. Aşağıdaki 6 Ekim kararı tarihsel kayıttır.

## 1. Temel karar

AdsTable, Shopify Admin içine gömülü çalışan bir Public Embedded App'tir. Admin içindeki arayüz ikinci bir AdsTable tasarım sistemi değildir. Arayüz yalnız Shopify App Bridge ve ürün sahibinin açıkça onayladığı güncel App Home Polaris web component sürümüyle kurulur. Web component, Shopify'ın sunduğu arayüz bileşenidir; teknik bileşen ve özellik adları çevrilmez.

**Tarihsel ürün sahibi runtime kararı — 6 Ekim 2026 (29 Ekim sürüm seçimiyle güncellendi):** Yeni gömülü uygulamanın Preview ve hedef Production referansı `polaris-2.0-rc.js` ile birebir eşleşen `@shopify/polaris-types@2.0.0-rc.2` paketidir. Runtime uygulamanın çalışan sürümünü, type paketi bileşenlerin tip tanımlarını ifade eder. Shopify bu hattın release candidate, yani kararlı sürüm adayı olduğunu ve gözlem döneminde değişebileceğini bildirir. Bu bilinçli karar otomatik olarak stable 1.x'e geri çevrilemez. Kararlı `polaris-2.0.js` yayımlandığında geçiş; güncel resmî dokümantasyon, type/runtime eşleşmesi, masaüstü ve gerçek mobil kabul, açık ürün sahibi kararı gerektirir.

Shopify iframe uygulamanın teknik taşıyıcısıdır; özel görünüm üretme izni değildir. Mağaza sahibi AdsTable'ı Shopify'dan kopuk bir web sitesi gibi görmemelidir.

## 2. Otorite sırası

Çelişki halinde sıra şöyledir:

1. Execution Plan ve açık kullanıcı kararı.
2. Bu anayasa.
3. `contracts/shopify/shopify-embedded-ui-constitution-v1.json`.
4. İlgili karar belgesi ve yürütülebilir sözleşme. Eski E10/R belgeleri yalnız tarihsel referanstır; güncel EO otoritesinin yerine geçmez.
5. Onaylı analist özeti ve bileşen eşlemesi.
6. Kod ve test.

Kod veya eski ekran görüntüsü üstteki kararlara aykırıysa referans değil, düzeltilmesi gereken teknik borçtur.

## 3. İzin verilen yapı

- Yerleşim, kart/bölüm, ayırıcı, yığın/ızgara/kutu, başlık, metin, simge, rozet, bildirim, buton/buton grubu, modal, form alanı ve gezinme için yalnız resmî Shopify bileşenleri kullanılır.
- Bileşen adı, property, variant, tone, spacing ve farklı ekran boyutlarındaki davranış uygulama günü güncel resmî Shopify kaynağından doğrulanır. Bunlar kodda kullanılacak teknik özellik kimlikleridir.
- Referans ekran görüntüsü ürün niyetini ve Shopify standardını gösterir; görünüm özel CSS ile kopyalanmaz. Uygun resmî bileşen/varyant seçilir.
- Uygulama gezinmesi ve sayfa başlığı App Bridge'in resmî gezinme/başlık yetenekleriyle yönetilir. Aynı yol için `Dashboard / Settings` gibi uydurma ikinci gezinme izi üretilmez.
- `Connected` gibi durumlar resmî durum bileşeniyle; `Disconnect` gibi yıkıcı eylemler resmî butonun belgelenmiş critical/destructive anlamıyla gösterilir.
- Mobil ve masaüstü aynı bilgi mimarisini taşır. Shopify bileşenlerinin doğal ekran uyumu esas alınır; ayrı özel mobil arayüz sistemi kurulmaz.

Resmî dayanaklar:

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/web-components
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- https://shopify.dev/docs/api/app-home-ui-extension/latest/web-components/feedback-and-status-indicators/badge
- https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components
- https://shopify.dev/docs/api/polaris/using-polaris-web-components
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning

Shopify'ın resmî rehberi `s-clickable` bileşenini, button/link ile çözülemeyen özel durumlar için istisnai çıkış yolu olarak tanımlar. Standart bir eylemi buton gibi göstermek için `s-clickable` kullanmak yasaktır.

## 4. Kesin yasaklar

- Ham `<button>`, `<input>`, `<select>`, `<form>` veya `<dialog>` ile gömülü kontrol üretmek.
- Özel buton, rozet, kart, modal, form, gezinme veya durum bileşeni yazmak.
- Satır içi `style`, `<style>`, doğrudan hex/rgb/hsl renk veya özel class ile renk/gölge/kenarlık/köşe/ölçü taklit etmek.
- Shopify'ın resmî bileşenini CSS ile başka bileşen görünümüne çevirmek.
- `s-clickable` ile Connect, Resume setup, Disconnect, Reporting account, Update spend veya Change value butonu taklit etmek. Bu İngilizce adlar mevcut ekran eylemlerinin kimliğidir; bu pakette ekran metinleri çevrilmez.
- Tasarım kararını ekran görüntüsünden renk örnekleyerek veya “yakın görünür” tahminiyle vermek.
- Yalnız masaüstüne bakarak ekran uyumu kabulü vermek.
- Kullanıcı akışı çalışıyor diye görsel/Shopify'a özgü kabulü otomatik PASS saymak.
- Kanıt olmadan Execution Plan'da `Done`, `PASS` veya `Accepted` yazmak.

Resmî bileşen ihtiyacı karşılamıyorsa geliştirici kendi karşılığını uydurmaz. İş durur; analist kararı ve sözleşme değişikliği istenir.

## 5. Her arayüz işinden önce zorunlu analist özeti

Koddan önce aşağıdakiler yazılı olmalıdır:

- İş amacı ve kullanıcı sonucu.
- Başlangıç, başarı, iptal, yükleniyor, boş, hata ve yeniden bağlanma durumları.
- Birebir görünen metinler ve eylemler.
- Masaüstü ve mobil yerleşim beklentisi.
- Her görünür öğe için birebir Shopify bileşen/property/variant eşlemesi.
- Doğrulanan resmî Shopify bağlantısı ve doğrulama tarihi.
- Değişmeyecek sunucu/OAuth/veri davranışı.
- Kapsam dışı maddeler.
- Kabul adımları ve gerekli kanıt.

Bu alanlardan biri eksikse uygulama başlamaz.

## 6. Birleştirme ve tamamlanma kapıları

Shopify gömülü arayüz paketi ancak bütün koşullar sağlanırsa birleştirilebilir ve tamamlanmış sayılır:

1. Anayasa koruma testi PASS.
2. İlgili arayüz sözleşme testi PASS.
3. Ham HTML kontrolü, özel CSS, doğrudan renk ve taklit bileşen yok.
4. Masaüstü Shopify Admin gerçek oturum kanıtı PASS.
5. En az 320 px gerçek mobil Shopify Admin kanıtı PASS.
6. Yükleniyor, boş, hata, iptal ve başarı durumları test edilmiş.
7. OAuth değişiyorsa dönüş yolu, kurulum sürdürme, hesap seçimi ve modal iptali bağımsız test edilmiş.
8. Kullanıcı/ürün sahibi açık kabul vermiş.
9. Execution Plan yalnız bu kanıtlardan sonra güncellenmiş.

Ekran görüntüsü yalnız kanıttır; kullanıcı istemedikçe repository'ye kopyalanmaz. Kanıt için gereksiz dosya üretilmez.

## 7. Eski Settings tespiti — tarihsel kayıt

Eski repository'nin `main` dalındaki `e9cd2490f1e9a9c70213baf3f47feba8c264380f` sürümünde Settings eylemleri için `s-clickable`, satır içi style ve `#FDE8E7` doğrudan renk değeri kullanılmıştı. Mobilde buton/durum ölçüsü ve yerleşimi Shopify referansıyla uyumlu değildi.

Bu **kabul edilmiş tasarım değildi**. O aşamadaki R7-B6 görsel kabulü `FAIL / corrective work required`, yani düzeltme gerekli durumundaydı. Anayasa kaydı Settings kodunu değiştirmedi; ihlali görünür kıldı, yeni ihlali engelledi ve ayrı kanıtlı düzeltme gerektirdi.

Bu eski tespit, yeni `ads-table-embedded` uygulamasının bugünkü Settings durumunu anlatmaz. Eski R7-B6 için yeni kabul üretmez; güncel uygulamanın kabulü kendi Execution Plan ve kanıt kayıtlarından okunur.

## 8. Değişiklik yönetimi

Anayasa yalnız açık kullanıcı/ürün kararı, Execution Plan kaydı ve yürütülebilir sözleşme/test güncellemesiyle değiştirilebilir. Bir görev veya ajan kendi başına istisna üretemez. Bu Türkçe dil düzenlemesi yeni istisna veya arayüz uygulaması değildir.

## 9. Karar geçmişi

- 30 Eylül 2026 geliştirme RC kararı eski repository bağlamında alındı.
- 6 Ekim 2026 EO-01-B'deki stable 1.1 seçiminin yerine aynı gün açık ürün sahibi kararıyla EO-01-C kapsamında Polaris 2.0 RC geçti.
- Bu karar eski uygulamanın runtime'ını değiştirmez; yalnız yeni `ads-table-embedded` repository'sinin referans sürümünü belirler.

## 10. Analitik grafik çizim düzlemi istisnası

**Ürün sahibi kararı — 7 Ekim 2026:** Funnel ilişki grafiklerinin yalnız veri çizim düzleminde SVG veya Canvas kullanılabilir. Bu dar istisna Shopify görünümünü taklit etme izni değildir.

İzinli çizim öğeleri: Eksenler, seri çizgileri ve alanları, veri noktaları/işaretleri, kılavuzlar, grafik içi lejant, doğrudan veri etiketleri ve bunların erişilebilir seçim/hedef mekanikleri.

Sayfa kabuğu, başlıklar, tarih/karşılaştırma/filtre kontrolleri, butonlar, formlar, KPI özetleri, bölüm/kart yapısı, tablolar, modal/açılır panel, durum/veri güncelliği, gezinme ve yükleniyor/boş/hata yüzeyleri istisna dışındadır; resmî Polaris/App Bridge bileşeni olmak zorundadır. Grafik ayrıntısı yalnız fareyle üzerine gelmeye bağlanamaz. Klavye ve dokunma desteği, erişilebilir başlık/açıklama veya tablo eşdeğeri, renk dışı seri ayrımı ve azaltılmış hareket tercihi desteği zorunludur.

Grafik, seçili nokta ayrıntısı, KPI özeti ve tablo aynı BFF/sorgu sonucu ile aynı formül otoritesini kullanır. Sayısal veya durum anlamındaki fark kabul hatasıdır. Grafik rengi veri kodlamasıdır; erişilebilirlik ve tema kabulü geçmeden onaylanamaz. Ad Analysis aynı çizim sınırını ancak A6-EO-07-C kanıtı ve ayrı kabul edilmiş grafik özeti sonrasında kullanabilir.
