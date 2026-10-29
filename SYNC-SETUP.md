# Ručná synchronizácia — nastavenie

Tlačidlo **Aktualizovať** v appke spúšťa GitHub Actions workflow `scrape.yml` cez Netlify funkciu
`netlify/functions/sync.mjs` (endpoint `/api/sync`). GitHub token je uložený len v Netlify, do
prehliadača sa nedostane. Kým token nie je nastavený, lišta s tlačidlom sa v appke nezobrazuje.

## 1. GitHub token

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. *Repository access*: **Only select repositories** → `sk-junior-u15`
3. *Permissions → Repository permissions*: **Actions: Read and write** (nič iné netreba)
4. Expirácia podľa seba (po vypršaní sa lišta skryje a treba vygenerovať nový)

## 2. Netlify

**Site configuration → Environment variables → Add a variable**

| Premenná | Hodnota |
|---|---|
| `GH_TOKEN` | token z kroku 1 (povinné) |
| `SYNC_COOLDOWN_MIN` | ako často sa dá spustiť ručný sync, predvolene `15` |

Potom **Deploys → Trigger deploy → Deploy site**, aby funkcia premennú načítala.

## Ako to funguje

- **Odhad trvania** = priemer posledných 10 úspešných behov workflow (krátke sobotné „strážne“ behy sa nerátajú) + cca 60 s na nasadenie na Netlify.
- **Priebeh** sleduje skutočný beh na GitHube; ak práve beží plánovaný sync, appka ho ukáže tiež.
- Po dobehnutí čaká, kým Netlify nasadí nové `data/teams.json`, a dáta v appke prekreslí bez obnovenia stránky.
- **Ochrana**: nový beh sa nedá spustiť, kým jeden beží, a ručný sync najviac raz za `SYNC_COOLDOWN_MIN` minút (plánované behy cooldown neblokujú).
