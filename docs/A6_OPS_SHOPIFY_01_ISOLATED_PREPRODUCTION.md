# A6-OPS-SHOPIFY-01 — İzole Shopify gömülü uygulama ön üretim ortamı

**Karar tarihi:** 17 Ekim 2026
**Durum:** Planlandı; tetikleyiciye ulaşılmadı; uygulama başlamadı
**Tür:** Bağımsız ön koşul paketi; aktif EO ana paketini ilerletmez
**Devreye alma son sınırı:** AdsTable kullanımı için gerçek mağazanın Shopify'a taşınması veya ilk dış/ekip dışı kullanıcının davet edilmesi; hangisi önceyse ondan önce

## Analist özeti

AdsTable'ın kayıt tarihinde çalışan bir Production Shopify uygulama kimliği ve Production barındırma sınırı vardır. Tek başına genel bir Vercel Preview URL'si, gerçek Shopify gömülü uygulama kabul ortamı değildir. Shopify yapılandırılmış uygulama URL'sini yükler, uygulama kimliği ve dönüş URL'lerini doğrular.

Bu paket, aynı repository sürümünü gerçek Shopify Admin içinde sınamak için izole bir yer oluşturmayı planlar. Mağaza sahibinin canlı mağazası veya Production uygulaması geliştirme ortamına çevrilmez.

Paket bilinçli olarak şimdi planlanıp sonra açılacaktır. Planlama; Shopify uygulaması/mağazası oluşturma, Vercel/Supabase değişikliği, secret oluşturma/kopyalama, sağlayıcı yapılandırması, deployment, kurulum, canlı API çağrısı veya gerçek veri taşıma yetkisi vermez. Güncel ilerleme için `docs/EXECUTION_PLAN.md` bağlayıcıdır; bu dil düzenlemesi paketi başlatmaz.

## 17 Ekim 2026'da kontrol edilen resmî dayanak

- Shopify, **uygulama yapılandırma dosyalarını yönetme**: Tek kod tabanı adlandırılmış yapılandırma dosyalarıyla ayrı geliştirme, hazırlık ve canlı uygulamalarına bağlanabilir. Shopify, canlı mağazada kurulu uygulamaya karşı aktif geliştirmeden kaçınmayı önerir. <https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files>
- Shopify, **geliştirme mağazaları**: Canlı mağazayı etkilemeden gerçekçi uygulama geliştirmek için sahip olunan test ortamlarıdır. <https://shopify.dev/docs/apps/build/stores/development-stores>
- Shopify, **uygulama yapılandırması**: `application_url`, gömülü çalışma modu ve yetkilendirme dönüş URL'leri seçili Shopify uygulama yapılandırmasına aittir. <https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration>
- Vercel, **ortamlar** ve **ortam değişkenleri**: Preview ile Production ayrı deployment ortamlarıdır; farklı yapılandırmalar taşıyabilir. <https://vercel.com/docs/deployments/environments> ve <https://vercel.com/docs/environment-variables>

Uygulama açıldığında bu kaynaklar yeniden kontrol edilmelidir. Dokümantasyon planın kanıtıdır; gelecekteki sağlayıcı davranışını varsayma izni değildir.

## İş sonucu

Ürün ekibi; mağazanın canlı Shopify yapısını veya Production AdsTable uygulamasını etkilemeden masaüstü/mobil gömülü davranışı, OAuth dönüşlerini, kurulum/oturum sınırlarını ve onaylı salt okunur sağlayıcı senaryolarını doğrulayabilir.

## Zorunlu kapsam

