# A6-TECH-01 mühendislik bütünlüğü denetimi

**Kontrol tarihi:** 18 Ekim 2026
**Denetlenen ürün referans sürümü:** `c3faddff97628f372f5cc843f3326fb38de95dfc`
**Durum:** PASS — ürün sahibi genel kapanış kabulü, 18 Ekim 2026
**PASS referans sürümü:** `bd243fff7200ae6bdb3900ebb7417b3beba53010`
**EO-05 kararı:** A6-DOCS-01 tamamlanana kadar kapalı

Güncel iş sırası `docs/EXECUTION_PLAN.md`, kabul edilmiş kapanış otoritesi ise
şu kayıttır:
`docs/evidence/A6_TECH_01_CLOSURE_2026-10-18.json`.
F01–F09 ve bağımlılık güvenlik bulgusu kapalı; açık P0/P1/P2 yoktur. F10 açık
P3 ertelemesidir. Gerçek Shopify Admin masaüstü/mobil kabulü ürün sahibi
bildirimidir; agent'ın doğrudan tarayıcı veya gerçek sağlayıcı testi değildir.
Sağlayıcı/kurtarma sınırları ve sonraki review kapıları aynen korunur. Aşağıdaki
ilk denetim ve ara düzeltme kayıtları tarihsel gelişimi gösterir; güncel karar
bu özet ve bölüm 8'in son kapanış kaydıdır.

## Okuma kuralı

İlk denetimde 0 P0, 3 P1, 5 engelleyici P2 ve 2 P3 kaydedildi. Son kabulde
F01–F09 ve sonradan bulunan güvenlik konusu kapandı; yalnız F10 açık P3 olarak
ertelendi. Aşağıdaki FAIL tabloları, “başlamadı” ve “PASS değil” ifadeleri
geçmiş aşamaları anlatır; kapatılmış işi yeniden açmaz. Bugünkü aktif iş
A6-DOCS-01'dir; EO-05 kapalıdır. Bu dil düzenlemesi yeni denetim, prova,
yedekleme, yükseltme veya canlı işlem yetkisi vermez.

Terimler: Runtime uygulamanın çalışan kodudur; migration sıralı veritabanı
değişikliği kaydıdır; transaction ya bütünüyle tamamlanan ya da geri alınan
işlem birimidir. Hash içerik parmak izidir; secret gizli kimlik bilgisidir.
Deployment belirli kaynak sürümünün dağıtımıdır; typecheck tip kontrolü,
build derleme, CI otomatik teslim kontrolleridir.

## Ara düzeltme durumu — tarihsel kayıt

**O aşamadaki düzeltme durumu:** F01–F09 ürün sahibi kabulüyle kapandı.
F09 teslimi için son CI, birleştirme ve temiz birincil çalışma kopyası eşliği zorunludur;
son eşlik kanıtı PR #112 üzerinde tutulur. F10 ürün sahibi kararıyla ayrı uyumluluk
çalışmasına bırakıldı; açık teknik borçtur, düzeltilmiş değildir. Genel denetim PASS değildir.
İlk denetim bulguları ve başlangıç sayıları aşağıda
tarihsel başlangıç kaydı olarak korunur; genel A6-TECH-01 henüz PASS değildir.

**İlk yeniden test (tarihsel) — 18 Ekim 2026:** `cddda0fad4803c9212412211495365c69ed2e884`
üzerinde 441 test, typecheck ve build geçti. Production bağımlılık taraması
uyarı bildirmedi; geliştirme/build bağımlılıklarını da içeren tarama ise dört
yüksek, üç orta, bir düşük güvenlik bildirimi üretti. Yeni `TECH01-RETEST-SEC01`
güvenlik değerlendirmesi açık olduğundan genel kapanış ve EO-05 başlangıcı yok.
Kanıt: `docs/evidence/A6_TECH_01_FINAL_RETEST_2026-10-18.json`.

## 1. İlk denetim ve ara değerlendirmeler — tarihsel kayıt

**Kapanıştan önceki ek kanıt — 18 Ekim 2026:** GitHub `main-protection` aktif ve yalnız `main`
hedefli; bypass boş, PR ve `governance` zorunlu, silme/force-push engelli.
Meta'nın iki resmî doküman metni ürün sahibinin paylaşımı üzerinden incelendi;
agent'ın başarısız HTTP erişimi bağımsız teyit gibi sunulmaz. İzin hatasının
yeniden bağlantıya çevrilmesi ve `80000/80004` kota kodlarının eksikliği için
onaylı dar kod/test düzeltmesi hazırdır; CI/kabul/birleştirme beklenir. Kanıt:
`docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json`.

Yukarıdaki ilk yeniden test ve aşağıdaki ilk denetim sayıları tarihseldir. Güncel
kritik F01–F09 ve repository bağımlılık güvenlik bulgusu kapalıdır. Bu Meta
düzeltmesinin teslimi sonrasında ayrı onaylı birebir sürüm/canlı kabul ve genel
kapanış kararı kalır. F10 ertelenmiştir; yeni yedek işi açılmaz, genel PASS veya
EO-05 başlangıcı verilmez.

Çalışan Production uygulamasında veri kaybı veya aktif servis kırılması
gözlenmemiştir. Repository test, typecheck ve build kapılarından geçmektedir.
Buna rağmen repository ile canlı altyapının birlikte yeniden üretilebilirliği,
secret yaşam döngüsü ve bazı güvenlik/review sınırları henüz kanıtlı değildir.

Denetimde P0 bulunmamıştır. Üç P1 ve güvenlik, veri doğruluğu, kapasite veya
review sonucunu etkileyen beş P2 açıktır. Bağlayıcı kalite sözleşmesi gereği bu
bulgular düzeltilip yeniden test edilmeden A6-TECH-01 PASS verilemez ve EO-05
başlayamaz.

Bu belge hiçbir Supabase, Vercel, GitHub, Shopify veya sağlayıcı değişikliğini
yetkilendirmez. Denetim sırasında canlı veri, kimlik bilgisi veya yapılandırma
değiştirilmemiştir.

## 2. İlk denetimin planı ve yöntemi — tarihsel kayıt

| Alan | Kontrol | Yöntem | Sonuç |
| --- | --- | --- | --- |
| Git ve teslim | Uzak `main`, görev branch'i, PR, CI, worktree, stash ve yalnız yerelde kalan envanteri | GitHub Connector ve salt okunur yerel Git | Bulgu var |
| Uygulama | Runtime, bağımlılık, test, typecheck ve build | Kaynak inceleme ve yerel doğrulama | Geçti; bulgu var |
| Shopify | Gömülü kimlik doğrulama, App Bridge, Polaris ve yapılandırma bütünlüğü | Resmî doküman ve kaynak inceleme | Bulgu var |
| Sağlayıcılar | Sözleşme, sürüm, hata ve veri sınırları | Resmî doküman, kod ve test karşılaştırması | Sınırlı geçti |
| Supabase | Migration, canlı şema, RLS, yetkiler, fonksiyonlar, indeks ve Advisor | Salt okunur üst veri ve Advisor kontrolleri | Kritik bulgu var |
| Vercel | Ortam, deployment kaynak geçmişi, runtime ve log | Salt okunur proje/deployment/log envanteri | Kritik bulgu var |
| Güvenlik | Secret izi, kimlik bilgisi sahipliği ve hata sızıntısı | Yalnız ad içeren envanter, kaynak/geçmiş taraması | Kritik bulgu var |
| Veri doğruluğu | Sağlayıcı gerçeği, gerçek sıfır/bilinmeyen ayrımı ve EO-04 devirleri | Sözleşme/test/runtime çapraz kontrolü | Mevcut EO-04 sınırları korundu |

