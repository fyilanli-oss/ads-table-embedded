# EO-03-C — Connection and Reporting Account Authority

**Durum:** Implementation  
**Kontrol tarihi:** 9 Ekim 2026  
**Parent:** A6-EO-03  
**Başlangıç kapısı:** EO-03-B Accepted  
**Production etkisi:** Yok

## Analist özeti

Bu paket provider OAuth bağlantısının doğruladığı hesapları AdsTable'ın canonical bağlantı otoritesine dönüştürür. Provider hesabı yalnız reklam/raporlama veri kapsamını belirler. AdsTable'ın commerce ve workspace otoritesi her zaman uygulamanın kurulu olduğu, Shopify ID token ve Admin API ile doğrulanmış mağazadır.

Provider bağlantısı başka bir Shopify mağazasını seçemez. İkinci Shopify mağazası ayrı app installation, workspace ve subscription gerektirir. WooCommerce, BigCommerce ve Magento bu Shopify embedded workspace'e commerce source olarak eklenemez.

## Provider davranışı

### Meta

- Provider tarafından doğrulanmış hesaplardan 1–3 tanesi bağlı hesap olarak saklanabilir.
- Funnel ve Ad Analysis için bağlı kümeden tam bir Reporting Account seçilir.
- Merchant tarafından yazılmış veya provider kanıtında bulunmayan account ID kabul edilmez.
- Reporting Account değişikliği taze provider erişim kanıtı gerektirir.

### Google Ads

- Provider tarafından doğrulanmış hesaplardan 1–3 tanesi bağlı hesap olarak saklanabilir.
- Manager erişim yolu gerekiyorsa `login_account_id` ile korunur.
- Manager hesap erişim kökü olabilir; advertiser değilse Reporting Account olamaz.
- Funnel ve Ad Analysis için bağlı ve eligible advertiser hesaplardan tam biri seçilir.

### Klaviyo

- OAuth tokenının ait olduğu tek hesap `Connected Account` olarak saklanır.
- Ayrı Reporting Account kontrolü yoktur.
- Hesap değişikliği basit seçim değildir; EO-03-D reauthorization yaşam döngüsünü gerektirir.

## Kanıt sınırı

EO-03-C provider HTTP çağrısı yapmaz. EO-04 adapterları daha sonra provider cevaplarını okuyup kısa ömürlü `provider_account_access_verified` kanıtı üretecektir.

Bu kanıt:

- provider ile eşleşir;
- en fazla 10 dakika geçerlidir;
- erişilebilir hesap kimliklerini ve raporlama uygunluğunu taşır;
- token, credential, raw provider cevabı, workspace veya install-generation taşımaz;
- stale, cross-provider veya secret-bearing ise fail-closed reddedilir.

Bu ayrım EO-03-C'nin kanıt tüketen güvenlik sınırı; EO-04'ün ise provider sözleşmesini bilen üretici olmasını sağlar.

## Veritabanı modeli

### `integrations.provider_connections`

Bir workspace/install-generation/provider için tek canonical bağlantıdır. Exact provider credential envelope'a referans verir. Credential başka workspace, generation veya provider'a aitse bağlantı kurulmaz.

### `integrations.provider_accounts`

Yalnız provider tarafından doğrulanmış ve merchant tarafından seçilmiş hesapları tutar. Token veya raw response saklamaz.

### `integrations.reporting_account_bindings`

Meta ve Google için effective-dated Reporting Account tarihçesidir. Her bağlantıda yalnız bir aktif binding bulunur. Seçim değişikliği eski kaydı kapatır, yenisini açar; tarihsel Dataset'i yeniden yazmaz.

Klaviyo bu tabloda binding oluşturmaz.

## Güvenlik

- Tablolar private `integrations` şemasındadır.
- RLS enabled ve forced'dır.
- `public`, `anon`, `authenticated`, `service_role` ve runtime doğrudan tablo erişimine sahip değildir.
- Runtime yalnız exact SECURITY DEFINER fonksiyonlarını çağırabilir.
- Fonksiyonların `search_path` değeri boştur.
- Her write aktif Shopify installation, workspace, install generation, provider ve credential authority eşleşmesini yeniden doğrular.
- Reporting Account switch başarısız olursa mevcut aktif seçim aynı transaction içinde korunur.

## Resmî kaynaklar

9 Ekim 2026 tarihinde kontrol edildi:

- Shopify authentication ve mağaza-bazlı access-token otoritesi
- Meta'nın resmî Marketing API Postman koleksiyonu
- Google Ads access model, `ListAccessibleCustomers` ve `login-customer-id`
- Klaviyo OAuth ve `accounts:read` Get Account
- Supabase changelog, database functions ve Row Level Security

Executable contract: `contracts/eo-03c-connection-account-authority-v1.json`.

## Bu dilimde yapılmayanlar

- Canlı provider OAuth veya account discovery
- Canlı Supabase migration
- Vercel environment/secret değişikliği
- Settings UI
- Dataset V2 veya SnapshotJob
- Reconnect, disconnect, refresh, revoke ve renewal
- Reporting Store seçimi
- Production deploy

Bu işlemler kendi ileriki kapıları ve açık yetkileri olmadan yapılamaz.

## Repository kabulü

1. Meta/Google 1–3 connected account ve tek eligible Reporting Account kuralı test edilir.
2. Klaviyo tek Connected Account ve reporting-control-yok kuralı test edilir.
3. Fresh evidence, stale evidence, cross-provider, cross-workspace ve secret-bearing negatif kontroller çalışır.
4. Credential envelope exact installation authority ile eşleşir.
5. Function-only, forced-RLS ve tek aktif reporting binding statik olarak doğrulanır.
6. Repository testleri, typecheck, build ve zorunlu CI PASS olur.
7. Canlı migration ve provider authorization ayrıca açık onay alır.
8. Ürün sahibi EO-03-C'yi açıkça kapatır.
