## 29 Ekim 2026 — Onaylı kararlı Polaris 2.0 hizalaması

#262 main’e birleşti (284c789715342786e972f912e5a57d253b1c7001). Ürün sahibi açıklama tasarımını ve sabit polaris-2.0.js + exact @shopify/polaris-types@2.0.0 geçişini açıkça onayladı. Sunucu ShopifyApp ve AppProvider aynı merkezi runtime değerini kullanır; paket ve lock birlikte değiştirilir. Resmî Shopify sürümleme kaynağı 2026-10-29 kontrol edildi: https://shopify.dev/docs/api/app-home/latest/web-components/versioning.

Bu kayıt yalnız kod referansını hizalar. Gerçek Shopify Admin masaüstü ve en az 320 px gerçek mobil görsel kabulü bekliyor; yeni modal/route veya izin aktivasyonu tamamlandı sayılmaz. Shopify üzerinde ajan görsel işlem yapmaz. Canlı config/deploy/izin/token/DB değişikliği yok. Eski RC kararları tarihsel kayıttır; güncel sürüm seçimi kararlı 2.0’dır. 15 başlamadı, 22 duraklatılmış, 23 Dataset/FX yazımıdır.

# İzin öncesi açıklamalar — inceleme tasarımı

29 Ekim 2026 · EO-05 / mevcut 07 · dördüncü teknik teslim

Bu belge kullanıcının göreceği beş açıklamayı aynı kurala bağlar. Henüz ekran kodu, canlı izin istemi veya görsel kabul değildir. Ürün ekranlarının mevcut İngilizce dili korunur; aşağıdaki İngilizce bloklar birebir ekran metnidir. Makine karşılığı: `contracts/eo-05-permission-explanation-design-v1.json`.

## Her açıklamada aynı davranış

Başlık → neden gerekli olduğu → hangi erişimin gerektiği → **Cancel / Connect**.

Açıklamayı açmak izin istemez. **Cancel**, kapatma veya Escape, Connect öncesinde yalnız açıklamayı kapatır. Connect bir kez basılınca açıklama kapanır, bağlantı başlatılır ve ikinci istem engellenir. Bundan sonra sağlayıcının kendi izin ekranı devreye girer; başlamış işlem iptal edildi diye varsayılmaz.

Dönüşte gerçek izin ve gerekli hesap/katalog erişimi sunucuda okunur. Eksik adımda **Resume setup** yalnız o adıma götürür: izin, hesap seçimi, katalog seçimi veya Klaviyo maliyet girişi. Her eksik adım yeniden OAuth başlatmaz.

## Connect Shopify products

Ürün ve varyant okuma temel ürün kurulumu için gerekli; sipariş erişimi bu isteme eklenmez.

> Allow AdsTable to read your products and variants to match product reporting to your Shopify catalog.
>
> Product access is required to finish product setup. Order access is optional and will be requested separately when you choose an order-based feature.

**Cancel** · **Connect**

## Connect Shopify orders

Son siparişler ve satın alınan ürünlerle atıf karşılaştırması; isteğe bağlı, Products izni korunur, kesin çift sayım vaat edilmez.

> Allow AdsTable to read recent orders and purchased products to compare Shopify sales with marketing attribution.
>
> Order access is optional. Cancelling does not change your existing product connection.
>
> Order access helps investigate attribution overlap; it does not, by itself, confirm duplicate attribution for individual orders.

**Cancel** · **Connect**

## Connect Google Ads and Merchant Center

Ads ve Merchant birlikte gerekli. Merchant olmadan kurulum eksik kalır. Google izninin genişliği ile AdsTable’ın okuma amacı ayrı anlatılır.

> Allow AdsTable to read your advertising data and catalog to match product reporting.
>
> Both Google Ads and Merchant Center access are needed to finish this connection. You need an accessible Merchant Center account, including for Search-only setups.
>
> Google permissions may also allow changes. AdsTable uses this connection to read data and does not edit your campaigns or catalog.

**Cancel** · **Connect**

## Connect Meta ads and catalog

Reklam hesabı ve katalog birlikte gerekli; işletme/Sayfa izinleri de görünür. Yönetim izinlerinin genişliği gizlenmez, ürün/satış ayrımı vaat edilmez.

> Allow AdsTable to read advertising data and the catalog available to your selected business.
>
> Both ad account and catalog access are needed to finish setup. You may also see business and Page permissions.
>
> Some business and catalog permissions also allow changes. AdsTable uses this connection for reporting and product matching; it does not edit those assets.

**Cancel** · **Connect**

## Connect Klaviyo

Mevcut beş okuma izni; aylık tahmin ayrı adım, sıfır geçerli. Maliyet eksikliği yeniden OAuth istemez.

> Allow AdsTable to read account details and campaign, flow, metric and event data for reporting.
>
> After connecting, add your estimated monthly Klaviyo cost to finish setup. Enter 0 if you have no monthly cost.
>
> The cost is entered separately in AdsTable. If you leave it incomplete, use Resume setup to finish it later.

**Cancel** · **Connect**

## Sonuçların aynı dili konuşması

