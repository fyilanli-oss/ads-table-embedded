# A6 EO-F6 — Monolit onarımı ile yalnız Shopify içine gömülü yeniden kuruluşun efor/risk karşılaştırması

**Tarih:** 4 Ekim 2026

**Tarihsel durum:** EO-F6 tamamlandı; EO-F7 insan GO/NO-GO kararı bekleniyor

**Etkisi:** Salt okunur fizibilite ve planlama sözleşmesi. Yeni repository/proje oluşturmaz; kod, Production, sağlayıcı, veritabanı, Shopify yapılandırması veya dağıtım değiştirmez.

**Okuma notu:** Bu belge 4 Ekim 2026 başlangıç karşılaştırmasıdır. Efor, risk, eski yapı bulguları ve o gün gelecekte olan 15 Ekim kontrolü tarihsel planlamadır; bugünkü kalan iş, yeni teslim tarihi veya bugünkü açık bulgu sayısı değildir. Sonraki EO-F7 GO kararı ve güncel `docs/EXECUTION_PLAN.md` / `contracts/a6-eo-implementation-master-v1.json` geçerlidir. Dil düzenlemesi tahminleri yeniden hesaplamaz ve yeni iş başlatmaz.

## Analist sonucu

Aynı Shopify review kapsamı için **yalnız Shopify içine gömülü temiz yeniden kuruluş** tercih edilmelidir.

Bu sonuç “yeniden yazmak daha kolaydır” varsayımına dayanmaz. Yeni yapı da faturalandırma/deneme, gizlilik, silme, temiz yeniden kurulum, sağlayıcı OAuth, zamanlayıcı, Dataset V2, kesinleşme, formül, UI, eşlik, kademeli geçiş ve geri dönüş kapılarının tamamını geçmelidir. Kazanç, bunları 819 dosyalık karma monolite ve emekli yetki kaynaklarına yeniden bağlamak yerine üç yüzeyli, üç sağlayıcılı, ayrı repository/Vercel/Supabase sınırında bir kez kurmaktır.

Karşılaştırmalı planlama sonucu:

- Monolit onarımı: **59–92 odaklı mühendislik günü**
- Gömülü ürünün review için kritik yolu: **42–63 odaklı mühendislik günü**
- Tasarruf: **17–29 odaklı mühendislik günü**, yaklaşık **%29–32**
- Review sonrası tüketici-sıfır/eski yapıyı emekliye ayırma dahil temiz yolun toplamı: **49–74 odaklı mühendislik günü**

Bunlar takvim sözü değildir. Bir odaklı mühendislik günü, dış bekleme olmadan tek kişinin kesintisiz tam günlük geliştirme/doğrulama kapasitesidir. Sağlayıcı veri penceresi, mağaza sahibi kabulü, 15 Ekim Klaviyo yeniden doğrulaması ve Shopify review süresi ayrıca değerlendirilir.

## Aynı kapsam kuralı

İki yol da aşağıdaki sonuçların tamamı olmadan review'a hazır sayılamaz:

1. Shopify kurulum/oturum ve çalışma alanı yetki kaynağı
2. 14 günlük deneme, abonelik ve kullanım hakkı
3. zorunlu gizlilik webhook'ları
4. Delete My Data yürütücüsü ve son durum manifesti
5. kaldırmayla erişim/zamanlayıcının durması
6. mağaza verileri karartılmadan önce ve silmeden sonra temiz yeniden kurulum
7. Meta, Google Ads ve Klaviyo OAuth/hesap/token yaşam döngüsü
8. AdsTable'ın kendi saatlik zamanlayıcısı, kiralama ve ilerleme noktası
9. dün + bugün ilk yüklemesi
10. Dataset V2 veri kökeni, olgunluk, uzlaştırma ve kesinleşme
11. veriyi doğru yansıtan formül/sorgu/API anlamı
12. üç yüzeyli Shopify'a yerel UI
13. sağlayıcı/API/UI eşliği
14. kademeli geçiş, geri dönüş ve geri yükleme provası
15. açık ürün sahibi masaüstü/mobil kabulü

Bir maddeyi çıkarmak süre kazanımı değil, review veya müşteri riskini ileriye itmektir.

## Ölçüm zemini

4 Ekim 2026 eski kaynak ölçümü:

