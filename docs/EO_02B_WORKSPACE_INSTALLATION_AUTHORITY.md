# EO-02-B — Çalışma alanı, kurulum ve kurulum nesli yetkisi

**Kontrol tarihi:** 6 Ekim 2026

**Durum:** Kabul edildi

## Analist sonucu

Bu paket Shopify mağazasının kimliğini AdsTable kiracı anahtarı yerine kullanmaz. Yetkili kiracı anahtarı `workspace_id` değeridir; Shopify Shop GID, doğrulanmış kurulum adaptörünün kimliğidir. Görünen mağaza alan adı yönlendirme ve doğrulama içindir; kalıcı sahiplik anahtarı değildir.

İlk doğrulanmış kurulum tek veritabanı işleminde bir çalışma alanı ve 1 numaralı kurulum nesli oluşturur. Aynı aktif kurulum yeniden açıldığında yeni çalışma alanı veya nesil oluşmaz. Uygulamayı kaldırma, 48 saatlik yeniden kurulum yarışı, tamamlanmış silme ve yeni nesil üretimi EO-02-D'nin yaşam döngüsü yetkisindedir. EO-02-B bu durumları kendiliğinden yeniden aktifleştirmez.

Bu belge 6 Ekim 2026'daki kabul kapsamını ve aşağıdaki 9 Ekim düzeltmesini birlikte anlatır. Teknik kiracı anahtarı ile mağazanın ticaret kaynağı olması farklı kavramlardır; düzeltme bunları birbirinin yerine geçirmez. Güncel proje durumu Execution Plan'dadır.

## Tarihsel resmî kaynak kontrolü

6 Ekim 2026 tarihinde:

- Shopify embedded istek kimliği App Bridge ID token ile doğrulanır.
- ID token API çağrısı yetkisi taşımaz; sunucu bunu erişim token'ına çevirir.
- Arka plan işleri çevrimdışı token gerektirir; herkese açık uygulamalarda süresi dolan çevrimdışı token modeli kullanılmalıdır.
- Admin GraphQL `shop` sorgusu, erişim token'ının bağlı olduğu Shop kaynağını `id` ve `myshopifyDomain` alanlarıyla doğrular.
- Kararlı Admin API tabanı `2026-10`'dur.
- Supabase/PostgreSQL tarafında özel şema, zorunlu RLS, dar nesne yetkisi, indeksli yabancı anahtar ve kısa atomik veritabanı işlemi uygulanır.

Kaynaklar:

- https://shopify.dev/docs/api/usage/versioning
- https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/shop
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Yetki akışı

1. Resmî Shopify adaptörü ID token'ı doğrular.
2. Sunucu, token değişimi/kimlik doğrulayıcı üzerinden Admin API yetkisi alır.
3. `shop { id myshopifyDomain }` sunucuda okunur.
4. ID token alan adı ile Admin API'deki mağaza alan adı farklıysa veritabanına hiçbir şey yazılmaz.
5. Shop GID başına, işlem kapsamlı danışma kilidi (transaction advisory lock) alınır.
6. İlk kayıt, çalışma alanını ve 1 numaralı kurulum neslini tek işlemde oluşturur.
7. Aktif kayıt zaten varsa aynı çalışma alanı ve nesil döner.
8. Alan adı değişmiş ama Shop GID aynı kalmışsa ikinci çalışma alanı oluşturulmaz; alan adı geçmişi yazılır.
9. Uygulamayı kaldırma/silme durumunda EO-02-D kararı olmadan kayıt yeniden aktifleştirilmez.

## Veri modeli

- `app.workspaces`: Yetkili kiracı kayıt defteri.
- `shopify.installations`: Shop GID, standartlaştırılmış alan adı, çalışma alanı bağı, kurulum nesli ve yaşam döngüsü durumu.
- `shopify.installation_domain_history`: Aynı Shop GID için doğrulanmış alan adı değişikliği izi.

Bütün tablolar özel şemadadır; RLS açıktır ve zorunlu uygulanır. `anon`, `authenticated`, `service_role` ve tarayıcı yolu kapalıdır. `adstable_runtime` doğrudan tablo değiştirme (DML) yetkisi almaz; yalnız iki dar sunucu fonksiyonunu çağırabilir. DELETE yetkisi verilmez.

