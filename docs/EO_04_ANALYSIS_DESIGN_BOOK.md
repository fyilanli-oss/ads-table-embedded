# EO-04 — Analiz ve tasarım kitabı

27 Ekim EO-05 Klaviyo kimlik adayları: #203 `efc1b08fd1cf5ce09ec7c6b2c2695e1ca98e59bd` main'dedir. Native Shopify Ordered Product metric/event ilişkisi kontrolü ve ortak Shopify Product/Variant-parent doğrulaması hazırlanır. Resmî Ordered Product kaynağındaki `Variant ID`, eski `VariantID` alanından ayrı korunur; çelişki/null/eksiklik veya eski alanın tek başına gelişi sessiz alias üretmez. Event replay'i tekilleşir, tüm kaynak event ID'leri korunur; miktar/değer ve Campaign/Flow rollerine dokunulmaz. 29 yeni + 32 mevcut test sentetik; çıktı yazıma kapalı taslak, gerçek collector/lifecycle/vault/Admin/Message birleşimi mevcut 11. adımda açık kalır. Yeni güvenli alan özeti yalnız presence sayar. Canlı route/token/config, SQL ve Dataset değişmez; tarihsel EO-04 kabulü korunur. Ayrıntı `contracts/eo-05-start-brief-v1.json#Klaviyo_product_identity_candidates_2026_10_27` ve `docs/EXECUTION_PLAN.md`.

27 Ekim EO-05 Meta→Shopify aday çözümü: #202 `07f6c81e8d7c297ae51ddd7ffe67e3d364df86a8` main'dedir. Meta çözümleyicisi rapor namespace'i için kanıtlı kuralı, retailer kaynak biçimi kuralından ayrı ister. İkisi olmadan Shopify kimliği üretilmez; katalog iç ID/grup kimliği aday gibi parçalanmaz. Google ile saf aday/kapsam helper'ları ortak, provider kimlikleri ayrıdır. 30 yeni + 83 mevcut test sentetik; çıktı yazıma kapalı taslak, native Ad ilişkisi kanıtını kendiliğinden devralmaz. Gerçek kurallar ve güvenilir runtime kompozisyonu mevcut 11. adımda açık; canlı route/token/config, SQL, Dataset ve rol/metrik sorguları değişmez. Ayrıntı `contracts/eo-05-start-brief-v1.json#Meta_source_rule_Shopify_candidate_resolution_2026_10_27` ve `docs/EXECUTION_PLAN.md`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Meta Ad/creative katalog referansları: #201 `9ce54805d4fa348ce7bdb3b24010b8b1fc46ba81` main'dedir. Ad hesap/Campaign/Ad Set ve creative kimlikleri native alanlardan karşılaştırılır; açık creative ürün kümesinin kataloğu da denetlenir. İki açık katalog çelişirse öncelik tahmini yoktur. Creative alanının missing/null/empty hali korunur, override yokluğu diye yorumlanmaz. 28 yeni + 104 mevcut Meta testi sentetik; kanıt güncel gözlenen referans zinciriyle sınırlıdır, teslim edilen ürün/rol veya Shopify kimliği değildir. Gerçek runtime/kural yükleyicisi, rapor namespace'i ve kaynak biçimi kanıtı açık. Canlı route/token/config, SQL ve Dataset değişmez; tarihsel EO-04 kabulü korunur. Ayrıntı: `contracts/eo-05-start-brief-v1.json#Meta_Ad_creative_catalog_reference_composition_2026_10_27` ve `docs/EXECUTION_PLAN.md`.

27 Ekim EO-05 Meta katalog referansı: #200 `ebaeaf1a757fd76e2b7a8b190b527949e05e6ce6` main'dedir. Ad Set'in native hesap ve promoted katalog/ürün kümesi referansı #200 okuyucusuna kompoze edilir; token native olarak incelenir, referans okuma öncesi/sonrası ve sunucu bağlamı aralarda karşılaştırılır. Bu, global hesap/katalog ataması veya tekil Ad/creative ürün teslimi kanıtı değildir; rapor namespace'i, Shopify kimliği ve rol ayrımı açık kalır. 35 yeni + 69 regresyon testi sentetik. Canlı route, token/config, SQL veya Dataset değişmedi; gerçek lifecycle/vault/Reporting Account yükleyicisi mevcut 11. adımda kalır. Kaynak ve kapsam: `contracts/eo-05-start-brief-v1.json#Meta_AdSet_catalog_reference_composition_2026_10_27` ve `docs/EXECUTION_PLAN.md`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Meta katalog okuyucusu: #199 `894ad59dbd1db19783295693928c0bbbb4c2b576` main'dedir. 9. adımın ürün kaynağı okuması hazırlanır; katalog iç ID ve retailer ID ayrı namespace'lerle korunur. Ham grup/feed ayrıntısı Shopify kimliğine çevrilmez; kaynak tekrarı, belirsiz retailer eşleşmesi ve eksik sayfalama ayrılır. 34 test sentetiktir. Resmî referansın 429 erişim hatası sonrasında Meta'nın kendi SDK v26 kaynakları incelendi; bu kaynaklar gerçek Shopify biçimi veya Insights kimlik anlamını kanıtlamaz. Ads hesabı–katalog bağı, namespace/kaynak biçimi ve güvenilir runtime kompozisyonu açık kalır. Route, canlı token/config, SQL veya Dataset değişmez; tarihsel EO-04 kabulü korunur. Ayrıntı: `contracts/eo-05-start-brief-v1.json#Meta_catalog_source_reader_2026_10_27` ve `docs/EXECUTION_PLAN.md`.

