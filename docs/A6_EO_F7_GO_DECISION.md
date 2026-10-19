# A6 EO-F7 — Yalnız Shopify içine gömülü temiz yeniden kuruluş için GO kararı

**Tarih:** 4 Ekim 2026

**Karar sahibi:** Ürün sahibi / kullanıcı

**Karar:** **GO — yalnız Shopify içine gömülü temiz yeniden kuruluş**

**Tarihsel durum:** Fizibilite tamamlandı; EO-01 uygulama başlangıcı yetkilendirildi

**Etkisi:** Kararı ve yetki sınırını kaydeder. Kendi başına repository/proje oluşturmaz; Production, sağlayıcı, veritabanı, Shopify veya dağıtım değişikliği yapmaz.

**Okuma notu:** Bu belge 4 Ekim 2026'da kabul edilen başlangıç GO'sudur; yeni GO talebi veya bugünkü sınırsız uygulama yetkisi değildir. EO-01–04'ün sonraki kabulleri korunur. Bugünkü sıra ve açık kapılar `docs/EXECUTION_PLAN.md` ile `contracts/a6-eo-implementation-master-v1.json` içindedir. Bu dil düzenlemesi EO-05'i açmaz; canlı taşıma, kaynak oluşturma, yetkili geçiş veya silme başlatmaz.

## İş kararı

AdsTable'ın Shopify gömülü ürünü eski monolit onarılarak büyütülmeyecektir. Yeni ürün şu sınırlarla kurulacaktır:

- ayrı, temiz GitHub repository'si;
- ayrı, yalnız Preview ile başlayan Vercel projesi;
- ayrı Standard Supabase Postgres projesi;
- yalnız Meta, Google Ads ve Klaviyo;
- yalnız Funnel App Home, Ad Analysis ve Settings;
- izin listesine dayalı sözleşme/veri/davranış taşıması.

Monolit, yeni ürün eşlik, kademeli geçiş, geri dönüş ve yetkili geçiş kapılarını geçene kadar Production riskini sınırlama ve geri dönüş hattı olarak korunur.

## Neden GO verildi?

EO-F1–F6 birlikte aşağıdaki soruları kapattı:

| Kapı | Sonuç |
|---|---|
| EO-F1 | Kanonik yetki kaynağı ve canlı veri envanteri çıkarıldı; faturalandırma, zamanlayıcı ve gizlilik temel boşlukları yeni programa taşındı |
| EO-F2 | Ayrı GitHub repository'si + ayrı Vercel projesi seçildi |
| EO-F3 | Uygulama/çalışma zamanı kodunu aynen taşıma 0; davranışlar çıkarılıp yeniden yazılır veya yalnız sözleşme alınır |
| EO-F4 | Ayrı Standard Supabase seçildi; birebir 10 iş satırı taşıma ve Dataset'i yeniden çekme kararı |
| EO-F5 | Üç yüzeyli ürün/rota haritası: Funnel, Ad Analysis, Settings |
| EO-F6 | Temiz yol 42–63, monolit onarımı 59–92 odaklı gün; hazırlık skoru 88/100 ve 45/100 |

İşlev veya güvenlik kapısı eksiltilmedi. Gizlilik, silme, faturalandırma, sağlayıcı doğruluğu, zamanlayıcı/kesinleşme, doğru API/UI sunumu, mobil/masaüstü kabul, eşlik ve geri dönüş zorunlu kaldı.

## GO'nun yetkilendirdiği işler

EO-F7 merge edildikten sonra başlayabilecek program:

