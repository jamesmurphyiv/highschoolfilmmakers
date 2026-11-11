// HSF member auth. Visible ID = Instagram @handle (unique). Password = a NEW
// password the member makes up for HSF (never their Instagram password),
// stored only as a salted PBKDF2 hash. Session = HttpOnly Secure cookie.
//   GET  /api/join            -> { count } active members (public)
//   GET  /api/join?session=1  -> { ok, member } or 401
//   POST {action:'join', ...} -> create member + session
//   POST {action:'login', ig_handle, password} -> session
//   POST {action:'logout'}    -> clear session
const AGE_RANGES = ['13-14', '15-16', '17', '18-plus'];
const PBKDF2_ITER = 100000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
  });
}
const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hashPassword(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function constEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}
function sessionIdFrom(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)hsf_session=([A-Za-z0-9_-]{20,100})/);
  return m ? m[1] : null;
}
async function memberFromSession(request, env) {
  const id = sessionIdFrom(request);
  if (!id) return null;
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.first_name, m.age_range, m.region, m.ig_handle
     FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND m.status = 'active'`
  ).bind(id).all();
  return results && results.length ? results[0] : null;
}
async function createSession(env, memberId, ipHash) {
  const raw = new Uint8Array(24);
  crypto.getRandomValues(raw);
  const id = b64url(raw);
  await env.DB.prepare(
    `INSERT INTO sessions (id, member_id, expires_at, ip_hash) VALUES (?, ?, datetime('now', '+30 days'), ?)`
  ).bind(id, memberId, ipHash).run();
  return id;
}
function cookieHeader(id, maxAge) {
  return `hsf_session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function rateOk(env, key, limit, modifier) {
  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM rate_hits WHERE hit_key = ? AND created_at > datetime('now', ?)`
  ).bind(key, modifier).all();
  return !(results && results[0] && results[0].n >= limit);
}
async function hit(env, key) {
  await env.DB.prepare(`DELETE FROM rate_hits WHERE created_at < datetime('now', '-1 day')`).run();
  await env.DB.prepare(`INSERT INTO rate_hits (hit_key) VALUES (?)`).bind(key).run();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ count: 0 });
  const url = new URL(request.url);
  if (url.searchParams.get('session')) {
    const m = await memberFromSession(request, env);
    if (!m) return json({ ok: false }, 401);
    return json({ ok: true, member: { ig: m.ig_handle, first_name: m.first_name, age_range: m.age_range, region: m.region } });
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
  const action = s(body.action, 10) || 'join';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));

  if (action === 'logout') {
    const id = sessionIdFrom(request);
    if (id) await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('x', 0) });
  }

  if (action === 'login') {
    const ig = s(body.ig_handle, 30).replace(/^@/, '').toLowerCase();
    const password = String(body.password || '');
    if (!ig || !password) return json({ error: 'invalid fields' }, 400);
    if (!(await rateOk(env, 'login:' + ipHash, 10, '-10 minutes')) ||
        !(await rateOk(env, 'loginh:' + ig, 5, '-10 minutes'))) {
      return json({ error: 'too many tries - wait a few minutes' }, 429);
    }
    await hit(env, 'login:' + ipHash);
    await hit(env, 'loginh:' + ig);
    const { results } = await env.DB.prepare(
      `SELECT id, password_hash FROM members WHERE ig_handle = ? AND status = 'active'`
    ).bind(ig).all();
    let ok = false;
    let memberId = null;
    if (results && results.length && results[0].password_hash) {
      const parts = String(results[0].password_hash).split('$');
      if (parts.length === 3 && parts[0] === 'pbkdf2') {
        const candidate = await hashPassword(password, parts[1]);
        ok = constEq(candidate, parts[2]);
        memberId = results[0].id;
      }
    } else {
      await hashPassword(password, btoa('hsf-dummy-salt00')); // even out timing
    }
    if (!ok) return json({ error: 'wrong handle or password' }, 401);
    const id = await createSession(env, memberId, ipHash);
    return json({ ok: true, ig: ig }, 200, { 'Set-Cookie': cookieHeader(id, 2592000) });
  }

  // action === 'join'
  const firstName = s(body.first_name, 20);
  const ageRange = s(body.age_range, 10);
  const region = s(body.region, 40);
  const ig = s(body.ig_handle, 30).replace(/^@/, '').toLowerCase();
  const password = String(body.password || '');

  if (!/^[A-Za-z][A-Za-z' -]{0,19}$/.test(firstName) ||
      !AGE_RANGES.includes(ageRange) ||
      !region || region.length > 40 ||
      !/^[a-z0-9._]{1,30}$/.test(ig) ||
      password.length < 8 || password.length > 100 ||
      password.toLowerCase() === ig ||
      body.agree !== true) {
    return json({ error: 'invalid fields' }, 400);
  }

  if (!(await verifyTurnstile(env, s(body.turnstile_token, 2048), ip))) {
    return json({ error: 'turnstile failed' }, 403);
  }
  if (!(await rateOk(env, 'join:' + ipHash, 3, '-1 hour'))) {
    return json({ error: 'rate limited' }, 429);
  }
  await hit(env, 'join:' + ipHash);

  const { results: dup } = await env.DB.prepare(
    `SELECT id FROM members WHERE ig_handle = ? AND status = 'active'`
  ).bind(ig).all();
  if (dup && dup.length) {
    return json({ error: 'that handle already joined - log in instead' }, 409);
  }

  const saltRaw = new Uint8Array(16);
  crypto.getRandomValues(saltRaw);
  const saltB64 = btoa(String.fromCharCode(...saltRaw));
  const pwHash = 'pbkdf2$' + saltB64 + '$' + (await hashPassword(password, saltB64));
  const placeholder = b64url(crypto.getRandomValues(new Uint8Array(9)));

  let memberId;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO members (first_name, age_range, region, ig_handle, member_code, password_hash, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(firstName, ageRange, region, ig, placeholder, pwHash, ipHash).run();
    memberId = r.meta && r.meta.last_row_id;
  } catch (e) {
    return json({ error: 'that handle already joined - log in instead' }, 409);
  }

  const id = await createSession(env, memberId, ipHash);
  const { results: cnt } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM members WHERE status = 'active'`
  ).all();
  return json({ ok: true, ig: ig, count: cnt && cnt[0] ? cnt[0].n : null },
              200, { 'Set-Cookie': cookieHeader(id, 2592000) });
    }
