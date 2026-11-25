# EO-06-B dönem karşılaştırması

**25 Kasım 2026 · Uygulama taslağı.** V37’deki Compare seçimi, mevcut Dataset’teki iki tarih aralığını aynı ürün, kanal, kampanya ve platform filtreleriyle okur. Uygulama mağazanın Shopify saat dilimindeki takvim günlerini kullanır. Her iki uç tarih dahildir. [İş paketi](A6_EO_IMPLEMENTATION_MASTER_TABLE.md#eo-06--formül-sorgu-ve-aynı-origin-bffapi) · [Ana sözleşme](../contracts/a6-eo-implementation-master-v1.json)

| Seçim | Tarih kuralı |
|---|---|
| No comparison | Yalnızca ana aralık okunur. |
| Previous period | Karşılaştırma ana aralığın başlangıcından bir gün önce biter. Başlangıç, ana aralıkla aynı gün sayısını verecek şekilde hesaplanır. |
| Previous year | Karşılaştırma geçen yılın aynı ay ve gününde başlar. Başlangıç 29 Şubat ise ve önceki yıl artık yıl değilse 28 Şubat kullanılır. Bitiş, ana aralıkla aynı gün sayısını verecek şekilde hesaplanır. |
| Custom range | Kullanıcının seçtiği iki tarih geçerli ve sıralı olmalı. Gün sayısı ana aralıkla eşleşmiyorsa seçim kabul edilmez. |

Summary/Table için 90 gün, Daily için 31 gün sınırı her aralığa ayrı uygulanır. İki dönem kronolojik sırada gün sırasına göre eşlenir. Alınamayan gün kendi tarihini korur ve eksik veri olarak kalır. Kaynakta doğrulanmış sıfır değer sıfır olarak kalır. `Sales` ve `Purchase` aynı dönemleri kullanır.

## Kabul örnekleri

| Ana aralık | Seçim | Beklenen sonuç |
|---|---|---|
| 1–7 Ekim 2026 | Previous period | 24–30 Eylül 2026. İki dönem de 7 gün. |
| 1–7 Ekim 2026 | Previous year | 1–7 Ekim 2025. İki dönem de 7 gün. |
| 28 Şubat–1 Mart 2024 | Previous year | 28 Şubat–2 Mart 2023. İki dönem de 3 gün. |
| 29 Şubat 2024 | Previous year | 28 Şubat 2023. İki dönem de 1 gün. |
| 1–7 Ekim 2026 | Custom range, 10–16 Eylül 2026 | Kabul edilir. İki dönem de 7 gün. |
| 1–7 Ekim 2026 | Custom range, 10–15 Eylül 2026 | Seçim reddedilir. Karşılaştırma aralığı 6 gün. |
| 7–9 Mart 2026, America/New_York | Previous period | 4–6 Mart 2026. Yaz saati geçişine rağmen iki dönem de 3 takvim günü. |
| 1–7 Ekim 2026 | Previous period, 26 Eylül verisi eksik | 26 Eylül ciro ve satış adedi sıfıra çevrilmeden ilgili eksik veri durumuyla gösterilir. |

EO-06-B’nin bu adımının çıktısı, sorgunun kullanacağı günler ve eşleme kurallarıdır. Grafik bağlantısı EO-07’de yapılır.
