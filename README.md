# DubbyDub — çok oyunculu dublaj platformu (tamamen ücretsiz)

Arkadaşlarla sahne seçin, karakterleri rastgele paylaşın, replikleri mikrofonla kaydedin,
FFmpeg final videosunu birlikte izleyin. Premium/ödeme YOK — her şey ücretsiz.

## Yerelde çalıştırma
1. Node.js 18+ kurulu olsun.
2. Klasörde: `npm install`
3. `npm start`  -> http://localhost:3000

## Render.com'a deploy (ücretsiz)
1. Bu klasörü GitHub'a yükle (örnek: repo adı `dubbydub`).
2. render.com -> New -> Web Service -> GitHub repo'yu seç.
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
   - (repoda `render.yaml` varsa bu alanlar otomatik dolar)
3. Environment Variables:
   - `ADMIN_TOKEN` = istediğin gizli anahtar (varsayılan: dubbydub-admin-123)
   - `AUTO_APPROVE` = `1` yaparsan kullanıcı gönderdiği sahneler admin onayı olmadan
     direkt yayınlanır. Varsayılan `0` — yani her kullanıcı klibi önce admin onayından geçer.
4. Deploy et. Site canlı: `https://dubbydub-xxxx.onrender.com`

## Kullanım
1. Ana sayfada ismini gir (hesap yok, ücretsiz). İsim artık hem cookie'de hem de
   tarayıcı localStorage'ında saklanıyor, bu yüzden sayfayı yenileyince/sekmeyi
   kapatıp açınca ismin kaybolmuyor.
2. **"Sahne Gönder"** ile kendi video klibini yükle:
   - Video dosyasını sürükle-bırak ya da seç (otomatik önizleme + otomatik kapak resmi).
   - Sahne adı, kategori, dil bilgisini gir.
   - Karakterleri ekle (isim listesi).
   - Replikleri ekle: hangi karakter, ne diyor, kaçıncı saniyede başlayıp bitiyor —
     videoyu oynatıp "▶ şu an" butonlarıyla saniyeyi videodan direkt yakalayabilirsin.
   - Gönder — sahne "onay bekliyor" durumuna düşer (AUTO_APPROVE=1 ise direkt yayınlanır).
3. Admin panelinden (`/#/admin`) gönderilen sahneleri incele: videoyu izle, karakter/replik
   tablosunu düzenle (isim, kategori, zorluk, karakterler, replik metni ve zaman kodları),
   sonra **Onayla** — sahne "Sahneler" kataloğuna düşer. İstersen direkt **Sil**.
4. "Sahneler" -> karta tıkla -> oda kodu üretilir.
5. Arkadaşın "Oda koduyla katıl" bölümüne kodu yazar (örnek: DD82KD).
6. Herkes mikrofon testi yapar -> "Hazırım" -> host "Dağıtımı başlat".
7. Karakterler sunucuda rastgele dağıtılır; kendi repli(leri)nin kaydını yap,
   dinle, yeniden kaydet veya kabul et.
8. Tüm replikler yüklenince FFmpeg otomatik karıştırır: "SAHNE TAMAMLANDI."
   Finali izle, indir, toplulukla paylaş.

## Mimari
- server.js        : Express + Socket.io (gerçek zamanlı oda) + SQLite (better-sqlite3)
- FFmpeg (ffmpeg-static) : replik seslerini sahne zamanlamasına göre karıştırıp mp4 mux'lar,
  yüklenen kullanıcı videolarından otomatik kapak resmi (thumbnail) ve sessiz kopya üretir
- public/          : arayüz (SPA)
- uploads/         : videolar, kayıtlar, final dublajlar, kullanıcı gönderimleri
- data/dubbydub.db : sahneler, dublajlar, beğeniler, oturumlar (isim/nickname kayıtları burada)
- scenes/          : hazır katalog videoları — bu klasörü sen (repo sahibi) ekliyorsun,
  proje her başladığında scenes_data.json'a bakıp buradaki videoları otomatik yükler.
  Büyük olduğu için repoya eklemek istemiyorsan, scenes_data.json'daki her sahneye bir
  `"url"` alanı ekleyip videoyu oradan indirtebilirsin (kod zaten bunu destekliyor).

## Render free notları
- Free tier disk'i geçicidir: redeploy'da yüklenen videolar (ve kullanıcı gönderimleri)
  silinebilir. Kalıcı için Render'da Persistent Disk ekle.
- FFmpeg mux işlemi hafiftir (-c:v copy), 512MB RAM yeterlidir.
- İlk istek 50 sn'de uyanabilir (free cold start) — normaldir.

## Ücretsiz model
- routes/pricing, premium kilit, kalite kısıtlaması YOKTUR.
- Tüm sahneler, tüm karakter sayıları, sınırsız yeniden kayıt ve indirme herkese açıktır.
