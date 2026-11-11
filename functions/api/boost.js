// POST /api/boost -> request HSF promotion for a project. Approval queue on.
const BOOST_TYPES = ['cast-crew', 'festival', 'finished-film', 'crowdfunding', 'other'];

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
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'not configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const title = s(body.title, 80);
  const pitch = s(body.pitch, 400);
  const boostType = s(body.boost_type, 20);
  const ig = s(body.ig_handle, 30).replace(/^@/, '');

  if (!title || !pitch || !BOOST_TYPES.includes(boostType) || !/^[A-Za-z0-9._]{1,30}$/.test(ig)) {
    return json({ error: 'invalid fields' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, s(body.turnstile_token, 2048), ip))) {
    return json({ error: 'turnstile failed' }, 403);
  }

  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM boost_requests WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ipHash).all();
  if (recent && recent[0] && recent[0].n >= 3) return json({ error: 'rate limited' }, 429);

  await env.DB.prepare(
    `INSERT INTO boost_requests (title, pitch, boost_type, ig_handle, ip_hash)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(title, pitch, boostType, ig, ipHash).run();

  return json({ ok: true });
}
