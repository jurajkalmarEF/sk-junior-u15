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
const MINUTE_RE = /^(\d+)'(\+\d+')?$/;
const GOAL_EVENT_TYPES = ['Gól z hry', 'Pokutový kop', 'Vlastný gól', 'Nepremenený pokutový kop', 'Gól'];
const CARD_EVENT_TYPES = ['Žltá karta', 'Druhá žltá karta', 'Červená karta'];

// Tím, pre ktorý ideme naviac scrapovať aj detail každého hráča (fotka, veková
// kategória, zápasy/minúty/góly/karty). Pre ostatné tímy len odkaz na profil,
// aby sme nezaťažovali Sportnet stovkami requestov na cudzích hráčov denne.
const DETAIL_SQUAD_SLUG = 'sk-junior-ivanka-pri-nitre';

const PLAYER_PROFILE_FIELDS = ['Krajina', 'Pohlavie', 'Vek', 'Zápasy', 'Minúty', 'Góly', 'Žltá karta', 'Druhá ŽK', 'Karty'];

function parseStandings(lines) {
  const teamNames = TEAMS.map((t) => t.name);
  const standings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const known = TEAMS.find((t) => t.name === line);
    if (!known) continue;

    let pos = null;
    if (lines[i - 1] && /^\d{1,2}$/.test(lines[i - 1])) pos = parseInt(lines[i - 1], 10);

    const nums = [];
    let score = null;
    let forma = [];
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const l = lines[j];
      if (teamNames.indexOf(l) !== -1) break; // narazili sme na ďalší tím, koniec tohto riadku
      if (/^\d+\s*:\s*\d+$/.test(l)) {
        score = l.replace(/\s/g, '');
      } else if (/^[VRP](\s*[VRP])*$/.test(l)) {
        forma = forma.concat(l.split(/\s+/));
      } else if (/^\d{1,3}$/.test(l)) {
        nums.push(parseInt(l, 10));
      }
    }

    const [z, v, r, p, pts] = nums;
    standings.push({ slug: known.slug, name: known.name, pos, z, v, r, p, score, pts, forma });
  }

  return standings;
}

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

function parseMatchEvents(lines) {
  // Priebeh zápasu (.../futbalnet/z/.../zapas/<id>/) je tiež čistý text, vzor:
  //   Začiatok - 1. polčas / 10:00
  //   3'
  //   Michal Hladký
  //   Gól z hry
  //   36'
  //   Juraj Bašťovanský
  //   Striedajúci hráč: Lukáš Raučina
  //   Marcel Hlisník              <- druhé striedanie v tej istej minúte,
  //   Striedajúci hráč: ...          bez opakovania minúty
  //   Koniec - 2. polčas / 11:25
  //   Štatistika                  <- koniec užitočnej časti priebehu
  const events = [];
  let lastMinute = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === 'Štatistika') break;

    const minuteMatch = l.match(MINUTE_RE);
    if (minuteMatch) {
      lastMinute = l;
      const a = lines[i + 1];
      const b = lines[i + 2];
      if (a && GOAL_EVENT_TYPES.indexOf(b) !== -1) {
        events.push({ minute: lastMinute, type: 'goal', player: a, detail: b });
        i += 2;
        continue;
      }
      if (a && CARD_EVENT_TYPES.indexOf(b) !== -1) {
        events.push({ minute: lastMinute, type: 'card', player: a, detail: b });
        i += 2;
        continue;
      }
      if (a && b && b.indexOf('Striedajúci hráč:') === 0) {
        events.push({ minute: lastMinute, type: 'sub', playerOut: a, playerIn: b.replace('Striedajúci hráč:', '').trim() });
        i += 2;
        continue;
      }
      continue;
    }

    // druhé striedanie v tej istej minúte, bez vlastného riadku s minútou
    if (lastMinute && lines[i + 1] && lines[i + 1].indexOf('Striedajúci hráč:') === 0) {
      events.push({ minute: lastMinute, type: 'sub', playerOut: l, playerIn: lines[i + 1].replace('Striedajúci hráč:', '').trim() });
      i += 1;
      continue;
    }
  }
  return events;
}

function parseMatchDetail(lines) {
  const events = parseMatchEvents(lines);

  let attendance = null;
  let referee = null;
  let stadiumName = null;
  let stadiumAddress = null;

  const stadiumIdx = lines.indexOf('Štadión');
  const delegatedIdx = lines.indexOf('Delegované osoby');

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const att = l.match(/^(\d+)\s*divákov$/);
    if (att) attendance = parseInt(att[1], 10);
    if (delegatedIdx !== -1 && i > delegatedIdx && l.indexOf('Rozhodca	') === 0 && !referee) {
      referee = l.split('	')[1] || null;
    }
    if (stadiumIdx !== -1 && i > stadiumIdx) {
      if (l.indexOf('Názov	') === 0 && !stadiumName) stadiumName = l.split('	')[1] || null;
      if (l.indexOf('Adresa	') === 0 && !stadiumAddress) stadiumAddress = l.split('	')[1] || null;
    }
  }

  return { events, attendance, referee, stadiumName, stadiumAddress };
}

async function extractMatchLinks(page) {
  try {
    const hrefs = await page.$$eval('a[href*="/zapas/"]', (els) => els.map((el) => el.href));
    const seen = new Set();
    return hrefs.filter((h) => (seen.has(h) ? false : (seen.add(h), true)));
  } catch (e) {
    return [];
  }
}

