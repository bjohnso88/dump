// Dump v2 Worker: serves the app (static assets), a small JSON API on D1, and the reminder cron.
import { smartParse, prioritize, shrink } from './claude.js';
import { sendToAll } from './push.js';
import { serveStatic } from './static.js';
import { readDeadline } from './dates.js';
import { safeTz, localParts, localToUtc, dueToUtc, DUE_RE } from './time.js';

const DAY = 86400000;
const QUIET_START = 22 * 60, QUIET_END = 8 * 60; // 10pm to 8am, local
const DAILY_MAX = 4;
const SIZES = ['quick', 'medium', 'big'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function authed(req, env) {
  const got = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  const want = env.AUTH_TOKEN || '';
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ---------- settings ----------
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.k, r.v]));
}
const setSetting = (env, k, v) =>
  env.DB.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();

// ---------- items ----------
const toItem = (r) => r && ({
  id: r.id, text: r.text, kind: r.kind, createdAt: r.created_at, doneAt: r.done_at,
  due: r.due, size: r.size, touchedAt: r.touched_at, askOpen: !!r.ask_open,
});
const getRow = (env, id) => env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
const openTodos = async (env) =>
  (await env.DB.prepare("SELECT * FROM items WHERE kind = 'todo' AND done_at IS NULL ORDER BY created_at LIMIT 100").all()).results;

// Fallback when Claude is unavailable: due soonest, then oldest.
function plainPick(list) {
  const sorted = [...list].sort((a, b) =>
    (a.due || '9999').localeCompare(b.due || '9999') || a.created_at - b.created_at);
  return {
    top: sorted.slice(0, 3).map((it) => ({ id: it.id, why: it.due ? 'Has a due date' : 'Been waiting a while' })),
    firstStep: 'Open it up and give it two minutes.',
  };
}

async function makePick(env, energy, tz) {
  const list = await openTodos(env);
  const L = localParts(Date.now(), tz);
  const pick = (await prioritize(env, list, energy, L, tz)) || plainPick(list);
  const out = { ...pick, energy, at: Date.now() };
  await setSetting(env, 'last_pick', JSON.stringify(out));
  return out;
}

// ---------- API ----------
async function route(req, env, url, ctx) {
  const m = req.method;
  const p = url.pathname.replace(/^\/api/, '');
  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const now = Date.now();
  const s = await getSettings(env);
  const tz = safeTz(s.tz);

  if (m === 'GET' && p === '/state') {
    const qtz = url.searchParams.get('tz');
    if (qtz && safeTz(qtz) === qtz && qtz !== s.tz) await setSetting(env, 'tz', qtz);
    const { results } = await env.DB.prepare(
      'SELECT * FROM items WHERE done_at IS NULL OR done_at > ? ORDER BY created_at').bind(now - 8 * DAY).all();
    return json({
      items: results.map(toItem),
      pick: s.last_pick ? JSON.parse(s.last_pick) : null,
      morning: s.morning || '08:30',
      vapidKey: env.VAPID_PUBLIC_KEY || null,
    });
  }

  if (m === 'POST' && p === '/items') {
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) return json({ error: 'empty' }, 400);
    const id = String(body.id || crypto.randomUUID());
    const kind = body.kind === 'idea' ? 'idea' : 'todo';
    await env.DB.prepare('INSERT OR IGNORE INTO items (id, text, kind, created_at, touched_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, text, kind, body.createdAt || now, now).run();
    return json(toItem(await getRow(env, id)));
  }

  if (m === 'POST' && p === '/import') {
    const stmts = (body.items || []).slice(0, 2000).filter((i) => i && i.text).map((i) =>
      env.DB.prepare('INSERT OR IGNORE INTO items (id, text, kind, created_at, done_at, touched_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(String(i.id), String(i.text).slice(0, 500), i.kind === 'idea' ? 'idea' : 'todo',
          Math.floor(Number(i.id)) || now, i.doneAt || null, now));
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, count: stmts.length });
  }

  let mm = p.match(/^\/items\/([^/]+)(\/smart|\/shrink)?$/);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    const row = await getRow(env, id);
    if (!row) return json({ error: 'gone' }, 404);

    if (m === 'DELETE' && !mm[2]) {
      await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    if (m === 'POST' && mm[2] === '/smart') {
      // Deadline: Claude if it has a key and finds one, else the built-in reader (worker/dates.js).
      const L = localParts(now, tz);
      const got = await smartParse(env, row.text, L, tz);
      const found = got?.due || readDeadline(row.text, L);
      // On add, only fill blanks, never overwrite something set by hand.
      // After you edit the text, a date written in the new text wins.
      const due = body.edit && found ? found : (row.due ?? found ?? null);
      const dueChanged = due !== row.due;
      await env.DB.prepare(`UPDATE items SET due = ?, due_at = ?, size = ?${dueChanged ? ', reminded_at = NULL' : ''} WHERE id = ?`)
        .bind(due, dueToUtc(due, tz), row.size ?? got?.size ?? null, id).run();
      return json(toItem(await getRow(env, id)));
    }

    if (m === 'POST' && mm[2] === '/shrink') {
      const text = await shrink(env, row.text);
      if (!text) return json({ error: 'no shrink' }, 502);
      await env.DB.prepare("UPDATE items SET text = ?, size = 'quick', touched_at = ?, ask_open = 0 WHERE id = ?")
        .bind(text, now, id).run();
      return json(toItem(await getRow(env, id)));
    }

    if (m === 'PATCH' && !mm[2]) {
      const sets = ['touched_at = ?', 'ask_open = 0'];
      const vals = [now];
      if ('text' in body && String(body.text).trim()) { sets.push('text = ?'); vals.push(String(body.text).trim().slice(0, 500)); }
      if ('kind' in body) { sets.push('kind = ?'); vals.push(body.kind === 'idea' ? 'idea' : 'todo'); }
      if ('doneAt' in body) { sets.push('done_at = ?'); vals.push(body.doneAt ? Number(body.doneAt) : null); }
      if ('size' in body) { sets.push('size = ?'); vals.push(SIZES.includes(body.size) ? body.size : null); }
      if ('due' in body) {
        const due = DUE_RE.test(body.due || '') ? body.due : null;
        sets.push('due = ?', 'due_at = ?', 'reminded_at = NULL');
        vals.push(due, dueToUtc(due, tz));
      }
      await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      return json(toItem(await getRow(env, id)));
    }
  }

  if (m === 'POST' && p === '/prioritize') {
    const energy = ['low', 'med', 'high'].includes(body.energy) ? body.energy : 'med';
    return json(await makePick(env, energy, tz));
  }

  if (m === 'POST' && p === '/pick/clear') {
    await env.DB.prepare("DELETE FROM settings WHERE k = 'last_pick'").run();
    return json({ ok: true });
  }

  if (m === 'POST' && p === '/settings') {
    if (/^\d{2}:\d{2}$/.test(body.morning || '')) {
      await setSetting(env, 'morning', body.morning);
      return json({ ok: true, morning: body.morning });
    }
    return json({ error: 'bad time' }, 400);
  }

  if (m === 'POST' && p === '/push/subscribe') {
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) return json({ error: 'bad sub' }, 400);
    await env.DB.prepare('INSERT INTO subs (endpoint, json, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json')
      .bind(body.endpoint, JSON.stringify({ endpoint: body.endpoint, keys: body.keys }), now).run();
    if (body.hello) ctx.waitUntil(sendToAll(env, { title: 'Dump', body: 'Reminders are on.', tag: 'hello' }));
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

