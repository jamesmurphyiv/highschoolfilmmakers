// POST /api/join -> become a member. Visible ID = Instagram @handle (unique).
// Secret member code proves ownership of that handle on later actions.
// GET /api/join -> { count } of active members (public)
// GET /api/join?code=X -> { ok, ig } verify a stored code
const AGE_RANGES = ['13-14', '15-16', '17', '18-plus'];

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

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ count: 0 });
  const code = new URL(request.url).searchParams.get('code');
  if (code) {
    const { results } = await env.DB.prepare(
      `SELECT ig_handle FROM members WHERE member_code = ? AND status = 'active'`
    ).bind(s(code, 24)).all();
    return results && results.length
      ? json({ ok: true, ig: results[0].ig_handle })
      : json({ ok: false }, 404);
  }
  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM members WHERE status = 'active'`
  ).all();
  return json({ count: results && results[0] ? results[0].n : 0 });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'not configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const firstName = s(body.first_name, 20);
  const ageRange = s(body.age_range, 10);
  const region = s(body.region, 40);
  const ig = s(body.ig_handle, 30).replace(/^@/, '').toLowerCase();

  if (!/^[A-Za-z][A-Za-z' -]{0,19}$/.test(firstName) ||
      !AGE_RANGES.includes(ageRange) ||
      !region || region.length > 40 ||
      !/^[a-z0-9._]{1,30}$/.test(ig) ||
      body.agree !== true) {
    return json({ error: 'invalid fields' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, s(body.turnstile_token, 2048), ip))) {
    return json({ error: 'turnstile failed' }, 403);
  }

  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM members WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ipHash).all();
  if (recent && recent[0] && recent[0].n >= 3) return json({ error: 'rate limited' }, 429);

  const { results: dup } = await env.DB.prepare(
    `SELECT id FROM members WHERE ig_handle = ? AND status = 'active'`
  ).bind(ig).all();
  if (dup && dup.length) {
    return json({ error: 'that handle already joined - your member code was shown when you joined; DM @highschoolfilmmakers if you lost it' }, 409);
  }

  const raw = new Uint8Array(9);
  crypto.getRandomValues(raw);
  const code = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    await env.DB.prepare(
      `INSERT INTO members (first_name, age_range, region, ig_handle, member_code, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(firstName, ageRange, region, ig, code, ipHash).run();
  } catch (e) {
    return json({ error: 'that handle already joined' }, 409);
  }

  const { results: cnt } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM members WHERE status = 'active'`
  ).all();

  return json({ ok: true, ig: ig, member_code: code, count: cnt && cnt[0] ? cnt[0].n : null });
    }
