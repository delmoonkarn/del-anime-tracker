import { Plus, X } from 'lucide-react';
import type { StreamLink } from '@/lib/types';
import { PLATFORM_PRESETS } from '@/lib/utils';

/** Drops blank rows and fills a missing name from the URL's host. */
export function cleanLinks(links: StreamLink[]): StreamLink[] {
  const seen = new Set<string>();
  const out: StreamLink[] = [];
  for (const l of links) {
    const url = l.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let site = l.site.trim();
    if (!site) {
      try {
        site = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        site = url;
      }
    }
    out.push({ site, url });
  }
  return out;
}

const INPUT =
  'min-w-0 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm';

/** Editable list of "where to watch" links: name + URL per row. */
export function LinksEditor({
  links,
  onChange,
  max,
}: {
  links: StreamLink[];
  onChange: (links: StreamLink[]) => void;
  /** Caps the number of rows (unbound schedule entries only hold one). */
  max?: number;
}) {
  const set = (i: number, patch: Partial<StreamLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = max === undefined || links.length < max;

  return (
    <div className="flex flex-col gap-2">
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={l.site}
            onChange={(e) => set(i, { site: e.target.value })}
            list="platform-presets"
            placeholder="Netflix"
            aria-label="Service name"
            className={`${INPUT} w-32 shrink-0`}
          />
          <input
            type="url"
            value={l.url}
            onChange={(e) => set(i, { url: e.target.value })}
            placeholder="https://…"
            aria-label="Link"
            className={`${INPUT} flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(links.filter((_, j) => j !== i))}
            className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
            aria-label="Remove link"
            title="Remove link"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={() => onChange([...links, { site: '', url: '' }])}
          className="inline-flex items-center gap-1.5 self-start px-2.5 py-1.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-indigo-300"
        >
          <Plus className="w-4 h-4" />
          {links.length === 0 ? 'Add streaming link' : 'Add another link'}
        </button>
      )}
      <datalist id="platform-presets">
        {PLATFORM_PRESETS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  );
}
