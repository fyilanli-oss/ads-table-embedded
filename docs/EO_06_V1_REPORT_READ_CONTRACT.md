# EO-06-B/C · V1 rapor okuma sözleşmesi

26 Kasım 2026. Bu sözleşme Dashboard ve EcoSystem'ın yayımlanmış Dataset'i nasıl okuyacağını tanımlar. Dashboard trend, pay ve dağılımı kullanır. EcoSystem aynı değerlerin tablosunu, ürün ilişkilerini ve dönem karşılaştırmasını kullanır. `AdsTable_Campaign_V37.html` veri ihtiyacı için referanstır. Bu teslim sözleşme kapsamındadır. API uygulaması ve EO-07 görsel kabulü açık kalır.

## Alanların kaynağı

| Okuma alanı | Mevcut kaynak | Kural |
|---|---|---|
| Sales ve Purchase | `analytics.cpd_product_sales_facts.sales_value`, `sales_quantity` | Sales sağlayıcının atfettiği ürün satış tutarıdır. Purchase satılan ürün adedidir. Her iki değer de kayıpsız ondalık metin olarak döner. `pd_facts.purchase/purchase_value` ve performans değerleri bu toplama girmez. |
| İş günü ve kaynak durumu | Satış fact'inde `business_date`, `source_timezone`, `reporting_scope`, `source_completeness`, `metric_support`, `observation_state` | Tarih aralığı ve gruplar mevcut `business_date` üzerinden okunur. Kaynak saat dilimi ve raporlama kapsamı korunur. Tarih temeli, satış kapsamı veya ölçü birimi uyuşmayan seriler tek kıyas değeri olarak birleştirilmez. |
| Platform, hesap, kampanya ve kanal | Satış fact'inde `platform`, `platform_account_id`, `root_entity_type/id/name`, `channel_type/id/resolution`, `campaign_type` | Hiyerarşi kimliklerle kurulur. Google'da Campaign türü ve örneğin Search/PMax formatı ayrı alanlardır, Klaviyo'da Campaign ve Flow kökleri ayrıdır. Kanal kimliği ancak `verified` ise kullanılır. Çözülemeyen kanalın satışı kendi kanıtsız kanal grubunda kalır. |
| Kampanya ve kanal adı | Önce satış `root_entity_name`. Aynı kapsam ve günde `analytics.pd_facts.root_entity_name` ve kanal için `entity_name` | `pd_facts` yalnız etiket girdisidir. Mağaza, kurulum nesli, bağlantı, platform, hesap, gün, kök türü ve kimliği eşleşir. Kanal adı için `entity_type/id`, satışın doğrulanmış `channel_type/id` değerine de eşleşir. Tek uyumlu ad alınır. Eksik veya çelişkili etiket `null` kalır ve bilinen kimlik gösterilebilir. |
| Reklamı yapılan ve satılan ürün | Satış fact'inde `advertised_product_mapping_id`, `sold_product_mapping_id` → `identity.product_identity_mappings.shopify_product_id` | İki eşleme ayrı doğrulanır. Aynı mağaza ve nesle ait, geçerli ve süresi dolmamış `verified` bağ kullanılır. Ürün raporu Shopify Product ID düzeyindedir. |
| Ürün adı ve SKU | Mevcut doğrulanmış eşleme Product ID verir. Bugünkü kimlik doğrulama okuması ürün adı ve SKU getirmiyor. | Güvenilir ürün düzeyinde ad ve SKU yoksa alanlar `null` kalır. Ürün kimliğiyle görüntüleme ve filtreleme devam eder. Varyant SKU'su keyfî seçilmez. Ürün adını kullanma kararı geçerlidir ve `Himself` etiketi kullanılmaz. |
| Satış rolü | Satış fact'inde `sales_role` ve ilgili `sales_role_evidence` | `Advertised` ve `Cross-sell` sunumda Direct ve Cross Sell olabilir. `Assisted`, `Triggered` ve `Unclassified` ayrı tutulur. V37'nin Indirect etiketi için ayrıca rol karşılığı kararı gerekir. `All roles` bu satışları korur. |
| Para birimi | Satış fact'inde `source_currency`, `target_currency`, `fx_state`, `fx_rate_id`; `analytics.fx_rates.fx_rate` | Aynı kaynak para biriminde native değerler toplanabilir. Ortak rapor para biriminde yalnız aynı para biriminde olan veya ilgili fact'e bağlı doğrulanmış kurla çevrilen değerler toplanır. Geçerli kur yoksa para grupları ayrı kalır ve birleşik tutar bilinmiyor olarak döner. Ürün adedi bundan etkilenmez. |
| Ürünün gözlendiği reklam yerleşimi | `analytics.cpd_product_performance_facts` içinde tarih, hesap, kök, doğrulanmış `channel_type/id` ve `product_mapping_id` | Geçerli bir Product ID bağıyla pozitif yerleşim gözlemi verir. Performans tablosu satış miktarı veya tutarı üretmez. Satır yokluğu yerleşimin bulunmadığını kanıtlamaz. |

