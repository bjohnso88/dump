---
title: How Dump fits together
type: architecture
created: 2026-11-27
updated: 2026-11-27
sources:
  - code: wrangler.jsonc
  - code: worker/index.js
  - code: worker/claude.js
  - code: worker/time.js
  - code: migrations/0001_init.sql
  - code: public/app.js
verified_at: 3fe44c9
---

One Cloudflare Worker named `dump` does everything: it serves the app from `public/`
(Workers Static Assets), answers a small JSON API under `/api/*`, and runs the reminder
cron every 5 minutes (`wrangler.jsonc`). Data lives in one D1 database (`migrations/0001_init.sql`):
`items`, `settings` (key/value), `subs` (push subscriptions), `sent` (notification log).
Reminders are on their own page: [[reminders]].

## Auth

Single user, single secret. The Worker secret `AUTH_TOKEN` must match the
`Authorization: Bearer` header on every `/api/*` call (`worker/index.js:14`). The browser
keeps it in `localStorage` under `dump-key`; a 401 clears it and shows the key screen
(`public/app.js:33`).

> ⚠️ The token compare is constant-time on purpose (`worker/index.js:14`). Don't replace it with `===`.

## The app talks to the server optimistically

`public/app.js` changes its local copy first, renders, then calls the API (`change`,
`public/app.js:56`). New items get a client-made UUID and go through a queue in
`localStorage` (`dump-queue`) so a task typed on bad signal is never lost
(`flushQueue`, `public/app.js:80`). The list is re-fetched whenever the app becomes
visible, which is how phone and laptop stay in sync.

> ⚠️ `POST /api/items` is `INSERT OR IGNORE` by id, so retrying a queued add is safe. Keep it idempotent; the queue relies on it.

> ⚠️ v1 kept everything in `localStorage['dump']` on one device. `load()` uploads it once via `/api/import` and renames the key to `dump-v1-backup` (`public/app.js:98`). Don't remove that until every device has opened v2.

## Claude

Three calls, all in `worker/claude.js`, all on `claude-haiku-5-5` with `effort: low`
and a JSON schema output: smart add (due date + size), prioritize (top 3 + first step),
shrink (a smaller version of a stale task). Each returns `null` on any failure and the
caller carries on: no date, or `plainPick` (due soonest, then oldest; `worker/index.js:41`).

> ⚠️ Haiku 5.5 thinks by default and thinking counts toward `max_tokens`, so keep the 2000 cap (`worker/claude.js:6`). A small cap ends in `stop_reason: max_tokens` with no text.

> ⚠️ Smart add only fills blanks (`worker/index.js:111`). It runs after the item is saved, so it must never overwrite a date or size the user already set by hand.

> ⚠️ Prioritize sends items as numbers `1..n`, not ids, and maps them back (`worker/claude.js:69`). Model output is checked against the list; never trust an id from the model.

## Time zones

Due dates are stored as the **local** string the user means (`due`, e.g. `2026-11-28T15:00`)
plus `due_at` in UTC ms only when there is a time. The user's zone is sent by the
browser on every `GET /api/state?tz=` and kept in `settings.tz`. Conversions are in
`worker/time.js`.

> ⚠️ Cron runs in UTC. Anything "local" (quiet hours, morning time, "today") must go through `localParts` / `localToUtc` with `settings.tz`, never `new Date().getHours()` on the server.
