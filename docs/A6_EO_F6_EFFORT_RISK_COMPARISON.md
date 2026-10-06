# A6 EO-F6 — Monolit onarımı ile embedded-only yeniden kuruluş efor/risk karşılaştırması

**Tarih:** 4 Ekim 2026  
**Durum:** EO-F6 tamamlandı; EO-F7 insan GO/NO-GO kararı bekleniyor  
**Etkisi:** Salt-okunur fizibilite ve planlama sözleşmesi. Yeni repository/project oluşturmaz; kod, production, provider, veritabanı, Shopify configuration veya deployment değiştirmez.

## Analist sonucu

Aynı Shopify review kapsamı için **embedded-only temiz yeniden kuruluş** tercih edilmelidir.

Bu sonuç “yeniden yazmak daha kolaydır” varsayımına dayanmaz. Yeniden kuruluş da billing/trial, privacy, deletion, clean reinstall, provider OAuth, scheduler, Dataset V2, finality, formula, UI, parity, canary ve rollback kapılarının tamamını geçmek zorundadır. Kazanç, bu zorunlu işleri 819 dosyalık karışık monolite ve emekli authority'lere yeniden bağlamak yerine yalnız üç yüzeyli, üç providerlı, ayrı repository/Vercel/Supabase sınırında bir kez kurmaktır.

Karşılaştırmalı planlama sonucu:

- Monolit onarımı: **59–92 focused engineering day**
- Embedded-only review kritik yol: **42–63 focused engineering day**
- Tasarruf: **17–29 focused engineering day**, yaklaşık **%29–32**
- Review sonrası consumer-zero/legacy retirement dahil embedded-only toplamı: **49–74 focused engineering day**

Bunlar takvim sözü değildir. Bir focused engineering day, dış bekleme olmadan tek kişinin kesintisiz tam günlük geliştirme/doğrulama kapasitesidir. Provider veri penceresi, merchant kabulü, 15 Ekim Klaviyo yeniden doğrulaması ve Shopify review süresi ayrıca değerlendirilir.

## Aynı kapsam kuralı

İki yol da aşağıdaki sonuçların tamamını üretmeden review-ready sayılamaz:

1. Shopify installation/session ve workspace authority
2. 14 günlük trial, subscription ve entitlement
3. mandatory privacy webhooks
4. Delete My Data executor ve terminal manifest
5. uninstall ile access/scheduler stop
6. pre-redact ve post-deletion clean reinstall
7. Meta, Google Ads ve Klaviyo OAuth/account/token lifecycle
8. AdsTable-owned hourly scheduler, lease ve checkpoint
9. yesterday + today bootstrap
10. Dataset V2 provenance, maturity, reconciliation ve finality
11. truthful formula/query/API semantics
12. üç yüzeyli Shopify-native UI
13. provider/API/UI parity
14. canary, rollback ve restore rehearsal
15. açık ürün sahibi desktop/mobile kabulü

Bu kapsamdan bir maddeyi çıkarmak süre kazanımı değil, review veya müşteri riskini ileriye itmektir.

## Ölçüm zemini

4 Ekim 2026 ana kaynak ölçümü:

- 819 repository dosyası
- 305,537 byte kök `server.js`
- 1,530,539 byte legacy `public/`
- 120 dosya / 561,776 byte `src/`
- 203 test dosyası / 1,018,092 byte `tests/`
- 24 public Supabase tablo
- 40 Vercel environment key
- 4 P0 + 7 P1 tekilleştirilmiş release blocker
- application/runtime carry-as-is: 0
- exact canonical business row carry: 10
- canonical Dataset direct-copy: 0; provider re-fetch zorunlu
- hedef yüzey: 3
- hedef aktif provider: 3

Bu ölçümler, monolitteki her satırın bozuk olduğunu söylemez. Güvenilir davranışların legacy import/authority/route bağlarından ayrılmasının, temiz arayüzde yeniden kurmaktan daha pahalı ve daha az öngörülebilir olduğunu gösterir.

## Seçenek A — Mevcut monoliti onarmak

| İş birimi | Focused day aralığı | Risk nedeni |
|---|---:|---|
| Legacy containment ve false-zero düzeltmeleri | 4–6 | Yeni hat çalışırken eski rollback hattı da truthful kalmalı |
| Lifecycle, privacy, deletion ve clean reinstall | 10–15 | Mevcut authority'lerle generation/race davranışı |
| Billing/trial/install foundation | 5–8 | Standalone subscription izleriyle çakışma |
| Üç providerı canonical workspace sınırına yeniden bağlama | 10–15 | Legacy token/account/store ve operator route ayrımı |
| Scheduler, Dataset, reconciliation ve finality | 8–12 | Eski snapshot/job/schedule zincirleriyle çift authority riski |
| Formula/API/UI truthful presentation | 7–11 | Legacy dashboard ve yeni embedded yüzeyin birlikte korunması |
| Cutover, rollback ve restore rehearsal | 7–11 | Rollback hedefinin de ayrıca düzeltilmesi |
| Monolit-wide regression ve hidden consumer/unknown | 8–14 | 819 dosya, public tree, 24 tablo, 40 env key |
| **Review kritik toplam** | **59–92** | Seri kritik yol; paralellik duplicate-authority riskini artırır |

