# A6-EO-F1/F2 — Yetki kaynağı, canlı veri ve fiziksel proje sınırı

**Tarih:** 4 Ekim 2026  
**Tarihsel durum:** EO-F1 tamam; EO-F2 kararı donduruldu; EO-F3–F7 bekliyor

**Yöntem:** Salt okunur GitHub, Supabase ve Vercel incelemesi

**Gizlilik:** Token, gizli değer, kişisel veri (PII), hesap kimliği, mağaza alan adı veya satır içeriği okunmadı ve kaydedilmedi.

**Okuma notu:** Bu belge 4 Ekim 2026'da eski `fyilanli-oss/ads-table-dev` yapısında görülen durumu ve o gün verilen kararları kaydeder. Sayılar, eksikler ve “henüz oluşturulmadı” ifadeleri bugünkü temiz projenin durumu değildir. Sonraki EO-F4 veri katmanı kararı ve EO-F7 GO kabulü bu tarihsel sıranın devamıdır. Güncel durum ve uygulama yetkisi `docs/EXECUTION_PLAN.md` ile `contracts/a6-eo-implementation-master-v1.json` üzerinden okunur; bu dil düzenlemesi eski kapıları yeniden açmaz.

## İş çıktısı

Yalnız Shopify içine gömülü çalışan ürünün yeniden kuruluşunda hangi canlı kayıtların yetkili kaynak olarak korunacağı, hangilerinin eski yapıya ait olduğu ve temiz uygulamanın fiziksel olarak nerede kurulacağı belirlendi.

**İş değeri:** Ayrı derleme ve dağıtım sınırı, eski monolitin, emekli sağlayıcı gizli değerlerinin veya bağımsız uygulamaya ait müşteri modelinin yanlışlıkla yeniden etkinleşmesini önler. Canlı çalışma alanı, sağlayıcı yetkilendirmesi ve Dataset V2 verileri silinmez; sonraki veri taşıma kapısında değerlendirilir.

## Yönetici özeti

1. **EO-F1 tamamlandı:** Müşteri, kurulum, sağlayıcı yetkilendirmesi/token, Dataset, OAuth işlemi, faturalandırma ve iş yürütme kayıtlarının yetkili kaynakları sınıflandırıldı.
2. **EO-F2 kararı:** Hedef çalışma zamanı ayrı GitHub repository'si ve ayrı Vercel projesi olarak kurulacaktır.
3. **Canlı hizmetin devamlılığı:** Mevcut `ads-table-dev` Vercel projesi ve `dev.adstable.app` alan adı, yetkili geçişe kadar riski sınırlama ve geri dönüş hattı olarak değişmeden kalır.
4. **Veri katmanı kararı o gün açık:** Aynı Supabase projesinde en az yetkili rol/özel şema ile devam etme ve ayrı Supabase projesine kanonik veri taşıma seçenekleri EO-F4'te karşılaştırılacaktır.
5. **Yasak:** Mevcut karma Supabase projesinde geniş erişim sağlayan `SUPABASE_SERVICE_ROLE_KEY` yeni çalışma zamanına verilemez. Service role, satır düzeyi güvenliği (RLS) atlayabilir.
6. **O gün uygulama başlamadı:** Yeni repository, Vercel projesi, Supabase projesi, alan adı veya gizli değer oluşturulmadı/değiştirilmedi.

## İncelenen canlı sınırlar

### Supabase

- Proje: `adstable-dev`
- Proje referansı: `xnstrzhavqkztvmlwsrx`
- Durum: `ACTIVE_HEALTHY`
- Bölge: `ap-northeast-1`
- PostgreSQL: `17.6.1.121`
- Public tablo sayısı: 24
- Bütün public tabloların RLS bayrağı açık.
- O günkü değişiklik günlüğü kontrolünde yeni public tabloların Data API'ye otomatik açılmaması ve açık erişim yetkisi gereksinimi doğrulandı.
- `cron.job` ilişkisi mevcut değildir; veritabanındaki cron'un kanonik zamanlayıcı olduğu kanıtlanmadı.

### Vercel

- Ekip: `FIRAT's projects`
- Proje: `ads-table-dev`
- Uygulama çatısı: Express
- Node: 24.x
- Production dağıtımı: READY
- Production alan adı: `dev.adstable.app`
- Gizli değerler açılmadan görülen ortam değişkeni adı sayısı: 40
- Mevcut proje kök monoliti, eski HTML'i, gömülü uygulama rotasını ve cron'u aynı dağıtım sınırında birleştiriyor.

