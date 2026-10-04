# Şehir Güvercinleri — fikir notu (04.10.2026)

Drone simülatörü motorunun üstünde ikinci bir ürün: oyuncu bir kuş olur, gerçek şehirde (önce Lünen) özgürce uçar,
çatılara konar, sürüyle gezer, kafelere dalar. Kodlanmadı; karar: önce Lünen 3B canlıya, sonra kuş.

## Neden aynı motor
- Dünya: NRW 3B mesh (Lünen → Dortmund …), uydu/OSM dünya, isteğe bağlı Google. Aynı yükleyici, aynı sahne.
- Online: odalar, hayaletler, radar, lobi → sürü. Lazer arena altyapısı → yem kapma / kovalamaca.
- Kumanda: oyun kolu, dokunmatik, klavye hazır. Kuş için en doğal giriş telefon jiroskobu (telefonu eğerek süzülme).

## Kuş uçuşu (yeni fizik, flight.js'den ayrı; plane.js'in akrabası)
- Planör mantığı: hız ↔ irtifa, kanat çırpmak enerji harcar, dalış hız verir, termaller yükseltir, rüzgâr sürükler.
- Kanat kapatıp konma: çatı, çan kulesi, köprü, ağaç. Konunca yürüme/gagalama.
- Kamera: kanatlar görünen yakın takip + kuş gözü FPV.
- Model: güvercin (ilk), karga, martı; GLB + iskelet animasyonu (kanat çırpma, konma, yürüme).

## Oyun hissi
- Hedefsiz keşif + "senin şehrin" duygusu: gerçek Rathaus'a konmak, gerçek çatılar.
- Mobil öncelikli, 2 dakikalık oturumlar.
- İsteğe bağlı küçük oyunlar: yem, yarış, göç, sürü hâlinde uçuş.
- İkinci faz gerçeklik: gerçek hava durumu, gün ışığı saati, mevsim (açık API).

## Kafe baskını (en eğlenceli parça)
- Mesh iç mekân vermez → kafe içleri elle kurulan tek kalıp (kapı, tezgâh, 5–6 masa, vitrin), dükkana göre renk/isim.
- Konumlar OSM'den (kapı koordinatı, açılış saatleri). Kapı mesh'teki gerçek girişe oturur; içeri girince mesh gizlenir, iç mekân açılır.
- Gerçek açılış saati: kapalıysa giremezsin, "Geschlossen".
- İçeride kırıntı/simit → puan + enerji. Çalışan NPC süpürgeyle kovalar, müşteriler kaçışır. Yakalanırsan 30 sn dışarıda.
- Çok oyunculu: biri dikkat dağıtır, diğeri yemi kapar. Haftalık "en çok kafe basan güvercin" tablosu.
- Zorluk mekâna göre: küçük kafe (hızlı çalışan) ↔ self servis zincir (çok masa).
- Lünen başlangıcı: 5–10 mekân (Marktplatz çevresi, BackWerk, Kanne …).

## Marka / hukuk
- Gerçek isim ve logo izinsiz kullanılmaz. İki yol:
  1. Hafif değiştirilmiş adlar ("Backwelt", "Kanna Café"), konum gerçek.
  2. Tercih edilen: işletmelere prototiple gitmek. Yerel kafe için bedava reklam; kendi menüsüyle oyuna girer,
     oyun içi başarıya gerçek kupon (10 kırıntı → kahve indirimi). Stadt Lünen için de "yerel şehir oyunu" hikâyesi.

## Riskler
- Mesh alçakta zayıf (cepheler perde gibi); kuş çatıda yaşar → çatı/ağaç kalitesi kritik. Ağaçlar yapraksız (Mart uçuşu) →
  prosedürel ağaç gerekir.
- Yüzlerce kuş aynı odada → ilgi alanı filtreleme (yalnız yakındakiler gönderilir).
- Kuş animasyonu drone modellerinden daha fazla iş.

## Sıra
1. Lünen 3B canlıya (R2 + world-nrw.js).
2. Kuş fiziği + bir güvercin modeli, Lünen'de tek kuşlu prototip.
3. Tek kafe prototipi (Marktplatz) → işletmelerle görüşme.
4. Sürü, oyunlar, telefon jiroskobu, ayrı vitrin (ör. kus.sewerk.de).
