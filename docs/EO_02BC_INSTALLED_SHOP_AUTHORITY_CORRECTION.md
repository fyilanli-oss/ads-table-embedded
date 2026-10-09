# EO-02-B/EO-02-C — Kurulu Shopify mağazası otoritesi düzeltmesi

Karar tarihi: 9 Ekim 2026  
Yerleşim: EO-02-B ve EO-02-C corrective amendment; EO-02-D acceptance öncesi zorunlu kapı.

## Karar

Shopify embedded AdsTable workspace'inin commerce otoritesi, uygulamanın kurulu olduğu doğrulanmış Shopify mağazasıdır. Otorite `Shop GID + canonical myshopifyDomain + install generation` ile belirlenir.

Kullanıcı mağaza seçmez. Reporting Account, pixel, provider domaini veya başka bir commerce hesabı bu otoriteyi değiştiremez.

## İş kuralları

- Bir app installation = bir Shopify mağazası = bir workspace = bir subscription.
- İkinci Shopify mağazası için ayrı AdsTable kurulumu ve aboneliği gerekir.
- Shopify organic verisi yalnız kurulu mağazadan gelir.
- Meta, Google Ads ve Klaviyo Reporting Account seçimleri kurulu mağaza otoritesinin altındadır.
- Provider entity'leri kurulu mağazaya deterministik bağlanamıyorsa hesap bağlı kalabilir fakat reporting authority olamaz.
- Scope kanıtlanmadan Dataset V2 yazımı ve SnapshotJob çalışması yasaktır.
- Pixel yardımcı scope kanıtı olabilir; trust root değildir.
- WooCommerce, BigCommerce ve Magento bu Shopify embedded workspace'e commerce source olarak bağlanmaz. Gelecekte desteklenirse ayrı ürün, installation ve billing modeli gerekir.
- Geçmiş veri yeni mağazaya relabel edilmez.

## UI sonucu

Settings'te mağaza seçici veya değiştirici yoktur. Kurulu mağaza kimliği gerekirse yalnız “Shopify store” adıyla salt-okunur bağlam olarak gösterilebilir; ayrı ayar yüzeyi değildir.

## Database ve runtime düzeltmesi

Yeni ileri yönlü migration, entitlement projection'daki eski üç metadata kolonunu kaldırır ve `apply_shopify_app_pricing_snapshot` ile `resolve_workspace_entitlement` sonuçlarını yalnız gerçek entitlement verilerine indirger. Uygulanmış migration'lar ve tarihsel kabul kanıtları değiştirilmez.

Repository migration'ının varlığı canlı Supabase değişikliğine yetki vermez. Canlı uygulama, dependency/lock kontrolü, backup doğrulaması, staging veya kontrollü pencere, acceptance probe ve Security/Performance Advisor kontrolleri için ayrı açık onay gerektirir.

## Resmî kaynaklar

Kontrol tarihi: 9 Ekim 2026.

- Shopify ID tokens: https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- Shopify Admin GraphQL shop query: https://shopify.dev/docs/api/admin-graphql/latest/queries/shop
- Shopify authentication: https://shopify.dev/docs/apps/build/authentication-authorization
- Shopify organization stores: https://help.shopify.com/en/manual/organization-settings/expansion-stores
- Shopify app installation: https://help.shopify.com/en/manual/apps/installing-apps
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Supabase safe object deletion: https://supabase.com/docs/guides/database/postgres/data-deletion
