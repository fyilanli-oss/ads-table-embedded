# A6-EO-04-D — Klaviyo bağlantısı ve tahmini e-posta harcaması başlangıç brief'i

**Tarihsel durum:** Kabul edildi — uygulama sürüyordu.

**Kaynak kontrol tarihi:** 13 Ekim 2026

Ürün sahibi, aşağıdaki OAuth, tek hesap ve başlangıç tarihli harcama sınırlarını
inceleyerek 13 Ekim 2026'da kabul verdi. Bu kabul yalnız repository uygulamasını
ve düzeltici harcama defteri şema migration'ını yetkilendirdi; canlı sağlayıcı
paneli, Vercel ve dağıtım işlemleri ayrı onay kapıları olarak kaldı.

Bu belge o günkü kapsamı ve sonraki düzeltmeleri koruyan tarihsel kayıttır;
bugün yeniden işlem yapma talimatı değildir. Güncel kabul ve iş sırası
`docs/EXECUTION_PLAN.md`, nihai paket anlatımı `docs/EO_04_ANALYSIS_DESIGN_BOOK.md`
üzerinden okunur. Özgün İngilizce ekran metinleri değiştirilmez.

## Resmî kaynaklar

- Klaviyo OAuth: https://developers.klaviyo.com/en/docs/set_up_oauth
- Klaviyo hesap sorgusu: https://developers.klaviyo.com/en/reference/get_accounts
- Klaviyo API genel bakışı ve sürümleri: https://developers.klaviyo.com/en/v2026-07-15/reference/api_overview
- Supabase satır düzeyi güvenlik: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase değişiklik günlüğü: https://supabase.com/changelog
- Shopify App Home 2.0 RC: https://shopify.dev/docs/api/app-home/v2.0-rc
- Shopify sayı alanı: https://shopify.dev/docs/api/app-home/latest/web-components/forms/number-field
- Shopify modal: https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
- Shopify buton: https://shopify.dev/docs/api/app-home/latest/web-components/actions/button

## İş sonucu

Kullanıcı, kimliği değiştirilemeyen kurulu Shopify mağazasının altına sağlayıcı
tarafından doğrulanmış tam bir Klaviyo Account bağlar. Hesabı açıkça seçer ve
hesabın para biriminde **Estimated 30-Day Klaviyo Email Spend** değerini kaydeder.
Bu, 30 günlük tahmini e-posta harcamasıdır. Daha sonra yeni bir harcama dönemi
başlatabilir veya mevcut dönemin tutarını, başlangıç tarihini değiştirmeden düzeltebilir.

Eski uygulamada kanıtlanmış ürün davranışı korunur; ancak yeni repository'nin
EO-03 işlem, şifreli token, sağlayıcı hesabı ve bağlantı yaşam döngüsü temelleri
üzerinde yeniden kurulur. Eski kaynak kod ve public şema erişim kalıpları kopyalanmaz.

## Kabul edilmiş uygulama akışı

1. **Connect Klaviyo**, Shopify onay modalını açar.
2. **Continue to Klaviyo**, sunucunun yönettiği OAuth işlemini oluşturur,
   S256 PKCE doğrulayıcı/karşılık çiftini üretir ve üst düzey sayfayı yönlendirir.
3. Dönüş adresi, tek kullanımlık işlemi tüketir; kodu
   `https://a.klaviyo.com/oauth/token` üzerinden değiştirir, dönen token kümesini
   şifreler ve bağlantıyı hesap seçimi bekleyen duruma taşır.
4. AdsTable, `accounts:read` ile `GET https://a.klaviyo.com/api/accounts/`
   çağrısını yapar. Tam bir geçerli hesap nesnesi gerekir.
5. OAuth dönüşünde Meta/Google ile kabul edilmiş kurulum davranışı izlenir:
   hesap seçimi modalı açılır. **Resume setup**, OAuth'u yeniden başlatmadan
   aynı hesap adımını açar. Sağlayıcıdan gelen hesabı kullanıcı açıkça seçer;
   AdsTable sessizce atama yapmaz.
