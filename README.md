# Calendar

A private, cross-platform scheduling app: it pulls your Google Calendar,
Outlook/Microsoft 365 Calendar, and Apple iCloud Calendar into one unified
view, notifies you when someone invites or edits an event on any of them, and
gives you an independent "native" calendar of your own — create an event
here and it's instantly visible on every device you're signed into (laptop,
iPad, phone), since it's all one web app backed by one database.

It's a normal web app (installable as a PWA), not three separate native
apps — that's what makes "works on my laptop, iPad, and phone" simple: one
deployment, one login, one URL.

## How it works

- **Next.js** app (this repo) — UI + API routes, deployed to Vercel.
- **Postgres** — stores your events, connections, and notifications.
- **Google Calendar API** — OAuth, incremental sync via sync tokens, and
  push-notification "watch" channels for near-real-time updates.
- **Microsoft Graph API** — OAuth (MSAL), delta-query sync, and change
  subscriptions (webhooks).
- **Apple iCloud** — CalDAV with an app-specific password (Apple has no
  consumer OAuth API for iCloud calendars), polled on a schedule since
  CalDAV has no push mechanism.
- **A cron-triggered poll** (`/api/cron/sync`) is the reliability backbone —
  it re-syncs every connected calendar on a schedule, so invites/edits show
  up even if a webhook was missed, expired, or was never set up. Webhooks
  are a nice-to-have for speed, not a requirement.

**Known limitations (v1):** recurring events created in this app (native)
only write back here, not to Google/Outlook/iCloud — pick "This app only"
when setting a repeat. Recurring iCloud events also aren't expanded into
individual instances the way Google/Outlook events are (a CalDAV/ical.js
limitation) — you'll see the recurring series' first occurrence only.

## 1. Local development