27 Ekim EO-05 Google→Shopify aday doğrulaması: #198 `aba31161a948f66e90ba80c636a2c2fbe85e4ecf` main'dedir. 8. adım için mevcut 11'in ortak Shopify ürün/varyant/ana ürün doğrulayıcısı ve koşullu Google kaynak kuralı çözümleyicisi hazırlandı. Onaylı kaynak kuralı yoksa kimlik parçalanmaz, Shopify çağrısı yapılmaz. Tek GraphQL okuması aynı mağaza ile GID/legacy ID ve ana ürün ilişkisini sınar; null, bozuk yanıt ve çelişki ayrılır. Sonuç kalıcı yazıma kapalı taslaktır; Ads bağı/güncel lifecycle birleşimi ve gerçek kaynak biçimi kanıtı açık kalır. 49 yeni + 63 regresyon testi sentetik; canlı kabul, SQL veya Dataset yazımı yoktur. Ayrıntı `contracts/eo-05-start-brief-v1.json#Google_source_rule_Shopify_candidate_verification_2026_10_27` ve `docs/EXECUTION_PLAN.md`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Google Ads–Merchant bağı: #197 `94511c5c9e6fb93f400057671cc247315b5b29ed` main'dedir. Aktif `product_link` okuması mevcut Merchant kaynak okuyucusuyla kompoze edildi; hedef bağ okuma öncesi/sonrası aynı olmalı, sunucu bağlamı ve credential değişirse sonuç atılmalıdır. 35 yeni ve 28 mevcut okuyucu testi sentetik HTTP ile geçti. Gerçek lifecycle/vault/Reporting Account yükleyicisine bağlama mevcut 11. adımda; bu kompozisyon Shopify kimliği, canlı kabul, atomik DB yazımı veya aktivasyon yetkisi değildir. Route, SQL ve Dataset değişmez. Kapsam ve kalanlar: `contracts/eo-05-start-brief-v1.json#Google_Ads_Merchant_link_composition_2026_10_27` ve `docs/EXECUTION_PLAN.md`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Google Merchant kaynak okuyucusu: #196 `d5dce8eb6f021796695045affc7e97615e887580` ile main'dedir. 7. adım canlı kapıları açıkken 8. adımın bağımsız kaynak okuma hazırlığı yapıldı. Merchant ürünleri feed/dil/dataSource/yerel bağlamıyla ve değişmez ham kayıtla okunur; eksik sayfalama sonuç vermez, belirsiz ürün seçilmez. 28 sentetik test canlı kaynak biçimi veya Shopify kimliği kanıtı değildir. Ads–Merchant bağının güvenilir çağırıcıdan doğrulanması, kaynak kuralı ve Shopify ürün/varyant/ebeveyn denetimi mevcut sonraki adımlarda kalır. Route, canlı token/config, SQL ve Dataset değişmez. Ayrıntı: `contracts/eo-05-start-brief-v1.json#Google_Merchant_source_reader_2026_10_27` ve `docs/EXECUTION_PLAN.md`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Klaviyo izin kaynağı güncellemesi: #195 `f5fccc7fda0e34eae210e23e80239a9ef9153aad` ile main'dedir. Klaviyo'nun mevcut beş scope'u ve reporting eksik izin kontrolleri korunur. Şifreli tokenSet yeni native scope yanıtını önceki kayıttan korunan scope'tan ayırır; token yenilendi diye eski izin gözlem tarihi yenilenmez, tarihi olmayan eski scope `null` kalır. 28 yeni test sentetiktir. Bu çalışma yeni izin, canlı kabul veya kapatılmış Advertised/Cross Sell çalışması değildir. Kalan 7. adım işleri ve kaynak kompozisyonu sınırı `docs/EXECUTION_PLAN.md` ile `contracts/eo-05-start-brief-v1.json#Klaviyo_token_scope_provenance_2026_10_27` içindedir; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 Shopify izin okuması güncellemesi: #194 `f80cc9dd82141eb21c55623be464e1b4ccf6a210` ile main'dedir. Önceki grant okuyucusu aktif kurulumun okuma öncesi/sonrası denetimi ve scope karşılaştırmasıyla bir sunucu fonksiyonunda birleştirildi. Mağaza/workspace/nesil değişiminde sonuç atılır; eksik grant ile eski gözlem ayrılır. 24 yeni test sentetiktir. Yerel boş scope beyanı canlı grant'in boş olduğu anlamına gelmez. Config/yayın/mağaza onayı değiştirilmedi; fonksiyon mevcut route'larda aktive edilmedi. 7. adımın kalan izin, uygulama ve gerçek okuma testleri `docs/EXECUTION_PLAN.md` ve `contracts/eo-05-start-brief-v1.json#Shopify_active_installation_scope_readback_2026_10_27` içinde; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 başlangıç bağı güncellemesi: #193 `33783ecfa06f50010be648a651d31e3c35d78e90` ile main'dedir. Google/Meta kimlik OAuth başlangıcının sunucu koşulu varsayılan kapalıdır. State, mevcut kurulumdaki ilk başlangıca veya bağlantının UUID/sürümüne bağlanır; callback değişikliği provider alışverişinden ve seçim kaydından önce denetler. Bağlı hesap izin yükseltmesi mevcut stage fonksiyonuyla yapılamadığı için reddedilir; kapatılan bağlantı kendiliğinden açılmaz. Bu ön okumalar atomik DB yazımı değildir. Son yarışın çözümü, bağlı hesap yükseltmesi ve belirsiz credential yazmasının uzlaştırılması canlı aktivasyon öncesi, mevcut 14. değerlendirme sınırında kalır. 34 yeni test sentetiktir. Ayrıntı `docs/EXECUTION_PLAN.md` ve `contracts/eo-05-start-brief-v1.json#identity_OAuth_start_connection_binding_2026_10_27`; tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 sonraki güncelleme: Google credential dilimi #192 `807408603484578555fc8700eb50f9cfa420d07d` ile main'dedir. Meta kimlik credential'ının hesap/Reporting Account yeniden doğrulamasından önce güncel native token incelemesi hazırlanır. Şifreli amaç işaretli credential için uygulama, geçerlilik, tüm gerekli izinler ve süre tekrar okunur; eski izin listesi taze kanıt sayılmaz. Eski reporting token'ındaki fazladan izinler kimlik yetkisi oluşturmaz. İlk hatada durulur; otomatik exchange/tekrar yoktur. İzin adları ve süre bilgisi tek başına katalog erişimi veya Shopify ürün eşlemesi değildir. 35 yeni davranış testi sentetiktir; canlı kabul üretilmez. Kalan 7. adım işleri ve sınırlar `docs/EXECUTION_PLAN.md` ile `contracts/eo-05-start-brief-v1.json#Meta_identity_credential_reinspection_2026_10_27` içindedir. Tarihsel EO-04 kabulü korunur.

27 Ekim EO-05 güncellemesi: #191 `438bf5f8960cc2e25d4b6202a580cc1b1bf9b426` ile main'dedir. 7. adımın sonraki repository dilimi Google kimlik token'ında gerçek scope/veriliş/bitiş kaydını ve bağlı hesapta çağrı öncesi tek yenilemeyi hazırlar. Yeni credential mevcut sürüm/önceki credential/mağaza/kurulum nesli denetimiyle bağlanır. Bekleyen kurulumda süre dolarsa yeniden izin hatası verilir; otomatik connected yapılmaz. İlk sağlayıcı hatasında tekrar yoktur. Belirsiz yazmada şifreli zarf korunur, kullanılmaz; uzlaştırma canlı aktivasyon öncesinde açık iştir. Normal reporting yolu değişmedi. Bu işler kaynak varlık yetkisi, Shopify ürün eşlemesi veya canlı test kabulü değildir. Ayrıntı: `docs/EXECUTION_PLAN.md` ve `contracts/eo-05-start-brief-v1.json#Google_identity_credential_lifecycle_2026_10_27`. Meta credential incelemesi ve gerçek izin testleriyle 7. adım açık kalır; tarihsel EO-04 kabulü korunur.

**Ana paket:** A6-EO-04 — Meta, Google Ads ve Klaviyo adaptörleri
**Durum:** Kabul edildi — 2026-10-18
**Amaç:** Teknik olmayan bir okuyucunun üç sağlayıcının hangi ham gerçeği verdiğini, AdsTable'ın Channel ve Sales Role kararını nasıl ürettiğini, hangi çıkarımları kesinlikle yapmadığını ve EO-05'e hangi açık işleri devrettiğini tek belgeden anlayabilmesi.

Bu kitap EO-04'ün kabul edildiği günkü kapsamını korur. Sonraki A6-TECH-01 ve
A6-DOCS-01 kapanışları ile aktif EO-05 repository ilerlemesi `docs/EXECUTION_PLAN.md` içindedir.
23 Ekim 2026 ürün sahibi kararıyla Klaviyo içerik-kümesi Sales Role çıkarımı
düzeltildi. KLAVIYO-01/02/03 sonuçları artık `Assisted` olur; ürünler,
kimlikler, Message/Medium/Variation ve diğer sağlayıcı senaryoları korunur.

## 1. İş amacı ve gerçek çıktı

**27 Ekim ek izin işlemi bağlantısı:** #190 ön kontrol kodu main'e alındı. Google/Meta için hazırlanan ek izin amacı, mevcut OAuth transaction'ının tam state özetine bağlandı; dönüşte gerekli gerçek izinler eksikse credential kaydı yapılmaz. Google gerçek grant listesi pending seçim kaydında korunur. Varsayılan raporlama akışı ve Settings/UI değişmedi; yeni amaç güvenilir sunucuda henüz açılmadı. Bu repository kodu gerçek izin/varlık erişimi kabulü değildir. Güncel kapsam `contracts/eo-05-start-brief-v1.json#identity_OAuth_scope_binding_2026_10_27` içindedir; 7. adım açıktır.

**27 Ekim 7. adım izin hazırlığı:** EO-05'te scope hedefi ile gerçekten verilmiş izinleri karşılaştıran tanısal kod ve Shopify `currentAppInstallation.accessScopes` okuyucusu hazırlandı. Bu, Shopify sipariş/ürün okuyucusu veya canlı izin kabulü değildir. Google Merchant, Meta katalog bağımlılıkları, Shopify sipariş/geçmiş/MarketingEvent koşulları ve Klaviyo mevcut scope'ları `contracts/eo-05-start-brief-v1.json#identity_permission_preparation_2026_10_27` içindedir. Eksik gözlem ve eski/uyuşmayan kanıt gerçek eksik grant'ten ayrılır; bütün scope'ların eşleşmesi tek başına App Review/varlık erişimi veya aktivasyon yetkisi üretmez. Gerçek OAuth ve erişim testleri açık kalır; 7. adım tamamlanmadı.