- 819 repository dosyası
- 305,537 bayt kök `server.js`
- 1,530,539 bayt eski `public/`
- 120 dosya / 561,776 bayt `src/`
- 203 test dosyası / 1,018,092 bayt `tests/`
- 24 public Supabase tablosu
- 40 Vercel ortam değişkeni adı
- 4 P0 + 7 P1 tekilleştirilmiş yayın engeli
- uygulama/çalışma zamanı kodunu aynen taşıma: 0
- kanonik iş satırını birebir taşıma: 10
- kanonik Dataset doğrudan kopyası: 0; sağlayıcıdan yeniden çekme zorunlu
- hedef yüzey: 3
- hedef aktif sağlayıcı: 3

Bunlar monolitteki her satırın bozuk olduğunu söylemez. Güvenilir davranışları eski import/yetki/rota bağlarından ayırmanın temiz arayüzde yeniden kurmaktan daha pahalı ve daha az öngörülebilir olduğunu gösterir. Bu eski bulgular A6-TECH-01'in güncel kapanışına ait açık bulgular değildir.

## Seçenek A — Mevcut monoliti onarmak

| İş birimi | Odaklı gün aralığı | Risk nedeni |
|---|---:|---|
| Eski riski sınırlama ve sahte sıfır düzeltmeleri | 4–6 | Yeni hat çalışırken eski geri dönüş hattı da veriyi doğru yansıtmalı |
| Yaşam döngüsü, gizlilik, silme ve temiz yeniden kurulum | 10–15 | Mevcut yetki kaynaklarıyla nesil/yarış davranışı |
| Faturalandırma/deneme/kurulum temeli | 5–8 | Bağımsız uygulama abonelik izleriyle çakışma |
| Üç sağlayıcıyı kanonik çalışma alanına yeniden bağlama | 10–15 | Eski token/hesap/depo ve operatör rotası ayrımı |
| Zamanlayıcı, Dataset, uzlaştırma ve kesinleşme | 8–12 | Eski anlık görüntü/iş/zamanlama zincirleriyle çift yetki kaynağı riski |
| Formül/API/UI'da doğru sunum | 7–11 | Eski pano ve yeni gömülü yüzeyin birlikte korunması |
| Yetkili geçiş, geri dönüş ve geri yükleme provası | 7–11 | Geri dönüş hedefinin de ayrıca düzeltilmesi |
| Tüm monolitte geriye dönük uyumluluk ve gizli/bilinmeyen tüketiciler | 8–14 | 819 dosya, public ağacı, 24 tablo, 40 ortam değişkeni |
| **Review için kritik toplam** | **59–92** | Sıralı kritik yol; paralellik çift yetki kaynağı riskini artırır |

### Monolit yolunun kalıcı maliyeti

- Emekli sağlayıcı, bağımsız uygulama ve eski analitik kodu Production repository'sinde yaşamaya devam eder.
- Her güvenlik veya ürün değişikliği geniş geriye dönük uyumluluk testi ister.
- “Kullanılmıyor” ile “silinmesi güvenli” aynı anda kanıtlanamaz.
- Geri dönüş aynı mimari borca döner.
- Shopify review kanıtını eski davranıştan ayırmak zorlaşır.
- Yeni geliştirici/ajan önce eski yetki katmanlarını ayıklamak zorunda kalır.

## Seçenek B — Yalnız gömülü ürün için temiz yeniden kuruluş

### Review için kritik paketler

| Paket | İş birimi | Odaklı gün aralığı | Çıktı |
|---|---|---:|---|
| EO-01 | Temiz repository/çalışma zamanı kabuğu, CI, yasak bağımlılıklar | 2–3 | Sıfır eski import ile Preview kabuğu |
| EO-02 | Çalışma alanı/kurulum/faturalandırma/gizlilik temelleri | 6–9 | Deneme, kullanım hakkı, webhook, silme nesli |
| EO-03 | OAuth, kanonik bağlantı ve token kasası | 4–6 | Üç sağlayıcı için tek yetki kaynağı |
| EO-04 | Meta, Google Ads ve Klaviyo adaptörleri | 8–12 | Ham kanıt + normalleştirilmiş olgular |
| EO-05 | Zamanlayıcı, Dataset V2, FX, olgunluk/kesinleşme | 7–10 | Saatlik yetkili veri katmanı |
| EO-06 | Formül, sorgu ve BFF/API | 4–6 | Veriyi doğru yansıtan tüketici yanıtı |
| EO-07 | Funnel, Ad Analysis ve Settings UI | 5–8 | Masaüstü/mobil Shopify'a yerel üç yüzey |
| EO-08 | Veri taşıma provası, eşlik, kademeli geçiş ve geri dönüş | 6–9 | Yetkili geçiş GO'su için ölçülebilir kanıt |
| **Review için kritik toplam** | | **42–63** | EO-F7 GO sonrası uygulanabilir |

