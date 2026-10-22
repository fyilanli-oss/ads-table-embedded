# EO-04 — Geçici sağlayıcı canlı kabul tetikleyicisi

## Geçici Meta test düğmesi — 22 Ekim 2026 analist özeti

Ürün sahibi Settings'e yalnız bu test için geçici düğme eklenmesini açıkça
onayladı. Bu karar, aşağıdaki ilk dar ek alan diliminin "yeni buton eklenmez"
sınırını yalnız bu taşıma mekanizması için değiştirir; sunucu sorgusu değişmez.
Ürün sahibi PR #164'ün merge ve dağıtımını ayrıca onayladı. Yalnız bu geçici
düğme için masaüstü/mobil görsel kontrolün dağıtımdan hemen sonra yapılmasını
açıkça kabul etti. İstisna kontrolün zamanını değiştirir; gerçek mobil veya ürün
sahibi görsel kabulünü kaldırmaz, görsel PASS/Done/Accepted veya paket kapanışı
vermez. Diğer UI kuralları değişmez. Görsel kabul ve canlı test henüz yapılmadı.

- Amaç: Mevcut Shopify Admin oturumundan, bağlı Meta'nın seçili Reporting
  Account'u için `2026-10-01` tarihli `promoted_product_metrics` testini başlatmak.
- Yerleşim: Bağlı Meta bölümünde hesap listesinden sonra, Reporting Account
  eyleminden önce tek secondary `s-button`; masaüstü ve mobil aynı doğal akış.
  Yeni modal, tarih alanı, özel CSS veya başka ürün yüzeyi yoktur.
- Bileşen eşlemesi: `s-button` / `variant="secondary"`, boolean `loading` ve
  `disabled`, React `onClick`; durum açıklaması özellik eklenmeyen `s-paragraph`.
  Mevcut onaylı Polaris RC runtime/type eşleşmesi korunur.
- Başlangıç metni: `Run Meta product test (2026-10-01)`.
- Loading: `Reading Meta product evidence…`; düğme disabled, ilk tıklama kilidi
  ilk await'ten önce alınır. Aynı Settings mount'unda ikinci istek yoktur.
- Başarı: `Meta product evidence received`; açıklamada yalnız tarih ve
  Channel/ürün satır sayıları vardır. Ham yanıt, kimlik, hash veya değer yoktur.
- Boş ürün sonucu: `Meta returned no product rows. This is not evidence of zero sales or global lack of support.`
- Hata/401/reauthorization/network/bozuk yanıt: `Meta product test stopped`;
  açıklama `Meta product test stopped. No retry was performed. Error code: ...`.
  Yalnız izinli büyük harf hata kodu gösterilir; token yenileme, OAuth başlatma,
  eski sorguya fallback veya otomatik tekrar yoktur. Düğme disabled kalır.
- İptal: Tıklamamak hiçbir istek yapmaz. Başlatılmış isteği iptal/yenileme veya
  navigasyonla yeniden başlatma yetkisi yoktur; yeni mount tek canlı çağrı
  onayını yenilemez. Bu kilit global/durable idempotency garantisi değildir.
- Bağlı değil / pending / reauthorization_required / başka Meta işlemi:
  mevcut durum ekranı korunur, test düğmesi gösterilmez.
- Değişmeyen sınır: authenticated POST `/settings/provider-live-evidence`,
  yalnız sabit provider/date/probe; sunucu token kasası ve yetki zinciri,
  güvenli sunucu logu, Dataset yazmama ve ilk sağlayıcı hatasında durma korunur.
  Google/Klaviyo test düğmeleri, hesap seçimi ve OAuth değişmez.
- Kaldırma: Test ve güvenli kanıt saklandıktan sonra ayrı gözden geçirilen
  cleanup ile düğme kaldırılır; arka planda kendiliğinden tekrar çalışmaz.
- Kabul planı: çift tıklama/concurrent çağrı, başarısız HTTP/network/JSON,
  yanlış probe/tarih/zarf, boş/present sonuç ve veri sızıntısı unit testleri;
  anayasa koruma, typecheck/build; ardından gerçek masaüstü ve en az 320 px
  gerçek mobil Shopify Admin kabulü ve açık ürün sahibi görsel kabulü.
  Preview ölçüsü gerçek mobil kabulü sayılmaz. Canlı test onayı tek çalıştırmadır.

Resmî kaynaklar, kontrol 22 Ekim 2026:
<https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/actions/button>,
<https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/typography-and-content/paragraph>,
<https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/resource-fetching-api>.

