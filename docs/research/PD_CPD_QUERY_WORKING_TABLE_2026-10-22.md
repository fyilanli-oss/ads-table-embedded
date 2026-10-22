# PD ve CPD sorgu çalışma tablosu

Tarih: 22 Ekim 2026. Durum: çalışma referansı sabitlendi; nihai ortak tasarım kabulü değildir.

Ürün sahibi mevcut üç sağlayıcılı tablo düzeninin korunmasını ve Meta bölümündeki son düzeltmelerin kaydedilmesini istedi. Google bölümü ürün sahibinin sonraki kararlarıyla güncellenmiştir. Klaviyo satırları önceki mesaj içi tablonun envanter kaydıdır; incelemesi sıradadır.

## Açık karar

**Meta PD Ad ile CPD Channel performansının aynı Ad ölçümlerini kullanması henüz ürün sahibi tarafından kabul edilmedi.** Google incelemesinden sonra kabul edecek veya itiraz edecek yönündeki önceki açık karar korunur. Sonraki görüşmede CPD Channel'ın Ad genel değerleri yerine bağlı ürün metriklerinin toplamını temsil etmesi kararlaştırılmıştır. Meta hücrelerinin bu yeni anlama göre revizyonu ve kod eksikleri, Klaviyo tablosundan sonraki ortak değerlendirmede ele alınacaktır; mevcut Meta ham kaynak hücreleri bu karara uygun tamamlanmış uygulama değildir.

## Hücrelerin anlamı

- **Var:** Sorguda isteniyor. Yanıtta dolu geldiği veya koda/DB'ye işlendiği anlamına gelmez.
- **Yok:** Mevcut sorguda istenmiyor. Sağlayıcı sunmuyor demek değildir.
- **KD:** İlgili satırın metrik kapsamı dışında.
- **Ad kayıtlarından hiyerarşik toplam:** Üst seviye metriklerin oluşma biçimi; sorgu eksiği değildir. Çalışan toplama kodu kabulü anlamına gelmez.
- Session sütunu ürün sahibi kararıyla çıkarılmıştır.
- Kodda işleme eksikleri hücrede “Yok” olarak gösterilmez; numaralı notlara yazılır.

## Sorgu tablosu

