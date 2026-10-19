# EO-03-A — OAuth yetkilendirme işlemi sınırı

**Kontrol tarihi:** 9 Ekim 2026

**Durum:** Kabul edildi — repository, canlı veritabanı ve açık ürün sahibi kapıları geçti.

**Ana paket:** A6-EO-03 — Tek yetkili OAuth, bağlantı ve token kasası

Bu belge 9 Ekim 2026'daki EO-03-A kapsamını, ara bulguları ve kabulü anlatır. “Henüz yok/kapalı” ifadeleri o aşamaya aittir; güncel proje durumu Execution Plan'dadır. Tarihsel denemeler bugün yeniden yürütülmüş veya yeniden deneme izni verilmiş sayılmaz.

## Analist sonucu

Meta, Google Ads veya Klaviyo kullanıcıyı AdsTable dışına yönlendirmeden önce sunucunun yönettiği, sağlayıcıdan bağımsız tek yetkilendirme işlemi oluşturulur.

İşlem, önceden doğrulanmış AdsTable çalışma alanına ve kurulu Shopify nesline aittir. Dönüş isteği (callback) çalışma alanı, mağaza veya raporlama hesabı seçemez. Yalnız AdsTable'ın oluşturduğu, süresi dolmamış tam işlemi tamamlayabilir.

Bu paket **canlı sağlayıcı bağlamaz, sağlayıcı token'ı saklamaz ve raporlama hesabı seçmez.**

## Tarihsel resmî kaynak kontrolü

9 Ekim 2026 tarihinde kontrol edildi:

### Meta

- 30 Haziran 2026'da güncellenen manuel Facebook Login akışı:
  https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
- Dönüş URI'si uygulama panelinde tanımlanır.
- `state` değişmeden döner; CSRF koruması için gereklidir.
- Sunucunun yönettiği yetkilendirme `response_type=code` kullanır.
- Kod değişimi uygulama sırrı gerektirdiğinden sunucular arasında yapılır.
- Uygulama sırrı istemci koduna giremez.
- Dönen erişim token'ı kullanılmadan beklenen uygulama/kullanıcı için incelenip doğrulanır.

### Google

- OAuth 2.0 web sunucusu akışı:
  https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth güvenliği ve erişim bilgisi saklama uygulamaları:
  https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- Dönüş URI'si birebir eşleşir.
- Kriptografik rastgele `state` doğrulanmalıdır.
- İstemci sırları kaynak kod ve herkese açık istemciler dışında kalır.
- Çevrimdışı erişim yalnız arka planda yenileme gereken yerde istenir.
- İzin kapsamları en az yetkiyle ve ilgili işlem bağlamında istenir.
- Token'lar saklanırken şifrelenir; gerek kalmadığında iptal edilir/silinir.

### Klaviyo

- OAuth kurulumu:
  https://developers.klaviyo.com/en/v2026-01-15/docs/set_up_oauth
- PKCE S256 ile Authorization Code akışı zorunludur.
- Her istek benzersiz doğrulayıcı/karşılık (verifier/challenge) çifti kullanır.
- Dönüş URI'si izin verilen URI ile birebir eşleşir.
- Yetkilendirme kodunun ömrü beş dakikadır.
- Token ve iptal uç noktaları `https://a.klaviyo.com/oauth/token` ve `https://a.klaviyo.com/oauth/revoke` adresleridir.
- İstemci sırrı ve kod değişimi sunucuda kalır.
- Erişim ve yenileme token'ları hesap kapsamlıdır. Süre sabit varsayılmaz; `expires_in` alanından alınır.

### Shopify istek yetkisi

- ID token kimlik doğrulaması:
  https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- OAuth işlemi oluşturulmadan önce başlangıç isteği doğrulanmış kurulu Shopify mağazasına ve çalışma alanına bağlanmalıdır.

## Yetkili normal akış

