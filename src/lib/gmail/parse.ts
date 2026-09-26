// Historia e-maili z Gmaila (CRM, prompt 3C) — czyste funkcje bez zależności
// (vitest bez aliasu "@/"). Do bazy trafiają WYŁĄCZNIE wiadomości, w których
// nadawca lub odbiorca to osoba kontaktowa klienta (albo adres w firmowej
// domenie klienta — jako propozycja nowej osoby). Treść nigdy nie jest
// zapisywana — tylko temat, skrót z Gmaila i metadane.

// Darmowe domeny pocztowe — dla nich NIE zgadujemy klienta po domenie
// (prompt 3, 4.3; lista w jednym miejscu, łatwa do rozszerzenia).
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "wp.pl", "o2.pl", "onet.pl", "onet.eu", "op.pl", "poczta.onet.pl", "interia.pl", "interia.eu",
  "interia.com", "poczta.fm", "tlen.pl", "gazeta.pl", "vp.pl", "go2.pl", "autograf.pl", "buziaczek.pl", "icloud.com", "me.com",
  "outlook.com", "outlook.pl", "hotmail.com", "live.com", "yahoo.com", "yahoo.pl", "protonmail.com", "proton.me", "aol.com",
]);

const ADDRESS_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// „Anna <a@b.pl>, "X, Y" <c@d.pl>, e@f.pl” → ["a@b.pl", "c@d.pl", "e@f.pl"]
export function parseAddresses(header: string | null | undefined): string[] {
  return [...new Set((header ?? "").match(ADDRESS_RE)?.map((a) => a.toLowerCase()) ?? [])];
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

export type MessageHeaders = Record<string, string>;

export function headerMap(headers: { name: string; value: string }[] | undefined): MessageHeaders {
  const out: MessageHeaders = {};
  for (const h of headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

// Auto-odpowiedzi i powiadomienia — pomijane (prompt 3, 4.3).
export function isAutomated(h: MessageHeaders): boolean {
  const auto = (h["auto-submitted"] ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"]) return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test(h["precedence"] ?? "")) return true;
  return /^(out of office|automatic reply|autoreply|automatyczna odpowied|nieobecno|poza biurem|undeliverable|delivery status notification|niedostarczon)/i.test(
    (h["subject"] ?? "").trim(),
  );
}

// Etykiety, których nie importujemy: szkice (np. szkice faktur z panelu,
// dopóki nie zostaną wysłane), spam, kosz, czat.
export function isSkippedByLabels(labelIds: string[] | undefined): boolean {
  return (labelIds ?? []).some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH" || l === "CHAT");
}

export type AddressIndex = {
  byEmail: Map<string, { clientId: string; contactId: string }>;
  byDomain: Map<string, string>; // firmowa domena → clientId (tylko gdy jednoznaczna)
};

export function buildAddressIndex(contacts: { clientId: string; contactId: string; email: string | null }[]): AddressIndex {
  const byEmail = new Map<string, { clientId: string; contactId: string }>();
  const domainClients = new Map<string, Set<string>>();
  for (const c of contacts) {
    const e = c.email?.trim().toLowerCase();
    if (!e || !e.includes("@")) continue;
    byEmail.set(e, { clientId: c.clientId, contactId: c.contactId });
    const d = domainOf(e);
    if (!FREE_EMAIL_DOMAINS.has(d)) domainClients.set(d, (domainClients.get(d) ?? new Set()).add(c.clientId));
  }
  const byDomain = new Map<string, string>();
  for (const [d, ids] of domainClients) if (ids.size === 1) byDomain.set(d, [...ids][0]);
  return { byEmail, byDomain };
}

export type ClassifiedEmail = {
  direction: "IN" | "OUT";
  clientId: string;
  clientContactId: string | null;
  matchMethod: "EMAIL" | "DOMAIN";
  counterpart: string; // adres klienta, którego dotyczy wiadomość
};

// Czy wiadomość dotyczy klienta i w którą stronę idzie. `own` = adresy
// naszych skrzynek (i domena firmy) — wiadomość od nas = OUT.
export function classifyEmail(
  input: { from: string[]; to: string[]; cc: string[] },
  index: AddressIndex,
  isOwn: (address: string) => boolean,
): ClassifiedEmail | null {
  const fromOwn = input.from.some(isOwn);
  const others = fromOwn ? [...input.to, ...input.cc] : input.from;
  const direction = fromOwn ? "OUT" : "IN";
  for (const a of others) {
    const hit = index.byEmail.get(a);
    if (hit) return { direction, clientId: hit.clientId, clientContactId: hit.contactId, matchMethod: "EMAIL", counterpart: a };
  }
  // Nadawca spoza bazy, a klientka jest w „Do”/„DW” (np. wątek z kimś z jej
  // gabinetu, my w kopii) — to też korespondencja z klientką.
  if (!fromOwn) {
    for (const a of [...input.to, ...input.cc]) {
      const hit = index.byEmail.get(a);
      if (hit) return { direction: "IN", clientId: hit.clientId, clientContactId: hit.contactId, matchMethod: "EMAIL", counterpart: a };
    }
  }
  for (const a of others) {
    if (isOwn(a)) continue;
    const clientId = index.byDomain.get(domainOf(a));
    if (clientId) return { direction, clientId, clientContactId: null, matchMethod: "DOMAIN", counterpart: a };
  }
  return null;
}

// Zapytania do Gmaila dla importu historii: kilka adresów na raz, składnia
// {a b c} = LUB. Bez limitu dat (prompt 3, 4.3).
export function historyQuery(addresses: string[]): string {
  const terms = addresses.flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`]);
  return `{${terms.join(" ")}} -in:chats -in:drafts`;
}

// HTML → zwykły tekst do podglądu (bez skryptów, obrazów i iframe'ów —
// wyświetlamy wyłącznie tekst).
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
