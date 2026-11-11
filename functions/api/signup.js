// POST /api/signup -> structured role sign-up on an approved project.
// No free text: first name, age range, optional Instagram only.
const ROLES = ['director', 'producer', 'screenwriter', 'dp', 'camera-op', 'gaffer', 'sound-mixer', 'boom-op', 'sound', 'production-design', 'costume', 'makeup', 'editor', 'colorist', 'composer', 'lead-actor', 'supporting-actor', 'extra', 'actor', 'pa', 'script-supervisor', 'stunts', 'vfx', 'graphic-design', 'social', 'other'];
const AGE_RANGES = ['under-14', '14-15', '16-17', '18-plus'];

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
  if (!env.DB) return json({ error: 'board not configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const projectId = Number(body.project_id);
  const role = s(body.role, 30);
  const firstName = s(body.first_name, 20);
  const ageRange = s(body.age_range, 12);
  const ig = s(body.ig_handle, 30).replace(/^@/, '');

  if (!Number.isInteger(projectId) || !ROLES.includes(role) ||
      !/^[A-Za-z][A-Za-z' -]{0,19}$/.test(firstName) ||
      !AGE_RANGES.includes(ageRange) ||
      (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig))) {
    return json({ error: 'invalid fields' }, 400);
  }

  const { results: proj } = await env.DB.prepare(
    `SELECT id, roles, status FROM projects WHERE id = ?`
  ).bind(projectId).all();
  if (!proj || !proj.length || proj[0].status !== 'approved') {
    return json({ error: 'project not found' }, 404);
  }
  let projectRoles = [];
  try { projectRoles = JSON.parse(proj[0].roles || '[]'); } catch {}
  if (!projectRoles.includes(role)) {
    return json({ error: 'that role is not listed on this project' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, s(body.turnstile_token, 2048), ip))) {
    return json({ error: 'turnstile failed' }, 403);
  }

  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ipHash).all();
  if (recent && recent[0] && recent[0].n >= 5) return json({ error: 'slow down - try again later' }, 429);

  const { results: dup } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses WHERE project_id = ? AND role = ? AND ip_hash = ?`
  ).bind(projectId, role, ipHash).all();
  if (dup && dup[0] && dup[0].n > 0) return json({ error: 'you already signed up for this role' }, 409);

  await env.DB.prepare(
    `INSERT INTO responses (project_id, role, first_name, age_range, ig_handle, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(projectId, role, firstName, ageRange, ig || null, ipHash).run();

  return json({ ok: true });
}
