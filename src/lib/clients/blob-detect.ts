// Wykrywanie „zlepków” — klientów, pod którymi siedzi kilka gabinetów
// (np. „Joanna Bakalarz”: pusta firma HubSpot z 14 osobami). Czysty moduł
// (vitest, bez @/). Punktacja z uzasadnieniem; próg SUSPECT_SCORE.
import { isPlaceholderEmail } from "./placeholder";
import { FREE_EMAIL_DOMAINS } from "../gmail/parse";

export const SUSPECT_SCORE = 3;

export type BlobInput = {
  name: string;
  nip: string | null;
  hubspotCompanyId: string | null;
  contacts: { firstName: string | null; lastName: string | null; email: string | null; phone?: string | null }[];
  invoiceNips: string[]; // NIP-y nabywców z faktur przypisanych do klienta
  country?: string | null; // kraj klienta (np. z auto-wzbogacenia HubSpota)
  invoicesCount?: number; // wszystkie faktury klienta
};

// „Kowalska” i „Kowalski” to to samo nazwisko (rodzina, nie inny gabinet).
function surnameStem(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/(ska|ski|cka|cki|dzka|dzki)$/, "sk")
    .replace(/(owa|ówna|owna|a)$/, "");
}

export function blobScore(c: BlobInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const n = c.contacts.length;
  const placeholders = c.contacts.filter((p) => isPlaceholderEmail(p.email)).length;
  if (placeholders >= 2) {
    score += 2 + Math.min(3, placeholders * 0.5);
    reasons.push(`${placeholders} osób z adresem zastępczym (np. brak.pl)`);
  }
  if (n >= 5) {
    score += n >= 8 ? 2 : 1;
    reasons.push(`${n} osób kontaktowych`);
  }
  const nips = [...new Set(c.invoiceNips.filter(Boolean))];
  if (nips.length >= 2) {
    score += 3;
    reasons.push(`faktury na ${nips.length} różne NIP-y (${nips.join(", ")})`);
  }
  if (c.nip && nips.length > 0 && !nips.includes(c.nip)) {
    score += 1;
    reasons.push(`NIP klienta ${c.nip} nie występuje na jego fakturach`);
  }
  // Wniosek 3: zlepki łączone darmową domeną (np. firma HubSpot „interia.eu”).
  const surnames = new Set(c.contacts.map((p) => p.lastName?.trim()).filter((x): x is string => !!x).map(surnameStem));
  if (surnames.size >= 2 && n >= 3) {
    score += surnames.size >= 3 ? 2 : 1;
    reasons.push(`${surnames.size} różne nazwiska wśród osób`);
  }
  const domains = c.contacts.map((p) => p.email?.split("@")[1]?.toLowerCase()).filter((x): x is string => !!x);
  const freeShared = [...new Set(domains)].filter((dom) => FREE_EMAIL_DOMAINS.has(dom) && domains.filter((x) => x === dom).length >= 2);
  // Wniosek 3 (poprawka 27.09): osoby łączy WYŁĄCZNIE darmowa domena — żadna
  // firmowa domena ani wspólny telefon — i mają różne nazwiska. To sam w
  // sobie zlepek HubSpota (firma założona z domeny interia.eu / gmail.com).
  const ownDomains = new Set(domains.filter((d) => !FREE_EMAIL_DOMAINS.has(d) && !isPlaceholderEmail(`x@${d}`)));
  const phones = c.contacts.map((p) => p.phone?.replace(/\D/g, "")).filter((x): x is string => !!x);
  const sharedPhone = phones.some((ph, i) => phones.indexOf(ph) !== i);
  if (c.hubspotCompanyId && freeShared.length && surnames.size >= 2) {
    const onlyFree = ownDomains.size === 0 && !sharedPhone;
    score += onlyFree ? 3 : 1.5;
    reasons.push(`firma HubSpot łączy osoby${onlyFree ? " wyłącznie" : ""} przez darmową domenę (${freeShared.join(", ")})`);
  }
  // Firma HubSpot bez nazwy albo nazwana domeną („brak.pl”, „interia.eu”).
  const nameLower = c.name.trim().toLowerCase();
  const domainName = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(nameLower);
  if (c.hubspotCompanyId && n >= 2 && (domainName || /^klient \d+$/.test(nameLower) || nameLower === "")) {
    score += 3;
    reasons.push(domainName ? `firma HubSpot nazwana domeną „${c.name.trim()}”` : "firma HubSpot bez nazwy");
  }
  const country = c.country?.trim().toLowerCase();
  const polishPhones = c.contacts.filter((p) => p.phone?.startsWith("+48")).length;
  if (country && !["polska", "poland", "pl"].includes(country) && polishPhones > 0) {
    score += 1.5;
    reasons.push(`kraj „${c.country}” przy polskich numerach telefonów (auto-wzbogacenie HubSpota?)`);
  }
  if (c.nip && c.invoicesCount === 0 && n >= 2) {
    score += 1;
    reasons.push(`NIP ${c.nip} bez żadnej faktury`);
  }
  const personNames = c.contacts.map((p) => [p.firstName, p.lastName].filter(Boolean).join(" ").trim().toLowerCase()).filter(Boolean);
  if (c.hubspotCompanyId && n >= 3 && personNames.includes(c.name.trim().toLowerCase())) {
    score += 1;
    reasons.push("nazwa klienta to imię jednej z osób, a firma HubSpot łączy kilka osób");
  }
  return { score: Math.round(score * 10) / 10, reasons };
}
