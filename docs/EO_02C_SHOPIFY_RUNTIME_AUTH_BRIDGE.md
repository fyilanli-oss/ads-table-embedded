# EO-02-C düzeltme kapısı — Shopify çalışma zamanı kimlik doğrulama köprüsü

**Kontrol tarihi:** 8 Ekim 2026

**O tarihteki durum:** Karar sabitlendi; uygulamadan önce makine tarafından denetlenen sözleşme bağlayıcıdır.

**Paket:** A6-EO-02-C içindeki düzeltme kapısıdır; yeni ana paket veya paralel çalışma hattı değildir.

Bu belge 8 Ekim 2026'daki eksikliği ve seçilen düzeltmeyi anlatır. “Yoktur” ifadeleri o aşamaya aittir; bugünkü uygulama envanteri değildir. Sonraki canlı kabul `docs/runbooks/EO_02C_LIVE_ACCEPTANCE_RUNBOOK.md`, güncel proje durumu Execution Plan üzerinden okunur. Bu belge yeni canlı işlem yetkisi vermez.

## Analist sonucu

EO-02-C'nin kalıcı kayıt adaptörü ve iç uzlaştırma çağırıcısı kodda hazırdı; fakat Production'da çağırıcıyı çalıştıracak doğrulanmış Shopify sunucu sınırı yoktu. Üç ürün adresi yalnız önizlemeydi. `shopify.server.ts`, `authenticate.admin(request)` kullanan ve adrese ek yol getirmeyen (pathless) Admin yerleşimi, kalıcı oturum deposu ve gerekli Production ortam değişkeni sözleşmesi bulunmuyordu.

Yalnız `ADSTABLE_RUNTIME_DATABASE_URL` ekleyip dağıtım yapmak canlı kalıcı kayıt kanıtı üretemez. Bu düzeltme kapısı geçmeden veritabanı gizli bilgisini etkinleştirmek yasaktır.

## Tarihsel resmî kaynak kontrolü

8 Ekim 2026 tarihinde:

- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
- https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
- https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts
- https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app.tsx

Resmî React Router sözleşmesinde embedded ürün adresleri kimliği doğrulanmış Admin yerleşimi altında çalışır. Her Admin isteği `authenticate.admin(request)` ile doğrulanır; framework kalıcı oturum deposunu kullanır; herkese açık uygulama süresi dolan çevrimdışı erişim token'ı modelini etkinleştirir.

## Düzeltme kapsamı

1. Adresleri değiştirmeyen, kimlik doğrulamalı pathless Admin yerleşimi.
2. Resmî `@shopify/shopify-app-react-router`, `shopifyApp` ve `authenticate.admin` sınırı.
3. Supabase özel şemada yalnız şifreli Shopify oturum zarfı.
4. `adstable_runtime` için yalnız fonksiyon çağıran oturum adaptörü; doğrudan tablo değiştirme (DML) yok.
5. Node `crypto` AES-256-GCM şifreleme; anahtar yalnız Vercel Production Secret'ta, sürümlü ve repository/log/tarayıcı dışında.
6. Süresi dolan çevrimdışı erişim token'ları.
7. Doğrulanmış ID token alan adıyla Admin GraphQL `shop { id myshopifyDomain }` kimliğinin eşleştirilmesi.
8. Doğrulanmış uygulama girişinde EO-02-C uzlaştırma çağırıcısının yinelendiğinde aynı sonucu koruyarak çalışması.
9. Gerçek Shopify Admin oturumu, Supabase kalıcı kaydı, tarayıcı/yanıt/log gizli bilgi taraması ve açık ürün sahibi kabulü.

## Arayüz için analist açıklaması