**27 Ekim Shopify satış/atıf ek kararı:** Ürün sahibi Shopify sipariş ve ürün satırlarını bir kez sayılan bağımsız satış referansı olarak kullanmayı kabul etti. Shopify kaynak/ziyaret atfı ile provider'ın kendi dönüşüm atfı ayrı korunacak; biri diğerini değiştirmeyecek. Tekilleştirme Shopify Order ID ve LineItem ID'nin workspace/mağaza kapsamında yapılmasıyla tasarlanacak; Product ID tek başına satış anahtarı olmayacak. Yalnız paid-ad etiketliler değil erişime izin verilen tüm siparişler kapsanacak. Provider toplamı ile Shopify toplamının farklı olması kesin sipariş overlap'i kanıtlamaz; aynı siparişe bağlanan provider atıf kanıtı ayrıca gerekir. Mevcut üç provider PD/CPD matrisi veya Sales Role'ler değişmez. Fiziksel tablo sayısı belirlenmedi. İzin hazırlığı, EO-05-B/C ve EO-06-A bağlantıları Execution Plan'ın “Shopify sipariş satış temeli ve ayrı atıflar” bölümünde; makinece okunur karar `contracts/pd-cpd-query-standard-v1.json#shopify_order_attribution_decision_2026_10_27` içindedir. Henüz canlı izin/reader/writer uygulaması değildir.

**27 Ekim güncel okuma kuralı:** EO-04'ün 18 Ekim kabulü korunur; EO-05 repository uygulaması başlamıştır ve ilk hata düzeltmesi #182 ile main'e alınmıştır. Bu kitabın eski META/GOOGLE senaryo kartları ürün hedefleri ve tarihsel açıklamalardır; gerçek provider ürün ilişkisi kanıtı veya bütünleşik runtime kabulü değildir. Ürün kümesine üyelik tek başına Advertised/Cross-sell vermez. Meta native ilişki decoder'ı/kanıtı ve Google raporlama rol bağlantıları açıktır. Klaviyo araştırması ürün kararıyla kapalıdır; Campaign Assisted, Flow Triggered ve mevcut Unclassified kuralları korunur. Kimlik/plan #179, Meta classifier #180 ve Klaviyo etkileşim okuyucusu #181 açık PR'lardır; main/canlı gibi okunmaz. Güncel sınır Execution Plan'dır. Bu açıklama kapanış kanıtını, mağaza/ürün adlarını veya tarihsel örnek kimliklerini değiştirmez.

EO-04, kurulu Shopify mağazasına bağlı doğrulanmış Meta, Google Ads ve Klaviyo
hesaplarından sağlayıcının kendi verisi olan raporlama kanıtını güvenli ve kanıta sadık biçimde
okuyan adaptör sınırıdır.

Paketin gerçek çıktıları:

- sağlayıcı hesabı, iş tarihi, saat dilimi, para birimi, sorgu ve API kaynak bilgisi;
- sağlayıcının gerçek Campaign ve Channel kimliği;
- reklamda gösterilen/tıklanan ürün ile satılan ürün kanıtının ayrı tutulması;
- yalnız kanıtla üretilen `Advertised`, `Cross-sell`, `Assisted`, `Triggered`
  veya `Unclassified` Sales Role;
- Sales Role'den ayrı `Unclassified Channel` ve `Zero Value` eksenleri;
- Channel maliyeti ile sağlayıcı ürün maliyetinin birbirine dönüştürülmeden korunması;
- eksik, desteklenmeyen, izin reddi, bu çalıştırmada gözlemlenmeyen ve açık sıfırın
  ayrı sonuçlar olmasıdır.

EO-04 Dataset V2, zamanlayıcı, kalıcı tarihsel anlık görüntü, maliyet dağıtımı,
sağlayıcı atıflarındaki örtüşmeleri uzlaştırma veya kullanıcıya dönük analiz UI'ı üretmez.

## 2. Aktörler ve otoriteler

- **Kurulu Shopify mağazası:** Ticari ürün ve satış otoritesidir.
- **Sağlayıcı Reporting Account:** Meta ve Google Ads sorgularının doğrulanmış
  hesap kapsamıdır. Klaviyo bağlantının kendisini tek hesap olarak kullanır.
- **Sağlayıcı API:** Channel, attribution (satışın kaynağa atfı), ürün ve metrik kanıtının dış otoritesidir.
- **Meta Ad:** Meta için tek gerçek Channel'dır.
- **Google Ad Group / Asset Group:** Kampanya ailesine göre Google Channel'ıdır.
- **Klaviyo Campaign Message / Flow Message:** Klaviyo Channel'ıdır.
- **Adaptör:** Sağlayıcı cevabını kayıpsız ve hata halinde güvenli biçimde durarak normalize eder; sağlayıcının
  vermediği ilişkiyi üretmez.
- **Shopify Admin API:** Desteklenen resmî sağlayıcı senkronizasyon yolundan türetilen ürün
  ve varyant adayını ticari ürün kimliğine doğrular.
- **EO-05:** Kalıcı saklama, Dataset V2, tarihsel PMax ürün listeleme ağacı anlık görüntüsü,
  veri uzlaştırma, örtüşme ve maliyet dağıtımı girdilerinin sahibidir; hesap/formül sahibi EO-06-A'dır.

Campaign, Meta Ad Set, Klaviyo Flow, trigger, split ve delay Channel değildir.
Creative, ürün listeleme ağacı düğümü ve Variation Channel'ın kanıt/alt-kırılımıdır.

## 3. Uçtan uca normal raporlama akışı

1. Çalışma zamanı, kurulu Shopify mağazasının kurulum neslini ve kanonik sağlayıcı
   bağlantısını doğrular.
2. Meta ve Google için kanonik Reporting Account, Klaviyo için doğrulanmış hesap
   otoritesi çözülür.
3. Sağlayıcıya özgü sınırlı sorgu aileleri aynı iş tarihi kapsamı için
   tamamlanır; eksik sayfa veya ilk sağlayıcı hatası kısmi yayın üretmez.
4. Campaign, gerçek Channel varlığı ve sağlayıcı alt kanıtı ayrı tutulur.
5. Reklamda gösterilen/tıklanan ürün kanıtı ile satılan ürün kanıtı karşılaştırılır.
6. Channel çözüm durumu, Sales Role ve Zero Value üç ayrı eksende üretilir.
7. Channel maliyeti ile varsa sağlayıcı ürün maliyeti ayrı kaynak bilgisiyle korunur.
8. Sonuç EO-05'in kanonik kalıcı saklama ve veri uzlaştırma hattına aktarılabilecek
   kanıta sadık ham/normalize kanıt olarak bırakılır.

## 4. Kanonik senaryo standardı

EO-04 örnekleri artık serbest metin olarak çoğaltılmaz. Her senaryo
`contracts/eo-04-canonical-scenario-matrix-v1.json` içindeki aynı kart yapısını
kullanır ve şu alanları taşır:

1. değişmez `scenario_id` ve iş sorusu;
2. sağlayıcı ve kampanya ailesi;
3. Campaign ile bütün Channel adayları;
4. Creative, ürün listeleme ağacı, Medium veya Variation gibi sağlayıcı alt kanıtı;
5. reklamda gösterilen ürün kanıt durumu: `exact`, `incomplete`, `unavailable` veya
   `conflicting`;
