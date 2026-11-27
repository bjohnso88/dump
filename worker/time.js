// Time zone helpers. Cron runs in UTC, so everything "local" goes through here.

export function safeTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const y = +p.year, mo = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute, s = +p.second;
  return {
    y, mo, d, h, mi, s, weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(h).padStart(2, '0')}:${p.minute}`,
    minutes: h * 60 + mi,
  };
}

function offset(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// 'YYYY-MM-DD' + 'HH:MM' in tz -> UTC ms
export function localToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offset(guess, tz);
  let utc = guess - off;
  const off2 = offset(utc, tz);
  if (off2 !== off) utc = guess - off2; // DST edge
  return utc;
}

export const DUE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

// Local due string -> UTC ms (only when it has a time)
export function dueToUtc(due, tz) {
  if (!due || !due.includes('T')) return null;
  const [d, t] = due.split('T');
  return localToUtc(d, t, tz);
}
