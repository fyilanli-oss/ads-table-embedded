# EO-04-D — Klaviyo raporlama yetkisi analist brief'i

**Tarihsel kapsam:** 17 Ekim 2026 raporlama yetkisi uygulaması.
Güncel paket kabulü ve iş sırası `docs/EXECUTION_PLAN.md`, nihai anlatım
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. Bu belge geçmiş kapsamı korur;
yeni canlı çağrı veya uygulama yetkisi vermez.

## Karar özeti

26 Ekim 2026 eklemesi: `event` ve `attributed-event` kimlikleri atıf kaydında korunur; mevcut `event` bağı başka satışa işaret ederse snapshot durur. `readDailyEvidenceSnapshot` içindeki `includeAttributingEvents: true` seçeneği, bütün satış sayfaları tamamlandıktan sonra her farklı etkileşim kimliği için bir `GET /api/events/{id}?include=metric` isteği yapar. Varsayılan false olduğu için mevcut canlı tetikleyici ve otomatik çağrı sayısı değişmez. Ayrıntı olayı satış gününden önce olabileceğinden tarih filtresi uygulanmaz. En çok 100 farklı kimlik, bütün isteklerden önce kontrol edilir; aşılırsa sessiz kesme yoktur. Olay kimliği/türü, tarih, özellikler ve tekil metric kaynağı doğrulanır. Ham olay ve metrik yalnız özel server kanıt snapshot'ında tutulur; kişisel veri içerebilir, loga veya ürün raporuna taşınmaz; profil kaynağı istenmez. Bu dilimde canlı provider çağrısı yapılmadı.

Satış → etkileşim bağı ürün kimliği kanıtı sayılmaz. Olayın kendi metric adı ve ham özellikleri korunur; açılma/teslim/tıklama birbirine dönüştürülmez. `product_interaction_verified` ve ayrıntı `dataset_publishable` false kalır. Mevcut Campaign Assisted / Flow Triggered kararları değişmez; kaynak ürünü ve satılan ürünü doğrulayan yol hâlâ açıktır. Ayrıntı kanıtı yeni satış fact'i değildir. Eksik ilişki not_observed durumudur; sorgu seçeneği kapalıysa ayrıntı ailesi hiç çalışmaz. İlk provider/şema hatasında bütün snapshot sonuçları null olur; retry yoktur.

