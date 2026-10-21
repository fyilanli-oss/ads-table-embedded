# AdsTable Embedded

AdsTable'ın yalnız Shopify Admin içinde çalışan temiz embedded uygulaması.

## Programın sınırları

- Kaynak repository: `fyilanli-oss/ads-table-embedded`
- Eski yapının kanıt repository'si: `fyilanli-oss/ads-table-dev`
- Aktif sağlayıcılar: Meta, Google Ads ve Klaviyo
- Ürün yüzeyleri: Funnel App Home (`/`), Ad Analysis (`/ad-analysis`) ve Settings (`/settings`)
- Başlangıçtaki barındırma durumu: yalnız önizleme (preview-only)
- Production cutover — eski yapıdan yeni yapıya nihai geçiş: yetkilendirilmedi
- Canlı veri veya token taşıma: yetkilendirilmedi
- Eski uygulamadan/çalışma zamanından aynen taşınan modül: sıfır

Geliştirme; A6-EO Execution Plan, makine tarafından kontrol edilen EO ana sözleşmesi ve Shopify Embedded UI Anayasası ile yönetilir.

Başlangıç durumu ile bugünkü kabul edilmiş durumu ayırmak için güncel yetki ve paket sırası [Execution Plan](docs/EXECUTION_PLAN.md) üzerinden okunur.

## Geliştirme makinesine erişemiyorsan

[Windows VM kurtarma rehberi](docs/runbooks/WINDOWS_VM_RECOVERY.md), 21 Ekim 2026'da
yaşanan RDP/`Please wait` olayını, SAC girişini, disk ve sanal bellek kontrollerini
ve kontrollü yeniden başlatmayı adım adım açıklar. Komutları topluca çalıştırma;
değişiklik öncesi koşulları ve ilk hatada durma kuralını oku. Bu, AdsTable üretim
uygulamasının kurtarma planı veya EO-05/ilert etkinleştirmesi değildir.

