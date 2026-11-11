// Dump: one box, one list. Everything is saved in localStorage on this phone.

// ---------- Data ----------
// Each item: { id, text, kind: 'todo' | 'idea', doneAt: timestamp or null }
let items = JSON.parse(localStorage.getItem('dump') || '[]');
let view = 'todo';
const kept = new Set(); // wrap-up items you tapped Keep on (just for this screen)

function save() {
  localStorage.setItem('dump', JSON.stringify(items));
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
const today = () => dayKey(Date.now());

// ---------- Little helpers ----------
const $ = (sel) => document.querySelector(sel);
const box = $('#box');

const NICE = ['Nice job.', 'Done!', 'One less thing.', 'Look at you go.', 'Nice.', 'Handled.'];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1500);
}

function li(item, buttons = []) {
  const el = document.createElement('li');
  el.dataset.id = item.id;
  if (item.doneAt) el.classList.add('done');
  const span = document.createElement('span');
  span.className = 'text';
  span.textContent = item.text;
  el.append(span, ...buttons);
  return el;
}

function button(label, onClick, cls) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

function heading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function empty(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

function remove(id) {
  items = items.filter((i) => i.id !== id);
  save();
}

// ---------- Swipe left or long-press to delete ----------
function makeDeletable(el, id) {
  let startX = 0, dx = 0, timer = null, gesture = false;

  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    dx = 0;
    gesture = false;
    timer = setTimeout(() => { gesture = true; del(); }, 600);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 10) clearTimeout(timer);
    if (dx < 0) el.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  el.addEventListener('touchend', () => {
    clearTimeout(timer);
    if (dx < -80) { gesture = true; del(); }
    else el.style.transform = '';
  });

  // Desktop: right-click deletes.
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); gesture = true; del(); });

  // Swallow the tap that follows a swipe/long-press.
  el.addEventListener('click', (e) => {
    if (gesture) { e.stopImmediatePropagation(); gesture = false; }
  }, true);

  function del() {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-100%)';
    setTimeout(() => { remove(id); render(); }, 150);
    toast('Gone.');
  }
}

// ---------- Views ----------
function renderTodo(main) {
  // Show open to-dos, plus anything finished today (so you see your wins).
  const list = items.filter((i) =>
    i.kind === 'todo' && (!i.doneAt || dayKey(i.doneAt) === today()));

  if (!list.length) return main.append(empty('Nothing here. Type something up top.'));

  const ul = document.createElement('ul');
  // Open items first, done items at the bottom.
  list.sort((a, b) => !!a.doneAt - !!b.doneAt);
  for (const item of list) {
    const el = li(item);
    el.onclick = () => {
      item.doneAt = item.doneAt ? null : Date.now();
      save();
      if (item.doneAt) toast(NICE[Math.floor(Math.random() * NICE.length)]);
      render();
    };
    makeDeletable(el, item.id);
    ul.append(el);
  }
  main.append(ul);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Tap = done · swipe left or hold = delete';
  main.append(hint);
}

function renderIdeas(main) {
  const list = items.filter((i) => i.kind === 'idea');
  if (!list.length) return main.append(empty('No ideas yet. Start with "idea:" to save one.'));

  const ul = document.createElement('ul');
  for (const item of list) {
    const el = li(item, [button('→ To-do', () => {
      item.kind = 'todo';
      save();
      toast('Moved to to-dos.');
      render();
    })]);
    makeDeletable(el, item.id);
    ul.append(el);
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
      ul = document.createElement('ul');
      main.append(ul);
      lastDay = day;
    }
    ul.append(li(item));
  }
}

function renderWrap(main) {
  const wins = items.filter((i) => i.doneAt && dayKey(i.doneAt) === today());
  const left = items.filter((i) => i.kind === 'todo' && !i.doneAt);

  main.append(heading('Done today'));
  if (wins.length) {
    const ul = document.createElement('ul');
    wins.forEach((i) => ul.append(li(i)));
    main.append(ul);
  } else {
    main.append(empty('Rest days count too.'));
  }

  main.append(heading('Still open'));
  if (!left.length) return main.append(empty('All clear. Go enjoy your evening.'));

  const ul = document.createElement('ul');
  for (const item of left) {
    const keep = button('Keep', () => { kept.add(item.id); keep.classList.add('picked'); },
      kept.has(item.id) ? 'picked' : '');
    const drop = button('Drop', () => { remove(item.id); render(); });
    ul.append(li(item, [keep, drop]));
  }
  main.append(ul);
  main.append(button("I'm done for today", () => {
    toast('Good work today.');
    setView('todo');
  }, 'big'));
}

function render() {
  const main = $('#view');
  main.innerHTML = '';
  ({ todo: renderTodo, ideas: renderIdeas, week: renderWeek, wrap: renderWrap })[view](main);
}

function setView(v) {
  view = v;
  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === v));
  render();
}

// ---------- Wiring ----------
$('#add').onsubmit = (e) => {
  e.preventDefault();
  let text = box.value.trim();
  if (!text) return;

  let kind = 'todo';
  if (/^idea:/i.test(text)) {
    kind = 'idea';
    text = text.slice(5).trim();
    if (!text) return;
  }

  items.push({ id: Date.now() + Math.random(), text, kind, doneAt: null });
  save();
  box.value = '';
  toast(kind === 'idea' ? 'Saved to ideas.' : 'Got it.');
  render();
  box.focus();
};

document.querySelectorAll('nav button').forEach((b) =>
  b.onclick = () => { setView(b.dataset.view); box.focus(); });

render();
box.focus();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
