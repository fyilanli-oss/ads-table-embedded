# EO-04-D — Klaviyo official reporting capability baseline

**İlk kontrol:** 13 Ekim 2026

**GA yeniden doğrulama:** 16 Ekim 2026

**Durum:** Provider gerçekleri güncel; bağlayıcı AdsTable kararı `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md` içindedir.

## Amaç ve yetki sınırı

Bu kayıt yalnız Klaviyo'nun güncel resmî API kabiliyetini ve kesin sınırlarını kaydeder. Dataset V2, provider runtime, canlı API çağrısı, migration, secret, environment, deployment veya estimated-spend dağıtımı yetkilendirmez.

## 16 Ekim resmî kaynak kontrolü

1. [Klaviyo changelog](https://developers.klaviyo.com/en/docs/changelog_)
2. [Omnichannel Campaign API](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)
3. [Get Campaign Variation](https://developers.klaviyo.com/en/reference/get_campaign_variation)
4. [Get Variations for Campaign Message](https://developers.klaviyo.com/en/reference/get_variations_for_campaign_message)
5. [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
6. [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values)
7. [Query Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values)
8. [Query Flow Series](https://developers.klaviyo.com/en/reference/query_flow_series)
9. [Get Events](https://developers.klaviyo.com/en/reference/get_events)
10. Klaviyo resmî OpenAPI stable `campaigns`, `reporting` ve `events` şemaları

`2026-10-15` revision Campaign Variation resource'unu GA olarak yayımlamıştır. Önceki `2026-07-15.pre` beta bekleme kaydı kapanmıştır.

## Campaign gerçekleri

- Provider hierarchy `Campaign -> Campaign Audience -> Campaign Message -> Campaign Variation` biçimindedir.
- Campaign Values açık `group_by` kullanımında `campaign_id` ve `campaign_message_id` zorunludur.
- `variation` ve `variation_name` belgelenmiş reporting boyutlarıdır.
- Campaign Variation artık gerçek GA resource'tur ve `campaigns:read` scope'u içinde okunur.
- Campaign için Values endpoint'i vardır; Flow'daki gibi ayrı Campaign Series endpoint'i yoktur.
- Günlük grain gerekiyorsa her business day için ayrı tek-gün timeframe sorgulanır; series varmış gibi cevap üretilmez.

## Flow gerçekleri

- Flow reporting `flow_id` ve `flow_message_id` zorunlu grouping alanlarını kullanır.
- Variation ve variation name Flow reporting boyutlarıdır.
- Events attribution relationship'i `flow-message` ve `flow-message-variation` ilişkilerini açıkça içerebilir.
- Flow Values ve Flow Series ayrı resmî endpointlerdir.

## Event attribution asimetrisi

Klaviyo stable Events OpenAPI şemasında attribution ilişkileri şunları içerir:

- `campaign`
- `campaign-message`
- `flow`
- `flow-message`
- `flow-message-variation`

Aynı şemada `campaign-variation` attribution relationship'i yoktur. Bunun sonucu:

1. Tek variation'lı Campaign'de message-attributed sold product tek mümkün variation'a exact bağlanabilir.
2. Çoklu variation'lı Campaign'de variation performance exact olmasına rağmen sold product yalnız Message'a bağlıdır.
3. Çoklu variation ürün satışı A veya B variation'a dağıtılamaz; Message bağlamıyla `Unknown Channel` altında korunur.
4. Flow event'i variation relationship verirse exact Flow Message Variation; yalnız message verirse Flow Message kullanılır.

Bu kurallar synthetic çıkarım değil, provider schema sınırıdır.

## Ürün alanları

Klaviyo'nun resmî Ordered Product örneği ProductID, SKU, ProductName, Quantity, event value ve ürün URL'si kabiliyetini gösterir. Bu alanlar:

- yalnız event response içinde gerçekten döndüğü ölçüde ham kanıttır;
- her hesapta aynı property adlarıyla geldiği varsayılamaz;
- capability/observation state ile kaydedilir;
- doğrulanmadan AdsTable SKU, ürün adı, purchase veya sales alanına sessizce dönüştürülemez.

Desteklenen kimlik yolu resmî Klaviyo Shopify entegrasyonudur. Özel/manual event üreticileri bu sürümün kapsamı dışındadır.

## Performance, conversion metric ve kota

- Klaviyo UI ile eşleşen Campaign/Flow performansı için Reporting API kullanılır.
- Her report için doğru `conversion_metric_id` açıkça seçilmelidir; Klaviyo metriği sessizce AdsTable metriğine yeniden adlandırılmaz.
- Campaign Values belgelenmiş düşük kota sınıfındadır: `1/s` burst, `2/min` steady, `225/day`.
- İlk bootstrap yalnız dün ve bugündür.
- Saatlik refresh, reconciliation ve workspace ölçek kota bütçesi EO-05'e aittir.
- Cursor, retry ve `Retry-After` ortak EO-04-A fail-closed kurallarına uyar.

## Güncel capability tablosu

| Soru | 16 Ekim 2026 durumu | Gerekçe |
|---|---|---|
| Campaign -> Message -> Variation | documented_stable | `2026-10-15` GA resource ve reporting dimension |
| Flow -> Message -> Variation | documented_stable | Reporting ve Event attribution schema |
| Campaign/Flow performance | documented_metric_dependent | `conversion_metric_id` zorunlu |
| Event product ID/SKU/name/quantity/value | documented_event_property_capability | Ordered Product örneği; hesap gözlemi gerekir |
| Campaign Event -> Message | documented_stable | Event attribution relationship |
| Campaign Event -> Variation | unsupported_by_current_event_relationship_schema | `campaign-variation` relationship yok |
| Flow Event -> Message Variation | documented_stable | Event attribution relationship |
| Campaign daily series | unavailable | Campaign Values var; Campaign Series yok |
| Email cost allocation | EO05_only | Estimated Spend var; dağıtım EO-04 işi değil |
| AdsTable Channel kararı | ready_for_product_owner_acceptance | Ortak brief/contract hazır |
| Dataset mapping | not_started | EO-05 sorumluluğu |

## Uygulama kapısı

Bu belge tek başına reporting runtime yetkisi değildir. Ortak brief/contract ürün sahibi tarafından kabul edilene kadar:

- Klaviyo reporting veya Events runtime kodu yazılmaz;
- canlı reporting çağrısı yapılmaz;
- Dataset/migration oluşturulmaz;
- estimated spend Channel veya ürüne dağıtılmaz.
