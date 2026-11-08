# EO-05-B — rapor ve bağlı ham kanıtın üç yıl birlikte saklanması

8 Kasım 2026. Ürün sahibi önce üç yıllık rapor geçmişini kabul etti; ardından
“Codex bence senkron tutalım, ayırma başlı başına bir karmaşa getirecek” kararıyla
rapor ile kaynak ömrünün ayrılmasını isteyen henüz birleştirilmemiş öneriyi
kaldırdı. Bu belgede geçerli karar senkron saklamadır. Önceki taslak ve onay
[PR #348'in önceki commit'inde](https://github.com/fyilanli-oss/ads-table-embedded/commit/006cbfca7ebb65c847d5818d13f748ae0e928b39)
tarihsel olarak korunur. Aynı EO-05-B / Ayrıntılı kontrol listesi 23; yeni paket yoktur.

## Kabul edilen saklama modeli

| Veri sınıfı | Normal saklama |
|---|---|
| Gerekli seçilmiş rapor verisi | Verinin ait olduğu tarihten itibaren üç yıl |
| Bu rapora gerekli, mevcut onaylı ham zarflar ve sayfalar | Bağlı raporun üç yıllık ömrünü destekleyecek süre |
| Bu kaynakların makbuzu, kanıt metaverisi ve gerekli kimlik/eşleme/kur/sürüm bağı | Bağlı rapor boyunca korunur |
| Rapora bağlı olmayan kaynak ve metaveri | Mevcut 90/365 günlük varsayılan politika |

Rapor kaydı dururken ona gerekli ham sayfa, paket veya makbuz normal temizlikle
kaldırılmaz. Mevcut yabancı anahtarlar, kaynak readback ve kanıt pin koruması
kullanılır. Kaynak ile raporu ayıran yeni arşiv/kanıt protokolü kurulmaz. Aynı
ham gövdenin ikinci kopyası üretilmez; yeni sorgu veya müşteri alanı eklenmez.

Bu karar, rapora bağlı kaynak sınıfı için önceki kısa kaynak/metaveri ömrünü
üç yıllık düzene taşır. Bütün kaynak tablolarının bütün kayıtları otomatik olarak
üç yıla çevrilmez. Gerekli kaynak ve destek bağları, bağlı raporun bitişinden önce
sona eremez; birden fazla geçerli bağımlılık varsa son gerekli rapor bitişi dikkate
alınır. Raporun kendi sabit ömrü yeniden okuma/tekrar/düzeltme ile uzatılmaz.

Üç yılın başlangıcı indirme/yazma zamanı değil native iş günü veya olayın ilgili
iş günüdür. Tarih/saat dilimi eksikse ömür uydurulmaz. Yıl dönümü, artık gün ve
saat dilimi davranışı uygulamada açık sınır testleriyle doğrulanır. Bu karar
UI tarih filtresini veya tek sorgunun tarih aralığını değiştirmez.

## Veri ve silme sınırı

Yalnız mevcut onaylı sorgu/projection alanları ve gerekli rapor bilgileri tutulur.
Arbitrary JSON, tam filtrelenmemiş HTTP gövdesi, yeni müşteri profili veya gereksiz
kişisel alan bu kararın kapsamında değildir. Klaviyo Ordered Product satışının
tekil event grain'i, mevcut native kimlik/rol/dedup davranışı korunur; sessizce
günlük toplam veya anonim veri diye yeniden sınıflandırılmaz.

Doğrulanmış zorunlu mağaza silmesi, ilgili ham kaynak, rapor, eşleme ve kanıt
katmanlarını üç yıl beklemeden kapsar. Müşteri kapsamlı silme, mevcut gerçek sipariş/
olay bağları üzerinden ilgili kayıtları bulmalıdır. Kaynağı birlikte tutmak tek
başına bu bağın doğruluğunu kanıtlamaz; kapsam bilinmiyorsa işlem tamamlandı denmez.
Başka mağazaların kayıtları ve ortak bağımsız kur kaynağı körlemesine silinmez.
Mevcut worker, kapsam/HMAC doğrulaması ve yeniden yazmayı engelleyen kayıtlar korunur.

Normal süre dolumunda önce silinmeye uygun rapor kayıtları, ardından artık gerekli
olmayan kaynak ve destek kayıtları temizlenir. Diğer saklanan bağımlılıklar ile
mevcut consumer/partial/unknown kontrolleri erken temizliği engellemeye devam eder.
Üç yıl zorunlu silmeye karşı bir saklama hakkı oluşturmaz.

## Mevcut kodun bu modele uyumu

İnceleme tabanı PR #347 main commit'i 009570183f7cfd4a7781a61dc2d1ecd1e599f07f.
[Exact blob/anchor incelemesi](evidence/EO05B_REPORT_RETENTION_DEPENDENCIES_2026-11-08.json)
kaynak FK'sını, fact ömrünün kaynak ömrünü aşamamasını, makbuzun kaynak manifest'inde
olmasını, kaynak pin'ini, mapping/FX bağlarını ve silme sırasını gösterir.

Bu bağları ayırmak yerine, gerekli kaynaklar ile rapora aynı sürümlü saklama
politikasının uygulanması gerekir. Yalnız fact.policy.until değerini büyütmek
çalışmaz; kaynak sayfası/paketi/makbuzu ve gerekli destek bağlarının ömrü de birlikte
uyumlandırılmalıdır. Yeni kaynak kabulündeki sahiplik, AEAD/hash, makbuz, sorgu kapsamı,
expiry ve mapping doğrulamaları gevşetilmez. Mevcut beş tablo ailesi korunur.

Uygulama kabulü aynı üç yıllık süre sınırını bütün gerekli bağlı kayıtlarda, eski
90/365 günün rapor kaynağına yanlış uygulanmamasını, sürenin tekrar ile uzamamasını,
erken temizliğin engellenmesini ve zorunlu silmenin iki katmanda da çalışmasını
izole testlerle doğrulamalıdır. Mevcut rol/Channel/native kanıt sınırları korunur.

## Bu teslimin durumu

Bu PR karar ve statik uyumluluk kaydıdır. Runtime, SQL migration, worker, saklama
ayarları ve canlı ortam değişmedi. Üç yıllık saklama henüz uygulanmış veya SQL ile
kabul edilmiş değildir. Önceki PR #347 sentetik PostgreSQL kanıtı mevcut bağ/pin/
silme davranışını doğrular; yeni süre politikasını doğrulamış sayılmaz.

Veri maliyeti ve Supabase kapasite değerlendirmesi ürün sahibinin isteğiyle
veritabanı işi sonrasına bırakıldı. Bu teslimde benchmark, yeni altyapı veya arşiv
kurulmaz. Kur kaynağı/rapor para birimi kabulü, EO-05-C/D tüketim/düzeltme, 18/22
native kanıtları ve mevcut teslim/yedek ertelemeleri kendi yerindedir. Canlı
provider/DB/config, OAuth/UI, merge veya deploy yetkisi yoktur. EO-05-B açıktır.

Resmî kontrol: 8 Kasım 2026. [PostgreSQL 17 foreign keys](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK),
[tarih/saat işlemleri](https://www.postgresql.org/docs/17/functions-datetime.html),
[Supabase değişiklikleri](https://supabase.com/changelog),
[Shopify API şartları, bölüm 6](https://www.shopify.com/legal/api-terms),
[korunan veri gereklilikleri](https://shopify.dev/docs/apps/launch/protected-customer-data#requirements),
[gizlilik bildirimleri](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).
Shopify üç yıllık genel izin vermez; gerekli amaç ve veri minimizasyonu gerekir.
Kaldırma sonrası 30 gün API sözleşmesinde kaldırmadan başlar; 48 saat shop/redact
bildiriminin gönderim zamanıdır. Zorunlu silme süresi bu kararla uzatılmaz.
