import { useEffect, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';

/** Card grid vs stacked rows. */
export type ViewMode = 'card' | 'list';

/** View mode remembered per page (e.g. 'scheduleViewMode') so it survives reloads. */
export function usePersistedViewMode(key: string, fallback: ViewMode = 'card') {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === 'list' || saved === 'card' ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, mode);
    } catch {
      // Storage unavailable (private mode, etc.) — view mode just won't persist.
    }
  }, [key, mode]);
  return [mode, setMode] as const;
}

/** Small segmented control — mirrors the .xlsx/.json toggle style used
 *  elsewhere (e.g. ImportExportMenu) for visual consistency. */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const btn = (mode: ViewMode, label: string, Icon: typeof LayoutGrid) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        value === mode ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200'
      }`}
      title={`${label} view`}
      aria-pressed={value === mode}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="flex gap-0.5 p-1 bg-zinc-950 border border-zinc-800 rounded-lg shrink-0">
      {btn('card', 'Card', LayoutGrid)}
      {btn('list', 'List', ListIcon)}
    </div>
  );
}