6. reklamda gösterilen/tıklanan ürün ve satılan ürün;
7. iş tarihi ve zaman kanıtı durumu;
8. beklenen Channel türü/adı ve `exact` / `unknown` çözüm durumu;
9. beklenen Sales Role ve bağımsız değer niteleyicisi;
10. Medium/Variation sonucu yalnız sağlayıcı sözleşmesinde varsa;
11. maliyeti koruma/dağıtma kuralı;
12. örtüşme veya yinelenme davranışı;
13. yasak çıkarımlar;
14. kanıt seviyesi ve sonraki paket sahibi.

### Ortak sonuç sözlüğü

| Durum | Sonuç |
| --- | --- |
| Doğrulanmış reklam etkileşimi ürünü ile satılan ürün aynı | Hedef `Advertised`; gerekli native kanıt olmadan üretilmez |
| Doğrulanmış reklam etkileşimi ürünü ile satılan ürün farklı; aynı kümede olabilir | Hedef `Cross-sell`; yalnız küme üyeliği/dışılığı yeterli değildir |
| Channel biliniyor, kesin reklamda gösterilen ürün kanıtı yok | `Assisted` |
| Geçerli Klaviyo Flow Message attribution'ı | `Triggered` |
| Ürün veya attribution kanıtı gerçekten çelişkili | `Unclassified` |
| Satış var, kesin Channel çözülemiyor | `Unclassified Channel`; Sales Role ayrı korunur |
| Pozitif adet ve açık sıfır satış değeri | Mevcut Sales Role + `Zero Value` |

`Unclassified Channel` Sales Role değildir. Kullanıcı açısından bilinmeyen bir
kampanyanın içeri sızdığı anlamına gelmez: **Satış doğrulandı, ancak mevcut
provider kanıtı exact Channel'ı belirlemeye yetmedi.** Teknik `unknown`,
`missing`, `partial` ve `stale` kanıt durumları veri kalitesi/kaynak bilgisi
katmanında ayrı korunur. `Zero Value` da Sales Role değildir.

## 5. Meta standardize senaryoları

Ortak kurulumda Campaign `Sonbahar Kampanyası`; gerçek Channel her zaman Meta
`Ad`dır. Ad Set örnek kartına Channel adayı olarak girmez.

| ID | Kurulum | Satılan ürün | Beklenen sonuç |
| --- | --- | --- | --- |
| META-01 | `İnci Küpe Videosu` Ad'ında kesin `İnci Küpe` | İnci Küpe | Channel kesin Ad; `Advertised` |
| META-02 | Aynı Ad'da kesin `İnci Küpe` | İnci Kolye | Channel kesin Ad; `Cross-sell` |
| META-03 | Ad biliniyor; genel reklam içeriği veya yalnız `product_set_id` | İnci Kolye | Channel kesin Ad; `Assisted` |
| META-04 | İnci Küpe hem `İnci Küpe Videosu` hem `Sonbahar Carousel` Ad'ında; Meta attribution yalnız ilk Ad'ı verir | İnci Küpe | İlk Ad kesin Channel; `Advertised` |
| META-05 | Meta aynı ürün attribution metriğini iki Ad altında döndürür | İnci Küpe | İki sağlayıcı Ad kaydı korunur; `Unclassified Channel` yok; bunlar iki Shopify siparişi sayılmaz |
| META-06 | Ad kesin fakat Creative ürün kimlikleri çelişkili | İnci Kolye | Channel kesin Ad; `Unclassified` |

### META-01 — Kesin reklam ürünü satılıyor

- **İş sorusu:** Ad içinde açıkça doğrulanan ürün satılırsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Küpe Videosu` adlı gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** Ad Creative kesin `İnci Küpe` ürün kimliğini taşır.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; kanıt durumu `exact`.
- **Satılan ürün:** `İnci Küpe`.
- **Zaman kanıtı:** Meta iş tarihi ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Küpe Videosu`; tür `Ad`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Ad harcaması Ad üzerinde korunur; ürüne tahminî dağıtılmaz.
- **Neden:** Satılan ürün kesin Creative ürün kümesinin içindedir ve sağlayıcı gerçek `ad_id`yi vermiştir.
- **Yasak çıkarım:** Ad Set veya Creative ayrı Channel yapılamaz.

### META-02 — Kesin reklam ürününden farklı ürün satılıyor

- **İş sorusu:** Küpe reklamından kolye satılırsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Küpe Videosu` adlı gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** Ad Creative kesin `İnci Küpe` ürün kimliğini taşır.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; kanıt durumu `exact`.
- **Satılan ürün:** `İnci Kolye`; kesin Creative kümesinin dışındadır.
- **Zaman kanıtı:** Meta iş tarihi ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Küpe Videosu`; tür `Ad`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Küpeye ait sağlayıcı ürün maliyeti varsa kolyeye taşınmaz; Ad harcaması dağıtılmaz.
- **Neden:** Channel Meta'nın verdiği Ad'dır; satılan ürün yalnız ürün ilişkisinin `Cross-sell` olduğunu belirler.
- **Yasak çıkarım:** `İnci Kolye` kullanılarak başka Ad seçilemez.

### META-03 — Ad biliniyor, reklam ürünü kesin bilinmiyor

- **İş sorusu:** Meta Ad'ı kesin fakat Creative genel veya yalnız `product_set_id` taşıyorsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Yeni Sezon Takıları` adlı gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** Genel video/görsel veya üyeleri açılamayan `product_set_id`.
- **Reklamda gösterilen/tıklanan ürün:** Kesin ürün kümesi yok; kanıt durumu `unavailable`.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Meta iş tarihi ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `Yeni Sezon Takıları`; tür `Ad`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Ad harcaması korunur; ürünlere dağıtılmaz.
- **Neden:** Ad kesin olduğu için Channel bilinmektedir; kesin reklamda gösterilen ürün kanıtı olmadığı için `Advertised` veya `Cross-sell` üretilemez.
- **Yasak çıkarım:** Ad adı, URL, görsel metni veya `product_set_id` kesin ürün listesi sayılamaz.

### META-04 — Aynı ürün iki Ad'da, attribution yalnız bir Ad'a ait

- **İş sorusu:** Aynı ürün birden fazla Ad'da bulunurken Meta yalnız bir `ad_id` verirse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel` adlı iki gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** `İnci Küpe Videosu` Creative kümesi `[İnci Küpe]`; `Sonbahar Takıları Carousel` Creative kümesi `[İnci Küpe, İnci Kolye]`; sağlayıcı atfı `İnci Küpe Videosu` Ad'ını verir.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; iki Ad'ın da kesin ürün kümesindedir.
- **Satılan ürün:** `İnci Küpe`.
- **Zaman kanıtı:** Meta iş tarihi ile sağlayıcının verdiği Ad attribution aynı pencerededir.
- **Beklenen Channel:** Yalnız `İnci Küpe Videosu`; tür `Ad`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Yalnız sağlayıcının attribution verdiği Ad kaydı bu sonuçta kullanılır.
- **Neden:** Meta Channel'ı ürün üyeliğinden değil doğrudan gerçek `ad_id`den gelir.
- **Yasak çıkarım:** Ürünün iki Ad'da bulunması `Unclassified Channel` veya ikiye dağıtım nedeni değildir.

### META-05 — Sağlayıcı aynı ürün metriğini iki Ad altında raporluyor