### Monolit yolunun kalıcı maliyeti

- Emekli provider, standalone ve legacy analytics kodları production repository'de yaşamaya devam eder.
- Her güvenlik veya product change geniş regression ister.
- “Kullanılmıyor” ile “silinmesi güvenli” aynı anda kanıtlanamaz.
- Rollback aynı mimari borca döner.
- Shopify review kanıtı ile legacy davranışın birbirinden ayrılması zorlaşır.
- Yeni geliştirici/agent önce eski authority katmanlarını ayıklamak zorunda kalır.

## Seçenek B — Embedded-only temiz yeniden kuruluş

### Review kritik paketler

| Paket | İş birimi | Focused day aralığı | Çıktı |
|---|---|---:|---|
| EO-01 | Clean repository/runtime shell, CI, dependency denylist | 2–3 | Sıfır legacy import ile preview shell |
| EO-02 | Workspace/install/billing/privacy foundations | 6–9 | Trial, entitlement, webhook, deletion generation |
| EO-03 | OAuth, canonical connection ve token vault | 4–6 | Üç provider için tek authority |
| EO-04 | Meta, Google Ads ve Klaviyo adapterları | 8–12 | Raw evidence + normalized facts |
| EO-05 | Scheduler, Dataset V2, FX, maturity/finality | 7–10 | Saatlik authoritative data plane |
| EO-06 | Formula, Query ve BFF/API | 4–6 | Truthful consumer envelope |
| EO-07 | Funnel, Ad Analysis ve Settings UI | 5–8 | Desktop/mobile Shopify-native üç yüzey |
| EO-08 | Data carry rehearsal, parity, canary ve rollback | 6–9 | Cutover GO için ölçülebilir evidence |
| **Review kritik toplam** |  | **42–63** | EO-F7 GO sonrası uygulanabilir |

### Review sonrası fakat silme öncesi zorunlu paketler

| Paket | İş birimi | Focused day aralığı |
|---|---|---:|
| EO-09 | Authority cutover stabilization ve consumer-zero observation | 4–6 |
| EO-10 | Legacy archive, retention ve kontrollü retirement | 3–5 |
| **Post-review toplam** |  | **7–11** |

EO-09/10'u review kritik toplamın dışında tutmak legacy'yi erken silme yetkisi vermez. Eski runtime rollback hattı olarak korunur; consumer-zero ve ayrı destructive approval olmadan kapatılmaz.

## Neden temiz yol daha kısa?

### Yapılmayacak işler

- root monoliti parçalayarak ayakta tutmak
- standalone user/login/subscription modelini uyumlulaştırmak
- GA4, Google Sheets, TikTok, Pinterest ve Organic runtime'larını yeni değişikliklerden korumak
- legacy V1 snapshot/dashboard hattını yeni Dataset V2 ile birlikte geliştirmek
- debug/operator/acceptance route'larını product router'dan tek tek ayırmak
- 24 tabloluk karışık schema içinde runtime grant sınırı kurmak
- 40 environment key'in hangisinin production-critical olduğunu her değişiklikte yeniden çözmek
- legacy UI ile üç yüzeyli yeni UI'yı aynı public/deploy root'ta taşımak

### Yeniden yapılacak fakat keşfi bitmiş işler

- Shopify tenant/install/session
- üç providerın OAuth/client/normalization davranışı
- token encryption envelope
- Dataset V2 ve formula/query kuralları
- Klaviyo cost allocation
- three-surface route/product map
- exact 10-row carry ve provider re-fetch
- scheduler/finality/deletion/billing contract'ları

Yani temiz yol “sıfırdan bilinmeyen ürün” değildir. En pahalı keşifler ve ürün kararları mevcut contract/evidence ile tamamlanmıştır; uygulama temiz sınırda yeniden kurulur.

## Risk skoru

Aşağıdaki skor 1 zayıf, 5 güçlüdür. Ağırlıklı sonuç ne kadar yüksekse yol o kadar güvenli/öngörülebilirdir.

