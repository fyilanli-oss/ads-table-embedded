# EO-05-E — İşlerin sağlığını ve tüketimini izleme

**Tarih:** 10 Kasım 2026. **Durum:** Onaylı kod, SQL hazırlığı, izole test ve tek PR.
Canlı izleme veya bildirim açılmış değildir.

Fırat, beş mevcut başlığın somut açıklamasından sonra “Çok net anlaşıldı
onaylıyorum devam Codex” diyerek çalışmayı onayladı. Bağlayıcı kayıt
`contracts/eo-05e-observability-v1.json`; önceki alarm tasarımı
`contracts/eo-05-refresh-alarm-matrix-v1.json` tarihsel tasarım olarak korunur.

## Ne ölçülür?

1. **Verinin güncelliği:** Kaydedilmiş ham zarf değil, EO-05-D'nin tüketilmiş gün
   makbuzu ve fiziksel tablo karşılaştırması kullanılır. Gerçek boş sonuç ayrı
   doğrulanır; bulunmayan/erişilemeyen/uyumsuz kayıt sıfır olmaz. Kuyruk heartbeat'i
   raporun güncelliğini kanıtlamaz. Son doğrulanmış kaynak okumasının tamamlanma
   zamanı ölçülür; izleme zamanı daha yeni veri varmış gibi kullanılamaz.
2. **İşin ilerlemesi:** Mevcut iş, aşama, son ilerleme ve durma kayıtları okunur.
   En fazla101 kayıt döner;100 sınırının aşılması açıkça eksik kapsamdır.
   Ayrılmış bütçe gerçek tüketim olarak sunulmaz. Tam beklenen bölüm/iş manifest'i
   ile ölçülmüş ve onaylanmış aşama eşikleri dışarıdan açıkça verilmelidir.
3. **Kesinleşmemiş günler:** Mevcut olgunluk makbuzları sınırlı okunur. Bilinmeyen,
   eksik veya taşmış envanter tamamlanmış sayılmaz. Eski güne ait veri düzeltmesi
   ile bugünün/dünün saatlik işi maliyet hesabında ayrı iş sınıflarıdır.
4. **Kaynak tüketimi:** Ortak private Dataset çalıştırıcısında gerçek sorgu girişimi,
   monoton süre, süreç CPU farkı ve bitişte RSS örneği alınır. CPU/RSS paylaşılan
   süreç ölçümüdür; tek müşterinin CPU faturası veya işin tepe belleği değildir.
   SQL okuması veritabanı boyutunu, bağlantı sayısını ve reset zamanı ile kümülatif
   sayaçları verir. Pooler bağlantıları, gerçek disk IOPS, WAL ve sorgu gecikmesi
   için henüz bağlanmamış platform ölçümü **unknown** kalır; sıfır üretilmez.
5. **Maliyet girdileri:** Tekil ölçüm kimlikleriyle gözlenen istek/sorgu/satır/bayt
   ve süre toplanır. Yinelenen kimlik reddedilir. Sayaçlar yalnız enstrümante
   edilmiş çağrıları kapsar; henüz okunmayan kaynakların sayısı ölçülmüş sayılmaz.
   Onaylı fiyatlar ve tam kapsam olmadan aktif mağaza başına parasal maliyet
   açıklanmaz. EO-06 formülleri veya maliyet dağıtımı burada yeniden tasarlanmaz.

## Alarm davranışı

AL01–AL16'nın mevcut aşama ve önem dereceleri korunur. Tam manifest'teki eksik bir
bölümü başka bölümün başarısı örtemez. Provider hatası, kısmi yanıt, yetki kaybı,
sonucu belirsiz işlem, tablo uyuşmazlığı ve hatalı checkpoint farklı sınıflanır.
Geçerli boş sonuç ve olağan bütçe beklemesi bilgi sınıfındadır. AL03/AL09/AL16 gibi
mevcut guard ihlalleri güvenilir sunucu bileşiminden açık sınıflı sinyal alır;
izleme, mevcut önleme/kimlik/silme guard'ının yerine geçmez.

Kuyruk sessizliği tam120 saniyede henüz kritik değildir;120 saniye aşıldığında
kritiktir. Başlangıç da kalıcı aktivasyon zamanından hesaplanır. Eski, tekrar,
gelecek tarihli, başka ortam veya generation sinyali süreyi yenilemez. Aşama
süreleri için120 saniye varsayımı yapılmaz.