- **İş sorusu:** Meta aynı ürün için iki ayrı Ad satırında attribution metriği döndürürse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel` adlı iki gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** İki ayrı `level=ad` sağlayıcı satırı; her satır kendi gerçek `ad_id`sini taşır.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; iki Ad'ın kesin ürün kümesindedir.
- **Satılan ürün:** Sağlayıcı metriğinde `İnci Küpe`. EO-04 bu iki metriğin aynı Shopify sipariş olayı olduğunu iddia etmez.
- **Zaman kanıtı:** İki sağlayıcı satırı aynı Meta iş tarihi penceresindedir.
- **Beklenen Channel:** İki ayrı kesin sağlayıcı kaydı: `İnci Küpe Videosu` ve `Sonbahar Takıları Carousel`; ikisi de tür `Ad`.
- **Beklenen Sales Role:** Her Ad kaydı için `Advertised`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** İki sağlayıcı atfı kaydı ayrı korunur; bunlar toplanarak iki benzersiz Shopify siparişi üretilmez. Ticari veri uzlaştırma EO-05'e aittir.
- **Neden:** Sağlayıcı iki gerçek Ad kaydı vermiştir fakat tekil ticari satış otoritesi Shopify'dır.
- **Yasak çıkarım:** Kanıtsız bir Ad seçmek veya iki attribution metriğini iki Shopify satışı saymak yasaktır.

### META-06 — Ad kesin, ürün kanıtı çelişkili

- **İş sorusu:** Gerçek Ad bilinirken kesin Creative ürün alanları birbiriyle çelişirse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `İnci Takıları Reklamı` adlı gerçek Meta Ad.
- **Sağlayıcı alt kanıtı:** Bir kesin Creative alanı `İnci Küpe`, başka kesin alan `İnci Kolye` gösterir ve çatışma çözülemez.
- **Reklamda gösterilen/tıklanan ürün:** Kanıt durumu `conflicting`; adaylar `İnci Küpe` ve `İnci Kolye`.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Meta iş tarihi ve Ad attribution aynı rapor penceresindedir.
- **Beklenen Channel:** `İnci Takıları Reklamı`; tür `Ad`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Unclassified`.
- **Medium / Variation:** Meta EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Ad harcaması korunur; çelişki çözülmeden ürün maliyet dağıtımı yapılmaz.
- **Neden:** Channel kanıtı ile ürün kanıtı ayrı eksenlerdir; ürün çelişkisi gerçek Ad'ı belirsizleştirmez.
- **Yasak çıkarım:** Çelişkili ürünlerden biri seçilemez veya ürün çelişkisi `Unclassified Channel`a çevrilemez.

Bir ürünün birden fazla Ad'da bulunması PMax ürün listeleme ağacı örtüşmesi değildir.
Meta `level=ad` cevabı gerçek `ad_id` verdiği için Channel ürün üyeliğinden
seçilmez. Meta Ad harcaması ürüne taşınmaz. Canlı katalog cevabıyla ürün düzeyindeki
semantiği doğrulanmamış ürün kırılımındaki harcama, gerçek ürün maliyeti sayılmaz.

## 6. Google Ads standardize senaryoları

| ID | Campaign / Channel yapısı | Reklamda gösterilen/tıklanan ve satılan ürün | Beklenen sonuç |
| --- | --- | --- | --- |
| GOOGLE-01 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Küpe | Kesin Ad Group; `Advertised` |
| GOOGLE-02 | Standard Shopping / `Küpeler Ad Group` | İnci Küpe → İnci Kolye | Kesin Ad Group; `Cross-sell` |
| GOOGLE-03 | PMax; İnci Küpe yalnız `Küpeler Asset Group` ürün listeleme ağacında | İnci Küpe → İnci Kolye | Kesin Asset Group; `Cross-sell` |
| GOOGLE-04 | PMax; İnci Küpe hem `Küpeler` hem `Sonbahar Takıları` Asset Group ağacında | İnci Küpe → İnci Kolye | `Unclassified Channel`; `Cross-sell` korunur |
| GOOGLE-05 | PMax satış günü ağaç anlık görüntüsü yok; yalnız bugünkü ağaç var | İnci Küpe → İnci Küpe | `Unclassified Channel`; `Advertised` korunur |
| GOOGLE-06 | Search / `İnci Takılar Ad Group`; kesin reklamda gösterilen ürün yok | elde edilemiyor → İnci Kolye | Kesin Ad Group; `Assisted` |

### GOOGLE-01 — Standard Shopping, aynı ürün satılıyor

- **İş sorusu:** Standard Shopping'de tıklanan ve satılan ürün aynıysa ne olur?
- **Campaign:** `Takı Shopping`; aile `Standard Shopping`.
- **Channel adayları:** Yalnız `Küpeler Ad Group`.
- **Sağlayıcı alt kanıtı:** Cart Data öncü ürün kanıtı ve kesin Ad Group kimliği.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; kanıt durumu `exact`.
- **Satılan ürün:** `İnci Küpe`.
- **Zaman kanıtı:** Google Reporting Account saat diliminde aynı iş tarihi.
- **Beklenen Channel:** `Küpeler Ad Group`; tür `Ad Group`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Google'ın verdiği ürün maliyeti kendi reklamda gösterilen ürün satırında korunur.
- **Neden:** Sağlayıcı tıklanan/öncü ürün ile satılan ürünün aynı olduğunu kanıtlar.
- **Yasak çıkarım:** Ürün satırları toplanarak Channel toplamı yeniden üretilemez.

### GOOGLE-02 — Standard Shopping, farklı ürün satılıyor

- **İş sorusu:** Standard Shopping'de küpe tıklanıp kolye satılırsa ne olur?
- **Campaign:** `Takı Shopping`; aile `Standard Shopping`.
- **Channel adayları:** Yalnız `Küpeler Ad Group`.
- **Sağlayıcı alt kanıtı:** Cart Data Cross-sell kanıtı ve kesin Ad Group kimliği.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; kanıt durumu `exact`.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Google Reporting Account saat diliminde aynı iş tarihi.
- **Beklenen Channel:** `Küpeler Ad Group`; tür `Ad Group`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Küpeye ait sağlayıcı ürün maliyeti kolyeye taşınmaz.
- **Neden:** Ad Group sağlayıcı tarafından kesin verilir; farklı satılan ürün yalnız Sales Role'u belirler.
- **Yasak çıkarım:** Satılan kolye kullanılarak başka Ad Group seçilemez.

### GOOGLE-03 — PMax, tıklanan ürün yalnız bir Asset Group'ta

- **İş sorusu:** Tıklanan ürün tek ürün listeleme ağacında bulunuyorsa ve başka ürün satılıyorsa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** Yalnız `Küpeler Asset Group`.
- **Sağlayıcı alt kanıtı:** `Küpeler Asset Group` ürün listeleme ağacı ürünleri `[İnci Küpe, Halka Küpe]`; başka uygun Asset Group yoktur.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; yalnız `Küpeler Asset Group` ağacındadır.
- **Satılan ürün:** `İnci Kolye`; tanımlı ürün listeleme ağacının dışındadır.
- **Zaman kanıtı:** Sürümlenmiş ürün listeleme ağacı satışın sağlayıcıya göre tüm iş günü penceresini kapsar.
- **Beklenen Channel:** `Küpeler Asset Group`; tür `Asset Group`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Kesin sağlayıcı ürün maliyeti korunur; Asset Group maliyeti ürünlere dağıtılmaz.
- **Neden:** Tıklanan `İnci Küpe` yalnız bir Asset Group'a uyar; satılan kolye farklı üründür.
- **Yasak çıkarım:** Satılan kolyenin ağaç dışında olması Channel'ı değiştiremez.

### GOOGLE-04 — PMax, tıklanan ürün iki Asset Group'ta

- **İş sorusu:** Tıklanan ürün iki ürün listeleme ağacına uyarken satılan ürün yalnız bir ağaçta bulunursa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** `Küpeler Asset Group` ve `Sonbahar Takıları Asset Group`.
- **Sağlayıcı alt kanıtı:** `Küpeler Asset Group` ağaç ürünleri `[İnci Küpe, Halka Küpe]`; `Sonbahar Takıları Asset Group` ağaç ürünleri `[İnci Küpe, İnci Kolye]`.
- **Reklamda gösterilen/tıklanan ürün:** `İnci Küpe`; iki Asset Group ağacında da bulunur.
- **Satılan ürün:** `İnci Kolye`; yalnız `Sonbahar Takıları Asset Group` ağacında bulunur.
- **Zaman kanıtı:** Her iki sürümlenmiş ürün listeleme ağacı da satışın sağlayıcıya göre tüm iş günü penceresini kapsar.
- **Beklenen Channel:** `Unclassified Channel`; çözüm durumu `unknown`; iki aday Asset Group kaynak bilgisi olarak korunur.
- **Beklenen Sales Role:** `Cross-sell`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Satış ve kesin sağlayıcı ürün maliyeti korunur; hiçbir Asset Group'a dağıtılmaz.
- **Neden:** Channel'ı tıklanan `İnci Küpe` belirler ve bu ürün iki Asset Group'a uygundur. Satılan kolyenin yalnız ikinci ağaçta bulunması ikinci grubu Channel yapmaz.
- **Yasak çıkarım:** `İnci Kolye` kullanılarak `Sonbahar Takıları Asset Group` seçilemez veya satış iki gruba bölünemez.

