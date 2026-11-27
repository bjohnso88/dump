---
title: Reminders (cron + web push)
type: subsystem
created: 2026-11-27
updated: 2026-11-27
sources:
  - code: worker/index.js
  - code: worker/push.js
  - code: public/sw.js
  - code: public/app.js
  - code: scripts/vapid.mjs
verified_at: f1415f4
---

The cron (`*/5 * * * *`) calls `tick` (`worker/index.js:218`). Rules, in order:

1. Quiet 22:00 to 08:00 in the user's zone: send nothing.
2. Already 4 rows in `sent` since local midnight: send nothing.
3. Otherwise `nextMessage` (`worker/index.js:177`) picks **one** message, first match wins:
   a task whose due time passed in the last 12 hours, then the morning top 3 (within 3
   hours of the set time, once a day), then one "Still want this?" for the task
   untouched longest (5+ days, once per task ever, at most one a day).

A "Still want this?" also sets `ask_open = 1`, which shows the Do it / Shrink / Drop card
in the app. Any edit to the item clears it. See [[overview]] for the data model.

> ⚠️ One notification per cron run is deliberate. It keeps the daily cap simple and stops a due ping, the morning nudge and a stale nudge landing together.

> ⚠️ A due time inside quiet hours fires at 08:00 because of the 12-hour look-back. Shrinking that window drops overnight reminders silently.

> ⚠️ The morning nudge marks `morning_date` even when it decides not to send (too late, empty list). That stops it retrying all day.

## Web push, no libraries

`worker/push.js` builds the VAPID `Authorization` header (ES256 JWT signed with WebCrypto)
and encrypts the payload as `aes128gcm` (RFC 8291). Keys come from the secrets
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, made by `npm run vapid` (`scripts/vapid.mjs`); see [[deploy-and-keys]].
The subject is the `VAPID_SUBJECT` var.

> ⚠️ The encryption was checked against the `http_ece` decoder before shipping. If you touch `encrypt`, check it the same way: a wrong byte fails silently on the push service side.

> ⚠️ Push services answer 404/410 for dead subscriptions; `sendToAll` deletes those rows. Other errors are only logged (`npx wrangler tail`).

> ⚠️ iPhone push only works from the home-screen install, and iOS shows no notification action buttons. That is why Do it / Shrink / Drop live in the app, not in the notification.

`public/sw.js` shows the notification and focuses or opens the app on tap. The app
re-posts its subscription on every load (`checkPush`, `public/app.js:597`) so a wiped
`subs` table heals itself. "Turn on reminders" sends `hello: true`, which triggers a
"Reminders are on." test push.

> ⚠️ The service worker must not cache `/api/*` (`public/sw.js`). Cached API answers would show a stale list on the other device.