## 3. İlk denetimin kontrol matrisi — tarihsel sonuçlar

| Kontrol | Durum | Kanıt özeti |
| --- | --- | --- |
| Görev worktree'si birebir uzak `main` referans sürümünde | PASS | Dal `codex/a6-tech-01-audit`; başlangıç ayrışması `0/0` |
| Açık PR | PASS | Açık PR bulunmadı; EO-04 kapanış PR'ı birleştirilmiş ve kontroller başarılı |
| Repository çalışma ağacı | PASS | Denetim başlamadan önce takip edilen/edilmeyen dosya değişikliği yoktu |
| Ürün testleri | PASS | Başlangıç sürümünde 384/384 test geçti |
| TypeScript kontrolü | PASS | `pnpm typecheck` başarılı |
| Production build | PASS | `pnpm build` başarılı; React Router v8 gelecek sürüm uyarıları ayrı teknik borç |
| Production bağımlılık güvenliği | PASS | `pnpm audit --prod` bilinen açık bildirmedi |
| Güncel Production runtime | PASS | Son deployment loglarında hata/uyarı yok |
| Supabase Security Advisor | PASS | Bulgu yok |
| Supabase RLS ve yalnız fonksiyon çalıştırma runtime sınırı | PASS | Özel tablolar forced RLS; runtime için doğrudan tablo yetkisi yok |
| Supabase migration/repository eşliği | FAIL | Canlı defter ve repository migration zinciri eşleşmiyor |
| Kimlik bilgisi sahiplik bütünlüğü | FAIL | Bir Google şifreli kimlik bilgisi kaydı aktif bağlantıya bağlı değil |
| Vercel ortam değişkeni adı envanter eşliği | FAIL | Canlı 22 Production adı; repository Vercel envanteri 18 ad |
| Production/Preview secret izolasyonu | PASS | Canlı girdiler yalnız Production hedefinde |
| Shopify Polaris URL tekliği | FAIL | İstemci RC URL'si ile sunucunun ön yükleme URL'si aynı sözleşmeye bağlanmamış |
| GitHub Actions bağımlılıkları değişmez sürüme sabitleme | FAIL | Bazı action'lar değişken ana sürüm etiketi kullanıyor |
| Production hata log güvenliği | FAIL | En üst SSR sınırı ham `Error` nesnesi yazabiliyor |
| Production deployment kaynak geçmişi | FAIL | Canlı deployment kaynak referansı `main` değil |
| Gizlilik tablolarının yabancı anahtar indeksleri | FAIL | İki eksik indeks Advisor tarafından raporlandı |
| Repository ve Git geçmişinde açık secret izi | PASS | Belirgin secret kalıbı bulunmadı; değerler rapora alınmadı |
| Sağlayıcı canlı kanıtlarının EO-04'e sınırları açık aktarımı | PASS | Açık Meta/Google/Klaviyo kanıt sınırları korunuyor |

## 4. Bulgular — kabul edilmiş kapanış ve tarihsel teşhis

### TECH01-F01 — P1 — Supabase migration zinciri yeniden üretilebilir değil

**Güncel düzeltme durumu — 18 Ekim 2026:** F01-A/B ve PR #101 tamamlandı.
Ürün sahibinin ayrı kapsam ve canlı uygulama onayından sonra devreden çıkarma bir kez
uygulandı. İlk 38 defter kaydı/SQL hash'i değişmedi; yeni gerçek sürüm
`20261018152910`. Canlı katalog yalnız beklenen fonksiyon/policy farklarını
taşıyor; bağlantı, kimlik bilgisi ve tarihsel satır parmak izleri aynı.
Security Advisor temiz. Kanıt:
`docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
Ürün sahibi F01 kapanışını ve PR #102'in birleştirilmesini 18 Ekim 2026'da onayladı.
Kapanış kanıtı `docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
Bu kabul diğer bulguları kapatmaz veya EO-05 başlangıcını yetkilendirmez.
Aşağıdaki bulgu metni denetim başlangıcındaki durumu açıklar.

**F01-A hazırlığı:** Ayrıntılı eşleme ve kapılar
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` içindedir. Repository hazırlığı
F01'i kapatmaz; temiz veritabanı provası ve ayrı canlı uygulama kapıları beklenir.

Repository 32 migration taşırken canlı migration defteri 38 kayıt taşır. Aynı
isimli 32 migration'ın sürüm kimlikleri eşleşmemektedir. Canlıda repository
`main` içinde bulunmayan altı eski yetkilendirme devri migration'ı ile bunların
tablo ve çalıştırılabilir fonksiyonları kalmıştır.

**İş etkisi:** Çalışan veritabanının yalnız repository'den güvenilir biçimde
yeniden kurulabileceği kanıtlanamaz. Geçmişte kabul edilmiş yeni bağlantı
mimarisi ile canlı çalıştırılabilir yüzey birlikte uyumsuzluk taşır.

**Kapatma kapısı:** Birebir tarihsel SQL kaynak geçmişi çıkarılmalı; mevcut defter
yeniden adlandırılmadan ve eski migration tekrar çalıştırılmadan geçmişi değiştirmeden ilerleyen
uzlaştırma tasarlanmalı; temiz geçici PostgreSQL üzerinde sıfırdan kurulum
ve canlı şema eşlik testi geçmelidir.

### TECH01-F02 — P1 — Sahipsiz şifreli Google kimlik bilgisi

**Güncel sonuç — 18 Ekim 2026:** PR #103 iki temiz PostgreSQL kurulumunda
F02 regresyonu ve governance/test/typecheck/build PASS sonrasında açık onayla
birleştirildi. Kullanıcı yalnız tek sahipsiz şifreli kaydın commit sonrası geri
getirilemeyeceğini açıkça kabul ederek canlı temizlemeyi ayrıca onayladı.
Kayıt tek transaction ve tek denemede silindi. Kilit altında ön koşullar ve
COMMIT öncesi son koşullar doğrulandı. Sahipsiz Google kimlik bilgisi 1 → 0,
toplam kimlik bilgisi 4 → 3. Diğer üç kimlik bilgisi, üç bağlantı ve sekiz geçmiş
satırının parmak izleri aynı; Security Advisor 0. Google yetki iptal çağrısı,
token çözme/dışa aktarma, şema/yetki veya platform yapılandırma değişikliği yok.

Kanıt: `docs/evidence/A6_TECH_01_F02_LIVE_CLEANUP_2026-10-18.json`.
Birebir transaction SQL'i aynı kanıt dizininde korunur; tekrar çalıştırma
yetkisi vermez ve aday artık bulunmadığından koruma kontrolüyle durur. Başlangıçtaki
geri alınabilir silme kapısı genel olarak gevşetilmedi: yalnız bu kayda ait
commit-sonrası geri dönüşsüzlük istisnası açıkça kabul edildi. Tam yedek
varmış gibi gösterilmez. Ürün sahibi 18 Ekim 2026'da F02 kapanışını ve PR #104
birleştirilmesini kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F02_CLOSURE_2026-10-18.json`.
F03 sıradadır; uygulaması başlamadı ve bu kabul yeni işlem yetkisi vermez.
Aşağıdaki teşhis/hazırlık notları önceki durumu açıklar.