| Durum | Ekranda görünen | Davranış |
|---|---|---|
| Başlangıç okuması | Checking connection status… | Bağlı diye varsaymaz; izin istemez. |
| Kullanıcı Connect dedi | Starting connection… | Tek istek; açıklama kasıtlı kapanır, hide olayı iptal sayılmaz. |
| Sağlayıcıdan dönüş | Verifying access… | Gerçek izin ve hesap/varlık kontrolü. |
| İzin eksik | Resume setup | Önce açıklama yeniden açılır; yalnız yeni Connect ile izin istenir. |
| Hesap/raporlama hesabı/katalog seçimi eksik | Resume setup | Seçim adımı; yeniden OAuth yok. |
| Klaviyo tahmini maliyet eksik | Resume setup | Mevcut maliyet adımı; 0 geçerli, eksik ayrı. |
| İsteğe bağlı Orders yok | Order access is not connected. Your product connection is unchanged. | Products durumu korunur; Orders açıklaması ancak kullanıcı isterse. |
| Yalnız erişim doğrulandı | Access verified. Setup is awaiting activation. | Genel Connected veya veri işi yetkisi üretmez. |
| Sonuç belirsiz | We could not confirm the result. Check the connection status before starting again. | Check status yalnız okur; otomatik tekrar/silme/alternatif rota yok. |
| Geliştirici onayı/yayın kapısı eksik | Connection setup is not available yet. | Close; kullanıcıdan yeniden izin isteyerek geliştirici eksikliği kapatılmaz. |

İlk bağlantı tamamlanmamışken Connected gösterilmez. Önceden çalışan raporlama bağlantısı varsa yeni eksik ürün kurulumu onu kendiliğinden silmez. Orders izni, eski sipariş/korumalı veri erişimi ve tekil sipariş Overlap kanıtı ayrı şeylerdir. Bu açıklamalar reklam/ürün kimliği/Sales Role kurallarını değiştirmez.

## Resmî Shopify bileşenleri

| Görünür öğe | Bileşen ve seçilen özellik | Kaynak (29 Ekim) |
|---|---|---|
| Overlay and title | `s-modal` — heading=modal.heading; size=base; padding=base | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal) |
| Paragraph grouping | `s-stack` — direction=block; gap=base | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/stack) |
| Explanation and cancellation note | `s-paragraph` — children=exact paragraph text; no lineClamp, custom style or color | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/typography-and-content/paragraph) |
| Primary confirmation | `s-button` — slot=primary-action; variant=primary; children=Connect; loading=true only while dispatching; disabled=pending or server gate closed | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Cancel | `s-button` — slot=secondary-actions; variant=secondary; commandFor=matching modal id; command=--hide; children=Cancel | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Open explanation | `s-button` — commandFor=matching modal id; command=--show; children=Existing Connect/Resume setup trigger label | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button) |
| Status/error feedback | `s-banner` — tone=info for pending; warning for missing; critical for error; no success from partial evidence; heading=exact state copy | [Resmî belge](https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner) |

Özel CSS, ham HTML kontrolü, özel kart/modal/rozet veya literal renk yok. Metin kesilmez. Modalın doğal kaydırması ve resmî action slotları kullanılır; en az 320 px gerçek mobilde bütün metin ve eylemler erişilebilir olmalıdır. Klavye, dokunma, odak giriş/geri dönüş ve tek açık modal ayrıca doğrulanır.

## Tarihsel tasarım önerisi — yukarıdaki 29 Ekim onayıyla sonuçlandı

Repository’nin 6 Ekim’de açıkça seçilmiş referansı hâlâ `polaris-2.0-rc.js` + `2.0.0-rc.2` tipleridir. Son AGENTS metni kararlı bileşen ister. 29 Ekim resmî kontrolünde **kararlı Polaris 2.0** ve **2.0.0 tipleri** mevcut: resmî sabit `polaris-2.0.js` dosyası HTTP 200, npm resmî latest tipi 2.0.0. [Shopify sürümleme belgesi](https://shopify.dev/docs/api/app-home/latest/web-components/versioning), sürüm ile tiplerin birlikte değiştirilmesini ve RC dosyasının kendiliğinden kararlıya dönüşmediğini açıklar.

Önerilen somut hedef: `https://cdn.shopify.com/shopifycloud/polaris-2.0.js` ve exact `@shopify/polaris-types@2.0.0`; otomatik ilerleyen kanal yerine sabit 2.0. Bu tasarım sürümü, paketleri, lock dosyasını veya runtime’ı değiştirmez. UI anayasası geçiş için açık ürün sahibi kararı istediğinden bu karar ekran kodundan önce netleştirilmelidir. Önerilen özelliklerin kurulu RC manifestinde de bulunması, geçiş veya görsel kabul kanıtı değildir.

## Değişmeyecekler ve kabul

Bu tasarım Google/Meta/Klaviyo/Shopify izin setini, OAuth sunucu kapılarını, mevcut hesap seçimlerini, aylık maliyet formülünü veya Dataset’i değiştirmez. Yeni yüzey yok; yalnız mevcut `/` ve `/settings` içindeki kurulum girişi planlanır. Overlap rapor butonunun kesin yeri raporlama tasarımında kalır. Merchant/işletme/katalog seçici uygulaması ve kalıcı kaynak/kanıt bağları bu metin tasarımıyla tamamlanmış sayılmaz.

Metin/akış incelemesinden sonra onaylı sürüme uygun ekran kodu hazırlanır. Gerçek Shopify Admin masaüstü, en az 320 px gerçek mobil, yükleniyor/iptal/hata/dönüş/sürdürme ve ürün sahibinin açık görsel kabulü alınmadan UI işi birleştirilmiş veya Done/PASS ilan edilmez. Kullanıcının Shopify’da görsel otomasyon yapılmaması talimatı korunur; gerçek oturum kanıtı kullanıcı tarafından sağlanır. Canlı izin/config/deploy açılışı ayrıca kendi kapısındadır. 15 başlamadı; 22 duraklatılmış; Dataset/FX yazımı 23’te.
