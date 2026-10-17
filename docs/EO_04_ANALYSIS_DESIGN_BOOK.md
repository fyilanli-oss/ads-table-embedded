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

Bir ürünün birden fazla Ad'da bulunması PMax listing-tree overlap'i değildir.
Meta `level=ad` cevabı gerçek `ad_id` verdiği için Channel ürün üyeliğinden
seçilmez. Aynı dönüşüm birden fazla Ad metriğinde görünürse EO-04 her provider
fact'ini korur; commerce sale deduplication ve attribution overlap EO-05'e aittir.

Meta Ad spend ürüne taşınmaz. Canlı katalog cevabıyla product-grain semantiği
doğrulanmamış product breakdown spend, gerçek ürün maliyeti sayılmaz.

## 6. Google Ads standardize senaryoları

| ID | Campaign / Channel yapısı | Advertised/clicked ve sold product | Beklenen sonuç |
| --- | --- | --- | --- |
| GOOGLE-01 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Küpe | Exact Ad Group; `Advertised` |
| GOOGLE-02 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Kolye | Exact Ad Group; `Cross-sell` |
| GOOGLE-03 | PMax; İnci Küpe yalnız `Küpeler Asset Group` listing tree'sinde | İnci Küpe → İnci Kolye | Exact Asset Group; `Cross-sell` |
| GOOGLE-04 | PMax; İnci Küpe hem `Küpeler` hem `Sonbahar Takıları` Asset Group tree'sinde | İnci Küpe → İnci Kolye | `Unknown Channel`; `Cross-sell` korunur |
| GOOGLE-05 | PMax satış günü tree snapshot'ı yok; yalnız bugünkü tree var | İnci Küpe → İnci Küpe | `Unknown Channel`; `Advertised` korunur |
| GOOGLE-06 | Search / `İnci Takılar Ad Group`; exact advertised product yok | unavailable → İnci Kolye | Exact Ad Group; `Assisted` |

PMax Channel'ı satılan ürün seçmez. GOOGLE-04'te satılan İnci Kolye yalnız bir
Asset Group'a bağlı olsa bile clicked İnci Küpe birden fazla Asset Group'a
uyuyorsa Channel `Unknown Channel` kalır.

GOOGLE-05 için tarihsel listing-tree capture/persistence EO-05'in ilk zorunlu
kapısıdır. Bugünkü tree geçmiş güne kopyalanamaz.

## 7. Klaviyo standardize senaryoları

| ID | Message / alt kırılım | Sold product | Beklenen sonuç |
| --- | --- | --- | --- |
| KLAVIYO-01 | Campaign Message `Sonbahar Takıları`; Medium `Email`; tek Variation katalogda bulunsa da event Variation vermez | exact içerikte İnci Küpe | Message exact Channel; Medium exact; Variation unresolved; `Advertised` |
| KLAVIYO-02 | Aynı Campaign Message altında A/B veya çoklu Variation | exact içerikte İnci Kolye | Message exact Channel; Variation unresolved; `Advertised` |
| KLAVIYO-03 | Campaign Message exact içerik kümesi yalnız İnci Küpe | İnci Kolye | Message exact Channel; `Cross-sell` |
| KLAVIYO-04 | Campaign Message biliniyor, içerik ürün kümesi unavailable | İnci Kolye | Message exact Channel; `Assisted` |
| KLAVIYO-05 | Flow Message `Sepet Hatırlatma`; Medium `SMS`; exact Flow Variation attribution | İnci Küpe | Parent Flow Message Channel; Variation exact; `Triggered` |
| KLAVIYO-06 | Message attribution missing, birden fazla Message veya Campaign/Flow çatışması | İnci Küpe | Satış bir kez korunur; `Unknown Channel`; `Unclassified` |

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
