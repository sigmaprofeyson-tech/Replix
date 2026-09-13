# REPLIX — cok oyunculu dublaj platformu (tamamen ucretsiz)

Arkadaslarla sahne secin, karakterleri rastgele paylasin, replikleri mikrofonla kaydedin,
FFmpeg final videosunu birlikte izleyin. Premium/odeme YOK — her sey ucretsiz.

## Yerelde calistirma
1. Node.js 18+ kurulu olsun.
2. Klasorde: `npm install`
3. `npm start`  -> http://localhost:3000

## Render.com'a deploy (ucretsiz)
1. Bu klasoru GitHub'a yukle (ornek: repo adi `replix`).
2. render.com -> New -> Web Service -> GitHub repo'yu sec.
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
   - (repoda `render.yaml` varsa bu alanlar otomatik dolar)
3. Environment Variables (opsiyonel):
   - `ADMIN_TOKEN` = istedigin gizli anahtar (varsayilan: replix-admin-123)
   - `AUTO_APPROVE` = `1` -> sahneler admin onaysiz direkt yayinlanir (kisisel kullanim icin onerilir)
4. Deploy et. Site canli: `https://replix-xxxx.onrender.com`
5. Ilk sahneyi yuklemek icin: site -> "Sahne gonder" -> video mp4 sec, karakter ve
   replik zaman kodlarini gir -> gonder. AUTO_APPROVE=1 ise aninda katalogda.

## Kullanim
1. Ana sayfada ismini gir (hesap yok, ucretsiz).
2. "Sahne gonder" ile gercek video klibini yukle (kendi cektigin/telifsiz icerik).
3. "Sahneler" -> karta tikla -> oda kodu uretilir.
4. Arkadasin "Oda koduyla katil" bolumune kodu yazar (ornek: RX82KD).
5. Herkes mikrofon testi yapar -> "Hazirim" -> host "Dagitimi baslat".
6. Karakterler sunucuda rastgele dagitilir; kendi repli(leri)nin kaydini yap,
   dinle, yeniden kaydet veya kabul et.
7. Tum replikler yuklenince FFmpeg otomatik karistirir: "SAHNE TAMAMLANDI."
   Finali izle, indir, toplulukla paylas.

## Mimari
- server.js        : Express + Socket.io (gercek zamanli oda) + SQLite (better-sqlite3)
- FFmpeg (ffmpeg-static) : replik seslerini sahne zamanlamasina gore karistirip mp4 mux'lar
- public/          : arayuz (SPA)
- uploads/         : videolar, kayitlar, final dublajlar
- data/replix.db   : sahneler, dublajlar, begeniler, oturumlar

## Render free notlari
- Free tier disk'i gecicidir: redeploy'da yuklenen videolar silinebilir.
  Kalici icin Render'da Persistent Disk ekle (mount path: /opt/render/project/src)
  ve UP/DATA yollarini buna gore ayarla, veya diskin altinda tut.
- FFmpeg mux islemi hafiftir (-c:v copy), 512MB RAM yeterlidir.
- Ilk istek 50 sn'de uyanabilir (free cold start) — normaldir.

## Ucretsiz model
- routes/pricing, premium kilit, kalite kisitlamasi YOKTUR.
- Tum sahneler, tim karakter sayilari, sinirsiz yeniden kayit ve indirme herkese aciktir.
