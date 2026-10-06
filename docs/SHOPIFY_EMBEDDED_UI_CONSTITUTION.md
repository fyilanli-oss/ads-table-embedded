# AdsTable Shopify Embedded UI Anayasası

**Durum:** Bağlayıcı — 30 Eylül 2026  
**Kapsam:** Shopify Admin içinde görünen bütün AdsTable sayfaları, navigation, settings, setup, OAuth dönüşü, modal, form, durum, buton ve responsive davranışları  
**Üst otorite:** `codex-input/AdsTable_EXECUTION_PLAN_V4_2026-08-17_TR.md`

## 1. Temel karar

AdsTable bir Shopify Public Embedded App'tir. Shopify Admin içindeki arayüz ikinci bir AdsTable tasarım sistemi değildir. UI yalnız Shopify App Bridge ve ürün sahibi tarafından açıkça onaylanmış güncel App Home Polaris web component sürümü ile kurulur.

**Ürün sahibi runtime kararı — 6 Ekim 2026:** Yeni embedded-only uygulamanın preview ve hedef production baseline'ı `polaris-2.0-rc.js` ve onunla eşleşen exact `@shopify/polaris-types@2.0.0-rc.2` paketidir. Shopify bu hattın release candidate olduğunu ve soak döneminde değişebileceğini bildirir. Bu bilinçli ürün kararı otomatik olarak stable 1.x'e geri çevrilemez. Stable `polaris-2.0.js` yayımlandığında geçiş; güncel resmî doküman, type/runtime eşleşmesi, desktop ve gerçek mobil kabul ve açık ürün sahibi kararıyla yapılır.

Shopify iframe uygulamanın teknik taşıyıcısıdır; özel görünüm üretme izni değildir. Merchant, AdsTable'ı Shopify'dan kopuk bir web sitesi gibi görmemelidir.

## 2. Otorite sırası

Çelişki halinde sıra şöyledir:

1. Execution Plan ve açık kullanıcı kararı
2. Bu anayasa
3. `contracts/shopify/shopify-embedded-ui-constitution-v1.json`
4. İlgili E10/R karar belgesi ve executable contract
5. Onaylı analist brief'i ve component mapping
6. Kod ve test

Kod veya eski ekran görüntüsü üstteki kararlara aykırıysa referans değil, düzeltilmesi gereken teknik borçtur.

## 3. İzin verilen yapı

- Layout, card/section, divider, stack/grid/box, title, text, icon, badge, banner, button/button group, modal, form alanı ve navigation için yalnız resmî Shopify componentleri kullanılır.
- Component adı, property, variant, tone, spacing ve responsive davranış implementasyon günü güncel resmî Shopify kaynağından doğrulanır.
- Referans ekran görüntüsü ürün niyetini ve Shopify standardını gösterir; görünüm özel CSS ile kopyalanmaz. Uygun resmî component/variant seçilir.
- App navigation ve sayfa başlığı App Bridge'in resmî navigation/title yetenekleriyle yönetilir. Aynı route için `Dashboard / Settings` gibi uydurma ikinci breadcrumb üretilmez.
- `Connected` gibi durumlar resmî status componentiyle; `Disconnect` gibi destructive eylemler resmî button'ın documented critical/destructive semantiğiyle gösterilir.
- Mobil ve desktop aynı bilgi mimarisini taşır. Shopify componentlerinin doğal responsive davranışı esas alınır; ayrı özel mobil UI sistemi kurulmaz.

Resmî dayanaklar:

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/web-components
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- https://shopify.dev/docs/api/app-home-ui-extension/latest/web-components/feedback-and-status-indicators/badge
- https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components
- https://shopify.dev/docs/api/polaris/using-polaris-web-components
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning

Shopify'ın güncel resmî rehberi `s-clickable` bileşenini, button/link ile çözülemeyen özel durumlar için bir **escape hatch** olarak tanımlar. Bu nedenle standart bir eylemi button gibi göstermek için `s-clickable` kullanmak yasaktır.

## 4. Kesin yasaklar

