# Dump

A calm, zero-friction to-do app. Type, hit enter, done. Now synced between phone and laptop.

- Type anything → it's a to-do. Start with `idea:` → it goes to Ideas.
- Tap a to-do to mark it done. Swipe left or hold to delete.
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
- Auth: one secret key. You paste it once per device; it stays in that browser.

## Deploy (Cloudflare)

You need Node 20+ and your Cloudflare login. Run these from this folder.

**1. Install and log in**
```bash
npm install
```
```bash
npx wrangler login
```

**2. Create the database**
```bash
npx wrangler d1 create dump
```
Copy the `database_id` it prints into `wrangler.jsonc` (replace `PASTE_DATABASE_ID_HERE`). Then:
```bash
npx wrangler d1 migrations apply dump --remote
```

**3. Make VAPID keys (for push)**
```bash
npm run vapid
```
It prints a public and a private key. Keep that terminal open for the next step.

**4. Set the secrets** (each command asks you to paste a value)
```bash
npx wrangler secret put AUTH_TOKEN
```
Make up a long random key (e.g. from a password manager). This is what you paste into Dump on each device.
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```
```bash
npx wrangler secret put VAPID_PUBLIC_KEY
```
```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```
(On the very first run wrangler may say the Worker doesn't exist yet and offer to create it. Say yes.)

**5. Deploy**
```bash
npx wrangler deploy
```
This uploads the app, the API and the 5-minute cron, and attaches `dump.bixjohnson.com`
(the `routes` entry in `wrangler.jsonc`, with `custom_domain: true`). Cloudflare creates the DNS
record and certificate for you, since bixjohnson.com is already on your Cloudflare account. If v1's
custom domain is still attached to the old Worker, deploy replaces it because it's the same Worker
name (`dump`). The old `dump-files` KV namespace isn't used any more; delete it whenever you like.

**6. On each device**
- Open https://dump.bixjohnson.com and paste your key.
- iPhone: Share → **Add to Home Screen**, then open Dump from the home screen icon and tap
  **Turn on reminders** at the bottom of the To-do list (iOS only allows push from the installed app).
  You should get "Reminders are on." right away.
- Laptop: just tap **Turn on reminders** in the browser.
- Your old v1 list (which lived only in that browser) is copied up automatically the first time
  you open v2 on that device.

**Updating later:** change files, then `npx wrangler deploy` again.

**Logs:** `npx wrangler tail` shows each cron run (`tick ...`) and any Claude or push errors.

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
http://localhost:8787/__scheduled. Add `ANTHROPIC_API_KEY=...` to `.dev.vars` to try the Claude parts.
