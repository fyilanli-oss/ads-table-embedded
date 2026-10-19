# A6-EO-04-D — Klaviyo yeniden yetkilendirme durumunun doğru gösterimi

**Tarihsel durum:** Production'a dağıtıldı ve görsel kabul alındı; merge bekliyordu.

**Kaynak kontrol tarihi:** 17 Ekim 2026

Bu belge o günkü düzeltmeyi ve kabul kanıtını korur. Eski bekleyen durumlar
bugünün açık iş listesi değildir. Güncel kabul ve sıra `docs/EXECUTION_PLAN.md`,
nihai paket anlatımı `docs/EO_04_ANALYSIS_DESIGN_BOOK.md` içindedir.

## Analist sonucu

Kullanıcının başlattığı açık bir Klaviyo işlemi yetkilendirmenin artık geçerli
olmadığını kanıtlarsa raporlama yetkisi zaten güvenli biçimde kaldırılır.
Settings de aynı merkezi yaşam döngüsü gerçeğini göstermelidir;
`reauthorization_required` durumunu `Not connected` diye gösteremez.

Düzeltme, yerel yaşam döngüsü okumasıdır. Settings'i açmak Klaviyo çağrısı,
token yenileme veya başarısız sağlayıcı isteğini tekrar etme işlemi yapmaz.
Geçmiş harcama dönemleri değişmez.

## Durum matrisi

İngilizce ekran metinleri özgün arayüz sözleşmesidir; bu dil çalışmasında çevrilmez.

| Durum | Kullanıcının gördüğü metin | Eylem | Sonuç |
| --- | --- | --- | --- |
| Yükleniyor | `Klaviyo setup is being updated…` | yok | yinelenen eylem engellenir |
| Bağlantı kesilmiş | `Not connected` | `Connect Klaviyo` | yeni onaylı kurulum başlar |
| Bekliyor | `Account selection required` | `Resume setup` | hesap ve harcama tamamlama adımına döner |
| Bağlı | `Connected` | mevcut harcama ve bağlantı kesme eylemleri | yerel doğrulanmış yetki gösterilir |
| Yeniden yetkilendirme gerekli | `Reauthorization required` ve `Klaviyo authorization is no longer valid. Reconnect to continue.` | `Reconnect Klaviyo` | OAuth başlar; doğrulanmış tamamlama olmadan raporlama açılmaz |
| Hata | mevcut sınırlı genel hata kodu | hata sınıfına göre yeniden yükleme veya yeniden başlatma | gizli tekrar yok |
| İptal | mevcut iptal bildirimi | yok | hesap bağlanmaz |

## Shopify bileşen eşlemesi

| Görünür öğe | Bileşen | Özellik | Resmî kaynak | Kontrol tarihi |
| --- | --- | --- | --- | --- |
| Yaşam döngüsü durumu | `s-badge` | `tone="warning"` | https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge | 17 Ekim 2026 |
| Yeniden bağlanma eylemi | `s-button` | `variant="primary"` | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button | 17 Ekim 2026 |
| Açıklama | `s-paragraph` | mevcut varsayılan | Shopify App Home web bileşenleri | 17 Ekim 2026 |

Yeni görsel bileşen, CSS, renk, yerleşim veya ürün yüzeyi eklenmez.
Kabul edilmiş masaüstü/mobil Settings sunumu yeniden kullanılır.

## Sunucu ve veri sınırı

- Yalnız `connected` raporlama yetkisi taşır.
- `reauthorization_required` güvenli biçimde kapalı kalır ve yeni satır üretemez.
- Settings, sağlayıcı erişimi olmadan merkezi yerel yaşam döngüsü durumunu okur.
- OAuth tekrarı, alternatif sağlayıcı yolu, secret, dağıtım ve canlı Klaviyo
  çağrıları bu repository düzeltmesinin dışındadır.
- Harcama geçmişi silinmez ve yeniden yazılmaz.
- OAuth ile yeniden yetkilendirme sonrasında tarihsel hesap kaydı duruyor olsa
  bile bekleyen hesap doğrulamasına devam edilebilir. Yeni hesap kanıtı ve
  harcama tamamlama başarılı olana kadar raporlama kapalı kalır.

