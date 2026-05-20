'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Compass,
  Download,
  Heart,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { DiscoverVariant, Season } from '@/lib/types';
import { getCurrentSeasonName, seasonRank } from '@/lib/utils';
import { useConfirm } from './ConfirmDialog';

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
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const discoverRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  /** Confirmation-gated DB zip download. <a download> alone would
   *  fire immediately; this lets the user back out if they misclicked. */
  async function handleDbDownload() {
    const ok = await confirm({
      title: 'Download database backup',
      message:
        'Download a zip of your current database (anime-tracker.db)? The WAL is flushed first so the file is a clean point-in-time snapshot.',
      confirmText: 'Download',
    });
    if (!ok) return;
    // Programmatic click on a temporary <a> so the browser handles the
    // Content-Disposition filename and save dialog.
    const a = document.createElement('a');
    a.href = '/api/db-zip';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

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

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/40 backdrop-blur sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onJumpHome}
          className="flex items-center gap-2 shrink-0 group"
          title="Go to current season's schedule"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Anime Tracker"
            className="w-8 h-8 rounded-lg group-hover:drop-shadow-[0_0_8px_rgba(0,163,255,0.6)] transition-all"
          />
          <h1 className="font-semibold text-sm hidden sm:block group-hover:text-indigo-300 transition-colors">
            Anime Tracker
          </h1>
        </button>
        <div className="h-6 w-px bg-zinc-800 shrink-0 hidden sm:block" />

        {/* Season split-button: name jumps to current schedule, chevron toggles dropdown */}
        <div ref={wrapperRef} className="relative flex-1 min-w-0">
          <div
            className={`inline-flex items-stretch rounded-full overflow-hidden max-w-full transition-colors ${
              isScheduleActive
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-800 text-zinc-100'
            }`}
          >
            <button
              type="button"
              onClick={onJumpHome}
              className={`flex items-center gap-2 pl-4 pr-2 py-1.5 text-sm font-medium min-w-0 transition-colors ${
                isScheduleActive ? 'hover:bg-indigo-600' : 'hover:bg-zinc-700'
              }`}
              title="Go to current season's schedule"
            >
              <span className="truncate">
                {activeSeason?.name ?? 'No season selected'}
              </span>
              {activeSeason && isCurrent(activeSeason.name) && (
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              {activeSeason && (
                <span className="text-xs opacity-70 shrink-0">
                  ({activeSeason.animes.length})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className={`pl-1 pr-2 py-1.5 border-l transition-colors ${
                isScheduleActive
                  ? 'border-indigo-400/40 hover:bg-indigo-600'
                  : 'border-zinc-700 hover:bg-zinc-700'
              }`}
              title="Switch season"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {open && (
            <div className="absolute left-0 mt-2 w-72 max-w-[90vw] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-30">
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
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 ${
                          active ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-200'
                        }`}
                      >
                        <span className="truncate flex items-center gap-1.5">
                          {s.name}
                          {current && (
                            <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                          )}
                        </span>
                        <span className="text-xs text-zinc-500 shrink-0">
                          {s.animes.length}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {seasons.length === 0 && (
                  <li className="px-3 py-3 text-sm text-zinc-500 text-center">
                    No seasons yet.
                  </li>
                )}
              </ul>

              {/* Bottom action row: + New Season on the left, Manage pen on the right */}
              <div className="border-t border-zinc-800 p-2 flex items-center gap-2">
                {creating ? (
                  <form onSubmit={handleCreate} className="flex gap-1 flex-1">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Winter 2026"
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none"
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
                    className="flex-1 flex items-center gap-2 px-2 py-2 text-sm text-zinc-300 hover:text-indigo-300 hover:bg-zinc-800/60 rounded-md"
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
                    className="p-2 rounded-md text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800/60 shrink-0"
                    title="Manage seasons"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Collection button */}
        <button
          type="button"
          onClick={() => onDiscover('collection')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0 ${
            activeDiscoverVariant === 'collection'
              ? 'bg-rose-500 text-white hover:bg-rose-600'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
          }`}
          title="My Collection (favorites)"
        >
          <Heart
            className={`w-4 h-4 ${activeDiscoverVariant === 'collection' ? 'fill-current' : ''}`}
          />
          <span className="hidden sm:inline">Collection</span>
        </button>

        {/* Discover split-button: main click jumps to season discover; arrow opens dropdown */}
        <div ref={discoverRef} className="relative shrink-0">
          <div
            className={`inline-flex items-stretch rounded-full overflow-hidden text-sm font-medium transition-colors ${
              activeDiscoverVariant === 'season' || activeDiscoverVariant === 'h'
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-800 text-zinc-300'
            }`}
          >
            <button
              type="button"
              onClick={() => onDiscover('season')}
              className={`inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 transition-colors ${
                activeDiscoverVariant === 'season' || activeDiscoverVariant === 'h'
                  ? 'hover:bg-indigo-600'
                  : 'hover:bg-zinc-700 hover:text-zinc-100'
              }`}
              title="Discover by Season"
            >
              <Compass className="w-4 h-4" />
              <span className="hidden sm:inline">Discover</span>
            </button>
            <button
              type="button"
              onClick={() => setDiscoverOpen((o) => !o)}
              className={`pl-1 pr-2 py-1.5 border-l transition-colors ${
                activeDiscoverVariant === 'season' || activeDiscoverVariant === 'h'
                  ? 'border-indigo-400/40 hover:bg-indigo-600'
                  : 'border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100'
              }`}
              title="Switch discover mode"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  discoverOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          {discoverOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-30">
              <button
                type="button"
                onClick={() => {
                  onDiscover('season');
                  setDiscoverOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 ${
                  activeDiscoverVariant === 'season'
                    ? 'bg-indigo-500/10 text-indigo-200'
                    : 'text-zinc-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Discover by Season
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onDiscover('h');
                  setDiscoverOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 border-t border-zinc-800 ${
                  activeDiscoverVariant === 'h'
                    ? 'bg-indigo-500/10 text-indigo-200'
                    : 'text-zinc-200'
                }`}
              >
                <span>H</span>
                <span className="text-xs text-rose-400">Browse</span>
              </button>
            </div>
          )}
        </div>

        {/* DB zip backup — confirmation-gated. On confirm, fires a
            programmatic click that hits /api/db-zip and the browser
            handles the save dialog from the Content-Disposition header. */}
        <button
          type="button"
          onClick={handleDbDownload}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors shrink-0"
          title="Download database as .zip"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
