# A6-TECH-01 mühendislik bütünlüğü denetimi

**Kontrol tarihi:** 18 Ekim 2026
**Denetlenen ürün baseline'ı:** `c3faddff97628f372f5cc843f3326fb38de95dfc`
**Durum:** Bulgular kaydedildi; kritik düzeltme ve yeniden test zorunlu
**EO-05 kararı:** Kapalı

**Güncel düzeltme durumu:** F01–F07 ürün sahibi kabulüyle kapandı.
F08 index hazırlığı sürüyor; izole CI ve ayrı canlı onay beklenir. Genel audit PASS değildir.
İlk denetim bulguları ve başlangıç sayıları aşağıda
tarihsel baseline olarak korunur; genel A6-TECH-01 henüz PASS değildir.

## 1. Analist özeti

Çalışan Production uygulamasında veri kaybı veya aktif servis kırılması
gözlenmemiştir. Repository test, typecheck ve build kapılarından geçmektedir.
Buna rağmen repository ile canlı altyapının birlikte yeniden üretilebilirliği,
secret yaşam döngüsü ve bazı güvenlik/review sınırları henüz kanıtlı değildir.

Denetimde P0 bulunmamıştır. Üç P1 ve güvenlik, veri doğruluğu, kapasite veya
review sonucunu etkileyen beş P2 açıktır. Bağlayıcı kalite sözleşmesi gereği bu
bulgular düzeltilip yeniden test edilmeden A6-TECH-01 PASS verilemez ve EO-05
başlayamaz.

Bu belge hiçbir Supabase, Vercel, GitHub, Shopify veya provider mutation'ını
yetkilendirmez. Denetim sırasında canlı veri, credential veya configuration
değiştirilmemiştir.

## 2. Denetim planı ve yöntem

| Alan | Kontrol | Yöntem | Sonuç |
| --- | --- | --- | --- |
| Git ve teslim | Uzak `main`, görev branch'i, PR, CI, worktree, stash ve local-only envanteri | GitHub Connector ve salt-okunur yerel Git | Bulgu var |
| Uygulama | Runtime, dependency, test, typecheck ve build | Kaynak inceleme ve yerel doğrulama | Geçti; bulgu var |
| Shopify | Embedded auth, App Bridge, Polaris ve config bütünlüğü | Resmî doküman ve kaynak inceleme | Bulgu var |
| Providerlar | Sözleşme, sürüm, hata ve veri sınırları | Resmî doküman, kod ve test karşılaştırması | Sınırlı geçti |
| Supabase | Migration, canlı schema, RLS, grants, functions, index ve Advisor | Salt-okunur metadata ve Advisor kontrolleri | Kritik bulgu var |
| Vercel | Environment, deployment provenance, runtime ve log | Salt-okunur proje/deployment/log envanteri | Kritik bulgu var |
| Güvenlik | Secret izi, credential sahipliği ve hata sızıntısı | İsim-only envanter, kaynak/geçmiş taraması | Kritik bulgu var |
| Veri doğruluğu | Provider gerçeği, zero/unknown ayrımı ve EO-04 devirleri | Contract/test/runtime çapraz kontrolü | Mevcut EO-04 sınırları korundu |

## 3. Kontrol matrisi

| Kontrol | Durum | Kanıt özeti |
| --- | --- | --- |
| Görev worktree'si exact uzak `main` baseline'ında | PASS | Branch `codex/a6-tech-01-audit`; başlangıç divergence `0/0` |
| Açık PR | PASS | Açık PR bulunmadı; EO-04 kapanış PR'ı merge ve kontroller başarılı |
| Repository çalışma ağacı | PASS | Denetim başlamadan önce tracked/untracked değişiklik yoktu |
| Ürün testleri | PASS | Baseline'da 384/384 test geçti |
| TypeScript kontrolü | PASS | `pnpm typecheck` başarılı |
| Production build | PASS | `pnpm build` başarılı; React Router v8 future uyarıları ayrı teknik borç |
| Production dependency vulnerability | PASS | `pnpm audit --prod` bilinen açık bildirmedi |
| Güncel Production runtime | PASS | Son deployment loglarında hata/uyarı yok |
| Supabase Security Advisor | PASS | Bulgu yok |
| Supabase RLS ve function-only runtime sınırı | PASS | Private tablolar forced RLS; runtime için direct table grant yok |
| Supabase migration/repository eşliği | FAIL | Canlı ledger ve repository migration zinciri eşleşmiyor |
| Credential sahiplik bütünlüğü | FAIL | Bir Google credential envelope aktif bağlantıya bağlı değil |
| Vercel env-name envanter eşliği | FAIL | Canlı 22 Production adı; repository Vercel envanteri 18 ad |
| Production/Preview secret izolasyonu | PASS | Canlı girdiler yalnız Production hedefinde |
| Shopify Polaris URL tekliği | FAIL | Client RC URL ile server preload URL'si aynı sözleşmeye bağlanmamış |
| GitHub Actions immutable dependency pinning | FAIL | Bazı action'lar mutable major tag kullanıyor |
| Production hata log sanitizasyonu | FAIL | Top-level SSR sınırı ham `Error` nesnesi yazabiliyor |
| Production deployment provenance | FAIL | Canlı deployment kaynak ref'i `main` değil |
| Privacy foreign-key covering indexleri | FAIL | İki eksik index Advisor tarafından raporlandı |
| Repository ve Git geçmişinde açık secret izi | PASS | Belirgin secret pattern'i bulunmadı; değerler rapora alınmadı |
| Provider production kanıtlarının EO-04 truthful devri | PASS | Açık Meta/Google/Klaviyo kanıt sınırları korunuyor |

