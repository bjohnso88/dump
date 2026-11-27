# Dump

A calm, zero-friction to-do app. Type, hit enter, done. Now synced between phone and laptop.

- Type anything → it's a to-do. Start with `idea:` → it goes to Ideas.
- Tap the circle to mark a to-do done; tap the task to edit it. Swipe left to delete. Every delete
  shows **Undo** for a few seconds, and holding a row no longer deletes it.
- **Search:** the bar under the tabs finds to-dos and ideas (and anything finished in the last week).
- **Smart add:** Claude quietly pulls out a due date/time ("call dentist tomorrow 3pm") and a size
  (quick / medium / big). It shows as small gray text. Tap it to fix.
- **Prioritize:** tap it, pick your energy (low / med / high), get your top 3 with one line on why,
  plus a tiny first step for #1. Everything else folds into "Later".
- **Reminders** (web push): a morning nudge at the time you set, a ping at a task's due time, and a
  one-time "Still want this?" for anything untouched 5+ days (Do it / Shrink / Drop in the app).
  Quiet 10pm to 8am. Never more than 4 a day.
- **Wrap up** shows today's wins, then lets you keep or drop what's left.
- **This week** shows what you finished in the last 7 days.

## How it's built
- `public/` – the app (plain HTML/CSS/JS, installs to the home screen, opens offline)
- `worker/index.js` – Cloudflare Worker: JSON API, cron, serves `public/`
- `worker/claude.js` – the three Claude calls (Claude Haiku 5.5, low effort). If Claude fails,
  the app just carries on (no date, simple fallback for prioritize).
- `worker/push.js` – web push with no libraries (VAPID + aes128gcm)
- `migrations/` – D1 database schema
- `worker/static.js` – serves the files in `public/`, which are bundled into the Worker
- Auth: one secret key. You paste it once per device; it stays in that browser.

## Where things stand

Dump v2 is deployed on Cloudflare as the Worker **`dump`** at https://dump.bixjohnson.com.

| Piece | Status |
|---|---|
| D1 database `dump` | Created, schema applied |
| Worker, custom domain, 5-minute cron | Deployed |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (push) | Set |
| `AUTH_TOKEN` (your login key) | **You set this** (below) |
| `ANTHROPIC_API_KEY` (Claude) | **You set this** (below) |

Until `AUTH_TOKEN` is set, the app shows the key screen and refuses every key. That's on purpose.

## The keys, all in one place

There are five keys. None of them is in this repository, and none should ever be.

| Key | What it does | Where it lives | Who makes it |
|---|---|---|---|
| `AUTH_TOKEN` | Your login key. Paste it into Dump once per device | Worker secret, and in each browser you unlocked | You (any long random text) |
| `ANTHROPIC_API_KEY` | Lets Dump call Claude (smart dates, Prioritize, Shrink) | Worker secret | You, at console.anthropic.com → API Keys |
| `VAPID_PUBLIC_KEY` | Push notifications, public half. The app reads it from the server | Worker secret | Already made (`npm run vapid`) |
| `VAPID_PRIVATE_KEY` | Push notifications, private half. Signs every push | Worker secret | Already made, nobody has seen it |
| Cloudflare API token | Lets Claude (or you) run `wrangler deploy` | Cloudflare dashboard → My Profile → API Tokens. A copy is saved in the "dump" cloud environment for Claude sessions | You made it |

### Set your two secrets (Cloudflare dashboard, about 3 minutes)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **dump** → **Settings** → **Variables and Secrets**.
2. Click **+ Add**. Type: **Secret**. Name: `AUTH_TOKEN`. Value: a long random key
   (a password manager's generator is perfect, 30+ characters). Save it in your password manager too.
3. Click **+ Add** again. Type: **Secret**. Name: `ANTHROPIC_API_KEY`. Value: your Claude API key
   (https://console.anthropic.com → **API Keys** → **Create Key**).
4. Click **Deploy** (or **Save and deploy**) so the Worker picks them up.

Leave the existing secrets and the `VAPID_SUBJECT` variable alone. Don't change the type of anything
from Secret to Text: Text values are visible to anyone with dashboard access.

### If you need to change or lose a key

- **Forgot `AUTH_TOKEN`, or think someone saw it:** set a new value in the dashboard (same place, edit
  `AUTH_TOKEN`). Every device shows the key screen again; paste the new one. Your list is not affected.
- **New Claude key:** create it at console.anthropic.com, update `ANTHROPIC_API_KEY` in the dashboard,
  then delete the old key in the Anthropic console.
- **VAPID keys:** don't change them unless you have to. If you do (`npm run vapid`, then update both
  secrets), every device has to tap **Turn on reminders** again.
- **Cloudflare token leaked or no longer wanted:** delete it at dash.cloudflare.com → My Profile →
  API Tokens. Also remove it from the "dump" cloud environment (claude.ai/code → environment menu →
  **dump** → Edit → Network secrets). Make a new one the same way if you want to deploy again.

## On each device

- Open https://dump.bixjohnson.com and paste your `AUTH_TOKEN`.
- **iPhone:** Safari → Share → **Add to Home Screen**. Open Dump **from the home screen icon**
  (push only works there on iOS), then tap **Turn on reminders** at the bottom of the To-do list.
  You should get "Reminders are on." right away.
- **Laptop:** tap **Turn on reminders** in the browser.
- **Your old v1 list** lived only in the browser you used it in. Open v2 once in that same browser
  and it's copied up automatically. (A backup stays in that browser under `dump-v1-backup`.)
- **Morning nudge time:** the time box at the bottom of the To-do list. Quiet hours are 10pm to 8am,
  so the earliest it fires is 8:00.

## Deploying changes later

**Easiest:** ask Claude in a cloud session using the **dump** environment. The Cloudflare token is
saved there, so it can run `npx wrangler deploy` for you.

**From your own computer:**
```bash
npm install
```
```bash
npx wrangler login
```
```bash
npx wrangler deploy
```
Deploys keep your secrets and your data. The database already exists, so you only run a migration
when a new file appears in `migrations/`:
```bash
npx wrangler d1 migrations apply dump --remote
```

**Logs:** `npx wrangler tail` shows each cron run (`tick ...`) and any Claude or push errors.
Also in the dashboard: Workers & Pages → dump → **Logs**.

**Clean-up (optional):** the old v1 storage, the `dump-files` KV namespace, isn't used any more.
Delete it whenever you like: Storage & Databases → KV.

## Setting it up from scratch (new account)

Only needed if you ever move Dump to a different Cloudflare account.

1. `npx wrangler d1 create dump`, then paste the printed `database_id` into `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply dump --remote`
3. `npx wrangler deploy` (say yes if it offers to create the Worker).
4. `npm run vapid`, then `npx wrangler secret put VAPID_PUBLIC_KEY` and
   `npx wrangler secret put VAPID_PRIVATE_KEY` with the two values it printed.
5. Set `AUTH_TOKEN` and `ANTHROPIC_API_KEY` as in "Set your two secrets" above.
6. Change the domain in `wrangler.jsonc` (`routes`) if it isn't on bixjohnson.com.

## Run it locally
```bash
printf 'AUTH_TOKEN=testkey\n' > .dev.vars
```
```bash
npx wrangler d1 migrations apply dump --local
```
```bash
npm run dev
```
Open http://localhost:8787 and use `testkey`. Trigger the cron by hand at
http://localhost:8787/__scheduled. Add `ANTHROPIC_API_KEY=...` to `.dev.vars` to try the Claude parts. `.dev.vars` is gitignored;
never commit it.
