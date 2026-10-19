# EO-03-B — Token zarfı ve başlangıç koruması

**Kontrol tarihi:** 9 Ekim 2026

**Durum:** Kabul edildi — repository, canlı veritabanı, Production başlangıç ve ürün sahibi kapıları geçti.

**Ana paket:** A6-EO-03 — Tek yetkili OAuth, bağlantı ve token kasası

Bu belge 9 Ekim 2026'daki kapsam ve kabulü anlatır. İlk hazırlık kapsamı ile ayrı onaylı canlı işlemler ayrı kayıtlardır. Supabase Vault'un sürüm durumu dahil dış platform açıklamaları tarihsel kontrolü yansıtır; güncel proje durumu Execution Plan'dadır. Yeni canlı işlem yetkisi verilmez.

## Analist sonucu

Geri alınabilir OAuth PKCE doğrulayıcısı veya ilerideki sağlayıcı token kümesi, veritabanında okunabilir metin olarak saklanmaz. AdsTable değeri sunucuda şifreler; tam çalışma alanı, Shopify kurulum nesli, sağlayıcı, amaç ve kayda bağlar. Yalnız bütünlüğü doğrulanabilen şifreli zarf kalıcılaşır.

Yetkilendirme başlamadan çalışma zamanı şunları kanıtlar: beklenen veritabanı sözleşmesi sürümü, mevcut kayıtlardaki bütün anahtar sürümlerinin kullanılabilirliği, Shopify oturum anahtarından farklı aktif sağlayıcı-token anahtarı ve başarılı şifreleme öz testi. Başarısızlıkta açık metne, başka anahtara veya doğrulanmamış mağazaya geçilmez; yetkilendirme durur.

Kabul edilen paket, özel Production anahtarını oluşturup onaylı Supabase migration'larını uyguladı ve Production başlangıç korumasını doğruladı. Buna rağmen sağlayıcı bağlamaz, gerçek sağlayıcı token'ı taşımaz ve canlı sağlayıcı OAuth izni vermez.

## Tarihsel resmî kaynak kontrolü

9 Ekim 2026 tarihinde:

- Node.js Crypto — doğrulamalı şifreleme, `createCipheriv`, `setAAD`, `getAuthTag`, `setAuthTag`:
  https://nodejs.org/api/crypto.html
- Supabase veritabanı güvenliği — özel şemalar, RLS ve fonksiyon güvenlik sınırı:
  https://supabase.com/docs/guides/database/database-security
- Supabase Vault — o kontrolde herkese açık alfa sürümündeydi; yeterince yetkili veritabanı rollerine çözülmüş görünüm açıyordu:
  https://supabase.com/docs/guides/database/vault
- Supabase pgcrypto emeklilik/geçiş rehberi — PostgreSQL 17 değişimi eski `pgcrypto` şifreleme fonksiyonlarıyla ilgilidir. EO-03-B uygulama düzeyinde Node AES-GCM kullanır:
  https://supabase.com/docs/guides/troubleshooting/pgcrypto-deprecation-and-data-migration-guide
- Vercel ortam değişkenleri — yalnız sunucuya özel hassas değerler ve ortam kapsamı:
  https://vercel.com/docs/environment-variables

## Güvenlik kararı

### Kök anahtar

- Sağlayıcı-token kök anahtarı özel, rastgele 32 baytlık anahtardır.
- Shopify oturum şifreleme anahtarı değildir; aynı anahtarı kullanma reddedilir.
- Production değerleri yalnız Vercel Sensitive ortam değişkenlerinde bulunur.
- Veritabanı kök anahtarı saklamaz veya döndürmez.
- Aktif sürüm `ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION` ile seçilir.
- Anahtar malzemesi `ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V<n>` adlandırmasını kullanır.
- Yeni yazımlar aktif sürümü kullanır; bütün zarflar yeni anahtara geçirilene kadar eski sürümler okunabilir kalır.

O tarihteki alfa ve çözülmüş görünüm modeli görev ayrımını iyileştirmediğinden Supabase Vault anahtarların birincil deposu seçilmedi.

### Zarf

