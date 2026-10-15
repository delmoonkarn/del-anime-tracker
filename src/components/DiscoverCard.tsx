import { Check, ExternalLink, Plus, X } from 'lucide-react';
import type { DiscoverItem } from '@/lib/types';

interface Props {
  item: DiscoverItem;
  alreadyAdded: boolean;
  onAdd: () => void;
  onRemove?: () => void;
}

/** Card for the H Discover / H Favorites pages: poster (links to AniList),
 *  titles, format line, top tags, description, and Add / Added / Remove. */
export function DiscoverCard({
  item,
  alreadyAdded,
  onAdd,
  onRemove,
}: Props) {
  const poster = item.imageUrl ? (
    <img src={item.imageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
  ) : null;
  return (
    <div className="group bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg hover:border-zinc-700 transition-colors">
      <div className="relative">
        <a
          href={`https://anilist.co/anime/${item.anilistId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full aspect-[2/3] bg-zinc-800"
        >
          {poster}
        </a>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div>
          <h3 className="font-bold text-sm leading-tight line-clamp-2" title={item.title}>
            {item.title}
          </h3>
          {item.titleEnglish && (
            <p
              className="text-xs text-zinc-300 line-clamp-1 leading-tight mt-0.5"
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