**18 Ekim 2026 incelemesi:** Tek Google kalıntısının bağlantı ve yetkilendirme devri
referansı yok; aynı sahibi için süresi dolmamış OAuth işlemi de yok. Kayıt
11 Ekim 15:50:07 UTC'de oluşmuş. Yakın OAuth/yetkilendirme devri geçmişi
`SUPERSEDED_BY_NEW_AUTHORIZATION` ile sonlanmış. Kimlik bilgisi bağlantısı eskiden
boşaltıldığı için bu tarih eşliği doğrudan ID kaynak zinciri kanıtı değildir.

Eski `create_provider_authorization_handoff` fonksiyonunda somut hata bulundu:
`credential_id = null` güncellemesinden sonra `RETURNING handoff.credential_id`
yeni NULL değeri topluyor, dolayısıyla eski şifreli kayıt silinemiyordu. Bu fonksiyon
F01'de kaldırılmıştır. Güncel `stage_provider_account_selection` eski ID'yi
güncellemeden önce değişkende tutar ve aynı transaction içinde siler. Gerçek
PostgreSQL regresyon senaryosu mevcut izole runner'a eklenmiştir; CI geçmeden
bu yeni senaryo PASS sayılmaz. Uygulama veya tarihsel SQL değiştirilmedi.

Kanıt: `docs/evidence/A6_TECH_01_F02_DIAGNOSIS_2026-10-18.json`.
Canlı silme yetkisi yoktur. Kayıt hâlâ korunmaktadır. En son token kullanımını
gösteren ayrı denetim alanı bulunmadığından son kullanım zamanı iddia edilmez.
Commit öncesi geri alma mümkün; commit sonrası kaydı geri getirecek yedek bu
çalışmada oluşturulmadı. Bu sınır kabul edilmeden silme yapılmaz.

**Önerilen tek-kayıt temizleme sınırı (henüz yetkili değil):** Sağlayıcı,
oluşturma zamanı ve kimlik parmak iziyle tam bir aday bulunmalı. Kısa transaction
içinde kimlik bilgisi ve iki referans tablosu kilitlenip referans/devam eden işlem kontrolleri
yeniden yapılmalı; aday sayısı bir değilse veya referans oluşmuşsa durulmalı.
Yalnız bu şifreli kayıt silinmeli; üç bağlı kimlik bilgisi ve bağlantı/geçmiş
parmak izleri korunmalı. Kontrol başarısızsa COMMIT yapılmadan geri alınmalı.
Commit sonrasında yerel şifreli kayıt bu çalışma ile geri getirilemez; yeniden
OAuth gerekebilir. Google tarafında yetki iptali yapılması bu işlemin
parçası değildir. Bu sınırlı ve commit-sonrası geri alınamayan silme yolunun
kabulü, başlangıçtaki geri alınabilir silme kapısı için açık ürün sahibi kararı
gerektirir; mevcut kayıt bu kapıyı PASS yapmaz.

Regresyon yalnız bekleyen kimlik bilgisi değiştirme davranışını kanıtlar; süreç
çökmesi veya sessiz temizlik hatalarının bütün olasılıklarını çözdüğü iddia edilmez.

Canlı kimlik bilgisi envanterinde iki Google şifreli kaydı bulunmasına rağmen yalnız biri
mevcut kanonik bağlantı tarafından referanslanmaktadır. Diğeri geçerli anahtar
ailesiyle şifreli ve çözülebilir durumdadır.

**İş etkisi:** Gerekenden uzun secret saklama ve kimlik bilgisi saklama sorumluluğu belirsizliği.
Bu durum veri kaybı kanıtı değildir.

**Kapatma kapısı:** Sahiplik ve son kullanım kanıtı çıkarılmalı; geri alınabilir
silme planı ve geri alma açıkça kabul edilmeli; canlı silme yalnız ayrı ürün
sahibi onayıyla yapılmalıdır.

### TECH01-F03 — P1 — Vercel ortam envanter uyumsuzluğu

**18 Ekim repository düzeltmesi:** Güncel üst veri yalnız ad/target/type
alanlarıyla yeniden okundu: 22 Production, 0 Preview/Development. Eksik dört
Google adı `.env.example` ve secret sözleşmesine eklendi. Master 23 toplam /
22 Vercel / 1 iş akışı secret adıyla eşlendi; GitHub secret deposu yeniden
denetlenmiş sayılmaz. Sözleşmenin mantıksal saklama politikası ile gözlenen
fiilî tür ayrıldı: Vercel 17 Secret / 5 Config. Canlı yeniden sınıflandırma yok.
Negatif test, Google adı hem örnekten hem sözleşmeden çıkarılsa bile canlı
kayıtlı görünüm karşılaştırmasının bunu yakalamasını sağlar; eski `16` sabiti kaldırıldı.
Secret çözümleme/değer okuma, sağlayıcı/yapılandırma değişikliği veya dağıtım yapılmadı.
Kanıt `docs/evidence/A6_TECH_01_F03_ENV_INVENTORY_2026-10-18.json`.
Ürün sahibi F03 kapanışını ve PR #105'in birleştirilmesini 18 Ekim 2026'da onayladı.
Kanıt `docs/evidence/A6_TECH_01_F03_CLOSURE_2026-10-18.json`.
F04 başlamadı. Bu kabul genel secret saklama sorumluluğu/kurtarma açıklarını kapatmaz;
aşağıdaki metin başlangıç bulgusudur.

Canlı Vercel Production projesi 22 ortam değişkeni adı taşır. Repository secret
sözleşmesi 18 Vercel girdisi, ana sözleşme ise daha eski 16 toplam/11 Vercel
sayısını taşır. `.env.example` dört Google yalnız sunucuda kullanılan adı içermemektedir:
`GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`,
`GOOGLE_ADS_OAUTH_REDIRECT_URI` ve `GOOGLE_ADS_DEVELOPER_TOKEN`.

**İş etkisi:** Yeni ortam veya kurtarma işlemi eksik yapılandırma ile kurulabilir;
mevcut test eski sayıyı koruduğu için yanlış güven üretir.

**Kapatma kapısı:** Secret değeri okunmadan veya değiştirilmeden yalnız ad içeren
ortam değişkeni sözleşmesi, örnek dosya, ana kayıt ve test aynı otorite kabul edilen ad kümesi üzerinde
birleştirilmelidir.

### TECH01-F04 — P2 engelleyici — Shopify Polaris URL bütünlüğü

**Kapanış — 18 Ekim 2026:** Tek Polaris sabiti sunucu ve AppProvider'a verildi;
gerçek SDK Link ön yükleme/script eşliği ve negatif testler geçti. Test edilmiş
`3e665f647f1c815673b0d6ff05f7e70649d4c4e5` ayrı açık onayla mevcut Production
adresine dağıtıldı. Vercel `READY`, birebir commit ve alan adı eşlemesi doğrulandı.
Ürün sahibi gerçek Shopify Admin masaüstü ve mobil görünümünü normal buldu ve
PR #106'in birleştirilmesini onayladı. Kanıt:
`docs/evidence/A6_TECH_01_F04_CLOSURE_2026-10-18.json`.
F05 başlamaz; F07 sürüm kaynak geçmişi ve genel EO-05 engeli açık kalır.
Aşağıdaki brief ve teşhis uygulama öncesi tarihsel kayıttır.

#### F04 uygulama öncesi analist brief'i — 18 Ekim 2026

