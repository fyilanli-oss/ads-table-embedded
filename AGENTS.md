# AdsTable Embedded repository çalışma kuralları

Bu repository temiz Shopify embedded-only AdsTable runtime'ıdır. **Execution Plan anayasadır.**

## Zorunlu başlangıç kapısı

1. Dış provider, platform, API, framework veya kütüphane işi başlamadan önce ilgili tarafın güncel resmî dokümantasyonu okunur; kaynak ve kontrol tarihi kullanıcıya bildirilir.
2. İş başında GitHub Connector erişimi, uzak `main`, görev branch'i ve yerel envanter ayrı ayrı doğrulanır.
3. GitHub Connector veya zorunlu yetki geçmiyorsa implementasyon başlamaz; web editörü, yerel Git onarımı, GCM/ACL değişikliği, process/servis/VM restart fallback'i kullanılmaz.
4. Kanıtlanmamış provider davranışı implementasyon gerçeği kabul edilmez.

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
- İş sonunda staged/tracked/untracked, stash, worktree ve upstream'siz/ahead branch envanteri alınır.
- Secret, cache, dependency/build çıktısı GitHub'a yüklenmez.
- Uzak dosya exact content/blob/commit olarak tekrar doğrulanmadan “GitHub güncel” denmez.
- Yerel içerik uzak eşdeğeri doğrulanmadan silinmez; merge sonrası görev worktree'si geri alınabilir biçimde arşivlenir.

## Güvenlik sınırı

Production domain, Shopify app config, provider mutation, live token/data carry, database provisioning, cutover ve legacy deletion yalnız kendi ileriki kapılarında ve açık yetkiyle yapılır. Missing, unknown, unsupported, partial, stale ve gerçek zero ayrı durumlardır.