6. **Continue**, aynı modalı ayrı bir tahmini harcama adımına ilerletir.
   Hesap adı, para birimi ve saat dilimi salt okunurdur. Klaviyo için Ad Account
   veya Reporting Account kavramı yoktur.
7. İkinci adım **Estimated 30-Day Klaviyo Email Spend** değerini alır.
   Para biriminin tek kaynağı sağlayıcıdır ve değiştirilemez. İlk başlangıç tarihi,
   doğrulanmış hesap saat dilimine göre sunucunun hesapladığı iş tarihidir.
8. **Save and connect**, seçilen hesap kimliği ve harcamayı birlikte gönderir.
   Sunucu bekleyen kimlik bilgisini yeniden yükler, hesap listesini yeniden
   sorgular; eksik veya güncelliğini yitirmiş seçimi reddeder. Doğrulanmış hesap,
   ilk harcama dönemi ve bağlı durum birlikte, atomik olarak kaydedilir.
   Kısmi başarı yasaktır.
9. Modalın iki adımından herhangi birini kapatmak bekleyen durumu korur.
   Sonraki **Resume setup** her zaman yeniden hesap seçiminden başlar.
10. Bağlı durumda **Update spend**, **Change value** ve önce sağlayıcı yetkisini
    iptal eden **Disconnect** eylemleri bulunur.

## Tahmini harcama defteri

Tahmini harcama, kendi başlangıç tarihli defteri olan kullanıcı ayarıdır.
Sağlayıcı token'ının veya raporlama gerçeği satırının içine yazılmaz.

Öngörülen özel tablo `integrations.klaviyo_email_spend_periods` ve yetkili alanları:

- `id`: değişmez UUID birincil anahtar.
- `connection_id`: EO-03 sağlayıcı bağlantısının yabancı anahtarı.
- `account_id`: doğrulanmış `integrations.provider_accounts` yabancı anahtarı.
- `workspace_id` ve `install_generation`: kurulu mağazanın yetki sınırı.
- `provider_account_id`: sunucunun doğruladığı Klaviyo hesap kimliği.
- `source_currency`: doğrulanmış, üç harfli Klaviyo hesap para birimi.
- `estimated_30_day_email_spend`: `numeric(10,2)`; `0.00`–`99999999.99` aralığı.
- `effective_from`: doğrulanmış hesap saat dilimindeki iş tarihi.
- `provenance`: tam olarak `user_estimated` değeri.
- `correction_version`: 1'den başlayan pozitif tamsayı.
- `created_at` ve `updated_at`: sunucu zaman damgaları.

Her **Update spend** gönderimi ayrı ve değişmez bir defter olayı oluşturur;
aynı iş tarihindeki birden fazla gönderim de buna dahildir. En yeni olay
`effective_from`, ardından `created_at`, ardından `id` ile belirlenir.
Önceki aynı gün kayıtları denetim geçmişinde görünür ve tutarları düzeltilebilir kalır.
Tablo özel `integrations` şemasındadır; RLS etkin ve zorunludur.
Tarayıcıya, `anon`, `authenticated` veya genel `service_role` rolüne erişim
verilmez. Yalnız dar yetkili `adstable_runtime` fonksiyonları üzerinden erişilir.

### Update spend — yeni dönem başlatma

- Önce güncel Klaviyo hesabı, para birimi ve saat dilimi yeniden doğrulanır.
- Yeni başlangıç tarihi, hesap saat diliminden sunucuda hesaplanır.
- Yeni defter satırı eklenir; önceki dönemin üzerine yazılmaz.
- Aynı iş tarihinde tekrar güncelleme yapılabilir. Her biri ayrı ve değişmez
  olaydır; aynı günün son olayı geçerli olur.
