# A6-TECH-01 mühendislik bütünlüğü denetimi

**Kontrol tarihi:** 18 Ekim 2026
**Denetlenen ürün baseline'ı:** `c3faddff97628f372f5cc843f3326fb38de95dfc`
**Durum:** Bulgular kaydedildi; kritik düzeltme ve yeniden test zorunlu
**EO-05 kararı:** Kapalı

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

`AppProvider` Polaris 2 RC URL'sini alırken server `shopifyApp()` yapılandırması
aynı `polarisUrl` değerini almamaktadır. Kurulu kütüphanenin varsayılanı stable
URL'dir. Shopify'ın güncel talimatı React Router uygulamasında iki değerin aynı
olmasını zorunlu tutar.

**İş etkisi:** Yanlış bundle preload'u, performans ve review tutarsızlığı.

**Kapatma kapısı:** Tek sabit iki noktaya verilmeli; eşitlik testi, build ve ürün
sahibi desktop/mobile görsel kabulü geçmelidir.

### TECH01-F05 — P2 blocker — GitHub Actions immutable pin eksikliği

Governance ve Shopify deploy workflow'larında bazı üçüncü taraf action'lar tam
commit SHA yerine mutable major tag kullanmaktadır. Deploy workflow'u Shopify
automation secret'ına erişmektedir.

**İş etkisi:** CI/deploy tedarik zinciri riski.

**Kapatma kapısı:** Her action resmî repository'sindeki doğrulanmış release
commit SHA'sına sabitlenmeli; Dependabot/controlled update yöntemi ve CI testi
eklenmelidir.

### TECH01-F06 — P2 blocker — Production hata log sanitizasyonu

Top-level server rendering sınırı `console.error(error)` ile ham hata nesnesi
yazabilmektedir. Geçmiş log örneklerinde provider request ID, database nesne adı,
SQL parçası ve stack path görülmüştür. Son deployment penceresi temizdir.

**İş etkisi:** Operasyon loglarında gereksiz iç yapı ve provider metadata'sı
saklanabilir.

**Kapatma kapısı:** Bounded error code/context logger kullanılmalı; token,
credential, query, stack ve provider ham body negatif testleri geçmelidir.

### TECH01-F07 — P2 blocker — Production deployment provenance

Güncel Production deployment'ın kaynak ref'i `codex/eo04-closure`, kaynak commit'i
ise denetlenen `main` merge commit'i değildir. Runtime/config/schema/workflow
içeriği `main` ile aynıdır; davranış drift'i görülmemiştir.

**İş etkisi:** Canlı sürüm ile denetlenmiş release authority arasında kesin commit
bağı kurulamamaktadır.

**Kapatma kapısı:** Repository düzeltmeleri merge edildikten sonra ayrı dış
mutation onayıyla exact audited `main` commit'i Production'a alınmalı ve deployment
provenance tekrar doğrulanmalıdır.

### TECH01-F08 — P2 blocker — Privacy foreign-key indexleri

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
