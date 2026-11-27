-- Dump v2 schema. Apply with: npx wrangler d1 migrations apply dump --remote

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'todo',  -- 'todo' | 'idea'
  created_at  INTEGER NOT NULL,              -- ms
  done_at     INTEGER,                       -- ms, null = open
  due         TEXT,                          -- local 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
  due_at      INTEGER,                       -- ms UTC, only when due has a time
  size        TEXT,                          -- 'quick' | 'medium' | 'big'
  touched_at  INTEGER NOT NULL,              -- last time you changed it
  reminded_at INTEGER,                       -- due-time reminder sent
  asked_at    INTEGER,                       -- "still want this?" sent (once ever)
  ask_open    INTEGER NOT NULL DEFAULT 0     -- show Do it / Shrink / Drop in the app
);

CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE subs (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER);

CREATE TABLE sent (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, title TEXT, body TEXT);
CREATE INDEX sent_at ON sent (at);