### GitHub

4 Ekim 2026 `main` ölçümü:

- 819 repository dosyası
- 305,537 bayt kök `server.js`
- 1,530,539 bayt `public/`
- 120 dosya / 561,776 bayt `src/`
- 203 test dosyası / 1,018,092 bayt `tests/`

## EO-F1 yetkili kaynak envanteri

Kanonik kaynak, yeni sistemin esas alacağı kayıt kaynağıdır. “Taşıma adayı” kesin taşıma onayı değildir.

| Alan | Canlı kayıt kaynağı | O günkü canlı durum | EO kararı |
|---|---|---|---|
| Kanonik müşteri/çalışma alanı | `workspaces` | 1 aktif | Yetkili kaynak olarak taşınacak |
| Çalışma alanı ayarları/para birimi | `workspace_settings` | 1 | Yetkili kaynak olarak taşınacak |
| Shopify kurulumu | `shopify_installations` | 1 aktif, nesil 1 | Yetkili kaynak olarak taşınacak; EO-F4 birebir eşlemesi gerekli |
| Kanonik sağlayıcı yetkilendirmeleri/token'ları | `workspace_provider_connections` | Meta, Google Ads, Klaviyo: 3 bağlı | Yetkili kaynak olarak taşınacak; yalnız şifreli zarflar |
| Gömülü uygulamanın geçiş dönemi bağlantı deposu | `shopify_workspace_provider_connections` | 1 | Yetkili kaynak olarak taşınmayacak; önce uzlaştırılacak, sonra emekliye ayrılacak |
| Dataset V2 | `performance_dataset_rows_v2` | 5 satır; 4 Klaviyo, 1 Meta; çalışma alanı boş 0; sentetik 0 | Taşıma adayı; kesinleşme ve veri kökeni doğrulaması gerekli |
| Klaviyo maliyet geçmişi | `workspace_provider_email_spend_history` | 4 satır | Yetkili kaynak olarak taşınacak |
| Eski kullanıcı–çalışma alanı eşleme onayı | `legacy_user_workspace_bindings` | 1 aktif eşleme | Yalnız taşıma kanıtı; çalışma zamanı yetkisi değil |
| OAuth işlemleri | `oauth_transactions` | 12/12 süresi dolmuş; tümü Shopify/çalışma alanına bağlı | Satırlar taşınmayacak; yaşam süresi (TTL)/temizlik deposu yeniden kurulacak |
| Eski müşteri modeli | `users` | 8 | Müşteri yetki kaynağı olarak taşınmayacak |
| Eski sağlayıcı yetkilendirmeleri | `platform_connections` + `platform_connection_tokens` | 8 bağlantı satırı / 6 token zarfı | Dondurulmuş eski kayıt; yeni çalışma zamanı erişemez |
| Eski hesap envanteri | `platform_ad_accounts`, `platform_businesses`, `platform_account_ownerships` | 12 / 0 / 12 | Yalnız tarihsel kanıt |
| Eski ayarlar | `user_settings` | 6 | Taşınmayacak |
| Eski faturalandırma/deneme | `subscriptions` | 7 | Kanonik değil; EO-02 çalışma alanı faturalandırması yerini almalı |
| Eski anlık görüntüler | `dashboard_snapshots` | 2,185 | EO-F4'e kadar salt okunur geçmiş |
| Eski veri kümesi | `performance_dataset_rows` | 4,947 | Kör kopyalama yok; yalnız R8 doğrulaması/sağlayıcıdan yeniden çekme |
| Eski iş kayıt defteri | `snapshot_jobs` | 2,392 | Zamanlayıcı yetki kaynağı olarak taşınmayacak |
| Eski zamanlamalar | `snapshot_schedules` | 10; hepsi pasif; 240 dakika | Taşınmayacak |
| Döviz kuru geçmişi | `fx_rates_daily` | 10,478 | Taşıma adayı; EO-F4'te sağlayıcı/veri kökeni kontrolü |
| Boş/ikincil depolar | `insight_logs`, `fx_rates`, `platform_businesses` | 0 | Yalnız hedef sözleşme gerektiriyorsa yeniden kurulacak |

## Sağlayıcı yetki kaynağı bulgusu

