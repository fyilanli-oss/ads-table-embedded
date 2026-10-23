# EO-04-D — Klaviyo raporlama yetkisi analist brief'i

**Tarihsel kapsam:** 17 Ekim 2026 raporlama yetkisi uygulaması.
Güncel paket kabulü ve iş sırası `docs/EXECUTION_PLAN.md`, nihai anlatım
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. Bu belge geçmiş kapsamı korur;
yeni canlı çağrı veya uygulama yetkisi vermez.

## Karar özeti

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