### Review sonrası fakat silme öncesi zorunlu paketler

| Paket | İş birimi | Odaklı gün aralığı |
|---|---|---:|
| EO-09 | Yetki geçişini kararlı hale getirme ve eski tüketicilerin sıfırlanmasını gözleme | 4–6 |
| EO-10 | Eski yapının arşivi, saklama ve kontrollü emekliye ayırma | 3–5 |
| **Review sonrası toplam** | | **7–11** |

EO-09/10'u review için kritik toplamın dışında tutmak eski yapıyı erken silme yetkisi vermez. Eski çalışma zamanı geri dönüş hattıdır; tüketici-sıfır ve ayrı yıkıcı işlem onayı olmadan kapatılmaz.

## Neden temiz yol daha kısa?

### Yapılmayacak işler

- kök monoliti parçalayarak ayakta tutmak
- bağımsız kullanıcı/giriş/abonelik modelini uyumlulaştırmak
- GA4, Google Sheets, TikTok, Pinterest ve Organic çalışma zamanlarını yeni değişikliklerden korumak
- eski V1 anlık görüntü/pano hattını yeni Dataset V2 ile birlikte geliştirmek
- hata ayıklama/operatör/kabul rotalarını ürün yönlendiricisinden tek tek ayırmak
- 24 tabloluk karma şemada çalışma zamanı erişim sınırı kurmak
- 40 ortam değişkeninden hangisinin Production için kritik olduğunu her değişiklikte yeniden çözmek
- eski UI ve yeni üç yüzeyli UI'yı aynı public/dağıtım kökünde taşımak

### Yeniden yapılacak fakat keşfi bitmiş işler

- Shopify müşteri/kurulum/oturum yapısı
- üç sağlayıcının OAuth/istemci/normalleştirme davranışı
- token şifreleme zarfı
- Dataset V2 ve formül/sorgu kuralları
- Klaviyo maliyet dağıtımı
- üç yüzeyli rota/ürün haritası
- birebir 10 satır taşıma ve sağlayıcıdan yeniden çekme
- zamanlayıcı/kesinleşme/silme/faturalandırma sözleşmeleri

Temiz yol “sıfırdan bilinmeyen ürün” değildir. En pahalı keşifler ve ürün kararları mevcut sözleşme/kanıtla tamamlanmıştır; uygulama temiz sınırda yeniden kurulur.

## Risk skoru

Skor 1 zayıf, 5 güçlüdür. Ağırlıklı sonuç yükseldikçe yol daha güvenli/öngörülebilirdir.

| Kriter | Ağırlık | Monolit onarımı | Temiz yeniden kuruluş |
|---|---:|---:|---:|
| Yetki kaynağı ve erişim yetkilerini yalıtma | 20 | 2 | 5 |
| Review kanıtının açıklığı | 15 | 2 | 5 |
| Takvimin öngörülebilirliği | 15 | 2 | 4 |
| Yetkili geçiş/geri dönüş kontrolü | 15 | 3 | 4 |
| Canlı veri devamlılığı | 15 | 4 | 3 |
| Geriye dönük uyumluluk test alanının küçüklüğü | 10 | 1 | 5 |
| Uzun vadeli bakım | 10 | 1 | 5 |
| **Ağırlıklı hazırlık skoru** | **100** | **45/100** | **88/100** |

Temiz yolun belirgin dezavantajı canlı veri devamlılığı/geçiş işidir. EO-F4 birebir taşıma, yeniden çekme, şifreli token anahtar yenilemesi ve eski geri dönüş hattı bu riski azaltır; yok etmez. EO-08 başarısızsa yetkili geçiş yapılmaz.

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
                              -> review'a hazır kararı
