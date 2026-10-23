# EO-04-D — Klaviyo satış kaynağını çözümleme analist brief'i

**Tarihsel kapsam:** 17 Ekim 2026 satış eşleştirme uygulaması.
Güncel paket kabulü ve iş sırası `docs/EXECUTION_PLAN.md`, nihai anlatım
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. Bu belge geçmiş kapsamı korur;
yeni sağlayıcı çağrısı veya ürün kararı oluşturmaz.

## Karar

Bu paket, `Ordered Product` satış olayını Campaign/Flow raporlarında bulunan
Message kataloğuyla birleştirir. Bir `Ordered Product` olayı bir satış
gerçeğidir ve yalnız bir kez korunur. `Placed Order` yalnız Campaign/Flow
performans dönüşümü kaynağıdır; aynı satışı ikinci kez üretmez.

Channel yalnız Klaviyo'nun olay attribution (satışı kaynağa atfetme) ilişkisiyle belirlenir. Satış
zamanı, rapor toplamı veya yakın tarihli mesaj tahmin için kullanılamaz.

## Campaign

- `campaign-message` varsa Channel kesin olarak Campaign Message'dır.
- Resmî Events şeması Campaign Variation vermediği için Variation
  `unresolved` kalır.
- Message kataloğunda tek `send_channel` eşleşirse Medium kesinleşir.
- Katalog satırı yoksa veya aynı Message birden fazla Medium taşıyorsa Channel
  kaybedilmez; yalnız ad ve/veya Medium çözümlenmemiş (`unresolved`) kalır.
- 23 Ekim 2026 düzeltmesi: kesin içerik ürün seti bile etkileşime konu ürünü
  kanıtlamaz. Satılan ürün setin içinde veya dışında olsa da yalnız bu kanıtla
  Sales Role `Assisted` olur; `Advertised` / `Cross-sell` üretilmez.
- Ürün etkileşiminin aynı satışa doğrulanmış bağlantısı gelecekte ayrıca
  tasarlanmalıdır. Bu düzeltme yeni bir sağlayıcı alanı veya kanıt yolu eklemez.

Örnek: `Sonbahar Takıları` Message'ından attribution alan `Kolye` satışı,
içerikteki ürün seti okunmamışsa `Channel = Sonbahar Takıları`,
`Medium = Email`, `Variation = unresolved`, `Sales Role = Assisted` olur.

## Flow

- `flow-message` varsa Channel kesin olarak Flow Message'dır.
- `flow-message-variation` tekil gelirse Variation kesin olarak tutulur; Variation
  Channel'ın yerine geçmez.
- Aynı Flow Message altında birden fazla Variation attribution görülürse
  Channel korunur, Variation `unresolved` olur.
- Geçerli Flow Message attribution'lı satışın Sales Role'u `Triggered` olur.

## Unclassified Channel sınırı

Katalogda Message adı, Medium veya Variation bulunamaması, sağlayıcının Message ID'si
biliniyorsa Channel'ı `Unclassified Channel` yapmaz. `Unclassified Channel` yalnız Message
attribution'ı yoksa, farklı Message'lar aynı satış için çelişiyorsa, Campaign ve
Flow aynı attribution'da çelişiyorsa veya Message'ın üst varlık ilişkisi bozuksa
kullanılır. Satış yine bir kez korunur ve Sales Role `Unclassified` olur.

## Hata ve yayın sınırı

Çözümleme, dört sağlayıcı sorgu ailesi tamamlandıktan sonra yerel olarak çalışır.
Çelişen aynı olay kimliği, bozuk attribution şeması veya çözümleyici hatası bütün
anlık görüntüyü `publishable: false` yapar; sağlayıcı ailelerinin kısmi sonucu
yayımlanmaz. Başarılı boş olay listesi `not_observed_in_this_execution` olarak
kalır, sayısal sıfıra çevrilmez.

## Paket dışı

- Canlı Klaviyo çağrısı
- Veritabanı/migration, Dataset V2, zamanlayıcı veya veri uzlaştırma
- Campaign içeriklerinin sağlayıcıdan okunması
- Product ID standardizasyonu
- UI, dağıtım, secret veya ortam değişikliği

## Resmî kaynak kontrolü

Kontrol tarihi: **17 Ekim 2026**. Kullanılan Klaviyo API sürümü:
**2026-10-15**.

- [Olayları alma](https://developers.klaviyo.com/en/reference/get_events)
- [Campaign değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_campaign_values)
- [Flow değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_flow_values)
- [Klaviyo resmî OpenAPI repository](https://github.com/klaviyo/openapi)

OpenAPI, Event attribution kaynağında Campaign için `campaign` ve
`campaign-message`; Flow için `flow`, `flow-message` ve
`flow-message-variation` ilişkilerini tanımlar. Campaign variation ilişkisi
tanımlamaz.

## Kabul ölçütü

Sentetik senaryolar Campaign, Flow, çoklu Variation, eksik attribution,
çelişen Message, içerik kanıtı ve çift sayım engelini kapsamalıdır. Tüm repository
testleri, typecheck ve Production derlemesi geçmeli; teslim PR üzerinden yapılmalı
ve merge için ayrıca ürün sahibi onayı alınmalıdır.
