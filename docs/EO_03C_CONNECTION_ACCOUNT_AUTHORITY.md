# EO-03-C — Bağlantı ve Reporting Account yetkisi

**O tarihteki durum:** Uygulama hazırlığı (Implementation)

**Kontrol tarihi:** 9 Ekim 2026

**Ana paket:** A6-EO-03

**Başlangıç kapısı:** EO-03-B kabulü

**O hazırlık aşamasındaki Production etkisi:** Yok

Bu belge EO-03-C'nin tarihsel uygulama kapsamını ve kabul kapılarını anlatır; bugünkü açık iş listesi değildir. Ana paketin kapanışı `docs/EO_03_ANALYSIS_DESIGN_BOOK.md`, güncel proje durumu Execution Plan üzerinden okunur. Yeni canlı işlem yetkisi vermez.

## Analist özeti

Sağlayıcı OAuth bağlantısının doğruladığı hesaplar AdsTable'ın tek yetkili bağlantı modeline alınır. Sağlayıcı hesabı yalnız reklam/raporlama veri kapsamını belirler. Ticaret kaynağı ve çalışma alanı yetkisi her zaman uygulamanın kurulu olduğu, Shopify ID token ve Admin API ile doğrulanmış mağazadır.

Sağlayıcı bağlantısı başka Shopify mağazası seçemez. İkinci mağaza ayrı uygulama kurulumu, çalışma alanı ve abonelik gerektirir. WooCommerce, BigCommerce ve Magento bu Shopify embedded çalışma alanına ticaret kaynağı eklenemez.

## Sağlayıcı davranışı

### Meta

- Sağlayıcının doğruladığı hesaplardan 1–3 tanesi bağlı hesap olarak saklanabilir.
- Funnel ve Ad Analysis için bağlı kümeden tam olarak bir Reporting Account seçilir.
- Kullanıcının elle yazdığı veya sağlayıcı kanıtında olmayan hesap kimliği kabul edilmez.
- Reporting Account değişikliği güncel sağlayıcı erişim kanıtı gerektirir.

### Google Ads

- Sağlayıcının doğruladığı hesaplardan 1–3 tanesi bağlı hesap olarak saklanabilir.
- Gerekli yönetici erişim yolu `login_account_id` ile korunur.
- Yönetici hesabı erişim kökü olabilir; reklamveren değilse Reporting Account olamaz.
- Funnel ve Ad Analysis için bağlı, raporlamaya uygun reklamveren hesaplardan tam olarak biri seçilir.

### Klaviyo

- OAuth token'ının ait olduğu tek hesap `Connected Account` olarak saklanır.
- Ayrı Reporting Account kontrolü yoktur.
- Hesap değişikliği basit seçim değildir; EO-03-D yeniden yetkilendirme yaşam döngüsünü gerektirir.

## Kanıt sınırı

EO-03-C sağlayıcı HTTP çağrısı yapmaz. EO-04 adaptörleri sonraki aşamada yanıtları okuyup kısa ömürlü `provider_account_access_verified` kanıtı üretir.

Bu kanıt:

- Sağlayıcıyla eşleşir.
- En fazla 10 dakika geçerlidir.
- Erişilebilir hesap kimlikleri ve raporlama uygunluğu taşır.
- Token, erişim bilgisi, ham sağlayıcı yanıtı, çalışma alanı veya kurulum nesli taşımaz.
- Güncelliğini yitirmiş, başka sağlayıcıya ait veya gizli bilgi içeriyorsa güvenle reddedilir.

EO-03-C kanıt tüketen güvenlik sınırıdır; EO-04 sağlayıcı sözleşmesini bilen üreticidir.

## Veritabanı modeli

### `integrations.provider_connections`

Bir çalışma alanı/kurulum nesli/sağlayıcı için tek yetkili bağlantıdır. Tam sağlayıcı erişim bilgisi zarfına başvurur. Zarf başka çalışma alanı, nesil veya sağlayıcıya aitse bağlantı kurulmaz.

### `integrations.provider_accounts`

Yalnız sağlayıcının doğruladığı ve kullanıcının seçtiği hesapları tutar. Token veya ham yanıt saklamaz.

### `integrations.reporting_account_bindings`

Meta ve Google için geçerlilik tarihli Reporting Account geçmişidir. Her bağlantıda yalnız bir aktif bağ bulunur. Seçim değişince eski kayıt kapanır, yenisi açılır; tarihsel Dataset yeniden yazılmaz.

Klaviyo bu tabloda bağ oluşturmaz.

## Güvenlik

- Tablolar özel `integrations` şemasındadır.
- RLS açıktır ve zorunludur.
- `public`, `anon`, `authenticated`, `service_role` ve çalışma zamanı doğrudan tabloya erişemez.
- Çalışma zamanı yalnız tam SECURITY DEFINER fonksiyonlarını çağırır.
- Fonksiyonların `search_path` değeri boştur.
- Her yazım aktif Shopify kurulumu, çalışma alanı, kurulum nesli, sağlayıcı ve erişim bilgisi yetkisini yeniden eşleştirir.
- Reporting Account değiştirme başarısızsa mevcut aktif seçim aynı işlem içinde korunur.

## Tarihsel resmî kaynaklar

9 Ekim 2026 tarihinde kontrol edilen konular:

- Shopify kimlik doğrulama ve mağaza bazlı erişim token'ı yetkisi
- Meta'nın resmî Marketing API Postman koleksiyonu
- Google Ads erişim modeli, `ListAccessibleCustomers` ve `login-customer-id`
- Klaviyo OAuth ve `accounts:read` Get Account işlemi
- Supabase değişiklik günlüğü, veritabanı fonksiyonları ve RLS

Makine sözleşmesi: `contracts/eo-03c-connection-account-authority-v1.json`.

## Bu hazırlıkta yapılmayanlar

- Canlı sağlayıcı OAuth veya hesap keşfi
- Canlı Supabase migration'ı
- Vercel ortam değişkeni/gizli bilgi değişikliği
- Settings arayüzü
- Dataset V2 veya SnapshotJob
- Yeniden bağlanma, bağlantıyı kesme, token yenileme, iptal ve yenileme yaşam döngüsü
- Reporting Store seçimi
- Production dağıtımı

Bu işlemler sonraki kendi kapıları ve açık yetkileri olmadan yapılamaz.

## Repository kabulü

1. Meta/Google için 1–3 bağlı hesap ve tek uygun Reporting Account kuralı sınanır.
2. Klaviyo için tek Connected Account ve raporlama kontrolü bulunmaması sınanır.
3. Güncel/eski kanıt, başka sağlayıcı/çalışma alanı ve gizli bilgi içeren kanıt kontrolleri çalışır.
4. Erişim bilgisi zarfı tam kurulum yetkisiyle eşleşir.
5. Yalnız fonksiyon erişimi, zorunlu RLS ve tek aktif raporlama bağı statik doğrulanır.
6. Repository testleri, tür kontrolü, derleme ve zorunlu CI geçer.
7. Canlı migration ve sağlayıcı yetkilendirmesi ayrıca açık onay alır.
8. Ürün sahibi EO-03-C'yi açıkça kapatır.
