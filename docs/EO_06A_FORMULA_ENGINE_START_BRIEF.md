# EO-06-A formül motoru başlangıç notu

**V1 kapsam kararı ve EO-06-A kapanışı · 24 Kasım 2026.** Fırat ile alınan karara göre KPI’lar, metrik hesaplamaları ve maliyetlendirme V1’de yer almayacaktır. EO-06-A, V1 kapsamından ertelenerek kapatıldı. Aşağıdaki başlangıç notu önceki kapsamı belgeler.

**Başlangıç 22 Kasım 2026.** İlk iş, kanonik Dataset'ten gelen girdilerle formüllerin hangi toplamlar üzerinden hesaplanacağını ve sentetik örneklerde beklenen sonuçları belirlemek. [Ana sözleşme](../contracts/a6-eo-implementation-master-v1.json#eo06a_start_2026_11_22) · [Paket sırası](A6_EO_IMPLEMENTATION_MASTER_TABLE.md#eo-06--formül-sorgu-ve-aynı-origin-bffapi)

| İş | Başlangıç kapsamı |
|---|---|
| KPI | Uygun yaprak satırlarının pay ve paydasını önce ayrı ayrı topla. CPC ve ROAS dahil oranları toplamların üzerinden hesapla. CPS, gelir ve gelir marjı için kullanılan satış kapsamını ve girdileri kabul örneklerinde belirt. |
| Para birimi | Aynı para birimindeki veya doğrulanmış dönüşümle aynı para birimine çevrilen tutarları kullan. Eksik kur, eksik girdi ve sıfır payda için beklenen sonucu ayrı kaydet. |
| Klaviyo maliyeti | Mevcut tahmini maliyet kaydı üzerinden dağıtımın girdilerini, uygun satırlarını ve tutar korunumu örneğini tanımla. Ham sağlayıcı harcaması ile hesaplanan dağıtım ayrı izlenir. |
| Sentetik kabul | Sabit demo girdilerinden beklenen sonuçları yeniden hesapla. Farklı ağırlıktaki satırlar, çifte sayım, sıfır payda, eksik değer, kur eksikliği ve maliyet dağıtımı için örnek hazırla. |

İlk kabul çıktısı, formül başına **girdi, toplama kapsamı, sonuç ve eksik veri davranışını** gösteren bir tablodur. Desteklenmeyen, eksik, kısmi, eski ve gerçek sıfır durumları korunur. Sorgu ve filtreler EO-06-B, API yanıtları EO-06-C kapsamındadır. [Dataset girdileri](EO_05B_DATASET_STORAGE.md) · [Sabit sentetik referans](A6_EO_DEMO_FIXTURE_EXPORT_REFERENCE.md)

### İlk sentetik formül örneği

Aynı dönemin iki uygun yaprak satırı aynı para birimindedir. İlk satırda 40 TL harcama, 10 tıklama ve 120 TL atfedilen gelir, ikinci satırda 60 TL harcama, 30 tıklama ve 80 TL atfedilen gelir var.

| Formül | Girdi | Beklenen sonuç |
|---|---|---:|
| CPC | 100 TL toplam harcama ÷ 40 toplam tıklama | 2,50 TL |
| ROAS | 200 TL toplam atfedilen gelir ÷ 100 TL toplam harcama | 2,00 |

Bu örnek toplama sırasını sabitler. Satış adedi veya gelir tanımı sağlayıcılar arasında değişiyorsa, aynı toplamda kullanılabilecek girdiler ilgili kabul örneğinde açıkça tanımlanır.