### GOOGLE-05 — PMax geçmiş satışında satış-günü ağaç kanıtı yok

- **İş sorusu:** Geçmiş satış için yalnız bugünkü ürün listeleme ağacı varsa ne olur?
- **Campaign:** `Takı Performance Max`.
- **Channel adayları:** Bugünkü yapıda `Küpeler Asset Group`; satış günündeki adaylar kanıtlanmamıştır.
- **Sağlayıcı alt kanıtı:** 16 Ekim güncel ağaç ürünleri `[İnci Küpe, Halka Küpe]`; 1 Ekim satış gününü kapsayan sürümlenmiş ağaç yoktur.
- **Reklamda gösterilen/tıklanan ürün:** 1 Ekim'de `İnci Küpe`.
- **Satılan ürün:** 1 Ekim'de `İnci Küpe`.
- **Zaman kanıtı:** Satışın iş tarihi `1 Ekim`; eldeki ağaç `16 Ekim`; tarihle eşleşen tam gün kanıtı `missing`.
- **Beklenen Channel:** `Unclassified Channel`; çözüm durumu `unknown`.
- **Beklenen Sales Role:** `Advertised`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Satış ve kesin sağlayıcı ürün maliyeti korunur; bugünkü Asset Group'a taşınmaz.
- **Neden:** Ürünün kendisi satıldığı için Sales Role kesindir; fakat bugünkü ağaç 1 Ekim Channel'ını kanıtlamaz.
- **Yasak çıkarım:** 16 Ekim ağacı 1 Ekim için anlık görüntü veya kesin Channel yapılamaz.

### GOOGLE-06 — Search, kesin reklamda gösterilen ürün yok

- **İş sorusu:** Search Ad Group satışı var fakat kesin reklam ürünü yoksa ne olur?
- **Campaign:** `İnci Takılar Search`; aile `Search`.
- **Channel adayları:** Yalnız `İnci Takılar Ad Group`.
- **Sağlayıcı alt kanıtı:** Sağlayıcının ilişkilendirdiği Search dönüşümü ve kesin Ad Group kimliği.
- **Reklamda gösterilen/tıklanan ürün:** Kesin ürün kanıtı `unavailable`.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Google Reporting Account saat diliminde kesin iş tarihi.
- **Beklenen Channel:** `İnci Takılar Ad Group`; tür `Ad Group`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Google EO-04 sözleşmesinde tanımlı değildir / uygulanmaz.
- **Maliyet / kayıt davranışı:** Channel maliyeti korunur; ürüne tahminî dağıtılmaz.
- **Neden:** Ad Group bilinmektedir fakat Search sorgusu kesin reklamda gösterilen ürünü kanıtlamaz.
- **Yasak çıkarım:** Arama terimi veya açılış sayfası kullanılarak reklamda gösterilen ürün uydurulamaz.

PMax Channel'ı satılan ürün seçmez. GOOGLE-05 için tarihsel ürün listeleme ağacı
toplama/kalıcı saklama EO-05'in ilk zorunlu kapısıdır. Bugünkü ağaç geçmiş güne
kopyalanamaz.

## 7. Klaviyo standardize senaryoları

23 Ekim düzeltmesi: Message içerik kümesi, satışla ilişkili ürün etkileşimi
kanıtı değildir. Küme içinde veya dışında olmak `Advertised` / `Cross-sell`
üretmez. Geçerli Campaign Message bağlantısıyla yalnız içerik biliniyorsa
`Assisted` kullanılır. A/B/C içerikli mesajdan A/B/C/D satışı bu koşulda dört
`Assisted` satış olarak korunur. Ürün etkileşimi kanıtını toplama/eşleme yolu
bu düzeltmede eklenmez. Flow `Triggered` kalır. Ortak sözlüğün önceki küme
üyeliği açıklaması Klaviyo'ya bu ayrım olmadan uygulanamaz.

| ID | Message / alt kırılım | Satılan ürün | Beklenen sonuç |
| --- | --- | --- | --- |
| KLAVIYO-01 | Campaign Message `Sonbahar Takıları`; Medium `Email`; tek Variation katalogda bulunsa da olay Variation vermez | kesin içerikte İnci Küpe | Message kesin Channel; Medium kesin; Variation çözümlenmemiş; `Assisted` |
| KLAVIYO-02 | Aynı Campaign Message altında A/B veya çoklu Variation | kesin içerikte İnci Kolye | Message kesin Channel; Variation çözümlenmemiş; `Assisted` |
| KLAVIYO-03 | Campaign Message kesin içerik kümesi yalnız İnci Küpe | İnci Kolye | Message kesin Channel; `Assisted` |
| KLAVIYO-04 | Campaign Message biliniyor, içerik ürün kümesi elde edilemiyor | İnci Kolye | Message kesin Channel; `Assisted` |
| KLAVIYO-05 | Flow Message `Sepet Hatırlatma`; Medium `SMS`; kesin Flow Variation attribution | İnci Küpe | Üst Flow Message Channel; Variation kesin; `Triggered` |
| KLAVIYO-06 | Message attribution eksik, birden fazla Message veya Campaign/Flow çatışması | İnci Küpe | Satış bir kez korunur; `Unclassified Channel`; `Unclassified` |

### Campaign Audience — teknik geçiş, raporlama boyutu değil

- **Sağlayıcı ağacı:** `Sonbahar Kampanyası` → `Son 90 Günde Alışveriş Yapanlar` → `Sonbahar Takıları` → `Küpe Görseli`.
- **Audience:** `Son 90 Günde Alışveriş Yapanlar`.
- **İş amacı:** Audience, mesajın kime gönderildiğini belirleyen Klaviyo hedefleme/ayar katmanıdır. Campaign içeriğine giderken doğru Message üst varlık ilişkisini izlemek için kullanılır.
- **Channel:** `Sonbahar Takıları`; tür `Campaign Message`.
- **Medium / Variation:** Medium `Email`; Variation `Küpe Görseli`.
- **Reklamda gösterilen ürün:** Kesin Message içerik kümesi `[İnci Küpe]`.
- **Satılan ürün:** `İnci Kolye`.
- **Sales Role:** `Assisted`; içerik kümesi ürün etkileşimini kanıtlamaz.
- **Audience sonucu:** kanonik AdsTable satırına alınmaz; kullanıcıya gösterilmez; Channel olmaz; satışı bölmez veya ayrı raporlama grubu üretmez.
- **Yasak çıkarım:** Audience adı Channel, Campaign veya Variation yerine geçirilemez. Aynı Campaign altındaki başka bir Audience'ın Message içeriği bu satışa karıştırılamaz.

### KLAVIYO-01 — Campaign Message kesin, tek katalog Variation var

- **İş sorusu:** Campaign'de tek Variation bulunsa fakat olay yalnız Message attribution verse ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Sağlayıcı alt kanıtı:** `send_channel=Email`; katalogda `Küpe Görseli` adlı tek Variation; Ordered Product olayı Campaign Message'ı verir fakat Campaign Variation vermez.
- **Reklamda gösterilen/tıklanan ürün:** Message içerik kümesi kesin `[İnci Küpe]`.
- **Satılan ürün:** `İnci Küpe`.
- **Zaman kanıtı:** Klaviyo hesabının saat diliminde kesin iş günü olayı ve Message kataloğu kanıtı.
- **Beklenen Channel:** `Sonbahar Takıları`; tür `Campaign Message`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Medium `Email` kesin; Variation `unresolved`.
- **Maliyet / kayıt davranışı:** Bir Ordered Product olayı bir satış gerçeğidir; EO-04'te sağlayıcı kaynaklı Campaign/ürün maliyeti yoktur.
- **Neden:** Message ve içerik ürünü kesindir; içerik, satışla ilişkili ürün etkileşimini kanıtlamaz. Olay Campaign Variation'ı da kanıtlamaz.
- **Yasak çıkarım:** Katalogda tek Variation bulunması olayın kaynak olarak gösterdiği Variation kanıtı sayılamaz.

