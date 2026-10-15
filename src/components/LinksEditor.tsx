import { Plus, X } from 'lucide-react';
import type { StreamLink } from '@/lib/types';
import { normalizeStreamUrl, serviceName } from '@/lib/streamLinks';

/** Drops blank / invalid rows, cleans the URL ("netflix.com/x" →
 *  "https://netflix.com/x") and fills an empty name automatically
 *  ("Netflix" for netflix.com, otherwise the site's address). */
export function cleanLinks(links: StreamLink[]): StreamLink[] {
  const seen = new Set<string>();
  const out: StreamLink[] = [];
  for (const l of links) {
    const url = normalizeStreamUrl(l.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ site: l.site.trim() || serviceName(url), url });
  }
  return out;
}

const INPUT =
  'min-w-0 px-3 py-2 rounded-lg bg-zinc-950 border focus:border-indigo-500 outline-none text-sm';

/** Editable list of your "where to watch" links: URL + optional name per
 *  row. The name box shows the name that will be used if left empty. */
export function LinksEditor({
  links,
  onChange,
  max,
  stacked = false,
}: {
  links: StreamLink[];
  onChange: (links: StreamLink[]) => void;
  /** Caps the number of rows (unbound schedule entries only hold one). */
  max?: number;
  /** URL and name on separate rows, each labelled — for narrow spots like
   *  the detail page's sidebar. */
  stacked?: boolean;
}) {
  const set = (i: number, patch: Partial<StreamLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = max === undefined || links.length < max;

  return (
    <div className="flex flex-col gap-2">
      {links.map((l, i) => {
        const normalized = normalizeStreamUrl(l.url);
        const invalid = l.url.trim() !== '' && normalized === null;
        const urlInput = (
          <input
            type="url"
            inputMode="url"
            value={l.url}
            onChange={(e) => set(i, { url: e.target.value })}
            placeholder="https://…"
            aria-label="Link"
            aria-invalid={invalid}
            className={`${INPUT} w-full flex-1 ${invalid ? 'border-red-500/70' : 'border-zinc-800'}`}
          />
        );
        const nameInput = (
          <input
            value={l.site}
            onChange={(e) => set(i, { site: e.target.value })}
            placeholder={normalized ? serviceName(normalized) : stacked ? 'Filled in from the link' : 'Name (optional)'}
            aria-label="Name (optional — filled in from the link)"
            title="Optional — left empty, the service name is filled in from the link"
            className={`${INPUT} border-zinc-800 ${stacked ? 'w-full' : 'w-36 shrink-0'}`}
          />
        );
        const removeButton = (
          <button
            type="button"
            onClick={() => onChange(links.filter((_, j) => j !== i))}
            className={`shrink-0 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-red-300 ${stacked ? '-m-1 p-1' : 'p-2'}`}
            aria-label="Remove link"
            title="Remove link"
          >
            <X className="w-4 h-4" />
          </button>
        );
        return (
          <div
            key={i}
            className={stacked ? 'flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2' : 'flex flex-col gap-1'}
          >
            {stacked ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Link</span>
                  {removeButton}
                </div>
                {urlInput}
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Name <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                {nameInput}
              </>
            ) : (
              <div className="flex items-center gap-2">
                {urlInput}
                {nameInput}
                {removeButton}
              </div>
            )}
            {invalid && (
              <p className="text-xs text-red-300" role="alert">
                Not a valid web address, e.g. https://www.netflix.com/title/… (this row won't be saved)
              </p>
            )}
          </div>
        );
      })}
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
    </div>
  );
}
