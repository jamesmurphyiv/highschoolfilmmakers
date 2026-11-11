// Admin API. All requests need header X-Admin-Passcode matching env.ADMIN_PASSCODE.
// GET  /api/admin?view=pending|approved|reports
// POST /api/admin {action: approve|reject|remove|dismiss, id}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function ok(request, env) {
  return !!env.ADMIN_PASSCODE && request.headers.get('X-Admin-Passcode') === env.ADMIN_PASSCODE;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'board not configured' }, 503);
  if (!ok(request, env)) return json({ error: 'unauthorized' }, 401);
  const view = new URL(request.url).searchParams.get('view') || 'pending';
  if (view === 'pending') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, logline, genre, compensation, roles, city, region, ig_handle, created_at
       FROM projects WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`).all();
    return json({ items: results || [] });
  }
  if (view === 'approved') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, logline, genre, compensation, roles, city, region, ig_handle, created_at
       FROM projects WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 200`).all();
    return json({ items: results || [] });
  }
  if (view === 'reports') {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.project_id, r.reason, r.created_at, p.title, p.logline, p.genre, p.compensation, p.roles, p.city, p.region, p.ig_handle
       FROM reports r JOIN projects p ON p.id = r.project_id
       ORDER BY r.created_at DESC LIMIT 100`).all();
    return json({ items: results || [] });
  }
  if (view === 'boosts') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, pitch, boost_type, ig_handle, created_at
       FROM boost_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`).all();
    return json({ items: results || [] });
  }
  if (view === 'members') {
    const { results } = await env.DB.prepare(
      `SELECT id, first_name, age_range, region, ig_handle, created_at
       FROM members WHERE status = 'active' ORDER BY created_at ASC LIMIT 500`).all();
    const { results: cnt } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM members WHERE status = 'active'`).all();
    return json({ items: results || [], count: cnt && cnt[0] ? cnt[0].n : 0 });
  }
  return json({ error: 'unknown view' }, 400);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'board not configured' }, 503);
  if (!ok(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
  switch (body.action) {
    case 'approve':
      await env.DB.prepare(`UPDATE projects SET status = 'approved', approved_at = datetime('now') WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'reject':
      await env.DB.prepare(`UPDATE projects SET status = 'rejected' WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'remove':
      await env.DB.prepare(`DELETE FROM reports WHERE project_id = ?`).bind(id).run();
      await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'member-remove':
      await env.DB.prepare(`UPDATE members SET status = 'removed' WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'boost-done':
      await env.DB.prepare(`UPDATE boost_requests SET status = 'done' WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'boost-remove':
      await env.DB.prepare(`DELETE FROM boost_requests WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    case 'dismiss':
      await env.DB.prepare(`DELETE FROM reports WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    default:
      return json({ error: 'unknown action' }, 400);
  }
  }
