# EO-04-D — Klaviyo Official Reporting Capability Baseline

**Kontrol tarihi:** 13 Ekim 2026  
**Durum:** Resmî provider gerçekleri kaydedildi; AdsTable Channel sözleşmesi ve runtime uygulaması henüz başlamadı.

## Amaç

Bu kayıt, Klaviyo'yu Meta ve Google Ads için ulaşılan araştırma seviyesine çıkarır. Yalnız güncel resmî Klaviyo belgelerinde doğrulanabilen provider gerçeklerini sınıflandırır.

Bu belge:

- Channel hiyerarşisi seçmez;
- Dataset veya canonical entity üretmez;
- provider request/runtime kodu tanımlamaz;
- API çağrısı, veri çekimi, migration, secret, environment veya deployment değişikliği yetkilendirmez;
- product attribution, cross-sell veya maliyet dağıtımı konusunda kanıtlanmamış bağ kurmaz.

Channel sözleşmesi ancak ürün sahibinin açık cümlesi ve ayrı kabulüyle kurulabilir.

## Resmî kaynaklar

13 Ekim 2026 tarihinde aşağıdaki Klaviyo kaynakları kontrol edildi:

1. [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
2. [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values)
3. [Campaigns API overview](https://developers.klaviyo.com/en/reference/campaigns_api_overview)
4. [Get Campaigns](https://developers.klaviyo.com/en/reference/get_campaigns)
5. [Get Campaign Message](https://developers.klaviyo.com/en/reference/get_campaign_message)
6. [Flows API overview](https://developers.klaviyo.com/en/reference/flows_api_overview)
7. [Get Flow Message](https://developers.klaviyo.com/en/reference/get_flow_message)
8. [Events API overview](https://developers.klaviyo.com/en/reference/events_api_overview)
9. [Get Events](https://developers.klaviyo.com/en/reference/get_events)
10. [Rate limits, status codes, and errors](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling)
11. [Campaigns API multi-channel/variation preview](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)
12. [Get Variations for Campaign Message — beta](https://developers.klaviyo.com/en/reference/get_variations_for_campaign_message_beta)

Karar zamanı stable dokümantasyon sürümü '2026-07-15'tir. Campaign Variation resource yüzeyi '2026-07-15.pre' beta durumundadır ve resmî belgede 15 Ekim 2026 GA revizyonu hedeflenmektedir. Bu nedenle variation resource kullanımı 15 Ekim veya sonrasında resmî stable belgeyle tekrar doğrulanmadan runtime bağımlılığı olamaz.

## Doğrulanmış provider-native yapı

### Campaign reporting

Klaviyo Reporting API campaign sonuçlarını varsayılan olarak şu provider alanlarıyla gruplar:

- 'campaign_id'
- 'campaign_message_id'
- 'send_channel'

Açık bir 'group_by' gönderildiğinde 'campaign_id' ve 'campaign_message_id' zorunludur. Ek kırılım olarak campaign message name, variation, variation name, send channel, group, group name, text-message format ve tag alanları belgelenmiştir.

Bunun kanıtladığı sınır şudur:

- Campaign ve Campaign Message, stable Reporting API'nin zorunlu provider grain'idir.
- Variation, Reporting API'de belgelenmiş bir raporlama boyutudur.
- Variation'ın AdsTable'da ayrı canonical entity veya kullanıcıya sunulan Channel olması henüz kararlaştırılmamıştır.
- Beta Campaign Variation resource yüzeyi, stable Reporting API'deki variation boyutuyla otomatik olarak aynı sözleşme kabul edilemez.

### Flow reporting

Klaviyo Reporting API flow sonuçlarını varsayılan olarak şu provider alanlarıyla gruplar:

- 'flow_id'
- 'flow_message_id'
- 'send_channel'

Açık bir 'group_by' gönderildiğinde 'flow_id' ve 'flow_message_id' zorunludur. Ek kırılım olarak flow name, flow message name, variation, variation name, send channel, text-message format ve tag alanları belgelenmiştir.

Bunun kanıtladığı sınır şudur:

- Flow ve Flow Message, stable Reporting API'nin zorunlu provider grain'idir.
- Variation belgelenmiş bir raporlama boyutudur; canonical entity veya Channel kararı değildir.

## Doğrulanmış performans gerçekleri

Reporting API, Klaviyo arayüzüyle 1:1 performance eşleşmesi için önerilen yüzeydir. Klaviyo, Query Metric Aggregates sonucunun campaign/flow arayüz performansıyla birebir eşleşmeyebileceğini açıkça belirtir.

Seçilen 'conversion_metric_id'ye bağlı olarak Reporting API conversions, conversion uniques, conversion value, conversion rate, average order value ve revenue per recipient istatistiklerini; ayrıca recipients, delivered, opens ve clicks ailelerini sağlayabilir.

Bu alanlar provider-native sonuçlardır. AdsTable'ın purchase, sales, session, add to cart veya başka canonical kavramlarına dönüşmeleri bu belgede yapılmaz. Hangi Klaviyo metric ID'sinin hangi AdsTable metriğine karşılık geleceği ayrı Channel/veri sözleşmesinde açıkça belirlenmelidir.

## Ürün gerçekleri ve kesin sınır

Events API event kayıtlarında 'event_properties' alanını verir. Klaviyo'nun resmî Ordered Product örneği ProductID, SKU, ProductName, Quantity, event value ve ürün URL'si alanlarını gösterir.

Bu, Klaviyo hesabındaki uygun commerce event'lerinde SKU, ürün adı, adet ve değer bilgisinin bulunabileceğini kanıtlar.

Bu bilgi tek başına şunları kanıtlamaz:

- Her mağaza veya entegrasyonun aynı property adlarını ürettiğini;
- her Placed Order/Ordered Product event'inin eksiksiz olduğunu;
- ürün event'inin belirli Campaign Message, Flow Message veya variation'a güvenilir biçimde bağlanabildiğini;
- message/variation seviyesinde SKU, product name, purchase ve sales toplamının API sözleşmesiyle garanti edildiğini;
- cross-sell sınıflandırmasını.

Events endpoint'i attribution relationship okuyabilse de güncel reference bu ilişkinin AdsTable'ın ihtiyaç duyduğu stable message/variation/product join sözleşmesini tek başına garanti etmez. Bu bağ gerçek provider response kanıtı ve ayrı kabul olmadan kurulamaz.

## Kota ve sayfalama gerçekleri

- Campaign Values endpoint'i resmî reference'ta '1/s' burst, '2/m' steady ve '225/day' sınırıyla belgelenmiştir.
- Flow Values endpoint'i aynı düşük reporting sınıfında belgelenmiştir ve implementasyon öncesi güncel endpoint reference üzerinden yeniden doğrulanmalıdır.
- Kaynak endpointleri cursor pagination kullanır; response içindeki provider 'links.next' değeri izlenmelidir.
- OAuth app kotaları kurulum başına/provider hesabı başına uygulanır.
- '429' yanıtında 'Retry-After' beklenmeden tekrar denenemez.
- '429' ve '503' için bounded backoff uygulanması resmî öneridir; bu belge runtime politikasını uygulamaz.

Bu kotalar EO-05 scheduler bütçesine girdi olur; bu belge scheduler kararı vermez.

## Support-state başlangıç sınıflandırması

| Soru | 13 Ekim 2026 durumu | Gerekçe |
|---|---|---|
| Campaign → Campaign Message yapısı | documented | Stable Campaigns ve Reporting API |
| Flow → Flow Message yapısı | documented | Stable Flows ve Reporting API |
| Campaign/Flow Message performance | documented | Zorunlu Reporting API group alanları |
| Variation performance dimension | documented_pending_acceptance | Reporting API group alanı; AdsTable entity kararı yok |
| Stable Campaign Variation resource | beta_pending_2026-10-15_revalidation | '2026-07-15.pre' |
| Conversion count/value | documented_metric_dependent | 'conversion_metric_id' zorunluluğu |
| Event product ID/SKU/name/quantity/value | documented_event_property_capability | Events API Ordered Product örneği |
| Product → message/variation attribution | unknown_requires_live_evidence | Stable join garantisi kanıtlanmadı |
| Email cost allocation | not_decided | Estimated Spend defteri var; dağıtım sözleşmesi yok |
| AdsTable Channel hierarchy | not_decided | Ürün sahibi kararı bekleniyor |
| Dataset mapping | not_started | EO-05 sorumluluğu |

Buradaki documented yalnız provider belgesinde alan/yüzey bulunduğunu ifade eder. AdsTable implementasyon desteği veya ürün kabulü anlamına gelmez.

## Channel sözleşmesinden önce cevaplanacak sorular

Aşağıdaki maddeler karara bağlanmadan Klaviyo reporting runtime'ı yazılamaz:

1. Campaign ve Flow aynı kullanıcı-facing Channel modelinde mi, ayrı kök türlerinde mi gösterilecek?
2. Campaign Message ve Flow Message ortak en alt stable leaf olarak mı kabul edilecek?
3. Variation yalnız kırılım/etiket mi, yoksa gerçek leaf entity mi olacak?
4. Hangi conversion metric ID purchase ve sales için yetkilidir?
5. Shopify commerce event property adları provider/account bazında nasıl doğrulanacak?
6. Product event ile Campaign/Flow Message ilişkisi hangi resmî attribution anahtarıyla kanıtlanacak?
7. Kanıt yoksa product-at-message durumu unknown mı, unsupported mı kalacak?
8. Estimated email spend Campaign/Flow/Message seviyelerine nasıl dağıtılacak veya hiç dağıtılmayacak mı?
9. Reporting API'nin düşük günlük kotası bootstrap, refresh ve reconciliation bütçesine nasıl bölünecek?
10. Stable '2026-10-15' revision variation sözleşmesini nasıl değiştirecek?

## Zorunlu durma kuralı

Ürün sahibi Channel standardını açıkça söyleyip kabul edene kadar:

- Klaviyo reporting request/runtime kodu yazılmaz;
- canlı Klaviyo reporting veya Events API çağrısı yapılmaz;
- Dataset, migration veya canonical fact oluşturulmaz;
- Campaign/Flow/Message/Variation arasında AdsTable hiyerarşisi dondurulmaz;
- product attribution veya cost allocation uygulanmaz;
- bu belge implementasyon yetkisi olarak kullanılamaz.