- Yeniden bağlanma/bağlantı kesme yarışlarında güvenli durmak için iyimser
  bağlantı sürümü kilidi kullanılır.
- Kabul edilmiş Settings sunumu aynen korunur: bağlı durumdaki eylem
  **Update spend**; modal başlığı **Update Klaviyo email spend**; açıklaması
  **Enter the new estimated Klaviyo email cost for the next 30-day period starting today. SMS costs are not included.**;
  alan etiketi **Estimated 30-Day Klaviyo Email Spend**; ana eylem **Save new value**.

Disconnect geçmiş harcamayı korur. Aynı iş tarihinde tamamlanan sonraki yeniden
bağlanma da ayrı ve değişmez olay ekler; önceki bağlantı geçmişiyle çakışamaz,
üzerine yazamaz veya onu silemez.

Yeniden bağlanmanın tamamlanmasında hem `connected_at` hem `last_verified_at`
için yeni sağlayıcı doğrulama zaman damgası kullanılır. Böylece
`last_verified_at >= connected_at` değişmezi; OAuth, hesap seçimi, Disconnect
ve geçmiş harcama satırları değiştirilmeden korunur.

### Change value — kayıtlı tutarı düzeltme

- Mevcut tek defter satırı, değişmez harcama dönemi UUID'siyle seçilir.
  Aynı gün birden fazla güncelleme olabileceğinden tarih tekil seçici değildir.
- Yalnız tutar değişir; hesap, para birimi ve başlangıç tarihi korunur.
- `correction_version` artırılır; sunucu zaman damgası güncellenir.
- Eksik kayıt `SPEND_HISTORY_ENTRY_NOT_FOUND` ile reddedilir.
- Ekrandaki güncel tutar son geçerli dönemden türetilir; ikinci bir değiştirilebilir
  güncel maliyet kaynağı oluşturulmaz.
- Kabul edilmiş Settings sunumu aynen korunur: **Change value**, her geçmiş
  satırının yanında tekrarlanan değil, bağlı durumda tek bir eylemdir.
  Modal başlığı **Change Klaviyo email spend**; açıklaması
  **Change a previously saved amount. Its original start date will not change.**.
  Kullanıcı bir **Saved period** seçer; kayıtlı tutar
  **Updated 30-Day Klaviyo Email Spend** alanına doldurulur. Ana eylem **Save change**.

## Girdi ve yetki kuralları

- Metinsel tutar `0` veya en fazla sekiz tamsayı ve iki ondalık basamaklı,
  negatif olmayan ondalık sayı olabilir.
- Bilimsel gösterim, işaretler, virgül, NaN, Infinity ve ikiden fazla ondalık
  basamak reddedilir.
- `0.00`, Klaviyo'nun ücretsiz planını açıkça destekler.
- Kullanıcının değiştirebildiği gizli form alanlarından gelen hesap kimliği,
  hesap adı, para birimi, saat dilimi ve başlangıç tarihi yetkili kaynak sayılmaz.
- İlk tamamlama ve Update spend için para birimi/saat dilimi yeniden doğrulanır.
  Change value yalnız sunucuya ait mevcut dönemi düzeltir.
- SMS, MMS ve WhatsApp maliyeti bu e-posta harcaması girdisinin dışındadır.

## Token ve bağlantı kesme kuralları

- Yetkilendirme adresi: `https://www.klaviyo.com/oauth/authorize`.
- Token alma/yenileme adresi: `https://a.klaviyo.com/oauth/token`.
- Yetki iptal adresi: `https://a.klaviyo.com/oauth/revoke`.
- PKCE yöntemi tam olarak `S256` olur.
- Yetkilendirme kodları beş dakikalık kimlik bilgisi olarak ele alınır.
- Token ömrü `expires_in` değerinden okunur; sabit erişim token ömrü varsayılmaz.
- `invalid_grant`, yeniden yetkilendirme gerektiren duruma dönüşür.
- Yenileme sınırlıdır; döngüye girmez.
- Disconnect, yerel aktif yetkiyi temizlemeden önce yenileme token'ını iptal eder.
  Sağlayıcı veya ağ hatasında yerel bağlantı korunur; işlem güvenli biçimde durur.