// ---------- Cron: at most one notification per run ----------
async function nextMessage(env, s, tz, L, now) {
  // 1. A task's due time
  const due = await env.DB.prepare(
    `SELECT * FROM items WHERE kind = 'todo' AND done_at IS NULL AND due_at IS NOT NULL AND reminded_at IS NULL
     AND due_at <= ? AND due_at > ? ORDER BY due_at LIMIT 1`).bind(now, now - 12 * 3600000).first();
  if (due) {
    await env.DB.prepare('UPDATE items SET reminded_at = ? WHERE id = ?').bind(now, due.id).run();
    return { title: 'Now-ish', body: due.text, tag: `due-${due.id}` };
  }

  // 2. Morning nudge (within 3 hours of the time you set)
  const [mh, mmin] = (s.morning || '08:30').split(':').map(Number);
  const mAt = mh * 60 + mmin;
  if (s.morning_date !== L.date && L.minutes >= mAt) {
    await setSetting(env, 'morning_date', L.date);
    if (L.minutes < mAt + 180) {
      const pick = await makePick(env, 'med', tz);
      if (pick.top.length) {
        const { results } = await env.DB.prepare(
          `SELECT id, text FROM items WHERE id IN (${pick.top.map(() => '?').join(',')})`).bind(...pick.top.map((t) => t.id)).all();
        const byId = Object.fromEntries(results.map((r) => [r.id, r.text]));
        const names = pick.top.map((t) => byId[t.id]).filter(Boolean);
        return { title: 'Good morning', body: `Your top 3 today: ${names.join(' · ')}`, tag: 'morning' };
      }
    }
  }

  // 3. One gentle "still want this?" per day, once per task ever
  if (s.stale_date !== L.date) {
    const old = await env.DB.prepare(
      `SELECT * FROM items WHERE kind = 'todo' AND done_at IS NULL AND asked_at IS NULL AND touched_at <= ?
       ORDER BY touched_at LIMIT 1`).bind(now - 5 * DAY).first();
    if (old) {
      await env.DB.prepare('UPDATE items SET asked_at = ?, ask_open = 1 WHERE id = ?').bind(now, old.id).run();
      await setSetting(env, 'stale_date', L.date);
      return { title: 'Still want this?', body: `${old.text}: do it, shrink it, or drop it.`, tag: `stale-${old.id}` };
    }
  }
  return null;
}

export async function tick(env, now = Date.now()) {
  const s = await getSettings(env);
  const tz = safeTz(s.tz);
  const L = localParts(now, tz);
  if (L.minutes >= QUIET_START || L.minutes < QUIET_END) return 'quiet';
  const dayStart = localToUtc(L.date, '00:00', tz);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sent WHERE at >= ?').bind(dayStart).first();
  if (n >= DAILY_MAX) return 'cap';
  const msg = await nextMessage(env, s, tz, L, now);
  if (!msg) return 'nothing';
  await env.DB.prepare('INSERT INTO sent (at, title, body) VALUES (?, ?, ?)').bind(now, msg.title, msg.body).run();
  await sendToAll(env, msg);
  return msg;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return serveStatic(url);
    if (!authed(req, env)) return json({ error: 'bad key' }, 401);
    try {
      return await route(req, env, url, ctx);
    } catch (e) {
      console.log('api error', e.stack);
      return json({ error: 'server' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).then((r) => console.log('tick', JSON.stringify(r))));
  },
};
