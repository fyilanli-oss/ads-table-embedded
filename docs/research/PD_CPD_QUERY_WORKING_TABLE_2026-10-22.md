# PD ve CPD sorgu çalışma tablosu

Tarih: 22 Ekim 2026. Durum: çalışma referansı sabitlendi; nihai ortak tasarım kabulü değildir.

Ürün sahibi mevcut üç sağlayıcılı tablo düzeninin korunmasını ve Meta bölümündeki son düzeltmelerin kaydedilmesini istedi. Google bölümü ürün sahibinin sonraki kararlarıyla güncellenmiştir. Klaviyo bölümü de ürün sahibinin kabul ettiği seçimlerle sabitlenmiştir; teknik uygulama ve açık Spend hesabı tamamlanmış sayılmaz.

## Kabul edilen hedef ve açık uygulama

CPD Channel, üç sağlayıcıda da PD genel değerlerinin kopyası değil, bağlı ürün metriklerinin toplamıdır. 23 Ekim 2026 envanter 01 uyumunda Meta Channel hücreleri de bu hedefe hizalanmıştır. Bu toplam ve bağlantılar henüz uygulanmış kabul edilmez; envanter 17–19 kontrolü ve ilgili sağlayıcı bağlantı işleri açıktır. Kabul edilen hedeflerin ortak sözleşmesi `contracts/pd-cpd-query-standard-v1.json`; sağlayıcı runtime sözleşmeleri mevcut sorgu durumunu korur.

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
| Meta | CPD | Channel performansı | Ad | Ürün kayıtlarından toplam — hedef | Ürün kayıtlarından toplam — hedef | Ürün kayıtlarından toplam — hedef | KD | KD | KD | KD | Ürün satış adetleri toplamı — hedef | Ürün satış değerleri toplamı — hedef |
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
| Google Ads | CPD | Ürün satış ilişkisi | Cart data | KD | KD | KD | KD | KD | KD | KD | Var: `units_sold`, lead / cross-sell — normal esas; `all_*` ham kaynak | Var: `revenue_micros`, lead / cross-sell — normal esas; `all_*` ham kaynak |
| Klaviyo | PD | Campaign | Campaign | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Açık⁷ | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Klaviyo | PD | Campaign | Campaign Message | Var: `delivered` | Var: `clicks` | Açık⁷ | Yok⁸ | Yok⁸ | Yok⁸ | Yok⁸ | Var: `conversions` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | PD | Flow | Flow | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Açık⁷ | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam | Alt kayıtlardan hiyerarşik toplam |
| Klaviyo | PD | Flow | Flow Message | Var: `delivered` | Var: `clicks` | Açık⁷ | Yok⁸ | Yok⁸ | Yok⁸ | Yok⁸ | Var: `conversions` — Placed Order | Var: `conversion_value` — Placed Order |
| Klaviyo | CPD | Campaign — Channel performansı | Campaign Message | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁹ | Ürün satış değerleri toplamı⁹ |
| Klaviyo | CPD | Flow — Channel performansı | Flow Message | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Ürün satış adetleri toplamı⁹ | Ürün satış değerleri toplamı⁹ |
| Klaviyo | CPD | Ürün performansı | Message × ürün | N/A¹⁰ | N/A¹⁰ | Açık⁷ | KD | KD | KD | KD | Var⁹: `Quantity` | Var⁹: `$value` |
| Klaviyo | CPD | Ürün satış ilişkisi | Ordered Product → Message | KD | KD | KD | KD | KD | KD | KD | Var⁹: `Quantity` | Var⁹: `$value` |

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

## Google normal kapsam kararı

08. madde, 22 Ekim 2026 ürün sahibi onayıyla netleşti; 23 Ekim 2026 tarihinde çalışma tablosuna aktarıldı. Karar netleşti; runtime eşlemeleri ve kabul testleri açık.

