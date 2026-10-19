# A6-EO — Paketler arası güvenlik, kapasite ve taşınabilirlik kararı

**Durum:** Karar donduruldu; uygulama ve kabul bekliyor
**Karar tarihi:** 7 Ekim 2026
**Yürütülebilir sözleşme:** `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

> Bu belge 7 Ekim tarihindeki hedefleri ve kabul koşullarını kaydeder; bunların uygulanmış veya ölçümle kanıtlanmış olduğunu söylemez. Güncel ilerleme için `docs/EXECUTION_PLAN.md` bağlayıcıdır. Bu dil düzenlemesi yedekleme, kurtarma, kapasite artırımı veya EO-05 çalışması başlatmaz.

## Analist sonucu

Supabase için sabit bir “çalışma alanı sayısı” duvarı yoktur. Kapasiteyi her yenilemede yazılan satır ve bayt miktarı, geçmiş veriyi yeniden uzlaştırmanın yükü, sorgu biçimleri, eşzamanlı kullanıcılar ve dışa aktarmalar, saklama süresi, bağlantı kullanımı, CPU, bellek ve disk IO belirler. Bu nedenle AdsTable ölçülmemiş bir çalışma alanı sayısı vaat etmez; veritabanı taşımasını planlamak için canlı ortamın arızalanmasını da beklemez.

Ürün hedefi **2,000 aktif çalışma alanıdır**. Bu hedef ancak **4,000 çalışma alanlı sentetik stres testi**, 2,000 çalışma alanlı saatlik çevrim testi ve 2,000 çalışma alanıyla 24 saatlik dayanıklılık testi aşağıdaki eşikleri geçerse doğrulanmış kapasite sayılır.

2,000 çalışma alanında saat içine eşit dağıtılmış zamanlama saniyede ortalama 0.556 çalışma alanı başlatır. Üç sağlayıcının tamamı aktifse bu yaklaşık günde 144,000 sağlayıcı işi veya saniyede 1.667 sağlayıcı işi başlangıcıdır. Tek başına bu başlangıç hızı tehlikeli değildir. Bilinmeyen çarpan, her işin standartlaştırıp yazdığı sağlayıcı verisi miktarıdır. EO-05 uygulamasından önce bu çarpan ölçülmelidir.

## Otorite ve ilk review sınırı

- Aktif otorite bu repository ve `docs/EXECUTION_PLAN.md` dosyasıdır.
- `ads-table-dev` yalnız ilk kaynak geçmişi, kanıt ve eski yapıyı sınırlandırma referansıdır.
- Dışa aktarma ilk review kapsamı dışındadır.
- Bağlantıların tek yönetim yeri Settings'tir. Ayrı bir üst seviye Data Sources kontrolü yoktur.
- Yenileme AdsTable tarafından saatlik yönetilir. Kullanıcının yenilemeyi açıp kapattığı kontrol yoktur; arayüz yalnız son güncelleme ve sonraki planlı yenilemeyi gösterebilir.

## Abonelik ve gizlilik

- Deneme süresi ve aktif abonelik ürünün tamamına erişim sağlar.
- Bekleyen, dondurulmuş, iptal edilmiş, reddedilmiş, süresi dolmuş veya bulunamayan kullanım hakkı sağlayıcı işlerini durdurur.
- Settings ve gizlilik işlemleri açık kalır; Funnel ve Ad Analysis abonelik gerekli durumunu gösterir, metrik göstermez.
- Abonelik kaybı veriyi hemen silmez. Silme yalnız doğrulanmış Delete My Data talebi, doğrulanmış Shopify veri silme bildirimi veya onaylı saklama süresinin dolmasıyla başlar.
- Shopify webhook HMAC doğrulaması zorunludur. Shopify'ın 30 günlük tamamlama süresi ve kaldırma sonrası `shop/redact` yaşam döngüsü bağlayıcıdır.
- Genel bir yasal saklama istisnası yoktur. Her istisnanın kesin veri sınıfı, yasal dayanağı, sorumlusu ve bitiş tarihi olmalıdır.
- Geri yüklemeden sonra silme kayıtları yeniden uygulanmadan hizmet açılamaz.

## Yeniden uzlaştırma ve verinin kesinleşmesi

- Saatlik güncel veri penceresi, sağlayıcının iş tarihine göre yalnız bugün ve dündür.
- Tüm geçmiş her saat yeniden çekilmez.
- AdsTable her 24 saatte bir sağlayıcının geçerli attribution süresinin tamamını yeniden uzlaştırır.
- Meta'da raporlamada kullanılan doğrulanmış aktif hesap/Campaign/Ad Set attribution ayarlarının en uzunu alınır. Ayara ulaşılamıyorsa kesinleşme bilinmez ve veri geçici kalır.
- Google Ads'te aktif dönüşüm işlemlerinin en uzun tıklama/görüntüleme geriye bakış süresi alınır. Resmî genel üst sınırlar tıklamada 90, görüntülemede 30 gündür.
- Klaviyo'da doğrulanmış güncel hesap/mesaj attribution ayarı kullanılır. Mevcut test hesabının beş günlük Email penceresi bir kanıttır; tüm hesaplara uygulanacak sabit değildir.
- Bir tarih ancak geçerli attribution süresi, bir tam sağlayıcı iş günü ve pencere sonrası başarılı yeniden uzlaştırma tamamlanınca kesinleşir.
- Başarısız, kısmi veya kota nedeniyle sınırlanmış çalıştırmalar kesinleşmeyi ilerletmez. Ayar değişirse etkilenen tarihler tekrar açılır.

## Tarih ve karşılaştırma sınırı

- Saat dilimi otoritesi, uygulamanın kurulu olduğu Shopify mağazasının IANA saat dilimidir; sağlayıcının ham tarih ve saat dilimleri ayrıca saklanır.
- Varsayılan aralık bugün dahil son yedi takvim günüdür.
- Summary/Table özel aralığı en fazla 90, Daily en fazla 31 gündür.
- Karşılaştırma aralıkları aynı gün sayısında, çakışmayan, aynı saat dilimi ve raporlama para biriminde olmalıdır.
- İlk veri yükleme dün+bugün ile sınırlıdır. Daha eski erişilemeyen tarihler yapay sıfır sayılmaz.
- Güncel veya kesinleşmemiş tarihler görünür biçimde geçici işaretlenir.
- Sağlayıcının günlük verisi doğru biçimde dönüştürülemiyorsa AdsTable sessiz tarih kaydırmak yerine kısmi veri/saat dilimi uyumsuzluğu döndürür.

## Geri yükleme hedefleri

Bunlar AdsTable kabul hedefleridir; sağlayıcı garantisi veya bugün tamamlanmış kurtarma kanıtı değildir. RPO kabul edilebilir veri kaybı süresini, RTO hizmeti geri açma süresini ifade eder:

| Sınır | RPO | RTO |
|---|---:|---:|
| Kod/deployment | 0 | güvenli geri alma ≤30 dakika |
| Kritik kontrol veritabanı | ≤15 dakika | aşağıdaki toplam süreye dahil |
| Yeniden üretilebilir Dataset V2 | ≤60 dakika | yeniden işleme/uzlaştırmayla oluşturulur |
| Güvenli, kısıtlı hizmet | — | ≤60 dakika |
| Tam çalışma | — | ≤240 dakika |

Canlı kullanımdan önce PITR gerekir. EO-08-D öncesinde süre ölçülen geri yükleme provası geçmelidir. Geri yükleme envanteri veritabanının yanında Storage, Edge Functions, Auth ayarları, API anahtarları/secret rotasyonu, Realtime, eklentiler, replikalar ve Vercel yapılandırması/deployment için var/yok durumunu açıkça kapsar. Silinmiş veri geri getirilmemelidir. Bu gelecek kabul koşulu, bugün yedekleme veya prova başlatma yetkisi değildir.

## Kapasite sınırları

### Zorunlu iş yükü bütçesi

EO-05 öncesi ölçümler; yenileme başına sağlayıcı satırlarını, veritabanı satır/bayt miktarını, yeniden uzlaştırma yükünü, etkileşimli sorgu ve dışa aktarma eşzamanlılığını, çalışma alanı başına saklama büyümesini ortaya koymalıdır.

### Zamanlama

- Çalışma alanları saat içine eşit dağıtılır; saat başında tüm işleri birden başlatmak yasaktır.
- Süreli iş sahipliği ve tek etkin çalıştırma kuralı yinelenen işleri önler.
- Sağlayıcı ve veritabanı eşzamanlılığı sınırlıdır.
- Yük baskısına göre yavaşlama, tekrar denemeleri zamana yayma ve ilerleme kontrol noktaları zorunludur. Bu zamanlama tasarımı, dış sağlayıcıdaki ilk hata sonrası durma ve yeniden onay alma kapısını kaldırmaz.
- Saatlik çevrimin p95 süresi 45 dakikayı geçmez; 15 dakika yedek süre kalır.

### Sorgular ve dışa aktarma

- Her sorgu çalışma alanı ve tarih ile sınırlanır.
- İndeksler ölçülmüş sorgu biçimlerine göre kurulur; sınırsız tarama yasaktır.
- Arayüz önce toplulaştırılmış veriyi okur.
- Dışa aktarma eklendiğinde asenkron, cursor ile sayfalı ve belirli bir veri anına bağlı olacaktır. Ana etkileşimli bağlantı havuzunu tüketemez; üretilen dosyaların süresi dolar.

### Kabul eşikleri

- Etkileşimli okumalar: p95 ≤2 saniye; p99 ≤5 saniye.
- İş/sorgu hata oranı: <%0.1; müşteri verisi izolasyon hatası: 0.
- Sürekli CPU <%60, tepe CPU <%80, sürekli bellek <%70.
- Veritabanı/pooler bağlantı sınırı kullanımı <%60.
- Önerilen veritabanı boyutu kullanımı <%70.
- Disk IO kısılma olayı: 0. Sürekli yükte disk IO bütçesi tüketimi kapasite yükseltme incelemesini başlatır.
- En az %30 ölçülmüş boş kapasite kalır.

Canlı kabul edilen çalışma alanı sayısı son doğrulanmış kapasiteyi aşamaz. Bu kapasitenin %80'inde ölçekleme incelemesi zorunludur; sınırsız otomatik müşteri alımı yasaktır.

## Ölçekleme sırası

1. Sorgu planları, indeksler, toplu işleme ve saklama düzenlenir.
2. Supabase işlem kapasitesi artırılır.
3. Ölçüm gerektiriyorsa disk IOPS/veri aktarım kapasitesi sağlanır.
4. Salt okunur analiz ve dışa aktarma, gecikmesi görünür olan bir okuma replikasına alınır.
5. Gerekirse operasyonel kontrol verisi ile analitik iş yükü ayrılır.
6. Başka PostgreSQL platformu ancak ölçüme dayalı iş/operasyon kararıyla değerlendirilir; arıza sırasında doğaçlama taşınmaz.

7 Ekim kaynak değerlendirmesinde Supabase'in Micro'dan büyük/özel boyutlara kadar ayrılmış Postgres işlem kapasitesi, ayarlanabilir disk performansı ve analitik okumalar için okuma replikaları sunduğu kaydedildi. Büyüme otomatik olarak Google veritabanına taşınma anlamına gelmez; ölçülmüş ölçekleme gerektirir.

## Taşınabilirlik sınırı

Kanonik verilerde standart PostgreSQL önceliklidir; migration'lar repository'ye aittir, anahtarlar açık, veri türleri taşınabilir olmalıdır. Sağlayıcıya özgü özellik için adaptör ve çıkış planı kaydı gerekir. Kanonik veri Supabase Auth veya Storage'a geri döndürülemez biçimde bağımlı olamaz. EO-08, gelecekteki platform değişikliğinin planlı ve geri alınabilir olması için sağlayıcıdan bağımsız PostgreSQL'e geri yükleme provasını kapsar.

## Paketlere dağılım

- EO-02: abonelik/gizlilik ve şema ön koşulları.
- EO-05: yeniden uzlaştırma, zamanlayıcı, yazma kapasitesi ve gözlemlenebilirlik.
- EO-06: formüller, tarih aralıkları, sorgu ve dışa aktarma kapasitesi.
- EO-07: ilk review kontrolleri ve doğru arayüz durumları.
- EO-08: geri yükleme, yük, taşınabilirlik ve geri alma provası.

Bu karar yeni ana paket oluşturmaz, paket durumunu ilerletmez; canlı ortam değişikliği, kapasite artırımı, replika veya veritabanı taşımasına izin vermez.

## 7 Ekim 2026'da kontrol edilen resmî kaynaklar

- [Supabase işlem kapasitesi ve disk](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Supabase canlıya geçiş kontrol listesi](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase okuma replikaları](https://supabase.com/docs/guides/platform/read-replicas)
- [Supabase metrik API'si](https://supabase.com/docs/guides/observability/metrics)
- [Supabase yeni projeye geri yükleme](https://supabase.com/docs/guides/platform/clone-project)
- [Google Ads dönüşüm pencereleri](https://developers.google.com/google-ads/api/docs/conversions/getting-started)
- [Klaviyo attribution ayarları](https://help.klaviyo.com/hc/en-us/articles/11118357030555)
- [Meta resmî Marketing API koleksiyonu](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
- [Shopify gizlilik uyumu](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Vercel geri alma](https://vercel.com/docs/cli/rollback)
