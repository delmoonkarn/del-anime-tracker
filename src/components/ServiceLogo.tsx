import { useState } from 'react';
import type { StreamLink } from '@/lib/types';

function faviconUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return null;
  }
}

/**
 * Logo for a streaming link, always a full rounded tile: the site's own
 * favicon, and the first letter of the name as a last resort.
 */
export function ServiceLogo({ link, className = 'w-5 h-5' }: { link: StreamLink; className?: string }) {
  const icon = faviconUrl(link.url);
  // The icon URL that turned out to be missing (load error or Google's globe).
  const [missing, setMissing] = useState<string | null>(null);
  const src = icon !== missing ? icon : null;
  const base = `inline-grid shrink-0 place-items-center overflow-hidden rounded-[22%] ${className}`;

  if (src) {
    return (
      <span className={`${base} bg-white`} aria-hidden>
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setMissing(src)}
          // Google answers "no icon" with a 16 px globe; show the letter instead.
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth <= 16) setMissing(src);
          }}
          className="w-full h-full object-cover"
        />
      </span>
    );
  }
  return (
    <span className={`${base} bg-zinc-700 text-[0.6rem] font-bold text-zinc-200`} aria-hidden>
      {link.site.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Row of clickable channel icons (bottom-left of a poster, or inline in a row). */
export function ServiceLinks({
  links,
  title,
  max = 4,
  size = 'w-7 h-7',
  className = '',
}: {
  links: StreamLink[];
  title: string;
  max?: number;
  size?: string;
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {links.slice(0, max).map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-[22%] shadow-md ring-1 ring-black/30 transition-transform hover:scale-110"
          aria-label={`Watch ${title} on ${l.site}`}
          title={`Watch on ${l.site}`}
        >
          <ServiceLogo link={l} className={size} />
        </a>
      ))}
    </div>
  );
}