## 4. Bulgu kaydı

### TECH01-F01 — P1 — Supabase migration zinciri yeniden üretilebilir değil

**Güncel düzeltme durumu — 18 Ekim 2026:** F01-A/B ve PR #101 tamamlandı.
Ürün sahibinin ayrı kapsam ve canlı uygulama onayından sonra retirement bir kez
uygulandı. İlk 38 ledger kaydı/SQL hash'i değişmedi; yeni gerçek version
`20261018152910`. Canlı katalog yalnız beklenen function/policy farklarını
taşıyor; connection, credential ve tarihsel satır parmak izleri aynı.
Security Advisor temiz. Kanıt:
`docs/evidence/A6_TECH_01_F01_LIVE_ACCEPTANCE_2026-10-18.json`.
Ürün sahibi F01 kapanışını ve PR #102 merge'ünü 18 Ekim 2026'da onayladı.
Kapanış kanıtı `docs/evidence/A6_TECH_01_F01_CLOSURE_2026-10-18.json`.
Bu kabul diğer bulguları kapatmaz veya EO-05 başlangıcını yetkilendirmez.
Aşağıdaki bulgu metni denetim başlangıcındaki durumu açıklar.

**F01-A hazırlığı:** Ayrıntılı eşleme ve kapılar
`docs/A6_TECH_01_F01_MIGRATION_RECONCILIATION.md` içindedir. Repository hazırlığı
F01'i kapatmaz; temiz database provası ve ayrı canlı uygulama kapıları beklenir.

Repository 32 migration taşırken canlı migration ledger'ı 38 kayıt taşır. Aynı
isimli 32 migration'ın version kimlikleri eşleşmemektedir. Canlıda repository
`main` içinde bulunmayan altı eski authorization-handoff migration'ı ile bunların
tablo ve çalıştırılabilir fonksiyonları kalmıştır.

**İş etkisi:** Çalışan veritabanının yalnız repository'den güvenilir biçimde
yeniden kurulabileceği kanıtlanamaz. Geçmişte kabul edilmiş yeni connection
mimarisi ile canlı executable yüzey birlikte drift taşır.

**Kapatma kapısı:** Exact tarihsel SQL provenance'ı çıkarılmalı; mevcut ledger
yeniden adlandırılmadan ve eski migration tekrar çalıştırılmadan forward-only
reconciliation tasarlanmalı; temiz ephemeral PostgreSQL üzerinde sıfırdan kurulum
ve canlı schema parity testi geçmelidir.

### TECH01-F02 — P1 — Sahipsiz şifreli Google credential

**Güncel sonuç — 18 Ekim 2026:** PR #103 iki temiz PostgreSQL kurulumunda
F02 regresyonu ve governance/test/typecheck/build PASS sonrasında açık onayla
merge edildi. Kullanıcı yalnız tek sahipsiz envelope'un commit sonrası geri
getirilemeyeceğini açıkça kabul ederek canlı temizlemeyi ayrıca onayladı.
Kayıt tek transaction ve tek denemede silindi. Kilit altında ön koşullar ve
COMMIT öncesi son koşullar doğrulandı. Sahipsiz Google credential 1 → 0,
toplam credential 4 → 3. Diğer üç credential, üç connection ve sekiz history
satırının parmak izleri aynı; Security Advisor 0. Google revoke çağrısı,
token çözme/dışa aktarma, schema/grant veya platform config değişikliği yok.

