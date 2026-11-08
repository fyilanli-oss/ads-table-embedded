# EO-05-B — beş tablo uygulamasının kayıt katmanı

8 Kasım 2026. PR #345'teki yerleşim ürün sahibi tarafından kabul edildi.
Bu çalışma aynı EO-05-B içinde dört yeni tablo, özel yazıcı ve izole SQL
sınamalarını hazırlar. Mevcut `identity.product_identity_mappings` değiştirilmez.

Üç fact tablosu native tutarları `numeric` olarak tutar; uygulama sınırında
kayıpsız ondalık metin kullanılır. Eksik metrik ile gözlenmiş sıfır farklıdır.
Sahiplik, hesap, kurulum nesli, kaynak makbuzu, sayfa özeti ve eşleme kapsamı SQL
işlemi içinde yeniden denetlenir. Bir işlemdeki sonraki kayıt reddedilirse önceki
yazımlar ve makbuz da geri alınır. Belirsiz sonuç otomatik tekrar edilmez; ayrı
inceleme yapılır. Kimlik aynı, içerik farklıysa düzeltme protokolü olmadan üzerine
yazılmaz. Tekrar yazım saklama süresini uzatmaz.

İsteğe bağlı metrik bölümü sürümlüdür. İlk sürüm boş registry'dir: örnek Meta
alanı dahil hiçbir yeni provider metriği kendiliğinden kabul edilmez. Yeni alan
için sözleşme, kaynak seçimi ve okuyucu/yazıcı tanımı birlikte güncellenir. Temel
kolon, kimlik veya yeni satır boyutu bu bölüme gizlenemez.

Kaynak sayfa ve paketleri, birincil olmayan metrik kaynakları dahil, bağlı fact
varsa normal temizlik tarafından kaldırılamaz. Mevcut mağaza silme worker'ı önce
bağlı fact'leri siler; sayıları kendi silme sonucuna ekler. Müşteri kapsamlı mevcut
worker, yeniden mühürlenecek sayfaların kaynak paketlerine bağlı fact'leri aynı
transaction içinde önce kaldırır; ilgisiz mağaza/nesil kayıtları korunur. Silinen
kaynak paketiyle yeni fact kabul edilmez. Ürün eşlemesi ve kur için normal silmede
kör cascade yoktur.

Yazıcının makbuzu **kayıt makbuzudur**. Kaynak paketinin `handoff_state` alanını,
rapor tüketim makbuzunu veya refresh checkpoint'ini ilerletmez. Makbuz mevcut
kaynak paketi manifest'inde, paket başına en fazla 32 işlem olarak tutulur;
altıncı tablo kurulmaz. İnceleme, kayıtların hâlâ varlığını ve kaynak durumunu
yeniden kontrol eder.

Bu katman, güvenilir sunucu projection'ının storage DTO'sunu alır. Makbuz ve
sayfa özeti eşleşmesi provider alanının anlamını veya tutarın fiziksel yanıttan
doğru çıkarıldığını tek başına kanıtlamaz. Native okuyucu/projection kabulü ve
rol/Channel kanıt kapıları yerinde kalır. Mevcut canonical rapor validator'ı
gevşetilmez. Burada sağlayıcı sorgusu veya mevcut okuyucu bağlanmaz.

Kur tablosu belirli para çifti/gün/kaynak/sürümü tutar; kur satırı değiştirilemez.
Bu çalışma gerçek kur sağlayıcısı seçmez, kur sorgusu çalıştırmaz ve otomatik
önceki gün/güncel kur fallback'i kurmaz. Kur yoksa native değer saklanabilir;
dönüştürülmüş rapor hazır sayılmaz.

Canlı aktivasyon yoktur. Yeni tablolara veya yazıcıya runtime/source-runner
yetkisi verilmez. Canlıya geçmeden önce aynı EO-05-B içinde gerçek projection
bağlantısı, açık Dataset saklama politikası ve buna bağlı olağan temizlik kabulü,
kur kaynağı/rapor para birimi kabulü tamamlanmalıdır. Mevcut kaynak 90/365 gün
kararı değiştirilmez; yeni fact süresi buradan veya UI aralığından türetilmez.
Testte kullanılan süreler ve kurlar yalnız sentetiktir.

Mevcut EO-05-C/D düzeltme/yeniden işleme ve gerçek tüketim/checkpoint işleri bu
katmanın tamamlanmasıyla bitmiş sayılmaz. 18/22 native kanıt beklemeleri ile
EO-07-A/EO-08-D teslim ve EO-08-C yedek ertelemeleri korunur. Yeni paket yoktur.

Kontroller: `tests/dataset-storage.test.js`, mevcut tam test paketi, typecheck,
build, iki anayasa guard'ı ve mevcut F01 içinde gerçek PostgreSQL üzerinde
`tools/eo05b-dataset-storage-probe.mjs`. SQL sınamaları geçici CI veritabanında
sentetik sahiplik/şifreli kaynakla çalışır ve geri alınır; canlı kanıt değildir.

Resmî mekanizma kontrolü 8 Kasım 2026: [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html),
[INSERT](https://www.postgresql.org/docs/current/sql-insert.html),
[numeric](https://www.postgresql.org/docs/current/datatype-numeric.html),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
Migration mevcut CI ile aynı `supabase@2.121.0 migration new` komutuyla oluşturuldu.
