# Shopify Embedded UI task şablonu

Bu şablon doldurulmadan Shopify embedded UI kodu yazılmaz.

## Analist brief'i

- Paket / Execution Plan maddesi:
- Kullanıcı amacı:
- Başlangıç durumu:
- Başarılı sonuç:
- Değişmeyecek backend/OAuth/data davranışı:
- Kapsam dışı:

## Durum matrisi

| Durum | Kullanıcının gördüğü metin | Eylem | Beklenen sonuç |
|---|---|---|---|
| Loading |  |  |  |
| Empty / Not connected |  |  |  |
| Resume required |  |  |  |
| Connected |  |  |  |
| Error / Reauthorization |  |  |  |
| Cancel |  |  |  |

## Shopify component mapping

| Görünür öğe | Exact Shopify component | Property / variant / tone | Resmî kaynak | Kontrol tarihi |
|---|---|---|---|---|
| Sayfa / section |  |  |  |  |
| Durum |  |  |  |  |
| Primary action |  |  |  |  |
| Secondary action |  |  |  |  |
| Destructive action |  |  |  |  |
| Modal / form |  |  |  |  |
| Navigation / icon |  |  |  |  |

`s-clickable` seçildiyse Button veya Link'in neden yetersiz olduğu ayrıca kanıtlanır. Görsel taklit gerekçesi kabul edilmez.

## Kabul planı

- [ ] Constitution guard PASS
- [ ] İlgili UI contract testleri PASS
- [ ] Desktop gerçek Shopify Admin PASS
- [ ] Mobil gerçek Shopify Admin (en az 320 px) PASS
- [ ] Loading / empty / error / cancel / success PASS
- [ ] OAuth varsa return / resume / account selection PASS
- [ ] Ürün sahibi açık kabul verdi
- [ ] Kanıtlar Execution Plan'a işlendi

Bu kutuların tamamı kanıtlanmadan task `Done`, `PASS` veya `Accepted` olamaz.


