// Built-in deadline reader: finds a day and/or time in plain text, no Claude needed.
// "call dentist tomorrow 3pm", "rent due 12/1", "report by friday", "pay bill dec 5th", "in 3 days".
// Returns 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' in the user's local time, or null.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WD_FULL = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
const WD_SHORT = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)';
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

// L = localParts(now, tz) from time.js
export function readDeadline(text, L) {
  const s = ' ' + text.toLowerCase().replace(/[,]/g, ' ') + ' ';
  const today = Date.UTC(L.y, L.mo - 1, L.d);
  const plus = (n) => today + n * 86400000;
  const todayDow = DAYS.indexOf(L.weekday.toLowerCase().slice(0, 3));

  // ---- time ----
  let time = null;
  let m;
  if ((m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W)/))) {
    let h = +m[1] % 12;
    if (m[3][0] === 'p') h += 12;
    if (+m[1] <= 12 && +(m[2] || 0) < 60) time = `${pad(h)}:${m[2] || '00'}`;
  } else if ((m = s.match(/\b(?:at|@)\s*(\d{1,2}):(\d{2})\b/)) && +m[1] < 24 && +m[2] < 60) {
    time = `${pad(+m[1])}:${m[2]}`;
  } else if (/\bnoon\b/.test(s)) time = '12:00';
  else if (/\b(eod|end of (the )?day|close of business|cob)\b/.test(s)) time = '17:00';
  else if (/\btonight\b|\bthis evening\b/.test(s)) time = '19:00';
  else if (/\b(this|in the|tomorrow) morning\b/.test(s)) time = '09:00';
  else if (/\b(this|in the|tomorrow) afternoon\b/.test(s)) time = '15:00';

  // ---- day ----
  let day = null;
  const y = L.y;
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  } else if ((m = s.match(/\b(day after tomorrow)\b/))) {
    day = plus(2);
  } else if (/\b(tomorrow|tmrw|tmr|tomorow|tommorow)\b/.test(s)) {
    day = plus(1);
  } else if (/\b(today|tonight|this (morning|afternoon|evening)|eod|end of (the )?day)\b/.test(s)) {
    day = today;
  } else if ((m = s.match(/\bin (\d{1,3}|a|an|one|two|three|a couple of) (day|days|week|weeks)\b/))) {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, 'a couple of': 2 };
    const n = words[m[1]] ?? +m[1];
    day = plus(m[2].startsWith('week') ? n * 7 : n);
  } else if (/\bnext week\b/.test(s)) {
    day = plus(((8 - todayDow) % 7) || 7); // next Monday
  } else if (/\b(this weekend|the weekend|weekend)\b/.test(s)) {
    day = plus((6 - todayDow + 7) % 7); // Saturday
  } else if (/\b(end of (the )?week)\b/.test(s)) {
    day = plus((5 - todayDow + 7) % 7); // Friday
  } else if (/\b(end of (the )?month)\b/.test(s)) {
    day = Date.UTC(y, L.mo, 0);
  } else if ((m = s.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`)))) {
    day = monthDay(MONTHS.indexOf(m[1].slice(0, 3)), +m[2], m[3]);
  } else if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?:\\s+(\\d{4}))?\\b`)))) {
    day = monthDay(MONTHS.indexOf(m[2].slice(0, 3)), +m[1], m[3]);
  } else if ((m = s.match(/(?:^|[\s(])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=[\s).]|$)/))) {
    day = monthDay(+m[1] - 1, +m[2], m[3] && (m[3].length === 2 ? '20' + m[3] : m[3]));
  } else if ((m = s.match(new RegExp(`\\b${WD_FULL}\\b`)) || s.match(new RegExp(`\\b(?:next|this|on|by|due|till|until) ${WD_SHORT}\\.?(?=\\W)`)))) {
    // Full day names anywhere; short ones ("fri") only after on/by/next/... so "the sun" isn't Sunday.
    const want = DAYS.indexOf(m[1].slice(0, 3));
    let n = (want - todayDow + 7) % 7;
    if (n === 0) {
      // Same weekday as today: today only if a time later today was given.
      n = time && time > L.time ? 0 : 7;
    }
    day = plus(n);
  }

  function monthDay(mon, d, year) {
    if (mon < 0 || d < 1 || d > 31 || mon > 11) return null;
    let t = Date.UTC(year ? +year : y, mon, d);
    if (!year && t < today) t = Date.UTC(y + 1, mon, d); // already passed this year
    return t;
  }

  if (day == null && time) {
    // A time with no day: today if it's still ahead, otherwise tomorrow.
    day = time > L.time ? today : plus(1);
  }
  if (day == null || Number.isNaN(day)) return null;
  return time ? `${ymd(day)}T${time}` : ymd(day);
}
