# A6-EO-04-C — Google 2026 erişim ve review düzeltmesi

**Kontrol tarihi:** 17 Ekim 2026

**O tarihteki durum:** Repository uygulaması onaylı; sağlayıcı ve Production değişiklikleri yetkili değil.

**Paket:** A6-EO-04-C

Bu belge 17 Ekim 2026'da kontrol edilen erişim modeli ve kabul edilmiş düzeltme kararını anlatır. Kota, erişim seviyesi ve başvuru açıklamaları tarihsel araştırma kaydıdır; bu dil düzenlemesi onları bugün yeniden doğrulanmış saymaz. Güncel proje durumu Execution Plan'dadır.

## Analist sonucu

İlk review hedefi **Explorer access** olmalıdır. O tarihteki karara göre Explorer, gerçek Production hesaplarında salt okunur AdsTable sorgularına yeterlidir; Standard denetimini erkenden üstlenmeden gerçek veri geliştirmesini açar. OAuth consent/marka doğrulamasının yerine geçmez; ayrı kapılardır.

17 Ekim denetiminde ürün ve sorgu mantığı doğru, erişim katmanında iki 2026 uyumsuzluğu bulundu:

1. API erişim seviyesi OAuth istemcisinin Google Cloud Project'ine veriliyordu; eski developer token erişim otoritesi değildi.
2. Çalışma zamanı her `403` yanıtını OAuth kopması sayıyordu. Oysa proje erişimi, 2-Step Verification, izin kapsamı ve bilinen erişim olayı farklı sonuçlardır.

Paket yalnız bu iki uyumsuzluğu düzeltir. Sorgu anlamı, Reporting Account yetkisi, veri kümesi ve arayüz değişmez.

## Erişim ve review kapıları

| Kapı | Kanıtladığı | AdsTable kararı |
|---|---|---|
| Google Ads API Test | Test hesabı erişimi | Tamamlanmış demo; Production kanıtı değil |
| Google Ads API Explorer | Production hesabında sınırlı günlük işlem | İlk gerçek hesap geliştirme/kabul hedefi |
| Google Ads API Basic | Daha yüksek günlük kota; marka doğrulaması ön koşulu | İhtiyaç doğduğunda |
| Google Ads API Standard | Limitsiz işlem; manuel denetim ve RMF | Ortak üst seviye business/review aşaması |
| OAuth public verification | Dış kullanıcı izin/marka/kapsam güveni | Explorer'dan ayrı; dış kullanıcı öncesi zorunlu |

17 Ekim kaydında Explorer kotası Production için günlük 2.880, Test için 15.000 işlemdir. Bu aşamadaki salt okunur reporting/search, Explorer'ın kısıtladığı hesap oluşturma, kullanıcı yönetimi, planlama ve faturalandırma servislerine girmez. Bu paragraf yeni kota/fiyat/erişim taahhüdü değildir.

## Çalışma zamanı kararı

- `GOOGLE_ADS_DEVELOPER_TOKEN` geçiş dönemi için **opsiyoneldir**.
- Varsa v25 uyumuyla başlık gönderilir; yoksa istek `developer-token` başlığı olmadan kurulur.
- Mevcut Vercel gizli bilgisi değiştirilmez/silinmez. Kaldırma, Explorer gerçek hesap kanıtından sonra ayrı etki analizi, açık onay, dağıtım ve geri alma kapısı ister.
- OAuth istemci kimliği/sırrı, dönüş URI'si, şifreli yenileme token'ı, yetkili reklamveren Reporting Account ve varsa yönetici `login-customer-id` davranışı değişmez.
- İlk sağlayıcı hatasında durulur; otomatik tekrar, alternatif proje, uç nokta veya kimlik doğrulama yolu yoktur.

## Hata kararları

| Sağlayıcı sonucu | AdsTable sınıfı | Kullanıcı/operasyon anlamı |
|---|---|---|
| HTTP 401 / geçersiz grant | `reauthorization_required` | OAuth yeniden yetkilendirmesi gerekir |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | `provider_access_level_required` | Projeye Explorer veya üstü gerekir |
| `TWO_STEP_VERIFICATION_NOT_ENROLLED` | `account_security_action_required` | Kullanıcı Google hesap güvenliğini tamamlamalı |
| Diğer HTTP 403 | `permission_or_scope_missing` | Hesap erişimi/kapsam kontrolü; bağlantı otomatik kopmuş sayılmaz |
| `AUTHORIZATION_ERROR` | `provider_access_incident` | Bilinen/olası sağlayıcı erişim olayı; ilk hatada dur |

Google'ın o tarihteki resmî geçiş sayfası, 9 Eylül 2026 değişiminden sonra bazı yeni Explorer/Basic projelerin Production'da `AUTHORIZATION_ERROR` alabileceğini kaydetti. Geçici öneri yeni Cloud Project olsa da AdsTable otomatik uygulamaz. İlk hata kanıtıyla durur, tam sonuç kullanıcıya bildirilir; proje değişimi yeni açık onayla değerlendirilir.

## Review hazırlık listesi

Explorer başvurusu/gerçek hesap kabulünden önce:

1. OAuth istemcisinin tam Cloud Project'i ve Ads API Overview erişim seviyesi doğrulanır.
2. OAuth consent markası, doğrulanmış alan adı, herkese açık ana sayfa ve aynı alanda gizlilik politikası hazırdır.
3. API kullanıcısında 2-Step Verification; Google zorunlu tutuyorsa passkey tamamlanır.
4. Demo gerçek davranışı gösterir: bağlantı, reklamveren seçimi, Reporting Account, salt okunur rapor, Disconnect.
5. Ek demo istenirse yedi günlük yanıt penceresi operasyon planına alınır.
6. İlk Production çağrısı ayrıca onaylanır; ilk sağlayıcı hatasında durur.

## Listing tree ve veri doğruluğu sınırı

Mevcut sözleşme geçmiş satışı bugünkü ağaçla `exact` eşlemeyi yasaklar. Satış/Sales Role korunur; yalnız Channel `Unclassified Channel` olur. Koruma testlerle sabittir.

Fakat sürümlü tarihsel ağaç anlık kayıtlarının kalıcı saklanması henüz yoktur. Geçmiş PMax satışında kesin Asset Group ancak satış gününün tam iş günü penceresini kapsayan kayıt varsa üretilebilir. Toplama/zamanlayıcı/saklama A6-EO-05'tir. Yapılana kadar doğru sonuç `Unclassified Channel` olabilir. Explorer başvurusunu engellemez; nihai veri doğruluğu için açık iş kalır.

## Yetki ve dış sistem değişikliği sınırı

Bu karar:

- Google başvurusu/canlı çağrı yapmaz.
- Cloud Project, OAuth consent, erişim bilgisi, gizli bilgi veya ortam değiştirmez.
- Dağıtım, migration, Dataset V2 veya arayüz değişikliği yapmaz.
- Production kanıtı varmış gibi davranmaz.

## 17 Ekim 2026'da kontrol edilen resmî kaynaklar

1. [Developer token emekliliği ve Cloud Project geçişi](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
2. [Google Ads API erişim seviyeleri](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
3. [OAuth marka doğrulaması](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
4. [OAuth politika uyumu](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
5. [API güvenlik şartları](https://developers.google.com/google-ads/api/docs/oauth/security-requirements)
6. [API politikası ve demo yanıt süresi](https://support.google.com/adspolicy/answer/6169371?hl=en-GB)