Kanıt: `docs/evidence/A6_TECH_01_F02_LIVE_CLEANUP_2026-10-18.json`.
Exact transaction SQL'i aynı evidence dizininde korunur; tekrar çalıştırma
yetkisi vermez ve aday artık bulunmadığından guard ile durur. Başlangıçtaki
recoverable-deletion kapısı genel olarak gevşetilmedi: yalnız bu kayda ait
commit-sonrası geri dönüşsüzlük istisnası açıkça kabul edildi. Full backup
varmış gibi gösterilmez. Ürün sahibi 18 Ekim 2026'da F02 kapanışını ve PR #104
merge'ünü kabul etti. Kanıt:
`docs/evidence/A6_TECH_01_F02_CLOSURE_2026-10-18.json`.
F03 sıradadır; uygulaması başlamadı ve bu kabul yeni işlem yetkisi vermez.
Aşağıdaki teşhis/hazırlık notları önceki durumu açıklar.

**18 Ekim 2026 incelemesi:** Tek Google kalıntısının connection ve handoff
referansı yok; aynı sahibi için süresi dolmamış OAuth işlemi de yok. Kayıt
11 Ekim 15:50:07 UTC'de oluşmuş. Yakın OAuth/handoff geçmişi
`SUPERSEDED_BY_NEW_AUTHORIZATION` ile sonlanmış. Credential bağlantısı eskiden
boşaltıldığı için bu tarih eşliği doğrudan ID lineage kanıtı değildir.

Eski `create_provider_authorization_handoff` fonksiyonunda somut hata bulundu:
`credential_id = null` güncellemesinden sonra `RETURNING handoff.credential_id`
yeni NULL değeri topluyor, dolayısıyla eski envelope silinemiyordu. Bu fonksiyon
F01'de kaldırılmıştır. Güncel `stage_provider_account_selection` eski ID'yi
güncellemeden önce değişkende tutar ve aynı transaction içinde siler. Gerçek
PostgreSQL regresyon senaryosu mevcut izole runner'a eklenmiştir; CI geçmeden
bu yeni senaryo PASS sayılmaz. Application veya historical SQL değiştirilmedi.

Kanıt: `docs/evidence/A6_TECH_01_F02_DIAGNOSIS_2026-10-18.json`.
Canlı silme yetkisi yoktur. Kayıt hâlâ korunmaktadır. En son token kullanımını
gösteren ayrı audit alanı bulunmadığından son kullanım zamanı iddia edilmez.
Commit öncesi rollback mümkün; commit sonrası kaydı geri getirecek yedek bu
çalışmada oluşturulmadı. Bu sınır kabul edilmeden silme yapılmaz.

**Önerilen tek-kayıt temizleme sınırı (henüz yetkili değil):** Provider,
created-at ve kimlik parmak iziyle tam bir aday bulunmalı. Kısa transaction
içinde credential ve iki referans tablosu kilitlenip referans/in-flight kontrolleri
yeniden yapılmalı; aday sayısı bir değilse veya referans oluşmuşsa durulmalı.
Yalnız bu envelope silinmeli; üç bağlı credential ve connection/history
parmak izleri korunmalı. Kontrol başarısızsa COMMIT yapılmadan rollback edilmeli.
Commit sonrasında yerel envelope bu çalışma ile geri getirilemez; yeniden
OAuth gerekebilir. Google tarafında grant revocation yapılması bu işlemin
parçası değildir. Bu sınırlı ve commit-sonrası geri alınamayan silme yolunun
kabulü, başlangıçtaki recoverable-deletion kapısı için açık ürün sahibi kararı
gerektirir; mevcut kayıt bu kapıyı PASS yapmaz.

Regresyon yalnız pending credential değiştirme davranışını kanıtlar; process
crash veya sessiz cleanup hatalarının bütün olasılıklarını çözdüğü iddia edilmez.

Canlı credential envanterinde iki Google envelope bulunmasına rağmen yalnız biri
mevcut canonical connection tarafından referanslanmaktadır. Diğeri geçerli anahtar
ailesiyle şifreli ve çözülebilir durumdadır.

**İş etkisi:** Gerekenden uzun secret saklama ve credential custody belirsizliği.
Bu durum veri kaybı kanıtı değildir.

**Kapatma kapısı:** Sahiplik ve son kullanım kanıtı çıkarılmalı; recoverable
deletion planı ve rollback açıkça kabul edilmeli; canlı silme yalnız ayrı ürün
sahibi onayıyla yapılmalıdır.

### TECH01-F03 — P1 — Vercel environment envanter drift'i

