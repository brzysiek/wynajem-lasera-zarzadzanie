import { getAccessToken } from "@/lib/integrations/google-calendar";
import { logWarn } from "@/lib/logger";

// Odczyt Gmaila pod historię e-maili klienta (CRM, prompt 3C). WYŁĄCZNIE
// zakres gmail.readonly — ten plik niczego nie wysyła, nie usuwa ani nie
// oznacza. To samo konto serwisowe co Kalendarz i szkice faktur; zakres
// dopisany w Google Admin (domain-wide delegation) 26.09.2026.
// ZASADA: treść maili nie jest nigdzie logowana — w logach tylko id.

export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const tokens = new Map<string, { token: string; until: number }>();

async function token(mailbox: string): Promise<string> {
  const cached = tokens.get(mailbox);
  if (cached && cached.until > Date.now()) return cached.token;
  const t = await getAccessToken(GMAIL_READ_SCOPE, mailbox);
  tokens.set(mailbox, { token: t, until: Date.now() + 50 * 60_000 });
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GmailError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// GET z ponawianiem przy 429/5xx (limity Gmail API) — wykładniczo, 3 próby.
async function gmail(mailbox: string, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${await token(mailbox)}` } });
    const body = await res.json().catch(() => null);
    if (res.ok) return body ?? {};
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      logWarn("gmail_api_retry", { status: res.status, attempt });
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new GmailError(body?.error?.message || `Gmail API zwróciło błąd (HTTP ${res.status}).`, res.status);
  }
}

export async function getProfile(mailbox: string): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  const b = await gmail(mailbox, "profile");
  return { emailAddress: String(b.emailAddress ?? mailbox), historyId: String(b.historyId ?? ""), messagesTotal: Number(b.messagesTotal ?? 0) };
}

export async function listMessageIds(mailbox: string, q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q, maxResults: "500" });
  if (pageToken) params.set("pageToken", pageToken);
  const b = await gmail(mailbox, `messages?${params.toString()}`);
  const messages = (b.messages as { id: string }[] | undefined) ?? [];
  return { ids: messages.map((m) => m.id), nextPageToken: (b.nextPageToken as string | undefined) ?? null };
}

// Nowe wiadomości od historyId (bieżąca synchronizacja). 404 = historyId za
// stary (Gmail trzyma historię ok. tygodnia) — wywołujący robi nadrabianie.
export async function listHistoryAdded(
  mailbox: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<{ ids: string[]; historyId: string | null; nextPageToken: string | null }> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
  if (pageToken) params.set("pageToken", pageToken);
  const b = await gmail(mailbox, `history?${params.toString()}`);
  const ids = ((b.history as { messagesAdded?: { message: { id: string } }[] }[] | undefined) ?? []).flatMap((h) =>
    (h.messagesAdded ?? []).map((m) => m.message.id),
  );
  return { ids: [...new Set(ids)], historyId: (b.historyId as string | undefined) ?? null, nextPageToken: (b.nextPageToken as string | undefined) ?? null };
}

export type GmailMeta = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: number;
  headers: { name: string; value: string }[];
  hasAttachments: boolean;
};

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond"];

export async function getMessageMeta(mailbox: string, id: string): Promise<GmailMeta> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of META_HEADERS) params.append("metadataHeaders", h);
  const b = await gmail(mailbox, `messages/${encodeURIComponent(id)}?${params.toString()}`);
  const payload = (b.payload as { mimeType?: string; headers?: { name: string; value: string }[] } | undefined) ?? {};
  return {
    id: String(b.id),
    threadId: String(b.threadId),
    labelIds: (b.labelIds as string[] | undefined) ?? [],
    snippet: String(b.snippet ?? ""),
    internalDate: Number(b.internalDate ?? Date.now()),
    headers: payload.headers ?? [],
    // multipart/mixed = w praktyce wiadomość z załącznikiem (bez pobierania treści).
    hasAttachments: payload.mimeType === "multipart/mixed",
  };
}

type Part = { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

// Pełna treść JEDNEJ wiadomości — pobierana w chwili otwarcia na karcie
// klienta, nigdy nie zapisywana. Zwraca tekst (text/plain, a gdy go brak —
// HTML przerobiony na tekst przez wywołującego) i listę załączników.
export async function getMessageFull(
  mailbox: string,
  id: string,
): Promise<{ headers: { name: string; value: string }[]; text: string | null; html: string | null; attachments: { filename: string; size: number }[]; threadId: string }> {
  const b = await gmail(mailbox, `messages/${encodeURIComponent(id)}?format=full`);
  const payload = (b.payload as Part | undefined) ?? {};
  let text: string | null = null;
  let html: string | null = null;
  const attachments: { filename: string; size: number }[] = [];
  const walk = (p: Part) => {
    if (p.filename) {
      attachments.push({ filename: p.filename, size: p.body?.size ?? 0 });
      return;
    }
    if (p.mimeType === "text/plain" && p.body?.data && text == null) text = decode(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && html == null) html = decode(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return { headers: payload.headers ?? [], text, html, attachments, threadId: String(b.threadId ?? "") };
}
