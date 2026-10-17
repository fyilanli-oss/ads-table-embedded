# EO-04 Analysis–Design Book

**Parent package:** A6-EO-04 — Meta, Google Ads and Klaviyo adapters  
**Status:** Draft for product-owner closure review — 2026-10-17  
**Purpose:** Teknik olmayan bir okuyucunun üç providerın hangi ham gerçeği verdiğini, AdsTable'ın Channel ve Sales Role kararını nasıl ürettiğini, hangi çıkarımları kesinlikle yapmadığını ve EO-05'e hangi açık işleri devrettiğini tek belgeden anlayabilmesi.

## 1. İş amacı ve gerçek çıktı

EO-04, kurulu Shopify mağazasına bağlı doğrulanmış Meta, Google Ads ve Klaviyo
hesaplarından provider-native raporlama kanıtını güvenli ve truthful biçimde
okuyan adapter sınırıdır.

Paketin gerçek çıktıları:

- provider hesabı, business date, timezone, currency, sorgu ve API provenance'ı;
- providerın gerçek Campaign ve Channel kimliği;
- advertised/clicked product ile sold product kanıtının ayrı tutulması;
- yalnız kanıtla üretilen `Advertised`, `Cross-sell`, `Assisted`, `Triggered`
  veya `Unclassified` Sales Role;
- Sales Role'den ayrı `Unknown Channel` ve `Zero Value` eksenleri;
- Channel cost ile provider product cost'un birbirine dönüştürülmeden korunması;
- missing, unsupported, permission-denied, not-observed ve explicit zero'nun
  ayrı sonuçlar olmasıdır.

EO-04 Dataset V2, scheduler, kalıcı tarihsel snapshot, maliyet allocation'ı,
provider-overlap reconciliation veya kullanıcı-facing analiz UI'ı üretmez.

## 2. Aktörler ve otoriteler

- **Kurulu Shopify mağazası:** Commerce ürün ve satış otoritesidir.
- **Provider Reporting Account:** Meta ve Google Ads sorgularının doğrulanmış
  hesap kapsamıdır. Klaviyo bağlantının kendisini tek hesap olarak kullanır.
- **Provider API:** Channel, attribution, ürün ve metrik kanıtının dış otoritesidir.
- **Meta Ad:** Meta için tek gerçek Channel'dır.
- **Google Ad Group / Asset Group:** Kampanya ailesine göre Google Channel'ıdır.
- **Klaviyo Campaign Message / Flow Message:** Klaviyo Channel'ıdır.
- **Adapter:** Provider cevabını kayıpsız ve fail-closed normalize eder; providerın
  vermediği ilişkiyi üretmez.
- **Shopify Admin API:** Desteklenen resmî provider sync yolundan türetilen product
  ve variant adayını commerce kimliğine doğrular.
- **EO-05:** Persistence, Dataset V2, tarihsel PMax listing-tree snapshot,
  reconciliation, overlap ve allocation sahibidir.

Campaign, Meta Ad Set, Klaviyo Flow, trigger, split ve delay Channel değildir.
Creative, listing-tree node ve Variation Channel'ın kanıt/alt-kırılımıdır.

## 3. Uçtan uca normal raporlama akışı

1. Runtime kurulu Shopify installation generation ve canonical provider
   connection'ı doğrular.
2. Meta ve Google için canonical Reporting Account, Klaviyo için verified account
   otoritesi çözülür.
3. Provider-specific bounded sorgu aileleri aynı business-date kapsamı için
   tamamlanır; eksik sayfa veya ilk provider hatası partial publish üretmez.
4. Campaign, gerçek Channel entity ve provider alt kanıtı ayrı tutulur.
5. Advertised/clicked product kanıtı ile sold product kanıtı karşılaştırılır.
6. Channel resolution, Sales Role ve Zero Value üç ayrı eksende üretilir.
7. Channel cost ile varsa provider product cost ayrı provenance ile korunur.
8. Sonuç EO-05'in canonical persistence ve reconciliation hattına aktarılabilecek
   truthful ham/normalize kanıt olarak bırakılır.

## 4. Canonical senaryo standardı

EO-04 örnekleri artık serbest metin olarak çoğaltılmaz. Her senaryo
`contracts/eo-04-canonical-scenario-matrix-v1.json` içindeki aynı kart yapısını
kullanır ve şu alanları taşır:

1. stable `scenario_id` ve iş sorusu;
2. provider ve kampanya ailesi;
3. Campaign ile bütün Channel adayları;
4. Creative, listing tree, Medium veya Variation gibi provider alt kanıtı;
5. advertised-product kanıt durumu: `exact`, `incomplete`, `unavailable` veya
   `conflicting`;
