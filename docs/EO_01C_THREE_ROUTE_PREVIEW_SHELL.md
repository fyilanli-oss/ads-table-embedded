# EO-01-C — Üç adresli, gerçeğe uygun önizleme kabuğu

## Analist açıklaması

### İş amacı ve kullanıcı sonucu

Yeni embedded-only uygulamanın üç yetkili ürün adresi ilk kez çalışan Vercel önizlemesinde görünür. Ekranlar bağlantı, veri veya tamamlanmış ürün davranışı iddia etmez.

Bu belge EO-01-C'nin 6 Ekim 2026 tarihindeki hazırlık ve kabul kaydıdır. Buradaki ekran metinleri ve “yok” ifadeleri bugünkü ürün durumu değildir. Güncel durum Execution Plan'dan okunur.

### Kabul edilen görünür metin ve durumlar

Aşağıdaki İngilizce değerler kabul edilmiş ekran metinleridir; dokümantasyon çevirisi uygulamanın görünen metinlerini değiştirmez.

| Uygulama adresi | Sayfa başlığı | Bölüm başlığı | Verisiz durumdaki özgün ekran metni |
|---|---|---|---|
| `/` | Funnel | Reporting preview | No reporting data is available in this preview. Connections and data loading will be added in later EO packages. |
| `/ad-analysis` | Ad Analysis | Analysis preview | No advertising analysis is available in this preview. No provider data has been requested or inferred. |
| `/settings` | Settings | Configuration preview | Connections and configuration are not available in this preview. Existing accounts, tokens, and settings remain unchanged. |

Bu pakette asenkron işlem ve veri değiştirme yoktur. Yükleniyor (Loading), iptal (cancel) ve başarı (success) durumları uygulanamaz; bağlı (connected) durum iddia edilmez. Kök hata sınırı yalnız önizleme sayfasının açılamadığını ve hiçbir verinin değiştirilmediğini söyler.

### Shopify bileşen eşlemesi

| Görünür öğe | Tam bileşen adı | Özellik | Kaynak |
|---|---|---|---|
| Sayfa | `s-page` | `heading` | https://shopify.dev/docs/api/app-home/latest |
| İçerik grubu | `s-section` | `heading` | https://shopify.dev/docs/api/app-home/latest |
| Metin | `s-paragraph` | — | https://shopify.dev/docs/api/app-home/latest |
| Önizleme adreslerinin sırası | `s-stack` | `direction=inline`, `gap=base` | https://shopify.dev/docs/api/app-home/latest/web-components |
| Adres bağlantısı | `s-link` | `href` | https://shopify.dev/docs/api/app-home/latest/web-components |

Tarihsel kontrol tarihi: **6 Ekim 2026**. Ürün sahibinin açık kararıyla çalışma zamanı `polaris-2.0-rc.js`, tam tip paketi `@shopify/polaris-types@2.0.0-rc.2` olarak eşlenir. Özel CSS, ham HTML eylem kontrolü ve doğrudan renk değeri kullanılmaz. Shopify'ın RC değişim riski kabul edilir; kararlı 1.x'e otomatik geri dönüş yapılmaz.

`2.0.0-rc.2` 5 Ekim 2026'da yayımlandığı için pnpm'in 24 saatlik asgari yayımlanma yaşı kapısında yalnız bu resmî Shopify paketi için dar istisna kayıtlıdır. Diğer tedarik zinciri kontrolleri değişmez.

## Görsel kabul kanıtı — 6 Ekim 2026

- Kaynak commit: `622fcc8ebdef8df852ec4c345143335126144f9f`
- Vercel önizleme dağıtımı: `dpl_BiCqUCRDcYD3kUifEw7wztgufTsm`
- `/`, `/ad-analysis`, `/settings`: HTTP 200
- Canlı yanıtta tek Polaris çalışma zamanı: `polaris-2.0-rc.js`; `polaris-1.js`: yok
- Masaüstü ve 320 px mobil teknik görünüm kontrolü: PASS
- Ürün sahibi görsel kabulü: 6 Ekim 2026 tarihinde alındı
- Bu tarihsel kayıt anında merge: ayrı açık kullanıcı onayı bekliyor

### Vercel eşlemesi

Vercel'in resmî React Router önayarı `@vercel/react-router@1.3.7` ile sunucuda oluşturulan sayfaların (SSR) derlemesi hazırlanır. Yeni proje Git entegrasyonu ve Production'a yükseltme olmadan oluşturulur; yalnız görev dalı commit'inden önizleme dağıtımı üretilir.

Tarihsel resmî kaynaklar:

- https://vercel.com/docs/frameworks/frontend/react-router
- https://vercel.com/docs/deployments
- https://vercel.com/docs/cli/deploy

### Değişmeyecek davranış ve kapsam dışı

- Shopify OAuth/oturum yönetimi yok.
- Supabase veya başka veritabanı yok.
- Meta, Google Ads ve Klaviyo isteği yok.
- Ortam değişkenlerinde gizli bilgi yok.
- Production dağıtımı, alan adı veya App URL değişikliği yok.
- EO-07'nin nihai görsel ürün uygulaması yok.

### Kabul ve geri alma

Testler, tür kontrolü, derleme ve GitHub CI geçer. Üç önizleme adresi HTTP 200 döner; masaüstü ve 320 px mobil görüntü kullanıcıya sunulur. Kullanıcının görsel kabulü ve ayrı merge onayı olmadan paket tamamlanmaz. Geri alma, önizleme dağıtımının ve görev dalının kaldırılmasıdır; Production etkisi yoktur.
