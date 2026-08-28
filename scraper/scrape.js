/**
 * Scraper pre appku ŠK Junior Ivanka pri Nitre — U15.
 *
 * DÔLEŽITÉ: Selektory nižšie sú najlepší odhad, nie overené proti živému
 * renderovanému DOM-u (Sportnet dáta dorenderuje cez JS, ja som ho v sandboxe
 * nevidel spustený v prehliadači). Pri prvom behu skript zapíše do
 * data/debug/*.txt surový extrahovaný text z každej stránky — ak scraper
 * nenájde hráčov/zápasy, pozri sa tam a uprav selektory podľa toho, čo tam
 * reálne je.
 *
 * Beží cez Playwright (headless Chromium) — vidí presne to, čo bežný
 * návštevník v prehliadači, vrátane JS-dorenderovaného obsahu.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TEAMS = [
  { slug: 'sk-junior-ivanka-pri-nitre', name: 'ŠK Junior Ivanka pri Nitre' },
  { slug: 'fk-kolarovo', name: 'FK Kolárovo' },
  { slug: 'ssc-fenix-nove-zamky', name: 'SSC FÉNIX Nové Zámky' },
  { slug: 'futbalovy-klub-slovan-sahy', name: 'Futbalový klub Slovan Šahy' },
  { slug: 'sk-surany', name: 'ŠK Šurany' },
  { slug: 'futbalovy-klub-holice', name: 'Futbalový klub Holice' },
  { slug: 'fc-slovan-galanta', name: 'FC Slovan Galanta' },
  { slug: 'fc-slovan-hlohovec', name: 'FC Slovan Hlohovec' },
  { slug: 'fk-veca', name: 'FK Veča' },
  { slug: 'candp-stars-academy-zm', name: 'C&P Stars Academy - ZM' },
  { slug: 'mso-sturovo', name: 'MŠO Štúrovo' },
  { slug: 'fk-slovan-duslo-sala', name: 'FK Slovan Duslo Šaľa' },
  { slug: 'malodvornicky-fk-male-dvorniky', name: 'Malodvornícky FK Malé Dvorníky' },
  { slug: 'tj-dynamo-nova-straz', name: 'TJ Dynamo Nová Stráž' },
  { slug: 'msk-zeliezovce', name: 'MŠK Želiezovce' }
];

const BASE = (slug) => `https://sportnet.sme.sk/futbalnet/k/${slug}/tim/u15-m-a`;
const OUT_DIR = path.join(__dirname, '..', 'data');
const DEBUG_DIR = path.join(OUT_DIR, 'debug');

function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function writeDebug(name, text) {
  fs.writeFileSync(path.join(DEBUG_DIR, name), text || '', 'utf8');
}

// Try a list of selector strategies in order; return the first that yields rows.
async function firstMatchingRows(page, strategies) {
  for (const strat of strategies) {
    try {
      const rows = await page.$$eval(strat.selector, (els, extractorSrc) => {
        // eslint-disable-next-line no-eval
        const extractor = eval(extractorSrc);
        return els.map(extractor).filter(Boolean);
      }, strat.extractorSrc);
      if (rows && rows.length > 0) {
        return { rows, usedSelector: strat.selector };
      }
    } catch (e) {
      // selector not present on this page — try next strategy
    }
  }
  return { rows: [], usedSelector: null };
}

async function scrapeSquad(page, team) {
  const url = `${BASE(team.slug)}/hraci/`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500); // let client-side hydration settle

  const strategies = [
    // Strategy 1: table rows with jersey number + name cells
    {
      selector: 'table tr',
      extractorSrc: `(el) => {
        const cells = Array.from(el.querySelectorAll('td')).map(td => td.textContent.trim());
        if (cells.length < 2) return null;
        const numberLike = cells.find(c => /^\\d{1,2}$/.test(c));
        const nameLike = cells.find(c => /[A-Za-zÀ-ž]{2,}\\s+[A-Za-zÀ-ž]{2,}/.test(c));
        if (!nameLike) return null;
        return { number: numberLike || null, name: nameLike };
      }`
    },
    // Strategy 2: card/list items with a name-like class
    {
      selector: '[class*="player"], [class*="hrac"]',
      extractorSrc: `(el) => {
        const text = el.textContent.trim().replace(/\\s+/g, ' ');
        if (!/[A-Za-zÀ-ž]{2,}\\s+[A-Za-zÀ-ž]{2,}/.test(text)) return null;
        if (text.length > 80) return null;
        return { number: null, name: text };
      }`
    }
  ];

  const { rows, usedSelector } = await firstMatchingRows(page, strategies);
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  writeDebug(`${team.slug}-hraci.txt`, `URL: ${url}\nUsed selector: ${usedSelector}\nRows found: ${rows.length}\n\n--- RAW PAGE TEXT (first 4000 chars) ---\n${bodyText.slice(0, 4000)}`);

  return rows;
}

async function scrapeResults(page, team) {
  const url = `${BASE(team.slug)}/vysledky/`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const strategies = [
    {
      selector: '[class*="match"], [class*="zapas"], [class*="result"]',
      extractorSrc: `(el) => {
        const text = el.textContent.trim().replace(/\\s+/g, ' ');
        if (!/\\d+\\s*[:\\-]\\s*\\d+/.test(text)) return null;
        if (text.length > 200) return null;
        return { raw: text };
      }`
    },
    {
      selector: 'table tr',
      extractorSrc: `(el) => {
        const text = el.textContent.trim().replace(/\\s+/g, ' ');
        if (!/\\d+\\s*[:\\-]\\s*\\d+/.test(text)) return null;
        return { raw: text };
      }`
    }
  ];

  const { rows, usedSelector } = await firstMatchingRows(page, strategies);
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  writeDebug(`${team.slug}-vysledky.txt`, `URL: ${url}\nUsed selector: ${usedSelector}\nRows found: ${rows.length}\n\n--- RAW PAGE TEXT (first 4000 chars) ---\n${bodyText.slice(0, 4000)}`);

  return rows;
}

async function main() {
  ensureDirs();
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; IvankaU15Bot/1.0; +informational, non-commercial fan app)' });

  const output = { generatedAt: new Date().toISOString(), teams: {} };

  for (const team of TEAMS) {
    console.log(`Scraping ${team.name} (${team.slug})...`);
    let squad = [];
    let results = [];
    try {
      squad = await scrapeSquad(page, team);
    } catch (e) {
      console.error(`  squad failed for ${team.slug}:`, e.message);
    }
    try {
      results = await scrapeResults(page, team);
    } catch (e) {
      console.error(`  results failed for ${team.slug}:`, e.message);
    }
    console.log(`  -> ${squad.length} hráčov, ${results.length} zápasov`);
    output.teams[team.slug] = { name: team.name, squad, results };
    await page.waitForTimeout(800); // buď slušný, neposielaj requesty na trhačku
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, 'teams.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log('Hotovo. Výstup: data/teams.json (debug dáta v data/debug/).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