6. advertised/clicked ürün ve sold product;
7. business-date ve temporal evidence durumu;
8. beklenen Channel type/name ve `exact` / `unknown` resolution;
9. beklenen Sales Role ve bağımsız value modifier;
10. Medium/Variation sonucu yalnız provider sözleşmesinde varsa;
11. cost preservation/allocation kuralı;
12. overlap veya duplicate davranışı;
13. yasak çıkarımlar;
14. kanıt seviyesi ve sonraki paket sahibi.

### Ortak sonuç sözlüğü

| Durum | Sonuç |
| --- | --- |
| Satılan ürün exact advertised-product kümesinde | `Advertised` |
| Exact küme biliniyor, satılan ürün kümenin dışında | `Cross-sell` |
| Channel biliniyor, exact advertised product kanıtı yok | `Assisted` |
| Geçerli Klaviyo Flow Message attribution'ı | `Triggered` |
| Ürün veya attribution kanıtı gerçekten çelişkili | `Unclassified` |
| Satış var, exact Channel çözülemiyor | `Unknown Channel`; Sales Role ayrı korunur |
| Pozitif quantity ve explicit zero sales value | Mevcut Sales Role + `Zero Value` |

`Unknown Channel` Sales Role değildir. `Zero Value` da Sales Role değildir.

## 5. Meta standardize senaryoları

Ortak kurulumda Campaign `Sonbahar Kampanyası`; gerçek Channel her zaman Meta
`Ad`dır. Ad Set örnek kartına Channel adayı olarak girmez.

| ID | Kurulum | Sold product | Beklenen sonuç |
| --- | --- | --- | --- |
| META-01 | `İnci Küpe Videosu` Ad'ında exact `İnci Küpe` | İnci Küpe | Channel exact Ad; `Advertised` |
| META-02 | Aynı Ad'da exact `İnci Küpe` | İnci Kolye | Channel exact Ad; `Cross-sell` |
| META-03 | Ad biliniyor; generic creative veya yalnız `product_set_id` | İnci Kolye | Channel exact Ad; `Assisted` |
| META-04 | İnci Küpe hem `İnci Küpe Videosu` hem `Sonbahar Carousel` Ad'ında; Meta attribution yalnız ilk Ad'ı verir | İnci Küpe | İlk Ad exact Channel; `Advertised` |
| META-05 | Meta aynı ürün attribution metriğini iki Ad altında döndürür | İnci Küpe | İki provider Ad fact'i korunur; `Unknown Channel` yok; bunlar iki Shopify siparişi sayılmaz |
| META-06 | Ad exact fakat Creative ürün kimlikleri çelişkili | İnci Kolye | Channel exact Ad; `Unclassified` |

### META-01 — Exact reklam ürünü satılıyor

- **İş sorusu:** Ad içinde açıkça doğrulanan ürün satılırsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Küpe Videosu` adlı gerçek Meta Ad.
- **Provider alt kanıtı:** Ad Creative exact `İnci Küpe` ürün kimliğini taşır.
- **Advertised/clicked product:** `İnci Küpe`; evidence state `exact`.
- **Sold product:** `İnci Küpe`.
- **Temporal evidence:** Meta business date ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Küpe Videosu`; type `Ad`; resolution `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Ad spend Ad üzerinde korunur; ürüne tahminî dağıtılmaz.
- **Neden:** Satılan ürün exact Creative ürün kümesinin içindedir ve provider gerçek `ad_id`yi vermiştir.
- **Yasak çıkarım:** Ad Set veya Creative ayrı Channel yapılamaz.

### META-02 — Exact reklam ürününden farklı ürün satılıyor

- **İş sorusu:** Küpe reklamından kolye satılırsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Küpe Videosu` adlı gerçek Meta Ad.
- **Provider alt kanıtı:** Ad Creative exact `İnci Küpe` ürün kimliğini taşır.
- **Advertised/clicked product:** `İnci Küpe`; evidence state `exact`.
- **Sold product:** `İnci Kolye`; exact Creative kümesinin dışındadır.
- **Temporal evidence:** Meta business date ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Küpe Videosu`; type `Ad`; resolution `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Küpeye ait provider product cost varsa kolyeye taşınmaz; Ad spend dağıtılmaz.
- **Neden:** Channel Meta'nın verdiği Ad'dır; sold product yalnız ürün ilişkisinin `Cross-sell` olduğunu belirler.
- **Yasak çıkarım:** `İnci Kolye` kullanılarak başka Ad seçilemez.

### META-03 — Ad biliniyor, reklam ürünü exact bilinmiyor

