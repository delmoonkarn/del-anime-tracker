// "Where to watch" helpers: recognising streaming services, cleaning URLs,
// picking AniList's links, and merging them with your own. Pure functions.

import type { AnilistExternalLink, LinkSource, StreamLink } from './types';

/** A streaming service the app recognises, by hostname or by the link's name. */
interface StreamingService {
  name: string;
  /** Hostname suffixes: "netflix.com" also matches "www.netflix.com". */
  hosts: readonly string[];
  /** Other ways people write the name; compared ignoring case, spaces and punctuation. */
  aliases?: readonly string[];
  /** One site, many channels (YouTube): each link is its own source, so a
   *  link you add only replaces AniList's when it's the same address. */
  channels?: boolean;
}

/** Services common in Thailand and worldwide. Order matters only when two could match. */
const STREAMING_SERVICES: readonly StreamingService[] = [
  { name: 'Netflix', hosts: ['netflix.com'] },
  { name: 'Crunchyroll', hosts: ['crunchyroll.com'] },
  { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], channels: true },
  { name: 'Bilibili', hosts: ['bilibili.tv', 'bilibili.com', 'b23.tv'], aliases: ['bstation', 'bilibili tv'] },
  { name: 'iQIYI', hosts: ['iq.com', 'iqiyi.com'], aliases: ['iqiyi', 'iq'] },
  { name: 'Prime Video', hosts: ['primevideo.com'], aliases: ['amazon prime', 'prime', 'amazon prime video', 'amazon'] },
  { name: 'Disney+', hosts: ['disneyplus.com', 'hotstar.com'], aliases: ['disney plus', 'disney', 'disney+ hotstar'] },
  { name: 'HBO Max', hosts: ['hbomax.com', 'max.com'], aliases: ['max', 'hbo'] },
  { name: 'Apple TV', hosts: ['tv.apple.com'], aliases: ['apple tv+', 'appletv'] },
  { name: 'Paramount+', hosts: ['paramountplus.com'], aliases: ['paramount plus', 'paramount'] },
  { name: 'Viu', hosts: ['viu.com'] },
  { name: 'WeTV', hosts: ['wetv.vip'] },
  { name: 'TrueID', hosts: ['trueid.net'], aliases: ['true id'] },
  { name: 'AIS PLAY', hosts: ['aisplay.ais.co.th'], aliases: ['ais play', 'aisplay'] },
  { name: 'HIDIVE', hosts: ['hidive.com'] },
  { name: 'Hulu', hosts: ['hulu.com'] },
  { name: 'Ani-One', hosts: ['ani-one.com'], aliases: ['anione', 'ani one asia', 'ani-one asia'] },
  { name: 'Muse Asia', hosts: ['museasia.com'], aliases: ['muse', 'muse thailand'] },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '');

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Which service a link belongs to: by hostname first, then by its name. */
export function findService(url: string, label = ''): StreamingService | null {
  const host = hostOf(url);
  if (host) {
    const byHost = STREAMING_SERVICES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (byHost) return byHost;
  }
  const key = squash(label);
  if (!key) return null;
  return STREAMING_SERVICES.find((s) => squash(s.name) === key || s.aliases?.some((a) => squash(a) === key)) ?? null;
}

/** The automatic name for a link: "Netflix" for netflix.com, otherwise the bare hostname. */
export function serviceName(url: string): string {
  return findService(url)?.name ?? hostOf(url) ?? url;
}

/** Name a link is grouped under (Explore's service filter): the recognised
 *  service, otherwise the link's own name. */
export function serviceLabel(link: StreamLink): string {
  return findService(link.url, link.site)?.name ?? link.site;
}

/** Domain whose icon represents the link — always where the link goes (a
 *  recognised service's main domain, otherwise the link's own host). The
 *  name doesn't count: a hareshi.net link named "Bilibili" shows hareshi. */
export function iconDomain(link: StreamLink): string | null {
  return findService(link.url)?.hosts[0] ?? hostOf(link.url);
}

/**
 * Cleans a typed address into an http(s) URL, adding "https://" when the
 * scheme is missing. Returns null when it isn't a usable web address.
 */
export function normalizeStreamUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // A host without a dot ("https://netflix") is almost always a typo.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href;
}

/** Same service: same host (or one a subdomain of the other), or the same
 *  recognised service / name. */
