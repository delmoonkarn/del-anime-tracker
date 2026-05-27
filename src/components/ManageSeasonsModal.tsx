
import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Season } from '@/lib/types';
import { useConfirm } from './ConfirmDialog';

interface Props {
  open: boolean;
  seasons: Season[];
  onClose: () => void;
  onDeleteMany: (ids: string[]) => void;
}

export function ManageSeasonsModal({ open, seasons, onClose, onDeleteMany }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = seasons.length > 0 && selected.size === seasons.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(seasons.map((s) => s.id)));
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const names = seasons
      .filter((s) => selected.has(s.id))
      .map((s) => `• ${s.name}`)
      .join('\n');
    const ok = await confirm({
      title: `Delete ${selected.size} season${selected.size === 1 ? '' : 's'}?`,
      message: `This will permanently remove these seasons and all their anime:\n\n${names}`,
      kind: 'danger',
      confirmText: 'Delete',
    });
    if (ok) {
      onDeleteMany(Array.from(selected));
      onClose();
    }
  };

  const totalAnimes = seasons
    .filter((s) => selected.has(s.id))
    .reduce((sum, s) => sum + s.animes.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Manage Seasons</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/60">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-indigo-500"
            />
            Select all
          </label>
          <span className="text-xs text-zinc-500">
            {selected.size} selected{totalAnimes > 0 ? ` · ${totalAnimes} anime` : ''}
          </span>
        </div>

        <ul className="overflow-y-auto divide-y divide-zinc-800">
          {seasons.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-3 p-3 hover:bg-zinc-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-indigo-500"
                />
                <span className="flex-1 text-sm truncate">{s.name}</span>
                <span className="text-xs text-zinc-500 shrink-0">
                  {s.animes.length} {s.animes.length === 1 ? 'show' : 'shows'}
                </span>
              </label>
            </li>
          ))}
          {seasons.length === 0 && (
            <li className="p-4 text-center text-sm text-zinc-500">No seasons.</li>
          )}
        </ul>

        <footer className="flex justify-end gap-2 p-4 border-t border-zinc-800 bg-zinc-900">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Done
          </button>
          <button
            onClick={handleDelete}
            disabled={selected.size === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/90 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white inline-flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete selected
          </button>
        </footer>
      </div>
    </div>
  );
}
