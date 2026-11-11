// GET /api/projects -> approved projects (public, no PII beyond IG handle + city)
// POST /api/projects -> new submission into the pending queue
const GENRES = ['Drama', 'Comedy', 'Horror', 'Thriller', 'Documentary', 'Music Video', 'Animation', 'Experimental', 'Sci-Fi / Fantasy', 'Action', 'Romance', 'Other'];
const COMPS = ['paid', 'unpaid', 'deferred'];
const ROLES = ['director', 'producer', 'screenwriter', 'dp', 'camera-op', 'gaffer', 'sound', 'production-design', 'costume', 'makeup', 'editor', 'colorist', 'composer', 'actor', 'pa', 'script-supervisor', 'stunts', 'vfx', 'graphic-design', 'social', 'other'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // preview without secret: don't block
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ projects: [] });
  const { results } = await env.DB.prepare(
    `SELECT id, title, logline, genre, compensation, roles, city, region, country, lat, lon, ig_handle, created_at
     FROM projects WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 200`
  ).all();
  return json({ projects: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'board not configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const title = s(body.title, 80);
  const logline = s(body.logline, 500);
  const genre = s(body.genre, 40);
  const compensation = s(body.compensation, 20);
  const roles = (Array.isArray(body.roles) ? body.roles : []).map(r => s(r, 30)).filter(r => ROLES.includes(r)).slice(0, 21);
  const city = s(body.city, 60);
  const region = s(body.region, 40);
  const country = s(body.country, 40) || 'US';
  const ig = s(body.ig_handle, 30).replace(/^@/, '');
  const lat = typeof body.lat === 'number' && Math.abs(body.lat) <= 90 ? Math.round(body.lat * 100) / 100 : null;
  const lon = typeof body.lon === 'number' && Math.abs(body.lon) <= 180 ? Math.round(body.lon * 100) / 100 : null;

  if (!title || !logline || !GENRES.includes(genre) || !COMPS.includes(compensation) || !roles.length || !city || !region || !/^[A-Za-z0-9._]{1,30}$/.test(ig)) {
    return json({ error: 'invalid fields' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, s(body.turnstile_token, 2048), ip))) {
    return json({ error: 'turnstile failed' }, 403);
  }

  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM projects WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ipHash).all();
  if (recent && recent[0] && recent[0].n >= 5) return json({ error: 'rate limited' }, 429);

  await env.DB.prepare(
    `INSERT INTO projects (title, logline, genre, compensation, roles, city, region, country, lat, lon, ig_handle, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(title, logline, genre, compensation, JSON.stringify(roles), city, region, country, lat, lon, ig, ipHash).run();

  return json({ ok: true });
}
