# EO-03-D — Yeniden bağlanma, bağlantıyı kesme ve yenileme yaşam döngüsü

**Kontrol tarihi:** 9 Ekim 2026

**Durum:** Kabul edildi

**Ana paket:** A6-EO-03 — Tek yetkili OAuth, bağlantı ve token kasası

Bu belge 9 Ekim 2026'daki tasarımı, geri alınan sentetik kabul denemelerini, düzeltmeleri ve nihai kabulü anlatır. Ara “açık” durumları bugünkü açık iş listesi değildir. Tarihsel tekrar koşuları yeni deneme izni vermez. Güncel proje durumu Execution Plan'dadır.

## Analist sonucu

Meta, Google Ads ve Klaviyo bağlantılarının her biri, değiştirilemez kurulu Shopify mağazası altında bağımsız ve gerçeğe uygun yaşam döngüsü taşır.

Sağlayıcı yetkilendirme hatası sıfır veriye veya sessiz “bağlı” durumuna dönüşmez. Token yenileme hatası yeni sağlayıcı işini durdurur ve `reauthorization_required` olur. Kullanıcının bağlantıyı kesme isteği önce yeni işi durdurur; sağlayıcı iptal kanıtı sınıflandırılana kadar `disconnect_pending` kalır. Disconnect geçmiş analiz verisini silmez; gizlilik silmesi tek silme yaşam döngüsüdür.

## Tarihsel resmî kaynak kontrolü

9 Ekim 2026 tarihinde:

- Shopify erişim token'ı yenileme, emeklilik ve iptal: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- Shopify uygulama kaldırma webhook'ları: https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-webhooks
- Meta resmî Marketing API koleksiyonu ve erişim token'ı temeli: https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi
- Google Ads erişim bilgisi yönetimi: https://developers.google.com/google-ads/api/docs/oauth/credential-management
- Google OAuth web sunucusu yenileme/iptal: https://developers.google.com/identity/protocols/oauth2/web-server
- Klaviyo OAuth yenileme, invalid_grant ve iptal: https://developers.klaviyo.com/en/v2026-01-15/docs/set_up_oauth
- Supabase değişiklik günlüğü: https://supabase.com/changelog
- Supabase RLS ve fonksiyon güvenliği: https://supabase.com/docs/guides/database/postgres/row-level-security

## Durum makinesi

`connected → reauthorization_required → connected`

`connected | reauthorization_required → disconnect_pending → disconnected → connected`

Kurallar:

- Yalnız `connected` durumunda sağlayıcı okuması, SnapshotJob veya hesap yetkisi yüklemesi uygundur.
- `reauthorization_required` şifreli erişim bilgisini yalnız güvenli değiştirmeyi destekleyecek kadar tutar; yeni raporlama verisi üretemez.
- `disconnect_pending` yeni işi hemen durdurur; sağlayıcı iptalini başarılı saymaz.
- `disconnected` erişim bilgisine başvurmaz; aktif sağlayıcı hesabı veya Reporting Account bağı yoktur.
- Yeniden bağlanma aynı yetkili bağlantı satırını kullanır; `connection_version` artar, hesaplar yeniden doğrulanır, gerekiyorsa geçerlilik tarihli yeni Reporting Account bağı oluşturulur.
- Her değişiklik beklenen bağlantı sürümü ve benzersiz olay kimliği ister.

## Sağlayıcı kuralları

### Shopify

Shopify kurulum/oturum token'ları ayrı yetkidir. Sağlayıcıya yeniden bağlanma kurulu mağazayı değiştiremez. Uygulamayı kaldırma ve gizlilik silmesi EO-02-D sorumluluğudur.

### Meta

EO-03-D olmayan bir refresh-token yetkilendirme türü uydurmaz. Doğrulanmış yeni yetkilendirme Meta'yı yeniden bağlayabilir. Sağlayıcıya özel token incelemesi ve iptal çağrısı adaptör işidir.

### Google Ads

Erişim token'ı kısa ömürlüdür; normalde şifreli yenileme token'ıyla yenilenir. `invalid_grant`, iptal edilmiş erişim veya kayıp izin kapsamı `reauthorization_required` olur. Eksik yenileme token'ı boş değerle değiştirilmez.

### Klaviyo

Yenileme/iptal için `https://a.klaviyo.com/oauth/token` ve `https://a.klaviyo.com/oauth/revoke` kullanılır. Yenilemede her `invalid_grant` yetki kaybıdır; yeniden bağlanma gerektirir.

## Atomik erişim bilgisi kuralları