**18 Ekim repository düzeltmesi:** Güncel metadata yalnız ad/target/type
alanlarıyla yeniden okundu: 22 Production, 0 Preview/Development. Eksik dört
Google adı `.env.example` ve secret contract'ına eklendi. Master 23 toplam /
22 Vercel / 1 workflow secret adıyla eşlendi; GitHub secret store yeniden
denetlenmiş sayılmaz. Contract'ın mantıksal saklama politikası ile gözlenen
fiilî tür ayrıldı: Vercel 17 Secret / 5 Config. Canlı yeniden sınıflandırma yok.
Negatif test, Google adı hem örnekten hem contract'tan çıkarılsa bile canlı
snapshot karşılaştırmasının bunu yakalamasını sağlar; eski `16` sabiti kaldırıldı.
Secret çözümleme/değer okuma, provider/config mutation veya deploy yapılmadı.
Kanıt `docs/evidence/A6_TECH_01_F03_ENV_INVENTORY_2026-10-18.json`.
Ürün sahibi F03 kapanışını ve PR #105 merge'ünü 18 Ekim 2026'da onayladı.
Kanıt `docs/evidence/A6_TECH_01_F03_CLOSURE_2026-10-18.json`.
F04 başlamadı. Bu kabul genel secret custody/recovery açıklarını kapatmaz;
aşağıdaki metin başlangıç bulgusudur.

Canlı Vercel Production projesi 22 environment adı taşır. Repository secret
contract'ı 18 Vercel girdisi, master contract ise daha eski 16 toplam/11 Vercel
sayısını taşır. `.env.example` dört Google server-only adını içermemektedir:
`GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`,
`GOOGLE_ADS_OAUTH_REDIRECT_URI` ve `GOOGLE_ADS_DEVELOPER_TOKEN`.

**İş etkisi:** Yeni ortam veya recovery işlemi eksik configuration ile kurulabilir;
mevcut test eski sayıyı koruduğu için yanlış güven üretir.

**Kapatma kapısı:** Secret değeri okunmadan veya değiştirilmeden name-only
env sözleşmesi, örnek dosya, master kayıt ve test aynı authoritative set üzerinde
birleştirilmelidir.

### TECH01-F04 — P2 blocker — Shopify Polaris URL bütünlüğü

**Kapanış — 18 Ekim 2026:** Tek Polaris sabiti server ve AppProvider'a verildi;
gerçek SDK Link preload/script eşliği ve negatif testler geçti. Test edilmiş
`3e665f647f1c815673b0d6ff05f7e70649d4c4e5` ayrı açık onayla mevcut Production
adresine deploy edildi. Vercel `READY`, exact commit ve domain alias'ı doğrulandı.
Ürün sahibi gerçek Shopify Admin masaüstü ve mobil görünümünü normal buldu ve
PR #106 merge'ünü onayladı. Kanıt:
`docs/evidence/A6_TECH_01_F04_CLOSURE_2026-10-18.json`.
F05 başlamaz; F07 release provenance ve genel EO-05 engeli açık kalır.
Aşağıdaki brief ve teşhis uygulama öncesi tarihsel kayıttır.

#### F04 uygulama öncesi analist brief'i — 18 Ekim 2026

- Amaç: Browser'ın ön yüklediği Polaris ile AppProvider'ın çalıştırdığı Polaris
  aynı kabul edilmiş RC adresi olsun; gereksiz/yanlış bundle ön yüklenmesin.
- Başlangıç: `publicConfig.polarisUrl` RC adresi, server config ise library
  varsayılanında. Başarı: iki değer tek sabitten gelir ve gerçek SDK response
  Link header'ı ile render edilen script adresi eşleşir.
- Exact copy: hiçbir görünür metin, buton veya kullanıcı eylemi değişmez.
- Durum matrisi: loading, empty/not connected, resume, connected, error,
  reauthorization, cancel ve success akışları mevcut davranışı aynen korur;
  bu düzeltme yeni durum veya action eklemez. Auth/OAuth/database/provider
  çağrıları ve üç ürün URL'i değişmez.
- Component mapping: mevcut `AppProvider` / `polarisUrl` korunur; server
  `shopifyApp({polarisUrl})` aynı sabiti alır. Sayfa, section, form, modal,
  navigation ve action componentleri/propları değişmez. Yeni CSS/control yok.
- Desktop/mobil beklenti: görünüm ve bilgi mimarisi aynı; mevcut RC sürümü ve
  `@shopify/polaris-types@2.0.0-rc.2` korunur, yükseltme veya stable fallback yok.