| Provider | Tüketici | Akış | Level | Impression | Click | Spend | ATC | ATC Value | Checkout | Checkout Value | Satış adedi / türü | Satış değeri / türü |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meta | PD | Reklam | Campaign | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Reklam | Ad Set | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam | Ad kayıtlarından hiyerarşik toplam |
| Meta | PD | Reklam | Ad | Var: `impressions` | Var | Var: `spend` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` | Var³: `actions` | Var³: `action_values` |
| Meta | CPD | Channel performansı | Ad | Var: `impressions` | Var | Var: `spend` | KD | KD | KD | KD | Var³: `actions` | Var³: `action_values` |
| Meta | CPD | Ürün performansı | Ad × ürün | Var: `impressions` | Var: `clicks` | Var: `spend` | KD | KD | KD | KD | Var: `converted_product_quantity` | Var: `converted_product_value` |
| Meta | CPD | Ürün satış ilişkisi | Ad × ürün | KD | KD | KD | KD | KD | KD | KD | Var¹: `converted_promoted_product_quantity` | Var²: `converted_promoted_product_value` |
| Google Ads | PD | Search | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Search | Ad Group | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Search | Ad | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ |
| Google Ads | PD | Shopping | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Shopping | Ad Group | Var | Var | Var: `cost_micros` | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Var⁵: `conversions` | Var⁵: `conversions_value` |
| Google Ads | PD | Retail PMax | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Google Ads | PD | Retail PMax | Asset Group | Var | Var | Var: `cost_micros` | Yok⁴ | Yok⁴ | Yok⁴ | Yok⁴ | Var⁵: `conversions` | Var⁵: `conversions_value` |
| Google Ads | CPD | Search — Channel performansı | Ad | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Shopping — Channel performansı | Ad Group | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Retail PMax — Channel performansı | Asset Group | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | Ürün kayıtlarından toplam⁶ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁶ | Ürün satış değerleri toplamı⁶ |
| Google Ads | CPD | Ürün performansı | Ürün kırılımı | Var | Var | Var | KD | KD | KD | KD | Var⁵: `conversions` — dönüşüm sayısı | Var⁵: `conversions_value` — dönüşüm değeri |
| Google Ads | CPD | Ürün satış ilişkisi | Cart data | KD | KD | KD | KD | KD | KD | KD | Var: `units_sold`, lead / cross-sell ve `all_*` | Var: `revenue_micros`, lead / cross-sell ve `all_*` |
| Klaviyo | PD | Önceki envanter — Klaviyo incelemesi bekliyor | Campaign / Flow — ayrı üst seviye sorgusu | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok | Yok |
| Klaviyo | PD | Önceki envanter — Klaviyo incelemesi bekliyor | Campaign Message / Flow Message | Eşleme yok⁷ | Var: `clicks`, `clicks_unique` | Yok | Yok | Yok | Yok | Yok | Var: `conversions`, `conversion_uniques` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | CPD | Önceki envanter — Klaviyo incelemesi bekliyor | Channel — Message | Eşleme yok⁷ | Var | Yok | KD | KD | KD | KD | Var: Placed Order dönüşümleri | Var: Placed Order değeri |
| Klaviyo | CPD | Önceki envanter — Klaviyo incelemesi bekliyor | Message × ürün — ayrı performans sorgusu | Yok | Yok | Yok | KD | KD | KD | KD | Yok | Yok |
| Klaviyo | CPD | Önceki envanter — Klaviyo incelemesi bekliyor | Ürün satış ilişkisi — Ordered Product | Yok | Yok | Yok | KD | KD | KD | KD | `event_properties` içinde `Quantity` okunuyor | `event_properties` içinde `$value` okunuyor |

## Meta test notları

¹ `converted_promoted_product_quantity`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

² `converted_promoted_product_value`: hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor.

22 Ekim testinde seçilen iş tarihi 1 Ekim 2026 idi. Ad sorgusu 1, ürün kırılımı 0 satır döndürdü. Tam ham yanıt saklanmadı; bu kayıt ham yanıtın yerine geçmez. Boş ürün sonucu desteklenmiyor veya gerçek sıfır demek değildir. Dört `converted_product_*` / `converted_promoted_product_*` quantity/value alanı talep listesinde korunur.

## Koda eklenecek

³ Sorguda istenen `actions` ve `action_values` içinden ATC, Checkout ve Purchase adet/değerlerinin ilgili standart metriklere işlenmesi tamamlanacak. Bu bir sorgu eksiği değildir.

¹ ve ² ile işaretli alanlar mevcut kodda yalnız test seçeneğiyle isteniyor. Standart ürün sorgusunda kalıcı istenmesi gelecek kod değişikliğidir; bu belge o değişikliği yapmaz.

## Google tasarım kararları

- Search PD hiyerarşisi Campaign → Ad Group → Ad; Channel bağlantı kimliği Ad ID.
- Shopping PD hiyerarşisi Campaign → Ad Group; Channel bağlantı kimliği Ad Group ID. Shopping Ad satırı çıkarılmıştır; bu seviyeye sorgu eklenmeyecek.
- Retail PMax PD hiyerarşisi Campaign → Asset Group; Channel bağlantı kimliği Asset Group ID.
- Search Ad Group/Campaign, Shopping Campaign ve Retail PMax Campaign için dokuz metrik de alt kayıtlardan hiyerarşik toplamdır. Campaign'e ait yardımcı conversion-action sorgusu hiyerarşi seviyesi değildir; onun mevcudiyeti yeni hedef toplam kuralını değiştirmez.
- PD Purchase, sağlayıcının satın alma dönüşümü sayısıdır. CPD satılan adet, ürün satış miktarıdır; aynı ölçüm değildir.
- CPD Channel ürün esaslıdır: bağlı ürünlerin metrik toplamlarını gösterir; PD Ad/Ad Group/Asset Group genel değerleri CPD ürün toplamlarının yerine konulmaz.
- Ürün satış değeri ile sağlayıcının genel dönüşüm değerinin vergi/kargo kapsamı eşit varsayılmaz. Kullanıcı örneği: 3.000 ürün + 600 vergi + 300 kargo = 3.900; 300 spend ile genel değer ROAS 13, ürün geliri ROAS 10. Bu açıklama örneği sağlayıcının her yanıtta aynı kapsamı döndürdüğü iddiası değildir.

## Google teknik işler ve ertelenen değerlendirme

⁴ **Sorguya eklenecek teknik talepler:** Search Ad seviyesindeki dokuz metrik ile Shopping Ad Group ve Retail PMax Asset Group seviyelerinde eksik ATC/Checkout adet-değer talepleri. Bunlar sorgulanmış veya destek uyumu ayrı ayrı doğrulanmış sayılmaz; mevcut satırlar sorgu talebi ve uygulama eksiğini ayırır.

⁵ **Koda eklenecek:** Dönüşüm aksiyonuna göre Purchase adet/değer ayrımı. `conversions` doğrudan Purchase veya satılan ürün adedi değildir. Ürün performansındaki bu ham alanlar CPD satış miktarı olarak yeniden adlandırılmaz; satılan adet/değer için satış ilişkisi kayıtları kullanılır.

⁶ **Hedef toplam ve bağlantı:** CPD Channel ürün toplamları tasarım kararıdır; çalışan toplam veya tamamlanmış ürün→Channel bağlantısı değildir. Spend/click tekrar sayımı ve ürün kapsamı kontrolü uygulama değerlendirmesinde ele alınacak. Search Ad performansına satış dönüşümü bağlanabilmesi, satılan Product ID'nin de bağlandığını kanıtlamaz.

Açık bağlantılar kaybolmadan ertelenmiştir: Search→Ad ürün satış bağlantısı tamam değil; Shopping ürün performansında Ad Group kimliği var ancak cart data satışında Ad Group kimliği istenmiyor; PMax ürün performansı Asset Group'a bağlanmamış; PMax satış çözümleyicisi yazılmış ancak reporting akışında çağrılmıyor. Bu kayıtlar yeni sağlayıcı kısıtlaması değil, 22 Ekim kaynak incelemesinde görülen kod durumudur.

**İş sırası:** Önce Klaviyo sorgu tablosu tamamlanacak. Sonra üç sağlayıcı birlikte değerlendirilerek doğal olarak sonraya bırakılmış işler, atlanmış/yanlış kurulmuş işler ve yeni tasarım nedeniyle değişecek işler ayrılacak. Bu aşamada eksik kodları uygulamaya başlanmayacak.

## Klaviyo önceki tablo notu

⁷ Klaviyo sorgusunda `recipients`, `delivered`, `opens`, `opens_unique` isteniyor; bunlardan PD Impression karşılığı seçilmiş değildir. Önceki envanter satırları içerik olarak korunmuştur; Klaviyo incelemesinde netleştirilecek.

## Yetki ve sonraki adım

Önce üç sağlayıcının teorik sorgu standardı netleştirilecek; kod ve DB bundan sonra ele alınacak. Bu kayıt runtime, DB, provider çağrısı, OAuth, deploy veya merge yetkisi vermez. Shopify üzerinde görsel işlem yapılmayacak.

Bağlayıcı üst belgeler `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` olarak kalır. Bu çalışma referansı yürütülebilir sözleşmeleri değiştirmez.
