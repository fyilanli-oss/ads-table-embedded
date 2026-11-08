# EO-05-B — üç yıllık rapor geçmişi ve ham kaynaktan bağımsız saklama

8 Kasım 2026. Ürün sahibi “Son karar önerinde mutabikiz Codex” ve ardından
“Tamam başlayalım Codex” diyerek aşağıdaki rapor saklama kararını kabul etti.
Bu kayıt aynı EO-05-B / Ayrıntılı kontrol listesi 23 içindedir. Yeni paket değildir.

## Kabul edilen karar

| Veri | Normal saklama kararı |
|---|---|
| Rapor için gerekli seçilmiş Dataset verisi | Verinin ait olduğu tarihten itibaren üç yıl |
| Raporun anlamını koruyan seçilmiş kimlik, kur ve hesaplama/sözlük sürümü bilgisi | Bağlı rapor geçmişini destekleyecek süre |
| Mevcut ham kaynak ve kaynak metaverisi | Kabul edilmiş 90/365 gün politikası korunur |
| Tekil sipariş, olay ve kişisel ayrıntılar | Dataset içinde bulunmaları otomatik üç yıllık saklama izni değildir; alan gerekliliği ve silme adresi incelenir |

Üç yıl normal rapor geçmişidir. Yeniden okuma, düzeltme, zenginleştirme veya yeni
bağlantı bu saati yeniden başlatmaz. Zaman hesabı ingestion/download tarihi
değil native iş günü veya olayın ilgili iş gününe dayanır. Eksik tarih/saat
dilimine göre süre uydurulmaz. Yıl dönümü, artık gün ve saat dilimi davranışı
runtime uygulamasında açık sınır testleriyle belirlenir; üç yıl 90/365 günden
türetilmez. Bu kayıt tarih filtresini veya rapor sorgu aralığını değiştirmez.

Normal ham zarf temizliği geçmiş raporu silmemeli, toplamlarını değiştirmemeli
veya onu kullanılamaz hale getirmemelidir. Rapor sayılarının yanında gerekli
kanıt özeti, kaynak kapsamı, kimlik ve sürüm bilgisi korunur. Süresi dolan ham
gövde ikinci bir alana kopyalanarak saklama politikası dolanılmaz. Özet kanıt,
ham gövdenin hâlâ var olduğu veya yeniden native doğrulandığı diye sunulmaz.

Doğrulanmış zorunlu mağaza silmesi, mağazaya ait kaynak/Dataset/eşleme/kanıt
katmanlarını kapsar; üç yıl beklenmez. Başka mağazanın kaydı veya ortak bağımsız
kur kaynağı körlemesine silinmez. Müşteri kapsamlı talepte ilgili kayıtların
bulunabilirliği ham gövdenin normal süresi bittikten sonra da korunmalıdır.
Kapsamı bulunamayan olay anonim veya silinmiş kabul edilemez. Mevcut worker ve
yeniden yazmayı engelleyen kayıtlar korunur; yeni bir gizlilik motoru kurulmaz.

## Mevcut koddan çıkan uygulama ihtiyacı

