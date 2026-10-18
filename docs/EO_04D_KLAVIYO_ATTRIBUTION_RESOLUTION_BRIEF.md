# EO-04-D — Klaviyo satış attribution çözümleme analist brief'i

## Karar

Bu paket, `Ordered Product` satış event'ini Campaign/Flow raporlarında bulunan
Message kataloğuyla birleştirir. Bir `Ordered Product` event'i bir satış
gerçeğidir ve yalnız bir kez korunur. `Placed Order` yalnız Campaign/Flow
performans conversion kaynağıdır; aynı satışı ikinci kez üretmez.

Channel yalnız Klaviyo'nun event attribution ilişkisiyle belirlenir. Satış
zamanı, rapor toplamı veya yakın tarihli mesaj tahmin için kullanılamaz.

## Campaign

- `campaign-message` varsa Channel kesin olarak Campaign Message'dır.
- Resmî Events şeması Campaign Variation vermediği için Variation
  `unresolved` kalır.
- Message kataloğunda tek `send_channel` eşleşirse Medium exact olur.
- Katalog satırı yoksa veya aynı Message birden fazla Medium taşıyorsa Channel
  kaybedilmez; yalnız ad ve/veya Medium `unresolved` kalır.
- Campaign içerik ürün seti ayrıca ve kesin kanıtlanmadıkça Sales Role
  `Assisted` olur. Kesin ürün seti geldiğinde satılan ürün içerideyse
  `Advertised`, dışarıdaysa `Cross-sell` olarak yeniden çözülebilir.

Örnek: `Sonbahar Takıları` Message'ından attribution alan `Kolye` satışı,
içerikteki ürün seti okunmamışsa `Channel = Sonbahar Takıları`,
`Medium = Email`, `Variation = unresolved`, `Sales Role = Assisted` olur.

## Flow

- `flow-message` varsa Channel kesin olarak Flow Message'dır.
- `flow-message-variation` tekil gelirse Variation exact tutulur; Variation
  Channel'ın yerine geçmez.
- Aynı Flow Message altında birden fazla Variation attribution görülürse
  Channel korunur, Variation `unresolved` olur.
- Geçerli Flow Message attribution'lı satışın Sales Role'u `Triggered` olur.

## Unclassified Channel sınırı

Katalogda Message adı, Medium veya Variation bulunamaması, provider Message ID'si
biliniyorsa Channel'ı `Unclassified Channel` yapmaz. `Unclassified Channel` yalnız Message
attribution'ı yoksa, farklı Message'lar aynı satış için çelişiyorsa, Campaign ve
Flow aynı attribution'da çelişiyorsa veya Message-parent ilişkisi bozuksa
kullanılır. Satış yine bir kez korunur ve Sales Role `Unclassified` olur.

## Hata ve yayın sınırı

Çözümleme, dört provider sorgu ailesi tamamlandıktan sonra yerel olarak çalışır.
Çelişen aynı event ID, bozuk attribution şeması veya resolver hatası bütün
snapshot'ı `publishable: false` yapar; provider ailelerinin kısmi sonucu
yayımlanmaz. Başarılı boş event listesi `not_observed_in_this_execution` olarak
kalır, sayısal sıfıra çevrilmez.

## Paket dışı

- Canlı Klaviyo çağrısı
- Database/migration, Dataset V2, scheduler veya reconciliation
- Campaign içeriklerinin provider'dan okunması
- Product ID standardizasyonu
- UI, deploy, secret veya environment değişikliği

## Resmî kaynak kontrolü

Kontrol tarihi: **17 Ekim 2026**. Kullanılan Klaviyo API revision:
**2026-10-15**.

- [Get Events](https://developers.klaviyo.com/en/reference/get_events)
- [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values)
- [Query Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values)
- [Klaviyo resmî OpenAPI repository](https://github.com/klaviyo/openapi)

OpenAPI, Event attribution kaynağında Campaign için `campaign` ve
`campaign-message`; Flow için `flow`, `flow-message` ve
`flow-message-variation` ilişkilerini tanımlar. Campaign variation ilişkisi
tanımlamaz.

## Kabul ölçütü

Sentetik senaryolar Campaign, Flow, çoklu Variation, eksik attribution,
çelişen Message, içerik kanıtı ve çift sayım engelini kapsamalıdır. Tüm repository
testleri, typecheck ve production build geçmeli; teslim PR üzerinden yapılmalı
ve merge için ayrıca ürün sahibi onayı alınmalıdır.
