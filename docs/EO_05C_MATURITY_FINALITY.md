# EO-05-C — günün olgunluk ve kesinleşme kaydı

10 Kasım 2026. Ürün sahibi açıkladığımız üç işi kapsayan kod, gerekli SQL
hazırlığı, izole test ve tek PR için “Tamam onaylıyorum Codex” dedi.
Bu mevcut EO-05-C paketidir. [Makine sözleşmesi](../contracts/eo-05c-maturity-v1.json)
somut kapsamı ve sınırları kaydeder. Canlı DB/provider/config/yayın ve merge ayrı
onaylıdır; bu teslim bunları çalıştırmaz.

## Kullanıcıya yansıyacak anlam

Bir günün verisi ilk başarılı aktarımda raporda kullanılabilir. Daha sonra aynı
günün 3 satışı5 olursa güncel değer5 olmalıdır;3+5 yapılmaz. Kesinleşme bu
güncellemeyi bekletmez. Değerin kontrollü devralınması, tüketim makbuzu ve
checkpoint EO-05-D'dedir; bu PR fact değerini değiştirmez.

EO-05-C yalnız o günün değişmeye açık olup olmadığını, hangi doğrulanmış ayara
ve son kontrole dayanarak değerlendirdiğimizi kaydeder. Durumlar:

- `unknown`: Gerçek ayar veya gerekli kanıt bilinmiyor. Varsayılan süre tahmin edilmez.
- `provisional`: Ayar bilinse de pencere veya başarılı son kontrol tamamlanmadı.
- `final`: Mevcut AdsTable olgunluk politikası için gerekli son kontrol doğrulandı.

`final`, platformun gelecekte hiçbir düzeltme yapamayacağı garantisi değildir.
Gözlenen ayar değişirse eski kesinleşme yeniden değerlendirmeye açılır. Bugün/dün
saatlik, daha eski kesinleşmemiş günler günlük takip edilir; bu PR zamanlayıcıyı
etkinleştirmez. PR #353'te kaydedilen birleşik kapasite hesabı bu ek okuma,
şifreleme/readback ve manifest/ham kanıt sürümlerini kapsar.

## 1. Ayar ile kaynak kanıtının bağı

Mevcut `createRefreshPdSourceReader({nativeMetadata:true})` akışı kullanılır.
Gerçek reader'ın private WeakMap kaydı yoksa kopyalanmış JSON, sahte doğrulama
bayrağı veya istemci kimliği kabul edilmez. Mağaza/workspace/kurulum/nesil/
provider/bağlantı/sürüm/credential/hesap/seçim birlikte eşleşir. Aynı gözlem yalnız
bir kez yakalanabilir; sonuç belirsizse yeni attempt ile otomatik tekrar edilmez.

Google'ın mevcut opt-in account ve conversion-action okuyucusu önce/sonra
gözlemlerini korur. Aynı sorguya yalnız `conversion_action.status` eklenir;
aktif olmayan action pencereyi büyütmez. Kimlik/kategori/model/counting ve
click/view günleri doğrulanır. Boş action listesi sıfır günlük pencere değildir.
Reporting Account veya conversion-owner hesabı değiştirilmez.

Meta'da mevcut opt-in unified-attribution/impression-date okumasındaki gerçek
Ad ayar etiketleri kullanılır; bilinmeyen etiketler tahmin edilmez. Mevcut ham
dataset okuyucusunun `existing_native_defaults` parametreleri bu opt-in okuma
ile aynı sayılmaz. Bu nedenle mevcut default ham Meta zarfları sırf ayar
okundu diye kesinleştirilemez; raporun aynı atıf/zaman parametrelerine dayandığı
kanıtlanmadıkça `provisional` kalır. Kaynak sorgu semantiği sessizce değiştirilmez.

Klaviyo'nun önceki5 günlük email varsayılanı karşılaştırma referansı olarak
kalır; hesap ayarı gözlenmiş değildir. Olgunluk politikasında `unknown` üretilir.
Yeni Settings alanı, OAuth adımı veya kullanıcı adına platform ayarı yoktur.

Native ayarın izinli alanları mevcut source cipher ile AEAD altında tek kaynak
sayfasına yazılır; kaynak makbuzu, sayfa hash'i, şifre çözme ve tekrar makbuz
eşitliği doğrulanır. Layer `collector_projection`, fidelity `decoded_only`'dir;
bu, orijinal HTTP byte veya finansal sayı hassasiyeti iddiası değildir. Manifest
yalnız türetilmiş politika, zaman, fingerprint ve kaynak referansını taşır.
Google/Meta sorgusunun başarılı olması tarihsel ayar sürekliliği kanıtı sayılmaz.

## 2. Takvim ve son kontrol kararı

Bağlayıcı mevcut kural: kaynak gününün bitişi + doğrulanmış etkin atıf penceresi
+ sağlayıcının saat diliminde bir tam gün + sonrasında başarılı kontrol.
Örneğin1 Kasım ve7 günlük pencere için UTC sınırı10 Kasım00:00'dır. Yaz/kış
saati nedeniyle bütün günler24 saat kabul edilmez; mevcut IANA gün hesaplayıcısı
kullanılır. Google'da aktif conversion-action click/view pencerelerinin, Meta'da
desteklenen gerçek Ad etiketlerinin maksimumu alınır.7/28/5 global sabit değildir.