## Production önkoşulu — 22 Ekim 2026

PR #163 ürün sahibi onayıyla birleşti; güncel main'in önceki EO-05 kodları dahil
tamamını dağıtma onayı ayrıca alındı. `b0a4fbaca14ac751fae5d97bc9d71da3a446493f`
commit'i `dpl_ELF7zyKfwKzEiV9Dz7LrT7rMwqRp` ile Production READY oldu;
`embedded.adstable.app` alias'ı doğrulandı. Kontrolde son 5 dakikada runtime
hatası bulunmadı; bu canlı Meta testinin yapıldığı veya kabul edildiği anlamına
gelmez. PR #163 açıklamasında dağıtım kanıtı kayıtlıdır.

## Dar ek alan testi — 22 Ekim 2026

Ürün sahibi, mevcut `product_id` kırılımına
`converted_promoted_product_quantity` ve `converted_promoted_product_value`
eklenerek tek canlı test yapılmasını ve bunun için dar uygulama/dağıtımı onayladı.
Bu yeni yetki aşağıdaki tarihsel 16/17 Ekim kayıtlarını değiştirmez.
Merge ayrı açık onay gerektirir. Canlı test henüz yapılmadı.

Mevcut kimlik doğrulamalı POST kaynağına yalnız sabit
`"probe": "promoted_product_metrics"` seçeneği eklenir. `provider` yine `meta`,
`business_date` tek açık iş tarihidir. Normal istek ve Channel sorgusu değişmez;
hesap, token, URL, keyfi alan veya sürüm istemciden alınmaz. Yeni buton eklenmez.
Ürün sahibinin seçtiği tarih 1 Ekim 2026'dır. Test gövdesi:
`{"provider":"meta","business_date":"2026-10-01","probe":"promoted_product_metrics"}`.
Bu gövdenin belgelenmesi testin gerçekleştiği anlamına gelmez.

İlk sağlayıcı hatasında durulur; eski alanlarla tekrar veya başka teknik rota
yoktur. Mevcut sınırlı sayfalama korunur; tek test tek HTTP isteği demek değildir.
Başarılı yanıt yalnız alanların bulunma/boş/null/sıfır/dizi durumlarını ve eylem
türlerini bildirir. Ham ticari değer, ürün kimliği veya token yayımlanmaz.
Dataset yazımı, ürün eşlemesi ve Sales Role sınıflandırması yapılmaz. Mevcut
token reddi yaşam döngüsü davranışı korunur; yeni token veya izin üretilmez.
Boş ürün yanıtı ne gerçek sıfır ne genel desteklenmeme kanıtıdır.

Resmî SDK'da iki alan mevcut; bu, `product_id` ile uyumluluğu kanıtlamaz.
Kaynak, kontrol 22 Ekim 2026:
<https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>.
Dağıtım dayanağı, aynı kontrol tarihi: <https://vercel.com/docs/git/vercel-for-github>.

**Tarihsel kontrol tarihi:** 16 Ekim 2026

**Ürün sahibi analist brief'i kabulü:** 16 Ekim 2026'da kaydedildi.

**Repository uygulama yetkisi:** 16 Ekim 2026'da kaydedildi.

**Kabul edilmiş canlı kanıt:** 16 Ekim 2026'da kaydedildi.

**Ek canlı çağrı, veritabanı/secret değişikliği ve kanıt kapanışı merge'ü:**
Bu tarihsel aşamada yetkilendirilmemişti.

Bu belge 16/17 Ekim'deki sınırlı Meta kabulünün tarihsel kaydıdır. Eski merge ve
hazırlık durumları bugünün açık iş listesi değildir. Güncel kabul ve sıra
`docs/EXECUTION_PLAN.md`, nihai paket anlatımı `docs/EO_04_ANALYSIS_DESIGN_BOOK.md`
içindedir. Bu dil çalışması yeni canlı işlem yetkisi vermez.

## Analist sonucu

Dataset V2 ve EO-05 zamanlayıcısı yokken EO-04'ün gerçek sağlayıcı cevap
yapısını dar bir kapsamda inceleyebilmesi gerekiyordu. Kabul edilen çözüm,
mevcut Settings URL ailesi altında, kimlik doğrulamalı geçici bir HTTP kaynağıydı.
Dördüncü bir görsel ürün yüzeyi veya kullanıcı iş akışı değildi.

