# Live prenos a videá k zápasom — nastavenie

Obe funkcie používajú ten istý Supabase projekt ako galéria. Treba len raz vytvoriť dve tabuľky.

## 1. Tabuľky v Supabase (jednorazovo)

V Supabase otvor **SQL Editor → New query**, vlož tento kód a spusti ho:

```sql
-- nastavenia appky (zatiaľ len stav live prenosu)
create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create policy "public read settings"   on app_settings for select using (true);
create policy "public insert settings" on app_settings for insert with check (true);
create policy "public update settings" on app_settings for update using (true) with check (true);

insert into app_settings (key, value) values ('live', '{"active": false}')
on conflict (key) do nothing;

-- odkazy na videá zo zápasov (jeden zápas môže mať viac videí)
create table if not exists match_videos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  match_key text not null,      -- ID zápasu zo Sportnetu, napr. sn:6a4bd33f5b0f57d4f481a3a6
  match_label text,             -- len pre prehľad v Supabase: "Ivanka – Šurany"
  url text not null check (url ~* '^https?://'),
  title text
);
create index if not exists match_videos_key on match_videos (match_key);
alter table match_videos enable row level security;
create policy "public read videos"   on match_videos for select using (true);
create policy "public insert videos" on match_videos for insert with check (true);
create policy "public delete videos" on match_videos for delete using (true);
```

Zabezpečenie je rovnaké ako v galérii: zapisovať sa dá len cez appku s **admin heslom**
(`ADMIN_PASSWORD` v `index.html`). Nie je to skutočné prihlasovanie, len zábrana pred
náhodnými návštevníkmi.

## 2. Live prenos z XbotGo

XbotGo **neposiela RTSP**. Posiela obraz (RTMP) na YouTube alebo na vlastný RTMP server.
Prehliadač ani appka nevedia RTSP ani RTMP prehrať priamo. Najjednoduchšie je preto
vysielať na **YouTube** a appka si YouTube prehrávač vloží sama.

### Príprava YouTube kanála (jednorazovo)
1. Na počítači otvor **studio.youtube.com** a zvoľ **Create → Go live**.
2. Ak to robíš prvýkrát, YouTube vyžaduje overenie telefónnym číslom. Živé vysielanie
   sa potom odomkne **až po 24 hodinách**, takže to sprav pár dní pred zápasom.
3. Vľavo zvoľ **Stream**. Skopíruj **Stream URL** (`rtmp://a.rtmp.youtube.com/live2`)
   a **Stream key**. Kľúč sa nemení, stačí si ho skopírovať raz.
4. V nastaveniach streamu odporúčam:
   - Viditeľnosť: **Nezaradené (Unlisted)**. Prenos uvidí len ten, kto má odkaz,
     teda ľudia v appke. Nedá sa nájsť vyhľadávaním (sú tam deti).
   - **Povoliť vkladanie (Allow embedding)**: zapnuté, inak sa prenos v appke neprehrá.
   - Publikum: „Nie je určené pre deti“. Ide o obsah pre rodičov a trénerov, nie o obsah
     pre deti, a pri voľbe „pre deti“ sú vložené prehrávače obmedzené.
   - **Auto-start / Auto-stop**: zapnuté.

### V aplikácii XbotGo (pri každom zápase)
1. Zapni kameru, pripoj ju v aplikácii XbotGo a zvoľ šport (Futbal).
2. Ťukni na **Live**. Zvoľ kvalitu podľa signálu na ihrisku: pri mobilných dátach
   radšej **720p**, 1080p len pri silnom signáli.
3. Zvoľ **RTMP** (alebo **YouTube**, ak chceš prihlásenie cez Google účet) → **Next**.
4. Pri RTMP vlož **Stream URL** a **Stream key** (políčko „password“) z YouTube Studia.
5. Ťukni **Start Online** a potom **Record**. Prenos počas zápasu nepauzuj, pauza môže
   spôsobiť čiernu obrazovku.

### V appke Ivanka U15
1. V YouTube Studiu (alebo v aplikácii YouTube) skopíruj odkaz na prebiehajúci prenos,
   napr. `https://youtube.com/live/XXXXXXXXXXX`.
2. V appke otvor kartu **Live** → **⚙️ Nastaviť prenos**, zadaj admin heslo, vlož odkaz
   a popis (predvyplní sa najbližší zápas). Potom ťukni **Spustiť / uložiť**.
3. Karta **Live** začne všetkým blikať na červeno (appka to kontroluje každú minútu).
4. Po zápase → **Ukončiť prenos**.
5. Záznam prenosu zostane na YouTube. Ten istý odkaz potom vlož ako video k zápasu
   (krok 3 nižšie).

> Voliteľné: ak budeš vysielať **verejne**, môžeš do `LIVE_YOUTUBE_CHANNEL_ID` v
> `index.html` vložiť ID svojho kanála (začína `UC…`). Potom stačí v appke zapnúť
> prenos bez odkazu a appka sama ukáže, čo práve na kanáli beží. Pri nezaradených
> prenosoch to nefunguje, tam treba odkaz.

### Prečo nie priamo RTSP?
Dalo by sa to cez vlastný server (napr. **MediaMTX** na Raspberry Pi), ktorý prijme RTMP
z kamery a premení ho na HLS (`.m3u8`). Appka vie prehrať aj takýto odkaz. Lenže Pi by
muselo byť dostupné z internetu cez HTTPS (port forward na routeri, doména, certifikát)
a zvládnuť upload pre všetkých divákov z tvojej domácej linky. YouTube to robí zadarmo
a spoľahlivejšie.

## 3. Videá k zápasu
1. Nahraj video na XbotGo cloud, YouTube, Google Drive a podobne. Skopíruj **odkaz na
   zdieľanie**: v XbotGo aplikácii pri videu **Share → Copy link**, na Google Drive
   „Ktokoľvek s odkazom“.
2. V appke **Zápasy** → klikni na zápas → **＋ Pridať video**.
3. Vlož odkaz a názov (napr. „1. polčas“, „2. polčas“, „Zostrih gólov“), zadaj admin heslo
   a **Uložiť video**. K jednému zápasu môžeš pridať ľubovoľný počet videí.
4. Pri zápase sa zobrazí 🎬 s počtom videí. YouTube, Vimeo a Facebook videá sa prehrajú
   priamo v appke. Ostatné (XbotGo, Google Drive) sa otvoria v novej karte.
5. Odstrániť video: po odomknutí admina sa pri videu zobrazí ✕. Samotné video na
   XbotGo alebo YouTube zostane, zmaže sa len odkaz v appke.
