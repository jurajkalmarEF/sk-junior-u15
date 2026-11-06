// yt-live — spúšťa sa každú minútu (Supabase cron).
// 1. Zistí, či na kanáli ŠK Junior Ivanka U15 beží živý prenos, a zapíše ho do app_settings ('live'),
//    aby ho appka ukázala v karte Live. Po skončení prenos v appke vypne.
// 2. Keď nič nebeží ani nečaká, pripraví JEDEN nezaradený prenos (auto-štart/auto-stop, vkladanie povolené)
//    naviazaný na kľúč streamu, aby sa XbotGo po zapnutí rovno spustil naživo.
//
// Úspornosť (denný limit YouTube API je 10 000 jednotiek):
//   - bežne len 2 lacné dotazy za minútu (zoznam aktívnych + čakajúcich prenosov, 1 jednotka každý)
//   - vytvorenie prenosu (≈100 jednotiek) najviac raz za 30 min
//   - ručné prepnutie na live (50 jednotiek) len ak kamera naozaj vysiela, prenos sám nenaštartoval,
//     a najviac raz za 5 min
// Ručne nastavený prenos v appke (active && !auto) funkcia neprepisuje.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const YT = 'https://www.googleapis.com/youtube/v3/';
const CREATE_EVERY_MS = 30 * 60 * 1000;
const TRANSITION_EVERY_MS = 5 * 60 * 1000;

async function sb(path: string, init: RequestInit = {}) {
  return fetch(SB_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

function out(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async () => {
  try {
    const cur = await (await sb('app_settings?key=eq.live&select=value')).json();
    // v = aktuálny stav záznamu; po každom zápise ho držíme aktuálny, aby sme si nič neprepísali
    let v: any = (cur && cur[0] && cur[0].value) || {};
    const now = Date.now();

    // Po vyčerpaní limitu YouTube neskúšame znova každú minútu — počkáme 30 min.
    if (v.quotaUntil && now < v.quotaUntil) return out({ skipped: 'quota', until: new Date(v.quotaUntil).toISOString() });

    const tok = await (await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('YT_CLIENT_ID')!,
        client_secret: Deno.env.get('YT_CLIENT_SECRET')!,
        refresh_token: Deno.env.get('YT_REFRESH_TOKEN')!,
        grant_type: 'refresh_token',
      }),
    })).json();
    if (!tok.access_token) return out({ error: 'token', detail: tok }, 500);
    const H = { Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' };
    const yt = async (path: string, init: RequestInit = {}) => (await fetch(YT + path, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();

    // Zmení len uvedené polia. Pomocné údaje (createdAt, tryAt, quotaUntil) sú v tom istom zázname; appka ich ignoruje.
    const save = async (patch: any) => {
      v = { ...v, ...patch };
      await sb('app_settings?key=eq.live', {
        method: 'PATCH',
        body: JSON.stringify({ value: v, updated_at: new Date().toISOString() }),
      });
    };

    const quotaHit = async (r: any) => {
      if (r?.error?.errors?.some((e: any) => e.reason === 'quotaExceeded')) {
        await save({ quotaUntil: now + 30 * 60 * 1000 });
        return true;
      }
      return false;
    };

    // 1) beží niečo naživo? (1 jednotka)
    const act = await yt('liveBroadcasts?part=id,snippet,status&broadcastStatus=active&maxResults=5');
    if (act.error) {
      if (await quotaHit(act)) return out({ error: 'quota' }, 429);
      return out({ error: 'yt', detail: act.error }, 500);
    }
    const live = (act.items || []).find((b: any) => b.status?.lifeCycleStatus === 'live');
    const manual = v.active && !v.auto;

    if (live) {
      const url = 'https://youtube.com/live/' + live.id;
      if (!manual && !(v.active && v.url === url)) {
        await save({ active: true, auto: true, url, title: live.snippet?.title || '' });
        return out({ live: live.id, changed: true });
      }
      return out({ live: live.id, changed: false });
    }

    // nič nebeží → ak appka ešte ukazuje automatický prenos, vypni ho
    if (v.active && v.auto) {
      await save({ active: false, url: '', title: '' });
    }

    // 2) čakajúce prenosy (1 jednotka)
    const upc = await yt('liveBroadcasts?part=id,status,contentDetails&broadcastStatus=upcoming&maxResults=10');
    if (upc.error) {
      if (await quotaHit(upc)) return out({ error: 'quota' }, 429);
      return out({ error: 'yt', detail: upc.error }, 500);
    }
    const waiting = (upc.items || []).filter((b: any) => b.contentDetails?.boundStreamId);

    if (waiting.length) {
      // Kamera vysiela, ale prenos sám nenaštartoval? Skús ho prepnúť — max. raz za 5 min.
      const ready = waiting.find((b: any) => ['ready', 'testing'].includes(b.status?.lifeCycleStatus));
      if (ready && !(v.tryAt && now - v.tryAt < TRANSITION_EVERY_MS)) {
        const st = await yt('liveStreams?part=id,status&id=' + ready.contentDetails.boundStreamId);
        if (st.items?.[0]?.status?.streamStatus === 'active') {
          await save({ tryAt: now });
          const t = await yt('liveBroadcasts/transition?broadcastStatus=live&id=' + ready.id + '&part=status', { method: 'POST' });
          if (await quotaHit(t)) return out({ error: 'quota' }, 429);
          return out({ transition: ready.id, ok: !t.error, detail: t.error?.message });
        }
      }
      return out({ live: null, waiting: waiting.length });
    }

    // 3) nič nečaká → priprav jeden prenos, najviac raz za 30 min
    if (v.createdAt && now - v.createdAt < CREATE_EVERY_MS) return out({ live: null, waiting: 0, created: null });
    const streams = await yt('liveStreams?part=id&mine=true&maxResults=1');
    const stream = (streams.items || [])[0];
    if (!stream) return out({ live: null, error: 'no stream key' });
    await save({ createdAt: now });
    const d = new Date().toLocaleDateString('sk-SK', { timeZone: 'Europe/Bratislava' });
    const ins = await yt('liveBroadcasts?part=snippet,status,contentDetails', {
      method: 'POST',
      body: JSON.stringify({
        snippet: { title: 'ŠK Junior Ivanka U15 – prenos ' + d, scheduledStartTime: new Date().toISOString() },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
        contentDetails: { monitorStream: { enableMonitorStream: false }, enableAutoStart: true, enableAutoStop: true, enableEmbed: true, enableDvr: true, recordFromStart: true },
      }),
    });
    if (ins.error) {
      if (await quotaHit(ins)) return out({ error: 'quota' }, 429);
      return out({ error: 'insert', detail: ins.error }, 500);
    }
    const bind = await yt('liveBroadcasts/bind?part=id&id=' + ins.id + '&streamId=' + stream.id, { method: 'POST' });
    if (bind.error) return out({ error: 'bind', detail: bind.error }, 500);
    return out({ live: null, created: ins.id });
  } catch (e) {
    return out({ error: String(e) }, 500);
  }
});