- Geçmiş harcama dönemleri bağlantı kesildikten sonra denetlenebilir kalır.

## İstenen izinler

Eski davranışla uyumlu önerilmiş izin kümesi:

- `accounts:read`
- `campaigns:read`
- `flows:read`
- `events:read`
- `metrics:read`

Bu OAuth/hesap/harcama diliminde yalnız `accounts:read` kullanılır. Diğer okuma
izinleri, sonraki Klaviyo raporlama endpoint sözleşmesi gerekliliklerini
kanıtlayana kadar geçici öneridir. Yazma izni istenmez. Bu ifade 13 Ekim'deki
başlangıç kapsamıdır; sonraki raporlama kabulünü geri almaz.

## Kullanıcıya görünen durumlar

Aşağıdaki İngilizce değerler özgün ekran/eylem adlarıdır; bu paket onları çevirmiyor.

| Durum | Görünen sonuç | Eylem | İşlem sonucu |
| --- | --- | --- | --- |
| Yükleniyor | Klaviyo status is loading | yok | yinelenen eylemler kapalı |
| Bağlı değil | Klaviyo · Not connected | Connect | onay modalı |
| Yetkilendirme | Continue to Klaviyo | Continue / Cancel | OAuth veya değişmeyen durum |
| Hesap seçimi gerekli | sağlayıcıdan gelen Klaviyo hesap listesi | Continue / Cancel | ayrı harcama adımı veya bekleyen durum |
| Tahmini harcama gerekli | seçili hesap özeti ve harcama alanı | Save and connect / Cancel | atomik bağlantı veya bekleyen durum |
| Kuruluma devam gerekli | Setup incomplete | Resume setup | hesap seçimi; OAuth yeniden başlamaz |
| Bağlı | bağlı hesap ve `amount currency / 30 days` | Update spend / Change value / Disconnect | seçili işleme özel akış |
| Yeniden yetkilendirme | Klaviyo authorization expired | Reconnect | yeni OAuth işlemi |
| Sağlayıcı hatası | açık, yeniden denenebilir sağlayıcı mesajı | Retry | uydurulmuş boş/başarılı durum yok |

Tarihsel matristeki **Retry**, ilk sağlayıcı hatasından sonra otomatik tekrar
yetkisi değildir; kullanıcı kararı ve bağlayıcı ilk hata kapısı korunur.

## Shopify bileşen eşlemesi

| İhtiyaç | Bileşen ve özellik |
| --- | --- |
| Sayfa/sağlayıcı bölümü | `s-page`, `s-section`, `s-stack` |
| Durum ve hata | `s-badge`, `s-banner` |
| Eylemler | `s-button`; gönderim sırasında `loading` ve `disabled` |
| Onay/tamamlama/geçmiş tutar düzeltmesi | `s-modal` |
| Açık tek hesap seçimi | `s-choice-list`, `s-choice` |
| Tahmini harcama | `s-number-field`, `min=0`, `max=99999999.99`, `step=0.01`, `required`, para birimi için `suffix` |
| Salt okunur hesap/para birimi/saat dilimi | modal içindeki Shopify metin bileşenleri |

Ham form kontrolleri, özel CSS, sabit görsel değerler veya eylem yerine
`s-clickable` kullanımı yasaktır. Klaviyo, kabul edilmiş Meta/Google kurulum
kalıbını izler: dönüş durumu hesap seçimi modalını açar; **Resume setup**,
modal kapatıldıktan sonra kullanıcının başlattığı devam yoludur. Hesap seçimi
ve tahmini harcama aynı modalın ayrı, ardışık görünümleridir. Tek ekranda
birleştirilmez ve iç içe modal açılmaz.

