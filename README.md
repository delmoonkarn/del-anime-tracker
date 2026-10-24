# Anime Tracker

Personal seasonal anime tracker with AniList integration. Tracks watch progress, manages favorites, and keeps everything in your own database: on your PC, or online for free on Cloudflare.

<img width="1277" height="908" alt="image" src="https://github.com/user-attachments/assets/da50f8ef-d2e7-4c92-8fcf-13ded492c342" />


## Contents

- [Features](#features)
- [Two ways to run it](#two-ways-to-run-it)
- [Run it on your PC](#run-it-on-your-pc)
- [Put it online (free, on Cloudflare)](#put-it-online-free-on-cloudflare)
- [Using it: account, backups, restore](#using-it-account-backups-restore)
- [Troubleshooting](#troubleshooting)
- [Limits and costs](#limits-and-costs)
- [Development](#development)

## Features

- Seasonal schedule with per-show watch progress (card or list view, filter by airing day)
- Watchlist: everything you're watching across all seasons, by the day the next episode airs
- Explore anime by season via AniList, with format / tag / streaming-service filters
- Detail page per show: progress, where to watch, facts, prequel & sequel, synopsis, trailer
- Where to watch: your own streaming links per show (several per show) plus AniList's streaming links (cached, refreshed weekly), shown as channel icons on the posters
- Favorites and Interested collections
- Global AniList search from the header (press `/`)
- Excel import/export of your schedule and collection
- Backups as plain `.sql` files: download or restore from Settings, or get one emailed every month
- Online version: one account (username + password), managed entirely from the app's Settings page

## Two ways to run it

| | On your PC | Online (Cloudflare, free) |
|---|---|---|
| Reach it from | this PC only | anywhere, phone included |
| Database | `data/anime-tracker.db` (SQLite) | Cloudflare D1 |
| Sign-in | none | username + password |
| Backup email | when you ask | monthly, plus when you ask |
| Cost | free | free |

You can use one or both. They keep separate data; a backup moves it from one to the other (see [step 10](#10-bring-over-your-pc-data-optional)).

## Run it on your PC

### What you need

- [Node.js](https://nodejs.org/) 22 or newer (the LTS download is fine)
- This project's files: `git clone https://github.com/delmoonkarn/del-anime-tracker.git`, or **Code → Download ZIP** on GitHub and unzip it

### Start it

**On Windows**, double-click `ATracker.exe` in the project folder. The first time, it installs what it needs and builds the app (a few minutes). After that it starts in a second and opens <http://localhost:3001> in your browser. Keep its window open while you use the tracker.

**Anywhere else (or from a terminal)**, in the project folder:

```bash
npm install
npm run build
npm start
```

Then open <http://localhost:3001>.

Your data lives in `data/anime-tracker.db`. The gear icon at the top right opens **Settings**, where you download and restore backups.

### Update it

Get the new files (`git pull`, or download the ZIP again and copy your `data` folder into it), then:

```bash
npm install
npm run build
```

`ATracker.exe` only builds when the app has never been built, so run `npm run build` after every update. Your database is upgraded the next time the app starts.

## Put it online (free, on Cloudflare)

This puts your own copy on Cloudflare's free plan: Workers runs the app, D1 holds the data, and you sign in with a username and password. It takes about 15 minutes. The commands run in a terminal (PowerShell on Windows) opened in the project folder.

### What you need

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Node.js](https://nodejs.org/) 22 or newer, and [Git](https://git-scm.com/downloads)
- A free [GitHub account](https://github.com/signup), to keep your own copy of the code (recommended)
- A free [Resend account](https://resend.com/signup), for backup emails and password resets (optional, but recommended)

### 1. Get the code

On GitHub, press **Fork** on this repository to make your own copy. Then download your copy and install it:

```bash
git clone https://github.com/<your-github-name>/del-anime-tracker.git
cd del-anime-tracker
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

A browser window opens; allow Wrangler (Cloudflare's command-line tool) to use your account. It stays logged in on this PC.

### 3. Create the database

Pick the location closest to you: `apac` (Asia-Pacific), `oc` (Oceania), `weur` / `eeur` (Western / Eastern Europe), `wnam` / `enam` (Western / Eastern North America).

```bash
npx wrangler d1 create anime-tracker --location apac
```

Keep the name `anime-tracker`: the project's commands use it. The output includes a line like `database_id = "1a2b3c4d-..."`; copy that id. If Wrangler offers to add the database to your config file, answer **no**: `wrangler.toml` already has the entry, and the next step only changes its id.

### 4. Point `wrangler.toml` at it

Open `wrangler.toml` in any text editor and change two lines:

```toml
name = "atracker"          # your app's name; becomes https://<name>.<subdomain>.workers.dev
...
database_id = "1a2b3c4d-..."   # the id from step 3
```

The `name` only has to be unique in your own Cloudflare account. Everything else in the file can stay. To change when the monthly backup email goes out, edit `crons` there too: the default `0 0 1 * *` is 00:00 UTC on the 1st of each month.

### 5. Set a setup code (recommended)

Until you've created your account, whoever opens the site first could create it instead. A setup code closes that gap: the setup page asks for it.

```bash
npx wrangler secret put SETUP_CODE
```

Type any long random text when it asks, and keep it until step 8. If Wrangler says the Worker doesn't exist yet and offers to create it, answer **yes**.

### 6. Create the tables

```bash
npm run cf:db:remote
```

It lists the migrations and asks to apply them; answer yes. Check that every one ends with ✅ before going on.

### 7. Deploy

```bash
npm run cf:deploy
```

On your very first deploy, Cloudflare may ask you to choose a `workers.dev` subdomain (for example your name). It becomes part of the address of everything you deploy. The command ends by printing your tracker's address, like `https://atracker.yourname.workers.dev`.

### 8. Create your account

Open the address from step 7. Because no account exists yet, you get a **Set up your tracker** page instead of a sign-in page:

1. Choose a username.
2. Choose a password (8 or more characters).
3. If you did step 5, type the setup code.

That creates your account, the only one the tracker has. After this, the site shows a normal sign-in page.

Each device stays signed in as long as you open the tracker at least once every 30 days. A device left unused for longer asks you to sign in again.

### 9. Turn on backup email

In the tracker: person icon (top right) → **Backup**, then the **Backup email** part of that page.

1. Sign up at [resend.com](https://resend.com/signup).
2. In Resend, open **API Keys** → **Create API Key**, choose **Sending access**, and copy the key (it starts with `re_`).
3. In the tracker, paste the key, and under **Send backups to** enter the email address you signed up to Resend with.
4. Leave **Email a backup on the 1st of every month** ticked, press **Turn on**, then **Send a backup now** and check your inbox (and spam).

Resend's free plan only sends to your own sign-up address. To send elsewhere, verify a domain you own under **Domains** in Resend, then set the **Sender** in Settings to an address on it, like `Anime Tracker <backup@yourdomain.com>`.

Backup email also turns on **Forgot password?** on the sign-in page.

### 10. Bring over your PC data (optional)

If you've been using the PC version:

1. On the PC version: gear icon → **Download backup**.
2. Online: person icon → **Backup** → **Restore from backup**, and pick that file.

### Done

Bookmark the address, or add it to your phone's home screen. Everything from here on (account, password, backups) is in **Settings**, without the terminal.

### Optional: your own domain

If you have a domain on Cloudflare, you can serve the tracker from it: Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.

### Updating your online copy

On GitHub, press **Sync fork** on your copy (if you forked). Then, in the project folder:

```bash
git pull
npm install
npm run cf:db:remote
npm run cf:deploy
```

Check that `cf:db:remote` succeeded (or says there's nothing to apply) before deploying: a new version may need new tables. Deploying uploads your project folder as it is; GitHub isn't involved.

### Removing it

```bash
npx wrangler delete
npx wrangler d1 delete anime-tracker
```

The first removes the Worker (the site), the second the database with all its data. Download a backup first if you want to keep anything.

## Using it: account, backups, restore

Everything is in **Settings**, which has two tabs. Online, the person icon (top right) opens either one: **Account** or **Backup**. On your PC there's no account, so the gear icon opens **Backup**.

### Account (online)

- **Change username or password:** enter your current password first. Your other devices get signed out.
- **Sign out everywhere:** signs out every device, this one included.
- **Wrong passwords:** after 5 wrong tries the sign-in page makes you wait 15 minutes.

### Forgot your password

On the sign-in page, press **Forgot password?**. A reset link goes to your backup email address; it works once, for 30 minutes. This needs [backup email](#9-turn-on-backup-email) to be on.

If backup email isn't on, the last resort is the terminal. This deletes the account, not your tracker data:

```bash
npx wrangler d1 execute anime-tracker --remote --command "DELETE FROM auth_session; DELETE FROM auth_account;"
```

Then open the site straight away and create the account again (with the setup code, if you set one).

### Backups

- **Download:** **Backup** tab → **Download backup** saves `anime-tracker-<date>.sql`.
- **Email:** online, a backup is emailed on the 1st of every month. **Send a backup now** sends one any time; Settings shows how the last one went.
- **What's in it:** seasons, shows, watch progress, collection, streaming links, H favorites and preferences. Not your account, the Resend key, or AniList data the app can fetch again.
- **Format:** plain SQL text you can open in any text editor, about half a megabyte for years of tracking.

### Restore

**Backup** tab → **Restore from backup**, then pick a `.sql` file.

- It replaces your tracker data with the backup's. Your account and settings stay as they are.
- It loads all of the file or, if anything goes wrong, none of it.
- On your PC, the data you had is first copied to `data/anime-tracker.before-restore-<time>.db`.
- Close the tracker on your other devices first. An open tab still holds the old data and would save it back over the restore.

**Undo, online:** D1 keeps the last 7 days of history, so you can roll the whole database back to any minute in that window (time in UTC):

```bash
npx wrangler d1 time-travel restore anime-tracker --timestamp=2026-11-01T12:00:00Z
```

**From the terminal:** `npm run restore -- <file>.sql` does the same on your PC, and `npm run restore -- <file>.sql --d1 remote` on the online version.

## Troubleshooting

| Problem | What to do |
|---|---|
| `npx wrangler ...` says you're not logged in | Run `npx wrangler login` again. |
| The site shows an error, or **Couldn't reach the server** | Look at the logs: Cloudflare dashboard → **Workers & Pages** → your Worker → **Logs**. "no such table" means step 6 didn't finish: run `npm run cf:db:remote`, then `npm run cf:deploy`. |
| The setup page says **Wrong setup code** | Set it again with `npx wrangler secret put SETUP_CODE`. |
| **Too many wrong tries. Wait 15 minutes.** | Wait, then try again; or use **Forgot password?**. |
| No **Forgot password?** link, or it says reset needs backup email | Backup email isn't on. Use the last-resort command under [Forgot your password](#forgot-your-password). |
| **Send a backup now** fails with `... testing emails to your own email address` | Use the address you signed up to Resend with, or verify a domain in Resend. |
| **Send a backup now** fails with `... API key is invalid` (or another `Resend: HTTP 401` / `403`) | The key is wrong or was deleted: create a new one with Sending access and paste it in Settings. |
| The monthly email didn't arrive | Check spam. Settings shows the last attempt and any error. It's sent at the time in `crons` (UTC). |
| Restore says the file **isn't an Anime Tracker backup** | Pick a `.sql` file that came from **Download backup** or a backup email. |
| Restore says **has no column named …** | The backup is from an older version whose tables were different. Use a newer backup. |
| The PC version won't start: port 3001 is in use | Another copy is already running; close its window (or use the tab that's already open). |

## Limits and costs

Free, and far above what one person's tracker needs:

- **Cloudflare Workers:** 100,000 requests a day.
- **Cloudflare D1:** up to 500 MB per database; a tracker is about 1 MB.
- **Resend:** 100 emails a day.

The tight limit is CPU: on the free plan each request gets 10 ms. Backups stay plain (not gzipped) and passwords use a modest hash cost because of it. If a much bigger tracker ever outgrows that, Cloudflare's $5/month Workers Paid plan lifts it.

## Development

```bash
npm run dev
```

Runs Vite on `:5173` (frontend with hot reload) and the API on `:3001`; Vite forwards `/api/*` to it. Open <http://localhost:5173>.

To run the online version locally (at <http://localhost:8787>, with a local D1 copy):

```bash
npm run cf:db:local
npm run cf:seed:local
npm run cf:dev
```

`cf:seed:local` copies `data/anime-tracker.db` into the local D1. For a local setup code or backup email, copy `.dev.vars.example` to `.dev.vars`.

**Changing the database:** add a new numbered file to `migrations/` (for example `0006_something.sql`). The PC version applies it when it starts; online, `npm run cf:db:remote` applies it.

### Stack

- **Vite + React 18** — frontend SPA
- **Hono** — API, shared by both versions
- **better-sqlite3** — database on your PC
- **Cloudflare Workers + D1** — online version
- **Resend** — backup and password-reset email
- **Tailwind CSS** — styling

### Project layout

```
index.html              SPA shell
src/                    Frontend
  main.tsx              ReactDOM entry
  App.tsx               Top-level state and view routing
  components/           React components
  lib/                  Types, AniList client, storage, import/export, sign-in
  hooks/
server/                 Backend
  app.ts                API routes, shared by both versions
  index.ts              PC version: Node + SQLite, serves the built frontend
  worker.ts             Online version: Workers + D1, plus the monthly backup cron
  db.ts                 Storage logic (saves only changed rows)
  sqlite.ts, d1.ts      Database adapters; sqlite.ts builds the PC database from migrations/
  auth.ts               Sign-in, sessions, password reset
  backup.ts             .sql backups, restore and the backup email
  settings.ts           Settings saved from the Settings page
  email.ts              Sends email through Resend
migrations/             Database schema, for both versions
scripts/                Build, dev, restore, export-sql
wrangler.toml           Cloudflare settings (Worker name, database id, monthly email time)
data/                   SQLite database (gitignored)
```
