# A6-OPS-LOCAL-01 — Tek seferlik güvenli yerel temizlik

**Durum:** Hazır; uygulama başlamadı
**Açılış:** 7 Ekim 2026
**Tür:** Bağımsız, tek seferlik operasyon paketi
**EO etkisi:** A6-EO paketi eklemez, bölmez, kapatmaz, sıralamaz veya engellemez
**Silme yetkisi:** Paket açılışında yok

> Bu, planın tarihsel kapsam kaydıdır. Güncel durum için `docs/EXECUTION_PLAN.md` okunur. Türkçeleştirme, temizlik veya arşivleme başlatma onayı değildir.

## Amaç

Paket sonu zorunlu kontrol kapısı bağlayıcı olmadan önce oluşmuş, anlamlı işin yalnız yerelde kalması riskini kapatmak. Önce repository ile ilişkili yerel durum listelenir; içeriğin GitHub'da kalıcı olduğu veya bilinçli olarak başka şekilde korunduğu kanıtlanır. Ardından yalnız geri alınabilir ve açıkça onaylanmış temizlik yapılır.

Bu tek seferlik düzeltme paketidir. Tekrarını, `contracts/repository-delivery-workflow-v1.json` içindeki zaten bağlayıcı paket sonu kapısı önler.

## Kapsam

- Salt okunur eski repository ana kopyası: `C:\Users\dev\Documents\Codex\ads-table-dev`.
- AdsTable repository'leriyle ilişkili, Codex tarafından yönetilen veya Git'e kayıtlı bağlı worktree'ler.
- Stage'e alınmış, takip edilen ama değişmiş, takip edilmeyen ve Git'in yok saydığı proje dosyaları.
- Stash'ler; ayrık HEAD, upstream'i olmayan veya upstream'den ileride yerel dal uçları; geçersiz kalmış worktree üst verisi.
- Yeniden üretilebilir önbellek, bağımlılık ve derleme çıktıları.
- Değerlerini göstermeden secret'lar ve yalnız makinede tutulan yedekler gibi bilinçli yerel istisnalar.

Rastgele kullanıcı klasörleri, ilgisiz repository'ler, sağlayıcı sistemleri, veritabanları, Vercel, Supabase veya GitHub uzak geçmişi temizlenmez.

## İş adımları

### A6-OPS-LOCAL-01-A — Salt okunur envanter ve sabitleme

Repository kökleri, `HEAD`, dal/upstream durumu, `git-common-dir`, takip edilmeyen/yok sayılan dosyaların sınıflandırıldığı durum, stash'ler, yerel dalların erişilebilirliği ve tüm bağlı worktree'ler kaydedilir. Değişiklik yapılmaz.

### A6-OPS-LOCAL-01-B — Sınıflandırma ve uzak eşdeğer kanıtı

Her bulgu; anlamlı proje işi, secret, bilinçli yedek, yeniden üretilebilir önbellek/bağımlılık/derleme çıktısı, aktif worktree, arşivlenmiş/geri getirilebilir worktree veya geçersiz üst veri olarak sınıflandırılır. Anlamlı proje işinin temizlikten önce GitHub'da birebir dal/PR/commit/içerik eşdeğeri olmalıdır.

### A6-OPS-LOCAL-01-C — Geri alınabilir temizlik

Güncel envanter ve ayrıca açık kullanıcı onayı alındıktan sonra, uygun Codex worktree'leri Codex'in geri getirilebilir arşiv mekanizmasıyla arşivlenir. Yalnız kesin kökleri doğrulanmış, atılabilir olduğu kanıtlanmış dosyalar kaldırılır. Geçersiz worktree üst verisi ancak önce değişiklik yapmayan deneme kanıtıyla budanabilir. Zorla kaldırma, geniş kapsamlı özyinelemeli hedef, yerel Git onarımı, ACL/GCM değişikliği, süreç sonlandırma veya sunucu/VM yeniden başlatma yetkisi yoktur.

### A6-OPS-LOCAL-01-D — Kapanış kanıtı

Tam envanter tekrarlanır ve şunlar kanıtlanır: Yalnız yerelde kalan anlamlı proje işi sıfırdır; aktif worktree zarar görmemiştir; ana kopya/ortak Git üst verisi sağlamdır; uzak eşdeğerler okunabilir; secret'lar yüklenmemiştir; bilinçli her yerel istisna kaydedilmiştir.

## Değişmez güvenlik kuralları

- Önce envanter, sonra sınıflandırma, en son değişiklik.
- Uzak eşdeğer veya bilinçli koruma kararı kanıtlanmadan yerel dosya, stash, dal veya worktree kaldırılmaz.
- Bağlı worktree varken eski ana kopya ve ortak `.git` asla silinmez.
- Değişiklik içeren veya kilitli worktree zorla kaldırılmaz.
- Secret değerleri ne ekrana yazılır ne commit edilir.
- Önbellek, bağımlılık ve derleme çıktısı kaynak teslimi sayılmaz.
- Sahibi bilinmeyen veya içeriği belirsiz öğede işlem güvenli biçimde durur.
- Paket açılışı temizlik uygulamasına yetki vermez.

## Kabul

Paket ancak dört adımın tamamı geçtiğinde, GitHub kanıtları eklendiğinde, yalnız yerelde kalan anlamlı işin sıfır olduğu kanıtlandığında, repository teslim kuralları hâlâ geçtiğinde ve kullanıcı temizlik sonucunu açıkça kabul ettiğinde kapanır.

## 7 Ekim 2026'da kontrol edilen resmî kaynaklar

- OpenAI Codex iş akışı rehberi: https://developers.openai.com/blog/mastering-codex-remote-for-engineering
- Git worktree dokümantasyonu: https://git-scm.com/docs/git-worktree
- Git status dokümantasyonu: https://git-scm.com/docs/git-status