## Kapsam dışı

- Campaign, Flow, Message veya Variation raporlama istekleri.
- Channel hiyerarşisi ve sunum kuralları.
- Alıcı ağırlıklı maliyet dağıtımı veya formül hesapları.
- Raporlama gerçekleri, geçmiş veri yükleme, zamanlama, dışa aktarma veya grafikler.
- Sağlayıcıda yazma işlemleri.
- SMS, MMS veya WhatsApp maliyeti.
- Geçmiş eski kayıtların taşınması veya kontrollü sıfırlama aracı.
- 15 Ekim Variation davranışlarının kendiliğinden etkinleştirilmesi.

## Kabul ve geri dönüş

Uygulama, bu brief için ürün sahibinin açık kabulünden sonra başlayabilir.
Repository kabulü; belirlenimci OAuth, doğrulama, defter, eşzamanlılık, önce
yetki iptali ve UI sözleşme testleri; typecheck, build, CI; kontrollü veritabanı
doğrulaması; masaüstü ve gerçek mobil Shopify Admin kanıtı; son olarak açık
ürün sahibi kabulü gerektirir.

Canlı şema kullanılmadan önce migration, Supabase güvenlik ve performans
Advisor kontrollerini geçmelidir. Geri dönüş yeni Klaviyo eylemlerini kapatır;
özel defter ve şifreli kimlik bilgilerini korur, denetlenebilir geçmişi silmez.

## Tarihsel canlı veritabanı kapısı — 13 Ekim 2026

Ürün sahibi canlı Supabase migration'ını ayrıca onayladı. Bu kapı yeni secret,
sağlayıcı OAuth'u, sağlayıcı API çağrısı, Vercel ortam ayarı veya dağıtım içermedi.

`eo04d_klaviyo_spend_ledger` migration'ı sağlıklı `ads-table-embedded` Supabase
projesine uygulandı. Bağımsız katalog kontrolleri özel tablo sahibini, etkin ve
zorunlu RLS'yi, doğrudan tablo yetkilerinin verilmediğini ve yalnız fonksiyonla
`adstable_runtime` erişimini doğruladı. Security Advisor sıfır bulguda kaldı;
paket, indekssiz yabancı anahtar bulgusu üretmedi.

Geri alınan işlem içindeki sentetik senaryo; ilk harcamayla atomik kurulum,
ayar yükleme, kayıt ekleme, aynı tarihi reddetme, yalnız tutar düzeltme, düzeltme
sürümünü artırma, bağlantı kesme ve geçmişi koruma adımlarını geçti. Bu ilk
denemedeki aynı tarihi reddetme davranışı tarihsel kanıttır; son kabul edilmiş
kural yukarıdaki ayrı aynı-gün olaylarıdır. İşlem geri alındı; bağımsız artık
kontrolleri tüm sentetik çalışma alanı, kurulum, kimlik bilgisi, bağlantı, hesap,
yaşam döngüsü olayı ve harcama dönemi için sıfır döndürdü. Kalıcı kanıt:
`docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json`.

Bu ara aşamada yalnız veritabanı kapısı geçti. Ortam değerleri, dağıtım, canlı
Klaviyo OAuth'u, masaüstü/mobil Shopify kabulü, nihai ürün sahibi kabulü ve merge
henüz açıktı. Bu liste bugünün açık iş listesi değildir.

Canlı yeniden bağlanma zaman damgası düzeltmesinin kaydı:
`docs/evidence/EO_04D_KLAVIYO_RECONNECT_TIMESTAMP_ORDER_ACCEPTANCE_2026-10-13.json`.
Veritabanı ve güvenlik kontrolleri geçti. Ürün sahibi ardından tam canlı yeniden
bağlanma akışını tekrarlayıp bütün akışın çalıştığını açıkça doğruladı.
Merge ayrı açık kapı olarak kaldı; sonraki nihai durum Execution Plan'dadır.