Ürün sahibi 16 Ekim 2026'da, kimlik doğrulamalı kaynak mevcut tarayıcı kontrolüyle
çalıştırılamadığı için bağlı Meta bölümünde tek ve küçük bir geçici butonu
onayladı. Modal, tarih alanı, yeni bölüm veya özel stil eklenmedi. Buton sabit
kabul edilmiş `2026-10-01` kanıt tarihini gönderdi; sayfa yüklemesi başına bir
denemeye izin verdi, başarı veya hata sonrasında etkisiz kaldı. Repository'de
bulunması tek başına dağıtım veya canlı sağlayıcı çağrısı yetkilendirmedi.

Ürün sahibi 17 Ekim 2026'da bu geçici görsel taşıma yolunu kapattı. Bağlı
Settings durumu yalnız Reporting Account ve Disconnect gösterir. Kimlik
doğrulamalı sunucu route'u, ayrıca onaylanacak App Role kabul çalışması için
korunur. OAuth izni, raporlama sorgusu veya sağlayıcı yetkisi değişmedi.

16 Ekim'de ayrı ayrı onaylanan iki Production çalıştırması başarıyla tamamlandı;
ancak embedded iframe konsolu mevcut tarayıcı log kanalından görülemediğinden
iki güvenli yanıt da saklanamadı. Ürün sahibi ardından yalnız repository
kapsamındaki düzeltmeyi onayladı, merge ve dağıtım yapıldı: tam yanıt sonrasında
izin listesindeki tek güvenli özet sunucu loguna yazıldı. Ayrıca onaylanan üçüncü
çalıştırma `2026-10-16T15:14:07.104Z` anında tamamlandı; güvenli özet saklandı,
çalışma zamanı hatası gözlenmedi.

Log; alan adları, durum sayıları, satır sayıları, sınırlı action türleri ve
kontrol bayraklarını içerir. Ham satır, ad, sayısal ticari değer, ham kimlik,
kimlik hash'i, sağlayıcı istek kimliği, cursor, cursor hash'i, token ve kimlik
bilgisi içermez. Eski tarayıcı konsolu kopyası kaldırıldı; sunucu logu tek
kanıt kanalı oldu. O aşamadaki buton metni, yerleşimi ve durum davranışı değişmedi.

## Kabul edilmiş canlı analist sonucu — 16 Ekim 2026

Ad/Channel isteği bir Ad satırıyla tamamlandı. `impressions`, `spend`, `clicks`
ve `inline_link_clicks` sayısal sağlayıcı kanıtı olarak vardı. `outbound_clicks`
ve `actions` dizi biçimindeydi; `action_values` yoktu. Action türleri arasında
açılış sayfası, bağlantı ve etkileşim hareketleri vardı; purchase, checkout veya
add-to-cart hareketi yoktu.

`impressions` ve `spend` doğrudan sağlayıcı kanıtı olarak kabul edildi.
Kanonik Ad Click seçilmedi: `clicks`, `inline_link_clicks` ve `outbound_clicks`
ayrı adaylar olarak kaldı. Ayrı kabul edilmiş eşleme olmadan
`landing_page_view`, Session sayılmadı. Purchase, checkout ve add-to-cart
kanıtının yokluğundan Funnel olayı türetilmedi.

`product_id` isteği başarıyla sıfır satır döndürdü. Sınıflandırma
`not_observed_in_this_execution` oldu: gerçek ürün sıfırı değildir ve Meta'nın
genel olarak `product_id` desteği olmadığını kanıtlamaz. Ürün satırı olmadan
alan durumu, Shopify ürün/varyant kimliği, Sales Role veya ürün Ad Cost üretilemez.

Ürün sahibinin, gözlenen Instagram reklamının Amazon ürün sayfasına yöneldiği
açıklaması sağlayıcının ürettiği kanıttan ayrı tutuldu. Bu bilgi eksik Meta
katalog kimliğiyle uyumludur, ancak nedensellik kanıtı değildir. Aynı akışı
tekrarlamak gerekmez. Sonraki ürün kanıtı kapısı, Meta kataloğuna bağlı ürün
reklamı ve ayrı canlı çağrı onayı gerektirir.

