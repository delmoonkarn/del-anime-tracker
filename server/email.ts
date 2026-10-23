// Sending email through Resend (resend.com): backups and password-reset links.

export interface EmailConfig {
  /** Resend API key. */
  apiKey: string;
  to: string;
  /** Defaults to Resend's test sender, which can only mail your own Resend address. */
  from?: string;
}

export interface EmailMessage {
  subject: string;
  text: string;
  /** content is base64. */
  attachments?: { filename: string; content: string }[];
}

export async function sendEmail(cfg: EmailConfig, msg: EmailMessage): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: cfg.from || 'Anime Tracker <onboarding@resend.dev>',
      to: [cfg.to],
      ...msg,
    }),
  });
  if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