1. Shopify Admin isteği sunucuya gelir.
2. AdsTable Shopify ID token'ını doğrular; kurulu mağazayı, çalışma alanını ve güncel kurulum neslini çözer.
3. Sağlayıcının desteklendiği ve dönüş URI'sinin o sağlayıcı/ortam için sabit izinli URI olduğu kontrol edilir.
4. Sunucu şunları oluşturur:
   - İç yapısı dışarıya anlam taşımayan, kriptografik rastgele state;
   - Ayrı işlem nonce'u;
   - Sağlayıcı gerektiriyorsa PKCE doğrulayıcı/karşılık çifti;
   - Kesin bitiş zaman damgası.
5. Herkese açık state'in yalnız özeti saklanır. Geri alınabilir doğrulayıcı malzemesi EO-03-B şifreli zarfına ayrılmıştır; açık metin yazılamaz.
6. Tarayıcı, yalnız sağlayıcının desteklediği herkese açık yetkilendirme parametreleriyle sağlayıcıya yönlendirilir.
7. Dönüşte state özetlenir; eşleşen işlem tek atomik adımda sahiplenilir.
8. İşlem süresi dolmamış, kullanılmamış, doğru sağlayıcıya/çalışma alanına ait ve hâlâ güncel kurulum nesline bağlı olmalıdır.
9. Sağlayıcı reddi veya dönüş hatası, bağlantı oluşturmadan işlemi gerçeğe uygun kapatır.
10. Başarılı doğrulama kodu yalnız bellekte sağlayıcıya özel sunucu değişim sınırına verir; ham kod saklanmaz.
11. İşlem tek kullanımlıktır. Tekrar oynatma, eşzamanlı çift dönüş veya başka sağlayıcı yerine kullanma güvenle reddedilir.

## Durum makinesi

`created → redirected → claimed → exchanged`

Diğer son durumlar:

- `denied`
- `expired`
- `invalidated`
- `failed`

Son duruma ulaşmış işlem yeniden kullanılamaz.

## Önerilen iç sınırlar

- İşlem ömrü (TTL): 10 dakika.
- Klaviyo kod değişimi ayrıca beş dakikalık kod ömrüne uyar.
- State: kriptografik güvenli rastgele üreteçten en az 256 bit entropi.
- PKCE: yalnız S256; `plain` alternatifine düşülmez.
- Dönüş kökeni/yolu: ortama özel sabit izin listesi; çağıranın gönderdiği yönlendirme yok.
- Saklama: işlem sonrasında yalnız güvenlik üst verisi; kod, token veya açık metin doğrulayıcı yok.

## Güvenli ret matrisi

| Koşul | Sonuç |
|---|---|
| Eksik/bilinmeyen state | Ret; sağlayıcı kod değişimi yok |
| Süresi dolmuş state | Süresi dolmuş işaretle; reddet |
| Önceden sahiplenilmiş state | Tekrar kullanımı reddet |
| Yanlış sağlayıcı dönüşü | Yerine kullanımı reddet |
| Kurulum nesli değişmiş | Geçersizleştir; kullanıcı yetkilendirmeyi yeniden başlatır |
| Dönüş URI'si izin listesi dışında | Yönlendirme veya kod değişiminden önce reddet |
| Sağlayıcıda kullanıcı izni reddedilmiş | Ret neden sınıfını kaydet; bağlantı yok |
| PKCE gerekli ama doğrulayıcı yok | Ret; koruma seviyesi düşürülmez |
| EO-03-B kasası yok | Canlı yetkilendirmeyi başlatma |
| İstemci sırrı yok | Canlı yetkilendirmeyi başlatma |

## Veri sınırı

`integrations.oauth_transactions` kaydı açık metin sağlayıcı sırrı, token, yetkilendirme kodu veya PKCE doğrulayıcı tutamaz. Çalışma zamanı yalnız fonksiyon çağırır. Çalışma alanı kimliği istek girdisinden değil, doğrulanmış Shopify oturumundan gelir.

Şifreli doğrulayıcı alanı ve sağlayıcı token zarfları, EO-03-B anahtar/sürüm/başlangıç korumasını kurana kadar kapalıdır.

## Kapsam

Dahil:

- Sağlayıcıdan bağımsız işlem durum makinesi;
- Çalışma alanı/kurulum nesli sahipliği;
- State özeti, nonce, TTL ve tek kullanımlık sahiplenme;
- Sağlayıcı/ortam dönüş izin listesi;
- PKCE için sağlayıcı yetenek bayrakları;
- Ret, süre dolumu ve tekrar kullanım davranışı;
- Olumsuz senaryo testleri ve sözleşme kanıtı.

