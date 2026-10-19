# EO-03 — Analiz ve tasarım kitabı

**Ana paket:** A6-EO-03 — Tek yetkili OAuth, bağlantı ve token kasası

**Durum:** Kabul edildi — 2026-10-09

**Amaç:** Teknik olmayan bir okuyucunun sağlayıcı bağlantısının kurulmasından yenileme, yeniden yetkilendirme ve ayrılmaya kadar bütün yaşam döngüsünü ve güvenlik sınırını anlayabilmesi.

Bu kitap EO-03'ün kabul edildiği günkü kapsamını anlatır. Daha sonraki sağlayıcı uygulamaları ve güncel işlem yetkileri için Execution Plan geçerlidir.

## 1. İş amacı ve gerçek çıktı

EO-03, Meta, Google Ads ve Klaviyo bağlantılarının güvenli ve tek anlamlı bir yetki modeliyle kurulmasını sağlar.

Paket sonunda:

- OAuth işlemi; çalışma alanı, kurulum nesli ve sağlayıcıya bağlı, tek kullanımlık bir işlem olarak kuruldu.
- Token'lar, sürümlü AES-256-GCM şifreli zarf içinde saklanır; açık metin kalıcılaştırılmaz.
- Çalışma zamanı, eksik veya hatalı gizli bilgiyle sessizce başlamaz.
- Sağlayıcının doğruladığı hesaplar ile veri çekme yetkisi birbirinden ayrıldı.
- Kurulu Shopify mağazası değiştirilemez kapsam otoritesidir; Reporting Store seçimi yoktur.
- Meta ve Google Ads için tam olarak bir yetkili Reporting Account seçilir.
- Klaviyo tek Connected Account olarak çalışır; ayrı Reporting Account kontrolü yoktur.
- Yeniden yetkilendirme, bağlantıyı kesme ve yeniden bağlanma yaşam döngüleri güvenli durum geçişleriyle yönetilir.

EO-03 henüz reklam verisi çekmez ve Dataset V2 yazmaz.

## 2. Aktörler ve otoriteler

- **Kurulu Shopify mağazası:** Çalışma alanının değiştirilemez ticaret kapsamıdır.
- **Shopify kurulum nesli (installation generation):** Eski kurulumun yeni kurulum adına işlem yapmasını engeller.
- **Kullanıcı:** Sağlayıcıya OAuth izni verir; desteklenen sağlayıcılarda raporlama hesabını seçer.
- **Sağlayıcı:** Kimliği, erişilebilir hesapları ve token yenileme sonucunu doğrulayan dış otoritedir.
- **OAuth işlem deposu:** State, PKCE, dönüş adresi (callback) ve tek kullanım sınırını korur.
- **Token kasası (token vault):** Şifreli sağlayıcı erişim bilgilerinin tek kalıcı saklama sınırıdır.
- **Bağlantı/hesap kayıtları:** Bağlantı durumu ile raporlama yetkisini açıkça ayırır.
- **Çalışma zamanı:** Yalnız connected durumundaki yetkili kaydı kullanabilir.

## 3. Uçtan uca normal bağlantı akışı

1. Kullanıcı, kurulu Shopify mağazası içinden bir sağlayıcı bağlantısı başlatır.
2. Sistem; çalışma alanı, kurulum nesli, sağlayıcı, tam dönüş adresi, state ve gerekiyorsa PKCE bilgisini kısa ömürlü OAuth işlemine bağlar.
3. Kullanıcı sağlayıcının kendi ekranında izin verir.
4. Dönüş geldiğinde state tek seferde işleme alınır; tekrar kullanım reddedilir.
5. Sağlayıcının dönüşü doğrulanır; token açık metin olarak saklanmadan şifreli zarfa çevrilir.
6. Sağlayıcının erişilebilir hesapları güncel yanıtla alınır.
7. Meta ve Google Ads için kullanıcı bir yetkili Reporting Account seçer. Klaviyo bağlantının kendisini yetkili hesap kabul eder.
8. Bağlantı connected durumuna geçer; ancak bu durumda sonraki veri hattına raporlama yetkisi verir.

## 4. Raporlama yetkisi kuralları

- Bir çalışma alanı yalnız kurulu Shopify mağazasını temsil eder.
- Kullanıcı başka bir Shopify, WooCommerce, BigCommerce veya Magento mağazasını bu çalışma alanına Reporting Store olarak seçemez.
- Meta ve Google Ads'te sağlayıcı hesabı ile Reporting Account aynı kavram değildir; seçilen hesap bağlantının altında doğrulanmış olmalıdır.
- Hesap değişikliği eski hesabı sessizce yeniden adlandırmaz; açık yetki değişimi olarak işlenir.
- Klaviyo için ayrı raporlama hesabı katmanı yaratılmaz.
- connected olmayan, güncelliğini yitirmiş veya kurulum nesli uyuşmayan kayıt veri çekme yetkisi vermez.

## 5. Yenileme, yeniden yetkilendirme, bağlantıyı kesme ve yeniden bağlanma

- Geçerli token yenileme sonucu, erişim bilgilerinin şifreli zarfını daha ileri sürümle güncelleyebilir.
- invalid_grant veya kalıcı yetki kaybı bağlantıyı reauthorization_required durumuna taşır; son başarılı token hâlâ kullanılabilirmiş gibi davranılmaz.
- Kullanıcı bağlantıyı kesmeyi başlattığında durum disconnect_pending olur; raporlama yetkisi hemen kapanır. Güvenli temizlik tamamlandığında durum disconnected olur.
- Yeniden bağlanma, yeni OAuth işlemi ve sağlayıcının güncel doğrulamasını gerektirir.
- Eski dönüş isteği, eski kurulum nesli veya eski bağlantı durumu yeni bağlantıyı ele geçiremez.

