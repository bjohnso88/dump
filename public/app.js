// Dump v2: one box, one list, synced through the Worker (D1).
// A copy of the list is kept in localStorage so the app opens instantly and works on bad signal.

// ---------- Data ----------
// Item: { id, text, kind: 'todo'|'idea', createdAt, doneAt, due: 'YYYY-MM-DD[THH:MM]'|null,
//         size: 'quick'|'medium'|'big'|null, askOpen }
let token = localStorage.getItem('dump-key');
let items = JSON.parse(localStorage.getItem('dump-cache') || '[]');
let queue = JSON.parse(localStorage.getItem('dump-queue') || '[]'); // adds that didn't reach the server yet
let pick = null;          // { top: [{id, why}], firstStep, energy, at }
let morning = '08:30';
let vapidKey = null;
let pushOn = false;
let view = 'todo';
let editing = null;       // id of the item whose gray text is open for fixing
let askEnergy = false;
let busy = false;
let laterOpen = false;   // keep the Later fold open while you edit inside it
const kept = new Set();

function cache() {
  localStorage.setItem('dump-cache', JSON.stringify(items));
  localStorage.setItem('dump-queue', JSON.stringify(queue));
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
const today = () => dayKey(Date.now());
const find = (id) => items.find((i) => i.id === id);

// ---------- Server ----------
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem('dump-key');
    token = null;
    render();
    throw new Error('auth');
  }
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

function merge(item) {
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = item; else items.push(item);
  cache();
}

// Change something now, tell the server in the background.
async function change(item, patch) {
  Object.assign(item, patch, { askOpen: false });
  cache();
  render();
  try { merge(await api('PATCH', '/items/' + encodeURIComponent(item.id), patch)); }
  catch (e) { if (e.message !== 'auth') toast("Couldn't save. Check your signal."); }
}

async function remove(id) {
  items = items.filter((i) => i.id !== id);
  queue = queue.filter((q) => q.id !== id);
  cache();
  try { await api('DELETE', '/items/' + encodeURIComponent(id)); } catch {}
}

async function smart(id, edit = false) {
  try {
    const item = await api('POST', '/items/' + encodeURIComponent(id) + '/smart', edit ? { edit: true } : undefined);
    merge(item);
    render();
  } catch {}
}

let flushing = null;
function flushQueue() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  for (const q of [...queue]) {
    try {
      merge(await api('POST', '/items', q));
      queue = queue.filter((x) => x.id !== q.id);
      cache();
      if (q.kind === 'todo') smart(q.id);
    } catch { return; }
  }
}

async function load() {
  if (!token) return render();
  // One-time move of v1 data (it lived only in this browser).
  const v1 = localStorage.getItem('dump');
  if (v1) {
    try {
      await api('POST', '/import', { items: JSON.parse(v1) });
      localStorage.setItem('dump-v1-backup', v1);
      localStorage.removeItem('dump');
    } catch {}
  }
  await flushQueue();
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const s = await api('GET', '/state?tz=' + encodeURIComponent(tz));
    items = s.items;
    for (const q of queue) if (!find(q.id)) items.push({ ...q, doneAt: null, due: null, size: null });
    pick = s.pick && dayKey(s.pick.at) === today() ? s.pick : null;
    morning = s.morning;
    vapidKey = s.vapidKey;
    cache();
  } catch {}
  await checkPush();
  render();
}

// ---------- Little helpers ----------
const $ = (sel) => document.querySelector(sel);
const box = $('#box');

