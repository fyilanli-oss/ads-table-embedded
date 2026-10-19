# A6-EO-04-D — Klaviyo OAuth güvenliğini güçlendirme brief'i

**Tarihsel durum:** Repository uygulaması incelemeye hazırdı.

**Kaynak kontrol tarihi:** 17 Ekim 2026

Bu belge 17 Ekim'deki kapsam ve doğrulama kaydıdır; bugün yeni kod veya canlı
işlem yetkisi vermez. Güncel kabul ve sıra `docs/EXECUTION_PLAN.md`, nihai
paket anlatımı `docs/EO_04_ANALYSIS_DESIGN_BOOK.md` üzerinden okunur.

## Analist sonucu

Klaviyo raporlaması token'ın süresinin dolduğunu ancak bir sağlayıcı isteği
harcadıktan sonra öğrenmemelidir. AdsTable bu nedenle sağlayıcının verdiği
sona erme zamanını şifreli token kümesinde tutar. Süresi dolmuş, dolmak üzere
olan veya eski biçimli token, amaçlanan Klaviyo isteğinden önce yenilenir.
Yeni kimlik bilgisi de o istekten önce kalıcı kaydedilir; dönen yenileme
kimlik bilgisi yalnız bellekte bırakılmaz.

Ters sınır da aynı derecede önemlidir: Klaviyo bir sağlayıcı isteğine hata
verdiğinde AdsTable durur; token yenileyip başarısız isteği tekrar etmez.
Yetkilendirme kodunun süresinin dolması, yenileme yetkisinin geçersizliği,
Accounts kimlik doğrulama hatası, izin reddi ve açıklanamayan sağlayıcı hatası
ayrı durumlar olarak kalır.

## Kullanıcıya ve işletime etkisi

- Bağlı hesap için Settings'i açmak yerel okumadır. Geçici Klaviyo kesintisi
  tek başına bağlı Settings görünümünü bozamaz.
- Klaviyo gerektiren açık işlem önce kimlik bilgisini hazırlar, sonra bir
  sağlayıcı isteği yapar.
- Accounts `401` ve yenilemedeki `invalid_grant`, yeniden yetkilendirme
  gerektirerek raporlama yetkisini kaldırır; başarılı bağlantı uydurulmaz.
- Accounts `403` izin reddi olarak kalır; token süresi dolmuş gibi etiketlenmez.
- Açıklanamayan sağlayıcı hatası tekrar edilmeden hata olarak döner.

## K-1 ayırma kararı

PR #91, sunucu tarafı kimlik bilgisi güçlendirmesini Klaviyo'dan başlayan yeni
kurulum ekranıyla birleştiriyordu. Sunucu tarafı gereksinimleri geçerliliğini
korudu; ancak PR, K-2 öncesi `main`e dayanıyordu, kabul edilmiş raporlama çalışma
zamanıyla çakışıyordu ve çalışma zamanı değişikliklerini yeterli davranış testi
korumuyordu.

Bu nedenle yalnız sunucu tarafı güçlendirme, o günün güncel `main`inden yeniden
kuruldu. `/auth/klaviyo/install` giriş yolu, izole Shopify üretim öncesi ortamı
ve masaüstü/gerçek mobil görsel kabul sağlanana kadar ertelendi. Bu pakette
route, Settings metni veya eylem kontrolü değişikliği yoktur.

## Doğrulama sözleşmesi

Davranış testleri, dışarıdan verilen sahte yanıtlarla token ve Accounts HTTP
sonuçlarını gerçekten çalıştırır. İstekten önce yenileme sırasını, şifreli kasaya
kalıcı kaydı, bekleyen/bağlı yetkinin yenilenmesini, tek Accounts isteğini ve
ilk hatada kesin durmayı kanıtlar. Kaynak metin eşleştirme, bu çalışma zamanı
davranışlarının kanıtı sayılmaz.

## Kapsam sınırı

Tarihsel yetki yalnız repository kodu, test, sözleşme ve dokümantasyondur.
Canlı Klaviyo çağrısı, OAuth yürütme, sağlayıcı paneli, secret, ortam değişkeni,
veritabanı/migration, dağıtım veya UI değişikliği yetkilendirilmemiştir.

## Resmî kaynaklar

- [OAuth ile API çağrısı](https://developers.klaviyo.com/en/docs/set_up_oauth)
- [Uygulamanın OAuth akışını yönetme](https://developers.klaviyo.com/en/docs/handle_your_apps_oauth_flow)
- [Uygulamayı incelemeye gönderme](https://developers.klaviyo.com/en/docs/submit_your_app_for_review)

Kaynaklar 17 Ekim 2026'da yeniden kontrol edilmişti. Tarihsel araştırma/kabul
tarihi korunur; bu dil düzenlemesi yeni review başvurusu veya sağlayıcı testi değildir.

## Tarihsel repository doğrulaması

- Tam test kümesi: 333/333 PASS
- TypeScript kontrolü: PASS
- Production derlemesi: PASS
- Diff boşluk kontrolü: PASS
- Canlı sağlayıcı veya altyapı değişikliği: yok
