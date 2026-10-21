# Windows geliştirme makinesi — erişim ve bellek kurtarma rehberi

**Son doğrulama: 21 Ekim 2026.** Bu belge, o gün gerçekten uygulanan işlemleri
ve gözlenen sonuçları kaydeder. AdsTable üretim uygulamasının kurtarma planı
değildir; EO-05 veya ilert kurulumu başlatmaz. Yeni bir arızanın aynı nedenden
kaynaklandığını varsayma. Komutları topluca yapıştırma; her adımın sonucunu gör.

## Acil durumda nereden başlayacağım?

1. RDP siyah ekranda veya `Please wait`te kaldıysa **1. bölüme** git.
2. Windows komut satırına ulaştıysan önce **2. bölümdeki kontrolleri** yap.
3. Yalnız disk gerçekten yetersizse **3. bölümü** değerlendir.
4. Yalnız sanal bellek ayarı sorunu doğrulandıysa **4. bölüme** git.
5. Yeniden başlatma gerekli ve ayrıca onaylıysa **5. bölümü** uygula.
6. Masaüstü döndüğünde **6. bölümle** sonucu doğrula.

Bu sayfayı telefonda veya VM dışındaki bir bilgisayarda açık tut; ihtiyaç
olmadan önce Google hesabına ve Windows parolana erişebildiğini doğrula.
Şifre, token, kurtarma kodu veya ham ekran görüntüsünü bu herkese açık
repository'ye ekleme. Kimlikler aşağıdaki olayın hedefini ayırt etmek içindir;
erişim yetkisi veya parola değildir.

## Hedef makine ve durma kuralları

21 Ekim 2026'da kullanılan hedef:

- Google Cloud projesi: `pacific-torus-508707-a2`
- VM ve bağlı boot disk: `codex-windows-backup-20260923-075405`
- Zone: `europe-west3-b`
- Windows bilgisayar adı: `codex-windows`
- Yerel Windows kullanıcısı: `dev`
- İşletim sistemi: Windows Server 2025 Datacenter

Adında `backup` geçmesine rağmen bu, o gün kullanılan çalışma makinesiydi.
Gelecekte taşınma olursa hedefi yeniden doğrula; bu kimlikleri körlemesine kullanma.

**Şunları yapma:** Google Cloud `Reset`, `Stop/Start`, parola sıfırlama,
IAM/organizasyon politikası değişikliği, servis kapatma veya klasör temizliğini
bu rehberin doğal devamı sayma. Bunların hiçbiri aşağıdaki komutlarla otomatik
yetkilendirilmez. Oturum numarasını tahmin ederek oturum kapatma.

**İlk açıklanmayan erişim/kimlik doğrulama/işlem hatasında dur.** Aynı komutu
tekrarlama, başka teknik yola geçme. Ekrandaki mesajı ve zamanı not et; gerekirse
güvenli kanaldan destek al. Devam etmek, hatanın hangi aşamada olduğunu
netleştirmeyi ve yeni açık onayı gerektirir. Bu belge gelecekte sınırsız deneme
veya otomatik yeniden başlatma izni değildir.

## 1. RDP açılmıyorsa: seri konsol üzerinden erişim

SAC, Windows'un masaüstünden ayrı yönetim konsoludur. RDP çalışmasa da
kullanılabilir; ancak Google erişimi, bağlantı ve çalışan Windows/SAC gerekir.
VM hiç açılmıyorsa veya Google bağlantısı kesikse garantili çözüm değildir.
21 Ekim'de erişim sağlandı, bir bağlantı da açıklanmayan hatayla kesildi.

### 1.1 Google Cloud ekranı

1. `Compute Engine → VM instances` üzerinden doğru projeyi ve VM'yi aç.
2. Seri port bağlantısı kapalıysa, **yalnız bu VM için ayrıca onayla**:
   `Edit → Remote access → Enable connecting to serial ports` kutusunu işaretle.
   Başka değişiklik yoksa `Save` ile kaydet. Bu bir ayar değişikliğidir.
3. `Connect to serial console → Port 2` seç.
4. Ekranı oku. **Yalnız boş konsolda** bir kez Enter ile istemi görünür kıl.
   Ekran zaten `Password:` diyorsa Enter boş parola denemesi olur; basma.

`Connection Failed` veya `Unable to authenticate` gelirse tekrar deneme.
Bu mesajlar tek başına yanlış parola, IAM arızası veya VM yeniden başlaması
kanıtı değildir. 21 Ekim'de ilk `Unable to authenticate` mesajından sonra
ekran aşaması netleştirildi; sonraki parola girişiyle mevcut komut satırına dönüldü.

### 1.2 Ekranda `SAC>` varsa

Şunu yaz:

