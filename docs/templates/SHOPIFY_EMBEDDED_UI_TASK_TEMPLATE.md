## OAuth — işlem öncesi zorunlu açık kullanıcı onayı (29 Ekim 2026)

**OAuth’a doğrudan veya dolaylı değen hiçbir çalışma, yapılacak somut işlem ve kapsam açıklanıp kullanıcıdan önceden açık izin alınmadan başlatılamaz.** Tüm sağlayıcılar ve Shopify dahildir.

- İnceleme/araştırma, akış ve ekran tasarımı, izin/kapsam, hesap/Reporting Account/Merchant/işletme/katalog seçimi veya bağlantıları bu kapıya tabidir.
- Kod, test, sözleşme, migration, config, callback/token/oturum, canlı çağrı, temizlik/kaldırma/geri alma/refactor, deploy ve merge de dahildir. Düzeltme veya geri alma amacı kendiliğinden izin oluşturmaz.
- Genel “devam edelim”, genel onay, önceki başka iş/merge onayı veya önceki plan kararı OAuth yetkisi değildir. Onay yalnız açıkça belirtilen somut iş ve kapsam için geçerlidir. Kapsam değişecekse durulur ve yeni açık izin alınır.
- Bu kapı, OAuth için önceki bağımsız kodlama veya izole test ilerleme izinlerinin önündedir; teknik olanak, başarılı test, geri alınabilirlik veya ajan takdiri yerine geçmez.
- #264 kullanıcı tarafından reddedilen katalog seçim adımı nedeniyle durdurulmuştur; merge yetkisi yoktur. Katalog seçimi kodu temizlenmedi veya değiştirilmedi. Temizlik de ayrı açık izin bekler.
- Bu kuralın AGENTS ve bağlayıcı belgelere kaydı kullanıcı tarafından açıkça istendi. Bu izin yalnız kural kaydına aittir; OAuth inceleme/kodlama/test/temizlik veya provider işlemi yetkisi vermez.

# Shopify gömülü arayüz görev şablonu

Bu şablon doldurulmadan Shopify gömülü arayüz kodu yazılmaz. Bağlayıcı kurallar
`docs/SHOPIFY_EMBEDDED_UI_CONSTITUTION.md` ve
`contracts/shopify/shopify-embedded-ui-constitution-v1.json` içindedir.
Güncel paket sırası için `docs/EXECUTION_PLAN.md` kullanılır.
Bu dil düzenlemesi yeni arayüz işi başlatmaz veya kabul üretmez.

## Analist özeti

- Paket / Execution Plan maddesi:
- Kullanıcı amacı:
- Başlangıç durumu:
- Başarılı sonuç:
- Değişmeyecek sunucu/OAuth/veri davranışı:
- Kapsam dışı:

## Durum matrisi

Parantez içindeki İngilizce adlar teknik durum eşlemesidir; şablonun Türkçeleştirilmesi
ürünün kabul edilmiş ekran metinlerini değiştirmez.

| Durum | Kullanıcının gördüğü birebir metin | Eylem | Beklenen sonuç |
|---|---|---|---|
| Yükleniyor (`Loading`) |  |  |  |
| Boş / Bağlı değil (`Empty / Not connected`) |  |  |  |
| Kurulum sürdürülmeli (`Resume required`) |  |  |  |
| Bağlı (`Connected`) |  |  |  |
| Hata / Yeniden yetkilendirme (`Error / Reauthorization`) |  |  |  |
| İptal (`Cancel`) |  |  |  |

## Shopify bileşen eşlemesi

Kodda kullanılacak bileşen adı ve property / variant / tone değerleri resmî kaynaktan
birebir alınır; teknik kimlikleri çevrilmez.

| Görünür öğe | Birebir Shopify bileşeni | Property / variant / tone | Resmî kaynak | Kontrol tarihi |
|---|---|---|---|---|
| Sayfa / bölüm |  |  |  |  |
| Durum |  |  |  |  |
| Birincil eylem |  |  |  |  |
| İkincil eylem |  |  |  |  |
| Yıkıcı eylem |  |  |  |  |
| Modal / form |  |  |  |  |
| Gezinme / simge |  |  |  |  |

`s-clickable` seçildiyse Button veya Link'in neden yetersiz olduğu ayrıca kanıtlanır.
Görsel taklit gerekçesi kabul edilmez.

## Kabul planı

- [ ] Anayasa koruma testi PASS
- [ ] İlgili arayüz sözleşme testleri PASS
- [ ] Masaüstü gerçek Shopify Admin PASS
- [ ] Mobil gerçek Shopify Admin (en az 320 px) PASS
- [ ] Yükleniyor / boş / hata / iptal / başarı PASS
- [ ] OAuth varsa dönüş / sürdürme / hesap seçimi PASS
- [ ] Ürün sahibi açık kabul verdi
- [ ] Kanıtlar Execution Plan'a işlendi

Bu kutuların tamamı kanıtlanmadan görev `Done`, `PASS` veya `Accepted` olamaz.