async function extractProfileLinks(page) {
  // Mená hráčov na súpiske sú (predpokladáme) odkazy na ich Sportnet profil
  // (.../futbalnet/clen/{id}/{meno}/). Vyťiahneme aj prípadnú fotku vedľa mena.
  try {
    return await page.$$eval('a[href*="/futbalnet/clen/"]', (els) =>
      els.map((el) => {
        const img = el.querySelector('img') || el.closest('li, tr, div')?.querySelector('img');
        return {
          name: el.textContent.trim().replace(/\s+/g, ' '),
          href: el.href,
          photo: img ? img.src : null
        };
      })
    );
  } catch (e) {
    return [];
  }
}

function mergeSquadWithLinks(squad, links) {
  const byName = {};
  links.forEach((l) => { byName[l.name] = l; });
  return squad.map((p) => {
    const match = byName[p.name];
    return match ? Object.assign({}, p, { href: match.href, photo: match.photo || null }) : p;
  });
}

function parsePlayerProfile(lines) {
  const data = {};
  PLAYER_PROFILE_FIELDS.forEach((field) => {
    const idx = lines.indexOf(field);
    if (idx > 0) data[field] = lines[idx - 1];
  });
  return {
    country: data['Krajina'] || null,
    gender: data['Pohlavie'] || null,
    age: data['Vek'] || null,
    matches: data['Zápasy'] ? parseInt(data['Zápasy'], 10) : null,
    minutes: data['Minúty'] ? parseInt(data['Minúty'], 10) : null,
    goals: data['Góly'] ? parseInt(data['Góly'], 10) : null,
    yellowCards: data['Žltá karta'] ? parseInt(data['Žltá karta'], 10) : null,
    secondYellow: data['Druhá ŽK'] ? parseInt(data['Druhá ŽK'], 10) : null,
    redCards: data['Karty'] ? parseInt(data['Karty'], 10) : null
  };
}

async function scrapePlayerDetail(page, player, teamSlug) {
  if (!player.href) return player;
  const text = await getBodyText(page, player.href);
  writeDebug(`player-${teamSlug}-${player.name.replace(/\s+/g, '-')}.txt`, `URL: ${player.href}\n\n${text}`);
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const profile = parsePlayerProfile(lines);

  let photo = player.photo || null;
  if (!photo) {
    photo = await page.$eval('img[src*="/data/"]', (el) => el.src).catch(() => null);
  }

  return Object.assign({}, player, { photo, profile });
}

async function extractProfileLinksAndDetail(page, squad, teamSlug) {
  const links = await extractProfileLinks(page);
  let merged = mergeSquadWithLinks(squad, links);

  if (teamSlug === DETAIL_SQUAD_SLUG) {
    const withDetail = [];
    for (const player of merged) {
      try {
        withDetail.push(await scrapePlayerDetail(page, player, teamSlug));
      } catch (e) {
        console.error(`    detail failed for ${player.name}:`, e.message);
        withDetail.push(player);
      }
      await page.waitForTimeout(400);
    }
    merged = withDetail;
  }

  return merged;
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
  const { squad: squadBase, staff } = parseSquad(usefulLines(squadText));
  // stránka /hraci/ je stále otvorená v `page`, takže tu vieme čítať DOM (odkazy, fotky)
  const squad = await extractProfileLinksAndDetail(page, squadBase, team.slug);

  const resultsUrl = `${BASE(team.slug)}/vysledky/`;
  const resultsText = await getBodyText(page, resultsUrl);
  writeDebug(`${team.slug}-vysledky.txt`, `URL: ${resultsUrl}\n\n${resultsText}`);
  const results = parseMatches(usefulLines(resultsText));

  // Priebeh zápasu (góly, striedania, rozhodca, štadión) sťahujeme len pre odohrané
  // zápasy Ivanky — pre ostatné tímy by to znamenalo desiatky requestov navyše denne.
  if (team.slug === DETAIL_SQUAD_SLUG) {
    const matchLinks = await extractMatchLinks(page); // page je stále na resultsUrl
    if (matchLinks.length === results.length) {
      for (let i = 0; i < results.length; i++) {
        if (!results[i].played) continue;
        try {
          const detailText = await getBodyText(page, matchLinks[i]);
          results[i].detailUrl = matchLinks[i];
          results[i].detail = parseMatchDetail(usefulLines(detailText));
        } catch (e) {
          console.error(`  detail zápasu zlyhal (${matchLinks[i]}):`, e.message);
        }
        await page.waitForTimeout(400);
      }
    } else {
      console.error(`  počet odkazov na zápasy (${matchLinks.length}) nesedí s počtom výsledkov (${results.length}), preskakujem priebeh zápasov`);
    }
  }

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
    userAgent: 'Mozilla/5.0 (compatible; IvankaU15Bot/1.0; +informational, non-commercial fan app)',
    timezoneId: 'Europe/Bratislava',
    locale: 'sk-SK'
  });

  const output = { generatedAt: new Date().toISOString(), standings: [], teams: {} };

  console.log('Scraping tabuľka skupiny...');
  try {
    const tableUrl = `${BASE(TEAMS[0].slug)}/tabulky/`;
    const tableText = await getBodyText(page, tableUrl);
    writeDebug('tabulky.txt', `URL: ${tableUrl}\n\n${tableText}`);
    output.standings = parseStandings(usefulLines(tableText));
    console.log(`  -> ${output.standings.length} tímov v tabuľke`);
  } catch (e) {
    console.error('  tabuľka failed:', e.message);
  }

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