```text
cmd
```

Beklenen: `The Command Prompt session was successfully launched` ve yeni
kanal adı. O gün kanal `Cmd0001` idi; farklı bir ad gelirse **gelen adı kullan**.
Yalnız kanal gerçekten `Cmd0001` ise:

```text
ch -sn Cmd0001
```

Kanal geçiş ekranı istediğinde bir tuşa/Space'e bas. Windows girişinde yerel
kullanıcı `dev`, domain alanı yerel hesap için boş bırakılarak kullanıldı.
Windows parolanı yalnız bu giriş ekranında yaz; karakterler görünmeyebilir.
Google parolası veya Google Cloud `Set Windows password` işlemiyle karıştırma.

Beklenen: `C:\Windows\System32>` komut satırı. Bağlantı doğrudan var olan
komut kanalına dönerse yeniden `cmd` çalıştırman gerekmez.

### 1.3 Doğru Windows ve yetki kontrolü — yalnız okuma

Her satırı ayrı çalıştır:

```text
hostname
whoami
whoami /groups | findstr S-1-5-32-544
query session
```

O gün `codex-windows`, `codex-windows\dev` ve etkin
`BUILTIN\Administrators` grubu görüldü. Grup satırında `Deny only` varsa
yönetici işlemi yapma. Hedef veya yetki beklenenden farklıysa dur.

O gün RDP kullanıcısının oturum numarası 2 idi. **Bu numara kalıcı değildir.**
`query session` yalnız inceleme içindir; listeden bir oturumu kapatma talimatı
değildir. Bugünkü iyileştirmede kullanıcı oturumu kapatma komutu kullanılmadı.

## 2. Bellek, disk ve yeniden başlama kontrolü — yalnız okuma

CMD ekranında önce PowerShell aç:

```text
powershell -NoProfile
```

`PS C:\...>` geldikten sonra her satırı ayrı çalıştır:

```powershell
Get-CimInstance Win32_OperatingSystem | Format-List LastBootUpTime,TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory
Get-CimInstance Win32_ComputerSystem | Format-List AutomaticManagedPagefile
Get-CimInstance Win32_PageFileSetting | Format-List Name,InitialSize,MaximumSize
Get-CimInstance Win32_PageFileUsage | Format-List Name,AllocatedBaseSize,CurrentUsage,PeakUsage
Get-Volume -DriveLetter C | Format-List DriveLetter,Size,SizeRemaining,HealthStatus
Get-Disk | Format-Table Number,FriendlyName,PartitionStyle,Size
Get-Partition -DiskNumber 0 | Format-Table PartitionNumber,DriveLetter,Type,Size
```

Son satırdaki disk 0, o gün doğrulanan disktir; farklı yerleşimde önce doğru
disk numarasını belirle. Bellek OS alanları KiB, pagefile alanları MiB,
disk/volume boyutları bayttır. Otomatik yönetimde `Win32_PageFileSetting`
satırının boş dönmesi tek başına hata değildir; gerçek çalışan boyutu
`Win32_PageFileUsage` ile ayrıca oku.

Windows Sistem günlüğünde bellek yetersizliği kaydı var mı?

```powershell
Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector';StartTime=(Get-Date).AddHours(-2)} -MaxEvents 5 | Format-List TimeCreated,Id,Message
```

`No events were found` / eşleşen kayıt yok mesajı, bu aralıkta ilgili olayın
bulunmadığını söyler; tüm sistem sağlıklı demek değildir. `Access denied`
ve diğer hatalar ise kayıt yok anlamına gelmez; yetkiyi zorlamadan dur.
Ham olay mesajları makine/kullanıcı bilgisi içerebilir; açık GitHub'a yapıştırma.

21 Ekim'de Sistem günlüğünde **2004 — low virtual memory** kayıtları bulundu.
RDP günlüğünde bağlantı zaman aşımı görüldü. Bellek sorunu somuttu; fakat siyah
ekranın ve seri konsol kopmasının kesin tek nedeni kanıtlanmadı.
`logging.logEntries.create` hatası ise Cloud Logging'e yazma yetkisiyle ilgilidir;
bu hata tek başına RDP kök nedeni veya IAM değiştirme gerekçesi değildir.

## 3. Yalnız ihtiyaç ve açık onay varsa: disk alanını büyütme

**Bu işlem her arızada tekrarlanmaz.** Disk zaten yeterliyse atla. Önce doğru
disk, hedef boyut, maliyet ve son kullanılabilir yedek durumunu kontrol et.
Google dosya sistemi/bölüm değişikliği öncesi snapshot önerir; bir zamanlamanın
bağlı olması son başarılı yedeği veya geri yüklenebilirliği kanıtlamaz.
Yedeği doğrulayamıyorsan risk açıkça değerlendirilmeden değişikliğe devam etme.