- **İş sorusu:** Meta Ad'ı kesin fakat Creative genel veya yalnız `product_set_id` taşıyorsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Yeni Sezon Takıları` adlı gerçek Meta Ad.
- **Provider alt kanıtı:** Genel video/görsel veya üyeleri açılamayan `product_set_id`.
- **Advertised/clicked product:** Exact ürün kümesi yok; evidence state `unavailable`.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Meta business date ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `Yeni Sezon Takıları`; type `Ad`; resolution `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Ad spend korunur; ürünlere dağıtılmaz.
- **Neden:** Ad exact olduğu için Channel bilinmektedir; exact advertised product kanıtı olmadığı için `Advertised` veya `Cross-sell` üretilemez.
- **Yasak çıkarım:** Ad adı, URL, görsel metni veya `product_set_id` exact ürün listesi sayılamaz.

### META-04 — Aynı ürün iki Ad'da, attribution yalnız bir Ad'a ait

- **İş sorusu:** Aynı ürün birden fazla Ad'da bulunurken Meta yalnız bir `ad_id` verirse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel` adlı iki gerçek Meta Ad.
- **Provider alt kanıtı:** `İnci Küpe Videosu` Creative kümesi `[İnci Küpe]`; `Sonbahar Takıları Carousel` Creative kümesi `[İnci Küpe, İnci Kolye]`; provider attribution `İnci Küpe Videosu` Ad'ını verir.
- **Advertised/clicked product:** `İnci Küpe`; iki Ad'ın da exact ürün kümesindedir.
- **Sold product:** `İnci Küpe`.
- **Temporal evidence:** Meta business date ile providerın verdiği Ad attribution aynı pencerededir.
- **Beklenen Channel:** Yalnız `İnci Küpe Videosu`; type `Ad`; resolution `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Yalnız providerın attribution verdiği Ad fact'i bu sonuçta kullanılır.
- **Neden:** Meta Channel'ı ürün üyeliğinden değil doğrudan gerçek `ad_id`den gelir.
- **Yasak çıkarım:** Ürünün iki Ad'da bulunması `Unknown Channel` veya ikiye dağıtım nedeni değildir.

### META-05 — Provider aynı ürün metriğini iki Ad altında raporluyor

- **İş sorusu:** Meta aynı ürün için iki ayrı Ad satırında attribution metriği döndürürse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel` adlı iki gerçek Meta Ad.
- **Provider alt kanıtı:** İki ayrı `level=ad` provider row'u; her satır kendi gerçek `ad_id`sini taşır.
- **Advertised/clicked product:** `İnci Küpe`; iki Ad'ın exact ürün kümesindedir.
- **Sold product:** Provider metriğinde `İnci Küpe`. EO-04 bu iki metriğin aynı Shopify order event'i olduğunu iddia etmez.
- **Temporal evidence:** İki provider row'u aynı Meta business-date penceresindedir.
- **Beklenen Channel:** İki ayrı exact provider fact: `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel`; ikisi de type `Ad`.
- **Beklenen Sales Role:** Her Ad fact'i için `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** İki provider attribution fact'i ayrı korunur; bunlar toplanarak iki benzersiz Shopify siparişi üretilmez. Commerce reconciliation EO-05'e aittir.
- **Neden:** Provider iki gerçek Ad fact'i vermiştir fakat unique commerce sale otoritesi Shopify'dır.
- **Yasak çıkarım:** Kanıtsız bir Ad seçmek veya iki attribution metriğini iki Shopify satışı saymak yasaktır.

### META-06 — Ad exact, ürün kanıtı çelişkili

- **İş sorusu:** Gerçek Ad bilinirken exact Creative ürün alanları birbiriyle çelişirse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Takıları Reklamı` adlı gerçek Meta Ad.
- **Provider alt kanıtı:** Bir exact Creative alanı `İnci Küpe`, başka exact alan `İnci Kolye` gösterir ve çatışma çözülemez.
- **Advertised/clicked product:** Evidence state `conflicting`; adaylar `İnci Küpe` ve `İnci Kolye`.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Meta business date ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Takıları Reklamı`; type `Ad`; resolution `exact`.
- **Beklenen Sales Role:** `Unclassified`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Ad spend korunur; çelişki çözülmeden product allocation yapılmaz.
- **Neden:** Channel kanıtı ile ürün kanıtı ayrı eksenlerdir; ürün çelişkisi gerçek Ad'ı belirsizleştirmez.
- **Yasak çıkarım:** Çelişkili ürünlerden biri seçilemez veya ürün çelişkisi `Unknown Channel`a çevrilemez.

Bir ürünün birden fazla Ad'da bulunması PMax listing-tree overlap'i değildir.
Meta `level=ad` cevabı gerçek `ad_id` verdiği için Channel ürün üyeliğinden
seçilmez. Meta Ad spend ürüne taşınmaz. Canlı katalog cevabıyla product-grain
semantiği doğrulanmamış product breakdown spend, gerçek ürün maliyeti sayılmaz.

