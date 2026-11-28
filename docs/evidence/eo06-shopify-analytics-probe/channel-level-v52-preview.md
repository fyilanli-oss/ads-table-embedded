# Channel Level · V52 sentetik raporu

27 Kasım 2026 · AdsTable Development · TRY

V52'nin Channel görünümündeki hiyerarşi, Product Level 1'deki 15 olay ve aşağıdaki beş ek satırla gösterilir. Tablodaki kısa ürün adları yalnız bu önizlemenin okunması içindir. Shopify'daki Product Title mevcut tam ürün adını taşır. Gün bütün satırlarda aynıdır ve SKU değeri `Yok` olur.

```text
Gün → Platform → Campaign → Channel
  → Interactivity → Interacted Channel → Product Title → Contribution Roles
  → Product ID → SKU → Sales Roles → Advertised Product → Sold Product
  → Sales | Contribution To
```

| Kısa ürün adı | Product ID |
| --- | --- |
| Örgü bileklik | 8523622678575 |
| Örgü kolye | 9900000000001 |
| Zirkon bileklik | 8523766988847 |
| Göz örgü kolye | 9900000000003 |
| Gümüş yüzük | 9900000000008 |
| Gümüş küpe | 9900000000007 |
| Gümüş halka küpe (sentetik) | 9900000000009 |
| Gümüş halhal (sentetik) | 9900000000010 |

Tabloda `From` ve `To`, Contribution Roles alanının kısa gösterimidir. `Other (same campaign)`, `Other (other campaign)` ve `Non Advertised` sırasıyla `Other Channels in Campaign`, `Other Channels in Other Campaigns` ve `Non Advertised Products` anlamına gelir. + işareti Product Level'a eklenecek satırları gösterir. Tutarlar TL'dir.

