# Meta ham raporlarını mevcut kanıt deposuna bağlama

4 Kasım 2026. Owner onayı: “Metayı bağladım. Onaylıyorum.” Öncesinde açıklanan kapsam: mevcut iki rapor sorgusu, şifreli kaynak kaydı ve geri okuma doğrulaması, güvenli sunucu girişi, dar veritabanı rolü hazırlığı, izole test ve tek PR. Canlı SQL/ayar/Meta çağrısı, merge ve yayın ayrı onaylıdır.

Meta bağlantısı salt okunur veritabanı kontrolünde connected, version38 ve Reporting Account act_3774985849396161 olarak doğrulandı. Credential mevcut; içeriği okunmadı. Bu gözlem canlı rapor kabulü değildir ve çalışma planına sabit yetki oluşturmaz.

## İşin sonucu

Aynı mevcut depoda iki ayrı zarf: account_performance (ad_channel_daily_insights) ve product_performance (ad_product_breakdown_daily_insights). İkisi aynı operation/job/fence/kurulum/bağlantı/hesap/gün bağına sahiptir. Mevcut Meta rapor URL builder'ları ve alanları kullanılır; yeni sorgu, scope, hesap/katalog seçici veya ürün eşleme kuralı yoktur. Her zarfta kısa, secretsiz native izin kontrolü kanıtı da bulunur.

Bir raporun başarılı boş yanıtı yalnız o rapor için gerçek0'dır. Ürün raporu0 olması katalog yokluğu değildir. Mevcut ayrı kimlik/katalog okuyucusu gerçek Ad/AdSet/Campaign/Catalog bağları gerektirir; burada bu ID'ler uydurulmaz, katalog kimliği veya Shopify eşlemesi doğrulanmış sayılmaz. Genel rapor tablosu/Dataset yazılmaz.

## Okuma ve kayıt sırası

1. Yalnız sunucuda, açıkça etkinleştirilmiş ve en çok15 dakika geçerli exact hedef planı. POST /internal/meta/raw-capture yalnız Production, ayrı server secret, exact origin/path, tek operationId kabul eder. Browser/cookie/forwarded host yetki değildir; reddedilen istek SQL çalıştırmaz. Duplicate JSON anahtarı reddedilir.
2. Mevcut runtime rolü aktif Shopify kurulumunu yükler ve private Meta capability üretir. JSON sahte yetki vermez. Güncel connection/version/credential/Reporting Account ile preflight kaynağı birebir eşleşir.
3. Mevcut koordinatör aynı admission ve güncel Partner entitlement/quota kapılarını kullanır. Saatlik worker etkinleştirilmez. Bu dar okuma tamamlanınca iş paused kapatılır.
4. Her native HTTP öncesinde güncel hesap/credential/izin bağı ve kota tekrar kontrol edilir. Mevcut debug_token kontrolü native app/scopes/expiry doğrular; token değişimi/yenilemesi/revoke yapılmaz. Ardından iki rapor sırayla okunur. İlk hata sonraki isteği durdurur.
5. Provider paging.next takip edilmez veya saklanmaz. Yalnız opaque cursor ile mevcut sabit sorgu yeniden kurulur. Döngü/eksik cursor/eksik data/hesap-gün uyuşmazlığı hata,0 değildir. Yalnız seçilmiş alanlar depoya gider; token/URL/secret/private fazlalıklar çıkarılır. Sayılar lexical token, sağlayıcının decimal string'leri string olarak korunur. Projection eksiksiz HTTP byte arşivi değildir; alan kapsamı/sanitizer/sürüm kaydedilir.
6. Her tam rapor ayrı şifreli commit, exact makbuz geri okuması, bütün sayfaların sıralı geri okuması, metadata/ciphertext eşliği ve şifre çözülmüş payload hash karşılaştırmasıyla doğrulanır. İlk zarf bilinen başarılıyken ikincisi başarısız olursa ilk makbuz korunur; genel complete/empty verilmez. Kayıp commit cevabından sonra otomatik replay veya receipt sorgusu yoktur.

## Hazırlanan sınırlar

