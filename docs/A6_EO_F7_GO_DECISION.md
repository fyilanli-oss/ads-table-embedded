# A6 EO-F7 — Embedded-only temiz yeniden kuruluş GO kararı

**Tarih:** 4 Ekim 2026  
**Karar sahibi:** Ürün sahibi / kullanıcı  
**Karar:** **GO — embedded-only temiz yeniden kuruluş**  
**Durum:** Fizibilite tamamlandı; EO-01 uygulama başlangıcı yetkilendirildi  
**Bu paketin etkisi:** Kararı ve yetki sınırını kaydeder. Bu paket kendi başına repository/project oluşturmaz, production/provider/DB/Shopify/deployment değişikliği yapmaz.

## İş kararı

AdsTable'ın Shopify embedded ürünü mevcut monoliti onararak büyütülmeyecektir. Yeni ürün:

- ayrı, temiz GitHub repository;
- ayrı, preview-only başlayan Vercel project;
- ayrı Standard Supabase Postgres project;
- yalnız Meta, Google Ads ve Klaviyo;
- yalnız Funnel App Home, Ad Analysis ve Settings;
- allowlist tabanlı contract/data/behavior carry

ile kurulacaktır.

Monolit, yeni ürün parity, canary, rollback ve cutover kapılarını geçene kadar production containment ve rollback hattı olarak korunur.

## Neden GO verildi?

EO-F1–F6 birlikte aşağıdaki soruları kapattı:

| Kapı | Sonuç |
|---|---|
| EO-F1 | Canonical authority ve canlı veri envanteri çıkarıldı; billing, scheduler ve privacy foundation boşlukları yeni programa taşındı |
| EO-F2 | Ayrı GitHub repository + ayrı Vercel project seçildi |
| EO-F3 | Application/runtime carry-as-is sayısı 0; davranışlar extract-and-rewrite veya contract-only |
| EO-F4 | Ayrı Standard Supabase seçildi; exact 10 business row carry ve Dataset re-fetch kararı |
| EO-F5 | Üç yüzeyli ürün/route map: Funnel, Ad Analysis, Settings |
| EO-F6 | Temiz yol 42–63, monolit onarımı 59–92 focused day; readiness 88/100 vs 45/100 |

Bu karar işlev veya güvenlik kapısı eksilterek alınmadı. Privacy, deletion, billing, provider doğruluğu, scheduler/finality, truthful API/UI, mobile/desktop kabul, parity ve rollback aynen zorunludur.

## GO'nun yetkilendirdiği işler

EO-F7 merge edildikten sonra aşağıdaki program başlayabilir:

1. **EO-01:** Temiz repository/runtime shell, CI, dependency ve forbidden-import sınırı
2. **EO-02:** Workspace, installation, 14 günlük trial/billing ve privacy lifecycle foundation
3. **EO-03:** Canonical OAuth, connection ve token vault
4. **EO-04:** Meta, Google Ads ve Klaviyo adapterları
5. **EO-05:** Scheduler, Dataset V2, FX, provenance, maturity/reconciliation/finality
6. **EO-06:** Formula, Query ve BFF/API
7. **EO-07:** Üç yüzeyli Shopify-native UI
8. **EO-08:** Data carry rehearsal, side-by-side parity, canary ve rollback
9. **EO-09:** Authority cutover stabilization ve consumer-zero
10. **EO-10:** Legacy archive, retention ve kontrollü retirement

### Fiziksel kaynak yetkisi

EO-01/EO-02 paketleri kendi executable plan ve test sınırları içinde şunları oluşturabilir:

- hedef GitHub repository adayı: `fyilanli-oss/ads-table-embedded`
- hedef Vercel project adayı: `ads-table-embedded`
- hedef Supabase display name adayı: `adstable-embedded`

İsim uygunlukları gerçek provisioning öncesi salt-okunur kontrol edilir. Çakışma varsa sessiz alternatif üretilmez; target isim kararı güncellenir.

Kaynaklar boş/clean başlar:

- eski repository fork edilmez;
- eski repository ağacı veya history toplu kopyalanmaz;
- eski package manifest/lockfile seed olmaz;
- production domain bağlanmaz;
- mevcut Shopify app URL/redirect configuration değiştirilmez;
- eski Supabase credential/service role yeni runtime'a verilmez.

## GO'nun yetkilendirmediği işler

Bu karar aşağıdakilere izin vermez:

