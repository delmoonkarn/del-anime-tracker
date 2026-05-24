# Anime Seasonal Tracker

Personal anime tracker — schedule your watch list by season, discover what's airing, keep favorites lists, on your local.

<img width="1285" height="912" alt="image" src="https://github.com/user-attachments/assets/e86c8e57-f88e-45a0-b566-16ee28c26bea" />

## Stack

| Layer        |                                                         |
|--------------|---------------------------------------------------------|
| Framework    | Next.js 14 (App Router), React 18, TypeScript           |
| Styling      | Tailwind CSS                                            |
| Storage      | SQLite via `better-sqlite3` — `data/anime-tracker.db`   |
| Spreadsheets | ExcelJS (`.xlsx` import / export)                       |
| External API | [AniList](https://anilist.co/) GraphQL |

## Run it

Easiest — double-click **`ATracker.exe`** (Windows, included in the repo). It runs the dev server and opens your browser at <http://localhost:3000> automatically. Closing the console shuts everything down cleanly.

Equivalent via terminal:

```bash
# first time
npm install
npm run dev
```

Or double-click **`run.bat`**.

> **Requires** Node.js 18+ on PATH. Without it both `ATracker.exe` and `npm install` will fail. Download: <https://nodejs.org/>

## Features

### Schedule
- Group anime by day of week, set broadcast time + platform link
- **Today** column highlighted (only on the current calendar season); aired entries dim + strike through
- **Episode progress** — `+/−` counter per card with denominator from AniList (`3 / 12`)
- **Watch status** pill — *Watching · Completed · Dropped · On Hold · Plan to Watch* — with auto-flips (`Plan → Watching` on first `+`, `Watching → Completed` at cap)
- **Status filter pills** above the grid, including a **Behind** pill that surfaces shows where aired-episode count exceeds watched
- **Airing-vs-watched indicator** on the card — `ep 6 aired · 2 behind` + countdown to the next episode (pulled from AniList's `nextAiringEpisode`, batch-refreshed once per app start)
- **Behind alert** — bright orange shine on actively-watching shows you're behind on; dropped shows dim out
- **Auto-fills day + air-time** from AniList when adding a new show; fields remain editable

### Discover by Season
- Pick any Winter / Spring / Summer / Fall + year, or **"— All year —"** to drop the season filter and browse the whole year
- Tag filter, search within results, LRU cache of the last 4 `{season, year, tags}` combos

### Collection
- Favorites + Interested sections, sort by released date / added date / title / score, tag filter
- Full tag list cached per entry (card shows top 5); enrichment job backfills older entries

### Import / Export
- **`.xlsx`** — schedule and collection each have their own format with `=IMAGE()` formulas, Thai-pastel day colors, and full watch-progress round-trip (status / watched / total columns)
- **`.json`** — lossless scope-bounded backup for Schedule and Collection (faster than xlsx; preserves every field). Restore merges new entries and updates matching ones — never deletes
- xlsx bulk-bind hits AniList to enrich imported titles with cover, episodes, and airing data automatically

### Reliability
- AniList outages surface a clear message in the search dropdown (`"AniList API is currently disabled by AniList…"`) instead of the browser's generic *Failed to fetch*
- Background airing refresh + metadata backfill are idempotent and gated to the current season to keep API calls modest

## Project layout

```
app/
  api/storage/[key]/route.ts   # GET/PUT/POST → reads/writes the SQLite DB
  layout.tsx                   # wraps the app in <ConfirmProvider>
  page.tsx                     # owns state, handlers, view routing
  globals.css                  # tailwind base + scrollbar + body gradients
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
  EmptyState.tsx               # fallback "no data yet" panel
lib/
  db.ts                        # SQLite schema + read/write per key (server-only)
  storage.ts                   # client adapter — async load + debounced save via API
  types.ts                     # AppState, Season, AnimeEntry, CollectionEntry, etc.
  anilist.ts                   # GraphQL queries
  discover.ts                  # API → DiscoverItem mapper
  import.ts                    # parse schedule + collection from xlsx and json
  export.ts                    # write schedule + collection to xlsx and json
  utils.ts                     # day constants, season helpers, tag matching, id gen
hooks/
  useDebounce.ts
data/                          # SQLite DB lives here (gitignored)
```

## Storage

Everything you add — schedule, collection, favorites, discover cache, tags, prefs — is stored in `data/anime-tracker.db` (SQLite, WAL journal). Schema is created and migrated automatically on first run.

**Backup**
- **Easiest:** copy the `data/` folder somewhere safe.
- **In-app:** use the I/O dropdown in Schedule or Collection → *Backup .json* — lossless scope-bounded backup that's small and human-readable.

**Restore**
- File copy: drop your `data/` folder back into place.
- In-app: I/O dropdown → *Restore .json*. New entries are appended; existing entries (matched by AniList ID + section / season name) are updated. Nothing is deleted.

## Credits

Anime metadata, season listings, and tag taxonomy are sourced from **[AniList](https://anilist.co/)** via their free public [GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/).
