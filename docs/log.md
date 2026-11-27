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