## 6. Google Ads standardize senaryoları

| ID | Campaign / Channel yapısı | Advertised/clicked ve sold product | Beklenen sonuç |
| --- | --- | --- | --- |
| GOOGLE-01 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Küpe | Exact Ad Group; `Advertised` |
| GOOGLE-02 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Kolye | Exact Ad Group; `Cross-sell` |
| GOOGLE-03 | PMax; İnci Küpe yalnız `Küpeler Asset Group` listing tree'sinde | İnci Küpe → İnci Kolye | Exact Asset Group; `Cross-sell` |
| GOOGLE-04 | PMax; İnci Küpe hem `Küpeler` hem `Sonbahar Takıları` Asset Group tree'sinde | İnci Küpe → İnci Kolye | `Unknown Channel`; `Cross-sell` korunur |
| GOOGLE-05 | PMax satış günü tree snapshot'ı yok; yalnız bugünkü tree var | İnci Küpe → İnci Küpe | `Unknown Channel`; `Advertised` korunur |
| GOOGLE-06 | Search / `İnci Takılar Ad Group`; exact advertised product yok | unavailable → İnci Kolye | Exact Ad Group; `Assisted` |

### GOOGLE-01 — Standard Shopping, aynı ürün satılıyor

- **İş sorusu:** Standard Shopping'de tıklanan ve satılan ürün aynıysa ne olur?
- **Campaign:** `Takı Shopping`; family `Standard Shopping`.
- **Channel adayları:** Yalnız `Küpeler Ad Group`.
- **Provider alt kanıtı:** Cart Data lead-product evidence ve exact Ad Group kimliği.
- **Advertised/clicked product:** `İnci Küpe`; evidence state `exact`.
- **Sold product:** `İnci Küpe`.
- **Temporal evidence:** Google Reporting Account timezone'unda aynı business date.
- **Beklenen Channel:** `Küpeler Ad Group`; type `Ad Group`; resolution `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Google provider product cost kendi advertised product satırında korunur.
- **Neden:** Provider clicked/lead product ile sold product'ın aynı olduğunu kanıtlar.
- **Yasak çıkarım:** Product satırları toplanarak Channel toplamı yeniden üretilemez.

### GOOGLE-02 — Standard Shopping, farklı ürün satılıyor

- **İş sorusu:** Standard Shopping'de küpe tıklanıp kolye satılırsa ne olur?
- **Campaign:** `Takı Shopping`; family `Standard Shopping`.
- **Channel adayları:** Yalnız `Küpeler Ad Group`.
- **Provider alt kanıtı:** Cart Data cross-sell evidence ve exact Ad Group kimliği.
- **Advertised/clicked product:** `İnci Küpe`; evidence state `exact`.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Google Reporting Account timezone'unda aynı business date.
- **Beklenen Channel:** `Küpeler Ad Group`; type `Ad Group`; resolution `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Küpeye ait provider product cost kolyeye taşınmaz.
- **Neden:** Ad Group provider tarafından exact verilir; farklı sold product yalnız Sales Role'u belirler.
- **Yasak çıkarım:** Satılan kolye kullanılarak başka Ad Group seçilemez.

### GOOGLE-03 — PMax, tıklanan ürün yalnız bir Asset Group'ta