Mevcut okuma, mağaza ve kurulum neslini sunucuda belirler. Aktif kurulum, gizlilik silme durumu, geçerli saklama süresi ve yayımlanmış kaynağın eşliği korunur. Etiket ve yerleşim okumaları da aynı sınırlarla yürütülür. [Dataset şeması](../supabase/migrations/20261108085004_eo05b_dataset_storage.sql) · [Compare sorgusu](../supabase/migrations/20261125093522_eo06b_report_sales_compare.sql) · [Kur sözleşmesi](../contracts/eo-05b-fx-reporting-currency-v1.json) · [Ürün kimliği okuması](../app/lib/shopify/product-identity-verification.server.js)

## Ortak sorgu ve sonuç

- İstek, bir ana tarih aralığı, Product/Channel/Campaign/Platform görünümü ve zaman grubu alır. Platform ve Product ID için çoklu seçimde aynı filtredeki seçimler **veya**, ayrı filtreler **ve** ile birleşir. Hesap, kampanya ve kanal seçimleri kendi üst kapsamına bağlıdır. Ad etiketleri filtre anahtarı olmaz. Product ID seçimi iki ürün ucunu da kapsar. İki uç da seçilmişse aynı satış toplamda bir kez kullanılır.
- EcoSystem Compare iki eşit uzunlukta ve uçları dahil tarih aralığı okur. Özel aralıklar örtüşmez. Önceki dönem ve önceki yıl mevcut takvim kuralını kullanır. Dashboard aynı okumanın ana aralığını kullanır. Daily 31 gün, diğer gruplar 90 günle sınırlıdır. Gün sırası aralık başlangıcından itibaren hesaplanır.
- Zaman grupları Selected Range, Daily, Weekly, Monthly ve Quarterly'dir. Hafta pazartesi başlar. Ay ve çeyrek takvim sınırına uyar. Kenar grupları seçili günlerle sınırlıdır. Kıyas sütunları ana aralığın gün sırasıyla eşlenir ve her sütun ikinci dönemde karşılık gelen gerçek günleri gösterir.
- Sonuç her dönem için aralık, zaman grupları, gruplama kimlikleri, görünen etiketler, Sales, Purchase, para birimi ve veri durumlarını taşır. Product ana satış grubu satılan üründür. Reklamı yapılan ürün, aynı fact'ten çıkan ilişki görünümünde kullanılır. Channel ve Campaign grupları hesap bağını korur. Platform özeti alt gruplarla birlikte gösterilebilir. Toplamlar üst ve alt satırları yeniden toplayarak oluşturulmaz.
- Tutar ve adet toplama yalnız aynı kapsamın uygun satış satırları üzerinden yapılır. Eksik veya desteklenmeyen katkı sıfıra çevrilmez. Bir grubun bir bölümü biliniyorsa sonuç gözlenen alt toplamı ve `partial` durumunu taşır. Bilinen katkı yoksa değer `null` kalır. Kaynakta kayıtlı açık sıfır geçerlidir. Satır olmayan aralık, tek başına doğrulanmış boş yayın veya gecikme kanıtı değildir.
- Tablo, trend, pay ve dağılım aynı toplamları kullanır. Pay yalnız uyumlu para ölçüsü veya ürün adedi için, karşılaştırılabilir tam ve sıfırdan farklı toplam olduğunda hesaplanabilir. Yüzde veya tutar farkı eksik dönemi sıfıra çevirmez. Sağlayıcıların atfettiği satış toplamı, tekil Shopify sipariş toplamı olarak sunulmaz.

