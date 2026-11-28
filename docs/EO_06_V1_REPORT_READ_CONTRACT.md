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

[Düzeltme build'i](https://vercel.com/firats-projects-d22284db/ads-table-embedded/GD5phdHixueRDHY83ZY3SxKNc85t) ilk olayın tam zaman damgasını, hedef mağazayı ve kırılımlarını kullandı. Tek istek 0 adet ve −2.000 kuruş farkını, ilk olayınkinden ayrı bir işlem anahtarıyla gönderdi. Shopify `202` ve `success: true` döndü. Ürün sahibinin mobil ekranı 19–26 Kasım rapor aralığında tek satır, 1 adet ve 80 TL gösterdi. İlk gönderim ve düzeltme build'lerinde canlı alan adı aynı dağıtıma bağlı kaldı.

### Aynı düzeltmenin tekrar kontrolü

[Tekrar betiği](evidence/eo06-shopify-analytics-probe/send-correction.mjs) düzeltmenin JSON gövdesini ve işlem anahtarını aynen kullanır. `ADSTABLE_ANALYTICS_EXPECT_REPLAY=1` ile açık tekrar çalışması ve düzeltmenin kabulünden itibaren 24 saat dolmadan sona eren bir pencere gerektirir. Prova güvenlik payıyla 27 Kasım 2026 16.34 UTC'de kapanır. Tekrarın teknik kabulü `202`, `success: true` ve `Idempotent-Replay: true` ile, rapor kabulü aynı tek satırın 1 adet ve 80 TL kalmasıyla doğrulanır. [Shopify tekrar makbuzu](https://shopify.dev/docs/api/app-events/latest#status-and-error-codes)

### Kaydedilen rapor kanıtı

[Tekrar build'i](https://vercel.com/firats-projects-d22284db/ads-table-embedded/HJ4VLpjbuU69QLg1PSYXCEwpT47U) aynı düzeltmeye `202` aldı. Önceki makbuzun yeniden kullanıldığı API yanıtından doğrulanamadı. Ek istek gönderilmedi. Ürün sahibi mobilde raporu yenilediğinde 1 satır, 1 adet, 80 TL gördü. Raporu **İlk rapor** adıyla kaydetti ve Shopify Analizler → Raporlar listesinden tekrar açarak 1 adet ve 80 TL'yi yeniden doğruladı. Kullanıcı sorgu veya sütun hazırlamadan bir kez kopyayı kaydetti. Kurulum sırasında raporun otomatik oluşturulması doğrulanmadı. [Shopify özel rapor yönetimi](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/custom-reports/managing-custom-reports)

### Katkı toplamı için ShopifyQL provası

26 Kasım 2026. Ürün sahibi Contribution From ve Contribution To kontrolüne başlanmasını onayladı. Mevcut App Events şemasıyla, 19 Kasım'daki doğrulanmış A → B (1 adet, 80 TL) satırına ek olarak C → A (1 adet, 50 TL) sentetik olayı planlanır. Aynı prova kimliği ve gün kullanılır. C → A ayrı işlem anahtarına sahip olur. Bu kayıt olayın gönderildiği anlamına gelmez.

ShopifyQL `WITH TOTALS`, iki yön de sonuçtaysa satış ölçüsünü 130 TL olarak toplar. `WHERE` ile yalnızca A'nın satıldığı satırları seçmek 50 TL'yi verir ve A → B satırını tablodan çıkarır. Shopify'ın genel toplamda tek yönü dışarıda bırakabilen bir ShopifyQL seçeneği belgelerde bulunmadı. Aynı raporda denenecek aday, genel toplamı kaldırıp satılan ürüne göre `WITH GROUP_TOTALS` kullanmaktır. [ShopifyQL toplamları](https://shopify.dev/docs/api/shopifyql/latest/syntax/with#total-columns) · [ShopifyQL filtreleri](https://shopify.dev/docs/api/shopifyql/latest/syntax/where) · [Shopify Analizler'de grup toplamları](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/shopifyql-editor/shopifyql-syntax)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_sale_probe.purchases,
  event."adstable-1".ecosystem_sale_probe.sales
WHERE event."adstable-1".ecosystem_sale_probe.probe_run = 'eo06e-development-analytics-first-sale'
  AND (event."adstable-1".ecosystem_sale_probe.sold_product = 'A'
    OR event."adstable-1".ecosystem_sale_probe.advertised_product = 'A')
GROUP BY event."adstable-1".ecosystem_sale_probe.sold_product,
  event."adstable-1".ecosystem_sale_probe.advertised_product WITH GROUP_TOTALS
SINCE 2026-11-19 UNTIL 2026-11-19
```

Prova iki ayrıntı satırının ve aynı satış sütunundaki 50 TL ile 80 TL'nin göründüğünü, A'nın satışına ait grup toplamının 50 TL olduğunu ve 130 TL'nin A'nın satış toplamı olarak gösterilmediğini kontrol eder. Contribution From/To ayrımı mağaza sahibi için açık olmalı. Bu sorguda yön, reklamı yapılan ve satılan ürün sütunlarından anlaşılır. Shopify'ın arayüzünde ayrıca yön etiketleri veya tek ve ayrı bir A satış toplamı gerekirse o ihtiyaç açık kalır. Grafik bu provanın dışında kalır.

26 Kasım 2026. Ürün sahibi AdsTable Development'a tek C → A olayı ve alan adı atanmayan tek Vercel build'i için onay verdi. [Gönderim betiği](evidence/eo06-shopify-analytics-probe/send-contribution.mjs) 19 Kasım için 1 adet ve 5.000 kuruş gönderdi. [Build kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/8P5vc9Ae4YdK7c7tZBVwKtWjfqin) Shopify'dan `202` ve `success: true` alındığını doğruladı. `embedded.adstable.app` aynı dağıtıma bağlı kaldı. Shopify Analizler'de satırların ve grup toplamının görsel kabulü bekleniyor.

### Önce Contribution From ve Contribution To metrikleri

26 Kasım 2026. Ürün sahibinin ekranında A → B 80 TL ve C → A 50 TL aynı satış sütununda görünür. Shopify genel toplamı 130 TL gösterir. A için 50 TL'lik satış toplamı bu ekranda doğrulanmadı. Ürün sahibi bir sonraki iş olarak iki metriğin Shopify Analizler'e eklenmesini belirledi.

İlk prova A ürününe odaklanır. `Contribution From` başka bir ürünün reklamından A'ya gelen satış tutarını, `Contribution To` A'nın reklamından başka bir ürüne giden satış tutarını gösterir. Shopify'ın belgelenen özel metrik tanımı, her `sum` metriğini tek bir sayısal olay alanına bağlar. Aynı satış alanını iki adla tanımlamak iki yönü ayırmaz. Taslak iki ayrı tutar alanını ve prova için odak ürün kimliğini kullanır. [Shopify özel metrik tanımı](https://shopify.dev/docs/apps/build/app-events/analytics/toml-configuration#custom-metrics)

| Reklamı yapılan → Satılan | Odak | Contribution From | Contribution To |
| --- | --- | ---: | ---: |
| C → A | A | 50 TL | 0 TL |
| A → B | A | 0 TL | 80 TL |

Kabul için iki metrik Shopify rapor düzenleyicisinde ayrı ayrı seçilebilmeli ve A için sırasıyla 50 TL ve 80 TL göstermeli. A'nın satış toplamı, kendi satışları ve Contribution From üzerinden ayrıca doğrulanır. Mevcut prova verisi yeni alanları taşımadığı için bu iki metriği kanıtlamak ancak yeni prova kayıtlarıyla mümkün olur. Bu kayıt tasarımdır. Shopify uygulama ayarları ve yayın için ayrı onay gerekir.

### Yeni metriklerin Shopify provası

26 Kasım 2026. Ürün sahibi [Shopify sürümünü](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1268126810113) etkinleştirdi ve iki metriği rapora ekleyerek ikisinin de sütun olarak seçilebildiğini doğruladı. Ardından AdsTable Development için iki sentetik kayıt gönderimini ve alan adı atanmayan tek Vercel build'ini onayladı. [Prova betiği](evidence/eo06-shopify-analytics-probe/send-directional-metrics.mjs) her iki yönü ayrı olay olarak gönderdi. [Build kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/94FBZdj21wLvQwcnYNFuBP7Ezxpt) her iki olay için `202` ve `success: true` sonucunu doğruladı. Aktif uygulama alan adı aynı dağıtıma bağlı kaldı. Değerlerin Shopify Analizler ekranında doğrulanması bekleniyor.

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_sale_probe.contribution_from,
  event."adstable-1".ecosystem_sale_probe.contribution_to
WHERE event."adstable-1".ecosystem_sale_probe.probe_run = 'eo06e-development-contribution-metrics-v1'
  AND event."adstable-1".ecosystem_sale_probe.focus_product = 'A'
GROUP BY event."adstable-1".ecosystem_sale_probe.advertised_product,
  event."adstable-1".ecosystem_sale_probe.sold_product WITH TOTALS
SINCE 2026-11-19 UNTIL 2026-11-19
```

### Contribution Roles boyutuyla EcoSystem provası

26 Kasım 2026. İki metrik provası, iki tutarın Shopify'a ulaşabildiğini gösterdi. A'nın satış toplamı ve ortak Sales sütunu bu provada doğrulanmadı. Ürün sahibi V52'yi görünüm referansı olarak belirledi. Shopify [yayındaki olayın metriklerini kaldırmayı reddetti](https://github.com/fyilanli-oss/ads-table-embedded/actions/runs/45878751106/job/140112407892). Ürün sahibinin onayıyla ayrı `adstable-1.ecosystem_role_probe` olayı, Contribution Roles boyutu ve Purchase ile Sales metrikleriyle [Shopify sürümüne eklendi](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1268161347585). Ürün sahibi sürümü etkinleştirdi.

Ürün sahibinin açık onayıyla [gönderim betiği](evidence/eo06-shopify-analytics-probe/send-ecosystem-roles.mjs) AdsTable Development'a 19 Kasım tarihli C → A 50 TL Contribution From ve A → B 80 TL Contribution To kayıtlarını gönderdi. [Build kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/ESZvedgtHScB3qvghRgLggpEu68g) iki kayıt için de `202` ve `success: true` sonucunu doğruladı. Etkin uygulama alan adı aynı dağıtıma bağlı kaldı. Shopify ekranında iki rolün tek Sales sütununda görünmesi ve satılan ürün A'nın ara toplamının 50 TL olması bekleniyor. `ORDER BY` grup ara toplamının tabloda görünmesini sağlar. [Shopify grup toplamı kuralı](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/shopifyql-editor/shopifyql-syntax#group-totals)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-ecosystem-roles-v1'
  AND event."adstable-1".ecosystem_role_probe.focus_product = 'A'
GROUP BY event."adstable-1".ecosystem_role_probe.sold_product, event."adstable-1".ecosystem_role_probe.contribution_role WITH GROUP_TOTALS
SINCE 2026-11-19 UNTIL 2026-11-19
ORDER BY event."adstable-1".ecosystem_role_probe.sold_product ASC
```

### İki tutar sütunuyla EcoSystem provası

26 Kasım 2026. Ürün sahibi `Sales` ve `Contribution To` olarak iki tutar sütununu onayladı. [Shopify sürümü](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1268212989953) mevcut olaya tek isteğe bağlı para alanı ve tek yeni metrik ekledi. Ürün sahibi sürümü etkinleştirdi ve AdsTable Development'a iki sentetik kayıt gönderilmesine açık onay verdi.

[Gönderim betiği](evidence/eo06-shopify-analytics-probe/send-sales-columns.mjs) iki satırı da Advertised Product A altında gönderdi. Sold Product A olan Contribution From satırı 50 TL Sales ve 0 TL Contribution To taşır. Sold Product B olan Contribution To satırı 0 TL Sales ve 80 TL Contribution To taşır. Purchase bu provanın kapsamı dışındadır. [Build kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/4ZhohDmksWWLq3UVurcH67ApiFJq) her iki kayıt için `202` ve `success: true` sonucunu doğruladı. Etkin uygulama alan adı aynı dağıtıma bağlı kaldı. A için 50 TL Sales ve 80 TL Contribution To grup toplamlarının Shopify raporunda görsel kabulü bekleniyor.

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales,
  event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-ecosystem-sales-columns-v1'
  AND event."adstable-1".ecosystem_role_probe.advertised_product = 'A'
GROUP BY event."adstable-1".ecosystem_role_probe.advertised_product, event."adstable-1".ecosystem_role_probe.sold_product,
  event."adstable-1".ecosystem_role_probe.contribution_role WITH GROUP_TOTALS
SINCE 2026-11-19 UNTIL 2026-11-19
ORDER BY event."adstable-1".ecosystem_role_probe.advertised_product ASC, event."adstable-1".ecosystem_role_probe.sold_product ASC
```

### EcoSystem hiyerarşi provası

28 Kasım 2026. Ürün sahibi Platform ve Channel boyutlarını ekleyen [Shopify sürümünü](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1270198468609) yayımladı. Açık onayla [prova betiği](evidence/eo06-shopify-analytics-probe/send-hierarchy.mjs) AdsTable Development'a 27 Kasım tarihli altı sentetik kayıt gönderdi. [Gönderim kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/G1EQFLvrJZiqL8BgjWbGWAFzcRCX) altı kayıt için de `202` ve `success: true` sonucunu doğruladı. Etkin uygulama alan adı aynı dağıtımda kaldı.

| Kontrol noktası | Sales | Contribution To |
| --- | ---: | ---: |
| Advertised Product A | 50 TL | 80 TL |
| Channel 1 | 130 TL | 80 TL |
| Campaign 1 | 150 TL | 80 TL |
| Platform 1 | 180 TL | 80 TL |
| Özet | 220 TL | 80 TL |

B'nin 80 TL satışı Sales toplamında bir kez sayılır. A'nın 80 TL katkısı ayrı sütunda kalır. Purchase bu provanın kapsamı dışındadır. Ürün sahibi 28 Kasım'da Shopify Analizler ekranında hiyerarşi ve toplamların doğru göründüğünü doğruladı. [28 Kasım'da kontrol edilen Shopify grup toplamı belgesi](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/shopifyql-editor/shopifyql-syntax#group-totals)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales, event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-ecosystem-hierarchy-v1'
GROUP BY event."adstable-1".ecosystem_role_probe.platform, event."adstable-1".ecosystem_role_probe.campaign, event."adstable-1".ecosystem_role_probe.channel, event."adstable-1".ecosystem_role_probe.advertised_product, event."adstable-1".ecosystem_role_probe.sold_product WITH GROUP_TOTALS, TOTALS
SINCE 2026-11-27 UNTIL 2026-11-27
ORDER BY event."adstable-1".ecosystem_role_probe.platform ASC, event."adstable-1".ecosystem_role_probe.campaign ASC, event."adstable-1".ecosystem_role_probe.channel ASC, event."adstable-1".ecosystem_role_probe.advertised_product ASC
```

### EcoSystem grafik önizlemesi

28 Kasım 2026. İlk grafik provası, kabul edilen hiyerarşi verisiyle A'nın katkı sağladığı satılan ürünleri yatay çubuklarla gösterir. Beklenen tek çubuk B · 80 TL'dir. Bu sorgu mevcut Shopify raporunu kaydetmeden önizlemeye açılır. Grafik türünün EcoSystem için görsel kabulü beklenir. [ShopifyQL yatay çubuk grafiği](https://shopify.dev/docs/api/shopifyql/latest/syntax/visualize#bar-charts)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-ecosystem-hierarchy-v1'
  AND event."adstable-1".ecosystem_role_probe.advertised_product = 'A'
  AND event."adstable-1".ecosystem_role_probe.contribution_role = 'Contribution To'
GROUP BY event."adstable-1".ecosystem_role_probe.sold_product
SINCE 2026-11-27 UNTIL 2026-11-27
VISUALIZE event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to TYPE horizontal_bar
```

### Product Level rapor provası

28 Kasım 2026. Ürün sahibi V52'nin Product görünümüne öncelik verdi ve Interactivity'yi bu rapordan çıkardı. Ürünün üstte yer aldığı sıra Product → Platform → Campaign → Channel → Contribution Roles olarak sınanır. Ürün kimliği, SKU ve ad üst ürünün bağlamını gösterir. Sales Roles ile Advertised Product ve Sold Product ayrıntıyı taşır. Sales ve Contribution To ayrı tutar sütunlarıdır. Grafik ve Dashboard ayrı kalır.

[Shopify sürümü](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1270227927041) dört isteğe bağlı Product Level boyutunu ekledi. Ürün sahibi sürümü etkinleştirdi ve AdsTable Development'a [14 kayıt gönderimini](evidence/eo06-shopify-analytics-probe/send-product-level.mjs) açıkça onayladı. 27 Kasım için 12 ayrı Platform/Campaign/Channel grubundan bir ürün örneği ve iki Contribution To ayrıntısı gönderildi. Örnekler altı farklı ürün kimliği içerir. Tek örnek SKU sentetiktir. Kaynağı belirlenemeyen dört örnekte Sales Roles gönderilmedi. Advertised Product ve Contribution Roles için zorunlu olay alanlarında boş görünümü temsil eden tire kullanıldı. Satış tutarları sentetiktir.

[Gönderim kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/8B2tYU8ieEqd5KkQ99XD6jX3PXH8) 14 kayıt için de `202` ve `success: true` sonucunu doğruladı. Etkin uygulama alan adı aynı dağıtımda kaldı. Beklenen genel toplam 7.800 TL Sales ve 200 TL Contribution To'dur. Shopify ekranında bütün kırılımların görünmesi, eksik alanların sunumu ve toplamların görsel kabulü bekleniyor. [28 Kasım'da kontrol edilen ShopifyQL gruplama belgesi](https://shopify.dev/docs/api/shopifyql/latest/syntax/group-by)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales, event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-product-level-v1'
GROUP BY event."adstable-1".ecosystem_role_probe.product_id, event."adstable-1".ecosystem_role_probe.sku, event."adstable-1".ecosystem_role_probe.product_name, event."adstable-1".ecosystem_role_probe.platform, event."adstable-1".ecosystem_role_probe.campaign, event."adstable-1".ecosystem_role_probe.channel, event."adstable-1".ecosystem_role_probe.contribution_role, event."adstable-1".ecosystem_role_probe.sales_role, event."adstable-1".ecosystem_role_probe.advertised_product, event."adstable-1".ecosystem_role_probe.sold_product WITH GROUP_TOTALS, TOTALS
SINCE 2026-11-27 UNTIL 2026-11-27
ORDER BY event."adstable-1".ecosystem_role_probe.product_id ASC, event."adstable-1".ecosystem_role_probe.sku ASC, event."adstable-1".ecosystem_role_probe.product_name ASC, event."adstable-1".ecosystem_role_probe.platform ASC, event."adstable-1".ecosystem_role_probe.campaign ASC, event."adstable-1".ecosystem_role_probe.channel ASC, event."adstable-1".ecosystem_role_probe.contribution_role ASC, event."adstable-1".ecosystem_role_probe.sales_role ASC, event."adstable-1".ecosystem_role_probe.advertised_product ASC
```

### Product Level rapor provası · Gün, SKU ve satış rolleri

28 Kasım 2026. Ürün sahibi, aynı 14 sentetik kaydın yalnızca AdsTable Development'a ayrı bir prova olarak gönderilmesini onayladı. [Prova betiği](evidence/eo06-shopify-analytics-probe/send-product-level-v2.mjs) bütün SKU değerlerini `Yok` olarak gönderir. Reklamı yapılan ürünün bilinmediği dört kayıtta `Contribution From`, `Unknown` ve `Indirect` kullanılır. Satılan ürün adı, kampanya bağı, olay tarihi ve tutarlar önceki provayla aynıdır.

[Gönderim kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/AVryyGri5GYvnN8qMHq36HDoY6zQ), 14 ayrı kayıt için `202` ve `success: true` yanıtını doğruladı. Canlı alan adının bağlı olduğu dağıtım gönderimden önce ve sonra aynıydı. Raporun beklenen toplamları 7.800 TL Sales ve 200 TL Contribution To. Shopify tablo görünümü için ürün sahibi kabulü beklenir.

Önizleme sorgusu `day` boyutunu ilk sıraya alır ve `WITH GROUP_TOTALS, TOTALS` ile ara toplamları ve Özet satırını korur. Shopify'ın `Toplam` etiketini tek başına gizlemeye veya uygulama verisini yerleşik rapor hücresinde rozet olarak göstermeye yönelik bir seçeneği belgelerde bulunmadı. [28 Kasım'da kontrol edilen ShopifyQL toplam ayarları](https://shopify.dev/docs/api/shopifyql/latest/syntax/with) · [Shopify rapor editörü](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/reports-overview) · [App Events API](https://shopify.dev/docs/api/app-events/latest)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales, event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-product-level-v2'
GROUP BY day, event."adstable-1".ecosystem_role_probe.product_id, event."adstable-1".ecosystem_role_probe.sku, event."adstable-1".ecosystem_role_probe.product_name, event."adstable-1".ecosystem_role_probe.platform, event."adstable-1".ecosystem_role_probe.campaign, event."adstable-1".ecosystem_role_probe.channel, event."adstable-1".ecosystem_role_probe.contribution_role, event."adstable-1".ecosystem_role_probe.sales_role, event."adstable-1".ecosystem_role_probe.advertised_product, event."adstable-1".ecosystem_role_probe.sold_product WITH GROUP_TOTALS, TOTALS
SINCE 2026-11-27 UNTIL 2026-11-27
ORDER BY day ASC, event."adstable-1".ecosystem_role_probe.product_id ASC, event."adstable-1".ecosystem_role_probe.sku ASC, event."adstable-1".ecosystem_role_probe.product_name ASC, event."adstable-1".ecosystem_role_probe.platform ASC, event."adstable-1".ecosystem_role_probe.campaign ASC, event."adstable-1".ecosystem_role_probe.channel ASC, event."adstable-1".ecosystem_role_probe.contribution_role ASC, event."adstable-1".ecosystem_role_probe.sales_role ASC, event."adstable-1".ecosystem_role_probe.advertised_product ASC
```

### Product Level 1 · Yatay yığılmış satış grafiği

28 Kasım 2026. Ürün sahibi, aynı test mağazasında satılan ürün tarafına tek Cross Sell örneği eklenmesini ve mevcut rapora yatay yığılmış grafik konmasını onayladı. [Gönderim betiği](evidence/eo06-shopify-analytics-probe/send-product-level-cross-sell.mjs), önceki Bileklik → Kolye ilişkisinin 80 TL tutarını Kolye'nin `Contribution From` / `Cross Sell` satış satırı olarak aynı prova günü ve kampanya altında bir kez gönderir. Bilekliğin `Contribution To` kaydı değişmez. [Gönderim makbuzu](https://vercel.com/firats-projects-d22284db/ads-table-embedded/BcNFdmj2KJCUSfoYmxr5J8z7ovTP) ve çevrimdışı yük kontrolü doğrulandı.

[Product Level 1](https://admin.shopify.com/store/adstable-development/analytics/reports/506167385) yerinde kaydedildi. Kısa bağlantıdan yeniden açıldığında Yığılmış yatay grafik, 15 detay satırı ve 7.880 TL Sales / 200 TL Contribution To görüldü. Grafik yalnız Sales metriğini Product Name ve Sales Roles boyutlarına göre böler. Direct 4.400 TL, Cross Sell 80 TL ve Indirect 3.400 TL, 7.880 TL satış toplamını oluşturur. Altı prova ürününün tamamı grafiğe sığar. Mevcut ayrıntı sütunları korunur. Shopify grafik gruplaması için Product Name ve Sales Roles başa, Gün sona alındı. [28 Kasım'da kontrol edilen ShopifyQL grafik belgesi](https://shopify.dev/docs/api/shopifyql/latest/syntax/visualize#bar-charts)

```sql
FROM app_events
SHOW event."adstable-1".ecosystem_role_probe.ecosystem_sales, event."adstable-1".ecosystem_role_probe.ecosystem_contribution_to
WHERE event."adstable-1".ecosystem_role_probe.probe_run = 'eo06e-development-product-level-v2'
GROUP BY event."adstable-1".ecosystem_role_probe.product_name, event."adstable-1".ecosystem_role_probe.sales_role, event."adstable-1".ecosystem_role_probe.product_id, event."adstable-1".ecosystem_role_probe.sku, event."adstable-1".ecosystem_role_probe.platform, event."adstable-1".ecosystem_role_probe.campaign, event."adstable-1".ecosystem_role_probe.channel, event."adstable-1".ecosystem_role_probe.contribution_role, event."adstable-1".ecosystem_role_probe.advertised_product, event."adstable-1".ecosystem_role_probe.sold_product, day WITH GROUP_TOTALS, TOTALS
SINCE 2026-11-27 UNTIL 2026-11-27
ORDER BY event."adstable-1".ecosystem_role_probe.product_name ASC, event."adstable-1".ecosystem_role_probe.sales_role ASC, event."adstable-1".ecosystem_role_probe.product_id ASC, event."adstable-1".ecosystem_role_probe.sku ASC, event."adstable-1".ecosystem_role_probe.platform ASC, event."adstable-1".ecosystem_role_probe.campaign ASC, event."adstable-1".ecosystem_role_probe.channel ASC, event."adstable-1".ecosystem_role_probe.contribution_role ASC, event."adstable-1".ecosystem_role_probe.advertised_product ASC, event."adstable-1".ecosystem_role_probe.sold_product ASC
VISUALIZE event."adstable-1".ecosystem_role_probe.ecosystem_sales TYPE stacked_horizontal_bar MAX 6
```

28 Kasım 2026. Ürün sahibi, grafik için yapılan sütun ve satır sırası değişikliğini kabul etmedi. Özgün sıralamayla grafik denendiğinde Shopify, Gün ve Product ID boyutlarını kullanarak 27 Kasım için tek bir yığılmış çubuk çizdi. Bu görünüm kaydedilmedi. Product Level 1, Gün → Product ID → SKU → Product Name → Platform → Campaign → Channel → Contribution Roles → Sales Roles → Advertised Product → Sold Product düzeni ve Tablo görünümüyle yeniden kaydedildi. Kısa bağlantıdan tekrar açıldığında 15 satır ve 7.880 TL Sales / 200 TL Contribution To doğrulandı. Kolye için eklenen 80 TL Cross Sell satırı provada duruyor.

### Product Title ve Channel Level ilk önizlemesi

28 Kasım 2026. Ürün sahibinin Shopify terminolojisi kararıyla Product Level 1 sütun başlığı, ShopifyQL alias üzerinden Product Title oldu. Kısa rapor bağlantısından yeniden açıldığında özgün tablo sırası, 15 satır ve 7.880 TL Sales / 200 TL Contribution To doğrulandı. [Shopify ürün başlığı](https://help.shopify.com/tr/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields) · [ShopifyQL alias](https://shopify.dev/docs/api/shopifyql/latest/syntax/from-and-show#as)

Channel Level önizlemesinde mevcut sentetik provanın satış satırları Gün → Platform → Campaign → Channel → Sales Roles → Advertised Product → Sold Product olarak gruplandı. Shopify 13 satış satırı ve 7.880 TL Sales gösterdi. V52 Channel görünümündeki Interactivity ve Interacted Channel, doğrulanmış hedef yerleşim alanları gerektirir. Bu prova yalnız kaynak kanalın satışını doğrular. Ayrı Channel Level raporu henüz kaydedilmedi.

### Channel Level · Filtresiz Shopify raporu

28 Kasım 2026. Ürün sahibi [Channel Level olay sürümünü](https://dev.shopify.com/dashboard/239318688/apps/432251994113/versions/1270366896129) yayımladı. Ayrı onayla [gönderim betiği](evidence/eo06-shopify-analytics-probe/send-channel-level.mjs) AdsTable Development'a aynı kanala ait iki sentetik olay gönderdi. Vercel [gönderim kaydı](https://vercel.com/firats-projects-d22284db/ads-table-embedded/CRNMpSQtpZ6pAQTKz388vGxJXVwS) iki 202 ve success yanıtını gösterdi. Uygulama alan adı önceki dağıtıma bağlı kaldı.

[Channel Level](https://admin.shopify.com/store/adstable-development/analytics/reports/506265689) 27 Kasım 2026 için kaydedildi ve kısa bağlantıdan yeniden açıldı. Küpeler → Same Channel → This Channel → Gümüş Küpe altında Contribution From ve Contribution To iki ayrı satırdır. Özet 500 TL Sales ve 80 TL Contribution To gösterir. Filtreler paneli boştur. Bu sentetik kanıt Same Channel dalının sunumuna aittir.