export function sameService(a: StreamLink, b: StreamLink): boolean {
  const ha = hostOf(a.url);
  const hb = hostOf(b.url);
  if (ha && hb && (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`))) return true;
  const sa = squash(serviceLabel(a));
  return sa !== '' && sa === squash(serviceLabel(b));
}

/** Never show a show's official website or its Twitter / X account. */
function isExcluded(l: AnilistExternalLink): boolean {
  const host = hostOf(l.url) ?? '';
  return (
    /official\s*site/i.test(l.site) ||
    /^(twitter|x)$/i.test(l.site.trim()) ||
    host === 'twitter.com' ||
    host.endsWith('.twitter.com') ||
    host === 'x.com' ||
    host.endsWith('.x.com')
  );
}

/** AniList lists a service once per region; prefer the Thai one, then a
 *  region-less one, then English, then whatever's left. */
function languageRank(language: string | null | undefined): number {
  if (!language) return 1;
  if (/thai/i.test(language)) return 0;
  if (/english/i.test(language)) return 2;
  return 3;
}

/** AniList's streaming links for a show: STREAMING type only, enabled, no
 *  official site / Twitter / X, one per service. */
export function toAnilistLinks(links: AnilistExternalLink[] | null | undefined): StreamLink[] {
  const best = new Map<string, AnilistExternalLink>();
  for (const l of links ?? []) {
    if (l.type !== 'STREAMING' || l.isDisabled || !l.url || isExcluded(l)) continue;
    const key = l.site.toLowerCase();
    const cur = best.get(key);
    if (!cur || languageRank(l.language) < languageRank(cur.language)) best.set(key, l);
  }
  return [...best.values()].map((l) => ({
    site: l.site,
    url: l.url,
    icon: l.icon ?? undefined,
    color: l.color ?? undefined,
    fromAnilist: true,
  }));
}

/** Same address, ignoring "www." and a trailing slash. */
function sameUrl(a: string, b: string): boolean {
  const key = (u: string) => (normalizeStreamUrl(u) ?? u).replace(/^(https?:\/\/)www\./i, '$1').replace(/\/$/, '');
  return key(a) === key(b);
}

/** Your links first (in your order), then AniList's for services you don't
 *  already have a link for. On channel sites (YouTube) only the same
 *  address counts: your channel doesn't hide a different one AniList lists. */
export function mergeLinks(own: StreamLink[] | undefined, anilist: StreamLink[] | undefined): StreamLink[] {
  const out = [...(own ?? [])];
  for (const l of anilist ?? []) {
    const covered = findService(l.url, l.site)?.channels
      ? out.some((o) => sameUrl(o.url, l.url))
      : out.some((o) => sameService(o, l));
    if (!covered) out.push(l);
  }
  return out;
}

/** A service's brand icon and colour (from AniList). */
export interface Brand {
  icon: string;
  color?: string;
}

export interface BrandIndex {
  /** Host patterns from AniList's catalogue ("bilibili.tv", "netflix"). */
  patterns: { pattern: string; brand: Brand }[];
  /** By recognised service name, squashed ("primevideo", "bilibili"). */
  byService: Map<string, Brand>;
}

/** Builds the brand lookup from AniList's service catalogue, plus any AniList
 *  links already seen (they carry their own icon + colour). */
export function buildBrandIndex(sources: LinkSource[], seen: StreamLink[]): BrandIndex {
  const patterns: BrandIndex['patterns'] = [];
  const byService = new Map<string, Brand>();
  const add = (name: string, brand: Brand) => {
    const key = squash(name);
    if (key && !byService.has(key)) byService.set(key, brand);
  };
  for (const s of sources) {
    if (!s.icon) continue;
    const brand: Brand = { icon: s.icon, color: s.color ?? undefined };
    const pattern = s.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (pattern) patterns.push({ pattern, brand });
    const asUrl = pattern.includes('.') ? `https://${pattern}` : '';
    add(findService(asUrl, s.site)?.name ?? s.site, brand);
  }
  for (const l of seen) {
    if (!l.icon) continue;
    const brand: Brand = { icon: l.icon, color: l.color };
    add(serviceLabel(l), brand);
    const host = hostOf(l.url);
    if (host) patterns.push({ pattern: host, brand });
  }
  return { patterns, byService };
}

/** Brand icon for a link: its own (AniList links), else the catalogue entry
 *  matching its host / recognised service — so a link you added to
 *  bilibili.tv gets the same Bilibili icon AniList's link has. Only the
 *  address counts, never the name: a link to another site keeps that site's
 *  own icon even when it's named after a service. */
export function brandFor(index: BrandIndex, link: StreamLink): Brand | null {
  if (link.icon) return { icon: link.icon, color: link.color };
  const host = hostOf(link.url);
  if (host) {
    const labels = host.split('.');
    for (const { pattern, brand } of index.patterns) {
      if (pattern.includes('.') ? host === pattern || host.endsWith(`.${pattern}`) : labels.includes(pattern)) {
        return brand;
      }
    }
  }
  const service = findService(link.url);
  return service ? (index.byService.get(squash(service.name)) ?? null) : null;
}
