# Anime Seasonal Tracker

Personal anime tracker — schedule your watch list by season, discover what's airing, keep favorites lists, on your local.

## Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| Framework    | Next.js 14 (App Router), React 18, TypeScript           |
| Styling      | Tailwind CSS                                            |
| Persistence  | SQLite via `better-sqlite3` — `data/anime-tracker.db`   |
| Spreadsheets | ExcelJS (`.xlsx` import / export)                       |

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

- **Schedule** — group anime by day of week, set broadcast time + platform link, today's day is highlighted, aired entries strike through
- **Discover by Season** — pick any Winter/Spring/Summer/Fall + year, browse top anime, filter by tags, search within results, LRU-cache of last 4 selections
- **Collection** — Favorites + Interested sections, sort by released date / added date / title / score, tag filter
- **Import/Export `.xlsx`** — schedule and collection each have their own format with `=IMAGE()` formulas and Thai day colors


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
  HDiscoverPage.tsx            # H-specific: status/tag/sort filters
  HFavoritesPage.tsx           # the separate H favorites view
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

## Database

Everything you add — schedule, collection, favorites, discover cache, prefs — is stored in `data/anime-tracker.db`. 

**Backup / restore:** copy the `data/` folder. Drop it back in to restore.

## Credits

Anime metadata, season listings, and tag taxonomy are sourced from **[AniList](https://anilist.co/)** via their free public [GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/).
