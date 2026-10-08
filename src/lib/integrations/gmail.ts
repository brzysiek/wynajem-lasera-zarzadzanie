import { getAccessToken } from "@/lib/integrations/google-calendar";
import { logInfo } from "@/lib/logger";

// Szkice maili (faktury do klientów) — CELOWO szkic, nie wysyłka: biuro ma
// przejrzeć i wysłać ręcznie z Gmaila, apka niczego nie wysyła sama
// (ustalone z użytkownikiem). Reużywa TEGO SAMEGO konta serwisowego co
// Kalendarz (google-calendar.ts, ten sam GOOGLE_SERVICE_ACCOUNT_EMAIL/
// PRIVATE_KEY/IMPERSONATED_USER), tylko z innym zakresem OAuth — domain-wide
// delegation w Google Admin musi mieć dopisany `gmail.compose` obok
// `calendar` dla tego samego Client ID (jednorazowy krok administratora
// Workspace, patrz /ustawienia/integracje/google).
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

// RFC 2047 — nagłówki maila muszą być ASCII; polskie znaki w temacie kodujemy.
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function createInvoiceEmailDraft(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachment: { filename: string; data: Buffer };
}): Promise<{ draftId: string }> {
  const accessToken = await getAccessToken(GMAIL_COMPOSE_SCOPE);
  const boundary = `wl_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const raw = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.html, "utf8").toString("base64"),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${input.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${input.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    input.attachment.data.toString("base64"),
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: base64url(raw) } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `Gmail API zwróciło błąd (HTTP ${res.status}).`);
  }

  logInfo("gmail_invoice_draft_created", { draftId: body?.id, to: input.to });
  return { draftId: body.id };
}

// Wysyłka gotowej wiadomości MIME z podanej skrzynki (04.10.2026 — mail
// automatyczny z cennikiem po formularzu WWW; jedyna wysyłka bez udziału
// biura, decyzja Tomka). Zakres gmail.compose pozwala też wysyłać
// (users.messages.send). Endpoint „upload” przyjmuje maile do 35 MB —
// załączniki PDF nie zmieszczą się w zwykłym żądaniu JSON.
export async function sendGmailMessage(mailbox: string, raw: string): Promise<{ id: string; threadId: string }> {
  const accessToken = await getAccessToken(GMAIL_COMPOSE_SCOPE, mailbox);
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" },
    body: raw,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error(body?.error?.message || `Gmail API zwróciło błąd (HTTP ${res.status}).`);
  }
  logInfo("gmail_message_sent", { mailbox, id: body.id });
  return { id: body.id, threadId: body.threadId };
}

// Szkic odpowiedzi z panelu (wniosek 44): zapis jako szkic w skrzynce
// `mailbox` (kontakt@). draftId podany → aktualizacja istniejącego szkicu,
// inaczej nowy; threadId → szkic jako odpowiedź w wątku klientki. Zakres
// gmail.compose (ten sam co szkice faktur). Panel nie wysyła.
export class GmailDraftGone extends Error {
  constructor() {
    super("Szkic nie istnieje już w Gmailu (wysłany albo usunięty).");
  }
}

export async function saveGmailDraft(input: { mailbox: string; draftId?: string | null; threadId?: string | null; raw: string }): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const accessToken = await getAccessToken(GMAIL_COMPOSE_SCOPE, input.mailbox);
  const message = { raw: base64url(input.raw), ...(input.threadId ? { threadId: input.threadId } : {}) };
  const url = input.draftId ? `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(input.draftId)}` : "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
  const res = await fetch(url, {
    method: input.draftId ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(input.draftId ? { id: input.draftId, message } : { message }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 404 && input.draftId) throw new GmailDraftGone();
  if (!res.ok || !body?.id) throw new Error(body?.error?.message || `Gmail API zwróciło błąd (HTTP ${res.status}).`);
  logInfo("gmail_reply_draft_saved", { mailbox: input.mailbox, draftId: body.id, update: Boolean(input.draftId) });
  return { draftId: body.id, messageId: body.message?.id ?? "", threadId: body.message?.threadId ?? input.threadId ?? "" };
}
