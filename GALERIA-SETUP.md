# Galéria — nastavenie Supabase

## 1. Vytvor Supabase projekt
Choď na https://supabase.com → New project (stačí free tier). Počkaj kým sa vytvorí databáza (~2 min).

## 2. Vytvor tabuľku pre záznamy galérie
V Supabase: **SQL Editor → New query**, vlož a spusti:

```sql
create table gallery_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_url text not null,
  file_type text not null check (file_type in ('image','video')),
  caption text,
  uploader_name text
);

alter table gallery_items enable row level security;

-- ktokoľvek s odkazom na appku (a heslom do galérie) môže čítať aj pridávať záznamy
create policy "public read" on gallery_items for select using (true);
create policy "public insert" on gallery_items for insert with check (true);
```

## 3. Vytvor Storage bucket pre súbory
**Storage → New bucket**:
- Name: `gallery`
- Public bucket: **zapnuté** (aby sa fotky/videá dali zobraziť priamo v appke)

Potom v **Storage → gallery → Policies** pridaj policy, ktorá dovolí nahrávanie:

```sql
create policy "public upload" on storage.objects for insert
  with check (bucket_id = 'gallery');

create policy "public read files" on storage.objects for select
  using (bucket_id = 'gallery');
```
(Dá sa spustiť aj cez SQL Editor.)

## 4. Skopíruj API údaje do appky
**Project Settings → API**:
- **Project URL** → skopíruj do `SUPABASE_URL` v `index.html`
- **anon public key** → skopíruj do `SUPABASE_ANON_KEY` v `index.html`

V súbore `index.html` nájdi (úplne na konci, v sekcii `/* ===================== GALÉRIA ===================== */`):

```js
var SUPABASE_URL = 'https://TVOJ-PROJEKT.supabase.co';
var SUPABASE_ANON_KEY = 'TVOJ-ANON-KEY';
var GALLERY_PASSWORD = 'junior2026';
```

Doplň svoje skutočné URL a kľúč, a zmeň `GALLERY_PASSWORD` na heslo, ktoré rozdáš rodičom/tímu (nie je to skutočné zabezpečenie — len jemná zábrana pred cudzími ľuďmi z internetu, keďže ide o fotky detí).

## 5. Nahraj aktualizovaný index.html do GitHubu
Rovnako ako doteraz — **Add file → Upload files** (nie copy-paste), nahraď starý `index.html`. Netlify si to samo znovu nasadí.

## Ako to funguje
- Záložka **Galéria** je zamknutá heslom (uloží sa do prehliadača, netreba ho zadávať zakaždým).
- Po odomknutí môže ktokoľvek nahrať fotku/video (voliteľne s popisom a menom) — ide priamo do Supabase Storage, appka si to sama ukáže v mriežke.
- Klik na fotku/video otvorí zväčšený náhľad.
- Galéria je spoločná pre celý klub (nezávisí od vybraného tímu hore).

## Poznámka k bezpečnosti
Toto nie je skutočné prihlasovanie — heslo je len v kóde appky a dá sa ľahko obísť (kto vie čítať zdrojový kód stránky). Je to zámerne jednoduché riešenie na odradenie náhodných návštevníkov, nie ochrana pred niekým, kto sa tam naozaj chce dostať. Ak by si chcel silnejšiu ochranu (napr. skutočné prihlasovanie cez Supabase Auth), vieme to neskôr dorobiť.