- Resmî kaynak: `https://shopify.dev/docs/apps/build/app-home/polaris2` ve
  `https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning`.
  Kontrol tarihi 18 Ekim 2026; kurulu React Router adapter 3.0.1 destekliyor.
- Kabul: constitution/test/typecheck/build/CI; tek bundle ve Link/script
  eşliği; ayrı onaylı exact-source deploy sonrası gerçek Shopify Admin
  desktop ve en az 320 px gerçek mobil kontrolü, açık ürün sahibi kabulü.
- Kapsam dışı: yeni özellik, dependency yükseltme, yeni app/secret/config,
  database/provider mutation, auth/data değişikliği. Deploy henüz yetkili değil.
- Rollback: uygulama kodundaki dar config değişikliği geri alınabilir; deploy
  gerekirse ayrı onaylı önceki deployment'a dönüş uygulanır. Mevcut secret ve
  veritabanı değiştirilmez. Görsel kabul kanıtsız PASS yazılmaz.

`AppProvider` Polaris 2 RC URL'sini alırken server `shopifyApp()` yapılandırması
aynı `polarisUrl` değerini almamaktadır. Kurulu kütüphanenin varsayılanı stable
URL'dir. Shopify'ın güncel talimatı React Router uygulamasında iki değerin aynı
olmasını zorunlu tutar.

**İş etkisi:** Yanlış bundle preload'u, performans ve review tutarsızlığı.

**Kapatma kapısı:** Tek sabit iki noktaya verilmeli; eşitlik testi, build ve ürün
sahibi desktop/mobile görsel kabulü geçmelidir.

### TECH01-F05 — P2 blocker — GitHub Actions immutable pin eksikliği

**Kapanış — 18 Ekim 2026:** 425 test, typecheck ve build GitHub CI'da geçti
(run `39148707523`). Ürün sahibi PR #107 merge'ünü ve F05 kapanışını kabul etti.
Kanıt: `docs/evidence/A6_TECH_01_F05_CLOSURE_2026-10-18.json`.
Shopify deploy workflow'u çalıştırılmadı; canlı ayar/secret/database değişmedi.
F06 başlamadı; aşağıdaki hazırlık ve teşhis tarihsel kayıt olarak korunur.

**Düzeltme hazırlığı — 18 Ekim 2026:** Dört değişken referans resmî repository
tag → commit eşliği doğrulanarak tam SHA'ya sabitlendi; mevcut major sürümler
ve diğer iki action pin'i korundu. Tüm workflow dosyalarını tarayan kontrol,
değişken/kısa/doğrulanmamış referansları negatif testlerle reddeder.
Kanıt: `docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json`.
Güncelleme yöntemi kontrollü manuel PR'dır: resmî release/tag ve commit yeniden
doğrulanır, SHA ve açıklama/evidence birlikte güncellenir; CI ve açık ürün sahibi
merge onayı gerekir. Otomatik merge yoktur. Workflow trigger, permission,
input ve komutlar değişmedi; Shopify deploy workflow'u çalıştırılmadı.
CI ve kabul gelmeden F05 kapalı sayılmaz; F06 başlamaz.
Aşağıdaki teşhis başlangıç kaydıdır.

Governance ve Shopify deploy workflow'larında bazı üçüncü taraf action'lar tam
commit SHA yerine mutable major tag kullanmaktadır. Deploy workflow'u Shopify
automation secret'ına erişmektedir.

**İş etkisi:** CI/deploy tedarik zinciri riski.

**Kapatma kapısı:** Her action resmî repository'sindeki doğrulanmış release
commit SHA'sına sabitlenmeli; Dependabot/controlled update yöntemi ve CI testi
eklenmelidir.

### TECH01-F06 — P2 blocker — Production hata log sanitizasyonu

**Canlı kabul — 18 Ekim 2026:** PR #108 `17e79ae4993860de23c3efda091844aaf88c23e5`
olarak merge edildi; test edilmiş kaynakla exact tree eşliği doğrulandı.
Ayrı onaylı tek Production deploy'u `dpl_JAAMKofCU2oi8Tr2s6mAVk2XGAhu`
READY oldu; exact kaynak SHA ve `embedded.adstable.app` alias'ı doğrulandı.
İlk kısa deployment-scoped error/fatal sorgusunda kayıt gözlenmedi; bu sonuç
yalnız o pencereyi kapsar, canlı hata enjeksiyonu yapılmadı. Ürün sahibi
masaüstü ve mobil normal çalışmayı kabul etti. Kapanış kanıtı:
`docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json`.
Kapanış kaydı merge onayı bekler; F07 ve genel audit PASS ilan edilmez.
Aşağıdaki hazırlık/teşhis tarihsel kayıttır.