### KLAVIYO-02 — Campaign Message kesin, birden fazla Variation var

- **İş sorusu:** On Variation bulunsa bile Message biliniyorsa Channel ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Sağlayıcı alt kanıtı:** `send_channel=Email`; Variation A `Küpe Görseli`, Variation B `Kolye Görseli`; olay yalnız Campaign Message attribution verir.
- **Reklamda gösterilen/tıklanan ürün:** Message düzeyinde kesin içerik kümesi `[İnci Küpe, İnci Kolye]`.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Klaviyo hesabının saat diliminde kesin iş günü olayı ve Message kataloğu kanıtı.
- **Beklenen Channel:** `Sonbahar Takıları`; tür `Campaign Message`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Medium `Email` kesin; Variation `unresolved`; Variation listesi UI Channel adına eklenmez.
- **Maliyet / kayıt davranışı:** Bir Ordered Product olayı bir satış gerçeğidir; EO-04'te tahmini harcama dağıtımı yoktur.
- **Neden:** Message kesindir; içerik kümesi üyeliği ürün etkileşimini, olay da A/B Variation'ı kanıtlamaz.
- **Yasak çıkarım:** Variation A/B seçilemez veya çoklu Variation `Unclassified Channel` üretemez.

### KLAVIYO-03 — Campaign Message kesin, içerik dışı ürün satılıyor

- **İş sorusu:** Küpe içerikli Campaign Message kolye satarsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Sağlayıcı alt kanıtı:** `send_channel=Email`; Campaign Message attribution kesin.
- **Reklamda gösterilen/tıklanan ürün:** Message kesin içerik kümesi `[İnci Küpe]`.
- **Satılan ürün:** `İnci Kolye`; kesin içerik kümesinin dışındadır.
- **Zaman kanıtı:** Klaviyo hesabının saat diliminde kesin iş günü olayı ve Message kanıtı.
- **Beklenen Channel:** `Sonbahar Takıları`; tür `Campaign Message`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Medium `Email` kesin; Variation olay tarafından verilmediği için `unresolved`.
- **Maliyet / kayıt davranışı:** Estimated Email Spend kolyeye taşınmaz; maliyet dağıtımı EO-05'e aittir.
- **Neden:** Satılan ürün Message içerik kümesinin dışındadır; bu tek başına satışla ilişkili ürün etkileşimini veya Cross-sell rolünü kanıtlamaz.
- **Yasak çıkarım:** Satılan kolye Channel veya Variation seçemez.

### KLAVIYO-04 — Campaign Message kesin, içerik ürün kümesi yok

