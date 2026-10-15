import { useState } from 'react';
import type { StreamLink } from '@/lib/types';
import { iconDomain } from '@/lib/streamLinks';
import { useBrandFor } from '@/lib/nav';

function faviconUrl(link: StreamLink): string | null {
  const domain = iconDomain(link);
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}

/**
 * Logo for a streaming link, always a full square tile: the service's brand
 * icon on its brand colour (AniList's catalogue — for AniList's links and for
 * your own links to a service AniList knows); otherwise the site's own icon
 * filling the tile, and the first letter of the name as a last resort.
 */
export function ServiceLogo({ link, className = 'w-5 h-5' }: { link: StreamLink; className?: string }) {
  // The icon URL that turned out to be missing (load error or Google's globe).
  const [missing, setMissing] = useState<string | null>(null);
  const brand = useBrandFor()(link);
  const base = `inline-grid shrink-0 place-items-center overflow-hidden ${className}`;

  if (brand && missing !== brand.icon) {
    const icon = brand.icon;
    return (
      <span className={base} style={{ backgroundColor: brand.color ?? '#0A1435' }} aria-hidden>
        <img src={icon} alt="" loading="lazy" onError={() => setMissing(icon)} className="w-[70%] h-[70%] object-contain" />
      </span>
    );
  }
  const favicon = faviconUrl(link);
  if (favicon && missing !== favicon) {
    return (
      <span className={`${base} bg-zinc-800`} aria-hidden>
        <img
          src={favicon}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setMissing(favicon)}
          // Google answers "no icon" with a 16 px globe; show the letter instead.
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth <= 16) setMissing(favicon);
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
          className="shadow-md ring-1 ring-black/30 transition-transform hover:scale-110"
          aria-label={`Watch ${title} on ${l.site}`}
          title={`Watch on ${l.site}`}
        >
          <ServiceLogo link={l} className={size} />
        </a>
      ))}
    </div>
  );
}
