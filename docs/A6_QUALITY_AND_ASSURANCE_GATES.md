# AdsTable mühendislik bütünlüğü ve review güvence kapıları

**Karar tarihi:** 18 Ekim 2026
**Durum:** Ürün sahibi tarafından kabul edilen bağlayıcı iş sırası

## 1. A6-TECH-01 — Uçtan uca proje bütünlüğü denetimi

Bu çalışma review hazırlığı değildir. EO-04 kapandıktan hemen sonra ve EO-05
başlamadan önce, EO-01–04 arasında oluşan bütün teknik yapının sağlamlığını
kanıtlar. Kapsamı:

- tüm application/runtime kodu, dependency ve test mimarisi;
- Shopify embedded yapı, session, installation, auth ve UI anayasası;
- provider adapter, attribution, Channel, Medium, Sales Role ve hata sınırları;
- Supabase migration-live schema drift, RLS, grants, functions, indexes,
  Advisors, backup/restore ve environment isolation;
- Vercel Production/Preview/Development ayrımı, environment, callback,
  deployment provenance, runtime, log, rollback ve uçtan uca akış;
- GitHub branch, PR, CI, commit lineage, local-only ve teslim bütünlüğü;
- yarım, kullanılmayan, çelişkili veya eski varsayım taşıyan kod;
- güvenlik, veri kaybı, idempotency, pagination ve first-error davranışı.

Denetim yalnız testlerin geçmesine bakmaz; yanlış davranışın yanlış testlerle
korunup korunmadığını da inceler. Bulgular P0–P3 olarak yazılır. P0/P1 ve veri
doğruluğu, güvenlik veya review sonucunu etkileyen P2 kapanmadan EO-05 başlamaz.

Çıktılar: denetim planı, kontrol matrisi, kanıt bağlantıları, bulgu kaydı,
düzeltme/retest sonucu ve denetlenmiş baseline commit.

18 Ekim 2026 ilk denetim sonucu
`docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md` ve
`contracts/a6-tech-01-engineering-integrity-audit-v1.json` içinde
kaydedilmiştir. P0 bulunmamış; üç P1 ve EO-05'i engelleyen beş P2 tespit
edilmiştir. Bu kayıt PASS değildir. Aktif kapı kritik düzeltme ve yeniden testtir.

## 2. Paket sonu delta bütünlük kapısı

18 Ekim 2026 genel kapanış kabulüyle A6-TECH-01 **PASS** oldu. İlk denetimin
yukarıdaki açık bulgu sayıları tarihseldir. Kabul edilmiş baseline
`bd243fff7200ae6bdb3900ebb7417b3beba53010`; kapanış ve sınırlar
`docs/evidence/A6_TECH_01_CLOSURE_2026-10-18.json` içindedir.
Aktif sonraki kapı A6-DOCS-01'dir; başlamış veya bitmiş sayılmaz. F10 açık
ertelemedir; EO-05–08 ve final assurance/review sırası değişmez.

EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 baseline'ına karşı kısa delta
denetimi çalışır. Yeni paket önceki güvenlik, veri doğruluğu veya mimari
kararları bozmuşsa bir sonraki paket başlamaz.

## 3. A6-DOCS-01 — Türkçe dokümantasyon standardizasyonu

A6-TECH-01 bulguları kapandıktan sonra ve EO-05 başlamadan önce aktif insan
okuyucu `.md` belgeleri Türkçeleştirilir. API field'ları, code symbol'leri,
provider entity adları, resmî hata kodları, JSON machine contract'ları ve
immutable evidence içerikleri çevrilmez. Kabul edilmiş semantik değiştirilmez.

### A6-DOCS-01 çalışma standardı — 19 Ekim 2026

Ürün sahibi pakete başlanmasını onayladı. Çalışma sözleşmesi ve tam envanter:
`contracts/a6-docs-01-turkish-standardization-v1.json`.

**İş sonucu:** İnsan okuyucu, kabul edilmiş kararları alt paket geçmişini yeniden
kurmadan Türkçe anlayabilmeli. Bu paket yeni ürün kararı veya kod düzeltmesi değildir.

- README ile `docs` altındaki insan-okuyucu Markdown belgeleri kapsamda.
  `AGENTS.md` makine/ajan çalışma talimatıdır; bu dil geçişinde değiştirilmez.
- Önce iş sonucu, sonra normal akış, hata yolları, yetki/veri sınırı ve kabul
  anlatılır. Teknik terim ilk kullanımda Türkçe açıklanır; gereksiz İngilizce
  cümle ve başlık bırakılmaz.
- `Channel`, `Sales Role`, `Medium`, sağlayıcı varlık adları, API alanları,
  durum kodları, paket kimlikleri, komutlar ve dosya yolları teknik kimliktir.
  Anlamları açıklanır; kod içindeki karşılıkları yeniden adlandırılmaz.
- Kapanmış paketin kitap bölümü o paketin kabul edildiği tarihteki kapsamıdır.
  Tarihsel durum bugünkü proje durumu gibi sunulmaz; güncel sıra Execution Plan'dadır.
