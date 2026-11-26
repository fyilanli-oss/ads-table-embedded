# EO-06-E Shopify Analizler olay taslağı

[Analytics olay taslağı](shopify.extension.toml.example) AdsTable Development provası için tek olay, altı zorunlu alan ve iki toplam ölçüsü tanımlar. Olay adı için gözlenen AdsTable handle'ı `adstable-1` kullanıldı. Bu örnek `docs/evidence` altında yer alır. Uygulamanın dağıtılan `extensions/` dizini, `shopify.app.toml`, OAuth kapsamları ve yayın işi bu çalışmanın dışında kaldı.

## Sürüm farkında aranacaklar

- Shopify'da yetkili adım başladığında mevcut AdsTable uygulama kimliği, olay öneki ve AdsTable Development mağazasının kesin Shop GID'si doğrulanır.
- Yayımlanmamış sürüm farkında yalnız `ecosystem-sales-probe` uzantısının eklendiği görülür. Mevcut sürümde kaldırma veya başka bir fark görülürse yayın değerlendirmesi durur.
- Olay tanımının kapsamı uygulama genelidir. Sentetik gönderim hedefi doğrulanmış tek test mağazasıdır. Taslaktaki `TRY` olaya sabittir. Bu prova çoklu para birimi için yayın kararı içermez.

Bu çalışma dosya farkını ve sentetik örneği inceler. Shopify'daki gerçek sürüm farkı, olayın kabulü ve rapor görünümü ayrı kanıt bekliyor.

## Gönderim örnekleri

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

## ShopifyQL prova sorgusu

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
