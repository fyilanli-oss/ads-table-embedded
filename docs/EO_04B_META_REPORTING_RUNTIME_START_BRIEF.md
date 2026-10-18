# EO-04-B Meta reporting runtime — first and second slices

## Status

- Product-owner runtime start authorization: **recorded 16 October 2026**
- First slice: **Meta Ad Channel daily raw Insights page**
- Second-slice authorization: **recorded 16 October 2026**
- Second slice: **Meta Ad + `product_id` daily raw Insights page**
- Live Meta request: **not authorized by this slice**
- Dataset V2, database, scheduler, UI, OAuth scope, secret, environment and deployment mutation: **forbidden**

## Why this slice is intentionally narrow

Meta's real Channel is the Ad. The first runtime slice therefore proves only the provider-native daily Ad-level request and opaque cursor boundary. It does not infer a product row, Sales Role or product Ad Cost.

The accepted product contract requires a real catalog response before product-breakdown impression, click and spend may be treated as exact provider product evidence. Product breakdown, Creative advertised-product evidence and Shopify product/variant verification remain separate next gates.

## Exact request

- Endpoint: `/{graph-version}/{ad-account-id}/insights`
- Graph version: `v26.0`
- OAuth scope remains exactly `ads_read`
- `level=ad`
- `time_increment=1`
- bounded inclusive `time_range`
- opaque `after` cursor only
- fields: account, Campaign, Ad Set and Ad identity/name; business dates; impressions, clicks, inline link clicks, outbound clicks, spend, actions and action values
- no `product_id` breakdown in this slice

## Output boundary

The runtime returns a provider-native page envelope:

- `fact_family=ad_channel_daily_insights`
- `channel_type=ad`
- untouched provider rows for later contract-controlled normalization
- next opaque cursor
- provider request ID
- query evidence without token or secret

This is not Dataset V2 and is not persisted.

## Failure rules

- Meta error `190` is `reauthorization_required` and is never retried.
- documented rate-limit classes are retryable classifications.
- provider/server transient failures are retryable classifications.
- malformed successful JSON or missing `data` fails closed as `provider_schema_changed`.
- a next page without a valid opaque cursor fails closed.
- an empty `data` array is a valid empty provider page; it is not fabricated as zero.

## Onaylı dar hata düzeltmesi — 18 Ekim 2026

Ürün sahibinin resmî Meta sayfalarından paylaştığı iki metin incelendi; bağımsız
HTTP erişimi başarılı ilan edilmez. Kaynaklar rate-limiting ve error-handling
sayfalarıdır; provenance ve GitHub koruma kanıtı
`docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json` içindedir.

- Raporlama izin hataları (`10`, `200–299`, tek başına HTTP `403`) token geçersizliği
  diye işaretlenmez; `permission_denied` sınıfı terminaldir. Hesap keşfinde `403`
  mevcut Graph hatası olarak korunur; bağlantı yenileme gerekçesi üretilmez.
- Açık `190` token hatası ve mevcut `401` davranışı korunur.
- `80000` ve `80004`, HTTP `403` ile gelse de kota sınıfıdır.
- Retryable sınıflandırması otomatik tekrar yetkisi değildir. İlk hata isteği
  sonlandırır; izin/kota hatasında lifecycle değiştirilmez, kalan sayfalar/veri
  aileleri çağrılmaz, kısmi sonuç yayımlanmaz.
- Sayısal kota, scheduler, BUC bekleme süresi parser'ı veya canlı çağrı eklenmez.

## Second slice — raw product breakdown

The second repository-only slice adds a separate Meta request with:

- `level=ad`;
- `breakdowns=product_id`;
- `time_increment=1`;
- a fixed operational `product_id_limit=100`;
- Ad hierarchy and business-date identity;
- raw `impressions`, `clicks`, `spend`, `converted_product_quantity` and `converted_product_value` fields.

Each returned product-breakdown row must contain a non-empty provider `product_id`. Other requested metrics remain untouched and may be absent or null. The runtime does not fabricate zeroes and does not normalize or classify those fields.

This slice still does **not** establish that product-breakdown impression, click or spend is exact product `Ad Cost`. Its evidence explicitly remains `validation_pending_real_catalog_response`. It also does not add Creative classification, Sales Role, Shopify identity verification, persistence, Dataset V2, scheduler or UI behavior.

## Next gate

Before a live request, the repository authority slice binds both pages to:

1. the verified active Shopify installation;
2. its connected canonical Meta authority;
3. exactly one selected Meta Reporting Account;
4. the server-only encrypted provider-token vault.

The merchant cannot supply or override an account ID, and neither token nor credential ID appears in the result/evidence. The Ad/Channel and product pages are returned together only after both requests succeed; a product-request failure publishes neither page. This slice performs no provider call or database write by itself.

After repository tests and product-owner review, a separately authorized live catalog-response validation may prove or reject the returned product-metric semantics. Only after that evidence may a later Meta-only slice add:

1. Creative/promoted-object exact advertised-product evidence;
2. Sales Role classification;
3. official Shopify Facebook & Instagram identity candidate verification;
4. exact product `Ad Cost` publication, only if the live evidence supports it.

No Google or Klaviyo runtime begins before the Meta provider slice is accepted.

## Official sources

Checked 16 October 2026:

- Meta official Business SDK — Ads Insights fields: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta official Business SDK — Ad Insights request parameters: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py>
- Shopify Admin GraphQL 2026-10 ProductVariant: <https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant>
- Shopify Admin GraphQL `productVariant` query: <https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant>