- Döndürme veya yeniden bağlanmadan önce aynı çalışma alanı, kurulum nesli ve sağlayıcı için yeni şifreli zarf bulunmalıdır.
- Yenileme, beklenen eski erişim bilgisini ve bağlantı sürümünü karşılaştırır.
- Bağlantının yeni zarfa geçmesi ve eski şifreli zarfın silinmesi tek veritabanı işlemidir.
- Yeniden bağlanma aynı atomik değiştirmeyi yapar; açık metin göstermez.
- Aynı olay kimliğiyle tekrar aynı sonucu korur. Olay kimliğini başka bağlantıda kullanma güvenle reddedilir.

## Bağlantıyı kesme kuralları

1. Doğrulanmış kullanıcı niyeti bağlantıyı kesmeyi ister; yeni sağlayıcı işi hemen durur.
2. Adaptör sağlayıcıya özel iptal politikasını dener.
3. Yalnız sınıflandırılmış `revoked`, `already_invalid`, `not_supported` veya açık onaylı `local_authority_removed` kanıtıyla sonuçlandırılır.
4. Geçici zaman aşımı veya bilinmeyen yanıt `disconnect_pending` kalır.
5. Sonuçlandırma erişim bilgisi başvurusunu kaldırır, şifreli zarfı siler, bağlı hesapları pasifleştirir ve aktif Reporting Account bağını kapatır.
6. Tarihsel bağlar ve Dataset V2 gerçekleri korunur.
7. Disconnect her sağlayıcıda bağımsızdır; Delete My Data anlamına gelmez.

## Repository kapsamı

Dahil:

- Yaşam döngüsü durumu ve çakışmayı beklenen sürümle tespit etme;
- Yalnız sona eklenen, gizli bilgi içermeyen olaylar;
- Yenileme, yeniden yetkilendirme gereksinimi, bağlantıyı kesme isteği/sonucu ve yeniden bağlanma veritabanı işlemleri;
- Sağlayıcıdan bağımsız sunucu doğrulaması ve adaptör sınırı;
- Hesap/bağ geçmişinin korunması;
- Zorunlu RLS, yalnız fonksiyon erişimi ve olumsuz senaryo testleri.

Hariç:

- Canlı sağlayıcı HTTP yenileme/iptal çağrıları;
- Canlı OAuth;
- Settings arayüzü;
- SnapshotJob ve Dataset V2 uygulaması;
- Production dağıtımı.

## Kabul sırası

1. Repository uygulaması, sözleşme, testler, tür kontrolü, derleme ve CI geçer.
2. Ürün sahibi canlı migration'a ayrıca izin verir veya reddeder.
3. İzin verilirse tam migration uygulanır; şema, yetki, RLS, indeks ve Advisor kontrolleri yapılır.
4. Gerçek sağlayıcı token'ı olmadan, işlem sonunda geri alınacak sentetik yaşam döngüsü kabulü çalışır.
5. Bütün sentetik satırların ve geçici yetkilerin kaldırıldığı doğrulanır.
6. Kalıcı kanıt kaydedilir.
7. Ürün sahibi EO-03-D ve A6-EO-03'ü açıkça kapatır.

## Canlı veritabanı kanıtı — 9 Ekim 2026

Ürün sahibi canlı migration'ı ve geri alınan sentetik kabulü açıkça onayladı.

Supabase `podpwkrpmjiksskxhwsu` projesinde:

- PostgreSQL: `17.11.0.003`;
- Migration kaydı: `20261009141549 / eo03d_provider_connection_lifecycle`;
- Kaynak commit: `3abcac35c31d7eecf75ba10f044a8bd059133df5`;
- Migration blob'u: `a6e1403345de48d5dbdf8045256bc9a07a63c547`.

Canlı doğrulama:

- Yaşam döngüsü kolonları, olay tablosu ve gerekli altı yaşam döngüsü/raporlama fonksiyonu mevcut;
- Sağlayıcı yetki tablolarında zorunlu RLS;
- `anon`, `authenticated`, `service_role` ve `adstable_runtime` doğrudan tabloya erişemez;
- Kritik fonksiyonlar `SECURITY DEFINER`, `search_path` boş;
- Raporlama yetkisi `connected`, boş olmayan erişim bilgisi ve aktif Shopify kurulumu gerektirir;
- Supabase Security Advisor bulgusu sıfır;
- Bağlantı, erişim bilgisi veya olay test satırı yok.

## İlk geri alınan kabul bulgusu — 9 Ekim 2026

İlk canlı koşu fonksiyona ulaştı; tablo adıyla nitelenmemiş `connection_id` olay kolonu, fonksiyonun `RETURNS TABLE` çıktı değişkeniyle çakışarak PostgreSQL `42702` üretti. İşlem geri alındı; artık satır sıfırdı. İleri yönlü `20261009145154_eo03d_qualify_lifecycle_event_columns.sql` bu kolon başvurularını niteledi.