21 Ekim'de Balanced Persistent Disk **50 → 80 GB** büyütüldü. Google Cloud'da
doğru disk için `Edit → Size` değiştirildi, diğer alanlar korunarak `Save`
yapıldı. Disk doğrudan küçültülemez; bu nedenle yeni hedefi tahmin etme.
`Updating the architecture ... is not supported` uyarısı mimariyle ilgilidir;
mimariyi değiştirme talimatı değildir.

Google tarafında büyütme, C: bölümünü aynı anda büyütmeyebilir. O gün Windows
80 GB disk gördü; C: yaklaşık 50 GB kaldı. Yönetici CMD'sinde şu kontroller yapıldı.
PowerShell'deysen önce `exit` ile CMD'ye dön:

```text
diskpart
list disk
list volume
```

**Değişiklikten önce dur ve listeyi oku:** Doğru disk `Online` olmalı;
eklenen ayrılmamış alan `Free` sütununda görünmeli. C: bölümü NTFS ve `Healthy`
olmalı. Aynı temel diskte, bölümün hemen sonrasında uygun ayrılmamış alan
bulunmalı; yerleşim farklıysa destek almadan devam etme.

O gün tek disk `Disk 0`, 80 GB, ayrılmamış alan 30 GB; C: ise `Volume 0` idi.
**Yalnız güncel listede de C: gerçekten Volume 0 ise** şu tek satırı çalıştır:

```text
select volume 0
```

Beklenen: `Volume 0 is the selected volume.` Son karakter **0 rakamıdır**.
Gelecekte C: başka numaradaysa bu örneği kullanma; güncel numarayı doğrula.
Seçim doğrulanmadan sonraki komuta geçme.

Yalnız doğru C: seçimi ve alan yerleşimi doğrulandıysa:

```text
extend
```

Beklenen: `DiskPart successfully extended the volume.` Başarıdan sonra:

```text
exit
```

`There is no volume selected` gelirse değişiklik yapılmamıştır. `extend`
komutunu tekrarlama; seçim aşamasını yeniden doğrulayıp devam onayı al.
`clean`, `format`, `delete`, `shrink` veya `convert` kullanma.
Sonra 2. bölümdeki `Get-Volume` ile C: kapasitesini ve boş alanı doğrula.

## 4. Yalnız ayar sorunu doğrulandıysa: sanal belleği Windows yönetsin

O gün 8 GB RAM vardı; pagefile başlangıç ve üst sınırı **1024 MiB** idi,
`AutomaticManagedPagefile=False` görünüyordu. Tepe kullanımı 1023 MiB'ye
ulaşmıştı. Yalnız pagefile doluluk yüzdesi teşhis değildir; olay kayıtları ve
toplam bellek durumu birlikte değerlendirildi.

Yeterli disk alanı sağlandıktan sonra, açık onayla yönetici PowerShell'inde:

```powershell
Get-CimInstance Win32_ComputerSystem | Set-CimInstance -Property @{AutomaticManagedPagefile=$true} -ErrorAction Stop
```

Bu satır ayarı değiştirir; yeniden başlatma komutu içermez. Hata gelirse dur.
Mesaj çıkmadan isteme dönmesi mümkündür. Ayarı ve çalışan boyutu ayrı doğrula:

```powershell
Get-CimInstance Win32_ComputerSystem | Format-List AutomaticManagedPagefile
Get-CimInstance Win32_PageFileUsage | Format-List Name,AllocatedBaseSize,CurrentUsage,PeakUsage
```

Beklenen ayar `True`. Çalışan dosya hâlâ eski boyuttaysa ayar başarısız olmuş
demek değildir; yeni ayar yeniden başlatma sonrasında uygulanabilir.
Zaten `True` ise bu komutu her arızada yeniden çalıştırma.

## 5. Yalnız ayrıca onaylıysa: normal Windows yeniden başlatması

Önce açık belgeleri ve işleri kaydet. Repo dışında kaydedilmemiş dosyalar ve
çalışan işler de olabilir; yalnız `git status` bunların kaydedildiğini kanıtlamaz.
Repository'de staged/tracked/untracked, stash, worktree ve gönderilmemiş branch
envanteri alınmalı; anlamlı yerel iş kalıcılaştırılmadan yeniden başlatma yapma.
Ekleri, sohbet geçmişini, secret'ları veya önbellekleri topluca GitHub'a yükleme.

Yeniden başlatma Windows uygulamalarını ve bu makinede çalışan Codex'i kapatır.
Telefon bağlantısı kesilebilir; Codex'in kendiliğinden devam edeceğini varsayma.
VM dışından bu belgeye, Google hesabına ve RDP bilgilerine erişimin olmalı.