Hariç:

- Canlı Meta/Google/Klaviyo yetkilendirmesi;
- İstemci sırrı oluşturma/girme;
- Sağlayıcı token değişimi ve kalıcı saklama;
- Token yenileme, iptal ve bağlantıyı kesme;
- Raporlama hesabı keşfi/seçimi;
- Arayüz kabulü;
- Vercel veya sağlayıcı panelinde değişiklik.

## Kabul kapısı

1. Şema, çalışma zamanı servisi ve makine sözleşmesi aynı durum makinesini uygular.
2. State/tekrar kullanım/sağlayıcı/çalışma alanı/nesil bozma testleri geçer.
3. Gizli bilgi veya yetkilendirme kodu saklanmaz/loglanmaz.
4. Dönüş URI'leri sabit ve tamdır.
5. EO-03-B başlangıç koruması geçmeden canlı OAuth kapalıdır.
6. Repository testleri, derleme ve CI geçer.
7. Ürün sahibi alt paketi açıkça kapatır.

## Teknik uygulama — 9 Ekim 2026

O tarihte repository şunları içeriyordu:

- Özel şemada, RLS'si zorunlu `integrations.oauth_transactions`;
- Yalnız fonksiyon erişimi; tarayıcı, service-role ve çalışma zamanı tablo erişimleri kapalı;
- İstekten değil sağlayıcıdan türetilen tam Production dönüş eşlemesi;
- Yalnız SHA-256 özeti saklanan 256 bit herkese açık state;
- Bağımsız 256 bit işlem nonce'u;
- Google Ads ve Klaviyo için S256 PKCE; geri alınabilir doğrulayıcı EO-03-B kasa arayüzüne devredilir;
- Aynı aktif Shopify kurulum nesline bağlı atomik, tek kullanımlık dönüş sahiplenmesi;
- Ret, süre dolumu, tekrar kullanım, sağlayıcı değiştirme ve kurulum değişikliği hata davranışı;
- Yalnız bellekteki değişim bağlamında yetkilendirme kodu;
- `ON DELETE CASCADE` kurulum yabancı anahtarı: yeni güvenlik veri ailesi kullanılmadan mevcut gizlilik silme yoluna bağlanır.

Uygulama dosyaları:

- `supabase/migrations/20261009091622_eo03a_oauth_transaction_boundary.sql`
- `app/lib/database/oauth-transaction-repository.server.js`
- `app/lib/oauth/oauth-transaction.server.js`
- `tests/eo-03a-oauth-transaction-boundary.test.js`

Bu aşamada uygulama adreslerinden hiçbiri sınırı çağırmıyordu. Sağlayıcı paneli veya Vercel ortamı değiştirilmedi. Onaylı iki EO-03-A migration'ı canlıdaydı; ancak EO-03-B şifreli doğrulayıcı/token kasası başlangıç korumasını sağlayıp kanıtlayana kadar canlı yetkilendirme yapısal olarak engelliydi.

## Repository doğrulaması

GitHub Actions `37907571603` koşusu 9 Ekim 2026'da Repository Governance işini geçti:

- Sabit bağımlılık grafiği: PASS;
- Repository yönetişim testleri: PASS;
- TypeScript sözleşmeleri: PASS;
- Önizleme kabuğu derlemesi: PASS.

Bu yalnız repository davranış kanıtıdır. Canlı Supabase migration'ı, sağlayıcı ayarı, Vercel gizli bilgi değişimi veya canlı OAuth bağlantısı iddiası/yetkisi değildir.

## Canlı şema ön kontrolü — 9 Ekim 2026

Canlı DDL öncesi salt okunur kontrol:

- Hedef `ads-table-embedded` / `podpwkrpmjiksskxhwsu`: `ACTIVE_HEALTHY`;
- PostgreSQL: `17.11.0.003`;
- Son canlı migration: `20261009075721_eo02d_worker_conditional_expression_fix`;
- `integrations.oauth_transactions` ad çakışması yok;
- Canlı `shopify.installations.id`: `bigint`.

