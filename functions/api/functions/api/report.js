// POST /api/report -> flag a project for review
const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(JSON.stringify({ error: 'board not configured' }), { status: 503 });
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 }); }
  const id = Number(body.project_id);
  if (!Number.isInteger(id) || id <= 0) return new Response(JSON.stringify({ error: 'bad id' }), { status: 400 });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = await sha256(ip + '|' + (env.ADMIN_PASSCODE || 'hsf'));
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ipHash).all();
  if (recent && recent[0] && recent[0].n >= 10) {
    return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
  }
  await env.DB.prepare(
    `INSERT INTO reports (project_id, reason, ip_hash) VALUES (?, ?, ?)`
  ).bind(id, s(body.reason, 300), ipHash).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