**Ayrı yeniden başlatma onayı alındıktan sonra**, SAC yönetici CMD veya
PowerShell ekranında kullanılan komut:

```text
shutdown.exe /r /t 0 /d p:2:4
```

Enter sonrası normal Windows yeniden başlatması hemen başlar. `/r` yeniden
başlatır; `/t 0` gecikmesizdir; `/d p:2:4` planlı işletim sistemi yeniden
yapılandırması nedenini kaydeder. `/f` içermez; uygulamaları zorla kapatma
izni değildir. Windows engel/hata verirse zorlamadan dur. Pozitif süre ekleme:
Microsoft'a göre `/t` sıfırdan büyükse zorla kapatma davranışı da devreye girer.

## 6. Yeniden açıldıktan sonra

1. Windows'un açılması için birkaç dakika bekle; aynı VM'ye RDP ile bağlan.
2. Masaüstü geldiyse Codex uygulamasını aç; mevcut konuşmayı bul ve dönüşü bildir.
   Başka VM veya yalnız aynı hesapla giriş, aynı yerel çalışma durumunun
   otomatik taşındığını garanti etmez.
3. 2. bölümdeki okuma komutlarıyla açılış zamanı, disk, otomatik yönetim ve
   çalışan pagefile boyutunu kontrol et. Yeni bellek olayı var mı bak.
4. RDP tekrar `Please wait`te kalırsa yeniden başlatmayı döngüye sokma.
   İlk hatada durma kuralıyla 1. bölümdeki SAC erişimini değerlendir.
   SAC de hata veriyorsa Reset/Stop/Start veya IAM değişikliğine sıçrama;
   zamanı ve hatayı not ederek destek al.

## 7. 21 Ekim 2026 olayının doğrulanmış sonucu ve sınırları

- Disk/C: yaklaşık 50 GB'dan **80 GB'a** çıktı; ilk kontrolde boş alan
  **33,33 GiB**, yeniden açılış kontrolünde **35,15 GiB** idi.
- `AutomaticManagedPagefile=True` kaydedildi.
- Normal yeniden başlatmadan sonra `LastBootUpTime=2026-10-21 10:42:33 UTC`.
- Çalışan pagefile **1024 → 1920 MiB** oldu; otomatik yönetimde bu boyut daha
  sonra değişebilir. 1920, herkes için hedef veya sabit yeni sınır değildir.
- Fırat masaüstüne geri eriştiğini bildirdi. İlk açılış sonrası kontrolde
  yeni Resource-Exhaustion kaydı bulunmadı; uzun süreli dayanıklılık testi yapılmadı.
- Cloud `Reset` veya `Stop/Start`, kullanıcı oturumu kapatma, IAM/politika
  değişikliği, klasör temizliği ve şifre sıfırlama yapılmadı.
- `default-schedule-1` snapshot zamanlaması bağlı görüldü; panelde
  `Failed to load backup plan` uyarısı vardı. Son başarılı snapshot/restore
  doğrulanmadı; bu uyarı yedeklerin kesin başarısızlığı olarak yorumlanmadı.
- Yaklaşık 5,72 GiB oturum kaydı ve 0,71 GiB yerel sohbet veritabanı görüldü;
  bunlar günlük yedek veya güvenle silinebilir önbellek diye sınıflandırılmadı.
- İşlemler geliştirme makinesine aitti. AdsTable sağlayıcıları, canlı veritabanı,
  deployment, zamanlayıcı veya alarm sistemi bu olayda etkinleştirilmedi.

## Resmî kaynaklar

Kontrol tarihi: **21 Ekim 2026**. Gelecekte farklı Windows/Google arayüzünde
işlem yapmadan önce ilgili kaynağı yeniden kontrol et.

- [Google Cloud — Windows SAC bağlantısı](https://docs.cloud.google.com/compute/docs/instances/connecting-to-sac)
- [Google Cloud — seri konsol ve erişim sınırları](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshooting-using-serial-console)
- [Google Cloud — Persistent Disk büyütme](https://docs.cloud.google.com/compute/docs/disks/resize-persistent-disk)
- [Microsoft — DiskPart list](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/list)
- [Microsoft — DiskPart extend](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/extend)
- [Microsoft — sanal bellek boyutlandırma](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows)
- [Microsoft — AutomaticManagedPagefile](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystem)
- [Microsoft — ayar ile çalışan pagefile ayrımı](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-pagefilesetting)
- [Microsoft — normal yeniden başlatma komutu](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/shutdown)
- [OpenAI Docs — Remote bağlantısının çalışan host bağımlılığı](https://learn.chatgpt.com/docs/remote-connections)
