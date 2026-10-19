# EO-04-D — Geçici Klaviyo canlı kanıt çalıştırma analist brief'i

**Tarihsel kontrol tarihi:** 18 Ekim 2026

**Durum:** Production dağıtımı tamamlandı; ayrıca onaylanan tek çağrı,
Shopify entegrasyonu bulunmadığı için güvenli biçimde durdu. Ek çağrı kapalıdır.

Bu belge geçici kanıt eyleminin tarihsel kapsamını ve sınırlı sonucunu korur.
Güncel paket kabulü ve iş sırası `docs/EXECUTION_PLAN.md`, nihai anlatım
`docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir. Yeni canlı çağrı yetkisi verilmez.

## İş amacı ve kullanıcı sonucu

EO-04 kapanmadan önce kalıcı Klaviyo raporlama çalışma zamanının, bağlı test
hesabındaki gerçek sağlayıcı cevaplarıyla güvenli çalışıp çalışmadığı görülecekti.
Settings içindeki geçici `Run Klaviyo evidence` düğmesi tek bir salt okunur
çalıştırma başlatır. Sonuç yalnız sorgu ailesi satır sayılarını ve sınıflandırma
sayılarını gösterir; ham sağlayıcı satırı, ad, ID, profil, kişisel veri (PII),
ticari değer, token veya kimlik bilgisi göstermez ve kaydetmez.

Bu taşıma mekanizması ürün özelliği değildir. Dataset V2'ye yazmaz; zamanlayıcı,
veri uzlaştırma veya otomatik tekrar başlatmaz. Production dağıtımı 18 Ekim
2026'da ayrıca onaylandı. Canlı çağrı ve Klaviyo Sample Data Generation Tool
kullanımı ayrı açık onaya bağlıydı; tek çağrının sonraki sonucu aşağıdadır.

## Çalıştırma sırası

1. Shopify Admin isteği ve aktif kurulum nesli doğrulanır.
2. Merkezi kayıtla bağlı Klaviyo hesabı, gerekli okuma izinleri ve şifreli
   kimlik bilgisinin yetkisi doğrulanır.
3. Tarih kullanıcıdan alınmaz; bağlı hesabın IANA saat dilimine göre o anki
   iş tarihi sunucuda hesaplanır.
4. Kalıcı çalışma zamanı sırasıyla Shopify metrik keşfi, Campaign Values,
   Flow Values, Ordered Product Events ve yerel ürün satışı çözümlemesini yürütür.
5. İlk sağlayıcı veya şema hatasında kalan aileler başlamaz; tekrar ve alternatif endpoint yoktur.
6. Yalnız bütün aileler tamamlanırsa güvenli özet döner.

## Durum matrisi

İngilizce ekran metinleri özgün arayüz değerleridir; değiştirilmez.

| Durum | Görünen metin | Eylem | Beklenen sonuç |
| --- | --- | --- | --- |
| Hazır | `Run Klaviyo evidence` | düğmeye bas | tek çalıştırma başlar |
| Yükleniyor | `Reading Klaviyo evidence…` | yok | `loading` yinelenen tıklamayı engeller |
| Veri var | `Klaviyo evidence received` | yok | aile satır sayıları ile kesin ve Unclassified Channel sayıları gösterilir |
| Başarılı boş cevap | `Klaviyo evidence received` | yok | sonucun sıfır veya desteklenmeme anlamına gelmediği açıklanır |
| Hata | `Klaviyo evidence stopped` | yok | tam güvenli hata kodu gösterilir; tekrar edilmez |
| Yeniden yetkilendirme | `Klaviyo evidence stopped` | yok | çalışma zamanı güvenli biçimde kapalı kalır; Settings merkezi yeniden bağlanma durumuna geçebilir |

Bir sayfa yüklemesinde başarı veya başarısızlıktan sonra düğme yeniden
çalıştırılamaz. Yeni çağrı ayrı kullanıcı kararı gerektirir.

## Shopify bileşen eşlemesi

| Görünür öğe | Bileşen | Özellik | Resmî kaynak | Kontrol tarihi |
| --- | --- | --- | --- | --- |
| Kanıt eylemi | `s-button` | varsayılan; eşzamansız işlem sırasında `loading` | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button | 18 Ekim 2026 |
| Başarılı sonuç | `s-banner` | `tone="success"` | Shopify App Home web bileşenleri | 18 Ekim 2026 |
| Boş sonuç | `s-banner` | `tone="warning"` | Shopify App Home web bileşenleri | 18 Ekim 2026 |
| Hata | `s-banner` | `tone="critical"` | Shopify App Home web bileşenleri | 18 Ekim 2026 |

Yeni modal, tarih alanı, bölüm, ham HTML kontrolü, CSS, sabit renk veya ürün
yüzeyi eklenmez. Mevcut Klaviyo `Connected` bölümü kullanılır.

## Güvenli cevap

- API sürümü ve hesabın yerel iş tarihi;
- Campaign Message, Flow Message ve Ordered Product satır sayıları;
- Email, SMS, WhatsApp ve Push Medium sayıları;
- kesin/çözümlenmemiş Variation sayıları;
- kesin/Unclassified Channel ve Sales Role sayıları;
- ürün alanlarının yalnız var/yok sayıları;
- tamamlanan sorgu aileleri ve güvenlik kontrol bayrakları.

Ham isim, ID, profil, e-posta/telefon, ürün değeri, adet, gelir, sağlayıcı istek
kimliği, cursor, hash, erişim token'ı veya kimlik bilgisi yanıtta ve logda yer almaz.

## Örnek veri sınırı

Klaviyo'nun resmî Sample Data Generation Tool'u bir veri tipi için yalnız bir
kez veri oluşturma işlemi yapar. Klaviyo verisi; örnek profiller, e-posta/SMS
olayları ve iki örnek Campaign sağlayabilir. E-ticaret örnek verisi ise
`custom ecommerce` entegrasyonu altında oluşur. AdsTable'ın merkezi metrik
keşfi kuralı yalnız `integration.name = Shopify` kabul ettiği için bu örnek veri,
Shopify `Placed Order` veya `Ordered Product` kanıtı değildir.

Örnek veri Campaign/Message/Medium veya genel cevap yapısı için yardımcı
olabilir; Shopify kaynaklı ürün satışı, attribution ve ürün kimliği kabulünün
yerini alamaz. Örnek veri üretimi bu repository uygulamasının dışındadır;
ayrı manuel onay ister.

## Unclassified Channel kullanıcı anlamı

`Unclassified Channel`, bilinmeyen bir kampanyanın sisteme sızdığı anlamına
gelmez. Görünen açıklama şudur: **Satış doğrulandı, ancak mevcut provider kanıtı
exact Channel'ı belirlemeye yetmedi.** Özgün açıklama metni korunur; Türkçe anlamı,
satışın doğrulandığı fakat mevcut sağlayıcı kanıtının kesin Channel seçmeye
yetmediğidir. Teknik `unknown`, `missing`, `partial` ve `stale` kanıt
durumları ayrı kalır.

## Tarihsel yetki sınırı

- Repository kodu, sözleşme, test ve dokümantasyon: onaylı.
- Production dağıtımı: 18 Ekim 2026'da onaylandı.
- Canlı Klaviyo çağrısı: ek çağrı kapalı.
- Örnek veri üretimi veya silinmesi: kapalı.
- Veritabanı, Dataset V2, secret/ortam ve sağlayıcı değişikliği: kapalı.
- Merge: o gün ayrı ürün sahibi onayına bağlıydı; güncel kayıt Execution Plan'dadır.

## 18 Ekim 2026 canlı kapı sonucu

- Tam kaynak commit'i `b675885469effe9f3d9cb58135fa27d0219dcbb7`,
  Production dağıtımı `dpl_FBfQ8t9mV4vw4PZkKmtgbjDbDqdy` olarak `READY` oldu.
- Ürün sahibinin ayrıca onayladığı tek çağrı ilk `metrics` ailesinde
  `KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID` ile durdu.
- `completed_families=[]`; Campaign, Flow, Ordered Product ve çözümleme
  aileleri başlamadı. Tekrar, veritabanı/Dataset yazımı veya örnek veri üretimi olmadı.
- Ürün sahibi Klaviyo Metrics ekranında Shopify entegrasyonu bulunmadığını;
  yalnız `Klaviyo` ve `API` entegrasyon adlarını gözlemledi. Günlük değerlerin
  sıfır olması metrik kimliği/tekilliği kanıtı sayılmadı.
- Sonuç `environment_not_ready — shopify_integration_absent` olarak tutuldu;
  kod veya sağlayıcı arızası kanıtlanmadı ve EO-04 o ara aşamada bu kanıtla kapatılmadı.
- Geçici buton, gerçek Shopify mağazası Klaviyo'ya bağlanıp Shopify kaynaklı
  `Placed Order` ve `Ordered Product` metrikleri tam birer adet oluşana kadar
  korunur. Ek canlı çağrı yetkili değildir.
- Kalıcı kanıt:
  `docs/evidence/EO_04D_KLAVIYO_ENVIRONMENT_NOT_READY_2026-10-18.json`.

Sonraki EO-04 genel kabulü, bu ortam sınırının giderildiği veya başarılı
Shopify ürün satışı cevabı alındığı anlamına gelmez. Bu belge eski canlı çağrıyı
yeniden çalıştırma talimatı değildir.

## Resmî kaynaklar

Kaynak belgenin tarihsel kontrolü: 18 Ekim 2026.

- https://developers.klaviyo.com/en/reference/reporting_api_overview
- https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview
- https://developers.klaviyo.com/en/reference/get_metrics
- https://developers.klaviyo.com/en/reference/get_events
- https://developers.klaviyo.com/en/docs/generate_sample_data
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