1. Yetkili kuruluşun sahip olduğu ayrı Shopify geliştirme uygulaması oluşturulur veya belirlenir.
2. Shopify geliştirme mağazası oluşturulur veya belirlenir; gerçek canlı mağaza bunun yerine geçemez.
3. Production yapılandırması değiştirilmeden geliştirme uygulamasına bağlı adlandırılmış, canlı olmayan Shopify yapılandırması eklenir.
4. Shopify Admin içinde gömülü çalışmaya uygun sabit HTTPS Preview/Staging uygulama URL'si ve birebir izinli dönüş adresleri sağlanır.
5. Preview'a özel Shopify kimlik bilgileri ve canlı olmayan secret'lar kullanılır. Production kimlik bilgisi değerleri Preview veya Development'a kopyalanamaz.
6. Canlı olmayan kalıcı veriler Production iş verisinden ayrılır. Preview kurulumu, oturumu, sağlayıcı token'ı, işi veya veri satırı Production sınırına yazamaz.
7. Sağlayıcı erişimi ayrıca onaya bağlıdır. Gerçek hesap kabulü salt okunur, rol/sahiplik yetkili, kesin hesaba bağlı ve o çalıştırma için açıkça onaylı olmalıdır.
8. Kapanıştan önce masaüstü/mobil Shopify Admin davranışı, ilk açılış, yeniden yükleme, OAuth dönüşü, oturum sürekliliği ve eksik/yanlış yapılandırmada güvenli durma kanıtlanır.
9. Production durumu silinmeden geliştirme uygulaması kurulumu, Preview takma adresleri/yapılandırması ve canlı olmayan kimlik bilgileri için geri alma/kaldırma adımları kaydedilir.
10. Yeniden kullanılabilir kanıt A6-EO-08-D'ye aktarılır; bu paket tek başına uygulamayı review'a hazır ilan etmez.

## Planlama sırasında açıkça kapsam dışı

- Production deployment veya alan adı değişikliği.
- Production Shopify uygulama yapılandırması değişikliği.
- Gerçek mağaza taşıması.
- Dış kullanıcı daveti.
- Production secret kopyalama.
- Production veritabanı veya mağaza verisi taşıma.
- Meta, Google Ads veya Klaviyo değişikliği/canlı isteği.
- Shopify, Meta, Google veya Klaviyo review başvurusu.
- Canlı geçiş, merge veya eski yapı silme.

## İş adımları

### A6-OPS-SHOPIFY-01-A — Yeniden doğrulama ve kesin envanter

Secret değerleri okunmadan ve sağlayıcı değiştirilmeden güncel resmî dokümantasyon yeniden kontrol edilir; Production Shopify uygulaması/yapılandırması, Vercel ortam adları, veritabanı sınırları ve sağlayıcı dönüş adresi bağımlılıkları listelenir.

### A6-OPS-SHOPIFY-01-B — İzolasyon tasarımı ve değişiklik onayları

Kesin geliştirme uygulaması/mağazası, sabit URL, izinli dönüş adresleri, Preview ortam anahtarları, canlı olmayan kalıcı veri sınırı, sorumluluk, maliyet ve geri alma planı sabitlenir. Her dış değişiklik kendi ayrı onayına tabidir.

### A6-OPS-SHOPIFY-01-C — Ayrı onaylı kurulum ve gömülü kabul

Yalnız açık onaydan sonra kabul edilmiş sınırlar kurulur; uygulama ayrı geliştirme mağazasında masaüstü ve mobilde doğrulanır. İlk açık veya açıklamasız sağlayıcı hatasında durulur; yeni açıklama ve onay olmadan tekrar denenmez veya rota değiştirilmez.

### A6-OPS-SHOPIFY-01-D — Kapanış ve kanıt devri

Production'ın değişmediği, Preview'ın Production verisine yazamadığı, Production kimlik bilgisinin kopyalanmadığı, zorunlu gömülü senaryoların geçtiği ve geri alma kanıtının bulunduğu kanıtlanır. A6-EO-08-D'de yeniden kullanılabilecek kanıt kaydedilir.

## Kapanış kuralı

Paket yalnız repository/CI kanıtı, secret içermeyen kesin ortam envanteri, masaüstü/mobil kullanıcı kabulü, izolasyon ve geri alma kanıtı, açık ürün sahibi kabulüyle kapanır. Kod, yapılandırma, deployment veya çalışan URL tek başına tamamlanma değildir.