## İlişki grafikleri

**Ürün Sankey'i.** İki ürün kimliği aynı satış kaydında doğrulanmışsa bağlantı reklamı yapılan ürün → satılan ürün yönündedir. A → B, A ekranında Contribution To ve B ekranında Contribution From olarak görünür. Bunlar aynı satışın iki görünümüdür. Mutual için A → B ve B → A ayrı ayrı kanıtlanır. A → A, A'nın adıyla kendi satışıdır. Yalnız satılan ürün kanıtlıysa satış toplamda kalır ve ürünler arası bağlantı üretilmez. Örneğin Klaviyo Ordered Product satılan ürünü ve doğrulanmışsa mesaj bağını sağlayabilir. Meta performans satırı tek başına satış veya Cross-sell kanıtı vermez.

**Kanal ve kampanya Sankey'i.** Kaynak kanal satıştaki doğrulanmış kanaldır. Satılan ürünün hedef yerleşimi aynı platform, hesap ve kaynak rapor günündeki doğrulanmış yerleşim eşliğinden okunur. Aynı kanal ve kampanya kimliği **Same Channel**, farklı kanal ve aynı kampanya **Other Channels in Campaign**, farklı kampanya **Other Channels in Other Campaigns** adayıdır. Hedef yerleşimi ürünün orada gözlendiğini belirtir. Satış atfı kaynak kanalda kalır. Birden fazla eşdeğer hedef varsa aynı satış birden fazla hedefe yazılmaz. Tek hedef doğrulanana kadar ilişki sınıfı boş kalır ve satış toplamı korunur. **Non Advertised Products** yalnız o kapsam için eksiksiz yerleşim kanıtı varsa üretilebilir. Bugünkü performans fact'i böyle bir tam envanter sağlamadığı için bu kategori mevcut veriden türetilemez. Google PMax'te kesinleşmemiş kanal ve Klaviyo'da reklamı yapılan ürün eksikse bu bağ kurulmaz.

## Uygulama kabul örnekleri

| Girdi | Beklenen sonuç |
|---|---|
| Aynı satışta A → B, 2 ürün ve 100 TRY. A ve B birlikte seçili. | Toplam 2 ürün ve 100 TRY. A'dan B'ye tek bağlantı. A ve B ekranındaki yön etiketleri toplama ek satış üretmez. |
| A → B 100 TRY ve B → A 25 TRY. | İki ayrı yönde 100 ve 25 TRY. Mutual görünümünde toplam 125 TRY bir kez hesaplanır. |
| Klaviyo'da B ürünü 1 adet, 40 TRY ve bağlı Flow mesajı var. Reklamı yapılan ürün yok. | Flow ve B satışta görünür. Bu satırdan ürünler arası ilişki çıkmaz. |
| B'nin aynı gün başka kanalda iki hedef adayı var. Tam yerleşim listesi yok. | Satış bir kez toplamda kalır. Kesin hedef ve Non Advertised Products etiketi üretilmez. |
| Bir satış 100 TRY, diğeri 10 USD. Ortak kur yok. | Para toplamları para birimine göre ayrı kalır. Birleşik tutar `null`. Satılan ürün adedi uygun satırlardan hesaplanır. |
| Bir satır kayıtlı sıfır, diğer satırın tutarı eksik. | Gözlenen alt toplam `"0"`, grup durumu `partial`. İkisi de eksik olsaydı tutar `null` olurdu. |
| Ana aralık 1–7 Ekim, özel kıyas 4–10 Ekim. | İstek reddedilir. 24–30 Eylül aynı gün adediyle geçerli önceki dönemdir. |

Son doğrulanan gün bilgisi EO-06-D'de makbuza dayalı ayrı karar olarak açık. KPI, ROAS, maliyet dağıtımı ve kesin sipariş Overlap'i bu rapor okumasının kapsamı dışındadır. Teknik referanslar 26 Kasım 2026'da kontrol edildi. [PostgreSQL ondalık türleri](https://www.postgresql.org/docs/17/datatype-numeric.html) · [PostgreSQL takvim işlemleri](https://www.postgresql.org/docs/17/functions-datetime.html)