- Raw `<button>`, `<input>`, `<select>`, `<form>` veya `<dialog>` ile embedded kontrol üretmek
- Özel button, badge, card, modal, form, navigation veya status componenti yazmak
- Inline `style`, `<style>`, literal hex/rgb/hsl renk, özel class ile renk/gölge/border/radius/ölçü taklit etmek
- Shopify'ın resmî componentini CSS ile başka bir component görünümüne çevirmek
- `s-clickable` ile Connect, Resume setup, Disconnect, Reporting account, Update spend veya Change value button'ı taklit etmek
- Tasarım kararını ekran görüntüsünden renk örnekleyerek veya “yakın görünür” tahminiyle vermek
- Yalnız desktop ekranına bakarak responsive kabul vermek
- Kullanıcı akışı çalıştığı için görsel/Shopify-native kabulü otomatik PASS saymak
- Kanıt olmadan Execution Plan'da `Done`, `PASS` veya `Accepted` yazmak

Resmî component ihtiyacı karşılamıyorsa geliştirici kendi karşılığını uydurmaz. İş durur; analist kararı ve contract revizyonu istenir.

## 5. Her UI taskından önce zorunlu analist brief'i

Koddan önce aşağıdakiler yazılı olmalıdır:

- İş amacı ve kullanıcı sonucu
- Başlangıç, başarı, cancel, loading, empty, error ve reconnect durumları
- Exact görünen metinler ve eylemler
- Desktop ve mobil yerleşim beklentisi
- Her görünür öğe için exact Shopify component/property/variant eşlemesi
- Doğrulanan resmî Shopify linki ve doğrulama tarihi
- Değişmeyecek backend/OAuth/data davranışı
- Kapsam dışı maddeler
- Kabul adımları ve gerekli kanıt

Bu alanlardan biri eksikse implementation başlamaz.

## 6. Merge ve tamamlanma kapıları

Bir Shopify embedded UI paketi ancak şu koşulların tamamı sağlanırsa merge edilebilir ve tamamlandı sayılabilir:

1. Anayasa guard testi PASS.
2. İlgili UI contract testi PASS.
3. Ham HTML kontrolü, özel CSS, literal renk ve taklit component yok.
4. Desktop Shopify Admin gerçek oturum kanıtı PASS.
5. En az 320 px gerçek mobil Shopify Admin kanıtı PASS.
6. Loading, empty, error, cancel ve başarılı durumlar test edilmiş.
7. OAuth değişiyorsa dönüş route'u, resume setup, account selection ve modal cancel bağımsız test edilmiş.
8. Kullanıcı/ürün sahibi açık kabul vermiş.
9. Execution Plan yalnız bu kanıtlardan sonra güncellenmiş.

Screenshot yalnız kanıttır; kullanıcı istemedikçe repository'ye kopyalanmaz. Kanıt için gereksiz dosya üretimi yapılmaz.

## 7. Mevcut Settings durumu

`main` üzerindeki `e9cd2490f1e9a9c70213baf3f47feba8c264380f` sürümünde Settings eylemleri için `s-clickable`, inline style ve `#FDE8E7` literal rengi kullanılmıştır. Mobil görünümde button/status ölçüsü ve yerleşimi Shopify referansıyla uyumlu değildir.

Bu durum **kabul edilmiş tasarım değildir** ve R7-B6 görsel kabulü `FAIL / corrective work required` durumundadır. Bu anayasa paketi Settings UI kodunu değiştirmez; yalnız ihlali görünür kılar ve yeni ihlal eklenmesini engeller. Düzeltme ayrı, kısa ve kanıta dayalı UI paketi olacaktır.

## 8. Değişiklik yönetimi

Bu anayasa ancak açık kullanıcı/ürün kararı, Execution Plan kaydı ve executable contract/test güncellemesiyle değiştirilebilir. Bir task veya ajan kendi başına istisna üretemez.

## 9. Karar geçmişi

- 30 Eylül 2026 development RC kararı legacy repository bağlamında alınmıştı.
- 6 Ekim 2026 EO-01-B'deki stable 1.1 seçimi, aynı gün ürün sahibinin açık kararıyla EO-01-C kapsamında supersede edildi; aktif baseline Polaris 2.0 RC'dir.
- Bu değişiklik legacy uygulamanın runtime'ını değiştirmez; yalnız yeni `ads-table-embedded` repository'sinin baseline'ını belirler.
