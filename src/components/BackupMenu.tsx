import { useCallback, useRef, useState } from 'react';
import { Download, Loader2, Mail } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { BTN_ICON, EYEBROW, MENU, MENU_ITEM } from '@/lib/ui';

interface BackupStatus {
  email: { to: string } | null;
  monthly: boolean;
  last: { at: number; ok: boolean; reason: 'monthly' | 'manual'; error?: string } | null;
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Header button: download a backup (.sql), or email one now. */
export function BackupMenu() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  async function loadStatus() {
    try {
      const res = await fetch('/api/backup/status', { cache: 'no-store' });
      if (res.ok) setStatus((await res.json()) as BackupStatus);
    } catch {
      // The menu still offers the download without it.
    }
  }

  function toggle() {
    if (!open) {
      setMessage(null);
      void loadStatus();
    }
    setOpen((o) => !o);
  }

  function download() {
    setOpen(false);
    // A temporary <a> so the browser takes the filename from Content-Disposition.
    const a = document.createElement('a');
    a.href = '/api/backup';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function emailNow() {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/backup/email', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setMessage(
        res.ok && data?.ok
          ? { ok: true, text: `Sent to ${status?.email?.to ?? 'you'}.` }
          : { ok: false, text: data?.error ?? `Couldn't send (HTTP ${res.status}).` },
      );
    } catch {
      setMessage({ ok: false, text: "Couldn't reach the server." });
    }
    setSending(false);
    void loadStatus();
  }

  const last = status?.last;
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={toggle} className={BTN_ICON} title="Backup" aria-label="Backup" aria-expanded={open}>
        <Download className="h-4 w-4" />
      </button>
      {open && (
        <div className={`absolute right-0 mt-2 w-72 p-1.5 ${MENU}`}>
          <button type="button" className={`${MENU_ITEM} text-sm text-zinc-200`} onClick={download}>
            <Download className="h-4 w-4 text-zinc-400" />
            Download backup (.sql)
          </button>
          {status?.email && (
            <button
              type="button"
              className={`${MENU_ITEM} text-sm text-zinc-200 disabled:opacity-50`}
              disabled={sending}
              onClick={() => void emailNow()}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : <Mail className="h-4 w-4 text-zinc-400" />}
              Email me a backup now
            </button>
          )}
          {message && (
            <p className={`px-2.5 py-1.5 text-xs ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>
          )}
          {status && (
            <div className="mt-1 border-t border-zinc-700 px-2.5 pb-1 pt-2 text-xs text-zinc-400">
              <div className={EYEBROW}>Email backups</div>
              {status.email ? (
                <>
                  <div className="mt-1 truncate">
                    {status.monthly ? 'Monthly, on the 1st' : 'On request'} · to {status.email.to}
                  </div>
                  {last && (
                    <div className={`mt-0.5 ${last.ok ? '' : 'text-rose-300'}`}>
                      Last {last.reason === 'monthly' ? 'monthly email' : 'email'} {when(last.at)}: {last.ok ? 'sent' : 'failed'}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1">Off. Set RESEND_API_KEY and BACKUP_EMAIL_TO on the server.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