1. **EO-01:** Temiz repository/çalışma zamanı kabuğu, CI, bağımlılık ve yasak import sınırı
2. **EO-02:** Çalışma alanı, kurulum, 14 günlük deneme/faturalandırma ve gizlilik yaşam döngüsü temeli
3. **EO-03:** Kanonik OAuth, bağlantı ve token kasası
4. **EO-04:** Meta, Google Ads ve Klaviyo adaptörleri
5. **EO-05:** Zamanlayıcı, Dataset V2, FX, veri kökeni, olgunluk/uzlaştırma/kesinleşme
6. **EO-06:** Formül, sorgu ve BFF/API
7. **EO-07:** Üç yüzeyli Shopify'a yerel UI
8. **EO-08:** Veri taşıma provası, yan yana eşlik, kademeli geçiş ve geri dönüş
9. **EO-09:** Yetki geçişini kararlı hale getirme ve eski tüketicilerin sıfırlanması
10. **EO-10:** Eski yapının arşivi, saklama ve kontrollü emekliye ayırma

### Fiziksel kaynak yetkisi

EO-01/EO-02 paketleri kendi yürütülebilir plan ve test sınırlarında şu aday kaynakları oluşturabilir:

- hedef GitHub repository adayı: `fyilanli-oss/ads-table-embedded`
- hedef Vercel projesi adayı: `ads-table-embedded`
- hedef Supabase görünen ad adayı: `adstable-embedded`

Bunlar tarihsel aday adlarıdır; bugün yeniden kaynak oluşturma talebi değildir. Gerçek oluşturma öncesinde ad uygunluğu salt okunur kontrol edilir. Çakışmada sessiz alternatif üretilmez; hedef ad kararı güncellenir.

Kaynaklar boş/temiz başlar:

- eski repository fork edilmez;
- eski dosya ağacı veya Git geçmişi topluca kopyalanmaz;
- eski paket tanımı/lockfile başlangıca alınmaz;
- Production alan adı bağlanmaz;
- mevcut Shopify uygulama URL/yönlendirme yapılandırması değiştirilmez;
- eski Supabase kimlik bilgisi/service role yeni çalışma zamanına verilmez.

## GO'nun yetkilendirmediği işler

Bu karar şunlara izin vermez:

- `dev.adstable.app` alan adı geçişi
- Shopify App URL veya yönlendirme URI'sinde Production değişikliği
- mevcut Production dağıtımını kapatma
- canlı sağlayıcı çağrısı veya OAuth/token değişikliği
- canlı satır/veri/token taşıması
- Dataset Production geçmiş verisini tamamlama
- eski Supabase projesinde silme/güncelleme/yetki daraltma
- tüketici-sıfır öncesi eski kod/tablo/ortam değişkeni silme
- uygulamanın review'a, Production'a veya yetkili geçişe hazır olduğu iddiası
- kanıt olmadan RM/R/E bulgularını kapatma
- yıkıcı temizlik veya emekliye ayırma

Bunlar kendi paketleri, CI/kanıt ve gerektiğinde ayrı açık insan kapıları tamamlanmadan yapılamaz.

## EO-01 başlangıç sözleşmesi

EO-01'in ilk teslimi Production ürünü değil, temiz ve kanıtlanabilir Preview kabuğudur.

Zorunlu çıktılar:

1. ayrı repository ve dal koruması/CI;
2. asgari, güncel resmî Shopify altyapısı kararı;
3. temiz paket tanımı ve lockfile;
4. eski yapı/import/rota/tablo/ortam değişkeninin bulunmadığını doğrulayan ret testleri;
5. App Bridge + Polaris web bileşenlerinden kabuk;
6. üç kanonik rota için verinin yokluğunu doğru gösteren boş durum:
   - `/`
   - `/ad-analysis`
   - `/settings`
7. yalnız sunucuda tutulan yapılandırma sınırı;
8. yalnız Preview Vercel dağıtımı;
9. Production alan adı ve Shopify uygulama yapılandırması değişikliği 0;
10. geri dönüş: yeni Preview çıktısı devreden çıkarılır, eski Production etkilenmez.

EO-01 ürün verisi çekmez, canlı token taşımaz ve Supabase iş şemasını kurmaz. Veri katmanı oluşturma EO-02'nin kesin migration/rol sözleşmesine bağlıdır; EO-01 yalnız gerekli bağlantı arayüzünü ve hata halinde kapalı kalan yapılandırmayı tanımlar.

