import { escapeHtml } from './mail';

const CONTACT_MAIL = 'kontakt@stamm-phoenix.de';

/** Shared Phoenix frame for transactional emails, with inline styles for mail clients. */
export function mailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #810a1a;padding:24px;">
    ${content}
    <p style="margin-top:32px;font-size:12px;color:#6b7280;">
      DPSG Stamm Phoenix Feldkirchen-Westerham · Fragen? <a href="mailto:${CONTACT_MAIL}" style="color:#003056;">${CONTACT_MAIL}</a>
    </p>
  </div>
</body>
</html>`;
}

export function mailButton(
  href: string,
  label: string,
  fallback = 'Falls der Button nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:'
): string {
  return `<p style="margin:24px 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:#810a1a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px;">${escapeHtml(label)}</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">${escapeHtml(fallback)}<br />
      <a href="${escapeHtml(href)}" style="color:#003056;word-break:break-all;">${escapeHtml(href)}</a>
    </p>`;
}