- **İş sorusu:** Tıklanan ürün tek listing tree'de bulunuyorsa ve başka ürün satılıyorsa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** Yalnız `Küpeler Asset Group`.
- **Provider alt kanıtı:** `Küpeler Asset Group` listing tree ürünleri `[İnci Küpe, Halka Küpe]`; başka eligible Asset Group yoktur.
- **Advertised/clicked product:** `İnci Küpe`; yalnız `Küpeler Asset Group` tree'sindedir.
- **Sold product:** `İnci Kolye`; tanımlı listing tree'nin dışındadır.
- **Temporal evidence:** Versioned listing tree satışın tüm provider business-day penceresini kapsar.
- **Beklenen Channel:** `Küpeler Asset Group`; type `Asset Group`; resolution `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Exact provider product cost korunur; Asset Group cost ürünlere dağıtılmaz.
- **Neden:** Tıklanan `İnci Küpe` yalnız bir Asset Group'a uyar; satılan kolye farklı üründür.
- **Yasak çıkarım:** Satılan kolyenin tree dışında olması Channel'ı değiştiremez.

### GOOGLE-04 — PMax, tıklanan ürün iki Asset Group'ta

- **İş sorusu:** Tıklanan ürün iki listing tree'ye uyarken satılan ürün yalnız bir tree'de bulunursa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** `Küpeler Asset Group` ve `Sonbahar Takıları Asset Group`.
- **Provider alt kanıtı:** `Küpeler Asset Group` tree ürünleri `[İnci Küpe, Halka Küpe]`; `Sonbahar Takıları Asset Group` tree ürünleri `[İnci Küpe, İnci Kolye]`.
- **Advertised/clicked product:** `İnci Küpe`; iki Asset Group tree'sinde de bulunur.
- **Sold product:** `İnci Kolye`; yalnız `Sonbahar Takıları Asset Group` tree'sinde bulunur.
- **Temporal evidence:** Her iki versioned listing tree de satışın tüm provider business-day penceresini kapsar.
- **Beklenen Channel:** `Unknown Channel`; resolution `unknown`; iki aday Asset Group provenance olarak korunur.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Satış ve exact provider product cost korunur; hiçbir Asset Group'a dağıtılmaz.
- **Neden:** Channel'ı tıklanan `İnci Küpe` belirler ve bu ürün iki Asset Group'a uygundur. Satılan kolyenin yalnız ikinci tree'de bulunması ikinci grubu Channel yapmaz.
- **Yasak çıkarım:** `İnci Kolye` kullanılarak `Sonbahar Takıları Asset Group` seçilemez veya satış iki gruba bölünemez.

### GOOGLE-05 — PMax geçmiş satışında satış-günü tree kanıtı yok

- **İş sorusu:** Geçmiş satış için yalnız bugünkü listing tree varsa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** Bugünkü yapıda `Küpeler Asset Group`; satış günündeki adaylar kanıtlanmamıştır.
- **Provider alt kanıtı:** 16 Ekim current tree ürünleri `[İnci Küpe, Halka Küpe]`; 1 Ekim satış gününü kapsayan versioned tree yoktur.
- **Advertised/clicked product:** 1 Ekim'de `İnci Küpe`.
- **Sold product:** 1 Ekim'de `İnci Küpe`.
- **Temporal evidence:** Sale business date `1 Ekim`; eldeki tree `16 Ekim`; date-matched full-day evidence `missing`.
- **Beklenen Channel:** `Unknown Channel`; resolution `unknown`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Satış ve exact provider product cost korunur; bugünkü Asset Group'a taşınmaz.
- **Neden:** Ürünün kendisi satıldığı için Sales Role exacttır; fakat bugünkü tree 1 Ekim Channel'ını kanıtlamaz.
- **Yasak çıkarım:** 16 Ekim tree'si 1 Ekim için snapshot veya exact Channel yapılamaz.

### GOOGLE-06 — Search, exact advertised product yok

- **İş sorusu:** Search Ad Group satışı var fakat exact reklam ürünü yoksa ne olur?
- **Campaign:** `İnci Takılar Search`; family `Search`.
- **Channel adayları:** Yalnız `İnci Takılar Ad Group`.
- **Provider alt kanıtı:** Provider-attributed Search conversion ve exact Ad Group kimliği.
- **Advertised/clicked product:** Exact product evidence `unavailable`.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Google Reporting Account timezone'unda exact business date.
- **Beklenen Channel:** `İnci Takılar Ad Group`; type `Ad Group`; resolution `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Cost / fact davranışı:** Channel cost korunur; ürüne tahminî dağıtılmaz.
- **Neden:** Ad Group bilinmektedir fakat Search sorgusu exact advertised product kanıtlamaz.
- **Yasak çıkarım:** Search term veya landing page kullanılarak advertised product uydurulamaz.

PMax Channel'ı satılan ürün seçmez. GOOGLE-05 için tarihsel listing-tree
capture/persistence EO-05'in ilk zorunlu kapısıdır. Bugünkü tree geçmiş güne
kopyalanamaz.

## 7. Klaviyo standardize senaryoları

| ID | Message / alt kırılım | Sold product | Beklenen sonuç |
| --- | --- | --- | --- |
| KLAVIYO-01 | Campaign Message `Sonbahar Takıları`; Medium `Email`; tek Variation katalogda bulunsa da event Variation vermez | exact içerikte İnci Küpe | Message exact Channel; Medium exact; Variation unresolved; `Advertised` |
| KLAVIYO-02 | Aynı Campaign Message altında A/B veya çoklu Variation | exact içerikte İnci Kolye | Message exact Channel; Variation unresolved; `Advertised` |
| KLAVIYO-03 | Campaign Message exact içerik kümesi yalnız İnci Küpe | İnci Kolye | Message exact Channel; `Cross-sell` |
| KLAVIYO-04 | Campaign Message biliniyor, içerik ürün kümesi unavailable | İnci Kolye | Message exact Channel; `Assisted` |
| KLAVIYO-05 | Flow Message `Sepet Hatırlatma`; Medium `SMS`; exact Flow Variation attribution | İnci Küpe | Parent Flow Message Channel; Variation exact; `Triggered` |
| KLAVIYO-06 | Message attribution missing, birden fazla Message veya Campaign/Flow çatışması | İnci Küpe | Satış bir kez korunur; `Unknown Channel`; `Unclassified` |

