# Anime Tracker

Personal seasonal anime tracker with AniList integration. Tracks watch progress, manages favorites, and keeps everything in your own database: on your PC, or online for free on Cloudflare.

<img width="1286" height="918" alt="image" src="https://github.com/user-attachments/assets/6b1c32c2-85a1-4272-9f94-9bfe9879c6a2" />

## Features

- Seasonal schedule with per-show watch progress (card or list view, filter by airing day)
- Watchlist: everything you're watching across all seasons, by the day the next episode airs
- Explore anime by season via AniList, with format / tag / streaming-service filters
- Detail page per show: progress, where to watch, facts, prequel & sequel, synopsis, trailer
- Where to watch: your own streaming links per show (several per show) plus AniList's streaming links (cached, refreshed weekly), shown as channel icons on the posters
- Favorites and Interested collections
- Global AniList search from the header (press `/`)
- Import/export
- Backups as plain `.sql` files: download or restore from Settings, or get one emailed every month
- Online version: one account (username + password), managed entirely from the app's Settings page

## Two ways to run it

| | On your PC | Online (Cloudflare, free) |
|---|---|---|
| Start | `npm start` or `ATracker.exe` | `npm run cf:deploy` |
| Database | `data/anime-tracker.db` (SQLite) | Cloudflare D1 |
| Sign-in | off (`REQUIRE_LOGIN=1` turns it on) | always |
| Backup email | when you ask | monthly, plus when you ask |

The two keep separate data. To move data from one to the other, use a backup (see [Backups](#backups)).

## On your PC

Needs Node.js 22+.

```bash
npm install
npm run build
npm start
```

Opens at <http://localhost:3001>.

On Windows, double-clicking `ATracker.exe` runs the same flow: installs dependencies if missing, builds if `dist/` is absent, then starts the server and opens the browser.

The gear icon at the top right opens Settings, where backups live.

## Deploy your own (online, free)

This puts your own copy on Cloudflare's free plan: Workers runs the app, D1 holds the data. You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node.js 22+.

1. **Fork** this repo on GitHub, clone your fork, and install:

   ```bash
   npm install
   ```

2. **Log in to Cloudflare** (opens the browser):

   ```bash
   npx wrangler login
   ```

3. **Create the database** near you. `--location` is one of `apac` (Asia-Pacific), `oc` (Oceania), `weur`, `eeur`, `wnam`, `enam`:

   ```bash
   npx wrangler d1 create anime-tracker --location apac
   ```

4. **Edit `wrangler.toml`:**
   - `database_id`: the id the last command printed
   - `name`: your app's name. The address will be `https://<name>.<your subdomain>.workers.dev`; Cloudflare asks you to pick the subdomain on your first deploy.

5. **Create the tables**, and check that it ends with the migrations applied:

   ```bash
   npm run cf:db:remote
   ```

6. **Deploy:**

   ```bash
   npm run cf:deploy
   ```

7. **Open the address it prints and create your account right away.** Until an account exists, whoever opens the site first can create it. To rule that out, set a setup code before deploying (`npx wrangler secret put SETUP_CODE`); the setup page then asks for it.

8. **Turn on backup email** (optional, recommended): person icon → **Settings and backups** → **Backup email**. It sends through [Resend](https://resend.com) (free):
   - sign up there
   - create an API key under API Keys with Sending access
   - paste the key and your Resend sign-up email in Settings, then press **Send a backup now** to check it arrives

   Without your own domain on Resend, emails can only go to the address you signed up to Resend with. Backup email also makes **Forgot password?** work.

### Updating your copy

```bash
git pull
npm install
npm run cf:db:remote
npm run cf:deploy
```

Run `cf:db:remote` first and check that it succeeded: the new version may need the tables it adds. Deploying uploads your local folder as it is; GitHub isn't involved.

### Free plan limits

Far above what one person's tracker uses: Workers allow 100,000 requests a day, a D1 database holds up to 500 MB (a tracker is about 1 MB), and Resend sends 100 emails a day. The one tight limit is CPU: each request on the free plan gets 10 ms. That's why backups aren't gzipped and passwords use a modest hash cost.

## Account and settings

Everything is in the app, with no terminal: person icon → **Settings and backups**.

- **Account:** change your username or password (asks for the current one; other devices get signed out), or sign out everywhere.
- **Backups:** download a backup, restore one, and set up the backup email.

**Forgot your password?** On the sign-in page, press **Forgot password?**. A reset link goes to the backup email address; it works once, for 30 minutes. This needs backup email to be set up.

If backup email isn't set up, the last resort is the terminal. This deletes the account, not your tracker data:

```bash
npx wrangler d1 execute anime-tracker --remote --command "DELETE FROM auth_session; DELETE FROM auth_account;"
```

Then open the site straight away and create the account again.

## Backups

**Download:** Settings → **Download backup** saves `anime-tracker-<date>.sql`.

**Email:** online, a backup is emailed on the 1st of every month at 00:00 UTC (change `crons` in `wrangler.toml`). **Send a backup now** in Settings sends one any time.

**What's in it:** seasons, shows, watch progress, collection, streaming links, H favorites and preferences. It's plain SQL text, so it stays readable without this app. Left out: the AniList caches (they refill themselves), the sign-in tables, and the Resend key.

**Restore:** Settings → **Restore from backup**, then pick the `.sql` file.
- It replaces your tracker data with the backup's. Your account and settings stay as they are.
- It loads all of the file or, if anything goes wrong, none of it.
- On your PC, the data you had is first copied to `data/anime-tracker.before-restore-<time>.db`.
- Close the tracker on your other devices first. An open tab still holds the old data and would save it back over the restore.

This is also how you move your data between your PC and the online version: download a backup on one, restore it on the other.

The terminal can do the same, for the PC version:

```bash
npm run restore -- anime-tracker-2026-11-01.sql
```

and for the online version:

```bash
npm run restore -- anime-tracker-2026-11-01.sql --d1 remote
```

**Undo, online:** D1 keeps a point-in-time history for the last 7 days, so you can roll the whole database back to any minute in that window:

```bash
npx wrangler d1 time-travel restore anime-tracker --timestamp=2026-11-01T12:00:00Z
```

## Development

```bash
npm run dev
```

Runs Vite on `:5173` (frontend with HMR) and Hono on `:3001` (API) in parallel. Vite proxies `/api/*` to Hono automatically. Open <http://localhost:5173>.

To run the Cloudflare version locally (at <http://localhost:8787>, with a local D1):

```bash
npm run cf:db:local
npm run cf:seed:local
npm run cf:dev
```

`cf:seed:local` copies `data/anime-tracker.db` into the local D1. For a local setup code or backup email, copy `.dev.vars.example` to `.dev.vars`.

## Stack

- **Vite + React 18** — frontend SPA
- **Hono** — API, shared by both versions
- **better-sqlite3** — database on your PC
- **Cloudflare Workers + D1** — online version
- **Resend** — backup and password-reset email
- **Tailwind CSS** — styling

## Layout

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
  backup.ts             .sql backups and the backup email
  settings.ts           Settings saved from the Settings page
  email.ts              Sends email through Resend
migrations/             Database schema, for both versions (new changes go in a new numbered file)
scripts/                Build, dev, restore, export-sql
data/                   SQLite database (gitignored)
```