- Amaç: Tarayıcının ön yüklediği Polaris ile AppProvider'ın çalıştırdığı Polaris
  aynı kabul edilmiş RC adresi olsun; gereksiz/yanlış kod paketi ön yüklenmesin.
- Başlangıç: `publicConfig.polarisUrl` RC adresi, sunucu yapılandırması ise kütüphane
  varsayılanında. Başarı: iki değer tek sabitten gelir ve gerçek SDK yanıtının
  Link başlığı ile oluşturulan script adresi eşleşir.
- Görünür metinlerin korunması: hiçbir görünür metin, buton veya kullanıcı eylemi değişmez.
- Durum matrisi: yükleniyor, boş/bağlı değil, sürdür, bağlı, hata,
  yeniden yetkilendirme, iptal ve başarı akışları mevcut davranışı aynen korur;
  bu düzeltme yeni durum veya eylem eklemez. Kimlik doğrulama/OAuth/veritabanı/sağlayıcı
  çağrıları ve üç ürün URL'i değişmez.
- Bileşen eşlemesi: mevcut `AppProvider` / `polarisUrl` korunur; sunucu
  `shopifyApp({polarisUrl})` aynı sabiti alır. Sayfa, bölüm, form, modal,
  gezinme ve eylem bileşenleri/özellikleri değişmez. Yeni CSS/kontrol yok.
- Masaüstü/mobil beklenti: görünüm ve bilgi mimarisi aynı; mevcut RC sürümü ve
  `@shopify/polaris-types@2.0.0-rc.2` korunur, yükseltme veya stable sürüme alternatif geçiş yok.
- Resmî kaynak: `https://shopify.dev/docs/apps/build/app-home/polaris2` ve
  `https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning`.
  Kontrol tarihi 18 Ekim 2026; kurulu React Router adaptörü 3.0.1 destekliyor.
- Kabul: anayasa/test/typecheck/build/CI; tek kod paketi ve Link/script
  eşliği; ayrı onaylı birebir kaynaklı dağıtım sonrası gerçek Shopify Admin
  masaüstü ve en az 320 px gerçek mobil kontrolü, açık ürün sahibi kabulü.
- Kapsam dışı: yeni özellik, bağımlılık yükseltme, yeni uygulama/secret/yapılandırma,
  veritabanı/sağlayıcı değişikliği, kimlik doğrulama/veri değişikliği. O hazırlık anında dağıtım henüz yetkili değildi.
- Geri alma: uygulama kodundaki dar yapılandırma değişikliği geri alınabilir; dağıtım
  gerekirse ayrı onaylı önceki deployment'a dönüş uygulanır. Mevcut secret ve
  veritabanı değiştirilmez. Görsel kabul kanıtsız PASS yazılmaz.

`AppProvider` Polaris 2 RC URL'sini alırken sunucu `shopifyApp()` yapılandırması
aynı `polarisUrl` değerini almamaktadır. Kurulu kütüphanenin varsayılanı stable
URL'dir. Shopify'ın güncel talimatı React Router uygulamasında iki değerin aynı
olmasını zorunlu tutar.

**İş etkisi:** Yanlış kod paketi ön yüklemesi, performans ve review tutarsızlığı.

**Kapatma kapısı:** Tek sabit iki noktaya verilmeli; eşitlik testi, build ve ürün
sahibi masaüstü/mobil görsel kabulü geçmelidir.

### TECH01-F05 — P2 engelleyici — GitHub Actions değişmez pin eksikliği

**Kapanış — 18 Ekim 2026:** 425 test, typecheck ve build GitHub CI'da geçti
(koşu `39148707523`). Ürün sahibi PR #107'in birleştirilmesini ve F05 kapanışını kabul etti.
Kanıt: `docs/evidence/A6_TECH_01_F05_CLOSURE_2026-10-18.json`.
Shopify dağıtım iş akışı çalıştırılmadı; canlı ayar/secret/veritabanı değişmedi.
F06 başlamadı; aşağıdaki hazırlık ve teşhis tarihsel kayıt olarak korunur.

**Düzeltme hazırlığı — 18 Ekim 2026:** Dört değişken referans resmî repository
tag → commit eşliği doğrulanarak tam SHA'ya sabitlendi; mevcut ana sürümler
ve diğer iki action sabitlemesi korundu. Tüm iş akışı dosyalarını tarayan kontrol,
değişken/kısa/doğrulanmamış referansları negatif testlerle reddeder.
Kanıt: `docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json`.
Güncelleme yöntemi kontrollü manuel PR'dır: resmî sürüm/etiket ve commit yeniden
doğrulanır, SHA ve açıklama/kanıt birlikte güncellenir; CI ve açık ürün sahibi
birleştirme onayı gerekir. Otomatik birleştirme yoktur. İş akışı tetikleyicileri, izinleri,
girdileri ve komutları değişmedi; Shopify dağıtım iş akışı çalıştırılmadı.
CI ve kabul gelmeden F05 kapalı sayılmaz; F06 başlamaz.
Aşağıdaki teşhis başlangıç kaydıdır.

Governance ve Shopify dağıtım iş akışlarında bazı üçüncü taraf action'lar tam
commit SHA yerine değişken ana sürüm etiketi kullanmaktadır. Dağıtım iş akışı Shopify
otomasyon secret'ına erişmektedir.

**İş etkisi:** CI/dağıtım tedarik zinciri riski.

**Kapatma kapısı:** Her action resmî repository'sindeki doğrulanmış sürüm
commit SHA'sına sabitlenmeli; Dependabot/kontrollü güncelleme yöntemi ve CI testi
eklenmelidir.

### TECH01-F06 — P2 engelleyici — Production hata log güvenliği