## EO-05 zorunlu takip işi

Kullanıcı farkında değilken yeniden yetkilendirme ihtiyacı, sağlayıcıdan veri
toplanmayan bir aralık oluşturabilir. EO-05, zamanlayıcı veya Dataset V2
kabulünden önce aşağıdakilerin tamamını tanımlayıp test etmelidir:

1. Son başarılı sağlayıcı kontrol noktasından doğrulanmış yeniden bağlantıya
   kadar eksik kalan iş tarihlerinin tam aralığı.
2. Sağlayıcıya özgü, sınırları belirlenmiş geçmiş veri tamamlama ve uzlaştırma pencereleri.
3. Açık `missing`, `partial`, `stale` ve kurtarılmış durumlar; uydurulmuş sıfırlar değil.
4. Tamamlama öncesinde, sırasında ve sonrasında kullanıcının ne göreceği.
5. Tamamlanan tarihlerin ne zaman geçici veya kesin sonuç sayılabileceği.
6. Sağlayıcı eksik aralığın tamamını döndüremediğinde uygulanacak davranış.

Bu takip işi burada tamamlanmış veya yetkilendirilmiş sayılmaz.

## Kabul

- Yaşam döngüsü okuması kurulum, kurulum nesli ve sağlayıcıyla sınırlıdır.
- Saklanan `reauthorization_required` satırı Settings'te yeniden bağlanma durumuna eşlenir.
- Tarihsel hesap ve harcama defteri silinmeden bekleyen hesap doğrulamasına devam edilebilir.
- Settings durum kontrolü sağlayıcı isteği yapmaz.
- Bağlı, bekleyen ve bağlantısı kesilmiş durumların davranışları bozulmaz.
- Repository testleri, typecheck, build ve Shopify UI koruma testleri geçer.
- Onaylı ekleyici migration, ayrılmış `ads-table-embedded` Supabase projesinde
  canlıdır. İki özel fonksiyon da beklenen sahibi, boş `search_path` değerini
  ve yalnız runtime rolüne verilen çalıştırma yetkisini korur.
- Ürün sahibi, repository'nin tam kaynak commit'i Production'a ulaştıktan
  sonra gerçek Shopify Admin Settings sonucunu masaüstü ve mobilde kabul etti.
  Merge bu tarihsel aşamada ayrı açık kapıydı.

## Resmî kaynaklar

- https://developers.klaviyo.com/en/docs/set_up_oauth
- https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button

## Tarihsel repository ve canlı kabul doğrulaması

- Tam test kümesi: 361/361 PASS
- TypeScript kontrolü: PASS
- Production derlemesi: PASS
- Diff boşluk kontrolü: PASS
- Canlı veritabanı migration'ı: PASS (`20261017135321 /
  eo04d_klaviyo_reauthorization_state`)
- Supabase Security Advisor: 0 bulgu
- Performance Advisor: migration'ın ürettiği bulgu yok; önceden var olan iki
  privacy yabancı anahtar INFO bulgusu o gün değişmeden kaldı
- Sağlayıcı çağrısı veya secret/ortam değişikliği: yok
- Kalıcı kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_LIVE_DATABASE_ACCEPTANCE_2026-10-17.json`
- Production dağıtımı: PASS (`dpl_8QgriVfjig4RjxC7hwpwtBJ77n8F`, commit
  `9bc3108d366a58ce9ff92a293681245a0c380462`, `embedded.adstable.app`)
- Masaüstü/mobil kontrolünden sonraki dağıtıma ait error/fatal taraması: temiz
- Masaüstü Shopify Admin Settings: PASS
- Mobil Shopify Admin Settings: PASS
- Görsel kanıt:
  `docs/evidence/EO_04D_KLAVIYO_REAUTHORIZATION_VISUAL_ACCEPTANCE_2026-10-17.json`
- Merge: bu ara kayıtta açık ürün sahibi onayı bekliyordu.

İki INFO bulgusu 17 Ekim'in tarihsel sonucudur. Sonraki F08 kapanışı
`docs/evidence/A6_TECH_01_F08_CLOSURE_2026-10-18.json` içindedir; bu dil
çalışması yeni Advisor kontrolü yapmaz ve eski kanıtı değiştirmez.

