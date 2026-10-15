import type { ReactNode } from 'react';

/** Title row for the Explore / Watchlist pages: heading with an optional
 *  count, description, actions on the right and controls underneath. */
export function PageHeader({
  title,
  count,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-zinc-800 pb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-sm font-semibold text-zinc-300 tabular-nums">
                {count}
              </span>
            )}
          </h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-zinc-400">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