Kanonik çalışma alanı yetkisi yalnız kabul edilen üç sağlayıcıyla sınırlıdır:

- Meta: 1 bağlı
- Google Ads: 1 bağlı
- Klaviyo: 1 bağlı

Eski `platform_connections` o gün hâlâ şunları taşıyor:

- Google: 1 bağlı
- Klaviyo: 2 bağlı
- Meta: 1 bağlı
- Pinterest: 1 bağlı
- TikTok: 1 bağlı
- Google Sheets ve Organic: bağlantısı kesilmiş

Bu satırlar yeni çalışma zamanına verilirse yinelenen veya emekli yetki kaynakları tekrar etkinleşebilir. Bu nedenle yeni çalışma zamanı eski bağlantı/token tablolarına erişemez.

## Dataset V2 bulgusu

- Klaviyo: 4 satır, 26 Eylül–2 Ekim 2026
- Meta: 1 satır, 1 Ekim 2026
- Google Ads: 0 satır
- `workspace_id IS NULL`: 0
- `synthetic=true`: 0

Bu tablo kanonik taşıma adayıdır. Beş satırın varlığı raporlamanın eksiksizliği, verinin olgunluğu veya kesinleşmesi için PASS anlamına gelmez.

## Zamanlayıcı ve yaşam döngüsü boşlukları

O gün kanonik çalışma alanına bağlı iş/kiralama/ilerleme noktası tabloları yoktur.

Mevcut kayıt defteri:

- `snapshot_jobs`: eski kullanıcıya bağlı, 2,392 satır
- `snapshot_schedules`: eski kullanıcıya bağlı, 10 satır, tamamı pasif
- Vercel cron: saatte bir `/api/cron/auto-refresh`
- Veritabanı `cron.job`: yok

Canlı veritabanı yordam envanterinde yalnız şunlar bulundu:

- `complete_shopify_managed_install`
- `expire_trials`
- `r4c_reject_legacy_provider_write`

Kalıcı uninstall/gizlilik webhook işleme sahipliği, silme manifesti/çalıştırma/kanıt kaydı, temiz yeniden kurulum nesli, çalışma alanına bağlı iş kiralaması/ilerleme noktası ve kanonik faturalandırma yordamları yoktur. Bunlar EO-02 ve EO-05'in zorunlu temel çıktılarıdır.

## Faturalandırma/deneme boşluğu

O gün canlıda yalnız kullanıcıya bağlı `subscriptions` tablosu vardır. Çalışma alanına bağlı Shopify Billing yetkili kaynağı veya kullanım hakkı defteri bulunmamaktadır.

Sonuç:

- 14 günlük Shopify deneme süresi kararı korunur.
- Eski `subscriptions` yeni çalışma zamanına yetkili kaynak olarak taşınmaz.
- EO-02, Shopify kurulumu/çalışma alanına bağlı sürümlü faturalandırma ve kullanım hakkı modelini kurmadan review'a hazır olunamaz.

## Ortam değişkeni sınırı

O günkü Vercel projesi 40 değişken adı taşır. Yeni projeye alınmayacaklar:

- 10 TikTok değişkeni
- 3 Pinterest değişkeni
- 1 GA4 değişkeni
- `PROVIDER_TOKEN_LEGACY_READ_ENABLED`
- `ADSTABLE_CODEX_READONLY_TOKEN`
- eski yapıya, hata ayıklamaya, teste veya yalnız operatöre ait bütün değişkenler

Gizli değerler yeni projeye topluca kopyalanamaz. Her değişkenin sahibi, hedef ortamı, anahtar yenileme/geçiş ve geri dönüş kaydı gerekir. `SUPABASE_SERVICE_ROLE_KEY` mevcut karma projeye erişmek üzere yeni çalışma zamanına verilemez.

## EO-F2 seçenek karşılaştırması

Puan: 1 zayıf, 5 güçlü. Yüksek puan daha güvenli/uygundur.

| Kriter | Aynı repository / ayrı dağıtım kökü | Ayrı repository + ayrı Vercel |
|---|---:|---:|
| Eski import/derleme bağımlılıklarını yalıtma | 2 | 5 |
| Gizli değer ve ortam yalıtımı | 2 | 5 |
| CI ve dağıtım bağımsızlığı | 3 | 5 |
| Yanlış rota/statik dosya dahil etme riski | 2 | 5 |
| Bağımsız geri dönüş/yetki geçişi | 3 | 5 |
| Mevcut geçmiş/sözleşme keşfinin kolaylığı | 5 | 3 |
| Başlangıç operasyon yükü | 4 | 3 |
| **Toplam** | **21/35** | **31/35** |

