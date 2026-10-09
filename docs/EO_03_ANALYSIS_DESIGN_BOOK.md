# EO-03 Analysis–Design Book

**Parent package:** A6-EO-03 — Canonical OAuth, connection and token vault  
**Status:** Accepted — 2026-10-09  
**Purpose:** Teknik olmayan bir okuyucunun provider bağlantısının kurulmasından yenileme, yeniden yetkilendirme ve ayrılmaya kadar bütün yaşam döngüsünü ve güvenlik sınırını anlayabilmesi.

## 1. İş amacı ve gerçek çıktı

EO-03 Meta, Google Ads ve Klaviyo bağlantılarının güvenli ve tek anlamlı otorite modeliyle kurulmasını sağlar.

Paket sonunda:

- OAuth işlemi workspace, kurulum nesli ve provider'a bağlı tek kullanımlık transaction olarak kuruldu.
- Tokenlar sürümlü AES-256-GCM envelope ile ciphertext olarak saklanır.
- Runtime eksik veya hatalı secret ile sessizce başlamaz.
- Provider tarafından doğrulanan hesaplar ile reporting authority birbirinden ayrıldı.
- Kurulu Shopify mağazası değiştirilemez kapsam otoritesidir; Reporting Store seçimi yoktur.
- Meta ve Google Ads için tam bir canonical Reporting Account seçilir.
- Klaviyo tek Connected Account olarak çalışır; ayrı Reporting Account kontrolü yoktur.
- Reauthorization, disconnect ve reconnect yaşam döngüleri güvenli durum geçişleriyle yönetilir.

EO-03 henüz reklam verisi çekmez ve Dataset V2 yazmaz.

## 2. Aktörler ve otoriteler

- **Kurulu Shopify mağazası:** Workspace'in değiştirilemez commerce kapsamıdır.
- **Shopify installation generation:** Eski kurulumun yeni kurulum adına işlem yapmasını engeller.
- **Kullanıcı:** Provider OAuth iznini verir ve desteklenen providerlarda reporting account seçer.
- **Provider:** Kimliği, erişilebilir hesapları ve token yenileme sonucunu doğrulayan dış otoritedir.
- **OAuth transaction store:** State, PKCE, callback ve tek kullanım sınırını korur.
- **Token vault:** Şifreli provider credential'larının tek kalıcı saklama sınırıdır.
- **Connection/account records:** Bağlantı durumu ile raporlama yetkisini açıkça ayırır.
- **Runtime:** Yalnız connected ve yetkili kaydı kullanabilir.

## 3. Uçtan uca normal bağlantı akışı

1. Kullanıcı kurulu Shopify mağazası içinden bir provider bağlantısı başlatır.
2. Sistem workspace, installation generation, provider, exact callback, state ve gerekiyorsa PKCE bilgisini kısa ömürlü transaction'a bağlar.
3. Kullanıcı provider'ın kendi ekranında izin verir.
4. Callback geldiğinde state tek seferde claim edilir; tekrar kullanım reddedilir.
5. Provider dönüşü doğrulanır ve token plaintext olarak kalıcılaştırılmadan şifreli envelope'a çevrilir.
6. Provider'ın erişilebilir hesapları fresh response ile alınır.
7. Meta ve Google Ads için kullanıcı bir canonical Reporting Account seçer. Klaviyo bağlantının kendisini canonical hesap kabul eder.
8. Connection durumu connected olur; yalnız bu durumda sonraki veri hattına raporlama yetkisi verir.

## 4. Reporting authority kuralları

- Bir workspace yalnız kurulu Shopify mağazasını temsil eder.
- Kullanıcı başka bir Shopify, WooCommerce, BigCommerce veya Magento mağazasını bu workspace'e reporting store olarak seçemez.
- Meta ve Google Ads'te provider hesabı ile Reporting Account aynı kavram değildir; seçilen hesap bağlantının altında doğrulanmış olmalıdır.
- Hesap değişikliği eski hesabı sessizce yeniden adlandırmaz; açık yetki değişimi olarak işlenir.
- Klaviyo için ayrı reporting account katmanı yaratılmaz.
- connected olmayan, stale veya generation uyuşmayan kayıt veri çekme otoritesi vermez.

## 5. Yenileme, yeniden yetkilendirme, disconnect ve reconnect

- Geçerli refresh sonucu credential envelope'ı ileri sürümle güncelleyebilir.
- invalid_grant veya kalıcı yetki kaybı bağlantıyı reauthorization_required durumuna taşır; son başarılı token varmış gibi kullanılmaz.
- Kullanıcı disconnect başlattığında durum disconnect_pending olur, raporlama otoritesi hemen kapanır ve güvenli cleanup tamamlanınca disconnected olur.
- Reconnect yeni OAuth transaction ve fresh provider doğrulaması gerektirir.
- Eski callback, eski installation generation veya eski connection state yeni bağlantıyı ele geçiremez.

