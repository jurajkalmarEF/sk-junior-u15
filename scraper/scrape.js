/**
 * Scraper pre appku ŠK Junior Ivanka pri Nitre — U15.
 *
 * Sportnet stránky renderujú súpisku aj výsledky ako čistý, predvídateľný
 * text (žiadne užitočné CSS triedy), takže namiesto krehkých selektorov
 * parsujeme document.body.innerText podľa známych vzorov:
 *
 * SÚPISKA (.../hraci/):
 *   Hráči
 *   Brankári
 *   Jakub Kalmár
 *   Obrancovia
 *   Miroslav Bakša
 *   ...
 *   Organizačný tím
 *   Tréner
 *   Jakub Blaži
 *   ...
 *   Správy z Futbalnetu   <- koniec užitočného obsahu
 *
 * VÝSLEDKY (.../vysledky/) aj PROGRAM (.../program/) majú rovnaký vzor,
 * program len niekedy vynecháva stav zápasu a skóre (ešte sa nehralo):
 *   <súťaž a skupina> - N. kolo
 *   DD.MM. HH:MM
 *   [Koniec / Nezačalo / ...]   <- voliteľné
 *   Domáci tím
 *   Hosťujúci tím
 *   [<skóre domáci>]            <- voliteľné
 *   [<skóre hostia>]            <- voliteľné
 *   ... (opakuje sa)
 *   Správy z Futbalnetu   <- koniec užitočného obsahu
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
const STOP_MARKER = 'Správy z Futbalnetu';

const POSITION_HEADINGS = {
  'Brankári': 'Brankár',
  'Obrancovia': 'Obranca',
  'Záložníci': 'Záložník',
  'Útočníci': 'Útočník'
};

const KNOWN_STATUS = ['Koniec', 'Nezačalo', 'Prebieha', 'Naživo', 'Odložené', 'Zrušené', 'Kontumácia', 'Neuskutočnené'];
const NAME_RE = /^\p{Lu}\p{Ll}+(\s\p{Lu}\p{Ll}+)+$/u;
const ROUND_RE = /(\d+)\.\s*kolo\s*$/;
const DATETIME_RE = /^(\d{2}\.\d{2})\.\s*(\d{2}:\d{2})$/;

function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function writeDebug(name, text) {
  fs.writeFileSync(path.join(DEBUG_DIR, name), text || '', 'utf8');
}

function usefulLines(fullText) {
  const cut = fullText.indexOf(STOP_MARKER);
  const trimmed = cut >= 0 ? fullText.slice(0, cut) : fullText;
  return trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

function parseSquad(lines) {
  const startIdx = lines.indexOf('Hráči');
  if (startIdx === -1) return { squad: [], staff: [] };

  const squad = [];
  const staff = [];
  let currentPos = null;
  let inStaff = false;
  let pendingRole = null;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    if (line === 'Organizačný tím') {
      inStaff = true;
      currentPos = null;
      continue;
    }

    if (!inStaff) {
      if (POSITION_HEADINGS[line]) {
        currentPos = POSITION_HEADINGS[line];
        continue;
      }
      if (currentPos && NAME_RE.test(line)) {
        squad.push({ name: line, position: currentPos });
      }
    } else {
      // alternating role-label / person-name lines
      if (!pendingRole) {
        pendingRole = line;
      } else {
        staff.push({ role: pendingRole, name: line });
        pendingRole = null;
      }
    }
  }

  return { squad, staff };
}

function parseMatches(lines) {
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const roundMatch = lines[i].match(ROUND_RE);
    if (!roundMatch) continue;

    const dt = lines[i + 1] ? lines[i + 1].match(DATETIME_RE) : null;
    if (!dt) continue; // false positive, keep scanning

    let cursor = i + 2;
    let status = '';
    if (lines[cursor] && KNOWN_STATUS.indexOf(lines[cursor]) !== -1) {
      status = lines[cursor];
      cursor++;
    }

    const home = lines[cursor] || ''; cursor++;
    const away = lines[cursor] || ''; cursor++;

    let scoreHome = null;
    let scoreAway = null;
    if (lines[cursor] && /^\d+$/.test(lines[cursor]) && lines[cursor + 1] && /^\d+$/.test(lines[cursor + 1])) {
      scoreHome = parseInt(lines[cursor], 10);
      scoreAway = parseInt(lines[cursor + 1], 10);
      cursor += 2;
    }

    matches.push({
      round: roundMatch[1] + '. kolo',
      competition: lines[i],
      date: dt[1],
      time: dt[2],
      status,
      home,
      away,
      scoreHome,
      scoreAway,
      played: scoreHome !== null
    });

    i = cursor - 1; // pokračuj skenovanie od miesta, kde sme skončili
  }
  return matches;
}

async function getBodyText(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200); // nech sa dorenderuje klientský obsah
  return page.evaluate(() => document.body.innerText).catch(() => '');
}

async function scrapeTeam(page, team) {
  const squadUrl = `${BASE(team.slug)}/hraci/`;
  const squadText = await getBodyText(page, squadUrl);
  writeDebug(`${team.slug}-hraci.txt`, `URL: ${squadUrl}\n\n${squadText}`);
  const { squad, staff } = parseSquad(usefulLines(squadText));

  const resultsUrl = `${BASE(team.slug)}/vysledky/`;
  const resultsText = await getBodyText(page, resultsUrl);
  writeDebug(`${team.slug}-vysledky.txt`, `URL: ${resultsUrl}\n\n${resultsText}`);
  const results = parseMatches(usefulLines(resultsText));

  const programUrl = `${BASE(team.slug)}/program/`;
  const programText = await getBodyText(page, programUrl);
  writeDebug(`${team.slug}-program.txt`, `URL: ${programUrl}\n\n${programText}`);
  const fixtures = parseMatches(usefulLines(programText));

  return { squad, staff, results, fixtures };
}

async function main() {
  ensureDirs();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (compatible; IvankaU15Bot/1.0; +informational, non-commercial fan app)'
  });

  const output = { generatedAt: new Date().toISOString(), teams: {} };

  for (const team of TEAMS) {
    console.log(`Scraping ${team.name} (${team.slug})...`);
    let squad = [];
    let staff = [];
    let results = [];
    let fixtures = [];
    try {
      const data = await scrapeTeam(page, team);
      squad = data.squad;
      staff = data.staff;
      results = data.results;
      fixtures = data.fixtures;
    } catch (e) {
      console.error(`  failed for ${team.slug}:`, e.message);
    }
    console.log(`  -> ${squad.length} hráčov, ${staff.length} členov tímu, ${results.length} výsledkov, ${fixtures.length} zápasov v programe`);
    output.teams[team.slug] = { name: team.name, squad, staff, results, fixtures };
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
