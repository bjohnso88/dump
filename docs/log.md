# Work log

Append-only. Newest entries at the bottom.

---

## [2026-11-27] setup | docs/ wiki scaffolded

- Categories: concepts - architecture - subsystems - decisions - reference - operations - history
- Baseline commit: `c74f131`
- Created: `docs/{CLAUDE,index,log}.md`, `raw/`, 4 `.claude/commands/docs-*`,
  and `.claude/scripts/docs-lint.py`

- Started in grow mode. Wrote [[overview]] and [[reminders]] from the v2 code just built (worker/, public/, migrations/). Other areas get pages as work touches them.

## [2026-11-27] deploy | v2 live on dump.bixjohnson.com

- D1 `dump` created and migrated through the Cloudflare API. Worker deployed with wrangler using a token saved as a network secret. VAPID keys set as secrets.
- Switched from Workers Static Assets to bundled files ([[overview]]), because the asset upload's JWT gets overwritten by the proxy.

## [2026-11-27] docs | keys and deploy

- README rewritten around the live setup and all five keys. Added [[deploy-and-keys]].

## [2026-11-27] change | search bar, undoable deletes

- Added a search bar (`renderSearch` in `public/app.js`) across to-dos, ideas and recent done items.
- Removed long-press/right-click delete; swipe now needs a clearly sideways drag. `remove()` hides the item and waits 10 s (Undo in the toast) before the server DELETE; leaving the page sends pending deletes with `keepalive`.

## [2026-11-27] deploy | search + undo live; deleted items found

- Deployed the search bar and undoable deletes. Hold-to-delete is gone from the live app.
- Used D1 Time Travel to find items deleted since v2 went live ([[deploy-and-keys]]). Found 4 deleted to-dos; the database was restored back to its pre-check bookmark and matched the backup.

## [2026-11-27] deploy | pinned add box live; 4 deleted to-dos restored

- Deployed the sticky add box fix.
- Re-inserted the 4 to-dos found with Time Travel (Winter coat, Storage unit, Icloud mcp, Dump can see bix-memory) with their original ids and fields, `INSERT OR IGNORE`. Items: 38 → 42.
