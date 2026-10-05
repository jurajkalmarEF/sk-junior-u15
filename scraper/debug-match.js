// DOČASNÝ diagnostický skript: stiahne vzhľad stránky zápasu zo Sportnetu
// (screenshoty + HTML priebehu), aby sme ho vedeli presne zopakovať v appke.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'debug', 'match-ui');
fs.mkdirSync(OUT, { recursive: true });

const URLS = {
  sample: 'https://sportnet.sme.sk/futbalnet/z/zsfz/zapas/6a4bd33f5b0f57d4f481a604/'
};

async function capture(browser, label, ctxOpts, url) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // zavri cookie lištu, ak existuje
  for (const txt of ['Pokračovať s nevyhnutnými cookies', 'Súhlasím', 'Prijať']) {
    const b = page.getByText(txt, { exact: false }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 2000 }).catch(() => {}); break; }
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${label}-top.png`), fullPage: false });

  // kontajner priebehu: najmenší element, ktorý obsahuje "Začiatok - 1. polčas", vyšplhaj hore
  const html = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let target = null;
    while ((node = walker.nextNode())) {
      if (node.textContent.indexOf('Začiatok - 1. polčas') !== -1) { target = node.parentElement; break; }
    }
    if (!target) return { timeline: 'NOT FOUND', score: 'NOT FOUND' };
    let el = target;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.textContent.length > 1500) break;
    }
    el.scrollIntoView();
    el.setAttribute('data-debug-timeline', '1');
    const clean = (e) => {
      const c = e.cloneNode(true);
      c.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
      return c.outerHTML;
    };
    // hlavička so skóre: vyšplhaj od názvu domáceho tímu
    let sb = null;
    const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while ((node = w2.nextNode())) {
      if (/divákov$/.test(node.textContent.trim())) { sb = node.parentElement; break; }
    }
    let sbEl = sb;
    for (let i = 0; i < 6 && sbEl && sbEl.parentElement; i++) {
      sbEl = sbEl.parentElement;
      if (sbEl.textContent.length > 120) break;
    }
    return { timeline: clean(el).slice(0, 120000), score: sbEl ? clean(sbEl).slice(0, 60000) : 'NOT FOUND' };
  });
  fs.writeFileSync(path.join(OUT, `${label}-timeline.html`), html.timeline, 'utf8');
  fs.writeFileSync(path.join(OUT, `${label}-scoreboard.html`), html.score, 'utf8');
  const tl = await page.$('[data-debug-timeline="1"]');
  if (tl) await tl.screenshot({ path: path.join(OUT, `${label}-timeline.png`) }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${label}-full.png`), fullPage: true }).catch(() => {});
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const mobile = {
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    timezoneId: 'Europe/Bratislava', locale: 'sk-SK'
  };
  const desktop = { viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Bratislava', locale: 'sk-SK' };
  for (const [name, url] of Object.entries(URLS)) {
    await capture(browser, `${name}-mobile`, mobile, url);
    await capture(browser, `${name}-desktop`, desktop, url);
  }
  await browser.close();
  console.log('done');
})();