### KLAVIYO-01 — Campaign Message exact, tek katalog Variation var

- **İş sorusu:** Campaign'de tek Variation bulunsa fakat event yalnız Message attribution verse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Provider alt kanıtı:** `send_channel=Email`; katalogda `Küpe Görseli` adlı tek Variation; Ordered Product event'i Campaign Message'ı verir fakat Campaign Variation vermez.
- **Advertised/clicked product:** Message içerik kümesi exact `[İnci Küpe]`.
- **Sold product:** `İnci Küpe`.
- **Temporal evidence:** Klaviyo account timezone'unda exact business-day event ve Message catalog evidence.
- **Beklenen Channel:** `Sonbahar Takıları`; type `Campaign Message`; resolution `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Medium `Email` exact; Variation `unresolved`.
- **Cost / fact davranışı:** Bir Ordered Product event'i bir sale fact'tir; EO-04'te native Campaign/product cost yoktur.
- **Neden:** Message ve içerik ürünü exacttır; resmi event relationship Campaign Variation'ı kanıtlamaz.
- **Yasak çıkarım:** Katalogda tek Variation bulunması event-attributed Variation kanıtı sayılamaz.

### KLAVIYO-02 — Campaign Message exact, birden fazla Variation var

- **İş sorusu:** On Variation bulunsa bile Message biliniyorsa Channel ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Provider alt kanıtı:** `send_channel=Email`; Variation A `Küpe Görseli`, Variation B `Kolye Görseli`; event yalnız Campaign Message attribution verir.
- **Advertised/clicked product:** Message-level exact içerik kümesi `[İnci Küpe, İnci Kolye]`.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Klaviyo account timezone'unda exact business-day event ve Message catalog evidence.
- **Beklenen Channel:** `Sonbahar Takıları`; type `Campaign Message`; resolution `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Medium `Email` exact; Variation `unresolved`; Variation listesi UI Channel adına eklenmez.
- **Cost / fact davranışı:** Bir Ordered Product event'i bir sale fact'tir; EO-04'te estimated spend allocation yoktur.
- **Neden:** Message exacttır ve satılan ürün Message-level exact içerik kümesindedir; event A veya B Variation'ı kanıtlamaz.
- **Yasak çıkarım:** Variation A/B seçilemez veya çoklu Variation `Unknown Channel` üretemez.

### KLAVIYO-03 — Campaign Message exact, içerik dışı ürün satılıyor

- **İş sorusu:** Küpe içerikli Campaign Message kolye satarsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Provider alt kanıtı:** `send_channel=Email`; Campaign Message attribution exact.
- **Advertised/clicked product:** Message exact içerik kümesi `[İnci Küpe]`.
- **Sold product:** `İnci Kolye`; exact içerik kümesinin dışındadır.
- **Temporal evidence:** Klaviyo account timezone'unda exact business-day event ve Message evidence.
- **Beklenen Channel:** `Sonbahar Takıları`; type `Campaign Message`; resolution `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Medium `Email` exact; Variation event tarafından verilmediği için `unresolved`.
- **Cost / fact davranışı:** Estimated Email Spend kolyeye taşınmaz; allocation EO-05'e aittir.
- **Neden:** Satılan ürün exact Message içerik kümesinin dışındadır.
- **Yasak çıkarım:** Satılan kolye Channel veya Variation seçemez.

### KLAVIYO-04 — Campaign Message exact, içerik ürün kümesi yok

- **İş sorusu:** Message bilinirken reklam/içerik ürünü exact kanıtlanamazsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Provider alt kanıtı:** `send_channel=Email`; Campaign Message attribution exact; içerik genel mağaza/kategori veya unavailable.
- **Advertised/clicked product:** Evidence state `unavailable`; exact ürün kümesi yoktur.
- **Sold product:** `İnci Kolye`.
- **Temporal evidence:** Klaviyo account timezone'unda exact business-day event ve Message evidence.
- **Beklenen Channel:** `Sonbahar Takıları`; type `Campaign Message`; resolution `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Medium `Email` exact; Variation `unresolved`.
- **Cost / fact davranışı:** Bir Ordered Product event'i korunur; EO-04'te product cost/allocation üretilmez.
- **Neden:** Message exact fakat advertised-product kümesi exact değildir.
- **Yasak çıkarım:** İçerik unavailable iken `Advertised` veya `Cross-sell` uydurulamaz; Variation belirsizliği Channel'ı bozmaz.