| Kriter | Ağırlık | Monolit onarımı | Temiz yeniden kuruluş |
|---|---:|---:|---:|
| Authority ve privilege izolasyonu | 20 | 2 | 5 |
| Review evidence açıklığı | 15 | 2 | 5 |
| Schedule öngörülebilirliği | 15 | 2 | 4 |
| Cutover/rollback kontrolü | 15 | 3 | 4 |
| Canlı veri continuity | 15 | 4 | 3 |
| Regression yüzeyinin küçüklüğü | 10 | 1 | 5 |
| Uzun vadeli bakım | 10 | 1 | 5 |
| **Ağırlıklı readiness** | **100** | **45/100** | **88/100** |

Temiz yolun tek belirgin dezavantajı canlı veri continuity/cutover işidir. EO-F4 exact carry, re-fetch, sealed token rotation ve eski runtime rollback hattı bu riski azaltır; yok etmez. EO-08 başarısızsa cutover yapılmaz.

## Kritik yol ve paralellik

Bağlayıcı sıra:

```text
EO-01
  -> EO-02
      -> EO-03
          -> EO-04
              -> EO-05
                  -> EO-06
                      -> EO-07
                          -> EO-08
                              -> review-ready kararı
```

Tam paketler paralel koşturulmaz. Güvenli alt-paralellik yalnız aynı upstream contract dondurulduktan sonra mümkündür:

- EO-04 içinde provider adapterları ayrı branch/test hatlarında hazırlanabilir.
- EO-07 içinde üç ekranın analyst brief ve component mapping'i paralel hazırlanabilir.
- EO-08'de veri parity ile UI acceptance ayrı evidence akışlarıdır.

EO-02 tamamlanmadan provider runtime; EO-05 tamamlanmadan final API/UI; EO-08 tamamlanmadan cutover yoktur.

## Dış takvim kapıları

Focused day hesabına dahil olmayan, fakat takvimi etkileyen işler:

- **15 Ekim 2026 Klaviyo GA revalidation:** Variation identity/grain otomatik aktive olmaz. O tarihte resmî sözleşme yeniden okunur; çalışma diğer paketlerle paralel ilerleyebilir.
- Provider attribution/finality pencereleri: en uzun gerekli pencere kadar bekleme/recheck gerekir; iş yapılmayan süre focused day değildir.
- Google Ads non-empty canlı acceptance bulunamazsa verified-empty capability kanıtı açıkça tutulur; sahte başarı üretilmez.
- Desktop ve gerçek mobile Shopify Admin kabul oturumları insan katılımı ister.
- Shopify App Review'ın kendi kuyruk süresi bu tahmine dahil değildir.

Planlama için minimum dış evidence rezervi:

- Temiz yeniden kuruluş: **7–15 takvim günü**, geliştirmeyle kısmen örtüşebilir.
- Monolit onarımı: **10–20 takvim günü**, daha geniş regression/rollback tekrarları nedeniyle daha değişkendir.

## Takvim yorumu

Tek aktif uygulama hattı ve haftada beş gerçek focused day varsayımıyla:

- Embedded-only review kritik geliştirme: yaklaşık **8.4–12.6 çalışma haftası**
- Monolit onarımı: yaklaşık **11.8–18.4 çalışma haftası**

Bu aralıklara Shopify App Review kuyruğu dahil değildir. Codex otomasyonu bazı kodlama günlerini kısaltabilir; provider evidence, merchant acceptance ve production kapılarını ortadan kaldıramaz. EO-F7 GO sonrasında EO-01 decomposition yapıldığında tahmin tekrar kalibre edilir.

## Karar

EO-F6 karşılaştırması **embedded-only yeniden kuruluş lehine PASS**:

- aynı review kapsamı korunur;
- beklenen review-kritik efor 17–29 focused day azalır;
- readiness skoru 45'ten 88'e çıkar;
- hidden legacy consumer ve regression riski fiziksel boundary ile küçülür;
- uzun vadeli geliştirme artık emekli kodun bakım maliyetini taşımaz.

Bu sonuç henüz uygulama GO değildir. EO-F7'de kullanıcı, bu efor/risk sözleşmesini ve F1–F5 kararlarını birlikte onaylamadan yeni repository, Vercel project veya Supabase project oluşturulmaz.

## Stop kuralları

- EO-F7 açık insan GO yoksa proje oluşturulmaz.
- EO-01 dependency/framework seçimi güncel resmî doküman olmadan yapılmaz.
- EO-04 provider contract drift gösterirse süre/risk tahmini yeniden açılır.
- EO-08 parity, deletion, billing, scheduler veya rollback kapısı başarısızsa cutover durur.
- Consumer-zero yoksa legacy retirement yapılmaz.
- Tahmin “deadline” veya eksik kabul kapısını atlama gerekçesi olarak kullanılamaz.
