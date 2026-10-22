# PD ve CPD sorgu çalışma tablosu

Tarih: 22 Ekim 2026. Durum: çalışma referansı sabitlendi; nihai ortak tasarım kabulü değildir.

Ürün sahibi mevcut üç sağlayıcılı tablo düzeninin korunmasını ve Meta bölümündeki son düzeltmelerin kaydedilmesini istedi. Google ve Klaviyo satırları önceki mesaj içi tablonun envanter kaydıdır; bu kayıtla yeniden doğrulanmış veya kabul edilmiş sayılmaz.

## Açık karar

**Meta PD Ad ile CPD Channel performansının aynı Ad ölçümlerini kullanması henüz ürün sahibi tarafından kabul edilmedi.** Tablodaki iki satır mevcut öneriyi gösterir. Ürün sahibi Google incelemesinden sonra kabul edecek veya itiraz edecek. Bu konu kapatılmış, standardizasyon tamamlanmış veya uygulama yetkisi verilmiş sayılmaz.

## Hücrelerin anlamı

- **Var:** Sorguda isteniyor. Yanıtta dolu geldiği veya koda/DB'ye işlendiği anlamına gelmez.
- **Yok:** Mevcut sorguda istenmiyor. Sağlayıcı sunmuyor demek değildir.
- **KD:** İlgili satırın metrik kapsamı dışında.
- **Ad kayıtlarından hiyerarşik toplam:** Üst seviye metriklerin oluşma biçimi; sorgu eksiği değildir. Çalışan toplama kodu kabulü anlamına gelmez.
- Session sütunu ürün sahibi kararıyla çıkarılmıştır.
- Kodda işleme eksikleri hücrede “Yok” olarak gösterilmez; numaralı notlara yazılır.

## Sorgu tablosu

| Provider | Tüketici | Akış / Level | Impression | Click | Spend | ATC | ATC Value | Checkout | Checkout Value | Satış adedi / türü | Satış değeri / türü |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Meta | PD | Campaign | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Ad Set | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Ad | Var: `impressions` | Var | Var: `spend` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` |
| Meta | CPD | Channel performansı — Ad | Var: `impressions` | Var | Var: `spend` | KD | KD | KD | KD | Var³: `actions` | Var³: `action_values` |
| Meta | CPD | Ürün performansı — Ad × ürün | Var: `impressions` | Var: `clicks` | Var: `spend` | KD | KD | KD | KD | Var: `converted_product_quantity` | Var: `converted_product_value` |
| Meta | CPD | Ürün satış ilişkisi | KD | KD | KD | KD | KD | KD | KD | Var¹: `converted_promoted_product_quantity` | Var²: `converted_promoted_product_value` |
| Google Ads | PD | Campaign × conversion action | Yok | Yok | Yok | Eşleme yok⁴ | Eşleme yok⁴ | Eşleme yok⁴ | Eşleme yok⁴ | Var: `conversions`, `all_conversions` | Var: `conversions_value`, `all_conversions_value` |
| Google Ads | PD | Search / Shopping — Ad Group | Var | Var | Var: `cost_micros` | Yok | Yok | Yok | Yok | Var: `conversions` | Var: `conversions_value` |
| Google Ads | PD | Search / Shopping — Ad ayrı sorgusu | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok |
| Google Ads | PD | Retail PMax — Asset Group | Var | Var | Var: `cost_micros` | Yok | Yok | Yok | Yok | Var: `conversions` | Var: `conversions_value` |
| Google Ads | CPD | Channel — Ad Group / Asset Group | Var | Var | Var | KD | KD | KD | KD | Var: `conversions` | Var: `conversions_value` |
| Google Ads | CPD | Ürün performansı | Var | Var | Var | KD | KD | KD | KD | Var: `conversions` | Var: `conversions_value` |
| Google Ads | CPD | Ürün satış ilişkisi — cart data | Yok | Yok | Yok | KD | KD | KD | KD | Var: `units_sold`, lead / cross-sell ve `all_*` | Var: `revenue_micros`, lead / cross-sell ve `all_*` |
| Klaviyo | PD | Campaign / Flow — ayrı üst seviye sorgusu | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok |
| Klaviyo | PD | Campaign Message / Flow Message | Eşleme yok⁵ | Var: `clicks`, `clicks_unique` | Yok | Yok | Yok | Yok | Yok | Var: `conversions`, `conversion_uniques` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | CPD | Channel — Message | Eşleme yok⁵ | Var | Yok | KD | KD | KD | KD | Var: Placed Order dönüşümleri | Var: Placed Order değeri |
| Klaviyo | CPD | Message × ürün — ayrı performans sorgusu | Yok | Yok | Yok | KD | KD | KD | KD | Yok | Yok |
| Klaviyo | CPD | Ürün satış ilişkisi — Ordered Product | Yok | Yok | Yok | KD | KD | KD | KD | `event_properties` içinde `Quantity` okunuyor | `event_properties` içinde `$value` okunuyor |

## Meta test notları

¹ `converted_promoted_product_quantity`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

² `converted_promoted_product_value`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

22 Ekim testinde seçilen iş tarihi 1 Ekim 2026 idi. Ad sorgusu 1, ürün kırılımı 0 satır döndürdü. Tam ham yanıt saklanmadı; bu kayıt ham yanıtın yerine geçmez. Boş ürün sonucu desteklenmiyor veya gerçek sıfır demek değildir. Dört `converted_product_*` / `converted_promoted_product_*` quantity/value alanı talep listesinde korunur.

## Koda eklenecek

³ Sorguda istenen `actions` ve `action_values` içinden ATC, Checkout ve Purchase adet/değerlerinin ilgili standart metriklere işlenmesi tamamlanacak. Bu bir sorgu eksiği değildir.

¹ ve ² ile işaretli alanlar mevcut kodda yalnız test seçeneğiyle isteniyor. Standart ürün sorgusunda kalıcı istenmesi gelecek kod değişikliğidir; bu belge o değişikliği yapmaz.

## Google ve Klaviyo önceki tablo notları

⁴ Google Campaign sorgusunda conversion action kimliği, kategorisi, dönüşüm sayıları ve değerleri isteniyor. ATC/Checkout/Purchase eşlemesi tamamlanmış veya `conversions` doğrudan Purchase kabul edilmiş değildir. Google hücreleri önceki tablo hâliyle korunmuştur; kendi incelemesinde durum ifadeleri netleştirilecek.

⁵ Klaviyo sorgusunda `recipients`, `delivered`, `opens`, `opens_unique` isteniyor; bunlardan PD Impression karşılığı seçilmiş değildir. “Eşleme yok”, native `impressions` alanı var demek değildir. Klaviyo hücreleri önceki tablo hâliyle korunmuştur; kendi incelemesinde durum ifadeleri netleştirilecek.

Google ve Klaviyo satırları kendi incelemelerinde güncellenecek; Meta için alınan hiyerarşik toplam veya alan kararları bu sağlayıcılara kendiliğinden uygulanmaz.

## Yetki ve sonraki adım

Önce üç sağlayıcının teorik sorgu standardı netleştirilecek; kod ve DB bundan sonra ele alınacak. Bu kayıt runtime, DB, provider çağrısı, OAuth, deploy veya merge yetkisi vermez. Shopify üzerinde görsel işlem yapılmayacak.

Bağlayıcı üst belgeler `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` olarak kalır. Bu çalışma referansı yürütülebilir sözleşmeleri değiştirmez.
