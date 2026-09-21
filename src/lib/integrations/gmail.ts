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
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

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