**Canlı kabul — 18 Ekim 2026:** PR #108 `17e79ae4993860de23c3efda091844aaf88c23e5`
olarak birleştirildi; test edilmiş kaynakla birebir kaynak ağacı eşliği doğrulandı.
Ayrı onaylı tek Production dağıtımı `dpl_JAAMKofCU2oi8Tr2s6mAVk2XGAhu`
READY oldu; birebir kaynak SHA ve `embedded.adstable.app` alias'ı doğrulandı.
İlk kısa yalnız ilgili deployment'a ait error/fatal sorgusunda kayıt gözlenmedi; bu sonuç
yalnız o pencereyi kapsar, canlı hata enjeksiyonu yapılmadı. Ürün sahibi
masaüstü ve mobil normal çalışmayı kabul etti. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json`.
Kapanış kaydı birleştirme onayı bekler; F07 ve genel denetim PASS ilan edilmez.
Aşağıdaki hazırlık/teşhis tarihsel kayıttır.

**Repository hazırlığı — 18 Ekim 2026:** Sunucu girişindeki `onError` ve resmî
`handleError` export'u tek sınırlı kayıt aracına bağlandı. Hata nesnesine erişim yok;
yalnız sabit olay/kod/aşama ve izinli yol/metot yazılır. Gerçek Router
production loader/action/resource/shell hata testleri, React streaming hatası,
başarı/yönlendirme, istek iptali ve log hedefi arızası sentetik olarak kontrol edilir.
Kanıt `docs/evidence/A6_TECH_01_F06_SAFE_ERROR_LOG_2026-10-18.json`.
CI, birleştirme ve ayrı onaylı dağıtım/canlı doğrulama tamamlanmadan F06 kapanmaz;
Production hâlâ önceki kodu kullanabilir. F07 başlamadı.

#### F06 uygulama öncesi analist brief'i — 18 Ekim 2026

- Amaç: SSR ve framework hata kayıtlarında ham hata taşınmasın; teşhis için
  sabit hata kodu, aşama, izinli HTTP metodu ve yalnız üç kanonik yol etiketi
  tutulsun. Diğer URL'ler `other`; sorgu, host, başlık ve kimlik kaydedilmez.
- Hata nesnesi hiç okunmaz/serileştirilmez: mesaj, çağrı izi, neden, sağlayıcı
  yanıt gövdesi, SQL, token veya kişisel veri filtre tahminine bırakılmadan dışarıda kalır.
- React Router'ın varsayılan ham kayıt aracı resmî `handleError` dışa aktarımıyla
  değiştirilir; React streaming `onError` aynı güvenli kayıt aracını kullanır.
- Yükleniyor/boş/bağlı/hata/yeniden yetkilendirme/iptal/başarı görünümü, birebir
  ekran metinleri, Polaris/App Bridge bileşen/özellik eşlemesi, masaüstü/mobil düzen,
  OAuth ve sağlayıcı/veritabanı davranışı değişmez. Yeni görsel öğe yoktur.
  SSR 500 ataması, shell rejection, response header ve abort timeout korunur.
- Kaynaklar: https://reactrouter.com/how-to/error-reporting ve
  https://react.dev/reference/react-dom/server/renderToPipeableStream;
  18 Ekim 2026'da kontrol edildi. Kurulu Router 7.18.2 kaynak kodunda özel
  `handleError` dışa aktarımının varsayılan kayıt aracının yerini aldığı doğrulandı.
- Kabul: gerçek Router/React üzerinde sentetik hata ve sızıntı negatifleri,
  yol/metot izin listesi, kesilen istek ve kayıt aracı arızası testleri; mevcut UI
  koruma kontrolleri, tüm testler, typecheck/build ve CI. Gerçek secret/sağlayıcı çağrısı yok.
- Kapsam dışı: UI değişikliği, bağımlılık güncelleme, dış log servisi,
  secret/yapılandırma/veritabanı değişikliği ve dağıtım. Canlıya alma ayrı yetki kapısında;
  bu hazırlık canlı düzeltme/PASS iddiası değildir. F07/F06 kapıları atlanmaz.

En üst sunucu oluşturma sınırı `console.error(error)` ile ham hata nesnesi
yazabilmektedir. Geçmiş log örneklerinde sağlayıcı istek kimliği, veritabanı nesne adı,
SQL parçası ve çağrı izi dosya yolu görülmüştür. Son deployment penceresi temizdir.

**İş etkisi:** Operasyon loglarında gereksiz iç yapı ve sağlayıcı üst verisi
saklanabilir.

**Kapatma kapısı:** Sınırlı hata kodu/bağlam kayıt aracı kullanılmalı; token,
kimlik bilgisi, sorgu, çağrı izi ve sağlayıcı ham yanıt gövdesi negatif testleri geçmelidir.

### TECH01-F07 — P2 engelleyici — Production deployment kaynak geçmişi

**Kapanış — 18 Ekim 2026:** Ürün sahibi kaynak eşliği sonucunu, yeni dağıtım
gerekmemesi kararını, F07 kapanışını ve PR #110'in birleştirilmesini kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F07_CLOSURE_2026-10-18.json`.
F08 başlamadı; aşağıdaki doğrulama/teşhis tarihsel kanıt olarak korunur.

**Doğrulama — 18 Ekim 2026:** Eski görev dalından yapılan deployment F06'da ayrı
açık onayla değiştirildi. Mevcut `dpl_JAAMKofCU2oi8Tr2s6mAVk2XGAhu`, o anda
onaylı birebir `main` birleştirme commit'i `17e79ae4993860de23c3efda091844aaf88c23e5`
kaynağından READY; alan adı ve kaynak tekrar doğrulandı. Güncel `main`
`f429bcc64aa699cc70003d3c35daac87646b9102` aynı commit değildir: fark yalnız
PR #109'un altı kapanış belge/defter/test dosyasıdır. Bu altı birebir yol dışında
371 kaynak girdisinin mode/type/blob/path SHA256 özeti iki tarafta aynıdır.
Uygulama/yapılandırma/bağımlılık/iş akışı/migration farkı yok; yeni dağıtım gerekmiyor.
Kanıt: `docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json`.
Bu noktasal kaynak doğrulamasıdır; derlenmiş çıktının birebir yeniden üretilebilirliği veya gelecek
değişikliklere genel istisna değildir. CI/kabul beklenir, F08 başlamaz.
Aşağıdaki ilk teşhis tarihsel başlangıç kaydı olarak korunur.

Güncel Production deployment'ın kaynak referansı `codex/eo04-closure`, kaynak commit'i
ise denetlenen `main` birleştirme commit'i değildir. Runtime/yapılandırma/şema/iş akışı
içeriği `main` ile aynıdır; davranış uyumsuzluğu görülmemiştir.

**İş etkisi:** Canlı sürüm ile denetlenmiş sürüm otoritesi arasında kesin commit
bağı kurulamamaktadır.

**Kapatma kapısı:** Repository düzeltmeleri birleştirildikten sonra ayrı dış
değişiklik onayıyla birebir denetlenmiş `main` commit'i Production'a alınmalı ve deployment
kaynak geçmişi tekrar doğrulanmalıdır.

### TECH01-F08 — P2 engelleyici — Gizlilik tablolarının yabancı anahtar indeksleri

**Kapanış — 18 Ekim 2026:** Ürün sahibi canlı işlem sonrası kontrol ve repository eşleme
sonucunu, F08 kapanışını ve PR #111'in birleştirilmesini açıkça kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F08_CLOSURE_2026-10-18.json`.
Yeni canlı işlem/dağıtım yok; F09 başlamaz. Aşağıdaki önceki kayıtlar tarihseldir.

**Canlı uygulama — 18 Ekim 2026:** Ayrı açık onayla tek migration çağrısı
başarılı oldu. Supabase sürüm `20261018181906`; hazırlık dosyası bu sürüme
yeniden adlandırıldı, SQL hash'i değişmedi. Önceki 39 migration korunur;
toplam 40 uygulanmış kayıt, bekleyen sıfır. İki indeks valid/ready durumunda; eski indeks, sahip rolü,
RLS/FORCE RLS, ACL, policy, FK/check ve gizlilik fonksiyonu hash'i aynı; hedef
tablolar öncesi/sonrası sıfır satır. Canlı EXPLAIN iki birebir indeksi kullanır;
boş tablo sonucu yanıt süresi/kapasite sertifikası değildir. Security Advisor 0;
indekslenmemiş FK 2 → 0. 14 kullanılmayan indeks bildirimi düşük kullanım gözlemidir,
hiçbir indeks silinmedi. Kanıt:
`docs/evidence/A6_TECH_01_F08_LIVE_ACCEPTANCE_2026-10-18.json`.
Son CI ve açık kapanış/birleştirme kabulü beklenir; F08 henüz kapalı sayılmaz.
Aşağıdaki hazırlık/teşhis kayıtları tarihsel kanıttır.

