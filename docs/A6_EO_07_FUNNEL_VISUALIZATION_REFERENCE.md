# A6-EO-07-B — Funnel görselleştirme referansı

**Durum:** Ürün niyeti kabul edildi; uygulama ve görsel kabul bekliyor

**Karar tarihi:** 7 Ekim 2026

**Sahibi:** A6-EO-07-B

**Yetki sınırı:** Bu referans rota, kod, sağlayıcı, veritabanı, dağıtım veya paket durumu değişikliğine izin vermez.

**Okuma notu:** Bu, kabul edilmiş grafik niyetinin kaydıdır; uygulanmış ekran kanıtı değildir. Güncel iş sırası `docs/EXECUTION_PLAN.md` içindedir. Tarihsel kaynak kontrolü yeni sürüm seçimi veya görsel kabul sayılmaz.

## Ürün niyeti

Funnel App Home, birbirinden kopuk grafikler yerine ilişkileri gösteren iki görselleştirme modu içerir. Metrik ve ekran adları teknik kimlik olarak korunur.

### Performance

Grafikteki ana seriler:

- Sales
- Revenue
- Spend

Destekleyici KPI ve seçili nokta ayrıntısı alanları:

- Impressions
- Clicks
- Spend
- CTR
- CPC
- Sales
- ROAS
- CPS
- Revenue
- Revenue Margin

Kullanıcıya gösterilen kanonik terim **Sales** olur. İç metrik anahtarı `sales_value` kalabilir.

### Intent

Grafikteki ana adet serileri:

- Add to Cart
- Checkout
- Abandoned
- Purchase

Seçili nokta ayrıntıları ve özetler adet ile değer alanlarını birlikte gösterebilir. Clicks ve Spend destekleyici bağlam olabilir. Adet ve parasal değer hiçbir zaman birbirine karıştırılmaz.

## Karşılaştırma davranışı

- Mevcut dönem düz, karşılaştırma dönemi kesik çizgiyle gösterilir.
- Karşılaştırma A6-EO-06 kurallarını kullanır: eşit takvim günü, örtüşmeme, aynı çalışma alanı zaman dilimi ve uyumlu para birimi kökeni.
- Daily görselleştirme mevcut 31 günlük sorgu sınırına tabidir.
- `zero`, `unknown`, `unsupported`, `partial`, `stale` ve `provisional` ayrı kalır.
- Olumlu yön metrik sözleşmesinden gelir: Sales, Revenue, ROAS, Revenue Margin, CTR, Purchase, Add to Cart ve Checkout artışı ancak A6-EO-06 bunu doğrularsa olumludur. CPC, CPS, Abandoned ve Abandoned Value düşüşü olumludur. Spend değişimi sonuç bağlamı olmadan nötrdür.
- Sıfır veya kullanılamayan paydadan uydurma yüzde üretilmez.

## Tek veri otoritesi

Grafik, seçili nokta ayrıntısı, KPI kartları/özetleri ve ilgili Funnel tablosu aynı BFF/sorgu sonucu ve formül otoritesinin gösterimleridir. Filtre, tarih, zaman dilimi, para birimi, destek durumu ve güncellik kökeni eşleşmelidir. Her eşlik farkı kabul hatasıdır.

## Shopify bileşeni ve çizim sınırı

Yüzeyin tamamında resmî Shopify App Bridge ve Polaris 2.0 RC bileşenleri zorunlu kalır. SVG veya Canvas yalnız grafik veri düzleminde; eksen, seri, işaret, kılavuz, grafik lejantı, doğrudan veri etiketi ve erişilebilir seçim hedefleri için kullanılabilir.

SVG/Canvas ile sayfa kabuğu, kontrol, KPI özeti, bölüm/kart, tablo, filtre, modal/popover, buton, form, durum/güncellik, gezinme veya yükleniyor/boş/hata UI'sı oluşturulamaz. Bunlar birebir resmî Polaris bileşenleridir.

Temel bilgi yalnız fareyle üzerine gelmeye bağlı olamaz. Klavye, dokunma, ekran okuyucu başlık/açıklaması veya tablo eşdeğeri, renk dışı seri ayrımı, azaltılmış hareket ve gerçek Shopify Admin mobil 320 px kabulü zorunludur.

## Ad Analysis sınırı

Bu referans Ad Analysis grafiğine yetki vermez. A6-EO-07-C her sağlayıcı için en alt analiz öğesini ve iki ürün/cross-sell örneğini kanıtlayana kadar Ad Analysis grafik işi kapalıdır. Daha sonra kabul edilmiş ayrı grafik brief'i bu dar çizim sınırını kullanabilir.

## 7 Ekim 2026 tarihinde kontrol edilen resmî kaynaklar

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/web-components
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/tooltip

## Kabul kapıları

Uygulama bekliyor. Kabul; sözleşme testleri, uygulama günü birebir bileşen doğrulaması, grafik/tablo/KPI eşliği, durum kapsamı, erişilebilirlik, masaüstü ve gerçek 320 px Shopify Admin kanıtı ile açık ürün sahibi onayı gerektirir.