## Shopify Analizler ürün raporu provası

26 Kasım 2026. V52 mockup'ındaki ürün tablosu, AdsTable Development mağazasında kurulu mevcut AdsTable (herkese açık uygulama, `adstable-1`) üzerinden sınanır. İlk taslakta ayrı test uygulaması hedeflenmişti. O hedefin yerini mevcut uygulama aldı. Tek özel `analytics_app_events` olayının tanımı uygulama genelinde yayımlanır. Sentetik gönderim öncesinde uygulama ve test mağazasının kesin Shopify kimlikleri doğrulanır. Yalnız bu mağazaya sentetik kampanya, ürün ve satış alanları gönderilir. Zey&Rose verisi ve gerçek sağlayıcı bağlantısı kullanılmaz. Önce yayımlanmamış sürüm farkı incelenir. Uygulama geneline yayın ve gönderim ayrı yetki gerektirir. Bu kayıt prova planıdır ve Shopify kabulü açıktır.

[Çevrimdışı olay ve sorgu taslağı](#çevrimdışı-shopify-analizler-olay-taslağı) sürüm farkında beklenen tek eklemeyi, iki sentetik olay örneğini ve ShopifyQL kontrolünü içerir.

| Aşama | Girdi | Shopify Analizler'de beklenen |
|---|---|---|
| İlk yayın | A reklam ürünü, B satılan ürün, `campaign-test-1`, satış günü D, adet farkı `1`, tutar farkı `10000` kuruş | D gününde kampanya ve A → B aynı satırda, `1` adet ve `100,00 TRY`. Genel toplam aynı. |
| Tarihsel düzeltme | İkinci olay, aynı ürün çifti ve kampanya, yine D günü, adet farkı `0`, tutar farkı `-2000` kuruş | Aynı D satırında `1` adet ve `80,00 TRY`. Gönderim gününe yeni satış yazılmaz. |
| Yinelenen düzeltme kontrolü | İkinci olayın aynı içeriği ve aynı işlem kimliği, ilk iki aşama doğrulandıktan sonra | Belgelenen 24 saatlik aynı anahtar penceresinde toplam yine `1` adet ve `80,00 TRY`. Kuyruktan günler sonra tekrar üretilen gönderimler için platformun 24 saatlik koruması tek başına yeterli kabul edilmez. |

Özel olayda `probe_run`, `advertised_product`, `sold_product`, `campaign` boyutları `string`, `quantity_delta` `int`, `sales_delta` `TRY` cinsinden `money` olarak tasarlanır. Ürün değerleri test kimlikleridir. Kullanılan iki ölçü `sum(quantity_delta)` ve `sum(sales_delta)` olarak tanımlanır. Olay sayısı ürün adedi olarak kullanılmaz. Rapor `FROM app_events` ile bu iki ölçüyü seçer, prova kimliğini filtreler, iki ürün ve kampanyaya göre gruplar. Günlük kırılım Shopify'ın olay zamanından okunur. D, test mağazasının saat diliminde provadan yedi takvim günü önceki kapalı gündür. Her iki olay için aynı D zaman etiketi kullanılır. Bu, gerçek yedi günü beklemeden geçmiş tarihe işleme davranışını sınar.

Eksi tutar Analytics için bu provanın hipotezidir. Shopify'ın API kabulü rapor kabulü sayılmaz. Her aşamada gönderim zamanı, Shopify kabul sonucu, Analizler'de ilk görünme zamanı, D gününün satırı ve genel toplam kaydedilir. Düzeltme reddedilirse, yanlış güne düşerse veya toplam yanlışsa sonuç açık kalır. İlk sağlayıcı hatasında prova durur.

### Hazır rapor ve katkı toplamı kabulü

Geçmiş gün kabulünden sonra AdsTable'ın hazırladığı raporun Shopify Analizler ve Raporlar altında doğrudan açılabilmesi sınanır. Mağaza sahibi hazır raporu yeniden açabilir, tarih ve ürün filtrelerini kullanabilir. Sorgu yazması veya raporu baştan kurması gerekmez.

Aynı test günü C → A için 1 adet ve 50 TL eklenir. A görünümünde Contribution From 50 TL, Contribution To 80 TL aynı satış sütununda görünür. A'nın satış toplamı 1 adet ve 50 TL kalır. Tarih ve ürün filtresi değiştiğinde aynı kural sürer. Contribution To aynı satışın diğer bakışını gösterir ve satış toplamına katılmaz.

Shopify Analizler, hazır rapor ve katkı toplamı kabulü sağlandığında Dashboard ile EcoSystem'in tek adresi olarak tercih edilir. Kabul karşılanamazsa iki görünüm birlikte AdsTable içinde değerlendirilir. Grafik kararı en sondadır. Sankey ve gruplu yatay çubuk kabul koşulu değildir. Hazır tablo tek başına yeterli olabilir.

Shopify olay başına bir istek alır. Canlı hacim hesabı, rapor ve düzeltme kabulünden sonra ele alınır. Teknik belgeler 26 Kasım 2026'da kontrol edildi. [Olay tanımı ve ölçüler](https://shopify.dev/docs/apps/build/app-events/analytics/toml-configuration) · [ShopifyQL analitik olayları](https://shopify.dev/docs/apps/build/app-events/analytics) · [App Events API](https://shopify.dev/docs/api/app-events/latest) · [Shopify sürüm yayını](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)

## Çevrimdışı Shopify Analizler olay taslağı

[Analytics olay taslağı](evidence/eo06-shopify-analytics-probe/shopify.extension.toml.example) AdsTable Development provası için tek olay, altı zorunlu alan ve iki toplam ölçüsü tanımlar. Olay adı için gözlenen AdsTable handle'ı `adstable-1` kullanıldı. Bu örnek `docs/evidence` altında yer alır. Uygulamanın dağıtılan `extensions/` dizini, `shopify.app.toml`, OAuth kapsamları ve yayın işi bu çalışmanın dışında kaldı.

### Sürüm farkında aranacaklar

- Shopify'da yetkili adım başladığında mevcut AdsTable uygulama kimliği, olay öneki ve AdsTable Development mağazasının kesin Shop GID'si doğrulanır.
- Yayımlanmamış sürüm farkında yalnız `ecosystem-sales-probe` uzantısının eklendiği görülür. Mevcut sürümde kaldırma veya başka bir fark görülürse yayın değerlendirmesi durur.
- Olay tanımının kapsamı uygulama genelidir. Sentetik gönderim hedefi doğrulanmış tek test mağazasıdır. Taslaktaki `TRY` olaya sabittir. Bu prova çoklu para birimi için yayın kararı içermez.

Bu çalışma dosya farkını ve sentetik örneği inceler. Shopify'daki gerçek sürüm farkı, olayın kabulü ve rapor görünümü ayrı kanıt bekliyor.

### Gönderim örnekleri

Yer tutucular çevrimdışı inceleme içindir. İki olayda aynı `TEST_SHOP_GID`, aynı benzersiz `RUN_ID` ve aynı `ORIGINAL_DAY_TIMESTAMP` kullanılır. Tarih, gönderim anında test mağazasının saat diliminde yedi takvim günü önceki kapalı güne denk gelir. İlk olay ve düzeltmenin anahtarları ayrıdır. Düzeltme tekrarında aynı gövde ve anahtar, belgelenen 24 saatlik pencere içinde kullanılır.

```json
[
  {
    "shop_id": "TEST_SHOP_GID",
    "event_handle": "adstable-1.ecosystem_sale_probe",
    "timestamp": "ORIGINAL_DAY_TIMESTAMP",
    "idempotency_key": "RUN_ID-initial",
    "attributes": {
      "probe_run": "RUN_ID",
      "advertised_product": "A",
      "sold_product": "B",
      "campaign": "campaign-test-1",
      "quantity_delta": 1,
      "sales_delta": 10000
    }
  },
  {
    "shop_id": "TEST_SHOP_GID",
    "event_handle": "adstable-1.ecosystem_sale_probe",
    "timestamp": "ORIGINAL_DAY_TIMESTAMP",
    "idempotency_key": "RUN_ID-correction",
    "attributes": {
      "probe_run": "RUN_ID",
      "advertised_product": "A",
      "sold_product": "B",
      "campaign": "campaign-test-1",
      "quantity_delta": 0,
      "sales_delta": -2000
    }
  }
]
```

Her nesne ayrı bir istek örneğidir. Önce 100 TL'nin raporda görünmesi beklenir. Sonra 80 TL ve en son aynı anahtarla tekrar sonrası 80 TL doğrulanır. `202 Accepted` gönderim makbuzudur. Raporun görünme zamanı ve sonucu ayrıca kaydedilir.

### ShopifyQL prova sorgusu

`RUN_ID` ve `ORIGINAL_DAY` yerine prova değerleri girilir. Aralığın bugüne uzanması, bugünün satışına yeni bir olay yazılıp yazılmadığını kontrol etmeyi sağlar. Hazır raporun sunumu ve Contribution From/To toplamı, bu ilk kabulün ardından ayrı sınanır.

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_sale_probe.purchases,
  event."adstable-1".ecosystem_sale_probe.sales
WHERE event."adstable-1".ecosystem_sale_probe.probe_run = 'RUN_ID'
GROUP BY day, event."adstable-1".ecosystem_sale_probe.campaign,
  event."adstable-1".ecosystem_sale_probe.advertised_product,
  event."adstable-1".ecosystem_sale_probe.sold_product WITH TOTALS
SINCE ORIGINAL_DAY UNTIL today
```

Teknik belgeler 26 Kasım 2026'da kontrol edildi. [Olay şeması](https://shopify.dev/docs/apps/build/app-events/analytics/toml-configuration) · [Gönderim ve 24 saatlik tekrar koruması](https://shopify.dev/docs/api/app-events/latest) · [ShopifyQL rapor sorgusu](https://shopify.dev/docs/apps/build/app-events/analytics#step-4-query-the-activity) · [Yayımlanmamış sürüm](https://shopify.dev/docs/api/shopify-cli/app/app-deploy#no-release)

### İlk olay için tek seferlik gönderim

[İlk gönderim betiği](evidence/eo06-shopify-analytics-probe/send-initial.mjs) ürün sahibinin onayladığı bir adet ve 100 TL sentetik olayı içerir. Vercel'de mevcut AdsTable Production ortam değişkenleriyle, alan adı bağlanmadan oluşturulan tek seferlik build içinde çalışması hedeflenir. Betik uygulamanın build komutuna veya bir web rotasına bağlı değildir. [Vercel alan adı atlaması](https://vercel.com/docs/cli/deploy#skip-domain)

Test mağazası kimliği [kurulum kabul kaydından](evidence/EO_02C_LIVE_ACCEPTANCE_2026-10-08.json) doğrulanır. Çalışma için aynı kimlik `ADSTABLE_ANALYTICS_TEST_SHOP_GID`, doğrulanmış mağaza saat dilimi `ADSTABLE_ANALYTICS_TEST_SHOP_TIME_ZONE` ve en çok bir saat sonraki bitiş anı `ADSTABLE_ANALYTICS_PROBE_EXPIRES_AT` adıyla verilir. Bunlar build'e özgü girdilerdir. Betik ilk hata veya belirsizlikte durur. İkinci olay ve tekrar provası bu çalışmaya bağlı değildir.

### 19 Kasım düzeltmesi

İlk olay [tek seferlik build kaydına](https://vercel.com/firats-projects-d22284db/ads-table-embedded/GwqfPaymjXcpspvEdzD2h3hDTgxR) göre yalnız AdsTable Development'a gönderildi. Ürün sahibinin mobil kanıtında Shopify Analizler, 19 Kasım 2026 için `campaign-test-1` ve A → B satırını gösterdi. Satır ve genel toplam 1 adet ve 100 TL idi.

[Düzeltme betiği](evidence/eo06-shopify-analytics-probe/send-correction.mjs) ilk olayın tam zaman damgasını, hedef mağazayı ve kırılımlarını kullanır. Tek istek 0 adet ve −2.000 kuruş farkını, ilk olayınkinden ayrı bir işlem anahtarıyla gönderir. Beklenen rapor sonucu aynı satırda 1 adet ve 80 TL. İlk hata, belirsiz yanıt veya mevcut işlem makbuzu durumunda betik durur. Bu betik tekrar provasını çalıştırmaz.