- `dev.adstable.app` domain switch
- Shopify App URL veya redirect URI production değişikliği
- mevcut production deployment'ı kapatma
- live provider çağrısı veya OAuth/token mutation
- canlı exact-row/data/token carry
- Dataset production backfill
- mevcut Supabase projectte delete/update/grant daraltma
- consumer-zero öncesi legacy code/table/environment silme
- app review-ready, production-ready veya cutover-ready iddiası
- evidence olmadan RM/R/E bulgularını kapatma
- destructive cleanup veya retirement

Bu eylemler kendi paketleri, CI/evidence ve gerektiğinde ayrı açık insan kapıları tamamlanmadan yapılamaz.

## EO-01 başlangıç contract'ı

EO-01'in ilk teslimi production ürünü değil, temiz ve kanıtlanabilir bir preview shell'dir.

Zorunlu çıktılar:

1. ayrı repository ve branch protection/CI;
2. minimal, güncel resmî Shopify stack kararı;
3. temiz package manifest ve lockfile;
4. zero legacy/import/route/table/env negative tests;
5. App Bridge + Polaris web components shell;
6. üç canonical route için boş truthful state shell:
   - `/`
   - `/ad-analysis`
   - `/settings`
7. server-only config boundary;
8. preview-only Vercel deployment;
9. production domain ve Shopify app configuration mutation sayısı 0;
10. rollback: yeni preview artefactının devreden çıkarılması, legacy production'ın etkilenmemesi.

EO-01 ürün verisi çekmez, live token taşımaz ve Supabase business schema'sını kurmaz. Data-plane provisioning EO-02'nin exact migration/role contract'ına bağlanır; EO-01 yalnız gerekli bağlantı arayüzünü ve fail-closed config'i tanımlar.

## Sıra ve stop kapıları

```text
EO-F7 GO
  -> EO-01 clean shell
      -> EO-02 foundations
          -> EO-03 connection/token
              -> EO-04 providers
                  -> EO-05 data plane
                      -> EO-06 API
                          -> EO-07 UI
                              -> EO-08 parity/canary/rollback
                                  -> ayrı cutover kararı
                                      -> EO-09 consumer-zero
                                          -> EO-10 retirement
```

- EO-01 CI/negative build sınırı geçmeden EO-02 başlamaz.
- EO-02 authority, billing ve privacy foundation geçmeden provider runtime başlamaz.
- EO-05 finality/provenance geçmeden final API/UI yoktur.
- EO-08 parity ve rollback geçmeden production cutover yoktur.
- Cutover stabilizasyonu ve consumer-zero olmadan legacy retirement yoktur.

## Mevcut paketlere etkisi

- A6 audit bulguları kapanmaz; EO paketlerine kabul kapısı olarak taşınır.
- RM-01 canlı güvenlik kazanımı mevcut production containment hattında korunur.
- R6/R7/R8 evidence ve acceptance gereksinimleri yeni provider/UI/parity paketlerinde yeniden kullanılır; otomatik Done sayılmaz.
- E10 lifecycle/billing/UI kararları EO-02/EO-07 içinde temiz uygulanır.
- E11–E14, EO-06–EO-10 sırasına uyarlanır.
- Monoliti büyüten veya temiz ürün tarafından gereksiz kılınan remediation yapılmaz; yalnız production containment için zorunlu minimum iş kalır.

## Başarı tanımı

EO programı ancak aşağıdaki durumlarda review-ready olabilir:

- üç provider için truthful accepted data state;
- scheduler/finality/reconciliation kanıtı;
- 14 günlük trial/billing truth;
- mandatory privacy, Delete My Data, uninstall ve clean reinstall E2E;
- Funnel, Ad Analysis ve Settings desktop + gerçek mobile kabulü;
- side-by-side parity ve failure-injection rollback;
- hiçbir missing/unknown/unsupported verinin measured zero gösterilmemesi;
- production debug/operator/legacy route sayısı 0;
- açık ürün sahibi review-ready kararı.

## EO-F7 sonucu

**GO kabul edildi.**

- seçilen yol: embedded-only temiz yeniden kuruluş
- reddedilen yol: monoliti hedef ürün geliştirme zemini olarak onarmak
- EO-01 başlangıç yetkisi: açık
- yeni hedef project provisioning: EO-01/EO-02 package sınırında açık
- production cutover: kapalı
- live data/token carry: kapalı
- provider mutation: kapalı
- legacy deletion/retirement: kapalı
- sıradaki paket: **A6-EO-01 — Clean runtime shell, CI and dependency boundary**