## 6. Negatif ve hata yolları

- Geçersiz, süresi geçmiş, başka çalışma alanına/sağlayıcıya ait veya daha önce kullanılmış state reddedilir.
- Dönüş adresi izin verilen adresler listesinin dışındaysa işlem durur.
- Sağlayıcının hesap yanıtı boş, yetkisiz veya belirsizse raporlama yetkisi kurulmaz.
- Token'ın şifresi çözülemiyorsa veya anahtar sürümü desteklenmiyorsa çalışma zamanı güvenli biçimde durur.
- Token yenilemenin geçici hatasında sınırlı yeniden deneme uygulanabilir; kalıcı kimlik doğrulama hatası yeniden yetkilendirme gerektirir.
- Bağlantıyı kesme işlemi tekrar çağrılsa da aynı sonucu korur; yinelenen işlem yan etkiyi çoğaltmaz.
- Başarısız bir bağlantı, mevcut sağlıklı başka sağlayıcı bağlantısını bozmaz.

## 7. Kalıcı durum ve veri sahipliği

Kalıcı veri sınıfları:

- kısa ömürlü OAuth işlem durumu,
- sağlayıcı bağlantısının kimliği ve yaşam döngüsü,
- sağlayıcının doğruladığı hesap envanteri,
- yetkili raporlama hesabı seçimi,
- şifreli erişim bilgisi zarfı ve anahtar sürümü bilgisi,
- güvenli operasyon ve kabul kanıtlarıdır.

Shopify mağaza kapsamı EO-02 çalışma alanı/kurulum yetkisinden gelir. EO-03 bu mağazayı değiştirecek bilgi üretmez.

## 8. Gizli bilgiler ve güvenlik sınırları

- Açık metin erişim veya yenileme token'ı; veritabanına, loga, yanıta, dokümana veya GitHub'a yazılmaz.
- Token'ın şifresi yalnız gerekli çalışma zamanı sınırında çözülür.
- Şifreleme anahtarı ve sağlayıcı istemci sırları, ortam değişkeni/gizli bilgi yöneticisi içinde kalır.
- OAuth state tek kullanımlı, kısa ömürlü ve kurulum nesline bağlıdır.
- Uygulamanın çalışma zamanı, doğrudan tablo yetkisiyle güvenlik katmanını aşamaz.
- Canlı kabul kanıtları gizli bilgi içermeyen, sentetik verilerle oluşturulmalıdır.

## 9. Operasyon, tekrar deneme ve gözlemlenebilirlik

Bağlantı durumu, raporlama yetkisi, erişim bilgisi sürümü ve son güvenli yaşam döngüsü sonucu ayrı gözlenir.

- Yeniden deneme yalnız sınıflandırılmış geçici hatalarda yapılır.
- Kalıcı kimlik doğrulama hatası, kullanıcı eylemi gerektiren yeniden yetkilendirme olarak gösterilir.
- Bağlantıyı kesme/yeniden bağlanma işlemleri tekrarlansa da tutarlı sonuç vermeli ve denetlenebilir olmalıdır.
- Başlangıç koruması, eksik gizli bilgiyi veya bozuk anahtar kümesini uygulama trafik almadan yakalar.
- Repository testleri ile canlı veritabanında geri alınan işlem kapsamındaki kabul birlikte kapanış kanıtıdır.

## 10. Geri alma, kurtarma ve güvenli başarısızlık

- Migration ve yaşam döngüsü kabulü, işlem sonunda geri alınan sentetik test verisiyle sınanır.
- Başarısız sağlayıcı işlemi bağlantıyı connected göstermemelidir.
- Bozuk yeni erişim bilgisi sürümü, önceki kaydın üzerine körlemesine yazmaz.
- Bağlantıyı kesme tamamlanamazsa yetki kapalı tutulur; durum yeniden işlenebilir kalır.
- Yalnız ileri yönde yapılan düzeltmeler, kabul edilmiş tarihsel kanıtı silmez.

## 11. Kabul kanıtı ve bilinen sınırlar

Kabul kanıtları:

- docs/EO_03A_OAUTH_TRANSACTION_BOUNDARY.md
- docs/EO_03B_TOKEN_ENVELOPE_STARTUP_GUARD.md
- docs/EO_03C_CONNECTION_ACCOUNT_AUTHORITY.md
- docs/EO_03D_PROVIDER_CONNECTION_LIFECYCLE.md
- evidence/eo-03d-live-database-evidence-2026-10-09.json
- Repository testleri, tür kontrolü ve derleme geçmiştir.
- Canlı veritabanında geri alınan işlem kapsamındaki yaşam döngüsü kabulü geçmiştir; sentetik test artığı 0'dır.
- Supabase Security Advisor bulgusu 0'dır; EO-03-D kaynaklı yeni indekslenmemiş foreign key yoktur.
- Ürün sahibi EO-03 kapanışını 9 Ekim 2026'da açıkça kabul etmiştir.

Bilinen sınırlar:

- Sağlayıcı HTTP adaptörleri ve gerçek veri çekimi EO-04 kapsamıdır.
- Scheduler, Dataset V2, uzlaştırma ve verinin kesinleşmesi EO-05 kapsamıdır.
- Bu paket canlı sağlayıcı OAuth işlemi, sağlayıcı paneli değişikliği veya Production deploy yetkisi vermez.
- Arayüz yüzeyleri EO-07 kapsamında uygulanacaktır.

## 12. Tek sonraki ana paket

EO-03'ün tek sonraki ana paketi **A6-EO-04 — Meta, Google Ads ve Klaviyo adaptörleri** paketidir.

## Makine sözleşmesinin bölüm eşlemesi

Aşağıdaki kimlikler testler tarafından kullanıldığı için çevrilmez:

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

