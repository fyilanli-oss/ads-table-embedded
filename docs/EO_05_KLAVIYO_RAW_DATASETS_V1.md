# EO-05 / 15 — Klaviyo ham veri zarfları

Durum: Kod ve hazırlanmış SQL; izole sınama ve tek PR kapsamı. Canlı SQL, rol girişi, ortam ayarı, provider çağrısı, yayın ve merge bu onayın dışında. Kontrol tarihi: 4 Kasım 2026.

## Yapılacak iş

Kullanıcının bağladığı tek Klaviyo hesabından mevcut onaylı sorgular okunur. Yanıtların izinli alanları kayıpsız sayı gösterimiyle şifrelenir; mevcut kaynak deposuna üç ayrı zarf olarak yazılır. Her zarfın kayıt makbuzu ve geri açılan içeriği doğrulanır. Ayrı tablo/depo kurulmaz.

| Zarf | İçerik | Eksik durum |
| --- | --- | --- |
| configuration | Hesap kimliği, saat dilimi, para birimi; Shopify metrik keşfinin bütün sayfaları | Başarılı boş keşif saklanır; satışın sıfır olduğu söylenmez |
| account_performance | Placed Order, Added to Cart, Checkout Started için Campaign ve Flow: toplam altı rapor ailesi | Eksik metrik açıkça account_configuration_missing; kısmi veya unavailable, toplam/count/empty bilinmiyor |
| product_performance | Ordered Product olayları; mevcut izinli ürün/sipariş alanları, metric/attribution kimlikleri | Ordered Product metriği yoksa unavailable; count/empty null |

Placed Order iki raporu mevcut dokuz istatistiğin tamamını ister; diğer dört rapor mevcut PD alanlarını ister. Dar Placed Order sorgusu ayrıca tekrarlanmaz. Kaynak alanı gelmemişse var veya sıfır sayılmaz. Bu iş hesap performansını ürün kataloğu ya da doğrulanmış ürün eşlemesi haline getirmez. Profile API ve müşteri kişisel alanları okunmaz/saklanmaz. Kaynak sayfalarındaki atıf kimlikleri yalnız ham kanıttır; yeni attribution/sales-role hesabı yapılmaz.

## Geçiş ve bütünlük

Özel sunucu isteği yalnız Production, sabit origin/path, zaman sınırlı sunucu planı ve özel bearer doğrulamasıyla açılır. Gövde yalnız operationId taşır. Tarayıcı oturumu, Settings kontrolü veya serbest sorgu kabul edilmez. Aynı operation tekrar çalıştırılamaz.

Mevcut kurulum, bağlantı sürümü, credential, tek hesap, yetkiler, güncel abonelik, iş kilidi ve SQL kota bağları yeniden doğrulanır. Klaviyo için Reporting Account seçim epoch'u null kalır. Hesabın gerçek saat dilimi/para birimi kontrol edilir. Hesap metadatası veri okumaları sonrasında tekrar kontrol edilir; değişiklikte işlem durur.

Yeni ham-veri kabul RPC'si yalnız ilgili bağlantının yerel takvim günü veya sonraki tek ve gelecekte olmayan günü kabul eder. İlk günün izin saatinden önceki saatleri içerip içermediği SQL tarafından manifest'e kaydedilir; authorizesReportingDataset daima false. Genel refresh/Google/Meta kabul işlevleri değişmez. SQL en fazla 180 saniye; okuyucu en fazla 120 saniye; dış işlem 150 saniye; özel route 180 saniye/fra1. Bunlar tek okumanın güvenli sınırlarıdır, saatlik iş planı değildir.

