/**
 * Transactional email for agentwright.app, sent through Resend (https://resend.com).
 *
 * The HTML layout mirrors the shared mail template (project files: agentwright/mail/render-mail.mjs,
 * kind "support"): spam-safe, inline CSS, `background-color` longhand + `bgcolor`, no images or
 * remote resources, at most one button.
 *
 * Config (Pages project → Settings → Variables and Secrets):
 *   secret RESEND_API_KEY      — without it, sending is skipped and records keep emailSent=false
 *   var    MAIL_FROM           — optional, default "Agentwright <hello@agentwright.app>"
 */
import type { LicenseRecord } from "./license";

export interface MailEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

const C = { navy: "#0F172A", amber: "#F59E0B", bg: "#FAFAF9", text: "#1C1917", muted: "#57534E", line: "#E7E5E4" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
const FOOT = "Agentwright · agentwright.app — Developer starter kit for Claude-based agent SaaS. Just reply to this email if you need anything else.";
const SIGN = "— The Agentwright team";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

export interface MailContent {
  subject: string;
  preheader?: string;
  title: string;
  greeting?: string;
  paragraphs?: string[];
  rows?: [string, string][];
  action?: { label: string; url: string };
  after?: string[];
}

const P = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${C.text};">${inline(s)}</p>`;

export function renderMail(m: MailContent): { html: string; text: string } {
  let body = `<h1 style="margin:0 0 16px;font-size:21px;line-height:1.35;color:${C.navy};">${inline(m.title)}</h1>`;
  if (m.greeting) body += P(m.greeting);
  (m.paragraphs ?? []).forEach((p) => (body += P(p)));
  if (m.rows?.length) {
    body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border:1px solid ${C.line};border-radius:6px;border-collapse:separate;">${m.rows
      .map(
        ([k, v], i) =>
          `<tr><td style="padding:10px 14px;font-size:14px;color:${C.muted};${i ? `border-top:1px solid ${C.line};` : ""}">${inline(k)}</td><td align="right" style="padding:10px 14px;font-size:14px;font-weight:600;color:${C.text};font-family:ui-monospace,Menlo,Consolas,monospace;${i ? `border-top:1px solid ${C.line};` : ""}">${inline(v)}</td></tr>`,
      )
      .join("")}</table>`;
  }
  if (m.action) {
    body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td bgcolor="${C.navy}" style="border-radius:6px;background-color:${C.navy};"><a href="${esc(m.action.url)}" style="display:inline-block;padding:11px 20px;background-color:${C.navy};border:1px solid ${C.navy};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${esc(m.action.label)}</a></td></tr></table>`;
  }
  (m.after ?? []).forEach((p) => (body += P(p)));
  body += `<p style="margin:18px 0 0;font-size:15px;line-height:1.65;color:${C.text};">${esc(SIGN)}</p>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.subject)}</title></head>
<body bgcolor="${C.bg}" style="margin:0;padding:0;background-color:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(m.preheader ?? "")}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.bg}" style="background-color:${C.bg};font-family:${FONT};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;">
<tr><td style="padding:0 4px 14px;"><span style="font-size:20px;font-weight:700;letter-spacing:-.01em;color:${C.navy};border-bottom:3px solid ${C.amber};padding-bottom:2px;">agentwright</span></td></tr>
<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid ${C.line};border-top:4px solid ${C.navy};border-radius:8px;padding:26px 24px 22px;">
${body}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${C.muted};">${esc(FOOT)}</td></tr>
</table></td></tr></table>
</body></html>`;

  let text = plain(m.title) + "\n\n";
  if (m.greeting) text += plain(m.greeting) + "\n\n";
  (m.paragraphs ?? []).forEach((p) => (text += plain(p) + "\n\n"));
  if (m.rows?.length) text += m.rows.map(([k, v]) => `- ${plain(k)}: ${plain(v)}`).join("\n") + "\n\n";
  if (m.action) text += `${m.action.label}: ${m.action.url}\n\n`;
  (m.after ?? []).forEach((p) => (text += plain(p) + "\n\n"));
  text += `${SIGN}\n\n--\n${FOOT}\n`;
  return { html, text };
}

export function licenseMail(record: LicenseRecord): MailContent {
  const first = (record.name ?? "").trim().split(/\s+/)[0];
  const rows: [string, string][] = [["License key", record.key]];
  if (record.orderNumber) rows.push(["Order", `#${record.orderNumber}`]);
  return {
    subject: `${record.testMode ? "[TEST] " : ""}Your Agentwright Starter license and download`,
    preheader: "Your license key and download link for the Agentwright Starter.",
    title: "Thanks for buying the Agentwright Starter",
    greeting: first ? `Hi ${first},` : "Hi there,",
    paragraphs: [
      "Your order went through. Here is your license key. Keep this email: the key and the download link below are all you need.",
    ],
    rows,
    action: { label: "Download the Starter", url: record.downloadUrl },
    after: [
      "The download link works as long as your license is active, so you can come back to it for future updates. Unzip it and follow **README.md** to get running.",
      "Not what you expected? You can get a full refund within 14 days, no questions asked. Just reply to this email.",
    ],
  };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Sends one email through the Resend REST API. Never throws. */
export async function sendMail(
  env: MailEnv,
  to: string,
  content: MailContent,
  opts: { replyTo?: string; idempotencyKey?: string } = {},
): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not configured" };
  const { html, text } = renderMail(content);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || "Agentwright <hello@agentwright.app>",
        to: [to],
        subject: content.subject,
        html,
        text,
        reply_to: opts.replyTo ?? "hello@agentwright.app",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !data.id) return { ok: false, error: `resend ${res.status}: ${data.message ?? "unknown error"}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: `resend fetch failed: ${(err as Error).message}` };
  }
}
