import { createHmac, timingSafeEqual } from "node:crypto";
import { extractPhone } from "@/lib/leads/mail-intake-rules";

// Messenger i Instagram Direct (wniosek 42): czyste reguły — podpis webhooka,
// rozbiór ładunku Meta, klucze kontaktowe z treści i porównanie imion.
// Bez bazy i sieci (vitest).

export type ChatChannelKey = "MESSENGER" | "INSTAGRAM";

export type MetaEvent = {
  channel: ChatChannelKey;
  pageId: string; // nasza strona / konto IG
  userId: string; // PSID / IGSID klientki
  mid: string;
  text: string | null;
  attachments: { type: string; url: string | null }[];
  at: Date;
  outbound: boolean; // echo naszej odpowiedzi
};

// X-Hub-Signature-256: „sha256=” + HMAC-SHA256 surowego ciała kluczem App Secret.
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

// object „page” (Messenger) albo „instagram”; wpisy bez wiadomości (dostarczono,
// przeczytano, reakcje, postbacki) pomijamy.
export function parseMetaPayload(body: unknown): MetaEvent[] {
  if (!isRec(body) || !Array.isArray(body.entry)) return [];
  const channel: ChatChannelKey | null = body.object === "page" ? "MESSENGER" : body.object === "instagram" ? "INSTAGRAM" : null;
  if (!channel) return [];
  const out: MetaEvent[] = [];
  for (const entry of body.entry) {
    if (!isRec(entry)) continue;
    // `messaging` — nasza aplikacja jest głównym odbiorcą rozmowy; `standby` — głównym
    // jest inna aplikacja (np. HubSpot), a my tylko czytamy. Oba traktujemy tak samo
    // (deduplikacja po mid), bez przejmowania rozmowy (Handover Protocol).
    const events = [...(Array.isArray(entry.messaging) ? entry.messaging : []), ...(Array.isArray(entry.standby) ? entry.standby : [])];
    if (!events.length) continue;
    const pageId = str(entry.id) ?? "";
    for (const ev of events) {
      if (!isRec(ev) || !isRec(ev.message) || !isRec(ev.sender) || !isRec(ev.recipient)) continue;
      const m = ev.message;
      const mid = str(m.mid);
      const senderId = str(ev.sender.id);
      const recipientId = str(ev.recipient.id);
      if (!mid || !senderId || !recipientId) continue;
      const outbound = m.is_echo === true || senderId === pageId;
      const ts = typeof ev.timestamp === "number" ? ev.timestamp : Number(ev.timestamp);
      out.push({
        channel,
        pageId,
        userId: outbound ? recipientId : senderId,
        mid,
        text: typeof m.text === "string" && m.text.trim() ? m.text : null,
        attachments: (Array.isArray(m.attachments) ? m.attachments : []).filter(isRec).map((a) => ({ type: str(a.type) ?? "file", url: isRec(a.payload) ? str(a.payload.url) : null })),
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(),
        outbound,
      });
    }
  }
  return out;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Twarde klucze podane w rozmowie: telefon (E.164) i e-mail.
export function extractContactKeys(text: string | null): { phone: string | null; email: string | null } {
  if (!text) return { phone: null, email: null };
  return { phone: extractPhone(text), email: text.match(EMAIL_RE)?.[0].toLowerCase() ?? null };
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Imię i nazwisko do porównania: małe litery bez ogonków, same słowa.
export function nameTokens(name: string | null | undefined): string[] {
  return fold(name ?? "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

// Samo imię i nazwisko = tylko PROPOZYCJA połączenia (nigdy automat). Zgodność:
// co najmniej dwa słowa i te same słowa niezależnie od kolejności.
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

// Wątek bez imienia (brak tokenu strony): czytelny podpis zamiast surowego ID.
export function fallbackChatName(channel: ChatChannelKey, userId: string): string {
  return `${channel === "INSTAGRAM" ? "Instagram" : "Messenger"} ${userId.slice(-4)}`;
}
