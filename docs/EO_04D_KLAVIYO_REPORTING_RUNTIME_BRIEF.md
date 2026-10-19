# EO-04-D — Klaviyo raporlama çalışma zamanı analist brief'i

## Durum ve yetki

- Ürün sahibi analitik modeli ve yalnız repository kapsamındaki çalışma zamanı başlangıcını 17 Ekim 2026'da kabul etti.
- API sürümü: `2026-10-15`.
- Bu paket canlı Klaviyo çağrısı, veritabanı/migration, secret/ortam, dağıtım veya UI değişikliği yapmaz.
- K-1 incelemeye uygun temel PR'ından bağımsız olarak o günün güncel `main`i üzerinden yürütüldü.

Bu belge tarihsel kapsamı korur. Güncel paket kabulü ve iş sırası
`docs/EXECUTION_PLAN.md`, nihai anlatım `docs/EO_04_ANALYSIS_DESIGN_BOOK.md`
üzerinden okunur. Dil düzenlemesi yeni uygulama veya canlı işlem yetkisi değildir.

## Bağlayıcı hiyerarşi

```text
Campaign -> Campaign Audience -> Campaign Message (Channel) -> Variation
Flow     -> Flow Message (Channel)                              -> Variation
```

`Campaign Audience`, sağlayıcının hedefleme/ayar katmanıdır; AdsTable Channel'ı
değildir. 2026-10-15 çoklu iletişim ortamlı Campaigns API bu ara katmanı resmî
varlık hiyerarşisinde tanımlar. Reporting API'nin zorunlu Channel kayıt düzeyi
yine `campaign_message_id` olarak kalır.

`Campaign Message` ve `Flow Message` sağlayıcı varlıkları AdsTable Channel'ıdır.
Sağlayıcıdaki Message adı Channel adıdır. Variation ayrı alt kırılımdır;
hiçbir durumda Channel'ın yerine geçmez.

Audience, sağlayıcı içeriğine ulaşırken izlenen ara katmandır. Kabul edilmiş
`contracts/eo-04d-klaviyo-reporting-runtime-v1.json` uyarınca AdsTable'ın
kanonik veri kümesine alınmaz, kullanıcıya ayrı boyut olarak gösterilmez ve
satışı bölmez. Bu açıklama yeni bir hiyerarşi kararı değildir.

`send_channel` zorunlu Medium kanıtıdır. Desteklenen `Email`, `SMS`,
`WhatsApp` ve `Push` değerleri sağlayıcının ham değeriyle birlikte korunur.
Medium tahmin edilmez; bulunamazsa veya yeni/desteklenmeyen değer gelirse
satır sessizce yayımlanmaz.

## Channel çözümü

1. Message ve kesin Variation biliniyorsa Channel yine Message'dır; Variation ayrıca kesin tutulur.
2. Message biliniyor, Variation bilinmiyorsa Channel kesin Message'dır; yalnız Variation `unresolved` kalır.
3. Message altında çok sayıda Variation bulunması `Unclassified Channel` veya yapay `Multi Channel` üretmez.
4. Variation adayları ana UI verisi değildir; satış aday Variation'lara dağıtılmaz.
5. `Unclassified Channel` yalnız Message bulunamadığında, katalogdan Message kimliği çözülemediğinde veya Message/Variation ilişkisi çeliştiğinde kullanılır.

Son maddedeki katalog sınırı, kimliği bilinen Message'ın yalnız adının, Medium'unun
veya Variation'ının eksik olması demek değildir. Kabul edilmiş ayrıntılı çözüm
`docs/EO_04D_KLAVIYO_ATTRIBUTION_RESOLUTION_BRIEF.md` içindedir:
Message ID biliniyorsa bu eksikler Channel'ı kaybettirmez. Başlangıç brief'inin
kısa ifadesi nihai çözümle birlikte okunur; yeni iş kuralı eklenmez.

## Sales Role

- Campaign'in kesin içerik ürün kümesinde satılan ürün: `Advertised`.
- Campaign'in kesin içerik ürün kümesinin dışında satılan ürün: `Cross-sell`.
- Campaign içerik ürün kümesi kanıtlanamıyorsa: `Assisted`.
- Campaign kanıtı gerçekten çelişkiliyse: `Unclassified`.
- Geçerli Flow attribution'lı satış: `Triggered`.
- Flow Message ile Variation üst varlık ilişkisi çelişiyorsa: `Unclassified`.

## Metrik ve ürün satış kaynağı

Klaviyo metrik keşfi yalnız `integration.name = Shopify` altında yapılır.
`Placed Order` ve `Ordered Product` metrik kimlikleri ayrı ayrı ve tam birer kez çözülmelidir.

- `Placed Order`: Campaign/Flow Reporting API için `conversion_metric_id`.
- `Ordered Product`: ürün seviyesindeki satış olayı.
- İki metrik aynı satışı iki kez saymak için birlikte kullanılmaz.
- Profile dahil edilmez; kişisel veri (PII) raporlama paketine alınmaz.
- ProductID, VariantID, SKU, ProductName, Variant Name, Quantity ve `$value`
  yalnız yanıtta gerçekten gözlemlendiği biçimde korunur. Bu pakette standartlaştırılmış Product ID üretilmez.

## Günlük kayıt düzeyi ve performans

Campaign ve Flow Values sorguları, bağlı Klaviyo hesabının IANA saat diliminde
tek iş günü aralığı kullanır. Başlangıç ve bitiş saat farkları, yaz/kış saati
(DST) dahil ayrı hesaplanır. İlk veri alımı yalnız `yesterday`, sonra `today`
sırasındadır; zamanlayıcı ve veri uzlaştırma EO-05'e aittir.

Raporlama satırı en az Message ID, Message Name ve `send_channel` içermelidir.
Variation ID/Name birlikte gelirse kesin tutulur; ikisi de gelmezse çözümlenmemiş
kalır; kısmi gelirse şema hatasıdır.

## Hata ve yayın sınırı

- İlk sağlayıcı hatası bütün kalan Klaviyo sorgu ailelerini durdurur.
- Otomatik tekrar veya alternatif endpoint yoktur.
- Kısmi sonuç yayımlanmaz.
- Başarılı boş cevap yalnız `not_observed_in_this_execution` anlamındadır;
  sayısal sıfır veya genel desteklenmeme kanıtı değildir.

## Tarihsel resmî kaynak kontrolü — 18 Ekim 2026

1. [Çoklu iletişim ortamlı Campaigns API genel bakışı](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)
2. [Raporlama API'sine genel bakış](https://developers.klaviyo.com/en/reference/reporting_api_overview)
3. [Metrikleri alma](https://developers.klaviyo.com/en/reference/get_metrics)
4. [Olayları alma](https://developers.klaviyo.com/en/reference/get_events)
5. [Shopify veri referansı](https://help.klaviyo.com/hc/en-us/articles/115005080447)