Kalıcı, güvenli hale getirilmiş kanıt:
`docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.

Tetikleyici, görsel olmayan `/settings/provider-live-evidence` kaynağında kalıcı
Meta raporlama çalışma zamanını kullanır. Yalnız `provider` ve tek
`business_date` kabul eder. Çağırandan mağaza, çalışma alanı, hesap, token,
sağlayıcı URL'si, cursor, alan listesi veya API sürümü kabul etmez.

## Yetki ve değişiklik sınırı

İstek; Shopify Admin kimlik doğrulaması, doğrulanmış Admin mağaza kimliği ve
mevcut aktif kurulum sorgusu kapılarından geçer. Sorgu salt okunurdur; kabul
route'u kurulum başlatmaz, oluşturmaz veya yeniden etkinleştirmez. Meta yetki
zincirinin özgün teknik adları:

```text
Installed Shopify Store
→ active installation generation
→ connected Meta authority
→ canonical Reporting Account
→ encrypted server-only token vault
```

Yani kurulu mağaza → aktif kurulum nesli → bağlı Meta yetkisi → kanonik
Reporting Account → yalnız sunucuda kullanılan şifreli token kasası.

Route; sağlayıcı gerçeği, Dataset V2 satırı, kurulum, bağlantı, token veya kanıt
kaydı yazmaz. Repository'deki kalıcı kanıt ayrı onaylanmış, güvenli hale getirilmiş
analist kaydıdır; uygulamanın veritabanına yazması değildir.

## Kabul edilmiş Meta kanıt davranışı

16 Ekim'deki tek istek tarihi, bir Ad/Channel sayfası ve ardından bir
`product_id` sayfası üretti. Otomatik tekrar yoktu. Hata işlemi durdurdu;
sonraki sağlayıcıya geçilmedi. Ürün isteği başarısızsa iki sayfa da dönmezdi.
Bu tek sayfalı tarihsel anlatım, 17 Ekim'deki kabul edilmiş App Role tam
sayfalama kuralını geri almaz; güncel kapsam
`docs/EO_04B_META_APP_ROLE_READINESS_BRIEF.md` içindedir.

Ad/Channel, standartlaştırılmış AdsTable veri ailesidir; fakat ilk canlı yanıt
sayısal yayın değil, kanıt kapısıdır. `impressions` ve `spend` doğrudan kanıttır.
Yanıt, `clicks`, `inline_link_clicks`, `outbound_clicks` ve dönen her
`actions/action_values.action_type` değerini listeler; kanonik click, session,
add-to-cart, checkout veya purchase eşlemesi seçmez. Saklanan canlı sonuçta
Ad Click çözümlenmemiş, Session eşlenmemiş ve Funnel kanıtı yok olarak kalır.
Sonraki kanonik eşleme ayrı ürün sahibi kararı gerektirir.

Ürün kırılımı ham sağlayıcı kanıtı olarak kalır; yalnız o aşamada kabul edilmiş
ürün gerçeklerini ister:

- `product_id`
- `impressions`
- `clicks`
- `spend`
- `converted_product_quantity`
- `converted_product_value`

Ürün gerçeklerini standartlaştırmaz, Sales Role atamaz, Shopify ürün/varyant
kimliğini eşlemez veya ürün `Ad Cost` yayımlamaz.

## Güvenli yanıt ve güvenli log ayrımı

Yanıt; satır sayıları, alan bazında durum sayıları, action türleri, istek
kimlikleri, sayfalama varlığı, cursor hash'leri ve satır kimliği hash'lerini
içerir. Sağlayıcı satırları, hesap/Ad/ürün adları, ham yetki kimlikleri,
token veya credential kimliği göstermez. Dataset V2'ye yayımlanamaz.

Bu tarihsel yanıt sözleşmesi, yukarıdaki dar sunucu loguyla aynı şey değildir:
log; sağlayıcı istek kimliği ve hash'leri dahil daha dar bir izin listesi kullanır.
Yeni log alanı veya veri toplama davranışı eklenmez.

## Yaşam döngüsü

HTTP tetikleyici geçicidir; kalıcı sağlayıcı çalışma zamanı yeniden kullanılabilir.
EO-05'in iş/zamanlayıcı yolu kabul edildiğinde bu route ve yalnız geçici taşıma
mekanizması atomik olarak kaldırılır.

## Tarihsel repository ve canlı kabul — 16 Ekim 2026

Ürün sahibinin onayladığı repository dilimi, güvenli sunucu logu düzeltmesi ve
Production dağıtımı tamamlandı. Üç başarılı route çalıştırması oldu; yalnız son
ve ayrıca onaylanan çalıştırmanın izinli canlı yanıt yapısı kanıtı saklandı.
Dataset V2 yazımı, veritabanı veya secret/ortam değişikliği olmadı.

## Tarihsel resmî kaynak kontrolü — 16 Ekim 2026

- Shopify Admin kimlik doğrulaması: https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
- Shopify embedded Admin route'ları: https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin
- Meta resmî Business SDK Ads Insights alanları: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py
- Meta resmî Business SDK Ad Insights istek parametreleri: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py