- JSON sözleşmeler, değişmez kabul kanıtları, migration'lar ve kod çevrilmez.
  Yalnız bu paketin çalışma durumu ve kapsam kaydı için gereken metadata eklenir.
- Dil düzenlemesinde tasarım çelişkisi görülürse kayda alınır; otomatik olarak
  iş kuralı değiştirilmez, yeni provider davranışı veya izin varsayılmaz.
- İlk geçiş README ile EO-01/02/03 analiz kitaplarıdır. Diğer belgeler envanterde
  bekler; bu geçişin tamamlanması A6-DOCS-01'in tamamlandığı anlamına gelmez.
- Her teslimde dil ve teknik kimlik kontrolleri, mevcut repository testleri ve
  zorunlu GitHub CI geçer. Merge ayrı açık onay ister. EO-05 açılmaz.

### Dil geçişinin ilerleme kaydı — 19 Ekim 2026

İlk dört belge ürün sahibi tarafından okunabilir bulundu ve PR #120 kullanıcı
tarafından merge edildi. Bu kabul yalnız o dört belgeye aittir; bütün paketin
kabulü değildir. İkinci teslim EO-01'in üç alt belgesi ile EO-02'nin veri temeli,
kurulum yetkisi ve kurulu mağaza düzeltmesinin üç belgesidir. Altı belge kabul,
diğer 52 belge dil incelemesi bekler.

Tarihsel ekran metinleri birebir teknik arayüz sözleşmesidir; İngilizce özgün
değerleri korunur, açıklama dili Türkçedir. Bu çalışma arayüz çevirisi yapmaz.
Supabase rehberi doğrultusunda nesne erişimi ile RLS'nin satır erişimi ayrımı
korundu; yeni veritabanı sorgusu, şema değişikliği veya canlı test yapılmadı.

Ürün sahibinin sonraki açık kabulüyle PR #121 de merge edildi. Güncel dil envanteri
10 kabul edilmiş belgedir. EO-02'nin faturalandırma, oturum köprüsü, gizlilik,
kalıcı silme işçisi ve canlı kabul kılavuzunun 5 belgesi üçüncü teslimde kabul
bekler; diğer 47 belge dil incelemesi bekler. Önceki ara sayımlar tarihseldir.
Hazırlık durumları bugünkü açık işler gibi gösterilmez; nihai kabul kaydına yönlendirilir.
Supabase rehberi yalnız güvenlik terimlerinin anlamını korumak için kullanılmıştır;
canlı veritabanı veya sağlayıcı işlemi yapılmamıştır. Bu teslim paket kapanışı değildir.

Üçüncü teslim PR #122 ile açık ürün sahibi onayıyla merge edildi. Güncel kabul
sayısı 15'tir. Dördüncü teslimdeki EO-03-A/B/C/D belgeleri okunabilirlik kabulü,
diğer 43 belge dil incelemesi bekler. Önceki sayımlar tarihseldir. OAuth işlemi
ile canlı yetkilendirme, hesap bağlantısı ile raporlama yetkisi ve Disconnect
ile gizlilik silmesi arasındaki ayrımlar korunur. Anahtar örneği yer tutucudur;
gerçek değer eklenmez. Bu teslim yeni provider, veritabanı veya deploy işlemi
ve paket kapanışı yetkilendirmez.

## 4. A6-ASSURE-01 — Pre-Review Assurance Programı

EO-08 sonrasında çalışır. İlk kez kod sağlamlığı arayan denetim değildir;
A6-TECH-01 ve paket sonu delta kapılarıyla denetlenmiş ürünün Shopify ve provider
review başvurularına hazır olduğunu doğrular.

Kapılar: Shopify compliance, code lineage, GitHub teslim durumu, Supabase,
Vercel, üç provider, veri bütünlüğü, analist/kullanıcı deneyimi ve fresh
browser→API→data→response akışı. Review sonucunu etkileyen açık P0/P1/P2 varken
PASS verilemez ve sessiz istisna üretilemez.

**Bağlayıcı sınır:** EO-04 kapanışı A6-ASSURE-01'in tamamlandığı anlamına gelmez.
EO-04 yalnız bu programa temiz ve denetlenebilir girdi sağlar. Hiçbir nihai
review başvurusu A6-ASSURE-01 PASS ve ürün sahibi GO kararı olmadan yapılamaz.

## 5. Bağlayıcı sıra

1. EO-04 kapanışı
2. A6-TECH-01 denetimi
3. Kritik bulguların düzeltme ve retest'i
4. A6-DOCS-01
5. EO-05–08 ve her paket sonunda delta bütünlük kapısı
6. A6-ASSURE-01
7. Ürün sahibi GO/NO-GO
8. Shopify/provider review başvuruları
9. Shopify onayı ve gerçek mağaza pilotu
10. EO-09 cutover

Bu karar repository kodu dışında Supabase, Vercel, GitHub, Shopify veya provider
mutation'ı yetkilendirmez. Her dış sistem denetimi başlarken güncel resmî
dokümantasyon ve exact erişim ayrı doğrulanır.
