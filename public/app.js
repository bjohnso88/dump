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
let query = '';          // what's typed in the search bar
const pendingDel = new Map(); // id -> { item, index, queued, timer }: deleted but still undoable
const UNDO_MS = 10000;   // how long a toast with Undo stays up

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
async function api(method, path, body, keepalive = false) {
  const res = await fetch('/api' + path, {
    method,
    keepalive,
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

// Deleting hides the item right away but only tells the server after a few seconds,
// so the Undo in the toast can bring it back exactly as it was.
function remove(id, msg = 'Deleted.') {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return;
  const item = items[index];
  const queued = queue.find((q) => q.id === id) || null;
  items.splice(index, 1);
  queue = queue.filter((q) => q.id !== id);
  if (editing === id) editing = null;
  cache();
  const timer = setTimeout(() => commitDelete(id), UNDO_MS);
  pendingDel.set(id, { item, index, queued, timer });
  toast(msg, { label: 'Undo', fn: () => undoDelete(id) });
}

function undoDelete(id) {
  const p = pendingDel.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingDel.delete(id);
  items.splice(Math.min(p.index, items.length), 0, p.item);
  if (p.queued) queue.push(p.queued);
  cache();
  toast('Back.');
  render();
  if (p.queued) flushQueue().then(render);
}

function commitDelete(id, leaving = false) {
  const p = pendingDel.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingDel.delete(id);
  api('DELETE', '/items/' + encodeURIComponent(id), undefined, leaving).catch(() => {});
}

async function smart(id) {
  try {
    const item = await api('POST', '/items/' + encodeURIComponent(id) + '/smart');
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
    if (!queue.some((x) => x.id === q.id)) continue; // deleted while we were busy
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
    items = s.items.filter((i) => !pendingDel.has(i.id));
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

// action: optional { label, fn } shown as a button in the toast (used for Undo).
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('act', !!action);
  if (action) {
    const b = el('button', '', action.label);
    b.onclick = (e) => { e.stopPropagation(); t.classList.remove('show', 'act'); action.fn(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show', 'act'), action ? UNDO_MS : 3500);
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
    quietChange(item, { text: v });
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
      button('→ Idea', () => { editing = null; undoable(item, { kind: 'idea' }, 'Moved to ideas.'); }),
    );
  } else {
    acts.append(button('→ To-do', () => {
      editing = null; undoable(item, { kind: 'todo' }, 'Moved to to-dos.'); smart(item.id);
    }));
  }
  acts.append(
    button('Delete', () => { remove(item.id); render(); }, 'danger'),
    button('Close', close),
  );
  ed.append(acts);
  return ed;
}

// Change an item and offer Undo in the toast, which puts the changed fields back.
function undoable(item, patch, msg) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k] ?? null]));
  change(item, patch);
  toast(msg, { label: 'Undo', fn: () => {
    const now = find(item.id);
    if (now) { change(now, before); toast('Undone.'); }
  } });
}

function toggleDone(item) {
  if (item.doneAt) return undoable(item, { doneAt: null }, 'Back on the list.');
  undoable(item, { doneAt: Date.now() }, NICE[Math.floor(Math.random() * NICE.length)]);
}

// A row. Circle = done, tap the task = edit panel, swipe left = delete (with Undo).
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

// ---------- Swipe left to delete ----------
// Only a deliberate sideways swipe counts: scrolling, holding or resting a thumb on a row does nothing.
// Every delete can be undone from the toast for a few seconds.
function makeDeletable(e, id) {
  let startX = 0, startY = 0, dx = 0, mode = null, skip = false, swiped = false;

  e.addEventListener('touchstart', (ev) => {
    skip = !!ev.target.closest('.editor, button');
    if (skip) return;
    startX = ev.touches[0].clientX;
    startY = ev.touches[0].clientY;
    dx = 0;
    mode = null; // decided on first real movement: 'swipe' or 'scroll'
  }, { passive: true });

  e.addEventListener('touchmove', (ev) => {
    if (skip || mode === 'scroll') return;
    const x = ev.touches[0].clientX - startX;
    const y = ev.touches[0].clientY - startY;
    if (!mode) {
      if (Math.abs(x) < 12 && Math.abs(y) < 12) return;
      mode = Math.abs(x) > Math.abs(y) * 2 && x < 0 ? 'swipe' : 'scroll';
      if (mode === 'scroll') { e.style.transform = ''; return; }
    }
    dx = Math.min(0, x);
    e.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  const end = () => {
    if (skip) return;
    if (mode === 'swipe' && dx < -120) { swiped = true; del(); }
    else e.style.transform = '';
    mode = null;
  };
  e.addEventListener('touchend', end);
  e.addEventListener('touchcancel', () => { e.style.transform = ''; mode = null; });

  e.addEventListener('click', (ev) => {
    if (swiped) { ev.stopImmediatePropagation(); swiped = false; }
  }, true);

  function del() {
    e.style.opacity = '0';
    e.style.transform = 'translateX(-100%)';
    setTimeout(() => { remove(id); render(); }, 150);
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
      button('Drop', () => { remove(item.id, 'Dropped. No guilt.'); render(); }),
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
  main.append(el('p', 'hint', 'Circle = done · tap a task to edit · swipe left = delete (you can undo)'));
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
    const drop = button('Drop', () => { remove(item.id, 'Dropped.'); render(); });
    ul.append(li(item, [keep, drop], { plain: true }));
  }
  main.append(ul);
  main.append(button("I'm done for today", () => {
    toast('Good work today.');
    setView('todo');
  }, 'big'));
}

// Search across to-dos and ideas (open, and done ones the app still has: the last week or so).
function renderSearch(main) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter((i) => words.every((w) => i.text.toLowerCase().includes(w)));
  if (!hits.length) return main.append(empty(`Nothing matches "${query}".`));
  const groups = [
    ['To-do', hits.filter((i) => i.kind === 'todo' && !i.doneAt)],
    ['Ideas', hits.filter((i) => i.kind === 'idea')],
    ['Done', hits.filter((i) => i.kind === 'todo' && i.doneAt).sort((a, b) => b.doneAt - a.doneAt)],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    main.append(heading(label));
    const ul = el('ul');
    list.forEach((i) => ul.append(todoRow(i)));
    main.append(ul);
  }
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
  if (query.trim()) return renderSearch(main);
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

const search = $('#search');
search.oninput = () => { query = search.value; editing = null; render(); };
search.onkeydown = (e) => { if (e.key === 'Escape') { search.value = ''; search.oninput(); } };

document.querySelectorAll('nav button').forEach((b) =>
  b.onclick = () => { search.value = ''; query = ''; setView(b.dataset.view); box.focus(); });

// Leaving the app finishes any deletes still waiting on Undo.
window.addEventListener('pagehide', () => { for (const id of [...pendingDel.keys()]) commitDelete(id, true); });

// Pick up changes from your other device when you come back to the app.
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
window.addEventListener('online', () => load());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

render();
load();
box.focus();