## Sıra ve durma kapıları

```text
EO-F7 GO
  -> EO-01 temiz kabuk
      -> EO-02 temeller
          -> EO-03 bağlantı/token
              -> EO-04 sağlayıcılar
                  -> EO-05 veri katmanı
                      -> EO-06 API
                          -> EO-07 UI
                              -> EO-08 eşlik/kademeli geçiş/geri dönüş
                                  -> ayrı yetkili geçiş kararı
                                      -> EO-09 tüketici-sıfır
                                          -> EO-10 emekliye ayırma
```

- EO-01 CI ve yasak derleme kontrolleri geçmeden EO-02 başlamaz.
- EO-02 yetki kaynağı, faturalandırma ve gizlilik temeli geçmeden sağlayıcı çalışma zamanı başlamaz.
- EO-05 kesinleşme/veri kökeni geçmeden nihai API/UI yoktur.
- EO-08 eşlik ve geri dönüş geçmeden Production'a yetkili geçiş yoktur.
- Geçiş kararlı hale gelmeden ve tüketici-sıfır kanıtlanmadan eski yapı emekliye ayrılmaz.

## O gün mevcut paketlere etkisi

- A6 denetim bulguları kendiliğinden kapanmaz; EO paketlerine kabul kapısı olarak taşınır.
- RM-01 canlı güvenlik kazanımı mevcut Production riskini sınırlama hattında korunur.
- R6/R7/R8 kanıt ve kabul gereksinimleri yeni sağlayıcı/UI/eşlik paketlerinde yeniden kullanılır; otomatik Done sayılmaz.
- E10 yaşam döngüsü/faturalandırma/UI kararları EO-02/EO-07 içinde temiz uygulanır.
- E11–E14, EO-06–EO-10 sırasına uyarlanır.
- Monoliti büyüten veya temiz ürünün gereksiz kıldığı düzeltmeler yapılmaz; yalnız Production riskini sınırlamak için zorunlu asgari iş kalır.

## Başarı tanımı

EO programı ancak şu durumda review'a hazır olabilir:

- üç sağlayıcı için gerçeği yansıtan kabul edilmiş veri durumu;
- zamanlayıcı/kesinleşme/uzlaştırma kanıtı;
- doğru 14 günlük deneme/faturalandırma durumu;
- zorunlu gizlilik, Delete My Data, kaldırma ve temiz yeniden kurulumun uçtan uca kabulü;
- Funnel, Ad Analysis ve Settings için masaüstü + gerçek mobil kabul;
- yan yana eşlik ve hata vererek geri dönüş testi;
- eksik/bilinmeyen/desteklenmeyen veriyi ölçülmüş sıfır göstermeme;
- Production hata ayıklama/operatör/eski rota sayısı 0;
- açık ürün sahibi review'a hazır kararı.

Güncel Execution Plan'daki A6-TECH-01, A6-DOCS-01, paket sonu delta ve A6-ASSURE-01 kapıları ayrıca geçerlidir; tarihsel GO bunları atlatmaz.

## Tarihsel EO-F7 sonucu

**GO kabul edildi.**

- seçilen yol: yalnız gömülü ürün için temiz yeniden kuruluş
- reddedilen yol: monoliti hedef ürün geliştirme zemini olarak onarmak
- EO-01 başlangıç yetkisi: o gün açık
- yeni hedef kaynak oluşturma: o gün EO-01/EO-02 paket sınırında açık
- Production'a yetkili geçiş: kapalı
- canlı veri/token taşıması: kapalı
- sağlayıcı değişikliği: kapalı
- eski yapıyı silme/emekliye ayırma: kapalı
- o günkü sıradaki paket: **A6-EO-01 — Temiz çalışma zamanı kabuğu, CI ve bağımlılık sınırı**

