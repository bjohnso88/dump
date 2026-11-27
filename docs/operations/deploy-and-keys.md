---
title: Deploy and keys
type: operation
created: 2026-11-27
updated: 2026-11-27
sources:
  - code: README.md
  - code: wrangler.jsonc
  - code: scripts/vapid.mjs
  - code: worker/index.js
verified_at: f1415f4
---

The user-facing steps (dashboard clicks, devices, rotating keys) are in the repository
`README.md`. This page holds what an agent needs to deploy without breaking things.
How the app is put together: [[overview]]. Push details: [[reminders]].

## Deploying from a cloud session

Use the cloud environment named **dump**. It has a Cloudflare API token saved as a network secret
for `api.cloudflare.com` (Workers Scripts, Workers Routes on bixjohnson.com, D1, Account Settings).
Run wrangler with placeholders; the proxy swaps in the real token:

`CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=e9bd30b479e4e0b5fd5b0b1ee9dc6367 npx wrangler deploy`

> ⚠️ Don't switch back to Workers Static Assets (an `assets` block in `wrangler.jsonc`). Its upload step uses its own one-time JWT in `Authorization`, which the proxy overwrites with the saved token, and the deploy fails with 401. See [[overview]].

> ⚠️ The D1 schema was applied through the Cloudflare API, with a matching row added to `d1_migrations`. `wrangler d1 migrations apply dump --remote` therefore only runs new files. Never re-run `migrations/0001_init.sql` by hand: it has no `IF NOT EXISTS`.

> ⚠️ The Default cloud environment has no Cloudflare token on purpose. Don't add one there; it is shared by all of the user's repos.

## Keys

| Name | Kind | Set by |
|---|---|---|
| `AUTH_TOKEN` | Worker secret | the user, in the dashboard |
| `ANTHROPIC_API_KEY` | Worker secret | the user, in the dashboard |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Worker secrets | made by `scripts/vapid.mjs`, set with `wrangler secret bulk` from a temp file that was shredded |
| `VAPID_SUBJECT` | plain var in `wrangler.jsonc` | repo |

> ⚠️ Never print, log, commit or paste a key value. Generate VAPID keys straight into `wrangler secret bulk` from a file in the scratchpad, then delete the file. Ask the user to type `AUTH_TOKEN` and `ANTHROPIC_API_KEY` into the dashboard themselves.

> ⚠️ With no `AUTH_TOKEN` set, every API call returns 401 (`worker/index.js` `authed`). That is the safe default, not a bug.

> ⚠️ Changing the VAPID keys breaks every existing push subscription. Each device has to tap Turn on reminders again.