Geçmişe ve sözleşmelere erişim, eski repository'yi salt okunur yetki/kanıt kaynağı olarak tutup yalnız onaylı dosyaları köken kaydıyla başlangıca alarak korunabilir. Buna karşılık aynı repository'deki yanlış import, derleme dosya kalıbı, gizli değer ve rota sızıntısı riskinin hata halinde kapalı kalacağı kanıtlanamaz.

## EO-F2 bağlayıcı karar

Uygulama için GO verilirse:

1. Yeni ve ayrı bir GitHub repository'si oluşturulur.
2. Bu repository'ye bağlı yeni ve ayrı bir Vercel projesi oluşturulur.
3. İlk dağıtım yalnız Preview olur; `dev.adstable.app` taşınmaz.
4. Mevcut Vercel projesi Production/geri dönüş hattı olarak kalır.
5. Yeni repository eski repository'nin fork'u veya toplu kopyası olmaz.
6. Başlangıca yalnız şunlar alınır:
   - yeni Execution Plan özeti,
   - EO sözleşmeleri,
   - Shopify UI Anayasası,
   - temiz paket/derleme/CI tanımları,
   - EO-F3 izin listesiyle kabul edilen modüller.
7. Eski repository geçmişi, köken URL/SHA kaydıyla referanslanır.
8. Shopify uygulama kimliği, yönlendirme URI'si ve alan adı geçişi kararı EO-F5/EO-08'de verilir.
9. EO-F4 Supabase veri katmanı seçimi tamamlanmadan çalışma zamanına kimlik bilgisi verilmez.

## Supabase veri katmanı durma kapısı

O gün değerlendirilecek iki güvenli aday vardır:

### A — Mevcut Supabase + özel en az yetki sınırı

- Yeni çalışma zamanı için ayrı Postgres rolü/özel şema veya eşdeğer dar yetki
- Yalnız izin listesindeki tablo/fonksiyon erişim yetkileri
- `service_role` yok
- Tarayıcı Data API kullanacaksa açık erişim yetkisi + RLS
- Eski tablolar için sıfır yetki
- Kimlik bilgisi yenileme ve yetki kaldırma planı

### B — Ayrı Supabase projesi

- Kanonik şema temiz migration geçmişiyle kurulur
- Yalnız EO-F4 onaylı satırlar uzlaştırma kanıtıyla taşınır
- Eski proje geri dönüş/salt okunur geçmiş olarak kalır
- Token zarfının anahtar/şifreleme geçişi ve Shopify kurulum devamlılığı ayrıca kanıtlanır

EO-F4 bu iki seçeneği güvenlik, taşıma riski, kesinti süresi, geri dönüş ve operasyon maliyetiyle karşılaştırıp tek karar verir.

## Resmî kaynak kontrolü

Aşağıdaki bağlantılar 4 Ekim tarihsel incelemesinin kaynaklarıdır; yeni canlı inceleme yapıldığı anlamına gelmez.

- [Supabase değişiklik günlüğü — uyumluluğu bozan değişiklikler](https://supabase.com/changelog?types=breaking-change)
- [Supabase satır düzeyi güvenliği](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Postgres rolleri](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase veri güvenliği](https://supabase.com/docs/guides/database/secure-data)

`service_role` RLS'yi atlayabildiği için “aynı veritabanı ama yeni Vercel projesi” tek başına veri yalıtımı değildir.

## O günkü sonraki kapı

EO-F3 — Kod/bağımlılık taşıma izin listesi:

- hedef modüllerin dolaylı import grafiği;
- aynen taşı / davranışı çıkarıp yeniden yaz / yalnız sözleşmeyi al / emekliye ayır sınıflaması;
- yasak sağlayıcı ve eski bağımlılıkların derlemeye dahil edilmemesi;
- temiz paket tanımı ve CI sınırı.

EO-F3 tamamlanmadan yeni repository oluşturulmaz. Bu son ifade tarihsel kuruluş sırasıdır; güncel proje ilerlemesi Execution Plan'dan okunur.