## İkinci geri alınan kabul bulgusu — 9 Ekim 2026

İlk düzeltme merge edildi; `20261009145154 / eo03d_qualify_lifecycle_event_columns` olarak uygulandı. Önceki belirsiz olay sorgusu geçti. İlk bağlantı güncellemesinde `connection_version = connection_version + 1` ifadesi, `RETURNS TABLE` çıktı değişkeniyle çakışarak `42702` üretti.

Sentetik işlemin tamamı geri alındı. Bağlantı, erişim bilgisi, hesap ve olay artığı sıfırdı. İleri yönlü `20261009150114_eo03d_qualify_lifecycle_update_columns.sql`, dört `provider_connections` güncellemesine takma ad verip kaynak `connection_version` başvurusunu niteledi. EO-03-D bu ara aşamada CI, açık merge/canlı onayı ve bütün senaryonun geçmesini bekliyordu.

## Üçüncü geri alınan kabul bulgusu — 9 Ekim 2026

İkinci düzeltme merge edildi; `20261009150114 / eo03d_qualify_lifecycle_update_columns` olarak uygulandı. Yeniden yetkilendirme, olayın yinelenmesinde aynı sonuç, atomik yenileme ve bağlantıyı kesme bekleme durumu geçti. Son bağlantı kesmede nitelenmemiş `reporting_account_bindings.connection_id`, çıktı değişkeniyle çakışarak `42702` üretti.

Dört fonksiyon gövdesinin statik incelemesi son kesme güncellemelerindeki iki kalan çakışmayı buldu: Reporting Account bağı ve sağlayıcı hesabı koşulları. `20261009150614_eo03d_qualify_finalize_update_columns.sql` ikisini birlikte takma adla niteledi. İşlem geri alındı; sentetik artık sıfırdı. Paket o aşamada CI, açık merge/canlı onayı ve tam başarılı koşu bekliyordu.

## Dördüncü geri alınan kabul bulgusu — 9 Ekim 2026

Üçüncü düzeltme merge edildi; `20261009150614 / eo03d_qualify_finalize_update_columns` olarak uygulandı. Yeniden yetkilendirme, olay tekrarı, yenileme, kesme beklemesi ve son kesme geçti. Yeniden bağlanmada `ON CONFLICT (connection_id, provider_account_id)`, çıktı değişkeninin adını içerdiğinden `42702` üretti.

Tabloda `provider_accounts_connection_account_unique` adlı benzersizlik kısıtı zaten vardı. İleri yönlü `20261009151123_eo03d_disambiguate_reconnect_conflict.sql`, `ON CONFLICT ON CONSTRAINT provider_accounts_connection_account_unique` kullanarak benzersizlik anlamını değiştirmeden belirsizliği kaldırdı. İşlem geri alındı; sentetik artık sıfırdı.

## Nihai geri alınan kabul — 9 Ekim 2026

Dördüncü düzeltme `f56be5d91d51b6d7132650accbc820c7a97b3690` commit'inde merge edildi; `20261009151123 / eo03d_disambiguate_reconnect_conflict` olarak uygulandı.

Bütün belirlenebilir yaşam döngüsü senaryosu geçti:

- `reauthorization_required` geçişi ve aynı olayın sonucu çoğaltmaması;
- Atomik erişim bilgisi yenileme ve değiştirilen eski zarfın silinmesi;
- `disconnect_pending` ve doğrulanmış son kesme;
- Aynı yetkili bağlantıya yeniden bağlanma ve yinelenen yeniden bağlanmada aynı sonuç;
- Eski sürüm/başka çalışma alanı için güvenli ret;
- Son bağlantı sürümü 6, aktif sağlayıcı hesabı ve aktif Reporting Account bağı.

Test işlemi geri alındı. Bağımsız canlı kontrol bağlantı, erişim bilgisi, olay, sağlayıcı hesabı ve raporlama bağı sentetik satırlarının tamamında sıfır artık buldu. Dört yaşam döngüsü değiştirme fonksiyonu `SECURITY DEFINER` ve boş `search_path` sınırını korudu. Security Advisor bulgusu sıfır kaldı. EO-03-D yeni indekssiz yabancı anahtar bulgusu üretmedi. İki Performance Advisor indekssiz-FK INFO bildirimi önceden vardı; ilgisiz privacy şemasına aitti.

Sağlayıcı API isteği, canlı OAuth, sağlayıcı paneli/Vercel değişikliği veya Production dağıtımı yapılmadı. Kalıcı kanıt: `evidence/eo-03d-live-database-evidence-2026-10-09.json`.

Ürün sahibi kapanış PR'ının merge onayıyla EO-03-D ve ana A6-EO-03'ü kabul etti. A6-EO-04 yalnız hazır oldu; bu kapanış onu başlatmadı.
