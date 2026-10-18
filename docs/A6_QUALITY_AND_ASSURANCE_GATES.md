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

## 2. Paket sonu delta bütünlük kapısı

EO-05, EO-06, EO-07 ve EO-08 sonunda A6-TECH-01 baseline'ına karşı kısa delta
denetimi çalışır. Yeni paket önceki güvenlik, veri doğruluğu veya mimari
kararları bozmuşsa bir sonraki paket başlamaz.

## 3. A6-DOCS-01 — Türkçe dokümantasyon standardizasyonu

A6-TECH-01 bulguları kapandıktan sonra ve EO-05 başlamadan önce aktif insan
okuyucu `.md` belgeleri Türkçeleştirilir. API field'ları, code symbol'leri,
provider entity adları, resmî hata kodları, JSON machine contract'ları ve
immutable evidence içerikleri çevrilmez. Kabul edilmiş semantik değiştirilmez.

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
