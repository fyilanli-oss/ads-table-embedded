# EO-02-B/EO-02-C — Kurulu Shopify mağazası yetkisi düzeltmesi

**Karar tarihi:** 9 Ekim 2026

**Yerleşim:** EO-02-B ve EO-02-C için düzeltici ek; EO-02-D kabulü öncesinde zorunlu kapı.

Bu belge 9 Ekim 2026'da kabul edilen düzeltmeyi anlatır; güncel proje durumu Execution Plan'dadır. Dokümantasyon çevirisi yeni veritabanı veya canlı işlem yetkisi vermez.

## Karar

Shopify embedded AdsTable çalışma alanının ticaret kaynağı, uygulamanın kurulu olduğu doğrulanmış Shopify mağazasıdır. Yetki `Shop GID + canonical myshopifyDomain + install generation` ile belirlenir: kalıcı mağaza kimliği, standartlaştırılmış mağaza alan adı ve kurulum nesli birlikte kullanılır.

Kullanıcı mağaza seçmez. Reporting Account, pixel, sağlayıcı alan adı veya başka ticaret hesabı bu yetkiyi değiştiremez.

## İş kuralları

- Bir uygulama kurulumu = bir Shopify mağazası = bir çalışma alanı = bir abonelik.
- İkinci Shopify mağazası için ayrı AdsTable kurulumu ve aboneliği gerekir.
- Shopify organik verisi yalnız kurulu mağazadan gelir.
- Meta, Google Ads ve Klaviyo Reporting Account seçimleri kurulu mağaza yetkisinin altındadır.
- Sağlayıcı varlıkları kurulu mağazaya kesin ve tekrarlanabilir biçimde bağlanamıyorsa hesap bağlı kalabilir, fakat veri raporlama yetkisi alamaz.
- Kapsam kanıtlanmadan Dataset V2 yazımı ve SnapshotJob çalışması yasaktır.
- Pixel, kapsamı destekleyen kanıt olabilir; güvenin temel kaynağı değildir.
- WooCommerce, BigCommerce ve Magento bu Shopify embedded çalışma alanına ticaret kaynağı olarak bağlanmaz. Gelecekte desteklenirse ayrı ürün, kurulum ve faturalandırma modeli gerekir.
- Geçmiş veri, yeni mağazaya aitmiş gibi yeniden etiketlenmez.

## Arayüz sonucu

Settings'te mağaza seçici veya değiştirici yoktur. Kurulu mağaza kimliği gerekirse yalnız “Shopify store” adıyla salt okunur bağlam olarak gösterilebilir; ayrı ayar yüzeyi değildir.

## Veritabanı ve çalışma zamanı düzeltmesi

Yeni, ileri yönlü migration; kullanım hakkı (entitlement) yansıtmasındaki eski üç metadata kolonunu kaldırır. `apply_shopify_app_pricing_snapshot` ve `resolve_workspace_entitlement` sonuçları yalnız gerçek kullanım hakkı verilerini içerir. Uygulanmış migration'lar ve tarihsel kabul kanıtları değiştirilmez.

Repository'de migration bulunması canlı Supabase değişikliğine yetki vermez. Canlı uygulama için ayrı açık ürün sahibi onayı gerekir.

## Canlı uygulama sonucu

9 Ekim 2026'da ayrı açık ürün sahibi onayı alındı. Ön kontrolde bekleyen kilit ve 30 saniyeden uzun veritabanı işlemi bulunmadı; üç eski kolona bağlı yalnız kendi kontrol kısıtları görüldü.

Migration, Supabase'e `20261009070314 / eo02bc_installed_shop_authority` olarak uygulandı. Son kontrolde:

- Eski kolon sayısı sıfırdı.
- Kullanım hakkı satır sayısı değişmeden bir kaldı.
- İki çalışma zamanı fonksiyonu `adstable_owner` sahipliğinde, `SECURITY DEFINER` ve boş `search_path` ile yeniden kurulmuştu.
- `EXECUTE` yetkisi yalnız `adstable_owner` ve `adstable_runtime` rollerindeydi.
- Security Advisor bulgusu sıfırdı.

Kanıt: `docs/evidence/EO_02BC_INSTALLED_SHOP_AUTHORITY_LIVE_2026-10-09.json`.

## Tarihsel resmî kaynaklar

Kontrol tarihi: 9 Ekim 2026.

- Shopify ID token'ları: https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- Shopify Admin GraphQL mağaza sorgusu: https://shopify.dev/docs/api/admin-graphql/latest/queries/shop
- Shopify kimlik doğrulama: https://shopify.dev/docs/apps/build/authentication-authorization
- Shopify organizasyon mağazaları: https://help.shopify.com/en/manual/organization-settings/expansion-stores
- Shopify uygulama kurulumu: https://help.shopify.com/en/manual/apps/installing-apps
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Supabase güvenli nesne silme: https://supabase.com/docs/guides/database/postgres/data-deletion