- Algoritma: AES-256-GCM.
- Nonce: her zarf için 12 rastgele bayt.
- Kimlik doğrulama etiketi: 16 bayt.
- Bağlı veri; sözleşme sürümü, anahtar sürümü, kayıt kimliği, çalışma alanı, kurulum nesli, sağlayıcı ve amacı birlikte bağlar.
- Şifreli metni başka kiracı, nesil, sağlayıcı, amaç veya kayda taşımak doğrulamayı bozar.
- Şifre çözme hatası genel kasa doğrulama hatası döndürür; gizli malzeme loglanmaz.

## Veritabanı modeli

### PKCE zarfları

`integrations.oauth_pkce_envelopes`, Google Ads ve Klaviyo PKCE doğrulayıcıları için yalnız şifreli metin üst verisi saklar.

Kayıt OAuth işlemiyle birebirdir; tam aktif Shopify kurulum yetkisine bağlıdır. EO-03-A dönüşü atomik sahiplenince EO-03-B, zarfı sunucuya döndürürken tek işlemde doğrulayıp siler. İkinci alma sonuç döndürmez. Süresi dolmuş veya yetkisi uyuşmayan kayıt dönmez.

### Sağlayıcı erişim bilgisi zarfları

`integrations.provider_credential_envelopes`, ilerideki Meta, Google Ads ve Klaviyo token kümelerinin yalnız şifreli saklama sınırıdır. EO-03-B sınırı hazırlar; bağlantıyı etkinleştirme, kod değişimi, yenileme ve iptal EO-03-C/D ile sağlayıcı paketlerinin sorumluluğudur.

İki tablo da:

- Özel `integrations` şemasındadır.
- RLS'yi açar ve zorunlu uygular.
- Tarayıcı rolleri, `service_role` ve `adstable_runtime` için doğrudan erişimi kapatır.
- Çalışma zamanından yalnız boş `search_path` taşıyan tam `SECURITY DEFINER` fonksiyonlarıyla erişilir.
- Tam Shopify kurulum neslinden kademeli silinir.
- Açık metin erişim token'ı, yenileme token'ı veya PKCE doğrulayıcı kolonu içermez.

## Başlangıç koruması

Aşağıdakiler sağlanmadan sağlayıcı yetkilendirmesi veya token kullanımı reddedilir:

1. Veritabanı sözleşme sürümü tam olarak 1'dir.
2. Aktif anahtar sürümü vardır.
3. Saklanan zarfların kullandığı her anahtar sürümü okunabilirdir.
4. Sağlayıcı-token ve Shopify oturum anahtarları farklıdır.
5. Bellekte AES-GCM şifrele/aç öz testi geçer.

Koruma yalnız başarıdan sonra önbelleğe alınır. Başarısızlık başarı diye saklanmaz; sessiz koruma düşürme yoktur.

## Ortam değişkeni sözleşmesi

Aşağıdaki teknik örnek gerçek anahtar değildir; adlar ve yer tutucu aynen korunur:

```text
ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION=1
ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1=<32 random bytes, base64url>
```

Sürüm numarası yapılandırmadır. Her `...ENCRYPTION_KEY...` değeri gizlidir: commit edilemez, yazdırılamaz, tarayıcıya döndürülemez veya Supabase satırlarına kopyalanamaz.

## Kapsam

Dahil:

- Sürümlü, yalnız sunucuda anahtar kümesi;
- Doğrulamalı şifreleme ve bağlama;
- Yalnız şifreli PKCE/token kümesi şeması;
- Atomik, tek kullanımlık PKCE alma;
- Aktif kurulum yetkisi kontrolleri;
- Yalnız fonksiyon çağıran çalışma zamanı erişimi;
- Başlangıç koruması;
- Repository testleri ve makine sözleşmesi.

İlk repository hazırlığında kapsam dışı olanlar:

- Canlı veritabanı migration'ı;
- Vercel gizli bilgisi oluşturma;
- Gerçek sağlayıcı erişim bilgisi veya OAuth;
- Sağlayıcı değişim, yenileme, iptal ve bağlantıyı kesme işlemleri;
- Raporlama hesabı seçimi;
- Production dağıtımı.

Bu ilk liste, aşağıdaki ayrı onaylı canlı kabulün yapılmadığı anlamına gelmez.

## Kabul sırası

