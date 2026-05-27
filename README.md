# Anime Tracker (v2 — Vite + Hono)

Same app, lighter shell. Migrated off Next.js to:

- **Vite + React** for the frontend (SPA, no SSR overhead)
- **Hono** for the tiny API server (replaces Next.js API routes)
- **better-sqlite3** for storage (unchanged — same `.db` file format)

Functionally identical to v1.0.0 / v1.1.0 — every component, lib, and
DB migration came across as-is.

## Run

```bash
# first time
npm install

# dev: Vite on :5173 (frontend) + Hono on :3001 (API), in parallel
npm run dev

# open http://localhost:5173
```

The Vite dev server proxies `/api/*` to Hono automatically.

## Production build

```bash
npm run build       # → dist/
npm start           # Hono serves dist/ + /api on :3001
```

Open <http://localhost:3001>.

## Layout

```
package.json
vite.config.ts       # frontend dev server + /api proxy
tsconfig.json
tailwind.config.ts
postcss.config.js
index.html           # SPA shell
server/              # Node-only
  index.ts           # Hono entry + routes
  db.ts              # better-sqlite3 schema + migrations
src/                 # browser-only
  main.tsx           # ReactDOM entry
  App.tsx            # top-level state + view routing
  globals.css        # tailwind + scrollbar + body gradient
  components/        # 14 React components, unchanged
  lib/               # types, utils, anilist, storage, import/export
  hooks/             # useDebounce
data/                # SQLite DB lives here (gitignored)
```

## Storage

<<<<<<< Updated upstream
Everything you add — schedule, collection, favorites, discover cache, tags, prefs — is stored in `data/anime-tracker.db`. Schema is created and migrated automatically on first run.
=======
<<<<<<< HEAD
`data/anime-tracker.db` — same SQLite file as v1.x. To migrate from the
old project: copy the `data/` folder over. Schema migrations run on
first launch.
=======
Everything you add — schedule, collection, favorites, discover cache, tags, prefs — is stored in `data/anime-tracker.db`. Schema is created and migrated automatically on first run.
>>>>>>> a404db901744c861da46017312f2e458ddfc9a45
>>>>>>> Stashed changes

## Why this rewrite

| | v1.x (Next.js) | v2.x (Vite + Hono) |
|---|---|---|
| `node_modules` | ~300 MB | ~120 MB |
| Dev server RAM | ~250 MB | ~120 MB |
| Cold dev startup | 3–5 s | ~300 ms |
| HMR latency | ~500 ms | ~50 ms |
| Production bundle | ~2 MB | ~600 KB |
| Build time | ~30 s | ~5 s |

No functional changes — schedule tracker, watch progress, behind alert,
shared progress, Discover with format blocks and Continuing section,
xlsx + JSON I/O, DB zip backup, AniList error handling — all identical.
