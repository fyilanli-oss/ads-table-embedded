# AdsTable OAuth akış anayasası

Durum: owner onaylı hazırlık; bu PR'ın merge'i ayrı onay gerektirir. Tarih: 2026-11-01.
Kapsam: Shopify Products/Orders, Google Ads, Meta ve Klaviyo; bunlara doğrudan veya
dolaylı değen bütün insanlar, ajanlar ve otomasyonlar. Codex de istisna değildir.

## Otorite ve değişiklik kapısı

Execution Plan ve açık ürün sahibi kararları üst otoritedir. Bu anayasa ile
[makine sözleşmesi](../contracts/oauth/oauth-flow-constitution-v1.json) güncel akışın
tek giriş noktasıdır. Shopify UI anayasası ve güvenlik sözleşmeleri birlikte
bağlayıcıdır. Eski EO kayıtları tarihsel kanıt olarak kalır; eski bir plan veya
koddaki davranış yeni yetki oluşturmaz. Çelişki sessizce yorumlanmaz, owner'a sunulur.

OAuth'a değen araştırma, tasarım, sözleşme, kod/test, temizlik, SQL/config, merge ve
yayın öncesinde yapılacak somut işlem/kapsam açıklanır ve açık owner onayı alınır.
Genel devam veya başka işe verilen onay yetki değildir. Onay yalnız belirtilen
kapsamadır. Bu kayıt çalışan akışın değiştirilmesine veya canlı işleme izin vermez.

Her değişiklikte: güncel main/Connector/branch/envanter doğrulanır; resmî belge ve
kontrol tarihi kaydedilir; etkilenen geçiş/mesaj/guard tanımlanır; önce owner onayı,
sonra bu sözleşmede yeni revision, exact changed_paths, gerekçe ve test kanıtı gelir.
Runtime dosyası değişiyorsa revision scope.runtime_code=true ayrıca açık onaylı
olmalıdır. Eski revision'lar değiştirilemez/silinemez. Hash güncellemesi tek başına
onay değildir. Merge ve production yayını ayrı açık onay ister.

## Ortak durum modeli

| Durum | Kullanıcı sunumu | İzin verilen sonraki adım |
|---|---|---|
| not_connected | Not connected + Connect | Açıklama modalı; açılışta I/O yok |
| explaining / explanation_hiding | Tek mevcut izin açıklaması | Cancel sıfır I/O; Connect niyeti yakalanır, native afterhide beklenir |
| native_authorization | Shopify/provider kendi onay ekranı | Gerçek dönüş ve sunucu doğrulaması; URL/istemci cevabı grant değildir |
| verifying / saving | Yalnız ilgili kartta info bar | Tek bağlı işlem; ikinci tıklama ve başka mutation kilitli |
| permissions_incomplete | Resume setup + izin açıklaması | Önce açıklama; yalnız yeni explicit Connect izin ister |
| account_required | Resume setup + hesap açıklaması | Açık hesap seçimi |
| reporting_required | Resume setup + rapor hesabı açıklaması | Güncel bağlı seçeneklerden tek Reporting Account |
| spend_required | Resume setup + kısa maliyet açıklaması | Ayrı Klaviyo maliyet modalı |
| connected | Connected + doğrulanmış hesap/erişim özeti | Reporting Account / maliyet yönetimi veya Disconnect |
| disconnect_confirm | Mevcut native onay modalı | Açılış/Cancel sıfır I/O; onaydan sonra aşağıdaki provider sırasıyla tek revoke |
| disconnecting | Info bar: Disconnecting… | Mevcut sunucu/provider protokolü; sonuç doğrulanır |
| unknown | Mevcut belirsiz-sonuç uyarısı | Önce explicit salt okunur kontrol; otomatik retry/fallback/write yok |
| unavailable | Kurulum kullanılamıyor açıklaması | Kapı açılmadan native istek yok |

Unknown, missing, denied, cancelled, stale, unavailable ve gerçek0 birbirinden
ayrıdır. Field validation hatası submitted-write unknown değildir; input korunur.
Başlamış bir işlemin modalını kapatmak o işlemin geri alındığı anlamına gelmez.