İnceleme tabanı `009570183f7cfd4a7781a61dc2d1ecd1e599f07f` (PR #347).
Exact blob/anchor kanıtı: [bağımlılık incelemesi](evidence/EO05B_REPORT_RETENTION_DEPENDENCIES_2026-11-08.json).

1. Üç fact tablosunda kaynak paketi zorunlu yabancı anahtardır. Ömür doğrulayıcısı
   fact süresinin kaynak paketi süresini aşmasını reddeder. Yalnız policy.until
   değerini üç yıl yapmak bu nedenle çalışmaz.
2. `inspect_dataset_storage` makbuzu kaynak manifest'inden okur; paket ve katkıda
   bulunan bütün sayfaların hâlâ güncel olmasını ister. Üç yıllık raporun tarihsel
   okuması, bu canlı kaynak readback'iyle aynı kabul koşulu olamaz. Yeni kaynak
   kabulünde tam doğrulama sürmelidir; sonradan hamın bitmesi geçmişteki başarılı
   doğrulamayı otomatik başarısızlığa çevirmemelidir.
3. `guard_dataset_evidence` bağlı fact varken sayfa/paket temizliğini durdurur.
   Bu mevcut koruma korunur; ancak bağımsız kalıcı rapor kanıtı kabul edildikten
   sonra normal kaynak temizliğinin ilerleyebileceği protokol gerekir. Guard'ı
   kaldırmak, TTL uzatmak veya hamı ikinci kopyada saklamak çözüm değildir.
4. Product mapping ve FX bağları, raporun gerekli tarihsel kimlik/kur bağlamını
   korumalıdır. Bugünkü doğrulayıcı, kaynak kuralı ve sayfalarına bağlı mapping
   state'i yeniden denetler. Tarihsel rapor anlamı, yeni yazım için gereken taze
   mapping yetkisiyle karıştırılamaz.
5. Mağaza silme fonksiyonu fact'leri kaynaklardan önce, installation'ın bütün
   nesilleri için kaldırır. Müşteri silme fonksiyonu bugün kaynak sayfaları ve
   paketleri üzerinden bağlı fact'leri bulur. Normal kaynak temizliği sonrası
   da müşteri kapsamının bulunabildiği kanıtlanmadan üç yıllık yol açılamaz.
6. Klaviyo satış fact'i tekil Ordered Product event grain'indedir. Onu sessizce
   günlük toplama çevirmek grain/rol/dedup değişikliğidir. Event/order kimliklerinin
   rapor gerekliliği ve silme bağı ayrıca sınıflandırılmalıdır. Günlük sayılar da
   kendiliğinden anonim veri veya Shopify şartlarından muaf veri sayılmaz.

## Uygulamada korunacak kabul koşulları

Mevcut beş tablo ailesi korunur. Raporun gereken kalıcı kanıtı için mevcut
provenance ve tarihsel bağlam alanlarının kullanımı değerlendirilir; yeni tablo
bu kararla onaylanmaz. Kimlik, sahiplik, sayı hassasiyeti, destek/eksik/sıfır,
source completeness ve mevcut Sales Role/Channel kanıt sınırları korunur.

Runtime/SQL değişikliği hazırlanırken normal kaynak süresi dolmadan önce
doğrulanmış rapor kaydının kalıcı kanıtının nasıl tutulduğu, hangi alanların
üç yıllık sınıfa girdiği ve silme adresinin nasıl kaldığı birlikte somutlaştırılır.
Yalnız seçilmiş rapor verisi ve gerekli bağlam kabul edilir. Tam ham gövde,
arbitrary JSON, müşteri profili veya gereksiz tekil ayrıntı bu sınıfa gizlenemez.

İzole davranış kanıtı en az şunları kapsamalıdır: normal kaynak temizliği sonrası
aynı rapor değerleri ve kapsam; yanlış sahip/bozuk kanıt reddi; immutable üç yıllık
ömrün tekrar yazımla uzamaması; zorunlu mağaza ve müşteri silmesi; ilgisiz mağazanın
korunması; gerekli tarihsel mapping/FX sürümünün bulunması. Ham expire olduktan
sonra rapor okuması, yeniden provider sorgusu veya otomatik OAuth adımı başlatamaz.

## Bu teslimin durumu

Karar, alan sınıflandırma sınırı ve mevcut bağımlılıklar kayıt altına alınmıştır.
Runtime, migration, worker, saklama süresi ve canlı ayar değiştirilmemiştir.
Üç yıllık davranış uygulanmış veya SQL ile kabul edilmiş değildir. Önceki
PR #347'nin sentetik PostgreSQL kanıtı mevcut kaynak bağı/pin/silme davranışına
aittir; bu yeni ömür ayrımını test etmiş sayılmaz. EO-05-B hâlâ açıktır.

Kur kaynağı/rapor para birimi kabulü, EO-05-C/D tüketim/düzeltme, 18/22 native
kanıtları ve mevcut teslim/yedek ertelemeleri kendi yerinde kalır. Provider çağrısı,
OAuth/UI değişikliği, yeni paket, canlı DB/config, merge veya deploy yoktur.

Resmî kontrol: 8 Kasım 2026. [PostgreSQL 17 foreign keys](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK),
[tarih/saat işlemleri](https://www.postgresql.org/docs/17/functions-datetime.html),
[Supabase değişiklikleri](https://supabase.com/changelog),
[Shopify API şartları, bölüm 6](https://www.shopify.com/legal/api-terms),
[korunan veri gereklilikleri](https://shopify.dev/docs/apps/launch/protected-customer-data#requirements),
[zorunlu gizlilik bildirimleri](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).
Shopify üç yıllık hazır bir izin vermez; gerekli amaç ve veri minimizasyonu gerekir.
Uygulama kaldırıldığında API şartlarındaki 30 gün kaldırmadan başlar; 48 saat,
shop/redact gönderim zamanıdır. Bu kayıt yasal istisna uydurmaz ve eski kayıtlı
gizlilik sürelerini gevşetmez.
