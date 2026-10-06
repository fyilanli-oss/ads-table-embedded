# EO-01-A — Clean repository and physical boundary

## Analist açıklaması

Bu paket ürün kodu yazmaz. Amacı, yeni AdsTable embedded uygulamasının eski repository'deki bataklık koddan fiziksel olarak ayrıldığını ve yalnız onaylı karar/contract kanıtlarının kontrollü biçimde taşındığını ispatlamaktır.

## Dahil

- Ayrı GitHub repository: `fyilanli-oss/ads-table-embedded`
- Uzak `main` başlangıç commit'i ve `codex/eo01a-repository-boundary` teslim branch'i
- Execution Plan, EO master contract ve Shopify UI anayasası
- Kaynak repository/commit/blob provenance kaydı
- Legacy runtime carry-as-is sayısının sıfır olduğunu doğrulayan test

## Dahil değil

Application scaffold, package manifest, lockfile, runtime route, provider adapter, database, Vercel project, Supabase project, token/data carry, production mutation ve legacy deletion.

## Kabul

1. Uzak repository ve branch Connector üzerinden okunup yazılabilir.
2. Her taşınan belge exact source commit ve blob SHA ile izlenebilir.
3. `src`, `app`, `public`, legacy server, package/lockfile ve environment dosyaları yoktur.
4. Kabul testi PASS olur.
5. PR/CI sonucu kullanıcıya sunulur; açık merge onayı olmadan merge edilmez.