- **Kullanıcı amacı:** Kullanıcı AdsTable'ı Shopify Admin'de mevcut üç adres ve önizleme görünümüyle açar; kimlik doğrulama arka planda gerçekleşir.
- **Başlangıç:** Uygulama Shopify Admin içinden açılır; App Bridge ID token üretir.
- **Başarı:** İstek doğrulanır. Mevcut Funnel/Ad Analysis/Settings önizlemesi değişmeden gösterilir; yalnız sunucuda çalışan kullanım hakkı uzlaştırması yürür.
- **Hata:** Kimlik doğrulama veya kalıcı kayıt başarısızsa korunan veri gösterilmez; güvenli ret uygulayan hata sınırı kullanılır.
- **Değişmeyen arayüz:** Görünen metinler, adresler, Polaris 2.0 RC temeli ve mevcut önizleme içeriği.
- **Kapsam dışı:** Settings ürün davranışı, sağlayıcı OAuth/Reporting Account seçimi, yeni grafik veya yeni görsel bileşen.

### Tam Shopify bileşen eşlemesi

| Görünür öğe | Tam bileşen adı | Karar |
|---|---|---|
| Embedded sağlayıcı | `AppProvider`, `@shopify/shopify-app-react-router/react` paketinden | Resmî App Bridge/React Router sınırı |
| Sayfa/bölüm/metin/bağlantı | Mevcut `s-page`, `s-section`, `s-paragraph`, `s-link` | Görünüm ve metin değişmez |
| Kimlik doğrulama hatası | Framework'ün `boundary.error` ve `boundary.headers` işlevleri | Özel modal/buton/hata taklidi yok |
| Gezinme | Mevcut üç adres | Adres ve bilgi mimarisi değişmez |

Ham HTML eylem/form kontrolü, özel CSS, doğrudan renk değeri, özel bileşen ve herkese açık test uç noktası eklenmez.

## Çalışma zamanı ortam değişkeni sözleşmesi

| Anahtar | Tür | Kapsam |
|---|---|---|
| `SHOPIFY_API_KEY` | Config | Production |
| `SHOPIFY_API_SECRET` | Secret | Production |
| `SHOPIFY_APP_URL` | Config | Production |
| `SCOPES` | Config | Production |
| `ADSTABLE_SESSION_ENCRYPTION_KEY_V1` | Secret | Production |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Secret | Production |

Preview ve Development Production erişim bilgilerini alamaz. Gizli bilgi değeri sohbete, repository'ye, terminal argümanına, kanıta veya loga yazılmaz. Ortam değişikliği yeni Production dağıtımı olmadan etkin sayılmaz.

## Kabul kapıları

- Sözleşme ve olumsuz senaryo testleri geçer.
- Migration canlı Supabase'e ayrı açık kullanıcı onayıyla uygulanır.
- Oturum tablosunda açık metin token, yenileme token'ı, gizli bilgi veya JSON bulunmaz.
- Çalışma zamanının doğrudan tablo değiştirme yetkisi sıfırdır; yalnız izinli oturum ve kullanım hakkı fonksiyonları çalışır.
- `/`, `/ad-analysis`, `/settings` adresleri korunur.
- Kimliği doğrulanmamış/doğrudan istek güvenle reddedilir.
- Gerçek Shopify Admin masaüstü ve en az 320 px mobil kabulü geçer.
- Gerçek doğrulanmış istek çalışma alanı, kurulum, abonelik ve kullanım hakkı yansımalarını üretir.
- Gizli bilgi/tarayıcı/HTTP/uygulama/platform log taraması geçer.
- PR ve zorunlu CI geçer.
- EO-02-C yalnız açık ürün sahibi kapanış kararıyla kabul edilir.

## Geri alma

Yeni dağıtım Production otoritesi yapılmadan önce CI ve önizleme doğrulanır. Canlı hatada dağıtım geri alınır; yeni oturum/veritabanı gizli bilgisi kaldırılır veya yenilenir. Şifreli oturum satırları ilgili güvenli migration geri alma/saklama kararına göre ele alınır. Eski herkese açık önizleme dağıtımı güvenli geri dönüş noktasıdır.

Bu tarihsel geri alma planı, bugün gizli bilgi değiştirme veya dağıtım yapma yetkisi değildir.