### KLAVIYO-05 — Flow Variation parent Message'a çözülüyor

- **İş sorusu:** Event exact Flow Message Variation verirse Channel ne olur?
- **Campaign:** `Sepet Hatırlatma Flow`; Flow yalnız üst bağlamdır.
- **Channel adayları:** Yalnız `Sepet Hatırlatma` adlı parent Flow Message.
- **Provider alt kanıtı:** `send_channel=SMS`; exact `Sepette Küpe` Flow Message Variation relationship ve doğrulanmış parent Message.
- **Advertised/clicked product:** Flow için Sales Role içerik karşılaştırmasından değil provider Flow attribution'dan gelir; exact advertised set gerekli değildir.
- **Sold product:** `İnci Küpe`.
- **Temporal evidence:** Klaviyo account timezone'unda exact business-day event ve parent relationship.
- **Beklenen Channel:** `Sepet Hatırlatma`; type `Flow Message`; resolution `exact`.
- **Beklenen Sales Role:** `Triggered`.
- **Medium / Variation:** Medium `SMS` exact; Variation `Sepette Küpe` exact ve subordinate.
- **Cost / fact davranışı:** Bir Ordered Product event'i bir sale fact'tir; native Flow/product cost yoktur.
- **Neden:** Variation relationship parent Flow Message'ı doğrular; Variation Channel'ın alt kırılımıdır.
- **Yasak çıkarım:** Flow veya Variation Channel'ın yerine geçirilemez.

### KLAVIYO-06 — Message attribution eksik veya çelişkili

- **İş sorusu:** Event tek bir Campaign/Flow Message'a çözülemiyorsa ne olur?
- **Campaign:** Kesin değildir; missing Message, birden fazla Message, Campaign/Flow conflict veya parent conflict olabilir.
- **Channel adayları:** Provider kanıtı tek bir Message seçemediği için exact aday yoktur.
- **Provider alt kanıtı:** Message attribution missing/conflicting; Medium ve Variation da güvenilir biçimde çözülemez.
- **Advertised/clicked product:** Evidence state `conflicting`; exact içerik ilişkisi üretilemez.
- **Sold product:** `İnci Küpe`; Ordered Product event'i olarak bir kez korunur.
- **Temporal evidence:** Event business date bilinmektedir fakat timing Channel çözmek için kullanılamaz.
- **Beklenen Channel:** `Unknown Channel`; resolution `unknown`.
- **Beklenen Sales Role:** `Unclassified`.
- **Medium / Variation:** İkisi de `unresolved`.
- **Cost / fact davranışı:** Satış bir kez korunur; başka Message toplamına dağıtılmaz.
- **Neden:** Provider attribution evidence tek ve çelişkisiz Message kanıtlamamıştır.
- **Yasak çıkarım:** Timing, en yakın send veya report totals kullanılarak Message seçilemez; satış düşürülemez.

Klaviyo'da `send_channel` zorunlu Medium'dur. Campaign/Flow adı Channel değildir;
Campaign Message veya Flow Message Channel'dır. Variation Channel'ın yerine
geçmez. Message biliniyorsa Variation belirsizliği `Unknown Channel` üretmez.

## 8. Negatif ve hata yolları

- İlk provider hatası complete snapshot publication'ını durdurur; partial aileler
  başarılı veri gibi yayımlanmaz ve otomatik ikinci provider denemesi yapılmaz.
- Missing, null, unsupported, permission-denied ve not-observed numeric zero olmaz.
- Provider product kimliği Shopify kimliğine doğrulanamazsa raw provider ID
  korunur; SKU, ürün adı veya variant uydurulmaz.
- Meta generic Creative'den ürün tahmin edilmez.
- Google sold product kullanılarak Asset Group seçilmez.
- Bugünkü PMax listing tree geçmiş Channel'ı çözmez.
- Klaviyo timing veya report toplamından Message/Variation tahmini yapılmaz.
- Bir providerın conversion metriği Shopify commerce sale adedi gibi yeniden
  adlandırılmaz veya başka provider metriğiyle toplanmaz.

## 9. Kalıcı durum ve veri sahipliği

EO-04'ün kalıcı sahip olduğu alan bağlantı ve adapter sözleşmesi, provider-native
raw evidence şekli, doğrulanmış hesap kapsamı ve secret-free kabul kanıtıdır.

EO-05 şunların kalıcı sahibidir:

- Dataset V2 canonical rows;
- Google historical listing-tree snapshots ve validity intervals;
- scheduler lease/checkpoint;
- provider attribution overlap ve Shopify sale reconciliation;
- provisional/final maturity;
- allocated cost ve yeniden hesaplama provenance'ı.