const NICE = ['Nice job.', 'Done!', 'One less thing.', 'Look at you go.', 'Nice.', 'Handled.'];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(label, onClick, cls) {
  const b = el('button', cls, label);
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

const heading = (text) => el('h2', '', text);
const empty = (text) => el('p', 'empty', text);

function dueLabel(due) {
  if (!due) return '';
  const [d, t] = due.split('T');
  const date = new Date(d + 'T00:00');
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const diff = Math.round((date - start) / 86400000);
  let label = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday'
    : diff > 1 && diff < 7 ? date.toLocaleDateString(undefined, { weekday: 'short' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (t) {
    const [h, m] = t.split(':').map(Number);
    label += ' ' + (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm');
  }
  return label;
}

// The small gray "tomorrow 3pm · quick" line. Tapping it (or the task) opens the edit panel.
function meta(item) {
  const text = [dueLabel(item.due), item.size].filter(Boolean).join(' · ');
  const m = el('span', 'meta' + (text ? '' : ' faint'), text || 'add date');
  return m;
}

// Update without re-rendering (used while typing, so taps on the panel's buttons still land).
async function quietChange(item, patch) {
  Object.assign(item, patch, { askOpen: false });
  cache();
  try { merge(await api('PATCH', '/items/' + encodeURIComponent(item.id), patch)); }
  catch (e) { if (e.message !== 'auth') toast("Couldn't save. Check your signal."); }
}

const close = () => { editing = null; render(); };

// The panel that opens when you tap a task or idea.
function editor(item) {
  const ed = el('div', 'editor');
  ed.onclick = (e) => e.stopPropagation();

  const text = el('input', 'edit-text');
  text.value = item.text;
  text.enterKeyHint = 'done';
  text.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } };
  text.onblur = () => {
    const v = text.value.trim();
    if (!v || v === item.text) return;
    // Save, then re-read the new wording for a deadline ("...by friday").
    quietChange(item, { text: v }).then(() => { if (item.kind === 'todo') smart(item.id, true); });
    const span = text.closest('li')?.querySelector('.text');
    if (span) span.textContent = v;
  };
  ed.append(text);

  if (item.kind === 'todo') {
    const when = el('div', 'row');
    const [d, t] = (item.due || '').split('T');
    const date = el('input'); date.type = 'date'; date.value = d || '';
    const time = el('input'); time.type = 'time'; time.value = t || '';
    const save = () => change(item, { due: date.value ? (time.value ? date.value + 'T' + time.value : date.value) : null });
    date.onchange = save;
    time.onchange = () => { if (!date.value) date.value = new Date().toLocaleDateString('en-CA'); save(); };
    when.append(date, time, button('No date', () => change(item, { due: null })));
    ed.append(when);

    const sizes = el('div', 'row');
    for (const s of ['quick', 'medium', 'big']) {
      sizes.append(button(s, () => change(item, { size: s }), item.size === s ? 'picked' : ''));
    }
    ed.append(sizes);
  }

  const acts = el('div', 'row');
  if (item.kind === 'todo') {
    acts.append(
      button(item.doneAt ? 'Not done' : 'Mark done', () => { editing = null; toggleDone(item); }),
      button('→ Idea', () => { editing = null; change(item, { kind: 'idea' }); toast('Moved to ideas.'); }),
    );
  } else {
    acts.append(button('→ To-do', () => {
      editing = null; change(item, { kind: 'todo' }); smart(item.id); toast('Moved to to-dos.');
    }));
  }
  acts.append(
    button('Delete', () => { editing = null; remove(item.id); toast('Gone.'); render(); }, 'danger'),
    button('Close', close),
  );
  ed.append(acts);
  return ed;
}

function toggleDone(item) {
  const doneAt = item.doneAt ? null : Date.now();
  if (doneAt) toast(NICE[Math.floor(Math.random() * NICE.length)]);
  change(item, { doneAt });
}

// A row. Circle = done, tap the task = edit panel, swipe/hold = delete.
function li(item, buttons = [], opts = {}) {
  const e = el('li');
  e.dataset.id = item.id;
  if (item.doneAt) e.classList.add('done');
  if (editing === item.id) e.classList.add('open');
  if (item.kind === 'todo' && !opts.plain) e.append(button(item.doneAt ? '✓' : '', () => toggleDone(item), 'check'));
  const body = el('div', 'body');
  body.append(el('span', 'text', item.text));
  if (opts.why) body.append(el('span', 'why', opts.why));
  if (opts.step) body.append(el('span', 'step', 'First step: ' + opts.step));
  if (item.kind === 'todo' && !item.doneAt && !opts.plain) body.append(meta(item));
  e.append(body, ...buttons);
  if (editing === item.id && !opts.plain) e.append(editor(item));
  if (!opts.plain) e.onclick = () => { editing = editing === item.id ? null : item.id; render(); };
  return e;
}

function todoRow(item, opts) {
  const e = li(item, [], opts);
  makeDeletable(e, item.id);
  return e;
}

// ---------- Swipe left or long-press to delete ----------
function makeDeletable(e, id) {
  let startX = 0, dx = 0, timer = null, gesture = false, skip = false;

  e.addEventListener('touchstart', (ev) => {
    skip = !!ev.target.closest('.editor, button');
    if (skip) return;
    startX = ev.touches[0].clientX;
    dx = 0;
    gesture = false;
    timer = setTimeout(() => { gesture = true; del(); }, 600);
  }, { passive: true });

  e.addEventListener('touchmove', (ev) => {
    if (skip) return;
    dx = ev.touches[0].clientX - startX;
    if (Math.abs(dx) > 10) clearTimeout(timer);
    if (dx < 0) e.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  e.addEventListener('touchend', () => {
    if (skip) return;
    clearTimeout(timer);
    if (dx < -80) { gesture = true; del(); }
    else e.style.transform = '';
  });

  e.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest('.editor')) return;
    ev.preventDefault(); gesture = true; del();
  });

  e.addEventListener('click', (ev) => {
    if (gesture) { ev.stopImmediatePropagation(); gesture = false; }
  }, true);

  function del() {
    e.style.opacity = '0';
    e.style.transform = 'translateX(-100%)';
    setTimeout(() => { remove(id); render(); }, 150);
    toast('Gone.');
  }
}

// ---------- Views ----------
function staleCards(main) {
  for (const item of items.filter((i) => i.askOpen && !i.doneAt && i.kind === 'todo')) {
    const card = el('div', 'card');
    card.append(el('p', 'ask', 'Still want this?'), el('p', 'card-text', item.text));
    const row = el('div', 'row');
    row.append(
      button('Do it', () => { change(item, {}); toast('Okay. It stays.'); }),
      button('Shrink', async () => {
        toast('Shrinking…');
        try { merge(await api('POST', '/items/' + encodeURIComponent(item.id) + '/shrink')); toast('Smaller now.'); }
        catch { toast("Couldn't shrink it right now."); }
        render();
      }),
      button('Drop', () => { remove(item.id); toast('Dropped. No guilt.'); render(); }),
    );
    card.append(row);
    main.append(card);
  }
}

function prioritizeBar(main) {
  const bar = el('div', 'row bar');
  if (busy) {
    bar.append(el('span', 'muted', 'Thinking…'));
  } else if (askEnergy) {
    bar.append(el('span', 'muted', 'Energy?'));
    for (const [label, energy] of [['low', 'low'], ['med', 'med'], ['high', 'high']]) {
      bar.append(button(label, async () => {
        askEnergy = false; busy = true; render();
        try { pick = await api('POST', '/prioritize', { energy }); }
        catch { toast("Couldn't prioritize right now."); }
        busy = false; render();
      }));
    }
  } else {
    bar.append(button('Prioritize', () => { askEnergy = true; render(); }, 'wide'));
    if (pick) bar.append(button('Show all', () => { pick = null; api('POST', '/pick/clear').catch(() => {}); render(); }));
  }
  main.append(bar);
}

function footer(main) {
  const f = el('div', 'foot');
  f.append(el('span', '', 'Morning nudge '));
  const t = el('input'); t.type = 'time'; t.value = morning; t.min = '08:00'; t.max = '21:59';
  t.onchange = async () => {
    if (!t.value) return;
    morning = t.value;
    try { await api('POST', '/settings', { morning }); toast('Got it.'); } catch { toast("Couldn't save."); }
  };
  f.append(t);
  if (!pushOn) f.append(button('Turn on reminders', enablePush));
  main.append(f);
}

function renderTodo(main) {
  const list = items.filter((i) =>
    i.kind === 'todo' && (!i.doneAt || dayKey(i.doneAt) === today()));

  staleCards(main);
  if (list.some((i) => !i.doneAt)) prioritizeBar(main);

  if (!list.length) {
    main.append(empty('Nothing here. Type something up top.'));
    return footer(main);
  }

  const open = list.filter((i) => !i.doneAt);
  const done = list.filter((i) => i.doneAt);
  const topItems = pick ? pick.top.map((t) => ({ ...t, item: find(t.id) })).filter((t) => t.item) : [];

  if (topItems.length) {
    main.append(heading('Right now'));
    const ul = el('ul');
    topItems.forEach((t, n) => ul.append(todoRow(t.item, { why: t.why, step: n === 0 && !t.item.doneAt ? pick.firstStep : '' })));
    main.append(ul);
    const later = open.filter((i) => !pick.top.some((t) => t.id === i.id));
    if (later.length) {
      const det = el('details');
      det.open = laterOpen || later.some((i) => i.id === editing);
      det.ontoggle = () => { laterOpen = det.open; };
      det.append(el('summary', '', `Later (${later.length})`));
      const lu = el('ul');
      later.forEach((i) => lu.append(todoRow(i)));
      det.append(lu);
      main.append(det);
    }
    const doneRest = done.filter((i) => !pick.top.some((t) => t.id === i.id));
    if (doneRest.length) {
      const du = el('ul');
      doneRest.forEach((i) => du.append(todoRow(i)));
      main.append(du);
    }
  } else {
    const ul = el('ul');
    [...open, ...done].forEach((i) => ul.append(todoRow(i)));
    main.append(ul);
  }
  main.append(el('p', 'hint', 'Circle = done · tap a task to edit · swipe left = delete'));
  footer(main);
}

function renderIdeas(main) {
  const list = items.filter((i) => i.kind === 'idea');
  if (!list.length) return main.append(empty('No ideas yet. Start with "idea:" to save one.'));

  const ul = el('ul');
  for (const item of list) {
    const e = li(item);
    makeDeletable(e, item.id);
    ul.append(e);
  }
  main.append(ul);
}

function renderWeek(main) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const done = items
    .filter((i) => i.doneAt && i.doneAt > weekAgo)
    .sort((a, b) => b.doneAt - a.doneAt);

  if (!done.length) return main.append(empty('Things you finish will show up here.'));

  let lastDay = null, ul;
  for (const item of done) {
    const day = dayKey(item.doneAt);
    if (day !== lastDay) {
      const label = day === today() ? 'Today'
        : new Date(item.doneAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      main.append(heading(label));
      ul = el('ul');
      main.append(ul);
      lastDay = day;
    }
    ul.append(li(item, [], { plain: true }));
  }
}

function renderWrap(main) {
  const wins = items.filter((i) => i.doneAt && dayKey(i.doneAt) === today());
  const left = items.filter((i) => i.kind === 'todo' && !i.doneAt);

  main.append(heading('Done today'));
  if (wins.length) {
    const ul = el('ul');
    wins.forEach((i) => ul.append(li(i, [], { plain: true })));
    main.append(ul);
  } else {
    main.append(empty('Rest days count too.'));
  }

  main.append(heading('Still open'));
  if (!left.length) return main.append(empty('All clear. Go enjoy your evening.'));

  const ul = el('ul');
  for (const item of left) {
    const keep = button('Keep', () => {
      kept.add(item.id);
      keep.classList.add('picked');
      api('PATCH', '/items/' + encodeURIComponent(item.id), {}).catch(() => {});
    }, kept.has(item.id) ? 'picked' : '');
    const drop = button('Drop', () => { remove(item.id); render(); });
    ul.append(li(item, [keep, drop], { plain: true }));
  }
  main.append(ul);
  main.append(button("I'm done for today", () => {
    toast('Good work today.');
    setView('todo');
  }, 'big'));
}

function renderKey(main) {
  const f = el('form', 'keyform');
  f.append(el('p', '', 'Paste your Dump key once on this device.'));
  const input = el('input'); input.type = 'password'; input.placeholder = 'Key'; input.autocomplete = 'off';
  f.append(input, el('button', 'big', 'Unlock'));
  f.onsubmit = (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    token = input.value.trim();
    localStorage.setItem('dump-key', token);
    load();
  };
  main.append(f);
}

function render() {
  const main = $('#view');
  main.innerHTML = '';
  if (!token) return renderKey(main);
  ({ todo: renderTodo, ideas: renderIdeas, week: renderWeek, wrap: renderWrap })[view](main);
}

function setView(v) {
  view = v;
  editing = null;
  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === v));
  render();
}

