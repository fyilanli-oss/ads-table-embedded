# EO-04-D — Klaviyo Reporting Authority Analyst Brief

## Karar özeti

Bu paket, daha önce kabul edilen Klaviyo sorgu ve sınıflandırma kurallarını gerçek
uygulama otoritesine bağlar. Bir raporlama çalışması artık yalnız şu zincirin
tamamı doğruysa yayınlanabilir:

1. İstek aktif Shopify kurulumuna aittir.
2. Bu kurulumun tam bir adet aktif Klaviyo Connected Account kaydı vardır.
3. Bağlantı `campaigns:read`, `flows:read`, `events:read` ve `metrics:read`
   yetkilerinin tamamını taşır.
4. Şifreli credential kullanılabilir durumdadır; gerekiyorsa provider isteğinden
   önce bir kez yenilenir ve yeni credential otoritesi kaydedilir.
5. Gün sınırı bağlı Klaviyo hesabının timezone'una göre hesaplanır.
6. Shopify `Placed Order` ve `Ordered Product` metrikleri ayrı ayrı ve tam birer
   kez çözülür.
7. Metrics, Campaign Values, Flow Values ve Ordered Product Events ailelerinin
   bütün sayfaları tamamlanır.
8. Ancak bütün zincir başarılıysa sonuç `publishable: true` olur.

Bu paket canlı Klaviyo çağrısı yapmaz; yalnız repository runtime'ını ve sentetik
testlerini hazırlar.

## Kullanıcıya yansıyan anlam

- Campaign Channel = Campaign Message.
- Flow Channel = Flow Message.
- Medium, `send_channel` alanından zorunlu olarak alınır.
- Variation Channel'ın yerine geçmez; ayrı alt kırılım olarak kalır.
- Ordered Product Events içinde profil verisi istenmez veya tutulmaz.
- Flow Message ve Flow Message Variation attribution kimlikleri provider'ın
  verdiği biçimde korunur.
- Campaign attribution resmî Events şemasında Campaign Message seviyesindedir;
  Campaign Variation uydurulmaz.

## Boş, sıfır ve hata ayrımı

- Başarılı ama boş Campaign, Flow veya Event sonucu:
  `not_observed_in_this_execution`.
- Bu durum satış veya performansın sayısal olarak sıfır olduğu anlamına gelmez.
- Provider hatası, eksik metric, bozuk şema, pagination döngüsü veya eksik
  attribution kaynağı: bütün snapshot `publishable: false`.
- Başarılı ilk ailelerin satırları hata sonrasında kısmi ürün verisi olarak
  yayımlanmaz.

## Pagination ve güvenlik sınırı

Metrics ve Events, resmî `links.next` içindeki opaque `page[cursor]` değerini
kullanır. Campaign/Flow Values istekleri resmî olarak `page_cursor` kabul eder;
2026-10-15 cevap şeması ise yalnız `links.self` alanını zorunlu tanımlar. Runtime
bu nedenle cursor tahmin etmez. Cevapta geçerli bir `links.next` bulunursa yalnız
aynı `https://a.klaviyo.com` origin'i ve aynı endpoint path'i üzerinden devam
eder; yoksa mevcut cevap son sayfadır. Yabancı origin, yanlış path, eksik cursor,
cursor döngüsü, 100 sayfa veya 100.000 satır sınırının aşılması fail-closed'dur.

## İlk hata kuralı

İlk provider hatası terminaldir. Otomatik retry, hatadan sonra token refresh,
başka endpoint denemesi veya alternatif authentication rotası yoktur. `401`
bağlantıyı reauthorization-required durumuna taşır. `403` permission denial
olarak ayrı kalır. Diğer provider cevapları güvenli hata koduyla sonlandırılır;
ham provider body kullanıcıya veya loga taşınmaz.

## Paket dışı işler

- Canlı provider doğrulaması
- Database/migration veya Dataset V2 yazımı
- Scheduler ve reconciliation
- Estimated Spend dağıtımı
- Product ID standardizasyonu ve Shopify ürün eşlemesi
- UI, deploy, secret veya environment değişikliği
- Campaign içeriğindeki ürün setinin çıkarılması

## Resmî kaynak kontrolü

Kontrol tarihi: **17 Ekim 2026**. Kullanılan sürüm: **2026-10-15**.

- [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values)
- [Query Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values)
- [Get Metrics](https://developers.klaviyo.com/en/reference/get_metrics)
- [Get Events](https://developers.klaviyo.com/en/reference/get_events)
- [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
- [Klaviyo official OpenAPI repository](https://github.com/klaviyo/openapi)

## Kabul ölçütü

Paket repository testleri, typecheck ve production build kapılarını geçmeli;
branch GitHub PR ile teslim edilmeli; merge için ayrıca ürün sahibi onayı
alınmalıdır.
