// The three quiet Claude calls. Every one returns null on any problem, and the app carries on.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-5-5'; // cheap + fast

async function ask(env, system, user, schema) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20000 });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000, // thinking counts toward this; low effort keeps it short
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason !== 'end_turn') {
      console.log('claude stop', res.stop_reason);
      return null;
    }
    const text = res.content.find((b) => b.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.log('claude api error', e.status, e.message);
    else console.log('claude error', e.message);
    return null;
  }
}

const obj = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

// ---- 1. Smart add ----
const SMART_SYSTEM = `You read one to-do item and quietly pull out a due date/time and a rough size. Reply only with the JSON.

due_date: the day the person mentioned, as YYYY-MM-DD, worked out from the current local date below. Empty string if they gave no day, date or time.
- "today", "tonight", "this afternoon" = today. "tomorrow" = the next day.
- A bare weekday ("friday") = the next one coming; today only if it is that weekday and the time has not passed.
- "next week" = next Monday. "this weekend" = the coming Saturday.
- A time with no day = today if that time is still ahead, otherwise tomorrow.
due_time: 24-hour HH:MM if they gave a time ("3pm" = 15:00, "noon" = 12:00, "morning" = 09:00, "tonight" = 19:00, "eod" = 17:00). Empty string otherwise. Never set due_time without due_date.
size: quick (under ~15 minutes), medium (under ~2 hours), big (longer or many steps). Always guess one.`;

export async function smartParse(env, text, L, tz) {
  const out = await ask(env, SMART_SYSTEM,
    `Now: ${L.weekday} ${L.date} ${L.time} (${tz})\nItem: ${text}`,
    obj({
      due_date: { type: 'string' },
      due_time: { type: 'string' },
      size: { type: 'string', enum: ['quick', 'medium', 'big'] },
    }));
  if (!out) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(out.due_date) ? out.due_date : '';
  const time = date && /^\d{2}:\d{2}$/.test(out.due_time) ? out.due_time : '';
  return {
    due: date ? (time ? `${date}T${time}` : date) : null,
    size: ['quick', 'medium', 'big'].includes(out.size) ? out.size : null,
  };
}

// ---- 2. Prioritize ----
const PICK_SYSTEM = `You help someone with ADHD pick what to do right now. Pick the top 3 from their open to-dos (fewer if the list is shorter), best first.
Weigh: due dates (overdue and due today come first), how long things have been sitting, and size against their energy (low energy: quick, easy things; high energy: a big one is fine).
why: one short line, at most 8 words, plain and kind, no exclamation marks.
first_step: one tiny physical first step for the #1 pick, at most 10 words, starting with a verb.
Use the item numbers you are given. Reply only with the JSON.`;

export async function prioritize(env, list, energy, L, tz) {
  if (!list.length) return null;
  const now = Date.now();
  const lines = list.map((it, i) => {
    const bits = [it.text];
    if (it.due) bits.push(`due ${it.due.replace('T', ' ')}`);
    if (it.size) bits.push(it.size);
    bits.push(`sitting ${Math.floor((now - it.created_at) / 86400000)} days`);
    return `${i + 1}. ${bits.join(' | ')}`;
  });
  const out = await ask(env, PICK_SYSTEM,
    `Now: ${L.weekday} ${L.date} ${L.time} (${tz})\nEnergy: ${energy}\n\n${lines.join('\n')}`,
    obj({
      top: { type: 'array', items: obj({ n: { type: 'integer' }, why: { type: 'string' } }) },
      first_step: { type: 'string' },
    }));
  if (!out) return null;
  const seen = new Set();
  const top = [];
  for (const t of out.top || []) {
    const it = list[t.n - 1];
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    top.push({ id: it.id, why: String(t.why || '').slice(0, 80) });
    if (top.length === 3) break;
  }
  return top.length ? { top, firstStep: String(out.first_step || '').slice(0, 100) } : null;
}

// ---- 3. Shrink ----
const SHRINK_SYSTEM = `Rewrite this to-do as a much smaller version that takes under 10 minutes and still moves it forward. At most 8 words, start with a verb, keep the person's words where you can. Reply only with the JSON.`;

export async function shrink(env, text) {
  const out = await ask(env, SHRINK_SYSTEM, text, obj({ text: { type: 'string' } }));
  const t = out?.text?.trim();
  return t ? t.slice(0, 200) : null;
}