**İzole doğrulama PASS:** PR #111 kaynak `b935ed6` üzerinde genel CI 437 test,
typecheck/build PASS; DB Integrity `39152944207` PASS. Doğal plan iki tabloda
Seq Scan'den birebir yeni indeks kullanılan Bitmap Heap Scan'e geçti. Test verileri
geri alındı; iki bağımsız 40-migration yeniden kurulumu son şema SHA256'sı
`74f45de15c47463848809ffd220fddb122775935f46c3f7eead961f116f3dec3` ile aynı.
Kanıt `docs/evidence/A6_TECH_01_F08_ISOLATED_PASS_2026-10-18.json`.
Canlı uygulama hâlâ ayrı açık onay bekler; F08 kapanmadı.

**Repository hazırlığı — 18 Ekim 2026:** Canlı salt okunur kontrol iki eksik
çalışma alanı FK indeksini doğruladı. `deletion_runs` ve `deletion_manifests` sıfır
satır; mevcut sahip rolü/RLS/FORCE RLS/ACL ve RESTRICT FK'ler korunacak. İki tam,
tekil olmayan B-tree yalnız `workspace_id` üzerinde hazırlanır; mevcut bekleyen ve
kimlik indeksleri silinmez. 12 kullanılmayan indeks bildirimi silme gerekçesi değildir.
Veri silinmez; webhook, işçi, saklama süresi ve silme kuralları değişmez.

Migration resmî CLI ile üretildi; yalnız iki CREATE INDEX, transaction içinde geçerli
sahip rolü, 5 sn kilit ve 30 sn SQL ifade sınırı içerir. Normal CREATE INDEX yazmayı
geçici bloke edebilir; canlı tabloların boş/küçük olması nedeniyle atomik yol
seçildi. CONCURRENTLY transaction içinde çalışmaz. Canlı ön kontrol koşulları
değişirse veya kilit zaman aşımı olursa durulur; otomatik rota değişimi/tekrar yoktur.

Yeni altyapı yerine mevcut iki izole yeniden kurulum kullanılır. İlkinde yalnız geri alınan
sentetik 2.000 çalışma alanı, tablo başına 20.000 tamamlanmış kayıt üzerinde doğal
plan öncesi/sonrası ve birebir indeks kullanımı; sonra migration kalıcılaştırılmış temiz
şemaya uygulanır. İkinci bağımsız yeniden kurulum aynı son şemayı üretmelidir.
Sentetik test verisi gerçek veri/ölçek sertifikası değildir; boş canlı tabloda indeks taraması
seçilmemesi tek başına hata veya performans kanıtı sayılmaz.

Kanıt `docs/evidence/A6_TECH_01_F08_PRIVACY_INDEXES_2026-10-18.json`.
İzole CI, ayrı canlı uygulama onayı, işlem sonrası kontrol/Advisor ve repository/canlı defter
eşlemesi olmadan F08 kapanmaz. Secret/dağıtım/sağlayıcı işlemi yok; F09 başlamaz.

Supabase Performance Advisor, `privacy.deletion_manifests.workspace_id` ve
`privacy.deletion_runs.workspace_id` için sorguyu kapsayan indeks bulunmadığını raporlamıştır.
Kullanılmayan indeks bildirimleri düşük trafik döneminde tek başına silme gerekçesi değildir.

**İş etkisi:** Çalışma alanı silme/kurtarma sorguları büyüdükçe kapasite ve kilit
süresi riski. EO-05 kapasite kapısını etkiler.

**Kapatma kapısı:** Geçmişi değiştirmeden ilerleyen migration, sorgu planı öncesi/sonrası kanıtı,
Advisor yeniden kontrolü ve ayrı canlı uygulama onayı gerekir.

### TECH01-F09 — P3 — Yerel ana çalışma kopyasının güncellik borcu

**Yerel doğrulama — 18 Ekim 2026:** Birincil çalışma kopyası
`C:/Users/dev/Documents/ChatGPT/ads-table-embedded`, `main` üzerinde 64 commit
gerideydi; ahead/staged/tracked/untracked/ignored/stash yoktu. GitHub Connector
ve uzak ref doğrulandı; `--ff-only --no-overwrite-ignore` ile
`f72c1af273c2271640342051d6a7cb0d47a889d9` kaynağına alındı. Commit/tree birebir
GitHub eşliği, temiz durum ve ahead/behind 0/0 doğrulandı. Eski commit Git
geçmişinde korunur; reset/clean/force/kimlik onarımı, install, servis yeniden başlatma,
dağıtım veya veritabanı işlemi yoktur. Görev eki ve iki çalışma kopyası korundu.
Kanıt `docs/evidence/A6_TECH_01_F09_CHECKOUT_SYNC_2026-10-18.json`.
Ürün sahibi kapanış ve PR #112 birleştirme onayını verdi. Kapanış kaydı
`docs/evidence/A6_TECH_01_F09_CLOSURE_2026-10-18.json`.
Son CI geçip bu PR birleştirilince primary temizliği yeniden kontrol edilip
yeni birebir main sürümüne bir kez daha yalnız ileri alma yapılmadan teslim bitmez.
Son birleştirme commit/tree ve temiz eşlik kanıtı PR #112 açıklamasına kaydedilir;
bu kayıt yeniden commit üretip çalışma kopyasını tekrar geride bırakmaz.

**Tekrar kullanım kuralı:** Eski klasörde işe başlamadan GitHub kaynak + fetch,
status ve ancestry kontrol edilir; yalnız temiz ve doğrusal main ilerletilir.
Yerel iş/divergence varsa durulur; otomatik stash/reset/force veya periyodik
sync kurulmaz. Bu kural sürekli güncellik garantisi değildir. F10 başlamaz.
Aşağıdaki ilk teşhis tarihsel kayıttır.

Görev worktree'si birebir `origin/main` iken birincil çalışma kopyasının yerel `main`
dalı 28 commit geridedir. Yalnız yerelde kalan commit, stash veya upstream'i olmayan dal
bulunmamıştır.

**Kapatma kapısı:** A6-OPS-LOCAL-01 içinde geri alınabilir yerel düzenleme; ürün
runtime'ını veya EO-05 kapısını tek başına engellemez.

### TECH01-F10 — P3 — Framework yükseltme borcu

**Güncel karar — 18 Ekim 2026:** Ürün sahibi F10'un ayrı uyumluluk çalışması
bekleyen, EO-05'i tek başına engellemeyen açık teknik borç olarak kaydedilmesini
onayladı. Kanıt: `docs/evidence/A6_TECH_01_F10_DEFERRED_2026-10-18.json`.
Bu karar F10 kapanışı, framework yükseltme veya genel denetim PASS kararı değildir.

Build beş React Router v8 gelecek sürüm uyarısı üretmektedir. Mevcut
`@vercel/react-router` sürümü React Router 7 uyumlu bağımlılık sınırına sahiptir; bu nedenle
ana sürüm yükseltmesi bu denetimde otomatik yapılmaz.

Uyarılar şu beş davranışla ilgilidir:

- `v8_middleware`: yol isteklerinin ara katmanda işlenmesi.
- `v8_splitRouteModules`: yol kodunun parçalara ayrılması.
- `v8_viteEnvironmentApi`: geliştirme/build ortamının yönetimi.
- `v8_passThroughRequests`: isteğin framework içinde aktarılması.
- `v8_trailingSlashAwareDataRequests`: veri isteği URL'lerinde son `/` ayrımı.

Bu uyarılar tek başına mevcut çalışma hatasını kanıtlamaz. Uyarıları gizlemek
için `false` özellik bayrağı, log filtresi veya başka susturma ayarı eklenmedi; mevcut
özellik bayrağı varsayımları ve sürümler korundu. Özellik bayraklarının v7 üzerinde tek tek
benimsenmesi mümkün olabilir; bunun güvenli olduğu henüz kanıtlanmadı.
Beş uyarının giderilmesi için mutlaka ana sürüm yükseltmesi gerektiği iddia edilmez.

