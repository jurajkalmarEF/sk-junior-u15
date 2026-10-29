// Ručná synchronizácia dát zo Sportnetu.
//
// GET  /api/sync  → stav: beží práve sync? kedy skončil posledný? priemerná dĺžka behu
// POST /api/sync  → spustí GitHub Actions workflow scrape.yml (workflow_dispatch)
//
// GitHub token je len tu na serveri (Netlify env premenná GH_TOKEN), nikdy nejde do
// prehliadača. Stačí fine-grained token s prístupom len k tomuto repu a oprávnením
// "Actions: Read and write".
//
// Voliteľné env premenné:
//   GH_REPO            (predvolene jurajkalmarEF/sk-junior-u15)
//   GH_WORKFLOW        (predvolene scrape.yml)
//   GH_REF             (predvolene main)
//   SYNC_COOLDOWN_MIN  (predvolene 15) — ako často sa dá spustiť ručný sync

const REPO = process.env.GH_REPO || 'jurajkalmarEF/sk-junior-u15';
const WORKFLOW = process.env.GH_WORKFLOW || 'scrape.yml';
const REF = process.env.GH_REF || 'main';
const COOLDOWN_MIN = Number(process.env.SYNC_COOLDOWN_MIN || 15);

// Sobotné "strážne" behy (DST guard v scrape.yml) skončia za pár sekúnd bez scrapovania —
// do priemeru ich nerátame, inak by odhad vychádzal nezmyselne krátky.
const MIN_REAL_RUN_SECONDS = 60;
const AVG_SAMPLE = 10;
const FALLBACK_AVG_SECONDS = 240;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function gh(path, init = {}) {
  return fetch('https://api.github.com/repos/' + REPO + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ivanka-u15-sync',
      ...(init.headers || {}),
    },
  });
}

function runSeconds(run) {
  return (Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / 1000;
}

export async function getStatus(now = Date.now()) {
  const r = await gh('/actions/workflows/' + WORKFLOW + '/runs?per_page=30');
  if (!r.ok) throw new Error('GitHub API ' + r.status);
  const runs = (await r.json()).workflow_runs || [];

  const durations = runs
    .filter((x) => x.status === 'completed' && x.conclusion === 'success' && x.run_started_at)
    .map(runSeconds)
    .filter((s) => s >= MIN_REAL_RUN_SECONDS)
    .slice(0, AVG_SAMPLE);
  const avgSeconds = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : FALLBACK_AVG_SECONDS;

  const active = runs.find((x) => x.status !== 'completed');
  const lastDone = runs.find((x) => x.status === 'completed');

  // Cooldown platí len pre ručné spustenia — plánované behy ho neblokujú.
  const lastManual = runs.find((x) => x.event === 'workflow_dispatch');
  const cooldownSeconds = lastManual
    ? Math.max(0, Math.ceil(COOLDOWN_MIN * 60 - (now - Date.parse(lastManual.created_at)) / 1000))
    : 0;

  return {
    configured: true,
    now: new Date(now).toISOString(),
    avgSeconds,
    samples: durations.length,
    cooldownSeconds,
    active: active
      ? {
          id: active.id,
          status: active.status,
          event: active.event,
          createdAt: active.created_at,
          startedAt: active.run_started_at || active.created_at,
        }
      : null,
    last: lastDone
      ? { id: lastDone.id, conclusion: lastDone.conclusion, createdAt: lastDone.created_at, finishedAt: lastDone.updated_at }
      : null,
  };
}

export default async (req) => {
  if (!process.env.GH_TOKEN) return json(200, { configured: false });

  try {
    if (req.method === 'GET') return json(200, await getStatus());

    if (req.method === 'POST') {
      const status = await getStatus();
      if (status.active) return json(409, { error: 'running', ...status });
      if (status.cooldownSeconds > 0) return json(429, { error: 'cooldown', ...status });

      const r = await gh('/actions/workflows/' + WORKFLOW + '/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: REF }),
      });
      if (r.status !== 204) return json(502, { error: 'dispatch_failed', githubStatus: r.status });

      return json(202, { ok: true, dispatchedAt: new Date().toISOString(), avgSeconds: status.avgSeconds });
    }

    return json(405, { error: 'method_not_allowed' });
  } catch (e) {
    return json(502, { error: 'github_unreachable', message: String(e.message || e) });
  }
};

export const config = { path: '/api/sync' };