**Repository hazırlığı — 18 Ekim 2026:** Server entry `onError` ve resmî
`handleError` export'u tek bounded logger'a bağlandı. Hata nesnesine erişim yok;
yalnız sabit event/code/stage ve allowlist route/method yazılır. Gerçek Router
production loader/action/resource/shell hata testleri, React streaming hatası,
başarı/redirect, abort ve log sink arızası sentetik olarak kontrol edilir.
Kanıt `docs/evidence/A6_TECH_01_F06_SAFE_ERROR_LOG_2026-10-18.json`.
CI, merge ve ayrı onaylı deploy/canlı doğrulama tamamlanmadan F06 kapanmaz;
Production hâlâ önceki kodu kullanabilir. F07 başlamadı.

#### F06 uygulama öncesi analist brief'i — 18 Ekim 2026

- Amaç: SSR ve framework hata kayıtlarında ham hata taşınmasın; teşhis için
  sabit hata kodu, aşama, izinli HTTP metodu ve yalnız üç canonical route etiketi
  tutulsun. Diğer URL'ler `other`; query, host, header ve kimlik kaydedilmez.
- Hata nesnesi hiç okunmaz/serialize edilmez: message, stack, cause, provider
  body, SQL, token veya kişisel veri filtre tahminine bırakılmadan dışarıda kalır.
- React Router'ın varsayılan ham logger'ı resmî `handleError` export'uyla
  değiştirilir; React streaming `onError` aynı güvenli logger'ı kullanır.
- Loading/empty/connected/error/reauthorization/cancel/success görünümü, exact
  copy, Polaris/App Bridge component/property eşlemesi, desktop/mobil düzen,
  OAuth ve provider/database davranışı değişmez. Yeni görsel öğe yoktur.
  SSR 500 ataması, shell rejection, response header ve abort timeout korunur.
- Kaynaklar: https://reactrouter.com/how-to/error-reporting ve
  https://react.dev/reference/react-dom/server/renderToPipeableStream;
  18 Ekim 2026'da kontrol edildi. Kurulu Router 7.18.2 kaynak kodunda özel
  `handleError` export'unun varsayılan logger'ın yerini aldığı doğrulandı.
- Kabul: gerçek Router/React üzerinde sentetik hata ve sızıntı negatifleri,
  route/method allowlist, kesilen istek ve logger arızası testleri; mevcut UI
  guard, tüm testler, typecheck/build ve CI. Gerçek secret/provider çağrısı yok.
- Kapsam dışı: UI değişikliği, dependency güncelleme, dış log servisi,
  secret/config/database mutation ve deploy. Canlıya alma ayrı yetki kapısında;
  bu hazırlık canlı düzeltme/PASS iddiası değildir. F07/F06 kapıları atlanmaz.

Top-level server rendering sınırı `console.error(error)` ile ham hata nesnesi
yazabilmektedir. Geçmiş log örneklerinde provider request ID, database nesne adı,
SQL parçası ve stack path görülmüştür. Son deployment penceresi temizdir.

**İş etkisi:** Operasyon loglarında gereksiz iç yapı ve provider metadata'sı
saklanabilir.

**Kapatma kapısı:** Bounded error code/context logger kullanılmalı; token,
credential, query, stack ve provider ham body negatif testleri geçmelidir.

### TECH01-F07 — P2 blocker — Production deployment provenance

**Kapanış — 18 Ekim 2026:** Ürün sahibi kaynak eşliği sonucunu, yeni deploy
gerekmemesi kararını, F07 kapanışını ve PR #110 merge'ünü kabul etti.
Kanıt `docs/evidence/A6_TECH_01_F07_CLOSURE_2026-10-18.json`.
F08 başlamadı; aşağıdaki doğrulama/teşhis tarihsel kanıt olarak korunur.

**Doğrulama — 18 Ekim 2026:** Eski feature-branch deployment'ı F06'da ayrı
açık onayla değiştirildi. Mevcut `dpl_JAAMKofCU2oi8Tr2s6mAVk2XGAhu`, o anda
onaylı exact `main` merge commit'i `17e79ae4993860de23c3efda091844aaf88c23e5`
kaynağından READY; domain ve kaynak tekrar doğrulandı. Güncel `main`
`f429bcc64aa699cc70003d3c35daac87646b9102` aynı commit değildir: fark yalnız
PR #109'un altı kapanış belge/ledger/test dosyasıdır. Bu altı exact yol dışında
371 kaynak girdisinin mode/type/blob/path SHA256 özeti iki tarafta aynıdır.
Uygulama/config/dependency/workflow/migration farkı yok; yeni deploy gerekmiyor.
Kanıt: `docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json`.
Bu noktasal kaynak doğrulamasıdır; binary reproducibility veya gelecek
değişikliklere genel istisna değildir. CI/kabul beklenir, F08 başlamaz.
Aşağıdaki ilk teşhis tarihsel baseline olarak korunur.

