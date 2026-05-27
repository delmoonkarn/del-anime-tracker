
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

export type ConfirmKind = 'info' | 'warning' | 'danger';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  kind?: ConfirmKind;
  /** If true, only show the confirm button (alert-style). */
  alert?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx);
  if (!fn) {
    // Fallback to native confirm so the app doesn't crash if the provider is
    // missing somewhere — but warn so we notice during dev.
    console.warn('useConfirm called outside ConfirmProvider; using native confirm.');
    return (opts: ConfirmOptions) =>
      Promise.resolve(
        opts.alert
          ? (window.alert(typeof opts.message === 'string' ? opts.message : opts.title), true)
          : window.confirm(typeof opts.message === 'string' ? opts.message : opts.title),
      );
  }
  return fn;
}

interface Pending {
  opts: ConfirmOptions;
  resolve: (result: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm: ConfirmFn = useCallback(
    (opts) => new Promise((resolve) => setPending({ opts, resolve })),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      setPending((cur) => {
        if (!cur) return null;
        cur.resolve(result);
        return null;
      });
    },
    [],
  );

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          opts={pending.opts}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </Ctx.Provider>
  );
}

function Dialog({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const kind = opts.kind ?? 'info';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  const buttonClass =
    kind === 'danger'
      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
      : kind === 'warning'
        ? 'bg-amber-500 hover:bg-amber-600 text-zinc-950 shadow-amber-500/20'
        : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20';

  const iconWrap =
    kind === 'danger'
      ? 'bg-red-500/15 text-red-400'
      : kind === 'warning'
        ? 'bg-amber-500/15 text-amber-400'
        : 'bg-indigo-500/15 text-indigo-400';

  const Icon = kind === 'info' ? Info : AlertTriangle;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 p-4 border-b border-zinc-800">
          <div
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${iconWrap}`}
          >
            <Icon className="w-4.5 h-4.5" />
          </div>
          <h2 className="text-base font-semibold flex-1 pt-1.5">{opts.title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
          {opts.message}
        </div>
        <footer className="flex justify-end gap-2 p-3 border-t border-zinc-800 bg-zinc-900/60">
          {!opts.alert && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800"
            >
              {opts.cancelText ?? 'Cancel'}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-lg ${buttonClass}`}
          >
            {opts.confirmText ?? (opts.alert ? 'OK' : 'Confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