Prerequisites: Node 20+, a Postgres database (local or a free
[Neon](https://neon.tech)/[Supabase](https://supabase.com) instance).

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, SIGNUP_SECRET
# (openssl rand -hex 32   -- for the two secrets)

npx prisma migrate deploy   # creates the database tables
npm run dev
```

Open http://localhost:3000, click **Sign up**, and use the `SIGNUP_SECRET`
value you set as the invite code. You can use the calendar and create native
events immediately — connecting Google/Outlook/iCloud needs the setup below.

## 2. Connect Google Calendar

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (top-left project picker → **New Project**).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have a Google Workspace account).
   - Fill in an app name, your email as support/developer contact.
   - Under **Test users**, add your own Google account's email. While the
     app is in "Testing" mode, only accounts listed here can sign in — this
     is fine and expected for a personal app; you don't need Google to
     verify/publish it.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: add
     `https://YOUR_DOMAIN/api/connections/google/callback`
     (and, for local testing, `http://localhost:3000/api/connections/google/callback`).
   - Save, then copy the **Client ID** and **Client Secret**.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your environment.

Real-time push notifications (Google "watch" channels) require Google to be
able to reach `APP_URL/api/webhooks/google` over HTTPS — this works
automatically once you're deployed with a real domain. Until then (or if you
skip this), the daily cron poll (see "About the sync cron" below) keeps
things in sync as a fallback, just less instantly.

## 3. Connect Outlook / Microsoft 365

1. Go to the [Azure Portal](https://portal.azure.com/) →
   **Microsoft Entra ID → App registrations → New registration**.
2. Name it anything. Under **Supported account types**, choose
   **Accounts in any organizational directory and personal Microsoft
   accounts** (unless you specifically want to restrict it to one org/tenant).
3. **Redirect URI**: platform **Web**,
   `https://YOUR_DOMAIN/api/connections/microsoft/callback`
   (add `http://localhost:3000/api/connections/microsoft/callback` too for
   local testing).
4. After creation, copy the **Application (client) ID** — that's your
   `MICROSOFT_CLIENT_ID`.
5. **Certificates & secrets → New client secret** → copy the secret's
   **value** immediately (it's hidden after you leave the page) — that's
   `MICROSOFT_CLIENT_SECRET`.
6. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions** → add `Calendars.Read`, `offline_access`, `openid`,
   `email`, `profile` (these match the scopes the app requests).
7. Leave `MICROSOFT_TENANT_ID` unset to allow both personal and work/school
   Microsoft accounts to sign in, or set it to your tenant ID to restrict to
   one organization.
8. Generate a random `MICROSOFT_WEBHOOK_SECRET` (`openssl rand -hex 16`) —
   it's used to verify Graph webhook calls are genuinely from Microsoft.

## 4. Connect Apple iCloud

No app registration needed — Apple doesn't offer OAuth for iCloud calendars,
so this uses CalDAV with an **app-specific password** instead of your real
Apple ID password:

1. Go to [appleid.apple.com](https://appleid.apple.com) → sign in →
   **Sign-In and Security → App-Specific Passwords → Generate**.
2. Give it a label like "Calendar sync" and copy the generated password
   (format `xxxx-xxxx-xxxx-xxxx`).
3. In the app, go to **Connections → Connect iCloud**, enter your iCloud
   email and that app-specific password.

No environment variables are needed for Apple — credentials are entered
per-connection through the UI and stored encrypted in the database.

## 5. Import from a screenshot (for accounts you can't connect directly)

Some organizations block OAuth app registration or calendar sharing for
their Microsoft 365 / Outlook tenant, which makes a real connection
impossible even though you can still view your own calendar in a browser.
For that case, the calendar page has an **Import screenshot** button:

1. Take a screenshot of your calendar (any provider — Outlook web, Google
   Calendar, whatever you can see).
2. Click **Import screenshot** and upload it, or paste it directly
   (⌘V / Ctrl+V) into the dialog.
3. Claude reads the events out of the image and shows them as editable
   drafts — fix anything it misread, uncheck anything you don't want, then
   add them. They're created as regular native events (so they sync to all
   your devices), not linked to any live account.

This requires an `ANTHROPIC_API_KEY` (get one at
[console.anthropic.com](https://console.anthropic.com/settings/keys)). It's
optional — everything else works without it, but the button will error
until it's set.

## 6. Deploying to Vercel + Neon

1. Create a free Postgres database at [neon.tech](https://neon.tech) (or
   Supabase) and copy its connection string.
2. Push this repo to GitHub, then [import it into Vercel](https://vercel.com/new).
3. In the Vercel project's **Settings → Environment Variables**, add every
   variable from `.env.example` (`DATABASE_URL` from Neon, `APP_URL` set to
   your `https://your-app.vercel.app` domain, generated `SESSION_SECRET` /
   `ENCRYPTION_KEY` / `SIGNUP_SECRET` / `CRON_SECRET`, plus the Google/
   Microsoft values from steps 2–3 once you have them, and `ANTHROPIC_API_KEY`
   if you want the screenshot-import button to work).
4. Deploy. The build command (`prisma migrate deploy && next build`) applies
   any pending database migrations automatically on every deploy — nothing
   to run by hand.
5. Go back into Google Cloud Console / Azure and add your real
   `https://your-app.vercel.app/api/connections/.../callback` redirect URIs
   (you can add multiple redirect URIs, so keep the localhost one too).

**About the sync cron:** `vercel.json` schedules `/api/cron/sync` once a day,
since Vercel's **Hobby** plan rejects crons that run more often than that (a
more frequent schedule here will make every deployment fail validation). The
daily run is just a safety net — Google and Microsoft mostly keep things
current in real time via their push-notification webhooks once `APP_URL` is
a real HTTPS domain, and there's a manual **"Sync now"** button per
connection on the Connections page for anytime in between. If you want
tighter polling than once a day (e.g. to cover Apple/iCloud, which has no
push mechanism and only ever gets updated by this poll), either upgrade to
Vercel Pro, or point a free external scheduler — e.g.
[cron-job.org](https://cron-job.org) or a GitHub Actions scheduled workflow —
at `https://your-app.vercel.app/api/cron/sync` every 10–15 minutes with
header `Authorization: Bearer YOUR_CRON_SECRET`.

## 7. Installing it on your devices

Once deployed, open the app's URL in your browser on each device:

- **iPad/iPhone (Safari):** Share button → **Add to Home Screen**.
- **Android (Chrome):** menu → **Install app** / **Add to Home screen**.
- **Laptop (Chrome/Edge):** address bar → install icon → **Install**.

It'll open full-screen like a native app, using the icon and name from
`public/manifest.webmanifest`.

## 8. Push notifications and daily planning reminders

The 🔔 bell in the nav always shows invite/edit/cancellation alerts in-app,
but that only helps while the app is open. For real notifications on your
phone's lock screen — including a daily reminder to plan your day each
morning and check off your to-dos each evening — set up Web Push:

1. Generate a key pair: `npx web-push generate-vapid-keys`.
2. Add to Vercel: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from that
   output, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` set to the **same value** as
   `VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT` (a `mailto:you@example.com` or
   `https://` URL — push services use this to contact you if something's
   misbehaving). Redeploy afterward.
3. On each device (install as a PWA first — see step 7 above; iOS requires
   this, Android/desktop work in-browser too), go to your profile menu →
   **Notifications** → **Enable push on this device**, and allow the
   permission prompt.
4. On that same page, turn on **daily planning reminders** and set your
   morning/evening times — they're interpreted in your account's timezone.

**Reminders need their own poller.** Like the Apple/iCloud sync gap
mentioned above, Vercel Hobby's cron only runs once a day, which isn't
useful for "remind me every morning at 7am *and* every evening at 8pm."
Point an external scheduler at `/api/cron/reminders` every 15–30 minutes,
the same way as `/api/cron/sync`:
[cron-job.org](https://cron-job.org) or a GitHub Actions scheduled
workflow, hitting `https://your-app.vercel.app/api/cron/reminders` with
header `Authorization: Bearer YOUR_CRON_SECRET`. It's idempotent — each
user gets at most one morning and one evening reminder per day no matter
how often it's polled.

## 9. Telegram agenda + reminders (optional)

Besides push, you can get your daily agenda and per-event reminders sent to
Telegram — useful since it works even on devices where push notifications
are flaky, and message text can include full event details.

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   and follow the prompts. You'll get a token and a `@username` for your bot.
2. Add to Vercel: `TELEGRAM_BOT_TOKEN` (the token from BotFather),
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (the username, no `@`), and
   `TELEGRAM_WEBHOOK_SECRET` (generate with `openssl rand -hex 16`).
   Redeploy afterward.
3. While logged in, visit `https://your-app.vercel.app/api/telegram/setup`
   once to register the webhook — it should respond `{"ok":true,...}`.
4. In the app, go to profile menu → **Notifications** → **Telegram** →
   **Link Telegram**, then tap the button to open Telegram and hit **Start**.
5. Turn on **Today's agenda** / **Tomorrow's agenda** and set the times —
   same 15–30 min external-poller requirement as push reminders above, since
   this also runs through `/api/cron/reminders`.

Per-event reminders (set from the event editor, independent of two-way
sync — see below) go out over Telegram the same way, including the event's
location and description if you filled them in.

Once linked, you can also just message the bot naturally instead of using
the app:
- **"lunch with sarah tomorrow 1pm"** — creates the event, tagged
  `(Telegram)` like other event sources. If it clashes with something
  already on your calendar, the bot lists the conflict and asks via
  tappable buttons whether to create it anyway or cancel.
- **"am I free tomorrow at 3pm?"** — replies with a free/busy check.
- Anything else gets saved as an idea (see `/ideas` / `/done` above).

This uses a free local parser (no AI/API calls, so no added cost) — it
handles common phrasing well but is less flexible than a full assistant
with unusual wording. If you re-run step 3 after an update to this
feature, do it again — Telegram needs `allowed_updates` to include
`callback_query` for the buttons to work, which `/api/telegram/setup`
handles automatically each time you visit it.

## 10. Two-way sync toggle

By default, editing or deleting a Google/Outlook/iCloud-sourced event in
this app writes the change back to that provider too. If you'd rather this
app be read-only towards your external calendars — pulling in their changes
but never pushing anything back — turn off **Two-way sync** on the
**Connections** settings page. Native (app-only) events are unaffected
either way, and per-event reminders always work regardless of this setting
since they're stored locally and never sent to any provider.

## 11. Plan my day (optional travel-time buffers)

On the **To-do** page, adding a task lets you set an estimate (minutes),
a deadline, a priority, and a location — none required. Hit **Plan my day**
and it slots your un-timed to-dos for that day into the actual free gaps
between your calendar events (7am–10pm by default), picking the earliest-
deadline, then highest-priority, then best-fitting task for each gap. Tasks
that don't fit anywhere stay untimed and are called out rather than silently
dropped. Re-running it only touches tasks that are still untimed — anything
already scheduled (by this or manually) is left alone.

If two adjacent events have different, non-empty locations, it reserves a
travel-time buffer before the second one using Google's Distance Matrix API
(transit mode). This needs its own `GOOGLE_MAPS_API_KEY` — see
`.env.example` for where to get one. Without it, planning still works, it
just doesn't buffer for travel time.
