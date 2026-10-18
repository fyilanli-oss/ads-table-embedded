# EO-04-D — Geçici Klaviyo Run Evidence analist brief'i

**Kontrol tarihi:** 18 Ekim 2026
**Durum:** Repository implementasyonu ürün sahibi tarafından onaylandı; deploy ve canlı çağrı kapalı

## İş amacı ve kullanıcı sonucu

EO-04 kapanmadan önce kalıcı Klaviyo reporting runtime'ının bağlı test hesabında
gerçek provider cevaplarıyla güvenli biçimde çalışıp çalışmadığı görülmelidir.
Settings içindeki geçici `Run Klaviyo evidence` düğmesi tek bir salt-okunur
çalıştırma başlatır. Sonuç yalnız sorgu ailesi satır sayılarını ve sınıflandırma
sayılarını gösterir; ham provider satırı, ad, ID, profil, PII, ticari değer,
token veya credential göstermez ve kaydetmez.

Bu taşıma mekanizması ürün özelliği değildir. Dataset V2'ye yazmaz; scheduler,
reconciliation veya otomatik retry başlatmaz. Canlı çağrı, deploy ve Klaviyo
Sample Data Generation Tool kullanımı ayrıca ve açıkça onaylanacaktır.

## Çalıştırma sırası

1. Shopify Admin isteği ve aktif installation generation doğrulanır.
2. Canonical connected Klaviyo hesabı, gerekli read scope'ları ve şifreli
   credential authority doğrulanır.
3. Tarih kullanıcıdan alınmaz; bağlı hesabın IANA timezone'una göre o anki
   business date server tarafında hesaplanır.
4. Kalıcı runtime sırasıyla Shopify metric discovery, Campaign Values, Flow
   Values, Ordered Product Events ve yerel product-sale resolution çalıştırır.
5. İlk provider veya şema hatasında kalan aileler başlamaz; retry ve alternatif
   endpoint kullanılmaz.
6. Yalnız bütün aileler tamamlanırsa güvenli özet döner.

## Durum matrisi

| Durum | Görünen metin | Eylem | Beklenen sonuç |
| --- | --- | --- | --- |
| Idle | `Run Klaviyo evidence` | Düğmeye bas | Tek çalıştırma başlar |
| Loading | `Reading Klaviyo evidence…` | Yok | `loading` duplicate tıklamayı engeller |
| Present | `Klaviyo evidence received` | Yok | Aile satır sayıları ile exact ve Unclassified Channel sayıları gösterilir |
| Empty success | `Klaviyo evidence received` | Yok | Sonucun zero veya unsupported olmadığı açıkça yazılır |
| Error | `Klaviyo evidence stopped` | Yok | Exact güvenli hata kodu gösterilir; retry yapılmaz |
| Reauthorization | `Klaviyo evidence stopped` | Yok | Runtime fail-closed kalır; Settings canonical reconnect durumuna geçebilir |

Bir sayfa yüklemesinde success veya failure sonrasında düğme yeniden
çalıştırılamaz. Yeni bir çağrı ayrı kullanıcı kararı gerektirir.

## Shopify component mapping

| Görünür öğe | Exact component | Property | Resmî kaynak | Kontrol tarihi |
| --- | --- | --- | --- | --- |
| Evidence eylemi | `s-button` | varsayılan; async sırada `loading` | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button | 18 Ekim 2026 |
| Başarılı sonuç | `s-banner` | `tone="success"` | Shopify App Home web components | 18 Ekim 2026 |
| Empty sonuç | `s-banner` | `tone="warning"` | Shopify App Home web components | 18 Ekim 2026 |
| Hata | `s-banner` | `tone="critical"` | Shopify App Home web components | 18 Ekim 2026 |

Yeni modal, tarih alanı, section, raw HTML kontrolü, CSS, literal renk veya yeni
ürün yüzeyi eklenmez. Mevcut Klaviyo `Connected` bölümü kullanılır.

## Güvenli cevap

- API revision ve account-local business date;
- Campaign Message, Flow Message ve Ordered Product satır sayıları;
- Email, SMS, WhatsApp ve Push Medium sayıları;
- exact/unresolved Variation sayıları;
- exact/Unclassified Channel ve Sales Role sayıları;
- ürün property'lerinin yalnız present/absent sayıları;
- tamamlanan sorgu aileleri ve güvenlik kontrol bayrakları.

Ham isim, ID, profile, e-posta/telefon, product değeri, quantity, revenue,
provider request ID, cursor, hash, access token veya credential cevapta ve logda
yer almaz.

## Sample Data sınırı

Klaviyo'nun resmî Sample Data Generation Tool'u bir veri tipi için yalnız bir
kez mutation yapar. Klaviyo data; örnek profiller, email/SMS event'leri ve iki
örnek campaign sağlayabilir. Ecommerce sample data ise `custom ecommerce`
integration altında oluşur. AdsTable'ın kanonik metric discovery kuralı yalnız
`integration.name = Shopify` kabul ettiği için custom ecommerce sample data,
Shopify `Placed Order` veya `Ordered Product` kanıtı değildir.

Bu nedenle sentetik veri Campaign/Message/Medium veya genel response shape için
yardımcı olabilir; Shopify-native ürün satışı, attribution ve product identity
kabulünün yerini alamaz. Sample data üretimi bu repository implementasyonunun
dışındadır ve ayrı manuel onay ister.

## Unclassified Channel kullanıcı anlamı

`Unclassified Channel`, bilinmeyen bir kampanyanın sisteme sızdığı anlamına
gelmez. Görünen açıklama şudur: **Satış doğrulandı, ancak mevcut provider kanıtı
exact Channel'ı belirlemeye yetmedi.** Teknik `unknown`, `missing`, `partial` ve
`stale` evidence durumları ayrı kalır.

## Yetki sınırı

- Repository kodu, contract, test ve dokümantasyon: onaylı.
- Deploy: kapalı.
- Canlı Klaviyo çağrısı: kapalı.
- Sample data üretimi veya silinmesi: kapalı.
- Database, Dataset V2, secret/environment ve provider mutation: kapalı.
- Merge: ayrı ürün sahibi onayına bağlı.

## Resmî kaynaklar

18 Ekim 2026 tarihinde kontrol edildi:

- https://developers.klaviyo.com/en/reference/reporting_api_overview
- https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview
- https://developers.klaviyo.com/en/reference/get_metrics
- https://developers.klaviyo.com/en/reference/get_events
- https://developers.klaviyo.com/en/docs/generate_sample_data
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