1. Repository uygulaması, testler, tür kontrolü, derleme ve CI geçer.
2. Ürün sahibi sonucu inceler; canlı kapıya ayrıca izin verir veya reddeder.
3. Yetki verilirse kaynak kontrolü dışında yeni Production sağlayıcı-token anahtarı üretilir; Vercel Sensitive değeri olarak saklanır.
4. Tam migration onaylı Supabase projesine uygulanır.
5. Salt okunur şema, yetki, RLS, anahtar sürümü ve Advisor kontrolleri yapılır.
6. Gerçek token olmadan, yalnız sentetik şifreli kasa sınaması yapılır; bütün sınama satırları kaldırılır.
7. Dağıtılmış başlangıç koruması doğrulanır.
8. Kalıcı kanıt ve açık ürün sahibi kapanışı gerekir.

Repository merge'ü tek başına kabul değildir; 3–7. adımları yetkilendirmez.

## Production kabulü — 9 Ekim 2026

Ayrı onaylı canlı kapı, gerçek sağlayıcı token'ı veya canlı OAuth olmadan tamamlandı:

- `20261009113645_eo03b_token_vault` ve `20261009115314_eo03b_pkce_workspace_fk_index` Supabase migration'ları canlıdır.
- Özel anahtar ve aktif anahtar sürümü yalnız Vercel Production Sensitive değerleridir; geri okunmadı, yazdırılmadı veya commit edilmedi.
- `07e5396badb839b6d8bac290afa2bf058c193485` commit'inin `dpl_JDGeSSRYZNshT5m5bMHYHS4bBtts` dağıtımı adres eşleme hatası olmadan `READY` oldu.
- Benzersiz dağıtım adresi ve `embedded.adstable.app` Shopify çalışma zamanını başlattı; kontrol pencerelerinde Vercel çalışma zamanı hatası sıfırdı.
- Başarılı başlangıçtan sonraki kimliksiz kök yanıtı HTTP 410 beklenen sonuçtur; başlangıç koruması hatası değildir.

## Yalnız sentetik şifreli kasa sınaması — 9 Ekim 2026

Ayrı onaylı tek PostgreSQL işlemi, sağlayıcı erişim bilgisi olmadan Production fonksiyon sınırını sınadı:

1. Ön kontrol, yönetim çağırıcısının çalışma zamanı fonksiyonlarını çalıştıramadığını ve `adstable_runtime` rolüne geçemediğini kanıtladı.
2. Kontrollü işlemde rol üyeliği yalnız tam çalışma zamanı rolüyle yürütmeye yetecek süre için verildi.
3. Sabit sentetik erişim bilgisi kimliği ile içi yorumlanmayan şifreli metin/nonce/etiket, tek aktif kurulum yetkisi altında saklandı.
4. Doğru bağlamla yükleme tam bir zarf döndürdü.
5. Sağlayıcı değiştirme sıfır zarf döndürdü.
6. Silme true döndürdü; ikinci yükleme sıfır zarf döndürdü.
7. İşlem, commit öncesi geçici rol üyeliğini kaldırdı.
8. Bağımsız son kontrol:
   - `postgres`, `adstable_runtime` üyesi değildir.
   - `postgres` korumayı hâlâ çalıştıramaz.
   - `adstable_runtime` çalıştırabilir.
   - PKCE zarf satırı: 0.
   - Sağlayıcı erişim bilgisi zarf satırı: 0.
   - Supabase Security Advisor bulgusu: 0.

Sınama gerçek erişim token'ı, yenileme token'ı, yetkilendirme kodu, PKCE doğrulayıcı, müşteri kaydı veya kişisel veri içermedi. Uygulamanın Production başlangıç koruması gerçek Vercel anahtar kümesini ve AES-GCM öz testini ayrıca kanıtladı; veritabanı sınaması yalnız fonksiyon erişimli kalıcı kayıt sınırını kanıtladı.

Makine kanıtı: `docs/evidence/EO_03B_PRODUCTION_ACCEPTANCE_2026-10-09.json`.

## Ürün sahibi kapanışı — 9 Ekim 2026

Repository, canlı şema, Vercel başlangıcı ve sentetik şifreli saklama kanıtları geçtikten sonra ürün sahibi EO-03-B'yi açıkça kabul etti.

O tarihte tek sonraki alt paket **EO-03-C — Bağlantı ve raporlama hesabı yetkisi** hazırdı. EO-03-C/D ilgili yaşam döngüsünü kurup kabul edene kadar canlı sağlayıcı yetkilendirmesi kapalı kalıyordu.