## Shopify Products ve optional Orders

Connect products → mevcut açıklama → explicit Connect → native afterhide → tek
sunucu hazırlığı → App Bridge scopes.request → tek authenticated bound readback.
Pure Shop GID ayrı taşınır; Shop/workspace/installGeneration birleşik view owner'ı
ile karşılaştırılmaz veya bu birleşimden GID ayıklanmaz. AppInstallation/Shop/
generation sunucuda doğrulanır. granted-all bile tek başına Connected yetkisi değildir.

Doğrulanmış grant: Connected → Product access approved / Order access approved →
Disconnect. İzin yoksa Not connected + Connect; belirsizse mevcut güvenli hata kodu
ve Check status. Check status yeni izin istemez. Açıklama açıkken Checking bildirimi
gösterilmez; yalnız gerçek işlemde gösterilir. Orders ürün erişimi gerektirir;
ürün yokken Product access is required to connect orders. ve disabled Connect orders.
Orders Cancel/Disconnect Products'ı bozmaz. Product kaldırıldığında Orders'ın
effective readiness bağımsız gerçek scope readback ve prerequisite kuralıyla gösterilir;
Products kaldırmak bütün sağlayıcıları veya sipariş scope'unu sessizce revoke etmez.

Disconnect onayı → native afterhide → mevcut bağımsız revoke/readback → Not connected
+ ilgili success bar + Connect. İptal hiçbir revoke başlatmaz.

## Google Ads ve Meta

Connect → mevcut açıklama → explicit Connect → native afterhide → mevcut güvenli
OAuth transaction/native consent → callback claim/scope/owner doğrulaması → açık
1–3 advertiser hesabı seçimi. Google manager hesapları seçilemez. Tek dönen hesap
bile kullanıcı yerine seçilmez. Açıkça bir hesap kaydedilirse mevcut sole-account
Reporting Account davranışı korunur; durable doğrulama sonrası Connected olur.
Birden çok hesapta önceki modalın native afterhide'ından sonra güncel Reporting
Account modalı açılır; tek hesap seçilir, tek kayıt ve durable doğrulama yapılır.
Bilinen başarılı adımlar arasında ekstra Resume aratılmaz.

Hesap veya Reporting Account modalında Cancel/Escape/çarpı: o aşamada kalır, write
başlatmaz; sonraki Resume yalnız o güncel eksik adımı açar. Hiç izin vermeden dönüşte
mevcut doğrulanmış not_connected davranışı korunur. Eksik Google izinlerinde
permissions_incomplete sunumu kullanılır; URL ipucu yalnız açıklamadır, yetki değildir.

Google identity scope seti: adwords + content. Meta identity scope seti: ads_read,
catalog_management, business_management, pages_read_engagement, pages_show_list.
Bunlar native kapsam genişliğidir; AdsTable'ın kampanya/katalog düzenleme yetkisi
veya işi değildir. Mevcut reporting_v1 yolu ve developer/release kapıları korunur;
bu belge yeni scope veya canlı app onayı vermez. Provider'ın kendi business/Page/
katalog seçimleri AdsTable'a ikinci bir seçim adımı ekleme izni değildir.

Connected yalnız doğrulanmış reporting connection/Reporting Account demektir;
katalog eşleşmesi, veri aktivasyonu, worker/scheduler/Dataset yetkisi değildir.
Reporting Account değişimi güncel connection/version'a bağlı sunucu işlemiyle yapılır.
Disconnect açılışında yeni okuma yapılmaz; loader'daki public binding yakalanır.
Onaydan sonra sunucu güncel bağı yeniden doğrular; eski binding revoke başlatamaz.
Bilinen başarı kartı refresh gerekmeden günceller; unknown eski write'ı tekrarlamaz.

## Klaviyo