| Platform | Campaign | Channel | Interactivity | Interacted Channel | Product Title | Contribution Roles | Sales Roles | Advertised Product | Sold Product | Sales | Contribution To |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| Meta | YILBAŞI KAMPANYASI | BİLEKLİKLER | Same Channel | This Channel | Örgü bileklik | From | Direct | Örgü bileklik | Örgü bileklik | 100 | 0 |
| Meta | YILBAŞI KAMPANYASI | BİLEKLİKLER | Other (same campaign) | KOLYELER | Örgü kolye | From | Cross Sell | Örgü bileklik | Örgü kolye | 80 | 0 |
| Meta | YILBAŞI KAMPANYASI | BİLEKLİKLER | Other (same campaign) | KOLYELER | Örgü bileklik | To | Cross Sell | Örgü bileklik | Örgü kolye | 0 | 80 |
| Meta | YILBAŞI KAMPANYASI | KOLYELER | Same Channel | This Channel | Örgü kolye | From | Direct | Örgü kolye | Örgü kolye | 200 | 0 |
| Meta | Catalog Kampanyası | Catalog | Unknown | Unknown | Örgü bileklik | From | Indirect | Unknown | Örgü bileklik | 300 | 0 |
| Meta | Fırsat Kampanyası | YÜZÜKLER | Same Channel | This Channel | Gümüş yüzük | From | Direct | Gümüş yüzük | Gümüş yüzük | 400 | 0 |
| Meta | Fırsat Kampanyası | KÜPELER | Same Channel | This Channel | Gümüş küpe | From | Direct | Gümüş küpe | Gümüş küpe | 500 | 0 |
| Meta | Fırsat Kampanyası | KÜPELER | Same Channel | This Channel | Gümüş halka küpe (+) | From | Cross Sell | Gümüş küpe | Gümüş halka küpe | 40 | 0 |
| Meta | Fırsat Kampanyası | KÜPELER | Same Channel | This Channel | Gümüş küpe (+) | To | Cross Sell | Gümüş küpe | Gümüş halka küpe | 0 | 40 |
| Meta | Fırsat Kampanyası | KÜPELER | Non Advertised | No Channel | Gümüş halhal (+) | From | Cross Sell | Gümüş küpe | Gümüş halhal | 60 | 0 |
| Meta | Fırsat Kampanyası | KÜPELER | Non Advertised | No Channel | Gümüş küpe (+) | To | Cross Sell | Gümüş küpe | Gümüş halhal | 0 | 60 |
| Google | GOOGLE YILBAŞI KAMPANYASI | BİLEKLİKLER | Same Channel | This Channel | Zirkon bileklik | From | Direct | Zirkon bileklik | Zirkon bileklik | 600 | 0 |
| Google | GOOGLE YILBAŞI KAMPANYASI | BİLEKLİKLER | Other (other campaign) | Fırsat Kampanyası · BİLEKLİKLER | Örgü bileklik (+) | From | Cross Sell | Zirkon bileklik | Örgü bileklik | 120 | 0 |
| Google | GOOGLE YILBAŞI KAMPANYASI | BİLEKLİKLER | Other (other campaign) | Fırsat Kampanyası · BİLEKLİKLER | Zirkon bileklik | To | Cross Sell | Zirkon bileklik | Örgü bileklik | 0 | 120 |
| Google | GOOGLE YILBAŞI KAMPANYASI | KOLYELER | Same Channel | This Channel | Göz örgü kolye | From | Direct | Göz örgü kolye | Göz örgü kolye | 700 | 0 |
| Google | Keyword Kampanyası | Keywords | Unknown | Unknown | Örgü bileklik | From | Indirect | Unknown | Örgü bileklik | 800 | 0 |
| Google | Fırsat Kampanyası | YÜZÜKLER | Same Channel | This Channel | Gümüş yüzük | From | Direct | Gümüş yüzük | Gümüş yüzük | 900 | 0 |
| Google | Fırsat Kampanyası | KÜPELER | Same Channel | This Channel | Gümüş küpe | From | Direct | Gümüş küpe | Gümüş küpe | 1000 | 0 |
| Klaviyo | KLAVIYO YILBAŞI KAMPANYASI | E-Mail | Unknown | Unknown | Örgü bileklik | From | Indirect | Unknown | Örgü bileklik | 1100 | 0 |
| Klaviyo | Trigger Kampanyası | Triggers | Unknown | Unknown | Örgü bileklik | From | Indirect | Unknown | Örgü bileklik | 1200 | 0 |
| **Özet** | | | | | | | | | | **8100** | **300** |

## Prova verisinin dayanakları

- Meta aynı gün ve hesapta, örgü kolyenin YILBAŞI KAMPANYASI → KOLYELER ve halka küpenin Fırsat Kampanyası → KÜPELER yerleşimine sahip olduğunu varsayar. Tam Meta yerleşim envanteri varsayımı yalnız halhal örneği için kullanılır ve ürün bu envanterde yoktur.
- Google aynı gün ve hesapta, örgü bilekliğin Fırsat Kampanyası → BİLEKLİKLER yerleşimine sahip olduğunu varsayar. Bu yerleşim, mevcut 120 TL katkıya kanal kimliği verir. 120 TL satış, kaynak kampanya GOOGLE YILBAŞI KAMPANYASI altında kalır.
- Catalog, Keywords, E-Mail ve Triggers satırlarında reklamı yapılan ürün `Unknown` kalır. Satılan ürün ve satış tutarı mevcuttur.
- Her Cross Sell çifti satış tutarını yalnız From satırında, katkı tutarını yalnız To satırında taşır. İki raporun Sales toplamları birbirine eşittir. Satır ve özetler önceki iki satırlık kanal provasından bağımsız kontrol edilir.

Shopify kabulünde aynı gün 20 detay satırı, 8.100 TL Sales, 300 TL Contribution To, her kaynak kanal için Product Level ile eşleşen tutarlar ve boş Filters paneli kontrol edilir. Bu dosya çevrimdışı rapor önizlemesidir. Shopify'da tam görünümün açılması ve bu kontroller henüz bekliyor.