Bağımsız gözlemci bileşimi önce bağımsız kalıcı durumunu okur. Ana veritabanı
okunamasa bile son doğrulanmış heartbeat üzerinden sessizliği hesaplar. Bağımsız
duruma tek CAS yazımı doğrulanmadan kalıcı tanık var denmez; kayıp cevaba tekrar
yazım yoktur. Başlangıç kaydı yoksa kendiliğinden yeni tolerans süresi başlamaz.
Bu adapter sözleşmesi gerçek bağımsız sunucu/depo/tetikleyici kurulduğu anlamına
gelmez. Adapter'ın güvenilirliği, bağımsızlığı ve generation kaynağı canlı kapıda
ayrıca kanıtlanır. Gözlemciyi de ayrı tanık/canary izlemelidir.

Alarm anahtarı ortam, generation, opak kapsam kimliği ve sebep/aşama içerir.
Tekrarlarda ilk/son zaman ve adet güncellenir; bildirim durumu başa sarmaz ve
saklama sonu uzamaz. Serbest hata, payload, URL, hesap/mağaza adı veya secret alanı
yoktur. Incident reducer yalnız sınırlı güvenli nesne üretir; canlı depo/CAS,
silme/expiry uygulaması ve bildirim rotası seçilmeden kalıcı alarm servisi değildir.

Bildirim kabulü teslim veya insan onayı değildir. Teslim kanıtı yoksa unknown
kalır. İnsan onayı tek başına çözüm değildir; doğrulanmış iyileşme ve yetkili
çözüm gerekir. Hiçbir alarm işi yeniden çalıştırmaz, bilinmeyen yazıyı inceleyip
sonuçlandırmaz, rezervasyon bırakmaz veya checkpoint ilerletmez. Known consumed
makbuzun güncellik kontrolü bilinmeyen operasyon için recovery kanıtı değildir.

## Doğrulama ve canlı kapı

Unit testleri saat sınırları, tekrar/gelecek sinyali, bağımsız depo/ana DB hatası,
kapsam eksikliği, veri durumları, güvenli alarm yaşam döngüsü ve maliyet girdilerini
sınar. F01'in mevcut localhost rollback işleminde üç provider için gerçek SQL,
AEAD ve fiziksel boş gün makbuzu okunur; kaynak kaydı güncellik sayılmaz, scope
ve ACL ihlalleri reddedilir. HTTP/provider cevapları ve sahiplikler sentetiktir.
Bu sonuç gerçek alarm teslimi, bağımsız canlı tanık veya kapasite testi değildir.

Migration yalnız hazırlanır. İki yeni okuma fonksiyonu PUBLIC, runtime,
coordinator ve kaynak rollerine verilmez. Yeni Dataset ailesi, kalıcı telemetry
tablosu, saklama süresi veya kullanıcı arayüzü yoktur. Üç yıllık senkron saklama
ve zorunlu silme aynen geçerlidir; silinmiş/yenilenmiş sahiplik okunamaz.

Canlı açılıştan önce mevcut sözleşmenin kapıları gerekir: tam beklenen envanter,
ölçülmüş eşikler, bağımsız gözlemci/depo/tanık, sınanmış teslim gecikmesi,
ana/yedek bildirim kanalı ve alıcısı, ACK/escalation süreleri, alarm saklama/silme
politikası, gerçek canary ve açık owner aktivasyon onayı. Bu PR bunları seçmez,
servis satın almaz veya canlı görev kurmaz. Native provider ve kapasite kabulü
halen ayrı kanıttır. Mevcut kapsam dışında yeni paket açılmaz.

## Resmî kaynaklar

10 Kasım 2026'da kontrol edildi:
[PostgreSQL sayaçları](https://www.postgresql.org/docs/17/monitoring-stats.html),
[Node.js süreç ölçümleri](https://nodejs.org/docs/latest-v24.x/api/process.html#processcpuusagepreviousvalue),
[Supabase Metrics API](https://supabase.com/docs/guides/observability/metrics).
Kümülatif sayaçlar reset sınırı olmadan hız değildir; işletim sistemi disk IOPS
veya tek müşterinin maliyeti olarak yeniden adlandırılmaz.