Güncel Production deployment'ın kaynak ref'i `codex/eo04-closure`, kaynak commit'i
ise denetlenen `main` merge commit'i değildir. Runtime/config/schema/workflow
içeriği `main` ile aynıdır; davranış drift'i görülmemiştir.

**İş etkisi:** Canlı sürüm ile denetlenmiş release authority arasında kesin commit
bağı kurulamamaktadır.

**Kapatma kapısı:** Repository düzeltmeleri merge edildikten sonra ayrı dış
mutation onayıyla exact audited `main` commit'i Production'a alınmalı ve deployment
provenance tekrar doğrulanmalıdır.

### TECH01-F08 — P2 blocker — Privacy foreign-key indexleri

**İzole doğrulama PASS:** PR #111 kaynak `b935ed6` üzerinde genel CI 437 test,
typecheck/build PASS; DB Integrity `39152944207` PASS. Doğal plan iki tabloda
Seq Scan'den exact yeni index kullanılan Bitmap Heap Scan'e geçti. Fixture'lar
rollback edildi; iki bağımsız 40-migration replay son şema SHA256'sı
`74f45de15c47463848809ffd220fddb122775935f46c3f7eead961f116f3dec3` ile aynı.
Kanıt `docs/evidence/A6_TECH_01_F08_ISOLATED_PASS_2026-10-18.json`.
Canlı uygulama hâlâ ayrı açık onay bekler; F08 kapanmadı.

**Repository hazırlığı — 18 Ekim 2026:** Canlı read-only kontrol iki eksik
workspace FK index'ini doğruladı. `deletion_runs` ve `deletion_manifests` sıfır
satır; mevcut owner/RLS/FORCE RLS/ACL ve RESTRICT FK'ler korunacak. İki full,
non-unique B-tree yalnız `workspace_id` üzerinde hazırlanır; mevcut pending ve
identity index'leri silinmez. 12 unused-index bildirimi silme gerekçesi değildir.
Veri silinmez; webhook, worker, retention ve silme kuralları değişmez.

Migration resmî CLI ile üretildi; yalnız iki CREATE INDEX, transaction-local
owner, 5 sn lock ve 30 sn statement sınırı içerir. Normal CREATE INDEX yazmayı
geçici bloke edebilir; canlı tabloların boş/küçük olması nedeniyle atomic yol
seçildi. CONCURRENTLY transaction içinde çalışmaz. Canlı preflight koşulları
değişirse veya lock timeout olursa durulur; otomatik rota değişimi/tekrar yoktur.

Yeni altyapı yerine mevcut iki izole replay kullanılır. İlkinde rollback-only
sentetik 2.000 workspace, tablo başına 20.000 completed kayıt üzerinde doğal
plan öncesi/sonrası ve exact index kullanımı; sonra migration committed clean
schema'ya uygulanır. İkinci bağımsız replay aynı son schema'yı üretmelidir.
Fixture gerçek veri/ölçek sertifikası değildir; boş canlı tabloda index scan
seçilmemesi tek başına hata veya performans kanıtı sayılmaz.

Kanıt `docs/evidence/A6_TECH_01_F08_PRIVACY_INDEXES_2026-10-18.json`.
İzole CI, ayrı canlı uygulama onayı, postcheck/Advisor ve repository-live ledger
eşlemesi olmadan F08 kapanmaz. Secret/deploy/provider işlemi yok; F09 başlamaz.

Supabase Performance Advisor, `privacy.deletion_manifests.workspace_id` ve
`privacy.deletion_runs.workspace_id` için covering index bulunmadığını raporlamıştır.
Unused-index bildirimleri düşük trafik döneminde tek başına silme gerekçesi değildir.

**İş etkisi:** Workspace deletion/recovery sorguları büyüdükçe kapasite ve kilit
süresi riski. EO-05 kapasite kapısını etkiler.

**Kapatma kapısı:** Forward-only migration, query-plan öncesi/sonrası kanıtı,
Advisor yeniden kontrolü ve ayrı canlı uygulama onayı gerekir.

### TECH01-F09 — P3 — Yerel ana checkout güncellik borcu

