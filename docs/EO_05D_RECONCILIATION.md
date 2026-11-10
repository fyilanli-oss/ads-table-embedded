# EO-05-D — İlk yükleme, değer güncelleme ve kaynak kabulü

10 Kasım 2026 owner onaylı kapsam: önce dün/bugün sırası, aynı günün yeni değeri
devralması, tekrar güvenliği ve ham kaynak–fiziksel tablo karşılaştırması. Kod,
gerekli SQL hazırlığı, izole testler ve tek PR. Canlı DB/provider/config, merge ve
yayın ayrı onay gerektirir. Mevcut depo ve beş mantıksal Dataset ailesi korunur.

## Kullanıcıya görünen anlam

Aynı hesap/ürün/gün için önce3, sonra5 satış okunursa yeni değer5'tir;8 olmaz.
Tam doğrulanmış yeni okuma boşsa o günün önceki satırları kaldırılır; sahte sıfır
satırı üretilmez. Eksik metric, kısmi/başarısız okuma ve mevcut anlamsal hold eski
doğru değeri değiştirmez, consumer kabulü/checkpoint üretmez. Meta nonempty satış
anlamı hold'u ve Klaviyo Shopify metric yokluğu korunur. Kesinleşme yeni değerin
gösterilmesini bekletmez; EO-05-C'nin unknown/provisional/final kararını değiştirmez.

## İlk yükleme

`planDatasetBootstrap`, gerçek IANA provider takviminde dün ve bugün sırasını
üretir; dispatch/yetki üretmez. Başlangıcı eligibility öncesindeki gün açıkça
unavailable'dır. Bağlantının kapalı olduğu aralığı doldurmaz; gün ortası bağlantı
ve istemsiz yetki kaybı için henüz onaylanmamış geçmiş/kısmi-gün politikası uydurmaz.
`executeDatasetBootstrap` tek kullanımlı özgün planla mevcut admitted okuyucu/
yazıcı callback'ini sırayla çağırır. Önceki günün exact owner/tarih/saat dilimine
bağlı gerçek SQL readback makbuzu olmadan sonraki güne geçmez. Kopya JSON, input
completedDates, hata veya belirsiz cevap ilerleme yetkisi değildir. Yeni provider
çağrısı, cron veya otomatik retry başlatmaz; mevcut scheduler aktivasyonu ayrı kalır.

## Doğrulanmış kaynaktan atomik kabul

1. Mevcut `readStoredDatasetSources` fiziksel zarfı, AEAD/hash, tam sayfaları,
   current owner ve orijinal admission snapshot'ını doğrular. Sabit mevcut Google,
   Meta veya Klaviyo projector'ü ve mevcut isteğe bağlı FX çözümlemesi kullanılır.
2. Tam, holdsuz sonuç yeni private reconciliation RPC'ye gönderilir. Caller row,
   key veya arbitrary sorgu alınmaz. Boş sonuç da tam kaynak referansları taşır.
3. SQL mevcut refresh-control/kurulum kilit sırasını, owner/nesil/connection,
   eligible gün/saat dilimi, tam iki/üç zarf ve tüm kaynak sayfaları, gerçek okuma
   saatleri ve mevcut üç yıllık politikayı yeniden denetler. Gün revizyonu CAS'tır;
   eski okuma ve kullanılmış operation/source kabul edilmez. Bir operation en fazla
   200 yeni ve200 eski fact,300 kaynak sayfası,1MiB istek ve120 saniye deadline ile
   sınırlıdır. Büyük tam gün sessizce kesilmez; limitte durur.
4. Mevcut native key ve fact doğrulayıcıları korunarak aynı kimlik güncellenir;
   mevcut UPDATE engeli yalnız aynı SQL transaction'ındaki exact satır/önceki ve
   yeni revizyon/önceki ve yeni digest izniyle açılır. Bu geçici permit kaynak
   manifest'inden update hemen sonrasında kaldırılır; kalan validator bütünüyle
   çalışır. GUC, trigger kapatma veya genel UPDATE yetkisi kullanılmaz.
   yeni tam okumada kaybolan satırlar yalnız aynı hesap/kurulum/connection/gün/saat
   dilimi kapsamında ve bağımlılık kontrolüyle kaldırılır. Başka hesap veya gün
   değişmez. Eski encrypted zarf/sayfa ve tarihsel FX/kimlik kanıtı silinmez.