Kaynak kontrolü 18 Ekim 2026'da yapıldı. Kurulu adaptör `1.3.7` manifest'i
React Router dev/node için `7` uyumlu bağımlılık sınırı bildirir. Vercel'in resmî GitHub
[manifest'i](https://github.com/vercel/vercel/blob/main/packages/react-router/package.json)
aynı uyumlu bağımlılık sınırını gösterir; erişilen uzak dosyada sürüm `1.3.6` olduğundan
bu kaynak kurulu `1.3.7` ile birebir veya en yeni yayımlanmış sürüm kanıtı
sayılmaz. Vercel doküman sayfasına erişim hatasından sonra yalnız kullanıcı
onaylı resmî GitHub rotası kullanıldı. React Router'ın sürüme özel rehberine
erişim de başarısız oldu; yeniden deneme/alternatif rota zorlanmadı. Bu nedenle
tam geçiş/özellik bayrağı uyumluluğu kanıtlanmış değildir.

**Kapatma kapısı:** Uyumlu Vercel adaptörü sürümü ve resmî geçiş yolu birlikte
kanıtlandığında ayrı açık onaylı uyumluluk işi. O işte birebir sürüm/bağımlılık uyumu,
güncel resmî geçiş belgeleri ve her özellik bayrağının etkisi doğrulanır; davranış
testleri, typecheck/build ve gerekiyorsa Shopify masaüstü/mobil kabulü alınır.
EO-05 öncesi genel yeniden test ve denetim kararı bu ertelemeden bağımsızdır.

## 5. O aşamada açık kanıtlar — tarihsel gelişim

### Son yeniden testte bulunan güvenlik konusu — TECH01-RETEST-SEC01

**Vite düzeltmesi — 18 Ekim 2026:** Ayrı açık kullanıcı onayıyla yalnız
Vite `7.3.1 → 7.3.5` ve bağımlılık kayıt dosyası/lockfile eşliği hazırlandı.
Yeni taramada Vite'nin beş güvenlik bildirimi yok; toplam 4 yüksek/3 orta/1 düşükten
1 yüksek/1 orta/1 düşüğe indi. Production taraması temiz. Kalan `braces`,
`ajv`, `esbuild` sürümleri değişmedi; override/ignore eklenmedi. Kanıt:
`docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json`.
Bu kısmi düzeltme genel güvenlik kapanışı değildir. CI ve ayrı birleştirme kabulü
beklenir; dağıtım yetkisi yoktur. Aşağıdaki sekiz güvenlik bildirimi kaydı önceki taramadır.

Bu kayıt ilk F01–F10 listesini veya o denetimin başlangıç sayılarını değiştirmez.
F01–F09 kapanışları ve F10'un kabul edilmiş açık teknik borç kararı korunur.
Yeni konu, tam bağımlılık taramasında görülen geliştirme/build zinciridir:

- Vite `7.3.1`: üç yüksek ve iki orta güvenlik bildirimi.
- Vercel adaptörünün dolaylı `braces` bağımlılığı: bir yüksek güvenlik bildirimi.
- Aynı zincirde `ajv`: bir orta güvenlik bildirimi.
- `esbuild`: bir düşük güvenlik bildirimi.

Tarama başarılı bir paket kayıt hizmeti yanıtı aldı ve bulgu nedeniyle çıkış kodu 1 döndü;
bu bir bağlantı/izin hatası veya yeniden deneme gerekçesi değildir. Sonuçlar
güvenlik bildirimi eşleşmesidir; uygulamanın ele geçirildiği, canlıda veri sızdığı veya
her güvenlik bildiriminin mevcut kullanımda tetiklenebildiği kanıtlanmış değildir.
Yalnız Production taramanın temiz olması da build zincirini veya yayımlanan
kod paketi'ı kendiliğinden güvenli ilan etmez.

**Karar:** Ön değerlendirme P2/güvenlik; etki analizi tamamlanana kadar kapanış
ve EO-05 engeli. Otomatik `audit --fix`, override, ignore, lockfile veya sürüm
değişikliği yapılmadı. F10'un v8 geçiş borcuyla birleştirilmez. Sonraki adım,
ayrı açık onayla güvenlik bildirimlerinin birebir sürüm ve gerçek kullanım koşullarını
inceleyip en küçük güvenli düzeltmeyi önermektir; henüz uygulama yetkisi yoktur.

### Sonraki onaylı güvenlik düzeltmesi — yalnız repository

İlk Vite düzeltmesi PR #115 ile birleştirildi; beş güvenlik bildirimi kalktı, üçü kaldı.
Ürün sahibinin ayrı onayıyla Vite `7.3.6` ve dört birebir dar kapsamlı sürüm geçersiz kılması uygulandı:
Vite altında esbuild `0.28.1`; Vercel static-config altında Ajv `8.18.0` ve
ts-morph `24.0.0`; Vercel React Router adaptörü altında ts-morph `24.0.0`.
Braces güncellenmiş gibi gösterilmedi: onu getiren eski glob zinciri kaldırıldı.
Production ve tam bağımlılık taraması yeni grafikte sıfır güvenlik bildirimi döndürdü.
Ignore, güvenlik bildirimi filtresi, fork veya risk kabulü kullanılmadı.

ts-morph `12 → 24` Vercel'in kendi sürüm sabitlemesi dışındadır; resmî Vercel destek garantisi
iddia edilmez. Kurulu gerçek Vercel ayrıştırıcı/doğrulayıcısı ve preset'iyle normal yol,
yerel ayrıştırıcı yokken ts-morph yolu, hatalı yapılandırma reddi, yapılandırma yokluğu, yol
mirası ve kod paketi kimliği sınanır. Yalnız test için üretilen yerel-yükleyici hatası hiçbir bağımlılık
dosyasını değiştirmez. Birebir lockfile hash'i ve sürümler yeni kanıta bağlanır:
`docs/evidence/A6_TECH_01_REMAINING_SECURITY_REMEDIATION_2026-10-18.json`.

CI ve ürün sahibi kabulü beklenir; güvenlik bulgusu henüz kapalı ilan edilmez.
Eski denetim ve PR #115 kanıtları tarihsel olarak korunur. Canlı dağıtım yapılmadı;
bu sonuç mevcut canlı kod paketi'ın veya genel denetimin PASS kanıtı değildir.
F10 ertelemesi, diğer kanıt kapıları ve EO-05 engeli değişmez.

### Önceden açık kalan kanıtların güncel sınırı

F01'de dar kapsamlı şema kurtarma açık ürün sahibi kabulüyle kapandı. Free Plan'da
yönetilen yedek olmadığı biliniyor; bu artık bilinmeyen bir plan sorusu değildir.
F01 kabulü tam veri yedeği veya genel PITR kanıtı sayılmaz. Bu yeniden test yeni
yedek işi açmaz, F01'i tekrar açmaz ve genel kurtarma güvencesi iddia etmez.
GitHub aktif koruma kuralları ve Meta'nın önceden erişilemeyen iki resmî sayfası
için yeni kanıt üretilmedi. GitHub ruleset rehberine erişim de başarısız oldu;
yeniden deneme veya alternatif yetki rotası kullanılmadı.

F08'in başarılı izole veritabanı CI kaydı Connector ile yeniden doğrulandı.
O kaynağa göre migration, DB araçları, iş akışı ve bağımlılık girdileri değişmedi;
eski PASS kanıtı bu sınırla korunur. Bu, bugün yeni bir DB yeniden kurulumu, canlı sorgu
veya canlı durum doğrulaması yapıldığı anlamına gelmez. Aynı şekilde F06 kabul
edilmiş dağıtım kaynağına göre uygulama/yapılandırma/bağımlılık dosyaları değişmedi;
bu taze tarayıcı/API/DB uçtan uca kabulünün yerine geçirilmez.

Aşağıdaki tablo ilk denetimin tarihsel açık kanıt listesidir; yukarıdaki sınırlar
o aşamadaki değerlendirmedir. Yeni güvenlik konusu çözülmeden genel PASS verilmez.

| Kanıt | Durum | Tamamlama yolu |
| --- | --- | --- |
| GitHub dal koruması/kural kümesi | Connector endpoint'i yok; `gh` kurulu değil | Ürün sahibi GitHub `Settings → Rules` ekranından aktif kural kümesi/zorunlu kontroller bilgisini paylaşır |
| Supabase yedek/PITR | Connector plan ve geri yükleme penceresini göstermiyor | Ürün sahibi Supabase `Database → Backups` ekranından plan, son yedek ve PITR durumunu paylaşır |
| Meta güncel resmî kaynak yeniden okuması | İlk salt okunur istek `429` verdi; tekrar denenmedi | Ayrı onaylı ve hatasız doküman erişiminde yeniden doğrulanır |

Bu eksikler platformun hatalı olduğunu kanıtlamaz; yalnız denetim kanıtının henüz
tamamlanmadığını gösterir.

## 6. İlk düzeltme taslağı — tarihsel, uygulanacak güncel sıra değil

Bu ilk taslak daha sonra F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 →
F09 → F10 sırasıyla yürütüldü. Aşağıdaki eski sıralama yeni iş talimatı değildir.

1. Yalnız repository kapsamlı P1 ortam envanteri düzeltmesi ve yanlış testi kaldırma.
2. Supabase migration kaynak geçmişi/uzlaştırma tasarımı; canlı değişiklik yok.
3. Polaris URL, güvenli loglama ve GitHub Actions değişmez pin düzeltmeleri.
4. Gizlilik indeksi migration'ı ve eski yetkilendirme devri yüzeyi için geçmişi değiştirmeden ilerleyen migration
   tasarımı; canlı uygulama ayrı onay.
5. Sahipsiz kimlik bilgisi için birebir silme/geri alma planı; canlı işlem ayrı onay.
6. Düzeltme dalında tam test, typecheck, build, bağımlılık taraması ve temiz
   geçici veritabanı migration provası.
7. GitHub CI ve manuel GitHub/Supabase kanıt kapıları.
8. Birleştirme için açık ürün sahibi onayı.
9. Birebir denetlenmiş `main` deployment'ı için ayrı dış değişiklik onayı ve yeni
   tarayıcı → API → veri → yanıt doğrulaması.
10. A6-TECH-01 PASS referans sürüm commit'ini kaydetme; ardından A6-DOCS-01.

## 7. Resmî kaynak tabanı

18 Ekim 2026 tarihinde kontrol edilmiştir:

- Shopify kimlik doğrulaması ve ID token:
  <https://shopify.dev/docs/apps/build/authentication-authorization>
- Shopify App Home/App Bridge/Polaris:
  <https://shopify.dev/docs/api/app-home/latest>
- Shopify Polaris:
  <https://shopify.dev/docs/api/polaris>
- GitHub Rulesets:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
- GitHub Actions güvenliği:
  <https://docs.github.com/en/actions/reference/security/secure-use>
- Vercel ortam değişkenleri ve dağıtımlar:
  <https://vercel.com/docs/environment-variables>
  ve <https://vercel.com/docs/deployments/overview>
- Supabase veritabanı ve yedekler:
  <https://supabase.com/docs/guides/database/overview>
  ve <https://supabase.com/docs/guides/platform/backups>
- Google Ads GAQL ve Performance Max raporlaması:
  <https://developers.google.com/google-ads/api/docs/query/overview>
  ve <https://developers.google.com/google-ads/api/performance-max/reporting>
- Klaviyo Reporting API ve istek sınırları:
  <https://developers.klaviyo.com/en/reference/reporting_api_overview>
  ve <https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling>

## 8. Referans sürümler, tarihsel ara karar ve son kabul

`c3faddff97628f372f5cc843f3326fb38de95dfc` denetlenmiş başlangıç sürümüdür;
PASS sonucu değildir. A6-TECH-01 düzeltmeleri ve yeniden test tamamlanınca yeni birebir
commit kaydedilmesi gerekiyordu; son kabul aşağıdadır.

Güvenlik düzeltmesinden sonraki ara karar (tarihsel):

18 Ekim 2026 güvenlik kapanışı: PR #116 ürün sahibi onayıyla birleştirildi;
449 test ve GitHub build/typecheck/lockfile kapıları geçti, iki bağımlılık
taramasında sıfır güvenlik bildirimi kaydedildi. `TECH01-RETEST-SEC01` repository kapsamıyla
kapalıdır. Önceki açık/hazırlık durumları tarihsel kanıttır. Kapanış:
`docs/evidence/A6_TECH_01_SECURITY_CLOSURE_2026-10-18.json`.

Genel kapanışta kalanlar: GitHub aktif koruma kuralları kanıtı, daha önce 429
alınan Meta resmî kaynaklarının ayrı onaylı teyidi ve son sürümün ayrı onaylı
canlı kabulü. Bu kayıt bunları yapma yetkisi vermez. F01–F09 tekrar açılmaz;
bilinen kurtarma sınırı yeni yedek işi değildir. F10 açık ve ertelenmiştir.

- `A6-TECH-01`: **Bulgular kaydedildi; düzeltme gerekli**
- `A6-TECH-01 PASS`: **Hayır**
- `A6-DOCS-01`: **Başlayamaz**
- `A6-EO-05`: **Başlayamaz**

### Son bağlayıcı karar — 18 Ekim 2026

Ürün sahibi canlı kabulü ve genel denetim kapanışını açıkça onayladı.
`A6-TECH-01`: **PASS / Kabul edildi**, referans sürüm
`bd243fff7200ae6bdb3900ebb7417b3beba53010`.
`dpl_6AeuxVdBj2DMVB8Bskc4xX1qKKJT` Production READY; domain/kaynak eşleşmesi
kabul sonrası doğrulandı. 457 testlik kaynak CI'ı, iki sıfır güvenlik bildirimli tarama
kanıtı, GitHub koruması, Meta doküman incelemesi/dar düzeltme ve ürün sahibi
masaüstü/mobil normal çalışma kabulü kapanışa bağlandı.

Kısa log penceresinde hata/uyarı grubu gözlenmedi; bu tüm veri yolları veya
gelecekte hatasızlık garantisi değildir. Yeni gerçek sağlayıcı çağrısı, taze DB
replay veya canlı hata enjeksiyonu yapılmış sayılmaz. F10 açık ertelemesi,
F01 dar kapsamlı kurtarma ve EO04 sağlayıcı kanıt sınırları devam eder.
`A6-DOCS-01` önkoşulu sağlandı; uygulama o kapanış tarihinde başlamamıştı. EO-05, review ve
canlı geçiş açılmaz. Kapanış PR'ının CI/birleştirme teslimi zorunludur.