## 6. Negatif ve hata yolları

- Geçersiz, süresi geçmiş, başka workspace/provider'a ait veya daha önce kullanılmış state reddedilir.
- Callback allowlist dışındaysa işlem durur.
- Provider hesap yanıtı boş, yetkisiz veya belirsizse reporting authority kurulmaz.
- Token decrypt edilemiyorsa veya key version desteklenmiyorsa runtime güvenli biçimde durur.
- Refresh geçici hatasında sınırlı retry uygulanabilir; kalıcı auth hatası reauthorization gerektirir.
- Disconnect tekrar çağrılsa dahi sonuç idempotent kalır.
- Başarısız bağlantı mevcut sağlıklı başka provider bağlantısını bozmaz.

## 7. Kalıcı durum ve veri sahipliği

Kalıcı veri sınıfları:

- kısa ömürlü OAuth transaction durumu,
- provider connection kimliği ve yaşam döngüsü,
- provider tarafından doğrulanmış account envanteri,
- canonical reporting account seçimi,
- ciphertext credential envelope ve key version metadata'sı,
- güvenli operasyon ve kabul kanıtlarıdır.

Shopify mağaza kapsamı EO-02 workspace/installation otoritesinden gelir. EO-03 bu mağazayı değiştirecek metadata üretmez.

## 8. Secret ve güvenlik sınırları

- Plaintext access veya refresh token database, log, response, doküman ya da GitHub'a yazılmaz.
- Token yalnız gerekli runtime sınırında çözülür.
- Encryption key ve provider client secret'ları environment/secret manager içinde kalır.
- OAuth state tek kullanımlı, kısa ömürlü ve kurulum nesline bağlıdır.
- Application runtime doğrudan tablo yetkisiyle güvenlik katmanını aşamaz.
- Canlı kabul kanıtları secret-free ve synthetic olmalıdır.

## 9. Operasyon, tekrar deneme ve gözlemlenebilirlik

Operasyonel olarak connection state, reporting authority, credential version ve son güvenli lifecycle sonucu ayrı gözlenir.

- Retry yalnız sınıflandırılmış geçici hatalarda yapılır.
- Kalıcı auth hatası kullanıcı eylemi gerektiren reauthorization olarak gösterilir.
- Disconnect/reconnect işlemleri idempotent ve audit edilebilir olmalıdır.
- Startup guard eksik secret veya bozuk key setini uygulama trafiği almadan yakalar.
- Repository testleri ve canlı rollback-scoped database acceptance birlikte kapanış kanıtıdır.

## 10. Rollback, kurtarma ve güvenli başarısızlık

- Migration ve lifecycle kabulü rollback-scoped synthetic fixture ile sınanır.
- Başarısız provider işlemi bağlantıyı connected göstermemelidir.
- Bozuk yeni credential sürümü önceki kaydı körlemesine overwrite etmez.
- Disconnect tamamlanamazsa yetki kapalı tutulur ve durum yeniden işlenebilir kalır.
- Forward-only düzeltmeler kabul edilmiş tarihsel kanıtı silmez.

## 11. Kabul kanıtı ve bilinen sınırlar

Kabul kanıtları:

- docs/EO_03A_OAUTH_TRANSACTION_BOUNDARY.md
- docs/EO_03B_TOKEN_ENVELOPE_STARTUP_GUARD.md
- docs/EO_03C_CONNECTION_ACCOUNT_AUTHORITY.md
- docs/EO_03D_PROVIDER_CONNECTION_LIFECYCLE.md
- evidence/eo-03d-live-database-evidence-2026-10-09.json
- Repository test, typecheck ve build PASS.
- Canlı rollback-scoped lifecycle kabulü PASS; synthetic residue 0.
- Supabase Security Advisor 0; EO-03-D kaynaklı yeni unindexed foreign key yok.
- Ürün sahibi EO-03 kapanışını 9 Ekim 2026'da açıkça kabul etti.

Bilinen sınırlar:

- Provider HTTP adapter'ları ve gerçek veri çekimi EO-04 kapsamıdır.
- Scheduler, Dataset V2, reconciliation ve finality EO-05 kapsamıdır.
- Bu paket canlı provider OAuth töreni, provider console mutation'ı veya production deploy yetkilendirmez.
- UI yüzeyleri EO-07 kapsamında uygulanacaktır.

## 12. Tek sonraki parent

EO-03'ün tek sonraki parent'ı **A6-EO-04 — Meta, Google Ads and Klaviyo adapters** paketidir.

## Contract section map

- business_purpose_and_actual_output
- actors_and_authorities
- end_to_end_happy_path
- negative_and_failure_paths
- persistent_state_and_data_ownership
- secret_and_security_boundaries
- operations_retries_and_observability
- rollback_recovery_or_safe_failure
- accepted_evidence_and_known_limits
- single_next_parent

