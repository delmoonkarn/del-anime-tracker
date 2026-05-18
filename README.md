# Anime Seasonal Tracker

Personal anime tracker — schedule your watch list by season, discover what's airing, keep favorites lists, on your local.

## Stack

- **Next.js 14** (App Router) + React 18 + TypeScript
- **Tailwind CSS** with a custom cyber palette (deep navy + electric cyan/magenta/purple)
- **SQLite** (via `better-sqlite3`) — `data/anime-tracker.db`
- **ExcelJS** — `.xlsx` import/export for both schedule and collection
- **Lucide React** — icons

## Run it

Easiest — double-click **`ATracker.exe`** (Windows, included in the repo). It runs the dev server and opens your browser at <http://localhost:3000> automatically. Closing the console shuts everything down cleanly.

Equivalent via terminal:

```bash
# first time
npm install
npm run dev
```

Or double-click **`run.bat`**.

## Features

- **Schedule** — group anime by day of week, set Thai broadcast time + platform link, today's day is highlighted, aired entries strike through
- **Discover by Season** — pick any Winter/Spring/Summer/Fall + year, browse top anime, filter by tags, search within results, LRU-cache of last 4 selections
- **Hentai** — separate page, separate DB table (`hentai_favorites`), independent sort/filter prefs
- **Collection** — Favorites + Interested sections, sort by released date / added date / title / score, tag filter
- **Import/Export `.xlsx`** — schedule and collection each have their own format with `=IMAGE()` formulas and Thai day colors
- **Confirmation dialogs** styled to match the theme (no browser popups)

## Project layout

```
app/
  api/storage/[key]/route.ts   # GET/PUT/POST → reads/writes the SQLite DB
  layout.tsx                   # wraps the app in <ConfirmProvider>
  page.tsx                     # owns state, handlers, view routing
  globals.css                  # tailwind + cyber-themed body/scrollbar/gradients
components/
  SeasonSelector.tsx           # header: title, season split-button, Collection, Discover split
  ScheduleGrid.tsx             # toolbar (search + Add + I/O), card grid by day
  AnimeCard.tsx                # schedule card + 3-dot menu (Edit/Favorite/Interested/Delete)
  AddAnimeModal.tsx            # search + manual schedule fields
  AddToCollectionModal.tsx     # search → add to collection
  DiscoverPage.tsx             # season picker + tag filter + grid, cache-aware
  DiscoverCard.tsx             # discover card (cover + meta + add/favorite/interested)
  HentaiDiscoverPage.tsx       # hentai-specific: status/tag/sort filters
  HentaiFavoritesPage.tsx      # the separate hentai favorites view
  CollectionPage.tsx           # Favorites / Interested with sort + tag filter + I/O
  ConfirmDialog.tsx            # <ConfirmProvider> + useConfirm() hook
  ManageSeasonsModal.tsx       # batch delete seasons
  TagFilterPicker.tsx          # multi-select tag picker with Enter-to-add
  EmptyState.tsx
lib/
  db.ts                        # SQLite schema + read/write per key (server-only)
  storage.ts                   # client adapter — async load + debounced save via API
  types.ts                     # AppState, Season, AnimeEntry, CollectionEntry, etc.
  anilist.ts                   # GraphQL queries
  discover.ts                  # API → DiscoverItem mapper
  import.ts                    # parse schedule + collection xlsx
  export.ts                    # write schedule + collection xlsx
  utils.ts                     # day constants, season helpers, tag matching, id gen
hooks/
  useDebounce.ts
data/                          # SQLite DB lives here (gitignored)
```

## Database (SQLite)

`data/anime-tracker.db` — open in [DB Browser for SQLite](https://sqlitebrowser.org/) to inspect:

| Table | What |
|---|---|
| `seasons` | id, name, created_at |
| `anime_entries` | FK season_id + anilist_id, titles, image, day, time, platform, status, added_at |
| `collection` | (anilist_id, section) PK + titles, image, tags, format, eps, score, start date, added_at |
| `hentai_favorites` | same shape as `collection` but no section (separate table by design) |
| `discover_cache` | LRU cache (up to 4) of fetched season grids |
| `kv_store` | `activeSeasonId`, `tags`, `hentai-prefs` |

All writes are debounced 300 ms on the client side, sent as PUT/POST to `/api/storage/<key>`, and applied to the DB in a single SQLite transaction. Atomic writes; crash-safe via WAL.

## Credits

Anime metadata, season listings, and tag taxonomy are sourced from **[AniList](https://anilist.co/)** via their free public [GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/).
