# EO-04-D — Klaviyo resmî raporlama kabiliyetleri başlangıç kaydı

**İlk kontrol:** 13 Ekim 2026

**Genel kullanıma açık sürüm (GA) yeniden doğrulaması:** 16 Ekim 2026

**Tarihsel durum:** 16/17 Ekim sağlayıcı kabiliyetleri kaydı.
Bağlayıcı AdsTable kararı `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`
içindedir. Güncel kabul ve sıra `docs/EXECUTION_PLAN.md`, nihai paket anlatımı
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` üzerinden okunur. Bugünkü dil düzenlemesi
yeni kota taahhüdü, sağlayıcı testi veya review araştırması değildir.

## Amaç ve yetki sınırı

Bu kayıt yalnız o gün kontrol edilen resmî Klaviyo API kabiliyetini ve kesin
sınırlarını kaydeder. Dataset V2, sağlayıcı çalışma zamanı, canlı API çağrısı,
migration, secret, ortam, dağıtım veya tahmini harcama dağıtımı yetkilendirmez.

## Tarihsel resmî kaynak kontrolü — 16 Ekim

1. [Klaviyo değişiklik günlüğü](https://developers.klaviyo.com/en/docs/changelog_)
2. [Çoklu iletişim ortamlı Campaign API](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)
3. [Campaign Variation alma](https://developers.klaviyo.com/en/reference/get_campaign_variation)
4. [Campaign Message'ın Variation kayıtlarını alma](https://developers.klaviyo.com/en/reference/get_variations_for_campaign_message)
5. [Raporlama API'sine genel bakış](https://developers.klaviyo.com/en/reference/reporting_api_overview)
6. [Campaign değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_campaign_values)
7. [Flow değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_flow_values)
8. [Flow zaman serisini sorgulama](https://developers.klaviyo.com/en/reference/query_flow_series)
9. [Olayları alma](https://developers.klaviyo.com/en/reference/get_events)
10. Klaviyo resmî OpenAPI kararlı `campaigns`, `reporting` ve `events` şemaları

`2026-10-15` sürümü Campaign Variation varlığını GA olarak yayımladı.
Önceki `2026-07-15.pre` beta bekleme kaydı kapandı.

## Campaign gerçekleri

- Sağlayıcı hiyerarşisi `Campaign -> Campaign Audience -> Campaign Message -> Campaign Variation` biçimindedir.
- Campaign Values için açık `group_by` kullanımında `campaign_id` ve `campaign_message_id` zorunludur.
- `variation` ve `variation_name` belgelenmiş raporlama boyutlarıdır.
- Campaign Variation gerçek GA varlığıdır; `campaigns:read` izniyle okunur.
- Campaign için Values endpoint'i vardır; Flow'daki gibi ayrı Campaign Series endpoint'i yoktur.
- Günlük kayıt düzeyi gerekiyorsa her iş günü için ayrı tek günlük zaman aralığı sorgulanır; zaman serisi varmış gibi cevap üretilmez.

## Flow gerçekleri

- Flow raporlaması `flow_id` ve `flow_message_id` zorunlu gruplama alanlarını kullanır.
- Variation ve Variation adı Flow raporlama boyutlarıdır.
- Events attribution ilişkisi `flow-message` ve `flow-message-variation` ilişkilerini açıkça içerebilir.
- Flow Values ve Flow Series ayrı resmî endpointlerdir.

## Olayın kaynağa atfındaki asimetri ve 17 Ekim ürün kararı

Klaviyo kararlı Events OpenAPI şemasında attribution ilişkileri şunları içerir:

- `campaign`
- `campaign-message`
- `flow`
- `flow-message`
- `flow-message-variation`

Aynı şemada `campaign-variation` attribution ilişkisi yoktur. Bunun sonucunda
17 Ekim 2026 ürün sahibi kararı, sağlayıcının Message ve Variation seviyelerini ayırdı:

1. Campaign Message AdsTable Channel'ıdır; Campaign Variation Channel değildir.
2. Flow Message AdsTable Channel'ıdır; Flow Message Variation Channel değildir.
3. `send_channel` zorunlu ayrı Medium kanıtıdır.
4. Message biliniyor fakat Variation bilinmiyorsa Channel kesin kalır; yalnız Variation çözümlenmemiş olur.
5. Çoklu Variation satışları A veya B Variation'a dağıtılamaz; Message biliniyorsa `Unclassified Channel` oluşmaz.
6. Flow olayı Variation ilişkisi verirse üst Flow Message Channel olarak çözülür; Variation ayrıca kesin tutulur.

Bu kurallar sentetik çıkarım değil, sağlayıcı şeması sınırıdır.
Campaign Audience sağlayıcı hiyerarşisinde korunur; AdsTable Channel'ı veya satış
bölme boyutu değildir. Bu ayrıntı kabul edilmiş raporlama çalışma zamanı sözleşmesindedir.

## Ürün alanları

Klaviyo'nun resmî Ordered Product örneği ProductID, SKU, ProductName, Quantity,
olay değeri ve ürün URL'si kabiliyetini gösterir. Bu alanlar:

- yalnız olay cevabında gerçekten döndüğü ölçüde ham kanıttır;
- her hesapta aynı alan adlarıyla geldiği varsayılamaz;
- kabiliyet/gözlem durumuyla kaydedilir;
- doğrulanmadan AdsTable SKU, ürün adı, purchase veya sales alanına sessizce dönüştürülemez.

Desteklenen kimlik yolu resmî Klaviyo Shopify entegrasyonudur. Özel/manuel olay
üreticileri bu sürümün kapsamı dışındadır.

## Performans, dönüşüm metriği ve tarihsel kota

- Klaviyo UI ile eşleşen Campaign/Flow performansı için Reporting API kullanılır.
- Her rapor için doğru `conversion_metric_id` açıkça seçilir; Klaviyo metriği sessizce AdsTable metriği diye yeniden adlandırılmaz.
- Campaign Values, o tarihte belgelenmiş düşük kota sınıfındaydı: `1/s` ani istek, `2/min` sürekli istek, `225/day`.
- İlk veri alımı yalnız dün ve bugündür.
- Saatlik yenileme, veri uzlaştırma ve çalışma alanı ölçeğindeki kota bütçesi EO-05'e aittir.
- Cursor, tekrar ve `Retry-After` ortak EO-04-A güvenli durma kurallarına uyar.

Kota değerleri tarihsel kaynak kaydıdır; yeni işletim öncesinde yeniden
doğrulanmalıdır. Bu belge otomatik tekrar veya yeni çağrı yetkisi vermez.

## Tarihsel kabiliyet tablosu

Teknik durum değerleri kaynak kayıttaki kimliklerdir; Türkçe açıklamaları yan sütundadır.
Tablodaki kısa Campaign yolu Audience'ı yok saymaz; tam hiyerarşi yukarıdadır.

| Soru | 16 Ekim 2026 durumu | Gerekçe |
| --- | --- | --- |
| Campaign -> Message -> Variation | documented_stable | `2026-10-15` GA varlığı ve raporlama boyutu |
| Flow -> Message -> Variation | documented_stable | raporlama ve olay attribution şeması |
| Campaign/Flow performansı | documented_metric_dependent | `conversion_metric_id` zorunlu |
| Olay ürün kimliği/SKU/ad/adet/değer | documented_event_property_capability | Ordered Product örneği; hesap gözlemi gerekir |
| Campaign olayı -> Message | documented_stable | olay attribution ilişkisi |
| Campaign olayı -> Variation | unsupported_by_current_event_relationship_schema | `campaign-variation` ilişkisi yok |
| Flow olayı -> Message Variation | documented_stable | olay attribution ilişkisi |
| Campaign günlük zaman serisi | unavailable | Campaign Values var; Campaign Series yok |
| E-posta maliyeti dağıtımı | EO05_only | Estimated Spend var; dağıtım EO-04 işi değil |
| AdsTable Channel kararı | corrected_and_accepted_2026-10-17 | Campaign/Flow Message Channel; `send_channel` zorunlu Medium; Variation ayrı alt kırılım |
| Veri kümesi eşlemesi | not_started | EO-05 sorumluluğu |

## Tarihsel uygulama kapısı

Bu belge tek başına raporlama çalışma zamanı yetkisi değildi. Ortak brief/sözleşme
ürün sahibi tarafından kabul edilene kadar şu sınırlar geçerliydi:

- Klaviyo raporlama veya Events çalışma zamanı kodu yazılmaz;
- canlı raporlama çağrısı yapılmaz;
- Dataset/migration oluşturulmaz;
- tahmini harcama Channel veya ürüne dağıtılmaz.

Sonraki kabul edilmiş uygulamalar bu tarihsel hazırlık kaydıyla geri alınmaz.
Güncel yetki için Execution Plan izlenir; bu dil çalışması hiçbir kapıyı açmaz.