Okuma en çok60s, dış iş90s, private route120s ve fra1; aynı mevcut Frankfurt deposuna yakındır. Plan başına en çok1MiB HTTP,1000 native satır, iki raporun her birinde en çok10 sayfa ve toplam en çok21 Meta HTTP çağrısı (izin kontrolü dahil). Plan daha düşük sınır koyabilir; limit dolması partial/hata olarak durur. Bu değerler provider kotası iddiası değildir. Mevcut native kota kayıtları ayrıca zorunludur.

Yeni tablolar yoktur. Migration yalnız evidence.commit_meta_dataset_source RPC'sini hazırlar: owner/privacy/current credential/selection, fenced job/window/current entitlement ve quota snapshot'ı, bounded deadline ve izin expiry tekrar kontrol edilir. Başka dataset family, kimlik/sipariş/rule/mapping/claim/link yazımı reddedilir. RPC public/anon/authenticated/service_role/runtime/coordinator'a kapalıdır.

Ayrı prepared rol adstable_meta_source_runner NOLOGIN, parolasız, NOINHERIT, yetkisiz tablo erişimi ve rol üyeliği olmadan yalnız11 exact RPC EXECUTE alır. SQL istemcisi her RPC öncesi bütün profil/ACL'yi ve exact kullanıcıyı doğrular, TLS doğrulanmış Transaction pooler kullanır. Owner SQL veya genel table query gönderemez. Kurulum betiği mevcut rolü bulursa durur; canlıda çalıştırılmaz.

Mevcut runtime/koordinatör bağlantı istemcileri yeniden kullanılır (Google adlı modüllerdeki provider bağımsız RPC altyapısı). Google owner capability Meta için geçerli değildir; ayrı private Meta kanıtı gerekir. Google sorgu ve OAuth akışı değişmez.

## Kabul

Odaklı sentetik HTTP/SQL-boundary testleri; genel test/typecheck/build; üç F01 izole ortamında gerçek SQL, actual dar rol ve mevcut admitted Meta job üzerinde boş/dolu,403, kayıp write, bozuk içerik, eski fence, seçim değişimi ve expired permission provasının tamamı beklenir. F01 yeni SQL ve rolü transaction içinde geri alır; canlı migration ledger değişmez. CI sonucu PR'a kaydedilir. Unit HTTP gate testi tek başına canlı kabul değildir.

Private execution instance tek kullanımlıdır. Ayrı process/HTTP çağrılarında durable exactly-once iddiası yoktur: aynı operation'ın bilinen paused işi tekrar kabul edilmez, belirsizde durable stop ve owner'ın açık reconciliation/onay kapısı korunur. Plan sonradan yeni operation üretme yetkisi vermez.

Saklama kararı owner isteğiyle Meta ve Klaviyo kabulünden sonra birlikte uygulanacak.90/365 gün bugün kodda/canlıda etkinleştirilmez; mevcut geçici plan politikası korunur. Otomatik temizleme ve Dataset23/Overlap/saatlik refresh kapsam dışındadır.

## Resmî kaynak kontrolü — 4 Kasım 2026

- Meta resmi SDK: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py ve adsinsights.py. Mevcut Insights parametre/alan şeması incelendi. SDK alanı tenant erişimi, product_id namespace veya katalog eşleşmesi kanıtı değildir. Doğrudan Meta doküman sitesi429 verdi; bu native rapor sonucu değildir. Python SDK eklenmez.
- PostgreSQL17 GRANT: https://www.postgresql.org/docs/17/sql-grant.html . Supabase rol ve güvenlik belgeleri MCP search_docs üzerinden kontrol edildi; dar EXECUTE ve kapalı schema/RPC yüzeyi korunur. CLI3.0.0 migration new yalnız yerel dosya oluşturdu; link/push/apply yapılmadı.
- Vercel Functions region/duration: https://vercel.com/docs/functions/configuring-functions/region ve https://vercel.com/docs/functions/configuring-functions/duration .120s/fra1 yalnız yeni private resource route için hazırlanır; canlı deploy yoktur.
