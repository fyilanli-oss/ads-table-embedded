# A6-EO-04-C — Google 2026 access and review corrective

**Control date:** 17 October 2026

**Status:** Repository implementation authorized; provider and production mutations are not authorized

**Package:** A6-EO-04-C

## Analyst result

Google tarafındaki ilk review hedefi **Explorer access** olmalıdır. Explorer gerçek Production Google Ads hesaplarında salt-okunur AdsTable sorgularını çalıştırmaya yeterlidir ve Standard access denetimini erkenden üstlenmeden gerçek veri geliştirmesini açar. Explorer, OAuth consent/brand doğrulamasının yerine geçmez; bunlar iki ayrı kapıdır.

17 Ekim 2026 denetiminde repository'nin ürün ve sorgu mantığı doğru, fakat erişim kabuğunda iki 2026 uyumsuzluğu bulundu:

1. Google Ads API erişim seviyesi artık OAuth istemcisinin bağlı olduğu Google Cloud Project'e veriliyor; eski developer token erişim otoritesi değil.
2. Runtime her `403` cevabını OAuth bağlantısı kopmuş gibi sınıflandırıyordu. Oysa Cloud Project access, 2-Step Verification, izin/scope ve Google'ın bilinen erişim olayı farklı operasyonel sonuçlardır.

Bu paket yalnız bu iki uyumsuzluğu düzeltir. Sorguların anlamını, Reporting Account yetkisini, veri setini veya arayüzü değiştirmez.

## Access ve review kapıları

| Kapı | Ne kanıtlar | AdsTable kararı |
|---|---|---|
| Google Ads API Test | Test hesaplarına erişim | Tamamlanan demo; Production kanıtı değildir |
| Google Ads API Explorer | Production hesaplarına sınırlı günlük operasyon | İlk gerçek-hesap geliştirme ve kabul hedefi |
| Google Ads API Basic | Daha yüksek günlük kota; marka doğrulaması önkoşulu | Kullanım ihtiyacı doğduğunda |
| Google Ads API Standard | Limitsiz operasyon; manuel audit ve RMF | Ortak üst-seviye business/review aşaması |
| OAuth public verification | Dış kullanıcı consent/brand/scope güveni | Explorer'dan ayrı; dış kullanıcı öncesi zorunlu |

Explorer kotası Production için günde 2.880, Test için günde 15.000 operasyondur. AdsTable'ın bu aşamadaki salt-okunur reporting/search kullanımı Explorer'ın kısıtladığı account creation, user management, planning ve billing servislerine girmez.

## Runtime kararı

- `GOOGLE_ADS_DEVELOPER_TOKEN` geçiş dönemi için **opsiyoneldir**.
- Değer mevcutsa v25 uyumluluğu korunarak header gönderilir; yoksa Google Ads isteği `developer-token` header'ı olmadan kurulur.
- Bu paket mevcut Vercel secret'ını değiştirmez veya silmez. Secret kaldırma ancak Explorer gerçek-hesap kanıtından sonra ayrı etki analizi, açık onay, deployment ve rollback kapısıyla yapılabilir.
- OAuth client ID, client secret, redirect URI, encrypted refresh token, canonical advertiser Reporting Account ve varsa manager `login-customer-id` davranışı değişmez.
- İlk provider hatasında sorgu durur; otomatik retry, alternatif project, endpoint veya auth rotası yoktur.

## Hata kararları

| Provider sonucu | AdsTable sınıfı | Kullanıcı/operasyon anlamı |
|---|---|---|
| HTTP 401 / geçersiz grant | `reauthorization_required` | OAuth yeniden yetkilendirme gerekir |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | `provider_access_level_required` | Cloud Project için Explorer veya üstü erişim gerekir |
| `TWO_STEP_VERIFICATION_NOT_ENROLLED` | `account_security_action_required` | Google hesap güvenliği kullanıcı tarafından tamamlanmalıdır |
| Diğer HTTP 403 | `permission_or_scope_missing` | Hesap erişimi veya scope kontrol edilir; bağlantı otomatik kopmuş sayılmaz |
| `AUTHORIZATION_ERROR` | `provider_access_incident` | Bilinen/olası provider access olayı; ilk hatada durulur |

Google, 9 Eylül 2026 geçişinden sonra bazı yeni onaylanan Explorer/Basic projelerde Production çağrısının `AUTHORIZATION_ERROR` verebildiğini resmi migration sayfasında kaydediyor. Google'ın geçici önerisi yeni Cloud Project olabilse de AdsTable bunu otomatik uygulamaz. İlk hata kanıtıyla durur, kullanıcıya exact sonuç bildirilir ve project değişimi ancak yeni açık onayla değerlendirilir.

## Review hazırlık listesi

Explorer başvurusu/gerçek-hesap kabul gününden önce:

1. OAuth istemcisinin bağlı olduğu exact Google Cloud Project ve Ads API Overview access seviyesi doğrulanır.
2. OAuth consent brand, verified domain, public homepage ve aynı domain üzerindeki privacy policy hazır olur.
3. Google Ads API erişimi bulunan kullanıcıda 2-Step Verification; Google zorunlu tutuyorsa passkey tamamlanır.
4. Review demonstrasyonu yalnız gerçek davranışı gösterir: bağlantı, advertiser seçimi, Reporting Account, salt-okunur rapor ve disconnect.
5. Google ek demo isterse yedi günlük cevap penceresi operasyon planına alınır.
6. İlk Production çağrısı ayrıca ürün sahibi tarafından onaylanır. İlk provider hatasında işlem durur.

## Listing tree ve veri doğruluğu sınırı

Mevcut sözleşme geçmiş satışı bugünkü listing tree ile `exact` eşleştirmeyi yasaklıyor ve satış/Sales Role bilgisini koruyup yalnız Channel'ı `Unknown Channel` yapıyor. Bu koruma testlerle kilitlidir.

Ancak versioned historical listing-tree snapshot persistence henüz yoktur. Bu nedenle gerçek geçmiş PMax satışlarında exact Asset Group yalnız satış gününün tam business-day penceresini kapsayan snapshot mevcutsa üretilebilir. Snapshot scheduler/persistence A6-EO-05'e aittir; yapılana kadar doğru sonuç `Unknown Channel` olabilir. Bu, Explorer başvurusunu engellemez fakat nihai ürün doğruluğu için açık iş olarak kalır.

## Yetki ve mutation sınırı

Bu karar:

- Google başvurusu veya canlı provider çağrısı yapmaz;
- Cloud Project, OAuth consent, credential, secret veya environment değiştirmez;
- deployment, database migration, Dataset V2 veya UI değişikliği yapmaz;
- Production kanıtı varmış gibi davranmaz.

## 17 October 2026 tarihinde kontrol edilen resmî kaynaklar

1. [Developer token sunset and Cloud Project migration](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
2. [Google Ads API access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
3. [OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
4. [OAuth policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
5. [Google Ads API security requirements](https://developers.google.com/google-ads/api/docs/oauth/security-requirements)
6. [Google Ads API policy and demo request timing](https://support.google.com/adspolicy/answer/6169371?hl=en-GB)