- PD satış adedi/değeri: normal `conversions` / `conversions_value` içinden Purchase ayrımı. Genel dönüşüm toplamı doğrudan satış sayılmaz.
- CPD satılan ürün adedi/geliri: normal `units_sold` / `revenue_micros`. Sales Role aynı normal kapsamdaki lead/cross-sell adet ve gelir alanlarına dayanır.
- `all_*` alanları standart PD/CPD sonuçlarına eklenmez; normal alan eksikse bunlarla otomatik tamamlama yapılmaz. Ham kaynakta korunmaları bu seçimi değiştirmez.
- PD Purchase sayısı ile CPD ürün adedi eşit sayılmaz. CPD Channel bağlı ürünlerden oluşur; PD genel Ad/Ad Group/Asset Group değeri ürün toplamı yerine geçirilmez.
- Search Ad, Shopping Ad Group ve Retail PMax Asset Group seviyeleri korunur; Campaign değerleri aşağı kopyalanmaz.
- Kabul testleri yalnız normal, yalnız `all_*`, iki ailenin farklı değerleri, eksik normal alan, gerçek sıfır ve çelişkili rol kanıtını ayırır. Çift sayım ve kanıtsız rol üretimi olmaz.

Resmî metrik tanımları, kontrol 23 Ekim 2026: [Google Ads API v25 Metrics](https://developers.google.com/google-ads/api/reference/rpc/v25/Metrics). Kaynak metrik tanımlarını destekler; normal kapsamı seçmek AdsTable ürün kararıdır.

## Google teknik işler ve ertelenen değerlendirme

⁴ **Sorguya eklenecek teknik talepler:** Search Ad seviyesindeki dokuz metrik ile Shopping Ad Group ve Retail PMax Asset Group seviyelerinde eksik ATC/Checkout adet-değer talepleri. Bunlar sorgulanmış veya destek uyumu ayrı ayrı doğrulanmış sayılmaz; mevcut satırlar sorgu talebi ve uygulama eksiğini ayırır.

⁵ **Koda eklenecek:** Dönüşüm aksiyonuna göre Purchase adet/değer ayrımı. `conversions` doğrudan Purchase veya satılan ürün adedi değildir. Ürün performansındaki bu ham alanlar CPD satış miktarı olarak yeniden adlandırılmaz; satılan adet/değer için satış ilişkisi kayıtları kullanılır.

⁶ **Hedef toplam ve bağlantı:** CPD Channel ürün toplamları tasarım kararıdır; çalışan toplam veya tamamlanmış ürün→Channel bağlantısı değildir. Spend/click tekrar sayımı ve ürün kapsamı kontrolü uygulama değerlendirmesinde ele alınacak. Search Ad performansına satış dönüşümü bağlanabilmesi, satılan Product ID'nin de bağlandığını kanıtlamaz.

Açık bağlantılar kaybolmadan ertelenmiştir: Search→Ad ürün satış bağlantısı tamam değil; Shopping ürün performansında Ad Group kimliği var ancak cart data satışında Ad Group kimliği istenmiyor; PMax ürün performansı Asset Group'a bağlanmamış; PMax satış çözümleyicisi yazılmış ancak reporting akışında çağrılmıyor. Bu kayıtlar yeni sağlayıcı kısıtlaması değil, 22 Ekim kaynak incelemesinde görülen kod durumudur.

**İş sırası:** Klaviyo sorgu seçimleri sabitlendi. Sıradaki iş, üç sağlayıcının eksiklerini birlikte değerlendirerek doğal olarak sonraya bırakılmış işler, atlanmış/yanlış kurulmuş işler ve yeni tasarım nedeniyle değişecek işleri ayırmaktır. Bu kayıt eksik kodları uygulama yetkisi vermez.

## Klaviyo kabul edilen sorgu seçimleri

- PD Impression karşılığı `delivered`: teslim edilen mesaj sayısıdır, fiziksel görüntülenme kanıtı değildir. `recipients`, `opens` ve `opens_unique` artık bu standart sütun için alternatif değildir; kaynakta korunmaları bu seçimi değiştirmez.
- PD Click `clicks`: toplam tıklama. `clicks_unique` standart Click yerine kullanılmayacak.
- PD Purchase `conversions`, seçili Shopify `Placed Order` metriğinin olay sayısıdır. Değer `conversion_value` alanından gelir; `conversion_uniques` standart Purchase yerine kullanılmayacak.
- CPD satılan ürün adedi `event_properties.Quantity`, satış değeri `event_properties.$value` kaynağından alınır. Sipariş dönüşümü sayısı ve satılan ürün miktarı ayrı tutulur.
- Campaign → Campaign Message ve Flow → Flow Message hiyerarşileri korunur. Channel bağlantı kimlikleri Campaign Message ID ve Flow Message ID'dir. Mevcut `variation` ayrıntısı Message kimliğinin yerine geçirilmez.
- Campaign ve Flow üst metrikleri mesaj kayıtlarından hiyerarşik toplam hedefidir. Spend bu toplam kararına otomatik maliyet hesabı eklemez; ayrıca açık kalır.

## Klaviyo açık işler ve kapsam kararları

23 Ekim rol düzeltmesi (PR #166): Campaign mesaj içeriğinde bulunma, tıklanan ürün kanıtı değildir; içerikteki ve dışındaki ürünler yalnız mesaj atfıyla Assisted kalır. Advertised/Cross-sell için satışa bağlı doğrulanmış ürün etkileşimi gerekir; bu kanıt yolu henüz uygulanmadı. Flow Triggered ve çelişkili kanıtta Unclassified sınırı korunur.

⁷ **Spend açık:** Ürün sahibi şu aşamada hesaplama yapılmamasını, maliyet hesabının sonraki ortak değerlendirmeye bırakılmasını istedi. Önceki estimated-spend/ledger çalışmaları tamamlanmış raporlama hesabı yerine konulmaz. Bu belge yeni formül veya ürün maliyeti dağıtımı belirlemez.

⁸ **Teknik sorgu eklemesi:** Campaign Message ve Flow Message seviyelerinde ATC/Checkout adet ve değerlerinin conversion metric talepleri eklenecek; mevcut Placed Order sorgusunun bu dört alanı karşıladığı varsayılmayacak. Üst Campaign/Flow kayıtları bu mesaj kaynaklarının toplamıdır.

⁹ **Ortak ürün satış kaynağı:** Ordered Product olayındaki Quantity ve $value hem ürün performansı hem ürün satış ilişkisini besleyebilir; iki ayrı satış sayılarak toplanmaz. Channel ürün satış toplamları aynı kayıtları bir kez sayar. Bu, kimlik eşlemesi, tarih/attribution kapsamı veya Dataset bağlantılarının tamamlandığı iddiası değildir; bu işler sonraki ortak değerlendirmede ele alınacak.

¹⁰ **N/A kapsam kararı:** Klaviyo CPD ürün Impression ve Click bu aşamada kapsam dışında bırakıldı; ürün link tıklamasını Product ID'ye eşleme veya ürün gösterimi çıkarma geliştirmesi yapılmayacak. N/A sıfır veya sağlayıcının kesinlikle desteklemediği demek değildir. Ürün esaslı CPD Channel bu alanlar için mesaj delivered/click değerini kopyalamaz; bu yüzden ilgili Channel hücreleri de N/A'dır. PD mesaj delivered/click ölçümleri korunur.

## Klaviyo resmî kaynaklar

Kontrol tarihi: 22 Ekim 2026.

- [Reporting API tanımları](https://developers.klaviyo.com/en/reference/reporting_api_overview#available-statistics): delivered, clicks, conversions ve conversion_value anlamları.
- [Link ve ürün satış raporları](https://help.klaviyo.com/hc/en-us/articles/115005258568): link bazlı tıklama ve ürün satışı için Ordered Product ayrımı.
- [Events API](https://developers.klaviyo.com/en/reference/get_events): olay özellikleri kaynağı. Kaynak varlığı N/A kapsam kararını değiştirmez.

## Birlikte ele alınacak maddeler

23 Ekim 2026 son kullanıcı incelemesine sunulan çalışma gruplarıdır. Mevcut 24 numara korunur; yeni EO paketi veya toplu uygulama yetkisi oluşmaz. 01–16 kaynak/kimlik/rol tasarımı ve düzeltmeleri; 17–19 bütünleşik tasarım kontrolü; ardından mevcut EO-05/06 paket sırası korunur. Gruplar tek dev PR zorunluluğu değildir; sağlayıcı ve kanıt sınırlarında küçük teslimlere bölünebilir.

| Maddeler | Birlikte yapılacak iş | Sıra ve sınır |
| --- | --- | --- |
| 01 | Sözleşme uyumu | Önce ortak karar ve alan sözleşmesi. Her grupta güncel tutulur; EO-04 düzeltmeleri ile EO-05/06 sahiplikleri karıştırılmaz. |
| 02, 03 | Meta sorgu ve metrik eşlemeleri | 02 + 03 birlikte: promoted alanları ve PD Click/funnel eşlemeleri. EO-04-B düzeltmesi; 24 ile sorgu ve yanıt kanıtı. Kalıcı Dataset yazımı bu grupta yok. |
| 06, 07, 08 | Google sorgu ve normal kapsam | 06 + 07 + 08 birlikte: Search Ad, Shopping/PMax funnel ve normal kapsam Purchase/ürün satış eşlemeleri. EO-04-C düzeltmesi; alan birleşimi doğrulaması ve 24 kabulü. |
| 13, 14 | Klaviyo sorgu ve metrik eşlemeleri | 13 + 14 birlikte: kabul edilen PD alanları ve Message ATC/Checkout talepleri. EO-04-D düzeltmesi; ürün Impression/Click N/A ve Spend açık kalır. |
| 04, 09, 10, 11, 12, 16 | Kaynak ve kimlik bağlantıları | 04 + 09 + 10 + 11 + 12 + 16 birlikte tasarlanır. Provider bağlantı düzeltmeleri EO-04; 16 kalıcı kimlik modeli EO-05-B. 11 tarihsel PMax çalışması ayrı açık onay olmadan başlamaz; kanıtsız Channel atanmaz. |
| 05, 15 | Satış ilişkisi ve Sales Role | 05 + 15 birlikte: Meta ve Klaviyo kanıt/rol kuralları. Google rolü 08 normal kapsam kararıyla uyumlu kalır. Kaynak/kimlik kanıtlarına bağlı EO-04-B/D düzeltmeleri; tek ortak rol tanımı. |
| 17, 18, 19 | Bütünleşik tasarım kontrolü | 17 + 18 + 19 birlikte tasarım kontrolü; provider gruplarından sonra. Bağımsız PD/CPD, üst hiyerarşi ve ürün esaslı Channel onayı. Kayıt/yayın EO-05-B; aggregate-first hesaplama EO-06-A. Paketler erkene alınmaz. |
| 20, 22 | Dataset ve FX | 20 + 22 birlikte EO-05-B: Dataset aileleri, anahtarlar, kaynak para birimi ve FX izi; 16 kimlik tasarımını kullanır. 20'nin idempotent upsert/düzeltme kısmı EO-05-D'de, 21 ile birlikte ele alınır. |
| 21 | Tarih ve uzlaştırma | 21: EO-05-C'de attribution/olgunluk; EO-05-D'de 20'nin tekrar yazma ve düzeltme kısmıyla birlikte. 20'nin veri modeliyle karıştırılmaz; Klaviyo tarih ve gün sınırı testleri korunur. |
| 23 | Formula Engine | 23 ayrı EO-06-A sırasında uygulanır. 20 + 22 ile veri/FX sözleşmesi birlikte tasarlanır; formül kodu erkene alınmaz. 18/19 aggregate-first kuralları kullanılır. Klaviyo Spend için yeni formül onaylanmış değildir. |
| 24 | Her aşamada kanıt ve kabul | 24 tüm gruplara eşlik eder; sona bırakılmaz. Her grubun sorgu/ham yanıt, tamlık, tekrar ve hata testleri; EO-08 sonundaki gerçek hesap kontrolü ayrı kapıdır. Canlı çağrı ayrıca açık yetki gerektirir. |

20'nin veri modeli EO-05-B, idempotent upsert ve uzlaştırması EO-05-D sahibindedir. 16, 20, 21, 22 ve 23'ün mevcut paket kapıları korunur. EO-05-A kapanışı veya EO-05-B başlangıcı verilmez. 11'in durdurulmuş tarihsel kanıt işi kendiliğinden açılmaz; kanıtsız Channel için geçerli satış korunur.

## Yetki ve sonraki adım

Önce üç sağlayıcının teorik sorgu standardı netleştirilecek; kod ve DB bundan sonra ele alınacak. Bu kayıt runtime, DB, provider çağrısı, OAuth, deploy veya merge yetkisi vermez. Shopify üzerinde görsel işlem yapılmayacak.

Bağlayıcı üst belgeler `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` olarak kalır. Bu çalışma referansı yürütülebilir sözleşmeleri değiştirmez.
