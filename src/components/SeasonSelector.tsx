import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Compass,
  Heart,
  Menu,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { DiscoverVariant, Season } from '@/lib/types';
import { getCurrentSeasonName, seasonRank } from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';
import { MENU, MENU_ITEM } from '@/lib/ui';
import { AccountMenu } from './AccountMenu';
import { useConfirm } from './ConfirmDialog';
import { GlobalSearch } from './GlobalSearch';

interface Props {
  seasons: Season[];
  activeSeasonId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onManage: () => void;
  onJumpHome: () => void;
  onDiscover: (variant: DiscoverVariant) => void;
  activeDiscoverVariant: DiscoverVariant | null;
  isScheduleActive: boolean;
  onWatchlist: () => void;
  isWatchlistActive: boolean;
  onSettings: () => void;
}

export function SeasonSelector({
  seasons,
  activeSeasonId,
  onSelect,
  onCreate,
  onManage,
  onJumpHome,
  onDiscover,
  activeDiscoverVariant,
  isScheduleActive,
  onWatchlist,
  isWatchlistActive,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const discoverRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useClickOutside(mobileRef, mobileOpen, closeMobile);
  const confirm = useConfirm();

  const activeSeason = seasons.find((s) => s.id === activeSeasonId) ?? null;
  const currentSeasonName = getCurrentSeasonName().toLowerCase();
  const isCurrent = (n: string) => n.trim().toLowerCase() === currentSeasonName;

  const sortedSeasons = [...seasons].sort((a, b) => {
    const ra = seasonRank(a.name);
    const rb = seasonRank(b.name);
    if (ra != null && rb != null) return rb - ra;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return b.createdAt - a.createdAt;
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        setName('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!discoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (discoverRef.current && !discoverRef.current.contains(e.target as Node)) {
        setDiscoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [discoverOpen]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
    setCreating(false);
    setOpen(false);
  };

  // Split buttons (season, explore) pad their own halves, so padding is separate.
  const navTone = (active: boolean) =>
    `rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-indigo-500/10 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
    }`;
  const navClass = (active: boolean) => `${navTone(active)} px-3 py-1.5`;
  const exploreActive = activeDiscoverVariant === 'season' || activeDiscoverVariant === 'h';

  /** H is behind an 18+ confirm — skipped when already in an H view so
   *  moving between H Discover and H Favorites doesn't re-ask. */
  async function openH() {
    if (activeDiscoverVariant !== 'h') {
      const ok = await confirm({
        title: 'Enter H section',
        message: 'This section contains adult content (18+). Continue?',
        confirmText: 'Continue',
        kind: 'warning',
      });
      if (!ok) return;
    }
    onDiscover('h');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-14 w-full items-center gap-2 px-4 md:gap-3">
        {/* Mobile: the page links collapse into a menu. */}
        <div ref={mobileRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
          {mobileOpen && (
            <ul className={`absolute left-0 mt-2 flex w-52 flex-col gap-0.5 ${MENU} p-1.5`}>
              {[
                { label: 'Schedule', active: isScheduleActive, go: onJumpHome },
                { label: 'Explore', active: activeDiscoverVariant === 'season', go: () => onDiscover('season') },
                { label: 'Watchlist', active: isWatchlistActive, go: onWatchlist },
                { label: 'Collection', active: activeDiscoverVariant === 'collection', go: () => onDiscover('collection') },
                { label: 'H', active: activeDiscoverVariant === 'h', go: openH },
              ].map((n) => (
                <li key={n.label}>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOpen(false);
                      void n.go();
                    }}
                    className={`${MENU_ITEM} text-sm font-medium ${
                      n.active ? 'bg-indigo-500/10 text-indigo-300' : 'text-zinc-300'
                    }`}
                  >
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onJumpHome}
          className="flex items-center gap-2 shrink-0 group"
          title="Go to current season's schedule"
        >
          <img
            src="/logo.png"
            alt="Anime Tracker"
            className="w-8 h-8 rounded-lg group-hover:drop-shadow-[0_0_8px_rgba(0,163,255,0.6)] transition-all"
          />
          <span className="hidden text-[0.95rem] font-bold tracking-tight lg:inline group-hover:text-indigo-300 transition-colors">
            Anime Tracker
          </span>
        </button>

        <nav aria-label="Main" className="ml-1 flex min-w-0 items-center gap-1">
          {/* Schedule: the season name jumps to the current schedule, the
              chevron opens the season list. */}
          <div ref={wrapperRef} className="relative min-w-0">
            <div className={`flex min-w-0 items-stretch overflow-hidden ${navTone(isScheduleActive)}`}>
              <button
                type="button"
                onClick={onJumpHome}
                className="flex min-w-0 items-center gap-1.5 py-1.5 pl-3 pr-1.5"
                title="Go to current season's schedule"
              >
                <span className="truncate">{activeSeason?.name ?? 'No season'}</span>
                {activeSeason && isCurrent(activeSeason.name) && (
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                {activeSeason && (
                  <span className="hidden text-xs opacity-60 shrink-0 sm:inline">{activeSeason.animes.length}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="py-1.5 pl-1 pr-2 hover:text-indigo-300"
                title="Switch season"
                aria-expanded={open}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {open && (
              <div className={`absolute left-0 mt-2 w-72 max-w-[90vw] ${MENU}`}>
                <ul className="max-h-72 overflow-y-auto">
                  {sortedSeasons.map((s) => {
                    const active = s.id === activeSeasonId;
                    const current = isCurrent(s.name);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(s.id);
                            setOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 ${
                            active ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-200'
                          }`}
                        >
                          <span className="truncate flex items-center gap-1.5">
                            {s.name}
                            {current && <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />}
                          </span>
                          <span className="text-xs text-zinc-500 shrink-0">{s.animes.length}</span>
                        </button>
                      </li>
                    );
                  })}
                  {seasons.length === 0 && (
                    <li className="px-3 py-3 text-sm text-zinc-500 text-center">No seasons yet.</li>
                  )}
                </ul>

                {/* Bottom action row: + New Season on the left, Manage pen on the right */}
                <div className="border-t border-zinc-700 p-2 flex items-center gap-2">
                  {creating ? (
                    <form onSubmit={handleCreate} className="flex gap-1 flex-1">
                      <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Winter 2026"
                        className="flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm bg-zinc-950 border border-zinc-700 focus:border-indigo-500 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-md text-sm bg-indigo-500 hover:bg-indigo-600 text-white"
                      >
                        Add
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="flex-1 flex items-center gap-2 px-2 py-2 text-sm text-zinc-300 hover:text-indigo-300 hover:bg-zinc-700/60 rounded-md"
                    >
                      <Plus className="w-4 h-4" />
                      New season
                    </button>
                  )}
                  {seasons.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onManage();
                        setOpen(false);
                      }}
                      className="p-2 rounded-md text-zinc-400 hover:text-indigo-300 hover:bg-zinc-700/60 shrink-0"
                      title="Manage seasons"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Explore: main click opens Explore, the chevron offers H. */}
          <div ref={discoverRef} className="relative hidden shrink-0 md:block">
            <div className={`flex items-stretch ${navTone(exploreActive)}`}>
              <button type="button" onClick={() => onDiscover('season')} className="py-1.5 pl-3 pr-1.5">
                {activeDiscoverVariant === 'h' ? 'H' : 'Explore'}
              </button>
              <button
                type="button"
                onClick={() => setDiscoverOpen((o) => !o)}
                className="py-1.5 pl-1 pr-2 hover:text-indigo-300"
                title="Switch explore mode"
                aria-expanded={discoverOpen}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${discoverOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {discoverOpen && (
              <div className={`absolute left-0 mt-2 w-56 ${MENU}`}>
                <button
                  type="button"
                  onClick={() => {
                    onDiscover('season');
                    setDiscoverOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 ${
                    activeDiscoverVariant === 'season' ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-200'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 text-indigo-300" />
                  Explore by season
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscoverOpen(false);
                    void openH();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 border-t border-zinc-700 ${
                    activeDiscoverVariant === 'h' ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-200'
                  }`}
                >
                  <span>H</span>
                  <span className="text-xs text-rose-400">18+</span>
                </button>
              </div>
            )}
          </div>

          <button type="button" onClick={onWatchlist} className={`hidden shrink-0 md:inline-flex ${navClass(isWatchlistActive)}`}>
            Watchlist
          </button>
          <button
            type="button"
            onClick={() => onDiscover('collection')}
            className={`hidden shrink-0 items-center gap-1.5 md:inline-flex ${navClass(activeDiscoverVariant === 'collection')}`}
          >
            <Heart className={`w-3.5 h-3.5 ${activeDiscoverVariant === 'collection' ? 'fill-current' : ''}`} />
            Collection
          </button>
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <GlobalSearch />
          <AccountMenu onOpenSettings={onSettings} />
        </div>
      </div>
    </header>
  );
}
