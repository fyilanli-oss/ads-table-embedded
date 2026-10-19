# EO-01-A — Temiz repository ve fiziksel ayrım sınırı

## Analist açıklaması

Bu paket ürün kodu yazmaz. Yeni AdsTable embedded uygulamasının eski repository'deki uygulama kodundan fiziksel olarak ayrıldığını ve yalnız onaylı karar/sözleşme kanıtlarının kontrollü taşındığını doğrular.

Bu belge EO-01-A'nın tarihsel başlangıç ve kabul kapsamını anlatır. Aşağıdaki “yoktur” ifadeleri bugünkü repository envanteri değildir; sonraki paketler ve güncel durum için Execution Plan geçerlidir.

## Kapsama dahil olanlar

- Ayrı GitHub repository: `fyilanli-oss/ads-table-embedded`
- Uzak `main` başlangıç commit'i ve `codex/eo01a-repository-boundary` teslim dalı
- Execution Plan, EO ana sözleşmesi ve Shopify UI anayasası
- Kaynak repository, commit ve blob üzerinden belgenin nereden geldiğini gösteren izlenebilirlik kaydı
- Eski çalışma zamanı kodundan aynen taşınan modül sayısının sıfır olduğunu doğrulayan test

## Kapsam dışı

Uygulama iskeleti, bağımlılık bildirimi (package manifest), lockfile, çalışma zamanı adresleri, sağlayıcı adaptörleri, veritabanı, Vercel/Supabase projesi, token/veri taşıma, canlı ortam değişikliği ve eski yapının silinmesi.

## Kabul

1. Uzak repository ve görev dalı GitHub Connector üzerinden okunup yazılabilir.
2. Taşınan her belgenin kaynağı tam commit ve blob SHA ile izlenebilir.
3. Bu aşamada `src`, `app`, `public`, eski sunucu, package/lockfile ve ortam değişkeni dosyaları yoktur.
4. Kabul testi geçer.
5. PR ve CI sonucu kullanıcıya sunulur; açık merge onayı olmadan birleştirme yapılmaz.

