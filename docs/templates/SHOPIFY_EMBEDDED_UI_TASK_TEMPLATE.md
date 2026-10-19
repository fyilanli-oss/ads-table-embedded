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