EO-04 canlı evidence route'ları kalıcı merchant workflow değildir; EO-05
scheduler kabulünde geçici transport atomik olarak kaldırılır.

## 10. Secret ve güvenlik sınırları

- Token, client secret, developer token veya plaintext credential dokümana,
  loga, fixture'a veya GitHub'a girmez.
- Kullanıcı account ID, cursor, query veya product eşleme otoritesi sağlayamaz.
- Runtime yalnız verified installation, connection ve Reporting Account
  otoritesini kullanır.
- Provider scope genişletme, secret/environment değişimi, canlı çağrı, database
  veya deployment her zaman kendi açık kapısına tabidir.
- Synthetic fixture yalnız AdsTable mantığını sınar; provider gerçeği değildir.

## 11. Operasyon, tekrar deneme ve gözlemlenebilirlik

- Pagination bounded ve opaque cursor kurallarına uyar.
- Cursor loop, page/row ceiling ve ilk provider error fail-closed olur.
- Retry yalnız provider sözleşmesinde açıkça sınıflandırılmış transient hatalara
  uygulanabilir; credential, permission veya config hatasında otomatik alternatif
  rota yoktur.
- Observation state, support state, adapter/API version, query provenance,
  business date, timezone ve currency sonuçla birlikte taşınır.
- Test-account empty sonucu Production zero veya global unsupported kanıtı değildir.

## 12. Rollback, kurtarma ve güvenli başarısızlık

- Provider ailelerinden biri tamamlanmazsa önceki complete snapshot korunur;
  partial yeni snapshot publish edilmez.
- Reauthorization sırasında reporting authority kapanır; geçmiş analytics
  silinmez. EO-05 eksik business-date aralığını açıkça backfill/reconcile eder.
- Current tree veya başka tarihli evidence ile geçmiş PMax Channel fabricate
  edilmez; sonuç güvenli biçimde `Unknown Channel` kalır.
- Exact product cost kanıtı Sales Role, Zero Value veya Unknown Channel nedeniyle
  silinmez; fakat Channel toplamı ürüne tahminî dağıtılmaz.

## 13. Kabul kanıtı ve bilinen sınırlar

Kabul edilmiş temel kanıtlar:

- `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md`
- `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`
- Meta App Role ve retained live-shape evidence
- Google test-account review evidence ve historical safety tests
- Klaviyo OAuth, reporting, attribution ve reauthorization contracts/tests
- `contracts/eo-04-canonical-scenario-matrix-v1.json`
- `tests/eo-04-canonical-scenario-matrix.test.js`

Bilinen ve açıkça devredilen sınırlar:

- Meta product-level canlı katalog cevabı henüz gözlenmemiştir.
- Google Production performance evidence Explorer-or-higher access bekler.
- Historical PMax listing-tree persistence henüz yoktur ve EO-05'in ilk kapısıdır.
- Klaviyo live reporting provider call kapalıdır.
- Provider overlap reconciliation, Dataset V2, finality ve allocation EO-05'tedir.
- UI rendering ve kullanıcı-facing explanation EO-07'dedir.

Bu kitap closure review için Draft durumundadır. EO-04 ancak repository CI, paket
envanteri ve ürün sahibinin ayrıca vereceği açık kapanış kabulüyle `Accepted`
olabilir.

## 14. Tek sonraki parent

EO-04'ün tek sonraki parent'ı **A6-EO-05 — Scheduler, Dataset V2, FX, maturity
and reconciliation** paketidir. EO-05'in ilk zorunlu kapısı versioned historical
PMax listing-tree evidence'dır.

## Contract section map

- business_purpose_and_actual_output
- actors_and_authorities
- end_to_end_happy_path
- negative_and_failure_paths
- persistent_state_and_data_ownership
- secret_and_security_boundaries
- operations_retries_and_observability
- rollback_recovery_or_safe_failure
- accepted_evidence_and_known_limits
- single_next_parent

## Resmî kaynak kontrolü

Provider davranışı için kullanılan resmî kaynaklar 17 Ekim 2026'da yeniden
kontrol edilmiştir:

- Meta Marketing API official collection: <https://www.postman.com/meta/facebook-marketing-api/overview>
- Meta Business SDK Ads Insights: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta Business SDK Ad Creative: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py>
- Google Shopping reporting: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- Google PMax retail reporting: <https://developers.google.com/google-ads/api/performance-max/retail-reporting>
- Google PMax listing groups: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- Klaviyo Events API: <https://developers.klaviyo.com/en/reference/get_events>
- Klaviyo Campaign Values: <https://developers.klaviyo.com/en/reference/query_campaign_values>
- Klaviyo Flow Values: <https://developers.klaviyo.com/en/reference/query_flow_values>
