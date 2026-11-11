// GET /api/responses?code=XXXX -> project + its role sign-ups, gated by the
// secret view code handed to the poster once at submission.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'board not configured' }, 503);
  const code = (new URL(request.url)).searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{8,20}$/.test(code)) return json({ error: 'bad code' }, 400);

  const { results: proj } = await env.DB.prepare(
    `SELECT id, title, genre, compensation, roles, city, region, created_at, status
     FROM projects WHERE view_code = ?`
  ).bind(code).all();
  if (!proj || !proj.length) return json({ error: 'not found' }, 404);
  const p = proj[0];
  if (p.status === 'rejected') return json({ error: 'not found' }, 404);

  const { results: resp } = await env.DB.prepare(
    `SELECT role, first_name, age_range, ig_handle, created_at
     FROM responses WHERE project_id = ? ORDER BY created_at ASC LIMIT 500`
  ).bind(p.id).all();

  return json({
    project: {
      title: p.title, genre: p.genre, compensation: p.compensation,
      city: p.city, region: p.region, roles: p.roles, status: p.status
    },
    responses: resp || []
  });
}
