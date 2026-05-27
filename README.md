# Anime Tracker

Personal seasonal anime tracker with AniList integration. Tracks watch progress, manages favorites, and stores everything locally.

<img width="1286" height="918" alt="image" src="https://github.com/user-attachments/assets/6b1c32c2-85a1-4272-9f94-9bfe9879c6a2" />

## Features

- Seasonal browser backed by AniList GraphQL
- Watch status, current episode, score, and notes per show
- Progress shared by AniList ID across split-cour or repeat-airing entries
- Tag system, search, and filtering
- Excel and JSON import/export
- Database backup as a downloadable zip

## Requirements

- Node.js 22+
- Windows (the bundled `ATracker.exe` launcher is Windows-only; the app itself is cross-platform)

## Quick start

```bash
npm install
npm run build
npm start
```

Opens at <http://localhost:3001>.

On Windows, double-clicking `ATracker.exe` runs the same flow: installs dependencies if missing, builds if `dist/` is absent, then starts the server and opens the browser.

## Development

```bash
npm run dev
```

Runs Vite on `:5173` (frontend with HMR) and Hono on `:3001` (API) in parallel. Vite proxies `/api/*` to Hono automatically. Open <http://localhost:5173>.

## Stack

- **Vite + React 18** — frontend SPA
- **Hono** — API server (Node)
- **better-sqlite3** — local persistence
- **Tailwind CSS** — styling

## Layout

```
index.html              SPA shell
src/                    Frontend
  main.tsx              ReactDOM entry
  App.tsx               Top-level state and view routing
  components/           React components
  lib/                  Types, AniList client, storage, import/export
  hooks/
server/                 Backend
  index.ts              Hono entry and routes
  db.ts                 SQLite schema and migrations
scripts/                Build and launch tooling
data/                   SQLite database (gitignored)
```

## Storage

All data — schedule, collection, favorites, Discover cache, tags, preferences — lives in `data/anime-tracker.db`. Schema and migrations run automatically on first launch.

To back up the database, request `/api/db-zip` from the running app.