Görev worktree'si exact `origin/main` iken birincil checkout'un yerel `main`
branch'i 28 commit geridedir. Yerel-only commit, stash veya upstream'siz branch
bulunmamıştır.

**Kapatma kapısı:** A6-OPS-LOCAL-01 içinde recoverable yerel düzenleme; ürün
runtime'ını veya EO-05 kapısını tek başına engellemez.

### TECH01-F10 — P3 — Framework yükseltme borcu

Build beş React Router v8 future uyarısı üretmektedir. Mevcut
`@vercel/react-router` sürümü React Router 7 peer sınırına sahiptir; bu nedenle
major upgrade bu denetimde otomatik yapılmaz.

**Kapatma kapısı:** Uyumlu Vercel adapter sürümü ve resmi migration yolu birlikte
kanıtlandığında ayrı dependency paketi.

## 5. Açık kanıtlar

| Kanıt | Durum | Tamamlama yolu |
| --- | --- | --- |
| GitHub branch protection/ruleset | Connector endpoint'i yok; `gh` kurulu değil | Ürün sahibi GitHub `Settings → Rules` ekranından active ruleset/required checks bilgisini paylaşır |
| Supabase backup/PITR | Connector plan ve restore penceresini göstermiyor | Ürün sahibi Supabase `Database → Backups` ekranından plan, son backup ve PITR durumunu paylaşır |
| Meta güncel resmî kaynak yeniden okuması | İlk salt-okunur istek `429` verdi; tekrar denenmedi | Ayrı onaylı ve hatasız doküman erişiminde yeniden doğrulanır |

Bu eksikler platformun hatalı olduğunu kanıtlamaz; yalnız audit kanıtının henüz
tamamlanmadığını gösterir.

## 6. Remediation ve retest sırası

1. Repository-only P1 env inventory düzeltmesi ve yanlış testi kaldırma.
2. Supabase migration provenance/reconciliation tasarımı; canlı mutation yok.
3. Polaris URL, güvenli loglama ve GitHub Actions immutable pin düzeltmeleri.
4. Privacy index migration'ı ve eski handoff yüzeyi için forward-only migration
   tasarımı; canlı uygulama ayrı onay.
5. Sahipsiz credential için exact deletion/rollback planı; canlı işlem ayrı onay.
6. Düzeltme branch'inde tam test, typecheck, build, dependency audit ve temiz
   ephemeral database migration provası.
7. GitHub CI ve manuel GitHub/Supabase kanıt kapıları.
8. Merge için açık ürün sahibi onayı.
9. Exact audited `main` deployment'ı için ayrı dış mutation onayı ve fresh
   browser → API → data → response doğrulaması.
10. A6-TECH-01 PASS baseline commit'ini kaydetme; ardından A6-DOCS-01.

## 7. Resmî kaynak tabanı

18 Ekim 2026 tarihinde kontrol edilmiştir:

- Shopify authentication ve ID token:
  <https://shopify.dev/docs/apps/build/authentication-authorization>
- Shopify App Home/App Bridge/Polaris:
  <https://shopify.dev/docs/api/app-home/latest>
- Shopify Polaris:
  <https://shopify.dev/docs/api/polaris>
- GitHub Rulesets:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
- GitHub Actions güvenliği:
  <https://docs.github.com/en/actions/reference/security/secure-use>
- Vercel environment variables ve deployments:
  <https://vercel.com/docs/environment-variables>
  ve <https://vercel.com/docs/deployments/overview>
- Supabase database ve backups:
  <https://supabase.com/docs/guides/database/overview>
  ve <https://supabase.com/docs/guides/platform/backups>
- Google Ads GAQL ve Performance Max reporting:
  <https://developers.google.com/google-ads/api/docs/query/overview>
  ve <https://developers.google.com/google-ads/api/performance-max/reporting>
- Klaviyo Reporting API ve rate limits:
  <https://developers.klaviyo.com/en/reference/reporting_api_overview>
  ve <https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling>

## 8. Baseline ve karar

`c3faddff97628f372f5cc843f3326fb38de95dfc` denetlenmiş başlangıç baseline'ıdır;
PASS baseline'ı değildir. A6-TECH-01 remediation ve retest tamamlanınca yeni exact
commit ayrı olarak kaydedilecektir.

Şimdiki bağlayıcı karar:

- `A6-TECH-01`: **Findings recorded; remediation required**
- `A6-TECH-01 PASS`: **Hayır**
- `A6-DOCS-01`: **Başlayamaz**
- `A6-EO-05`: **Başlayamaz**