```

Tam paketler paralel yürütülmez. Güvenli alt-paralellik yalnız ortak öncül sözleşme dondurulduktan sonra mümkündür:

- EO-04 sağlayıcı adaptörleri ayrı dal/test hatlarında hazırlanabilir.
- EO-07 üç ekranın analist brief'i ve bileşen eşlemesi paralel hazırlanabilir.
- EO-08 veri eşliği ile UI kabulü ayrı kanıt akışlarıdır.

EO-02 tamamlanmadan sağlayıcı çalışma zamanı, EO-05 tamamlanmadan nihai API/UI, EO-08 tamamlanmadan yetkili geçiş yoktur.

## Dış takvim kapıları

Odaklı gün hesabına dahil olmayan, fakat takvimi etkileyen işler:

- **15 Ekim 2026 Klaviyo genel kullanıma açılma (GA) yeniden doğrulaması:** Variation kimliği/kırılımı otomatik etkinleşmez. O gün resmî sözleşme yeniden okunacaktır; çalışma diğer paketlerle paralel ilerleyebilir. Bu tarihsel plan satırıdır; sonraki kabul edilmiş Klaviyo kabiliyet/attribution kararlarının yerine geçmez.
- Sağlayıcı attribution/kesinleşme pencereleri: gereken en uzun pencere kadar bekleme/yeniden kontrol gerekir; iş yapılmayan süre odaklı gün değildir.
- Google Ads'te boş olmayan canlı kabul bulunamazsa doğrulanmış boş yanıt kabiliyeti açıkça kaydedilir; sahte başarı üretilmez.
- Masaüstü ve gerçek mobil Shopify Admin kabul oturumları insan katılımı ister.
- Shopify App Review kuyruk süresi bu tahmine dahil değildir.

Planlama için asgari dış kanıt rezervi:

- Temiz yeniden kuruluş: **7–15 takvim günü**, geliştirmeyle kısmen örtüşebilir.
- Monolit onarımı: **10–20 takvim günü**, daha geniş uyumluluk/geri dönüş tekrarları nedeniyle daha değişkendir.

## Takvim yorumu

Tek aktif uygulama hattı ve haftada beş gerçek odaklı gün varsayımıyla:

- Gömülü ürünün review için kritik geliştirmesi: yaklaşık **8.4–12.6 çalışma haftası**
- Monolit onarımı: yaklaşık **11.8–18.4 çalışma haftası**

Shopify App Review kuyruğu bu aralıklarda yoktur. Kodlama otomasyonu bazı günleri kısaltabilir; sağlayıcı kanıtı, mağaza sahibi kabulü ve Production kapılarını ortadan kaldıramaz. İlk planda tahmin, EO-F7 GO sonrasında EO-01 alt işlere ayrılırken yeniden değerlendirilecektir; bu belge bugünkü kalan süre tahmini değildir.

## Karar

EO-F6 karşılaştırması **yalnız gömülü ürün için temiz yeniden kuruluş lehine PASS**:

- aynı review kapsamı korunur;
- beklenen review için kritik efor 17–29 odaklı gün azalır;
- hazırlık skoru 45'ten 88'e çıkar;
- gizli eski tüketici ve geriye dönük uyumluluk riski fiziksel sınırla küçülür;
- yeni geliştirme emekli kodun bakım maliyetini taşımaz.

Bu sonuç o gün henüz uygulama GO'su değildir. EO-F7'de kullanıcı efor/risk sözleşmesini ve F1–F5 kararlarını birlikte onaylamadan yeni repository, Vercel veya Supabase projesi oluşturulmaz. Sonraki GO kabulü EO-F7'de kayıtlıdır.

## Durma kuralları

- EO-F7 açık insan GO'su yoksa proje oluşturulmaz.
- EO-01 bağımlılık/uygulama çatısı seçimi güncel resmî doküman olmadan yapılmaz.
- EO-04 sağlayıcı sözleşmesi değişmişse süre/risk tahmini yeniden açılır.
- EO-08 eşlik, silme, faturalandırma, zamanlayıcı veya geri dönüş kapısı başarısızsa yetkili geçiş durur.
- Tüketici-sıfır yoksa eski yapı emekliye ayrılmaz.
- Tahmin teslim tarihi veya eksik kabul kapısını atlama gerekçesi olamaz.

