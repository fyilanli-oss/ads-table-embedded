# EO-04-D — Klaviyo reporting runtime analyst brief

## Durum ve yetki

- Ürün sahibi analitik modeli ve repository-only runtime başlangıcını 17 Ekim 2026'da kabul etti.
- API revision: `2026-10-15`.
- Bu paket canlı Klaviyo çağrısı, database/migration, secret/environment, deploy veya UI değişikliği yapmaz.
- K-1 review-safe foundation PR'ından bağımsız olarak güncel `main` üzerinden yürür.

## Bağlayıcı hiyerarşi

```text
Campaign -> Campaign Audience -> Campaign Message (Channel) -> Variation
Flow     -> Flow Message (Channel)                              -> Variation
```

`Campaign Audience` provider targeting/configuration katmanıdır; AdsTable
Channel değildir. 2026-10-15 omnichannel Campaigns API bu ara katmanı resmî
resource hierarchy içinde tanımlar. Reporting API'nin zorunlu Channel grain'i
yine `campaign_message_id` olarak kalır.

`Campaign Message` ve `Flow Message` provider entity'si AdsTable Channel'dır. Provider Message adı Channel adıdır. Variation ayrı alt kırılımdır ve hiçbir durumda Channel'ın yerine geçmez.

`send_channel` zorunlu Medium kanıtıdır. Desteklenen güncel değerler `Email`, `SMS`, `WhatsApp` ve `Push` olarak provider ham değeriyle birlikte korunur. Medium tahmin edilmez; bulunamaz veya yeni/desteklenmeyen bir değer gelirse satır sessizce yayımlanmaz.

## Channel çözümü

1. Message biliniyor, exact Variation biliniyorsa Channel yine Message'dır; Variation ayrıca exact tutulur.
2. Message biliniyor, Variation bilinmiyorsa Channel exact Message'dır; yalnız Variation `unresolved` kalır.
3. Message altında çok sayıda Variation bulunması `Unclassified Channel` veya sentetik `Multi Channel` üretmez.
4. Variation adayları ana UI verisi değildir ve satış aday Variation'lara dağıtılmaz.
5. `Unclassified Channel` yalnız Message bulunamadığında, Message kataloğu çözülemediğinde veya Message/Variation ilişkisi çeliştiğinde kullanılır.

## Sales Role

- Campaign exact içerik ürün kümesinde satılan ürün: `Advertised`.
- Campaign exact içerik ürün kümesinin dışında satılan ürün: `Cross-sell`.
- Campaign içerik ürün kümesi kanıtlanamıyorsa: `Assisted`.
- Campaign kanıtı gerçekten çelişkiliyse: `Unclassified`.
- Geçerli Flow attribution'lı satış: `Triggered`.
- Flow Message ile Variation ebeveyn ilişkisi çelişiyorsa: `Unclassified`.

## Metric ve ürün satış kaynağı

Klaviyo metric discovery yalnız `integration.name = Shopify` altında yapılır. `Placed Order` ve `Ordered Product` metric ID'leri ayrı ayrı ve tam bir kez çözülmelidir.

- `Placed Order`: Campaign/Flow Reporting API için `conversion_metric_id`.
- `Ordered Product`: ürün seviyesindeki satış event'i.
- İki metric aynı satışı iki kez saymak için birlikte kullanılmaz.
- Profile include edilmez; PII reporting paketine alınmaz.
- ProductID, VariantID, SKU, ProductName, Variant Name, Quantity ve `$value` yalnız response içinde gerçekten gözlemlendiği biçimde korunur. Bu pakette standardize Product ID üretilmez.

## Günlük grain ve performans

Campaign ve Flow Values sorguları bağlı Klaviyo hesabının IANA timezone'u ile tek business-day aralığı kullanır. Başlangıç ve bitiş offset'leri DST dahil ayrı hesaplanır. İlk bootstrap yalnız `yesterday`, sonra `today` sırasındadır; scheduler ve reconciliation EO-05'e aittir.

Reporting satırı en az Message ID, Message Name ve `send_channel` içermelidir. Variation ID/Name birlikte gelirse exact; ikisi de gelmezse unresolved; kısmi gelirse schema hatasıdır.

## Hata ve yayın sınırı

- İlk provider hatası bütün kalan Klaviyo sorgu ailelerini durdurur.
- Otomatik retry veya alternatif endpoint yoktur.
- Kısmi sonuç publish edilmez.
- Başarılı boş cevap yalnız `not_observed_in_this_execution` anlamındadır; numeric zero veya global unsupported kanıtı değildir.

## 18 Ekim 2026 resmî kaynak kontrolü

1. [Campaigns API overview](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)
2. [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
3. [Get Metrics](https://developers.klaviyo.com/en/reference/get_metrics)
4. [Get Events](https://developers.klaviyo.com/en/reference/get_events)
5. [Shopify data reference](https://help.klaviyo.com/hc/en-us/articles/115005080447)
