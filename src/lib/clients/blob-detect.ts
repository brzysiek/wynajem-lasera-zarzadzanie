// Wykrywanie „zlepków” — klientów, pod którymi siedzi kilka gabinetów
// (np. „Joanna Bakalarz”: pusta firma HubSpot z 14 osobami). Czysty moduł
// (vitest, bez @/). Punktacja z uzasadnieniem; próg SUSPECT_SCORE.
import { isPlaceholderEmail } from "./placeholder";

export const SUSPECT_SCORE = 3;

export type BlobInput = {
  name: string;
  nip: string | null;
  hubspotCompanyId: string | null;
  contacts: { firstName: string | null; lastName: string | null; email: string | null }[];
  invoiceNips: string[]; // NIP-y nabywców z faktur przypisanych do klienta
};

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
  const personNames = c.contacts.map((p) => [p.firstName, p.lastName].filter(Boolean).join(" ").trim().toLowerCase()).filter(Boolean);
  if (c.hubspotCompanyId && n >= 3 && personNames.includes(c.name.trim().toLowerCase())) {
    score += 1;
    reasons.push("nazwa klienta to imię jednej z osób, a firma HubSpot łączy kilka osób");
  }
  return { score: Math.round(score * 10) / 10, reasons };
}