Saatin geçmesi tek başına `final` üretmez. Son okuma sınırdan sonra başlamalı,
karar anından önce bitmeli; sabit aile kapsamı tam, sahiplik/ayar/paranın zaman
anlamı tutarlı, tüm kaynak sayfaları mevcut ve doğrulanmış olmalıdır. Gerçek rapor
yazım makbuzu veya kalıcı boş sonuç makbuzu da tekrar doğrulanır. Kaynak makbuzu
tek başına tüketim veya kesinleşme makbuzu değildir. Partial/held/hata/kota
kesintisi kesinleşmeyi ilerletmez. Mevcut raporda olmayan yeni değer, eski rapor
makbuzu kullanılarak kesinleştirilemez.

Karar yazılırken yapılandırma gözlemi en çok60 saniyelik olmalıdır. Okuyucu
karar kaydının kaynaklarını ve en yeni kayıtlı ayar fingerprint'ini yeniden
kontrol eder; farklı ayarda eski `final` göstermez. Bu, sınırlandırılmış bir
read/sonraki CAS yazımıdır; bütün geçmişi topluca yeniden yazan bir tarama değildir.
`inspectionOnly` görünümü saklı makbuzun değiştiği anlamına gelmez; özgün digest
ayrıca korunur ve görünümün digest'i yeniden hesaplanır.

## 3. Kalıcı kayıt ve SQL sınırı

Yeni Dataset tablosu yoktur. Mevcut source manifest'lerinde:

- Şifreli ayar paketinde `maturityConfiguration` kaydı bulunur.
- Günün kaynak anchor paketinde tek `maturityHead` ve CAS revision tutulur.
- Ayar paketinde en fazla200 işlemlik `maturityDecisions` denetim kaydı tutulur.

Manifest1 MiB, karar kaynakları en fazla3 paket/300 sayfa, SQL deadline en fazla
120 saniyedir. Güncel owner kontrolü, hesap bazlı transaction lock'u ve sıralı
kaynak satır kilitleri birlikte kullanılır. Revision uyuşmazlığı veya aynı
operationId'nin tekrarı reddedilir. Config ve head değişikliği tek SQL işlemidir.
Yazım cevabı kaybolursa otomatik inspect/retry/reset yoktur; bilinen başarıdan
sonra readback yapılır. Dar fonksiyonlara public/anon/authenticated/service_role/
runtime/coordinator EXECUTE verilmez. Canlı role extension bu PR'da kurulmaz.

Kaynak ve rapor üç yıllık senkron politikaya bağlıysa gerekli ayar kanıtı mevcut
`hold_report_source_batch` ile aynı sabit son tarihe bağlanır. Salt okuma ömrü
uzatmaz. Bağlı olmayan kaynak için açık sonlu politika gerekir. Mevcut zorunlu
silme kaynak paketini kaldırınca içindeki olgunluk kaydı da gider; sayfa silinmiş,
expired veya privacy-redacted ise kesinleşme okuması başarısız olur. Başka bir
customer/PII tablosu veya yeni dış arşiv oluşturulmaz.

## Sınama ve teslim

Unit kontroller Google action durumu, Meta etiketleri, Klaviyo bilinmeyen ayarı,
boş/eksik/çelişkili veri, DST, kopya/stale/yanlış sahipli gözlem, tek kullanım,
şifre/hash/scope bozulması ve kayıp yazım cevabını kapsar. Gerçek reader ve source
cipher çalışır; native HTTP ve test hesabı/credential sentetiktir.

`tools/eo05c-maturity-probe.mjs`, mevcut F01 localhost/CI rollback işleminin
içinde gerçek SQL, şifreleme/readback, ayar kaydı, rapor/boş makbuz, CAS, ayar
değişimi, silme ve ACL sınamalarını yürütür. Hazırlanan migration F01'in sonradan
uygulanan prepared listesine girer; tarihsel82 migration kabulü yeniden yazılmaz.
Bu izole sınama gerçek provider veya canlı DB kabulü değildir.

Zorunlu tam testler, iki anayasa guard'ı, typecheck/build, mevcut F01 aşamaları,
exact uzak içerik doğrulaması ve ayrı merge onayı gerekir. Native kanıt kapıları,
EO-05-D güncelleme/tüketim/checkpoint ve EO-06 formüller/güncel sentetik set korunur.

Resmî kontrol10 Kasım2026: [Google conversion actions](https://developers.google.com/google-ads/api/docs/conversions/getting-started),
[Google v25 alanları](https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionAction),
[Meta resmî SDK](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/adsinsights.py),
[Klaviyo attribution](https://help.klaviyo.com/hc/en-us/articles/11118357030555),
[Klaviyo Reporting API](https://developers.klaviyo.com/en/reference/reporting_api_overview),
[PostgreSQL zaman](https://www.postgresql.org/docs/17/functions-datetime.html),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[changelog](https://supabase.com/changelog). Meta developer sayfası doğrudan
okunamadı; SDK alanları native hesap/operasyon davranışının kabulü yerine geçmez.