Connect → açıklama → explicit Connect → native afterhide → mevcut OAuth callback →
açık tek hesap seçimi (tek seçenek olsa bile) → Continue → native afterhide → ayrı
estimated spend modalı → açık geçerli tutar → tek mevcut atomic complete → doğrulanmış
Connected. Hesap ve maliyet aynı modalın gizli adımları olamaz.0 geçerlidir; boş,
negatif veya biçimsiz değer validation hatasıdır. SMS dahil değildir; mevcut para
birimi, tarih, ledger ve correctionVersion kuralları değişmez.

Hesap seçilmezse account_required; maliyet girilmezse spend_required. Maliyet Resume
OAuth'ı yeniden başlatmaz. Belirsiz kayıt sonrası otomatik write tekrarı yoktur;
önce explicit status kontrolü gerekir. Update spend ve Change value ayrı mevcut
anlamlarını korur. Bağlantı/izin, input veya geçmiş maliyet keyfî biçimde temizlenmez.

İşlem bitene kadar kilit korunur; Connected sonrası refresh olmadan serbest kalır.
Modal DOM'dan kalktığında cleanup yalnız o modal setinin lock'unu bırakır; farklı
modalın lock'u silinmez. Geri dönen management modallarına listener tekrar bağlanır.
Disconnect mevcut revoke-first sunucu protokolünü ve historical spend korumasını
kullanır; tek info progress bar ve doğrulanmış success bar gösterilir. Klaviyo
Disconnect mevcut explicit confirmation handler içinde tek submit yapar; işlem
başlayınca conditional modal kaldırılır. Buraya yeni bir afterhide dispatch kapısı
eklenmez. Native afterhide şartı Klaviyo account → spend geçişi için zorunludur.

## Birebir kart/bildirim standardı

| Eksik aşama / işlem | Birebir metin |
|---|---|
| Google eksik izin | Complete your permissions to finish setup. |
| Google/Meta advertiser | Select your advertiser accounts to finish setup. |
| Google/Meta Reporting Account | Select your reporting account to finish setup. |
| Klaviyo hesap | Select your account to finish setup. |
| Klaviyo maliyet | Enter your estimated spend to finish setup. |
| Resume kartları | Warning Resume setup rozeti → kısa paragraph → default Resume setup s-button |
| Ortak doğrulama | Verifying access… |
| Klaviyo initial spend | Saving estimated spend… |
| Disconnect progress | Disconnecting… |
| Google success | Google Ads was disconnected. |
| Meta success | Meta was disconnected. |
| Klaviyo success | Klaviyo was disconnected. |
| Shopify success | Product access removed. / Order access removed. |

Not connected → success varsa s-banner tone=success → Connect. İşlem s-banner
tone=info; hata/unknown ayrı mevcut uyarı. Başarı yalnız doğrulanmış sonuçtan gelir.
Şu anki geçici evidence/product-test düğmeleri OAuth adımı değildir; bu belge onları
kaldırmaz veya çalıştırmaz. Native modal açıklama metinleri mevcut onaylı copy dosyasıyla
birlikte korunur. Read-only kullanımı provider scope'u read-only diye yanlış tanıtmaz.

## Kırmızı çizgiler

1. Owner onayı olmadan OAuth'a doğrudan/dolaylı dokunulmaz; Codex istisna değildir.
2. Callback state/claim/PKCE, gerçek scope, Shop/workspace/generation ve connection/CAS
   güvenliği gevşetilemez. Eski sekme/yanıt güncel karta veya write'a yetki veremez.
3. Tek active mutation/selection; çift tıklama, tekrar hide ve başka provider overlap yok.
4. Yeni modal yalnız önceki native afterhide sonrası; Cancel=0 yeni write.
   Google/Meta/Shopify Connect/selection/revoke dispatch sırası korunur; Klaviyo
   Disconnect ve spend save mevcut explicit handler sırasını kullanır.
5. Unknown'dan otomatik retry, fallback, token exchange/refresh, revoke veya write replay yok.
6. Token/secret/private credential URL, browser state, log, doküman veya evidence'e taşınmaz.
7. AdsTable OAuth'a Merchant/business/catalog selector, manual asset ID veya yeniden
   adlandırılmış step6 eklenmez. Bağımsız product readers yeni OAuth adımı yapılamaz.