5. SQL fiziksel tablodan bütün DTO değerlerini okuyup exact canonical digest'i
   yeniden hesaplar; yalnız stored payload_digest kolonuna güvenmez. Beklenen
   projection ile eşitse aynı transaction içinde exact source handoff consumed,
   bağımsız consumer makbuzu ve gün checkpoint revizyonu kaydedilir. Kaynak makbuzu
   tek başına consumer makbuzu değildir. Sonuç kesin bilindikten sonra JS makbuzu
   yeniden okur; kayıp write cevabında otomatik inspect/retry yoktur.

Gün checkpoint'i bu exact source-to-Dataset kabulüdür; scheduler job finish veya
reservation release değildir. Runtime `publishable` ve `hourlyRefreshActivated`
false kalır. Saatlik çağrı/scheduler açılması veya yeni canlı grant bu PR'da yoktur.

## Uyuşmazlık, tarih ve silme

Mevcut source manifest'indeki bounded `datasetReconciliation`, önceki/yeni
digest'leri ve inserted/replaced/removed kararlarını saklar. Fiziksel write-readback
uyuşmazlığında iç transaction bütün fact/consumed/checkpoint değişikliklerini geri
alır; yeni kaynakta yalnız minimal `datasetReconciliationMismatch` hata kaydı
kalır. Veri/secret/native hata gövdesi kaydedilmez. Unknown yazım sonucu bu bilinen
mismatch ile aynı değildir; otomatik tekrar veya alternatif rota yoktur.

Önceki consumer makbuzu tarihsel kalır, fakat superseded makbuz güncel checkpoint
sayılmaz. Önceki storage/empty-retention makbuzları da supersession sonrası güncel
rapor doğrulaması vermez; EO-05-C eski bir raporu final göstermek için kullanamaz.
EO-05-C yeni gerçek consumer makbuzunu aynı fiziksel readback ile tanır; eski
makbuz superseded olduğunda eski final kararı provisional olur. Yeni okuma aynı
mevcut native atıf/olgunluk koşullarını ayrıca sağlamalıdır.
Okumalar kaynak gizlilik/TTL ve gerçek fact digest'lerini yeniden kontrol eder.
Mevcut mandatory scoped erasure bütün rapor/source katmanlarında önceliklidir;
yeni PII, dış audit tablosu veya özel silme istisnası eklenmez.

## Sunucu ve test kapısı

Mevcut üç private Dataset handler'ı version1 planda eski storage-only davranışını
korur. Version2, explicit expectedRevision ve yalnız iki yeni private RPC ile bu
kabul yolunu seçer. Hazır role extension ayrı dosyadır; canlıya uygulanmaz. Public,
anon, authenticated, service_role, runtime/coordinator veya doğrudan tablo yetkisi
verilmez. Özel worker/digest helper'ları runner'a da açılmaz.

Unit testleri provider takvimi/DST/eligibility, iki gün sırası, sahte/eski/kopya
makbuz, eksik metric/Meta hold, tam boş, bozuk kaynak ve unknown-no-retry sınar.
Mevcut F01 rollback testinde gerçek PostgreSQL, AEAD ve dar role profilleriyle
3→5 değişimi, aynı ID, duplicate/CAS/stale reddi, boşun eski fact'leri kaldırması,
sonradan bozulan fiziksel değerde rollback+mismatch kaydı ve üç provider version2
sunucu bileşimi doğrulanır. Native HTTP/hesap/anahtar/clock sentetiktir; native
nonempty veya canlı kapasite kabulü sayılmaz. EO-06 formüller/güncel sentetik veri
ve mevcut EO-05 kapasite koşuları yerinde kalır.

Resmî kontrol10 Kasım2026: [PostgreSQL transactions](https://www.postgresql.org/docs/17/tutorial-transactions.html),
[INSERT/UPDATE](https://www.postgresql.org/docs/17/sql-insert.html),
[lock sırası](https://www.postgresql.org/docs/17/explicit-locking.html),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Supabase changelog](https://supabase.com/changelog).
