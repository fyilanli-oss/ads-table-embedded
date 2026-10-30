# AdsTable Embedded repository çalışma kuralları

Bu repository temiz Shopify embedded-only AdsTable runtime'ıdır. **Execution Plan anayasadır.**

## OAuth — işlem öncesi zorunlu açık kullanıcı onayı (29 Ekim 2026)

**OAuth’a doğrudan veya dolaylı değen hiçbir çalışma, yapılacak somut işlem ve kapsam açıklanıp kullanıcıdan önceden açık izin alınmadan başlatılamaz.** Tüm sağlayıcılar ve Shopify dahildir.

- İnceleme/araştırma, akış ve ekran tasarımı, izin/kapsam, hesap/Reporting Account/Merchant/işletme/katalog seçimi veya bağlantıları bu kapıya tabidir.
- Kod, test, sözleşme, migration, config, callback/token/oturum, canlı çağrı, temizlik/kaldırma/geri alma/refactor, deploy ve merge de dahildir. Düzeltme veya geri alma amacı kendiliğinden izin oluşturmaz.
- Genel “devam edelim”, genel onay, önceki başka iş/merge onayı veya önceki plan kararı OAuth yetkisi değildir. Onay yalnız açıkça belirtilen somut iş ve kapsam için geçerlidir. Kapsam değişecekse durulur ve yeni açık izin alınır.
- Bu kapı, OAuth için önceki bağımsız kodlama veya izole test ilerleme izinlerinin önündedir; teknik olanak, başarılı test, geri alınabilirlik veya ajan takdiri yerine geçmez.
- #264 kullanıcı tarafından reddedilen katalog seçim adımı nedeniyle durdurulmuştur; merge yetkisi yoktur. Katalog seçimi kodu temizlenmedi veya değiştirilmedi. Temizlik de ayrı açık izin bekler.
- Bu kuralın AGENTS ve bağlayıcı belgelere kaydı kullanıcı tarafından açıkça istendi. Bu izin yalnız kural kaydına aittir; OAuth inceleme/kodlama/test/temizlik veya provider işlemi yetkisi vermez.

## Zorunlu başlangıç kapısı

1. Dış provider, platform, API, framework veya kütüphane işi başlamadan önce ilgili tarafın güncel resmî dokümantasyonu okunur; kaynak ve kontrol tarihi kullanıcıya bildirilir.
2. İş başında GitHub Connector erişimi, uzak `main`, görev branch'i ve yerel envanter ayrı ayrı doğrulanır.
3. GitHub Connector veya zorunlu yetki geçmiyorsa implementasyon başlamaz; web editörü, yerel Git onarımı, GCM/ACL değişikliği, process/servis/VM restart fallback'i kullanılmaz.
4. Kanıtlanmamış provider davranışı implementasyon gerçeği kabul edilmez.

## Provider ilk hata durma ve kullanıcıya dönüş kapısı

1. Token, credential, permission, deploy, app configuration veya başka bir dış-provider mutation'ı ilk açık ya da açıklamasız provider hatasında durdurulur.
2. Aynı işlem ikinci kez denenmez; farklı tarayıcı, CLI, authentication yöntemi, legacy panel veya alternatif teknik rota kullanıcıya açıklanmadan ve açık onayı alınmadan kullanılmaz.
3. Kullanıcının provider arayüzünde kısa sürede tamamlayabileceği işlem için otomasyon ısrarı yapılmaz. Kullanıcıya yalnız exact ekran, exact alan/aksiyon, exact hedef ve tamamlandığında vereceği kısa dönüş söylenir.
4. İlk hata sonrasında durum tek cümlede sınıflandırılır: ne oluşmadı, nerede değişiklik yapılmadı ve hangi tek manuel adım gerekiyor. Kanıt olmadan izin, rol, hesap veya platform arızası nedeni uydurulmaz.
5. Kullanıcı alternatif rota istemedikçe çalışma güvenli biçimde durur; arka planda yeni token, secret, oturum, deploy veya provider değişikliği üretilmez.

## Governing authority

- `docs/EXECUTION_PLAN.md` ve `contracts/a6-eo-implementation-master-v1.json` bağlayıcıdır.
- Legacy repository `fyilanli-oss/ads-table-dev` yalnız evidence/reference kaynağıdır.
- Legacy application/runtime, package manifest, lockfile, route, environment variable veya Git history toplu taşınamaz.
- Aktif provider hedefleri yalnız Meta, Google Ads ve Klaviyo'dur.
- Ürün yüzeyleri yalnız `/`, `/ad-analysis` ve `/settings`'dir.

## Shopify embedded UI zorunlu kapısı

Application route, App Home, Settings, Ad Analysis veya bunların testlerinden önce tamamı okunur:

1. `docs/SHOPIFY_EMBEDDED_UI_CONSTITUTION.md`
2. `contracts/shopify/shopify-embedded-ui-constitution-v1.json`
3. `docs/templates/SHOPIFY_EMBEDDED_UI_TASK_TEMPLATE.md`
4. Aktif EO paketi contract ve analist brief'i

Görsel ve etkileşimli UI yalnız güncel Shopify App Bridge ve stable Polaris web componentleriyle kurulur. Raw HTML action control, custom Shopify-look CSS, inline style, literal renk ve doğrulanmamış component/property yasaktır. Kullanıcı açıkça kabul etmeden görsel aşama PASS veya Done sayılamaz.

## Teslim ve local-only sıfır

- GitHub `main` başlangıç ve ürün otoritesidir.
- İş güncel `main`den açılan `codex/*` branch, PR ve zorunlu CI ile teslim edilir.
- Merge için açık kullanıcı onayı gerekir.
- Anlamlı kod, test, contract, karar, migration veya kanıt yalnız yerelde bırakılamaz.
- **Her iş paketinin sonunda zorunlu kapı:** staged/tracked/untracked, stash, worktree ve upstream'siz/ahead branch envanteri alınır; bu kapı geçmeden paket kapanmış sayılamaz.
- Secret, cache, dependency/build çıktısı GitHub'a yüklenmez.
- Uzak dosya exact content/blob/commit olarak tekrar doğrulanmadan “GitHub güncel” denmez.
- Yerel içerik uzak eşdeğeri doğrulanmadan silinmez; merge sonrası görev worktree'si geri alınabilir biçimde arşivlenir.

## Güvenlik sınırı

Production domain, Shopify app config, provider mutation, live token/data carry, database provisioning, cutover ve legacy deletion yalnız kendi ileriki kapılarında ve açık yetkiyle yapılır. Missing, unknown, unsupported, partial, stale ve gerçek zero ayrı durumlardır.