`Get Event` belgesindeki sınır 10/s burst ve 150/min steady'dir. Liste Events kotasıyla aynı varsayılmaz: transport ve resolver ayrı `event_detail` ailesini tanır; eksik kota profili dispatch'i engeller. Limit veya DB profili oluşturulmadı, mevcut kota bütçesine yedek yapılmadı. Canlı etkinleştirme ayrı kapıdır. Resmî kontrol: 26 Ekim 2026, [Get Event](https://developers.klaviyo.com/en/reference/get_event) ve [2026-10-15 OpenAPI şeması](https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/get_events.json).

23 Ekim 2026, envanter 13 + 14 eklemesi: `readPdEvidenceSnapshot` mevcut hesap/izin/credential ve sayfalama denetimlerini kullanarak Placed Order, Added to Cart ve Checkout Started için Campaign/Flow Message raporları okur. Bu ayrı repository giriş noktası eski canlı tetikleyiciyi veya aşağıdaki ürün satış yolunu değiştirmez. Eksik metrikte istek yok, durum account_configuration_missing; çelişkili kimlikte güvenli hata, ilk sağlayıcı hatasında kalan aileler durur ve kısmi sonuç dönmez. Ham satırlar ve bunlara indeksle bağlı PD projeksiyonları korunur. Dataset publishable false, gerçek hesap kabulü pending'dir. Ayrıntı `docs/EO_04D_KLAVIYO_REPORTING_RUNTIME_BRIEF.md` ve sözleşmelerin pd_alignment kayıtlarındadır.

Bu paket, daha önce kabul edilen Klaviyo sorgu ve sınıflandırma kurallarını gerçek
uygulama otoritesine bağlar. Bir raporlama çalışması artık yalnız şu zincirin
tamamı doğruysa yayınlanabilir:

1. İstek aktif Shopify kurulumuna aittir.
2. Bu kurulumun tam bir adet aktif Klaviyo Connected Account kaydı vardır.
3. Bağlantı `campaigns:read`, `flows:read`, `events:read` ve `metrics:read`
   yetkilerinin tamamını taşır.
4. Şifreli kimlik bilgisi kullanılabilir durumdadır; gerekiyorsa sağlayıcı
   isteğinden önce bir kez yenilenir ve yeni kimlik bilgisi kalıcı kaydedilir.
5. Gün sınırı bağlı Klaviyo hesabının saat dilimine göre hesaplanır.
6. Shopify `Placed Order` ve `Ordered Product` metrikleri ayrı ayrı ve tam birer
   kez çözülür.
7. Metrics, Campaign Values, Flow Values ve Ordered Product Events
   sorgu ailelerinin bütün sayfaları tamamlanır.
8. Ancak bütün zincir başarılıysa sonuç `publishable: true` olur.

Bu paket canlı Klaviyo çağrısı yapmaz; yalnız repository çalışma zamanını ve sentetik
testlerini hazırlar.

## Kullanıcıya yansıyan anlam

- Campaign Channel = Campaign Message.
- Flow Channel = Flow Message.
- Medium, `send_channel` alanından zorunlu olarak alınır.
- Variation Channel'ın yerine geçmez; ayrı alt kırılım olarak kalır.
- Ordered Product Events içinde profil verisi istenmez veya tutulmaz.
- Flow Message ve Flow Message Variation attribution (satışın kaynağa atfı) kimlikleri sağlayıcının
  verdiği biçimde korunur.
- Campaign attribution resmî Events şemasında Campaign Message seviyesindedir;
  Campaign Variation uydurulmaz.

## Boş, sıfır ve hata ayrımı

- Başarılı ama boş Campaign, Flow veya Event sonucu:
  `not_observed_in_this_execution`.
- Bu durum satış veya performansın sayısal olarak sıfır olduğu anlamına gelmez.
- Sağlayıcı hatası, eksik metrik, bozuk şema, sayfalama döngüsü veya eksik
  attribution kaynağı: bütün anlık görüntü (snapshot) `publishable: false`.
- Başarılı ilk ailelerin satırları hata sonrasında kısmi ürün verisi olarak
  yayımlanmaz.

## Sayfalama ve güvenlik sınırı

Metrics ve Events, resmî `links.next` içindeki içeriği yorumlanmayan `page[cursor]` değerini
kullanır. Campaign/Flow Values istekleri resmî olarak `page_cursor` kabul eder;
2026-10-15 cevap şeması ise yalnız `links.self` alanını zorunlu tanımlar. Çalışma zamanı
bu nedenle cursor tahmin etmez. Cevapta geçerli bir `links.next` bulunursa yalnız
aynı `https://a.klaviyo.com` kökeni ve aynı endpoint yolu üzerinden devam
eder; yoksa mevcut cevap son sayfadır. Yabancı köken, yanlış yol, eksik cursor,
cursor döngüsü, 100 sayfa veya 100.000 satır sınırının aşılması işlemi güvenli biçimde durdurur.

## İlk hata kuralı

İlk sağlayıcı hatası işlemi kesin olarak durdurur. Otomatik tekrar, hatadan sonra
token yenileme, başka endpoint denemesi veya alternatif kimlik doğrulama yolu yoktur.
`401` bağlantıyı yeniden yetkilendirme gereken duruma taşır. `403` izin reddi
olarak ayrı kalır. Diğer sağlayıcı cevapları güvenli hata koduyla sonlandırılır;
ham sağlayıcı yanıt gövdesi kullanıcıya veya loga taşınmaz.

## Paket dışı işler

- Canlı sağlayıcı doğrulaması
- Veritabanı/migration veya Dataset V2 yazımı
- Zamanlayıcı ve veri uzlaştırma
- Estimated Spend dağıtımı
- Product ID standardizasyonu ve Shopify ürün eşlemesi
- UI, dağıtım, secret veya ortam değişikliği
- Campaign içeriğindeki ürün setinin çıkarılması

## Resmî kaynak kontrolü

Kontrol tarihi: **17 Ekim 2026**. Kullanılan sürüm: **2026-10-15**.

- [Campaign değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_campaign_values)
- [Flow değerlerini sorgulama](https://developers.klaviyo.com/en/reference/query_flow_values)
- [Metrikleri alma](https://developers.klaviyo.com/en/reference/get_metrics)
- [Olayları alma](https://developers.klaviyo.com/en/reference/get_events)
- [Raporlama API'sine genel bakış](https://developers.klaviyo.com/en/reference/reporting_api_overview)
- [Klaviyo resmî OpenAPI repository'si](https://github.com/klaviyo/openapi)

## Kabul ölçütü

Paket repository testleri, typecheck ve Production derlemesi kapılarını geçmeli;
branch GitHub PR ile teslim edilmeli; merge için ayrıca ürün sahibi onayı
alınmalıdır.