- **İş sorusu:** Message bilinirken reklam/içerik ürünü kesin kanıtlanamazsa ne olur?
- **Campaign:** `Sonbahar Kampanyası`.
- **Channel adayları:** Yalnız `Sonbahar Takıları` adlı Campaign Message.
- **Sağlayıcı alt kanıtı:** `send_channel=Email`; Campaign Message attribution kesin; içerik genel mağaza/kategori veya elde edilemiyor.
- **Reklamda gösterilen/tıklanan ürün:** Kanıt durumu `unavailable`; kesin ürün kümesi yoktur.
- **Satılan ürün:** `İnci Kolye`.
- **Zaman kanıtı:** Klaviyo hesabının saat diliminde kesin iş günü olayı ve Message kanıtı.
- **Beklenen Channel:** `Sonbahar Takıları`; tür `Campaign Message`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Assisted`.
- **Medium / Variation:** Medium `Email` kesin; Variation `unresolved`.
- **Maliyet / kayıt davranışı:** Bir Ordered Product olayı korunur; EO-04'te ürün maliyeti/dağıtımı üretilmez.
- **Neden:** Message kesin fakat reklamda gösterilen ürün kümesi kesin değildir.
- **Yasak çıkarım:** İçerik elde edilemiyor iken `Advertised` veya `Cross-sell` uydurulamaz; Variation belirsizliği Channel'ı bozmaz.

### KLAVIYO-05 — Flow Variation üst Message'a çözülüyor

- **İş sorusu:** Olay kesin Flow Message Variation verirse Channel ne olur?
- **Campaign:** `Sepet Hatırlatma Flow`; Flow yalnız üst bağlamdır.
- **Channel adayları:** Yalnız `Sepet Hatırlatma` adlı üst Flow Message.
- **Sağlayıcı alt kanıtı:** `send_channel=SMS`; kesin `Sepette Küpe` Flow Message Variation ilişkisi ve doğrulanmış üst Message.
- **Reklamda gösterilen/tıklanan ürün:** Flow için Sales Role içerik karşılaştırmasından değil sağlayıcı Flow atfından gelir; kesin reklam ürünü kümesi gerekli değildir.
- **Satılan ürün:** `İnci Küpe`.
- **Zaman kanıtı:** Klaviyo hesabının saat diliminde kesin iş günü olayı ve üst varlık ilişkisi.
- **Beklenen Channel:** `Sepet Hatırlatma`; tür `Flow Message`; çözüm durumu `exact`.
- **Beklenen Sales Role:** `Triggered`.
- **Medium / Variation:** Medium `SMS` kesin; Variation `Sepette Küpe` kesin ve ayrı alt kırılım olarak tutulur.
- **Maliyet / kayıt davranışı:** Bir Ordered Product olayı bir satış gerçeğidir; sağlayıcı kaynaklı Flow/ürün maliyeti yoktur.
- **Neden:** Variation ilişkisi üst Flow Message'ı doğrular; Variation Channel'ın alt kırılımıdır.
- **Yasak çıkarım:** Flow veya Variation Channel'ın yerine geçirilemez.

### KLAVIYO-06 — Message attribution eksik veya çelişkili

- **İş sorusu:** Olay tek bir Campaign/Flow Message'a çözülemiyorsa ne olur?
- **Campaign:** Kesin değildir; eksik Message, birden fazla Message, Campaign/Flow çelişkisi veya üst varlık çelişkisi olabilir.
- **Channel adayları:** Sağlayıcı kanıtı tek bir Message seçemediği için kesin aday yoktur.
- **Sağlayıcı alt kanıtı:** Message attribution eksik/çelişkili; Medium ve Variation da güvenilir biçimde çözülemez.
- **Reklamda gösterilen/tıklanan ürün:** Kanıt durumu `conflicting`; kesin içerik ilişkisi üretilemez.
- **Satılan ürün:** `İnci Küpe`; Ordered Product olayı olarak bir kez korunur.
- **Zaman kanıtı:** Olayın iş tarihi bilinmektedir fakat zamanlama Channel çözmek için kullanılamaz.
- **Beklenen Channel:** `Unclassified Channel`; çözüm durumu `unknown`.
- **Beklenen Sales Role:** `Unclassified`.
- **Medium / Variation:** İkisi de `unresolved`.
- **Maliyet / kayıt davranışı:** Satış bir kez korunur; başka Message toplamına dağıtılmaz.
- **Neden:** Sağlayıcı attribution kanıtı tek ve çelişkisiz Message kanıtlamamıştır.
- **Yasak çıkarım:** Zamanlama, en yakın gönderim veya rapor toplamları kullanılarak Message seçilemez; satış düşürülemez.

Klaviyo'da `send_channel` zorunlu Medium'dur. Campaign/Flow adı Channel değildir;
Campaign Message veya Flow Message Channel'dır. Variation Channel'ın yerine
geçmez. Message biliniyorsa Variation belirsizliği `Unclassified Channel` üretmez.

## 8. Negatif ve hata yolları

- İlk sağlayıcı hatası tam anlık görüntünün yayımlanmasını durdurur; kısmi aileler
  başarılı veri gibi yayımlanmaz ve otomatik ikinci sağlayıcı denemesi yapılmaz.
- Eksik, null, desteklenmeyen, izin reddi ve bu çalıştırmada gözlemlenmeyen sayısal sıfır olmaz.
- Sağlayıcı ürün kimliği Shopify kimliğine doğrulanamazsa ham sağlayıcı ID
  korunur; SKU, ürün adı veya varyant uydurulmaz.
- Meta genel reklam içeriğinden ürün tahmin edilmez.
- Google satılan ürün kullanılarak Asset Group seçilmez.
- Bugünkü PMax ürün listeleme ağacı geçmiş Channel'ı çözmez.
- Klaviyo zamanlama veya rapor toplamından Message/Variation tahmini yapılmaz.
- Bir sağlayıcının dönüşüm metriği Shopify ticari satış adedi gibi yeniden
  adlandırılmaz veya başka sağlayıcı metriğiyle toplanmaz.

## 9. Kalıcı durum ve veri sahipliği

EO-04'ün kalıcı sahip olduğu alan bağlantı ve adaptör sözleşmesi, sağlayıcının kendi verisi olan
ham kanıt yapısı, doğrulanmış hesap kapsamı ve gizli bilgi içermeyen kabul kanıtıdır.

EO-05 şunların kalıcı sahibidir:

- Dataset V2 kanonik satırlar;
- Google tarihsel ürün listeleme ağacı anlık görüntüleri ve geçerlilik aralıkları;
- zamanlayıcı kilidi/kontrol noktası;
- sağlayıcı atıflarındaki örtüşmeler ve Shopify satışlarıyla uzlaştırma;
- geçici/kesin olgunluk;
- dağıtılmış maliyet ve yeniden hesaplama kaynak bilgisi.

EO-04 canlı kanıt route'ları kalıcı kullanıcı iş akışı değildir; EO-05
zamanlayıcı kabulünde geçici taşıma mekanizması atomik olarak kaldırılır.

## 10. Secret ve güvenlik sınırları

- Token, client secret, developer token veya düz metin kimlik bilgisi dokümana,
  loga, test verisine veya GitHub'a girmez.
- Kullanıcı hesap kimliği, cursor, sorgu veya ürün eşleme otoritesi sağlayamaz.
- Çalışma zamanı yalnız doğrulanmış kurulum, bağlantı ve Reporting Account
  otoritesini kullanır.
- Sağlayıcı izin kapsamı genişletme, secret/ortam değişimi, canlı çağrı, veritabanı
  veya dağıtım her zaman kendi açık kapısına tabidir.
- Sentetik test verisi yalnız AdsTable mantığını sınar; sağlayıcı gerçeği değildir.

## 11. Operasyon, tekrar deneme ve gözlemlenebilirlik

- Sayfalama sınırlı ve içeriği yorumlanmayan cursor kurallarına uyar.
- Cursor döngüsü, sayfa/satır sınırı ve ilk sağlayıcı hatası işlemi güvenli biçimde durdurur.
- Tekrar yalnız sağlayıcı sözleşmesinde açıkça sınıflandırılmış geçici hatalara
  uygulanabilir; kimlik bilgisi, izin veya ayar hatasında otomatik alternatif
  rota yoktur.
- Gözlem durumu, destek durumu, adaptör/API sürümü, sorgu kaynak bilgisi,
  iş tarihi, saat dilimi ve para birimi sonuçla birlikte taşınır.
- Test hesabının boş sonucu Production sıfırı veya genel desteklenmeme kanıtı değildir.

Bu koşullu tekrar çerçevesi otomatik deneme yetkisi değildir. Bağlayıcı ilk
sağlayıcı hatası kapısı korunur; canlı işlem durur ve kullanıcıya dönülür.

## 12. Rollback, kurtarma ve güvenli başarısızlık

- Sağlayıcı ailelerinden biri tamamlanmazsa önceki tam anlık görüntü korunur;
  yeni kısmi anlık görüntü yayımlanmaz.
- Yeniden yetkilendirme sırasında raporlama yetkisi kapanır; geçmiş analiz verisi
  silinmez. EO-05 eksik iş tarihi aralığını açıkça tamamlar ve uzlaştırır.
- Güncel ağaç veya başka tarihli kanıt ile geçmiş PMax Channel uydurulmaz; sonuç güvenli biçimde `Unclassified Channel` kalır.
- Kesin ürün maliyeti kanıtı Sales Role, Zero Value veya Unclassified Channel nedeniyle
  silinmez; fakat Channel toplamı ürüne tahminî dağıtılmaz.

## 13. Kabul kanıtı ve bilinen sınırlar

Kabul edilmiş temel kanıtlar:

- `docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md`
- `docs/EO_04E_THREE_PROVIDER_CHANNEL_PRODUCT_ECONOMICS_START_BRIEF.md`
- Meta App Role ve saklanan canlı yanıt yapısı kanıtı
- Google test hesabı inceleme kanıtı ve tarihsel güvenlik testleri
- Klaviyo OAuth, raporlama, attribution ve yeniden yetkilendirme sözleşmeleri/testleri
- `contracts/eo-04-canonical-scenario-matrix-v1.json`
- `tests/eo-04-canonical-scenario-matrix.test.js`

Bilinen ve açıkça devredilen sınırlar:

- Meta ürün düzeyindeki canlı katalog cevabı henüz gözlenmemiştir.
- Google Production performans kanıtı Explorer veya daha yüksek erişim bekler.
- Tarihsel PMax ürün listeleme ağacının kalıcı saklanması henüz yoktur ve EO-05'in ilk kapısıdır.
- Klaviyo canlı raporlama çağrısı kapalıdır.
- Sağlayıcı atıflarındaki örtüşmeleri uzlaştırma, Dataset V2, kesinleşme ve maliyet dağıtımı EO-05'tedir.
- UI çizimi ve kullanıcıya dönük açıklama EO-07'dedir.

Bu kitap ve EO-04 ana paketi, repository doğrulaması ve paket envanteri
tamamlandıktan sonra ürün sahibinin 18 Ekim 2026 tarihli açık kapanış kabulüyle
`Accepted` durumuna geçti. Bu kabul, yukarıdaki devredilmiş sağlayıcı
doğrulamalarını tamamlanmış saymaz ve EO-05'i başlatmaz; sıradaki zorunlu kapı
`A6-TECH-01` bütünlük denetimiydi. Bu ifade 18 Ekim kapanış sırasıdır;
denetimin sonraki kabulü ve bugünün aktif kapısı Execution Plan'dadır.

## 14. Tek sonraki ana paket

EO-04'ün tek sonraki ana paketi **A6-EO-05 — Zamanlayıcı, Dataset V2, FX, olgunluk
ve veri uzlaştırma** paketidir. EO-05'in ilk zorunlu kapısı sürümlenmiş tarihsel
PMax ürün listeleme ağacı kanıtıdır.

## Sözleşme bölüm eşlemesi

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

## Resmî kaynak kontrolü

Sağlayıcı davranışı için kullanılan resmî kaynaklar 17 Ekim 2026'da yeniden
kontrol edilmiştir:

- Meta Marketing API resmî koleksiyonu: <https://www.postman.com/meta/facebook-marketing-api/overview>
- Meta Business SDK Ads Insights: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta Business SDK Ad Creative: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py>
- Google Shopping raporlaması: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- Google PMax perakende raporlaması: <https://developers.google.com/google-ads/api/performance-max/retail-reporting>
- Google PMax ürün listeleme grupları: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- Klaviyo Events API: <https://developers.klaviyo.com/en/reference/get_events>
- Klaviyo Campaign Values: <https://developers.klaviyo.com/en/reference/query_campaign_values>
- Klaviyo Flow Values: <https://developers.klaviyo.com/en/reference/query_flow_values>
