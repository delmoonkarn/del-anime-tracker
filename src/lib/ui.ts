// Shared class strings for the Explore / Watchlist / Detail pages, so the
// same "surface", pill and button looks are spelled out once.

/** A raised panel: card background with a hairline border. */
export const SURFACE = 'bg-zinc-900 border border-zinc-800 rounded-xl';

/** Small uppercase label above a group of controls or a fact. */
export const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wider text-zinc-500';

/** Small neutral button. */
export const BTN =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Small primary (cyan) button. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Square icon-only button. */
export const BTN_ICON =
  'inline-flex items-center justify-center w-8 h-8 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Native <select> / text input. */
export const FIELD =
  'h-8 px-3 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm';

/** Floating menu panel under a dropdown button. One step lighter than the
 *  cards it opens over, with a bright border and a deep shadow, so it never
 *  blends into what's behind it. Pops in. */
export const MENU =
  'bg-zinc-800 border border-zinc-600 rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.7)] overflow-hidden z-30 motion-safe:animate-pop-in';

/** A dialog's panel (over the dimmed page): same border as MENU, pops in. */
export const DIALOG =
  'bg-zinc-900 border border-zinc-600 rounded-2xl shadow-2xl motion-safe:animate-pop-in';

/** The dimmed layer behind a dialog; fades in. */
export const DIALOG_BACKDROP =
  'fixed inset-0 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm motion-safe:animate-fade-in';

/** Favorite / Interested icon on a poster: no box behind it, just a dark
 *  outline so it stays readable on bright artwork. */
export const POSTER_ICON = 'grid h-8 w-8 place-items-center drop-shadow-[0_0_3px_rgba(0,0,0,0.85)]';

/** A row inside a MENU (icon + label). */
export const MENU_ITEM = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-700';

/** Rounded filter chip (format pills on Explore, day pills on Watchlist). */
export const pillClass = (active: boolean, tone: 'primary' | 'info' = 'primary') =>
  `inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
    active
      ? tone === 'info'
        ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
        : 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300'
      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
  }`;

export const FORMAT_LABEL: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

export const AIRING_STATUS_LABEL: Record<string, string> = {
  RELEASING: 'Airing',
  FINISHED: 'Finished',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};