Repository migration'ında `installation_id` yanlışlıkla `uuid` tanımlanmıştı. Canlı veritabanı değiştirilmedi. Bekleyen migration `bigint` olarak düzeltildi; gerileme testi bu uyumu canlı uygulamadan önce sabitledi.

## İlk canlı migration denemesi — Güvenli başarısızlık

İlk yetkili deneme, şema/veri değişmeden PostgreSQL SQLSTATE `42501` ile durdu. İşlemin tamamı geri alındı.

EO-02-A, `integrations` şemasını `adstable_owner` altında zaten oluşturmuştu. EO-03-A kısıtlı sahip rolüne geçtikten sonra gereksiz `CREATE SCHEMA IF NOT EXISTS` denedi; PostgreSQL bu ifade için yine veritabanı düzeyinde oluşturma yetkisi istedi.

Düzeltmede EO-02-A'nın bağlayıcı şeması yeniden kullanılır; yeni şema oluşturulmaz. Gerileme testi alt paket migration'ında `CREATE SCHEMA` kullanımını yasaklar. Yetki genişletilmedi; canlı geçici çözüm uygulanmadı.

## Çekirdek canlı migration kabulü — 9 Ekim 2026

`20261009091622_eo03a_oauth_transaction_boundary`, `podpwkrpmjiksskxhwsu` projesine uygulandı.

Salt okunur kabul:

- Tablo sahibi: `adstable_owner`;
- Satır: `0`; sentetik OAuth işlemi oluşturulmadı;
- `installation_id`: `bigint`;
- Kurulum yabancı anahtarı: `ON DELETE CASCADE`;
- RLS açık ve zorunlu;
- `anon`, `authenticated`, `service_role` ve `adstable_runtime` için doğrudan SELECT/INSERT/UPDATE/DELETE kapalı;
- Onaylı beş çalışma zamanı fonksiyonu `adstable_runtime` tarafından çalıştırılabilir;
- Herkese açık çalıştırma yetkisi: sıfır;
- Yetkili fonksiyonlar `SECURITY DEFINER`, `search_path` boş;
- Supabase Security Advisor bulgusu: sıfır.

Performance Advisor, kurulum yabancı anahtarını kapsayan indeksin eksik olduğuna ilişkin yeni bilgi bulgusu verdi. Ayrı, yıkıcı olmayan düzeltme `oauth_transactions_installation_fk_idx (installation_id)` indeksini ekler. Gizlilik tablolarının bildirimleri önceden vardı; sıfır satırlı kullanılmayan indeks bildirimleri trafik öncesinde beklenir.

## Nihai canlı veritabanı kabulü — 9 Ekim 2026

Düzeltici `20261009092144_eo03a_oauth_installation_fk_index` uygulandı.

Son salt okunur doğrulama:

- `oauth_transactions_installation_fk_idx (installation_id)` mevcut, geçerli ve hazır;
- EO-03-A kaynaklı çözülmemiş Performance Advisor bulgusu sıfır;
- Security Advisor bulgusu sıfır;
- Tabloda hâlâ sıfır satır; sentetik yetkilendirme işlemi oluşturulmadı;
- Gizli bilgi, token, yetkilendirme kodu, PKCE doğrulayıcı veya kişisel veri kaydedilmedi;
- Kalan iki indekssiz gizlilik yabancı anahtarı bildirimi EO-03-A'dan önce vardı;
- Kullanılmayan indeks bildirimleri sıfır çalışma zamanı trafiğinde beklenir.

Makine kanıtı: `docs/evidence/EO_03A_DATABASE_ACCEPTANCE_2026-10-09.json`.

EO-03-A'nın repository ve canlı veritabanı teknik kanıtları bu aşamada tamamlandı.

## Ürün sahibi kapanışı — 9 Ekim 2026

PR #44 merge edilip CI/kanıt tekrar doğrulandıktan sonra ürün sahibi EO-03-A'yı açıkça kabul etti.

O tarihteki tek sonraki alt paket EO-03-B — Token zarfı ve başlangıç korumasıydı. Hazırdı; fakat şifreli kasa ve başlangıç koruması kabul edilmeden canlı sağlayıcı yetkilendirmesi kapalıydı.