// ---------- Reminders (web push) ----------
function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function checkPush() {
  pushOn = false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    pushOn = true;
    api('POST', '/push/subscribe', sub.toJSON()).catch(() => {}); // keep the server's copy fresh
  }
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return toast(ios ? 'On iPhone: Share → Add to Home Screen, then open Dump from there.' : "This browser can't do reminders.");
  }
  if (!vapidKey) return toast('Reminders are not set up on the server yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Okay, reminders stay off.');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    await api('POST', '/push/subscribe', { ...sub.toJSON(), hello: true });
    pushOn = true;
    toast('Reminders on.');
  } catch {
    toast("Couldn't turn reminders on.");
  }
  render();
}

// ---------- Wiring ----------
$('#add').onsubmit = (e) => {
  e.preventDefault();
  let text = box.value.trim();
  if (!text || !token) return;

  let kind = 'todo';
  if (/^idea:/i.test(text)) {
    kind = 'idea';
    text = text.slice(5).trim();
    if (!text) return;
  }

  const item = { id: crypto.randomUUID(), text, kind, createdAt: Date.now() };
  items.push({ ...item, doneAt: null, due: null, size: null, askOpen: false });
  queue.push(item);
  cache();
  box.value = '';
  toast(kind === 'idea' ? 'Saved to ideas.' : 'Got it.');
  render();
  box.focus();
  flushQueue().then(render);
};

document.querySelectorAll('nav button').forEach((b) =>
  b.onclick = () => { setView(b.dataset.view); box.focus(); });

// Pick up changes from your other device when you come back to the app.
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
window.addEventListener('online', () => load());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

render();
load();
box.focus();
