'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ExternalLink,
  Heart,
  MoreVertical,
  Plus,
  X,
} from 'lucide-react';
import type { DiscoverItem } from '@/lib/types';

interface Props {
  item: DiscoverItem;
  alreadyAdded: boolean;
  onAdd: () => void;
  onRemove?: () => void;
  favorited?: boolean;
  interested?: boolean;
  onToggleFavorite?: () => void;
  onToggleInterested?: () => void;
}

function DiscoverActionMenu({
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
}: {
  favorited?: boolean;
  interested?: boolean;
  onToggleFavorite?: () => void;
  onToggleInterested?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!onToggleFavorite && !onToggleInterested) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded-full bg-black/70 backdrop-blur text-zinc-200 hover:bg-zinc-700"
        title="More actions"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleFavorite();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-rose-500 hover:text-white text-left"
            >
              <Heart
                className={`w-3.5 h-3.5 ${favorited ? 'fill-current text-rose-400' : ''}`}
              />
              {favorited ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          {onToggleInterested && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleInterested();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-sky-500 hover:text-white text-left border-t border-zinc-800"
            >
              <Bookmark
                className={`w-3.5 h-3.5 ${interested ? 'fill-current text-sky-400' : ''}`}
              />
              {interested ? 'Not interested' : 'Interested'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DiscoverCard({
  item,
  alreadyAdded,
  onAdd,
  onRemove,
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
}: Props) {
  return (
    <div className="group bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg hover:border-zinc-700 transition-colors">
      <a
        href={`https://anilist.co/anime/${item.anilistId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full aspect-[2/3] bg-zinc-800 relative"
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : null}
        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
          {interested && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-sky-400"
              title="In your Interested list"
            >
              <Bookmark className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
          {favorited && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-rose-400"
              title="In your Favorites"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
        </div>
        <div
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.preventDefault()}
        >
          <DiscoverActionMenu
            favorited={favorited}
            interested={interested}
            onToggleFavorite={onToggleFavorite}
            onToggleInterested={onToggleInterested}
          />
        </div>
      </a>

      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div>
          <h3 className="font-bold text-sm leading-tight line-clamp-2" title={item.title}>
            {item.title}
          </h3>
          {item.titleEnglish && (
            <p
              className="text-[10px] text-zinc-500 line-clamp-1 leading-tight mt-0.5"
              title={item.titleEnglish}
            >
              {item.titleEnglish}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
          {item.format && <span className="uppercase font-semibold">{item.format}</span>}
          {item.episodes != null && <span>{item.episodes} eps</span>}
          {item.averageScore != null && (
            <span className="text-amber-300">★ {item.averageScore}%</span>
          )}
        </div>

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {/* Card shows only the top 5 highest-ranked tags; full list lives
                on the entry so search/filter still works against everything. */}
            {item.tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {item.description && (
          <p className="text-[11px] text-zinc-400 line-clamp-3 leading-relaxed whitespace-pre-line">
            {item.description}
          </p>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <a
            href={`https://anilist.co/anime/${item.anilistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-indigo-300"
          >
            <ExternalLink className="w-3 h-3" />
            AL
          </a>
          {onRemove ? (
            <button
              onClick={onRemove}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-red-500 hover:text-white text-zinc-300 text-[11px] font-medium border border-zinc-700"
              title="Remove"
            >
              <X className="w-3 h-3" />
              Remove
            </button>
          ) : alreadyAdded ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium">
              <Check className="w-3 h-3" />
              Added
            </span>
          ) : (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-medium"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