## Durum matrisi

| Durum | Sonuç |
|---|---|
| ID token eksik/geçersiz | Güvenli ret; yazım yok |
| ID token alan adı ile Admin API'deki mağaza farklı | Güvenli ret; yazım yok |
| İlk doğrulanmış kurulum | Çalışma alanı + kurulum nesli 1 |
| Aktif kurulum tekrar çağrıldı | Aynı çalışma alanı + aynı nesil |
| Eski doğrulama zaman damgası | Ret; yazım yok |
| Kaldırma/silme bekliyor | EO-02-D olmadan yeniden aktifleştirme yok |
| Silinmiş kurulum geçmişi mevcut | Yeni nesil yalnız EO-02-D yetkisinde |

## Kapsam sınırı

Bu pakette görünür arayüz değişikliği yoktur. Ham HTML veya Polaris kararı üretilmez.

Açık metin token, sahte token kolonu veya geçici token deposu kurulmaz. Süresi dolan çevrimdışı token'ın yenilenmesi/döndürülmesi ve şifreli zarf EO-03-B'de uygulanır. EO-02-D'den önce kaldırma, silme veya temiz yeniden kurulum davranışı uygulanmış sayılmaz.

## Canlı kabul sonucu

- Migration geçmişi: 3/3 EO-02-B migration mevcut
- Yetki tabloları: 3; RLS açık ve zorunlu: 3/3
- Çalışma zamanının doğrudan tablo değiştirme yetkisi: 0
- Çalışma zamanının fonksiyon çalıştırma yetkisi: 2/2
- Data API fonksiyon çalıştırma yetkisi: 0
- Kendi test verisini temizleyen ilk kurulum, yinelenen işlem, eski doğrulama ve alan adı değişimi sınaması: PASS
- Sınama sonrası iş verisi satırı: 0
- Security Advisor: 0
- Performance Advisor: 0
- Kanıt: `docs/evidence/EO_02B_LIVE_ACCEPTANCE_2026-10-06.json`

## Kabul

- Migration, iş alanı servisi ve sözleşme aynı durum matrisini uygular.
- Eşzamanlı ilk kurulum yalnız bir aktif yetki kaydı oluşturur.
- Çağıranın gönderdiği kiracı iddiası servis arayüzünde yoktur.
- Shop GID kalıcı kimliktir; alan adı değişimi denetim izine yazılır.
- Çalışma zamanı yalnız fonksiyonlara erişir; doğrudan tablo değiştirme yetkisi taşımaz.
- Testler, derleme ve Governance CI geçer.
- Supabase canlı uygulaması açık kullanıcı onayıyla geçti.
- PR #6, Governance CI geçtikten sonra açık kullanıcı onayıyla merge edildi.
- Kabul merge commit'i: `edc9e21588f5a32bea139b754ea0108c9809cf27`.

## 9 Ekim 2026 — Kurulu mağaza yetkisi düzeltmesi

Shopify embedded çalışma alanının ticaret kaynağı, uygulamanın kurulu olduğu ve ID token ile Admin GraphQL `shop` yanıtı üzerinden doğrulanan Shopify mağazasıdır. Kimlik `Shop GID + canonical myshopifyDomain + install generation` üçlüsüdür; kullanıcı tarafından seçilemez veya değiştirilemez.

- Bir çalışma alanı yalnız bir kurulu Shopify mağazasına aittir.
- Sağlayıcı Reporting Account seçimi bu mağaza yetkisinin altındadır; mağazayı değiştiremez.
- Sağlayıcı varlıkları kurulu mağazaya kesin ve tekrarlanabilir biçimde bağlanamıyorsa hesap bağlı kalabilir, fakat veri raporlama yetkisi alamaz; Dataset V2 yazımı ve SnapshotJob güvenli biçimde durur.
- Pixel veya sağlayıcı alan adı mağaza yetkisini belirlemez.
- İkinci Shopify mağazası ayrı uygulama kurulumu, çalışma alanı ve abonelik gerektirir.
- WooCommerce, BigCommerce ve Magento bu Shopify embedded çalışma alanına ticaret kaynağı olarak bağlanamaz.

Bağlayıcı düzeltme: `contracts/eo-02bc-installed-shop-authority-correction-v1.json`.