Rapor endpoint'i başına istekler en az 31 saniye aralıklıdır (1/s, 2/min, 225/day resmî sınırları). Hesap 4.1s, metrik 410ms, event 20ms aralığı uygular; ayrıca mevcut ortak SQL kota kontrolü her çağrıda zorunludur. Bir başka çalıştırıcı bu aralığı paylaşmaz; ortak kota kaydı limitlerin asıl hesabıdır. Sayfalama aynı sabit builder ile yalnız doğrulanmış cursor'dan kurulur; dış next adresi takip edilmez. Sayfa/satır/byte/deadline sınırı aşılırsa sonuç tamamlandı sayılmaz. İlk provider hatasında tekrar denenmez.

Geçerli erişim anahtarı bu okuyucunun ön koşuludur. Anahtarın kalan süresi bütün okuma penceresi ve 60 saniyelik payı karşılamazsa credential_refresh_required ile veri çağrısından önce durur. Mevcut OAuth, anahtar yenileme, hesap ve maliyet ekranları değişmez. Bu PR Klaviyo için yeni token döndürme/kalıcılaştırma protokolü eklemez ve süresi bitmiş anahtarı kendi başına yenilediğini iddia etmez.

## Depo ve yetki

Yalnız mevcut şifreli source_batches/source_pages ve ham referanslar kullanılır. Kural, eşleme, order, line, journey, claim, link ve Dataset satırı yazılmaz. Eksik metrik kanıtı configuration sayfaları ve manifest coverage ile birlikte saklanır; eksiklik için sahte native yanıt üretilmez.

Hazırlanan adstable_klaviyo_source_runner NOLOGIN rolü yalnız dar kaynak/kota/receipt RPC listesini kullanır; tablo erişimi, token-vault erişimi, genel SQL veya admission yetkisi yoktur. Mevcut koordinatöre yalnız yeni Klaviyo ham kabul RPC'si eklenir. Beş yeni ortam adı yalnız kod sözleşmesidir; canlıya değer yazılmaz. Mevcut ayrı kaynak şifreleme anahtarı ve sağlayıcıya bağlı AAD korunur.

Commit gönderildikten sonra cevap kaybolursa unconfirmed kalır; otomatik tekrar yazma veya receipt arama yapılmaz. Başarılı her commit'in makbuzu, bütün sayfalarının metadata/hash/şifre çözümü ve fazladan sayfa olmaması doğrulanır. Üç doğrulanmış zarf sonrası iş paused kapanır. Eksik kaynakla HTTP200 partial, tam kaynakla HTTP200 stored; başarısız/kanıtsız işlem HTTP409. Partial hiçbir zaman tamamlanmış veri diye sunulmaz.

90/365 günlük kararlaştırılmış saklama süresi bu PR'da uygulanmaz. Meta ve Klaviyo canlı kabulünden sonra ayrı onaylı uygulama yapılacak. Saatlik refresh, Overlap, Dataset/23 ve aktivasyon bu iş değildir.

## Sınama ve kanıt sınırı

Birim testleri sahte saat/HTTP ile gerçek pacing, ilk hata, kapsam, kayıpsız projeksiyon, receipt ve decrypt sınırlarını sınar. F01 üç izole PostgreSQL ortamında gerçek özel handler → vault → admission → Partner/kota → şifreli commit → decrypt → paused yolunu çalıştırır; HTTP ve pacing bu SQL provasına özel bağımlılık enjeksiyonuyla sentetiktir. Bütün SQL değişiklikleri rollback olur. Bu, gerçek Klaviyo kabulü değildir.

## Güncel resmî kaynaklar

4 Kasım 2026: API revision 2026-10-15. Hesap/metrik/events alanları ve altı rapor mevcut builder'lardan korunmuştur.

- https://developers.klaviyo.com/en/reference/get_accounts
- https://developers.klaviyo.com/en/reference/get_metrics
- https://developers.klaviyo.com/en/reference/get_events
- https://developers.klaviyo.com/en/reference/query_campaign_values
- https://developers.klaviyo.com/en/reference/query_flow_values
- https://developers.klaviyo.com/en/reference/reporting_api_overview
- https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling
- https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/query_campaign_values.json