8. Eksik developer onayı/uygunsuz native hesap, kullanıcıyı tekrar OAuth yaptırarak çözülmez.
9. İlk provider mutation hatasında durulur; açıklama + yeni açık onay olmadan başka rota yok.
   Yalnız mevcut owner onaylı Google REST search403 dar hesap elemesi istisnası korunur:
   dolu kayıtların tümü aynı izinli authorizationError CUSTOMER_NOT_ENABLED veya
   CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION olmalı; o hesap tekrar denenmez, kalan
   kökler değerlendirilir. Karışık/eksik/diğer hata durur; hepsi reddedilirse başarı yok.
10. Native scope/release flag, app config, SQL/DB, provider çağrısı, merge ve deploy ayrı kapılardır.
11. Shopify UI yalnız onaylı stable Polaris2.0/App Bridge; raw HTML kontrol, custom CSS,
    inline style/literal renk ve taklit bileşen yoktur. Disabled düğme başarı kanıtı değildir.
12. Başarılı native bağlantı veya CI bütün07'nin görsel kabulü değildir. Desktop + gerçek
    en az320px mobil, klavye/dokunma/focus ve owner'ın açık kabulü ayrı kalır.

## CI ile koruma ve sınırlar

[check-oauth-constitution](../tools/check-oauth-constitution.mjs) mevcut Repository
Governance required-check işinin içinde çalışır. Runtime, onun dolaylı auth/provider/
DB/quota bağımlılıkları, migration dosyaları, kritik testler ve bu guard'ın kendisi
SHA256 inventory ile korunur. Ekleme/silme/rename veya içerik farkı kayıtsızsa fail.
Hashler line-ending farkını normalize eder, diğer içerik değişiklikleri aynı sayılmaz.
Manifestte baseline'da runtime değişmez; yeni revision olmadan snapshot yenilenemez.
Revision tüm değişen korunan yolları beyan eder; eski kayıtların üstüne yazamaz.

Kritik davranış testleri normal pnpm test içinde çalışır; dosyaları silme/değiştirme
veya CI adımını kaldırma da korunan değişikliktir. Negatif testler bozuk hash/yeni
ve silinen dosya, kayıt dışı değişiklik, history rewrite, forbidden transition ve
regresyon kapsamı eksikliğinde guard'ın gerçekten fail ettiğini doğrular. Bu guard
flow simulator'ü runtime yetkisi değildir; gerçek hook/server testlerinin yerine geçmez.

Onay kaydı insan tarafından doğrulanmalıdır. CI konuşmadaki onayın gerçekliğini veya
tüm gelecekteki davranışları ispatlayamaz. Hem guard'ı hem sözleşmeyi hem workflow'u
ve branch korumasını değiştirebilen/bypass edebilen yetkiliyi repo kodu mutlak olarak
durduramaz. Required checks ve gerçek owner review enforcement canlı GitHub ayarıdır;
bu PR bunları değiştirmez veya doğrulanmış gibi göstermez. Platform bypass yetkisi
owner'da kalmalıdır; aynı kişinin kendi açtığı PR'ı review etme sınırlaması da ayrıca
değerlendirilmelidir. Bu sınır hiçbir ajana sözleşmeyi tek başına değiştirme izni vermez.

## Kabul ve teslim sırası

Yeni ana akışın görünümü owner tarafından konuşmada kabul edildi; bu kayıt bütün
EO07/desktop+mobile kabulünü otomatik kapatmaz. Tam kapsama negatif/unknown, Cancel,
restore, old-tab, same-shop generation/workspace,1/çok hesap,0 maliyet, disconnect
iptali ve başarısı dahildir. Bu PR yalnız anayasa/sözleşme/CI'dır; runtime veya canlı
provider davranışı değişmez. Şimdi CI/PR, sonra ayrı merge onayı; deploy gerekirse
ayrı açık kapsam/onay.07 açık;15 başlamadı;22 paused;23 Dataset writer.

Resmî kontrol tarihi2026-11-01: [Shopify Scopes](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api),
[Modal](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal),
[GitHub checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
